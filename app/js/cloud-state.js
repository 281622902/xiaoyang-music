/* Optional, explicit merge sync. Audio files, device URIs, API addresses and credentials never enter payloads. */
(function(global){
 'use strict';
 const vendors=new Set(['netease','tencent','kugou','kuwo']);
 const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
 const text=(value,max=200)=>String(value??'').slice(0,max);
 const remoteImage=value=>{try{const u=new URL(value);if(!/^https?:$/.test(u.protocol)||u.username||u.password||/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[|0\.)/.test(u.hostname))return '';return text(u.href,2000);}catch{return '';}};
 function tracks(input){const seen=new Set();return (Array.isArray(input)?input:[]).filter(t=>t&&vendors.has(t.vendor)&&String(t.id||'').length>0&&String(t.id).length<100).filter(t=>{const key=t.vendor+'|'+t.id;if(seen.has(key))return false;seen.add(key);return true;}).slice(0,5000).map(t=>({id:text(t.id,100),vendor:t.vendor,name:text(t.name),artist:text(t.artist),album:text(t.album),pic:remoteImage(t.pic),duration:Math.max(0,Number(t.duration)||0)}));}
 function clean(input={}){return {schema:1,playlists:(Array.isArray(input.playlists)?input.playlists:[]).filter(p=>p&&p.id).slice(0,300).map(p=>({id:text(p.id,100),name:text(p.name,100),kind:p.kind==='collected'?'collected':'created',cover:remoteImage(p.cover),createdAt:Number(p.createdAt)||0,metadataUpdatedAt:Math.max(0,Number(p.metadataUpdatedAt)||0),tracks:tracks(p.tracks)})),favorites:tracks(input.favorites),preferences:{quality:['standard','ex','lossless','hires'].includes(input.preferences?.quality)?input.preferences.quality:'standard'}};}
 function local(){return clean({playlists:read('uzz.playlists',[]),favorites:read('uzz.fav',[]),preferences:{quality:localStorage.getItem('uzz.quality')||'standard'}});}
 function stampPlaylists(input){const previous=new Map(read('uzz.playlists',[]).map(p=>[p.id,p]));for(const p of input){const old=previous.get(p.id);if(!old||['name','cover','kind'].some(k=>(old[k]||'')!==(p[k]||'')))p.metadataUpdatedAt=Math.max(Date.now(),(Number(old?.metadataUpdatedAt)||0)+1);}return input;}
 function newerMetadata(a,b){if(a.metadataUpdatedAt!==b.metadataUpdatedAt)return a.metadataUpdatedAt>b.metadataUpdatedAt?a:b;return JSON.stringify([a.name,a.cover,a.kind])>=JSON.stringify([b.name,b.cover,b.kind])?a:b;}
 function merge(left,right){left=clean(left);right=clean(right);const map=new Map(left.playlists.map(p=>[p.id,p]));for(const p of right.playlists){const old=map.get(p.id);map.set(p.id,old?{...newerMetadata(old,p),tracks:tracks([...old.tracks,...p.tracks])}:p);}return clean({playlists:[...map.values()],favorites:tracks([...left.favorites,...right.favorites]),preferences:right.preferences});}
 async function user(){if(!global.XYCloud?.available)throw Error('云端账户暂不可用');const {data,error}=await global.supabase.auth.getUser();if(error||!data.user)throw Error('请先登录云端账户');return data.user.id;}
 async function guard(id){if(await user()!==id)throw Error('账户已切换，本次同步已取消');}
 // v3.6.1：以前把「表/函数不存在」笼统说成「服务尚未启用」，用户会误以为
 // 整个云端功能坏了；网络超时也会被吞成「同步失败」。这里按错误类型给
 // 可操作的提示，尤其是明确告诉用户要执行哪个 SQL 文件。
 function message(error){
  const code=String(error?.code||''),msg=String(error?.message||'');
  if(['42P01','PGRST202','PGRST205'].includes(code))
   return Error('云端同步表未初始化：请在 Supabase SQL Editor 执行项目里的 supabase/music_state.sql（本机歌单不受影响）');
  if(code==='42501'||/permission denied/i.test(msg))
   return Error('请先登录云端账户，再同步歌单');
  if(/timeout|abort|fetch|network|connection|502/i.test(msg)||error?.error==='connection_reset')
   return Error('云端连接超时，请稍后重试');
  return Error(msg||'同步失败，请检查网络');
 }
 async function fetchState(id){const {data,error}=await global.supabase.from('user_music_state').select('payload,revision').eq('user_id',id).maybeSingle();if(error)throw message(error);return data||{payload:{},revision:0};}
 async function preview(){const id=await user(),remote=await fetchState(id);await guard(id);const a=local(),b=clean(remote.payload);return {localPlaylists:a.playlists.length,cloudPlaylists:b.playlists.length,cloudFavorites:b.favorites.length,revision:remote.revision};}
 async function push(){const id=await user();for(let attempt=0;attempt<3;attempt++){const remote=await fetchState(id);await guard(id);const payload=merge(remote.payload,local());if(JSON.stringify(payload).length>1800000)throw Error('歌单数据较多，请减少后重试');const {error}=await global.supabase.rpc('save_music_state',{expected_user:id,expected_revision:remote.revision,new_payload:payload});if(error){if(String(error.message).includes('music_state_conflict'))continue;throw message(error);}await guard(id);return {playlists:payload.playlists.length,favorites:payload.favorites.length};}throw Error('其他设备正在同步，请稍后重试');}
 async function pull(){const id=await user(),remote=await fetchState(id);await guard(id);if(!remote.revision)throw Error('云端还没有歌单，请先从任一设备上传');const payload=merge(local(),remote.payload);
  // Preserve device-only music and local playlist entries. Pull is an additive merge, not a destructive restore.
  const existing=read('uzz.playlists',[]),map=new Map(existing.map(p=>[p.id,p]));for(const p of payload.playlists){const old=map.get(p.id);if(old){const portableIds=new Set(p.tracks.map(t=>t.vendor+'|'+t.id));map.set(p.id,{...old,...p,tracks:[...p.tracks,...(old.tracks||[]).filter(t=>!portableIds.has(t.vendor+'|'+t.id))]});}else map.set(p.id,p);}
  const likes=read('uzz.fav',[]),keys=new Set(likes.map(t=>t.vendor+'|'+t.id));for(const t of payload.favorites)if(!keys.has(t.vendor+'|'+t.id))likes.push(t);
  localStorage.setItem('uzz.playlists',JSON.stringify([...map.values()]));localStorage.setItem('uzz.fav',JSON.stringify(likes));localStorage.setItem('uzz.quality',payload.preferences.quality);
  global.Player?.reloadLibrary();document.dispatchEvent(new CustomEvent('xy:libraryRestore'));return {playlists:map.size,favorites:likes.length};
 }
 global.XYSync={preview,push,pull,clean,merge,stampPlaylists};
})(window);
