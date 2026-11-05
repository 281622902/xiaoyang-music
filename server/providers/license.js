/* ============================================================
 * license.js — 设备授权码（v3.5.0 防泄露机制）
 *
 * 规则：
 *   - 授权码绑定「设备指纹 + 版本号」，换设备不可用；
 *   - 每次发版换一批新码：旧版本授权码在新版本上校验失败，自动失效；
 *   - revoked=true 可随时吊销单个码；
 *   - 授权表只有服务端能读写，客户端只通过 /api/auth/license/* 交互。
 *
 * 存储：
 *   1) SUPABASE_SERVICE_KEY 可用 → 用 Supabase 的 app_licenses 表
 *      （见 supabase/app_licenses.sql），生产环境走这条；
 *   2) 否则 → 落本地 JSON 文件（server/data/licenses.json），便于本地
 *      开发与单机部署。两种存储共用同一套业务规则。
 *
 * 码格式：XY<版本号>-<4-4-4 大写字母数字>
 *   例：XY3.5.0-K7QM-2X9D-H4TB
 * ============================================================ */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_PREFIX = 'XY';
const DATA_FILE = process.env.XY_LICENSE_FILE || path.join(__dirname, '..', 'data', 'licenses.json');

// 大小写不敏感的码（用户手输常带空格/小写）
function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
}
function versionOfCode(code) {
  const m = /^XY([0-9]+\.[0-9]+\.[0-9]+)/.exec(normalizeCode(code));
  return m ? m[1] : '';
}
function randomChunk(len) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
/** 生成授权码：XY3.5.0-K7QM-2X9D-H4TB */
function generateCode(version) {
  const v = String(version || '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error('版本号格式应为 x.y.z');
  return `${CODE_PREFIX}${v}-${randomChunk(4)}-${randomChunk(4)}-${randomChunk(4)}`;
}

/* ============================================================
 * 存储层
 * ============================================================ */
function useFile(env = process.env) {
  return !env.SUPABASE_SERVICE_KEY;
}
function readFileStore(env = process.env) {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) { return []; }
}
function writeFileStore(rows, env = process.env) {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2), 'utf8');
  } catch (e) {
    throw new Error('授权表写入失败：' + (e.message || '未知错误'));
  }
}
async function supabaseRows(env, query = {}) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase 未配置（SUPABASE_URL / SUPABASE_SERVICE_KEY）');
  const target = new URL(url + '/rest/v1/app_licenses');
  // 过滤器参数兼容两种调用约定：{ select, order, ... } 直接传，或
  // { method, query: {...}, body } 嵌套传（saveRow/patchRow 用后者）。
  // method/body 是请求本身的一部分，拼进 URL 会被 PostgREST 当成过滤器解析
  // （实测报 400 failed to parse filter）。
  const params = query.query && typeof query.query === 'object' ? query.query : query;
  for (const [k, v] of Object.entries(params)) {
    if (k === 'method' || k === 'body' || k === 'query') continue;
    if (v !== undefined && v !== null && v !== '') target.searchParams.set(k, v);
  }
  const res = await fetch(target.href, {
    method: query.method || 'GET',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: query.body ? JSON.stringify(query.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new Error('授权服务 HTTP ' + res.status + (data && data.message ? '：' + data.message : ''));
  return Array.isArray(data) ? data : [];
}

/** 取出全表（授权表规模很小，几十~几百条，一次读完最省事） */
async function allRows(env = process.env) {
  if (useFile(env)) return readFileStore(env);
  return supabaseRows(env, { select: 'code,device_id,version,platform,note,revoked,issued_at,used_at', order: 'issued_at.desc', limit: '1000' });
}
async function saveRow(row, env = process.env) {
  if (useFile(env)) {
    const rows = readFileStore(env);
    const i = rows.findIndex(r => r.code === row.code);
    if (i >= 0) rows[i] = { ...rows[i], ...row }; else rows.unshift(row);
    writeFileStore(rows, env);
    return row;
  }
  const out = await supabaseRows(env, {
    method: 'POST',
    query: { on_conflict: 'code' },
    body: row,
  });
  return out[0] || row;
}
async function patchRow(code, patch, env = process.env) {
  if (useFile(env)) {
    const rows = readFileStore(env);
    const i = rows.findIndex(r => r.code === code);
    if (i < 0) return null;
    rows[i] = { ...rows[i], ...patch };
    writeFileStore(rows, env);
    return rows[i];
  }
  const out = await supabaseRows(env, { method: 'PATCH', query: { code: 'eq.' + code }, body: patch });
  return out[0] || null;
}

/* ============================================================
 * 业务规则
 * ============================================================ */
/** 查某个授权码 */
async function findCode(code, env = process.env) {
  const c = normalizeCode(code);
  if (!c) return null;
  const rows = await allRows(env);
  return rows.find(r => r.code === c) || null;
}

/** 查该设备在本版本下的授权记录 */
async function findDevice(deviceId, version, env = process.env) {
  const d = String(deviceId || '').trim();
  if (!d) return null;
  const rows = await allRows(env);
  return rows.find(r => r.device_id === d && String(r.version) === String(version) && !r.revoked) || null;
}

/**
 * 校验授权码。
 * 规则：码存在、未吊销、版本与当前 App 版本一致、设备指纹一致。
 * 任一不满足都返回 ok:false + 中文原因（不泄露具体哪一项不匹配）。
 */
async function verify({ code, deviceId, version }, env = process.env) {
  const c = normalizeCode(code);
  if (!c) return { ok: false, msg: '请输入授权码' };
  let row;
  try { row = await findCode(c, env); }
  catch (e) { return { ok: false, msg: '授权服务暂时不可用：' + (e.message || '') }; }
  if (!row) return { ok: false, msg: '授权码无效' };
  if (row.revoked) return { ok: false, msg: '该授权码已被停用，请联系作者重新获取' };
  if (String(row.version) !== String(version)) return { ok: false, msg: '授权码与当前版本不匹配，请获取 v' + version + ' 的授权码' };
  if (String(row.device_id) !== String(deviceId || '').trim()) return { ok: false, msg: '授权码与本机不匹配（可能已被他人使用）' };
  try { await patchRow(c, { used_at: new Date().toISOString() }, env); }
  catch { /* 使用时间写失败不影响授权结果 */ }
  return { ok: true, msg: '', license: { code: row.code, version: row.version, issuedAt: row.issued_at } };
}

/** 设备在本版本是否已有授权记录（服务端视角） */
async function deviceStatus({ deviceId, version }, env = process.env) {
  const d = String(deviceId || '').trim();
  if (!d) return { authorized: false, service: true };
  try {
    const row = await findDevice(d, version, env);
    return { authorized: !!row, service: true, version: row ? row.version : null };
  } catch (e) {
    return { authorized: false, service: false, error: e.message || '授权服务不可用' };
  }
}

/** 签发授权码（管理端） */
async function issue({ code, deviceId, version, platform = 'android', note = '' }, env = process.env) {
  const v = String(version || '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error('版本号格式应为 x.y.z');
  const d = String(deviceId || '').trim();
  if (!d) throw new Error('缺少设备指纹');
  const finalCode = normalizeCode(code) || generateCode(v);
  if (versionOfCode(finalCode) !== v) throw new Error('授权码里的版本段与 version 不一致');
  const row = {
    code: finalCode, device_id: d, version: v, platform,
    note: String(note || '').slice(0, 200), revoked: false,
    issued_at: new Date().toISOString(), used_at: null,
  };
  await saveRow(row, env);
  return { code: finalCode, device_id: d, version: v, platform, note: row.note };
}

/** 列出授权码 */
async function list({ deviceId = '', version = '', limit = 100 } = {}, env = process.env) {
  const rows = await allRows(env);
  return rows
    .filter(r => (!deviceId || r.device_id === deviceId) && (!version || String(r.version) === String(version)))
    .slice(0, Math.min(500, Math.max(1, limit)));
}

/** 吊销 / 恢复授权码 */
async function revoke(code, revoked = true, env = process.env) {
  const c = normalizeCode(code);
  const row = await patchRow(c, { revoked: !!revoked }, env);
  if (!row) throw new Error('授权码不存在');
  return row;
}

module.exports = { generateCode, normalizeCode, versionOfCode, verify, deviceStatus, issue, list, revoke, findCode, useFile, DATA_FILE };
