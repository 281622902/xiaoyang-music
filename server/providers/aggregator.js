/* ============================================================
 * aggregator.js — 全网底层音源聚合（v3.6.0 阶段一）
 *
 * 目标（用户原话）：「不要局限于现有接口，可以尝试接入更底层的全网
 *   音源聚合，只要确保是真的原唱。」
 *
 * 与 searchMerged 的区别：
 *   - searchMerged 面向「列表展示」，要尽量召回，用打分排序；
 *   - 本模块面向「播放解析兜底」，宁缺毋滥——并行打穿各家的底层
 *     搜索口（GDStudio 网易 / meting 网易·QQ·酷狗 / 各家原生搜索），
 *     但每一条候选都必须通过 original-guard 的严格判定才能进入候选池。
 *
 * 设计要点：
 *   1) 全部请求并行，整体硬超时（默认 5.5s），不拖慢播放解析主链路；
 *   2) 歌名用 titleScore 卡 >=2，歌手用 judge() 卡 ok；
 *   3) 跨平台共现（多个不同平台都收录同一「歌名+歌手」）= 原唱强信号，
 *      排在最前；只在单一小平台出现、且带版本标记的条目直接丢弃；
 *   4) 输出的候选保留 vendor/id/pic/duration，供上层逐个尝试解析地址。
 *      上层仍要做 probeAudioLen / isFullAudio 校验，本模块不碰网络音频。
 * ============================================================ */
'use strict';

const guard = require('../original-guard');
const { titleScore, normalizeName, stripVersion, aliasArtist } = require('../search-merge');

const gds = require('./gds');
const qmeting = require('./qmeting');
const netease = require('./netease');
const tencent = require('./tencent');
const kugou = require('./kugou');
const kuwo = require('./kuwo');

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); }),
  ]);
}

const swallow = (p) => Promise.resolve(p).then((r) => (r && r.list ? r.list : [])).catch(() => []);

/**
 * 并行打穿底层聚合口。
 * @param {string} name 目标歌名（用户看到 / 搜索词里的歌名）
 * @param {string} artist 期望歌手（强约束；为空时只挡二次创作）
 * @param {{timeout?:number, limit?:number}} opts
 * @returns {Promise<Array>} 严格匹配原唱的候选，按可信度降序
 */
async function searchOriginal(name, artist, opts = {}) {
  const nm = String(name || '').trim();
  const ar = String(artist || '').trim();
  if (!nm) return [];
  const timeout = Number(opts.timeout || 5500);
  const limit = Math.max(1, Math.min(30, Number(opts.limit || 12)));
  const want = guard.expectedArtist({ explicit: ar });
  const queries = [nm];
  if (want) queries.push(nm + ' ' + want);

  const jobs = [];
  for (const qk of queries) {
    // 国内 meting 聚合（三个平台的真实索引，海外后端可达）
    jobs.push({ source: 'qmeting-netease', platform: 'netease', list: swallow(qmeting.search('netease', qk, 1, 20)) });
    jobs.push({ source: 'qmeting-tencent', platform: 'tencent', list: swallow(qmeting.search('tencent', qk, 1, 20)) });
    jobs.push({ source: 'qmeting-kugou', platform: 'kugou', list: swallow(qmeting.search('kugou', qk, 1, 20)) });
    // GDStudio 网易底层（返回的是「当前可播」子集）
    jobs.push({ source: 'gds-netease', platform: 'netease', list: swallow(gds.search('netease', qk, 1, 20)) });
    // 各家原生搜索口
    jobs.push({ source: 'netease', platform: 'netease', list: swallow(netease.search(qk, 'song', 1, 20)) });
    jobs.push({ source: 'tencent', platform: 'tencent', list: swallow(tencent.search(qk, 'song', 1, 20)) });
    jobs.push({ source: 'kugou', platform: 'kugou', list: swallow(kugou.search(qk, 'song', 1, 20)) });
    jobs.push({ source: 'kuwo', platform: 'kuwo', list: swallow(kuwo.search(qk, 'song', 1, 20)) });
  }

  let settled;
  try {
    settled = await withTimeout(Promise.all(jobs.map((j) => j.list)), timeout);
  } catch (e) {
    // 整体超时：用 Promise.allSettled 也拿不到结果，直接返回空，上层走原有链路
    return [];
  }

  const buckets = new Map();
  settled.forEach((list, i) => {
    const job = jobs[i];
    for (const raw of list || []) {
      if (!raw || !raw.name || !raw.id) continue;
      // ① 歌名必须真的是这首（挡「同名不同曲」「XX 的翻唱合集」）
      if (titleScore(raw.name, nm) < 2) continue;
      // ② 原唱守卫：二次创作 / 歌手对不上，一律不进候选池
      const verdict = guard.judge(raw, want);
      if (!verdict.ok) continue;
      const key = normalizeName(stripVersion(raw.name)) + '||' +
        normalizeName(aliasArtist(raw.artist || ''));
      let b = buckets.get(key);
      if (!b) {
        b = {
          ...raw,
          // 聚合源返回的 vendor 可能是 qmeting/gds 这类「通道名」而非音源名，
          // 上层 resolvePlayUrl 要拿它去 getProvider()，必须规范化成真实音源。
          vendor: /^(netease|tencent|kugou|kuwo)$/.test(String(raw.vendor || '')) ? raw.vendor : job.platform,
          _sources: new Set(),
          _platforms: new Set(),
          _match: verdict.match,
          _score: 0,
        };
        buckets.set(key, b);
      }
      b._sources.add(job.source);
      b._platforms.add(job.platform);
      // 信息更完整的那份作为代表（有封面 / 有直链 / 有时长）
      const w = (t) => (t.pic ? 3 : 0) + (t.url ? 4 : 0) + (t.duration ? 2 : 0) + (t.album ? 1 : 0);
      if (w(raw) > w(b)) {
        const goodVendor = /^(netease|tencent|kugou|kuwo)$/.test(String(raw.vendor || '')) ? raw.vendor : job.platform;
        Object.assign(b, raw, { vendor: goodVendor }, { _sources: b._sources, _platforms: b._platforms, _match: b._match, _score: b._score });
      }
    }
  });

  const out = [];
  for (const b of buckets.values()) {
    // 跨平台共现加分：原唱在多家都有收录，翻唱往往只在一家
    b._score = (b._platforms.size - 1) * 20 + b._match * 8 + (b.pic ? 3 : 0) + (b.url ? 6 : 0);
    out.push({
      ...b,
      _sources: [...b._sources],
      _platforms: [...b._platforms],
    });
  }
  out.sort((a, b) => (b._score - a._score) || (b.duration - a.duration));
  return out.slice(0, limit);
}

module.exports = { name: 'aggregator', searchOriginal, withTimeout };
