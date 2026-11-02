/* ============================================================
 * kuwo.js — 酷我音乐 provider
 * 说明：酷我接口需要带 kw_token cookie 与 Referer，token 为随机 32 位十六进制。
 * 如返回空地址，多半是 token / 签名策略更新，参考 README 调整。
 * ============================================================ */
const { getJson, randHex } = require('../common');

const SEARCH_URL = 'https://www.kuwo.cn/api/www/search/searchMusicBykeyWord';
const URL_API = 'https://www.kuwo.cn/url';
const HEAD_BASE = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Referer: 'https://www.kuwo.cn/',
  csrf: '',
};

function headWithToken() {
  const token = randHex(32);
  return Object.assign({}, HEAD_BASE, { Cookie: 'kw_token=' + token, csrf: token });
}

async function search(keyword, type = 'song', page = 1, limit = 20) {
  const url = `${SEARCH_URL}?key=${encodeURIComponent(keyword)}&pn=${page}&rn=${limit}`;
  const json = (await (await getJson(url, headWithToken())).json()) || {};
  const lists = ((json && json.data && json.data.list) || []);
  const list = lists.map((s) => ({
    id: String(s.rid),
    name: s.name || s.songname || '',
    artist: s.artist || s.artistname || '',
    album: s.album || s.albumname || '',
    pic: s.albumpic || s.pic || '',
    vendor: 'kuwo',
    duration: Number(s.duration) || 0,
  }));
  return { list, total: ((json && json.data && json.data.total) || list.length) };
}

async function url(id) {
  const res = await getJson(`${URL_API}?rid=${id}&type=convert_url3&br=128kmp3`, headWithToken());
  const json = (await res.json()) || {};
  return (json && json.url) || '';
}

async function lyric(id) {
  try {
    const res = await getJson(`https://www.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${id}`, headWithToken());
    const json = (await res.json()) || {};
    const lrclist = (json && json.data && json.data.lrclist) || [];
    return lrclist.map((l) => `[${fmtKuwo(l.time)}]${l.lineLyric}`).join('\n');
  } catch (e) {
    return '';
  }
}

function fmtKuwo(sec) {
  sec = Math.floor(Number(sec) || 0);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
}

async function song(id) {
  const [u, l] = await Promise.all([url(id), lyric(id)]);
  return { id, vendor: 'kuwo', name: '', artist: '', album: '', pic: '', url: u, lyric: l };
}

module.exports = { name: 'kuwo', search, song, url, lyric };
