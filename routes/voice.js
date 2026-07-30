/**
 * voice.js — Voice session tokens + tool bridge
 * Primary: xAI Grok Voice Agent (ephemeral client secrets)
 * Also: Gemini Live, OpenAI Realtime
 */

import { Router } from 'express';
import fetch from 'node-fetch';
import path from 'path';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';
import { env } from '../utils/env.js';
import { VOICE_PROVIDERS } from '../utils/providers.js';
import {
  XAI_VOICE_MODELS,
  XAI_BUILTIN_VOICES,
  DEFAULT_VOICE_AGENT,
  buildXaiSessionConfig,
  boardroomFunctionTools,
} from '../utils/voice_agent.js';

dotenv.config({ quiet: true });
const router = Router();
const execFileAsync = promisify(execFile);
const BASE_WORKSPACE = path.resolve(process.cwd());

function extractClientKeys(req) {
  const hdr = req.headers['x-provider-keys'];
  if (hdr) {
    try {
      return JSON.parse(Buffer.from(String(hdr), 'base64').toString('utf8'));
    } catch {
      /* ignore */
    }
  }
  if (req.body?.providerKeys) return req.body.providerKeys;
  return {};
}

function keyFor(provider, clientKeys) {
  if (provider === 'gemini' || provider === 'google') {
    return clientKeys.google || clientKeys.gemini || env('GEMINI_API_KEY');
  }
  if (provider === 'openai') return clientKeys.openai || env('OPENAI_API_KEY');
  if (provider === 'xai') return clientKeys.xai || env('XAI_API_KEY');
  return null;
}

