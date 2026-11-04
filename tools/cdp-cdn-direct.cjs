// 验证：手机直连 injahow 302 拿直链 → 直连网易 CDN（无 Referer）能否出流
const ID = process.argv[2];
const ws = new WebSocket('ws://localhost:9222/devtools/page/' + ID);
let nextId = 1;
const pending = new Map();
function evalJs(expr, ms) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
    setTimeout(() => reject(new Error('eval timeout')), ms || 40000);
  });
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.result?.exceptionDetails) reject(new Error(m.result.exceptionDetails.exception?.description || 'eval error'));
    else p.resolve(m.result?.result?.value);
  }
};
(async () => {
  await new Promise(r => ws.onopen = r);
  const out = {};
  try {
    // 1) 直连 injahow 拿 302 后的最终直链（res.url）
    out.step1 = await evalJs(`(async()=>{
      const r=await fetch('https://api.injahow.cn/meting/?type=url&id=287398&source=netease',{redirect:'follow'});
      const buf=await r.arrayBuffer();
      return JSON.stringify({finalUrl:(r.url||'').slice(0,90),ct:(r.headers.get('content-type')||'').slice(0,30),bytes:buf.byteLength});
    })()`, 40000);
    // 2) 直连 CDN 直链（无 Referer，模拟 Media3 原生请求）
    out.step2 = await evalJs(`(async()=>{
      const r=await fetch('https://api.injahow.cn/meting/?type=url&id=287398&source=netease',{redirect:'follow'});
      const cdn=r.url;if(!cdn||!cdn.includes('126.net'))return 'NO_CDN_URL: '+(cdn||'').slice(0,60);
      const s=await fetch(cdn,{headers:{Range:'bytes=0-99999'}});
      const buf=await s.arrayBuffer();
      return JSON.stringify({status:s.status,ct:(s.headers.get('content-type')||'').slice(0,30),bytes:buf.byteLength});
    })()`, 60000);
  } catch (e) { out.ERROR = e.message; }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
