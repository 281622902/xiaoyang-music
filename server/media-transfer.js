const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { upstreamFetch } = require('./request-context');

// Bound waits for headers and for the next chunk, without timing out a long song
// or a client that has intentionally stopped reading because its buffer is full.
async function transferAudio(req, res, url, { headers = {}, headerTimeoutMs = 12000, idleTimeoutMs = 15000, fetchImpl = upstreamFetch } = {}) {
  const controller = new AbortController();
  let headerExpired = false, timer;
  const abort = () => controller.abort();
  res.once('close', abort);
  try {
    timer = setTimeout(() => { headerExpired = true; abort(); }, headerTimeoutMs);
    const upstream = await fetchImpl(url, { headers, redirect: 'follow', signal: controller.signal });
    clearTimeout(timer);
    if (res.destroyed) return;
    if (![200, 206].includes(upstream.status)) {
      const status = upstream.status === 416 ? 416 : 502;
      const out = { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' };
      if (status === 416 && upstream.headers.has('content-range')) out['Content-Range'] = upstream.headers.get('content-range');
      res.writeHead(status, out);
      await upstream.body?.cancel();
      return res.end('upstream ' + upstream.status);
    }
    const out = { 'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg', 'Access-Control-Allow-Origin': '*' };
    for (const header of ['content-range', 'content-length', 'accept-ranges']) {
      const value = upstream.headers.get(header); if (value) out[header] = value;
    }
    res.writeHead(upstream.status, out);
    if (req.method === 'HEAD') { await upstream.body?.cancel(); return res.end(); }
    if (!upstream.body) return res.end();
    async function* chunks() {
      const reader = upstream.body.getReader();
      try {
        while (true) {
          // No timer is armed while the consumer is applying backpressure.
          timer = setTimeout(abort, idleTimeoutMs);
          let next;
          try { next = await reader.read(); } finally { clearTimeout(timer); }
          if (next.done) return;
          yield next.value;
        }
      } finally { reader.releaseLock(); }
    }
    await pipeline(Readable.from(chunks()), res);
  } catch (error) {
    if (res.destroyed) return;
    if (res.headersSent) return res.destroy();
    res.writeHead(headerExpired ? 504 : 502, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(headerExpired ? 'audio source timed out' : 'audio source unavailable');
  } finally {
    clearTimeout(timer); abort(); res.removeListener('close', abort);
  }
}
module.exports = { transferAudio };
