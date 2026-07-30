/**
 * voice.js — Multi-provider voice session config
 * Providers: Gemini Live, OpenAI Realtime, xAI Grok Voice
 */

import { Router } from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { env } from '../utils/env.js';
import { VOICE_PROVIDERS } from '../utils/providers.js';

dotenv.config({ quiet: true });
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
  if (req.body?.providerKeys) return req.body.providerKeys;
  return {};
}

function keyFor(provider, clientKeys) {
  if (provider === 'gemini') {
    return clientKeys.google || clientKeys.gemini || env('GEMINI_API_KEY');
  }
  if (provider === 'openai') return clientKeys.openai || env('OPENAI_API_KEY');
  if (provider === 'xai') return clientKeys.xai || env('XAI_API_KEY');
  return null;
}

async function loadVaultContext() {
  let systemLogs = '';
  let activeProjects = '';
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
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
  return `You are JARVIS, Chief of Staff of AI Boardroom. British, concise, proactive. Address the user as Sir occasionally.
Active projects:\n${(activeProjects || '').slice(0, 500) || 'None'}\nRecent logs:\n${recentLogs}`;
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
    defaultProvider: providers.find((p) => p.enabled)?.id || 'gemini',
  });
});

// POST /api/voice/token — session config for selected provider
router.post('/token', async (req, res) => {
  try {
    const clientKeys = extractClientKeys(req);
    const provider = (req.body?.provider || 'gemini').toLowerCase();
    const apiKey = keyFor(provider, clientKeys);
    if (!apiKey) {
      return res.status(400).json({
        error: `${provider} voice key not configured`,
        message: `Add the API key for ${provider} in Settings to enable voice.`,
      });
    }

    const systemText = await loadVaultContext();

    if (provider === 'gemini') {
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
      return res.json({ provider: 'gemini', wsUrl, setupMessage, protocol: 'gemini-bidi' });
    }

    if (provider === 'openai') {
      // Create ephemeral realtime session when possible; else return direct key session config
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
        // Prefer ephemeral secret; fall back to user key (browser will use it only for WS)
        auth: clientSecret || apiKey,
        instructions: systemText,
        voice: env('OPENAI_VOICE_NAME', 'alloy'),
      });
    }

    if (provider === 'xai') {
      const model = env('XAI_VOICE_MODEL', 'grok-2-public');
      // xAI realtime-compatible endpoint (OpenAI-style realtime path when available)
      const base = env('XAI_BASE_URL', 'https://api.x.ai/v1').replace(/\/$/, '');
      const wsBase = base.replace(/^https:/, 'wss:');
      return res.json({
        provider: 'xai',
        protocol: 'openai-realtime',
        model,
        wsUrl: `${wsBase}/realtime?model=${encodeURIComponent(model)}`,
        auth: apiKey,
        instructions: systemText,
        voice: env('XAI_VOICE_NAME', 'Ara'),
        note: 'Uses xAI realtime-compatible socket when enabled on your account.',
      });
    }

    return res.status(400).json({ error: `Unknown voice provider: ${provider}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
