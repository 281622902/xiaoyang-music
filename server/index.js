const { upstreamFetch: fetch, runRequest } = require('./request-context');
// 原生 fetch（绕过公网模式音源白名单网关）：版本检查代理访问 Supabase 用——
// 它不是音乐音源，不应被 mediaURL 许可校验拦截。
const rawFetch = globalThis.fetch.bind(globalThis);
/* ============================================================
 * index.js — 音乐解析后端 + 静态资源服务（零依赖 Node）
 * 同时承担两件事：
 *   1) 提供 /api/* 音乐解析接口（music-api 兼容）
 *   2) 直接托管前端 app/ 目录（桌面版 Electron 内同进程运行）
 *
 * 启动：  node server/index.js   （端口可用 PORT 环境变量覆盖，默认 3000）
 * ============================================================ */
const http = require('http');
const fs = require('fs');
const { Readable } = require('stream');
const { pipeline } = require('node:stream/promises');
const path = require('path');

const netease = require('./providers/netease');
const tencent = require('./providers/tencent');
const kugou = require('./providers/kugou');
const kuwo = require('./providers/kuwo');
const mock = require('./providers/mock');
const aggregate = require('./providers/aggregate');
const gds = require('./providers/gds');
const qmeting = require('./providers/qmeting');
const localLib = require('./local-lib');
const localAccess = require('./local-access');
const { audioExtension } = require('./audio-format');
const { transferAudio } = require('./media-transfer');
const accounts = require('./accounts');

const USE_MOCK = process.env.MOCK === '1';
const PROVIDERS = USE_MOCK
  ? { netease: mock, tencent: mock, kugou: mock, kuwo: mock, mock }
  : { netease, tencent, kugou, kuwo };
const DEFAULT_VENDOR = USE_MOCK ? 'mock' : (process.env.DEFAULT_VENDOR || 'netease');
const PORT = process.env.PORT || 3000;
const APP_DIR = process.env.UZZ_APP_DIR
  ? path.resolve(process.env.UZZ_APP_DIR)
  : path.resolve(__dirname, '..', 'app');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const publicMode=process.env.XY_PUBLIC_API==='1';
const publicGate=publicMode?require('./public-api').createGate():null;

function getProvider(v) {
  return PROVIDERS[v] || PROVIDERS[DEFAULT_VENDOR] || netease;
}

