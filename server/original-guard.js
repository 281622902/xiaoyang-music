/* ============================================================
 * original-guard.js — 原唱守卫（v3.6.0 阶段一）
 *
 * 用户原话：「搜周杰伦，列表显示周杰伦，点进去却是别人唱的！
 *   如果解析出的音频歌手与搜索词不符，宁可放不出声音，也不要放
 *   翻唱/盗版，直接提示『暂无原唱版权』。」
 *
 * 本模块只做判定，不发起网络请求，方便单测与在解析链各步复用：
 *   1) 歌手归一化：别名 / 繁简 / 分隔符 / 大小写 / 括号补充说明；
 *   2) 二次创作识别：翻唱 / cover / 伴奏 / Live / 串烧 / DJ / 加速版等，
 *      以及「歌名里写着原唱 XXX」这种把翻唱者塞进 artist 的脏数据；
 *   3) 严格匹配：候选歌手必须与期望歌手实打实对得上，
 *      「包含」只在双方都是完整词时才算（避免「周杰伦」命中「周杰伦粉丝团」）；
 *   4) 期望歌手推断：优先用户搜索词里的歌手，其次列表显示歌手。
 *
 * 设计取舍：宁可误杀，不可放过。判定不通过时上层不返回播放地址。
 * ============================================================ */
'use strict';

// ── 歌手别名（跨平台写法差异）──────────────────────────────
const ALIAS = {
  jay: '周杰伦', 'jaychou': '周杰伦', 'jay chou': '周杰伦',
  '周杰倫': '周杰伦', '周董': '周杰伦', '周杰伦': '周杰伦',
  'jj': '林俊杰', '林俊傑': '林俊杰', '林俊杰': '林俊杰',
  '薛之謙': '薛之谦', '陈奕迅': '陈奕迅', '陳奕迅': '陈奕迅',
  '邓紫棋': '邓紫棋', '鄧紫棋': '邓紫棋', 'g.e.m.': '邓紫棋', 'gem': '邓紫棋',
  '张学友': '张学友', '張學友': '张学友', '王菲': '王菲', 'faye wong': '王菲',
  '五月天': '五月天', 'mayday': '五月天', 's.h.e': 'S.H.E', 'she': 'S.H.E',
  'taylor swift': 'Taylor Swift', 'taylorswift': 'Taylor Swift',
  'adele': 'Adele', 'ed sheeran': 'Ed Sheeran',
  '周深': '周深', '毛不易': '毛不易', '李荣浩': '李荣浩', '李榮浩': '李荣浩',
};

// 去掉大小写、空白、标点、括号补充说明
function norm(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s·・\-—_,，。.、!！?？'"《》【】\[\]<>~@#￥$%^&*+=|\\/]/g, '');
}

