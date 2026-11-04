/* ============================================================
 * player.js — 播放器核心引擎 + UI 联动
 * 负责：音频播放、播放队列、播放模式、歌词、收藏/历史、迷你栏与全屏页
 * ============================================================ */
(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const audio = global.XYAudio || $('audio');
  let headless = false;
  const emit = kind => document.dispatchEvent(new CustomEvent('xy:player', { detail: { kind } }));

  const STATE = {
    queue: [],          // [{id,name,artist,album,pic,vendor,url,lyric,duration}]
    index: -1,
    mode: 'list',       // list | single | random | sequential
    lyrics: [],         // [{t, text}]
    tlyrics: [],        // 翻译歌词 [{t, text}]（翻译开关）
    current: null,
    pendingSeek: 0,     // 本地断点续听 / CUE 起始
    cueEnd: 0,          // 本地 CUE 结束秒
    lastProg: 0,        // 上次上报进度时间
    lastSrcSet: 0,       // 最近一次设置 audio.src 的时间戳，用于忽略换源瞬间的临时 pause
    // ── 播放请求序号（关键）：每次切歌自增。异步流程里每一步 await 之后都校验，
    //    一旦期间用户又点了别的歌，本次流程立即静默退出，
    //    杜绝「慢请求后到覆盖新歌」「连续跳回之前点的歌」这类竞态。
    playSeq: 0,
    failSeq: 0,          // 记录最近一次播放失败的序号，避免旧歌的失败提示串台
  };
  // 取当前播放令牌；每次切歌自增
  let playbackRequest = new AbortController();
  function bumpPlaySeq() {
    playbackRequest.abort(); playbackRequest = new AbortController();
    STATE.playSeq++; return STATE.playSeq;
  }
  function resetPlayback() {
    bumpPlaySeq();
    try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (e) {}
    STATE.pendingSeek = 0; STATE.cueEnd = 0; STATE.lastProg = 0;
    STATE.lyrics = []; STATE.tlyrics = [];
    setPlayIcon(false); renderLyric(); pushLyric(-1);
  }
  // 校验令牌是否仍是最新（false = 已被更新的点击取代，本次流程必须退出）
  function seqAlive(seq) { return seq === STATE.playSeq; }
  function enqueueTrack(track) {
    if (!track?.id) return;
    if (!STATE.queue.some(q => q.id === track.id && q.vendor === track.vendor)) STATE.queue.push(track);
    renderQueue();
  }
  function notifyTrackChanged() {
    document.dispatchEvent(new CustomEvent('xy:trackChanged'));
  }
  function clearQueue() {
    resetPlayback(); STATE.loading = false;
    STATE.queue = []; STATE.index = -1; STATE.current = null;
    notifyTrackChanged();
    renderQueue();
  }
  function playQueue(tracks, index = 0) {
    clearQueue();
    const seen = new Set();
    STATE.queue = (tracks || []).filter(t => { const key = t.vendor + '|' + t.id; if (!t.id || seen.has(key)) return false; seen.add(key); return true; });
    if (STATE.queue.length) return loadAndPlay(STATE.queue[Math.min(index, STATE.queue.length - 1)]);
  }
  const MODE_TEXT = { list: '列表循环', single: '单曲循环', random: '随机播放', sequential: '顺序播放' };
  // 各播放模式 SVG 图标（描边风，随按钮颜色）
  const MODE_SVG = {
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
    single: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><text x="9.2" y="15.4" font-size="9" font-weight="700" fill="currentColor" stroke="none" font-family="inherit">1</text></svg>',
    random: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>',
    sequential: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15"/><path d="M13 6l6 6-6 6"/></svg>',
  };
  const VOL_SVG_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9.5 9.5 0 0 1 0 13"/></svg>';
  // 低档（1-33）：只一 Soundwave；中档（34-66）：两弧；高档（67+）：两弧 + 外弧
  const VOL_SVG_LOW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>';
  const VOL_SVG_MID = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9.5 9.5 0 0 1 0 13"/></svg>';
  const VOL_SVG_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none"/><path d="M22 9l-6 6"/><path d="M16 9l6 6"/></svg>';
  // 播放控制 SVG 图标（与整体描边/填充风格统一）
  const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  const PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  const QUALITY_LABEL = { standard: '标准', ex: '极高', lossless: '无损', hires: 'Hi-Res' };

  /* ---------- 持久化 ---------- */
  function loadJSON(key, def) {
    try { return JSON.parse(localStorage.getItem(key)) || def; } catch (e) { return def; }
  }
  function saveJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  let favorites = loadJSON('uzz.fav', []);
  let history = loadJSON('uzz.history', []);
  /* ---------- 上回记忆播放 ----------
     记下退出时正在听的歌与播放进度，下次启动可一键接着听。
     注意：只记「听到一定程度」的（>5s且不超过结尾5s），避免误记刚点开就退出的歌。 */
  const RESUME_KEY = 'uzz.resume';
  function saveResume() {
    try {
      // 「记住上次播放进度」关闭时不再写入
      if (localStorage.getItem('uzz.play.resume') === '0') { localStorage.removeItem(RESUME_KEY); return; }
      const t = STATE.current;
      if (!t || !t.id) { localStorage.removeItem(RESUME_KEY); return; }
      const c = audio.currentTime || 0;
      const d = audio.duration || t.duration || 0;
      // 开头 5 秒内或已接近结尾的不记录（从头听更自然）
      if (c < 5 || (d && c > d - 8)) { localStorage.removeItem(RESUME_KEY); return; }
      localStorage.setItem(RESUME_KEY, JSON.stringify({
        id: t.id, name: t.name || '', artist: t.artist || '', album: t.album || '',
        pic: t.pic || '', vendor: t.vendor || 'netease', quality: t.quality || '',
        time: Math.floor(c), duration: Math.floor(d || 0), url: t.url || '',
        at: Date.now(),
      }));
    } catch (e) { /* 忽略 */ }
  }
  function getResume() {
    try {
      const r = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null');
      // 只保留 7 天内的记录，过期就没必要提示了
      if (r && r.id && Date.now() - (r.at || 0) < 7 * 24 * 3600e3) return r;
      return null;
    } catch (e) { return null; }
  }
  function clearResume() { try { localStorage.removeItem(RESUME_KEY); } catch (e) { /* 忽略 */ } }
  // 恢复：载入该歌并跳到上次进度（不自动播放，等用户点）
  async function resumeFrom(r) {
    if (!r || !r.id) return;
    try {
      clearResume();
      await loadAndPlay({ ...r, resumeAt: r.time });
      if (r.time > 5) {
        // 等元数据就绪后再跳转，避免 duration 未定导致 seek 无效
        const seek = () => {
          try { if (isFinite(audio.duration) && audio.duration > 0) { audio.currentTime = Math.min(r.time, audio.duration - 3); } }
          catch (e) { /* 忽略 */ }
        };
        if (audio.readyState >= 1) seek();
        else audio.addEventListener('loadedmetadata', seek, { once: true });
        try { audio.pause(); } catch (e) { /* 忽略 */ }
        setPlayIcon(false);
      }
    } catch (e) { /* 恢复失败静默 */ }
  }
  // 页面退出/关闭前记录
  function bindResumeSave() {
    // 每 5 秒存一次（避免频繁写盘），并在暂停/切换/卸载时补一次
    setInterval(saveResume, 5000);
    window.addEventListener('beforeunload', saveResume);
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveResume(); });
    audio.addEventListener('pause', saveResume);
    audio.addEventListener('ended', clearResume);
  }

  function isFav(id) { return favorites.some((t) => t.id === id && t.vendor === STATE.current?.vendor); }

  /* ---------- 工具 ---------- */
  function fmt(sec) {
    sec = Math.floor(sec || 0);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  /* ---------- 进度条：悬停气泡（当前 / 总时长）+ 拇指跟随 ---------- */
  // ratio: 0~1；null 表示按当前播放进度显示
  function updateSeekTip(ratio) {
    const tip = $('seekTip');
    if (!tip) return;
    const d = audio.duration || 0;
    const r = ratio == null ? (d ? (audio.currentTime || 0) / d : 0) : ratio;
    $('seekTipCur').textContent = fmt(d ? r * d : 0);
    $('seekTipDur').textContent = fmt(d);
    // 气泡横向跟随拇指（限制在容器内，避免贴边被裁）
    const wrap = tip.parentElement;
    const w = wrap.clientWidth || 1;
    const x = Math.max(34, Math.min(w - 34, r * w));
    tip.style.left = x + 'px';
  }
  function bindSeekTip() {
    const wrap = document.querySelector('.seek-wrap');
    const seek = $('seek');
    const tip = $('seekTip');
    if (!wrap || !seek || !tip) return;
    let dragging = false;
    const show = () => { tip.classList.remove('hidden'); updateSeekTip(); };
    const hide = () => { if (!dragging) tip.classList.add('hidden'); };
    wrap.addEventListener('mouseenter', show);
    wrap.addEventListener('mouseleave', () => { if (!dragging) tip.classList.add('hidden'); });
    // 鼠标在轨道上移动时气泡跟随
    wrap.addEventListener('mousemove', (e) => {
      const r = seek.getBoundingClientRect();
      if (!r.width) return;
      updateSeekTip(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
    });
    // 拖动中始终显示
    seek.addEventListener('pointerdown', () => { dragging = true; wrap.classList.add('dragging'); tip.classList.remove('hidden'); });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      wrap.classList.remove('dragging');
      tip.classList.add('hidden');
    };
    window.addEventListener('pointerup', endDrag);
  }
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 1800);
  }
  function picUrl(t) {
    if (t.pic) return UzzApi.picProxy ? UzzApi.picProxy(t.pic) : t.pic;
    return '';
  }

  // 跨域音频直链 → 同源流代理。
  // 关键：EQ 启用后 audio 走 Web Audio 图（createMediaElementSource），
  // 跨域资源会被 CORS 污染输出纯静音（进度照走但无声）。转同源即可正常出声。
  function sameOriginStream(url) {
    if (!url) return url;
    if (url.startsWith('/api/')) return UzzApi.getApiBase() + url;
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    if (!/^https?:\/\//i.test(url)) return url;
    try {
      if (new URL(url, location.origin).origin === location.origin) return url;
    } catch (e) { return url; }
    return UzzApi.getApiBase() + '/api/stream?url=' + encodeURIComponent(url);
  }

  /* ---------- 桌面歌词 ---------- */
  function dlEnabled() {
    return localStorage.getItem('uzz.dl.enabled') === '1' && window.uzzBridge;
  }
  function pushLyric(idx) {
    if (!window.uzzBridge) return;
    const cur = STATE.lyrics[idx] ? STATE.lyrics[idx].text : '';
    const next = STATE.lyrics[idx + 1] ? STATE.lyrics[idx + 1].text : '';
    // 翻译行（桌面歌词双行用）：开翻译且有译文时取当前句译文
    let trans = '';
    if (transOn() && STATE.lyrics[idx] && STATE.tlyrics && STATE.tlyrics.length) {
      trans = findTrans(STATE.lyrics[idx].t);
    }
    const audio = document.getElementById('audio');
    window.uzzBridge.sendLyric({ cur, next, trans, playing: !!(audio && !audio.paused && audio.src) });
  }
  // 把设置页的桌面歌词样式推给歌词窗
  function pushLyricStyle() {
    if (!window.uzzBridge) return;
    const color = localStorage.getItem('uzz.dl.color') || 'gradient';
    const colors = { green: '#1ecd8a', pink: '#ff8fc7', gold: '#ffc861', blue: '#7ab6ff' };
    window.uzzBridge.setLyricStyle({
      font: localStorage.getItem('uzz.dl.font') || 'Microsoft YaHei',
      size: parseInt(localStorage.getItem('uzz.dl.size') || '30', 10),
      weight: localStorage.getItem('uzz.dl.weight') || 'bold',
      stroke: localStorage.getItem('uzz.dl.stroke') !== '0',
      layout: localStorage.getItem('uzz.dl.layout') || 'double',
      align: localStorage.getItem('uzz.dl.align') || 'center',
      gradient: color === 'gradient',
      played: colors[color] || localStorage.getItem('uzz.dl.played') || '#1ecd8a',
      unplayed: localStorage.getItem('uzz.dl.unplayed') || '#8a93a6',
      topmost: localStorage.getItem('uzz.dl.topmost') !== '0',
      trans: localStorage.getItem('uzz.dl.trans') !== '0',
    });
  }
  function syncLyricBtn() {
    const b = $('btnLyric');
    const enabled = localStorage.getItem('uzz.dl.enabled') === '1';
    if (b) b.classList.toggle('on', enabled);
    for (const id of ['stLyricEnable', 'stDLyric']) { const el = $(id); if (el) el.checked = enabled; }
  }
  // 播放/暂停时同步桌面歌词工具条图标（暂停时 timeupdate 不触发，需主动推一次）
  function syncDlPlayState(playing) {
    if (!window.uzzBridge) return;
    const idx = STATE.lyrics.length ? -2 : -1; // -2=仅刷新播放态，不动歌词内容
    if (idx === -1) { pushLyric(-1); return; }
    const audio = document.getElementById('audio');
    window.uzzBridge.sendLyric({ playing: !!playing, keep: true, cur: '', next: '', trans: '' });
  }

  /* ---------- 歌词 ---------- */
  function parseLrc(text) {
    if (!text) return [];
    const lines = text.split('\n');
    const out = [];
    const re = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    lines.forEach((line) => {
      const times = [];
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(line))) {
        const mm = parseInt(m[1], 10);
        const ss = parseInt(m[2], 10);
        const xx = parseInt((m[3] || '0').padEnd(3, '0').slice(0, 3), 10);
        times.push(mm * 60 + ss + xx / 1000);
      }
      const content = line.replace(re, '').trim();
      if (content) times.forEach((t) => out.push({ t, text: content }));
    });
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  // 歌词微调偏移（秒）：工具栏 ±0.5s 用；正数 = 歌词延后显示
  function lyricOffset() { return Number(localStorage.getItem('uzz.lyricOffset') || 0); }
  function setLyricOffset(v) {
    v = Math.max(-10, Math.min(10, Math.round(v * 2) / 2));
    localStorage.setItem('uzz.lyricOffset', String(v));
    const audio = document.getElementById('audio');
    syncLyric(audio ? audio.currentTime : 0);
    return v;
  }
  // 翻译显示开关
  function transOn() { return localStorage.getItem('uzz.lyricTrans') === '1'; }

  function renderLyric() {
    if (headless) { emit('lyrics'); return; }
    const box = $('fpLyric');
    if (!STATE.lyrics.length) {
      box.innerHTML = '<p class="lr-empty">暂无歌词</p>';
      return;
    }
    box.style.fontSize = (localStorage.getItem('uzz.fpLyricSize') || 24) + 'px';
    const useTrans = transOn() && STATE.tlyrics && STATE.tlyrics.length;
    box.innerHTML = STATE.lyrics.map((l, i) => {
      let html = l.text;
      if (useTrans) {
        const tr = findTrans(l.t);
        if (tr) html += `<span class="ly-tr">${tr}</span>`;
      }
      // 每行带 data-t（秒）供「点行跳到该段播放」使用；右侧为行内播放按钮
      return `<p data-i="${i}" data-t="${l.t}" title="点击从这句开始播放">`
        + `<span class="lr-play" data-goto="${l.t}" title="从这里播放">▶</span>`
        + `<span class="lr-txt">${html}</span></p>`;
    }).join('');
  }
  // 点击歌词行/播放按钮 → 跳到该时间点播放
  function bindLyricGoto() {
    const box = $('fpLyric');
    if (!box || box.dataset.gotoBound) return;
    box.dataset.gotoBound = '1';
    box.addEventListener('click', (e) => {
      const t = e.target.closest('[data-goto]') || e.target.closest('p[data-t]');
      if (!t) return;
      const sec = parseFloat(t.getAttribute('data-goto') || t.getAttribute('data-t'));
      if (!isFinite(sec)) return;
      try {
        if (audio.readyState < 1) audio.currentTime = sec;   // 元数据未就绪时先记，loadedmetadata 后再设
        else { audio.currentTime = sec; if (audio.paused) audio.play().catch(() => {}); }
        if (audio.readyState < 1) {
          audio.addEventListener('loadedmetadata', () => {
            try { audio.currentTime = sec; audio.play(); } catch (e) { /* 忽略 */ }
            setPlayIcon(true);
          }, { once: true });
        }
      } catch (e) { /* 忽略 */ }
    });
  }
  function findTrans(t) {
    if (!STATE.tlyrics || !STATE.tlyrics.length) return '';
    let best = '', diff = 99;
    for (const l of STATE.tlyrics) {
      const d = Math.abs(l.t - t);
      if (d < diff) { diff = d; best = l.text; }
    }
    return diff <= 1.2 ? best : '';
  }

  function syncLyric(time) {
    if (!STATE.lyrics.length) { pushLyric(-1); return; }
    time = time - lyricOffset(); // 偏移：正数让歌词延后出现
    let idx = -1;
    for (let i = 0; i < STATE.lyrics.length; i++) {
      if (STATE.lyrics[i].t <= time + 0.15) idx = i; else break;
    }
    pushLyric(idx);
    const box = $('fpLyric');
    if (!box) return;
    if (idx < 0) return;
    const ps = box.querySelectorAll('p');
    if (ps.length <= idx) return;
    ps.forEach((p) => p.classList.remove('active'));
    const cur = ps[idx];
    cur.classList.add('active');
    // 居中滚动
    box.scrollTop = cur.offsetTop - box.clientHeight / 2 + cur.clientHeight / 2;
  }

  /* ---------- 渲染迷你栏 / 全屏 ---------- */
  function renderNowPlaying() {
    const t = STATE.current;
    if (!t) return;
    if (headless) { syncFavBtn(); notifyTrackChanged(); emit('track'); return; }
    // SMTC：把当前播放信息同步给 Windows 媒体控制中心（设置里开启后生效）
    try {
      if (localStorage.getItem('uzz.smtc') === '1' && navigator.mediaSession) {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: t.name || '',
          artist: t.artist || '',
          album: t.album || '',
          artwork: t.pic ? [{ src: t.pic, sizes: '256x256', type: 'image/jpeg' }] : [],
        });
      }
    } catch (e) { /* SMTC 不可用则忽略 */ }
    $('miniTitle').textContent = t.name;
    $('miniArtist').textContent = t.artist;
    $('fpSong').textContent = t.name;
    const fpbSong = $('fpbSong');
    if (fpbSong) fpbSong.textContent = t.name;
    const fpbArtist = $('fpbArtist');
    if (fpbArtist) fpbArtist.textContent = t.artist || '';
    $('fpArtist').textContent = t.artist;
    const artistEl = $('fpArtist');
    if (artistEl) {
      artistEl.dataset.id = t.artistId || '';
      artistEl.classList.toggle('fp-link', !!t.artistId);
    }
    const cover = picUrl(t);
    if (cover) {
      $('miniCover').src = cover;
      $('fpCover').src = cover;
      $('fpBg').style.backgroundImage = `url("${cover}")`;
      const viz = $('fpViz');
      if (viz) resizeVinylViz();
    }
    const albumEl = $('fpAlbum');
    if (albumEl) {
      albumEl.textContent = t.album || '未知专辑';
      albumEl.dataset.id = t.albumId || '';
      albumEl.classList.toggle('fp-link', !!t.albumId);
    }
    const vendorEl = $('fpVendor');
    if (vendorEl) {
      const vn = { netease: '网易云', tencent: 'QQ 音乐', kugou: '酷狗', kuwo: '酷我' }[t.vendor] || t.vendor || '—';
      vendorEl.textContent = vn;
    }
    $('miniPlayer').classList.remove('hidden');
    syncFavBtn();
    notifyTrackChanged();
  }

  function syncFavBtn() {
    if (headless) { emit('favorites'); return; }
    const t = STATE.current;
    const on = !!(t && favorites.some((f) => f.id === t.id && f.vendor === t.vendor));
    const btn = $('fpFav');
    if (btn) {
      // 用 class 控制填充态（SVG 空心/实心），比替换♡♥ 字符更醒目
      btn.classList.toggle('on', on);
      btn.classList.toggle('fav-hit', on);
      btn.title = on ? '已收藏，点击取消' : '收藏这首歌';
    }
    const fpb = $('fpbFav');
    if (fpb) {
      fpb.classList.toggle('on', on);
      fpb.title = on ? '已收藏，点击取消' : '收藏这首歌';
    }
  }

  function setPlayIcon(playing) {
    if (headless) { document.body.classList.toggle('is-playing', !!playing); emit('play'); return; }
    const mp = $('miniPlay');
    if (mp) mp.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
    $('fpPlay').innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
    const fpbPlay = $('fpbPlay');
    if (fpbPlay) fpbPlay.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
    const mmPlay = $('mmPlay');
    if (mmPlay) mmPlay.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
    // 全局播放状态：播放栏封面 / mini 封面旋转（#9 播放时转动、暂停停止）
    document.body.classList.toggle('is-playing', !!playing);
    // 黑胶唱片 / 唱针联动
    const vinyl = $('vinylDisc');
    if (vinyl) vinyl.classList.toggle('playing', playing);
    const arm = $('tonearm');
    if (arm) arm.classList.toggle('playing', playing);
  }

  // 黑名单判定：歌名/歌手/专辑 任一命中关键词即算被屏蔽
  function isBlocked(track) {
    let list = window.__uzzBlacklist;
    if (!list) {
      try { list = JSON.parse(localStorage.getItem('uzz.play.blacklist') || '[]'); }
      catch (e) { list = []; }
      window.__uzzBlacklist = list;
    }
    const keys = (Array.isArray(list) ? list : []).filter(Boolean).map((x) => String(x).toLowerCase());
    if (!keys.length || !track) return false;
    const hay = ((track.name || '') + ' ' + (track.artist || '') + ' ' + (track.album || '')).toLowerCase();
    return keys.some((k) => hay.indexOf(k) >= 0);
  }

  // 把设置页里的音频选项真正应用到 Web Audio 图
  // 音频图是「播放时才创建」的，所以每次创建后都必须按设置应用一次，
  // 否则改完设置当下不生效 —— 表现就是"设了没用"
  function applyAudioSettings() {
    if (!window.Eq) return;
    try {
      const fadeOn = localStorage.getItem('uzz.play.fade') !== '0';
      window.Eq.setFade(fadeOn ? 800 : 0);
      const normOn = localStorage.getItem('uzz.play.normalize') === '1';
      window.Eq.setNormalize(normOn);
      if (normOn) window.Eq.setNormalizeStrength(localStorage.getItem('uzz.play.normStrength') || '50');
      const spatOn = localStorage.getItem('uzz.play.spatialize') === '1';
      window.Eq.setSpatial(spatOn, localStorage.getItem('uzz.play.spatSize') || '35');
      const outDev = localStorage.getItem('uzz.play.output') || '';
      if (outDev && audio.setSinkId) audio.setSinkId(outDev).catch(() => {});
    } catch (e) { /* 音频设置异常不应影响播放 */ }
  }

  /* ---------- 加载并播放 ----------
   * 竞态防护：进入即领一个令牌 seq。此后每个 await 之后都校验 seqAlive(seq)，
   * 用户中途点了别的歌 → seq 失效 → 本流程立即静默退出，不碰 audio/STATE。
   * 这是「点A慢 → 点B → 又跳回A，每次只播一小段」这类怪象的根治点。 */
  async function loadAndPlay(track, opts) {
    opts = opts || {};
    if (!track || !track.id) return;
    if (opts.quiet) {
      enqueueTrack(track);
      return;
    }
    // 黑名单过滤（设置 → 播放 → 黑名单）：命中歌名/歌手/专辑关键词直接跳过
    if (isBlocked(track)) {
      toast('已在黑名单中跳过：' + (track.name || '该歌曲'));
      // 自动跳到队列中下一首未屏蔽的，避免用户以为点了没反应
      const alt = STATE.queue.find((q) => !isBlocked(q));
      if (alt && STATE.queue.length > 1) {
        const t = alt;
        setTimeout(() => loadAndPlay(t), 30);
      }
      return;
    }

    // 本地音乐：独立播放链路（不走在线解析接口）
    if (track.vendor === 'local') return loadLocal(track, opts);

    // 连点同一首歌：正在播放就续播，正在解析就等它完成，都不重复发起解析请求
    if (STATE.current && STATE.current.id === track.id && STATE.current.vendor === track.vendor) {
      STATE.index = STATE.queue.findIndex(q => q.id === track.id && q.vendor === track.vendor);
      renderQueue();
      const hasSrc = !!audio.src && audio.src !== 'about:blank';
      if (hasSrc) {                       // 已有可播地址 → 续播即可
        try { await audio.play(); setPlayIcon(true); } catch (e) { /* 自动播放被拦，等用户手动 */ }
        return;
      }
      if (STATE.current.url) {            // 有缓存地址但 src 被清 → 重新挂上
        audio.src = sameOriginStream(STATE.current.url);
        STATE.lastSrcSet = Date.now();
        try { await audio.play(); setPlayIcon(true); } catch (e) { /* 同上 */ }
        return;
      }
      if (STATE.loading) return;
    }

    resetPlayback();
    const seq = STATE.playSeq;
    const signal = playbackRequest.signal;
    STATE.loading = true;

    // 加入队列
    let qi = STATE.queue.findIndex((q) => q.id === track.id && q.vendor === track.vendor);
    if (qi === -1) {
      STATE.queue.push(track);
      qi = STATE.queue.length - 1;
    }
    STATE.index = qi;
    STATE.current = STATE.queue[qi];

    renderNowPlaying();
    renderQueue();
    // 立即给出可见反馈（歌名与播放条已切过去），避免网络慢时看起来"点了没反应"
    toast('正在解析播放地址…');

    if (window.Eq) {
      window.Eq.init(audio); window.Eq.resume(); window.Eq.setRG(0);
      applyAudioSettings();
    }

    // 获取完整信息（url / lyric）— 传完整 track 以启用多音源兜底
    let full = STATE.current;
    try {
      full = (track.vendor === 'cloud' && /^https?:\/\//i.test(track.url || '')) || (track.vendor === 'device' && audio.nativeQueue && /^content:\/\//i.test(track.url || ''))
        ? track : await UzzApi.getSong(track, undefined, signal);
      if (!seqAlive(seq)) return;   // 已被新的点击取代 → 丢弃本次结果
      const keep = { name: STATE.current.name, artist: STATE.current.artist, album: STATE.current.album, pic: STATE.current.pic };
      // 兜底来源只描述音频地址，不能改写原歌曲 ID 所属平台。
      Object.assign(STATE.current, full, { id: track.id, vendor: track.vendor, playbackVendor: full.vendor });
      ['name', 'artist', 'album', 'pic'].forEach((k) => {
        const v = STATE.current[k];
        if (!v || v === '未知') STATE.current[k] = keep[k] || '';
      });
      renderNowPlaying();
    } catch (e) {
      if (!seqAlive(seq)) return;   // 旧请求的失败不再提示、不改状态
      if (!STATE.current.url) {
        STATE.failSeq = seq;
        STATE.loading = false;
        toast('获取播放地址失败：' + (e.message || e));
        setPlayIcon(false);
        return;
      }
    }

    // 歌词（含翻译，供「翻译歌词」开关使用）
    let lyric = STATE.current.lyric || '';
    let tlyric = '';
    if (!lyric && track.vendor !== 'device') {
      try {
        if (UzzApi.getLyricEx) {
          const lf = await UzzApi.getLyricEx(track.id, track.vendor, signal);
          lyric = lf.lyric; tlyric = lf.tlyric || '';
        } else {
          lyric = await UzzApi.getLyric(track.id, track.vendor, signal);
        }
      } catch (e) { /* 歌词失败不阻塞播放 */ }
      if (!seqAlive(seq)) return;   // 歌词期间用户又点了别的歌
      STATE.current.lyric = lyric;
    } else if (track.vendor !== 'device' && UzzApi.getLyricEx) {
      UzzApi.getLyricEx(track.id, track.vendor, signal).then((f) => {
        // 令牌校验：防止旧歌的翻译歌词串到新歌上
        if (seqAlive(seq) && STATE.current && STATE.current.id === track.id) {
          STATE.tlyrics = parseLrc(f.tlyric || '');
          if (transOn()) renderLyric();
        }
      }).catch(() => {});
    }
    if (!seqAlive(seq)) return;
    STATE.tlyrics = tlyric ? parseLrc(tlyric) : [];
    STATE.lyrics = parseLrc(lyric);
    renderLyric();

    // 播放地址（主音源无地址时再走一次兜底）
    let url = STATE.current.url;
    let resolveTimeout = false;
    if (!url) {
      try {
        url = await UzzApi.getUrl(track, undefined, signal);
        resolveTimeout = !!(url && url.resolveTimeout);
        if (resolveTimeout) url = '';
      } catch (e) {
        if (!seqAlive(seq)) return;
        STATE.failSeq = seq;
        STATE.loading = false;
        toast('获取播放地址失败：' + (e.message || e));
        setPlayIcon(false);
        return;
      }
    }
    if (!seqAlive(seq)) return;   // ← 关键守卫：绝不把旧歌的地址写进 audio.src
    STATE.loading = false;
    if (!url) {
      STATE.failSeq = seq;
      setPlayIcon(false);
      toast(resolveTimeout || STATE.current.resolveTimeout
        ? '网络较慢，解析超时。可点「重试」或换一个音源'
        : '该音源暂无可播放地址，可换一个音源试试');
      return;
    }

    STATE.current.url = url; // 包括 getUrl() 兜底解析成功后的地址。
    notifyTrackChanged();
    audio.src = sameOriginStream(url);
    STATE.lastSrcSet = Date.now();
    try {
      await audio.play();
      if (!seqAlive(seq)) return;
      setPlayIcon(true);
      toast('');
    } catch (e) {
      if (!seqAlive(seq)) return;   // 已被新歌接管，静默退出
      setPlayIcon(false);
      toast('自动播放被拦截，点一下播放键');
    }
    if (!seqAlive(seq)) return;

    // 历史
    history = history.filter((h) => !(h.id === track.id && h.vendor === track.vendor));
    history.unshift({ id: track.id, name: track.name, artist: track.artist, album: track.album, pic: track.pic, vendor: track.vendor, at: Date.now() });
    if (history.length > 200) history = history.slice(0, 200);
    saveJSON('uzz.history', history);
  }

  /* ---------- 本地音乐播放链路 ---------- */
  async function loadLocal(track) {
    resetPlayback();
    STATE.loading = false;
    const seq = STATE.playSeq;
    const signal = playbackRequest.signal;
    const audioId = track.audioId || String(track.id).split('#')[0];
    track.url = track.url || '/api/local/stream?id=' + encodeURIComponent(audioId);
    // 加入队列（本地以 path 作为唯一键，避免同曲重复）
    const key = track.id || track.path;
    let qi = STATE.queue.findIndex((q) => (q.id === track.id) && q.vendor === 'local');
    if (qi === -1) {
      STATE.queue.push(track);
      qi = STATE.queue.length - 1;
    }
    STATE.index = qi;
    STATE.current = STATE.queue[qi];

    renderNowPlaying();
    renderQueue();
    toast('加载中…');

    if (window.Eq) {
      window.Eq.init(audio); window.Eq.resume(); window.Eq.setRG(track.replayGain || 0);
      applyAudioSettings();
    }

    // CUE / 断点
    STATE.pendingSeek = track.cueStart || (track.resumeAt > 3 ? track.resumeAt : 0);
    STATE.cueEnd = track.cueEnd || 0;

    // 歌词（同名词 LRC）
    try {
      const { lyric } = await UzzApi.localLyric(audioId, signal);
      if (!seqAlive(seq)) return;   // 期间用户又点了别的歌
      STATE.lyrics = parseLrc(lyric);
      renderLyric();
    } catch (e) { /* 歌词失败不阻塞播放 */ }
    if (!seqAlive(seq)) return;

    audio.src = sameOriginStream(track.url);
    STATE.lastSrcSet = Date.now();
    try {
      await audio.play();
      if (!seqAlive(seq)) return;
      setPlayIcon(true);
      toast('');
    } catch (e) {
      if (!seqAlive(seq)) return;
      setPlayIcon(false);
      toast(e.name === 'NotSupportedError' ? '此文件编码暂无法解码，可先转换为 FLAC / WAV / MP3' : '自动播放被拦截，点一下播放键');
    }
    if (!seqAlive(seq)) return;

    // 历史
    history = history.filter((h) => !(h.id === track.id && h.vendor === 'local'));
    history.unshift({ ...track, vendor: 'local', at: Date.now() });
    if (history.length > 200) history = history.slice(0, 200);
    saveJSON('uzz.history', history);
  }

  // 播放/暂停：没有当前歌曲时给出提示，避免"点了没反应"
  function toggle() {
    if (!STATE.current) { toast('还没有播放内容，先去选一首歌'); return; }
    if (audio.paused) audio.play().then(() => setPlayIcon(true)).catch(() => {});
    else { audio.pause(); setPlayIcon(false); }
  }

  function next(auto) {
    if (headless && audio.nativeQueue && STATE.queue.length) { audio.next(); return; }
    if (!STATE.queue.length) {
      if (!auto) toast('播放列表是空的，先去添加歌曲');   // 自动切歌不打扰，手动点击才提示
      return;
    }
    let ni;
    if (STATE.mode === 'random') {
      ni = Math.floor(Math.random() * STATE.queue.length);
    } else {
      ni = STATE.index + 1;
      if (ni >= STATE.queue.length) {
        // 顺序播放：自动切歌到列表末尾即停止（手动点下一首仍回到开头）
        if (STATE.mode === 'sequential' && auto) {
          setPlayIcon(false);
          toast('列表播放完毕');
          return;
        }
        ni = 0;
      }
    }
    const cf = localStorage.getItem('uzz.crossfade') === '1';
    const cfd = parseFloat(localStorage.getItem('uzz.crossfade.dur') || '2');
    if (cf && window.Eq && window.Eq.isReady()) {
      const seq = STATE.playSeq, target = STATE.queue[ni];
      window.Eq.crossfadeTo(cfd, () => { if (seqAlive(seq) && STATE.queue.includes(target)) loadAndPlay(target); });
    } else {
      loadAndPlay(STATE.queue[ni]);
    }
  }

  function prev() {
    if (headless && audio.nativeQueue && STATE.queue.length) { audio.previous(); return; }
    if (!STATE.queue.length) { toast('播放列表是空的，先去添加歌曲'); return; }
    // 已经到第一首时回到当前（常见播放器行为），并给个提示
    if (STATE.index <= 0 && STATE.current) {
      try { audio.currentTime = 0; } catch (e) { /* 忽略 */ }
      toast('已是第一首');
      return;
    }
    let pi = STATE.index - 1;
    if (pi < 0) pi = STATE.queue.length - 1;
    loadAndPlay(STATE.queue[pi]);
  }

  function cycleMode() {
    const order = ['list', 'single', 'random', 'sequential'];
    const i = (order.indexOf(STATE.mode) + 1) % order.length;
    STATE.mode = order[i];
    if (headless && audio.nativeQueue) audio.setMode(STATE.mode);
    syncModeBtn();
    toast('播放模式：' + MODE_TEXT[STATE.mode]);
  }
  // 播放模式按钮：SVG 图标 + 悬停提示当前模式名
  function syncModeBtn() {
    if (headless) { emit('mode'); return; }
    const b = $('fpMode');
    if (b) {
      b.innerHTML = MODE_SVG[STATE.mode] || MODE_SVG.list;
      b.dataset.tip = MODE_TEXT[STATE.mode];
      b.title = MODE_TEXT[STATE.mode];
    }
    const fpb = $('fpbMode');
    if (fpb) {
      fpb.innerHTML = MODE_SVG[STATE.mode] || MODE_SVG.list;
      fpb.title = MODE_TEXT[STATE.mode];
    }
  }

  /* ---------- 音量：点击图标静音 / 悬停弹出竖直滑条 / 滚轮调节 ----------
     底部有 3 处音量入口（右侧大按钮、mini 条滑条、播放页中间按钮），
     统一由setVolume()驱动，任一处改动其余同步。 */
  let lastVolume = 1;
  const VOL_BTNS = ['btnVol', 'btnVolMid'];
  const VOL_SLIDERS = ['volume', 'volumeMid'];
  function syncVolBtn() {
    const v = audio.volume;
    const svg = v <= 0 ? VOL_SVG_OFF : v < 0.34 ? VOL_SVG_LOW : v < 0.67 ? VOL_SVG_MID : VOL_SVG_ON;
    VOL_BTNS.forEach((id) => {
      const b = $(id);
      if (!b) return;
      b.innerHTML = svg;
      b.title = v > 0 ? '音量 ' + Math.round(v * 100) + '%，点击静音' : '已静音，点击恢复';
    });
  }
  // 统一设置音量（点击静音 / 拖动 / 滚轮 共用）
  function setVolume(v) {
    v = Math.max(0, Math.min(1, v));
    audio.volume = v;
    if (v > 0) lastVolume = v;
    const pct = Math.round(v * 100);
    VOL_SLIDERS.forEach((id) => {
      const s = $(id);
      if (s && document.activeElement !== s) s.value = pct;
    });
    const mm = $('mmVolSlider');
    if (mm && document.activeElement !== mm) mm.value = Math.round(pct * 0.8);
    const wave = $('mmVolWave');
    if (wave) wave.style.display = v > 0 ? '' : 'none';
    localStorage.setItem('uzz.volume', String(v));
    syncVolBtn();
  }
  // 给一组「音量按钮 + 滑块 + 容器」绑定事件（多处挂载共用）
  function bindVolGroup(btnId, sliderId, wrapId) {
    const btn = $(btnId), slider = $(sliderId), wrap = $(wrapId);
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (audio.volume > 0) { lastVolume = audio.volume; setVolume(0); }
        else setVolume(lastVolume > 0 ? lastVolume : 0.8);
      });
    }
    if (slider) slider.addEventListener('input', (e) => setVolume(e.target.value / 100));
    // 滚轮上下滚动调节音量（悬停图标或滑块时生效）
    if (wrap) {
      wrap.addEventListener('wheel', (e) => {
        e.preventDefault();
        setVolume(audio.volume + (e.deltaY < 0 ? 0.05 : -0.05));
      }, { passive: false });
    }
  }
  function bindVolume() {
    if (!$('volume')) return;
    bindVolGroup('btnVol', 'volume', 'volWrap');
    bindVolGroup('btnVolMid', 'volumeMid', 'volWrapMid');
  }

  /* ---------- 音质选择（标准 / 极高 / 无损 / Hi-Res） ---------- */
  const Q_CARET_SVG = '<svg class="q-caret" viewBox="0 0 24 24"><path d="M6 9.5l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function setQualityActive(q) {
    const menu = $('qualityMenu');
    if (menu) menu.querySelectorAll('button[data-q]').forEach((b) => b.classList.toggle('active', b.dataset.q === q));
    const btn = $('pbQuality');
    if (btn) btn.innerHTML = (QUALITY_LABEL[q] || '标准') + ' ' + Q_CARET_SVG;
  }
  function bindQuality() {
    const btn = $('pbQuality');
    const menu = $('qualityMenu');
    if (!btn || !menu) return;
    const cur = localStorage.getItem('uzz.quality') || 'standard';
    STATE.quality = cur;
    setQualityActive(cur);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('hidden');
    });
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-q]');
      if (!b) return;
      const q = b.dataset.q;
      setQualityActive(q);
      localStorage.setItem('uzz.quality', q);
      STATE.quality = q;
      menu.classList.add('hidden');
      reloadQuality(q);
    });
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && e.target !== btn) menu.classList.add('hidden');
    });
  }

  /* ---------- 播放倍速（0.5 / 1.0 / 1.5 / 2.0，切歌保留） ---------- */
  function fmtSpeed(v) {
    const r = Math.round(v * 100) / 100;
    return (Number.isInteger(r * 10) ? r.toFixed(1) : String(r)) + '×';
  }
  function setSpeedActive(v) {
    const menu = $('speedMenu');
    if (menu) menu.querySelectorAll('button[data-speed]').forEach((b) => b.classList.toggle('active', parseFloat(b.dataset.speed) === v));
    const btn = $('pbSpeed');
    if (btn) {
      const label = $('pbSpeedLabel');
      if (label) label.textContent = fmtSpeed(v);
      btn.classList.toggle('speed-on', Math.abs(v - 1) > 1e-6);   // 非 1.0× 点亮 accent
    }
  }
  function applyPlaybackRate(v) {
    // defaultPlaybackRate 一并设置：audio.load()（切歌 / 换源 reloadQuality）会把
    // playbackRate 重置回 defaultPlaybackRate，这样倍速在切歌后自动保留，无需补丁
    if (audio) {
      audio.defaultPlaybackRate = v;
      audio.playbackRate = v;
    }
  }
  function setPlaybackRate(v) {
    const r = Math.min(2, Math.max(0.5, parseFloat(v) || 1));
    setSpeedActive(r);
    applyPlaybackRate(r);
    localStorage.setItem('uzz.speed', String(r));
  }
  function bindSpeed() {
    const btn = $('pbSpeed');
    const menu = $('speedMenu');
    if (!btn || !menu) return;
    const saved = parseFloat(localStorage.getItem('uzz.speed'));
    const cur = (saved >= 0.5 && saved <= 2) ? saved : 1;   // 兼容音效面板滑块的连续值（如 1.25×）
    setSpeedActive(cur);
    applyPlaybackRate(cur);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('hidden');
    });
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-speed]');
      if (!b) return;
      setPlaybackRate(b.dataset.speed);
      menu.classList.add('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && !btn.contains(e.target)) menu.classList.add('hidden');
    });
  }
  // 切换音质：重新取播放地址（带音质档位），不中断播放进度
  async function reloadQuality(level) {
    const t = STATE.current;
    if (!t) { toast('还没有播放内容，无法切换音质'); return; }
    const seq = STATE.playSeq;   // 记录当前播放令牌：期间用户切了歌就不再重设 src
    t.quality = level;
    toast('切换音质：' + (QUALITY_LABEL[level] || level));
    try {
      const full = await UzzApi.getSong(t, undefined, playbackRequest.signal);
      if (!seqAlive(seq) || STATE.current !== t) return;   // 已切歌 → 丢弃
      if (full && full.url) {
        t.url = full.url;
        notifyTrackChanged();
        if (audio && !audio.paused && audio.src) {
          const t0 = audio.currentTime;
          audio.src = sameOriginStream(full.url);
          STATE.lastSrcSet = Date.now();
          try { await audio.play(); if (seqAlive(seq)) audio.currentTime = t0; } catch (e) {}
        }
      }
    } catch (e) { /* 沿用原音源 */ }
  }

  /* ---------- 队列渲染 ---------- */
  function renderQueue() {
    if (headless) { emit('queue'); return; }
    const ul = $('queueList');
    if (!ul) return;
    $('queueCount').textContent = STATE.queue.length;
    if (!STATE.queue.length) {
      ul.innerHTML = '<li class="qp-empty">播放列表为空</li>';
      return;
    }
    const favSet = new Set(favorites.map((f) => f.vendor + '|' + f.id));
    ul.innerHTML = STATE.queue.map((t, i) => {
      const on = i === STATE.index;
      const pic = t.pic ? (window.UzzApi && UzzApi.picProxy ? UzzApi.picProxy(t.pic) : t.pic) : '';
      const cov = pic
        ? `<img src="${escapeHtml(pic)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"/>`
        : '<span class="qp-cover-ph">♪</span>';
      const badges = [];
      if (t.vendor === 'local') badges.push('<i class="qp-bdg qp-b-local">本地</i>');
      else badges.push('<i class="qp-bdg qp-b-sq">在线播放</i>');
      if (t.quality === 'hires') badges.push('<i class="qp-bdg qp-b-hires">Hi-Res</i>');
      if (t.isMv) badges.push('<i class="qp-bdg qp-b-mv">MV</i>');
      if (t.vip) badges.push('<i class="qp-bdg qp-b-vip">VIP</i>');
      const fav = favSet.has((t.vendor || 'netease') + '|' + t.id);
      const dur = t.duration ? fmt(t.duration) : '';
      return `
        <li data-i="${i}" class="${on ? 'playing' : ''}">
          <span class="qp-cover">${cov}</span>
          <span class="qp-info">
            <span class="qp-name${on ? '' : ''}">${escapeHtml(t.name || '未知')}</span>
            <span class="qp-sub">${badges.join('')}<span class="qp-artist">${escapeHtml(t.artist || '')}</span></span>
          </span>
          <span class="qp-dur">${dur}</span>
          <span class="qp-acts">
            <button data-qfav="${i}" class="${fav ? 'on' : ''}" title="喜欢">${fav ? '♥' : '♡'}</button>
            <button data-qadd="${i}" title="加入歌单">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 7h16v13H4z"/><path d="M12 10v7M8.5 13.5h7"/></svg>
            </button>
            <button data-qdel="${i}" title="移除">···</button>
          </span>
        </li>`;
    }).join('');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 从队列移除第 i 首：删的是当前播放的下一首时要顺移索引
  function removeFromQueue(i) {
    if (i < 0 || i >= STATE.queue.length) return;
    STATE.queue.splice(i, 1);
    if (!STATE.queue.length) {
      resetPlayback();
      STATE.loading = false;
      STATE.index = -1;
      STATE.current = null;
      notifyTrackChanged();
      try { audio.pause(); } catch (e) { /* 忽略 */ }
      setPlayIcon(false);
    } else if (i < STATE.index) {
      STATE.index -= 1;              // 删的是前面的 → 当前曲索引前移
    } else if (i === STATE.index) {
      // 删掉正在播的这首：接着播下一首（已到末尾则回到开头）
      const ni = i >= STATE.queue.length ? 0 : i;
      STATE.index = ni;
      loadAndPlay(STATE.queue[ni]);
      return;
    }
    renderQueue();
  }

  /* ---------- 收藏 ---------- */
  // toggleFav(track?)：不传则作用于当前播放歌曲。
  // 返回 true = 已收藏，false = 已取消（供列表红心 / 「收藏全部」判断）
  function toggleFav(track) {
    // 防御：误传 DOM 事件时（addEventListener 直接传函数）退回到当前歌曲，
    // 避免把 MouseEvent 当歌曲存进收藏，造成"点了红心没反应"。
    if (track && typeof track.id !== 'string') track = null;
    const t = track || STATE.current;
    if (!t || !t.id) { toast('还没有播放内容，无法收藏'); return false; }
    const i = favorites.findIndex((f) => f.id === t.id && f.vendor === t.vendor);
    const added = i === -1;
    if (added) {
      favorites.unshift({ ...t, at: Date.now() });
    } else {
      favorites.splice(i, 1);
    }
    saveJSON('uzz.fav', favorites);
    syncFavBtn();
    // 弹跳动效：明确告诉用户"这次点击收到了"
    const fb = $('fpFav'), fpbB = $('fpbFav');
    [fb, fpbB].forEach((b) => {
      if (!b) return;
      b.classList.remove('hit');
      void b.offsetWidth;      // 强制重排，让动画能重复触发
      b.classList.add('hit');
      setTimeout(() => b.classList.remove('hit'), 360);
    });
    if (!track) toast(added ? '已收藏 ♥' : '已取消收藏');
    // 通知 app.js 刷新「我喜欢的音乐 / 最近播放」等列表，避免收藏后列表还是旧的
    document.dispatchEvent(new CustomEvent('uzz:libChanged', { detail: { kind: added ? 'fav-add' : 'fav-del' } }));
    return added;
  }

  /* ---------- 下载 ---------- */
  function downloadCurrent() {
    const t = STATE.current;
    if (!t) { toast('先选一首歌'); return; }
    downloadTrack(t);
  }
  async function downloadTrack(track) {
    if (!track) return;
    toast('准备下载…');
    const a = document.createElement('a');
    a.href = UzzApi.downloadUrl(track);
    const localExt = track.vendor === 'local' && /^[a-z0-9]{2,5}$/i.test(track.format || '') ? '.' + track.format.toLowerCase() : '.mp3';
    a.download = `${track.name} - ${track.artist}${localExt}`.replace(/[\\/:*?"<>|]/g, '_');
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('已开始下载（若未自动保存，请确认后端可达）');
  }

  /* ---------- 进度 ---------- */
  function bindProgress() {
    audio.addEventListener('timeupdate', () => {
      const d = audio.duration || 0;
      const c = audio.currentTime || 0;
      // CUE：到达分轨结束点则切下一首
      if (STATE.cueEnd && c >= STATE.cueEnd - 0.05) { next(true); return; }
      if (!headless) {
        $('curTime').textContent = fmt(c);
        $('durTime').textContent = fmt(d);
        if (d) $('seek').value = Math.floor((c / d) * 1000);
      }
      syncLyric(c);
      // mini 模式歌词列表用：当前时间 + 当前歌词行索引
      window.__mmCurT = c;
      if (STATE.lyrics && STATE.lyrics.length) {
        let idx = -1;
        for (let i = 0; i < STATE.lyrics.length; i++) { if (STATE.lyrics[i].t <= c + 0.15) idx = i; else break; }
        if (idx !== window.__mmCurIdx) {
          window.__mmCurIdx = idx;
          const ul = document.getElementById('mmList');
          if (ul && ul.querySelector('li[data-lc]')) {
            ul.querySelectorAll('li[data-lc]').forEach((li) => {
              li.classList.toggle('on', Number(li.dataset.lc) === idx);
            });
            const on = ul.querySelector('li.on');
            if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
          }
        }
      }
      // 本地音乐：节流上报断点续听进度
      if (STATE.current && STATE.current.vendor === 'local') {
        const now = Date.now();
        if (now - STATE.lastProg > 5000) {
          STATE.lastProg = now;
          UzzApi.localSetProgress(STATE.current.id, c);
        }
      }
    });
    audio.addEventListener('loadedmetadata', () => {
      if (!headless) $('durTime').textContent = fmt(audio.duration);
      if (STATE.pendingSeek && audio.duration && STATE.pendingSeek < audio.duration) {
        try { audio.currentTime = STATE.pendingSeek; } catch (e) {}
      }
      STATE.pendingSeek = 0;
    });
    audio.addEventListener('ended', () => {
      if (audio.nativeQueue) return;
      // 换源瞬间旧流可能补发 ended，若期间已切过歌则忽略，否则会连锁跳歌
      if (STATE.lastSrcSet && Date.now() - STATE.lastSrcSet < 600) return;
      if (STATE.mode === 'single') { audio.currentTime = 0; audio.play(); }
      else next(true);
    });
    // 淡入淡出：真实作用在播放音量上（事件驱动，覆盖所有播放/暂停路径）
    // SMTC：同步播放状态到 Windows 媒体控制中心
    try {
      if (localStorage.getItem('uzz.smtc') === '1' && navigator.mediaSession) {
        navigator.mediaSession.playbackState = 'playing';
      }
    } catch (e) { /* 忽略 */ }
    audio.addEventListener('play', () => {
      if (window.Eq) { window.Eq.resume(); window.Eq.fadeIn(); }
      setPlayIcon(true); syncDlPlayState(true);
    });
    // 切歌时设置 audio.src 会触发一次瞬时 pause，忽略它，避免播放图标卡在“暂停”
    audio.addEventListener('pause', () => {
      if (STATE.lastSrcSet && Date.now() - STATE.lastSrcSet < 400) return;
      // 淡出后再真正暂停（fadeMs=0 时立即暂停，不改变原有行为）
      if (window.Eq && window.Eq.getFade() > 0) window.Eq.fadeOut();
      // SMTC：暂停状态
      try {
        if (localStorage.getItem('uzz.smtc') === '1' && navigator.mediaSession) {
          navigator.mediaSession.playbackState = 'paused';
        }
      } catch (e) { /* 忽略 */ }
      setPlayIcon(false); syncDlPlayState(false);
    });
    audio.addEventListener('error', () => {
      // 只有当前这次播放才提示，避免旧歌的解码失败串台到新歌
      if (STATE.lastSrcSet && Date.now() - STATE.lastSrcSet < 300) return;
      if (audio.paused && !STATE.current) return;
      toast(STATE.current?.vendor === 'local' ? '文件解码失败或已移动，请检查文件；少见格式需额外解码支持' : '播放出错，尝试下一个音源或刷新');
    });

    if (headless) return;
    $('seek').addEventListener('input', (e) => {
      const d = audio.duration || 0;
      if (d) audio.currentTime = (e.target.value / 1000) * d;
      updateSeekTip(e.target.value / 1000);   // 拖动时气泡实时跟随
    });
    bindSeekTip();
  }

  /* ---------- 抽屉 / 全屏切换 ---------- */
  function openFull() {
    if (!STATE.current) { toast('先选一首歌'); return; }
    if (headless) { emit('openFull'); return; }
    $('fullPlayer').classList.remove('hidden');
    resizeVinylViz();
    startVinylViz();
  }
  function closeFull() { if (headless) { emit('closeFull'); return; } $('fullPlayer').classList.add('hidden'); stopVinylViz(); }
  // 播放列表：开关式（再点一次或点外部即关闭），不遮挡主界面
  function openQueue() {
    renderQueue();
    const d = $('queueDrawer');
    if (d) d.classList.remove('hidden');
  }
  function closeQueue() { const d = $('queueDrawer'); if (d) d.classList.add('hidden'); }
  function toggleQueue() {
    const d = $('queueDrawer');
    if (d && !d.classList.contains('hidden')) closeQueue();
    else openQueue();
  }
  // 设置不再是抽屉，改为切换到侧栏「设置」视图（由 app.js 处理视图切换）
  function openSettings() { document.dispatchEvent(new CustomEvent('uzz:view', { detail: 'settings' })); }

  /* ---------- 全屏页底部控制栏绑定 ---------- */
  function bindFullBottom() {
    const fpbPlay = $('fpbPlay'), fpbPrev = $('fpbPrev'), fpbNext = $('fpbNext'),
      fpbMode = $('fpbMode'), fpbFav = $('fpbFav'), fpbQueue = $('fpbQueue'), fpbFx = $('fpbFx');
    if (fpbPlay) fpbPlay.addEventListener('click', toggle);
    if (fpbPrev) fpbPrev.addEventListener('click', prev);
    if (fpbNext) fpbNext.addEventListener('click', () => next());
    if (fpbMode) fpbMode.addEventListener('click', cycleMode);
    // 注意：不能写成 addEventListener('click', toggleFav)——
    // 那样会把 MouseEvent 当成 track 传进 toggleFav，存进收藏的只有事件对象（表现为"点了没反应"）
    if (fpbFav) fpbFav.addEventListener('click', () => toggleFav());
    if (fpbQueue) fpbQueue.addEventListener('click', toggleQueue);
    if (fpbFx) fpbFx.addEventListener('click', () => { const p = $('fxPanel'); if (p) p.classList.remove('hidden'); });
    // 歌手 / 专辑 点击跳转
    const fpArtist = $('fpArtist'), fpAlbum = $('fpAlbum');
    if (fpArtist) fpArtist.addEventListener('click', () => {
      const t = STATE.current;
      if (t && t.artistId) document.dispatchEvent(new CustomEvent('uzz:openArtist', { detail: { id: t.artistId, name: t.artist, pic: t.pic } }));
    });
    if (fpAlbum) fpAlbum.addEventListener('click', () => {
      const t = STATE.current;
      if (t && t.albumId) document.dispatchEvent(new CustomEvent('uzz:openAlbum', { detail: { id: t.albumId, name: t.album, pic: t.pic } }));
    });
  }

  /* ---------- 黑胶唱片：音频跳动可视化（径向频谱，嵌在转动光盘内） ---------- */
  let vizRAF = null, vizData = null;
  function resizeVinylViz() {
    const canvas = $('fpViz');
    const vinyl = $('vinylDisc');
    if (!canvas || !vinyl) return;
    const size = vinyl.clientWidth || 300;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function startVinylViz() {
    const canvas = $('fpViz');
    if (!canvas || vizRAF) return;
    const ctx = canvas.getContext('2d');
    const BARS = 72;
    function draw() {
      vizRAF = requestAnimationFrame(draw);
      const analyser = (window.Eq && window.Eq.getAnalyser) ? window.Eq.getAnalyser() : null;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      if (!w || !h) return;
      const cx = w / 2, cy = h / 2;
      const r0 = Math.min(w, h) * 0.30;   // 内圈（唱片标签边缘）
      const r1 = Math.min(w, h) * 0.47;   // 外圈（跳动上限，限制在唱片黑胶环内）
      if (analyser && !audio.paused) {
        if (!vizData || vizData.length !== analyser.frequencyBinCount) vizData = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(vizData);
        const step = Math.max(1, Math.floor(vizData.length * 0.6 / BARS));
        const lw = Math.max(1.2, (Math.PI * 2 * r0 / BARS) * 0.55);
        for (let i = 0; i < BARS; i++) {
          let sum = 0;
          for (let k = 0; k < step; k++) sum += vizData[i * step + k] || 0;
          const v = (sum / step) / 255;
          const len = v * (r1 - r0);
          const ang = (i / BARS) * Math.PI * 2 - Math.PI / 2;
          const x0 = cx + Math.cos(ang) * r0, y0 = cy + Math.sin(ang) * r0;
          const x1 = cx + Math.cos(ang) * (r0 + len), y1 = cy + Math.sin(ang) * (r0 + len);
          ctx.strokeStyle = 'rgba(255,255,255,' + (0.22 + v * 0.6) + ')';
          ctx.lineWidth = lw;
          ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        }
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, (r0 + r1) / 2, 0, Math.PI * 2); ctx.stroke();
      }
    }
    draw();
  }
  function stopVinylViz() {
    if (vizRAF) { cancelAnimationFrame(vizRAF); vizRAF = null; }
    vizData = null;
  }

  /* ---------- 初始化 UI 事件 ---------- */
  function init(options = {}) {
    if (options.headless) {
      headless = true;
      audio.addEventListener('nativeTrack', event => {
        const s = event.state, t = s.queue?.[s.index]; if (!t?.id) return;
        const changed = !STATE.current || STATE.current.id !== t.id || STATE.current.vendor !== t.vendor;
        const metadataChanged = changed || STATE.current?.url !== t.url || STATE.current?.name !== t.name || STATE.current?.artist !== t.artist;
        if (changed) bumpPlaySeq();
        STATE.queue = s.queue; STATE.index = s.index; STATE.current = t; STATE.mode = s.mode || STATE.mode;
        if (changed || (t.lyric && STATE.nativeLyric !== t.lyric)) {
          STATE.nativeLyric = t.lyric; STATE.lyrics = parseLrc(t.lyric || ''); renderLyric();
          renderNowPlaying(); syncModeBtn();
        }
        else if (metadataChanged) renderNowPlaying();
        if (changed) {
          history = history.filter(h => !(h.id === t.id && h.vendor === t.vendor));
          history.unshift({ ...t, at: Date.now() }); history = history.slice(0,200); saveJSON('uzz.history',history);
        }
      });
      audio.replayState?.();
      bindProgress(); bindResumeSave();
      if (localStorage.getItem('uzz.volume') != null) audio.volume = Math.max(0, Math.min(1, Number(localStorage.getItem('uzz.volume')) || 0));
      return;
    }
    bindProgress();
    bindLyricGoto();

    // 全局快捷键（媒体键 / 自定义）+ 开机自启进入 mini 模式
    if (window.uzzBridge && window.uzzBridge.onGlobal) {
      window.uzzBridge.onGlobal((ev) => {
        if (ev === 'global:toggle') toggle();
        else if (ev === 'global:next') next();
        else if (ev === 'global:prev') prev();
        else if (ev === 'global:full') { if ($('fullPlayer').classList.contains('hidden')) openFull(); else closeFull(); }
        else if (ev === 'global:lyric') $('btnLyric').click();
        else if (ev === 'global:mini') { const t = $('tbMini'); if (t) t.click(); }
        // 开机自启「最小化展示」：切到 mini 播放条
        else if (ev === 'global:miniMode') {
          const t = document.getElementById('tbMini');
          if (t) t.click();
        }
      });
    }
    // 双击关联文件 / 命令行打开本地音频
    if (window.uzzBridge && window.uzzBridge.onOpenLocalFile) {
      window.uzzBridge.onOpenLocalFile(async (p) => {
        if (!p) return;
        try {
          const t = await UzzApi.localAddFile(p);
          if (t) {
            document.dispatchEvent(new CustomEvent('uzz:view', { detail: 'local' }));
            loadLocal({ id: t.id, name: t.name, artist: t.artist, album: t.album, pic: t.cover, vendor: 'local', url: t.url, duration: t.duration, resumeAt: t.resumeAt, replayGain: t.replayGain });
          } else toast('无法添加该文件');
        } catch (e) { toast('打开本地文件失败：' + (e.message || e)); }
      });
    }
    // 音量：持久化恢复 + 新交互（点击静音 / 悬停竖直滑条）
    if (localStorage.getItem('uzz.volume') != null) {
      audio.volume = parseFloat(localStorage.getItem('uzz.volume'));
    }
    VOL_SLIDERS.forEach((id) => { const s = $(id); if (s) s.value = Math.round(audio.volume * 100); });
    lastVolume = audio.volume > 0 ? audio.volume : 1;
    bindVolume();
    bindQuality();
    bindSpeed();
    syncVolBtn();
    bindResumeSave();

    // 底部播放条（桌面版播放键为 fpPlay；保留 miniPlay 兼容移动端布局）
    const mpBtn = $('miniPlay');
    if (mpBtn) mpBtn.addEventListener('click', toggle);
    const mnBtn = $('miniNext');
    if (mnBtn) mnBtn.addEventListener('click', () => next());
    $('miniPlayer').querySelector('.mini-meta').addEventListener('click', openFull);
    $('miniCover').addEventListener('click', openFull);

    $('fpClose').addEventListener('click', closeFull);
    $('fpPlay').addEventListener('click', toggle);
    $('fpNext').addEventListener('click', () => next());
    $('fpPrev').addEventListener('click', prev);
    $('fpMode').addEventListener('click', cycleMode);
    // 同上：必须用箭头函数忽略事件对象
    $('fpFav').addEventListener('click', () => toggleFav());
    $('fpDownload').addEventListener('click', downloadCurrent);
    $('fpQueue').addEventListener('click', toggleQueue);

    // 全屏页底部控制栏
    bindFullBottom();

    $('openQueue').addEventListener('click', toggleQueue);
    // 点面板外部（透明遮罩层）关闭
    $('queueDrawer').addEventListener('click', (e) => { if (e.target.id === 'queueDrawer') closeQueue(); });
    $('queueList').addEventListener('click', (e) => {
      const li = e.target.closest('li[data-i]');
      if (!li) return;
      const i = parseInt(li.dataset.i, 10);
      const t = STATE.queue[i];
      if (!t) return;
      // 行内操作
      const favBtn = e.target.closest('[data-qfav]');
      if (favBtn) { toggleFav(t); renderQueue(); return; }
      const addBtn = e.target.closest('[data-qadd]');
      if (addBtn) {
        const r = addBtn.getBoundingClientRect();
        // 派发给 app.js 的加入歌单菜单（它按 clientX/clientY 定位，用按钮位置构造伪事件）
        document.dispatchEvent(new CustomEvent('uzz:addToPlaylist', {
          detail: { track: t, x: r.left, y: r.bottom },
        }));
        return;
      }
      const delBtn = e.target.closest('[data-qdel]');
      if (delBtn) { removeFromQueue(i); return; }
      // 点行 = 切换到该曲
      if (i !== STATE.index) loadAndPlay(t);
      else toggle();
    });
    // 「收藏全部 / 清空」
    const qFavAll = $('queueFavAll');
    if (qFavAll) qFavAll.addEventListener('click', () => {
      let n = 0;
      STATE.queue.forEach((t) => { if (!favorites.some(f => f.id === t.id && f.vendor === t.vendor) && toggleFav(t)) n++; });
      renderQueue();
      toast(n ? '已收藏 ' + n + ' 首' : '列表里的歌都已在「我喜欢的音乐」里了');
    });
    const qClear = $('queueClear');
    if (qClear) qClear.addEventListener('click', () => {
      if (!STATE.queue.length) return;
      clearQueue();
      toast('已清空播放列表');
    });

    // ══════ 桌面歌词 ══════
    $('btnLyric').addEventListener('click', () => {
      if (!window.uzzBridge) { toast('桌面歌词仅桌面版可用'); return; }
      const on = localStorage.getItem('uzz.dl.enabled') === '1';
      const nv = on ? '0' : '1';
      localStorage.setItem('uzz.dl.enabled', nv);
      syncLyricBtn();
      const dlEnable = document.getElementById('dlEnable');
      if (dlEnable) dlEnable.checked = nv === '1';
      if (nv === '1') { window.uzzBridge.showLyric(true); pushLyricStyle(); }
      else window.uzzBridge.showLyric(false);
    });
    if (window.uzzBridge) {
      if (window.uzzBridge.onLyricLocked) window.uzzBridge.onLyricLocked(on => {
        localStorage.setItem('uzz.lyricLock', on ? '1' : '0');
        const el = $('stDLyricLock'); if (el) el.checked = on;
      });
      if (window.uzzBridge.onLyricConfig) window.uzzBridge.onLyricConfig(cfg => {
        for (const k of ['layout', 'align', 'played']) if (cfg[k] != null) localStorage.setItem('uzz.dl.' + k, cfg[k]);
        for (const k of ['topmost', 'gradient', 'trans']) if (cfg[k] != null) localStorage.setItem('uzz.dl.' + k, cfg[k] ? '1' : '0');
        const color = cfg.gradient ? 'gradient' : ({ '#1ecd8a': 'green', '#ff8fc7': 'pink', '#ffc861': 'gold', '#7ab6ff': 'blue' })[cfg.played] || 'green';
        localStorage.setItem('uzz.dl.color', color);
        const colorEl = $('stLyricColor'); if (colorEl) colorEl.value = color;
        const layout = $('stLyricLayout'); if (layout) layout.value = cfg.layout;
        const align = $('stLyricAlign'); if (align) align.value = cfg.align;
        for (const id of ['stLyricTop', 'stDLyricTop']) { const el = $(id); if (el) el.checked = cfg.topmost; }
        const trans = $('stLyricTrans'); if (trans) trans.checked = cfg.trans;
      });
      window.uzzBridge.onLyricClosed(() => {
        localStorage.setItem('uzz.dl.enabled', '0');
        syncLyricBtn();
      });
      if (localStorage.getItem('uzz.dl.enabled') === '1') {
        window.uzzBridge.showLyric(true);
        pushLyricStyle();
      }
    }
    syncLyricBtn();

    // 注：原「后端地址 / 音源 / 自动播放」「导出收藏 / 清空数据」的设置项
    // 已迁移到新的网易云式设置页，对应元素已从 HTML 移除，此处不再绑定。

    syncModeBtn();
  }

  global.Player = {
    init, loadAndPlay, enqueueTrack, playQueue, clearQueue, toggle, next, prev, openFull, closeFull,
    downloadTrack, downloadCurrent, pushLyricStyle, dlEnabled,
    refreshLyric: renderLyric, reloadQuality,
    setPlaybackRate,
    setVolume, cycleMode, removeFromQueue,
    parseLrcSafe: (text) => { try { return parseLrc(text || ''); } catch (e) { return []; } },
    setLyricOffset,
    getQueue: () => STATE.queue, getFavorites: () => favorites, getHistory: () => history,
    getState: () => STATE,
    // 上回记忆播放
    getResume, resumeFrom, clearResume, saveResume,
    updateSeekTip,
    toggleFav,
    reloadLibrary: () => { favorites=loadJSON('uzz.fav',[]); history=loadJSON('uzz.history',[]); syncFavBtn(); renderQueue(); },
  };
})(window);