// ── 完整版校验：探测音频字节数，估算时长，拦掉 30s/45s 试听片段──
// 用 Range: bytes=0-0 请求只拿响应头，几乎零开销。
// 必须带超时：网络慢/ CDN 不响应时，串行兜底链里每层探测都可能长挂，
// 叠加起来会让前端「点了播放半天没反应」。
// 超时可经环境变量放宽：海外部署（如 Render 美西/新加坡）到国内音源 RTT 大，
// 默认 3.5s 会把网易搜索/探测全部误判为超时 → 搜索单曲掉到酷狗、
// 歌手/专辑/歌单搜索全空、解析兜底链全灭（真机 4G 实测踩坑）。
// render.yaml 已为云端部署设置 XY_SEARCH_TIMEOUT=8000 / XY_PROBE_TIMEOUT=6000。
const PROBE_TIMEOUT = Number(process.env.XY_PROBE_TIMEOUT) || 3500;
// 播放地址兜底链整体时限（毫秒）：跨音源逐个 search+url+probe 串行执行，
// 网络差时可能十几秒。限时后快速失败 → 前端给可读提示，用户可重试或换音源。
const RESOLVE_TOTAL_TIMEOUT = Number(process.env.XY_RESOLVE_TIMEOUT) || 18000;
async function probeAudioLen(u) {
  if (!u) return -1;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT);
    let r;
    try {
      r = await fetch(u, {
        headers: { Range: 'bytes=0-0', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36' },
        redirect: 'follow',
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const cr = r.headers.get('content-range');
    if (cr) return Number(cr.split('/')[1]) || -1;
    return Number(r.headers.get('content-length')) || -1;
  } catch (e) {
    return -1;
  }
}

// len=字节数；expect=歌曲真实时长（秒，来自搜索/详情元数据）。
// 判定：完整 mp3 至少 128kbps → 期望时长 × 0.9 × 16KB/s 为下限；
// 试听片段最多 45s × 320kbps ≈ 1.8MB，远低于该下限。
function isFullAudio(len, expect) {
  if (len <= 0) return true; // 拿不到长度信息（部分 CDN 不支持 Range），放行
  if (expect > 60) return len >= expect * 0.9 * 16000;
  return len >= 600000; // 未知时长：≥600KB 大概率非试听
}

// 多音源播放兜底：主音源取不到地址、或拿到的是试听片段时，
// 依次走 聚合源 → GDStudio 完整版 → 跨音源按歌名+歌手匹配（同样校验完整版）。
const VENDOR_ORDER = ['netease', 'tencent', 'kugou', 'kuwo'];
// 音质档位 → GDStudio br 映射（netease level 档位无法直连时用聚合源兜底）
const QUALITY_BR = { standard: '128', ex: '320', lossless: '999', hires: '999' };
// 防御性加固：上游任何环节返回 http:// 明文音频地址时统一重写为 https://，
// 避免安卓 WebView / 原生播放层因明文策略静默拦截（网易云等音乐 CDN 均支持 https）
function forceHttps(u) {
  return typeof u === 'string' ? u.replace(/^http:\/\//i, 'https://') : u;
}

// 跨源找「网易同曲」并解析完整版地址（酷狗/酷我/QQ 曲目的救生艇）。
// 候选搜索：国内 meting 聚合源（api.qijieya.cn）优先——海外可达且不受 GDStudio 限流影响；
// 候选解析：meting type=url 实时直链优先（国内基础设施），GDStudio 兜底。
// 只用歌名搜索（"歌名+歌手"整串搜索分词质量差），按歌手过滤，最多试 3 个候选。
async function gdsNeteaseUrl(name, artist, quality) {
  const nm = (name || '').trim();
  if (!nm) return '';
  let list = [];
  try { list = (await qmeting.search('netease', nm, 1, 10)).list || []; } catch (e) { /* 走 GDStudio */ }
  if (!list.length) {
    try { list = (await gds.search('netease', nm, 1, 10)).list || []; } catch (e) { /* 空 */ }
  }
  if (!list.length) return '';
  const an = (artist || '').trim().toLowerCase();
  const pick = list.filter((c) => c.name.includes(nm) || nm.includes(c.name));
  const strict = an ? pick.filter((c) => {
    const cn = (c.artist || '').toLowerCase();
    return cn.split('/').some((part) => part && (an.includes(part) || part.includes(an)));
  }) : pick;
  const candidates = [...(strict.length ? strict : pick)].slice(0, 3);
  for (const c of candidates) {
    try {
      const mu = await qmeting.url('netease', c.id);
      if (mu) return mu;
    } catch (e) { /* 试 GDStudio */ }
    try {
      const cu = await gds.url('netease', c.id, QUALITY_BR[quality] || '320');
      if (cu) return cu;
    } catch (e) { /* 试下一候选 */ }
  }
  // 双聚合源都不可用时的最后兜底：injahow meting 搜索直链（精简部署，命中率低但无害）
  return metingSearchUrl(nm, an);
}

// 按歌手名返回其歌曲列表（海外聚合分类专用：name:/artistlist: 前缀共用），
// 走国内 meting 搜索。注意：qmeting 对「歌手名」的搜索结果是翻唱曲居多
//（artist=翻唱者），严格过滤常清零——优先 artist 匹配，不足 5 条放宽为全量，
// 保证界面始终有内容（聊胜于无原则）。结果自带实时直链（可播）。
async function artistTracksByName(name, limit) {
  const nm = String(name || '').trim();
  if (!nm) return [];
  let all = [];
  try {
    const r = await withTimeout(qmeting.search('netease', nm, 1, 100), SEARCH_TIMEOUT * 2);
    all = r.list || [];
  } catch (e) { /* 走 GDStudio */ }
  // qmeting 对个别热词偶发空结果（上游波动实测）：GDStudio 网易搜索兜底
  if (!all.length) {
    try {
      const r2 = await withTimeout(gds.search('netease', nm, 1, 100), SEARCH_TIMEOUT * 2);
      all = r2.list || [];
    } catch (e) { /* 空 */ }
  }
  const lk = nm.toLowerCase();
  const strict = all.filter((t) => (t.artist || '').toLowerCase().includes(lk));
  return (strict.length >= 5 ? strict : all).slice(0, Math.max(1, limit || 50));
}

// meting 搜索同曲并直接返回其携带的 mp3 直链（不落库、不解析，拿来即用）
async function metingSearchUrl(name, artist) {  const nm = (name || '').trim();
  if (!nm) return '';
  try {
    const u = 'https://api.injahow.cn/meting/?format=json&server=netease&type=search&id=' + encodeURIComponent(nm);
    const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36' }, redirect: 'follow' });
    if (!res.ok) return '';
    const arr = await res.json();
    if (!Array.isArray(arr)) return '';
    const an = (artist || '').trim().toLowerCase();
    for (const s of arr) {
      const sa = String(s.author || s.artist || '').toLowerCase();
      if (an && sa && !sa.includes(an) && !an.includes(sa)) continue; // 歌手不匹配跳过
      if (s.url && /^https?:\/\//i.test(s.url)) return s.url;
    }
    return '';
  } catch (e) {
    return '';
  }
}

async function resolvePlayUrl(track) {
  const primary = getProvider(track.vendor);
  if (USE_MOCK) return { url: await primary.url(track.id), vendor: track.vendor };
  let expect = track.duration || 0;
  // 期望时长（歌曲真实完整时长）缺失时，netease 可用歌曲详情 GET 接口补全
  if (!expect && track.vendor === 'netease') {
    try {
      const d = await netease.songsDetail([track.id]).catch(() => []);
      if (d[0] && d[0].duration) expect = d[0].duration;
    } catch (e) { /* 忽略 */ }
  }
  // 0) 国内 meting 聚合源优先（2026-11-05 终极方案）：按网易 ID 实时直出完整版 mp3。
  // 海外 IP 直连网易 weapi 已被风控（真机实测 IO_UNSPECIFIED 的根因之一），
  // meting（api.qijieya.cn，国内基础设施）从海外后端可达且响应快。
  // meting 直链来自免登录接口、为完整版，跳过字节探测（probe 的海外往返反而会误杀好直链）。
  if (track.vendor === 'netease' && track.id) {
    try {
      const mu = await withTimeout(qmeting.url('netease', track.id), SEARCH_TIMEOUT * 2);
      if (mu) return { url: mu, vendor: 'netease' };
    } catch (e) { /* 忽略，走主音源 */ }
  }
  // 1) 主音源直连（带音质档位）；netease 额外用 freeTrialInfo 标记识别试听
  let u = '';
  try {
    if (primary.urlInfo) {
      const info = await primary.urlInfo(track.id, track.quality);
      if (info.url && !info.trial) u = info.url;
    } else {
      u = (await primary.url(track.id)) || '';
    }
  } catch (e) { /* 忽略，走兜底 */ }
  if (u) {
    const len = await probeAudioLen(u);
    if (isFullAudio(len, expect)) return { url: u, vendor: track.vendor };
    u = '';
  }
  // 2) 聚合源（meting，按主音源 ID 解析；netease ID 支持）
  try {
    const au = await aggregate.url(track.vendor, track.id);
    if (au) {
      const len = await probeAudioLen(au);
      if (isFullAudio(len, expect)) return { url: au, vendor: track.vendor };
    }
  } catch (e) { /* 忽略 */ }
  // 2.5) GDStudio 跨源兜底（海外部署关键路径）：酷狗/酷我/QQ 曲目的解析接口
  // 在海外常被上游直接拒绝（真机实测：酷狗地址 → /api/stream 上游 403 →
  // 安卓原生 IO_BAD_HTTP_STATUS）。用海外可达的 GDStudio 按「歌名+歌手」
  // 搜网易同曲，再按网易 ID 解析完整版——保证搜得到就能播。
  if (!u && track.vendor !== 'netease' && (track.name || '').trim()) {
    try {
      const gu = await withTimeout(gdsNeteaseUrl(track.name, track.artist, track.quality), 15000);
      if (gu) {
        const len = await probeAudioLen(gu);
        if (isFullAudio(len, expect)) return { url: gu, vendor: 'netease' };
      }
    } catch (e) { /* 忽略，走后续兜底 */ }
  }
  // 3) GDStudio 完整版解析（按 netease ID 直出完整版，按音质档位选 br）
  if (track.vendor === 'netease') {
    try {
      const gu = await gds.url('netease', track.id, QUALITY_BR[track.quality] || '320');
      if (gu) {
        const len = await probeAudioLen(gu);
        if (isFullAudio(len, expect)) return { url: gu, vendor: 'netease' };
      }
    } catch (e) { /* 忽略 */ }
  }
  // 4) 跨音源：按歌名+歌手去其他音源找（候选时长须接近完整版）
  const name = (track.name || '').trim();
  const artist = (track.artist || '').trim();
  for (const v of VENDOR_ORDER) {
    if (v === track.vendor) continue;
    try {
      const pv = getProvider(v);
      const { list } = await pv.search(name, 'song', 1, 10);
      for (const cand of list) {
        const ca = (cand.artist || '').trim();
        if (artist && ca && !ca.includes(artist) && !artist.includes(ca)) continue; // 歌手不匹配跳过
        // 候选时长明显偏短（剪辑版/BGM）→ 跳过
        if (expect && cand.duration && cand.duration < expect * 0.85) continue;
        try {
          const cu = await pv.url(cand.id);
          if (cu) {
            const len = await probeAudioLen(cu);
            if (isFullAudio(len, cand.duration || expect)) return { url: cu, vendor: v };
          }
        } catch (e) { /* 该候选失败，试聚合源 */ }
        try {
          const au = await aggregate.url(v, cand.id);
          if (au) {
            const len = await probeAudioLen(au);
            if (isFullAudio(len, cand.duration || expect)) return { url: au, vendor: v };
          }
        } catch (e) { /* 忽略 */ }
      }
    } catch (e) { /* 忽略该音源 */ }
  }
  return { url: '', vendor: '' };
}

// 解析结果缓存包装：同一首歌短时间内反复解析（切歌回听/重试/多端）直接命中缓存，
// 不再打上游。地址 10 分钟过期，避免拿到已失效的 CDN token。
// fresh=1 时跳过缓存读（流加载 403 后前端强制换源重解析用），结果仍回写缓存。
async function resolvePlayUrlCached(track, opts) {
  const key = 'r:' + (track.vendor || '') + ':' + track.id + ':' + (track.quality || 'standard');
  if (!(opts && opts.fresh)) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }
  const r = await resolvePlayUrl(track);
  if (r && r.url) cacheSet(key, r, RESOLVE_CACHE_MS);
  return r;
}

// 单音源搜索超时保护，避免某个音源卡死拖垮 auto（海外部署经 XY_SEARCH_TIMEOUT 放宽）
const SEARCH_TIMEOUT = Number(process.env.XY_SEARCH_TIMEOUT) || 3500;
function withTimeout(promise, ms) {
  let timer;
  const t = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), ms); });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

