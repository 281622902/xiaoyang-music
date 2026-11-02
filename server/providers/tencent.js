/* ============================================================
 * tencent.js — QQ 音乐 provider
 * search 走 client_search_cp（免签），url 走 musicu.fcg 的 vkey 接口。
 * 说明：QQ 的 vkey 签名与 lyric 接口会随官方策略变化，如失效请在 README 中按提示更新。
 * ============================================================ */
const { postForm, getJson, md5, randHex } = require('../common');

const SEARCH_URL = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp';
const MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const HEAD = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Referer: 'https://y.qq.com/',
};

function unescapeHtml(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function search(keyword, type = 'song', page = 1, limit = 20) {
  const url =
    `${SEARCH_URL}?ct=24&qqmusic_ver=1298&new_json=1&remoteplace=txt.yqq.top` +
    `&searchid=0&t=0&aggr=1&cr=1&catZhida=1&lossless=1&flag_qc=0` +
    `&p=${page}&n=${limit}&w=${encodeURIComponent(keyword)}&cv=4747474&format=json`;
  const json = (await (await getJson(url, HEAD)).json()) || {};
  let list = [];
  let total = 0;
  if (type === 'artist') {
    (json && json.data && json.data.zhida && json.data.zhida.singerid
      ? [{ id: json.data.zhida.singerid, name: json.data.zhida.singername, pic: json.data.zhida.singerpic }]
      : []
    ).forEach((a) => list.push({ id: String(a.id), name: a.name, artist: a.name, album: '', pic: a.pic || '', vendor: 'tencent', duration: 0 }));
  } else {
    const songs = (json && json.data && json.data.song && json.data.song.list) || [];
    total = (json && json.data && json.data.song && json.data.song.totalnum) || songs.length;
    songs.forEach((s) => {
      const albummid = s.albummid || '';
      list.push({
        id: s.songmid,
        name: unescapeHtml(s.songname),
        artist: (s.singer || []).map((x) => unescapeHtml(x.name)).join('/'),
        album: unescapeHtml(s.albumname || ''),
        pic: albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albummid}.jpg` : '',
        vendor: 'tencent',
        duration: Number(s.interval) || 0,
      });
    });
  }
  return { list, total };
}

async function url(id) {
  const guid = randHex(32);
  const data = {
    req: { module: 'CDN.SrfCdnDispatchServer', method: 'GetCdnDispatch', param: { guid, calltype: 0, userip: '' } },
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param: { guid, songmid: [id], songtype: [0], uin: '0', loginflag: 1, platform: '20' },
    },
    comm: { uin: 0, format: 'json', ct: 24, cv: 0 },
  };
  const sign = md5('CJBPACrRuNy6wG2X' + JSON.stringify(data));
  const qs =
    'loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf8&notice=0' +
    '&platform=yqq.json&needNewCode=0&uin=0&cid=205361747&sign=' + sign;
  const res = await getJson(`${MUSICU_URL}?${qs}`, {
    ...HEAD,
    'Content-Type': 'application/json',
  });
  const json = (await res.json()) || {};
  const info = json && json.req_0 && json.req_0.data && json.req_0.data.midurlinfo && json.req_0.data.midurlinfo[0];
  const purl = info && info.purl;
  if (!purl) return '';
  return (purl.startsWith('http') ? '' : 'https://isure.stream.qqmusic.qq.com/') + purl;
}

async function lyric(id) {
  try {
    const url =
      `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${id}` +
      `&g_tk=5381&format=json&nobase64=1&platform=yqq.json&needNewCode=0`;
    const res = await getJson(url, HEAD);
    const json = (await res.json()) || {};
    return (json && json.lyric) || '';
  } catch (e) {
    return '';
  }
}

async function detail(id) {
  // 用搜索接口的补充信息较麻烦，这里直接返回基础结构，pic/name 由前端从搜索结果带入
  return { id, vendor: 'tencent', name: '', artist: '', album: '', pic: '', duration: 0 };
}

async function song(id) {
  const [u, l] = await Promise.all([url(id), lyric(id)]);
  const d = await detail(id);
  return Object.assign(d, { url: u, lyric: l });
}

// QQ 音乐歌单详情（fcg 接口，公开歌单免登录可用）
// id 为 disstid（歌单数字 ID），可从分享链接 https://y.qq.com/.../taoge.html?id=XXX 提取
async function playlistDetail(id) {
  const u = 'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0' +
    `&disstid=${encodeURIComponent(id)}&format=json&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`;
  const res = await getJson(u, HEAD);
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch (e) {
    // 某些场景返回 jsonp/带前缀，做一次宽松解析
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { j = JSON.parse(m[0]); } catch (e2) { /* 放弃 */ } }
  }
  const cl = j && j.cdlist && j.cdlist[0];
  if (!cl || !cl.disstid) return { id: String(id), missing: true, notFoundMsg: '歌单不存在或为私密歌单（QQ音乐仅支持导入公开歌单）', tracks: [], trackIds: [] };
  const tracks = (cl.songlist || []).slice(0, 500).map((s) => ({
    id: String(s.songmid || s.songid || ''),
    name: unescapeHtml(s.songname || s.songtitle || ''),
    artist: (s.singer || []).map((x) => unescapeHtml(x.name)).join('/'),
    album: unescapeHtml(s.albumname || ''),
    albumId: s.albummid || '',
    pic: s.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.albummid}.jpg` : '',
    vendor: 'tencent',
    duration: Math.round(s.interval || 0),
  })).filter((t) => t.id && t.name);
  return {
    id: String(id),
    name: unescapeHtml(cl.dissname || cl.title || ''),
    cover: (cl.logo || cl.imgurl || '').replace(/^http:/, 'https:'),
    creator: (cl.creator && (cl.creator.name || cl.creator.nick)) || '',
    desc: unescapeHtml(cl.desc || '').slice(0, 200),
    trackCount: cl.songnum || tracks.length,
    playCount: cl.visitnum || 0,
    trackIds: tracks.map((t) => t.id),
    tracks,
  };
}

module.exports = { name: 'tencent', search, song, url, lyric, detail, playlistDetail };
