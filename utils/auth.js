/**
 * auth.js — Optional API key middleware for sensitive routes.
 *
 * If BOARDROOM_API_KEY is unset, routes stay open (local/demo).
 * When set, requires matching X-API-Key header or ?apiKey= query.
 */

import dotenv from 'dotenv';
import { env } from './env.js';
dotenv.config({ quiet: true });

const API_KEY = env('BOARDROOM_API_KEY');

export function requireAuth(req, res, next) {
  if (!API_KEY) {
    return next();
  }

  const provided =
    req.headers['x-api-key'] ||
    req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
    req.query.apiKey;

  if (provided !== API_KEY) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'A valid X-API-Key header is required for this endpoint.',
    });
  }

  next();
}

export default { requireAuth };
