// v3.2.2 收官回归：新设置 UI（列表行+sheet 单选）+ 底部导航 5 列 + 桌面歌词
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
    // 1) 底部导航 5 列 + 设置页行式布局
    out.layout = await evalJs(`(()=>{
      const btn=document.querySelector('.bottom-nav [data-nav="settings"]');
      btn.click();
      const rows=document.querySelectorAll('#page-settings .settings-card button').length;
      const navButtons=document.querySelectorAll('.bottom-nav button').length;
      return JSON.stringify({navButtons,settingRows:rows,hasGiantSeg:!!document.querySelector('#qualitySeg')});
    })()`);

    // 2) 行值显示正确
    out.values = await evalJs(`JSON.stringify({quality:(document.getElementById('valQuality')||{}).textContent,speed:(document.getElementById('valSpeed')||{}).textContent,theme:(document.getElementById('valTheme')||{}).textContent,lyric:(document.getElementById('valMobileLyric')||{}).textContent})`);

    // 3) 点「音质」行 → sheet 单选 → 选高品 → 值更新
    out.pickQuality = await evalJs(`(async()=>{
      document.getElementById('rowQuality').click();
      await new Promise(r=>setTimeout(r,600));
      const sheetVisible=!document.getElementById('sheetBackdrop').hidden;
      const opt=document.querySelector('#sheetContent [data-pick="ex"]');
      if(!opt)return JSON.stringify({sheetVisible,option:'MISSING'});
      opt.click();
      await new Promise(r=>setTimeout(r,500));
      return JSON.stringify({sheetVisible,option:'ok',newVal:(document.getElementById('valQuality')||{}).textContent,stored:localStorage.getItem('uzz.quality')});
    })()`);
    out.pickBack = await evalJs(`(async()=>{
      document.getElementById('rowQuality').click();
      await new Promise(r=>setTimeout(r,500));
      const opt=document.querySelector('#sheetContent [data-pick="standard"]');
      opt&&opt.click();
      await new Promise(r=>setTimeout(r,400));
      return (document.getElementById('valQuality')||{}).textContent;
    })()`);

    // 4) 倍速行 → 1.5x
    out.pickSpeed = await evalJs(`(async()=>{
      document.getElementById('rowSpeed').click();
      await new Promise(r=>setTimeout(r,500));
      const opt=document.querySelector('#sheetContent [data-pick="1.5"]');
      opt&&opt.click();
      await new Promise(r=>setTimeout(r,700));
      const audio=window.XYAudio||document.getElementById('audio');
      return JSON.stringify({val:(document.getElementById('valSpeed')||{}).textContent,rate:audio?audio.playbackRate:null});
    })()`, 20000);

    // 5) 桌面歌词行开关（悬浮窗权限已授予环境）
    out.lyric = await evalJs(`(async()=>{
      document.getElementById('rowMobileLyric').click();
      await new Promise(r=>setTimeout(r,800));
      const on=localStorage.getItem('uzz.mobileLyric')==='1';
      const val=(document.getElementById('valMobileLyric')||{}).textContent;
      return JSON.stringify({on,val});
    })()`, 20000);

    // 6) 页面可滚动性（内容高度 vs 容器）
    out.scroll = await evalJs(`(()=>{
      const page=document.getElementById('page-settings');
      const main=document.getElementById('mobileMain');
      return JSON.stringify({pageH:page?page.scrollHeight:0,mainH:main?main.clientHeight:0,scrollable:page&&main?page.scrollHeight>main.clientHeight:true,overflow:getComputedStyle(main).overflow});
    })()`);
  } catch (e) { out.ERROR = e.message; }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
