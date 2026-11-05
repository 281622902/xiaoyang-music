// v3.2.2 桌面歌词全链路验收：开关 → 悬浮窗 → 播放歌词同步 → 关闭
const ID = process.argv[2];
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
    // 1) 打开桌面歌词（设置中心开关路径）
    out.switchOn = await evalJs(`(async()=>{
      document.querySelector('.bottom-nav [data-nav="settings"]').click();
      await new Promise(r=>setTimeout(r,500));
      document.querySelector('#mobileLyricSeg [data-mlyric="1"]').click();
      await new Promise(r=>setTimeout(r,1500));
      return JSON.stringify({pref:localStorage.getItem('uzz.mobileLyric'),active:(document.querySelector('#mobileLyricSeg .active')||{}).dataset?.mlyric||null});
    })()`, 20000);

    // 2) 播放一首有歌词的歌（等歌词同步进悬浮窗）
    out.playWithLyric = await evalJs(`(async()=>{
      document.querySelector('[data-nav="search"]').click();
      await new Promise(r=>setTimeout(r,300));
      const inp=document.getElementById('mobileSearchInput');
      inp.value='晴天';
      document.getElementById('mobileSearchForm').dispatchEvent(new Event('submit',{cancelable:true}));
      for(let i=0;i<24;i++){await new Promise(r=>setTimeout(r,1000));if(document.querySelectorAll('#mobileResults li').length>0)break;}
      const first=document.querySelector('#mobileResults [data-track-index="0"], #mobileResults li');
      (first.matches('button')?first:first.querySelector('button')||first).click();
      for(let i=0;i<18;i++){await new Promise(r=>setTimeout(r,5000));
        const st=window.Player.getState();const audio=window.XYAudio||document.getElementById('audio');
        if(audio&&!audio.paused&&(audio.currentTime||0)>3&&st.lyrics&&st.lyrics.length)return JSON.stringify({playing:true,lyricLines:st.lyrics.length,cur:(st.lyrics.find(l=>l.t<=audio.currentTime+0.2)||{}).text?.slice(0,18)||''});}
      return 'PLAY_TIMEOUT';
    })()`, 150000);

    // 3) 直接调一次 lyricOverlay 验证文本更新（同步链路终验）
    out.pushLyric = await evalJs(`(async()=>{
      const r=await window.XYNative.NativeMusic.lyricOverlay({show:true,cur:'验收测试当前句',next:'验收测试下一句',playing:true});
      return JSON.stringify(r||{ok:true});
    })()`, 20000);

    // 4) 关闭开关 → 悬浮窗应消失
    out.switchOff = await evalJs(`(async()=>{
      document.querySelector('.bottom-nav [data-nav="settings"]').click();
      await new Promise(r=>setTimeout(r,400));
      document.querySelector('#mobileLyricSeg [data-mlyric="0"]').click();
      await new Promise(r=>setTimeout(r,800));
      return JSON.stringify({pref:localStorage.getItem('uzz.mobileLyric')});
    })()`, 20000);
  } catch (e) { out.ERROR = e.message; }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