// ── 海外部署防风控缓存 ──────────────────────────────────────
// 数据中心 IP（Render/Vercel 等）直连国内音源，突发高频请求极易被临时封禁
// （真机 4G + 压测实测：连续矩阵测试后上游对本 IP 全部瞬时拒绝）。
// 对「搜索结果」与「解析出的播放地址」加内存 LRU+TTL，命中率高的场景
// 上游 QPS 可降一到两个数量级，显著降低被风控概率。
const upstreamCache = new Map(); // key -> { value, expires }
const UPSTREAM_CACHE_MAX = 600;
const SEARCH_CACHE_MS = 10 * 60e3;   // 搜索结果 10 分钟
const RESOLVE_CACHE_MS = 10 * 60e3;  // 播放地址 10 分钟（163 直链 token 带时效，不宜久存）
function cacheGet(key) {
  const hit = upstreamCache.get(key);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) { upstreamCache.delete(key); return undefined; }
  // LRU 触碰：删了重插排到队尾
  upstreamCache.delete(key); upstreamCache.set(key, hit);
  return hit.value;
}
function cacheSet(key, value, ttl) {
  if (upstreamCache.size >= UPSTREAM_CACHE_MAX) {
    const oldest = upstreamCache.keys().next().value;
    upstreamCache.delete(oldest);
  }
  upstreamCache.set(key, { value, expires: Date.now() + ttl });
}

// 多音源搜索兜底：vendor=auto 时依次尝试各音源，返回第一个有结果的；
// 未知 vendor 也走 auto 逻辑，保证总有搜索能力。
// 歌手/专辑/歌单类型只有网易可靠支持 → 固定走网易，避免其他音源返回空/脏数据。
async function searchMulti(vendor, kw, type, page, limit) {
  const key = 's:' + vendor + ':' + type + ':' + kw + ':' + page + ':' + limit;
  const cached = cacheGet(key);
  if (cached) return cached;
  if (type && type !== 'song') {
    // 非单曲类型只有网易可靠支持。海外部署时网易接口偶发超时/风控，
    // 首次失败后隔 1s 重试一次，尽量不让"歌手/专辑/歌单"整个搜不出东西。
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await withTimeout(netease.search(kw, type, page, limit), SEARCH_TIMEOUT * 3);
        if (r && r.list && r.list.length) { cacheSet(key, r, SEARCH_CACHE_MS); return r; }
      } catch (e) { /* 重试 */ }
      if (attempt === 0) await new Promise((r2) => setTimeout(r2, 1000));
    }
    // 海外兜底（歌手/专辑/歌单分类）：网易被风控时用国内 meting 歌曲数据聚合。
    // 歌手：按歌手去重（name: 前缀）；专辑/歌单：meting 无这两种类型（完整协议仅
    // search/url/lrc/pic），降级为按歌手聚合的「相关歌曲集」（artistlist: 前缀）——
    // 数据不如网易原生全，但界面有内容、点击有歌可播。
    if (type === 'artist' || type === 'album' || type === 'playlist') {
      let rows = [];
      try {
        const r = await withTimeout(qmeting.search('netease', kw, 1, 50), SEARCH_TIMEOUT * 2);
        rows = r.list || [];
      } catch (e) { /* 走 GDStudio */ }
      // qmeting 对个别热词偶发空结果（上游波动实测）：GDStudio 网易搜索兜底
      if (!rows.length) {
        try {
          const r2 = await withTimeout(gds.search('netease', kw, 1, 50), SEARCH_TIMEOUT * 2);
          rows = r2.list || [];
        } catch (e) { /* 忽略 */ }
      }
      try {
        const lkw = kw.trim().toLowerCase();
        const seen = new Map(); // 歌手 -> 首图
        for (const t of rows) {
          const an = (t.artist || '').trim();
          if (!an || seen.has(an)) continue;
          const lk = an.toLowerCase();
          if (!lk.includes(lkw) && !lkw.includes(lk)) continue;
          seen.set(an, t.pic || '');
          if (type === 'artist' && seen.size >= limit) break;
        }
        let list;
        if (type === 'artist') {
          list = [...seen.entries()].map(([an, pic]) => ({ id: 'name:' + an, name: an, artist: an, album: '', pic, vendor: 'netease', duration: 0 }));
        } else {
          // 专辑/歌单：严格匹配的歌手不足 3 个时，放宽为全部结果按歌手分组
          //（qmeting 对热门词的搜索结果常是翻唱曲，artist=翻唱者，严格过滤会清零）
          const groups = seen.size >= 3 ? seen : (() => {
            const g = new Map();
            for (const t of rows) { const an = (t.artist || '').trim() || '相关歌曲'; if (!g.has(an)) g.set(an, t.pic || ''); }
            return g;
          })();
          list = [...groups.entries()].slice(0, limit).map(([an, pic]) => ({
            id: 'artistlist:' + an,
            name: an + ' · 相关歌曲集',
            artist: an,
            album: '',
            pic,
            vendor: 'netease',
            duration: 0,
          }));
        }
        if (list.length) {
          const r2 = { list, total: list.length };
          cacheSet(key, r2, SEARCH_CACHE_MS);
          return r2;
        }
      } catch (e) { /* 忽略 */ }
    }
    return { list: [], total: 0 };
  }
  if (vendor === 'auto' || vendor === 'netease') {
    // 网易直连与国内 meting 聚合源「并行竞速」（2026-11-05 终极方案）：
    // - 国内/后端在本地时：网易直连 ~0.4s 先回且质量好（原版靠前）→ 用网易
    // - 海外部署被风控时：网易 3.5s 超时，并行的 qmeting（国内 API，海外可达）
    //   已就绪 → 用 qmeting（自带实时直链，手机直连即播）
    // 两路同时发，无论哪端环境都拿到当前条件下的最优解，杜绝转圈等待。
    const neP = withTimeout(netease.search(kw, type, page, limit), SEARCH_TIMEOUT).then((r) => (r && r.list && r.list.length) ? r : null).catch(() => null);
    const qmP = qmeting.search(vendor, kw, page, limit).then((r) => (r && r.list && r.list.length) ? r : null).catch(() => null);
    const ne = await neP;
    if (ne) { cacheSet(key, ne, SEARCH_CACHE_MS); return ne; }
    const qm = await qmP;
    if (qm) { cacheSet(key, qm, SEARCH_CACHE_MS); return qm; }
    // 两路皆空（网易被风控 + meting 主站此刻拒连）→ 不在此返回空，
    // 继续走下面的兜底链（GDStudio 等），否则用户直接看到「搜不到歌」。
    // ⚠️ 2026-11-05 实测：线上 DEFAULT_VENDOR=netease 时本分支曾直接返回
    //    空列表，只有 vendor=auto 才有兜底 → 默认参数下搜索间歇性 0 条。
    if (vendor === 'netease') {
      const ORDER = ['__gds__', 'tencent', 'kugou', 'kuwo'];
      for (const v of ORDER) {
        try {
          const r = v === '__gds__'
            ? await withTimeout(gds.search('netease', kw, page, limit), SEARCH_TIMEOUT * 2)
            : (PROVIDERS[v] ? await withTimeout(PROVIDERS[v].search(kw, type, page, limit), SEARCH_TIMEOUT) : null);
          if (r && r.list && r.list.length) { cacheSet(key, r, SEARCH_CACHE_MS); return r; }
        } catch (e) {
          console.warn('[search fail]', v, e && e.message);
        }
      }
      return { list: [], total: 0 };
    }
  }
  if (vendor === 'auto' || !PROVIDERS[vendor]) {
    // 顺序：网易 → GDStudio网易（海外可达，结果=可播的网易曲目）→ 其他直连源。
    // 网易直连在海外被风控时，先走 GDStudio 而不是酷狗：酷狗曲目解析需要
    // 二次跨源（慢且受 GDStudio 限流影响），网易曲目可直连+聚合+GDStudio 三路解析。
    const ORDER = ['netease', '__gds__', 'tencent', 'kugou', 'kuwo'];
    for (const v of ORDER) {
      try {
        const r = v === '__gds__'
          ? await withTimeout(gds.search('netease', kw, page, limit), SEARCH_TIMEOUT * 2)
          : (PROVIDERS[v] ? await withTimeout(PROVIDERS[v].search(kw, type, page, limit), SEARCH_TIMEOUT) : null);
        if (r && r.list && r.list.length) { cacheSet(key, r, SEARCH_CACHE_MS); return r; }
      } catch (e) {
        console.warn('[search fail]', v, e && e.message);
      }
    }
    return { list: [], total: 0 };
  }
  try {
    const r = await getProvider(vendor).search(kw, type, page, limit);
    if (r && r.list && r.list.length) cacheSet(key, r, SEARCH_CACHE_MS);
    return r || { list: [], total: 0 };
  } catch (e) {
    return { list: [], total: 0 };
  }
}

