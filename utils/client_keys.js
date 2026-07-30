/** Extract browser-supplied provider keys from X-Provider-Keys header or body. */
export function extractClientKeys(req) {
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
