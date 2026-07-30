/**
 * chat.js — Chat API with multi-provider routing + client key overrides
 */

import { Router } from 'express';
import { routeToLLM, getBoardMembers, identifyBoardMember } from '../utils/llm_router.js';
import { logSystemEvent } from '../utils/vault.js';
import { orchestrateMessage, getTaskStatus, getAllAgents } from '../utils/paperclip_orchestration.js';
import { resolveKey, DEFAULT_ROLE_MODELS, PROVIDERS } from '../utils/providers.js';
import { env } from '../utils/env.js';

const router = Router();
const conversations = new Map();
const taskHistory = new Map();

function extractClientKeys(req) {
  const hdr = req.headers['x-provider-keys'];
  if (hdr) {
    try {
      return JSON.parse(Buffer.from(String(hdr), 'base64').toString('utf8'));
    } catch {
      /* ignore */
    }
  }
  if (req.body?.providerKeys && typeof req.body.providerKeys === 'object') {
    return req.body.providerKeys;
  }
  return {};
}

function anyProviderConfigured(clientKeys = {}) {
  return Object.keys(PROVIDERS).some((id) => !!resolveKey(id, clientKeys));
}

function demoResponse(role = 'jarvis') {
  return {
    response:
      `I'm **JARVIS**, your Chief of Staff. No LLM provider keys are active yet.\n\n` +
      `**Quick start (recommended):**\n` +
      `1. Open **Settings** (gear icon)\n` +
      `2. Paste your **NVIDIA NIM** API key from [build.nvidia.com](https://build.nvidia.com)\n` +
      `3. Optionally add OpenRouter free-tier, OpenAI, Claude, Gemini, or Grok keys\n` +
      `4. Assign models per board member\n\n` +
      `NVIDIA is the primary stack. OpenRouter free models activate automatically as fallback when configured.\n\n` +
      `UI panels (vault, canvas, mind map, notepad) work offline either way.`,
    model: 'demo-mode',
    provider: 'none',
    role,
    boardMember: 'Jarvis — Demo Mode',
    usage: {},
    timestamp: new Date().toISOString(),
  };
}

function isMissingKeyError(message = '') {
  return /Neither NVIDIA_API_KEY|no LLM provider|not configured|No API key for provider/i.test(message);
}

// ── POST /api/chat ──────────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  try {
    const {
      message,
      sessionId = 'default',
      role = 'jarvis',
      model = null,
      provider = null,
      roleModels = {},
    } = req.body || {};

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    const clientKeys = extractClientKeys(req);
    const mergedRoleModels = { ...DEFAULT_ROLE_MODELS, ...roleModels };

    if (!conversations.has(sessionId)) conversations.set(sessionId, []);
    const history = conversations.get(sessionId);

    try {
      const orchestrationResult = await orchestrateMessage({ message, sessionId, role });
      if (orchestrationResult?.task) taskHistory.set(orchestrationResult.task.id, orchestrationResult.task);
    } catch (e) {
      console.warn('[Paperclip]', e.message);
    }

    history.push({ role: 'user', content: message });

    if (!anyProviderConfigured(clientKeys)) {
      const demo = demoResponse(role);
      history.push({ role: 'assistant', content: demo.response });
      return res.json(demo);
    }

    const result = await routeToLLM({
      messages: history,
      role,
      model,
      provider,
      clientKeys,
      roleModels: mergedRoleModels,
    });

    history.push({ role: 'assistant', content: result.content });
    if (history.length > 50) {
      conversations.set(sessionId, history.slice(-50));
    }

    try {
      await logSystemEvent(role, 'CHAT', `Processed by ${result.boardMember} via ${result.provider}/${result.model}`);
    } catch {
      /* ignore */
    }

    res.json({
      response: result.content,
      model: result.model,
      provider: result.provider,
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
    res.json({
      response: `I hit an error talking to the model providers:\n\n\`\`\`\n${err.message.slice(0, 1200)}\n\`\`\`\n\nOpen **Settings** to verify your NVIDIA (or other) API keys and model assignments.`,
      model: 'error',
      provider: 'error',
      role: req.body?.role || 'jarvis',
      boardMember: 'Jarvis — Error Recovery',
      usage: {},
      timestamp: new Date().toISOString(),
      error: true,
    });
  }
});

router.post('/delegate', async (req, res) => {
  try {
    const { task, targetRole, roleModels = {} } = req.body || {};
    if (!task) return res.status(400).json({ error: 'Task description is required' });
    const clientKeys = extractClientKeys(req);
    const mergedRoleModels = { ...DEFAULT_ROLE_MODELS, ...roleModels };

    let role = targetRole;
    let reason = 'Explicitly assigned';
    if (!role) {
      const assignment = await identifyBoardMember(task, { clientKeys, roleModels: mergedRoleModels });
      role = assignment.role;
      reason = assignment.reason;
    }

    const result = await routeToLLM({
      prompt: task,
      role,
      clientKeys,
      roleModels: mergedRoleModels,
    });

    res.json({
      response: result.content,
      delegatedTo: role,
      reason,
      model: result.model,
      provider: result.provider,
      usage: result.usage,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Delegation failed', details: err.message });
  }
});

router.get('/board', (req, res) => {
  const clientKeys = extractClientKeys(req);
  // role models from query optional JSON
  let roleModels = {};
  if (req.query.roleModels) {
    try {
      roleModels = JSON.parse(String(req.query.roleModels));
    } catch {
      /* ignore */
    }
  }
  res.json({
    members: getBoardMembers({ ...DEFAULT_ROLE_MODELS, ...roleModels }),
    timestamp: new Date().toISOString(),
  });
});

router.get('/status', (req, res) => {
  const clientKeys = extractClientKeys(req);
  const providerStatus = {};
  for (const id of Object.keys(PROVIDERS)) {
    providerStatus[id] = !!resolveKey(id, clientKeys);
  }
  const any = Object.values(providerStatus).some(Boolean);
  res.json({
    status: 'operational',
    platform: 'AI Boardroom',
    version: '2.0.0',
    primaryProvider: 'nvidia',
    providers: providerStatus,
    nvidiaConfigured: providerStatus.nvidia,
    openRouterConfigured: providerStatus.openrouter,
    geminiConfigured: providerStatus.google,
    openaiConfigured: providerStatus.openai,
    xaiConfigured: providerStatus.xai,
    anthropicConfigured: providerStatus.anthropic,
    apiKeyConfigured: any,
    voiceEnabled: !!(env('GEMINI_API_KEY') || env('OPENAI_API_KEY') || env('XAI_API_KEY')),
    vaultPath: env('OBSIDIAN_VAULT_PATH', './obsidian_vault'),
    boardMembers: getBoardMembers().length,
    activeSessions: conversations.size,
    demoMode: !any,
    timestamp: new Date().toISOString(),
  });
});

router.get('/paperclip/agents', (_req, res) => {
  res.json({ agents: getAllAgents(), timestamp: new Date().toISOString() });
});

router.get('/paperclip/tasks', (_req, res) => {
  const tasks = Array.from(taskHistory.values());
  res.json({ tasks, totalTasks: tasks.length, timestamp: new Date().toISOString() });
});

router.get('/paperclip/tasks/:taskId', async (req, res) => {
  const task = taskHistory.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const status = await getTaskStatus(req.params.taskId);
  res.json({ task, status, timestamp: new Date().toISOString() });
});

export default router;
