/* ============================================================
 * kugou.js — 酷狗音乐 provider
 * search 走 song_search_v2（免签），url/lyric/pic 走 play/getdata（需 signature）。
 * 签名算法：MD5( SECRET + 排序拼接的 params(不含 r/signature) + SECRET )，小写。
 * ============================================================ */
const crypto = require('crypto');
const { getJson } = require('../common');

const SEARCH_URL = 'https://songsearch.kugou.com/song_search_v2';
const GETDATA_URL = 'https://www.kugou.com/yy/index.php';
const SECRET = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
const HEAD = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Referer: 'https://www.kugou.com/',
};

function md5(s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

function unescapeHtml(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

function kugouSign(params) {
  const keys = Object.keys(params).filter((k) => k !== 'signature' && k !== 'r').sort();
  let str = '';
  for (const k of keys) str += k + '=' + params[k];
  return md5(SECRET + str + SECRET);
}

function getdataParams(hash) {
  const p = {
    r: 'play/getdata',
    appid: '1014',
    clientver: '20000',
    clienttime: String(Date.now()),
    dfid: '-',
    mid: md5(String(Date.now() + Math.random())).slice(0, 16),
    platid: '4',
    srcappid: '2919',
    token: '',
    userid: '0',
    hash,
  };
  p.signature = kugouSign(p);
  return p;
}

async function search(keyword, type = 'song', page = 1, limit = 20) {
  const url =
    `${SEARCH_URL}?keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${limit}` +
    `&platform=WebFilter&userid=-1&clientver=&filter=2&iscorrection=1&privilege_filter=0`;
  const json = (await (await getJson(url, HEAD)).json()) || {};
  const lists = ((json && json.data && json.data.lists) || []);
  const list = lists.map((s) => ({
    id: s.FileHash,
    name: unescapeHtml(s.SongName),
    artist: unescapeHtml(s.SingerName),
    album: unescapeHtml(s.AlbumName || ''),
    albumId: String(s.AlbumID || ''),
    // 封面：搜索接口直接给 AlbumImage/Image（{size} 占位需替换），
    // 缺失时用 AlbumID 拼酷狗标准图地址——搜索结果有封面是用户明确诉求
    // （原实现 pic 恒为空，导致列表里全是灰块，只能点进去播放才有图）。
    pic: kugouPic(s),
    vendor: 'kugou',
    duration: Number(s.Duration) || 0,
  }));
  return { list, total: ((json && json.data && json.data.total) || list.length) };
}

// 酷狗封面直链：优先用接口给的字段，其次按 AlbumID 拼标准地址
function kugouPic(s) {
  const raw = String((s && (s.AlbumImage || s.Image)) || '');
  if (raw) return raw.replace('{size}', '400').replace(/^http:/, 'https:');
  const albumId = String((s && s.AlbumID) || '');
  if (albumId) return `https://c1.kugou.com/albumcover/${albumId}.jpg`;
  return '';
}

async function getdata(hash) {
  const p = getdataParams(hash);
  const qs = Object.keys(p).map((k) => `${k}=${encodeURIComponent(p[k])}`).join('&');
  const url = `${GETDATA_URL}?${qs}`;
  const json = (await (await getJson(url, HEAD)).json()) || {};
  const d = ((json && json.data && json.data[0]) || (json && json.data) || {});
  let playUrl = d.play_url || '';
  if (playUrl && !playUrl.startsWith('http')) playUrl = 'https://' + playUrl.replace(/^\/+/, '');
  return { url: playUrl, pic: d.img || '', lyric: d.lyrics || '', name: d.songName || '', singer: d.singerName || '', album: d.album_name || '' };
}

async function url(id) {
  const g = await getdata(id);
  return g.url;
}
async function lyric(id) {
  const g = await getdata(id);
  return g.lyric;
}

async function song(id) {
  const g = await getdata(id);
  return {
    id,
    vendor: 'kugou',
    name: g.name,
    artist: g.singer,
    album: g.album,
    pic: g.pic,
    url: g.url,
    lyric: g.lyric,
  };
}

// 酷狗歌单详情：mobiles.kugou.com v5 special/song（免签实测可用），id 为 specialid（数字）。
// 分页抓全（每页 300，最多 3 页 = 900 首）。
const KG_COMMON = 'appid=1005&clientver=1014&mid=279255091273217012783691885049638077201&dfid=2j0D4U4xLZ2g3Z1On011J0YX&version=9206';
async function playlistDetail(id) {
  const tracks = [];
  let total = 0, name = '', cover = '', creator = '';
  for (let page = 1; page <= 3; page++) {
    const u = `https://mobiles.kugou.com/api/v5/special/song?${KG_COMMON}&specialid=${encodeURIComponent(id)}&pagesize=300&page=${page}`;
    const json = (await (await getJson(u, HEAD)).json()) || {};
    const d = json.data || {};
    if (page === 1 && (!d || !Array.isArray(d.info))) {
      return { id: String(id), missing: true, notFoundMsg: '歌单不存在或为私密歌单（酷狗仅支持导入公开歌单的 specialid）', tracks: [], trackIds: [] };
    }
    total = d.total || total;
    name = name || d.specialname || '';
    cover = cover || (d.imgurl || d.img || '').replace('{size}', '240').replace(/^http:/, 'https:');
    creator = creator || (d.nickname || '');
    (d.info || []).forEach((s) => {
      const fn = String(s.filename || '');
      const dash = fn.indexOf(' - ');
      const nm = s.name || s.songname || (dash > 0 ? fn.slice(dash + 3) : fn);
      tracks.push({
        id: s.hash || '',
        name: nm,
        artist: s.singername || (dash > 0 ? fn.slice(0, dash) : ''),
        album: s.album_name || s.remark || '',
        pic: s.cover ? String(s.cover).replace('{size}', '240').replace(/^http:/, 'https:') : (s.sqhash ? '' : ''),
        vendor: 'kugou',
        duration: Math.round(s.duration || s.timelen || 0),
      });
    });
    if (!d.info || !d.info.length || tracks.length >= total) break;
  }
  if (!tracks.length) return { id: String(id), missing: true, notFoundMsg: '歌单里没有可导入的歌曲', tracks: [], trackIds: [] };
  return {
    id: String(id),
    name: name || ('酷狗歌单 ' + id),
    cover,
    creator,
    desc: '',
    trackCount: total || tracks.length,
    playCount: 0,
    trackIds: tracks.map((t) => t.id),
    tracks,
  };
}

module.exports = { name: 'kugou', search, song, url, lyric, playlistDetail };
