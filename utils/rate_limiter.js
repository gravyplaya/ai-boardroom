/**
 * rate_limiter.js — In-memory sliding window (best-effort; not multi-instance)
 */

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const MAX = Number(process.env.RATE_LIMIT_MAX || 300); // tighter default
const buckets = new Map();

function clientIp(req) {
  // Prefer right-most X-Forwarded-For when behind a single trusted proxy
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    return parts[parts.length - 1] || req.socket?.remoteAddress || 'unknown';
  }
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

export function rateLimiter(req, res, next) {
  const path = req.path || '';
  if (path === '/health' || path === '/api/status' || path.endsWith('/status')) {
    return next();
  }

  const key = clientIp(req);
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start > WINDOW_MS) {
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count += 1;

  // Prevent unbounded growth
  if (buckets.size > 5000) {
    const first = buckets.keys().next().value;
    buckets.delete(first);
  }

  res.setHeader('X-RateLimit-Limit', String(MAX));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, MAX - bucket.count)));

  if (bucket.count > MAX) {
    return res.status(429).json({ error: 'Too many requests', retryAfterMs: WINDOW_MS });
  }
  next();
}

export default rateLimiter;
