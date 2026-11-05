// 验收：CDP 直调原生 downloadApk（真 Render release-file 链路）→ 进度事件 → openApk
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
    // 1) 版本接口（确认降级链路数据源）
    out.version = await evalJs(`(async()=>{
      const r=await fetch('${BASE}/api/version/android');
      const j=await r.json();
      return JSON.stringify({version:j.version,download:(j.download_url||'').slice(0,70)});
    })()`, 30000);

    // 2) App 内下载：监听进度 + 调原生 downloadApk（真链路下 7MB APK）
    out.download = await evalJs(`(async()=>{
      const events=[];
      const prog=window.XYNative.NativeMusic.addListener('apkProgress',(p)=>{events.push(Number(p&&p.percent)||0);});
      try{
        const r=await window.XYNative.NativeMusic.downloadApk({url:'${BASE}/api/release-file',version:'3.1.8'});
        if(prog&&prog.remove)prog.remove();
        return JSON.stringify({path:(r&&r.path)||null,size:(r&&r.size)||0,progressSamples:events.slice(0,5).join(',')+'...'+(events.length?events[events.length-1]:'')});
      }catch(e){if(prog&&prog.remove)prog.remove();return 'ERR '+e.message;}
    })()`, 120000);

    // 3) openApk（期望：弹安装器 或 返回 needsPermission=true 跳权限页）
    out.openApk = await evalJs(`(async()=>{
      const r=await window.XYNative.NativeMusic.downloadApk({url:'${BASE}/api/release-file',version:'3.1.8'});
      const open=await window.XYNative.NativeMusic.openApk({path:r.path});
      return JSON.stringify(open||{ok:true});
    })()`, 120000);

    // 4) 安装器是否真的弹出（检测前台 Activity 是否变成安装器/包安装程序）
    out.installerCheck = '见外部 dumpsys';
  } catch (e) { out.ERROR = e.message; }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
