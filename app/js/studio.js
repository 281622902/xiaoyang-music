(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let session = null, revision = 0, mode = 'login';
  try { session = JSON.parse(sessionStorage.getItem('xy.session') || 'null'); } catch {}
  const status = text => { $('accountStatus').textContent = text; };
  function renderAccount() {
    const logged=!!session;
    $('accountGuest').classList.toggle('hidden',logged);$('accountMember').classList.toggle('hidden',!logged);
    $('accountLabel').textContent=window.XYCloud?.user ? window.XYCloud.displayUser(window.XYCloud.user) : (session?.user.username || '账户与云端');
    $('accountName').textContent=session?.user.username || '';
  }
  async function account(action,method='GET',data) {
    const base=localStorage.getItem('xy.accountBase')||'';
    const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),15000);
    try {
      const response=await fetch(new URL(base+'/api/account/'+action,location.origin),{
        method,headers:{'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.token}:{})},
        body:data?JSON.stringify(data):undefined,signal:ctrl.signal,
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.msg||'账户操作失败');
      return result;
    }finally{clearTimeout(timer);}
  }
  function snapshot() {
    const read=(key,def)=>{try{return JSON.parse(localStorage.getItem(key)||'null')||def;}catch{return def;}};
    const settings={};for(const key of ['uzz.theme.mode','uzz.theme.accent','uzz.theme.skin','uzz.quality','uzz.volume','uzz.play.fade','uzz.play.normalize'])if(localStorage.getItem(key)!==null)settings[key]=localStorage.getItem(key);
    return {favorites:read('uzz.fav',[]),playlists:read('uzz.playlists',[]),settings};
  }
  function mergeTracks(a,b) { return [...new Map([...a,...b].filter(x=>x?.id).map(t=>[t.vendor+'|'+t.id,t])).values()]; }
  function restore(state) {
    const old=snapshot();localStorage.setItem('xy.beforeRestore',JSON.stringify({at:Date.now(),...old}));
    localStorage.setItem('uzz.fav',JSON.stringify(mergeTracks(old.favorites,state.favorites||[])));
    const playlists=new Map(old.playlists.map(p=>[p.id,p]));
    for(const p of state.playlists||[]) {const current=playlists.get(p.id);playlists.set(p.id,current?{...current,tracks:mergeTracks(current.tracks||[],p.tracks||[])}:p);}
    localStorage.setItem('uzz.playlists',JSON.stringify([...playlists.values()]));
    for(const [key,value]of Object.entries(state.settings||{}))localStorage.setItem(key,value);
    document.dispatchEvent(new CustomEvent('xy:libraryRestore'));
  }
  async function importResult(result) {
    $('dropOverlay').classList.add('hidden');
    if(result.tracks?.length){await Player.playQueue(result.tracks);document.dispatchEvent(new CustomEvent('uzz:view',{detail:'local'}));toast('已添加 '+result.tracks.length+' 首'+(result.errors?.length?'，另有 '+result.errors.length+' 项未导入':''));}
    else toast(result.errors?.[0]||'没有找到可播放的音频文件');
  }
  function toast(text){const el=$('toast');el.textContent=text;el.classList.remove('hidden');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.add('hidden'),3500);}
  document.addEventListener('DOMContentLoaded',()=>{
    renderAccount();
    $('accountOpen').addEventListener('click',()=>{$('accountModal').classList.remove('hidden');status('');if(!window.XYCloud?.user)$('cloudPhone')?.focus();});
    const close=()=>{$('accountModal').classList.add('hidden');$('accountOpen').focus();};
    $('accountClose').addEventListener('click',close);$('accountModal').addEventListener('click',e=>{if(e.target===$('accountModal'))close();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
    function setMode(value){mode=value;$('accountLoginTab').classList.toggle('active',value==='login');$('accountRegisterTab').classList.toggle('active',value==='register');$('accountSubmit').textContent=value==='login'?'登录':'注册并登录';$('accountPassword').autocomplete=value==='login'?'current-password':'new-password';status('');}
    $('accountLoginTab').onclick=()=>setMode('login');$('accountRegisterTab').onclick=()=>setMode('register');
    $('accountForm').addEventListener('submit',async e=>{
      e.preventDefault();$('accountSubmit').disabled=true;status('正在处理…');
      try {const result=await account(mode,'POST',{username:$('accountUsername').value,password:$('accountPassword').value});session={token:result.token,user:result.user};revision=result.revision;sessionStorage.setItem('xy.session',JSON.stringify(session));$('accountPassword').value='';renderAccount();status('已登录本机账户，尚未连接云端服务');}
      catch(error){status(error.message);}finally{$('accountSubmit').disabled=false;}
    });
    $('accountLogout').onclick=async()=>{try{await account('logout','POST',{});}catch{}session=null;sessionStorage.removeItem('xy.session');renderAccount();status('已退出，本机音乐库仍然保留');};
    $('accountBackup').onclick=async()=>{
      $('accountBackup').disabled=true;
      try{const latest=await account('state');revision=latest.revision;const result=await account('state','PUT',{revision,state:snapshot()});revision=result.revision;status('已备份到本机账户 · '+new Date(result.updatedAt).toLocaleString());}
      catch(error){status(error.message);}finally{$('accountBackup').disabled=false;}
    };
    $('accountRestore').onclick=async()=>{try{const result=await account('state');restore(result.state);revision=result.revision;status('已合并账户备份，保留原有本机收藏和歌单');}catch(error){status(error.message);}};
    if(session)account('me').then(r=>{revision=r.revision;session.user=r.user;renderAccount();}).catch(()=>{session=null;sessionStorage.removeItem('xy.session');renderAccount();});
    let dragDepth=0;
    document.addEventListener('dragenter',e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();dragDepth++;$('dropOverlay').classList.remove('hidden');}});
    document.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault();});
    document.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;$('dropOverlay').classList.add('hidden');}});
    document.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('dropOverlay').classList.add('hidden');if(!window.uzzBridge)toast('请在桌面版拖入文件，或从本地音乐页添加');});
    window.uzzBridge?.onDropResult?.(result=>importResult(result));
    $('heroImport').onclick=async()=>{if(!window.uzzBridge?.importFiles)return toast('请在桌面版导入本地文件');const paths=await window.uzzBridge.pickFiles();if(paths?.length){toast('正在读取音乐…');try{await importResult(await window.uzzBridge.importFiles(paths));}catch(error){toast(error.message);}}};
    $('heroContinue').onclick=()=>{const list=Player.getHistory();if(list.length)Player.playQueue(list);else document.dispatchEvent(new CustomEvent('uzz:view',{detail:'local'}));};
    document.querySelector('.side-mine [data-view="local"]')?.classList.remove('mi-extra');
    const symbols=['⌂','◈','◉','≈','◎'];document.querySelectorAll('#sideNav .nav-ic').forEach((el,i)=>el.textContent=symbols[i]||'◇');
  });
  window.XYStudio={account,snapshot,restore,importResult};
})();
