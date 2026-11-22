/* ============================================================
 * sw.js — 小杨音乐 PWA 更新保障
 * 策略：应用外壳「网络优先」，刷新时先取服务器最新版；
 *       网络失败才回退缓存。/api/* 与音频流完全不拦截。
 * ============================================================ */
const CACHE = 'xymusic-shell-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './css/style.css',
  './css/studio.css',
  './css/cloud.css',
  './css/mobile.css',
  './js/api.js',
  './js/app.js',
  './js/player.js',
];

self.addEventListener('install', (event) => {
  self.skipWaiting(); // 新 SW 立即接管，不等旧页面全部关闭
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((p) => cache.add(p))))
      .catch(() => {}),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
      )),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // 音乐接口不缓存

  const isShell = url.pathname === '/' || /\.(html|css|js|svg|webmanifest|json)$/i.test(url.pathname);
  if (!isShell) return;

  event.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-store' });
      if (!res || !res.ok) throw new Error('bad response');
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
      return res;
    } catch (err) {
      const cached = await caches.match(req)
        || (url.pathname === '/' ? await caches.match('./index.html') : null);
      if (cached) return cached;
      return new Response('离线不可用，请联网后刷新', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});