// 热搜词：取热歌榜前 12 首歌名，缓存 1 小时（供搜索框推荐 + 热搜榜）
const HOT_LIST_ID = '3778678'; // 云音乐热歌榜
let hotCache = { t: 0, words: [] };
async function hotWords() {
  if (Date.now() - hotCache.t < 3600e3 && hotCache.words.length) return hotCache.words;
  const pl = await netease.playlistDetail(HOT_LIST_ID);
  let names = (pl.tracks || []).map((t) => t.name);
  if (!names.length) {
    const tracks = await netease.songsDetail((pl.trackIds || []).slice(0, 12));
    names = tracks.map((t) => t.name);
  }
  hotCache = { t: Date.now(), words: names.filter(Boolean).slice(0, 12) };
  return hotCache.words;
}

function sendJson(res, code, obj, cors) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': '*',
  });
  res.end(body);
}

function q(reqUrl, name) {
  return reqUrl.searchParams.get(name);
}

async function handleApi(req, res, reqUrl) {
  const vendor = q(reqUrl, 'vendor') || DEFAULT_VENDOR;
  const p = getProvider(vendor);
  const pathname = reqUrl.pathname;

  try {
    if (pathname === '/api/health') return sendJson(res, 200, { code: 200, msg: 'ok', ...(publicMode?{service:'xiaoyang-music-api',publicMode:true}:{}) });

    if (pathname === '/api/search') {
      const kw = q(reqUrl, 'keyword') || '';
      const type = q(reqUrl, 'type') || 'song';
      const page = Math.max(1, parseInt(q(reqUrl, 'page') || '1', 10));
      const limit = Math.min(50, Math.max(1, parseInt(q(reqUrl, 'limit') || '20', 10)));
      if (!kw) return sendJson(res, 400, { code: 400, msg: '缺少 keyword' });
      const { list, total } = await searchMulti(vendor, kw, type, page, limit);
      return sendJson(res, 200, { code: 200, result: list, total });
    }

    if (pathname === '/api/artist') {
      // 歌手热门歌曲（搜索「歌手」标签点击后用）
      const id = q(reqUrl, 'id');
      if (!id) return sendJson(res, 400, { code: 400, msg: '缺少 id' });
      const limit = Math.min(100, Math.max(1, parseInt(q(reqUrl, 'limit') || '50', 10)));
      // 海外兜底：「name:歌手名」ID 来自 meting 聚合的歌手分类——按名字搜索其歌曲
      if (String(id).startsWith('name:')) {
        const name = String(id).slice(5).trim();
        if (!name) return sendJson(res, 400, { code: 400, msg: '歌手名无效' });
        const tracks = await artistTracksByName(name, limit);
        return sendJson(res, 200, { code: 200, tracks });
      }
      const tracks = await netease.artistTop(id, limit);
      return sendJson(res, 200, { code: 200, tracks });
    }

    if (pathname === '/api/album') {
      // 专辑详情 + 曲目（搜索「专辑」标签点击后用）
      const id = q(reqUrl, 'id');
      if (!id) return sendJson(res, 400, { code: 400, msg: '缺少 id' });
      // 海外兜底：「artistlist:歌手名」ID 来自 meting 聚合的相关歌曲集——按歌手名搜索其歌曲
      if (String(id).startsWith('artistlist:')) {
        const name = String(id).slice('artistlist:'.length).trim();
        const tracks = await artistTracksByName(name, 100);
        return sendJson(res, 200, { code: 200, info: { name: name + ' · 相关歌曲集', cover: tracks[0]?.pic || '' }, tracks });
      }
      const info = await netease.albumDetail(id);
      return sendJson(res, 200, { code: 200, info, tracks: info.tracks });
    }

    // ── Supabase 全量反向代理（2026-11-05）：国内运营商掐断 supabase.co（真机
    // 登录 Connection reset），手机端把 Supabase 客户端的 URL 指到本服务
    // /api/supabase/*，这里原样透传到真实 Supabase（海外→海外，稳定）。
    // 覆盖 auth（登录/注册/token 刷新）、rest（红心/歌单）、storage（头像）。
    if (pathname.startsWith('/api/supabase/')) {
      const su = process.env.SUPABASE_URL;
      if (!su || !/^https:\/\//.test(su)) return sendJson(res, 502, { code: 502, msg: 'Supabase 代理未配置' });
      const target = su.replace(/\/+$/, '') + pathname.slice('/api/supabase'.length) + (reqUrl.search || '');
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) {
        const lk = k.toLowerCase();
        if (['host', 'content-length', 'connection', 'accept-encoding', 'origin', 'referer'].includes(lk)) continue;
        headers[k] = v;
      }
      let body;
      if (!['GET', 'HEAD'].includes(req.method)) {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 5 * 1024 * 1024) { res.writeHead(413, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ code: 413, msg: '请求体过大' })); }
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
        if (body.length) headers['content-length'] = String(body.length);
      }
      try {
        const up = await withTimeout(rawFetch(target, { method: req.method, headers, body, redirect: 'manual' }), 30000);
        const resHeaders = {};
        for (const [k, v] of Object.entries(up.headers)) {
          const lk = k.toLowerCase();
          if (['content-length', 'transfer-encoding', 'connection', 'content-encoding'].includes(lk)) continue;
          resHeaders[k] = v;
        }
        resHeaders['access-control-allow-origin'] = '*';
        res.writeHead(up.status, resHeaders);
        if (up.body) await pipeline(Readable.fromWeb(up.body), res);
        else res.end();
      } catch (e) {
        if (res.destroyed) return;
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ code: 502, msg: '云端代理连接失败：' + ((e && e.message) || ''), error: 'connection_reset' }));
      }
      return;
    }

    // ── 版本检查代理（2026-11-05）：国内运营商掐断 supabase.co（真机 Connection reset），
    // 手机端「检查更新」拿不到版本号。Render（海外→海外）代替手机查 Supabase 并返回；
    // APK 下载也一并代理（download_url 是 supabase.co 域名，同样被墙）。
    if (pathname === '/api/version/android') {
      const su = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_ANON_KEY;
      if (!su || !key || !/^https:\/\//.test(su)) return sendJson(res, 200, { code: 200, version: '', release_notes: '' });
      const cacheKey = 'ver:android';
      const cached = cacheGet(cacheKey);
      if (cached) return sendJson(res, 200, { code: 200, ...cached });
      try {
        const r = await withTimeout(rawFetch(su + '/rest/v1/app_versions?platform=eq.android&select=version,download_url,release_notes&order=created_at.desc&limit=50', {
          headers: { apikey: key, Authorization: 'Bearer ' + key },
        }), 10000);
        if (!r.ok) throw new Error('upstream ' + r.status);
        const rows = await r.json();
        const semver = (v) => String(v || '').split('.').map((x) => parseInt(x, 10) || 0);
        const newer = (a, b) => { const A = semver(a), B = semver(b); for (let i = 0; i < 3; i++) { if (A[i] !== B[i]) return A[i] > B[i]; } return false; };
        let latest = null;
        for (const row of rows || []) {
          if (!row || !row.version || !row.download_url) continue;
          if (!latest || newer(row.version, latest.version)) latest = row;
        }
        if (!latest) return sendJson(res, 200, { code: 200, version: '', release_notes: '' });
        // 下载地址改写为 Render 自身代理（手机直连 supabase.co 被墙，经本服务流式转发）
        const payload = {
          version: latest.version,
          download_url: 'https://' + (req.headers.host || '') + '/api/release-file?v=' + encodeURIComponent(latest.version),
          release_notes: latest.release_notes || '',
        };
        cacheSet(cacheKey, payload, 5 * 60e3);
        return sendJson(res, 200, { code: 200, ...payload });
      } catch (e) {
        return sendJson(res, 200, { code: 200, version: '', release_notes: '', msg: '版本查询失败：' + ((e && e.message) || '') });
      }
    }

    if (pathname === '/api/release-file') {
      const su = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_ANON_KEY;
      if (!su || !key) { res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('release proxy not configured'); }
      try {
        const want = q(reqUrl, 'v') || '';
        const r = await withTimeout(rawFetch(su + '/rest/v1/app_versions?platform=eq.android&select=version,download_url' + (want ? '&version=eq.' + encodeURIComponent(want) : '&order=created_at.desc&limit=1'), {
          headers: { apikey: key, Authorization: 'Bearer ' + key },
        }), 10000);
        if (!r.ok) throw new Error('upstream ' + r.status);
        const rows = await r.json();
        const row = (rows || [])[0];
        if (!row || !row.download_url) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('release not found'); }
        const up = await withTimeout(rawFetch(row.download_url, { redirect: 'follow' }), 30000);
        if (!up.ok || !up.body) throw new Error('storage ' + up.status);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.android.package-archive',
          ...(up.headers.get('content-length') ? { 'Content-Length': up.headers.get('content-length') } : {}),
          'Content-Disposition': 'attachment; filename="xiaoyang-music-' + (row.version || 'latest') + '-android.apk"',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        });
        await pipeline(Readable.fromWeb(up.body), res);
      } catch (e) {
        if (res.destroyed) return;
        if (res.headersSent) return res.destroy();
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('release proxy error: ' + ((e && e.message) || ''));
      }
      return;
    }

    if (pathname === '/api/song') {
      const id = q(reqUrl, 'id');
      if (!id) return sendJson(res, 400, { code: 400, msg: '缺少 id' });
      const name = q(reqUrl, 'name') || '';
      const artist = q(reqUrl, 'artist') || '';
      const quality = q(reqUrl, 'quality') || 'standard';
      // 主音源元数据查询整体限时：海外 IP 被风控时 weapi 可能长挂，
      // 超时后落成空壳，交给下方完整版兜底链，不再让前端转圈半天。
      let data;
      try { data = await withTimeout(p.song(id, quality), SEARCH_TIMEOUT * 2); }
      catch (e) { data = { id, url: '', name: '', artist: '', duration: 0 }; }
      // 元数据回填：上游反爬导致空歌名/歌手时，用前端传来的信息补齐，避免播放条显示「未知」
      if (!data.name && name) data.name = name;
      if (!data.artist && artist) data.artist = artist;
      // 主音源无播放地址、或地址是 VIP 试听片段时，走完整版兜底链
      if (!data.url || data.trial) {
        // 兜底链整体限时：跨音源逐个 search+url+probe 可能拖很久，
        // 超时后返回「暂无地址」让前端快速给可读提示，而不是一直转圈。
        // fresh=1：流加载 403 后前端强制换源重解析，跳过解析缓存读。
        try {
          const fb = await withTimeout(
            resolvePlayUrlCached({ vendor, id, name: data.name || name, artist: data.artist || artist, duration: data.duration || 0, quality }, { fresh: q(reqUrl, 'fresh') === '1' }),
            RESOLVE_TOTAL_TIMEOUT,
          );
          if (fb && fb.url) { data.url = fb.url; data.vendor = fb.vendor; data.trial = false; }
        } catch (e) {
          data.url = data.url || '';
          data.resolveTimeout = true;
        }
      }
      data.url = forceHttps(data.url);
      // 全部音源都试过仍无地址（非超时）：给前端明确标记 → 提示「受版权保护或暂无音源」
      if (!data.url && !data.resolveTimeout) data.exhausted = true;
      return sendJson(res, 200, { code: 200, data });
    }

    if (pathname === '/api/url') {
      const id = q(reqUrl, 'id');
      if (!id) return sendJson(res, 400, { code: 400, msg: '缺少 id' });
      const name = q(reqUrl, 'name') || '';
      const artist = q(reqUrl, 'artist') || '';
      const duration = parseInt(q(reqUrl, 'duration') || '0', 10) || 0;
      const quality = q(reqUrl, 'quality') || 'standard';
      const fb = await withTimeout(
        resolvePlayUrlCached({ vendor, id, name, artist, duration, quality }, { fresh: q(reqUrl, 'fresh') === '1' }),
        RESOLVE_TOTAL_TIMEOUT,
      );
      return sendJson(res, 200, { code: 200, url: forceHttps(fb.url), vendor: fb.vendor });
    }

    if (pathname === '/api/lyric') {
      const id = q(reqUrl, 'id');
      if (!id) return sendJson(res, 400, { code: 400, msg: '缺少 id' });
      let full;
      if (p.lyricFull) full = await p.lyricFull(id).catch(() => ({ lyric: '', tlyric: '' }));
      else full = { lyric: await p.lyric(id), tlyric: '' };
      return sendJson(res, 200, { code: 200, lyric: full.lyric, tlyric: full.tlyric || '' });
    }

    // ══════ 歌曲百科（曲风/语种/发行时间/发行版本/BPM 等，wiki 失败用专辑信息兜底） ══════
    if (pathname === '/api/wiki') {
      const id = q(reqUrl, 'id');
      if (!id) return sendJson(res, 400, { code: 400, msg: '缺少 id' });
      const out = (p.wikiSummary && await p.wikiSummary(id).catch(() => null)) || null;
      if (!out) return sendJson(res, 200, { code: 200, source: 'none', info: {} });
      return sendJson(res, 200, { code: 200, source: out.source, info: out.info || {} });
    }

    // ══════ 相似歌曲推荐（官方 simiSong，失败兜底同歌手热歌） ══════
    if (pathname === '/api/simi') {
      const id = q(reqUrl, 'id');
      const limit = Math.min(50, parseInt(q(reqUrl, 'limit') || '30', 10) || 30);
      if (!id) return sendJson(res, 400, { code: 400, msg: '缺少 id' });
      const tracks = (p.simiSong && await p.simiSong(id, limit).catch(() => [])) || [];
      return sendJson(res, 200, { code: 200, tracks: tracks.map(normalizeImportTrack) });
    }

    // ══════ 搜索建议 + 热搜榜（keyword 为空时返回热搜词） ══════
    if (pathname === '/api/suggest') {
      const kw = (q(reqUrl, 'keyword') || '').trim();
      const hot = await hotWords().catch(() => []);
      if (!kw) return sendJson(res, 200, { code: 200, hot });
      const s = await netease.suggest(kw).catch(() => ({}));
      return sendJson(res, 200, { code: 200, hot, ...s });
    }

    // ══════ 榜单/歌单详情（含曲目列表） ══════
    if (pathname === '/api/playlist') {
      const pid = q(reqUrl, 'id');
      if (!pid) return sendJson(res, 400, { code: 400, msg: '缺少 id' });
      const platform = q(reqUrl, 'platform') || 'netease';
      const limit = Math.min(200, Math.max(1, parseInt(q(reqUrl, 'limit') || '50', 10)));
      // 海外兜底：「artistlist:歌手名」ID 来自 meting 聚合的相关歌曲集（与专辑分类共用）
      if (String(pid).startsWith('artistlist:')) {
        const name = String(pid).slice('artistlist:'.length).trim();
        const tracks = await artistTracksByName(name, limit);
        return sendJson(res, 200, { code: 200, info: { name: name + ' · 相关歌曲集', cover: tracks[0]?.pic || '' }, tracks });
      }
      if (platform === 'qq' || platform === 'kugou') {
        const prov = platform === 'qq' ? tencent : kugou;
        const info = await prov.playlistDetail(pid);
        if (info.missing) {
          return sendJson(res, 404, { code: 404, msg: `${platform === 'qq' ? 'QQ音乐' : '酷狗'}返回「${info.notFoundMsg || '歌单不存在'}」` });
        }
        return sendJson(res, 200, { code: 200, info, tracks: (info.tracks || []).slice(0, limit).map(normalizeImportTrack) });
      }
      const info = await netease.playlistDetail(pid);
      if (info.missing) {
        return sendJson(res, 404, { code: 404, msg: `歌单不存在或已删除${info.notFoundMsg ? '（' + info.notFoundMsg + '）' : ''}，也可能是私密歌单（匿名不可见），请换一个公开歌单 ID` });
      }
      // 榜单接口可能直接返回 tracks；否则用 trackIds 批量补全
      const tracks = info.tracks && info.tracks.length
        ? info.tracks.slice(0, limit)
        : await netease.songsDetail((info.trackIds || []).slice(0, limit)).catch(() => []);
      return sendJson(res, 200, { code: 200, info, tracks });
    }

    // ══════ 推荐歌单列表（高质量歌单） ══════
    if (pathname === '/api/playlists') {
      const cat = q(reqUrl, 'cat') || '全部';
      const limit = Math.min(50, Math.max(1, parseInt(q(reqUrl, 'limit') || '15', 10)));
      const list = await netease.topPlaylists(cat, limit).catch(() => []);
      return sendJson(res, 200, { code: 200, list });
    }

    // ══════ 识别网易云 ID → 选择性导入歌单 ══════
    if (pathname === '/api/import/resolve') {
      const input = q(reqUrl, 'input') || '';
      const platform = q(reqUrl, 'platform') || 'netease';
      // QQ / 酷狗：仅支持歌单（提取链接里的 id= / specialid= 或纯数字）
      if (platform === 'qq' || platform === 'kugou') {
        const pid = classifyPlatformId(input);
        if (!pid) {
          return sendJson(res, 400, { code: 400, msg: `无法识别${platform === 'qq' ? 'QQ音乐' : '酷狗'}歌单 ID：请粘贴歌单分享链接（含 id= / specialid=），或直接填数字 ID` });
        }
        const prov = platform === 'qq' ? tencent : kugou;
        try {
          const pl = await prov.playlistDetail(pid);
          if (pl.missing) {
            return sendJson(res, 404, { code: 404, msg: `${platform === 'qq' ? 'QQ音乐' : '酷狗'}返回「${pl.notFoundMsg || '歌单不存在'}」：ID ${pid} 可能输错、已删除，或为私密歌单（仅支持公开歌单）` });
          }
          if (!(pl.tracks || []).length) {
            return sendJson(res, 404, { code: 404, msg: `该歌单「${pl.name || pid}」没有可导入的歌曲` });
          }
          return sendJson(res, 200, {
            code: 200, type: 'playlist', id: pid,
            info: { type: 'playlist', id: pid, name: pl.name, cover: pl.cover, creator: pl.creator || '', desc: pl.desc || '', trackCount: pl.trackCount, playCount: pl.playCount || 0 },
            tracks: (pl.tracks || []).map(normalizeImportTrack),
          });
        } catch (e) {
          return sendJson(res, 502, { code: 502, msg: '解析失败：' + ((e && e.message) || e) });
        }
      }
      const parsed = classifyNeteaseInput(input);
      if (!parsed) {
        return sendJson(res, 400, { code: 400, msg: '无法识别网易云 ID，请粘贴歌单 / 专辑 / 单曲 / 歌手链接，或直接填数字 ID' });
      }
      let info = {}, tracks = [];
      try {
        if (parsed.type === 'playlist') {
          const pl = await netease.playlistDetail(parsed.id);
          // 网易云源站明确说“歌单不存在”/已删除：给可读提示，而不是让前端只看到 HTTP 404
          if (pl.missing) {
            return sendJson(res, 404, { code: 404, msg: `网易云返回「${pl.notFoundMsg || '歌单不存在'}」：ID ${parsed.id} 可能输错了、歌单已被删除，或它是私密歌单（匿名不可见）。可打开网易云 App 确认歌单为公开状态后重试` });
          }
          // 私密歌单 / 空歌单：匿名只能看到歌单名，曲目数为 0 —— 提前给出可读提示而不是“识别成功 0 首”
          if (!pl.trackCount && !(pl.tracks || []).length) {
            return sendJson(res, 404, { code: 404, msg: `该歌单「${pl.name || parsed.id}」是私密歌单或没有歌曲（网易云限制：别人的“我喜欢的音乐”等私密歌单匿名不可见），请换一个公开歌单 ID` });
          }
          info = {
            type: 'playlist', id: pl.id, name: pl.name, cover: pl.cover,
            creator: pl.creator || '', desc: pl.desc, trackCount: pl.trackCount, playCount: pl.playCount,
          };
          tracks = (pl.tracks && pl.tracks.length)
            ? pl.tracks
            : await netease.songsDetail((pl.trackIds || []).slice(0, 300)).catch(() => []);
        } else if (parsed.type === 'album') {
          const al = await netease.albumDetail(parsed.id);
          info = {
            type: 'album', id: al.id, name: al.name, cover: al.pic,
            creator: al.artist || '', desc: al.desc, trackCount: (al.tracks || []).length, playCount: 0,
          };
          tracks = al.tracks || [];
        } else if (parsed.type === 'song') {
          const sg = await netease.song(parsed.id);
          info = { type: 'song', id: sg.id, name: sg.name, cover: sg.pic, creator: sg.artist, desc: '', trackCount: 1, playCount: 0 };
          tracks = [sg];
        } else if (parsed.type === 'artist') {
          const tr = await netease.artistTop(parsed.id, 100);
          info = { type: 'artist', id: parsed.id, name: '歌手热门歌曲', cover: '', creator: '', desc: '', trackCount: tr.length, playCount: 0 };
          tracks = tr;
        }
      } catch (e) {
        return sendJson(res, 502, { code: 502, msg: '解析失败：' + ((e && e.message) || e) });
      }
      return sendJson(res, 200, {
        code: 200, type: parsed.type, id: parsed.id, info,
        tracks: (tracks || []).map(normalizeImportTrack),
      });
    }

    // ══════ 音乐榜单：精选网易云榜单入口（点击后走 /api/playlist 取曲目） ══════
    if (pathname === '/api/charts') {
      const charts = [
        { id: '3778678', name: '云音乐热歌榜', icon: '🔥', desc: '当下最热门' },
        { id: '3779629', name: '云音乐新歌榜', icon: '✨', desc: '最新发行' },
        { id: '19723756', name: '云音乐飙升榜', icon: '🚀', desc: '涨势最猛' },
        { id: '2884035', name: '网易原创榜', icon: '🎼', desc: '原创音乐' },
        { id: '1978921795', name: '云音乐电音榜', icon: '🎧', desc: 'EDM / 电子' },
        { id: '991319590', name: '云音乐说唱榜', icon: '🎤', desc: 'Hip-Hop / Rap' },
        { id: '5059661515', name: '云音乐国风榜', icon: '🏮', desc: '国风 / 古风' },
        { id: '71385702', name: '云音乐古典榜', icon: '🎻', desc: '古典音乐' },
        { id: '2809513713', name: '云音乐欧美榜', icon: '🌍', desc: '欧美热歌' },
        { id: '5059633707', name: '云音乐日语榜', icon: '🇯🇵', desc: '日语热歌' },
        { id: '5059642708', name: '云音乐韩语榜', icon: '🇰🇷', desc: '韩语热歌' },
      ];
      return sendJson(res, 200, { code: 200, charts });
    }

    return sendJson(res, 404, { code: 404, msg: 'unknown api' });
  } catch (e) {
    console.error('[api error]', pathname, e && e.message);
    return sendJson(res, 500, { code: 500, msg: (e && e.message) || 'server error' });
  }
}

