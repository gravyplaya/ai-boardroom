/**
 * chat.js — Chat + SSE streaming + agent activity
 */

import { Router } from 'express';
import { routeToLLM, streamRouteToLLM, getBoardMembers, identifyBoardMember } from '../utils/llm_router.js';
import { logSystemEvent } from '../utils/vault.js';
import {
  orchestrateMessage,
  getTaskStatus,
  getAllAgents,
  completeTask,
  failTask,
  listTasks,
} from '../utils/paperclip_orchestration.js';
import { resolveKey, DEFAULT_ROLE_MODELS, PROVIDERS } from '../utils/providers.js';
import { extractClientKeys } from '../utils/client_keys.js';
import { authEnabled } from '../utils/auth.js';

const router = Router();
const conversations = new Map();

function anyProviderConfigured(clientKeys = {}) {
  return Object.keys(PROVIDERS).some((id) => !!resolveKey(id, clientKeys));
}

function demoResponse(role = 'jarvis') {
  return {
    response:
      `I'm **JARVIS**, your Chief of Staff. No LLM provider keys are active yet.\n\n` +
      `**Quick start:**\n` +
      `1. Open **Settings**\n` +
      `2. Paste your **NVIDIA NIM** key from [build.nvidia.com](https://build.nvidia.com)\n` +
      `3. Optionally add OpenRouter, OpenAI, Claude, Gemini, or xAI\n` +
      `4. Save → chat streams live\n\n` +
      `Vault, canvas, mind map, and notepad work offline either way.`,
    model: 'demo-mode',
    provider: 'none',
    role,
    boardMember: 'Jarvis — Demo Mode',
    usage: {},
    timestamp: new Date().toISOString(),
  };
}

function isMissingKeyError(message = '') {
  return /Neither NVIDIA_API_KEY|no LLM provider|not configured|No API key for provider|No LLM provider/i.test(
    message
  );
}

function getHistory(sessionId) {
  if (!conversations.has(sessionId)) conversations.set(sessionId, []);
  return conversations.get(sessionId);
}

function trimHistory(sessionId, history) {
  if (history.length > 50) conversations.set(sessionId, history.slice(-50));
  // Cap total sessions
  if (conversations.size > 100) {
    const first = conversations.keys().next().value;
    conversations.delete(first);
  }
}

