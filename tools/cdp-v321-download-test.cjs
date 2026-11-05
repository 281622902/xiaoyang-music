// v3.2.1 下载+离线播放全链路验收
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
    // 1) 拿一首可下载的在线歌（meting 直链）
    out.search = await evalJs(`(async()=>{
      const r=await window.UzzApi.search('晴天','song',1,3);
      const t=r.list.find(x=>x.url&&/^https?:\\/\\//.test(x.url));
      return t?JSON.stringify({name:t.name.slice(0,15),url:t.url.slice(0,50)}):'NO_URL_TRACK';
    })()`, 60000);

    // 2) 原生下载（进度事件 → MediaStore → 返回 device 轨目）
    out.download = await evalJs(`(async()=>{
      const r=await window.UzzApi.search('晴天','song',1,3);
      const t=r.list.find(x=>x.url&&/^https?:\\/\\//.test(x.url));
      if(!t)return 'NO_TRACK';
      const events=[];
      const prog=window.XYNative.NativeMusic.addListener('downloadProgress',(p)=>{events.push(Number(p&&p.percent)||0);});
      try{
        const res=await window.XYNative.NativeMusic.downloadTrack({url:t.url,name:t.name,artist:t.artist});
        if(prog&&prog.remove)prog.remove();
        const track=(res&&res.tracks||[])[0]||null;
        return JSON.stringify({progress:events.length?('0..'+events[events.length-1]+'%'):'无(total未知)',id:track?track.id.slice(0,16):null,url:track?track.url.slice(0,40):null,vendor:track?track.vendor:null});
      }catch(e){if(prog&&prog.remove)prog.remove();return 'ERR '+e.message;}
    })()`, 180000);

    // 3) 入库 + 离线播放（播放 content:// URI，不经任何网络）
    out.playOffline = await evalJs(`(async()=>{
      const res=await window.XYNative.NativeMusic.downloadTrack({url:(await window.UzzApi.search('晴天','song',1,3)).list.find(x=>x.url).url,name:'离线测试曲',artist:'验收'});
      const t=res.tracks[0];
      window.XYMobileApp?null:0;
      // 直接用 Player 播放 device 轨（content:// 走 Media3，无网络）
      window.Player.loadAndPlay(t).catch(()=>{});
      for(let i=0;i<16;i++){await new Promise(r=>setTimeout(r,5000));
        const audio=window.XYAudio||document.getElementById('audio');
        const st=window.Player.getState();
        if(audio&&!audio.paused&&(audio.currentTime||0)>0)return JSON.stringify({offlinePlaying:true,cur:(st.current&&st.current.name||'').slice(0,12),pos:Math.round(audio.currentTime)});
      }
      return JSON.stringify({offlinePlaying:false});
    })()`, 180000);
  } catch (e) { out.ERROR = e.message; }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
