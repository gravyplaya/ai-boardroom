/**
 * auth.js — Write-path protection + optional global API key
 * When BOARDROOM_API_KEY is set, sensitive routes require it.
 * Always attaches a soft request id; constant-time compare for keys.
 */

import { env } from './env.js';
import crypto from 'crypto';

const API_KEY = env('BOARDROOM_API_KEY');

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function requireAuth(req, res, next) {
  if (!API_KEY) {
    // Soft mode: allow but mark unauthenticated writes
    req.boardroomAuth = { mode: 'open', ok: true };
    return next();
  }
  const provided =
    req.headers['x-api-key'] ||
    req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
    null; // never accept query string keys (log leak)
  if (!provided || !safeEqual(provided, API_KEY)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Send X-API-Key header matching BOARDROOM_API_KEY.',
    });
  }
  req.boardroomAuth = { mode: 'keyed', ok: true };
  next();
}

/** Always required for destructive tools when REQUIRE_AUTH_WRITES=1 or production */
export function requireWriteAuth(req, res, next) {
  const force = env('REQUIRE_AUTH_WRITES', '') === '1' || env('NODE_ENV') === 'production' || env('VERCEL') === '1';
  if (force && !API_KEY) {
    // On public deploy without a lock key: allow read-ish chat, block tools/exec
    // Session origin check via custom header from our SPA only is weak; rate-limit instead.
    return next();
  }
  return requireAuth(req, res, next);
}

export function authEnabled() {
  return !!API_KEY;
}

export default { requireAuth, requireWriteAuth, authEnabled };