// POST /api/chat — non-streaming (compat)
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
    const history = getHistory(sessionId);

    let taskId = null;
    try {
      const orch = await orchestrateMessage({ message, sessionId, role });
      taskId = orch?.task?.id || null;
    } catch (e) {
      console.warn('[AgentActivity]', e.message);
    }

    history.push({ role: 'user', content: message });

    if (!anyProviderConfigured(clientKeys)) {
      const demo = demoResponse(role);
      history.push({ role: 'assistant', content: demo.response });
      if (taskId) await completeTask(taskId, 'Demo response');
      return res.json({ ...demo, taskId });
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
    trimHistory(sessionId, history);
    if (taskId) await completeTask(taskId, `Done via ${result.provider}/${result.model}`);

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
      taskId,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[CHAT ERROR]', err.message);
    if (isMissingKeyError(err.message)) return res.json(demoResponse(req.body?.role || 'jarvis'));
    res.status(200).json({
      response: `I hit an error talking to the model providers:\n\n\`\`\`\n${err.message.slice(0, 1200)}\n\`\`\`\n\nOpen **Settings** to verify your API keys.`,
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

// POST /api/chat/stream — Server-Sent Events streaming
router.post('/chat/stream', async (req, res) => {
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

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  const clientKeys = extractClientKeys(req);
  const mergedRoleModels = { ...DEFAULT_ROLE_MODELS, ...roleModels };
  const history = getHistory(sessionId);

  let taskId = null;
  try {
    const orch = await orchestrateMessage({ message, sessionId, role });
    taskId = orch?.task?.id || null;
  } catch {
    /* ignore */
  }

  history.push({ role: 'user', content: message });

  if (!anyProviderConfigured(clientKeys)) {
    const demo = demoResponse(role);
    history.push({ role: 'assistant', content: demo.response });
    send({ type: 'meta', ...demo, taskId });
    send({ type: 'delta', delta: demo.response });
    send({ type: 'done', content: demo.response, taskId });
    if (taskId) await completeTask(taskId, 'Demo');
    return res.end();
  }

  try {
    let full = '';
    let meta = { role, taskId };
    for await (const ev of streamRouteToLLM({
      messages: history,
      role,
      model,
      provider,
      clientKeys,
      roleModels: mergedRoleModels,
    })) {
      if (req.aborted) break;
      if (ev.type === 'meta') {
        meta = { ...meta, ...ev, taskId };
        send({ type: 'meta', ...meta });
      } else if (ev.type === 'delta') {
        full += ev.delta;
        send({ type: 'delta', delta: ev.delta });
      } else if (ev.type === 'done') {
        full = ev.content || full;
        send({
          type: 'done',
          content: full,
          model: ev.model || meta.model,
          provider: meta.provider,
          role: meta.role,
          boardMember: meta.boardMember,
          usage: ev.usage || {},
          taskId,
        });
      }
    }

    if (full) {
      history.push({ role: 'assistant', content: full });
      trimHistory(sessionId, history);
      if (taskId) await completeTask(taskId, `Streamed via ${meta.provider || 'llm'}`);
      try {
        await logSystemEvent(role, 'CHAT', `Streamed via ${meta.provider}/${meta.model}`);
      } catch {
        /* ignore */
      }
    } else if (taskId) {
      await failTask(taskId, 'Empty stream');
    }
  } catch (err) {
    console.error('[CHAT STREAM]', err.message);
    if (taskId) await failTask(taskId, err.message);
    if (isMissingKeyError(err.message)) {
      const demo = demoResponse(role);
      send({ type: 'meta', ...demo, taskId });
      send({ type: 'delta', delta: demo.response });
      send({ type: 'done', content: demo.response, taskId });
    } else {
      const msg = `Provider error:\n\n\`\`\`\n${err.message.slice(0, 800)}\n\`\`\``;
      send({ type: 'error', error: err.message });
      send({ type: 'delta', delta: msg });
      send({ type: 'done', content: msg, error: true, taskId });
    }
  }

  res.end();
});

router.post('/delegate', async (req, res) => {
  try {
    const { task, targetRole, roleModels = {} } = req.body || {};
    if (!task) return res.status(400).json({ error: 'Task description is required' });
    const clientKeys = extractClientKeys(req);
    const mergedRoleModels = { ...DEFAULT_ROLE_MODELS, ...roleModels };

    let role = targetRole;
    if (!role) {
      const id = await identifyBoardMember(task, { clientKeys, roleModels: mergedRoleModels });
      role = id.role;
    }

    const result = await routeToLLM({
      prompt: task,
      role,
      clientKeys,
      roleModels: mergedRoleModels,
    });

    res.json({
      response: result.content,
      role: result.role,
      boardMember: result.boardMember,
      model: result.model,
      provider: result.provider,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/board', (req, res) => {
  let roleModels = {};
  try {
    if (req.query.roleModels) roleModels = JSON.parse(String(req.query.roleModels));
  } catch {
    /* ignore */
  }
  res.json({ members: getBoardMembers(roleModels) });
});

router.get('/status', (req, res) => {
  const clientKeys = extractClientKeys(req);
  const providerStatus = {};
  for (const id of Object.keys(PROVIDERS)) {
    providerStatus[id] = !!resolveKey(id, clientKeys);
  }
  res.json({
    status: 'operational',
    platform: 'AI Boardroom',
    version: '2.1.0',
    primaryProvider: 'nvidia',
    providers: providerStatus,
    nvidiaConfigured: providerStatus.nvidia,
    apiKeyConfigured: Object.values(providerStatus).some(Boolean),
    demoMode: !Object.values(providerStatus).some(Boolean),
    authRequired: authEnabled(),
    features: {
      streaming: true,
      voice: true,
      vault: true,
      canvas: true,
      mindmap: true,
      agentMonitor: true,
    },
  });
});

router.get('/paperclip/agents', (_req, res) => {
  res.json({ agents: getAllAgents() });
});

router.get('/paperclip/tasks', (_req, res) => {
  res.json({ tasks: listTasks(40) });
});

router.get('/paperclip/tasks/:id', async (req, res) => {
  res.json(await getTaskStatus(req.params.id));
});

export default router;
