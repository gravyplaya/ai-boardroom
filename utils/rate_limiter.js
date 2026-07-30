/**
 * rate_limiter.js — Lightweight in-memory rate limiting.
 * Serverless-safe: no setInterval (cleanup is opportunistic).
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX) || 500;

const clients = new Map();

function prune(now) {
  if (clients.size < 500) return;
  for (const [ip, data] of clients.entries()) {
    if (now > data.resetAt) clients.delete(ip);
  }
}

export function rateLimiter(req, res, next) {
  const ip =
    req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
    req.ip ||
    'unknown';
  const now = Date.now();
  prune(now);

  let data = clients.get(ip);
  if (!data || now > data.resetAt) {
    data = { count: 1, resetAt: now + WINDOW_MS };
    clients.set(ip, data);
    return next();
  }

  data.count += 1;
  if (data.count > MAX_REQUESTS) {
    res.setHeader('Retry-After', String(Math.ceil((data.resetAt - now) / 1000)));
    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'Request limit exceeded. Please try again later.',
    });
  }

  return next();
}

export default { rateLimiter };
