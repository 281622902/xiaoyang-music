/* ============================================================
 * api.js — 播放器与音乐解析后端的通信层
 * 后端接口约定（music-api 兼容，详见 server/README）：
 *   GET /api/search?keyword=&type=song|artist|album|playlist&page=&limit=
 *       -> { code, result:[{id,name,artist,album,pic,vendor,duration}], total }
 *   GET /api/song?id=&vendor=
 *       -> { code, data:{ id,name,artist,album,pic,url,lyric,duration,vendor } }
 *   GET /api/url?id=&vendor=   -> { code, url }
 *   GET /api/lyric?id=&vendor= -> { code, lyric }   (LRC 文本)
 *   GET /api/pic?id=&vendor=   -> 302 重定向到封面
 * ============================================================ */
(function (global) {
  'use strict';

  const DEFAULT_LIMIT = 20;

  function getApiBase() {
    // 优先用设置里的值；否则同源（桌面版 Electron 内置后端即同源）
    let base = (localStorage.getItem('uzz.apiBase') || '').trim();
    if (!base) base = '';
    return base.replace(/\/+$/, '');
  }

  function getVendor() {
    return localStorage.getItem('uzz.vendor') || 'auto';
  }

  const localTokens = new Map();
  async function request(path, params, timeout = 12000, externalSignal) {
    const base = getApiBase();
    const url = new URL(base + path, location.origin);
    Object.keys(params || {}).forEach((k) => {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '')
        url.searchParams.set(k, params[k]);
    });
    const ctrl = new AbortController();
    const requestId = crypto.randomUUID();
    const cancelBackend = () => global.uzzBridge?.cancelWebRequest?.(requestId);
    ctrl.signal.addEventListener('abort',cancelBackend,{once:true});
    const cancel = () => ctrl.abort();
    if (externalSignal?.aborted) cancel();
    else externalSignal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const headers = { 'X-XY-Request': requestId };
      if (path.startsWith('/api/local/')) {
        if (!localTokens.has(base)) {
          const session = await fetch(new URL(base + '/api/local/session', location.origin), { signal: ctrl.signal });
          if (!session.ok) throw new Error('当前后端不允许访问本地媒体库');
          localTokens.set(base, (await session.json()).token);
        }
        headers['X-Uzz-Local-Token'] = localTokens.get(base);
      }
      const res = await fetch(url.toString(), { signal: ctrl.signal, headers });
      // 非 2xx：后端错误响应体里带中文 msg（如“歌单不存在”），优先透出，
      // 否则用户只能看到干巴巴的 "HTTP 404"
      if (!res.ok) {
        let msg = '';
        try {
          const j = await res.json();
          msg = (j && (j.msg || j.message)) || '';
        } catch (e) { /* 响应体不是 JSON */ }
        throw new Error(msg || ('HTTP ' + res.status));
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', cancel);
      ctrl.signal.removeEventListener('abort', cancelBackend);
    }
  }

  // 搜索
  async function search(keyword, type, page, limit) {
    const r = await request('/api/search', {
      keyword,
      type: type || 'song',
      page: page || 1,
      limit: limit || DEFAULT_LIMIT,
      vendor: getVendor(),
    });
    if (!r || r.code !== 200) throw new Error((r && r.msg) || '搜索失败');
    return {
      list: (r.result || []).map(normalizeTrack),
      total: r.total || (r.result ? r.result.length : 0),
    };
  }

  // 单曲详情（含播放地址 + 歌词）；可传 track 对象以启用多音源兜底
  async function getSong(track, vendor, signal) {
    const id = typeof track === 'string' ? track : track.id;
    const name = typeof track === 'string' ? '' : (track.name || '');
    const artist = typeof track === 'string' ? '' : (track.artist || '');
    // 超时 22s：后端兜底链整体限时 18s，留出余量让后端的
    // "解析超时"标记能正常回传，避免前端先 abort 把原因掩盖成"网络慢"。
    let r;
    try {
      r = await request('/api/song', {
        id,
        vendor: vendor || (typeof track === 'string' ? getVendor() : (track.vendor || getVendor())),
        name,
        artist,
        quality: localStorage.getItem('uzz.quality') || 'standard',
      }, 22000, signal);
    } catch (e) {
      const msg = String((e && e.message) || e);
      throw new Error(/abort/i.test(msg) ? '解析超时（网络较慢），请重试或换个音源' : msg);
    }
    if (!r || r.code !== 200 || !r.data) throw new Error((r && r.msg) || '获取歌曲失败');
    const t = normalizeTrack(r.data);
    // 后端兜底链限时失败时带回标记，前端给「重试/换音源」的可操作提示
    if (r.data && r.data.resolveTimeout) t.resolveTimeout = true;
    return t;
  }

  // 取播放地址：可传 track 对象（含 name/artist 用于多音源兜底）
  async function getUrl(track, vendor, signal) {
    const id = typeof track === 'string' ? track : track.id;
    const name = typeof track === 'string' ? '' : (track.name || '');
    const artist = typeof track === 'string' ? '' : (track.artist || '');
    try {
      const r = await request('/api/url', {
        id,
        vendor: vendor || (typeof track === 'string' ? getVendor() : (track.vendor || getVendor())),
        name,
        artist,
        quality: localStorage.getItem('uzz.quality') || 'standard',
      }, 20000, signal);
      if (r && r.code === 200 && r.url) return r.url;
    } catch (e) {}
    return null;
  }

  async function getLyric(id, vendor, signal) {
    try {
      const r = await request('/api/lyric', { id, vendor: vendor || getVendor() }, 8000, signal);
      if (r && r.code === 200 && r.lyric) return r.lyric;
    } catch (e) {}
    return '';
  }

  // 把不同后端返回的差异字段统一成内部模型
  function normalizeTrack(t) {
    return {
      ...t,
      id: String(t.id),
      name: t.name || t.song_name || t.title || '未知',
      artist: t.artist || t.artist_name || t.singer || '未知',
      artistId: t.artistId || t.artist_id || '',
      album: t.album || t.album_name || '',
      albumId: t.albumId || t.album_id || '',
      pic: t.pic || t.pic_url || t.cover || '',
      vendor: t.vendor || t.server || getVendor(),
      duration: t.duration || t.dt || 0,
      url: t.url || '',
      lyric: t.lyric || '',
      // 后端兜底链限时失败的标记：透传给前端用于给「重试/换音源」提示
      resolveTimeout: !!t.resolveTimeout,
    };
  }

  // 健康检查（设置页用）
  async function ping() {
    const base = getApiBase();
    const url = new URL(base + '/api/health', location.origin);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(url.toString(), { signal: ctrl.signal });
      return res.ok;
    } catch (e) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  // 下载地址：走后端 /api/download 同源代理，规避跨域直链下载被拦截
  function downloadUrl(track, vendor) {
    const id = typeof track === 'string' ? track : track.id;
    const name = typeof track === 'string' ? '' : (track.name || '');
    const artist = typeof track === 'string' ? '' : (track.artist || '');
    const base = getApiBase();
    const url = new URL(base + '/api/download', location.origin);
    if (track && typeof track === 'object' && track.vendor === 'local') {
      const local = new URL(base + '/api/local/stream', location.origin);
      local.searchParams.set('id', track.audioId || String(track.id).split('#')[0]);
      return local.toString();
    }
    url.searchParams.set('id', id);
    url.searchParams.set('vendor', vendor || (typeof track === 'string' ? getVendor() : (track.vendor || getVendor())));
    if (name) url.searchParams.set('name', name);
    if (artist) url.searchParams.set('artist', artist);
    url.searchParams.set('quality', localStorage.getItem('uzz.dlQuality') || 'standard');
    if (track && typeof track === 'object' && track.duration) url.searchParams.set('duration', track.duration);
    return url.toString();
  }

  // 封面代理：走后端 /api/pic 绕过图床防盗链，解决封面不显示
  function picProxy(url) {
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) return url;
    const base = getApiBase();
    return base + '/api/pic?url=' + encodeURIComponent(url);
  }

  // 搜索建议 + 热搜词（keyword 为空 → 只返回热搜）
  async function suggest(keyword) {
    const r = await request('/api/suggest', { keyword: keyword || '' }, 8000);
    if (!r || r.code !== 200) throw new Error((r && r.msg) || '获取建议失败');
    return { hot: r.hot || [], songs: r.songs || [], artists: r.artists || [], albums: r.albums || [], playlists: r.playlists || [] };
  }

  // 榜单/歌单详情（在线歌单）
  async function getPlaylist(id, limit) {
    const r = await request('/api/playlist', { id, limit: limit || 50 }, 20000);
    if (!r || r.code !== 200) throw new Error((r && r.msg) || '获取歌单失败');
    return {
      info: r.info || {},
      tracks: (r.tracks || []).map(normalizeTrack),
    };
  }

  // 推荐歌单列表
  async function getPlaylists(cat, limit) {
    const r = await request('/api/playlists', { cat: cat || '全部', limit: limit || 15 }, 15000);
    if (!r || r.code !== 200) throw new Error((r && r.msg) || '获取推荐歌单失败');
    return r.list || [];
  }

  // 歌手热门歌曲（搜索「歌手」结果点击后用）
  async function getArtistTop(id, limit) {
    const r = await request('/api/artist', { id, limit: limit || 50 }, 15000);
    if (!r || r.code !== 200) throw new Error((r && r.msg) || '获取歌手歌曲失败');
    return (r.tracks || []).map(normalizeTrack);
  }

  // 专辑详情 + 曲目（搜索「专辑」结果点击后用）
  async function getAlbum(id) {
    const r = await request('/api/album', { id }, 15000);
    if (!r || r.code !== 200) throw new Error((r && r.msg) || '获取专辑失败');
    return {
      info: r.info || {},
      tracks: (r.tracks || []).map(normalizeTrack),
    };
  }

  /* ---------- 本地音乐 ---------- */
  async function localScan(folders) {
    const r = await request('/api/local/scan', { folders: (folders || []).join('|') }, 60000);
    if (!r || r.code !== 200) throw new Error((r && r.msg) || '扫描失败');
    return r;
  }
  async function localLibrary(filter) {
    const r = await request('/api/local/library', { filter: filter || 'all' }, 20000);
    if (!r || r.code !== 200) throw new Error((r && r.msg) || '读取本地库失败');
    return r.tracks || [];
  }
  async function localLyric(id, signal) {
    try {
      const r = await request('/api/local/lyric', { id }, 8000, signal);
      if (r && r.code === 200) return { lyric: r.lyric || '', hasLrc: r.hasLrc };
    } catch (e) {}
    return { lyric: '', hasLrc: false };
  }
  async function localAddFile(path) {
    const r = await request('/api/local/addFile', { path }, 20000);
    if (!r || r.code !== 200) throw new Error((r && r.msg) || '添加失败');
    return r.track || null;
  }
  async function localSetProgress(id, t) {
    try { await request('/api/local/progress', { id, t }, 5000); } catch (e) {}
  }
  async function localUpdateMeta(id, patch) {
    const r = await request('/api/local/meta', Object.assign({ id }, patch), 8000);
    if (!r || r.code !== 200) throw new Error((r && r.msg) || '更新失败');
    return r.track;
  }
  async function localRemove(id) {
    const r = await request('/api/local/remove', { id }, 8000);
    if (!r || r.code !== 200) throw new Error((r && r.msg) || '删除失败');
    return r.left;
  }
  async function localDuplicates() {
    const r = await request('/api/local/duplicates', {}, 15000);
    if (!r || r.code !== 200) throw new Error((r && r.msg) || '检测失败');
    return r.groups || [];
  }
  async function localCues(id) {
    const r = await request('/api/local/cues', { id }, 10000);
    if (!r || r.code !== 200) throw new Error((r && r.msg) || '读取 CUE 失败');
    return r; // { code, cues, meta }
  }
  async function localSmartPlaylists() {
    const r = await request('/api/local/smartplaylists', {}, 15000);
    if (!r || r.code !== 200) throw new Error((r && r.msg) || '生成智能歌单失败');
    return r.playlists || [];
  }

  // 音乐榜单（精选网易云榜单入口）
  async function getCharts() {
    const r = await request('/api/charts', {}, 10000);
    if (!r || r.code !== 200) throw new Error((r && r.msg) || '获取榜单失败');
    return r.charts || [];
  }

  // 识别网易云 / QQ / 酷狗 ID → 返回类型 / 信息 / 曲目列表（供「选择性导入歌单」使用）
  async function resolveImport(input, platform) {
    const r = await request('/api/import/resolve', { input: input || '', platform: platform || 'netease' }, 20000);
    if (!r || r.code !== 200) throw new Error((r && r.msg) || '识别失败');
    return {
      type: r.type || 'playlist',
      id: r.id || '',
      info: r.info || {},
      tracks: (r.tracks || []).map(normalizeTrack),
    };
  }

  // 歌词 + 翻译（歌词区「翻译」开关用）
  async function getLyricEx(id, vendor, signal) {
    try {
      const r = await request('/api/lyric', { id, vendor: vendor || getVendor() }, 8000, signal);
      if (r && r.code === 200) return { lyric: r.lyric || '', tlyric: r.tlyric || '' };
    } catch (e) {}
    return { lyric: '', tlyric: '' };
  }

  // 歌曲百科（曲风 / 语种 / 发行时间 / 发行版本 / BPM 等）
  async function getWiki(id, vendor) {
    try {
      const r = await request('/api/wiki', { id, vendor: vendor || getVendor() }, 10000);
      if (r && r.code === 200) return r.info || {};
    } catch (e) {}
    return {};
  }

  // 相似歌曲推荐
  async function getSimi(id, vendor, limit) {
    const r = await request('/api/simi', { id, vendor: vendor || getVendor(), limit: limit || 30 }, 15000);
    if (!r || r.code !== 200) throw new Error((r && r.msg) || '获取相似推荐失败');
    return (r.tracks || []).map(normalizeTrack);
  }

  global.UzzApi = { search, getSong, getUrl, getLyric, getLyricEx, getWiki, getSimi, getApiBase, getVendor, ping, downloadUrl, normalizeTrack, picProxy, suggest, getPlaylist, getPlaylists, getArtistTop, getAlbum,
    localScan, localLibrary, localLyric, localAddFile, localSetProgress, localUpdateMeta, localRemove, localDuplicates, localCues, localSmartPlaylists, getCharts, resolveImport };
})(window);
