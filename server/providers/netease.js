const { upstreamFetch: fetch } = require('../request-context');
/* ============================================================
 * netease.js — 网易云音乐 provider（weapi 加密，社区公开参数）
 * 接口：search / song / url / lyric / detail
 * ============================================================ */
const { weapi, postForm, getJson } = require('../common');

const BASE = 'https://music.163.com';
const HEAD = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Referer: 'https://music.163.com/',
  Cookie: '',
};

const TYPE_MAP = { song: 1, artist: 100, album: 10, playlist: 1000 };

// 免加密 GET 搜索（老接口，无需 weapi；POST 被拦/失败时的兜底，实测可用）
async function searchGet(keyword, type = 'song', page = 1, limit = 20) {
  const t = TYPE_MAP[type] || 1;
  const url = `${BASE}/api/search/get/web?s=${encodeURIComponent(keyword)}&type=${t}` +
    `&offset=${(page - 1) * limit}&limit=${limit}`;
  const json = (await (await getJson(url, HEAD)).json()) || {};
  const r = json.result || {};
  let list = [];
  let total = 0;
  if (type === 'artist') {
    total = r.artistCount || 0;
    (r.artists || []).forEach((a) =>
      list.push({ id: String(a.id), name: a.name, artist: a.name, album: '', pic: a.img1v1Url || '', vendor: 'netease', duration: 0 })
    );
  } else if (type === 'album') {
    total = r.albumCount || 0;
    (r.albums || []).forEach((a) =>
      list.push({ id: String(a.id), name: a.name, artist: (a.artist && a.artist.name) || '', album: a.name, pic: a.picUrl || '', vendor: 'netease', duration: 0 })
    );
  } else if (type === 'playlist') {
    total = r.playlistCount || 0;
    (r.playlists || []).forEach((p) =>
      list.push({ id: String(p.id), name: p.name, artist: (p.creator && p.creator.nickname) || '', album: '', pic: p.coverImgUrl || '', vendor: 'netease', duration: 0 })
    );
  } else {
    total = r.songCount || 0;
    (r.songs || []).forEach((s) =>
      list.push({
        id: String(s.id),
        name: s.name,
        artist: (s.artists || []).map((x) => x.name).join('/'),
        artistId: ((s.artists || [])[0] && s.artists[0].id) || '',
        album: (s.album && s.album.name) || '',
        albumId: (s.album && s.album.id) || '',
        pic: (s.album && s.album.picUrl) || '',
        vendor: 'netease',
        duration: Math.round((s.duration || 0) / 1000),
      })
    );
  }
  // GET 搜索返回的 album.picUrl 为 null → 用歌曲详情接口批量补全封面/专辑/时长
  if (type === 'song' && list.length) {
    try {
      const details = await songsDetail(list.map((x) => x.id));
      const dmap = new Map(details.map((d) => [d.id, d]));
      list.forEach((x) => {
        const d = dmap.get(x.id);
        if (d) {
          if (!x.pic && d.pic) x.pic = d.pic;
          if (!x.album && d.album) x.album = d.album;
          if (!x.duration && d.duration) x.duration = d.duration;
        }
      });
    } catch (e) { /* 补全失败不影响搜索结果 */ }
  }
  return { list, total };
}

async function search(keyword, type = 'song', page = 1, limit = 20) {
  let out = { list: [], total: 0 };
  try {
    const body = weapi({
      s: keyword,
      type: TYPE_MAP[type] || 1,
      offset: (page - 1) * limit,
      limit,
      total: true,
    });
    const res = await postForm(`${BASE}/weapi/cloudsearch/get/web`, body, HEAD);
    const json = (await res.json()) || {};
    out = parseCloudSearch(json, type);
  } catch (e) { /* weapi 失败，走 GET 兜底 */ }
  if (!out.list.length) {
    try { out = await searchGet(keyword, type, page, limit); } catch (e) { /* 双兜底都失败 */ }
  }
  return out;
}

