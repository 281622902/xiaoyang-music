// 一次性 UI 全流程验收：搜「发如雪」→ 点第一首 → 等播放 → 读原生播放状态
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
    await evalJs(`localStorage.setItem('uzz.apiBase', '${BASE}')`);
    // 进搜索页，输入关键词，提交
    out.nav = await evalJs(`(async()=>{
      document.querySelector('[data-nav="search"]')?.click();
      await new Promise(r=>setTimeout(r,400));
      const inp=document.getElementById('mobileSearchInput');
      if(!inp)return 'NO_INPUT';
      inp.value='发如雪';
      document.getElementById('mobileSearchForm').dispatchEvent(new Event('submit',{cancelable:true}));
      return 'submitted';
    })()`);
    // 等结果渲染
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const s = await evalJs(`JSON.stringify({summary:document.getElementById('searchSummary')?.textContent||'',rows:document.querySelectorAll('#mobileResults [data-play-index], #mobileResults li').length})`);
      const o = JSON.parse(s);
      if (o.rows > 0 && !/正在|寻找/.test(o.summary)) { out.search = o; break; }
      out.search = o;
    }
    // 点第一条结果播放
    out.click = await evalJs(`(async()=>{
      const first=document.querySelector('#mobileResults [data-play-index="0"], #mobileResults li button, #mobileResults li');
      if(!first)return 'NO_RESULT_ITEM';
      (first.matches('button')?first:first.querySelector('button')||first).click();
      return 'clicked';
    })()`);
    // 等 20s 读播放状态
    await new Promise(r => setTimeout(r, 20000));
    out.playState = await evalJs(`(async()=>{
      const st=window.Player?.getState?.()||{};
      const audio=window.XYAudio||document.getElementById('audio');
      return JSON.stringify({
        cur: st.current ? (st.current.vendor+'|'+st.current.name) : null,
        curUrl: (st.current?.url||'').slice(0,70)||null,
        paused: audio?audio.paused:null,
        position: audio?Math.round(audio.currentTime||0):null,
        duration: audio?Math.round(audio.duration||0):null,
        src: ((audio&&(audio.currentSrc||audio.src))||'').slice(0,80)||null,
        error: audio&&audio.error?(audio.error.code+'/'+(audio.error.nativeCode||'')):null,
      });
    })()`);
  } catch (e) { out.ERROR = e.message; }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