async function loadVaultContext(customInstructions) {
  let systemLogs = '';
  let activeProjects = '';
  try {
    const vaultPath = env('OBSIDIAN_VAULT_PATH', './obsidian_vault');
    try {
      systemLogs = await fs.readFile(path.join(vaultPath, '00_system_logs.md'), 'utf-8');
    } catch {
      /* ignore */
    }
    try {
      activeProjects = await fs.readFile(path.join(vaultPath, '01_active_projects.md'), 'utf-8');
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
  const recentLogs = systemLogs
    ? systemLogs.split('\n').filter((l) => l.trim()).slice(-12).join('\n')
    : 'None yet.';
  const base = `You are JARVIS, Chief of Staff of AI Boardroom — a production multi-agent software platform.
Speak in a clear British tone. Be concise and proactive. Address the user as Sir occasionally.
You can use tools: web search, X search, vault notes, board consultation, and workspace tools.
Active projects:\n${(activeProjects || '').slice(0, 800) || 'None'}
Recent logs:\n${recentLogs}`;
  if (customInstructions && String(customInstructions).trim()) {
    return `${String(customInstructions).trim()}\n\n---\n${base}`;
  }
  return base;
}

// GET /api/voice/status
router.get('/status', (req, res) => {
  const clientKeys = extractClientKeys(req);
  const providers = Object.values(VOICE_PROVIDERS).map((v) => ({
    id: v.id,
    name: v.name,
    description: v.description,
    enabled: !!keyFor(v.id, clientKeys),
  }));
  res.json({
    voiceEnabled: providers.some((p) => p.enabled),
    providers,
    defaultProvider: providers.find((p) => p.id === 'xai' && p.enabled)?.id
      || providers.find((p) => p.enabled)?.id
      || 'xai',
    xai: {
      models: XAI_VOICE_MODELS,
      voices: XAI_BUILTIN_VOICES,
      defaults: DEFAULT_VOICE_AGENT,
      tools: boardroomFunctionTools().map((t) => ({ name: t.name, description: t.description })),
      builtInTools: ['web_search', 'x_search', 'file_search', 'mcp', 'function'],
    },
  });
});

// GET /api/voice/options — catalog for settings UI
router.get('/options', (_req, res) => {
  res.json({
    models: XAI_VOICE_MODELS,
    voices: XAI_BUILTIN_VOICES,
    defaults: DEFAULT_VOICE_AGENT,
    boardroomTools: boardroomFunctionTools().map((t) => ({
      name: t.name,
      description: t.description,
    })),
    connectors: [
      { type: 'web_search', name: 'Web Search', description: 'Live web search with optional domain filters' },
      { type: 'x_search', name: 'X Search', description: 'Search posts on X with handle/date filters' },
      { type: 'file_search', name: 'Collections / File Search', description: 'Search xAI document collections (vector_store_ids)' },
      { type: 'mcp', name: 'Remote MCP', description: 'Connect MCP servers as tool providers' },
      { type: 'function', name: 'Boardroom Functions', description: 'Local workspace + vault + board tools' },
    ],
  });
});

// POST /api/voice/token — session bootstrap for browser
router.post('/token', async (req, res) => {
  try {
    const clientKeys = extractClientKeys(req);
    const provider = String(req.body?.provider || 'xai').toLowerCase();
    const apiKey = keyFor(provider, clientKeys);
    if (!apiKey) {
      return res.status(400).json({
        error: `${provider} voice key not configured`,
        message: `Add the ${provider === 'xai' ? 'xAI' : provider} API key in Settings → Provider API Keys, then enable voice.`,
      });
    }

    const agent = { ...DEFAULT_VOICE_AGENT, ...(req.body?.voiceAgent || {}) };
    const systemText = await loadVaultContext(agent.instructions);

    // ── xAI Grok Voice Agent ─────────────────────────────────────────────
    if (provider === 'xai') {
      const model = agent.model || env('XAI_VOICE_MODEL', 'grok-voice-latest');
      let clientSecret = null;
      let expiresAt = null;
      let secretError = null;

      try {
        const r = await fetch('https://api.x.ai/v1/realtime/client_secrets', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ expires_after: { seconds: 300 } }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok) {
          clientSecret = data.value || data.client_secret || data.secret || null;
          expiresAt = data.expires_at || null;
        } else {
          secretError = data.error?.message || data.message || `HTTP ${r.status}`;
          console.warn('[voice] xAI client_secrets failed:', secretError);
        }
      } catch (e) {
        secretError = e.message;
        console.warn('[voice] xAI client_secrets error:', e.message);
      }

      if (!clientSecret) {
        return res.status(502).json({
          error: 'Failed to create xAI ephemeral voice token',
          message: secretError || 'Check your xAI API key has Voice / Realtime access at console.x.ai',
        });
      }

      const session = buildXaiSessionConfig(
        { ...agent, instructions: agent.instructions || '' },
        systemText
      );
      // Prefer custom instructions only if set; else systemText already in builder
      if (!agent.instructions) session.instructions = systemText;

      const effort = agent.reasoningEffort === 'none' ? 'none' : 'high';
      const qs = new URLSearchParams({ model, 'reasoning.effort': effort });

      return res.json({
        provider: 'xai',
        protocol: 'xai-realtime',
        model,
        wsUrl: `wss://api.x.ai/v1/realtime?${qs.toString()}`,
        clientSecret,
        expiresAt,
        session,
        greetOnConnect: agent.greetOnConnect !== false,
        greetText: agent.greetText || DEFAULT_VOICE_AGENT.greetText,
        sampleRate: Number(agent.sampleRate) || 24000,
      });
    }

    // ── Gemini Live ──────────────────────────────────────────────────────
    if (provider === 'gemini' || provider === 'google') {
      const model = env('GEMINI_LIVE_MODEL', 'models/gemini-2.5-flash-native-audio-preview-12-2025');
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
      const setupMessage = {
        setup: {
          model,
          generation_config: {
            response_modalities: ['AUDIO'],
            speech_config: {
              voice_config: { prebuilt_voice_config: { voice_name: env('GEMINI_VOICE_NAME', 'Kore') } },
            },
          },
          system_instruction: { parts: [{ text: systemText }] },
          input_audio_transcription: {},
          output_audio_transcription: {},
        },
      };
      return res.json({ provider: 'gemini', wsUrl, setupMessage, protocol: 'gemini-bidi', sampleRate: 24000 });
    }

    // ── OpenAI Realtime ──────────────────────────────────────────────────
    if (provider === 'openai') {
      const model = env('OPENAI_REALTIME_MODEL', 'gpt-4o-realtime-preview');
      let clientSecret = null;
      try {
        const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            voice: env('OPENAI_VOICE_NAME', 'alloy'),
            instructions: systemText,
          }),
        });
        if (r.ok) {
          const data = await r.json();
          clientSecret = data?.client_secret?.value || data?.client_secret || null;
        }
      } catch (e) {
        console.warn('[voice] OpenAI session create failed:', e.message);
      }

      return res.json({
        provider: 'openai',
        protocol: 'openai-realtime',
        model,
        wsUrl: `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
        auth: clientSecret || apiKey,
        instructions: systemText,
        voice: env('OPENAI_VOICE_NAME', 'alloy'),
        sampleRate: 24000,
      });
    }

    return res.status(400).json({ error: `Unknown voice provider: ${provider}` });
  } catch (err) {
    console.error('[voice/token]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Tool execution for voice function calls ──────────────────────────────
const ALLOWED_BINARIES = new Set([
  'ls', 'pwd', 'echo', 'cat', 'head', 'tail', 'wc', 'date',
  'node', 'npm', 'python3', 'python', 'git',
]);

function ensureInsideWorkspace(targetPath) {
  const resolvedBase = path.resolve(BASE_WORKSPACE);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error('Security Exception: Path escapes workspace');
  }
  return resolvedTarget;
}

async function executeVoiceTool(name, args = {}, clientKeys = {}) {
  if (name === 'read_file') {
    const targetPath = ensureInsideWorkspace(path.resolve(BASE_WORKSPACE, args.filePath || args.path));
    const content = await fs.readFile(targetPath, 'utf-8');
    return { content: content.slice(0, 12000) };
  }
  if (name === 'write_file') {
    const targetPath = ensureInsideWorkspace(path.resolve(BASE_WORKSPACE, args.filePath));
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, String(args.content ?? ''), 'utf-8');
    return { success: true, path: args.filePath };
  }
  if (name === 'execute_cli_command') {
    const command = String(args.command || '');
    if (/[;&|`$<>\\\n\r]/.test(command)) throw new Error('Shell metacharacters not allowed');
    const parts = command.trim().split(/\s+/);
    const bin = parts[0];
    if (!ALLOWED_BINARIES.has(bin)) throw new Error(`Binary not allowlisted: ${bin}`);
    const { stdout, stderr } = await execFileAsync(bin, parts.slice(1), {
      cwd: BASE_WORKSPACE,
      timeout: 10000,
      maxBuffer: 2 * 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG },
    });
    return { stdout: String(stdout).slice(0, 8000), stderr: String(stderr).slice(0, 2000) };
  }
  if (name === 'get_system_status') {
    return {
      platform: 'AI Boardroom',
      version: '2.0.0',
      primaryProvider: 'nvidia',
      nvidiaConfigured: !!(clientKeys.nvidia || env('NVIDIA_API_KEY')),
      xaiConfigured: !!(clientKeys.xai || env('XAI_API_KEY')),
    };
  }
  if (name === 'list_board_members') {
    // Lazy import chat board roles if available
    try {
      const { DEFAULT_ROLE_MODELS } = await import('../utils/providers.js');
      return {
        members: Object.entries(DEFAULT_ROLE_MODELS || {}).map(([role, m]) => ({
          role,
          provider: m.provider,
          model: m.model,
        })),
      };
    } catch {
      return {
        members: ['jarvis', 'architect', 'coder', 'creative', 'analyst', 'product', 'devops', 'security', 'qa'],
      };
    }
  }
  if (name === 'consult_board') {
    const base = `http://127.0.0.1:${env('PORT', '8080')}`;
    const body = {
      message: args.message,
      role: args.role || 'jarvis',
      sessionId: 'voice-agent',
    };
    const headers = { 'Content-Type': 'application/json' };
    if (Object.keys(clientKeys).length) {
      headers['X-Provider-Keys'] = Buffer.from(JSON.stringify(clientKeys)).toString('base64');
    }
    const r = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || data.message || `chat ${r.status}`);
    return {
      reply: data.response || data.reply || data.message || data.content || JSON.stringify(data).slice(0, 4000),
      role: data.role || args.role || 'jarvis',
      model: data.model,
      provider: data.provider,
    };
  }
  if (name === 'vault_read') {
    const vaultPath = env('OBSIDIAN_VAULT_PATH', './obsidian_vault');
    const target = ensureInsideWorkspace(path.resolve(vaultPath, args.path || ''));
    const content = await fs.readFile(target, 'utf-8');
    return { content: content.slice(0, 12000) };
  }
  if (name === 'vault_append') {
    const vaultPath = env('OBSIDIAN_VAULT_PATH', './obsidian_vault');
    const target = ensureInsideWorkspace(path.resolve(vaultPath, args.path || ''));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.appendFile(target, `\n${args.content || ''}\n`, 'utf-8');
    return { success: true };
  }
  throw new Error(`Unknown tool: ${name}`);
}

// POST /api/voice/tool — execute a boardroom function tool for the voice agent
router.post('/tool', async (req, res) => {
  try {
    const { name, arguments: args, args: args2, call_id: callId } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Missing tool name' });
    const clientKeys = extractClientKeys(req);
    const result = await executeVoiceTool(name, args || args2 || {}, clientKeys);
    res.json({ ok: true, name, call_id: callId, result });
  } catch (err) {
    console.error('[voice/tool]', err.message);
    res.status(500).json({ ok: false, error: err.message, name: req.body?.name });
  }
});

export default router;
