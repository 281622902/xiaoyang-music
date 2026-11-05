(function(global){
 'use strict';
 const config=global.XYAndroidConfig||{lan:[],cleartextHosts:['localhost','127.0.0.1','10.0.2.2','10.0.3.2']};
 const native=()=>!!global.XYNative?.isAndroid;
 const cloudOrigin='https://codianpoqhqilkwviota.supabase.co';
 const publicKey='sb_publishable__DRTgpxPfdR67tsFEJ_EDQ_gvZ8VvdM';
 // Supabase 反向代理目标（2026-11-05）：国内运营商掐断 supabase.co 后，手机端
 // Supabase 请求改走音乐后端的 /api/supabase/* 透传代理（后端海外→海外稳定）。
 function supabaseOrigin(){
  const base=localStorage.getItem('uzz.apiBase')||'';
  if(native()&&base)return base.replace(/\/+$/,'')+'/api/supabase';
  return cloudOrigin;
 }
 function backendURL(value){
  let u;try{u=new URL(String(value||'').trim());}catch{throw Error('请填写音乐服务地址，或选择下方的电脑地址');}
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('服务地址必须是无账号、参数和片段的 HTTP / HTTPS 地址');
  if(u.protocol==='http:'&&!(config.cleartextHosts||[]).includes(u.hostname))throw Error('此 HTTP 地址不在安装包的局域网许可中。请使用 HTTPS，或在电脑上重新打包当前局域网地址');
  return u.href.replace(/\/+$/,'');
 }
 function requireBackend(){const base=localStorage.getItem('uzz.apiBase')||'';if(native()&&!base)throw Error('尚未连接音乐服务：请到“我的 → 播放与连接设置”选择同一 Wi-Fi 的电脑地址，或填写 HTTPS 服务器');return base;}
 function describe(error,kind='cloud'){
  const message=String(error?.message||error||''),prefix=kind==='music'?'音乐服务':'云端账户';
  if(/invalid.login.credentials|invalid_credentials|Invalid login/i.test(message))return '手机号或密码不正确，请确认使用相同的云端账号';
  if(/phone.not.confirmed|Phone not confirmed/i.test(message))return '手机号尚未确认，请检查 Supabase 手机号确认设置';
  if(/Unable to resolve host|UnknownHost|ENOTFOUND|DNS/i.test(message))return prefix+'域名解析失败，请检查手机 DNS、专用 DNS 或更换网络后重试';
  if(/CLEARTEXT/i.test(message))return 'Android 拒绝此 HTTP 地址，请选择包内许可的电脑地址或使用 HTTPS';
  if(/SSL|certificate|CertPath|Trust anchor/i.test(message))return prefix+'的 HTTPS 证书验证失败，请检查手机日期时间和网络；不会跳过证书校验';
  if(/timeout|timed out|AbortError|aborted/i.test(message))return prefix+'连接超时，请检查网络后重试';
  if(/Failed to fetch|fetch failed|NetworkError|network request failed|Failed to connect|ECONNREFUSED|Unable to connect|联网失败|网络连接失败/i.test(message)){
   if(kind==='music'&&/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(localStorage.getItem('uzz.apiBase')||''))return '当前 localhost 指向手机自身。真机请连接电脑同一 Wi-Fi 并选择电脑地址；USB 调试需先建立 ADB reverse';
   return prefix+'连接失败。'+(kind==='music'?'请确认同一 Wi-Fi、电脑后端和局域网端口；外网需 HTTPS 服务':'请使用“网络诊断”单独检查 Supabase，切换 Wi-Fi/移动数据后重试');
  }
  return message||prefix+'请求失败';
 }
 async function cloudFetch(input,init={}){
  const value=typeof input==='string'||input instanceof URL?String(input):input.url;
  const u=new URL(value);
  // 目标校验（v3.1.10 修复）：supabaseOrigin() 带路径不能与 u.origin 直接比对
  //（v3.1.8 的字符串不等导致合法请求被误拦——真机「云端请求目标不匹配」根因）。
  // 正确规则：直连 supabase.co，或「音乐后端 origin + /api/supabase 路径前缀」——
  // 后者凭据只发给自己后端的代理路径，不接受该 origin 下的任意其他路径。
  const proxyOrigin=native()?supabaseOrigin():'';
  const allowed=u.origin===cloudOrigin||(proxyOrigin&&u.origin===new URL(proxyOrigin).origin&&u.pathname.startsWith('/api/supabase/'));
  if(!allowed||u.username||u.password)throw Error('云端请求目标不匹配，已停止发送账户凭据');
  if(!native()||!global.XYNative.CapacitorHttp)return global.fetch(input,init);
  const signal=init.signal||input?.signal;if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  const headers=Object.fromEntries(new Headers(init.headers||input?.headers||{}).entries());
  let data=init.body;if(data!=null&&typeof data!=='string')throw Error('云端原生请求只支持 JSON 数据');
  if(data&&/application\/json/i.test(headers['content-type']||''))data=JSON.parse(data);
  let timer,onAbort;
  const canceled=new Promise((_,reject)=>{onAbort=()=>reject(new DOMException('Aborted','AbortError'));signal?.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>reject(new Error('云端网络连接超时')),20000);});
  try{
   const r=await Promise.race([global.XYNative.CapacitorHttp.request({url:u.href,method:init.method||input?.method||'GET',headers,data,connectTimeout:10000,readTimeout:12000,disableRedirects:true,responseType:'text'}),canceled]);
   const responseHeaders=new Headers(r.headers||{});responseHeaders.delete('content-length');responseHeaders.delete('content-encoding');
   return new Response([204,205,304].includes(r.status)?null:typeof r.data==='string'?r.data:JSON.stringify(r.data),{status:r.status,headers:responseHeaders});
  }catch(error){if(error.name==='AbortError')throw error;throw new TypeError(describe(error));}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
 }
 async function diagnose(){
  const base=localStorage.getItem('uzz.apiBase')||'';
  const results=await Promise.allSettled([
   (async()=>{requireBackend();if(!base)throw Error('未设置音乐服务地址');const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),8000);try{const r=await fetch(base+'/api/health',{signal:ctrl.signal});const json=await r.json();if(!r.ok||json.code!==200)throw Error('地址未返回音乐后端健康接口');return '音乐服务可达';}finally{clearTimeout(timer);}})(),
   (async()=>{const r=await cloudFetch(supabaseOrigin()+'/auth/v1/health',{headers:{apikey:publicKey}});if(!r.ok)throw Error('Supabase HTTP '+r.status);return '云端账户服务可达（'+(supabaseOrigin()===cloudOrigin?'直连':'经后端代理')+'）';})()
  ]);
  return{backend:base,music:{ok:results[0].status==='fulfilled',message:results[0].status==='fulfilled'?results[0].value:describe(results[0].reason,'music')},cloud:{ok:results[1].status==='fulfilled',message:results[1].status==='fulfilled'?results[1].value:describe(results[1].reason)}};
 }
 const ready=(async()=>{if(!native())return;let launch={};try{launch=await global.XYNative.NativeMusic.getLaunchConfig();}catch{}
  if(!localStorage.getItem('uzz.apiBase')){const value=config.defaultBackend||launch.developmentBackend;if(value)localStorage.setItem('uzz.apiBase',backendURL(value));}
 })();
 global.XYNetwork={config,ready,backendURL,requireBackend,describe,cloudFetch,diagnose,supabaseOrigin};
})(window);
