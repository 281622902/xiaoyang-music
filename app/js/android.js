/* Android presentation layer. Playback, HTTP API and Supabase functions are shared with desktop. */
(function (global) {
  'use strict';
  // 封面加载失败兜底（2026-11-05）：安卓直连图床/qijieya 图片接口失败时，
  // 自动换音乐后端 /api/pic 代理重试一次（error 事件不冒泡，用捕获阶段全局接）。
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || img.dataset.fbf) return;
    const src = img.getAttribute('src') || '';
    if (!/^https?:\/\//i.test(src) || src.includes('/api/pic')) return;
    const base = localStorage.getItem('uzz.apiBase') || '';
    if (!base) return;
    img.dataset.fbf = '1';
    img.src = base.replace(/\/+$/, '') + '/api/pic?url=' + encodeURIComponent(src);
  }, true);
  const $ = id => document.getElementById(id), audio = global.XYAudio || $('audio');
  const icons = {
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    discover:'<circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5z"/>',
    library:'<rect x="4" y="4" width="13" height="16" rx="2"/><path d="M20 6v14M8 9h5M8 13h5"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
    play:'<path d="m9 5 11 7-11 7z" fill="currentColor" stroke="none"/>',
    pause:'<path d="M8 5v14M16 5v14" stroke-width="4"/>',
    prev:'<path d="M5 5v14M19 5 8 12l11 7z"/>',next:'<path d="M19 5v14M5 5l11 7-11 7z"/>',
    queue:'<path d="M4 5h16M4 11h16M4 17h9m4-1 4 3-4 3z"/>',
    repeat:'<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3"/>',
    random:'<path d="m17 3 4 0 0 4M3 21 21 3M3 3l6 6m6 6 6 6m-4 0h4v-4"/>',
    more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    back:'<path d="m14 5-7 7 7 7"/>',chevron:'<path d="m9 5 7 7-7 7"/>',down:'<path d="m5 9 7 7 7-7"/>',
    arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',plus:'<path d="M12 4v16M4 12h16"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',spark:'<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/>',
    chart:'<path d="M5 20V10m7 10V4m7 16v-7"/>',moon:'<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z"/>',
    settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--surface)"/><circle cx="16" cy="17" r="3" fill="var(--surface)"/>',
    download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>'
  };
  const icon = name => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (icons[name] || icons.library) + '</svg>';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const keyOf = track => track.vendor + '|' + track.id;
  const cover = value => { if (!value || value==='icon.svg') return 'icon.svg'; try { const u = new URL(value, location.href); if (!/^https?:$/.test(u.protocol)) return 'icon.svg'; /* 安卓直连图床（国内 4G 直连快），不经海外后端 /api/pic 转图 */ return XYNative.isAndroid ? u.href : UzzApi.picProxy(u.href); } catch { return 'icon.svg'; } };
  const fmt = n => { n = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0; return Math.floor(n / 60) + ':' + String(n % 60).padStart(2,'0'); };
  const modes = {list:'列表循环',single:'单曲循环',random:'随机播放',sequential:'顺序播放'};
  const trackSets = new Map();
  let route = 'discover', previousRoute = 'discover', libraryTab = 'playlists', detail = null;
  let playlists = read('uzz.playlists', []), searchHistory = read('uzz.searchHistory', []);
  let localTracks = read('xy.android.localTracks', []);
  let searchType = 'song', searchKeyword = '', searchPage = 1, searchRows = [], searchGeneration = 0, searchAbort;
  let detailGeneration = 0, discoveryGeneration = 0, cloudGeneration = 0, authGeneration = 0, heart;
  let cloudRows = [], authMode = 'login', selectedTrack = null, lastFocus = null, sheetFocus = null, lastBack = 0;
  function toast(text) { $('toast').textContent = text; $('toast').classList.toggle('hidden', !text); clearTimeout(toast.timer); if (text) toast.timer=setTimeout(()=>$('toast').classList.add('hidden'),3500); }
  function hydrate(root = document) { root.querySelectorAll('[data-icon]').forEach(e=>{e.innerHTML=icon(e.dataset.icon);}); }
  function empty(text) { return '<div class="empty-state">'+escape(text)+'</div>'; }
  function failure(text, action) { return '<div class="error-state">'+escape(text)+(action?'<button data-action="'+action+'">重新加载</button>':'')+'</div>'; }
  function tracksHtml(tracks, scope) {
    trackSets.set(scope, tracks);
    if (!tracks.length) return '<li class="empty-state">还没有歌曲，去发现一些喜欢的音乐吧。</li>';
    const current = Player.getState().current;
    return tracks.map((t,i)=>'<li class="track-row '+(current && keyOf(t)===keyOf(current)?'playing':'')+'"><button class="track-main" data-track-list="'+scope+'" data-track-index="'+i+'"><img loading="lazy" src="'+escape(cover(t.pic))+'" alt=""><span><strong>'+escape(t.name || '未知歌曲')+'</strong><small>'+escape([t.artist,t.album].filter(Boolean).join(' · '))+'</small></span></button><button class="round-button" data-track-menu="'+scope+'" data-track-index="'+i+'" aria-label="'+escape((t.name || '歌曲')+'的更多操作')+'">'+icon('more')+'</button></li>').join('');
  }
  function sheet(title, html) {
    sheetFocus = document.activeElement; $('sheetTitle').textContent=title; $('sheetContent').innerHTML=html; hydrate($('sheetContent')); $('sheetBackdrop').hidden=false; $('mobileSheet').focus();
  }
  function closeSheet() { $('sheetBackdrop').hidden=true; sheetFocus?.focus?.(); }
  function closeAccount() { $('accountBackdrop').hidden=true; $('mobilePassword').value=''; lastFocus?.focus?.(); }
  function openAccount() { lastFocus=document.activeElement; $('accountBackdrop').hidden=false; $('mobileAuthStatus').textContent=XYCloud.error || ''; renderAuth(); $('mobileLoginTitle').tabIndex=-1; $('mobileLoginTitle').focus(); }
  function showPlayer() { if (!Player.getState().current) return toast('先选择一首喜欢的歌曲'); $('mobilePlayer').hidden=false; $('mobileSongName').tabIndex=-1; $('mobileSongName').focus({preventScroll:true}); }
  function closePlayer() { $('mobilePlayer').hidden=true; }
  function showRoute(value) {
    value=['discover','search','library','me','settings','detail'].includes(value)?value:'discover';
    if (value==='detail' && !detail) value='library';
    route=value;
    document.querySelectorAll('.m-page').forEach(e=>{e.hidden=e.id!=='page-'+route;});
    document.querySelectorAll('.bottom-nav button').forEach(e=>{const active=e.dataset.nav===(route==='detail'?'library':route);e.classList.toggle('active',active);if(active)e.setAttribute('aria-current','page');else e.removeAttribute('aria-current');});
    $('mobileMain').scrollTop=0;
    if(route==='library') renderLibrary();
    if(route==='me') renderCounts();
    if(route==='search') renderSearchWelcome();
  }
  function navigate(value) { if(value!==route) { previousRoute=route==='detail'?previousRoute:route; location.hash=value; } else showRoute(value); }
  function savePlaylists() { global.XYSync?.stampPlaylists(playlists); save('uzz.playlists',playlists); renderCounts(); if(route==='library')renderLibrary(); }
  function renderCounts() { $('favCount').textContent=Player.getFavorites().length; $('historyCount').textContent=Player.getHistory().length; $('playlistCount').textContent=playlists.length; }
  function renderSearchWelcome() {
    $('searchHistory').innerHTML=searchHistory.length?searchHistory.slice(0,10).map(t=>'<button data-query="'+escape(t)+'">'+escape(t)+'</button>').join(''): '<span class="muted">最近搜索会出现在这里</span>';
  }
  async function loadHot() {
    try { const r=await UzzApi.suggest(''); $('hotSearches').innerHTML=r.hot.slice(0,12).map((t,i)=>{const name=typeof t==='string'?t:(t.searchWord||t.name||t.keyword||'');return '<button data-query="'+escape(name)+'"><b>'+String(i+1).padStart(2,'0')+'</b>'+escape(name)+'</button>';}).join('') || empty('输入关键词，发现你想听的音乐'); }
    catch { $('hotSearches').innerHTML=empty('热搜暂时不可用，你仍可直接输入关键词搜索。'); }
  }
  async function search(more=false) {
    const keyword=$('mobileSearchInput').value.trim(); if(!keyword)return;
    searchAbort?.abort(); searchAbort=new AbortController(); const ticket=++searchGeneration;
    if(!more || keyword!==searchKeyword){searchPage=1;searchRows=[];}else searchPage++;
    searchKeyword=keyword; searchHistory=[keyword,...searchHistory.filter(s=>s!==keyword)].slice(0,20); save('uzz.searchHistory',searchHistory);
    $('searchWelcome').hidden=true; $('searchResults').hidden=false; $('searchSummary').textContent='正在寻找好声音…'; $('searchMore').hidden=true;
    if(!more)$('mobileResults').innerHTML='';
    try {
      const r=await UzzApi.search(keyword,searchType,searchPage,20,searchAbort.signal); if(ticket!==searchGeneration)return;
      searchRows=more?[...searchRows,...r.list]:r.list;
      $('searchSummary').textContent=r.total?'找到 '+r.total+' 个结果':'暂未找到结果，试试其他关键词或音源';
      $('mobileResults').innerHTML=tracksHtml(searchRows,'search'); $('searchMore').hidden=r.list.length<20||searchRows.length>=r.total;
    } catch(e) {if(ticket!==searchGeneration)return; if(more)searchPage--; $('searchSummary').textContent='搜索失败：'+e.message; if(!more)$('mobileResults').innerHTML='<li>'+failure('检查网络后重试。','retrySearch')+'</li>';else $('searchMore').hidden=false;}
  }
  async function loadDiscover() {
    const ticket=++discoveryGeneration; $('refreshDiscover').disabled=true;
    const cached=read('xy.android.discovery',null); if(cached)paintDiscover(cached);
    else { $('recommendations').innerHTML=empty('正在准备你的音乐首页…'); $('chartCards').innerHTML=''; }
    const results=await Promise.allSettled([UzzApi.getPlaylists('全部',12),UzzApi.getCharts()]); if(ticket!==discoveryGeneration)return;
    const data={playlists:results[0].status==='fulfilled'?results[0].value:cached?.playlists || [],charts:results[1].status==='fulfilled'?results[1].value:cached?.charts || []};
    paintDiscover(data); if(data.playlists.length||data.charts.length)save('xy.android.discovery',data);
    if(results[0].status==='rejected'&&!data.playlists.length)$('recommendations').innerHTML=failure(results[0].reason.message,'settings');
    $('refreshDiscover').disabled=false;
  }
  function paintDiscover(data) {
    $('recommendations').innerHTML=data.playlists.slice(0,8).map(p=>'<button class="cover-card" data-online="'+escape(p.id)+'" data-title="'+escape(p.name)+'"><div class="cover-art"><img loading="lazy" src="'+escape(cover(p.cover||p.pic||p.picUrl))+'" alt=""><span class="cover-count">▷ '+(Number(p.playCount)>10000?Math.floor(p.playCount/10000)+'万':Number(p.playCount)||'精选')+'</span></div><strong>'+escape(p.name)+'</strong><small>精选歌单 · 发现你的下一首喜欢</small></button>').join('') || empty('暂无推荐，先去搜索喜欢的歌曲吧。');
    $('chartCards').innerHTML=data.charts.slice(0,4).map((p,i)=>'<button class="chart-card" data-online="'+escape(p.id)+'" data-title="'+escape(p.name)+'"><span>TOP '+String(i+1).padStart(2,'0')+'</span><strong>'+escape(p.name)+'</strong><small>'+escape(p.desc)+'</small></button>').join('');
  }
  function paintDetail() {
    if(!detail)return; $('detailTitle').textContent=detail.name; $('detailKind').textContent=detail.localId?'我的歌单':'精选音乐'; $('detailSummary').textContent=detail.tracks.length+' 首歌曲'; $('detailCover').src=cover(detail.cover); $('detailTracks').innerHTML=tracksHtml(detail.tracks,'detail'); $('detailSave').hidden=!!detail.localId||detail.loading; $('detailRename').hidden=!detail.localId; $('detailPlayAll').disabled=!detail.tracks.length; $('detailStatus').textContent=detail.loading?'正在加载歌单…':detail.error||'';
  }
  async function openOnline(id,name,loader) {
    const ticket=++detailGeneration; detail={id,name:name||'歌单',tracks:[],loading:true}; navigate('detail');paintDetail();
    try {const r=await(loader?loader():UzzApi.getPlaylist(id,100));if(ticket!==detailGeneration)return;detail={id,name:r.info?.name||name||'歌单',cover:r.info?.cover||r.info?.pic||r.tracks[0]?.pic,tracks:r.tracks||[],loading:false};paintDetail();}
    catch(e){if(ticket===detailGeneration){detail.loading=false;detail.error='加载失败：'+e.message;paintDetail();}}
  }
  function openLocal(id) {const p=playlists.find(p=>p.id===id);if(!p)return;detailGeneration++;detail={localId:id,name:p.name,cover:p.cover,tracks:p.tracks||[]};navigate('detail');paintDetail();}
  async function openSearchResult(index) {
    const t=searchRows[index];if(!t)return;
    if(searchType==='song')return play(t);
    if(searchType==='artist')return openOnline('artist:'+t.id,t.name,async()=>({info:{name:t.name,cover:t.pic},tracks:await UzzApi.getArtistTop(t.id,100)}));
    if(searchType==='album')return openOnline('album:'+t.id,t.name,()=>UzzApi.getAlbum(t.id));
    return openOnline(t.id,t.name);
  }
  function play(track) { if(!track)return; Player.loadAndPlay(track).catch(e=>toast(e.message)); }
  function renderLibrary() {
    document.querySelectorAll('[data-library]').forEach(e=>e.classList.toggle('active',e.dataset.library===libraryTab));
    if(libraryTab==='playlists') {
      $('libraryContent').innerHTML=playlists.length?playlists.map(p=>'<button class="saved-playlist" data-local-playlist="'+escape(p.id)+'"><img src="'+escape(cover(p.cover||p.tracks?.[0]?.pic))+'" alt=""><span><strong>'+escape(p.name)+'</strong><small>'+(p.tracks?.length||0)+' 首 · '+(p.kind==='collected'?'已保存':'我创建的')+'</small></span></button>').join(''):empty('把喜欢的音乐装进歌单。点右上角 ＋ 创建第一张歌单。');
    } else if(libraryTab==='local') {
      $('libraryContent').innerHTML='<button class="primary wide-button" data-action="importLocal">＋ 选择本机音乐文件</button><p class="muted">音频不上传。无法保存读取授权的文件会复制到应用内部（单个文件最多 256MB），卸载应用会移除副本，原文件仍保留。播放能力取决于文件编码与设备支持。</p>'+(localTracks.some(t=>!t.persistent)?'<p class="muted">部分文件是临时授权；重启后无法播放时，请重新选择文件授权。</p>':'')+'<ul class="track-list">'+tracksHtml(localTracks,'local')+'</ul>';
    } else if(libraryTab==='cloud') {
      if(!XYCloud.user){$('libraryContent').innerHTML=empty('登录后，在这里查看云端收藏。')+'<button class="wide-button" data-action="account">登录云端账户</button>';return;}
      $('libraryContent').innerHTML='<button class="wide-button" data-action="refreshCloud">刷新云端收藏</button><ul id="mobileCloudList" class="track-list">'+tracksHtml(cloudRows,'cloud')+'</ul><p class="muted">云端保存的旧音频链接可能过期；本机歌单会在播放时重新解析地址。</p>';
      if(!cloudRows.length)refreshCloud();
    } else $('libraryContent').innerHTML='<ul class="track-list">'+tracksHtml(libraryTab==='history'?Player.getHistory():Player.getFavorites(),'library')+'</ul>';
    renderCounts();
  }
  async function refreshCloud() {
    if(!XYCloud.user)return;const ticket=++cloudGeneration,authTicket=authGeneration;
    const ul=$('mobileCloudList');if(ul)ul.innerHTML=empty('正在读取云端收藏…');
    try {const rows=await getFavorites();if(ticket!==cloudGeneration||authTicket!==authGeneration)return;cloudRows=rows.map(r=>XYCloud.favoriteToTrack(r)).filter(Boolean);if($('mobileCloudList'))$('mobileCloudList').innerHTML=tracksHtml(cloudRows,'cloud');}
    catch(e){if(ticket===cloudGeneration&&authTicket===authGeneration&&$('mobileCloudList'))$('mobileCloudList').innerHTML='<li>'+failure(e.message,'refreshCloud')+'</li>';}
  }
  function chooseLibrary(value) {libraryTab=value;navigate('library');renderLibrary();}
  function createPlaylist() { sheet('新建歌单','<form id="playlistCreateForm"><label>歌单名称<input id="newPlaylistName" maxlength="60" placeholder="给喜欢的音乐起个名字" required></label><button class="primary wide-button" type="submit">创建歌单</button></form>'); }
  function trackMenu(track,scope) {
    if(!track)return;selectedTrack=track;
    let html='<p class="muted">'+escape(track.artist||'小杨音乐')+'</p><button class="sheet-action" data-action="enqueue"><span data-icon="queue"></span>加入播放队列</button><button class="sheet-action" data-action="addToPlaylist"><span data-icon="plus"></span>添加到歌单</button><button class="sheet-action" data-action="deviceFavorite"><span data-icon="heart"></span>'+(Player.getFavorites().some(t=>keyOf(t)===keyOf(track))?'取消本机喜欢':'保存到本机喜欢')+'</button>';
    if(scope==='detail'&&detail?.localId)html+='<button class="sheet-action" data-action="removeFromPlaylist">从此歌单移除</button>';
    if(scope==='queue')html+='<button class="sheet-action" data-action="removeFromQueue">移出播放队列</button>';
    if(track.cloudUrl)html+='<button class="sheet-action" data-action="removeCloud">取消云端收藏</button>';
    if(track.vendor!=='device'&&/^https?:\/\//i.test(track.url||'')&&XYNative.NativeMusic?.downloadTrack)html+='<button class="sheet-action" data-action="downloadTrack"><span data-icon="queue"></span>下载到本机（离线可播）</button>';
    if(track.vendor==='device')html+='<button class="sheet-action" data-action="removeLocal">从本地列表移除（保留原文件）</button>';
    sheet(track.name,html);
  }
  function addToPlaylist() {sheet('添加到歌单',playlists.length?playlists.map(p=>'<button class="sheet-action" data-add-playlist="'+escape(p.id)+'">'+icon('library')+escape(p.name)+'</button>').join(''):'<p class="empty-state">先创建一张歌单，再添加喜欢的歌曲。</p><button class="wide-button" data-action="createPlaylist">新建歌单</button>');}
  function showQueue() {sheet('播放队列 · '+Player.getQueue().length+' 首','<ul class="track-list">'+tracksHtml(Player.getQueue(),'queue')+'</ul><button class="wide-button" data-action="clearQueue">清空播放队列</button>');}
  function playerChanged(kind) {
    const state=Player.getState(),t=state.current;
    $('mobileMini').hidden=!t;
    if(kind==='openFull')return showPlayer(); if(kind==='closeFull')return closePlayer();
    if(t){$('mobileMiniName').textContent=$('mobileSongName').textContent=t.name||'未知歌曲';$('mobileMiniArtist').textContent=$('mobileSongArtist').textContent=t.artist||'';$('mobileSource').textContent=({netease:'网易云音乐',tencent:'QQ 音乐',kugou:'酷狗音乐',kuwo:'酷我音乐',cloud:'云端收藏'})[t.vendor]||'小杨音乐';
      const image=cover(t.pic);for(const id of ['mobileCover','mobileMiniCover'])if($(id).getAttribute('src')!==image)$(id).src=image;
    } else closePlayer();
    const playing=!audio.paused&&!!audio.currentSrc;
    for(const id of ['mobilePlay','mobileMiniPlay']){$(id).innerHTML=icon(playing?'pause':'play');$(id).setAttribute('aria-label',playing?'暂停':'播放');}
    $('mobileMode').innerHTML=icon(state.mode==='random'?'random':'repeat');$('mobileMode').setAttribute('aria-label',modes[state.mode]);$('mobileMode').title=modes[state.mode];
    if(state.mode==='single')$('mobileMode').innerHTML=icon('repeat')+'<small>1</small>';
    if(kind==='lyrics')renderLyrics();
    renderCounts();
  }
  function renderLyrics(){const lines=Player.getState().lyrics;$('mobileLyrics').innerHTML=lines.length?lines.map((l,i)=>'<button data-lyric-time="'+l.t+'" data-lyric-index="'+i+'">'+escape(l.text)+'</button>').join(''):empty('暂无歌词，享受这一刻的旋律。');}
  let lyricIndex=-1;
  function progress() {const d=Number.isFinite(audio.duration)?audio.duration:0,c=audio.currentTime||0;$('mobileTime').textContent=fmt(c);$('mobileDuration').textContent=fmt(d);if(document.activeElement!==$('mobileSeek'))$('mobileSeek').value=d?Math.round(c/d*1000):0;$('miniProgress').value=d?c/d*1000:0;const lyrics=Player.getState().lyrics;let index=-1;for(let i=0;i<lyrics.length;i++){if(lyrics[i].t<=c+.15)index=i;else break;}if(index!==lyricIndex){lyricIndex=index;$('mobileLyrics').querySelectorAll('[data-lyric-index]').forEach(e=>{e.classList.toggle('active',Number(e.dataset.lyricIndex)===index);});if(!$('mobileLyrics').hidden)$('mobileLyrics').querySelector('.active')?.scrollIntoView({block:'center',behavior:'smooth'});}}
  function syncHeart() {const t=Player.getState().current;XYCloud.currentSong=t?{name:t.name,url:/^https?:\/\//i.test(t.url||'')?t.url:'',unavailableMessage:t.vendor==='device'?'本地音乐不上传，可在更多菜单保存至本机喜欢':'正在解析播放地址'}:null;heart?.refresh();playerChanged('track');}
  // ── 主题三态（v3.2.0）：浅色 / 深色 / 跟随系统 ──
  const systemDark = matchMedia('(prefers-color-scheme: dark)');
  function themePref() {
    const v = localStorage.getItem('xy.android.theme') || 'auto';
    return ['light', 'dark', 'auto'].includes(v) ? v : 'auto';
  }
  function applyTheme() {
    const pref = themePref();
    const dark = pref === 'dark' || (pref === 'auto' && systemDark.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const label = $('themeLabel');
    if (label) label.textContent = pref === 'dark' ? '开启' : pref === 'auto' ? (systemDark.matches ? '深色' : '浅色') : '关闭';
    document.querySelector('meta[name=theme-color]').content=dark?'#101c1a':'#f7faf8';
    if(XYNative.isAndroid){XYNative.StatusBar.setStyle({style:dark?'LIGHT':'DARK'}).catch(()=>{});XYNative.StatusBar.setBackgroundColor({color:dark?'#101c1a':'#f7faf8'}).catch(()=>{});}
    document.querySelectorAll('#themeSeg [data-theme]').forEach(b=>b.classList.toggle('active',b.dataset.theme===pref));
  }
  // 「我的」页快捷开关：浅色↔深色循环（完整三态在设置中心）
  function cycleTheme() { localStorage.setItem('xy.android.theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); applyTheme(); }
  function renderAuth() {const user=XYCloud.user;$('mobileGuest').hidden=!!user;$('mobileMember').hidden=!user;$('mobileMemberName').textContent=user?XYCloud.displayUser(user):'';$('mobileAccountName').textContent=user?XYCloud.displayUser(user):'登录，让喜欢随行';$('mobileAccountHint').textContent=user?'云端账户已连接 · 喜欢随账号保存':'云端收藏 · 多端共用同一个账号';$('mobileLoginSubmit').disabled=!XYCloud.available;}
  async function checkUpdate() {
    toast('正在检查更新…');
    let r;
    try { r = await XYCloud.getUpdateInfo(); }
    catch (e) { return toast('云端连接失败，请检查网络或稍后重试（' + (e.message || '网络异常') + '）', 6000); }
    if (!r.hasUpdate) return toast('当前已是最新版本 ' + r.cur);
    if (!XYNative.isAndroid || !XYNative.NativeMusic || !XYNative.NativeMusic.downloadApk) {
      // 无原生下载能力时兜底：浏览器下载
      return sheet('发现新版本 ' + r.latest, '<p class="muted">' + escape(r.notes || '新版本发布') + '</p><button id="mobileUpdateDownload" class="primary wide-button">前往浏览器下载 APK</button>');
    }
    // App 内下载闭环（2026-11-05）：进度条 sheet → 完成自动调起系统安装器，不再跳浏览器
    sheet('正在下载更新 v' + r.latest,
      '<p class="muted">' + escape(r.notes || '新版本发布') + '</p>' +
      '<div class="apk-progress"><div id="apkBarFill"></div></div>' +
      '<p id="apkPercent" class="muted" style="text-align:center;margin-top:6px;">0%</p>' +
      '<p id="apkStatus" class="muted" style="text-align:center;">正在连接下载服务…</p>');
    let apkPath = '';
    try {
      const prog = XYNative.NativeMusic.addListener('apkProgress', (p) => {
        const pct = Math.max(0, Math.min(100, Number(p && p.percent) || 0));
        const fill = document.getElementById('apkBarFill');
        const label = document.getElementById('apkPercent');
        if (fill) fill.style.width = pct + '%';
        if (label) label.textContent = pct + '%（' + Math.round((Number(p.received) || 0) / 1048576) + ' / ' + Math.round((Number(p.total) || 0) / 1048576) + ' MB）';
      });
      // 原生下载最多试 2 次（Render 免费实例偶发连接重置）：失败重试一次
      let res = null, lastErr = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await XYNative.NativeMusic.downloadApk({ url: r.url, version: r.latest });
          break;
        } catch (e) {
          lastErr = e;
          if (attempt === 0) {
            const st = document.getElementById('apkStatus');
            if (st) st.textContent = '下载中断，正在自动重试…';
            const fill = document.getElementById('apkBarFill');
            if (fill) fill.style.width = '0%';
          }
        }
      }
      if (prog && prog.remove) prog.remove();
      if (!res || !res.path) {
        // 双次失败 → 终极兜底：系统浏览器打开下载链接（浏览器下载可断点续传）
        closeSheet();
        toast('App 内下载失败（' + ((lastErr && lastErr.message) || '连接被重置') + '），已转系统浏览器下载，下载完成后请点击安装', 7000);
        try { await XYNative.openUpdate(r.url); } catch (e2) { toast('浏览器打开失败，请手动访问下载链接', 5000); }
        return;
      }
      apkPath = res.path;
      const st = document.getElementById('apkStatus');
      if (st) st.textContent = '下载完成，正在启动安装…';
      const open = await XYNative.NativeMusic.openApk({ path: apkPath });
      if (open && open.needsPermission) {
        // 未授予「安装未知应用」权限 → 跳系统设置，返回后可再点一次继续
        sheet('需要安装权限', '<p class="muted">请在接下来的页面允许「来自此来源的应用」安装，返回 App 后重新点「检查版本更新」即可直接进入安装。</p><button id="apkGrant" class="primary wide-button">去授权</button>');
        const g = document.getElementById('apkGrant');
        if (g) g.onclick = async () => { await XYNative.NativeMusic.requestInstallPermission(); };
      } else {
        closeSheet();
      }
    } catch (e) {
      try { XYNative.NativeMusic.removeAllListeners && XYNative.NativeMusic.removeAllListeners('apkProgress'); } catch (err) {}
      toast('更新下载失败：' + (e.message || '网络异常'), 6000);
    }
  }
  function settings(){const candidates=XYNetwork.config.lan||[];sheet('播放与连接设置','<form id="mobileSettingsForm"><label>音乐来源<select id="mobileVendor">'+Object.entries({auto:'自动选择',netease:'网易云音乐',tencent:'QQ 音乐',kugou:'酷狗音乐',kuwo:'酷我音乐'}).map(([v,n])=>'<option value="'+v+'" '+(UzzApi.getVendor()===v?'selected':'')+'>'+n+'</option>').join('')+'</select></label><label>音乐后端地址<input id="mobileBackend" type="url" placeholder="https://你的音乐服务 或下方电脑地址" value="'+escape(UzzApi.getApiBase())+'" required></label><p class="muted">真机的 localhost 指向手机自身。连接电脑同一 Wi-Fi 后，可选择下面的电脑地址；电脑后端须保持运行。离开该局域网后需要公网 HTTPS 音乐服务。登录与收藏直接连接 Supabase，不依赖电脑音乐后端。</p>'+candidates.map(c=>'<button type="button" class="wide-button" data-backend-suggestion="'+escape(c.url)+'">使用电脑地址 '+escape(c.url)+' · '+escape(c.label)+'</button>').join('')+'<button class="primary wide-button">保存设置</button></form><button class="wide-button" data-action="networkDiagnostics">诊断音乐与登录网络</button>');}
  async function networkDiagnostics(){if(!$('accountBackdrop').hidden)closeAccount();sheet('网络诊断','<p class="muted">正在分别检查音乐服务和 Supabase… 不发送手机号或密码。</p>');try{const r=await XYNetwork.diagnose();if($('sheetTitle').textContent!=='网络诊断')return;const text='音乐服务：'+(r.backend||'尚未设置')+'\n'+(r.music.ok?'✓ ':'× ')+r.music.message+'\n\n云端账户：\n'+(r.cloud.ok?'✓ ':'× ')+r.cloud.message;$('sheetContent').replaceChildren();const p=document.createElement('p');p.className='form-status';p.style.whiteSpace='pre-wrap';p.textContent=text;$('sheetContent').appendChild(p);const b=document.createElement('button');b.className='wide-button';b.dataset.action='settings';b.textContent='修改音乐服务地址';$('sheetContent').appendChild(b);}catch(e){toast(e.message);}}
  // ── 设置中心（v3.2.2 网易云风格列表）────────────────────────
  let sleepTimer = null, sleepDeadline = 0, lastSleepPick = 0;
  function applyQuality(q) {
    localStorage.setItem('uzz.quality', q);
    document.querySelectorAll('#qualitySeg [data-quality]').forEach(b => b.classList.toggle('active', b.dataset.quality === q));
    toast(q === 'lossless' ? '无损音质已选择，从下一首歌生效（部分歌曲可能回退高品/标准）' : q === 'ex' ? '高品 320k 已选择，从下一首歌生效' : '标准音质已选择，从下一首歌生效');
  }
  function applySpeed(rate) {
    const r = Number(rate) || 1;
    try { audio.playbackRate = r; audio.defaultPlaybackRate = r; } catch (e) { /* 原生桥失败不阻塞 */ }
    document.querySelectorAll('#speedSeg [data-speed]').forEach(b => b.classList.toggle('active', Number(b.dataset.speed) === r));
    toast(r === 1 ? '恢复正常速度' : '已切换 ' + r + 'x 倍速' + (r > 1 ? ' 🚀' : ''));
  }
  function applySleep(minutes) {
    clearTimeout(sleepTimer); sleepTimer = null;
    const status = $('sleepStatus');
    if (!minutes) {
      sleepDeadline = 0;
      if (status) { status.hidden = true; status.textContent = ''; }
      document.querySelectorAll('#sleepSeg [data-sleep]').forEach(b => b.classList.toggle('active', b.dataset.sleep === '0'));
      toast('已取消定时关闭');
      return;
    }
    sleepDeadline = Date.now() + minutes * 60000;
    document.querySelectorAll('#sleepSeg [data-sleep]').forEach(b => b.classList.toggle('active', Number(b.dataset.sleep) === minutes));
    const tick = () => {
      const left = sleepDeadline - Date.now();
      if (left <= 0) {
        sleepTimer = null; sleepDeadline = 0;
        if (status) { status.hidden = true; status.textContent = ''; }
        try { audio.pause(); } catch (e) {}
        toast('定时时间到，播放已停止 🌙');
        document.querySelectorAll('#sleepSeg [data-sleep]').forEach(b => b.classList.toggle('active', b.dataset.sleep === '0'));
        return;
      }
      const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      if (status) { status.hidden = false; status.textContent = '将在 ' + m + ' 分 ' + String(s).padStart(2, '0') + ' 秒后停止播放'; }
      sleepTimer = setTimeout(tick, 1000);
    };
    tick();
    toast('将在 ' + minutes + ' 分钟后停止播放');
  }
  function initSettings() {
    const QUALITY_LABELS = { standard: '标准', ex: '高品', lossless: '无损' };
    const SPEED_LABELS = { 0.5: '0.5x', 1: '1.0x', 1.5: '1.5x', 2: '2.0x' };
    const SLEEP_LABELS = { 0: '关闭', 15: '15分钟', 30: '30分钟', 60: '60分钟' };
    const THEME_LABELS = { light: '浅色', dark: '深色', auto: '跟随系统' };
    // 通用：底部弹层单选（网易云风格：列表行 → sheet 选值）
    function pickSheet(title, options, current, onPick) {
      sheet(title, options.map((o) => '<button class="sheet-action" data-pick="' + o.value + '">' + (String(o.value) === String(current) ? '✓ ' : '') + escape(o.label) + '</button>').join(''));
      document.querySelectorAll('#sheetContent [data-pick]').forEach(b => { b.onclick = () => { closeSheet(); onPick(b.dataset.pick); }; });
    }
    const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    function refreshSettingsValues() {
      const q = localStorage.getItem('uzz.quality') || 'standard';
      const r = Number(localStorage.getItem('uzz.rate') || 1) || 1;
      const sl = sleepDeadline > Date.now() ? Math.ceil((sleepDeadline - Date.now()) / 60000) + ' 分钟后停' : (SLEEP_LABELS[lastSleepPick] || '关闭');
      const th = themePref();
      const ml = localStorage.getItem('uzz.mobileLyric') === '1' ? '已开启' : '关闭';
      setText('valQuality', QUALITY_LABELS[q] || q);
      setText('valSpeed', SPEED_LABELS[String(r)] || r + 'x');
      setText('valSleep', sl);
      setText('valTheme', THEME_LABELS[th] || th);
      setText('valMobileLyric', ml);
    }
    // 恢复上次选择
    const savedRate = Number(localStorage.getItem('uzz.rate') || 1) || 1;
    try { audio.defaultPlaybackRate = savedRate; audio.playbackRate = savedRate; } catch (e) {}
    const rowQuality = $('rowQuality');
    if (rowQuality) rowQuality.onclick = () => pickSheet('音质', [
      { value: 'standard', label: '标准 128k' }, { value: 'ex', label: '高品 320k' }, { value: 'lossless', label: '无损' },
    ], localStorage.getItem('uzz.quality') || 'standard', (v) => { applyQuality(v); refreshSettingsValues(); });
    const rowSpeed = $('rowSpeed');
    if (rowSpeed) rowSpeed.onclick = () => pickSheet('播放倍速', [
      { value: '0.5', label: '0.5x 慢速' }, { value: '1', label: '1.0x 正常' }, { value: '1.5', label: '1.5x' }, { value: '2', label: '2.0x 🚀' },
    ], String(savedRate), (v) => { localStorage.setItem('uzz.rate', v); applySpeed(v); refreshSettingsValues(); });
    const rowSleep = $('rowSleep');
    if (rowSleep) rowSleep.onclick = () => pickSheet('定时关闭', [
      { value: '0', label: '关闭' }, { value: '15', label: '15 分钟' }, { value: '30', label: '30 分钟' }, { value: '60', label: '60 分钟' },
    ], String(lastSleepPick || 0), (v) => { lastSleepPick = Number(v) || 0; applySleep(lastSleepPick); refreshSettingsValues(); });
    const rowTheme = $('rowTheme');
    if (rowTheme) rowTheme.onclick = () => pickSheet('主题', [
      { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }, { value: 'auto', label: '跟随系统' },
    ], themePref(), (v) => { localStorage.setItem('xy.android.theme', v); applyTheme(); refreshSettingsValues(); });
    const rowMobileLyric = $('rowMobileLyric');
    if (rowMobileLyric) rowMobileLyric.onclick = async () => { await setMobileLyric(localStorage.getItem('uzz.mobileLyric') === '1' ? '0' : '1'); refreshSettingsValues(); };
    // 主题跟随系统实时切换
    systemDark.addEventListener('change', () => { if (themePref() === 'auto') applyTheme(); });
    applyTheme();
    refreshSettingsValues();
    const ver = $('settingsVer');
    if (ver) ver.textContent = 'v' + (window.XYCloud?.appVersion || '');
  }
  // 桌面歌词开关（v3.2.2）：开启需悬浮窗权限，未授权引导系统设置后重开
  async function setMobileLyric(v) {
    const on = v === '1';
    if (!on) {
      localStorage.removeItem('uzz.mobileLyric');
      try { await XYNative.NativeMusic.lyricOverlay({ show: false }); } catch (e) {}
      return toast('桌面歌词已关闭');
    }
    try {
      const r = await XYNative.NativeMusic.lyricOverlay({ show: true, cur: '小杨音乐 · 桌面歌词已开启', next: '播放歌曲后逐句显示（可拖动，长按关闭）', playing: true });
      if (r && r.needsPermission) {
        sheet('需要悬浮窗权限', '<p class="muted">请在接下来的页面允许「显示在其他应用上层」，返回后再打开桌面歌词。</p><button id="overlayGrant" class="primary wide-button">去授权</button>');
        const g = document.getElementById('overlayGrant');
        if (g) g.onclick = async () => { await XYNative.NativeMusic.overlayPermission(); };
        return;
      }
      localStorage.setItem('uzz.mobileLyric', '1');
      toast('桌面歌词已开启 🎵');
    } catch (e) {
      toast('无法开启桌面歌词：' + (e.message || '系统拒绝'), 5000);
    }
  }

  const actions={
    account:openAccount,closeAccount,closeSheet,player:showPlayer,closePlayer,toggle:()=>audio.error&&audio.retry?audio.retry():Player.toggle(),next:()=>Player.next(),prev:()=>Player.prev(),mode:()=>Player.cycleMode(),queue:showQueue,
    retryPlayback:async()=>{if(!Player.getState().current)return;if(audio.retry)await audio.retry();else{audio.load();await audio.play();}toast('正在重新连接音源…');},
    trackMenu:()=>trackMenu(Player.getState().current),createPlaylist,addToPlaylist,settings,networkDiagnostics,update:checkUpdate,
    back:()=>navigate(previousRoute==='detail'?'library':previousRoute),refreshDiscover:loadDiscover,retrySearch:()=>search(),refreshCloud,
    history:()=>chooseLibrary('history'),favorites:()=>chooseLibrary('favorites'),openCloud:()=>{closeAccount();chooseLibrary('cloud');},
    clearSearch:()=>{searchHistory=[];save('uzz.searchHistory',[]);renderSearchWelcome();},theme:cycleTheme,
    charts:()=>{navigate('discover');$('chartCards').scrollIntoView({behavior:'smooth',block:'center'});},
    enqueue:()=>{Player.enqueueTrack(selectedTrack);closeSheet();toast('已加入播放队列');},
    // 本机收藏（双写）：本机列表确定性增删 + 登录态下同步云端（失败不回滚本机）
    deviceFavorite:async()=>{const t=selectedTrack;if(!t||typeof t.id!=='string'||!t.vendor){closeSheet();toast('该来源暂不支持收藏');return;}
      const on=!Player.isFavorite(t);Player.setFavorite(t,on);closeSheet();toast(on?'已保存到本机喜欢':'已取消本机喜欢');if(route==='library')renderLibrary();
      if(XYCloud.user){const ref=XYCloud.trackReference(t);if(ref){try{const cur=await checkIsFavorited(ref);if(cur!==on){if(on)await addFavorite(t.name,ref);else await removeFavorite(ref);}heart?.refresh();}catch(e){toast('云端同步失败：'+e.message);}}}},
    removeFromPlaylist:()=>{const p=playlists.find(p=>p.id===detail?.localId);if(!p)return;p.tracks=p.tracks.filter(t=>keyOf(t)!==keyOf(selectedTrack));detail.tracks=p.tracks;savePlaylists();paintDetail();closeSheet();},
    removeFromQueue:()=>{Player.removeFromQueue(Player.getQueue().findIndex(t=>keyOf(t)===keyOf(selectedTrack)));showQueue();},
    clearQueue:()=>{Player.clearQueue();closeSheet();toast('播放队列已清空');},
    removeCloud:async()=>{const user=XYCloud.user?.id,url=selectedTrack?.cloudUrl;if(!url)return;try{await removeFavorite(url);if(user!==XYCloud.user?.id)return;closeSheet();await refreshCloud();heart?.refresh();toast('已取消云端收藏');}catch(e){toast(e.message);}},
    // 下载到本机（v3.2.1）：原生下载 → MediaStore 公共音乐目录 → 自动入本地库（离线可播）
    downloadTrack:async()=>{
      const t=selectedTrack;closeSheet();
      if(!t||!/^https?:\/\//i.test(t.url||''))return toast('该歌曲暂无可下载地址');
      if(!XYNative.NativeMusic?.downloadTrack)return toast('当前版本不支持下载');
      sheet('正在下载《'+escape((t.name||'').slice(0,20))+'》','<div class="apk-progress"><div id="dlBarFill"></div></div><p id="dlPercent" class="muted" style="text-align:center;margin-top:6px;">0%</p><p class="muted" style="text-align:center;">保存到系统音乐库 · Music/小杨音乐</p>');
      try{
        const prog=XYNative.NativeMusic.addListener('downloadProgress',(p)=>{
          const pct=Math.max(0,Math.min(100,Number(p&&p.percent)||0));
          const fill=document.getElementById('dlBarFill'),label=document.getElementById('dlPercent');
          if(fill)fill.style.width=pct+'%';if(label)label.textContent=pct+'%';
        });
        const r=await XYNative.NativeMusic.downloadTrack({url:t.url,name:t.name||'未知歌曲',artist:t.artist||''});
        if(prog&&prog.remove)prog.remove();
        closeSheet();
        if(r&&r.tracks&&r.tracks.length){addLocalTracks(r.tracks);toast('已下载并可离线播放，已加入「音乐库 · 本地」');}
        else toast('下载完成');
      }catch(e){
        try{XYNative.NativeMusic.removeAllListeners&&XYNative.NativeMusic.removeAllListeners('downloadProgress');}catch(err){}
        closeSheet();toast('下载失败：'+(e.message||'网络异常'),6000);
      }
    }
  };
  function addLocalTracks(tracks) {let added=0;for(const t of tracks||[]){if(t.vendor!=='device'||!String(t.url).startsWith('content://')||!t.id)continue;const i=localTracks.findIndex(old=>old.id===t.id);if(i<0){localTracks.push(t);added++;}else localTracks[i]={...localTracks[i],...t,persistent:!!(t.persistent||localTracks[i].persistent)};}save('xy.android.localTracks',localTracks);chooseLibrary('local');if(added)toast('已导入 '+added+' 首本地音乐');return tracks?.[0];}
  actions.importLocal=async()=>{if(!XYNative.isAndroid)return toast('请在安装的安卓版中选择本机音乐');const r=await XYNative.NativeMusic.pickFiles();addLocalTracks(r.tracks);};
  actions.removeLocal=()=>{localTracks=localTracks.filter(t=>t.id!==selectedTrack?.id);save('xy.android.localTracks',localTracks);closeSheet();if(route==='library')renderLibrary();toast('已从列表移除，原文件仍保留');};
  async function syncLibrary(direction) {try{const uid=XYCloud.user?.id;if(!uid)return openAccount();const p=await XYSync.preview();if(uid!==XYCloud.user?.id)return;sheet(direction==='push'?'上传并合并到云端':'从云端合并到本机','<p class="muted">本机 '+p.localPlaylists+' 张歌单，云端 '+p.cloudPlaylists+' 张歌单。合并保留双方歌曲，不同步删除。本地音频、文件地址和密码不会上传。</p><button class="primary wide-button" id="confirmLibrarySync">确认合并</button>');$('confirmLibrarySync').onclick=async()=>{if(uid!==XYCloud.user?.id){closeSheet();return toast('账户已切换，请重试');}$('confirmLibrarySync').disabled=true;try{const r=await XYSync[direction]();playlists=read('uzz.playlists',[]);renderCounts();closeSheet();toast('已合并 '+r.playlists+' 张歌单');}catch(e){toast(e.message);if($('confirmLibrarySync'))$('confirmLibrarySync').disabled=false;}};}catch(e){toast(e.message);}}
  async function click(event) {
    const button=event.target.closest('button,a');if(!button)return;
    if(button.dataset.backendSuggestion){$('mobileBackend').value=button.dataset.backendSuggestion;return;}
    if(button.dataset.nav){navigate(button.dataset.nav);return;}
    if(button.dataset.action){const action=actions[button.dataset.action];if(action)await action();return;}
    if(button.dataset.online){await openOnline(button.dataset.online,button.dataset.title);return;}
    if(button.dataset.query!==undefined){$('mobileSearchInput').value=button.dataset.query;await search();return;}
    if(button.dataset.library){libraryTab=button.dataset.library;renderLibrary();return;}
    if(button.dataset.localPlaylist){openLocal(button.dataset.localPlaylist);return;}
    if(button.dataset.type){searchType=button.dataset.type;document.querySelectorAll('[data-type]').forEach(e=>e.classList.toggle('active',e===button));await search();return;}
    if(button.dataset.trackMenu){trackMenu(trackSets.get(button.dataset.trackMenu)?.[Number(button.dataset.trackIndex)],button.dataset.trackMenu);return;}
    if(button.dataset.trackList){if(Date.now()<(click.suppressUntil||0))return;const scope=button.dataset.trackList,index=Number(button.dataset.trackIndex);if(scope==='search')await openSearchResult(index);else play(trackSets.get(scope)?.[index]);return;}
    if(button.dataset.addPlaylist){const p=playlists.find(p=>p.id===button.dataset.addPlaylist);if(!p||!selectedTrack)return;p.tracks=p.tracks||[];if(!p.tracks.some(t=>keyOf(t)===keyOf(selectedTrack)))p.tracks.push({...selectedTrack});savePlaylists();if(detail?.localId===p.id){detail.tracks=p.tracks;paintDetail();}closeSheet();toast('已添加到「'+p.name+'」');return;}
    if(button.dataset.lyricTime){audio.currentTime=Number(button.dataset.lyricTime);if(audio.paused)await audio.play().catch(()=>toast('点击播放继续'));}
    if(button.dataset.auth){authMode=button.dataset.auth;document.querySelectorAll('[data-auth]').forEach(e=>e.classList.toggle('active',e===button));$('mobileLoginSubmit').textContent=authMode==='login'?'登录':'注册并登录';$('mobilePassword').autocomplete=authMode==='login'?'current-password':'new-password';$('mobileAuthStatus').textContent='';}
  }
  function back(){if(!$('accountBackdrop').hidden)return closeAccount();if(!$('sheetBackdrop').hidden)return closeSheet();if(!$('mobilePlayer').hidden)return closePlayer();if(route!=='discover')return navigate(route==='detail'?previousRoute:'discover');if(Date.now()-lastBack<1800){XYNative.App.exitApp();return;}lastBack=Date.now();toast('再按一次返回退出应用');}
  let keyboardOpen=false;
  let playbackStatusKey='',bufferSince=0,bufferTimer;
  function playbackStatus(){
    const status=$('mobilePlaybackStatus');if(!status)return;
    const state=Player.getState(),key=state.current?keyOf(state.current):'',waiting=!!key&&(state.loading||(!audio.paused&&audio.readyState<3));
    if(key!==playbackStatusKey||!waiting){bufferSince=0;clearTimeout(bufferTimer);bufferTimer=null;}playbackStatusKey=key;
    if(waiting&&!bufferSince)bufferSince=Date.now();
    const slow=waiting&&Date.now()-bufferSince>=12000;
    if(waiting&&!slow&&!bufferTimer)bufferTimer=setTimeout(()=>{bufferTimer=null;playbackStatus();},Math.max(1,12000-(Date.now()-bufferSince)));
    const message=audio.error?(audio.error.message||'播放失败，请重试或切换歌曲'):state.loading?'正在解析歌曲…':waiting?'正在缓冲…':'';
    if(status.textContent!==message)status.textContent=message;
    $('playbackRecovery').hidden=!key||(!audio.error&&!slow);
    $('playbackRecoveryMessage').textContent=audio.error?message:'等待音源响应时间较长，可以重试或切换下一首。';
    $('playbackRecoveryNext').disabled=Player.getQueue().length<2;
    if(audio.error){for(const id of ['mobilePlay','mobileMiniPlay'])$(id).setAttribute('aria-label','重试播放');}
  }
  function viewport(){const v=global.visualViewport;document.documentElement.style.setProperty('--vh',(v?.height||innerHeight)+'px');document.documentElement.style.setProperty('--viewport-top',(v?.offsetTop||0)+'px');const keyboard=keyboardOpen||(/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)&&innerHeight-(v?.height||innerHeight)>100);document.body.classList.toggle('keyboard-visible',keyboard);}
  document.addEventListener('DOMContentLoaded',async()=>{
    await XYNetwork.ready;
    hydrate();Player.init({headless:true});applyTheme();$('todayDate').textContent=new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric'}).format(new Date());
    const diagnosticsButton=document.createElement('button');diagnosticsButton.type='button';diagnosticsButton.textContent='网络诊断';diagnosticsButton.dataset.action='networkDiagnostics';document.querySelector('.settings-card').appendChild(diagnosticsButton);
    const loginDiagnostic=document.createElement('button');loginDiagnostic.type='button';loginDiagnostic.className='wide-button';loginDiagnostic.textContent='登录失败？检查网络';loginDiagnostic.onclick=networkDiagnostics;$('mobileAuthStatus').after(loginDiagnostic);
    const playbackLabel=document.createElement('span');playbackLabel.id='mobilePlaybackStatus';playbackLabel.setAttribute('role','status');playbackLabel.setAttribute('aria-live','polite');$('mobileTime').after(playbackLabel);
    const recovery=document.createElement('div');recovery.id='playbackRecovery';recovery.className='playback-recovery';recovery.hidden=true;recovery.innerHTML='<p id="playbackRecoveryMessage" role="status"></p><button class="outline" data-action="retryPlayback">重新连接</button><button id="playbackRecoveryNext" class="outline" data-action="next">下一首</button>';$('mobileTime').parentElement.after(recovery);
    for(const name of ['timeupdate','waiting','canplay','play','pause','error'])audio.addEventListener(name,playbackStatus);
    document.addEventListener('xy:player',playbackStatus);
    for(const [direction,label] of [['push','上传并合并歌单'],['pull','从云端合并歌单']]){const b=document.createElement('button');b.type='button';b.className='wide-button';b.textContent=label;b.onclick=()=>syncLibrary(direction);$('mobileMember').insertBefore(b,$('mobileLogout'));}
    document.addEventListener('click',e=>{click(e).catch(error=>toast(error.message));});
    document.addEventListener('error',e=>{if(e.target instanceof HTMLImageElement&&e.target.getAttribute('src')!=='icon.svg')e.target.src='icon.svg';},true);
    global.addEventListener('hashchange',()=>showRoute(location.hash.slice(1)));showRoute(location.hash.slice(1));
    $('mobileSearchForm').onsubmit=e=>{e.preventDefault();$('mobileSearchInput').blur();search();};$('searchMore').onclick=()=>search(true);$('refreshDiscover').onclick=loadDiscover;
    $('mobileSearchInput').addEventListener('input',()=>{if(!$('mobileSearchInput').value.trim()){searchGeneration++;searchAbort?.abort();$('searchResults').hidden=true;$('searchWelcome').hidden=false;renderSearchWelcome();}});
    $('detailPlayAll').onclick=()=>{if(detail?.tracks.length){Player.playQueue(detail.tracks).catch(e=>toast(e.message));showPlayer();}};
    $('detailSave').onclick=()=>{if(!detail||!detail.tracks.length)return;const existing=playlists.find(p=>p.sourceId===detail.id);if(existing)return toast('此歌单已保存');playlists.unshift({id:'L'+crypto.randomUUID(),sourceId:detail.id,name:detail.name,cover:detail.cover,tracks:detail.tracks.slice(),kind:'collected',createdAt:Date.now()});savePlaylists();toast('歌单已保存到音乐库');};
    $('detailRename').onclick=()=>sheet('编辑歌单','<form id="playlistRenameForm"><label>歌单名称<input id="renamePlaylistName" maxlength="60" required value="'+escape(detail.name)+'"></label><button class="primary wide-button">保存名称</button></form><button class="wide-button" id="deletePlaylist">删除此歌单</button>');
    document.addEventListener('submit',e=>{
      if(e.target.id==='playlistCreateForm'){e.preventDefault();const name=$('newPlaylistName').value.trim();if(!name)return;const p={id:'L'+crypto.randomUUID(),name,cover:'',tracks:[],kind:'created',createdAt:Date.now()};playlists.unshift(p);savePlaylists();closeSheet();openLocal(p.id);}
      if(e.target.id==='playlistRenameForm'){e.preventDefault();const name=$('renamePlaylistName').value.trim(),p=playlists.find(p=>p.id===detail?.localId);if(!name||!p)return;p.name=detail.name=name;savePlaylists();paintDetail();closeSheet();}
      if(e.target.id==='mobileSettingsForm'){e.preventDefault();try{localStorage.setItem('uzz.apiBase',XYNetwork.backendURL($('mobileBackend').value));localStorage.setItem('uzz.vendor',$('mobileVendor').value);closeSheet();toast('设置已保存，可在网络诊断中检查连接');loadDiscover();loadHot();}catch(error){toast(error.message);}}
    });
    document.addEventListener('click',e=>{if(e.target.closest('#deletePlaylist')){sheet('删除歌单','<p class="muted">确认删除「'+escape(detail.name)+'」？歌曲文件不会被删除。</p><button id="confirmDeletePlaylist" class="wide-button">确认删除歌单</button>');}if(e.target.closest('#confirmDeletePlaylist')){playlists=playlists.filter(p=>p.id!==detail.localId);savePlaylists();closeSheet();navigate('library');}});
    actions.testBackend=async()=>{toast(await UzzApi.ping()?'音乐后端连接正常':'连接失败，请检查后端地址与电脑服务');};
    $('sheetBackdrop').onclick=e=>{if(e.target===$('sheetBackdrop'))closeSheet();};$('accountBackdrop').onclick=e=>{if(e.target===$('accountBackdrop'))closeAccount();};
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){back();return;}if(e.key==='Tab'){const container=!$('accountBackdrop').hidden?$('accountBackdrop'):!$('sheetBackdrop').hidden?$('mobileSheet'):null;if(!container)return;const nodes=[...container.querySelectorAll('button:not(:disabled),input,select,[tabindex="0"]')].filter(n=>n.getClientRects().length);if(!nodes.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&(document.activeElement===first||!container.contains(document.activeElement))){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
    $('mobileSeek').oninput=()=>{if(Number.isFinite(audio.duration))audio.currentTime=Number($('mobileSeek').value)/1000*audio.duration;};
    function toggleLyrics(){const show=$('mobileLyrics').hidden;$('mobileLyrics').hidden=!show;$('mobileArtwork').hidden=show;$('lyricToggle').textContent=show?'封面 ↗':'歌词 ↗';if(show)renderLyrics();}
    $('mobileArtwork').onclick=toggleLyrics;$('lyricToggle').onclick=toggleLyrics;
    for(const name of ['timeupdate','loadedmetadata','durationchange','seeked'])audio.addEventListener(name,progress);
    for(const name of ['play','pause','ended','error','emptied'])audio.addEventListener(name,()=>playerChanged('play'));
    document.addEventListener('xy:player',e=>playerChanged(e.detail.kind));document.addEventListener('xy:trackChanged',syncHeart);document.addEventListener('uzz:libChanged',()=>{renderCounts();if(route==='library'&&libraryTab!=='cloud')renderLibrary();});
    document.addEventListener('xy:libraryRestore',()=>{playlists=read('uzz.playlists',[]);renderCounts();if(route==='library')renderLibrary();});
    // 未登录点红心：不再强制跳登录，直接本机收藏兜底（这就是安卓"本机红心"）
    $('favoriteBtn').addEventListener('click',e=>{
      if(XYCloud.user)return; // 登录态交给云端红心（双写联动）
      e.stopImmediatePropagation();
      const t=Player.getState().current;
      if(!t||typeof t.id!=='string'||!t.vendor){toast('先播放一首歌再收藏');return;}
      const on=!Player.isFavorite(t);Player.setFavorite(t,on);
      const b=$('favoriteBtn');b.classList.toggle('is-favorited',on);b.setAttribute('aria-pressed',String(on));
      toast(on?'已保存到本机喜欢（登录后可同步云端）':'已取消本机喜欢');
    });
    // 云端红心（登录态）：双写联动钩子——点击时本机 uzz.fav 同步增删
    const currentTrack=()=>{const t=Player.getState().current;return (t&&typeof t.id==='string'&&t.vendor)?t:null;};
    if(XYCloud.available)heart=bindFavoriteButton({button:$('favoriteBtn'),status:$('favoriteStatus'),getSong:()=>{const t=Player.getState().current;return XYCloud.currentSong?{...XYCloud.currentSong,url:XYCloud.trackReference(t)||XYCloud.currentSong.url}:null;},onError:e=>toast(e.message),
      localState:()=>{const t=currentTrack();return !!(t&&Player.isFavorite(t));},
      localSet:(_s,on)=>{const t=currentTrack();if(t)Player.setFavorite(t,on);}});
    $('favoriteBtn').addEventListener('favoritechange',e=>{const d=e.detail||{};if(d.localOnly)return;if(d.pending)toast(d.favorited?'正在收藏到云端…':'正在取消云端收藏…');else if(!d.rollback)toast(d.favorited?'已收藏到云端':'已取消云端收藏');if(route==='library'&&libraryTab==='cloud')refreshCloud();});
    // 反向联动：本机收藏（更多菜单等）变化在当前歌上 → 云端同步
    document.addEventListener('uzz:favCurrent',async e=>{if(!XYCloud.user||!heart)return;const t=e.detail?.track;const ref=t&&XYCloud.trackReference(t);if(!ref)return;try{const cur=await checkIsFavorited(ref);if(cur===e.detail.added){heart.refresh();return;}if(e.detail.added)await addFavorite(t.name,ref);else await removeFavorite(ref);heart.refresh();if(route==='library'&&libraryTab==='cloud')refreshCloud();}catch(err){toast('云端同步失败：'+err.message);}});
    // 账号切换数据隔离：换号即用云端收藏重置本机喜欢（全量拉取，防串号）
    async function syncLocalFromCloud(){const uid=XYCloud.user?.id;if(!uid)return;try{const rows=await getFavorites();if(uid!==XYCloud.user?.id)return;const seen=new Set(),tracks=[];for(const row of rows){const t=XYCloud.favoriteToTrack(row);if(t&&t.id&&t.vendor){const key=t.vendor+'|'+t.id;if(!seen.has(key)){seen.add(key);tracks.push({...t,at:Date.now()});}}}Player.replaceFavorites(tracks);renderCounts();toast('已同步云端收藏到本机（'+tracks.length+' 首）');}catch(_){/*拉取失败保持本机现状*/}}
    $('mobileLoginForm').onsubmit=async e=>{e.preventDefault();$('mobileLoginSubmit').disabled=true;$('mobileAuthStatus').textContent='正在连接…';try{const data=await global[authMode==='login'?'loginUser':'registerUser']($('mobilePhone').value,$('mobilePassword').value);$('mobilePassword').value='';$('mobileAuthStatus').textContent=data.session?'登录成功':'注册完成，请检查手机号确认配置后登录';}catch(error){$('mobileAuthStatus').textContent=error.message;}finally{$('mobileLoginSubmit').disabled=!XYCloud.available;}};
    $('mobileLogout').onclick=async()=>{$('mobileLogout').disabled=true;try{await logoutUser();$('mobilePassword').value='';$('mobileAuthStatus').textContent='已退出登录';}catch(e){$('mobileAuthStatus').textContent=e.message;}finally{$('mobileLogout').disabled=false;}};
    if(XYCloud.available){const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{const user=session?.user||null;const changed=XYCloud.user?.id!==user?.id;if(changed){authGeneration++;cloudGeneration++;cloudRows=[];}XYCloud.user=user;renderAuth();setTimeout(()=>{if(changed&&user)syncLocalFromCloud();if(route==='library'&&libraryTab==='cloud')renderLibrary();},0);});global.addEventListener('pagehide',()=>{subscription.unsubscribe();heart?.destroy();},{once:true});}renderAuth();
    let longPress;document.addEventListener('pointerdown',e=>{const b=e.target.closest('[data-track-list]');if(!b)return;const x=e.clientX,y=e.clientY;clearTimeout(longPress);longPress=setTimeout(()=>{click.suppressUntil=Date.now()+800;trackMenu(trackSets.get(b.dataset.trackList)?.[Number(b.dataset.trackIndex)],b.dataset.trackList);},550);const move=ev=>{if(Math.abs(ev.clientX-x)+Math.abs(ev.clientY-y)>12){clearTimeout(longPress);document.removeEventListener('pointermove',move);}};document.addEventListener('pointermove',move);document.addEventListener('pointerup',()=>{clearTimeout(longPress);document.removeEventListener('pointermove',move);},{once:true});});document.addEventListener('pointercancel',()=>clearTimeout(longPress));
    global.visualViewport?.addEventListener('resize',viewport);global.visualViewport?.addEventListener('scroll',viewport);global.addEventListener('resize',viewport);document.addEventListener('focusin',e=>{viewport();if(e.target.matches('input,select'))setTimeout(()=>e.target.scrollIntoView({block:'center',behavior:'smooth'}),250);});document.addEventListener('focusout',()=>setTimeout(viewport,80));viewport();
    if(XYNative.isAndroid){XYNative.App.addListener('backButton',back).catch(()=>{});XYNative.NativeMusic.addListener('localFiles',r=>{const first=addLocalTracks(r.tracks);if(first)play(first);}).catch(()=>{});XYNative.App.getInfo().then(info=>$('mobileVersion').textContent=info.version).catch(()=>{});for(const name of ['keyboardDidShow','keyboardDidHide'])XYNative.Keyboard.addListener(name,()=>{keyboardOpen=name==='keyboardDidShow';viewport();}).catch(()=>{});}
    global.XYMobileApp={navigate,openOnline,openLocal,renderLibrary,refreshCloud,getDetail:()=>detail};
    audio.connection?.then(()=>{if(audio.lastState?.restored&&Player.getState().current){playerChanged('track');progress();toast('已恢复上次队列与进度，点击播放继续');}}).catch(()=>{});
    initSettings();loadDiscover();loadHot();renderCounts();syncHeart();
  });
})(window);
