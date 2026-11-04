// 轮询播放状态直至开始播放或超时（90s）
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
  for (let i = 0; i < 18; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const s = await evalJs(`(async()=>{
      const st=window.Player?.getState?.()||{};
      const audio=window.XYAudio||document.getElementById('audio');
      const toast=document.getElementById('toast');
      return JSON.stringify({
        cur: st.current ? (st.current.vendor+'|'+st.current.name) : null,
        url: (st.current?.url||'').slice(0,60)||null,
        paused: audio?audio.paused:null,
        pos: audio?Math.round(audio.currentTime||0):null,
        err: audio&&audio.error?(audio.error.code+'/'+(audio.error.nativeCode||'')):null,
        toast: toast&&!toast.classList.contains('hidden')?toast.textContent:null,
      });
    })()`);
    console.log('t+' + ((i + 1) * 5) + 's:', s);
    const o = JSON.parse(s);
    if (o.pos > 0 && o.paused === false) { console.log('PLAYING ✓'); break; }
    if (o.err) { console.log('ERROR STATE'); break; }
  }
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
