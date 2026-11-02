const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const attempts = new Map();
let writes = Promise.resolve();
const SESSION_MS = 7 * 86400000;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const file = () => path.join(process.env.UZZ_USER_DATA || path.join(__dirname,'.localdata'), 'accounts', 'accounts.json');
function read() {
  try { const value = JSON.parse(fs.readFileSync(file(),'utf8')); if (!Array.isArray(value.users)) throw Error('Invalid account database'); return value; }
  catch (e) { if (e.code === 'ENOENT') return { version:1,users:[],sessions:[] }; throw Error('账户数据库无法读取，请从备份恢复'); }
}
function save(db) {
  const fp=file(); fs.mkdirSync(path.dirname(fp),{recursive:true});
  if(fs.existsSync(fp)) fs.copyFileSync(fp,fp+'.bak');
  fs.writeFileSync(fp+'.tmp',JSON.stringify(db),{mode:0o600});fs.renameSync(fp+'.tmp',fp);
}
function serial(fn) { const next=writes.then(fn,fn);writes=next.catch(()=>{});return next; }
async function body(req,limit=2*1024*1024) {
  const chunks=[];let size=0;
  const timer=setTimeout(()=>req.destroy(),12000);
  try { for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(Error('请求内容过大'),{status:413});chunks.push(chunk);} }
  finally { clearTimeout(timer); }
  try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw Object.assign(Error('请求格式不正确'),{status:400});}
}
function cleanTrack(t) {
  if (!t || t.vendor === 'local' || !t.id) return null;
  const out={};for(const key of ['id','vendor','name','artist','album','pic','duration','artistId','albumId']) {
    if(typeof t[key]==='string')out[key]=t[key].slice(0,2048);
    else if(typeof t[key]==='number'&&Number.isFinite(t[key]))out[key]=t[key];
  }
  return out;
}
function sanitizeState(state={}) {
  if(!state||typeof state!=='object')state={};
  const tracks=list=>(Array.isArray(list)?list:[]).slice(0,5000).map(cleanTrack).filter(Boolean);
  const settings={};for(const key of ['uzz.theme.mode','uzz.theme.accent','uzz.theme.skin','uzz.quality','uzz.volume','uzz.play.fade','uzz.play.normalize']) {
    if(typeof state.settings?.[key]==='string')settings[key]=state.settings[key].slice(0,100);
  }
  return { favorites:tracks(state.favorites), playlists:(Array.isArray(state.playlists)?state.playlists:[]).slice(0,200).map(p=>({id:String(p.id||crypto.randomUUID()).slice(0,100),name:String(p.name||'歌单').slice(0,100),tracks:tracks(p.tracks)})), settings };
}
function permitted(req) {
  const peer=req.socket.remoteAddress;const local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer);
  if(!local&&process.env.UZZ_ACCOUNT_REMOTE!=='1')return false;
  const origin=req.headers.origin;const allowed=(process.env.UZZ_ACCOUNT_ORIGINS||'').split(',').filter(Boolean);
  const trusted=!!origin&&(origin==='http://'+req.headers.host||origin===process.env.UZZ_RENDERER_ORIGIN||allowed.includes(origin));
  return (!origin||trusted)&&!(req.headers['sec-fetch-site']==='cross-site'&&!trusted);
}
function publicUser(user){return {id:user.id,username:user.username,createdAt:user.createdAt};}
async function handle(req,res,url) {
  const respond=(status,data)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...(req.headers.origin?{'Access-Control-Allow-Origin':req.headers.origin,'Vary':'Origin'}:{})});res.end(JSON.stringify({code:status,...data}));};
  if(!permitted(req))return respond(403,{msg:'此账户服务不允许当前来源访问'});
  const action=url.pathname.slice('/api/account/'.length);
  try {
    if(['register','login'].includes(action)){
      if(req.method!=='POST')return respond(405,{msg:'请使用 POST'});
      const data=await body(req,16384);const username=String(data.username||'').trim();const password=data.password;
      if(!/^[\p{L}\p{N}_-]{2,24}$/u.test(username)||typeof password!=='string'||password.length<8||password.length>128)return respond(400,{msg:'用户名需 2–24 个字母、数字或汉字；密码需 8–128 位'});
      const key=req.socket.remoteAddress;const now=Date.now();let rate=attempts.get(key);
      if(!rate||now-rate.at>900000){rate={at:now,count:0};attempts.set(key,rate);}
      if(rate.count>=20)return respond(429,{msg:'尝试次数过多，请稍后重试'});
      rate.count++;
      return await serial(async()=>{
        const db=read();let user=db.users.find(u=>u.username.toLocaleLowerCase()===username.toLocaleLowerCase());
        if(action==='register'){
          if(user)return respond(409,{msg:'用户名已存在'});
          const salt=crypto.randomBytes(16).toString('hex');const hash=(await scrypt(password,salt,64)).toString('hex');
          user={id:crypto.randomUUID(),username,salt,hash,createdAt:new Date().toISOString(),revision:0,state:sanitizeState()};db.users.push(user);
        }else{
          const candidate=await scrypt(password,user?.salt||'invalid-user-salt',64);
          if(!user||!crypto.timingSafeEqual(candidate,Buffer.from(user.hash,'hex')))return respond(401,{msg:'用户名或密码不正确'});
        }
        const token=crypto.randomBytes(32).toString('hex');db.sessions=(db.sessions||[]).filter(s=>s.expiresAt>now).slice(-2000);db.sessions.push({hash:digest(token),userId:user.id,expiresAt:now+SESSION_MS});save(db);attempts.delete(key);
        respond(200,{user:publicUser(user),token,expiresAt:now+SESSION_MS,revision:user.revision});
      });
    }
    const token=(req.headers.authorization||'').replace(/^Bearer /,'');
    if(!/^[a-f0-9]{64}$/.test(token))return respond(401,{msg:'请先登录'});
    return await serial(async()=>{
      const db=read();const session=(db.sessions||[]).find(s=>s.hash===digest(token)&&s.expiresAt>Date.now());const user=session&&db.users.find(u=>u.id===session.userId);
      if(!user)return respond(401,{msg:'登录已过期，请重新登录'});
      if(action==='me'&&req.method==='GET')return respond(200,{user:publicUser(user),revision:user.revision});
      if(action==='logout'&&req.method==='POST'){db.sessions=db.sessions.filter(s=>s!==session);save(db);return respond(200,{msg:'已退出登录'});}
      if(action==='state'&&req.method==='GET')return respond(200,{state:user.state,revision:user.revision,updatedAt:user.updatedAt||null});
      if(action==='state'&&req.method==='PUT'){
        const data=await body(req);if(data.revision!==user.revision)return respond(409,{msg:'账户数据已变化，请先读取最新版本',revision:user.revision});
        user.state=sanitizeState(data.state);user.revision++;user.updatedAt=new Date().toISOString();save(db);return respond(200,{revision:user.revision,updatedAt:user.updatedAt});
      }
      respond(404,{msg:'未知账户操作'});
    });
  }catch(error){respond(error.status||500,{msg:error.status?error.message:'账户操作失败，请检查本机数据目录'});}
}
module.exports={handle,sanitizeState};
