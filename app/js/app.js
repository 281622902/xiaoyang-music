/* ============================================================
 * app.js — 小杨音乐 前端主控
 * 视图：发现音乐（推荐页）/ 搜索 / 歌单详情 / 我喜欢的 / 最近播放 / 下载管理 / 设置
 * 附加：搜索建议、歌单管理（创建/收藏/加歌）、主题切换、下载记录
 * ============================================================ */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const DESKTOP = !!(window.uzzBridge && window.uzzBridge.isDesktop);

  /* ---------- 工具 ---------- */
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function loadJSON(key, def) {
    try { return JSON.parse(localStorage.getItem(key)) || def; } catch (e) { return def; }
  }
  function saveJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
  function toast(msg) {
    const t = $('toast');
    if (!msg) { t.classList.add('hidden'); return; }
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 1800);
  }
  function fmtCount(n) {
    n = Number(n) || 0;
    if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
    if (n >= 1e4) return Math.round(n / 1e4) + '万';
    return String(n);
  }
  function shuffleSeeded(arr, seed) {
    const a = arr.slice();
    let s = seed;
    for (let i = a.length - 1; i > 0; i--) {
      s = (s * 9301 + 49297) % 233280;
      const j = Math.floor((s / 233280) * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ============================================================
   * 主题（深色/浅色 + 主题色）
   * ============================================================ */
  function hexToRgba(hex, a) {
    const m = hex.replace('#', '');
    const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  function applyTheme() {
    const mode = localStorage.getItem('uzz.theme.mode') || 'dark';
    const accent = localStorage.getItem('uzz.theme.accent') || (mode === 'light' ? '#087e72' : '#76ddc8');
    document.documentElement.dataset.theme = mode;
    document.querySelectorAll('input[name="themeMode"]').forEach(input=>{input.checked=input.value===mode;});
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-weak', hexToRgba(accent, 0.14));
    document.querySelector('meta[name=theme-color]').setAttribute('content', mode === 'light' ? '#f4f5f7' : '#12141a');
    // 皮肤整包配色：非默认皮肤时内联覆盖背景/文字/分割线等变量（未选皮肤时清除，回落主题默认）
    const rootStyle = document.documentElement.style;
    PAL_KEYS.forEach((k) => rootStyle.removeProperty(k));
    const skin = SKINS.find((s) => s.id === (localStorage.getItem('uzz.theme.skin') || ''));
    if (skin && skin.pal) {
      const pal = Object.assign({}, skin.pal);
      // 皮肤未显式给播放页蒙版时，用皮肤底色合成（保证播放页文字/图标在任何封面下可读）
      if (!pal['--fp-mask'] && pal['--bg-0']) {
        pal['--fp-mask'] = `linear-gradient(180deg, ${hexToRgba(pal['--bg-0'], 0.55)}, ${hexToRgba(pal['--bg-0'], 0.85)})`;
      }
      Object.entries(pal).forEach(([k, v]) => rootStyle.setProperty(k, v));
      document.querySelector('meta[name=theme-color]').setAttribute('content', skin.pal['--bg-0'] || (mode === 'light' ? '#f4f5f7' : '#12141a'));
    }
  }
  function bindThemeSettings() {
    const mode = localStorage.getItem('uzz.theme.mode') || 'dark';
    const accent = localStorage.getItem('uzz.theme.accent') || '#ec4141';
    document.querySelectorAll('#themeMode button').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
      b.addEventListener('click', () => {
        localStorage.setItem('uzz.theme.mode', b.dataset.mode);
        localStorage.setItem('uzz.theme.skin', ''); // 手动改深浅 = 放弃皮肤整包配色
        document.querySelectorAll('#themeMode button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        applyTheme();
      });
    });
    document.querySelectorAll('#accentSwatches button').forEach((b) => {
      b.classList.toggle('active', b.dataset.accent === accent);
      b.addEventListener('click', () => {
        localStorage.setItem('uzz.theme.accent', b.dataset.accent);
        localStorage.setItem('uzz.theme.skin', ''); // 手动改主题色 = 放弃皮肤整包配色
        document.querySelectorAll('#accentSwatches button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        applyTheme();
      });
    });
  }

  /* 个性皮肤：14 套整包配色（深浅 + 全套背景/文字变量），一键切换不再只有黑
     pal 内联覆盖 CSS 变量；prev 为皮肤卡片预览底色（渐变） */
  const PAL_KEYS = ['--bg-0', '--bg-1', '--bg-2', '--bg-3', '--text', '--text-2', '--line', '--shadow', '--vinyl-face', '--fp-mask'];
  const SKINS = [
    { id: 'classic', name: '经典红', mode: 'dark', accent: '#ec4141', prev: 'linear-gradient(135deg,#2a1a1c,#171a21)' },
    { id: 'light', name: '极简白', mode: 'light', accent: '#ec4141', prev: 'linear-gradient(135deg,#ffffff,#eceef1)' },
    { id: 'candy', name: '糖果粉', mode: 'light', accent: '#f0569a',
      pal: { '--bg-0': '#fdeef4', '--bg-1': '#ffffff', '--bg-2': '#fce8f0', '--bg-3': '#f6d7e4', '--text': '#432635', '--text-2': '#8d5a72', '--line': '#f0cfdd', '--shadow': 'rgba(160,60,110,.14)', '--vinyl-face': '#3a2430' },
      prev: 'linear-gradient(135deg,#ffe3ef,#fbc2dd)' },
    { id: 'sakura', name: '樱花夜', mode: 'dark', accent: '#ff6fa5',
      pal: { '--bg-0': '#201219', '--bg-1': '#261620', '--bg-2': '#2e1c27', '--bg-3': '#3a2432', '--text': '#f7e8ef', '--text-2': '#bd93a8', '--line': '#3d2735', '--shadow': 'rgba(0,0,0,.5)', '--vinyl-face': '#2c1a25' },
      prev: 'linear-gradient(135deg,#3a2432,#201219)' },
    { id: 'forest', name: '绿色森林', mode: 'light', accent: '#2e9e5b',
      pal: { '--bg-0': '#e9f5ec', '--bg-1': '#ffffff', '--bg-2': '#e2f2e7', '--bg-3': '#cfe8d6', '--text': '#16301f', '--text-2': '#47745c', '--line': '#d3e8da', '--shadow': 'rgba(30,90,55,.12)', '--vinyl-face': '#22382b' },
      prev: 'linear-gradient(135deg,#d9f0e0,#a9d9b9)' },
    { id: 'pine', name: '松涛夜绿', mode: 'dark', accent: '#35c26e',
      pal: { '--bg-0': '#0e1a13', '--bg-1': '#122118', '--bg-2': '#182b1f', '--bg-3': '#213828', '--text': '#e4f2e8', '--text-2': '#93b2a0', '--line': '#24402e', '--shadow': 'rgba(0,0,0,.5)', '--vinyl-face': '#152419' },
      prev: 'linear-gradient(135deg,#1d3a27,#0e1a13)' },
    { id: 'goldage', name: '流金岁月', mode: 'light', accent: '#c08a1e',
      pal: { '--bg-0': '#f7f0df', '--bg-1': '#fffdf6', '--bg-2': '#f4ecd6', '--bg-3': '#ead9b5', '--text': '#3d3015', '--text-2': '#7c6a3c', '--line': '#e6d6b2', '--shadow': 'rgba(120,90,30,.13)', '--vinyl-face': '#3a2f1a' },
      prev: 'linear-gradient(135deg,#f6e8c4,#e2c88a)' },
    { id: 'gilt', name: '鎏金夜', mode: 'dark', accent: '#d9a40e',
      pal: { '--bg-0': '#1c1610', '--bg-1': '#231c13', '--bg-2': '#2c2318', '--bg-3': '#3a2f1f', '--text': '#f5ecda', '--text-2': '#bfa87e', '--line': '#413521', '--shadow': 'rgba(0,0,0,.5)', '--vinyl-face': '#221a10' },
      prev: 'linear-gradient(135deg,#3a2f1f,#1c1610)' },
    { id: 'ocean', name: '蔚蓝海洋', mode: 'light', accent: '#1976d2',
      pal: { '--bg-0': '#e6f2fc', '--bg-1': '#ffffff', '--bg-2': '#dcecf9', '--bg-3': '#c6dff3', '--text': '#122a40', '--text-2': '#4c6f90', '--line': '#cfe3f2', '--shadow': 'rgba(25,80,140,.12)', '--vinyl-face': '#1d3a55' },
      prev: 'linear-gradient(135deg,#c9e6fb,#8fc4ee)' },
    { id: 'deepsea', name: '深海蓝', mode: 'dark', accent: '#3f8cff',
      pal: { '--bg-0': '#0c1524', '--bg-1': '#101c30', '--bg-2': '#16253d', '--bg-3': '#1f3350', '--text': '#e3edf9', '--text-2': '#8fa6c4', '--line': '#24395a', '--shadow': 'rgba(0,0,0,.5)', '--vinyl-face': '#13203a' },
      prev: 'linear-gradient(135deg,#1b3050,#0c1524)' },
    { id: 'lemon', name: '柠檬汽水', mode: 'light', accent: '#dca800',
      pal: { '--bg-0': '#fbf7dd', '--bg-1': '#fffef2', '--bg-2': '#f7f2cd', '--bg-3': '#efe6a8', '--text': '#423b10', '--text-2': '#7a7030', '--line': '#eee5a6', '--shadow': 'rgba(130,110,20,.13)', '--vinyl-face': '#3c3512' },
      prev: 'linear-gradient(135deg,#faf3bd,#eedd85)' },
    { id: 'grape', name: '魅紫', mode: 'dark', accent: '#9d5ce8',
      pal: { '--bg-0': '#170f26', '--bg-1': '#1e152f', '--bg-2': '#261c3b', '--bg-3': '#332550', '--text': '#efe8fa', '--text-2': '#a795c7', '--line': '#372a55', '--shadow': 'rgba(0,0,0,.5)', '--vinyl-face': '#221638' },
      prev: 'linear-gradient(135deg,#2c2044,#170f26)' },
    { id: 'mocha', name: '摩卡棕', mode: 'dark', accent: '#c08a5a',
      pal: { '--bg-0': '#1e1712', '--bg-1': '#251d16', '--bg-2': '#2e241b', '--bg-3': '#3c2f23', '--text': '#f3ebe2', '--text-2': '#b7a48f', '--line': '#44362a', '--shadow': 'rgba(0,0,0,.5)', '--vinyl-face': '#241b13' },
      prev: 'linear-gradient(135deg,#38291c,#1e1712)' },
    { id: 'mint', name: '薄荷青', mode: 'dark', accent: '#2dd4bf',
      pal: { '--bg-0': '#0b1a1a', '--bg-1': '#0f2222', '--bg-2': '#142d2c', '--bg-3': '#1c3c3a', '--text': '#e2f2f0', '--text-2': '#8fb0ac', '--line': '#214543', '--shadow': 'rgba(0,0,0,.5)', '--vinyl-face': '#122524' },
      prev: 'linear-gradient(135deg,#173a37,#0b1a1a)' },
  ];
  function syncThemeControls(mode, accent) {
    document.querySelectorAll('#themeMode button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    document.querySelectorAll('#accentSwatches button').forEach((b) => b.classList.toggle('active', b.dataset.accent === accent));
  }
  function renderSkins() {
    const grid = $('skinGrid');
    if (!grid) return;
    const stored = localStorage.getItem('uzz.theme.skin');
    const mode = localStorage.getItem('uzz.theme.mode') || 'dark';
    const accent = localStorage.getItem('uzz.theme.accent') || '#ec4141';
    grid.innerHTML = SKINS.map((s) => {
      // 旧版本没有 skin 存量：按 深浅+主题色 推断经典红/极简白
      const active = stored ? (stored === s.id) : (s.id === (mode === 'light' ? 'light' : 'classic') && s.accent === accent);
      return `<button class="skin-card${active ? ' active' : ''}" data-id="${s.id}" data-mode="${s.mode}" data-accent="${s.accent}">
        <span class="skin-prev" style="background:${s.prev || (s.mode === 'light' ? '#fff' : '#171a21')}">
          <span class="skin-note">♪</span>
          <span class="skin-dot" style="background:${s.accent}"></span>
          <span class="skin-bar" style="background:${s.accent}"></span>
        </span>
        <span class="skin-name">${s.name}<i class="skin-mode">${s.mode === 'light' ? '浅色' : '深色'}</i></span>
      </button>`;
    }).join('');
    grid.querySelectorAll('.skin-card').forEach((card) => {
      card.addEventListener('click', () => {
        const mode = card.dataset.mode, accent = card.dataset.accent;
        localStorage.setItem('uzz.theme.skin', card.dataset.id);
        localStorage.setItem('uzz.theme.mode', mode);
        localStorage.setItem('uzz.theme.accent', accent);
        applyTheme();
        syncThemeControls(mode, accent);
        grid.querySelectorAll('.skin-card').forEach((c) => c.classList.toggle('active', c === card));
        toast('皮肤已切换：' + card.querySelector('.skin-name').textContent.replace('浅色', '').replace('深色', '').replace('✓', '').trim());
      });
    });
  }

  /* ============================================================
   * 本地数据：歌单 / 下载记录 / 搜索历史
   * ============================================================ */
  let playlists = loadJSON('uzz.playlists', []);
  let downloads = loadJSON('uzz.downloads', []);
  let searchHistory = loadJSON('uzz.searchHistory', []);

  function savePlaylists() { global.XYSync?.stampPlaylists(playlists); saveJSON('uzz.playlists', playlists); renderPlaylistNav(); }
  function saveDownloads() { saveJSON('uzz.downloads', downloads.slice(0, 200)); renderDownloads(); }

  /* ============================================================
   * 曲目列表渲染（搜索/收藏/历史/歌单共用）
   * ============================================================ */
  function trackLi(t, i) {
    const vendorName = { netease: '网易云', tencent: 'QQ', kugou: '酷狗', kuwo: '酷我' }[t.vendor] || t.vendor;
    let sub = t.artist;
    if (t.album) sub += ' · ' + t.album;
    const dur = t.duration ? `<span class="dur">${fmtDur(t.duration)}</span>` : '<span class="dur"></span>';
    const cover = t.pic
      ? `<img class="cov" src="${escapeHtml(UzzApi.picProxy(t.pic))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>`
      : '<div class="cov"></div>';
    const num = i != null ? `<span class="idx" style="width:24px;text-align:right;color:var(--text-2);font-size:12px">${i + 1}</span>` : '';
    return `<li class="song" data-id="${escapeHtml(t.id)}" data-vendor="${escapeHtml(t.vendor)}" data-name="${escapeHtml(t.name)}" data-artist="${escapeHtml(t.artist)}" data-album="${escapeHtml(t.album)}" data-pic="${escapeHtml(t.pic)}" data-duration="${t.duration || 0}">
      ${num}${cover}
      <div class="info">
        <div class="name">${escapeHtml(t.name)}<span class="badge">${escapeHtml(vendorName)}</span></div>
        <div class="sub">${escapeHtml(sub)}</div>
      </div>
      <div class="acts">
        <button class="act-add" aria-label="加入歌单" title="加入歌单">⊕</button>
        <button class="act-dl" aria-label="下载" title="下载">⬇</button>
        <button class="act-play" aria-label="播放" title="播放">▶</button>
      </div>
      ${dur}
    </li>`;
  }
  function fmtDur(sec) {
    sec = Math.floor(sec || 0);
    return Math.floor(sec / 60) + ':' + (sec % 60 < 10 ? '0' : '') + (sec % 60);
  }
  // 实体行（歌手/专辑/歌单搜索结果，点击进入对应歌曲列表）
  function entityLi(t, etype) {
    const label = { artist: '歌手', album: '专辑', playlist: '歌单' }[etype] || etype;
    const sub = etype === 'playlist' ? (t.artist ? 'by ' + t.artist : '') : (t.artist || '');
    const cover = t.pic
      ? `<img class="cov" src="${escapeHtml(UzzApi.picProxy(t.pic))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>`
      : `<div class="cov ent-${etype}">${etype === 'artist' ? '🎤' : etype === 'album' ? '💿' : '🎵'}</div>`;
    return `<li class="song entity" data-etype="${etype}" data-id="${escapeHtml(t.id)}" data-name="${escapeHtml(t.name)}" data-pic="${escapeHtml(t.pic || '')}">
      ${cover}
      <div class="info">
        <div class="name">${escapeHtml(t.name)}<span class="badge">${label}</span></div>
        <div class="sub">${escapeHtml(sub)}</div>
      </div>
      <div class="acts"><button class="act-play" aria-label="查看" title="查看">▶</button></div>
    </li>`;
  }
  function liTrack(li) {
    return {
      id: li.dataset.id, vendor: li.dataset.vendor, name: li.dataset.name,
      artist: li.dataset.artist, album: li.dataset.album, pic: li.dataset.pic,
      url: li.dataset.url || '',
      duration: Number(li.dataset.duration) || 0,
    };
  }
  function bindListClick(ul) {
    ul.addEventListener('click', (e) => {
      const li = e.target.closest('li.song');
      if (!li) return;
      const track = liTrack(li);
      if (e.target.closest('.act-dl')) { doDownload(track); return; }
      if (e.target.closest('.act-add')) { openAddMenu(e, track); return; }
      Player.loadAndPlay(track);
    });
  }

  /* 最近播放表格（.ncm-row）：双击播放、行内按钮、播放中行暂停/续播 */
  function bindHistoryTableClick(ul) {
    if (!ul || ul.dataset.bound) return;
    ul.dataset.bound = '1';
    ul.addEventListener('click', (e) => {
      const li = e.target.closest('li.ncm-row');
      if (!li) return;
      const his = Player.getHistory();
      const t = his[parseInt(li.dataset.hi, 10)];
      if (!t) return;
      // 行内操作按钮
      const actBtn = e.target.closest('button[data-act]');
      if (actBtn) {
        e.stopPropagation();
        const act = actBtn.dataset.act;
        if (act === 'fav') {
          Player.toggleFav(t);
          renderLibrary();
          return;
        }
        if (act === 'dl') { doDownload(t); return; }
        if (act === 'add') { openAddMenu(e, t); return; }
        if (act === 'more') { toast('可加入歌单或下载该歌曲'); return; }
      }
      const cur = Player.getState().current;
      // 点正在播放的行 =暂停/ 续播
      if (cur && cur.id === t.id && cur.vendor === t.vendor) { Player.toggle(); return; }
      Player.loadAndPlay(t);
    });
    ul.addEventListener('dblclick', (e) => {
      const li = e.target.closest('li.ncm-row');
      if (!li) return;
      const t = Player.getHistory()[parseInt(li.dataset.hi, 10)];
      if (t) Player.loadAndPlay(t);
    });
  }

  /* ---------- 下载 ---------- */
  function doDownload(track) {
    toast('准备下载…');
    const a = document.createElement('a');
    a.href = UzzApi.downloadUrl(track);
    a.download = `${track.name} - ${track.artist}.mp3`.replace(/[\\/:*?"<>|]/g, '_');
    document.body.appendChild(a);
    a.click();
    a.remove();
    downloads.unshift({
      id: track.id, vendor: track.vendor, name: track.name, artist: track.artist,
      time: Date.now(), ok: false,
    });
    saveDownloads();
    toast('已开始下载');
  }

  /* ============================================================
   * 加入歌单浮层
   * ============================================================ */
  function openAddMenu(e, track) {
    const menu = $('addPlMenu');
    const items = playlists.map((p) =>
      `<button class="ap-item" data-pl="${escapeHtml(p.id)}">${escapeHtml(p.name)}（${p.tracks.length}）</button>`
    ).join('');
    menu.innerHTML = `<div class="ap-title">添加到歌单</div>${items}<button class="ap-item ap-new" data-new="1">＋ 新建歌单</button>`;
    menu.classList.remove('hidden');
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.min(e.clientX, window.innerWidth - mw - 12) + 'px';
    menu.style.top = Math.min(e.clientY + 8, window.innerHeight - mh - 12) + 'px';
    menu._track = track;
  }
  // 播放列表面板里的「加入歌单」按钮派发的事件（用按钮坐标构造定位）
  document.addEventListener('uzz:addToPlaylist', (ev) => {
    const d = ev.detail || {};
    if (!d.track) return;
    openAddMenu({ clientX: d.x, clientY: d.y }, d.track);
  });
  document.addEventListener('click', (e) => {
    const menu = $('addPlMenu');
    if (!menu || menu.classList.contains('hidden')) return;
    if (e.target.closest('#addPlMenu')) {
      const track = menu._track;
      const plBtn = e.target.closest('button.ap-item');
      if (plBtn && plBtn.dataset.new) {
        openPlModal((pl) => { addToPlaylist(pl.id, track); });
      } else if (plBtn && track) {
        addToPlaylist(plBtn.dataset.pl, track);
      }
      menu.classList.add('hidden');
      return;
    }
    menu.classList.add('hidden');
  });
  function addToPlaylist(plId, track) {
    const pl = playlists.find((p) => p.id === plId);
    if (!pl || !track) return;
    if (pl.tracks.some((t) => t.id === track.id && t.vendor === track.vendor)) { toast('歌单里已有这首歌'); return; }
    pl.tracks.unshift(track);
    if (!pl.cover && track.pic) pl.cover = track.pic;
    savePlaylists();
    if (curPlaylist && curPlaylist.type === 'local' && curPlaylist.id === plId) renderPlaylistView();
    toast(`已添加到「${pl.name}」`);
  }
  // 底部播放条「收藏到歌单」图标：打开加入歌单浮层（定位到该按钮下方）
  function bindAddFavButton() {
    const btn = $('fpAddFav');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      const t = (window.Player && window.Player.getState && window.Player.getState().current);
      if (!t) { toast('先选一首歌'); return; }
      const r = e.currentTarget.getBoundingClientRect();
      openAddMenu({ clientX: r.left, clientY: r.bottom + 6 }, t);
    });
  }

  /* ============================================================
   * 新建歌单弹窗
   * ============================================================ */
  function openPlModal(cb) {
    $('plModal').classList.remove('hidden');
    const inp = $('plModalName');
    inp.value = '';
    setTimeout(() => inp.focus(), 50);
    plModalCb = cb || null;
  }
  let plModalCb = null;
  function confirmPlModal() {
    const name = $('plModalName').value.trim();
    if (!name) { toast('先给歌单起个名字'); return; }
    const pl = { id: 'L' + Date.now(), name, cover: '', tracks: [], createdAt: Date.now(), kind: 'created' };
    playlists.unshift(pl);
    savePlaylists();
    $('plModal').classList.add('hidden');
    toast(`歌单「${name}」已创建`);
    if (plModalCb) { plModalCb(pl); plModalCb = null; }
  }

  /* ============================================================
   * 识别网易云 ID · 选择性导入歌单
   * ============================================================ */
  let impState = { tracks: [], type: '', info: null };
  function typeLabel(t) {
    return { playlist: '歌单', album: '专辑', song: '单曲', artist: '歌手' }[t] || t;
  }
  const IMP_PLATFORMS = {
    netease: { label: '网易云', hint: '支持歌单、专辑、单曲、歌手；粘贴分享链接或数字 ID 即可识别' },
    qq: { label: 'QQ音乐', hint: '支持公开歌单：粘贴歌单分享链接（含 id=）或直接填歌单数字 ID' },
    kugou: { label: '酷狗', hint: '支持公开歌单：粘贴歌单分享链接（含 specialid=）或直接填歌单数字 ID' },
  };
  function impPlatform() { return ($('impPlatform') && $('impPlatform').value) || 'netease'; }
  function openImportModal() {
    const m = $('importModal');
    m.classList.remove('hidden');
    $('impResult').classList.add('hidden');
    $('impInput').value = '';
    $('impInput').disabled = false;
    $('impResolve').disabled = false;
    $('impHint').textContent = IMP_PLATFORMS[impPlatform()].hint;
    impState = { tracks: [], type: '', info: null };
    setTimeout(() => $('impInput').focus(), 50);
  }
  function closeImportModal() { $('importModal').classList.add('hidden'); }
  async function resolveNcm() {
    const input = $('impInput').value.trim();
    const pf = impPlatform();
    if (!input) { toast('先粘贴' + IMP_PLATFORMS[pf].label + '链接或 ID'); return; }
    $('impResolve').disabled = true;
    $('impInput').disabled = true;
    $('impHint').textContent = '正在识别…';
    try {
      const r = await UzzApi.resolveImport(input, pf);
      impState = { tracks: r.tracks, type: r.type, info: r.info };
      impState.tracks.forEach((t) => { t.__sel = true; });
      renderImpResult(r);
      $('impResult').classList.remove('hidden');
      $('impHint').textContent = `识别成功：${IMP_PLATFORMS[pf].label}·${typeLabel(r.type)}，共 ${r.tracks.length} 首`;
    } catch (e) {
      $('impHint').textContent = '识别失败：' + (e.message || e);
      $('impResolve').disabled = false;
      $('impInput').disabled = false;
    }
  }
  function renderImpResult(r) {
    const info = r.info || {};
    const cv = $('impCover');
    if (info.cover) {
      cv.src = UzzApi.picProxy(info.cover);
      cv.style.visibility = 'visible';
      cv.onerror = () => { cv.style.visibility = 'hidden'; };
    } else {
      cv.removeAttribute('src');
      cv.style.visibility = 'hidden';
    }
    $('impPlName').textContent = info.name || '未命名';
    const sub = [`共 ${r.tracks.length} 首`];
    if (info.creator) sub.push('by ' + info.creator);
    $('impPlSub').textContent = sub.join(' · ');
    $('impName').value = info.name || (IMP_PLATFORMS[impPlatform()].label + '导入');
    $('impFilter').value = '';
    renderImpList('');
    updateImpCount();
  }
  function renderImpList(kw) {
    const ul = $('impList');
    kw = (kw || '').trim().toLowerCase();
    const list = impState.tracks.filter((t) =>
      !kw || (t.name + ' ' + t.artist + ' ' + t.album).toLowerCase().includes(kw));
    ul.innerHTML = list.length
      ? list.map((t) => {
          const idx = impState.tracks.indexOf(t);
          const cover = t.pic
            ? `<img class="cov" src="${escapeHtml(UzzApi.picProxy(t.pic))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>`
            : '<div class="cov"></div>';
          const sub = (t.artist || '') + (t.album ? ' · ' + t.album : '');
          return `<li class="imp-item">
            <label class="imp-check"><input type="checkbox" data-i="${idx}" ${t.__sel ? 'checked' : ''}/></label>
            ${cover}
            <div class="info"><div class="name">${escapeHtml(t.name)}</div><div class="sub">${escapeHtml(sub)}</div></div>
            <span class="dur">${escapeHtml(t.duration ? fmtDur(t.duration) : '')}</span>
          </li>`;
        }).join('')
      : '<li class="imp-empty">没有匹配的歌曲</li>';
  }
  function updateImpCount() {
    const n = impState.tracks.filter((t) => t.__sel).length;
    $('impCount').textContent = '已选 ' + n + ' 首';
    $('impImport').textContent = '导入选中(' + n + ')';
  }
  function impToggleAll(sel) {
    impState.tracks.forEach((t) => { t.__sel = sel; });
    renderImpList($('impFilter').value);
    updateImpCount();
  }
  function doImportNcm() {
    const sel = impState.tracks.filter((t) => t.__sel);
    if (!sel.length) { toast('请至少选择一首'); return; }
    let name = $('impName').value.trim() || (impState.info && impState.info.name) || (IMP_PLATFORMS[impPlatform()].label + '导入');
    const pl = { id: 'L' + Date.now(), name, cover: (impState.info && impState.info.cover) || '', tracks: [], createdAt: Date.now(), kind: 'collected' };
    let added = 0;
    sel.forEach((t) => {
      const tr = {
        id: String(t.id), name: t.name, artist: t.artist, artistId: t.artistId || '',
        album: t.album, albumId: t.albumId || '',
        pic: t.pic, vendor: t.vendor || 'netease', duration: t.duration || 0, url: t.url || '',
      };
      if (pl.tracks.some((x) => x.id === tr.id && x.vendor === tr.vendor)) return;
      pl.tracks.push(tr); added++;
    });
    playlists.unshift(pl);
    savePlaylists();
    closeImportModal();
    toast(`已导入 ${added} 首到「${name}」`);
    curPlaylist = { type: 'local', id: pl.id };
    showView('playlist', false, false);
    renderPlaylistView();
  }

  /* ============================================================
   * 侧栏歌单导航
   * ============================================================ */
  // 旧数据没有 kind 字段：有封面的视为导入收藏，否则视为自建
  function plKind(p) { return p.kind || (p.cover ? 'collected' : 'created'); }
  function renderPlaylistNav() {
    const mk = (p) => `
      <li data-pl="${escapeHtml(p.id)}" class="${curPlaylist && curPlaylist.type === 'local' && curPlaylist.id === p.id ? 'active' : ''}">
        <img class="plc-cover" src="${p.cover ? escapeHtml(UzzApi.picProxy(p.cover)) : 'data:,'}" onerror="this.style.visibility='hidden'" alt="" />
        <span class="plc-name">${escapeHtml(p.name)}</span>
        <button class="plc-del" data-del="${escapeHtml(p.id)}" title="删除歌单">✕</button>
      </li>`;
    const created = $('playlistCreated');
    const collected = $('playlistCollected');
    if (created) created.innerHTML = playlists.filter((p) => plKind(p) === 'created').map(mk).join('') || '<li class="pln-empty">还没有创建歌单</li>';
    if (collected) collected.innerHTML = playlists.filter((p) => plKind(p) === 'collected').map(mk).join('') || '<li class="pln-empty">点击 ⤓ 导入歌单</li>';
  }

  // 我的收藏：收藏歌单卡片墙（点击进入歌单详情）
  function renderCollectView() {
    const grid = $('collectGrid');
    if (!grid) return;
    const cols = playlists.filter((p) => plKind(p) === 'collected');
    if (!cols.length) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-ic">⤓</div><div class="empty-title">还没有收藏的歌单</div><div class="empty-sub">点侧栏「收藏的歌单」旁的 ⤓ 导入网易云 / QQ / 酷狗歌单</div></div>';
      return;
    }
    grid.innerHTML = cols.map((p) => `
      <div class="pl-card" data-pl="${escapeHtml(p.id)}">
        <div style="position:relative">
          <img class="plc-img" src="${p.cover ? escapeHtml(UzzApi.picProxy(p.cover)) : 'data:,'}" loading="lazy" onerror="this.style.visibility='hidden'" alt="" />
          <span class="plc-plays">${p.tracks.length} 首</span>
        </div>
        <div class="plc-name">${escapeHtml(p.name)}</div>
      </div>`).join('');
  }

  // 私人漫游：热歌榜随机抽 30 首开始播放
  async function startRoam() {
    const btn = $('roamPlay');
    if (btn) { btn.disabled = true; btn.textContent = '正在准备漫游…'; }
    try {
      const id = '3778678'; // 云音乐热歌榜
      const seed = Math.floor(Date.now() / 60000); // 每分钟换一批
      await openOnlinePlaylist(id, { title: '私人漫游 · 随机热歌', shuffle: true });
      // 洗牌后再取 30 首
      if (curPlaylist && curPlaylist.tracks && curPlaylist.tracks.length > 30) {
        curPlaylist.tracks = shuffleSeeded(curPlaylist.tracks, seed).slice(0, 30);
        renderPlaylistView();
      }
      toast('漫游开始，随机 30 首');
    } catch (e) {
      toast('漫游失败：' + (e.message || e));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '▶ 开始漫游'; }
    }
  }

  /* ============================================================
   * 视图切换
   * ============================================================ */
  const VIEWS = ['discover', 'search', 'playlist', 'fav', 'history', 'downloads', 'local', 'charts', 'settings', 'podcast', 'roam', 'follow', 'collect'];
  let curView = 'discover';
  let curPlaylist = null; // {type:'online', plId, info, tracks} | {type:'local', id}
  let navStack = ['discover'];
  let navPos = 0;
  function updateNavBtns() {
    const b = $('navBack'), f = $('navFwd');
    if (b) b.disabled = navPos <= 0;
    if (f) f.disabled = navPos >= navStack.length - 1;
  }
  function pushNav(name) {
    if (!name) return;
    if (navStack[navPos] === name) return;
    navStack = navStack.slice(0, navPos + 1);
    navStack.push(name);
    navPos = navStack.length - 1;
    updateNavBtns();
  }
  function goBack() {
    if (navPos <= 0) return;
    navPos--;
    showView(navStack[navPos], false, false);
    updateNavBtns();
  }
  function goFwd() {
    if (navPos >= navStack.length - 1) return;
    navPos++;
    showView(navStack[navPos], false, false);
    updateNavBtns();
  }
  // 前进键已按网易云样式移除（仅保留后退键），goFwd 保留供导航栈复用
  function showView(name, keepNav, record) {
    curView = name;
    if (record !== false) pushNav(name);
    VIEWS.forEach((v) => {
      const el = $('view' + v.charAt(0).toUpperCase() + v.slice(1));
      if (el) el.classList.toggle('hidden', v !== name);
    });
    const stb = $('searchTabsBar');
    if (stb) stb.classList.toggle('hidden', name !== 'search');
    if (!keepNav) {
      document.querySelectorAll('#sideNav button').forEach((b) => {
        b.classList.toggle('active', b.dataset.view === name);
      });
      document.querySelectorAll('.playlist-nav li').forEach((li) => {
        li.classList.toggle('active', name === 'playlist' && curPlaylist && curPlaylist.type === 'local' && curPlaylist.id === li.dataset.pl);
      });
    }
    if (name === 'fav' || name === 'history') renderLibrary();
    if (name === 'downloads') renderDownloads();
    if (name === 'collect') renderCollectView();
    if (name === 'local') loadLocalView(curLocalFilter, true);
    if (name === 'charts') loadCharts();
  }

  /* ============================================================
   * 推荐页
   * ============================================================ */
  const TOPLIST = { daily: '3778678', douyin: '2250011882', hot: '3778678', new: '3779629' };
  function dailyDate() {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1, day: d.getDate() };
  }
  function dailyTitle() {
    const { m, day } = dailyDate();
    return `${m}月${day}日 每日推荐`;
  }
  function openToplist(key) {
    const id = TOPLIST[key];
    if (key === 'daily') {
      // 每日推荐：按日期种子洗牌 + 取子集，保证每天看到的歌都不一样
      openOnlinePlaylist(id, { title: dailyTitle(), daily: true });
    } else openOnlinePlaylist(id);
  }

  // 音乐榜单：列出精选榜单，点击走 /api/playlist 取曲目
  async function loadCharts() {
    const grid = $('chartsGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="loading-pad" style="grid-column:1/-1"><span class="spin"></span> 榜单加载中…</div>';
    try {
      const charts = await UzzApi.getCharts();
      if (!charts.length) { grid.innerHTML = '<div class="loading-pad" style="grid-column:1/-1">暂无可用的榜单</div>'; return; }
      grid.innerHTML = charts.map((c) => `
        <div class="pl-card chart-card" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}">
          <div class="chart-ic">${c.icon || '📊'}</div>
          <div class="plc-name">${escapeHtml(c.name)}</div>
          <div class="plc-desc">${escapeHtml(c.desc || '')}</div>
          <div class="plc-plays">点击听榜</div>
        </div>`).join('');
    } catch (e) {
      grid.innerHTML = '<div class="loading-pad" style="grid-column:1/-1">榜单加载失败：' + escapeHtml(e.message || e) + '</div>';
    }
  }
  // 发现页「榜单精选」横向卡片（与音乐榜单页共用 /api/charts）
  async function loadDiscoverCharts() {
    const row = $('chartsRow');
    if (!row) return;
    row.innerHTML = '<div class="loading-pad"><span class="spin"></span> 榜单加载中…</div>';
    try {
      const charts = (await UzzApi.getCharts()).slice(0, 8);
      row.innerHTML = charts.map((c) => `
        <div class="chart-card" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}">
          <div class="ch-ic" style="background:${CHART_COLORS[c.id] || 'linear-gradient(135deg,#7c5cd6,#4f46e5)'}">${c.icon || '📊'}</div>
          <div class="ch-txt">
            <div class="ch-name">${escapeHtml(c.name)}</div>
            <div class="ch-desc">${escapeHtml(c.desc || '')}</div>
            <div class="ch-play">▶ 立即听榜</div>
          </div>
        </div>`).join('');
    } catch (e) {
      row.innerHTML = '<div class="loading-pad">榜单加载失败：' + escapeHtml(e.message || e) + '</div>';
    }
  }
  const CHART_COLORS = {
    3778678: 'linear-gradient(135deg,#ff6a3d,#c73e1d)',
    3779629: 'linear-gradient(135deg,#2fae61,#0f7a3d)',
    19723756: 'linear-gradient(135deg,#38bdf8,#2563eb)',
    2884035: 'linear-gradient(135deg,#a78bfa,#6d28d9)',
    1978921795: 'linear-gradient(135deg,#f472b6,#be185d)',
    991319590: 'linear-gradient(135deg,#fbbf24,#b45309)',
    5059661515: 'linear-gradient(135deg,#f87171,#991b1b)',
    71385702: 'linear-gradient(135deg,#94a3b8,#334155)',
  };

  async function loadRecommend() {
    const grid = $('plGrid');
    grid.innerHTML = '<div class="loading-pad" style="grid-column:1/-1"><span class="spin"></span> 推荐歌单加载中…</div>';
    try {
      const list = await UzzApi.getPlaylists('全部', 15);
      grid.innerHTML = list.map((p) => `
        <div class="pl-card" data-id="${escapeHtml(p.id)}">
          <div style="position:relative">
            <img class="plc-img" src="${escapeHtml(UzzApi.picProxy(p.cover))}" loading="lazy" onerror="this.style.visibility='hidden'" alt="" />
            <span class="plc-plays">▶ ${fmtCount(p.playCount)}</span>
          </div>
          <div class="plc-name">${escapeHtml(p.name)}</div>
        </div>`).join('');
    } catch (e) {
      grid.innerHTML = `<div class="loading-pad" style="grid-column:1/-1">推荐歌单加载失败：${escapeHtml(e.message || e)}</div>`;
    }
  }

  /* ============================================================
   * 歌单详情视图（在线榜单 / 本地歌单）
   * ============================================================ */
  async function openOnlinePlaylist(plId, opts) {
    opts = opts || {};
    curPlaylist = { type: 'online', plId, info: null, tracks: [] };
    showView('playlist');
    $('plpName').textContent = opts.title || '歌单加载中…';
    $('plpStats').textContent = '';
    $('plpDesc').textContent = '';
    $('plpCover').removeAttribute('src');
    $('plpSave').classList.remove('hidden');
    $('plpDelete').classList.add('hidden');
    $('plpTracks').innerHTML = '<li class="loading-pad"><span class="spin"></span> 歌单加载中…</li>';
    try {
      const { info, tracks } = await UzzApi.getPlaylist(plId, 50);
      if (!curPlaylist || curPlaylist.plId !== plId) return; // 已切走
      let list = tracks;
      if (opts.shuffle || opts.daily) {
        const { y, m, day } = dailyDate();
        const seed = y * 10000 + m * 100 + day;
        list = shuffleSeeded(tracks, seed);
        if (opts.daily) {
          // 每日推荐：洗牌后只取前 30 首 —— 不同日期 = 不同顺序 + 不同子集
          list = list.slice(0, Math.min(30, list.length));
        }
      }
      curPlaylist.info = info;
      curPlaylist.tracks = list;
      $('plpName').textContent = opts.title || info.name || '歌单';
      $('plpStats').textContent = opts.daily
        ? `共 ${list.length} 首 · ${dailyDate().m}月${dailyDate().day}日更新 · 每天 6:00 换一批`
        : `共 ${list.length} 首 · 播放量 ${fmtCount(info.playCount)}`;
      $('plpDesc').textContent = info.desc || '';
      if (info.cover) $('plpCover').src = UzzApi.picProxy(info.cover);
      $('plpTracks').innerHTML = list.length
        ? list.map((t, i) => trackLi(t, i)).join('')
        : '<li class="loading-pad">歌单是空的</li>';
    } catch (e) {
      $('plpTracks').innerHTML = `<li class="loading-pad">加载失败：${escapeHtml(e.message || e)}<br><small class="hint">检查网络后重试，或先去搜索听歌</small></li>`;
    }
  }
  function openLocalPlaylist(localId) {
    const pl = playlists.find((p) => p.id === localId);
    if (!pl) return;
    curPlaylist = { type: 'local', id: localId };
    showView('playlist');
    renderPlaylistView();
  }
  // 实体详情视图（歌手热门歌曲 / 专辑曲目，复用歌单详情视图）
  async function openEntityView(key, loadFn, loadingTitle) {
    curPlaylist = { type: 'online', plId: key, info: null, tracks: [] };
    showView('playlist');
    $('plpName').textContent = loadingTitle || '加载中…';
    $('plpStats').textContent = '';
    $('plpDesc').textContent = '';
    $('plpCover').removeAttribute('src');
    $('plpSave').classList.remove('hidden');
    $('plpDelete').classList.add('hidden');
    $('plpTracks').innerHTML = '<li class="loading-pad"><span class="spin"></span> 加载中…</li>';
    try {
      const r = await loadFn();
      if (!curPlaylist || curPlaylist.plId !== key) return; // 已切走
      curPlaylist.info = { cover: r.cover || '', name: r.title, desc: r.desc || '', playCount: 0 };
      curPlaylist.tracks = r.tracks;
      $('plpName').textContent = r.title;
      $('plpStats').textContent = r.stats || `共 ${r.tracks.length} 首`;
      $('plpDesc').textContent = r.desc || '';
      if (r.cover) $('plpCover').src = UzzApi.picProxy(r.cover);
      $('plpTracks').innerHTML = r.tracks.length
        ? r.tracks.map((t, i) => trackLi(t, i)).join('')
        : '<li class="loading-pad">没有歌曲</li>';
    } catch (e) {
      $('plpTracks').innerHTML = `<li class="loading-pad">加载失败：${escapeHtml(e.message || e)}<br><small class="hint">检查网络后重试，或先去搜索听歌</small></li>`;
    }
  }
  function openArtistView(id, name, pic) {
    return openEntityView('artist:' + id, async () => {
      const tracks = await UzzApi.getArtistTop(id, 50);
      return {
        title: name || '歌手',
        cover: pic || (tracks[0] && tracks[0].pic) || '',
        tracks,
        desc: '歌手热门歌曲',
        stats: `共 ${tracks.length} 首 · 热门歌曲`,
      };
    }, (name || '歌手') + ' 加载中…');
  }
  function openAlbumView(id, fallbackName) {
    return openEntityView('album:' + id, async () => {
      const { info, tracks } = await UzzApi.getAlbum(id);
      return {
        title: info.name || fallbackName || '专辑',
        cover: info.pic || (tracks[0] && tracks[0].pic) || '',
        tracks,
        desc: info.desc || '',
        stats: `共 ${tracks.length} 首` + (info.artist ? ' · ' + info.artist : ''),
      };
    }, fallbackName || '专辑加载中…');
  }
  function renderPlaylistView() {
    if (!curPlaylist) return;
    if (curPlaylist.type === 'local') {
      const pl = playlists.find((p) => p.id === curPlaylist.id);
      if (!pl) { showView('discover'); return; }
      $('plpName').textContent = pl.name;
      $('plpStats').textContent = `共 ${pl.tracks.length} 首 · 我创建的歌单`;
      $('plpDesc').textContent = '';
      if (pl.cover) $('plpCover').src = UzzApi.picProxy(pl.cover);
      else $('plpCover').removeAttribute('src');
      $('plpSave').classList.add('hidden');
      $('plpDelete').classList.remove('hidden');
      $('plpTracks').innerHTML = pl.tracks.length
        ? pl.tracks.map((t, i) => trackLi(t, i)).join('')
        : '<li class="loading-pad">歌单是空的，去歌曲列表点 ⊕ 添加吧</li>';
    }
  }
  function playAllInPlaylist() {
    if (!curPlaylist) return;
    let tracks = [];
    if (curPlaylist.type === 'online') tracks = curPlaylist.tracks || [];
    else {
      const pl = playlists.find((p) => p.id === curPlaylist.id);
      tracks = pl ? pl.tracks : [];
    }
    if (!tracks.length) { toast('歌单还没有歌曲'); return; }
    Player.playQueue(tracks);
  }
  function saveOnlinePlaylist() {
    if (!curPlaylist || curPlaylist.type !== 'online') return;
    const info = curPlaylist.info || {};
    const pl = {
      id: 'L' + Date.now(),
      name: $('plpName').textContent || '收藏歌单',
      cover: info.cover || '',
      tracks: (curPlaylist.tracks || []).slice(),
      createdAt: Date.now(),
    };
    playlists.unshift(pl);
    savePlaylists();
    toast(`已收藏到我的歌单：「${pl.name}」`);
  }
  function deleteLocalPlaylist() {
    if (!curPlaylist || curPlaylist.type !== 'local') return;
    const pl = playlists.find((p) => p.id === curPlaylist.id);
    if (!pl) return;
    if (!confirm(`确定删除歌单「${pl.name}」？`)) return;
    playlists = playlists.filter((p) => p.id !== curPlaylist.id);
    savePlaylists();
    curPlaylist = null;
    showView('discover');
    toast('歌单已删除');
  }

  /* ============================================================
   * 收藏 / 历史 / 下载 视图
   * ============================================================ */
  /* ---------- 最近播放：网易云式表格行 ----------
     播放时间按"多久之前"显示：刚刚 / N分钟前 / 今天 HH:MM / MM月DD日 / YYYY年MM月DD日 */
  function relTime(ms) {
    if (!ms) return '很久以前';
    const d = Date.now() - ms;
    if (d < 60000) return '刚刚';
    if (d < 3600e3) return Math.floor(d / 60000) + ' 分钟前';
    const t = new Date(ms);
    const today = new Date();
    const sameDay = t.toDateString() === today.toDateString();
    if (sameDay) return '今天 ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    const yst = new Date(today.getTime() - 86400e3);
    if (t.toDateString() === yst.toDateString()) return '昨天 ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    if (t.getFullYear() === today.getFullYear()) return (t.getMonth() + 1) + '月' + t.getDate() + '日';
    return t.getFullYear() + '年' + (t.getMonth() + 1) + '月' + t.getDate() + '日';
  }
  // 来源/版权徽章：超清版权 / MV / VIP / 试听
  function trackBadges(t) {
    const b = [];
    if (t.vendor === 'local') b.push('<i class="bdg bdg-local">本地</i>');
    else b.push('<i class="bdg bdg-sq">超清版权</i>');
    if (t.quality === 'hires') b.push('<i class="bdg bdg-hires">Hi-Res</i>');
    if (t.isMv) b.push('<i class="bdg bdg-mv">MV</i>');
    if (t.vip) b.push('<i class="bdg bdg-vip">VIP</i>');
    if (t.trial) b.push('<i class="bdg bdg-trial">试听</i>');
    return b.join('');
  }
  function historyRow(t, i) {
    const cur = Player.getState().current;
    const isCur = cur && cur.id === t.id && cur.vendor === t.vendor;
    const fav = Player.getFavorites().some((f) => f.id === t.id && f.vendor === t.vendor);
    const cov = t.pic ? `<img src="${escapeHtml(UzzApi.picProxy(t.pic))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>` : '';
    return `
      <li class="ncm-row${isCur ? ' playing' : ''}" data-hi="${i}">
        <span class="c-idx">
          <i class="idx-num">${String(i + 1).padStart(2, '0')}</i>
          <i class="idx-play">▶</i>
          <i class="idx-pause">⏸</i>
        </span>
        <span class="c-title">
          <span class="ncm-cover">${cov}</span>
          <span class="ncm-tt">
            <span class="ncm-name">${escapeHtml(t.name || '未知')}</span>
            <span class="ncm-sub">${trackBadges(t)}<span class="ncm-artist">${escapeHtml(t.artist || '未知')}</span></span>
          </span>
          <span class="ncm-row-acts">
            <button data-act="dl" title="下载">⬇</button>
            <button data-act="add" title="加入歌单">⊞</button>
            <button data-act="more" title="更多">···</button>
          </span>
        </span>
        <span class="c-album">${escapeHtml(t.album || '—')}</span>
        <span class="c-fav">
          <button class="ncm-heart${fav ? ' on' : ''}" data-act="fav" title="喜欢">${fav ? '♥' : '♡'}</button>
        </span>
        <span class="c-time">${relTime(t.at)}</span>
      </li>`;
  }

  // 收藏变化 → 若正停在「我喜欢的音乐 / 我的收藏 / 最近播放」视图，立刻重绘，
  // 否则收藏后列表还是旧的，用户会以为"没加入"。
  // 注意：必须注册在模块顶层（不能塞进 showView 里），否则启动后监听器根本没挂上。
  document.addEventListener('uzz:libChanged', () => {
    const cur = document.querySelector('main.view:not(.hidden)');
    const id = cur ? cur.id : '';
    if (id === 'viewFav' || id === 'viewCollect' || id === 'viewHistory') renderLibrary();
    if (id === 'viewCollect') renderCollectView();
  });

  function renderLibrary() {
    const fav = Player.getFavorites();    const his = Player.getHistory();
    const hc = $('historyCount'); if (hc) hc.textContent = his.length ? his.length + ' 首' : '';
    const fc = $('favCount'); if (fc) fc.textContent = fav.length ? fav.length + ' 首' : '';
    const s1 = $('htCountSingle'); if (s1) s1.textContent = his.length;
    const sp = $('htCountPlist');
    if (sp) sp.textContent = (Player.getState().queue.length || 0);
    $('favList').innerHTML = fav.length
      ? fav.map((t) => trackLi(t)).join('')
      : '<li class="loading-pad">还没有收藏，去歌曲列表点 ♡ 收藏吧</li>';
    $('historyList').innerHTML = his.length
      ? his.map((t, i) => historyRow(t, i)).join('')
      : '<li class="loading-pad">暂无播放记录</li>';
    // 「播放全部」：把最近播放当队列载入并从头播
    const pa = $('histPlayAll');
    if (pa && !pa.dataset.bound) {
      pa.dataset.bound = '1';
      pa.addEventListener('click', () => {
        const list = Player.getHistory();
        if (!list.length) { toast('还没有播放记录'); return; }
        Player.playQueue(list.slice(0, 200));
      });
      const fa = $('histFavAll');
      if (fa) fa.addEventListener('click', () => {
        let n = 0;
        Player.getHistory().forEach((t) => { if (!Player.getFavorites().some(f => f.id === t.id && f.vendor === t.vendor) && Player.toggleFav(t)) n++; });
        toast(n ? '已收藏 ' + n + ' 首' : '这些歌都已在「我喜欢的音乐」里了');
        renderLibrary();
      });
      const mo = $('histMore');
      if (mo) mo.addEventListener('click', () => toast('可在歌曲行右侧「···」里加入歌单或下载'));
    }
  }
  function renderDownloads() {
    const ul = $('downloadList');
    if (DESKTOP && window.uzzBridge.getDownloadDir) {
      window.uzzBridge.getDownloadDir().then((dir) => {
        $('dlDirLine').textContent = '保存目录：' + dir;
      }).catch(() => {});
    } else {
      $('dlDirLine').textContent = '网页版下载由浏览器管理（默认「下载」目录）';
    }
    ul.innerHTML = downloads.length
      ? downloads.map((d, i) => `
        <li class="song" data-dl="${i}">
          <div class="cov" style="display:grid;place-items:center">🎧</div>
          <div class="info">
            <div class="name">${escapeHtml(d.name)}</div>
            <div class="sub">${escapeHtml(d.artist)} · ${new Date(d.time).toLocaleString('zh-CN')}${d.ok ? ' · 已完成' : ''}</div>
          </div>
        </li>`).join('')
      : '<li class="loading-pad">还没有下载记录，去歌曲列表点 ⬇ 下载吧</li>';
  }

  /* ============================================================
   * 本地音乐（扫描 / 媒体库 / 播放 / CUE / 去重）
   * ============================================================ */
  let curLocalFilter = 'all';
  let localCueContext = null; // { parent, cues } 当前展开的 CUE 分轨

  function localLi(t, i, ctx) {
    const dur = t.duration ? `<span class="dur">${fmtDur(t.duration)}</span>` : '<span class="dur"></span>';
    const cover = t.cover
      ? `<img class="cov" src="${escapeHtml(t.cover)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>`
      : `<div class="cov ent-local">💿</div>`;
    const sub = t.artist + (t.album ? ' · ' + t.album : '');
    const num = ctx && ctx.cue ? '' : `<span class="idx" style="width:24px;text-align:right;color:var(--text-2);font-size:12px">${(i != null ? i + 1 : '')}</span>`;
    const cueBtn = (t.hasCue && !(ctx && ctx.cue)) ? `<button class="act-cue" title="查看分轨">♪ 分轨</button>` : '';
    const rmBtn = (ctx && ctx.cue) ? '' : `<button class="act-rm" title="从媒体库移除">🗑</button>`;
    const resume = (ctx && ctx.cue) ? `<span class="badge">分轨</span>` : '<span class="badge">本地</span>';
    return `<li class="song local" data-id="${escapeHtml(t.id)}" data-vendor="local" data-name="${escapeHtml(t.name)}" data-artist="${escapeHtml(t.artist)}" data-album="${escapeHtml(t.album)}" data-pic="${escapeHtml(t.cover || '')}" data-url="${escapeHtml(t.url || '')}" data-duration="${t.duration || 0}" ${ctx && ctx.cue ? `data-cuestart="${t.cueStart || 0}" data-cueend="${t.cueEnd || 0}" data-audioid="${escapeHtml(t.audioId || '')}"` : ''}>
      ${num}${cover}
      <div class="info">
        <div class="name">${escapeHtml(t.name)}${resume}</div>
        <div class="sub">${escapeHtml(sub)}</div>
      </div>
      <div class="acts">
        ${cueBtn}
        ${rmBtn}
        <button class="act-add" aria-label="加入歌单" title="加入歌单">⊕</button>
        <button class="act-play" aria-label="播放" title="播放">▶</button>
      </div>
      ${dur}
    </li>`;
  }

  // CUE 全局信息（专辑级 REM / CATALOG 等）
  function renderCueMeta(meta, parent) {
    if (!meta) return '';
    const items = [];
    if (meta.albumTitle) items.push(['专辑', meta.albumTitle]);
    if (meta.albumPerformer) items.push(['艺术家', meta.albumPerformer]);
    if (meta.catalog) items.push(['目录号', meta.catalog]);
    if (meta.genre) items.push(['风格', meta.genre]);
    if (meta.date) items.push(['年份', String(meta.date)]);
    if (meta.discid) items.push(['DiscID', meta.discid]);
    if (meta.label) items.push(['厂牌', meta.label]);
    if (meta.comment) items.push(['备注', meta.comment]);
    if (!items.length) return '';
    return `<li class="cue-meta-head">${items.map((kv) => `<span class="cm-item"><b>${escapeHtml(kv[0])}</b> ${escapeHtml(kv[1])}</span>`).join('')}</li>`;
  }

  // 单条 CUE 分轨（更细展示：索引导 / 作曲 / ISRC / 源文件 / 前导静音段 / FLAG）
  function cueLi(c, parent) {
    const dur = (c.end && c.start) ? (c.end - c.start) : 0;
    const extra = [];
    if (c.songwriter) extra.push('作曲 ' + c.songwriter);
    if (c.isrc) extra.push('ISRC ' + c.isrc);
    if (c.file) extra.push('源文件 ' + c.file);
    if (c.hasPregap) extra.push('前导 ' + fmtDur(c.pre));
    const flags = (c.flags && c.flags.length) ? ' · FLAG:' + c.flags.join('/') : '';
    const metaLine = extra.length ? `<div class="sub cue-meta">${extra.map(escapeHtml).join(' · ')}${flags}</div>` : '';
    const cover = parent.cover
      ? `<img class="cov" src="${escapeHtml(parent.cover)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>`
      : `<div class="cov ent-local">💿</div>`;
    return `<li class="song local cue-track" data-id="${escapeHtml(parent.id + '#' + c.no)}" data-vendor="local" data-name="${escapeHtml(c.title)}" data-artist="${escapeHtml(c.performer || parent.artist)}" data-album="${escapeHtml(parent.album)}" data-pic="${escapeHtml(parent.cover || '')}" data-url="${escapeHtml('/api/local/stream?id=' + (c.audioId || parent.id))}" data-duration="${dur}" data-cuestart="${c.start || 0}" data-cueend="${c.end || 0}" data-audioid="${escapeHtml(c.audioId || parent.id)}">
      <span class="cue-no">${c.no}</span>
      ${cover}
      <div class="info">
        <div class="name">${escapeHtml(c.title)}</div>
        <div class="sub">${escapeHtml(c.performer || parent.artist)}${parent.album ? ' · ' + escapeHtml(parent.album) : ''}</div>
        ${metaLine}
      </div>
      <div class="acts">
        <button class="act-add" aria-label="加入歌单" title="加入歌单">⊕</button>
        <button class="act-play" aria-label="播放" title="播放">▶</button>
      </div>
      <span class="dur">${fmtDur(dur)}</span>
    </li>`;
  }

  // 智能歌单：按风格分组渲染（可展开播放）
  function renderSmartPlaylists(ul, pls) {
    if (!pls.length) { ul.innerHTML = ''; return; }
    ul.innerHTML = pls.map((pl) => `
      <li class="local-group open" data-spl="${escapeHtml(pl.key)}">
        <div class="lg-head">${escapeHtml(pl.name)} <span class="lg-count">${pl.count}</span></div>
        <div class="lg-tracks">${pl.tracks.map((t, i) => localLi(t, i)).join('')}</div>
      </li>`).join('');
  }

  async function loadLocalView(filter, keepNav) {
    if (filter) curLocalFilter = filter;
    const ul = $('localList');
    const empty = $('localEmpty');
    if (!DESKTOP && !UzzApi.getApiBase()) {
      ul.innerHTML = '<li class="loading-pad">本地音乐需要桌面版（Electron）支持：扫描本机文件。</li>';
      empty.classList.add('hidden');
      return;
    }
    if (localCueContext) {
      // 展示展开的 CUE 分轨（更细：全局 REM 信息 + 每轨作曲/ISRC/前导静音段/FLAG）
      const { parent, cues, meta } = localCueContext;
      $('localStat').textContent = `${parent.name} · ${cues.length} 个分轨`;
      ul.innerHTML = `<li class="loading-pad cue-back"><button id="cueBack" class="btn-ghost">← 返回「${escapeHtml(parent.name)}」</button></li>` +
        renderCueMeta(meta, parent) +
        cues.map((c) => cueLi(c, parent)).join('');
      empty.classList.add('hidden');
      return;
    }
    ul.innerHTML = '<li class="loading-pad"><span class="spin"></span> 读取本地音乐库…</li>';
    empty.classList.add('hidden');
    try {
      if (curLocalFilter === 'smart') {
        const pls = await UzzApi.localSmartPlaylists();
        renderSmartPlaylists(ul, pls);
        $('localStat').textContent = pls.length ? pls.length + ' 个智能歌单' : '';
        empty.classList.add('hidden');
        if (!pls.length) empty.classList.remove('hidden');
        return;
      }
      const tracks = await UzzApi.localLibrary(curLocalFilter);
      if (curLocalFilter === 'all') {
        $('localStat').textContent = tracks.length ? tracks.length + ' 首' : '';
        ul.innerHTML = tracks.length
          ? tracks.map((t, i) => localLi(t, i)).join('')
          : '';
        if (!tracks.length) empty.classList.remove('hidden');
      } else {
        // 分组（专辑/歌手/文件夹）：渲染分组卡片，点击展开该组歌曲
        ul.innerHTML = tracks.map((g) => `
          <li class="local-group" data-gname="${escapeHtml(g.name)}">
            <div class="lg-head">${escapeHtml(g.name)} <span class="lg-count">${g.tracks.length}</span></div>
            <div class="lg-tracks">${g.tracks.map((t, i) => localLi(t, i)).join('')}</div>
          </li>`).join('');
        $('localStat').textContent = tracks.length + ' 个分组';
      }
    } catch (e) {
      ul.innerHTML = '<li class="loading-pad">读取失败：' + escapeHtml(e.message || e) + '</li>';
    }
  }

  async function scanFolder() {
    if (!DESKTOP || !window.uzzBridge.pickFolder) { toast('本地扫描仅桌面版支持'); return; }
    const folder = await window.uzzBridge.pickFolder();
    if (!folder) return;
    toast('扫描中，请稍候…');
    try {
      const r = await UzzApi.localScan([folder]);
      toast(`扫描完成：新增 ${r.added} 首，共 ${r.total} 首`);
      loadLocalView(curLocalFilter, true);
    } catch (e) {
      toast('扫描失败：' + (e.message || e));
    }
  }
  async function importFiles() {
    if (!DESKTOP || !window.uzzBridge.pickFiles) { toast('本地导入仅桌面版支持'); return; }
    const files = await window.uzzBridge.pickFiles();
    if (!files || !files.length) return;
    toast('导入中…');
    try {
      for (const f of files) {
        const t = await UzzApi.localAddFile(f);
        if (t && !window.__localImported) window.__localImported = true;
      }
      toast('已导入 ' + files.length + ' 个文件');
      loadLocalView(curLocalFilter, true);
    } catch (e) {
      toast('导入失败：' + (e.message || e));
    }
  }
  async function showDuplicates() {
    try {
      const groups = await UzzApi.localDuplicates();
      const drawer = $('dupDrawer');
      const list = $('dupList');
      if (!groups.length) {
        list.innerHTML = '<div class="loading-pad">没有发现重复文件 🎉</div>';
      } else {
        list.innerHTML = groups.map((g, gi) => `
          <div class="dup-group">
            <div class="dup-title">${escapeHtml(g.name)} — ${escapeHtml(g.artist)}（${g.count} 份）</div>
            ${g.tracks.map((t) => `<div class="dup-item" data-id="${escapeHtml(t.id)}"><span>${escapeHtml(t.path)}</span><button class="btn-ghost dup-del" data-id="${escapeHtml(t.id)}">移除</button></div>`).join('')}
          </div>`).join('');
      }
      drawer.classList.remove('hidden');
    } catch (e) {
      toast('检测失败：' + (e.message || e));
    }
  }
  async function openCues(parentTrack) {
    try {
      const r = await UzzApi.localCues(parentTrack.id);
      const cues = r.cues || [];
      if (!cues.length) { toast('未找到 CUE 分轨'); return; }
      localCueContext = { parent: parentTrack, cues, meta: r.meta || {} };
      loadLocalView(null, true);
    } catch (e) {
      toast('读取 CUE 失败：' + (e.message || e));
    }
  }

  /* ============================================================
   * Mini 模式（顶栏控制 + 下方播放列表）
   * ============================================================ */
  let miniTimerId = null;
  function bindMiniMode() {
    const mmPlay = $('mmPlay'), mmPrev = $('mmPrev'), mmNext = $('mmNext');
    if (!mmPlay) return;
    mmPlay.addEventListener('click', () => window.Player && window.Player.toggle());
    if (mmPrev) mmPrev.addEventListener('click', () => window.Player && window.Player.prev());
    if (mmNext) mmNext.addEventListener('click', () => window.Player && window.Player.next());
    const mmFav = $('mmFav');
    if (mmFav) mmFav.addEventListener('click', () => { const f = $('fpFav'); if (f) f.click(); });
    const mmVol = $('mmVol');
    if (mmVol) mmVol.addEventListener('click', () => { const v = $('btnVol'); if (v) v.click(); });
    // Mini 音量滑条：拖动实时调音量（悬停图标弹出）
    const mmVolSlider = $('mmVolSlider');
    if (mmVolSlider) {
      mmVolSlider.addEventListener('input', () => {
        if (window.Player && Player.setVolume) Player.setVolume(Number(mmVolSlider.value) / 100);
      });
    }
    // ── mini 模式控制条（v2.9.0） ──
    // 关闭：真正退出软件（与托盘"退出"一致）
    const mmClose = $('mmClose');
    if (mmClose) mmClose.addEventListener('click', () => {
      if (window.uzzBridge && window.uzzBridge.quitApp) window.uzzBridge.quitApp();
      else toast('已关闭 mini 模式');
    });
    // 完整模式：退出 mini 回到主界面全屏播放
    const mmFull = $('mmFull');
    if (mmFull) mmFull.addEventListener('click', () => {
      const t = $('tbMini'); if (t) t.click();      // 切回常规模式
      setTimeout(() => { try { Player.openFull(); } catch (e) { /* 忽略 */ } }, 60);
    });
    // 列表显示 / 隐藏
    const mmListBtn = $('mmListToggle');
    const mmLyricBox = $('mmLyricBox');
    if (mmListBtn && mmLyricBox) {
      mmListBtn.addEventListener('click', () => {
        const showing = mmLyricBox.classList.contains('hidden');   // 本次是否要显示
        // 收起：先淡出歌词区，再让窗口收高 → 视觉上内容先消失、窗口后缩，无跳动感
        // 展开：先把窗口放高，再淡入 → 窗口先到位、内容后出现
        const applySize = () => {
          if (window.uzzBridge && window.uzzBridge.setMiniListVisible) {
            window.uzzBridge.setMiniListVisible(showing).catch(() => {});
          }
        };
        if (!showing) {
          document.body.classList.add('mm-anim', 'mm-hiding');
          setTimeout(() => {
            mmLyricBox.classList.add('hidden');
            document.body.classList.remove('mm-hiding');
            applySize();
          }, 130);
        } else {
          applySize();
          mmLyricBox.classList.remove('hidden');
          document.body.classList.add('mm-anim');
          requestAnimationFrame(() => {
            mmLyricBox.style.opacity = '';
          });
          setTimeout(() => document.body.classList.remove('mm-anim'), 160);
        }
        mmListBtn.classList.toggle('on', showing);
        mmListBtn.title = showing ? '隐藏列表' : '显示列表';
        document.body.classList.toggle('mm-nolist', !showing);   // 收起态：控制条更紧凑
        localStorage.setItem('uzz.mm.list', showing ? '1' : '0');
      });
      // 恢复上次的显隐状态
      if (localStorage.getItem('uzz.mm.list') === '0') {
        mmLyricBox.classList.add('hidden');
        mmListBtn.classList.remove('on');
        mmListBtn.title = '显示列表';
        document.body.classList.add('mm-nolist');
      }
    }
    // 列表 hover：加 .hovering 让该行更实（纯视觉增强）
    const list0 = $('mmList');
    if (list0) {
      list0.addEventListener('mouseover', (e) => {
        const li = e.target.closest('li[data-i]');
        list0.querySelectorAll('li.hovering').forEach((x) => x.classList.remove('hovering'));
        if (li) li.classList.add('hovering');
      });
      list0.addEventListener('mouseleave', () => {
        list0.querySelectorAll('li.hovering').forEach((x) => x.classList.remove('hovering'));
      });
    }
    const list = $('mmList');
    if (list) list.addEventListener('click', (e) => {
      const li = e.target.closest('li');
      if (!li) return;
      // 歌词行：点击跳到该时间点
      if (li.dataset.t != null) {
        const a = document.getElementById('audio');
        if (a && isFinite(a.duration)) { try { a.currentTime = Number(li.dataset.t); } catch (err) { /* 忽略 */ } }
        return;
      }
      if (li.dataset.i == null) return;
      const q = window.Player.getQueue();
      const t = q[Number(li.dataset.i)];
      if (t) window.Player.loadAndPlay(t);
    });
    // mini 打开期间每秒同步：封面 / 标题 / 当前高亮 / 播放键
    miniTimerId = setInterval(() => {
      if (!document.body.classList.contains('mini-mode')) return;
      const st = window.Player ? window.Player.getState() : {};
      const cur = st.current || {};
      const cv = $('mmCover');
      if (cv) {
        const src = cur.pic ? UzzApi.picProxy(cur.pic) : '';
        if (cv.dataset.src !== src) { cv.dataset.src = src; cv.src = src || 'data:,'; cv.style.visibility = src ? 'visible' : 'hidden'; }
      }
      const tt = $('mmTitle'), aa = $('mmArtist');
      if (tt) tt.textContent = cur.name || '未在播放';
      if (aa) aa.textContent = cur.artist || '';
      // 播放键图标跟随实际播放状态
      const audioEl = document.getElementById('audio');
      const pb = $('mmPlay');
      if (pb && audioEl) {
        const playing = !audioEl.paused && !audioEl.ended;
        const want = playing
          ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
        if (pb.dataset.state !== String(playing)) { pb.dataset.state = String(playing); pb.innerHTML = want; }
      }
      // 红心状态同步
      const fvb = $('mmFav');
      if (fvb) {
        const fav = cur.id && Player.getFavorites().some((f) => f.id === cur.id && f.vendor === cur.vendor);
        fvb.classList.toggle('on', !!fav);
      }
      // 音量滑条与实际音量同步（0~100 直接对应音量 0~1）
      const sl = $('mmVolSlider'), wave = $('mmVolWave');
      if (audioEl && sl && document.activeElement !== sl) sl.value = Math.round((audioEl.volume || 0) * 100);
      if (wave) wave.style.display = (audioEl && audioEl.volume > 0) ? '' : 'none';
      renderMiniList(st);
    }, 1000);
    // 播放页 tab：切歌后自动刷新 百科 / 相似推荐
    setInterval(() => {
      const full = $('fullPlayer');
      if (!full || full.classList.contains('hidden')) return;
      const st = window.Player ? window.Player.getState() : {};
      const cur = st.current || {};
      if (!cur.id || (fpTabCache.id === cur.id && fpTabCache.vendor === cur.vendor)) return;
      if (!$('fpWiki').classList.contains('hidden')) loadWiki(cur);
      if (!$('fpSimi').classList.contains('hidden')) loadSimi(cur);
    }, 1500);
  }
  let mmListKey = '';
  // mini 列表：优先显示当前歌歌词（参考图），无歌词时回退到播放队列
  function renderMiniList(st) {
    const q = (st && st.queue) || [];
    const cur = (st && st.current) || {};
    const lyrics = (st && st.lyrics) || [];
    const tlyrics = (st && st.tlyrics) || [];
    const curT = window.__mmCurT || 0;
    // 播放时间由 Player 定时写入 __mmCurT，用于定位当前歌词行
    const key = q.length + '|' + (cur.id || '') + '|' + (cur.vendor || '') + '|' + lyrics.length;
    if (key === mmListKey) return;
    mmListKey = key;
    const ul = $('mmList');
    if (!ul) return;
    if (lyrics.length) {
      // 歌词模式：显示歌词行，点击可跳转到该时间
      ul.innerHTML = lyrics.map((l, i) => {
        const tr = tlyrics[i] && tlyrics[i].text ? tlyrics[i].text : '';
        const cls = (window.__mmCurIdx === i) ? ' on' : '';
        return `<li data-t="${l.t}" data-lc="${i}" class="${cls}">
          <span class="mm-marker"></span>
          <span class="mm-name">${escapeHtml(l.text || '')}${tr ? `<em class="mm-tr">${escapeHtml(tr)}</em>` : ''}</span>
        </li>`;
      }).join('');
    } else {
      ul.innerHTML = q.length ? q.map((t, i) => {
        const on = t.id === cur.id && t.vendor === cur.vendor;
        return `<li data-i="${i}" class="${on ? 'on' : ''}">
          <span class="mm-marker">${on ? '<i></i>' : ''}</span>
          <span class="mm-name">${escapeHtml(t.name)}</span>
          <span class="mm-artist">${escapeHtml(t.artist || '')}</span>
        </li>`;
      }).join('') : '<li class="mm-empty">播放列表为空</li>';
    }
    const on = ul.querySelector('li.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }

  /* ============================================================
   * 播放页：歌词区工具栏（±0.5s / 翻译 / 字号 / 报错）
   * ============================================================ */
  function bindLyricTools() {
    const back = $('lyBack5'), fwd = $('lyFwd5');
    const getOffset = () => Number(localStorage.getItem('uzz.lyricOffset') || 0);
    if (back) back.addEventListener('click', () => {
      const v = window.Player.setLyricOffset(getOffset() - 0.5);
      toast('歌词偏移 ' + (v > 0 ? '+' : '') + v + 's');
    });
    if (fwd) fwd.addEventListener('click', () => {
      const v = window.Player.setLyricOffset(getOffset() + 0.5);
      toast('歌词偏移 ' + (v > 0 ? '+' : '') + v + 's');
    });
    const trans = $('lyTrans');
    if (trans) trans.addEventListener('click', () => {
      const on = localStorage.getItem('uzz.lyricTrans') !== '1';
      localStorage.setItem('uzz.lyricTrans', on ? '1' : '0');
      trans.classList.toggle('on', on);
      toast(on ? '已显示翻译' : '已关闭翻译');
      // 无翻译数据时现场补拉
      const st = window.Player.getState();
      if (on && st.current && !(st.tlyrics && st.tlyrics.length) && UzzApi.getLyricEx) {
        UzzApi.getLyricEx(st.current.id, st.current.vendor).then((f) => {
          st.tlyrics = window.Player.parseLrcSafe ? window.Player.parseLrcSafe(f.tlyric) : [];
          document.dispatchEvent(new CustomEvent('uzz:lyricRefresh'));
        }).catch(() => {});
      } else document.dispatchEvent(new CustomEvent('uzz:lyricRefresh'));
    });
    if (trans) trans.classList.toggle('on', localStorage.getItem('uzz.lyricTrans') === '1');

    // 字号弹层：点击图标出现滑块，拖动 / 滚轮调整
    const pop = $('lyFontPop'), fontBtn = $('lyFont'), range = $('lyFontRange'), val = $('lyFontVal');
    if (fontBtn && pop && range && val) {
      const apply = (px, save) => {
        px = Math.max(14, Math.min(48, Math.round(px)));
        val.textContent = px;
        range.value = px;
        const box = $('fpLyric');
        if (box) box.style.fontSize = px + 'px';
        if (save) localStorage.setItem('uzz.fpLyricSize', String(px));
      };
      fontBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pop.classList.toggle('hidden');
        range.value = localStorage.getItem('uzz.fpLyricSize') || 24;
        val.textContent = range.value;
      });
      range.addEventListener('input', () => apply(Number(range.value), true));
      pop.addEventListener('wheel', (e) => {
        e.preventDefault();
        apply(Number(range.value) + (e.deltaY < 0 ? 1 : -1), true);
      }, { passive: false });
      document.addEventListener('click', (e) => {
        if (!pop.contains(e.target) && e.target !== fontBtn) pop.classList.add('hidden');
      });
    }

    // 歌词报错：弹简易反馈框
    const rep = $('lyReport');
    if (rep) rep.addEventListener('click', () => {
      const st = window.Player.getState();
      const cur = st.current || {};
      const msg = prompt('歌词报错反馈（请描述问题，如：第 5 句歌词时间不准 / 错词）', '');
      if (msg && msg.trim()) toast('感谢反馈，我们会尽快修正');
    });

    // 翻译刷新事件 → 重渲染歌词
    document.addEventListener('uzz:lyricRefresh', () => {
      const st = window.Player.getState();
      if (typeof renderLyricFromState === 'function') renderLyricFromState(st);
    });
  }
  // 让 player 重新渲染歌词（复用 player.renderLyric 逻辑：走 CustomEvent 由 player 监听也行，
  // 这里直接调暴露的接口最稳）
  function renderLyricFromState(st) {
    if (window.Player && window.Player.refreshLyric) window.Player.refreshLyric();
  }

  /* ============================================================
   * 播放页 tab：歌词 / 百科 / 相似推荐
   * ============================================================ */
  let fpTabCache = { id: '', vendor: '' };
  function bindFullTabs() {
    const tabs = $('fpTabs');
    if (!tabs) return;
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      tabs.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      $('fpLyric').classList.toggle('hidden', tab !== 'lyric');
      $('fpWiki').classList.toggle('hidden', tab !== 'wiki');
      $('fpSimi').classList.toggle('hidden', tab !== 'simi');
      const tools = $('fpLyTools');
      if (tools) tools.classList.toggle('hidden', tab !== 'lyric');
      const st = window.Player.getState();
      const cur = st.current || {};
      if (tab === 'wiki') loadWiki(cur);
      if (tab === 'simi') loadSimi(cur);
    });
    $('fpSimi').addEventListener('click', (e) => {
      const li = e.target.closest('li[data-i]');
      if (!li) return;
      const t = fpSimiCache[Number(li.dataset.i)];
      if (t) window.Player.loadAndPlay(t);
    });
  }
  let fpSimiCache = [];
  async function loadWiki(cur) {
    const box = $('fpWiki');
    if (!cur || !cur.id) { box.innerHTML = '<p class="lr-empty">暂无正在播放的歌曲</p>'; return; }
    if (fpTabCache.id === cur.id && fpTabCache.vendor === cur.vendor && box.dataset.loaded === '1') return;
    fpTabCache = { id: cur.id, vendor: cur.vendor };
    box.dataset.loaded = '1';
    box.innerHTML = '<p class="lr-empty">百科加载中…</p>';
    const info = await UzzApi.getWiki(cur.id, cur.vendor).catch(() => ({}));
    const rows = Object.entries(info).filter(([, v]) => v);
    const LABELS = { '曲风': 1, '语种': 1, '发行时间': 1, '发行版本': 1, 'BPM': 1, '歌手': 1, '专辑': 1, '发行公司': 1 };
    const ordered = [];
    ['曲风', '语种', '发行时间', '发行版本', 'BPM', '歌手', '专辑', '发行公司'].forEach((k) => {
      if (info[k]) ordered.push([k, info[k]]);
    });
    rows.forEach(([k, v]) => { if (!ordered.some(([ok]) => ok === k) && LABELS[k]) ordered.push([k, v]); });
    box.innerHTML = ordered.length
      ? `<div class="wiki-card">${ordered.map(([k, v]) => `<div class="wiki-row"><span class="wk">${escapeHtml(k)}</span><span class="wv">${escapeHtml(v)}</span></div>`).join('')}</div>`
      : '<p class="lr-empty">暂无百科信息</p>';
  }
  async function loadSimi(cur) {
    const box = $('fpSimi');
    if (!cur || !cur.id) { box.innerHTML = '<p class="lr-empty">暂无正在播放的歌曲</p>'; return; }
    if (fpTabCache.id === cur.id && fpTabCache.vendor === cur.vendor && box.dataset.loaded === '1') return;
    fpTabCache = { id: cur.id, vendor: cur.vendor };
    box.dataset.loaded = '1';
    box.innerHTML = '<p class="lr-empty"><span class="spin"></span> 相似推荐加载中…</p>';
    try {
      const tracks = await UzzApi.getSimi(cur.id, cur.vendor, 30);
      fpSimiCache = tracks;
      box.innerHTML = tracks.length
        ? `<ul class="simi-list">${tracks.map((t, i) => `
            <li data-i="${i}">
              <img class="cov" src="${t.pic ? escapeHtml(UzzApi.picProxy(t.pic)) : 'data:,'}" loading="lazy" onerror="this.style.visibility='hidden'" alt="" />
              <div class="info"><div class="name">${escapeHtml(t.name)}</div><div class="sub">${escapeHtml(t.artist || '')}</div></div>
              <span class="dur">${t.duration ? fmtDur(t.duration) : ''}</span>
            </li>`).join('')}</ul>`
        : '<p class="lr-empty">暂无相似推荐</p>';
    } catch (e) {
      box.innerHTML = '<p class="lr-empty">相似推荐加载失败：' + escapeHtml(e.message || e) + '</p>';
    }
  }

  /* ============================================================
   * 设置：系统 / 快捷键 新增项
   * ============================================================ */
  /* ══════════════════════════════════════════════════════════
   * 设置页（网易云式重构）：通用绑定工具 + 各分组具体功能
   * ══════════════════════════════════════════════════════════ */
  // 通用：复选框 ↔ localStorage
  function bindStCk(id, key, def, onChange) {
    const el = $(id);
    if (!el) return;
    el.checked = localStorage.getItem(key) !== null ? localStorage.getItem(key) === '1' : !!def;
    el.addEventListener('change', () => {
      localStorage.setItem(key, el.checked ? '1' : '0');
      if (key === 'uzz.dl.enabled') {
        for (const other of ['stLyricEnable', 'stDLyric']) { const input = $(other); if (input) input.checked = el.checked; }
        if (window.uzzBridge) { window.uzzBridge.showLyric(el.checked); if (el.checked) pushLyricCfg(); }
        const btn = $('btnLyric'); if (btn) btn.classList.toggle('on', el.checked);
      }
      if (key === 'uzz.dl.topmost' || key === 'uzz.dl.trans') {
        for (const other of key === 'uzz.dl.topmost' ? ['stLyricTop', 'stDLyricTop'] : ['stLyricTrans']) { const input = $(other); if (input) input.checked = el.checked; }
        pushLyricCfg();
      }
      if (onChange) onChange(el.checked);
      toast('已保存');
    });
  }
  // 通用：下拉 ↔ localStorage
  function bindStSel(id, key, def, onChange) {
    const el = $(id);
    if (!el) return;
    el.value = localStorage.getItem(key) || def || el.value;
    el.addEventListener('change', () => {
      localStorage.setItem(key, el.value);
      if (onChange) onChange(el.value);
      toast('已保存');
    });
  }
  // 通用：单选组 ↔ localStorage
  function bindStRadio(name, key, def, onChange) {
    const list = document.querySelectorAll('input[name="' + name + '"]');
    if (!list.length) return;
    const saved = localStorage.getItem(key);
    list.forEach((r) => {
      r.checked = saved ? r.value === saved : r.value === def;
      r.addEventListener('change', () => {
        if (!r.checked) return;
        localStorage.setItem(key, r.value);
        if (onChange) onChange(r.value);
        toast('已保存');
      });
    });
  }
  // 通用：滑杆 ↔ localStorage（带数值回显）
  function bindStRange(id, key, valId, suffix, def, onChange) {
    const el = $(id), out = $(valId);
    if (!el) return;
    el.value = localStorage.getItem(key) || def;
    if (out) out.textContent = el.value + (suffix || '');
    el.addEventListener('input', () => {
      localStorage.setItem(key, el.value);
      if (out) out.textContent = el.value + (suffix || '');
      if (onChange) onChange(Number(el.value));
    });
    el.addEventListener('change', () => toast('已保存'));
  }
  // 字体下拉填充（系统已装字体）
  function fillFontSelect(id, defFont) {
    const el = $(id);
    if (!el) return;
    const list = ['默认', '微软雅黑', '宋体', '黑体', '楷体', '仿宋', '思源黑体', '苹方', 'Arial', 'Tahoma', 'Georgia', 'Times New Roman', 'Segoe UI'];
    el.innerHTML = list.map((f) => '<option value="' + f + '"' + (f === (defFont || '默认') ? ' selected' : '') + '>' + f + '</option>').join('');
    el.addEventListener('change', () => {
      localStorage.setItem(id === 'stLyricFont' ? 'uzz.dl.font' : 'uzz.font', el.value);
      applyLyricPreview();
      toast('已保存');
    });
  }

  // 快捷键可自定义：点输入框 → 按下组合键即录入（参考网易云）
  const KEY_DEFS = [
    { k: 'toggle', name: '播放/暂停', app: 'Ctrl + P', global: 'Ctrl + Alt + P' },
    { k: 'prev', name: '上一首', app: 'Ctrl + Left', global: 'Ctrl + Alt + Left' },
    { k: 'next', name: '下一首', app: 'Ctrl + Right', global: 'Ctrl + Alt + Right' },
    { k: 'volUp', name: '音量加', app: 'Ctrl + Up', global: 'Ctrl + Alt + Up' },
    { k: 'volDown', name: '音量减', app: 'Ctrl + Down', global: 'Ctrl + Alt + Down' },
    { k: 'mini', name: 'mini/完整模式', app: 'Ctrl + M', global: '' },
    { k: 'like', name: '喜欢歌曲', app: 'Ctrl + L', global: 'Ctrl + Alt + L' },
    { k: 'lyric', name: '打开/关闭歌词', app: 'Ctrl + D', global: 'Ctrl + Alt + D' },
    { k: 'trans', name: '翻译当前歌词', app: 'Ctrl + T', global: '' },
  ];
  function prettyKey(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    const map = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'Space', Escape: 'Esc' };
    let k = e.key;
    if (map[k]) k = map[k];
    else if (k.length === 1) k = k.toUpperCase();
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(k)) parts.push(k);
    return parts.join(' + ');
  }
  // 收集当前所有全局快捷键（供下发给主进程真实注册）
  function collectKeys() {
    const out = {};
    try {
      KEY_DEFS.forEach((d) => {
        const v = localStorage.getItem('uzz.key.global.' + d.k) || d.global || '';
        if (v) out[d.k] = v;
      });
    } catch (e) { /* 忽略 */ }
    return out;
  }

  function renderKeys() {
    const box = $('keyList');
    if (!box) return;
    const used = new Set();
    box.innerHTML = KEY_DEFS.map((d) => {
      const appV = localStorage.getItem('uzz.key.app.' + d.k) || d.app;
      const gV = localStorage.getItem('uzz.key.global.' + d.k) || d.global;
      const isEmpty = !gV;
      if (!isEmpty) used.add(gV);
      return `<div class="key-item" data-k="${d.k}">
        <span class="key-name">${d.name}</span>
        <span class="key-input" data-scope="app" data-k="${d.k}" tabindex="0">${appV || '设置'}</span>
        <span style="display:flex;align-items:center">
          <span class="key-input${isEmpty ? ' conflict' : ''}" data-scope="global" data-k="${d.k}" tabindex="0">${isEmpty ? '空' : gV}</span>
          ${isEmpty ? '<span class="key-conflict-txt">热键被占用</span>' : ''}
        </span>
      </div>`;
    }).join('');
    // 冲突检测：全局键位重复
    box.querySelectorAll('.key-item').forEach((row) => {
      const g = row.querySelector('[data-scope="global"]');
      const v = localStorage.getItem('uzz.key.global.' + row.dataset.k) || (KEY_DEFS.find((d) => d.k === row.dataset.k) || {}).global;
      if (v && used.has(v) && used.size > 1) {
        const cnt = box.querySelectorAll('.key-item').length;
        const dup = Array.from(box.querySelectorAll('[data-scope="global"]')).filter((el) => el.textContent === v).length;
        if (dup > 1) { g.classList.add('conflict'); }
      }
    });
    // 录制
    box.querySelectorAll('.key-input').forEach((el) => {
      const start = (e) => {
        e.preventDefault();
        el.classList.add('listening');
        el.textContent = '按下组合键…';
        const onKey = (ev) => {
          ev.preventDefault();
          if (['Control', 'Alt', 'Shift', 'Meta'].includes(ev.key)) return;
          const combo = prettyKey(ev);
          el.classList.remove('listening');
          el.textContent = combo || '空';
          localStorage.setItem('uzz.key.' + el.dataset.scope + '.' + el.dataset.k, combo);
          // 全局快捷键：真实注册到系统，并回报是否被占用
          if (el.dataset.scope === 'global' && window.uzzBridge && window.uzzBridge.saveKeys) {
            window.uzzBridge.saveKeys(collectKeys(), {
              globalKeys: localStorage.getItem('uzz.keys.global') !== '0',
              mediaKeys: localStorage.getItem('uzz.keys.media') !== '0',
            }).then((r) => {
              renderKeys();
              if (r && r.failed && r.failed.length) {
                toast('已保存，但 ' + r.failed.join('、') + ' 被其它程序占用', 3600);
              } else {
                toast('全局快捷键已生效');
              }
            }).catch(() => { renderKeys(); toast('快捷键已保存'); });
            return;
          }
          // 重绘以刷新冲突标记
          renderKeys();
          toast('快捷键已保存');
          document.removeEventListener('keydown', onKey, true);
        };
        document.addEventListener('keydown', onKey, true);
        setTimeout(() => { document.removeEventListener('keydown', onKey, true); el.classList.remove('listening'); }, 4000);
      };
      el.addEventListener('click', start);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') start(e); });
    });
  }

  // 歌词预览跟随设置变化
  function applyLyricPreview() {
    const p = $('stLyricPrev');
    if (!p) return;
    const font = localStorage.getItem('uzz.dl.font') || '微软雅黑';
    const size = localStorage.getItem('uzz.dl.size') || '23';
    const weight = localStorage.getItem('uzz.dl.weight') || 'bold';
    const color = localStorage.getItem('uzz.dl.color') || 'gradient';
    p.style.fontFamily = font === '默认' ? '' : font;
    p.style.fontSize = size + 'px';
    p.style.fontWeight = weight;
    const map = { green: '#1ecd8a', pink: '#ff8fc7', gold: '#ffc861', blue: '#7ab6ff' };
    if (color === 'gradient') { p.classList.remove('solid'); p.style.color = ''; }
    else { p.classList.add('solid'); p.style.color = map[color] || '#1ecd8a'; }
  }

  function bindSettingsExtra() {
    // ── 常规 ──
    bindStRadio('themeMode', 'uzz.theme.mode', 'dark', (v) => {
      localStorage.setItem('uzz.theme.mode', v);
      applyTheme();
      toast('已保存');
    });
    $('stOpenSkins') && $('stOpenSkins').addEventListener('click', () => {
      const sk = $('skinOverlay');
      if (sk) sk.classList.remove('hidden');
    });
    // 字体选择：真实写入 CSS 变量，立即全站生效
    fillFontSelect('stFont', '默认');
    (function bindFontReal() {
      const el = $('stFont');
      if (!el) return;
      const apply = () => {
        const v = el.value || '默认';
        document.documentElement.style.setProperty('--app-font', v === '默认' ? '' : `"${v}", "Microsoft YaHei", sans-serif`);
        document.body.style.fontFamily = v === '默认' ? '' : `"${v}", "Microsoft YaHei", sans-serif`;
      };
      el.addEventListener('change', () => { localStorage.setItem('uzz.font', el.value || '默认'); apply(); toast('字体已应用'); });
      apply();
    })();
    // 开机自动运行：真实调用系统开机启动注册
    bindStCk('stStartup', 'uzz.sys.autoRun', false, (v) => {
      const br = window.uzzBridge;
      if (br && br.setStartup) { try { br.setStartup(v); } catch (e) { /* 忽略 */ } }
      const mode = localStorage.getItem('uzz.sys.startupMode') || 'mini';
      if (br && br.setLoginMode && v) { try { br.setLoginMode(mode === 'front' ? 'front' : 'tray'); } catch (e) { /* 忽略 */ } }
      toast(v ? '已加入开机启动' : '已取消开机启动');
    });
    // 启动方式：最小化展示 / 前台展示（二选一，真实写入开机参数）
    bindStRadio('startupMode', 'uzz.sys.startupMode', 'mini', (v) => {
      const on = localStorage.getItem('uzz.sys.autoRun') === '1';
      const br = window.uzzBridge;
      if (on && br && br.setLoginMode) { try { br.setLoginMode(v === 'front' ? 'front' : 'tray'); } catch (e) { /* 忽略 */ } }
      toast(v === 'front' ? '开机将前台显示' : '开机将最小化到播放条');
    });
    // 设为默认播放器：真实写注册表 + 打开系统默认应用页
    $('stSetDefault') && $('stSetDefault').addEventListener('click', async () => {
      const br = window.uzzBridge;
      const b = $('stSetDefault');
      b.disabled = true; b.textContent = '注册中…';
      try {
        const r = br && br.setDefaultPlayer ? await br.setDefaultPlayer() : { ok: false, msg: '主进程不支持' };
        b.disabled = false; b.textContent = '设为默认播放器';
        if (r && r.ok) {
          toast('已注册为默认播放器，如未生效请点击「打开系统设置」确认', 3200);
          $('stDefaultTip') && ($('stDefaultTip').textContent = '已注册。若系统未自动切换，请点右侧按钮在系统设置中确认。');
        } else {
          toast('注册失败：' + ((r && r.msg) || '未知错误'));
        }
      } catch (e) {
        b.disabled = false; b.textContent = '设为默认播放器';
        toast('注册失败：' + (e.message || e));
      }
    });
    $('stOpenDefApps') && $('stOpenDefApps').addEventListener('click', () => {
      const br = window.uzzBridge;
      if (br && br.openDefaultApps) br.openDefaultApps();
      else toast('请手动打开：设置 → 应用 → 默认应用');
    });
    // GPU 加速：真实生效（重启后应用），并如实告知需重启
    bindStCk('stGpu', 'uzz.gpu', true, (v) => {
      const br = window.uzzBridge;
      if (br && br.setGpu) {
        br.setGpu(v).then((r) => {
          if (r && r.needRestart) toast('已保存，重启小杨音乐后生效', 2600);
        }).catch(() => {});
      }
    });
    if (window.uzzBridge?.gpuInfo) window.uzzBridge.gpuInfo().then(info => { const el = $('stGpu'); if (el) el.checked = info.enabled; }).catch(() => {});
    $('stRestartSafe')?.addEventListener('click', () => {
      if (window.uzzBridge?.restartSafe) window.uzzBridge.restartSafe();
      else toast('兼容模式仅桌面版可用');
    });
    // 禁用动画：立即生效
    bindStCk('stNoAnim', 'uzz.noAnim', false, (v) => {
      document.body.classList.toggle('no-anim', v);
      toast(v ? '动画效果已禁用' : '动画效果已恢复');
    });
    if (localStorage.getItem('uzz.noAnim') === '1') document.body.classList.add('no-anim');
    // 禁用系统缩放：真实写入主进程（重启后完全生效）
    bindStCk('stNoScale', 'uzz.noScale', false, (v) => {
      const br = window.uzzBridge;
      if (br && br.setNoScale) br.setNoScale(v).catch(() => {});
      toast(v ? '已保存，重启后完全生效' : '已恢复系统缩放', 2400);
    });

    // 音源与后端
    const apiEl = $('stApiBase');
    if (apiEl) {
      apiEl.value = localStorage.getItem('uzz.apiBase') || '';
      apiEl.addEventListener('change', () => {
        localStorage.setItem('uzz.apiBase', apiEl.value.trim());
        UzzApi.ping().then((ok) => toast(ok ? '后端可用' : '后端不可达，请检查地址'));
        toast('已保存');
      });
    }
    $('stApiTest') && $('stApiTest').addEventListener('click', async () => {
      const b = $('stApiTest');
      b.disabled = true; b.textContent = '检测中…';
      const ok = await UzzApi.ping().catch(() => false);
      b.disabled = false; b.textContent = '测试';
      toast(ok ? '后端连接正常 ✓' : '后端不可达 ✗');
    });
    bindStSel('stVendor', 'uzz.vendor', 'auto');

    // ── 系统 ──
    // 定时关闭软件：真实定时器（到点真退出）
    const syncTimer = () => {
      const on = localStorage.getItem('uzz.timer.on') === '1';
      const h = parseInt(localStorage.getItem('uzz.timer.h') || '0', 10) || 0;
      const m = parseInt(localStorage.getItem('uzz.timer.m') || '0', 10) || 0;
      const min = h * 60 + m;
      const sh = $('stShutdown');
      if (sh) sh.classList.toggle('st-dim', !on || min <= 0);
      const br = window.uzzBridge;
      if (!br || !br.scheduleClose) return;
      if (on && min > 0) {
        br.scheduleClose(min).then((r) => {
          if (r && !r.off) toast(`已设定 ${h} 小时 ${m} 分后自动关闭软件`, 2600);
        }).catch(() => {});
      } else br.cancelClose();
    };
    bindStCk('stTimer', 'uzz.timer.on', false, syncTimer);
    bindStSel('stTimerH', 'uzz.timer.h', '0', syncTimer);
    bindStSel('stTimerM', 'uzz.timer.m', '0', syncTimer);
    // 关闭同时关机：真实调用 Windows shutdown（依赖定时关闭）
    bindStCk('stShutdown', 'uzz.timer.shutdown', false, (v) => {
      const br = window.uzzBridge;
      if (!v) { if (br && br.cancelShutdown) br.cancelShutdown(); toast('已取消定时关机'); return; }
      const h = parseInt(localStorage.getItem('uzz.timer.h') || '0', 10) || 0;
      const m = parseInt(localStorage.getItem('uzz.timer.m') || '0', 10) || 0;
      const min = h * 60 + m;
      if (localStorage.getItem('uzz.timer.on') !== '1' || min <= 0) {
        toast('请先开启「定时关闭软件」并设置有效时间', 2800);
        const el = $('stShutdown'); if (el) el.checked = false;
        localStorage.setItem('uzz.timer.shutdown', '0');
        return;
      }
      if (br && br.scheduleShutdown) {
        br.scheduleShutdown(min).then((r) => {
          toast(r && !r.off ? `到点将自动关机（${h} 小时 ${m} 分后）` : '定时关机失败', 2800);
        }).catch(() => toast('定时关机失败'));
      }
    });
    // 关闭主面板行为：最小化到托盘 / 真正退出
    bindStRadio('closeMain', 'uzz.sys.closeMain', 'tray', (v) => {
      localStorage.setItem('uzz.sys.closeHide', v === 'tray' ? '1' : '0');
      const br = window.uzzBridge;
      if (br && br.setMinToTray) { try { br.setMinToTray(v === 'tray'); } catch (e) { /* 忽略 */ } }
      toast(v === 'tray' ? '关闭窗口时最小化到托盘' : '关闭窗口时直接退出');
    });
    // SMTC：真实控制（Windows 媒体播放控制中心）
    bindStCk('stSmtc', 'uzz.smtc', false, (v) => {
      const br = window.uzzBridge;
      if (br && br.setSmtc) { try { br.setSmtc(v); } catch (e) { /* 忽略 */ } }
      toast(v ? '已接入 Windows 媒体控制中心' : '已关闭媒体控制中心');
    });
    // 启动时恢复定时关闭状态
    syncTimer();

    // ── 播放 ──
    // 启动时自动播放：真实行为（有上回记录才播，避免无内容报错）
    bindStCk('stAutoPlay', 'uzz.play.autoPlay', false, (v) => {
      toast(v ? '启动后会自动续播上次歌曲' : '已关闭启动自动播放');
    });
    // 播放时不自动休眠/熄屏：真实调用 powerSaveBlocker
    bindStCk('stNoSleep', 'uzz.play.noSleep', false, (v) => {
      const br = window.uzzBridge;
      if (br && br.blockPower) {
        br.blockPower('sleep', v).then(() => {
          if (br.blockPower) br.blockPower('screen', v);
          toast(v ? '播放时将阻止系统休眠与熄屏' : '已恢复系统休眠与熄屏');
        }).catch(() => toast('设置失败'));
      }
    });
    if (localStorage.getItem('uzz.play.noSleep') === '1' && window.uzzBridge && window.uzzBridge.blockPower) {
      window.uzzBridge.blockPower('sleep', true).catch(() => {});
      window.uzzBridge.blockPower('screen', true).catch(() => {});
    }
    // 跨端续播（记录最后播放位置到云端文件，供多端读取）
    bindStCk('stCrossPlay', 'uzz.play.crossPlay', false, (v) => {
      toast(v ? '已开启跨端续播（位置写入本地 resume 文件供多端读取）' : '已关闭跨端续播');
    });
    // 首次进入播客页自动播放
    bindStCk('stPodcastAuto', 'uzz.play.podcastAuto', false, (v) => {
      window.__podcastAuto = v;
      toast(v ? '进入播客页将自动播放' : '进入播客页不再自动播放');
    });
    window.__podcastAuto = localStorage.getItem('uzz.play.podcastAuto') === '1';
    // 记住上次播放进度（真实控制 saveResume 开关）
    bindStCk('stResume', 'uzz.play.resume', true, (v) => {
      if (!v && window.Player && window.Player.clearResume) window.Player.clearResume();
      toast(v ? '将记住退出时的播放进度' : '不再记住播放进度');
    });
    // 淡入淡出：真实接入 Web Audio 增益
    bindStCk('stFade', 'uzz.play.fade', true, (v) => {
      if (window.Eq && window.Eq.setFade) window.Eq.setFade(v ? 800 : 0);
      toast(v ? '已开启淡入淡出（0.8秒）' : '已关闭淡入淡出');
    });
    // 音量平衡：真实接入动态压缩器
    bindStCk('stNormalize', 'uzz.play.normalize', false, (v) => {
      if (window.Eq && window.Eq.setNormalize) window.Eq.setNormalize(v);
      toast(v ? '已开启音量平衡（压缩动态范围）' : '已关闭音量平衡');
    });
    // 音量平衡强度（真实调节压缩器 ratio / threshold）
    (function bindNormStrength() {
      const el = $('stNormStrength'), lab = $('stNormVal');
      if (!el) return;
      const apply = () => {
        if (window.Eq && window.Eq.setNormalizeStrength) window.Eq.setNormalizeStrength(Number(el.value));
        if (lab) lab.textContent = el.value + '%';
      };
      el.addEventListener('input', apply);
      el.addEventListener('change', () => {
        localStorage.setItem('uzz.play.normStrength', el.value);
        apply();
        toast('音量平衡强度：' + el.value + '%');
      });
      apply();
    })();
    // 系统空间音效：真实接入 ConvolverNode
    bindStCk('stSpatialize', 'uzz.play.spatialize', false, (v) => {
      const size = localStorage.getItem('uzz.play.spatSize') || '35';
      if (window.Eq && window.Eq.setSpatial) window.Eq.setSpatial(v, size);
      toast(v ? '已开启空间音效' : '已关闭空间音效');
    });
    (function bindSpatSize() {
      const el = $('stSpatSize'), lab = $('stSpatVal');
      if (!el) return;
      const apply = () => {
        if (window.Eq && window.Eq.setSpatial) {
          window.Eq.setSpatial(localStorage.getItem('uzz.play.spatialize') === '1', el.value);
        }
        if (lab) lab.textContent = el.value + '%';
      };
      el.addEventListener('input', apply);
      el.addEventListener('change', () => {
        localStorage.setItem('uzz.play.spatSize', el.value);
        apply();
        toast('空间大小：' + el.value + '%');
      });
      apply();
    })();
    // 输出设备：真实调用 setSinkId
    (function bindOutputReal() {
      const el = $('stOutput');
      if (!el) return;
      el.addEventListener('change', async () => {
        localStorage.setItem('uzz.play.output', el.value || '');
        const audio = document.getElementById('audio');
        if (!audio || !audio.setSinkId) { toast('当前环境不支持切换输出设备'); return; }
        try {
          await audio.setSinkId(el.value || '');
          toast(el.value ? '已切换输出设备' : '已恢复默认输出设备');
        } catch (e) { toast('切换失败：' + (e.message || e)); }
      });
      const saved = localStorage.getItem('uzz.play.output') || '';
      if (saved) setTimeout(() => {
        const audio = document.getElementById('audio');
        if (audio && audio.setSinkId) audio.setSinkId(saved).catch(() => {});
      }, 800);
    })();
    // 系统音量：真实调Windows 主音量（滑杆拖动时防抖，拖完才下发）
    (function bindSysVolumeReal() {
      const el = $('stSysVol'), lab = $('stSysVolVal'), br = window.uzzBridge;
      if (!el) return;
      let timer = null;
      // 启动时读回真实系统音量
      if (br && br.getSysVolume) {
        br.getSysVolume().then((v) => {
          if (typeof v === 'number') { el.value = v; if (lab) lab.textContent = v + '%'; }
        }).catch(() => {});
      }
      el.addEventListener('input', () => { if (lab) lab.textContent = el.value + '%'; });
      el.addEventListener('change', () => {
        const v = Number(el.value);
        localStorage.setItem('uzz.play.sysVol', String(v));
        clearTimeout(timer);
        // 松手后下发（volumechange 只在键盘/步进时可靠，鼠标拖动用 change）
        timer = setTimeout(() => {
          if (br && br.setSysVolume) {
            br.setSysVolume(v).then((r) => {
              toast(r && r.ok ? ('系统音量已设为约 ' + v + '%') : ('设置系统音量失败：' + ((r && r.msg) || '未知')));
            }).catch(() => toast('系统音量设置失败'));
          }
        }, 120);
      });
    })();
    // 黑名单：真实实现（屏蔽含关键词的歌曲）
    $('stBlacklist') && $('stBlacklist').addEventListener('click', async () => {
      const cur = localStorage.getItem('uzz.play.blacklist') || '';
      const v = window.prompt('输入要屏蔽的关键词（多个用英文逗号分隔，例如：广告,live）', cur);
      if (v === null) return;
      const list = v.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
      localStorage.setItem('uzz.play.blacklist', JSON.stringify(list));
      window.__uzzBlacklist = list;
      applyBlacklist();
      toast(list.length ? `已屏蔽关键词：${list.join('、')}` : '已清空黑名单');
    });
    // 播放列表播放模式（真实影响点歌行为）
    bindStRadio('plMode', 'uzz.play.plMode', 'replace', (v) => {
      toast(v === 'replace' ? '点歌将替换播放列表' : '点歌将加入播放列表末尾');
    });
    // 最近播放记录：真实控制是否写入
    bindStCk('stCloudHis', 'uzz.play.cloudHis', true, (v) => {
      toast(v ? '会记录最近播放' : '不再记录最近播放');
    });

    // ── 快捷键 ──
    renderKeys();
    // 全局快捷键开关：真实控制是否向系统注册
    bindStCk('stGlobalKey', 'uzz.keys.global', true, (v) => {
      const br = window.uzzBridge;
      if (br && br.registerGlobal) {
        (v ? br.saveKeys(collectKeys(), { globalKeys: true, mediaKeys: localStorage.getItem('uzz.keys.media') !== '0' })
           : br.saveKeys(collectKeys(), { globalKeys: false, mediaKeys: localStorage.getItem('uzz.keys.media') !== '0' }))
          .catch(() => {});
      }
      toast(v ? '全局快捷键已启用' : '全局快捷键已关闭');
    });
    // 系统媒体键开关：真实控制注册
    bindStCk('stMediaKey', 'uzz.keys.media', true, (v) => {
      const br = window.uzzBridge;
      if (br && br.saveKeys) {
        br.saveKeys(collectKeys(), {
          globalKeys: localStorage.getItem('uzz.keys.global') !== '0',
          mediaKeys: v,
        }).catch(() => {});
      }
      toast(v ? '系统媒体键已启用' : '系统媒体键已关闭');
    });
    $('stKeyReset') && $('stKeyReset').addEventListener('click', () => {
      Object.keys(localStorage).filter((k) => k.indexOf('uzz.key.') === 0).forEach((k) => localStorage.removeItem(k));
      renderKeys();
      // 恢复默认后重新注册（默认值为空 → 注销）
      if (window.uzzBridge && window.uzzBridge.registerGlobal) window.uzzBridge.registerGlobal({}).catch(() => {});
      toast('快捷键已恢复默认');
    });
    // 启动时把已保存的全局快捷键真实注册到系统
    if (window.uzzBridge && window.uzzBridge.registerGlobal) {
      window.uzzBridge.registerGlobal(collectKeys()).catch(() => {});
    }

    // ── 音质与下载 ──
    // 播放音质 / 下载音质（真实写入播放与下载请求参数）
    bindStRadio('quality', 'uzz.quality', 'ex', (v) => {
      if (window.Player && window.Player.reloadQuality) window.Player.reloadQuality(v);
      toast('播放音质：' + (v === 'ex' ? '超高' : v === 'hz' ? '高' : '标准'));
    });
    bindStRadio('quality2', 'uzz.quality', 'ex', (v) => {
      if (window.Player && window.Player.reloadQuality) window.Player.reloadQuality(v);
      toast('播放音质：' + (v === 'ex' ? '超高' : v === 'hz' ? '高' : '标准'));
    });
    bindStRadio('dlq', 'uzz.dlQuality', 'ex', (v) => {
      toast('下载音质：' + (v === 'ex' ? '超高' : v === 'hz' ? '高' : '标准'));
    });
    // 下载目录
    const fillDlDir = (d) => { const e = $('stDlDir'); if (e) e.textContent = d || '（未设置）'; };
    if (window.uzzBridge && window.uzzBridge.getDownloadDir) {
      window.uzzBridge.getDownloadDir().then(fillDlDir).catch(() => fillDlDir('（读取失败）'));
    }
    $('stDlDirBtn') && $('stDlDirBtn').addEventListener('click', async () => {
      if (!window.uzzBridge || !window.uzzBridge.chooseDownloadDir) { toast('仅桌面版支持'); return; }
      const dir = await window.uzzBridge.chooseDownloadDir();
      if (dir) { fillDlDir(dir); toast('下载目录已更改'); }
    });
    $('stDlOpen') && $('stDlOpen').addEventListener('click', () => {
      if (window.uzzBridge && window.uzzBridge.openDownloadDir) window.uzzBridge.openDownloadDir();
      else toast('仅桌面版支持');
    });
    // 缓存：真实读取路径、统计占用、可真正清理
    (function bindCacheReal() {
      const br = window.uzzBridge;
      const setDir = (p) => { const e = $('stCacheDir'); if (e) e.textContent = p || '（未知）'; };
      if (br && br.getCacheDir) br.getCacheDir().then(setDir).catch(() => setDir('（读取失败）'));
      else setDir('（浏览器环境无本地缓存）');
      const sizeEl = $('stCacheSize');
      const calcSize = () => {
        if (br && br.getCacheSize) {
          br.getCacheSize().then((r) => {
            if (sizeEl) sizeEl.textContent = r && r.sizeText ? ('当前占用 ' + r.sizeText) : '';
          }).catch(() => {});
        }
      };
      calcSize();
      $('stCacheDirBtn') && $('stCacheDirBtn').addEventListener('click', () => {
        if (br && br.openCacheDir) br.openCacheDir();
        else toast('缓存目录跟随程序目录，不可更改');
      });
      $('stCacheClear') && $('stCacheClear').addEventListener('click', async () => {
        const b = $('stCacheClear');
        b.disabled = true; b.textContent = '清理中…';
        let r = { ok: false };
        if (br && br.clearCache) r = await br.clearCache().catch(() => ({ ok: false }));
        b.disabled = false; b.textContent = '清理缓存';
        if (r && r.ok) { toast(r.freedText ? ('已清理 ' + r.freedText) : '缓存已清理'); calcSize(); }
        else toast('清理失败：' + ((r && r.msg) || '当前环境无本地缓存'));
      });
      bindStRange('stCacheMax', 'uzz.cacheMax', 'stCacheVal', 'G', '50', (v) => {
        if (br && br.setCacheMax) br.setCacheMax(v).catch(() => {});
        toast('缓存上限已设为 ' + v + ' GB');
      });
    })();
    // 下载文件命名格式（真实传给下载器）
    bindStRadio('nameFmt', 'uzz.nameFmt', 'artist-name', (v) => {
      const br = window.uzzBridge;
      if (br && br.setNameFmt) br.setNameFmt(v);
      toast('命名格式：' + ({ 'artist-name': '歌手 - 歌名', name: '歌名', 'name-artist': '歌名 - 歌手' }[v] || v));
    });
    // 下载后自动分类到子目录
    bindStRadio('dlClassify', 'uzz.dlClassify', 'none', (v) => {
      toast(v === 'none' ? '下载不做分类' : v === 'artist' ? '按歌手分文件夹' : '按专辑分文件夹');
    });
    // 音乐桌面
    $('stDesktop') && $('stDesktop').addEventListener('click', () => {
      const sk = $('skinOverlay');
      if (sk) { sk.classList.remove('hidden'); toast('请选择「音乐桌面」皮肤'); }
      else toast('请点击右上角换肤 → 音乐桌面');
    });
    // HTTP 代理：真实检测连通性
    bindStRadio('proxy', 'uzz.proxy', 'none', (v) => { window.__uzzProxyMode = v; toast('代理模式：' + (v === 'none' ? '不使用' : '自定义')); });
    window.__uzzProxyMode = localStorage.getItem('uzz.proxy') || 'none';
    $('stProxyUrl') && ($('stProxyUrl').value = localStorage.getItem('uzz.proxyUrl') || '');
    $('stProxyTest') && $('stProxyTest').addEventListener('click', async () => {
      const b = $('stProxyTest');
      const url = ($('stProxyUrl') || {}).value || '';
      b.disabled = true; b.textContent = '测试中…';
      const r = await testProxy(url).catch(() => ({ ok: false, msg: '检测失败' }));
      b.disabled = false; b.textContent = '测试';
      toast(r.ok ? ('代理可用：' + (r.msg || '')) : ('代理不可用：' + (r.msg || '连接失败')));
    });
    $('stProxyOk') && $('stProxyOk').addEventListener('click', () => {
      const url = ($('stProxyUrl') || {}).value || '';
      localStorage.setItem('uzz.proxyUrl', url);
      const br = window.uzzBridge;
      if (br && br.setProxy) br.setProxy(localStorage.getItem('uzz.proxy') || 'none', url);
      toast('代理已保存并生效');
    });
    // 音乐网盘
    bindStCk('stCloud', 'uzz.cloud', true, (v) => toast(v ? '已开启音乐网盘同步' : '已关闭音乐网盘'));
    for (const id of ['stCloud', 'stCloudHis', 'stLyricTransAlway']) {
      const el = $(id); if (el) { el.checked = false; el.disabled = true; }
    }
    // 桌面歌词参数
    bindStCk('stLyricEnable', 'uzz.dl.enabled', false);
    bindStCk('stLyricTop', 'uzz.dl.topmost', true);
    bindStCk('stLyricTrans', 'uzz.dl.trans', true);
    bindStCk('stLyricTransAlway', 'uzz.dl.transPhonetic', false);
    fillFontSelect('stLyricFont', '微软雅黑');
    bindStSel('stLyricFont', 'uzz.dl.font', '微软雅黑', pushLyricCfg);
    bindStSel('stLyricSize', 'uzz.dl.size', '23', pushLyricCfg);
    bindStSel('stLyricWeight', 'uzz.dl.weight', 'bold', pushLyricCfg);
    bindStSel('stLyricStroke', 'uzz.dl.stroke', '1', pushLyricCfg);
    bindStSel('stLyricLayout', 'uzz.dl.layout', 'double', pushLyricCfg);
    bindStSel('stLyricAlign', 'uzz.dl.align', 'center', pushLyricCfg);
    bindStSel('stLyricColor', 'uzz.dl.color', 'gradient', () => { pushLyricCfg(); applyLyricPreview(); });
    applyLyricPreview();

    // ── 桌面与歌词 ──
    bindStCk('stDLyric', 'uzz.dl.enabled', false);
    bindStCk('stDLyricTop', 'uzz.dl.topmost', true);
    // 锁定歌词位置：真实控制歌词窗鼠标穿透
    bindStCk('stDLyricLock', 'uzz.lyricLock', false, (v) => {
      const br = window.uzzBridge;
      if (br && br.setLyricLocked) {
        br.setLyricLocked(v).catch(() => {});
      }
      toast(v ? '已锁定：空白区域鼠标穿透，不挡桌面' : '已解锁：可拖动歌词窗口', 2600);
    });
    // 启动时与主进程同步真实锁定态（避免设置与实际不一致）
    if (window.uzzBridge && window.uzzBridge.getLyricLocked) {
      window.uzzBridge.getLyricLocked().then((r) => {
        if (r && typeof r.locked === 'boolean' && localStorage.getItem('uzz.lyricLock') !== (r.locked ? '1' : '0')) {
          localStorage.setItem('uzz.lyricLock', r.locked ? '1' : '0');
          const el = $('stDLyricLock');
          if (el) el.checked = r.locked;
        }
      }).catch(() => {});
    }
    const updOffset = () => { const e = $('stLyricOffsetVal'); if (e) e.textContent = (localStorage.getItem('uzz.lyricOffset') || 0) + 's'; };
    $('stLyricOffsetBack') && $('stLyricOffsetBack').addEventListener('click', () => {
      const v = Player.setLyricOffset(Number(localStorage.getItem('uzz.lyricOffset') || 0) - 0.5);
      if ($('stLyricOffsetVal')) $('stLyricOffsetVal').textContent = v + 's';
    });
    $('stLyricOffsetFwd') && $('stLyricOffsetFwd').addEventListener('click', () => {
      const v = Player.setLyricOffset(Number(localStorage.getItem('uzz.lyricOffset') || 0) + 0.5);
      if ($('stLyricOffsetVal')) $('stLyricOffsetVal').textContent = v + 's';
    });
    updOffset();
    bindStCk('stMiniBar', 'uzz.miniBar', false);
    bindStCk('stBootMini', 'uzz.sys.startupMode', false, (v) => {
      localStorage.setItem('uzz.sys.startupMode', v ? 'mini' : '');
      if (window.uzzBridge && window.uzzBridge.setAutoRun) { try { window.uzzBridge.setAutoRun(v); } catch (e) { /* 忽略 */ } }
    });

    // ── 关于 ──
    if (window.uzzBridge && window.uzzBridge.getAppVersion) {
      window.uzzBridge.getAppVersion().then((i) => { const e = $('abVer'); if (e) e.textContent = 'v' + ((i && i.version) || '?'); }).catch(() => {});
    }
    // 检查更新：两个入口都接上（关于页顶部的「检查更新」+ 状态区按钮）
    $('abCheck') && $('abCheck').addEventListener('click', () => doUpdateCheck(false));
    if ($('updCheck')) $('updCheck').addEventListener('click', () => doUpdateCheck(false));
    // 手动选择升级包
    if ($('updPick')) $('updPick').addEventListener('click', async () => {
      const br = window.uzzBridge;
      if (!br || !br.pickAndInstall) { toast('仅桌面版支持'); return; }
      const r = await br.pickAndInstall().catch(() => null);
      if (r && r.canceled) return;
      if (r && r.ok) toast('已开始安装升级');
      else if (r && r.msg) toast(r.msg);
    });
    // 升级源诊断：把网卡、端口、目录、连通性全部摊开，便于定位问题
    if ($('abDiag')) $('abDiag').addEventListener('click', async () => {
      const out = $('abDiagOut');
      const br = window.uzzBridge;
      if (!br || !br.updDiagnose) { toast('仅桌面版支持'); return; }
      if (out) out.textContent = '诊断中…';
      const d = await br.updDiagnose().catch((e) => ({ err: String(e) }));
      if (!d || d.err) { if (out) out.textContent = '诊断失败：' + ((d && d.err) || '未知'); return; }
      const L = [];
      const ok = (t) => '<span class="ok">' + t + '</span>';
      const bad = (t) => '<span class="bad">' + t + '</span>';
      const dim = (t) => '<span class="dim">' + t + '</span>';
      L.push('当前版本 v' + d.curVersion + '　目录内最新 v' + (d.latestInDir || '无') +
             '　' + (d.hasUpdateInDir ? bad('有新版本') : ok('无需升级')));
      L.push('升级目录：' + dim(d.dir) + '（安装包 ' + d.pkgCount + ' 个' + (d.hasLatestYml ? '，含 latest.yml' : '') + '）');
      L.push('升级服务：' + (d.serverRunning ? ok('运行中 端口 ' + d.port) : bad('未运行（请在下方开启）')) + '　更新源：' + dim(d.configuredUrl));
      L.push('局域网地址：' + (d.lanIp === '127.0.0.1' ? bad('未取到局域网 IP') : ok(d.lanUrl)));
      if (d.nicRejected && d.nicRejected.length) L.push('已排除的虚拟网卡：' + dim(d.nicRejected.join('；')));
      if (d.httpOk === false) L.push(bad('HTTP 探测失败：' + (d.httpErr || '无法访问')));
      else if (d.httpOk) {
        L.push('HTTP 探测：' + ok('正常，服务端最新 v' + d.httpLatest));
        L.push('下载地址：' + (d.httpUrlReachable ? ok('可访问') : bad('不可访问（其它机器会下载失败）')));
        if (d.httpUrl && !d.httpUrlReachable) L.push(dim('　' + d.httpUrl));
      }
      if (out) out.innerHTML = L.join('<br>');
    });
    // 清理历史升级包（每个约 75MB，不清理会涨到 GB 级）
    if ($('abPrune')) $('abPrune').addEventListener('click', async () => {
      const br = window.uzzBridge;
      if (!br || !br.prunePackages) { toast('仅桌面版支持'); return; }
      if (!confirm('将只保留最近 3 个版本的升级包（其余删除），确定？')) return;
      const r = await br.prunePackages(3).catch(() => null);
      if (r && r.ok) toast(r.removed ? ('已清理 ' + r.removed + ' 个历史包，释放 ' + r.freedText) : '没有需要清理的历史包');
      else toast('清理失败');
    });
    $('abFeedback') && $('abFeedback').addEventListener('click', () => toast('感谢反馈！可在设置里查看更新日志'));
    $('abRecords') && $('abRecords').addEventListener('click', () => toast('版本记录可在「检查更新」中查看'));
    bindStRadio('updMode', 'uzz.sys.updMode', 'auto');
    // 局域网升级服务器（从「系统」分组搬来，这里也能控）
    if (window.uzzBridge && window.uzzBridge.updSrvInfo) {
      const tg = $('abSrvToggle');
      const render = (r) => {
        if (!r) return;
        tg.textContent = r.running ? '停止升级服务' : '开启升级服务';
        tg.classList.toggle('st-btn-red', !r.running);
      };
      br_updSrvInfoSafe(render);
      tg && tg.addEventListener('click', async () => {
        const cur = await window.uzzBridge.updSrvInfo().catch(() => null);
        const r = await window.uzzBridge.updSrvToggle(!(cur && cur.running)).catch((e) => ({ ok: false, msg: String(e) }));
        if (!r || !r.ok) { toast('操作失败：' + ((r && r.msg) || '未知错误')); return; }
        br_updSrvInfoSafe(render);
      });
      $('abSrvDir') && $('abSrvDir').addEventListener('click', async () => {
        const d = await window.uzzBridge.updSrvSetDir().catch(() => '');
        if (d) { toast('已设置升级包目录'); br_updSrvInfoSafe(render); }
      });
      $('abSrvOpen') && $('abSrvOpen').addEventListener('click', () => window.uzzBridge.updSrvOpenDir && window.uzzBridge.updSrvOpenDir());
      $('abSrvPublish') && $('abSrvPublish').addEventListener('click', async () => {
        let r = null;
        if (window.uzzBridge.updSrvPublish) r = await window.uzzBridge.updSrvPublish('').catch((e) => ({ ok: false, msg: String(e) }));
        if (r && r.ok) { toast('已发布 v' + r.version + ' 到局域网升级目录'); br_updSrvInfoSafe(render); }
        else toast('发布失败：' + ((r && r.msg) || '目录内没有安装包'));
      });
    }
    function br_updSrvInfoSafe(cb) {
      if (window.uzzBridge && window.uzzBridge.updSrvInfo) window.uzzBridge.updSrvInfo().then(cb).catch(() => {});
    }
    // 数据管理
    $('abExportFav') && $('abExportFav').addEventListener('click', () => {
      const list = Player.getFavorites();
      if (!list.length) { toast('还没有收藏内容'); return; }
      const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'xiaoyang-favorites.json';
      a.click();
      toast('已导出 ' + list.length + ' 首');
    });
    $('abClearData') && $('abClearData').addEventListener('click', () => {
      if (!confirm('确定清空收藏与历史？此操作不可撤销')) return;
      localStorage.removeItem('uzz.fav');
      localStorage.removeItem('uzz.history');
      toast('已清空，刷新页面生效');
    });
    bindUpdater();
    bindWhatsNew();
  }
  // 歌词参数改动 → 推给歌词窗实时预览
  function pushLyricCfg() {
    if (window.Player && Player.pushLyricStyle) { try { Player.pushLyricStyle(); } catch (e) { /* 忽略 */ } }
    applyLyricPreview();
  }

  /* 升级后首次启动：弹出本版本更新要点（由主进程判定版本变更后推送） */
  function bindWhatsNew() {
    const br = window.uzzBridge;
    const box = $('whatsNewModal');
    if (!br || !br.onWhatsNew || !box) return;
    const close = () => box.classList.add('hidden');
    const ok = $('wnOk');
    if (ok && !ok.dataset.bound) { ok.dataset.bound = '1'; ok.addEventListener('click', close); }
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    br.onWhatsNew((d) => {
      if (!d || !d.items || !d.items.length) return;
      $('wnVer').textContent = d.version || '?';
      const ul = $('wnList');
      ul.innerHTML = d.items.map((s) => '<li>' + String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) + '</li>').join('');
      box.classList.remove('hidden');
    });
  }

  /* ============================================================
   * 软件更新（桌面版）：检查更新 / 一键下载安装 / 手动选包覆盖安装
   * ============================================================ */
  let updInfo = null; // 最近一次检查结果 { hasUpdate, latest, url, notes, cur }
  function bindUpdater() {
    const br = window.uzzBridge;
    const curEl = $('updCur') || $('abVer');
    // 当前版本 + 更新源回填
    br?.getAppVersion?.().then((info) => {
      curEl.textContent = 'v' + (info && info.version ? info.version : '?');
      if (info && info.updateUrl) if ($('updUrl')) $('updUrl').value = info.updateUrl;
    }).catch(() => {});
    if ($('updUrl') && br?.setUpdateUrl) $('updUrl').addEventListener('change', () => br.setUpdateUrl($('updUrl').value.trim()));
    // 检查入口已在关于页绑定，避免一次点击发起两次请求。
    // 一键升级：下载 → 静默覆盖安装
    if ($('updInstall')) $('updInstall').addEventListener('click', async () => {
      if (!updInfo || !updInfo.url) { toast('请先检查更新'); return; }
      if (!br?.downloadAndInstall) {
        if (window.XYNative?.isAndroid) {
          try { await window.XYNative.openUpdate(updInfo.url); }
          catch (error) { toast(error.message || '无法打开下载浏览器'); }
          return;
        }
        window.open(updInfo.url, '_blank', 'noopener,noreferrer');
        return;
      }
      $('updInstall').disabled = true;
      if ($('updProgRow')) $('updProgRow').classList.remove('hidden');
      if ($('updProgText')) $('updProgText').textContent = '正在下载升级包…';
      const r = await br.downloadAndInstall(updInfo.url).catch((e) => ({ ok: false, msg: String(e) }));
      if (!r || !r.ok) {
        $('updInstall').disabled = false;
        setUpdSpeed('');
        if (r && r.canceled) {
          // 已取消：断点保留，按钮变「继续下载」，下次点击自动续传
          if ($('updInstall')) $('updInstall').textContent = '继续下载';
          if ($('updProgText')) $('updProgText').textContent = '已取消（进度已保留，可继续）';
          toast('已取消下载，进度已保留');
        } else {
          if ($('updProgRow')) $('updProgRow').classList.add('hidden');
          toast('升级失败：' + ((r && r.msg) || '未知错误'));
        }
        return;
      }
      // 成功：主进程会启动安装器并退出应用
    });
    if ($('updCancel')) $('updCancel').addEventListener('click', () => {
      br?.cancelUpdateDownload?.();
      if ($('updCancel')) $('updCancel').disabled = true;
    });
    const setUpdSpeed = (text) => { if ($('updSpeed')) $('updSpeed').textContent = text || ''; };
    br?.onUpdateProgress?.((p) => {
      if (!p) return;
      if (p.phase === 'installing') {
        if ($('updCancel')) $('updCancel').disabled = true;
        if ($('updProgText')) $('updProgText').textContent = '下载完成，正在启动安装…';
        setUpdSpeed(''); return;
      }
      if (p.phase === 'canceled') {
        if ($('updCancel')) $('updCancel').disabled = false;
        if ($('updProgText')) $('updProgText').textContent = '已取消（进度已保留，可继续）';
        setUpdSpeed(''); return;
      }
      if (typeof p.pct === 'number') {
        if ($('updCancel')) $('updCancel').disabled = false;
        if ($('updBarFill')) $('updBarFill').style.width = p.pct + '%';
        const mb = (n) => (n / 1048576).toFixed(1);
        if ($('updProgText')) $('updProgText').textContent = `下载中 ${p.pct}%（${mb(p.received)} / ${mb(p.total)} MB）`;
        // 实时速度：主进程每秒采样一次字节增量
        setUpdSpeed(p.speed ? (p.speed / 1048576).toFixed(1) + ' MB/s' : '');
      }
    });
    // 手动选包入口已在关于页绑定。
    // 自动扫描本地升级包（下载目录 / 桌面），发现新版直接提供一键安装
    if (br?.scanLocalPackages) {
      const showLocal = (list) => {
        if (!list || !list.length) return;
        const top = list[0];
        if ($('updLocalRow')) $('updLocalRow').classList.remove('hidden');
        if ($('updLocalInfo')) $('updLocalInfo').textContent = `发现本地升级包 v${top.version}`;
        if ($('updLocalPath')) $('updLocalPath').textContent = top.path;
        $('updLocalInstall').onclick = async () => {
          const r = await br.installLocalPath(top.path).catch((e) => ({ ok: false, msg: String(e) }));
          if (r && r.msg) toast('升级失败：' + r.msg);
        };
      };
      br.scanLocalPackages().then((r) => showLocal(r && r.list)).catch(() => {});
      if ($('updCheck')) $('updCheck').addEventListener('click', () => {
        br.scanLocalPackages().then((r) => showLocal(r && r.list)).catch(() => {});
      });
    }
    // ══════ 本机升级服务器（把本机当作在线升级源） ══════
    if (br?.updSrvInfo && $('updSrvToggle') && $('updSrvInfo')) {
      const tg = $('updSrvToggle'), info = $('updSrvInfo');
      const render = (r) => {
        if (!r) return;
        tg.textContent = r.running ? '停止升级服务' : '开启升级服务';
        tg.classList.toggle('btn-accent', !r.running);
        const has = r.latest && r.latest.version;
        const lanLine = '局域网地址：<b style="color:var(--accent)">' + (r.lanUrl || '-') + '</b>'
          + '<br>浏览器打开该地址的根路径即可看到下载页。';
        info.innerHTML = (r.running
          ? `运行中 · 端口 ${r.port || ''}<br>${lanLine}<br>托管目录：${r.dir}<br>${has ? '当前托管版本：v' + r.latest.version + '（' + (r.latest.file || '') + '）' : '目录内暂无升级包（构建后点「发布当前升级包」即可投递进来）'}${r.auto ? '<br>已设为随软件自动启动' : ''}`
          : `未运行。开启后本机会以 HTTP 服务托管升级包目录（当前目录：${r.dir}），局域网内其它设备把「更新源地址」填成 ${r.lanUrl || ''} 即可发现新版本。`);
        if ($('updUrl') && r.running) $('updUrl').value = r.lanUrl || r.url;
      };
      br.updSrvInfo().then(render).catch(() => {});
      tg.addEventListener('click', async () => {
        const cur = await br.updSrvInfo().catch(() => null);
        const r = await br.updSrvToggle(!(cur && cur.running)).catch((e) => ({ ok: false, msg: String(e) }));
        if (!r || !r.ok) { toast('操作失败：' + ((r && r.msg) || '未知错误')); return; }
        br.updSrvInfo().then(render).catch(() => {});
      });
      if ($('updSrvSetDir')) $('updSrvSetDir').addEventListener('click', async () => {
        const d = await br.updSrvSetDir().catch(() => '');
        if (d) { toast('已设置升级包目录'); br.updSrvInfo().then(render).catch(() => {}); }
      });
      if ($('updSrvOpenDir')) $('updSrvOpenDir').addEventListener('click', () => br.updSrvOpenDir && br.updSrvOpenDir());
      const pub = $('updSrvPublish');
      if (pub) {
        pub.addEventListener('click', async () => {
          pub.disabled = true;
          // 优先发布扫描到的最新版安装包（下载目录/桌面），否则发布托管目录内现有包
          let r = null;
          if (br.scanLocalPackages) {
            const s = await br.scanLocalPackages().catch(() => null);
            if (s && s.list && s.list.length) r = await br.updSrvPublish(s.list[0].path).catch((e) => ({ ok: false, msg: String(e) }));
          }
          if (!r || !r.ok) r = await br.updSrvPublish('').catch((e) => ({ ok: false, msg: String(e) }));
          pub.disabled = false;
          if (r && r.ok) {
            toast('已发布 v' + r.version + ' 到局域网升级目录');
            br.updSrvInfo().then(render).catch(() => {});
          } else {
            toast('发布失败：' + ((r && r.msg) || '未找到安装包'));
          }
        });
      }
    }
  }
  /* ---------- 上回记忆播放：有未听完的歌就提示一键接着听 ---------- */
  function fmtSec(s) {
    s = Math.floor(s || 0);
    const m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }
  function showResumeBar() {
    const bar = $('resumeBar');
    if (!bar || !Player || !Player.getResume) return;
    const r = Player.getResume();
    // 没记录 / 已从听完 / 本次已恢复过 都不提示
    if (!r || !r.id || sessionStorage.getItem('uzz.resumeUsed') === '1') return;
    $('resumeName').textContent = r.name || '未知歌曲';
    const bits = [];
    if (r.artist) bits.push(r.artist);
    if (r.time > 0) bits.push('听到 ' + fmtSec(r.time) + (r.duration ? ' / ' + fmtSec(r.duration) : ''));
    $('resumeInfo').textContent = bits.join(' · ');
    const pic = $('resumePic');
    pic.src = r.pic ? UzzApi.picProxy(r.pic) : 'data:,';
    pic.style.visibility = r.pic ? 'visible' : 'hidden';
    bar.classList.remove('hidden');
    $('resumePlay').onclick = async () => {
      bar.classList.add('hidden');
      sessionStorage.setItem('uzz.resumeUsed', '1');
      await Player.resumeFrom(r);
      toast('已回到上次播放进度');
    };
    $('resumeClose').onclick = () => {
      bar.classList.add('hidden');
      Player.clearResume();          // 明确关闭才清除，避免下次又弹
    };
    // 一段时间不用就自己收起（不清除记录，下次仍可从「最近播放」手动继续）
    setTimeout(() => { if (!sessionStorage.getItem('uzz.resumeUsed')) bar.classList.add('hidden'); }, 30000);
  }

  // 黑名单：真实过滤（命中关键词的歌曲直接跳过并提示）
  function applyBlacklist() {
    let list = window.__uzzBlacklist;
    if (!list) {
      try { list = JSON.parse(localStorage.getItem('uzz.play.blacklist') || '[]'); }
      catch (e) { list = []; }
      window.__uzzBlacklist = list;
    }
    return (Array.isArray(list) ? list : []).filter(Boolean);
  }
  // 判断歌曲是否应被屏蔽：歌名/歌手/专辑 任一命中关键词即拦截
  function isBlacklisted(track) {
    const list = applyBlacklist();
    if (!list.length || !track) return false;
    const hay = ((track.name || '') + ' ' + (track.artist || '') + ' ' + (track.album || '')).toLowerCase();
    return list.some((k) => {
      const key = String(k).toLowerCase();
      return key && hay.indexOf(key) >= 0;
    });
  }

  // 代理连通性检测：真实发起请求并计时
  async function testProxy(proxyUrl) {
    const mode = window.__uzzProxyMode || localStorage.getItem('uzz.proxy') || 'none';
    if (mode === 'none' || !proxyUrl) {
      // 直连测试
      const t0 = Date.now();
      try {
        const r = await UzzApi.ping();
        return { ok: !!r, msg: (r ? '直连正常' : '后端不可达') + '，耗时 ' + (Date.now() - t0) + 'ms' };
      } catch (e) {
        return { ok: false, msg: '直连失败：' + (e.message || e) };
      }
    }
    if (!/^https?:\/\//i.test(proxyUrl)) return { ok: false, msg: '代理地址需以 http:// 或 https:// 开头' };
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      // 用代理去探测一个外部连通性检测端点
      const res = await fetch('https://www.baidu.com', { mode: 'no-cors', signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);
      return { ok: res.status < 500, msg: '代理响应 ' + res.status + '，耗时 ' + (Date.now() - t0) + 'ms' };
    } catch (e) {
      return { ok: false, msg: /abort/i.test(String(e.message)) ? '代理超时（8s）' : ('连接失败：' + (e.message || e)) };
    }
  }

  let checkingUpdate = false;
  async function doUpdateCheck(silent) {
    if (checkingUpdate) return;
    checkingUpdate = true;
    const controls = [$('abCheck'), $('updCheck')].filter(Boolean);
    controls.forEach(button => { button.disabled = true; });
    updInfo = null;
    $('updNewRow')?.classList.add('hidden');
    const br = window.uzzBridge, statusEl = $('updStatus');
    if (!silent) statusEl.textContent = '正在检查云端版本…';
    let r;
    try {
      if (window.XYCloud?.getUpdateInfo) r = await window.XYCloud.getUpdateInfo();
      else if (br?.checkUpdate) r = await br.checkUpdate();
      else throw new Error('更新服务未就绪');
    } catch (error) { r = { ok: false, msg: '检查更新失败：' + error.message }; }
    finally { checkingUpdate = false; controls.forEach(button => { button.disabled = false; }); }
    if (!r || !r.ok) {
      if (!silent) statusEl.textContent = r && r.msg ? r.msg : '检查失败';
      if (!silent) toast((r && r.msg) || '检查失败');
      return;
    }
    updInfo = r;
    if ($('abVer')) $('abVer').textContent = 'v' + r.cur;
    if ($('updInstall')) { $('updInstall').disabled = false; $('updInstall').textContent = br?.downloadAndInstall ? '一键升级' : '下载新版'; }
    if (r.hasUpdate) {
      statusEl.textContent = '';
      if ($('updNew')) $('updNew').textContent = 'v' + r.latest;
      if ($('updNotes')) $('updNotes').textContent = r.notes || '';
      if ($('updNewRow')) $('updNewRow').classList.remove('hidden');
      const tip = `发现新版本 v${r.latest}，可在关于页${br?.downloadAndInstall ? '一键升级' : '下载新版'}`;
      if (silent) toast(tip + '（设置 → 系统 → 软件更新）');
      else toast(tip);
    } else {
      // 已是最新版：明确告知（区分"目录内无升级包"与"确实无新版本"）
      if ($('updNewRow')) $('updNewRow').classList.add('hidden');
      if (r.noPackage) {
        statusEl.textContent = '未发现升级包（可点「发布当前升级包」把安装包投递到局域网目录）';
        if (!silent) toast('未在升级目录发现安装包，当前版本 v' + r.cur + ' 已是最新');
      } else {
        statusEl.textContent = `暂无更高版本 · 当前 v${r.cur}`;
        if (!silent) toast(`已经是最新版本 v${r.cur}`);
      }
    }
  }

  /* ============================================================
   * 应用内快捷键
   * ============================================================ */
  function bindShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (localStorage.getItem('uzz.keys.enable') === '0') return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
      const P = window.Player;

      // ── 应用内自定义快捷键：按用户在设置页录入的组合键匹配（真实生效） ──
      // 把本次按键规整成 "Ctrl + Alt + X" 形式，与 prettyKey 输出格式一致
      const combo = (() => {
        const ps = [];
        if (e.ctrlKey) ps.push('Ctrl');
        if (e.altKey) ps.push('Alt');
        if (e.shiftKey) ps.push('Shift');
        if (e.metaKey) ps.push('Meta');
        let k = e.key;
        const named = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'Space' };
        k = named[k] || (typeof k === 'string' ? (k.length === 1 ? k.toUpperCase() : k) : '');
        if (k && !['Control', 'Alt', 'Shift', 'Meta'].includes(k)) ps.push(k);
        return ps.join(' + ');
      })();

      if (combo) {
        const ACTIONS = {
          toggle: () => P && P.toggle(),
          prev: () => P && P.prev(),
          next: () => P && P.next(),
          volUp: () => { const a = document.getElementById('audio'); if (a && P && P.setVolume) P.setVolume(a.volume + 0.05); },
          volDown: () => { const a = document.getElementById('audio'); if (a && P && P.setVolume) P.setVolume(a.volume - 0.05); },
          mini: () => { const t = $('tbMini'); if (t) t.click(); },
          like: () => { const b = $('fpFav'); if (b) b.click(); },
          lyric: () => { const b = $('btnLyric'); if (b) b.click(); },
          trans: () => { const b = $('lyTrans'); if (b) b.click(); },
        };
        for (const d of KEY_DEFS) {
          const want = localStorage.getItem('uzz.key.app.' + d.k) || d.app;
          if (want && want !== combo) continue;
          const fn = ACTIONS[d.k];
          if (fn) { e.preventDefault(); fn(); return; }
        }
      }

      if (e.code === 'Space' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (P) P.toggle(); }
      else if (e.ctrlKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); const s = $('searchInput'); if (s) { s.focus(); s.select(); } }
    });
  }

  /* ============================================================
   * 音效 / 播放增强面板绑定
   * ============================================================ */
  let sleepTimerId = null;
  function bindFxPanel() {
    const audio = document.getElementById('audio');
    const panel = $('fxPanel');
    if (!panel) return;
    // 注意：fpbFx 的打开绑定在 player.js bindFullBottom() 里（remove hidden）。
    // 这里曾再绑一次 toggle → 一次点击先开后关，表现为“音效按钮没反应”，已移除。
    if ($('fxClose')) $('fxClose').addEventListener('click', () => panel.classList.add('hidden'));
    // 点背景（抽屉空白处）关闭 —— 之前只有 ✕ 能关，用户误以为按钮失效
    panel.addEventListener('click', (e) => { if (e.target === panel) panel.classList.add('hidden'); });

    // 均衡器：构建 10 段滑块
    const bandsEl = $('eqBands');
    if (bandsEl && window.Eq) {
      bandsEl.innerHTML = window.Eq.BANDS.map((f, i) =>
        `<div class="eq-band"><input type="range" class="eq-slider" data-i="${i}" min="-12" max="12" step="0.5" value="0" /><span class="eq-freq">${f >= 1000 ? (f / 1000) + 'k' : f}</span></div>`
      ).join('');
      bandsEl.querySelectorAll('.eq-slider').forEach((sl) => {
        sl.addEventListener('input', () => window.Eq.setBand(Number(sl.dataset.i), parseFloat(sl.value)));
      });
    }
    const eqEnable = $('eqEnable');
    if (eqEnable) {
      eqEnable.checked = localStorage.getItem('uzz.eq') === '1';
      eqEnable.addEventListener('change', () => {
        localStorage.setItem('uzz.eq', eqEnable.checked ? '1' : '0');
        if (window.Eq) window.Eq.setEnabled(eqEnable.checked);
      });
    }
    const eqPreset = $('eqPreset');
    if (eqPreset) eqPreset.addEventListener('change', () => {
      if (window.Eq) window.Eq.setPreset(eqPreset.value);
      // 同步滑块显示
      if (window.Eq && bandsEl) {
        const p = window.Eq.PRESETS[eqPreset.value] || [];
        bandsEl.querySelectorAll('.eq-slider').forEach((sl, i) => { sl.value = p[i] || 0; });
      }
      if (eqEnable && !eqEnable.checked) { eqEnable.checked = true; localStorage.setItem('uzz.eq', '1'); window.Eq.setEnabled(true); }
    });

    // 播放速度
    const speed = $('speed');
    if (speed) {
      speed.value = localStorage.getItem('uzz.speed') || '1';
      $('speedVal').textContent = parseFloat(speed.value).toFixed(2) + '×';
      speed.addEventListener('input', () => {
        const v = parseFloat(speed.value);
        $('speedVal').textContent = v.toFixed(2) + '×';
        // 走 Player.setPlaybackRate：同步底部倍速菜单 + defaultPlaybackRate（切歌后 load() 不丢倍速）
        if (window.Player && Player.setPlaybackRate) Player.setPlaybackRate(v);
        else if (audio) { audio.playbackRate = v; audio.defaultPlaybackRate = v; localStorage.setItem('uzz.speed', v); }
      });
    }

    // 输出设备
    const outDev = $('outDev');
    if (outDev && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then((devs) => {
        const outs = devs.filter((d) => d.kind === 'audiooutput' && d.deviceId);
        outs.forEach((d) => {
          const o = document.createElement('option');
          o.value = d.deviceId; o.textContent = d.label || ('扬声器 ' + d.deviceId.slice(0, 6));
          outDev.appendChild(o);
        });
      }).catch(() => {});
      outDev.addEventListener('change', async () => {
        try { if (audio && audio.setSinkId) await audio.setSinkId(outDev.value); }
        catch (e) { toast('切换输出设备失败'); }
      });
    }

    // AB 重复
    let abA = null, abB = null;
    const abInfo = $('abInfo');
    if ($('abSetA')) $('abSetA').addEventListener('click', () => { abA = audio ? audio.currentTime : 0; abInfo.textContent = `A=${fmtDur(abA)}`; });
    if ($('abSetB')) $('abSetB').addEventListener('click', () => { abB = audio ? audio.currentTime : 0; abInfo.textContent = `A=${fmtDur(abA || 0)} B=${fmtDur(abB)}`; });
    if ($('abClear')) $('abClear').addEventListener('click', () => { abA = abB = null; abInfo.textContent = ''; });
    // AB 区间检查（挂在全局，player 的 timeupdate 不方便改；这里用定时器轻量检查）
    setInterval(() => {
      if (abA != null && abB != null && audio && !audio.paused) {
        if (audio.currentTime >= abB) audio.currentTime = abA;
      }
    }, 300);

    // 睡眠定时
    const sleepSel = $('sleepTimer');
    if (sleepSel) sleepSel.addEventListener('change', () => {
      if (sleepTimerId) { clearTimeout(sleepTimerId); sleepTimerId = null; }
      const m = parseInt(sleepSel.value, 10);
      if (m > 0) {
        sleepTimerId = setTimeout(() => { if (audio) audio.pause(); toast('睡眠定时：已停止播放'); }, m * 60 * 1000);
        toast(`将在 ${m} 分钟后停止播放`);
      }
    });

    // 交叉淡入淡出
    const cf = $('crossfadeEnable'), cfDur = $('crossfadeDur');
    if (cf) {
      cf.checked = localStorage.getItem('uzz.crossfade') === '1';
      cf.addEventListener('change', () => localStorage.setItem('uzz.crossfade', cf.checked ? '1' : '0'));
    }
    if (cfDur) {
      cfDur.value = localStorage.getItem('uzz.crossfade.dur') || '2';
      $('crossfadeVal').textContent = parseFloat(cfDur.value).toFixed(1) + 's';
      cfDur.addEventListener('input', () => {
        const v = parseFloat(cfDur.value);
        $('crossfadeVal').textContent = v.toFixed(1) + 's';
        localStorage.setItem('uzz.crossfade.dur', v);
      });
    }

    // 频谱可视化
    const viz = $('fxViz');
    if (viz) {
      const ctx2d = viz.getContext('2d');
      const accent = localStorage.getItem('uzz.theme.accent') || '#ec4141';
      function draw() {
        requestAnimationFrame(draw);
        const an = window.Eq && window.Eq.getAnalyser();
        const w = viz.width, h = viz.height;
        ctx2d.clearRect(0, 0, w, h);
        if (!an) {
          ctx2d.fillStyle = 'rgba(255,255,255,0.18)';
          ctx2d.font = '13px sans-serif'; ctx2d.fillText('启用播放后展示频谱', 12, h / 2);
          return;
        }
        const data = new Uint8Array(an.frequencyBinCount);
        an.getByteFrequencyData(data);
        const bars = 48;
        const step = Math.floor(data.length / bars);
        const bw = w / bars;
        for (let i = 0; i < bars; i++) {
          const v = data[i * step] / 255;
          const bh = v * h;
          ctx2d.fillStyle = accent;
          ctx2d.globalAlpha = 0.35 + v * 0.65;
          ctx2d.fillRect(i * bw + 1, h - bh, bw - 2, bh);
        }
        ctx2d.globalAlpha = 1;
      }
      draw();
    }

    // 应用已保存的 EQ / 速度
    setTimeout(() => {
      if (window.Eq) {
        if (localStorage.getItem('uzz.eq') === '1') { window.Eq.setEnabled(true); eqEnable && (eqEnable.checked = true); }
        if (speed) audio && (audio.playbackRate = parseFloat(speed.value));
      }
    }, 300);
  }

  /* ============================================================
   * 搜索 + 搜索建议
   * ============================================================ */
  let curType = 'song';
  let curKeyword = '';
  let curPage = 1;
  let curTotal = 0;
  let loading = false;

  function renderResults(list) {
    const ul = $('resultList');
    if (curPage === 1) ul.innerHTML = '';
    if (!list.length && curPage === 1) {
      ul.innerHTML = '<li class="loading-pad">没有找到结果，换个关键词试试</li>';
      return;
    }
    if (curType === 'song') {
      ul.insertAdjacentHTML('beforeend', list.map((t) => trackLi(t)).join(''));
    } else {
      // 歌手/专辑/歌单：渲染为实体行，点击查看歌曲列表
      ul.insertAdjacentHTML('beforeend', list.map((t) => entityLi(t, curType)).join(''));
    }
    const lm = $('loadMore');
    if (curTotal && curPage * 20 < curTotal) lm.classList.remove('hidden');
    else lm.classList.add('hidden');
  }

  async function doSearch(reset) {
    const kw = $('searchInput').value.trim();
    if (!kw) { toast('请输入关键词'); return; }
    if (reset) {
      curKeyword = kw; curPage = 1; curTotal = 0;
      // 搜索历史
      searchHistory = [kw].concat(searchHistory.filter((h) => h !== kw)).slice(0, 10);
      saveJSON('uzz.searchHistory', searchHistory);
      hideSuggest();
    }
    if (loading) return;
    loading = true;
    showView('search');
    if (curPage === 1) {
      $('resultList').innerHTML = '<li class="loading-pad"><span class="spin"></span> 搜索中…</li>';
      $('searchMeta').textContent = '';
    }
    try {
      const { list, total } = await UzzApi.search(curKeyword, curType, curPage, 20);
      curTotal = total;
      $('searchMeta').textContent = total ? `共 ${total} 个结果` : '';
      renderResults(list);
    } catch (e) {
      const msg = (e && e.message) || String(e);
      let hint = '';
      const base = UzzApi.getApiBase();
      if (location.protocol === 'file:' && !base) {
        hint = '你正用文件方式直接打开，前端找不到后端。请用 http://localhost:3000 访问，或在「设置」填写后端地址。';
      } else if (!base) {
        hint = '未检测到后端。请先启动：进入 server 目录执行 node index.js，再用 http://localhost:3000 打开本页。';
      } else {
        hint = '请检查「设置」里的后端地址是否可达，并点「测试连接」确认。';
      }
      if (curPage === 1) {
        $('resultList').innerHTML = '<li class="loading-pad">搜索失败：' + escapeHtml(msg) +
          '<br><small class="hint">' + escapeHtml(hint) + '</small></li>';
      } else {
        toast('加载失败：' + msg);
      }
    } finally {
      loading = false;
    }
  }

  /* ---------- 搜索建议浮层 ---------- */
  let sgTimer = null;
  let hotWordsCache = [];
  async function ensureHotWords() {
    if (hotWordsCache.length) return hotWordsCache;
    try {
      const r = await UzzApi.suggest('');
      hotWordsCache = r.hot || [];
    } catch (e) { hotWordsCache = []; }
    return hotWordsCache;
  }
  async function showSuggest() {
    const box = $('suggestBox');
    const kw = $('searchInput').value.trim();
    box.classList.remove('hidden');
    // 猜你喜欢（本地搜索历史）
    if (searchHistory.length) {
      $('sgGuess').classList.remove('hidden');
      $('sgGuessChips').innerHTML = searchHistory.slice(0, 10)
        .map((h) => `<button data-kw="${escapeHtml(h)}">${escapeHtml(h)}</button>`).join('');
    } else $('sgGuess').classList.add('hidden');
    // 热搜榜
    const hot = await ensureHotWords();
    $('sgHot').innerHTML = hot.length
      ? hot.slice(0, 12).map((w, i) => `<li data-kw="${escapeHtml(w)}"><i class="n">${i + 1}</i>${escapeHtml(w)}</li>`).join('')
      : '<li class="sg-empty">热搜获取失败</li>';
    // 输入中 → 相关搜索
    if (kw) {
      clearTimeout(sgTimer);
      sgTimer = setTimeout(async () => {
        try {
          const r = await UzzApi.suggest(kw);
          const songs = r.songs || [];
          $('sgSongs').classList.toggle('hidden', !songs.length);
          $('sgSongList').innerHTML = songs.map((s) =>
            `<li data-kw="${escapeHtml(s.name + ' ' + s.artist)}"><span class="ic-note">♪</span><span>${escapeHtml(s.name)}</span><span class="sga">${escapeHtml(s.artist)}</span></li>`
          ).join('');
        } catch (e) { /* 建议失败不打扰 */ }
      }, 250);
      $('sgSongs').classList.remove('hidden');
    } else {
      clearTimeout(sgTimer);
      $('sgSongs').classList.add('hidden');
    }
  }
  function hideSuggest() { $('suggestBox').classList.add('hidden'); }

  /* ============================================================
   * 事件绑定
   * ============================================================ */
  function bind() {
    // ── 窗口控制 ──
    if (DESKTOP) {
      $('winMin').addEventListener('click', () => window.uzzBridge.minimize());
      $('winMax').addEventListener('click', () => window.uzzBridge.maximize());
      $('winClose').addEventListener('click', () => window.uzzBridge.close());
    } else {
      $('winMin').style.display = 'none';
      $('winMax').style.display = 'none';
      $('winClose').style.display = 'none';
    }

    // ── 后退（网易云式：仅一个返回键） ──
    $('navBack').addEventListener('click', goBack);
    updateNavBtns();

    // ── 侧栏导航（顶部主区 + 「我的」分组都走 data-view 委托） ──
    $('sideNav').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-view]');
      if (btn) showView(btn.dataset.view);
    });
    $('sideMine').addEventListener('click', (e) => {
      const t = e.target.closest('.side-toggle');
      if (t) {
        const expanded = $('sideMine').classList.toggle('expanded');
        $('sideMore').classList.toggle('hidden', expanded);
        $('sideLess').classList.toggle('hidden', !expanded);
        localStorage.setItem('uzz.side.mineExpanded', expanded ? '1' : '');
        return;
      }
      const btn = e.target.closest('button[data-view]');
      if (btn) showView(btn.dataset.view);
    });
    // 恢复「我的」分组展开状态
    if (localStorage.getItem('uzz.side.mineExpanded')) {
      $('sideMine').classList.add('expanded');
      $('sideMore').classList.add('hidden');
      $('sideLess').classList.remove('hidden');
    }
    // 我的收藏卡片 → 进入歌单详情
    $('collectGrid').addEventListener('click', (e) => {
      const c = e.target.closest('.pl-card');
      if (c && c.dataset.pl) openLocalPlaylist(c.dataset.pl);
    });
    // 漫游
    $('roamPlay').addEventListener('click', startRoam);
    document.addEventListener('uzz:view', (e) => { if (e.detail) showView(e.detail); });

    // ── 歌单导航（创建 + 收藏两个列表共用一套委托） ──
    $('playlistCreated').addEventListener('click', plNavClick);
    $('playlistCollected').addEventListener('click', plNavClick);
    function plNavClick(e) {
      const del = e.target.closest('.plc-del');
      if (del) {
        e.stopPropagation();
        const pl = playlists.find((p) => p.id === del.dataset.del);
        if (pl && confirm(`确定删除歌单「${pl.name}」？`)) {
          playlists = playlists.filter((p) => p.id !== del.dataset.del);
          savePlaylists();
          if (curPlaylist && curPlaylist.type === 'local' && curPlaylist.id === del.dataset.del) { curPlaylist = null; showView('discover'); }
        }
        return;
      }
      const li = e.target.closest('li[data-pl]');
      if (li) openLocalPlaylist(li.dataset.pl);
    }
    $('btnNewPlaylist').addEventListener('click', () => openPlModal());

    // ── 识别网易云 ID 选择性导入歌单 ──
    $('btnImportNcm').addEventListener('click', openImportModal);
    $('impClose').addEventListener('click', closeImportModal);
    $('impCancel').addEventListener('click', closeImportModal);
    $('impResolve').addEventListener('click', resolveNcm);
    $('impInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') resolveNcm(); });
    $('impPlatform').addEventListener('change', () => { $('impHint').textContent = IMP_PLATFORMS[impPlatform()].hint; });
    $('impSelectAll').addEventListener('click', () => impToggleAll(true));
    $('impSelectNone').addEventListener('click', () => impToggleAll(false));
    $('impFilter').addEventListener('input', (e) => renderImpList(e.target.value));
    $('impImport').addEventListener('click', doImportNcm);
    $('impList').addEventListener('change', (e) => {
      const cb = e.target.closest('input[type=checkbox]');
      if (!cb) return;
      const i = Number(cb.dataset.i);
      if (impState.tracks[i]) { impState.tracks[i].__sel = cb.checked; updateImpCount(); }
    });
    $('importModal').addEventListener('click', (e) => { if (e.target.id === 'importModal') closeImportModal(); });

    // ── 新建歌单弹窗 ──
    $('plModalOk').addEventListener('click', confirmPlModal);
    $('plModalCancel').addEventListener('click', () => $('plModal').classList.add('hidden'));
    $('plModal').addEventListener('click', (e) => { if (e.target.id === 'plModal') $('plModal').classList.add('hidden'); });
    $('plModalName').addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmPlModal(); });

    // ── 推荐页 ──
    $('bannerRow').addEventListener('click', (e) => {
      const b = e.target.closest('.banner');
      if (b) openToplist(b.dataset.top);
    });
    // 榜单精选（发现页横向卡片）
    $('chartsRow').addEventListener('click', (e) => {
      const c = e.target.closest('.chart-card');
      if (c) openOnlinePlaylist(c.dataset.id, { title: c.dataset.name });
    });
    $('plGrid').addEventListener('click', (e) => {
      const c = e.target.closest('.pl-card');
      if (c) openOnlinePlaylist(c.dataset.id);
    });
    const chartsGrid = $('chartsGrid');
    if (chartsGrid) chartsGrid.addEventListener('click', (e) => {
      const c = e.target.closest('.chart-card');
      if (c) openOnlinePlaylist(c.dataset.id, { title: c.dataset.name });
    });

    // ── 歌单详情 ──
    $('plpPlayAll').addEventListener('click', playAllInPlaylist);
    $('plpSave').addEventListener('click', saveOnlinePlaylist);
    $('plpDelete').addEventListener('click', deleteLocalPlaylist);
    bindListClick($('plpTracks'));

    // ── 搜索 ──
    $('searchGo').addEventListener('click', () => doSearch(true));
    $('searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(true); });
    $('searchInput').addEventListener('search', () => doSearch(true));
    $('searchInput').addEventListener('focus', showSuggest);
    $('searchInput').addEventListener('input', showSuggest);
    $('suggestBox').addEventListener('click', (e) => {
      const el = e.target.closest('[data-kw]');
      if (el) {
        $('searchInput').value = el.dataset.kw;
        doSearch(true);
      }
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search')) hideSuggest();
    });

    // ── 语音搜索（Web Speech API，不支持时降级提示） ──
    const btnVoice = $('btnVoice');
    if (btnVoice) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      let rec = null;
      btnVoice.addEventListener('click', () => {
        if (!SR) { toast('当前环境不支持语音识别'); return; }
        if (rec) { rec.stop(); rec = null; return; }
        try {
          rec = new SR();
        } catch (err) { toast('语音识别初始化失败'); return; }
        rec.lang = 'zh-CN';
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        btnVoice.classList.add('rec');
        toast('请说出要搜索的内容…');
        rec.onresult = (ev) => {
          const kw = ev.results[0][0].transcript.trim();
          if (kw) {
            $('searchInput').value = kw;
            doSearch(true);
          }
        };
        rec.onerror = () => { toast('未识别到内容，请再试一次'); };
        rec.onend = () => { btnVoice.classList.remove('rec'); rec = null; };
        rec.start();
      });
    }

    // ── 顶栏功能按钮：换肤 / Mini 模式 / 设置 ──
    const tbSkin = $('tbSkin');
    if (tbSkin) {
      tbSkin.addEventListener('click', () => {
        renderSkins();
        $('skinOverlay').classList.remove('hidden');
      });
    }
    const skinClose = $('skinClose');
    if (skinClose) skinClose.addEventListener('click', () => $('skinOverlay').classList.add('hidden'));
    const tbMini = $('tbMini');
    if (tbMini) {
      tbMini.addEventListener('click', () => {
        if (!window.uzzBridge || !window.uzzBridge.setMiniMode) { toast('Mini 模式仅桌面版可用'); return; }
        const on = !document.body.classList.contains('mini-mode');
        document.body.classList.toggle('mini-mode', on);
        tbMini.classList.toggle('on', on);
        const mm = $('miniMode');
        if (mm) mm.classList.toggle('hidden', !on);
        window.uzzBridge.setMiniMode(on);
        toast(on ? 'Mini 模式：点右上角 ✕ 可恢复' : '已恢复正常窗口');
      });
    }
    const tbSettings = $('tbSettings');
    if (tbSettings) tbSettings.addEventListener('click', () => showView('settings'));

    // 播放页右上角「播放器模式」：复用顶栏 Mini 开关（先收起播放页再进 Mini）
    const fpMini = $('fpMini');
    if (fpMini) {
      fpMini.addEventListener('click', () => {
        if (window.Player && Player.closeFull) Player.closeFull();
        const t = $('tbMini');
        if (t && !document.body.classList.contains('mini-mode')) t.click();
      });
    }

    // ── 点击 LOGO 回到发现音乐 ──
    const brandHome = $('brandHome');
    if (brandHome) brandHome.addEventListener('click', () => showView('discover'));

    bindMiniMode();
    bindLyricTools();
    bindFullTabs();
    bindSettingsExtra();
    bindShortcuts();

    // ── 播放栏「更多操作」三点菜单 ──
    const pbMore = $('pbMore');
    const pbMenu = $('pbMoreMenu');
    if (pbMore && pbMenu) {
      pbMore.addEventListener('click', (e) => {
        e.stopPropagation();
        pbMenu.classList.toggle('hidden');
      });
      pbMenu.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        pbMenu.classList.add('hidden');
        const act = btn.dataset.act;
        if (act === 'fx' || act === 'sleep') {
          const fx = $('fxPanel');
          if (fx) fx.classList.remove('hidden');
        } else if (act === 'speed') {
          const sb = $('pbSpeed');
          if (sb) sb.click();   // 直接弹出底部播放倍速菜单
        } else if (act === 'lyric') {
          const bl = $('btnLyric');
          if (bl) bl.click();
        } else if (act === 'download') {
          const fd = $('fpDownload');
          if (fd) fd.click();
        } else if (act === 'update') {
          // 打开 设置→系统 的软件更新区并自动检查
          showView('settings');
          const sysBtn = document.querySelector('#setTabs button[data-tab="system"]');
          if (sysBtn) sysBtn.click();
          const panel = document.querySelector('.settings-panel');
          if (panel) panel.scrollTop = 0;
          setTimeout(() => doUpdateCheck(false), 150);
        } else if (act === 'settings') {
          showView('settings');
        }
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#pbMoreMenu') && !e.target.closest('#pbMore')) pbMenu.classList.add('hidden');
      });
    }

    // ── 类型标签 ──
    $('tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      document.querySelectorAll('#tabs button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      curType = btn.dataset.type;
      if (curKeyword) doSearch(true);
    });

    // ── 列表点击 ──
    // 搜索结果列表：单曲行直接播放；歌手/专辑/歌单实体行进入对应歌曲列表
    $('resultList').addEventListener('click', (e) => {
      const li = e.target.closest('li.song');
      if (!li) return;
      if (li.dataset.etype) {
        const { etype, id, name, pic } = li.dataset;
        if (etype === 'artist') openArtistView(id, name, pic);
        else if (etype === 'album') openAlbumView(id, name);
        else if (etype === 'playlist') openOnlinePlaylist(id, { title: name });
        return;
      }
      const track = liTrack(li);
      if (e.target.closest('.act-dl')) { doDownload(track); return; }
      if (e.target.closest('.act-add')) { openAddMenu(e, track); return; }
      Player.loadAndPlay(track);
    });
    bindListClick($('favList'));
    bindHistoryTableClick($('historyList'));
    $('loadMore').addEventListener('click', () => { curPage += 1; doSearch(false); });

    // ── 本地音乐视图 ──
    if ($('btnScanFolder')) $('btnScanFolder').addEventListener('click', scanFolder);
    if ($('btnImportFiles')) $('btnImportFiles').addEventListener('click', importFiles);
    if ($('btnLocalDup')) $('btnLocalDup').addEventListener('click', showDuplicates);
    $('localTabs').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-f]');
      if (!btn) return;
      document.querySelectorAll('#localTabs button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      localCueContext = null;
      loadLocalView(btn.dataset.f, true);
    });
    $('localList').addEventListener('click', (e) => {
      const back = e.target.closest('#cueBack');
      if (back) { localCueContext = null; loadLocalView(curLocalFilter, true); return; }
      const li = e.target.closest('li.song');
      if (!li) return;
      const track = liTrack(li);
      if (li.dataset.cuestart != null) {
        track.url = '/api/local/stream?id=' + (li.dataset.audioid || track.id);
        track.cueStart = Number(li.dataset.cuestart) || 0;
        track.cueEnd = Number(li.dataset.cueend) || 0;
        track.resumeAt = 0;
      }
      if (e.target.closest('.act-cue')) { openCues(track); return; }
      if (e.target.closest('.act-rm')) {
        UzzApi.localRemove(track.id).then(() => { toast('已从媒体库移除'); loadLocalView(curLocalFilter, true); }).catch(() => toast('移除失败'));
        return;
      }
      if (e.target.closest('.act-add')) { openAddMenu(e, track); return; }
      Player.loadAndPlay(track);
    });
    // 分组展开（专辑/歌手/文件夹下的歌曲点开）
    $('localList').addEventListener('click', (e) => {
      const gh = e.target.closest('.lg-head');
      if (gh && gh.parentElement) {
        const lg = gh.parentElement;
        lg.classList.toggle('open');
      }
    });
    // 重复文件抽屉
    $('dupClose').addEventListener('click', () => $('dupDrawer').classList.add('hidden'));
    $('dupDrawer').addEventListener('click', (e) => { if (e.target.id === 'dupDrawer') $('dupDrawer').classList.add('hidden'); });
    $('dupList').addEventListener('click', (e) => {
      const del = e.target.closest('.dup-del');
      if (del) { UzzApi.localRemove(del.dataset.id).then(() => { toast('已移除'); showDuplicates(); }).catch(() => {}); }
    });

    // ── 音效 / 播放增强面板 ──
    bindFxPanel();

    // ── 底部播放条「收藏到歌单」图标 ──
    bindAddFavButton();

    // ── 全屏页：歌手 / 专辑 点击跳转 ──
    document.addEventListener('uzz:openArtist', (e) => {
      const d = e.detail || {};
      if (d.id) openArtistView(d.id, d.name, d.pic);
    });
    document.addEventListener('uzz:openAlbum', (e) => {
      const d = e.detail || {};
      if (d.id) openAlbumView(d.id, d.name);
    });

    // ── 下载管理 ──
    $('openDlDir').addEventListener('click', () => {
      if (DESKTOP) window.uzzBridge.openDownloadDir();
      else toast('网页版下载由浏览器管理');
    });

    // ── 设置：分类导航（点击切换 + 鼠标滚轮切换/滚动） ──
    const setNav = $('setTabs');
    const setTabsOrder = ['general', 'system', 'play', 'keys', 'download', 'desktop', 'about'];
    function gotoSetTab(tab) {
      if (!setTabsOrder.includes(tab)) return;
      setTabsOrder.forEach((t) => {
        const b = document.querySelector('#setTabs button[data-tab="' + t + '"]');
        if (b) b.classList.toggle('active', t === tab);
        const p = document.querySelector('.set-page[data-page="' + t + '"]');
        if (p) p.classList.toggle('hidden', t !== tab);
      });
      const sc = $('setScroll'); if (sc) sc.scrollTop = 0;
      localStorage.setItem('uzz.setTab', tab);
    }
    if (setNav) {
      setNav.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (btn) gotoSetTab(btn.dataset.tab);
      });
      // 滚轮：在导航条上滚动 → 横向滚动；按住导航区滚轮 → 直接切换分组
      let wheelLock = false;
      setNav.addEventListener('wheel', (e) => {
        // 横向滚动导航（分组多时不换页）
        if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          setNav.scrollLeft += (e.deltaX || e.deltaY);
          return;
        }
        if (setNav.scrollWidth > setNav.clientWidth + 4) {
          // 能横向滚动时优先滚动导航条，滚到端点再切分组
          const before = setNav.scrollLeft;
          setNav.scrollLeft += e.deltaY;
          if (setNav.scrollLeft !== before) return;
        }
        if (wheelLock) return;
        wheelLock = true;
        setTimeout(() => { wheelLock = false; }, 260);
        const cur = document.querySelector('#setTabs button.active');
        const i = setTabsOrder.indexOf(cur ? cur.dataset.tab : 'general');
        const dir = e.deltaY > 0 ? 1 : -1;
        const next = setTabsOrder[Math.max(0, Math.min(setTabsOrder.length - 1, i + dir))];
        if (next) gotoSetTab(next);
      }, { passive: true });
      const saved = localStorage.getItem('uzz.setTab');
      if (saved) gotoSetTab(saved);
    }

    // 注：「导出收藏 / 清空数据」已迁移到「关于小杨音乐」页（#abExportFav / #abClearData），此处不再绑定。
  }

  /* ============================================================
   * 入口
   * ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    if(localStorage.getItem('xy.design.v3')!=='1') {
      localStorage.setItem('uzz.theme.skin',''); localStorage.removeItem('uzz.theme.accent'); localStorage.setItem('xy.design.v3','1');
    }
    document.addEventListener('xy:libraryRestore',()=>{playlists=loadJSON('uzz.playlists',[]);Player.reloadLibrary();renderPlaylistNav();renderLibrary();applyTheme();});
    applyTheme();
    Player.init();
    bind();
    bindThemeSettings();
    renderSkins();
    renderPlaylistNav();
    loadRecommend();
    loadDiscoverCharts();
    // 每日推荐 banner 显示当日日期（网易云式 17 / 10）
    {
      const { m, day } = dailyDate();
      const dd = $('bnDailyDay'), dm = $('bnDailyMon');
      if (dd) dd.textContent = day;
      if (dm) dm.textContent = '/ ' + m;
    }
    showView('discover');
    showResumeBar();   // 上回记忆播放提示
    ensureHotWords(); // 预取热搜词
    // 启动自动检查更新（桌面版 + 用户未关闭 + 配置了更新源时才真正联网）
    if (DESKTOP && localStorage.getItem('uzz.sys.autoUpdate') !== '0') {
      setTimeout(() => doUpdateCheck(true), 4000);
    }
    const base = localStorage.getItem('uzz.apiBase');
    if (base) {
      UzzApi.ping().then((ok) => { if (!ok) toast('后端地址不可达，请到「设置」检查'); });
    } else if (location.protocol === 'file:') {
      toast('提示：请先在「设置」配置后端 API 地址');
    }
  });
})();
