// 一次性：①GDStudio search/url 海外可用性实测 ②复现「发如雪」酷狗解析失败
const ID = process.argv[2];
const BASE = 'https://xiaoyang-music-api.onrender.com';
const GDS = 'https://music-api.gdstudio.xyz/api.php';
const ws = new WebSocket('ws://localhost:9222/devtools/page/' + ID);
let nextId = 1;
const pending = new Map();
function evalJs(expr, ms) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
    setTimeout(() => reject(new Error('eval timeout #' + id)), ms || 40000);
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
    // 1) GDStudio 搜索（netease 源）
    out.gdsSearch = await evalJs(`(async()=>{
      const u='${GDS}?types=search&source=netease&name='+encodeURIComponent('发如雪 周杰伦')+'&count=5&pages=1';
      const r=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0'}});const j=await r.json();
      const list=Array.isArray(j)?j:(j.data||[]);
      return JSON.stringify({http:r.status,count:list.length,first:list[0]?list[0].id+'|'+list[0].name+'|'+(list[0].artist&&list[0].artist.name||list[0].artist||''):null,ids:list.slice(0,3).map(x=>x.id)});
    })()`, 40000);

    // 2) GDStudio 解析（用搜到的第一个网易 ID）
    out.gdsUrl = await evalJs(`(async()=>{
      const u='${GDS}?types=search&source=netease&name='+encodeURIComponent('发如雪 周杰伦')+'&count=3&pages=1';
      const j=await (await fetch(u,{headers:{'User-Agent':'Mozilla/5.0'}})).json();
      const list=Array.isArray(j)?j:[];
      if(!list.length)return 'NO_SEARCH_RESULT';
      const id=list[0].id;
      const ru='${GDS}?types=url&source=netease&id='+id+'&br=320';
      const r=await fetch(ru,{headers:{'User-Agent':'Mozilla/5.0'},redirect:'follow'});
      const txt=await r.text();let url='';
      try{const jj=JSON.parse(txt);url=jj.url||'';}catch(e){url=txt.slice(0,60);}
      return JSON.stringify({neteaseId:id,http:r.status,url:url?url.slice(0,80):'EMPTY'});
    })()`, 40000);

    // 3) 复现：Render 搜索「发如雪」→ 酷狗曲目 → /api/song 解析
    out.renderSearchSong = await evalJs(`(async()=>{
      const u='${BASE}/api/search?keyword='+encodeURIComponent('发如雪')+'&type=song&page=1&limit=5&vendor=auto';
      const r=await fetch(u);const j=await r.json();const t=(j.result||[])[0];
      if(!t)return 'SEARCH_EMPTY';
      return JSON.stringify({vendor:t.vendor,id:t.id,name:t.name});
    })()`, 40000);

    // 4) Render /api/song 解析该曲目（证据：403/空地址）
    out.renderResolve = await evalJs(`(async()=>{
      const u='${BASE}/api/search?keyword='+encodeURIComponent('发如雪')+'&type=song&page=1&limit=5&vendor=auto';
      const j=await (await fetch(u)).json();const t=(j.result||[])[0];if(!t)return 'NO_TRACK';
      const ru='${BASE}/api/song?id='+t.id+'&vendor='+t.vendor+'&name='+encodeURIComponent(t.name)+'&artist='+encodeURIComponent(t.artist)+'&quality=standard';
      const rr=await fetch(ru);const jj=await rr.json();const d=jj.data||{};
      return JSON.stringify({vendor:t.vendor,http:rr.status,url:(d.url||'EMPTY').slice(0,80),resolveTimeout:!!d.resolveTimeout});
    })()`, 60000);

    // 5) 对照：直接拿网易 ID 走 Render /api/song（发现页链路，应能出地址）
    out.renderNetease = await evalJs(`(async()=>{
      const gds='${GDS}?types=search&source=netease&name='+encodeURIComponent('发如雪')+'&count=1&pages=1';
      const gj=await (await fetch(gds,{headers:{'User-Agent':'Mozilla/5.0'}})).json();
      const list=Array.isArray(gj)?gj:[];if(!list.length)return 'NO_GDS';
      const nid=list[0].id;
      const ru='${BASE}/api/song?id='+nid+'&vendor=netease&quality=standard';
      const rr=await fetch(ru);const jj=await rr.json();const d=jj.data||{};
      return JSON.stringify({neteaseId:nid,http:rr.status,url:(d.url||'EMPTY').slice(0,80),trial:!!d.trial});
    })()`, 60000);
  } catch (e) { out.ERROR = e.message; }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
