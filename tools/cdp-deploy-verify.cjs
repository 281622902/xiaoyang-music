// 一次性：验证 Render 部署版本（新代码 /api/song 带 exhausted 标记 + 酷狗跨源能出地址）
const ID = process.argv[2];
const BASE = 'https://xiaoyang-music-api.onrender.com';
const KUGOU_ID = '1F7E7659B9FFF4FB6F71562A61BBC25F'; // 酷狗「发如雪」
const ws = new WebSocket('ws://localhost:9222/devtools/page/' + ID);
ws.onopen = () => {
  const expr = `(async () => {
    const out = {};
    try {
      const u = '${BASE}/api/song?id=${KUGOU_ID}&vendor=kugou&name=' + encodeURIComponent('发如雪') + '&artist=' + encodeURIComponent('周杰伦') + '&quality=standard';
      const r = await fetch(u);
      const j = await r.json();
      const d = j.data || {};
      out.kugouResolve = JSON.stringify({ http: r.status, vendor: d.vendor || null, url: (d.url || 'EMPTY').slice(0, 60), exhausted: !!d.exhausted, timeout: !!d.resolveTimeout });
    } catch (e) { out.kugouResolve = 'ERR ' + e.message; }
    try {
      const u2 = '${BASE}/api/search?keyword=' + encodeURIComponent('晴天') + '&type=song&page=1&limit=5&vendor=auto';
      const s = Date.now();
      const r2 = await fetch(u2);
      const j2 = await r2.json();
      out.searchQingTian = JSON.stringify({ total: j2.total || 0, ms: Date.now() - s, first: (j2.result || [])[0] ? (j2.result[0].vendor + '|' + j2.result[0].name) : null });
    } catch (e) { out.searchQingTian = 'ERR ' + e.message; }
    return JSON.stringify(out);
  })()`;
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
};
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id === 1) { console.log(m.result?.result?.value ?? JSON.stringify(m.result?.exceptionDetails?.exception?.description || m.result)); process.exit(0); }
};
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 90000);