function serveStatic(req, res, reqUrl) {
  let rel;
  try { rel = decodeURIComponent(reqUrl.pathname); }
  catch { res.writeHead(400); return res.end('Bad path'); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.resolve(APP_DIR, '.' + rel);
  // 防目录穿越
  const relative = path.relative(APP_DIR, filePath);
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
}

const server = http.createServer((req, res) => runRequest(req, res, () => {
  let reqUrl;
  try { reqUrl = new URL(req.url, 'http://localhost'); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  if(publicGate&&!publicGate(req,res,reqUrl))return;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': '*',
      ...(req.headers.origin === 'https://localhost' ? { 'Access-Control-Allow-Private-Network': 'true' } : {}),
    });
    return res.end();
  }
  if (reqUrl.pathname.startsWith('/api/')) {
    if (reqUrl.pathname.startsWith('/api/account/')) return accounts.handle(req,res,reqUrl);
    if (reqUrl.pathname.startsWith('/api/local/')) {
      if (!localAccess.authorize(req, reqUrl.pathname)) return sendJson(res, 403, { code: 403, msg: '本地媒体库访问未授权，请重新打开播放器' });
      if (reqUrl.pathname === '/api/local/session') return sendJson(res, 200, { code: 200, token: localAccess.token });
      return handleLocal(req, res, reqUrl);
    }
    if (reqUrl.pathname === '/api/download') return handleDownload(req, res, reqUrl);
    if (reqUrl.pathname === '/api/pic') return handlePic(req, res, reqUrl);
    if (reqUrl.pathname === '/api/stream') return handleStream(req, res, reqUrl);
    return handleApi(req, res, reqUrl);
  }
  return serveStatic(req, res, reqUrl);
}));