function parseCloudSearch(json, type) {
  const r = json.result || {};
  let list = [];
  let total = 0;
  if (type === 'artist') {
    total = r.artistCount || 0;
    (r.artists || []).forEach((a) =>
      list.push({ id: String(a.id), name: a.name, artist: a.name, album: '', pic: a.picUrl || '', vendor: 'netease', duration: 0 })
    );
  } else if (type === 'album') {
    total = r.albumCount || 0;
    (r.albums || []).forEach((a) =>
      list.push({ id: String(a.id), name: a.name, artist: (a.artist && a.artist.name) || '', album: a.name, pic: a.picUrl || '', vendor: 'netease', duration: 0 })
    );
  } else if (type === 'playlist') {
    total = r.playlistCount || 0;
    (r.playlists || []).forEach((p) =>
      list.push({ id: String(p.id), name: p.name, artist: (p.creator && p.creator.nickname) || '', album: '', pic: p.coverImgUrl || '', vendor: 'netease', duration: 0 })
    );
  } else {
    total = r.songCount || 0;
    (r.songs || []).forEach((s) =>
      list.push({
        id: String(s.id),
        name: s.name,
        artist: (s.artists || []).map((x) => x.name).join('/'),
        artistId: ((s.ar || s.artists || [])[0] || {}).id || '',
        album: (s.al && s.al.name) || (s.album && s.album.name) || '',
        albumId: (s.al && s.al.id) || (s.album && s.album.id) || '',
        pic: (s.al && s.al.picUrl) || (s.album && s.album.picUrl) || '',
        vendor: 'netease',
        duration: Math.round((s.duration || 0) / 1000),
      })
    );
  }
  return { list, total };
}

async function detail(id) {
  // GET 匿名接口（weapi POST 在部分环境返回空体，v2.4.x 实测）
  let s = {};
  try {
    const c = encodeURIComponent(JSON.stringify([{ id: Number(id) }]));
    const json = (await (await getJson(`${BASE}/api/v3/song/detail?c=${c}`, HEAD)).json()) || {};
    s = (json.songs && json.songs[0]) || {};
  } catch (e) { /* 走旧接口兜底 */ }
  if (!s.name) {
    try {
      const json = (await (await getJson(`${BASE}/api/song/detail?id=${encodeURIComponent(id)}&ids=${encodeURIComponent(JSON.stringify([Number(id)]))}`, HEAD)).json()) || {};
      s = (json.songs && json.songs[0]) || {};
    } catch (e) { /* 双兜底都失败 */ }
  }
  return {
    id: String(id),
    name: s.name || '',
    artist: ((s.ar || s.artists || [])).map((x) => x.name).join('/'),
    artistId: (((s.ar || s.artists || [])[0]) || {}).id || '',
    album: (s.al && s.al.name) || (s.album && s.album.name) || '',
    albumId: (s.al && s.al.id) || (s.album && s.album.id) || '',
    pic: (s.al && s.al.picUrl) || (s.album && (s.album.picUrl || s.album.img1v1Url)) || '',
    duration: Math.round((s.dt || s.duration || 0) / 1000),
  };
}

// 播放地址 + 试听检测：freeTrialInfo 非空 = VIP 歌的试听片段（30s 左右），
// fee=1 表示 VIP 歌。上层据此决定是否走完整版兜底。
// level：standard 标准128k / ex 极高320k / lossless 无损 / hires Hi-Res
async function urlInfo(id, level) {
  const lv = level || 'standard';
  const encodeType = (lv === 'lossless' || lv === 'hires') ? 'flac' : 'mp3';
  const body = weapi({ ids: JSON.stringify([Number(id)]), level: lv, encodeType });
  const res = await postForm(`${BASE}/weapi/song/enhance/player/url/v1`, body, HEAD);
  const json = (await res.json()) || {};
  const d = (json.data && json.data[0]) || {};
  return {
    url: d.url || '',
    trial: !!d.freeTrialInfo,       // 试听片段标记
    fee: d.fee || 0,                // 0 免费 / 1 VIP / 4 购买专辑 / 8 低音质免费
    level: d.level || lv,
    duration: Math.round((d.duration || 0) / 1000), // 该地址实际音频时长（秒）
  };
}

async function url(id, level) {
  try {
    return (await urlInfo(id, level)).url;
  } catch (e) {
    return '';
  }
}

async function lyric(id) {
  let text = '';
  try {
    const body = weapi({ id: Number(id), lv: -1, kv: -1, tv: -1 });
    const res = await postForm(`${BASE}/weapi/song/lyric`, body, HEAD);
    const json = (await res.json()) || {};
    text = (json.lrc && json.lrc.lyric) || '';
    ttext = (json.tlyric && json.tlyric.lyric) || '';
  } catch (e) { /* 走 GET 兜底 */ }
  if (!text) {
    try {
      const json = (await (await getJson(`${BASE}/api/song/lyric?id=${encodeURIComponent(id)}&lv=-1&kv=-1&tv=-1`, HEAD)).json()) || {};
      text = (json.lrc && json.lrc.lyric) || '';
      ttext = (json.tlyric && json.tlyric.lyric) || '';
    } catch (e) { /* 双兜底都失败 */ }
  }
  return text;
}

