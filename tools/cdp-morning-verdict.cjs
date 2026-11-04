// 早上生死判定：①Render→injahow（国内API）可达性 ②手机直连网易CDN直链（无Referer）③Render 网易解析现状
const ID = process.argv[2];
const BASE = 'https://xiaoyang-music-api.onrender.com';
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
    // 1) Render→injahow 经 /api/stream 白名单（type=url 按网易ID解析直链）
    out.renderToInjahow = await evalJs(`(async()=>{
      const u='${BASE}/api/stream?url='+encodeURIComponent('https://api.injahow.cn/meting/?type=url&id=287398&source=netease');
      const s=Date.now();
      try{const r=await fetch(u);const t=await r.text();return r.status+' '+(Date.now()-s)+'ms body='+t.slice(0,100);}catch(e){return 'ERR '+e.message;}
    })()`, 40000);

    // 2) Render 现在的网易解析（weapi 现状）
    out.renderNeteaseResolve = await evalJs(`(async()=>{
      const r=await fetch('${BASE}/api/song?id=287398&vendor=netease&quality=standard');
      const j=await r.json();const d=j.data||{};
      return JSON.stringify({http:r.status,url:(d.url||'EMPTY').slice(0,60),exhausted:!!d.exhausted,timeout:!!d.resolveTimeout});
    })()`, 60000);

    // 3) 若拿到直链：模拟器直连 CDN（无 Referer）能否出流（=手机 4G 直连的真实模拟）
    out.directCdn = await evalJs(`(async()=>{
      const r=await fetch('${BASE}/api/song?id=287398&vendor=netease&quality=standard');
      const j=await r.json();const url=(j.data||{}).url;if(!url)return 'NO_URL_FROM_RENDER';
      try{
        const s=await fetch(url,{headers:{Range:'bytes=0-1'}});
        return JSON.stringify({status:s.status,ct:(s.headers.get('content-type')||'').slice(0,30),len:s.headers.get('content-length')||''});
      }catch(e){return 'ERR '+e.message;}
    })()`, 80000);

    // 4) 模拟器直连 injahow（对照：国内网络→国内API）
    out.directInjahow = await evalJs(`(async()=>{
      const s=Date.now();
      try{const r=await fetch('https://api.injahow.cn/meting/?type=url&id=287398&source=netease',{redirect:'follow'});
      const t=await r.text();return r.status+' '+(Date.now()-s)+'ms body='+t.slice(0,80);}catch(e){return 'ERR '+e.message;}
    })()`, 30000);

    // 5) GDStudio 冷却恢复了吗（Render 侧搜索链：直接看 searchMulti 现状）
    out.renderSearch = await evalJs(`(async()=>{
      const s=Date.now();
      const r=await fetch('${BASE}/api/search?keyword='+encodeURIComponent('晴天')+'&type=song&page=1&limit=3&vendor=auto');
      const j=await r.json();
      return JSON.stringify({total:j.total||0,ms:Date.now()-s,first:(j.result||[])[0]?((j.result||[])[0].vendor+'|'+((j.result||[])[0].name||'').slice(0,15)):null});
    })()`, 80000);
  } catch (e) { out.ERROR = e.message; }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
