/**
 * settings.js — Public settings schema + server capability probe
 * User keys live in browser localStorage; server only reports env-backed capabilities.
 */

import { Router } from 'express';
import {
  PROVIDERS,
  DEFAULT_ROLE_MODELS,
  VOICE_PROVIDERS,
  resolveKey,
  getServerKey,
} from '../utils/providers.js';
import { env } from '../utils/env.js';

const router = Router();

function extractClientKeys(req) {
  const hdr = req.headers['x-provider-keys'];
  if (hdr) {
    try {
      return JSON.parse(Buffer.from(String(hdr), 'base64').toString('utf8'));
    } catch {
      /* ignore */
    }
  }
  return {};
}

router.get('/', (req, res) => {
  const clientKeys = extractClientKeys(req);

  const providers = Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    name: p.name,
    primary: !!p.primary,
    description: p.description,
    color: p.color,
    envKey: p.envKey,
    serverConfigured: !!getServerKey(p.id),
    clientConfigured: !!clientKeys[p.id],
    configured: !!resolveKey(p.id, clientKeys),
  }));

  const voice = Object.values(VOICE_PROVIDERS).map((v) => ({
    id: v.id,
    name: v.name,
    description: v.description,
    envKey: v.envKey,
    serverConfigured: !!env(v.envKey),
    clientConfigured: !!(clientKeys[v.id] || clientKeys[v.envKey === 'GEMINI_API_KEY' ? 'google' : v.id]),
    configured:
      !!env(v.envKey) ||
      !!clientKeys[v.id] ||
      (v.id === 'gemini' && !!clientKeys.google) ||
      (v.id === 'openai' && !!clientKeys.openai) ||
      (v.id === 'xai' && !!clientKeys.xai),
  }));

  res.json({
    version: '2.0.0',
    primaryProvider: 'nvidia',
    providers,
    voice,
    defaultRoleModels: DEFAULT_ROLE_MODELS,
    roles: Object.keys(DEFAULT_ROLE_MODELS),
    notes: [
      'API keys entered in the UI stay in your browser (localStorage) and are sent only to this app’s API.',
      'Server environment keys (Vercel / .env) act as defaults when client keys are empty.',
      'NVIDIA NIM is the primary model stack; OpenRouter free models are automatic fallbacks.',
    ],
    timestamp: new Date().toISOString(),
  });
});

// POST /api/settings/test-key — validate a provider key with a tiny request
router.post('/test-key', async (req, res) => {
  try {
    const { provider, apiKey, model } = req.body || {};
    if (!provider || !apiKey) {
      return res.status(400).json({ error: 'provider and apiKey required' });
    }
    const p = PROVIDERS[provider];
    if (!p) return res.status(400).json({ error: 'Unknown provider' });

    const keys = { [provider]: apiKey };
    const { routeToLLM } = await import('../utils/llm_router.js');
    const testModel = model || (provider === 'nvidia'
      ? 'nvidia/nemotron-mini-4b-instruct'
      : provider === 'openrouter'
        ? 'meta-llama/llama-3.1-8b-instruct:free'
        : undefined);

    const result = await routeToLLM({
      prompt: 'Reply with exactly: OK',
      role: 'jarvis',
      provider,
      model: testModel,
      clientKeys: keys,
      temperature: 0,
    });

    res.json({
      ok: true,
      provider,
      model: result.model,
      sample: String(result.content).slice(0, 120),
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
