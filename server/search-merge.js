/* ============================================================
 * search-merge.js — 多源搜索合并 + 歌手匹配 + 排序打分
 *
 * 解决的问题（用户实测反馈）：
 *   「搜周杰伦的歌搜到的不是周杰伦唱的」——网易云搜索结果里同名歌
 *   的翻唱/其它歌手版本与原唱混排，且原唱不一定在前。
 *
 * 解法：
 *   1) 多源并行（网易 / QQ / GDStudio / meting 聚合）结果合并；
 *   2) 按「歌名 + 歌手」归一化分组，跨源同时出现的曲目视为权威原唱
 *      （原唱在多个平台都有收录，翻唱通常只在个别平台），跨源数给分；
 *   3) 支持显式 artist 目标（前端识别「歌名 - 歌手」或独立参数），
 *      歌手命中者置顶；不命中者降权但不完全剔除（避免 0 结果）；
 *   4) 输出 matched 标记，前端可提示「已按歌手筛选」。
 *
 * v3.6.0 阶段一：接入 original-guard 做「原唱强匹配」。
 *   用户指定歌手（搜「周杰伦」/「晴天 周杰伦」）时，翻唱/伴奏/Live/
 *   歌手对不上的条目**直接剔除**，不再只是降权；宁可列表短，也不给错歌。
 *   同时新增 mergeArtists() 把多源重复歌手合并成唯一卡片。
 * ============================================================ */

const guard = require('./original-guard');

// 归一化：去大小写、空白、标点、括号补充说明（如「晴天 (Live)」→「晴天」）
function normalizeName(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s·・\-—_,，。.、!！?？'"'"《》【】\[\]<>~@#￥$%^&*+=|\\/]/g, '');
}

// 拆出主歌名与副歌名里的合作者/版本信息（feat. / ft. / with / Live / 现场版 / 翻唱版）
function stripVersion(value) {
  return String(value == null ? '' : value)
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\s*(feat\.?|ft\.?|featuring)\s.*$/i, '')
    .replace(/\s*[-–—]\s*(live|remix|翻唱|现场|伴奏|纯音乐|官方版|高音质).*$/i, '')
    .trim();
}

// 版本标记词：命中即视为「二次创作/改编版本」，降权。
// 用户实测痛点：网易未登录搜索把「晴天 (原唱 周杰伦)」的 artist 标成翻唱者
// （RyaVocal），若不降权，它会在列表里压过真正的原唱条目。
const VERSION_WORDS = [
  '原唱', '翻唱', '改编', '女声', '男声', '钢琴', '弦乐', '吉他', '古筝', '二胡', '琵琶',
  '伴奏', '纯音乐', '纯音樂', 'instrumental', 'cover', 'remix', 'live', '现场',
  'dj版', '加速', '慢速', '钢琴版', '吉他版', 'deep', '抖音', '完整版', '剪辑', '交响',
];
function versionPenalty(name) {
  const n = String(name || '').toLowerCase();
  for (const w of VERSION_WORDS) {
    if (n.includes(w)) return 22;
  }
  return 0;
}