// 歌词 + 翻译（歌词区「翻译」开关用）
async function lyricFull(id) {
  let lyric = '', tlyric = '';
  try {
    const body = weapi({ id: Number(id), lv: -1, kv: -1, tv: -1 });
    const res = await postForm(`${BASE}/weapi/song/lyric`, body, HEAD);
    const json = (await res.json()) || {};
    lyric = (json.lrc && json.lrc.lyric) || '';
    tlyric = (json.tlyric && json.tlyric.lyric) || '';
  } catch (e) { /* 走 GET 兜底 */ }
  if (!lyric) {
    try {
      const json = (await (await getJson(`${BASE}/api/song/lyric?id=${encodeURIComponent(id)}&lv=-1&kv=-1&tv=-1`, HEAD)).json()) || {};
      lyric = (json.lrc && json.lrc.lyric) || '';
      tlyric = (json.tlyric && json.tlyric.lyric) || '';
    } catch (e) { /* 双兜底都失败 */ }
  }
  return { lyric, tlyric };
}

// 歌曲百科：优先网易云 wiki 摘要，失败则用专辑信息兜底（发行时间 / 版本等）
async function wikiSummary(id) {
  // 1) 官方 wiki 接口（匿名可用性不稳定，失败静默走兜底）
  try {
    const j = (await (await getJson(`${BASE}/api/song/wiki/summary?id=${encodeURIComponent(id)}`, HEAD)).json()) || {};
    if (j.code === 200 && j.summary) {
      const blocks = (j.summary.blocks || []).filter((b) => b && b.entries);
      const kv = {};
      blocks.forEach((b) => (b.entries || []).forEach((en) => {
        if (en && en.name) kv[en.name] = (en.values || []).map((v) => (v && v.value) || '').filter(Boolean).join(' / ');
      }));
      if (Object.keys(kv).length) return { source: 'wiki', info: kv };
    }
  } catch (e) { /* 兜底 */ }
  // 2) 兜底：歌曲详情拿专辑 → 专辑详情拿发行时间 / 公司 / 类型
  const out = {};
  try {
    const s = await detail(id);
    out['歌手'] = s.artist || '';
    out['专辑'] = s.album || '';
    if (s.albumId) {
      const a = await albumDetail(s.albumId).catch(() => null);
      if (a) {
        const j = await (await getJson(`${BASE}/api/v1/album/${encodeURIComponent(s.albumId)}`, HEAD)).json().catch(() => null);
        const al = (j && j.album) || {};
        if (al.publishTime) out['发行时间'] = new Date(al.publishTime).toISOString().slice(0, 10);
        out['发行版本'] = al.type === 'EP' ? 'EP' : (al.type === 'SINGLE' ? '单曲' : '专辑');
        if (al.company) out['发行公司'] = al.company;
        if (a.artist) out['歌手'] = a.artist;
      }
    }
  } catch (e) { /* 尽力而为 */ }
  return { source: 'album', info: out };
}

// 相似歌曲推荐：优先官方 simiSong，匿名不可用时兜底「同歌手热门歌曲（去掉当前首）」
async function simiSong(id, limit = 30) {
  try {
    const j = (await (await getJson(`${BASE}/api/v1/discovery/simiSong?songid=${encodeURIComponent(id)}&limit=${limit}`, HEAD)).json()) || {};
    if (j.code === 200 && Array.isArray(j.songs) && j.songs.length) {
      return j.songs.map((s) => ({
        id: String(s.id), name: s.name,
        artist: ((s.ar || s.artists || [])).map((x) => x.name).join('/'),
        artistId: (((s.ar || s.artists || [])[0]) || {}).id || '',
        album: (s.al && s.al.name) || (s.album && s.album.name) || '',
        albumId: (s.al && s.al.id) || (s.album && s.album.id) || '',
        pic: (s.al && s.al.picUrl) || (s.album && s.album.picUrl) || '',
        vendor: 'netease', duration: Math.round((s.dt || s.duration || 0) / 1000),
      }));
    }
  } catch (e) { /* 兜底 */ }
  const cur = await detail(id).catch(() => null);
  if (!cur || !cur.artistId) return [];
  const tops = await artistTop(cur.artistId, limit + 5).catch(() => []);
  return tops.filter((t) => t.id !== String(id)).slice(0, limit);
}

