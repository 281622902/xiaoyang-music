// 热修验收：①cloudFetch 放行代理路径 ②真实登录请求过反代（业务错误=链路通）③安全闸仍拦非法路径
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
    const ORIGIN = 'https://xiaoyang-music-api.onrender.com';
    // 0) 环境：当前 Supabase 客户端 baseUrl（应为 /api/supabase 代理）
    out.baseUrl = await evalJs(`(window.supabase ? 'inited' : 'missing') + ' / ' + (window.XYNetwork ? (window.XYNetwork.supabaseOrigin()||'') : 'noXYNetwork')`, 15000);

    // 1) cloudFetch 放行：代理路径的 auth health（v3.1.8 此处会抛「目标不匹配」）
    out.health = await evalJs(`(async()=>{
      try{
        const r=await window.XYNetwork.cloudFetch(window.XYNetwork.supabaseOrigin()+'/auth/v1/health',{headers:{apikey:'sb_publishable__DRTgpxPfdR67tsFEJ_EDQ_gvZ8VvdM'}});
        const t=await r.text();
        return r.status+' body='+t.slice(0,80);
      }catch(e){return 'ERR '+e.message;}
    })()`, 30000);

    // 2) 真实登录链路（假密码 → 期待 400 invalid credentials 业务错误，而非拦截错误）
    out.login = await evalJs(`(async()=>{
      try{
        const r=await window.XYNetwork.cloudFetch(window.XYNetwork.supabaseOrigin()+'/auth/v1/token?grant_type=password',{
          method:'POST',
          headers:{apikey:'sb_publishable__DRTgpxPfdR67tsFEJ_EDQ_gvZ8VvdM','content-type':'application/json'},
          body:JSON.stringify({phone:'+8613800000000',password:'wrong-password-test'})
        });
        const t=await r.text();
        return r.status+' '+t.slice(0,100);
      }catch(e){return 'ERR '+e.message;}
    })()`, 40000);

    // 3) 安全闸仍有效：后端 origin 的非 /api/supabase 路径必须被拦
    out.security = await evalJs(`(async()=>{
      try{
        await window.XYNetwork.cloudFetch('https://xiaoyang-music-api.onrender.com/api/search?keyword=x');
        return 'NOT_BLOCKED(安全闸失效!)';
      }catch(e){return '已拦截: '+e.message.slice(0,40);}
    })()`, 15000);

    // 4) SDK 级冒烟：调 supabase-js 的 auth.getUser（未登录 → 应返回 session missing 而非网络错误）
    out.sdk = await evalJs(`(async()=>{
      try{
        const {data,error}=await window.XYCloud && (window.supabase? window.supabase.auth.getUser():{data:null,error:'no-sdk'});
        return JSON.stringify({userError:error?(error.message||String(error)).slice(0,60):null,hasUser:!!(data&&data.user)});
      }catch(e){return 'ERR '+e.message.slice(0,80);}
    })()`, 40000);
  } catch (e) { out.ERROR = e.message; }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