// 拆歌手：网易/QQ 常把合唱写成 "A/B"、"A、B"、"A & B"
function parts(value) {
  return String(value == null ? '' : value)
    .split(/[\/、,，&＆+＋·|;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function canonical(value) {
  const key = norm(value);
  return ALIAS[key] || String(value || '').trim();
}

function canonicalParts(value) {
  return parts(value).map(canonical);
}

// ── 二次创作识别 ────────────────────────────────────────────
// 命中即视为「非原唱」，搜索阶段剔除、解析阶段不采信。
const DERIVATIVE_WORDS = [
  '翻唱', '翻自', 'cover', '翻唱版', '改编', '改編', '串烧', '串燒', 'remix',
  '伴奏', '纯音乐', '純音樂', 'instrumental', 'karaoke', '卡拉ok',
  'live', '现场版', '現場版', '演唱会', '演唱會', 'live版',
  'dj', 'dj版', '慢速', '加速', '降调', '升调', '0.8x', '1.2x',
  '钢琴版', '鋼琴版', '吉他版', '古筝版', '二胡版', '小提琴版', '萨克斯',
  '女声版', '男声版', '童声版', '戏腔', '粤语版', '日语版', '英语版',
  '完整版', '剪辑版', '片段', '试听', '試聽', 'demo', '饭制', '粉丝',
  'tribute', 'acoustic', 'unplugged', 'nightcore', 'bootleg', 'mashup',
];
// 「(原唱 周杰伦)」这类括号标记：说明这条是别人翻唱、只是标注了原唱者
const ORIGIN_MARK = /(原唱|原唱者|原唱歌手|cover\s*[:：]?|翻自)/i;

function isDerivative(name, artist) {
  const n = String(name || '').toLowerCase();
  const a = String(artist || '').toLowerCase();
  for (const w of DERIVATIVE_WORDS) {
    if (n.includes(w) || a.includes(w)) return true;
  }
  // 歌名里出现「(原唱 XXX)」→ 该条目本身是翻唱
  if (ORIGIN_MARK.test(String(name || ''))) return true;
  // 歌手字段里塞了「XX 翻唱」「XX(cover)」等
  if (ORIGIN_MARK.test(String(artist || ''))) return true;
  return false;
}

// ── 严格歌手匹配 ────────────────────────────────────────────
// 返回 0~3：3=规范名完全相同 2=包含同一个完整歌手词 1=弱相关 0=不匹配
function artistMatch(candidateArtist, expectedArtist) {
  const want = norm(canonical(expectedArtist));
  if (!want) return 0;
  const cands = canonicalParts(candidateArtist).map(norm);
  if (!cands.length) return 0;
  if (cands.includes(want)) return 3;
  // 「包含」必须是候选里的某个完整歌手词被期望词完整包含（或反之），
  // 且长度差不能太大——避免「周杰伦」命中「周杰伦的粉丝后援会」。
  for (const c of cands) {
    if (!c) continue;
    const short = Math.min(c.length, want.length);
    const long = Math.max(c.length, want.length);
    if (long - short > 2) continue;
    if (c.includes(want) || want.includes(c)) return short >= 2 ? 2 : 1;
  }
  return 0;
}

// 期望歌手是否有意义（避免把「未知」「网络歌手」当强约束）
const WEAK_ARTISTS = new Set(['', '未知', '未知歌手', '网络歌手', '群星', ' Various', 'various', 'va', '原唱', '华语群星']);
function meaningfulArtist(value) {
  const a = norm(value);
  return !!a && !WEAK_ARTISTS.has(a) && !WEAK_ARTISTS.has(String(value || '').trim().toLowerCase());
}

/**
 * 从播放请求里推断「期望歌手」。
 * 优先用户搜索词里的歌手（explicit），其次曲目显示歌手（display）。
 */
function expectedArtist({ explicit, display } = {}) {
  if (meaningfulArtist(explicit)) return String(explicit).trim();
  if (meaningfulArtist(display)) return String(display).trim();
  return '';
}

/**
 * 判定一条候选曲目能否作为「原唱」使用。
 * @returns {{ok:boolean, reason:string, match:number, derivative:boolean}}
 */
function judge(candidate, expected) {
  const want = expectedArtist({ explicit: expected });
  const derivative = isDerivative(candidate && candidate.name, candidate && candidate.artist);
  if (!want) {
    // 没有歌手约束时只挡明显的二次创作
    return { ok: !derivative, reason: derivative ? '二次创作版本' : '', match: 0, derivative };
  }
  if (derivative) return { ok: false, reason: '二次创作版本', match: 0, derivative: true };
  const match = artistMatch(candidate && candidate.artist, want);
  if (match >= 2) return { ok: true, reason: '', match, derivative: false };
  return { ok: false, reason: '歌手不匹配（疑似翻唱/盗版）', match, derivative: false };
}

module.exports = {
  norm, parts, canonical, canonicalParts,
  isDerivative, artistMatch, meaningfulArtist, expectedArtist, judge,
  DERIVATIVE_WORDS,
};