// 歌手别名：同一歌手在不同平台可能用不同写法（Jay / 周杰伦 / 周杰倫）
const ARTIST_ALIAS = {
  jay: '周杰伦', 周杰倫: '周杰伦', 周杰伦: '周杰伦',
  'jay chou': '周杰伦', 周董: '周杰伦',
  林俊杰: '林俊杰', jj: '林俊杰',
  薛之谦: '薛之谦',
};
function aliasArtist(value) {
  const parts = artistParts(value);
  if (!parts.length) return '';
  return parts.map((p) => {
    const key = normalizeName(p);
    return ARTIST_ALIAS[key] || p;
  }).join('/');
}
function artistParts(value) {
  return String(value == null ? '' : value)
    .split(/[\/、,，&＆+＋·|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// 归一化后两个名字是否"是同一首歌"
function titleEqual(a, b) {
  const x = normalizeName(stripVersion(a));
  const y = normalizeName(stripVersion(b));
  if (!x || !y) return false;
  return x === y;
}

// 歌名相似度：3=完全相同 2=互相包含 1=版本名相同 0=无关
function titleScore(trackName, wantedName) {
  const raw = normalizeName(trackName);
  const want = normalizeName(wantedName);
  const bare = normalizeName(stripVersion(trackName));
  if (!raw || !want) return 0;
  if (raw === want) return 3;
  if (bare && bare === want) return 3;
  if (raw.includes(want) || want.includes(raw)) return 2;
  if (bare && (bare.includes(want) || want.includes(bare))) return 1;
  return 0;
}

// 歌手相似度：3=完全相同 2=包含 1=部分字符重叠 0=无关
function artistScore(trackArtist, wantedArtist) {
  const parts = artistParts(trackArtist);
  if (!parts.length) return 0;
  const want = normalizeName(wantedArtist);
  if (!want) return 0;
  const names = parts.map(normalizeName);
  if (names.includes(want)) return 3;
  if (names.some((n) => n.includes(want) || want.includes(n))) return 2;
  // 逐字包含关系（例如「周杰伦」vs「周杰倫」不同字时不匹配）
  if (want.length >= 2 && names.some((n) => n.length >= 2 && [...want].every((ch) => n.includes(ch)))) return 1;
  return 0;
}

// 从查询串里拆出候选片段：支持 "歌名 - 歌手"、"歌手 - 歌名"
function splitQuery(keyword) {
  const kw = String(keyword || '').trim();
  const sep = kw.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (!sep) return { title: kw, artist: '', parts: [] };
  const a = sep[1].trim();
  const b = sep[2].trim();
  if (!a || !b) return { title: kw, artist: '', parts: [] };
  // 「歌手 - 歌名」写法：左侧命中常见歌手名且右侧不像 → 反转
  if (isKnownArtist(a) && !isKnownArtist(b)) return { title: b, artist: a, parts: [a, b] };
  return { title: a, artist: b, parts: [a, b] };
}

// 常见歌手名（用于 "歌名 - 歌手" 的左右判定；命中不了也按「歌名 - 歌手」兜底）
const KNOWN_ARTISTS = [
  '周杰伦', '林俊杰', '陈奕迅', '薛之谦', '张杰', '五月天', '邓紫棋', '王菲', '张学友', '陈奕迅',
  '李宗盛', '陶喆', '许巍', '朴树', '汪峰', '郑源', '胡彦斌', '张靓颖', '毛不易', '赵雷',
  '李荣浩', '毛不易', '周深', '单依纯', '刘惜君', '张碧晨', '蔡依林', 'Taylor Swift', 'Adele',
  'Ed Sheeran', 'Justin Bieber', '周笔畅', '梁静茹', '孙燕姿', '莫文蔚', '那英', '田馥甄',
  'S.H.E', '任贤齐', '刘若英', '许嵩', '汪苏泷', '金志文', '曹轩宾', '陈一发', '南征北战',
];
const KNOWN_SET = new Set(KNOWN_ARTISTS.map(normalizeName));
function isKnownArtist(name) {
  const n = normalizeName(name);
  if (!n) return false;
  return KNOWN_SET.has(n);
}

/**
 * 合并多源搜索结果。
 * @param {Array<{list:Array,total:number,source:string}>} groups 各源返回
 * @param {{title?:string, artist?:string}} opts 目标歌名 / 歌手
 * @param {number} limit 最多返回条数
 */
function mergeResults(groups, opts = {}, limit = 20) {
  const wantTitle = opts.title || '';
  const wantArtist = opts.artist || '';
  const buckets = new Map();

  // 同一平台的多个采集口（网易直连 / meting 聚合 / GDStudio）算作一个平台，
  // 只有「不同平台都收录」才算跨平台共现（= 原唱权威度的强信号）。
  const PLATFORM = {
    netease: 'netease', qmeting: 'netease', gds: 'netease', aggregate: 'netease',
    tencent: 'tencent', kugou: 'kugou', kuwo: 'kuwo',
  };

  for (const group of groups) {
    const source = group.source || '';
    const platform = PLATFORM[source] || source || 'unknown';
    for (const item of group.list || []) {
      if (!item || !item.name) continue;
      const trackArtist = item.artist || '';
      const key = normalizeName(stripVersion(item.name)) + '||' + aliasArtist(trackArtist).split('/').map(normalizeName).sort().join('/');
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { key, base: item, sources: new Set(), platforms: new Set(), best: item };
        buckets.set(key, bucket);
      }
      bucket.sources.add(source || 'unknown');
      bucket.platforms.add(platform);
      // 同一首歌保留「信息最完整 + 最可能可播」的那份：
      //   权重 ①信息完整度（封面/时长/专辑）②音源可播性
      //   netease 权重最高——免登录状态下网易搜索返回的就是「当前可播子集」；
      //   tencent 次之（歌词/封面最全，但免登录 vkey 已失效，靠跨源兜底播放）；
      //   kugou 再次（搜索歌手准确，播放走跨源兜底）。
      const VENDOR_W = { netease: 5, tencent: 3, kugou: 2 };
      const scoreOf = (t) => (t.pic ? 2 : 0) + (t.duration ? 1 : 0) + (t.album ? 1 : 0) + (VENDOR_W[t.vendor] || 0);
      if (scoreOf(item) > scoreOf(bucket.best)) bucket.best = item;
    }
  }

  const scored = [];
  // 用户明确给了歌手目标时启用「原唱强匹配」：翻唱 / 伴奏 / Live / 歌手不符
  // 的条目直接不进结果集，而不是降权后排在后面被误点。
  // 没有歌手目标时保持原有打分（泛搜索仍要尽量召回），只用 _original 标记。
  const strictOriginal = !!wantArtist && opts.strict !== false;
  for (const bucket of buckets.values()) {
    const t = bucket.best;
    const verdict = guard.judge(t, wantArtist);
    if (strictOriginal && !verdict.ok) continue;
    const ts = titleScore(t.name, wantTitle);
    const as = wantArtist ? artistScore(aliasArtist(t.artist), aliasArtist(wantArtist)) : 0;
    let score = ts * 40;
    if (wantArtist) score += as * 45;
    // 跨平台共现：原唱通常在多个平台都有收录，翻唱一般只在个别平台
    score += Math.max(0, bucket.platforms.size - 1) * 14;
    // 封面完整度微调（视觉优先展示有封面的）
    if (t.pic) score += 3;
    // 二次创作/改编版本降权（原唱条目优先）
    score -= versionPenalty(t.name);
    if (wantArtist && as === 0) score -= 26;
    if (wantArtist && as === 1) score -= 8;
    if (ts === 0) score -= 18;
    scored.push({
      ...t,
      // 歌手别名归一后的显示名（Jay → 周杰伦），原始 artist 保留在 rawArtist
      artist: aliasArtist(t.artist) || t.artist,
      rawArtist: t.artist,
      _score: score,
      _titleScore: ts,
      _artistScore: as,
      _version: versionPenalty(t.name) > 0,
      _original: verdict.ok,
      _matchReason: verdict.reason || '',
      _sources: [...bucket.sources],
      _platforms: [...bucket.platforms],
      _matched: wantArtist ? as >= 2 : ts >= 3,
    });
  }

  scored.sort((a, b) => (b._score - a._score) || (b.duration - a.duration));

  // 去重：按「归一歌名 + 归一歌手」去重——同名不同歌手是不同曲目，必须都保留；
  // 同一歌手的同一首歌在多平台重复出现时只留一条（已在上游 bucket 内合并）。
  const seenTitle = new Set();
  const out = [];
  for (const t of scored) {
    const k = normalizeName(stripVersion(t.name)) + '||' + normalizeName(aliasArtist(t.artist));
    if (seenTitle.has(k)) continue;
    seenTitle.add(k);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 歌手去重合并（v3.6.0 阶段一）。
 * 多源搜索歌手时会出现：「周杰伦」「周杰倫」「Jay Chou」「周杰伦 · 相关歌曲集」
 * 以及同一歌手在不同平台的多张卡片。这里按「归一化 + 别名映射」合并成唯一
 * 歌手卡片，并保留最有用的 id 与封面：
 *   - 真实平台 id 优先于 name:/artistlist: 这类聚合伪 id（点进去才能拿到真热门歌曲）
 *   - 有封面的覆盖没封面的（列表不能出现白块）
 * 返回项带 _aliases / _sources / _mergedCount，前端可展示「合并了 N 个重复项」。
 */
function mergeArtists(list, opts = {}) {
  const limit = Math.max(1, Math.min(50, Number(opts.limit || 20)));
  const buckets = new Map();
  for (const item of list || []) {
    if (!item || !item.name) continue;
    const raw = String(item.name).trim();
    // 聚合兜底生成的「XXX · 相关歌曲集」不是歌手卡片，先剥掉后缀
    const clean = raw.replace(/\s*[·・\-—]\s*相关歌曲集\s*$/, '').trim();
    if (!clean) continue;
    const key = normalizeName(guard.canonical(clean));
    if (!key) continue;
    let b = buckets.get(key);
    if (!b) {
      b = {
        ...item,
        id: String(item.id || ''),
        name: guard.canonical(clean),
        artist: guard.canonical(clean),
        _aliases: new Set(),
        _sources: new Set(),
        _mergedCount: 0,
      };
      buckets.set(key, b);
    }
    b._aliases.add(raw);
    if (item.vendor) b._sources.add(item.vendor);
    b._mergedCount += 1;
    const bFake = /^(name|artistlist)\s*:/.test(String(b.id || ''));
    const iFake = /^(name|artistlist)\s*:/.test(String(item.id || ''));
    if (bFake && !iFake) { b.id = String(item.id); b.vendor = item.vendor || b.vendor; }
    if (!b.pic && item.pic) b.pic = item.pic;
    if (!b.artistId && item.artistId) b.artistId = item.artistId;
  }
  // 二次合并：装饰性变体（「周杰伦♚」「周杰伦jay」「周杰伦(官方)」）
  // 各家平台很常见，按前缀/包含关系归到最短的主名，避免同一歌手出多张卡。
  const keys = [...buckets.keys()].sort((a, b) => a.length - b.length);
  const aliasOf = new Map();
  for (const short of keys) {
    if (short.length < 2) continue;
    for (const long of keys) {
      if (long === short || aliasOf.has(long)) continue;
      if (long.length <= short.length || long.length - short.length > 4) continue;
      if (long.startsWith(short) || long.includes(short)) aliasOf.set(long, short);
    }
  }
  for (const [from, to] of aliasOf) {
    const src = buckets.get(from), dst = buckets.get(to);
    if (!src || !dst) continue;
    dst._aliases = new Set([...dst._aliases, ...src._aliases]);
    dst._sources = new Set([...dst._sources, ...src._sources]);
    dst._mergedCount += src._mergedCount;
    const dFake = /^(name|artistlist)\s*:/.test(String(dst.id || ''));
    const sFake = /^(name|artistlist)\s*:/.test(String(src.id || ''));
    if (dFake && !sFake) { dst.id = src.id; dst.vendor = src.vendor || dst.vendor; }
    if (!dst.pic && src.pic) dst.pic = src.pic;
    buckets.delete(from);
  }

  const out = [...buckets.values()].map((b) => ({
    ...b,
    _aliases: [...b._aliases],
    _sources: [...b._sources],
  }));
  // 有封面的排前面（视觉优先），其次按合并数量（热门歌手在多源出现更多）
  out.sort((a, b) => (!!b.pic - !!a.pic) || (b._mergedCount - a._mergedCount));
  return out.slice(0, limit);
}

module.exports = {
  mergeResults, mergeArtists, splitQuery, titleScore, artistScore,
  artistParts, normalizeName, stripVersion, isKnownArtist,
};
