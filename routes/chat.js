/**
 * chat.js — Chat API Routes
 * Handles communication between the Jarvis frontend and the Board of Directors.
 */

import { Router } from 'express';
import { routeToLLM, getBoardMembers, identifyBoardMember } from '../utils/llm_router.js';
import { logSystemEvent } from '../utils/vault.js';
import { orchestrateMessage, getTaskStatus, getAllAgents } from '../utils/paperclip_orchestration.js';
import { env } from '../utils/env.js';

const router = Router();

const conversations = new Map();
const taskHistory = new Map();

function demoResponse(role = 'jarvis') {
  return {
    response:
      `I'm **JARVIS**, your Chief of Staff. I'm running in **demo mode** because no working LLM API key is configured.\n\n` +
      `To activate the full Board of Directors, set one of these in your Vercel / \`.env\` environment:\n` +
      `\`\`\`\nGEMINI_API_KEY=your-gemini-key\nOPENROUTER_API_KEY=your-openrouter-key\n\`\`\`\n\n` +
      `Once connected I can route directives to:\n` +
      `- **The Architect (CEO)** — Strategy & system design\n` +
      `- **The Coder (CTO)** — Engineering & deployment\n` +
      `- **The Creative (CMO)** — Design & marketing\n` +
      `- **The Analyst (CFO)** — Research & data\n` +
      `- **Product / DevOps / Security / QA** — Full board coverage\n\n` +
      `UI panels (vault, canvas, mind map, notepad) still work offline.`,
    model: 'demo-mode',
    role,
    boardMember: 'Jarvis — Demo Mode',
    usage: {},
    timestamp: new Date().toISOString(),
  };
}

function isMissingKeyError(message = '') {
  return /OPENROUTER_API_KEY|GEMINI_API_KEY|API key|api key|Neither GEMINI/i.test(message);
}

// ── POST /api/chat ──────────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  try {
    const { message, sessionId = 'default', role = 'jarvis' } = req.body || {};

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (!conversations.has(sessionId)) {
      conversations.set(sessionId, []);
    }
    const history = conversations.get(sessionId);

    // Track via Paperclip-compatible task model (in-memory)
    try {
      const orchestrationResult = await orchestrateMessage({ message, sessionId, role });
      if (orchestrationResult?.task) {
        taskHistory.set(orchestrationResult.task.id, orchestrationResult.task);
      }
    } catch (e) {
      console.warn('[Paperclip] orchestration skipped:', e.message);
    }

    history.push({ role: 'user', content: message });

    // No keys at all → instant demo (no external call)
    if (!env('GEMINI_API_KEY') && !env('OPENROUTER_API_KEY')) {
      const demo = demoResponse(role);
      history.push({ role: 'assistant', content: demo.response });
      return res.json(demo);
    }

    const result = await routeToLLM({
      messages: history,
      role,
    });

    history.push({ role: 'assistant', content: result.content });

    if (history.length > 50) {
      const systemMsg = history.find((m) => m.role === 'system');
      const recent = history.slice(-48);
      conversations.set(sessionId, systemMsg ? [systemMsg, ...recent] : recent);
    }

    try {
      await logSystemEvent(role, 'CHAT', `User query processed by ${result.boardMember}`);
    } catch {
      // vault is non-critical on serverless
    }

    res.json({
      response: result.content,
      model: result.model,
      role: result.role,
      boardMember: result.boardMember,
      usage: result.usage,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[CHAT ERROR]', err.message);

    if (isMissingKeyError(err.message)) {
      return res.json(demoResponse(req.body?.role || 'jarvis'));
    }

    // Graceful user-facing error (don't blank the chat)
    const isAuth = /401|User not found|invalid.?api.?key|API_KEY_INVALID|PERMISSION_DENIED/i.test(err.message || '');
    const guidance = isAuth
      ? 'Your Gemini or OpenRouter API key looks invalid or revoked. Open the Vercel project → Settings → Environment Variables, re-paste **GEMINI_API_KEY** and/or **OPENROUTER_API_KEY** (no quotes, no trailing spaces), then Redeploy.'
      : 'Check your API keys and model names in environment settings, then try again.';
    res.json({
      response: `I hit an error talking to the model provider:\n\n> ${err.message}\n\n${guidance}`,
      model: 'error',
      role: req.body?.role || 'jarvis',
      boardMember: 'Jarvis — Error Recovery',
      usage: {},
      timestamp: new Date().toISOString(),
      error: true,
    });
  }
});

// ── POST /api/delegate ──────────────────────────────────────────────────────
router.post('/delegate', async (req, res) => {
  try {
    const { task, targetRole } = req.body || {};

    if (!task) {
      return res.status(400).json({ error: 'Task description is required' });
    }

    let role = targetRole;
    let reason = 'Explicitly assigned';
    if (!role) {
      const assignment = await identifyBoardMember(task);
      role = assignment.role;
      reason = assignment.reason;
    }

    const result = await routeToLLM({ prompt: task, role });

    try {
      await logSystemEvent('jarvis', 'DELEGATE', `Task delegated to ${role}: ${String(task).substring(0, 80)}...`);
    } catch {
      /* ignore */
    }

    res.json({
      response: result.content,
      delegatedTo: role,
      reason,
      model: result.model,
      usage: result.usage,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[DELEGATE ERROR]', err.message);
    if (isMissingKeyError(err.message)) {
      return res.json({
        ...demoResponse('jarvis'),
        delegatedTo: req.body?.targetRole || 'jarvis',
        reason: 'Demo mode',
      });
    }
    res.status(500).json({ error: 'Delegation failed', details: err.message });
  }
});

// ── GET /api/board ──────────────────────────────────────────────────────────
router.get('/board', (_req, res) => {
  res.json({
    members: getBoardMembers(),
    timestamp: new Date().toISOString(),
  });
});

// ── GET /api/status ─────────────────────────────────────────────────────────
router.get('/status', (_req, res) => {
  const openRouterConfigured = !!env('OPENROUTER_API_KEY');
  const geminiConfigured = !!env('GEMINI_API_KEY');
  res.json({
    status: 'operational',
    platform: 'AI Boardroom',
    version: '1.1.1',
    openRouterConfigured,
    apiKeyConfigured: openRouterConfigured || geminiConfigured,
    geminiConfigured,
    voiceEnabled: geminiConfigured,
    vaultPath: env('OBSIDIAN_VAULT_PATH', './obsidian_vault'),
    boardMembers: getBoardMembers().length,
    activeSessions: conversations.size,
    demoMode: !openRouterConfigured && !geminiConfigured,
    timestamp: new Date().toISOString(),
  });
});

// ── Paperclip monitoring ────────────────────────────────────────────────────
router.get('/paperclip/agents', (_req, res) => {
  res.json({
    agents: getAllAgents(),
    timestamp: new Date().toISOString(),
  });
});

router.get('/paperclip/tasks', (_req, res) => {
  const tasks = Array.from(taskHistory.values());
  res.json({
    tasks,
    totalTasks: tasks.length,
    timestamp: new Date().toISOString(),
  });
});

router.get('/paperclip/tasks/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const task = taskHistory.get(taskId);

  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const status = await getTaskStatus(taskId);
  res.json({
    task,
    status,
    timestamp: new Date().toISOString(),
  });
});

export default router;