// 封面图片代理：带 Referer/UA 服务端拉图，解决音源图床防盗链导致封面不显示
async function handlePic(req, res, reqUrl) {
  const raw = q(reqUrl, 'url') || '';
  if (!/^https?:\/\//i.test(raw)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('bad url');
  }
  try {
    const u = new URL(raw);
    const r = await fetch(u.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36',
        Referer: u.origin + '/',
      },
      redirect: 'follow',
    });
    if (!r.ok) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('upstream ' + r.status);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(200, {
      'Content-Type': r.headers.get('content-type') || 'image/jpeg',
      'Content-Length': buf.length,
      'Cache-Control': 'public, max-age=604800',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(buf);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('pic error');
  }
}

// 音频流同源代理：把跨域直链转成同源 /api/stream?url=
// 关键修复：Chromium 的 createMediaElementSource 对跨域资源输出静音（CORS 污染），
// EQ/可视化启用后在线歌全部无声。走本端代理即同源，Web Audio 图正常出声；同时绕过 CDN 防盗链。
// 支持 Range 请求（进度拖动）。
async function handleStream(req, res, reqUrl) {
  const raw = q(reqUrl, 'url') || '';
  if (!/^https?:\/\//i.test(raw)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('bad url');
  }
  try {
    const u = new URL(raw);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36',
      Referer: u.origin + '/',
      Accept: '*/*',
    };
    if (req.headers.range) headers.Range = req.headers.range;
    await transferAudio(req, res, u.toString(), { headers });
  } catch (e) {
    if (res.destroyed) return;
    if (res.headersSent) return res.destroy();
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('stream error');
  }
}

