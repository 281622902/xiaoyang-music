// v3.2.0 第一批全量回归：设置中心 UI + 音质/倍速/定时/主题 + 播放链路回归
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
    // 1) 底部导航第五项 + 设置页可达
    out.nav = await evalJs(`(()=>{
      const btn=document.querySelector('.bottom-nav [data-nav="settings"]');
      btn&&btn.click();
      const page=document.getElementById('page-settings');
      return JSON.stringify({hasNav:!!btn,visible:page&&!page.hidden,title:(document.getElementById('settingsTitle')||{}).textContent||null});
    })()`);

    // 2) 音质切换（localStorage + active 状态）
    out.quality = await evalJs(`(()=>{
      document.querySelector('#qualitySeg [data-quality="ex"]').click();
      const active=document.querySelector('#qualitySeg .active');
      return JSON.stringify({value:localStorage.getItem('uzz.quality'),active:active?active.dataset.quality:null});
    })()`);
    out.qualityBack = await evalJs(`(()=>{
      document.querySelector('#qualitySeg [data-quality="standard"]').click();
      return localStorage.getItem('uzz.quality');
    })()`);

    // 3) 倍速（原生桥 setSpeed + 状态保存）
    out.speed = await evalJs(`(async()=>{
      document.querySelector('#speedSeg [data-speed="1.5"]').click();
      await new Promise(r=>setTimeout(r,500));
      const audio=window.XYAudio||document.getElementById('audio');
      return JSON.stringify({saved:localStorage.getItem('uzz.rate'),rate:audio?(audio.playbackRate||'n/a'):null,active:(document.querySelector('#speedSeg .active')||{}).dataset?.speed||null});
    })()`, 20000);
    out.speedBack = await evalJs(`(async()=>{
      document.querySelector('#speedSeg [data-speed="1"]').click();
      await new Promise(r=>setTimeout(r,300));
      const audio=window.XYAudio||document.getElementById('audio');
      return JSON.stringify({saved:localStorage.getItem('uzz.rate'),rate:audio?audio.playbackRate:null});
    })()`, 15000);

    // 4) 定时关闭（启动 15 分钟 → 倒计时显示 → 取消）
    out.sleep = await evalJs(`(async()=>{
      document.querySelector('#sleepSeg [data-sleep="15"]').click();
      await new Promise(r=>setTimeout(r,1500));
      const on=document.getElementById('sleepStatus');
      const shown=on&&!on.hidden?on.textContent:'';
      document.querySelector('#sleepSeg [data-sleep="0"]').click();
      await new Promise(r=>setTimeout(r,300));
      return JSON.stringify({countdownShown:shown.slice(0,20),canceled:document.getElementById('sleepStatus').hidden});
    })()`, 20000);

    // 5) 主题三态
    out.theme = await evalJs(`(async()=>{
      document.querySelector('#themeSeg [data-theme="dark"]').click();
      await new Promise(r=>setTimeout(r,200));
      const dark=document.documentElement.dataset.theme;
      document.querySelector('#themeSeg [data-theme="light"]').click();
      await new Promise(r=>setTimeout(r,200));
      const light=document.documentElement.dataset.theme;
      document.querySelector('#themeSeg [data-theme="auto"]').click();
      await new Promise(r=>setTimeout(r,200));
      return JSON.stringify({dark:dark==='dark',light:light==='light',autoPref:localStorage.getItem('xy.android.theme'),autoActive:(document.querySelector('#themeSeg .active')||{}).dataset?.theme||null});
    })()`);

    // 6) 播放链路回归（搜歌→点播→出声）
    out.play = await evalJs(`(async()=>{
      document.querySelector('[data-nav="search"]').click();
      await new Promise(r=>setTimeout(r,400));
      const inp=document.getElementById('mobileSearchInput');
      inp.value='晴天';
      document.getElementById('mobileSearchForm').dispatchEvent(new Event('submit',{cancelable:true}));
      for(let i=0;i<24;i++){await new Promise(r=>setTimeout(r,1000));
        const rows=document.querySelectorAll('#mobileResults li').length;
        if(rows>0)break;}
      const first=document.querySelector('#mobileResults [data-track-index="0"], #mobileResults li');
      if(!first)return 'NO_RESULT';
      (first.matches('button')?first:first.querySelector('button')||first).click();
      for(let i=0;i<18;i++){await new Promise(r=>setTimeout(r,5000));
        const st=window.Player.getState();const audio=window.XYAudio||document.getElementById('audio');
        if(audio&&!audio.paused&&(audio.currentTime||0)>0)return JSON.stringify({playing:true,cur:st.current?(st.current.name||'').slice(0,15):null,pos:Math.round(audio.currentTime)});}
      return JSON.stringify({playing:false,cur:window.Player.getState().current?(window.Player.getState().current.name||'').slice(0,15):null});
    })()`, 150000);
  } catch (e) { out.ERROR = e.message; }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
