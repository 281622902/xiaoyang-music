const crypto = require('node:crypto');
const token = crypto.randomBytes(32).toString('hex');
const publicMedia = new Set(['/api/local/stream', '/api/local/cover']);
function authorize(req, pathname) {
  const allowed = (process.env.UZZ_LOCAL_API_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  const origin = req.headers.origin;
  const peer = req.socket.remoteAddress || '';
  const loopback = peer === '::1' || peer === '127.0.0.1' || peer === '::ffff:127.0.0.1';
  const expected = 'http://' + req.headers.host;
  let host;
  try { host = new URL(expected).hostname; } catch { return false; }
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(host);
  const remoteAllowed = !!(origin && allowed.includes(origin));
  if ((!loopback || !localHost) && !remoteAllowed) return false;
  const rendererAllowed = loopback && localHost && origin === process.env.UZZ_RENDERER_ORIGIN;
  if (origin && origin !== expected && !remoteAllowed && !rendererAllowed) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site' && !remoteAllowed) return false;
  if (pathname === '/api/local/session' || publicMedia.has(pathname)) return true;
  const provided = req.headers['x-uzz-local-token'];
  return typeof provided === 'string' && /^[a-f0-9]{64}$/.test(provided)
    && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(token));
}
module.exports = { authorize, token };
