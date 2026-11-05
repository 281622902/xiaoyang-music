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
  const cover = value => {
    if (!value || value==='icon.svg') return 'icon.svg';
    try {
      const u = new URL(value, location.href);
      if (!/^https?:$/.test(u.protocol)) return 'icon.svg';
      // 安卓 WebView 的安全上下文是 https://localhost，http:// 明文图片会被
      // 系统拦截（ERR_CLEARTEXT_NOT_PERMITTED）→ 卡片出现白块。国内图床均
      // 支持 https，这里统一升级，保证搜索四 Tab 的封面真实可见。
      if (u.protocol === 'http:') u.protocol = 'https:';
      return XYNative.isAndroid ? u.href : UzzApi.picProxy(u.href);
    } catch { return 'icon.svg'; }
  };
  const fmt = n => { n = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0; return Math.floor(n / 60) + ':' + String(n % 60).padStart(2,'0'); };
  const modes = {list:'列表循环',single:'单曲循环',random:'随机播放',sequential:'顺序播放'};
  const trackSets = new Map();
  let route = 'discover', previousRoute = 'discover', libraryTab = 'playlists', detail = null;
  let playlists = read('uzz.playlists', []), searchHistory = read('uzz.searchHistory', []);
  let localTracks = read('xy.android.localTracks', []);
  let searchType = 'song', searchKeyword = '', searchPage = 1, searchRows = [], searchGeneration = 0, searchAbort, searchArtistHint = '', searchDeduped = 0, searchTargeted = false, searchRelaxed = false, searchDegraded = false, searchNetworkTimeout = false;
  let channel = 'recommend';
  // v3.7.0 阶段二：首页推荐池 / 换一批游标、独立榜单页数据、频道缓存
  let discoveryPool = [], discoveryOffset = 0;
  let chartsData = [], activeChartId = '', pendingChartId = '';
  const channelCache = new Map();
  let detailGeneration = 0, discoveryGeneration = 0, cloudGeneration = 0, authGeneration = 0, heart;
  let cloudRows = [], authMode = 'login', selectedTrack = null, lastFocus = null, sheetFocus = null, lastBack = 0;
  // v3.6.1：云端歌单（user_playlists 表），与电脑端共用同一张表
  let cloudPlaylists = [], cloudPlAt = 0, cloudPlPending = false;
  let selectedArtist = { id:'', name:'' };
  function toast(text) { $('toast').textContent = text; $('toast').classList.toggle('hidden', !text); clearTimeout(toast.timer); if (text) toast.timer=setTimeout(()=>$('toast').classList.add('hidden'),3500); }
  function hydrate(root = document) { root.querySelectorAll('[data-icon]').forEach(e=>{e.innerHTML=icon(e.dataset.icon);}); }
  function empty(text) { return '<div class="empty-state">'+escape(text)+'</div>'; }
  function failure(text, action) { return '<div class="error-state">'+escape(text)+(action?'<button data-action="'+action+'">重新加载</button>':'')+'</div>'; }
  // v3.6.1：网络类失败给两个可操作出口（重试 / 切换音源），不再只丢一句「重试」
  function networkFailureBox(text) {
    return '<div class="error-state">'+escape(text)+'<button data-action="retrySearch">重试</button><button data-action="settings">切换音源</button></div>';
  }
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
  function openAccount() { lastFocus=document.activeElement; $('accountBackdrop').hidden=false; $('mobileAuthStatus').textContent=XYCloud.error || ''; renderAuth(); toggleCaptcha(); $('mobileLoginTitle').tabIndex=-1; $('mobileLoginTitle').focus(); }
  function showPlayer() { if (!Player.getState().current) return toast('先选择一首喜欢的歌曲'); $('mobilePlayer').hidden=false; $('mobileSongName').tabIndex=-1; $('mobileSongName').focus({preventScroll:true}); }
  function closePlayer() { $('mobilePlayer').hidden=true; }
  function picOf(p) { return (p && (p.cover || p.pic || p.picUrl || p.coverImgUrl || p.tracks?.[0]?.pic)) || ''; }
  function showRoute(value) {
    value=['discover','search','notes','library','me','settings','detail','charts'].includes(value)?value:'discover';
    if (value==='detail' && !detail) value='library';
    route=value;
    document.querySelectorAll('.m-page').forEach(e=>{e.hidden=e.id!=='page-'+route;});
    document.querySelectorAll('.bottom-nav button').forEach(e=>{const active=e.dataset.nav===route||(route==='detail'&&(route===previousRoute)&&false);e.classList.toggle('active',e.dataset.nav===route);if(e.dataset.nav===route)e.setAttribute('aria-current','page');else e.removeAttribute('aria-current');});
    $('mobileMain').scrollTop=0;
    closeDrawer();
    if(route==='library') renderLibrary();
    if(route==='me') renderMe();
    if(route==='notes') renderNotes();
    if(route==='search') renderSearchWelcome();
    if(route==='charts') loadChartsPage();
  }
  function navigate(value) { if(value!==route) { previousRoute=route==='detail'?previousRoute:route; location.hash=value; } else showRoute(value); }
  function savePlaylists() { global.XYSync?.stampPlaylists(playlists); save('uzz.playlists',playlists); renderCounts(); if(route==='library')renderLibrary(); }
  function renderCounts() { const f=$('favCount'); if(f) f.textContent=Player.getFavorites().length; const h=$('historyCount'); if(h) h.textContent=Player.getHistory().length; const p=$('playlistCount'); if(p) p.textContent=playlists.length; renderMeStats(); }
  // 我的页（v3.3.0 网易云风格）：数据 + 歌单列表（左图右文）
  function renderMe() {
    renderCounts(); renderAuth();
    const pl=[...playlists,...cloudPlaylists].slice(0,8);
    $('mePlaylists').innerHTML=pl.map(p=>'<button class="me-row" data-local="'+escape(p.id)+'"><img loading="lazy" src="'+escape(cover(picOf(p)||p.cover))+'" alt=""><span><strong>'+escape(p.name)+'</strong><small>歌单 · '+(p.tracks?.length||0)+' 首'+(p.cloudId?' · 云端':'')+'</small></span></button>').join('') || '<p class="muted" style="padding:14px 4px;">还没有歌单，去首页看看推荐，或搜索喜欢的歌。</p>';
    paintMeRecent();
    renderMeStats();
  }
  // 「我的」页最近常听：2 列小卡，与其它页的列表/网格形态都不同
  function paintMeRecent() {
    const box=$('meRecent'); if(!box)return;
    const rows=(Player.getHistory()||[]).slice(0,6);
    box.innerHTML=rows.length?rows.map((t,i)=>'<button class="recent-card" data-recent-index="'+i+'"><img loading="lazy" src="'+escape(cover(t.pic))+'"><span><strong>'+escape(t.name||'未知歌曲')+'</strong><small>'+escape(t.artist||'')+'</small></span></button>').join(''):'<p class="muted" style="grid-column:1/-1;padding:6px 2px;">还没有播放记录，去首页听首歌吧。</p>';
    recentRows=rows;
  }
  let recentRows=[];
  // 「我的」页四项统计（v3.4.0）：全部由真实本机数据推导，不再是写死的假数字
  function meStats() {
    const favs=Player.getFavorites()||[];
    const hist=Player.getHistory()||[];
    // 关注 = 本机收藏过的歌手数；粉丝 = 云端收藏数（未登录为 0）
    const artists=new Set();
    for(const t of favs){const a=(t&&t.artist||'').trim();if(a)artists.add(a);}
    const cloudFavs=XYCloud.user?read('xy.android.cloudFavCount',0):0;
    // 等级：按本机听歌量与收藏量综合评定（1-20 级）
    const score=favs.length*3+hist.length;
    const level=Math.min(20,Math.max(1,Math.floor(score/12)+1));
    return {follows:artists.size,fans:Number(cloudFavs)||0,level};
  }
  function renderMeStats(){
    const s=meStats();
    const set=(id,v)=>{const el=$(id);if(el)el.textContent=v;};
    set('meFollow',s.follows); set('meFans',s.fans);
    const lv=$('meLevel'); if(lv) lv.textContent=s.level;
    // 等级进度条：每 12 分升一级。score%12===0 表示刚升过级 → 还差满 12 分
    const score=(Player.getFavorites()||[]).length*3+(Player.getHistory()||[]).length;
    const rem=score%12;
    const pct=rem===0?0:Math.round(rem/12*100);
    const bar=$('meLevelBar'); if(bar)bar.style.width=pct+'%';
    const txt=$('meLevelText');
    if(txt)txt.textContent='Lv.'+s.level+' · 距下一级 '+(12-rem)+' 分';
  }
  // 笔记页（v3.3.0）：用发现页数据生成双列瀑布流卡片
  let notesMode='feed';
  // v3.7.0：从本机已有的真实封面里建配图池，让每张笔记拿到不同的图
  function noteImagePool(){
    const out=[],push=v=>{if(typeof v==='string'&&/^https?:/.test(v)&&!out.includes(v))out.push(v);};
    const d=read('xy.android.discovery',null)||{};
    (d.playlists||[]).forEach(p=>push(picOf(p)));
    (d.charts||[]).forEach(c=>push(c.cover||c.pic));
    (Player.getHistory()||[]).forEach(t=>push(t.pic));
    (Player.getFavorites()||[]).forEach(t=>push(t.pic));
    (read('xy.android.hotArtists',[])||[]).forEach(a=>push(a.pic));
    return out;
  }
  function renderNotes() {
    const cached=read('xy.android.discovery',null);
    const pools=[];
    (cached?.charts||[]).forEach(c=>pools.push({kind:'chart',data:c}));
    (cached?.playlists||[]).forEach(p=>pools.push({kind:'playlist',data:p}));
    // 「关注」= 用户自己创建/收藏的歌单 + 本机收藏歌曲所属的歌手卡片（真实数据，不再是隔项假切片）
    let src;
    if(notesMode==='follow'){
      const mine=playlists.map(p=>({kind:'playlist',data:{id:p.id,name:p.name,cover:p.cover,playCount:0,local:true}}));
      const artistCards=[];
      const seen=new Set();
      for(const t of (Player.getFavorites()||[])){
        const a=(t.artist||'').trim(); if(!a||seen.has(a))continue; seen.add(a);
        artistCards.push({kind:'artist',data:{id:t.artistId||a,name:a,pic:t.pic}});
      }
      src=mine.concat(artistCards);
    } else src=pools;
    const grid=$('notesGrid'), emptyBox=$('notesEmpty');
    const feedTitle=$('notesFeedTitle'), feedTip=$('notesFeedTip');
    if(feedTitle)feedTitle.textContent=notesMode==='follow'?'我的关注':'广场';
    if(feedTip)feedTip.textContent=notesMode==='follow'?'你收藏的歌手与歌单':'正在发生的音乐话题';
    paintNotesTimeline(src);
    const imgPool=noteImagePool(), usedPic=new Set();
    const html=src.slice(0,12).map((n,i)=>{
      const d=n.data;
      // 每条笔记优先用自己的封面；缺失或重复时从真实封面池里取一张没用过的
      let pic=n.kind==='artist'?(d.pic||''):(d.cover||d.pic||d.picUrl||'');
      if(!pic||usedPic.has(pic))pic=imgPool.find(u=>!usedPic.has(u))||imgPool[i%Math.max(1,imgPool.length)]||'';
      if(pic)usedPic.add(pic);
      const name=d.name||'音乐卡片';
      const desc=n.kind==='chart'?(d.desc||'热歌榜单'):n.kind==='artist'?'你喜欢的歌手':(d.local?'我创建的歌单':'精选歌单 · '+(d.playCount?Math.floor(Number(d.playCount)/10000)+'万次播放':'值得一听'));
      const likes=n.kind==='artist'?0:(1200+i*337);
      const attr=n.kind==='chart'?'data-action="charts"':n.kind==='artist'?'data-action="openArtist" data-artist="'+escape(d.id)+'" data-artist-name="'+escape(name)+'"':(d.local?'data-local-playlist="'+escape(d.id)+'"':'data-online="'+escape(d.id)+'" data-title="'+escape(name)+'"');
      return '<button class="note-card" '+attr+'><img loading="lazy" src="'+escape(cover(pic))+'" alt=""><span class="note-user"><em>'+escape((name.length>1?name.slice(0,1):'杨'))+'</em>'+escape(name.slice(0,10))+'</span><strong>'+escape(name)+'</strong><small>'+escape(desc)+'</small><span class="note-meta">'+(likes?'♥ '+String(likes).slice(0,2)+'.'+String(likes)[2]+'k · ':'')+(3+i*2)+' 评论</span></button>';
    }).join('');
    grid.innerHTML=html;
    if(emptyBox){
      const isEmpty=!html;
      emptyBox.hidden=!isEmpty;
      emptyBox.textContent=isEmpty?(notesMode==='follow'?'还没有关注的歌单或歌手。收藏喜欢的歌，或去首页逛逛歌单，这里就会显示你的专属内容。':'笔记正在准备中，先去首页听几首歌吧。'):'';
    }
  }
  function renderSearchWelcome() {
    $('searchHistory').innerHTML=searchHistory.length?searchHistory.slice(0,10).map(t=>'<button data-query="'+escape(t)+'">'+escape(t)+'</button>').join(''): '<span class="muted">最近搜索会出现在这里</span>';
  }
  /* ---------- 笔记页「今日精选」时间线（v3.5.0）---------- */
  // 笔记页顶部是一条按天排的横向时间线，与下面的瀑布流形成层次。
  const NOTE_DAYS = ['今天','昨天','前天','3 天前','4 天前','5 天前','一周前'];
  function paintNotesTimeline(src) {
    const box=$('notesTimeline'); if(!box)return;
    const items=(src||[]).slice(0,7);
    if(!items.length){box.innerHTML='';return;}
    const pool=noteImagePool();
    box.innerHTML=items.map((n,i)=>{
      const d=n.data||{};
      let pic=d.cover||d.pic||d.picUrl||'';
      if(!pic)pic=pool[i%Math.max(1,pool.length)]||'';
      const name=d.name||'音乐卡片';
      const attr=n.kind==='chart'?'data-action="charts"':n.kind==='artist'?'data-action="openArtist" data-artist="'+escape(d.id||'')+'" data-artist-name="'+escape(name)+'"':(d.local?'data-local-playlist="'+escape(d.id||'')+'"':'data-online="'+escape(d.id||'')+'" data-title="'+escape(name)+'"');
      return '<button class="tl-card" '+attr+'><img loading="lazy" src="'+escape(cover(pic))+'"><span class="tl-date">'+NOTE_DAYS[i%NOTE_DAYS.length]+'</span><strong>'+escape(name)+'</strong><small>'+escape(d.desc||(n.kind==='artist'?'你喜欢的歌手':'精选音乐卡片'))+'</small></button>';
    }).join('');
  }
  async function loadHot() {
    // 热词云：按热度分档字号（w1 最热 → w6 最冷），搜索页专属视觉
    try {
      const r=await UzzApi.suggest('');
      const words=(r.hot||[]).map(t=>typeof t==='string'?t:(t.searchWord||t.name||t.keyword||'')).filter(Boolean);
      $('hotSearches').innerHTML=words.slice(0,18).map((name,i)=>{
        const w=i===0?'w1':i===1?'w2':i<4?'w3':i<7?'w4':i<12?'w5':'w6';
        return '<button class="'+w+'" data-query="'+escape(name)+'"><b>'+String(i+1).padStart(2,'0')+'</b>'+escape(name)+'</button>';
      }).join('') || empty('输入关键词，发现你想听的音乐');
    }
    catch { $('hotSearches').innerHTML=empty('热搜暂时不可用，你仍可直接输入关键词搜索。'); }
  }
  // 从搜索框输入里识别「歌名 + 歌手」。
  // 用户输入习惯有两种：
  //   「晴天 - 周杰伦」  → 明确分隔，最可靠
  //   「周杰伦 晴天」/「晴天 周杰伦」→ 空格分隔，靠歌手词典判断
  // 识别出的歌手会传给后端做歌手强匹配，把该歌手的版本置顶。
  const ARTIST_HINTS = ['周杰伦','林俊杰','陈奕迅','薛之谦','张杰','邓紫棋','五月天','王菲','张学友','李宗盛','陶喆','许巍','朴树','汪峰','毛不易','赵雷','李荣浩','周深','蔡依林','孙燕姿','莫文蔚','那英','田馥甄','许嵩','汪苏泷','张碧晨','刘惜君','单依纯','胡彦斌','梁静茹','任贤齐','刘若英','费玉清','陈奕迅','周杰伦','李宇春','韩红','张敬轩','关喆','金志文','刘瑞琦','陈鸿宇','毛不易'];
  function parseArtistHint(keyword) {
    const kw = String(keyword || '').trim();
    const sep = kw.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    if (sep) {
      const a = sep[1].trim(), b = sep[2].trim();
      const aHit = ARTIST_HINTS.some(h => a.includes(h));
      const bHit = ARTIST_HINTS.some(h => b.includes(h));
      if (bHit && !aHit) return { title: a, artist: b };
      return { title: a, artist: b };
    }
    const parts = kw.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return { title: kw, artist: '' };
    for (const p of parts) {
      if (ARTIST_HINTS.some(h => p.includes(h) || h.includes(p))) {
        return { title: parts.filter(x => x !== p).join(' ') || kw, artist: p };
      }
    }
    return { title: kw, artist: '' };
  }
  // v3.6.0：四个 Tab 各自的数据加载与提示文案，绝不共用一套渲染
  const SEARCH_KIND_HINT = {
    song: '单曲 · 原唱强匹配，翻唱 / 伴奏版本已剔除',
    artist: '歌手 · 多源去重，合并为唯一歌手卡片',
    album: '专辑 · 定向加载专辑封面与歌手信息',
    playlist: '歌单 · 定向加载歌单封面与曲目数',
  };
  const SEARCH_KIND_UNIT = { song: '首歌曲', artist: '位歌手', album: '张专辑', playlist: '个歌单' };
  const SEARCH_BOX_IDS = ['mobileResults', 'searchArtists', 'searchAlbums', 'searchPlaylists', 'searchGrid'];
  async function search(more=false) {
    const keyword=$('mobileSearchInput').value.trim(); if(!keyword)return;
    searchAbort?.abort(); searchAbort=new AbortController(); const ticket=++searchGeneration;
    if(!more || keyword!==searchKeyword){searchPage=1;searchRows=[];}else searchPage++;
    searchKeyword=keyword; searchHistory=[keyword,...searchHistory.filter(s=>s!==keyword)].slice(0,20); save('uzz.searchHistory',searchHistory);
    $('searchWelcome').hidden=true; $('searchResults').hidden=false; $('searchSummary').textContent='正在寻找好声音…'; $('searchMore').hidden=true;
    // 切换 Tab / 新搜索时把四个容器全清掉，避免上一类结果残留
    if(!more){ SEARCH_BOX_IDS.forEach(id=>{const b=$(id);if(b){b.innerHTML='';b.hidden=true;}}); }
    // 歌手识别：命中时后端会把该歌手的版本置顶并硬剔除翻唱
    const hint = more ? (searchArtistHint ? {title:keyword,artist:searchArtistHint} : parseArtistHint(keyword)) : parseArtistHint(keyword);
    searchArtistHint = hint.artist || '';
    // 定向加载：歌手多取一些（去重后会少），其余按 20 条分页
    const kindLimit = searchType==='artist' ? 24 : 20;
    try {
      const r=await UzzApi.search(keyword,searchType,searchPage,kindLimit,searchAbort.signal,hint.artist); if(ticket!==searchGeneration)return;
      searchRows=more?[...searchRows,...r.list]:r.list;
      searchDeduped=r.deduped||0; searchTargeted=!!r.targeted;
      // v3.6.1：上游超时降级回执——网络问题优先于版权提示，避免误导
      searchRelaxed=!!r.relaxed; searchDegraded=!!r.degraded; searchNetworkTimeout=!!r.networkTimeout;
      const artistNote=(searchType==='song'&&hint.artist)?' · 已锁定 '+hint.artist+' 原唱':'';
      $('searchSummary').textContent=searchNetworkTimeout
        ? '网络超时，请稍后重试（已临时放宽筛选，请注意辨别版本）'
        : r.noOriginal
          ? '暂无原唱版权：没有找到 '+(hint.artist||'该歌手')+' 的正版音源'
          : r.total?('找到 '+r.total+' '+(SEARCH_KIND_UNIT[searchType]||'个结果')+artistNote)
          : (searchDegraded?'上游响应较慢，暂未取到结果，可重试或切换音源':'暂未找到结果，试试其他关键词或音源');
      paintSearchResults();
      $('searchMore').hidden=r.list.length<kindLimit||searchRows.length>=r.total;
    } catch(e) {if(ticket!==searchGeneration)return; if(more)searchPage--; $('searchSummary').textContent='搜索失败：'+e.message; if(!more){$('mobileResults').hidden=false;$('mobileResults').innerHTML='<li>'+networkFailureBox('网络超时或服务未响应，请稍后重试。')+'</li>';}else $('searchMore').hidden=false;}
  }
  // 搜索结果四套完全不同的 UI（v3.6.0 阶段一）：
  //   单曲=带序号列表 / 歌手=圆形头像列表 / 专辑=方形图片网格 / 歌单=长条卡片
  function paintSearchResults() {
    SEARCH_BOX_IDS.forEach(id=>{const b=$(id);if(b){b.hidden=true;b.innerHTML='';}});
    const hintBox=$('searchKindHint');
    if(hintBox){
      let text=SEARCH_KIND_HINT[searchType]||'搜索结果';
      if(searchType==='artist'&&searchDeduped>0)text+=' · 已合并 '+searchDeduped+' 个重复项';
      else if(searchTargeted)text+=' · 已补充定向数据';
      hintBox.textContent=text; hintBox.hidden=false;
    }
    const rows=searchRows;
    // v3.6.1：网络故障 / 原唱未命中导致空列表时，给「重试 + 切换音源」两个出口
    const giveActions = searchNetworkTimeout || searchDegraded || (searchType==='song' && !!searchArtistHint);
    const emptyOrActions = (txt) => giveActions ? networkFailureBox(txt) : empty(txt);
    if(searchType==='song'){
      const box=$('mobileResults'); box.hidden=false;
      box.innerHTML = rows.length ? rows.map((t,i)=>
        '<li class="track-row"><span class="track-index">'+(i+1)+'</span>'+
        '<button class="track-main" data-track-list="search" data-track-index="'+i+'"><img loading="lazy" src="'+escape(cover(t.pic))+'"><span><strong>'+escape(t.name||'未知歌曲')+'</strong><small>'+escape([t.artist,t.album].filter(Boolean).join(' · '))+'</small></span></button></li>'
      ).join('') : emptyOrActions(searchNetworkTimeout||searchDegraded?'网络超时，暂未取到歌曲，请重试或切换音源。':(searchArtistHint?'暂无原唱版权，可重试或切换音源后再试。':'没有找到相关歌曲'));
      trackSets.set('search', rows);
      return;
    }
    if(searchType==='artist'){
      const box=$('searchArtists'); box.hidden=false;
      box.innerHTML = rows.length ? rows.map((t,i)=>
        '<button class="artist-circle-item" data-search-index="'+i+'">'+
        '<span class="artist-circle-art">'+(t.pic?'<img loading="lazy" src="'+escape(cover(t.pic))+'">':'<span>'+escape((t.name||'歌').slice(0,1))+'</span>')+'</span>'+
        '<span class="artist-circle-meta"><strong>'+escape(t.name||'未知歌手')+'</strong><small>歌手 · 点击查看热门歌曲'+(t._mergedCount>1?' · 合并 '+t._mergedCount+' 个来源':'')+'</small></span>'+
        '<span class="artist-circle-arrow">›</span></button>'
      ).join('') : emptyOrActions(searchDegraded?'网络超时，暂未取到歌手，请重试或切换音源。':'没有找到相关歌手');
      return;
    }
    if(searchType==='album'){
      const box=$('searchAlbums'); box.hidden=false;
      box.innerHTML = rows.length ? rows.map((t,i)=>
        '<button class="album-square" data-search-index="'+i+'">'+
        '<span class="album-square-art"><img loading="lazy" src="'+escape(cover(t.pic))+'"></span>'+
        '<strong>'+escape(t.name||'未知专辑')+'</strong><small>'+escape(t.artist||'专辑')+'</small></button>'
      ).join('') : emptyOrActions(searchDegraded?'网络超时，暂未取到专辑，请重试或切换音源。':'没有找到相关专辑');
      return;
    }
    const box=$('searchPlaylists'); box.hidden=false;
    box.innerHTML = rows.length ? rows.map((t,i)=>
      '<button class="playlist-strip" data-search-index="'+i+'">'+
      '<img loading="lazy" src="'+escape(cover(t.pic))+'">'+
      '<span class="strip-meta"><strong>'+escape(t.name||'未知歌单')+'</strong><small>'+escape('歌单 · '+(t.artist||'网易云')+(t.trackCount?(' · '+t.trackCount+' 首'):''))+'</small></span>'+
      '<span class="strip-count">'+(t.playCount?('▶ '+Math.round(t.playCount/10000)+'万'):'›')+'</span></button>'
    ).join('') : emptyOrActions(searchDegraded?'网络超时，暂未取到歌单，请重试或切换音源。':'没有找到相关歌单');
  }
  // ══════ 首页推荐池（v3.7.0）：一次拉大池，「换一批」本地轮换 + 后台刷新 ══════
  function rotateDiscover() {
    // 非推荐频道时「换一批」= 清空该频道缓存并重新拉专属内容，
    // 不能把别的频道容器覆盖成推荐歌单网格
    if(channel!=='recommend'&&CHANNELS[channel]){
      channelCache.delete(channel);
      loadChannel(channel);
      toast('已刷新「'+CHANNELS[channel].title+'」');
      return;
    }
    if (discoveryPool.length > 8) {
      discoveryOffset = (discoveryOffset + 8) % discoveryPool.length;
      paintDiscover({ playlists: discoveryPool, charts: chartsData });
      toast('已换一批推荐');
    }
    loadDiscover(true);   // 后台拉新池，不阻塞点击反馈
  }
  async function loadDiscover(force) {
    const ticket=++discoveryGeneration; const btn=$('refreshDiscover'); if(btn)btn.disabled=true;
    const cached=read('xy.android.discovery',null);
    if(cached){
      if(!discoveryPool.length)discoveryPool=cached.playlists||[];
      if(!chartsData.length)chartsData=cached.charts||[];
      if(channel==='recommend')paintDiscover(cached);
    } else { $('recommendations').innerHTML=empty('正在准备你的音乐首页…'); $('chartCards').innerHTML=''; }
    const results=await Promise.allSettled([UzzApi.getPlaylists('全部',30),UzzApi.getCharts()]); if(ticket!==discoveryGeneration)return;
    const data={playlists:results[0].status==='fulfilled'?results[0].value:cached?.playlists||[],charts:results[1].status==='fulfilled'?results[1].value:cached?.charts||[]};
    if(data.playlists.length){
      discoveryPool=data.playlists;
      // 后台刷新池时保留当前「换一批」的位置，否则刚换的那批会被立刻覆盖回去
      discoveryOffset=discoveryOffset%Math.max(1,data.playlists.length);
    }
    if(data.charts.length)chartsData=data.charts;
    if(channel==='recommend')paintDiscover(data);
    if(data.playlists.length||data.charts.length)save('xy.android.discovery',data);
    if(route==='notes')renderNotes();
    if(results[0].status==='rejected'&&!data.playlists.length&&channel==='recommend')$('recommendations').innerHTML=networkFailureBox('推荐歌单暂时没取到，请重试或切换音源。');
    if(btn)btn.disabled=false;
    loadHotArtists();   // 每次进首页都实时刷新热门歌手
  }
  function paintDiscover(data) {
    const pool=discoveryPool.length?discoveryPool:(data.playlists||[]);
    const picks=pool.length>8?Array.from({length:8},(_,i)=>pool[(discoveryOffset+i)%pool.length]):pool;
    $('recommendations').innerHTML=picks.filter(p=>picOf(p)).map(p=>
      '<button class="cover-card" data-online="'+escape(p.id)+'" data-title="'+escape(p.name)+'"><div class="cover-art"><img loading="lazy" src="'+escape(cover(picOf(p)))+'" alt=""><span class="cover-count">▷ '+(Number(p.playCount)>10000?Math.floor(p.playCount/10000)+'万':Number(p.playCount)||'精选')+'</span></div><strong>'+escape(p.name)+'</strong><small>精选歌单 · 发现你的下一首喜欢</small></button>'
    ).join('') || empty('暂无推荐，先去搜索喜欢的歌曲吧。');
    // 排行榜 2x2 宫格：整块跳独立榜单页，不再在首页滚动
    const cs=(chartsData.length?chartsData:(data.charts||[])).slice(0,4);
    $('chartCards').innerHTML=cs.length?cs.map((c,i)=>
      '<button class="cp-card" data-nav="charts" data-chart-id="'+escape(c.id)+'"><span class="cp-rank">TOP '+String(i+1).padStart(2,'0')+'</span><span class="cp-icon">'+escape(c.icon||'🎵')+'</span><strong>'+escape(c.name)+'</strong><small>'+escape(c.desc||'实时榜单')+'</small></button>'
    ).join(''):'<button class="cp-card" data-nav="charts"><span class="cp-icon">🎵</span><strong>全部榜单</strong><small>查看各大实时榜单</small></button>';
    paintHotArtists(read('xy.android.hotArtists',null));
  }
  /* ---------- 首页「热门歌手」横滑（v3.7.0 实时拉取）---------- */
  function paintHotArtists(list) {
    const box=$('hotArtists'); if(!box)return;
    if(!list||!list.length){box.innerHTML='';return;}
    box.innerHTML=list.map(a=>'<button class="artist-chip" data-action="openArtist" data-artist="'+escape(a.id||'')+'" data-artist-name="'+escape(a.name)+'"><img loading="lazy" src="'+escape(cover(a.pic))+'"><span>'+escape(a.name)+'</span></button>').join('');
  }
  async function loadHotArtists() {
    const box=$('hotArtists'); if(!box)return;
    // 先画缓存保证首屏不空，但不再 return —— 每次都发起网络请求刷新真实热歌榜
    const cached=read('xy.android.hotArtists',null);
    if(cached&&cached.length)paintHotArtists(cached);
    try{
      const charts=chartsData.length?chartsData:await UzzApi.getCharts();
      if(charts.length&&!chartsData.length)chartsData=charts;
      const chart=charts[0]; if(!chart)return;
      const r=await UzzApi.getPlaylist(chart.id,60);
      const seen=new Set(),list=[];
      for(const t of (r.tracks||[])){
        const a=(t.artist||'').trim(); if(!a||seen.has(a))continue;
        seen.add(a); list.push({id:t.artistId||'',name:a,pic:t.pic||''});
        if(list.length>=12)break;
      }
      if(list.length){save('xy.android.hotArtists',list);paintHotArtists(list);}
    }catch(e){/* 热门歌手为增强项，失败保留上次结果 */}
  }
  // ══════ 排行榜独立页（v3.7.0）：榜单宫格 + 页内 Top10，不再跳走 ══════
  async function loadChartsPage() {
    const box=$('chartsFullGrid'); if(!box)return;
    if(!chartsData.length){
      box.innerHTML=empty('正在加载各大榜单…');
      try{ chartsData=await UzzApi.getCharts(); }
      catch(e){ box.innerHTML=failure(e.message||'榜单加载失败','charts'); return; }
    }
    paintChartsPage();
    const want=pendingChartId||activeChartId||chartsData[0]?.id||'';
    pendingChartId='';
    if(want)await selectChart(want);
  }
  function paintChartsPage() {
    const box=$('chartsFullGrid'); if(!box)return;
    box.innerHTML=chartsData.map(c=>
      '<button data-chart-pick="'+escape(c.id)+'" class="'+(String(c.id)===String(activeChartId)?'active':'')+'"><span class="cps-icon">'+escape(c.icon||'🎵')+'</span><span class="cps-meta"><strong>'+escape(c.name)+'</strong><small>'+escape(c.desc||'实时榜单')+'</small></span></button>'
    ).join('')||empty('暂无榜单数据');
    hydrate(box);
  }
  async function selectChart(id) {
    activeChartId=String(id);
    const chart=chartsData.find(c=>String(c.id)===String(id))||chartsData[0];
    document.querySelectorAll('#chartsFullGrid button').forEach(b=>b.classList.toggle('active',b.dataset.chartPick===String(id)));
    const title=$('chartsDetailTitle'), tip=$('chartsDetailTip'), ul=$('chartsTracks');
    if(title)title.textContent=chart?.name||'榜单金曲';
    if(tip)tip.textContent='实时 Top 10';
    if(ul)ul.innerHTML=empty('正在加载「'+(chart?.name||'榜单')+'」…');
    try{
      const r=await UzzApi.getPlaylist(id,10);
      const tracks=r.tracks||[];
      trackSets.set('charts',tracks);
      if(ul)ul.innerHTML=tracks.length?tracks.map((t,i)=>
        '<li class="track-row"><span class="track-index">'+(i+1)+'</span><button class="track-main" data-track-list="charts" data-track-index="'+i+'"><img loading="lazy" src="'+escape(cover(picOf(t)))+'" alt=""><span><strong>'+escape(t.name||'未知歌曲')+'</strong><small>'+escape(t.artist||'')+'</small></span></button></li>'
      ).join(''):empty('暂无曲目，换个榜单看看');
    }catch(e){ if(ul)ul.innerHTML=failure(e.message||'榜单曲目加载失败','charts'); }
  }
  // ══════ 首页频道（v3.7.0）：五个 Tab 的数据源 + 渲染形态完全区分 ══════
  const CHANNELS = {
    recommend: { title:'为你推荐',        cls:'cover-grid',        tip:'根据你的口味 · 每日更新' },
    music:     { title:'音乐 · 新歌速递', cls:'channel-music',     tip:'热歌榜实时金曲' },
    podcast:   { title:'播客 · 声音节目', cls:'channel-podcast',   tip:'有声节目与故事',   kw:'播客' },
    audiobook: { title:'听书 · 知识有声', cls:'channel-audiobook', tip:'文学作品与知识',   kw:'有声书' },
    radio:     { title:'电台 · 频率',     cls:'channel-radio',     tip:'背景音乐与电台',   kw:'电台' },
    fm:        { title:'私人FM',          cls:'fm-list',           tip:'根据你的红心随机推荐' },
  };
  // 每个频道用不同 API 组合拿数据，避免六个 Tab 只是同一批歌单换分类名
  async function channelLoad(key,cfg){
    if(channelCache.has(key))return channelCache.get(key);
    let rows=[];
    if(key==='music'){
      const charts=chartsData.length?chartsData:await UzzApi.getCharts();
      const id=charts[1]?.id||charts[0]?.id;   // 新歌榜 → 真实单曲
      if(id){const r=await UzzApi.getPlaylist(id,20);rows=r.tracks||[];}
    }else{
      const r=await UzzApi.search(cfg.kw,'playlist',1,12);
      rows=(r.list||[]).filter(p=>p&&p.id);
      if(!rows.length)rows=await UzzApi.getPlaylists('全部',12);
    }
    channelCache.set(key,rows);
    return rows;
  }
  function channelPaint(key,rows,cfg){
    if(key==='music'){
      trackSets.set('channelMusic',rows);
      return rows.length?rows.slice(0,20).map((t,i)=>
        '<button class="cm-row" data-track-list="channelMusic" data-track-index="'+i+'"><span class="cm-idx">'+String(i+1).padStart(2,'0')+'</span><img loading="lazy" src="'+escape(cover(picOf(t)))+'" alt=""><span class="cm-meta"><strong>'+escape(t.name||'未知歌曲')+'</strong><small>'+escape([t.artist,t.album].filter(Boolean).join(' · '))+'</small></span></button>'
      ).join(''):empty('新歌榜暂时没有内容');
    }
    const open=(p)=>'data-online="'+escape(p.id)+'" data-title="'+escape(p.name)+'"';
    const pic=(p)=>escape(cover(picOf(p)));
    if(key==='podcast')return rows.map(p=>
      '<button class="pod-card" '+open(p)+'><img loading="lazy" src="'+pic(p)+'" alt=""><span class="pod-meta"><span class="pod-tag">播客节目</span><strong>'+escape(p.name)+'</strong><small>'+escape(p.artist||cfg.tip)+'</small></span></button>'
    ).join('')||empty('暂无播客内容');
    if(key==='audiobook')return rows.map(p=>
      '<button class="ab-card" '+open(p)+'><span class="ab-cover"><img loading="lazy" src="'+pic(p)+'" alt=""></span><strong>'+escape(p.name)+'</strong><small>'+escape(p.artist||'有声书')+'</small></button>'
    ).join('')||empty('暂无听书内容');
    return rows.map(p=>
      '<button class="radio-card" '+open(p)+'><span class="radio-art"><img loading="lazy" src="'+pic(p)+'" alt=""></span><strong>'+escape(p.name)+'</strong></button>'
    ).join('')||empty('暂无电台内容');
  }
  async function loadChannel(key) {
    channel = key;
    const cfg = CHANNELS[key] || CHANNELS.recommend;
    document.querySelectorAll('.home-tabs button').forEach(b=>{
      const on = b.dataset.channel === key;
      b.classList.toggle('active', on);
      if(on) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
    });
    const title=$('discoverSectionTitle'); if(title) title.textContent=cfg.title;
    const box=$('recommendations'); if(!box)return;
    box.className='';
    // 「推荐」频道：复用首页推荐池 / 榜单宫格
    if(key==='recommend'){
      box.classList.add('cover-grid');
      const cached=read('xy.android.discovery',null);
      if(cached)paintDiscover(cached); else await loadDiscover();
      return;
    }
    if(key==='fm'){
      box.classList.add('fm-list');
      box.innerHTML=empty('正在为你挑选私人FM…');
      try{
        const favs=Player.getFavorites()||[];
        const seed=favs[0];
        let tracks=[];
        if(seed&&seed.id&&seed.vendor) tracks=await UzzApi.getSimi(seed.id,seed.vendor,12).catch(()=>[]);
        if(!tracks.length){
          const charts=chartsData.length?chartsData:await UzzApi.getCharts();
          const chart=charts[0];
          if(chart) tracks=(await UzzApi.getPlaylist(chart.id,12).catch(()=>({tracks:[]}))).tracks||[];
        }
        box.innerHTML=tracks.length?tracks.map((t,i)=>'<button class="fm-row" data-fm-index="'+i+'"><span class="fm-idx">'+String(i+1).padStart(2,'0')+'</span><img loading="lazy" src="'+escape(cover(picOf(t)))+'" alt=""><span class="fm-meta"><strong>'+escape(t.name||'未知歌曲')+'</strong><small>'+escape(t.artist||'')+'</small></span><span class="fm-play" data-icon="play"></span></button>').join(''):empty('还没有足够的红心数据，先去收藏几首歌，私人FM会更懂你。');
        hydrate(box);
        trackSets.set('fm',tracks);
        bindFmRows();
      }catch(e){ box.className='cover-grid'; box.innerHTML=failure(e.message||'私人FM加载失败','retryChannel'); }
      return;
    }
    // 音乐 / 播客 / 听书 / 电台：各自专属容器类 + 专属卡片结构
    box.className=cfg.cls;
    box.innerHTML=empty('正在加载「'+cfg.title+'」…');
    try{
      const rows=await channelLoad(key,cfg);
      box.innerHTML=channelPaint(key,rows,cfg);
      hydrate(box);
    }catch(e){ box.innerHTML=failure(e.message||'频道加载失败','retryChannel'); }
  }
  function bindFmRows(){
    const list=trackSets.get('fm')||[];
    document.querySelectorAll('[data-fm-index]').forEach(b=>{
      b.onclick=()=>{const t=list[Number(b.dataset.fmIndex)]; if(t) play(t);};
    });
  }
  // 打开歌手主页（笔记页「关注」里的歌手卡片）
  async function openArtist(id,name) {
    if(!id)return toast('该歌手暂无作品数据');
    await openOnline('artist:'+id,name,async()=>({info:{name,cover:''},tracks:await UzzApi.getArtistTop(id,100)}));
  }
  function paintDetail() {
    if(!detail)return; $('detailTitle').textContent=detail.name; $('detailKind').textContent=detail.localId?'我的歌单':'精选音乐'; $('detailSummary').textContent=detail.tracks.length+' 首歌曲'; $('detailCover').src=cover(detail.cover); $('detailTracks').innerHTML=tracksHtml(detail.tracks,'detail'); $('detailSave').hidden=!!detail.localId||detail.loading; $('detailRename').hidden=!detail.localId; $('detailPlayAll').disabled=!detail.tracks.length; $('detailStatus').textContent=detail.loading?'正在加载歌单…':detail.error||'';
  }
  async function openOnline(id,name,loader) {
    const ticket=++detailGeneration; detail={id,name:name||'歌单',tracks:[],loading:true}; navigate('detail');paintDetail();
    try {const r=await(loader?loader():UzzApi.getPlaylist(id,100));if(ticket!==detailGeneration)return;detail={id,name:r.info?.name||name||'歌单',cover:r.info?.cover||r.info?.pic||r.tracks[0]?.pic,tracks:r.tracks||[],loading:false};paintDetail();}
    catch(e){if(ticket===detailGeneration){detail.loading=false;detail.error='加载失败：'+e.message;paintDetail();}}
  }
  function openLocal(id) {
    const p=playlists.find(p=>p.id===id)||cloudPlaylists.find(p=>p.id===id);if(!p)return;
    detailGeneration++;detail={localId:p.cloudId?undefined:id,name:p.name,cover:p.cover,tracks:p.tracks||[]};navigate('detail');paintDetail();
  }
  // v3.6.1：读取电脑端也在用的 user_playlists 表。此前手机只走本地歌单 +
  // 废弃的 user_music_state 同步，导致电脑收藏的歌单在手机上永远看不到。
  async function loadCloudPlaylists() {
    if(!XYCloud.user||typeof global.getPlaylists!=='function'||cloudPlPending)return;
    cloudPlPending=true;
    try {
      const rows=await global.getPlaylists();
      const conv=global.XYCloud?.favoriteToTrack;
      cloudPlaylists=(rows||[]).map(r=>({
        id:'cloud:'+r.id, cloudId:r.id, name:r.name||'云端歌单', cover:'', kind:'collected',
        tracks:(r.tracks||[]).map(t=>conv?conv({song_name:t.name,song_url:t.url}):null).filter(x=>x&&x.id&&x.vendor),
      }));
      cloudPlAt=Date.now();
      if(route==='library'&&libraryTab==='playlists')renderLibrary();
    } catch(e) { /* 云端不可用时保留本机歌单，不打断使用 */ }
    finally { cloudPlPending=false; }
  }
  async function openSearchResult(index) {
    const t=searchRows[index];if(!t)return;
    // v3.6.0：从搜索结果点播时把「搜索词歌手 / 显示歌手」作为强约束传给播放链，
    // 解析出的音频歌手对不上，后端直接回「暂无原唱版权」，绝不放翻唱。
    // v3.6.1：上游超时且已放宽筛选时不再用严格模式点播，避免「搜得到却全被拦」
    if(searchType==='song')return play(t, !searchRelaxed);
    if(searchType==='artist')return openOnline('artist:'+t.id,t.name,async()=>({info:{name:t.name,cover:t.pic},tracks:await UzzApi.getArtistTop(t.id,100)}));
    if(searchType==='album'){
      // 定向兜底生成的专辑卡没有平台数字 id，按专辑名拉同专辑歌曲
      if(String(t.id||'').startsWith('albumname:'))return openOnline('albumname:'+t.name,t.name,async()=>{
        const r=await UzzApi.search(t.name,'song',1,40);
        return {info:{name:t.name,cover:t.pic},tracks:r.list};
      });
      return openOnline('album:'+t.id,t.name,()=>UzzApi.getAlbum(t.id));
    }
    return openOnline(t.id,t.name);
  }
  function play(track, fromSearch) {
    if(!track)return;
    if(fromSearch){
      const want=searchArtistHint||track.artist||'';
      track={...track, expectArtist:want, strictOriginal:1};
    }
    Player.loadAndPlay(track).catch(e=>toast(e.message));
  }
  function renderLibrary() {
    document.querySelectorAll('[data-library]').forEach(e=>e.classList.toggle('active',e.dataset.library===libraryTab));
    renderLibraryStats();
    if(libraryTab==='playlists') {
      // 歌单用大图网格（与「喜欢/最近」的列表形态区分）
      // v3.6.1：把云端 user_playlists（电脑端共用）与本机歌单合并展示
      const all=[...playlists,...cloudPlaylists];
      $('libraryContent').innerHTML=all.length?'<div class="lib-grid">'+all.map(p=>'<button data-local-playlist="'+escape(p.id)+'"><img loading="lazy" src="'+escape(cover(p.cover||p.tracks?.[0]?.pic))+'" alt=""><strong>'+escape(p.name)+'</strong><small>'+(p.tracks?.length||0)+' 首 · '+(p.cloudId?'云端歌单':(p.kind==='collected'?'已保存':'我创建'))+'</small></button>').join('')+'</div>':empty('把喜欢的音乐装进歌单。点右上角 ＋ 创建第一张歌单。');
      if(XYCloud.user&&!cloudPlPending&&Date.now()-cloudPlAt>60000)loadCloudPlaylists();
    } else if(libraryTab==='local') {
      $('libraryContent').innerHTML='<button class="primary wide-button" data-action="importLocal">＋ 选择本机音乐文件</button><p class="muted">音频不上传。无法保存读取授权的文件会复制到应用内部（单个文件最多 256MB），卸载应用会移除副本，原文件仍保留。播放能力取决于文件编码与设备支持。</p>'+(localTracks.some(t=>!t.persistent)?'<p class="muted">部分文件是临时授权；重启后无法播放时，请重新选择文件授权。</p>':'')+'<ul class="track-list">'+tracksHtml(localTracks,'local')+'</ul>';
    } else if(libraryTab==='cloud') {
      if(!XYCloud.user){$('libraryContent').innerHTML=empty('登录后，在这里查看云端收藏。')+'<button class="wide-button" data-action="account">登录云端账户</button>';return;}
      $('libraryContent').innerHTML='<button class="wide-button" data-action="refreshCloud">刷新云端收藏</button><ul id="mobileCloudList" class="track-list">'+tracksHtml(cloudRows,'cloud')+'</ul><p class="muted">云端保存的旧音频链接可能过期；本机歌单会在播放时重新解析地址。</p>';
      if(!cloudRows.length)refreshCloud();
    } else if(libraryTab==='history') {
      // 最近播放按时间分组（今天/昨天/更早）——列表页也有结构感
      const rows=Player.getHistory()||[];
      const groups=groupByDay(rows);
      const body=Object.keys(groups).map(k=>'<div class="lib-group"><h3>'+k+'</h3><ul class="track-list">'+tracksHtml(groups[k],'library')+'</ul></div>').join('');
      $('libraryContent').innerHTML=rows.length?body:empty('还没有播放记录，去首页听听歌吧。');
    } else $('libraryContent').innerHTML='<ul class="track-list">'+tracksHtml(Player.getFavorites()||[],'library')+'</ul>';
    renderCounts();
  }
  // 音乐库统计条：四种资源一眼看清
  function renderLibraryStats() {
    const box=$('libraryStats'); if(!box)return;
    const favs=(Player.getFavorites()||[]).length;
    const hist=(Player.getHistory()||[]).length;
    const items=[{n:playlists.length,l:'张歌单'},{n:favs,l:'首喜欢'},{n:localTracks.length,l:'首本地'},{n:hist,l:'条最近'}];
    box.innerHTML=items.map(x=>'<div class="lib-stat"><strong>'+x.n+'</strong><span>'+x.l+'</span></div>').join('');
  }
  // 最近播放按天分组
  function groupByDay(rows) {
    const now=Date.now();
    const g={'今天':[],'昨天':[],'更早':[]};
    for(const t of (rows||[])){
      const at=Number(t.at||0);
      const days=at?Math.floor((now-at)/86400000):99;
      if(days<=0)g['今天'].push(t); else if(days===1)g['昨天'].push(t); else g['更早'].push(t);
    }
    for(const k of Object.keys(g))if(!g[k].length)delete g[k];
    return g;
  }
  async function refreshCloud() {
    if(!XYCloud.user)return;const ticket=++cloudGeneration,authTicket=authGeneration;
    const ul=$('mobileCloudList');if(ul)ul.innerHTML=empty('正在读取云端收藏…');
    try {const rows=await getFavorites();if(ticket!==cloudGeneration||authTicket!==authGeneration)return;cloudRows=rows.map(r=>XYCloud.favoriteToTrack(r)).filter(Boolean);save('xy.android.cloudFavCount',rows.length);renderMeStats();if($('mobileCloudList'))$('mobileCloudList').innerHTML=tracksHtml(cloudRows,'cloud');}
    catch(e){if(ticket===cloudGeneration&&authTicket===authGeneration&&$('mobileCloudList'))$('mobileCloudList').innerHTML='<li>'+failure(e.message,'refreshCloud')+'</li>';}
  }
  function chooseLibrary(value) {libraryTab=value;navigate('library');renderLibrary();}
  function createPlaylist() { sheet('新建歌单','<form id="playlistCreateForm"><label>歌单名称<input id="newPlaylistName" maxlength="60" placeholder="给喜欢的音乐起个名字" required></label><button class="primary wide-button" type="submit">创建歌单</button></form>'); }
  function trackMenu(track,scope) {
    if(!track)return;selectedTrack=track;
    let html='<p class="muted">'+escape(track.artist||'小杨音乐')+'</p><button class="sheet-action" data-action="enqueue"><span data-icon="queue"></span>加入播放队列</button><button class="sheet-action" data-action="addToPlaylist"><span data-icon="plus"></span>添加到歌单</button><button class="sheet-action" data-action="deviceFavorite"><span data-icon="heart"></span>'+(Player.getFavorites().some(t=>keyOf(t)===keyOf(track))?'取消本机喜欢':'保存到本机喜欢')+'</button>';
    // v3.4.0：接入进阶功能（桌面端已有，移动端此前完全缺失）
    if(track.vendor!=='device'&&track.id)html+='<button class="sheet-action" data-action="songWiki"><span data-icon="spark"></span>歌曲百科</button><button class="sheet-action" data-action="similarSongs"><span data-icon="library"></span>相似推荐</button>';
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
  function renderLyrics(){
    const state=Player.getState();
    const lines=state.lyrics||[];
    const trans=state.tlyrics||[];
    const useTrans=localStorage.getItem('uzz.lyricTrans')==='1'&&trans.length>0;
    if(!lines.length){
      $('mobileLyrics').innerHTML=empty('暂无歌词，享受这一刻的旋律。');
      const tb=$('lyricTrans'); if(tb){tb.disabled=true;tb.textContent='翻译';}
      return;
    }
    // 翻译开启时按时间轴合并原文与译文
    const map=new Map();
    for(const l of trans)map.set(Math.round(l.t*10),l.text);
    $('mobileLyrics').innerHTML=lines.map((l,i)=>{
      const t=map.get(Math.round(l.t*10));
      return '<button data-lyric-time="'+l.t+'" data-lyric-index="'+i+'">'+escape(l.text)+(useTrans&&t?'<em class="lyric-trans">'+escape(t)+'</em>':'')+'</button>';
    }).join('');
    const tb=$('lyricTrans');
    if(tb){tb.disabled=!trans.length;tb.textContent=trans.length?(useTrans?'翻译 ✓':'翻译'):'无译文';tb.setAttribute('aria-pressed',String(useTrans));}
  }
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
  function renderAuth() {const user=XYCloud.user;
    // 账号切换/登录后立刻重新拉取云端歌单，避免残留上一个账号的数据
    const uid=user?.id||'';if(uid!==(renderAuth._uid||'')){renderAuth._uid=uid;cloudPlaylists=[];cloudPlAt=0;}
    $('mobileGuest').hidden=!!user;$('mobileMember').hidden=!user;const shown=user?(XYCloud.displayName?XYCloud.displayName(user):XYCloud.displayUser(user)):'';$('mobileMemberName').textContent=shown;const name=shown||'登录，让喜欢随行';$('mobileAccountName').textContent=name;$('mobileAccountHint').textContent=user?'云端账户已连接 · 喜欢随账号保存':'云端收藏 · 多端共用同一个账号';$('mobileLoginSubmit').disabled=!XYCloud.available;const av=$('meAvatar');if(av&&!av.style.backgroundImage)av.textContent=(user?name:'杨').slice(0,1);if(user)fillProfile(user);refreshAccountRows();}
  // 设置页「账号与安全」分组里的账户状态
  function refreshAccountRows() {
    const el=$('valAccount');
    if(el)el.textContent=XYCloud.user?(XYCloud.displayName?XYCloud.displayName(XYCloud.user):'已登录'):'未登录';
  }
  // 关于
  function showAboutSheet() {
    const ver=(global.XYCloud?.appVersion||'').replace(/^v/,'');
    sheet('关于小杨音乐','<div class="about-box"><img src="icon.svg" alt=""><strong>小杨音乐</strong><span class="muted">版本 v'+escape(ver)+'</span></div><div class="wiki-list"><div class="wiki-row"><span>定位</span><strong>让喜欢，随身听</strong></div><div class="wiki-row"><span>音源</span><strong>网易云音乐 · QQ 音乐 · 酷狗</strong></div><div class="wiki-row"><span>账号</span><strong>Supabase 手机号登录</strong></div><div class="wiki-row"><span>许可</span><strong>个人非商业使用</strong></div></div><p class="muted" style="margin-top:14px;">本应用所有歌曲与歌词均来自公开音乐接口，版权归原权利人所有。</p>');
  }
  // 设备授权（v3.5.0 防泄露机制）
  function showDeviceAuthSheet() {
    const da=global.XYDeviceAuth;
    if(!da)return sheet('设备授权','<p class="muted">授权模块未加载。</p>');
    sheet('设备授权','<div id="deviceAuthPanel" class="device-auth"><p class="muted">正在读取设备信息…</p></div>');
    da.status().then(st=>{
      const panel=$('deviceAuthPanel'); if(!panel)return;
      panel.innerHTML='<div class="wiki-list">'+
        '<div class="wiki-row"><span>设备码</span><strong>'+escape(st.deviceId||'—')+'</strong></div>'+
        '<div class="wiki-row"><span>当前版本</span><strong>'+escape(st.version||'—')+'</strong></div>'+
        '<div class="wiki-row"><span>授权状态</span><strong>'+(st.authorized?'已授权':'未授权')+'</strong></div>'+
        (st.authorized&&st.authorizedAt?'<div class="wiki-row"><span>授权时间</span><strong>'+escape(String(st.authorizedAt).slice(0,10))+'</strong></div>':'')+
        (st.renewed?'<div class="wiki-row"><span>续期方式</span><strong>同设备升级自动续期</strong></div>':'')+
        '</div>'+
        (st.authorized
          ? '<button class="wide-button" id="deviceAuthReset">解除本机授权</button>'
          : '<label>授权码<input id="deviceAuthCode" placeholder="XY' + (window.XYDeviceAuth?.currentVersion?.()||'3.6.0') + '-XXXX-XXXX-XXXX" autocomplete="off"></label><button class="primary wide-button" id="deviceAuthSubmit">验证并激活</button><p class="muted" style="margin-top:10px;">首次在新设备安装时需要向作者索取本版本的授权码；同一台设备升级版本会自动续期，无需再次输入。</p>');
      const submit=$('deviceAuthSubmit');
      if(submit)submit.onclick=async()=>{
        submit.disabled=true;
        const code=($('deviceAuthCode')?.value||'').trim();
        const r=await da.verify(code);
        submit.disabled=false;
        if(r.ok){toast('授权成功');closeSheet();refreshDeviceAuthRow();}
        else toast(r.msg||'授权码无效');
      };
      const reset=$('deviceAuthReset');
      if(reset)reset.onclick=async()=>{await da.reset();toast('已解除本机授权');closeSheet();refreshDeviceAuthRow();};
    }).catch(e=>{const panel=$('deviceAuthPanel');if(panel)panel.innerHTML='<p class="muted">读取设备信息失败：'+escape(e.message||'未知错误')+'</p>';});
  }
  function refreshDeviceAuthRow() {
    const el=$('valDeviceAuth'); if(!el)return;
    const da=global.XYDeviceAuth;
    if(!da){el.textContent='—';return;}
    da.status().then(st=>{el.textContent=st.authorized?(st.renewed?'已授权 · 自动续期':'已授权'):'未授权';}).catch(()=>{el.textContent='—';});
  }

  /* ---------- 注册图形验证码 ---------- */
  let captchaId = '', captchaSvg = '';
  function paintCaptcha(svg) {
    const box = $('mobileCaptchaBtn');
    if (!box) return;
    box.innerHTML = svg || '<span class="captcha-fallback">点击刷新</span>';
    // 后端返回的 SVG 需带尺寸，这里补一层 viewBox 适配容器
    const svgEl = box.querySelector('svg');
    if (svgEl) { svgEl.setAttribute('preserveAspectRatio','none'); svgEl.removeAttribute('width'); svgEl.removeAttribute('height'); }
  }
  async function loadCaptcha() {
    const box = $('mobileCaptchaBtn');
    if (!box) return;
    box.classList.add('loading');
    try {
      const r = await UzzApi.getCaptcha();
      captchaId = r.id; captchaSvg = r.svg;
      paintCaptcha(r.svg);
      $('mobileCaptchaInput').value = '';
    } catch (e) {
      captchaId = ''; paintCaptcha('');
      box.classList.remove('loading');
      box.innerHTML = '<span class="captcha-fallback">加载失败，点此重试</span>';
      box.title = e.message || '验证码加载失败';
      return;
    }
    box.classList.remove('loading');
  }
  function toggleCaptcha() {
    const row = $('mobileCaptchaRow');
    if (!row) return;
    const need = authMode === 'register';
    row.hidden = !need;
    if (need && !captchaId) loadCaptcha();
    if (!need) $('mobileCaptchaInput').value = '';
  }

  /* ---------- 资料中心：昵称 / 用户名 / 头像 ---------- */
  let pendingAvatar = '';          // 选好但尚未保存的头像（data URL）
  function fillProfile(user) {
    const p = XYCloud.profile ? XYCloud.profile(user) : { nickname:'', username:'', avatar:'' };
    const nick = $('pfNickname'), name = $('pfUsername'), img = $('pfAvatar');
    if (nick) nick.value = p.nickname || '';
    if (name) name.value = p.username || '';
    pendingAvatar = p.avatar || '';
    paintAvatar(p.avatar || '');
    const av = $('meAvatar');
    if (av && p.avatar) { av.textContent = ''; av.style.backgroundImage = 'url("' + p.avatar.replace(/"/g,'%22') + '")'; av.style.backgroundSize = 'cover'; av.style.backgroundPosition = 'center'; }
  }
  function paintAvatar(src) {
    const img = $('pfAvatar');
    if (!img) return;
    if (src) { img.src = src; img.classList.add('has-image'); img.style.backgroundImage = ''; }
    else { img.removeAttribute('src'); img.classList.remove('has-image'); img.textContent = ((XYCloud.displayName ? XYCloud.displayName(XYCloud.user) : '杨') || '杨').slice(0,1); }
  }
  async function saveProfile() {
    const btn = $('pfSave');
    const nickname = $('pfNickname')?.value || '';
    const username = $('pfUsername')?.value || '';
    btn.disabled = true;
    $('mobileAuthStatus').textContent = '正在保存资料…';
    try {
      await updateProfile({ nickname, username, avatar: pendingAvatar });
      renderAuth();
      $('mobileAuthStatus').textContent = '资料已保存';
      toast('资料已保存');
    } catch (e) {
      $('mobileAuthStatus').textContent = e.message || '保存失败';
    } finally { btn.disabled = false; }
  }
  async function doChangePassword() {
    const btn = $('pfChangePwd');
    const oldPw = $('pfOldPwd').value, newPw = $('pfNewPwd').value, newPw2 = $('pfNewPwd2').value;
    if (!oldPw || !newPw) { $('mobileAuthStatus').textContent = '请填写原密码和新密码'; return; }
    if (newPw !== newPw2) { $('mobileAuthStatus').textContent = '两次输入的新密码不一致'; return; }
    btn.disabled = true;
    $('mobileAuthStatus').textContent = '正在修改密码…';
    try {
      await changePassword(oldPw, newPw);
      $('pfOldPwd').value = ''; $('pfNewPwd').value = ''; $('pfNewPwd2').value = '';
      $('mobileAuthStatus').textContent = '密码修改成功';
      toast('密码已修改');
    } catch (e) {
      $('mobileAuthStatus').textContent = e.message || '修改失败';
    } finally { btn.disabled = false; }
  }

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
    // 防御性拦截（v3.2.3 热修）：绝不把 supabase.co 直链交给原生下载器/浏览器
    //（该域名国内被墙，真机 15s connect 超时）。一律改写为音乐后端 /api/release-file 代理。
    let dlUrl = r.url || '';
    if (/supabase\.co/i.test(dlUrl)) {
      const base = (UzzApi.getApiBase() || '').replace(/\/+$/, '');
      if (!base) return toast('下载地址为被墙的云端直链，请先在「播放与连接设置」配置音乐后端地址', 6000);
      dlUrl = base + '/api/release-file?v=' + encodeURIComponent(r.latest || '');
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
          res = await XYNative.NativeMusic.downloadApk({ url: dlUrl, version: r.latest });
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
        try { await XYNative.openUpdate(dlUrl); } catch (e2) { toast('浏览器打开失败，请手动访问下载链接', 5000); }
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
  // 播放器面板里的倍速/定时/音质快捷入口（v3.5.0）——
  // 这三项原来只藏在设置页，用户在播放界面找不到（用户明确诉求）。
  const QUALITY_CHIP_LABELS = { standard: '标准', ex: '高品', lossless: '无损' };
  function refreshPlayerChips() {
    const chipRate = $('mobileRate'), chipSleep = $('mobileSleep'), chipQuality = $('mobileQuality');
    if (chipRate) {
      const r = Number(localStorage.getItem('uzz.rate') || 1) || 1;
      chipRate.textContent = (r === 1 ? '1.0' : String(r)) + 'x';
      chipRate.classList.toggle('active', r !== 1);
    }
    if (chipQuality) {
      const q = localStorage.getItem('uzz.quality') || 'standard';
      chipQuality.textContent = QUALITY_CHIP_LABELS[q] || '标准';
      chipQuality.classList.toggle('active', q !== 'standard');
    }
    if (chipSleep) {
      const left = sleepDeadline - Date.now();
      if (sleepDeadline > 0 && left > 0) {
        const m = Math.ceil(left / 60000);
        chipSleep.textContent = m + ' 分钟后停';
        chipSleep.classList.add('active');
      } else {
        chipSleep.textContent = '定时';
        chipSleep.classList.remove('active');
      }
    }
  }
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
      refreshPlayerChips();
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
      refreshPlayerChips();
      sleepTimer = setTimeout(tick, 1000);
    };
    tick();
    toast('将在 ' + minutes + ' 分钟后停止播放');
  }
  // 设置项显示值（模块级：setMobileLyric 等模块级函数也要刷新这些文案）
  const QUALITY_LABELS = { standard: '标准', ex: '高品', lossless: '无损' };
  const SPEED_LABELS = { 0.5: '0.5x', 1: '1.0x', 1.5: '1.5x', 2: '2.0x' };
  const SLEEP_LABELS = { 0: '关闭', 15: '15分钟', 30: '30分钟', 60: '60分钟' };
  const THEME_LABELS = { light: '浅色', dark: '深色', auto: '跟随系统' };
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
    refreshPlayerChips();
  }
  function initSettings() {
    // 通用：底部弹层单选（网易云风格：列表行 → sheet 选值）
    function pickSheet(title, options, current, onPick) {
      sheet(title, options.map((o) => '<button class="sheet-action" data-pick="' + o.value + '">' + (String(o.value) === String(current) ? '✓ ' : '') + escape(o.label) + '</button>').join(''));
      document.querySelectorAll('#sheetContent [data-pick]').forEach(b => { b.onclick = () => { closeSheet(); onPick(b.dataset.pick); }; });
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
    // v3.5.0：账号与安全分组
    const rowAccount = $('rowAccount');
    if (rowAccount) rowAccount.onclick = () => { openAccount(); };
    const rowDeviceAuth = $('rowDeviceAuth');
    if (rowDeviceAuth) rowDeviceAuth.onclick = () => showDeviceAuthSheet();
    refreshAccountRows();
    // v3.5.0：播放器面板快捷入口（倍速 / 定时关闭 / 音质）——与设置页共用同一套逻辑
    const chipRate = $('mobileRate');
    if (chipRate) chipRate.onclick = () => pickSheet('播放倍速', [
      { value: '0.5', label: '0.5x 慢速' }, { value: '1', label: '1.0x 正常' }, { value: '1.5', label: '1.5x' }, { value: '2', label: '2.0x 🚀' },
    ], String(localStorage.getItem('uzz.rate') || 1), (v) => { localStorage.setItem('uzz.rate', v); applySpeed(v); refreshSettingsValues(); refreshPlayerChips(); });
    const chipSleep = $('mobileSleep');
    if (chipSleep) chipSleep.onclick = () => pickSheet('定时关闭', [
      { value: '0', label: '关闭' }, { value: '15', label: '15 分钟' }, { value: '30', label: '30 分钟' }, { value: '60', label: '60 分钟' },
    ], String(lastSleepPick || 0), (v) => { lastSleepPick = Number(v) || 0; applySleep(lastSleepPick); refreshSettingsValues(); refreshPlayerChips(); });
    const chipQuality = $('mobileQuality');
    if (chipQuality) chipQuality.onclick = () => pickSheet('音质', [
      { value: 'standard', label: '标准 128k' }, { value: 'ex', label: '高品 320k' }, { value: 'lossless', label: '无损' },
    ], localStorage.getItem('uzz.quality') || 'standard', (v) => { applyQuality(v); refreshSettingsValues(); refreshPlayerChips(); });
    // 主题跟随系统实时切换
    systemDark.addEventListener('change', () => { if (themePref() === 'auto') applyTheme(); });
    applyTheme();
    refreshSettingsValues();
    const ver = $('settingsVer');
    const appVer = (window.XYCloud?.appVersion || '').replace(/^v/,'');
    if (ver) ver.textContent = 'v' + appVer;
    // 版本号统一由 appVersion 驱动，避免多处硬编码后不一致
    const mv = $('mobileVersion');
    if (mv && appVer) mv.textContent = appVer;
  }
  // 桌面歌词开关（v3.2.2）：开启需悬浮窗权限，未授权引导系统设置后重开
  async function setMobileLyric(v) {
    const on = v === '1';
    if (!on) {
      localStorage.removeItem('uzz.mobileLyric');
      try { await XYNative.NativeMusic.lyricOverlay({ show: false }); } catch (e) {}
      refreshSettingsValues();
      return toast('桌面歌词已关闭');
    }
    // 桌面歌词依赖安卓悬浮窗，桌面浏览器没有这个能力——明确告知，别让用户以为点击没生效
    if (!XYNative.isAndroid || !XYNative.NativeMusic?.lyricOverlay) {
      refreshSettingsValues();
      return toast('桌面歌词仅在安卓版可用', 4000);
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
      refreshSettingsValues();
      toast('桌面歌词已开启 🎵');
    } catch (e) {
      toast('无法开启桌面歌词：' + (e.message || '系统拒绝'), 5000);
    }
  }

  const actions={
    account:openAccount,closeAccount,closeSheet,player:showPlayer,closePlayer,toggle:()=>audio.error&&audio.retry?audio.retry():Player.toggle(),next:()=>Player.next(),prev:()=>Player.prev(),mode:()=>Player.cycleMode(),queue:showQueue,
    drawer:openDrawer,closeDrawer,mlyric:async()=>{await setMobileLyric(localStorage.getItem('uzz.mobileLyric')==='1'?'0':'1');},
    retryPlayback:async()=>{if(!Player.getState().current)return;if(audio.retry)await audio.retry();else{audio.load();await audio.play();}toast('正在重新连接音源…');},
    trackMenu:()=>trackMenu(Player.getState().current),createPlaylist,addToPlaylist,settings,networkDiagnostics,update:checkUpdate,
    about:showAboutSheet,deviceAuth:showDeviceAuthSheet,
    back:()=>navigate(previousRoute==='detail'?'library':previousRoute),refreshDiscover:rotateDiscover,retryChannel:()=>loadChannel(channel),retrySearch:()=>search(),refreshCloud,
    history:()=>chooseLibrary('history'),favorites:()=>chooseLibrary('favorites'),openCloud:()=>{closeAccount();chooseLibrary('cloud');},
    clearSearch:()=>{searchHistory=[];save('uzz.searchHistory',[]);renderSearchWelcome();},theme:cycleTheme,
    // v3.4.0：语音搜索（Web Speech API，桌面浏览器可用；安卓原生不支持时给出明确指引）
    voiceSearch:()=>{
      const SR=global.SpeechRecognition||global.webkitSpeechRecognition;
      if(!SR)return sheet('语音搜索', '<p class="muted">当前环境未提供语音识别能力。可直接在搜索框输入歌名或歌手，例如「周杰伦 晴天」。</p><p class="muted" style="margin-top:8px;">提示：在安卓手机浏览器或输入法中开启「语音输入」后，点击搜索框右侧键盘即可直接说话。</p><button class="primary wide-button" data-action="focusSearch">去搜索框输入</button>');
      try{
        const rec=new SR();
        rec.lang='zh-CN';rec.interimResults=false;rec.maxAlternatives=1;
        rec.onresult=e=>{const t=(e.results&&e.results[0]&&e.results[0][0]&&e.results[0][0].transcript)||'';if(!t)return;$('mobileSearchInput').value=t;toast('识别到：'+t);search();};
        rec.onerror=e=>{const m={'not-allowed':'麦克风权限被拒绝','network':'语音服务网络异常','audio-capture':'未检测到麦克风'}[e.error]||('语音识别失败：'+e.error);toast(m,5000);};
        rec.start();toast('正在听…请说出歌名或歌手');
      }catch(e){toast('无法启动语音识别：'+(e.message||'设备不支持'),5000);}
    },
    focusSearch:()=>{closeSheet();const inp=$('mobileSearchInput');if(inp){inp.focus();inp.select();}},
    // v3.4.0：浏览全部热搜（此前只是静态文字）
    showAllHot:async()=>{
      sheet('热门搜索', '<p class="muted">正在获取…</p>');
      try{
        const r=await UzzApi.suggest('');
        const words=(r.hot||[]).map(t=>typeof t==='string'?t:(t.searchWord||t.name||t.keyword||'')).filter(Boolean);
        if(!words.length){ $('sheetContent').innerHTML=empty('热搜暂时不可用，你仍可直接输入关键词搜索。'); return; }
        $('sheetContent').innerHTML='<div class="hot-list">'+words.map((w,i)=>'<button class="hot-row" data-hot-word="'+escape(w)+'"><b>'+String(i+1).padStart(2,'0')+'</b><span>'+escape(w)+'</span></button>').join('')+'</div>';
        document.querySelectorAll('[data-hot-word]').forEach(b=>{b.onclick=()=>{closeSheet();$('mobileSearchInput').value=b.dataset.hotWord;search();};});
      }catch(e){ $('sheetContent').innerHTML=empty('热搜加载失败：'+(e.message||'网络异常')); }
    },
    // v3.4.0：云贝与权益（此前是静态横幅）
    showRewards:()=>{
      const favs=Player.getFavorites().length, hist=Player.getHistory().length;
      const coins=Math.max(0,Math.round(favs*10+hist*2));
      sheet('我的云贝与权益', '<div class="reward-hero"><strong>'+coins+'</strong><span>云贝</span></div>'+
        '<p class="muted">云贝按你的收藏与听歌自动累积：收藏 1 首 +10，乐听 1 次 +2。</p>'+
        '<div class="reward-list">'+
        '<button class="sheet-action" data-action="rewardExchange"><span data-icon="heart"></span>兑换「无损音质 7 天」<span class="muted">需 300 云贝</span></button>'+
        '<button class="sheet-action" data-action="rewardExchange"><span data-icon="clock"></span>兑换「定时关闭提醒」<span class="muted">需 80 云贝</span></button>'+
        '<button class="sheet-action" data-action="rewardExchange"><span data-icon="spark"></span>兑换「个性主题」<span class="muted">需 150 云贝</span></button>'+
        '</div><p class="muted">兑换会记录在本机，下次打开仍可查看。当前版本云贝为本地体验功能，不涉及真实充值。</p>');
      hydrate($('sheetContent'));
    },
    rewardExchange:()=>{ toast('云贝兑换为本地体验功能，权益将在下个版本开放，敬请期待'); },
    // v3.4.0：「我的」页统计项详情（此前三个按钮点击无反应）
    statFollows:()=>{
      const favs=Player.getFavorites()||[];
      const artists=new Map();
      for(const t of favs){const a=(t.artist||'').trim();if(a&&!artists.has(a))artists.set(a,t.pic||'');}
      const list=[...artists.entries()];
      sheet('我关注的歌手 · '+list.length, list.length?list.map(([n,p])=>'<button class="sheet-action" data-follow-artist="'+escape(n)+'" data-follow-pic="'+escape(p)+'"><img src="'+escape(cover(p))+'" alt=""><span>'+escape(n)+'</span></button>').join(''):empty('还没有关注任何歌手。在搜索页搜歌手，进入歌手主页后收藏歌曲，就会出现在这里。'));
      document.querySelectorAll('[data-follow-artist]').forEach(b=>{b.onclick=()=>{closeSheet();$('mobileSearchInput').value=b.dataset.followArtist;navigate('search');search();};});
    },
    statFans:()=>{
      if(!XYCloud.user)return sheet('我的粉丝', empty('登录云端账户后，这里会显示与你相关的好友互动数据。')+'<button class="wide-button" data-action="account">去登录</button>');
      sheet('我的粉丝', '<p class="muted">你收藏的歌曲与歌单已同步到云端，当前云端收藏 <strong>'+(read('xy.android.cloudFavCount',0)||0)+'</strong> 首。</p><button class="wide-button" data-action="openCloud">查看云端收藏</button>');
    },
    statLevel:()=>{
      const favs=Player.getFavorites().length, hist=Player.getHistory().length;
      const score=favs*3+hist, level=Math.min(20,Math.max(1,Math.floor(score/12)+1));
      const cur=score%12, need=12;
      sheet('我的等级', '<div class="reward-hero"><strong>Lv.'+level+'</strong><span>当前等级</span></div>'+
        '<p class="muted">成长值 '+score+'（收藏 '+favs+' 首 ×3 + 听歌 '+hist+' 次）</p>'+
        '<p class="muted">距离 Lv.'+(level+1)+' 还需 '+(need-cur)+' 点成长值</p>'+
        '<p class="muted">等级由本机真实的收藏与听歌记录自动计算。</p>');
    },
    openArtist:()=>openArtist(selectedArtist.id,selectedArtist.name),
    // v3.4.0：歌曲百科（曲风 / 语种 / 发行时间 / BPM 等）
    songWiki:async()=>{
      const t=selectedTrack;if(!t||!t.id)return;
      sheet('歌曲百科', '<p class="muted">正在获取《'+escape(t.name||'')+'》的资料…</p>');
      try{
        const info=await UzzApi.getWiki(t.id,t.vendor);
        const rows=Object.entries(info||{}).filter(([,v])=>v!==''&&v!=null&&!(Array.isArray(v)&&!v.length));
        if(!rows.length){ $('sheetContent').innerHTML=empty('暂无百科资料，换一首歌试试。'); return; }
        const label=k=>({'genre':'曲风','language':'语种','publishTime':'发行时间','releaseDate':'发行日期','bpm':'BPM','album':'专辑','alias':'别名','musicType':'音乐类型','company':'发行公司','producer':'制作人'}[k]||k);
        $('sheetContent').innerHTML='<div class="wiki-list">'+rows.map(([k,v])=>'<div class="wiki-row"><span>'+escape(label(k))+'</span><strong>'+escape(Array.isArray(v)?v.join(' / '):String(v))+'</strong></div>').join('')+'</div>';
      }catch(e){ $('sheetContent').innerHTML=empty('百科加载失败：'+(e.message||'网络异常')); }
    },
    // v3.4.0：相似推荐（可一键播放）
    similarSongs:async()=>{
      const t=selectedTrack;if(!t||!t.id)return;
      sheet('相似推荐', '<p class="muted">正在寻找相似歌曲…</p>');
      try{
        const list=await UzzApi.getSimi(t.id,t.vendor,20);
        if(!list.length){ $('sheetContent').innerHTML=empty('暂无相似推荐。'); return; }
        $('sheetContent').innerHTML='<ul class="track-list">'+tracksHtml(list,'similar')+'</ul><button class="primary wide-button" data-action="playSimilar">播放全部相似歌曲</button>';
        document.querySelectorAll('#sheetContent [data-track-list="similar"]').forEach(b=>{
          b.onclick=()=>{const idx=Number(b.dataset.trackIndex);const tk=(trackSets.get('similar')||[])[idx];if(tk)play(tk);};
        });
      }catch(e){ $('sheetContent').innerHTML=empty('相似推荐加载失败：'+(e.message||'网络异常')); }
    },
    playSimilar:()=>{const list=trackSets.get('similar')||[];if(!list.length)return toast('相似推荐为空');closeSheet();Player.playQueue(list).catch(e=>toast(e.message));showPlayer();},
    // v3.4.0：导入歌单链接（支持网易云 / QQ / 酷狗，复用服务端 /api/import/resolve）
    importPlaylist:()=>{
      sheet('导入歌单', '<form id="mobileImportForm"><label>歌单链接或 ID<input id="mobileImportInput" type="text" placeholder="粘贴网易云/QQ/酷狗歌单链接，或纯数字 ID" required></label><label>来源平台<select id="mobileImportPlatform"><option value="netease">网易云音乐</option><option value="qq">QQ 音乐</option><option value="kugou">酷狗音乐</option></select></label><button class="primary wide-button" type="submit">解析并导入</button></form><p class="muted">导入后会在「音乐库 · 歌单」中生成一张收藏歌单，歌曲仍按在线音源播放。</p>');
      const form=$('mobileImportForm');
      if(form)form.onsubmit=async e=>{
        e.preventDefault();
        const input=$('mobileImportInput'), platform=$('mobileImportPlatform');
        const value=(input&&input.value||'').trim();
        if(!value)return toast('请输入歌单链接或 ID');
        const btn=form.querySelector('button[type=submit]');
        if(btn){btn.disabled=true;btn.textContent='正在解析…';}
        try{
          const r=await UzzApi.resolveImport(value,platform&&platform.value||'netease');
          const tracks=(r.tracks||[]).map(t=>UzzApi.normalizeTrack?UzzApi.normalizeTrack(t):t).filter(t=>t&&t.id);
          if(!tracks.length)return toast('该歌单没有可导入的歌曲');
          const name=r.info&&r.info.name||'导入歌单';
          playlists.unshift({id:'L'+crypto.randomUUID(),sourceId:r.id,name,cover:r.info&&r.info.cover||'',tracks,kind:'collected',createdAt:Date.now()});
          savePlaylists();
          closeSheet();
          chooseLibrary('playlists');
          toast('已导入《'+name+'》共 '+tracks.length+' 首');
        }catch(err){ toast('导入失败：'+(err.message||'无法识别该链接'),5000); }
        finally{ if(btn){btn.disabled=false;btn.textContent='解析并导入';} }
      };
    },
    charts:()=>navigate('charts'),
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
    if(button.dataset.nav){if(button.dataset.nav==='charts'&&button.dataset.chartId)pendingChartId=button.dataset.chartId;navigate(button.dataset.nav);return;}
    if(button.dataset.chartPick){await selectChart(button.dataset.chartPick);return;}
    if(button.dataset.action){
      const action=button.dataset.action;
      // 需要元素上下文的动作：先把 data-* 注入 selected* 状态
      if(action==='openArtist')selectedArtist={id:button.dataset.artist||'',name:button.dataset.artistName||''};
      const fn=actions[action];if(fn)await fn();return;
    }
    if(button.dataset.online){await openOnline(button.dataset.online,button.dataset.title);return;}
    if(button.dataset.query!==undefined){$('mobileSearchInput').value=button.dataset.query;await search();return;}
    if(button.dataset.library){libraryTab=button.dataset.library;renderLibrary();return;}
    if(button.dataset.localPlaylist){openLocal(button.dataset.localPlaylist);return;}
    if(button.dataset.local){openLocal(button.dataset.local);return;}
    if(button.dataset.notes){notesMode=button.dataset.notes;document.querySelectorAll('[data-notes]').forEach(e=>e.classList.toggle('active',e===button));renderNotes();return;}
    if(button.dataset.channel){await loadChannel(button.dataset.channel);return;}
    if(button.dataset.type){searchType=button.dataset.type;document.querySelectorAll('[data-type]').forEach(e=>e.classList.toggle('active',e===button));await search();return;}
    if(button.dataset.searchIndex!==undefined){await openSearchResult(Number(button.dataset.searchIndex));return;}
    if(button.dataset.recentIndex!==undefined){const t=recentRows[Number(button.dataset.recentIndex)];if(t)play(t);return;}
    if(button.dataset.trackMenu){trackMenu(trackSets.get(button.dataset.trackMenu)?.[Number(button.dataset.trackIndex)],button.dataset.trackMenu);return;}
    if(button.dataset.trackList){if(Date.now()<(click.suppressUntil||0))return;const scope=button.dataset.trackList,index=Number(button.dataset.trackIndex);if(scope==='search')await openSearchResult(index);else play(trackSets.get(scope)?.[index]);return;}
    if(button.dataset.addPlaylist){const p=playlists.find(p=>p.id===button.dataset.addPlaylist);if(!p||!selectedTrack)return;p.tracks=p.tracks||[];if(!p.tracks.some(t=>keyOf(t)===keyOf(selectedTrack)))p.tracks.push({...selectedTrack});savePlaylists();if(detail?.localId===p.id){detail.tracks=p.tracks;paintDetail();}closeSheet();toast('已添加到「'+p.name+'」');return;}
    if(button.dataset.lyricTime){audio.currentTime=Number(button.dataset.lyricTime);if(audio.paused)await audio.play().catch(()=>toast('点击播放继续'));}
    if(button.dataset.auth){authMode=button.dataset.auth;document.querySelectorAll('[data-auth]').forEach(e=>e.classList.toggle('active',e===button));$('mobileLoginSubmit').textContent=authMode==='login'?'登录':'注册并登录';$('mobilePassword').autocomplete=authMode==='login'?'current-password':'new-password';$('mobileAuthStatus').textContent='';toggleCaptcha();}
  }
  function back(){if(!$('accountBackdrop').hidden)return closeAccount();if(!$('sheetBackdrop').hidden)return closeSheet();if(!$('drawerBackdrop').hidden)return closeDrawer();if(!$('mobilePlayer').hidden)return closePlayer();if(route!=='discover')return navigate(route==='detail'?previousRoute:'discover');if(Date.now()-lastBack<1800){XYNative.App.exitApp();return;}lastBack=Date.now();toast('再按一次返回退出应用');}
  // 侧边抽屉（v3.3.0 网易云风格）
  function openDrawer(){$('drawerBackdrop').hidden=false;const u=XYCloud.user;if(u){$('drawerName').textContent=XYCloud.displayUser(u);$('drawerAvatar').textContent=(XYCloud.displayUser(u)||'杨').slice(0,1);}paintMeRecent();hydrate($('drawerBackdrop'));}
  function closeDrawer(){const d=$('drawerBackdrop');if(d)d.hidden=true;}
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
    // v3.5.0：设备授权门禁。陌生设备首次安装必须输入本版本授权码；
    // 同一台设备升级凭本地记录自动续期，无需再次输入。
    // 遮罩是静态 HTML（脚本没跑也能挡住），这里只负责最终裁决放行与否。
    if(global.XYDeviceAuth){
      try{ await global.XYDeviceAuth.gate(); }catch(e){ console.warn('设备授权检查失败：',e&&e.message); }
      global.XYDeviceAuth.onAuthorized=()=>{ toast('授权成功，欢迎使用'); refreshDeviceAuthRow(); };
    }
    hydrate();Player.init({headless:true});applyTheme();const td=$('todayDate');if(td)td.textContent=new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric'}).format(new Date());
    const diagnosticsButton=document.createElement('button');diagnosticsButton.type='button';diagnosticsButton.textContent='网络诊断';diagnosticsButton.dataset.action='networkDiagnostics';document.querySelector('.me-extra')?.appendChild(diagnosticsButton);
    const loginDiagnostic=document.createElement('button');loginDiagnostic.type='button';loginDiagnostic.className='wide-button';loginDiagnostic.textContent='登录失败？检查网络';loginDiagnostic.onclick=networkDiagnostics;$('mobileAuthStatus').after(loginDiagnostic);
    const playbackLabel=document.createElement('span');playbackLabel.id='mobilePlaybackStatus';playbackLabel.setAttribute('role','status');playbackLabel.setAttribute('aria-live','polite');$('mobileTime').after(playbackLabel);
    const recovery=document.createElement('div');recovery.id='playbackRecovery';recovery.className='playback-recovery';recovery.hidden=true;recovery.innerHTML='<p id="playbackRecoveryMessage" role="status"></p><button class="outline" data-action="retryPlayback">重新连接</button><button id="playbackRecoveryNext" class="outline" data-action="next">下一首</button>';$('mobileTime').parentElement.after(recovery);
    for(const name of ['timeupdate','waiting','canplay','play','pause','error'])audio.addEventListener(name,playbackStatus);
    document.addEventListener('xy:player',playbackStatus);
    for(const [direction,label] of [['push','上传并合并歌单'],['pull','从云端合并歌单']]){const b=document.createElement('button');b.type='button';b.className='wide-button';b.textContent=label;b.onclick=()=>syncLibrary(direction);$('mobileMember').insertBefore(b,$('mobileLogout'));}
    document.addEventListener('click',e=>{click(e).catch(error=>toast(error.message));});
    document.addEventListener('error',e=>{if(e.target instanceof HTMLImageElement&&e.target.getAttribute('src')!=='icon.svg')e.target.src='icon.svg';},true);
    global.addEventListener('hashchange',()=>showRoute(location.hash.slice(1)));showRoute(location.hash.slice(1));
    $('mobileSearchForm').onsubmit=e=>{e.preventDefault();$('mobileSearchInput').blur();search();};$('searchMore').onclick=()=>search(true);$('refreshDiscover').onclick=rotateDiscover;
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
    // v3.4.0：歌词翻译开关（复用 player.js 已有的 tlyrics 数据）
    $('lyricTrans').onclick=async()=>{
      const st=Player.getState();
      if(!st.tlyrics||!st.tlyrics.length){
        // 译文可能仍在异步补拉中：现场再拉一次，成功则开翻译，失败才提示无译文
        const cur=st.current;
        if(cur&&cur.id&&UzzApi.getLyricEx){
          toast('正在获取译文…');
          try{
            const lf=await UzzApi.getLyricEx(cur.id,cur.vendor);
            const lines=Player.parseLrcSafe?Player.parseLrcSafe(lf.tlyric):[];
            if(lines&&lines.length){
              st.tlyrics=lines;
              localStorage.setItem('uzz.lyricTrans','1');
              renderLyrics();
              toast('已显示翻译');
              return;
            }
          }catch(e){/* 忽略，走下方提示 */}
        }
        toast('这首歌暂无译文');return;
      }
      const on=localStorage.getItem('uzz.lyricTrans')==='1';
      localStorage.setItem('uzz.lyricTrans',on?'0':'1');
      renderLyrics();
      toast(on?'已关闭翻译':'已显示翻译');
    };
    for(const name of ['timeupdate','loadedmetadata','durationchange','seeked'])audio.addEventListener(name,progress);
    for(const name of ['play','pause','ended','error','emptied'])audio.addEventListener(name,()=>playerChanged('play'));
    document.addEventListener('xy:player',e=>playerChanged(e.detail.kind));document.addEventListener('xy:trackChanged',syncHeart);document.addEventListener('uzz:libChanged',()=>{renderCounts();if(route==='library'&&libraryTab!=='cloud')renderLibrary();});
    // 译文异步补拉完成后刷新歌词区（否则「翻译」按钮会一直停在「无译文」且禁用）
    document.addEventListener('uzz:lyricRefresh',()=>{if(route==='player'||!$('mobilePlayer').hidden)renderLyrics();});
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
    $('mobileLoginForm').onsubmit=async e=>{e.preventDefault();$('mobileLoginSubmit').disabled=true;$('mobileAuthStatus').textContent='正在连接…';try{
      if(authMode==='register'){
        // 注册必须先过图形验证码（后端一次性校验，失败即作废）
        const answer=($('mobileCaptchaInput').value||'').trim();
        if(!answer){$('mobileAuthStatus').textContent='请输入图形验证码';await loadCaptcha();return;}
        if(!captchaId){$('mobileAuthStatus').textContent='验证码还没加载好，请稍候重试';await loadCaptcha();return;}
        try{await UzzApi.verifyCaptcha(captchaId,answer);}
        catch(err){$('mobileAuthStatus').textContent='验证码错误，请重新输入';await loadCaptcha();return;}
      }
      const data=await global[authMode==='login'?'loginUser':'registerUser']($('mobilePhone').value,$('mobilePassword').value);
      $('mobilePassword').value='';
      $('mobileAuthStatus').textContent=data.session?'登录成功':'注册完成，请检查手机号确认配置后登录';
    }catch(error){const msg=String(error.message||error);$('mobileAuthStatus').textContent=/reset|aborted|超时|timeout|failed to connect|网络/i.test(msg)?'网络波动，连接云端被中断（已自动重试多次）。请稍等片刻再点一次，通常即可成功':msg;}finally{$('mobileLoginSubmit').disabled=!XYCloud.available;}};
    // 图形验证码：点击图片刷新
    $('mobileCaptchaBtn').onclick=()=>{loadCaptcha();};
    // 资料中心
    $('pfSave').onclick=()=>{saveProfile();};
    $('pfChangePwd').onclick=()=>{doChangePassword();};
    $('pfAvatarClear').onclick=()=>{pendingAvatar='';paintAvatar('');const av=$('meAvatar');if(av){av.style.backgroundImage='';av.textContent=(XYCloud.displayName?XYCloud.displayName(XYCloud.user):'杨').slice(0,1);}toast('已恢复默认头像，记得点保存');};
    $('pfAvatarInput').onchange=async e=>{const f=e.target.files&&e.target.files[0];e.target.value='';if(!f)return;try{pendingAvatar=await compressAvatar(f,128);paintAvatar(pendingAvatar);toast('头像已选择，点「保存资料」生效');}catch(err){toast(err.message||'头像处理失败');}};
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
