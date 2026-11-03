const { AsyncLocalStorage } = require('node:async_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const requests = new AsyncLocalStorage();
function combinedSignal(signals) {
  const valid = signals.filter(Boolean);
  if (valid.length < 2) return valid[0];
  if (AbortSignal.any) return AbortSignal.any(valid);
  const ctrl = new AbortController();
  for (const signal of valid) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  }
  return ctrl.signal;
}
async function upstreamFetch(url, options = {}) {
  const signal = combinedSignal([requests.getStore()?.signal, options.signal]);
  if (signal?.aborted) return Promise.reject(signal.reason || new Error('Request canceled'));
  if(process.env.XY_PUBLIC_API==='1')return require('./public-api').publicFetch(url,{...options,signal},fetch);
  return fetch(url, { ...options, signal });
}
function sleep(ms) { return delay(ms, undefined, { signal: requests.getStore()?.signal }); }
function runRequest(req, res, callback) {
  const ctrl = new AbortController();
  // Audio transfers have separate header/idle deadlines and may legitimately last hours.
  const deadline = req.url.startsWith('/api/stream') ? 0 : req.url.startsWith('/api/download') ? 600000 : 24000;
  const timer = deadline ? setTimeout(() => ctrl.abort(new Error('Upstream deadline exceeded')), deadline) : null;
  const stop = () => { clearTimeout(timer); ctrl.abort(new Error('Request finished or disconnected')); };
  req.once('aborted', stop); res.once('close', stop); res.once('finish', stop);
  return requests.run({ signal: ctrl.signal }, callback);
}
module.exports = { upstreamFetch, runRequest, sleep };
