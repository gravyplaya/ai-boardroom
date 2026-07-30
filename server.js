/**
 * server.js — AI Boardroom Express Server (multi-provider)
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdir } from 'fs/promises';
import chatRoutes from './routes/chat.js';
import voiceRoutes from './routes/voice.js';
import toolsRoutes from './routes/tools.js';
import vaultRoutes from './routes/vault.js';
import canvasRoutes from './routes/canvas.js';
import uploadRoutes from './routes/upload.js';
import executionRoutes from './routes/execution.js';
import modelsRoutes from './routes/models.js';
import settingsRoutes from './routes/settings.js';
import { requireAuth } from './utils/auth.js';
import { rateLimiter } from './utils/rate_limiter.js';
import { logSystemEvent } from './utils/vault.js';
import { env } from './utils/env.js';

dotenv.config({ quiet: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 8080;
const IS_VERCEL = process.env.VERCEL === '1' || !!process.env.VERCEL_ENV;

function buildCorsOrigin() {
  const raw = (env('ALLOWED_ORIGINS', '') || '').trim();
  if (!raw || raw === '*') return true;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return (origin, callback) => {
    if (!origin || list.includes(origin)) return callback(null, true);
    return callback(null, false);
  };
}

app.use(cors({ origin: buildCorsOrigin(), credentials: true }));
app.use(rateLimiter);
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(join(__dirname, 'public'), {
  index: 'index.html',
  maxAge: IS_VERCEL ? '1h' : 0,
}));

app.use('/api', chatRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/vault', vaultRoutes);
app.use('/api/canvas', canvasRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/models', modelsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/tools', toolsRoutes);
app.use('/api/execution', requireAuth, executionRoutes);

app.use('/uploads', express.static(join(__dirname, 'uploads')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'ai-boardroom', version: '2.0.0' });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err?.message || err);
  const status = err?.message === 'Not allowed by CORS' ? 403 : 500;
  res.status(status).json({ error: err?.message || 'Internal server error' });
});

async function start() {
  try {
    await mkdir(join(__dirname, 'uploads'), { recursive: true });
    await mkdir(join(__dirname, 'obsidian_vault'), { recursive: true });
  } catch {
    /* ignore */
  }

  if (IS_VERCEL) return;

  app.listen(PORT, '0.0.0.0', async () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════╗');
    console.log('  ║         AI BOARDROOM v2 — Multi-Provider         ║');
    console.log(`  ║  Server:  http://0.0.0.0:${PORT}                     ║`);
    console.log(`  ║  NVIDIA:  ${env('NVIDIA_API_KEY') ? 'configured' : 'add in Settings'}                   ║`);
    console.log(`  ║  OpenRouter free fallback ready when keyed        ║`);
    console.log('  ╚══════════════════════════════════════════════════╝');
    console.log('');
    try {
      await logSystemEvent('system', 'SERVER_START', `AI Boardroom v2 on port ${PORT}`);
    } catch {
      /* ignore */
    }
  });
}

start();
export default app;
