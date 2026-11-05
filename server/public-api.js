const {isIP}=require('node:net');
const defaults=['163.com','126.net','qq.com','gtimg.cn','gtimg.com','kugou.com','kuwo.cn','kuwo.com','api.injahow.cn','api.qijieya.cn','music-api.gdstudio.xyz'];
const paths=new Set(['health','search','song','url','lyric','wiki','simi','suggest','playlist','playlists','charts','artist','album','pic','stream','version','release-file'].map(x=>'/api/'+x));
function mediaURL(value,env=process.env){
 const u=new URL(String(value));
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.hash||u.port&&!['80','443'].includes(u.port)||isIP(u.hostname)||u.hostname.startsWith('['))throw Error('公网服务不代理该地址');
 const extra=(env.XY_MEDIA_DOMAINS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
 if(extra.some(host=>!host.includes('.')||isIP(host)||!/^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/.test(host)||host.endsWith('.local')||host.endsWith('.localhost')))throw Error('XY_MEDIA_DOMAINS 配置无效');
 const allowed=[...defaults,...extra].some(host=>u.hostname===host||u.hostname.endsWith('.'+host));
 if(!allowed)throw Error('该音源域名尚未加入公网代理许可');return u;
}
async function publicFetch(input,options,fetchImpl){
 let url=mediaURL(input),opts={...options,redirect:'manual'};
 for(let redirects=0;redirects<=4;redirects++){
  const response=await fetchImpl(url.href,opts);
  if(![301,302,303,307,308].includes(response.status)||!response.headers.get('location'))return response;
  let next;try{next=mediaURL(new URL(response.headers.get('location'),url));}finally{await response.body?.cancel();}
  if(redirects===4)throw Error('音源重定向次数过多');
  const headers=new Headers(opts.headers||{});
  if(next.origin!==url.origin){headers.delete('authorization');headers.delete('cookie');}
  if(response.status===303&&opts.method!=='HEAD'||[301,302].includes(response.status)&&opts.method==='POST'){opts.method='GET';delete opts.body;headers.delete('content-type');headers.delete('content-length');}
  opts.headers=headers;url=next;
 }
}
function createGate(env=process.env){
 const buckets=new Map();let active=0;
 const rpm=Math.max(30,Math.min(6000,Number(env.XY_PUBLIC_RPM)||240));
 const respond=(res,code,msg)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Cache-Control':'no-store'});res.end(JSON.stringify({code,msg}));return false;};
 return(req,res,url)=>{
  if(!paths.has(url.pathname)&&!url.pathname.startsWith('/api/version/')&&!url.pathname.startsWith('/api/supabase/'))return respond(res,404,'公网服务仅提供在线音乐 API');
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!url.pathname.startsWith('/api/supabase/'))return respond(res,405,'公网音乐 API 不接受写入请求');
  if(url.href.length>8192)return respond(res,414,'请求地址过长');
  if(['/api/stream','/api/pic'].includes(url.pathname)){try{mediaURL(url.searchParams.get('url'),env);}catch(e){return respond(res,403,e.message);}}
  if(url.pathname==='/api/health'||req.method==='OPTIONS')return true;
  const now=Date.now();for(const [key,value]of buckets)if(value.expires<=now)buckets.delete(key);
  const peer=req.socket.remoteAddress||'unknown';let bucket=buckets.get(peer);
  if(!bucket){if(buckets.size>=2048)return respond(res,429,'服务繁忙，请稍后重试');bucket={count:0,expires:now+60000};buckets.set(peer,bucket);}
  if(++bucket.count>rpm)return respond(res,429,'请求过于频繁，请稍后重试');
  if(['/api/stream','/api/pic'].includes(url.pathname)){
   if(active>=24)return respond(res,503,'媒体连接较多，请稍后重试');active++;
   let released=false;const release=()=>{if(!released){released=true;active--;}};res.once('close',release);res.once('finish',release);
  }
  return true;
 };
}
module.exports={createGate,mediaURL,publicFetch};
