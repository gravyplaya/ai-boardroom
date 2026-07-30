/**
 * env.js — Safe environment helpers (trim Vercel paste newlines, quotes)
 */

export function env(name, fallback = undefined) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  let v = String(raw).trim();
  // Strip wrapping quotes often introduced by dashboards
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  // Remove any remaining CR/LF that break HTTP headers
  v = v.replace(/[\r\n\t]/g, '');
  return v || fallback;
}

export function envBool(name, fallback = false) {
  const v = env(name);
  if (v == null) return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

export default { env, envBool };
