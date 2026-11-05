// 生死判定②：Render → api.qijieya.cn 可达性（经 /api/stream 白名单代理）
const ID = process.argv[2];
const BASE = 'https://xiaoyang-music-api.onrender.com';
const ws = new WebSocket('ws://localhost:9222/devtools/page/' + ID);
ws.onopen = () => {
  const qijieyaSearch = 'https://api.qijieya.cn/meting/?type=search&id=' + encodeURIComponent('晴天') + '&limit=3&server=netease';
  const expr = `(async () => {
    const out = {};
    // 1) Render 代理 → qijieya search
    try {
      const s = Date.now();
      const r = await fetch('${BASE}/api/stream?url=' + encodeURIComponent('${qijieyaSearch}'));
      const t = await r.text();
      out.viaRender = r.status + ' ' + (Date.now() - s) + 'ms body=' + t.slice(0, 120);
    } catch (e) { out.viaRender = 'ERR ' + e.message; }
    // 2) 直连对照
    try {
      const s = Date.now();
      const r = await fetch('${qijieyaSearch}', { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const j = await r.json();
      out.direct = r.status + ' ' + (Date.now() - s) + 'ms count=' + (Array.isArray(j) ? j.length : 'bad');
    } catch (e) { out.direct = 'ERR ' + e.message; }
    return JSON.stringify(out);
  })()`;
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
};
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id === 1) { console.log(m.result?.result?.value ?? JSON.stringify(m.result?.exceptionDetails?.exception?.description || m.result)); process.exit(0); }
};
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 60000);