async function song(id, quality) {
  const [d, ui, l] = await Promise.all([
    detail(id),
    urlInfo(id, quality).catch(() => ({ url: '', trial: false })),
    lyric(id),
  ]);
  return Object.assign(d, { vendor: 'netease', url: ui.url || '', trial: !!ui.trial, qualityLevel: ui.level || '', lyric: l });
}

/* ══════ 推荐页 / 搜索建议扩展（全部免加密 GET，实测可用） ══════ */

// 搜索建议：歌曲/歌手/专辑/歌单
async function suggest(keyword) {
  const json = (await (await getJson(`${BASE}/api/search/suggest/web?s=${encodeURIComponent(keyword)}`, HEAD)).json()) || {};
  const r = json.result || {};
  return {
    songs: (r.songs || []).slice(0, 8).map((s) => ({
      id: String(s.id), name: s.name,
      artist: (s.artists || []).map((a) => a.name).join('/'),
      album: (s.album && s.album.name) || '', vendor: 'netease',
    })),
    artists: (r.artists || []).slice(0, 5).map((a) => a.name),
    albums: (r.albums || []).slice(0, 5).map((a) => a.name),
    playlists: (r.playlists || []).slice(0, 5).map((p) => p.name),
  };
}

// 歌单/榜单详情：优先 v6 GET 接口（用户歌单匿名可用），
// 旧 api/playlist/detail 只对官方榜单开放，用户歌单返回 code 20001（需登录态）。
async function playlistDetail(id) {
  let p = null;
  let notFoundMsg = '';
  try {
    const j = (await (await getJson(`${BASE}/api/v6/playlist/detail?id=${encodeURIComponent(id)}&n=1000`, HEAD)).json()) || {};
    if (j.code === 200 && j.playlist && j.playlist.name) p = j.playlist;
    else if (j.code && j.code !== 200) notFoundMsg = j.msg || j.message || '';
  } catch (e) { /* v6 失败走旧接口 */ }
  if (!p) {
    try {
      const j = (await (await getJson(`${BASE}/api/playlist/detail?id=${encodeURIComponent(id)}`, HEAD)).json()) || {};
      p = j.result || {};
    } catch (e) { /* 双接口都失败 */ }
  }
  // 第三兜底：手机网页版（免加密、无登录态，部分被 API 拒掉的歌单这里仍可看）。
  // m 页内嵌 30 首 song 链接 + 标题 —— 上层会用 songsDetail 补全曲目信息。
  if (!p || !p.name) {
    try {
      const res = await fetch(`${BASE}/m/playlist?id=${encodeURIComponent(id)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1', Referer: 'https://music.163.com/' },
        signal: AbortSignal.timeout(10000),
      });
      const html = await res.text();
      const tm = html.match(/<title>([^<]*?)\s*[-–]\s*歌单\s*[-–]\s*网易云音乐/);
      if (tm && tm[1].trim() && !/网易云音乐$/.test(tm[1].trim())) {
        const ids = [...html.matchAll(/\/song\?id=(\d+)/g)].map((m) => m[1]);
        p = { name: tm[1].trim(), trackIds: [...new Set(ids)].map((x) => ({ id: x })), tracks: [], trackCount: new Set(ids).size };
      }
    } catch (e) { /* m 页也失败则维持 missing 判定 */ }
  }
  // 两个接口都拿不到歌单（且 v6 明确报“歌单不存在”）：标记 missing，
  // 上层据此返回可读提示，而不是让前端看到一串 HTTP 404
  const missing = !p || !p.name;
  if (missing && !notFoundMsg) notFoundMsg = '歌单不存在';
  const trackIds = missing ? [] : (p.trackIds || []).map((x) => (x && x.id) ? String(x.id) : String(x));
  // v6 接口返回新格式（ar 数组 / al 对象），旧接口返回 artists / album —— 两种都要兼容，
  // 否则导入歌单会出现“歌手未知、封面空白”（v2.4.x 实测 bug）
  const tracks = missing ? [] : (p.tracks || []).map((s) => ({
    id: String(s.id),
    name: s.name,
    artist: ((s.ar || s.artists || [])).map((x) => x.name).join('/'),
    artistId: (((s.ar || s.artists || [])[0]) || {}).id || '',
    album: (s.al && s.al.name) || (s.album && s.album.name) || '',
    albumId: (s.al && s.al.id) || (s.album && s.album.id) || '',
    pic: (s.al && s.al.picUrl) || (s.album && s.album.picUrl) || (s.al && s.al.pic) || '',
    vendor: 'netease',
    duration: Math.round((s.duration || 0) / 1000),
  }));
  return {
    id: String(id),
    missing,
    notFoundMsg,
    name: missing ? '' : (p.name || ''),
    cover: p.coverImgUrl || p.coverUrl || '',
    creator: (p.creator && (p.creator.nickname || p.creator.name)) || '',
    trackCount: p.trackCount || trackIds.length || tracks.length,
    playCount: p.playCount || 0,
    desc: (p.description || '').slice(0, 200),
    trackIds,
    tracks,
  };
}

// 批量歌曲详情（≤200 个/次）
async function songsDetail(ids) {
  if (!ids || !ids.length) return [];
  const qs = encodeURIComponent(JSON.stringify(ids.slice(0, 200)));
  const json = (await (await getJson(`${BASE}/api/song/detail?ids=${qs}`, HEAD)).json()) || {};
  return (json.songs || []).map((s) => ({
    id: String(s.id),
    name: s.name,
    artist: (s.artists || []).map((x) => x.name).join('/'),
    artistId: ((s.artists || [])[0] && s.artists[0].id) || '',
    album: (s.album && s.album.name) || '',
    albumId: (s.album && s.album.id) || '',
    pic: (s.album && s.album.picUrl) || '',
    vendor: 'netease',
    duration: Math.round((s.duration || 0) / 1000),
  }));
}

// 歌手热门歌曲（免加密 GET，实测可用）
async function artistTop(id, limit = 50) {
  const json = (await (await getJson(`${BASE}/api/artist/top/song?id=${encodeURIComponent(id)}&limit=${limit}`, HEAD)).json()) || {};
  return (json.songs || []).map((s) => ({
    id: String(s.id),
    name: s.name,
    artist: ((s.ar || s.artists || [])).map((x) => x.name).join('/'),
    artistId: (((s.ar || s.artists || [])[0]) || {}).id || '',
    album: (s.al && s.al.name) || (s.album && s.album.name) || '',
    albumId: (s.al && s.al.id) || (s.album && s.album.id) || '',
    pic: (s.al && s.al.picUrl) || (s.album && s.album.picUrl) || '',
    vendor: 'netease',
    duration: Math.round((s.dt || s.duration || 0) / 1000),
  }));
}

// 专辑详情（免加密 GET v1 接口，曲目在顶层 songs）
async function albumDetail(id) {
  const json = (await (await getJson(`${BASE}/api/v1/album/${encodeURIComponent(id)}`, HEAD)).json()) || {};
  const a = json.album || {};
  const tracks = (json.songs || a.songs || []).map((s) => ({
    id: String(s.id),
    name: s.name,
    artist: ((s.ar || s.artists || [])).map((x) => x.name).join('/'),
    artistId: (((s.ar || s.artists || [])[0]) || {}).id || '',
    album: (s.al && s.al.name) || (s.album && s.album.name) || a.name || '',
    albumId: (s.al && s.al.id) || (s.album && s.album.id) || a.id || '',
    pic: (s.al && s.al.picUrl) || (s.album && s.album.picUrl) || a.picUrl || '',
    vendor: 'netease',
    duration: Math.round((s.dt || s.duration || 0) / 1000),
  }));
  return {
    id: String(id),
    name: a.name || '',
    artist: (a.artist && a.artist.name) || '',
    pic: a.picUrl || '',
    desc: (a.description || '').slice(0, 200),
    tracks,
  };
}

// 高质量推荐歌单列表
async function topPlaylists(cat, limit) {
  const qs = `cat=${encodeURIComponent(cat || '全部')}&limit=${limit || 20}`;
  const json = (await (await getJson(`${BASE}/api/playlist/highquality/list?${qs}`, HEAD)).json()) || {};
  return (json.playlists || []).map((p) => ({
    id: String(p.id),
    name: p.name,
    cover: p.coverImgUrl || '',
    playCount: p.playCount || 0,
    trackCount: p.trackCount || 0,
  }));
}

module.exports = { name: 'netease', search, song, url, urlInfo, lyric, lyricFull, wikiSummary, simiSong, detail, suggest, playlistDetail, songsDetail, topPlaylists, artistTop, albumDetail };
