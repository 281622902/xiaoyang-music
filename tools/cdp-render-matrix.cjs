// CDP：在 MuMu 模拟器内直连 Render 后端跑全接口测试矩阵（中国直连网络，等同用户 4G 环境）
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
    setTimeout(() => reject(new Error('eval timeout #' + id)), ms || 30000);
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
    // 0) 直连健康检查（App 内 fetch，模拟器直连网络）
    await evalJs(`localStorage.setItem('uzz.apiBase', '${BASE}')`);
    out.health = await evalJs(`fetch('${BASE}/api/health').then(r=>r.json()).then(j=>j.code+'/'+(j.service||'')+'/'+(j.publicMode?'public':'private'))`, 20000);

    // 1) 四类搜索（type=song/artist/album/playlist，vendor=auto）
    for (const t of ['song', 'artist', 'album', 'playlist']) {
      out['search_' + t] = await evalJs(`(async()=>{
        const u='${BASE}/api/search?keyword='+encodeURIComponent('周杰伦')+'&type=${t}&page=1&limit=5&vendor=auto';
        const r=await fetch(u);const j=await r.json();
        return JSON.stringify({http:r.status,total:j.total||0,count:(j.result||[]).length,first:(j.result||[])[0]?((j.result||[])[0].vendor||'-')+'|'+((j.result||[])[0].name||'').slice(0,18):null});
      })()`, 25000);
    }

    // 2) 取一首搜到的歌做完整解析（真实播放链路）
    out.resolve = await evalJs(`(async()=>{
      const u='${BASE}/api/search?keyword='+encodeURIComponent('晴天')+'&type=song&page=1&limit=5&vendor=auto';
      const r=await fetch(u);const j=await r.json();const t=(j.result||[])[0];if(!t)return 'NO_TRACK';
      const ru='${BASE}/api/song?id='+t.id+'&vendor='+t.vendor+'&name='+encodeURIComponent(t.name)+'&artist='+encodeURIComponent(t.artist)+'&quality=standard';
      const rr=await fetch(ru);const jj=await rr.json();const d=jj.data||{};
      const url=d.url||'';const trial=!!d.trial;const rt=!!d.resolveTimeout;
      let streamHead=null;
      if(url){try{const s=await fetch('${BASE}/api/stream?url='+encodeURIComponent(url),{method:'HEAD'});streamHead=s.status+' ct='+(s.headers.get('content-type')||'')+' len='+(s.headers.get('content-length')||'');}catch(e){streamHead='ERR '+e.message;}}
      return JSON.stringify({track:t.vendor+'|'+t.name, http:rr.status, url: url?url.slice(0,70):'EMPTY', trial, resolveTimeout: rt, streamHead});
    })()`, 60000);

    // 3) QQ 音源对照（验证跨源解析能力）
    out.resolve_tencent = await evalJs(`(async()=>{
      const u='${BASE}/api/search?keyword='+encodeURIComponent('晴天')+'&type=song&page=1&limit=5&vendor=tencent';
      const r=await fetch(u);const j=await r.json();const t=(j.result||[])[0];if(!t)return 'NO_TRACK (tencent 搜索空)';
      const ru='${BASE}/api/song?id='+t.id+'&vendor=tencent&name='+encodeURIComponent(t.name)+'&artist='+encodeURIComponent(t.artist);
      const rr=await fetch(ru);const jj=await rr.json();const d=jj.data||{};
      return JSON.stringify({http:rr.status,url:(d.url||'EMPTY').slice(0,70),resolveTimeout:!!d.resolveTimeout});
    })()`, 40000);
  } catch (e) { out.ERROR = e.message; }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
