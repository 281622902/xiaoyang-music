// 验证 qijieya meting（国内公开完整版）：search 响应结构 + type=url 直链能力
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
    // 1) qijieya meting search（国内直连）
    out.qijieyaSearch = await evalJs(`(async()=>{
      const s=Date.now();
      try{
        const r=await fetch('https://api.qijieya.cn/meting/?type=search&id='+encodeURIComponent('周杰伦 晴天')+'&limit=5&server=netease',{redirect:'follow'});
        const t=await r.text();
        return r.status+' '+(Date.now()-s)+'ms body='+t.slice(0,400);
      }catch(e){return 'ERR '+e.message;}
    })()`, 30000);

    // 2) qijieya meting type=url（按网易 ID 直链）
    out.qijieyaUrl = await evalJs(`(async()=>{
      try{
        const r=await fetch('https://api.qijieya.cn/meting/?type=url&id=287398&server=netease',{redirect:'follow'});
        const buf=await r.arrayBuffer();
        return JSON.stringify({finalUrl:(r.url||'').slice(0,90),ct:(r.headers.get('content-type')||'').slice(0,25),bytes:buf.byteLength});
      }catch(e){return 'ERR '+e.message;}
    })()`, 30000);

    // 3) 解析 search 响应结构（第一条完整字段）
    out.qijieyaFields = await evalJs(`(async()=>{
      try{
        const r=await fetch('https://api.qijieya.cn/meting/?type=search&id='+encodeURIComponent('晴天')+'&limit=3&server=netease');
        const j=await r.json();
        if(!Array.isArray(j)||!j.length)return 'EMPTY';
        const first=j[0];
        return JSON.stringify({name:first.name,artist:first.artist,url:(first.url||'').slice(0,80),pic:(first.pic||'').slice(0,60),lrc:!!first.lrc,keys:Object.keys(first).join(',')});
      }catch(e){return 'ERR '+e.message;}
    })()`, 30000);
  } catch (e) { out.ERROR = e.message; }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