async function handleDownload(req, res, reqUrl) {  const vendor = q(reqUrl, 'vendor') || DEFAULT_VENDOR;
  const id = q(reqUrl, 'id');
  if (!id) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('missing id');
  }
  try {
    const name = q(reqUrl, 'name') || '';
    const artist = q(reqUrl, 'artist') || '';
    const duration = parseInt(q(reqUrl, 'duration') || '0', 10) || 0;
    const quality = q(reqUrl, 'quality') || 'standard';
    const { url } = await withTimeout(resolvePlayUrlCached({ vendor, id, name, artist, duration, quality }), RESOLVE_TOTAL_TIMEOUT);
    if (!url) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('no playable url');
    }
    const r = await fetch(url);
    if (!r.ok) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('upstream ' + r.status);
    }
    const ext = audioExtension(r.headers.get('content-type'), r.url || url);
    const safeName = ((name || id) + (artist ? ' - ' + artist : '')).replace(/[\\/:*?"<>|]/g, '_').slice(0, 110) + ext;
    res.writeHead(200, {
      'Content-Type': r.headers.get('content-type') || 'audio/mpeg',
      ...(r.headers.get('content-length') ? { 'Content-Length': r.headers.get('content-length') } : {}),
      'Content-Disposition': `attachment; filename="audio.mp3"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    await pipeline(Readable.fromWeb(r.body), res);
  } catch (e) {
    if (res.destroyed) return;
    if (res.headersSent) return res.destroy();
    console.error('[download error]', e && e.message);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('download error: ' + ((e && e.message) || ''));
  }
}

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`uzz music backend listening on http://localhost:${PORT}`);
    console.log(`default vendor: ${DEFAULT_VENDOR}`);
  });
}

/* ══════════════════════════════════════════════════════════════
 * 本地音乐接口
 * ══════════════════════════════════════════════════════════════ */
function localResolvePath(p) {
  // 安全解析：只允许扫描目录内、或经 addFile 校验过的音频文件
  if (!p) return null;
  let rp;
  try { rp = path.resolve(p); } catch (e) { return null; }
  const folders = localLib.folders().map((f) => path.resolve(f));
  if (folders.some((f) => { const rel = path.relative(f, rp); return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); })) return rp;
  return null;
}

