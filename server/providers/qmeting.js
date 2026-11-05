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
// 国内 meting 备用站（2026-11-05 实测：主站 api.qijieya.cn 出现间歇性 000 拒连/
// 限流，备用站 api.injahow.cn 同协议可用且返回带签名的完整长链）。
// ⚠️ 关键：两站能力并不相同（2026-11-05 逐 type 实测）：
//   api.qijieya.cn  → 支持 search / url / lyric / pic（完整协议）
//   api.injahow.cn  → 仅支持 url（type=search 返回 {"error":"unknown type"}）
// 因此必须按能力分流：搜索/歌词只走主站，解析（type=url）才允许降级到备用站。
// 曾经的 bug：把备用站的 {"error":"unknown type"} 当 HTTP 200 成功响应，
// 导致搜索静默返回 0 条（用户看到「搜不到歌」），且 lastGoodBase 被污染。
const BASES = [
  // support 列出该站真正支持的 type；fetchAny 会据此筛选，避免拿不支持的站兜底
  { base: BASE, support: ['search', 'url', 'lyric', 'pic', 'song'] },
  { base: 'https://api.injahow.cn/meting/', support: ['url'] },
];
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// 依次尝试各 meting 站，返回首个「真正成功」的响应体。
// 主站会间歇性 000（连接被重置/限流），此时自动降级到备用站。
// lastGoodBase 记住最近一次成功的节点，后续生成的直链优先指向它（减少抖动）。
// ⚠️ 只有通过 validate 校验的响应才会更新 lastGoodBase —— 否则一个「HTTP 200
//    但内容是错误 JSON」的节点会把后续所有直链都带偏。
let lastGoodBase = null;
// 记录每个 type 最近一次成功的节点（搜索与解析分开记，避免互相污染）
const lastGoodByType = new Map();
async function fetchAny(path, { json = false, type = '', validate = null, keepBody = false } = {}) {
  let lastErr = null;
  // 只保留支持该 type 的节点；lastGoodBase 优先，但必须同样支持该 type
  const candidates = BASES.filter((x) => !type || x.support.includes(type));
  const usable = candidates.filter((x) => x.base === lastGoodBase);
  const order = [...usable, ...candidates.filter((x) => x.base !== lastGoodBase)];
  for (const node of order) {
    const base = node.base;
    const u = base + path;
    // 单节点最多试 2 次：meting 公共实例会间歇性返回空体/限流（实测同一秒两次
    // 调用一次成功一次空），不重试会让「搜得到却返回 0 条」随机发生。
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(u, { headers: { 'User-Agent': UA }, redirect: 'follow' });
        if (!res.ok) { lastErr = new Error('meting ' + res.status); continue; }
        if (!json) {
          if (validate && !validate(res)) { lastErr = new Error('meting invalid response'); continue; }
          // 302 目标已是 CDN 音频（实测 12MB），这里只需要 headers 与最终 URL，
          // 主动丢弃响应体，避免挂着一个大流白占连接（fetch 不会自动释放）。
          // ⚠️ 但调用方要读 body 时（type=lrc 歌词是纯文本）必须 keepBody，
          //    否则 body 被 cancel 后 res.text() 永远为空。
          if (!keepBody) {
            try { if (res.body && typeof res.body.cancel === 'function') await res.body.cancel(); } catch (e) { /* 忽略 */ }
          }
          lastGoodBase = base;
          if (type) lastGoodByType.set(type, base);
          return res;
        }
        const body = await res.json();
        // JSON 形状校验：meting 的错误响应是 HTTP 200 + {"error":"..."}，
        // 不校验就会把「不支持该 type 的站」当成成功（→ 搜索静默 0 条）。
        if (validate && !validate(body)) { lastErr = new Error('meting invalid json'); continue; }
        lastGoodBase = base;
        if (type) lastGoodByType.set(type, base);
        return body;
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr || new Error('meting unavailable');
}

// 生成「实时解析接口」地址：播放器请求它时由 meting 302 到当下新鲜的 CDN 直链。
// 该地址永不过期（不像 CDN 直链约 1 小时即 403）。
// 按 type 选节点：解析必须用支持 type=url 的站。
function liveUrl(id, type = 'url', server = 'netease') {
  const candidates = BASES.filter((x) => x.support.includes(type));
  const byType = lastGoodByType.get(type);
  const base = (byType && candidates.some((x) => x.base === byType) && byType)
    || (lastGoodBase && candidates.some((x) => x.base === lastGoodBase) && lastGoodBase)
    || (candidates[0] && candidates[0].base)
    || BASE;
  return base + '?type=' + type + '&id=' + encodeURIComponent(id) + '&server=' + server;
}

// 支持的平台（server 参数）：netease=网易云 / tencent=QQ音乐 / kugou=酷狗
const SERVERS = ['netease', 'tencent', 'kugou'];
function normalizeServer(vendor) {
  const v = String(vendor || 'netease').toLowerCase();
  if (v === 'qq' || v === 'tencent') return 'tencent';
  if (v === 'kg' || v === 'kugou') return 'kugou';
  if (v === 'netease' || v === '163' || v === 'auto') return 'netease';
  return SERVERS.includes(v) ? v : 'netease';
}

// 从 meting 返回的 url/lrc/pic 接口链接中解析出歌曲 ID
// ⚠️ ID 不一定是纯数字：网易是数字 id，QQ 音乐是 songmid（含字母），
//    酷狗是 32 位 hash（含字母）——旧正则 [?&]id=(\d+) 会把 QQ/酷狗全部丢掉。
function idFromUrl(u) {
  const m = /[?&]id=([A-Za-z0-9_-]+)/.exec(String(u || ''));
  return m ? m[1] : '';
}

// 把 meting 的 pic 解析接口地址转成可直接 <img src> 的图片直链。
// （直接用接口地址也能显示，但带查询串的图片在部分安卓 WebView 上会被风控，
//   转成 CDN 直链更稳、也能被 <img> 缓存。）
function directPic(server, rawPic) {
  const u = String(rawPic || '');
  if (!u) return '';
  if (/^https?:\/\/.*\.(jpg|jpeg|png|webp)(\?|$)/i.test(u)) return u.replace(/^http:/, 'https:');
  const pid = idFromUrl(u);
  if (!pid) return '';
  if (server === 'tencent') return 'https://y.gtimg.cn/music/photo_new/T002R500x500M000' + pid + '.jpg';
  if (server === 'kugou') return '';
  // 网易：pic id 即图片主键
  return 'https://p1.music.126.net/' + pid + '/' + pid + '.jpg';
}

// 搜索：type=search，响应数组 [{name, artist, url, pic, lrc}]
// v3.5.0：支持多平台（server=netease / tencent / kugou）。
// 背景（用户实测反馈）：网易云未登录搜索接口会返回「降级结果集」——
// 搜「晴天」只给 RyaVocal/纪钧瀚 等翻唱版本，周杰伦原唱根本不出现；
// 而 meting 的 server=tencent 走的是 QQ 音乐的真实索引，搜「晴天 周杰伦」
// 返回的全是周杰伦本人曲目。两者合并即可同时拿到「正确歌手」与「可播曲目」。
async function search(vendor, keyword, page = 1, limit = 20) {
  const server = normalizeServer(vendor);
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
    const u = `?type=search&id=${encodeURIComponent(songName)}&limit=${fetchLimit}&server=${server}`;
    // validate：必须是数组才算成功（meting 的错误响应是 HTTP 200 + {"error":"..."}）
    const arr = await fetchAny(u, {
      json: true,
      type: 'search',
      validate: (b) => Array.isArray(b) && b.length > 0,
    });
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
        pic: directPic(server, s.pic),
        // 实时解析接口地址（非 CDN token）：手机播放那一刻再请求，必得新鲜直链。
        // 统一改写到本站可用 meting 节点，避免上游返回的节点已挂导致 404/000。
        // 注意用 liveUrl(id,'url')：搜索节点（qijieya）与解析节点可能不同，
        // 不能把「搜索用的节点」当成「解析用的节点」。
        url: id ? liveUrl(id, 'url', server) : (s.url || ''),
        lyric: '',
        vendor: server,
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

// 歌词：type=lrc。meting 支持 netease / tencent / kugou 三种 server，
// 这是「网络歌曲没有歌词 → 自动补歌词」的主力通道（QQ 音乐歌词覆盖率很高）。
async function lyric(vendor, id) {
  if (!id) return '';
  const server = normalizeServer(vendor);
  try {
    const res = await fetchAny(`?type=lrc&id=${encodeURIComponent(id)}&server=${server}`, {
      type: 'lyric',
      keepBody: true,
      validate: (r) => {
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        return !ct.includes('application/json');
      },
    });
    const text = await res.text();
    const t = String(text || '').trim();
    if (!t || /^\{/.test(t)) return '';
    return t;
  } catch (e) {
    return '';
  }
}

// 封面：type=pic → 转成 CDN 直链
async function pic(vendor, id) {
  if (!id) return '';
  const server = normalizeServer(vendor);
  const raw = server + '|' + id;
  return directPic(server, server + '?type=pic&id=' + encodeURIComponent(id)) || raw;
}

// 解析：type=url 按网易 ID 实时直出 CDN mp3。
// ⚠️ 关键（2026-11-05 真机实测修正）：
//   跟随 302 拿到的网易 CDN 直链带有时间戳签名，实测约 1 小时后即 403
//   （ERROR_CODE_IO_BAD_HTTP_STATUS code=4）。服务端把这种一次性直链缓存后
//   下发给手机，手机播放时必然已过期 → 全线播放失败。
//   因此这里返回「实时解析接口」本体（meting URL），由播放器在真正播放的那一刻
//   再请求一次，拿到当下新鲜的 302 目标 → 永远不会过期。
//   代价是播放时多一次 302 跳转（国内 CDN，毫秒级），换来 100% 可播。
async function url(vendor, id) {
  const server = normalizeServer(vendor);
  if (!id) return '';
  try {
    // 只取 302 目标做可用性校验（探测当前直链是否真的可播），但返回的仍是实时接口地址。
    // type='url' → 允许降级到备用站（两站都支持 type=url）
    const res = await fetchAny(`?type=url&id=${encodeURIComponent(id)}&server=${server}`, {
      type: 'url',
      validate: (r) => {
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        const target = r.url || '';
        if (!/^https?:\/\//i.test(target)) return false;
        return ct.includes('audio') || ct.includes('octet-stream') || /\.mp3(\?|$)/i.test(target);
      },
    });
    return liveUrl(id, 'url', server);
  } catch (e) {
    return '';
  }
}

// 供服务端内部使用：立即解析出当下可播的 CDN 直链（不走代理、不缓存）
async function directUrl(vendor, id) {
  const server = normalizeServer(vendor);
  if (!id) return '';
  try {
    const res = await fetchAny(`?type=url&id=${encodeURIComponent(id)}&server=${server}`, {
      type: 'url',
      validate: (r) => /^https?:\/\//i.test(r.url || ''),
    });
    return res.url || '';
  } catch (e) {
    return '';
  }
}

module.exports = { name: 'qmeting', search, url, directUrl, lyric, pic, normalizeServer, liveUrl, directPic };
