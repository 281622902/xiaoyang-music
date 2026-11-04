const { upstreamFetch: fetch } = require('../request-context');
/* ============================================================
 * qmeting.js — 国内公开 meting 完整实例（api.qijieya.cn）
 * 作用：海外后端（Render 新加坡）直连网易/酷狗/QQ 的原生接口
 *       被国内平台 IP 风控集体拦截（2026-11-05 真机实测），
 *       本 provider 把搜索与解析全部改走国内可直连的 meting 聚合源。
 * 实测：type=search 613ms 返回直链；type=url 直出 12.8MB 完整 MP3。
 * 注意：meting url 是「实时解析接口」而非 CDN token，永不过期；
 *       手机端直接播此链接 = 国内 4G 直连国内 CDN，全程不经海外后端。
 * ============================================================ */
const BASE = 'https://api.qijieya.cn/meting/';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// meting 仅支持 netease 源（qijieya 部署）；其他源直接跳过
function onlyNetease(vendor) {
  return vendor === 'netease' || vendor === 'auto';
}

// 从 meting 返回的 url/lrc/pic 接口链接中解析出歌曲 ID
function idFromUrl(u) {
  const m = /[?&]id=(\d+)/.exec(String(u || ''));
  return m ? m[1] : '';
}

// 搜索：type=search，响应数组 [{name, artist, url, pic, lrc}]
async function search(vendor, keyword, page = 1, limit = 20) {
  if (!onlyNetease(vendor)) return { list: [], total: 0 };
  const kw = String(keyword || '').trim();
  if (!kw) return { list: [], total: 0 };
  try {
    // meting 无页码概念：用 page 做偏移截取（搜索默认多取一些再切页）
    const fetchLimit = Math.min(100, limit * (page + 1));
    // 关键词拆解："周杰伦 晴天" → 歌手=周杰伦 歌名=晴天；单段时全部当歌名。
    // meting 对整串搜索的分词质量差（原版常排不上），拆解后本地做匹配优先排序。
    const parts = kw.split(/\s+/).filter(Boolean);
    const songName = parts.length > 1 ? parts[parts.length - 1] : kw;
    const artistHint = parts.length > 1 ? parts.slice(0, -1).join(' ').toLowerCase() : '';
    const u = `${BASE}?type=search&id=${encodeURIComponent(songName)}&limit=${fetchLimit}&server=netease`;
    const res = await fetch(u, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!res.ok) return { list: [], total: 0 };
    const arr = await res.json();
    if (!Array.isArray(arr)) return { list: [], total: 0 };
    const list = arr.map((s) => {
      const id = idFromUrl(s.url);
      return {
        id: id || '',
        name: s.name || '',
        artist: s.artist || '',
        artistId: '',
        album: '',
        albumId: '',
        pic: s.pic || '',
        // 直播直链：meting 实时解析接口（手机直连它即播，不经后端转流）
        url: s.url || '',
        lyric: '',
        vendor: 'netease',
        duration: 0,
      };
    }).filter((x) => x.id && x.name);
    // 匹配优先排序：①歌名含 songName 且歌手匹配 artistHint ②歌名含 songName ③其余
    const nameHit = (t) => t.name.includes(songName);
    const artistHit = (t) => artistHint && (t.artist || '').toLowerCase().includes(artistHint);
    list.sort((a, b) => (artistHit(b) - artistHit(a)) || (nameHit(b) - nameHit(a)));
    const start = (page - 1) * limit;
    const paged = list.slice(start, start + limit);
    return { list: paged, total: list.length > start + limit ? start + paged.length + 1 : start + paged.length };
  } catch (e) {
    return { list: [], total: 0 };
  }
}

// 解析：type=url 按网易 ID 实时直出 CDN mp3（跟随 302 后即真实直链）
async function url(vendor, id) {
  if (!onlyNetease(vendor) || !id) return '';
  try {
    const u = `${BASE}?type=url&id=${encodeURIComponent(id)}&server=netease`;
    const res = await fetch(u, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!res.ok) return '';
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    // 正常：302 跟随到 mp3，content-type 为 audio/mpeg
    if (ct.includes('audio') || ct.includes('octet-stream')) return res.url || '';
    return '';
  } catch (e) {
    return '';
  }
}

module.exports = { name: 'qmeting', search, url };