async function handleLocal(req, res, reqUrl) {
  const p = reqUrl.pathname;
  const param = (n) => reqUrl.searchParams.get(n);
  try {
    // 扫描目录入媒体库
    if (p === '/api/local/scan') {
      const folders = (param('folders') || '').split('|').map((s) => s.trim()).filter(Boolean);
      if (!folders.length) return sendJson(res, 400, { code: 400, msg: '缺少 folders' });
      const r = await localLib.scan(folders, {});
      localLib.startWatch(); // 启动文件夹监控
      return sendJson(res, 200, { code: 200, ...r });
    }
    // 列表 / 分组
    if (p === '/api/local/library') {
      const filter = param('filter') || 'all';
      return sendJson(res, 200, { code: 200, tracks: localLib.getLibrary(filter) });
    }
    // 添加单个文件（双击关联文件打开时用）
    if (p === '/api/local/addFile') {
      const fp = param('path') || '';
      if (!fp || !path.isAbsolute(fp)) return sendJson(res, 400, { code: 400, msg: '需要绝对文件路径' });
      const rp = path.resolve(fp);
      const ext = path.extname(rp).toLowerCase();
      if (!localLib.AUDIO_EXT.has(ext)) return sendJson(res, 400, { code: 400, msg: 'not audio' });
      if (!fs.existsSync(rp)) return sendJson(res, 404, { code: 404, msg: '文件不存在' });
      const t = await localLib.addFile(rp);
      return sendJson(res, 200, { code: 200, track: t });
    }
    // 断点续听进度
    if (p === '/api/local/progress') {
      const id = param('id');
      const t = parseFloat(param('t') || '0');
      if (id) localLib.setProgress(id, t);
      return sendJson(res, 200, { code: 200 });
    }
    // 编辑元数据（覆盖，不回写文件）
    if (p === '/api/local/meta') {
      const id = param('id');
      const patch = {};
      if (param('name') != null) patch.name = param('name');
      if (param('artist') != null) patch.artist = param('artist');
      if (param('album') != null) patch.album = param('album');
      const t = await localLib.updateMeta(id, patch);
      return sendJson(res, 200, { code: 200, track: t });
    }
    // 从媒体库移除
    if (p === '/api/local/remove') {
      const id = param('id');
      const left = await localLib.removeTrack(id);
      return sendJson(res, 200, { code: 200, left });
    }
    // 重复文件检测
    if (p === '/api/local/duplicates') {
      return sendJson(res, 200, { code: 200, groups: localLib.findDuplicates() });
    }
    // 歌词（LRC）
    if (p === '/api/local/lyric') {
      const id = param('id');
      const lib = JSON.parse(require('fs').readFileSync(path.join(localLib.dataDir(), 'library.json'), 'utf-8'));
      const t = lib.tracks.find((x) => x.id === id);
      if (!t) return sendJson(res, 404, { code: 404, msg: 'not found' });
      return sendJson(res, 200, { code: 200, lyric: localLib.readLrc(t.path), hasLrc: t.hasLrc });
    }
    // CUE 分轨（更细：含全局 REM 信息 + 每轨作曲/ISRC/前导静音段/FLAG）
    if (p === '/api/local/cues') {
      const id = param('id');
      const lib = JSON.parse(require('fs').readFileSync(path.join(localLib.dataDir(), 'library.json'), 'utf-8'));
      const t = lib.tracks.find((x) => x.id === id);
      if (!t || !t.hasCue) return sendJson(res, 200, { code: 200, cues: [], meta: {} });
      const parsed = localLib.getCues(t.path);
      const cues = parsed.tracks.map((c, i) => ({
        no: c.no || (i + 1),
        title: c.title || ('Track ' + (i + 1)),
        performer: c.performer || t.artist,
        songwriter: c.songwriter || '',
        isrc: c.isrc || '',
        start: c.start,
        pre: c.pre || 0,
        end: c.end,
        hasPregap: !!c.hasPregap,
        flags: c.flags || [],
        file: c.file ? path.basename(c.file) : (t.name + path.extname(t.path)),
        audioId: t.id,
      }));
      return sendJson(res, 200, { code: 200, cues, meta: parsed.meta || {} });
    }
    // 智能歌单：按风格（语种/曲风/无损）自动归类本地媒体库
    if (p === '/api/local/smartplaylists') {
      return sendJson(res, 200, { code: 200, ...localLib.smartPlaylists() });
    }
    // 封面（按 coverId）
    if (p === '/api/local/cover') {
      const id = param('id');
      if (!id) { res.writeHead(400); return res.end('bad id'); }
      return localLib.serveCover(id, res);
    }
    // 流式播放（按 id 解析库内路径；或 path 限定在扫描目录内）
    if (p === '/api/local/stream') {
      let rp = null;
      const id = param('id');
      if (id) {
        const lib = JSON.parse(require('fs').readFileSync(path.join(localLib.dataDir(), 'library.json'), 'utf-8'));
        const t = lib.tracks.find((x) => x.id === id);
        if (t) rp = t.path;
      } else {
        rp = localResolvePath(param('path') || '');
      }
      if (!rp) { res.writeHead(403); return res.end('forbidden'); }
      return localLib.stream(rp, req, res);
    }
    return sendJson(res, 404, { code: 404, msg: 'unknown local api' });
  } catch (e) {
    console.error('[local api error]', p, e && e.message);
    return sendJson(res, 500, { code: 500, msg: (e && e.message) || 'server error' });
  }
}

// ══════ 识别网易云 ID：从链接 / 分享文案 / 纯数字 解析类型与数字 ID ══════
function classifyNeteaseInput(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  // 1) 从分享文案中提取网易云链接（可能夹带标题/口令）
  let url = s;
  const urlM = s.match(/https?:\/\/[^\s'"<>]*music\.163\.com[^\s'"<>]*/i);
  if (urlM) url = urlM[0];
  // 处理 hash 路由：music.163.com/#/playlist?id=123
  const hashIdx = url.indexOf('#');
  if (hashIdx >= 0) url = url.slice(hashIdx + 1);
  // 2) 识别类型（歌单 / 专辑 / 单曲 / 歌手）
  let type = null;
  const order = ['playlist', 'album', 'song', 'artist', 'djradio', 'program', 'toplist'];
  for (const t of order) {
    if (new RegExp('(?:^|[/?#])' + t + '(?=[/?#]|$|:)', 'i').test(url)) { type = t; break; }
  }
  // 3) 提取数字 ID：优先 id=NNN
  let id = null;
  const idM = url.match(/[?&#]id=(\d+)/);
  if (idM) id = idM[1];
  else {
    const segs = url.split('/').filter(Boolean);
    for (let i = segs.length - 1; i >= 0; i--) {
      const m = segs[i].match(/^(\d{4,})/); // 至少 4 位，避免误伤路径关键字
      if (m) { id = m[1]; break; }
    }
  }
  // 纯数字串（无链接）→ 视为歌单 ID
  if (!id && /^\d+$/.test(s)) { id = s; type = 'playlist'; }
  if (!id) return null;
  if (!type) type = 'playlist';
  // 电台/节目/排行榜统一按歌单取曲目
  if (type === 'djradio' || type === 'program' || type === 'toplist') type = 'playlist';
  return { type, id };
}

// QQ / 酷狗歌单 ID 提取：链接里的 id= / specialid= / global_specialid，或纯数字
function classifyPlatformId(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  const pats = [
    /[?&#]specialid=(\d+)/i,
    /[?&#]global_specialid=(\d+)/i,
    /[?&#]disstid=(\d+)/i,
    /[?&#]id=(\d+)/i,
  ];
  for (const p of pats) {
    const m = s.match(p);
    if (m) return m[1];
  }
  if (/^\d{3,}$/.test(s)) return s;
  // 从路径尾段兜底提取数字
  const segs = s.split('/').filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    const m = segs[i].match(/^(\d{4,})/);
    if (m) return m[1];
  }
  return null;
}

// 把 provider 返回的曲目规整成前端模型
function normalizeImportTrack(t) {
  return {
    id: String(t.id),
    name: t.name || '未知',
    artist: t.artist || '',
    artistId: t.artistId || '',
    album: t.album || '',
    albumId: t.albumId || '',
    pic: t.pic || '',
    vendor: t.vendor || 'netease',
    duration: t.duration || 0,
  };
}

module.exports = { server, getProvider, classifyNeteaseInput };
