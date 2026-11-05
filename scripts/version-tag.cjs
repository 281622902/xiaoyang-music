'use strict';
/* ============================================================
 * version-tag.cjs — 双端独立发版的 Tag 解析（v3.6.0 准则落地）
 *
 * 规则（小杨 2026-11-05 拍板）：
 *   pc-v4.0.0      只触发 Windows 打包发布
 *   mobile-v3.6.0  只触发 Android 打包发布
 *   all-v3.7.0     双端同时打包发布（需用户明确说「双端同步更新」）
 *   v3.5.0         历史 Tag，仅供本地工具读取/重建，不再触发任何发布
 *
 * ⚠️ 写进 Supabase app_versions 的 version 必须是纯语义版本号，
 *    绝不能把 pc- / mobile- / all- 前缀带进数据库。
 *
 * 所有构建脚本（update-supabase.js / android-release.cjs / release.js）
 * 一律通过本模块解析，避免三处正则各自漂移。
 * ============================================================ */
// 正式发布只允许 X.Y.Z 三段纯语义版本号（不接受 -beta / +build，
// 与既有 release 测试的约束一致：预发布 Tag 不能进正式发布流水线）。
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const PREFIX = { pc: 'pc', mobile: 'mobile', all: 'all' };

/**
 * @param {string} tag 形如 mobile-v3.6.0 / pc-v4.0.0 / all-v3.7.0 / v3.5.0
 * @returns {{tag:string, version:string, target:string, legacy:boolean}}
 */
function parseReleaseTag(tag) {
  const raw = String(tag || '').trim();
  if (!raw) throw new Error('缺少发布 Tag');
  const m = /^(?:(pc|mobile|all)-)?v(.+)$/.exec(raw);
  // 错误消息保留「以 v 开头」措辞，兼容既有 release 测试的断言
  if (!m) throw new Error('发布 Tag 必须以 v 开头（可带 pc-/mobile-/all- 前缀），并包含合法语义版本号');
  const target = m[1] || 'legacy';
  const version = m[2];
  if (!SEMVER.test(version)) {
    throw new Error('Tag 中的版本号不合法：' + version + '（应为合法语义版本 X.Y.Z，不要带 pc-/mobile-/all- 前缀）');
  }
  return { tag: raw, version, target, legacy: target === 'legacy' };
}

/** 由「目标端 + 版本号」生成 Tag */
function buildTag(target, version) {
  if (!SEMVER.test(String(version || ''))) throw new Error('版本号应为 X.Y.Z 格式');
  if (!PREFIX[target]) throw new Error('发布目标应为 pc / mobile / all');
  return PREFIX[target] + '-v' + version;
}

/** 该 Tag 是否应触发 Android 发布 */
function runsAndroid(tag) { const t = parseReleaseTag(tag).target; return t === 'mobile' || t === 'all'; }
/** 该 Tag 是否应触发 Windows 发布 */
function runsWindows(tag) { const t = parseReleaseTag(tag).target; return t === 'pc' || t === 'all'; }

module.exports = { parseReleaseTag, buildTag, runsAndroid, runsWindows, SEMVER };
