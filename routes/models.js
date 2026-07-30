/**
 * models.js — Live model catalog (NVIDIA NIM + static fallbacks)
 */

import { Router } from 'express';
import fetch from 'node-fetch';
import {
  PROVIDERS,
  staticModelCatalog,
  NVIDIA_CURATED_MODELS,
  resolveKey,
  catalogForProvider,
} from '../utils/providers.js';
import { env } from '../utils/env.js';

const router = Router();

function extractClientKeys(req) {
  // Prefer header X-Provider-Keys: base64(json)
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

async function fetchNvidiaModels(apiKey) {
  const base = env('NVIDIA_BASE_URL', 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');
  const res = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`NVIDIA models ${res.status}`);
  }
  const data = await res.json();
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return list
    .map((m) => {
      const id = m.id || m.name;
      if (!id) return null;
      // Filter out pure embedding / non-chat when possible
      const lower = String(id).toLowerCase();
      if (lower.includes('embed') || lower.includes('rerank') || lower.includes('retrieval')) {
        return { id, name: id.split('/').pop(), tier: 'embed', chat: false };
      }
      return { id, name: id.split('/').pop(), tier: 'catalog', chat: true };
    })
    .filter(Boolean);
}

// GET /api/models — full catalog
router.get('/', async (req, res) => {
  const clientKeys = extractClientKeys(req);
  const catalog = staticModelCatalog().map((p) => ({
    ...p,
    configured: !!resolveKey(p.id, clientKeys),
  }));

  // Live NVIDIA catalog when key available
  const nvidiaKey = resolveKey('nvidia', clientKeys);
  if (nvidiaKey) {
    try {
      const live = await fetchNvidiaModels(nvidiaKey);
      const chatModels = live.filter((m) => m.chat !== false);
      const nvidiaEntry = catalog.find((c) => c.id === 'nvidia');
      if (nvidiaEntry && chatModels.length) {
        // Merge live + curated (live first)
        const ids = new Set(chatModels.map((m) => m.id));
        const extras = NVIDIA_CURATED_MODELS.filter((m) => m.chat !== false && !ids.has(m.id));
        nvidiaEntry.models = [...chatModels, ...extras];
        nvidiaEntry.live = true;
        nvidiaEntry.liveCount = chatModels.length;
      }
    } catch (err) {
      console.warn('[models] NVIDIA live catalog failed:', err.message);
      const nvidiaEntry = catalog.find((c) => c.id === 'nvidia');
      if (nvidiaEntry) {
        nvidiaEntry.live = false;
        nvidiaEntry.liveError = err.message;
      }
    }
  }

  res.json({
    providers: catalog,
    primary: 'nvidia',
    timestamp: new Date().toISOString(),
  });
});

// GET /api/models/providers — lightweight list
router.get('/providers', (req, res) => {
  const clientKeys = extractClientKeys(req);
  res.json({
    providers: Object.values(PROVIDERS).map((p) => ({
      id: p.id,
      name: p.name,
      primary: !!p.primary,
      configured: !!resolveKey(p.id, clientKeys),
      color: p.color,
      description: p.description,
    })),
  });
});

// GET /api/models/:provider
router.get('/:provider', async (req, res) => {
  const { provider } = req.params;
  if (!PROVIDERS[provider]) {
    return res.status(404).json({ error: 'Unknown provider' });
  }
  const clientKeys = extractClientKeys(req);
  let models = catalogForProvider(provider);
  let live = false;
  if (provider === 'nvidia' && resolveKey('nvidia', clientKeys)) {
    try {
      const liveModels = await fetchNvidiaModels(resolveKey('nvidia', clientKeys));
      models = liveModels.filter((m) => m.chat !== false);
      live = true;
    } catch {
      /* curated fallback */
    }
  }
  res.json({ provider, models, live, configured: !!resolveKey(provider, clientKeys) });
});

export default router;
