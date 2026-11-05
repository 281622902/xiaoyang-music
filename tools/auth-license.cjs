#!/usr/bin/env node
/* ============================================================
 * auth-license.cjs — 设备授权码管理工具
 *
 * 用法：
 *   node tools/auth-license.cjs issue --device <设备码> --version 3.5.0 [--note "备注"]
 *   node tools/auth-license.cjs list [--device <设备码>] [--version 3.5.0]
 *   node tools/auth-license.cjs revoke <授权码> [--undo]
 *   node tools/auth-license.cjs gen --version 3.5.0
 *
 * 环境变量：
 *   SUPABASE_URL / SUPABASE_SERVICE_KEY  走云端授权表（生产）
 *   XY_LICENSE_FILE                      走本地 JSON 文件（默认 server/data/licenses.json）
 *
 * 典型流程：
 *   1. 用户把 App 里的「设备码」发给你；
 *   2. 你执行 issue 生成授权码并发给用户；
 *   3. 用户在授权页输入后即可使用；
 *   4. 每次发版换一批新码（旧版本码在新版本上自动失效）。
 * ============================================================ */
'use strict';
const path = require('node:path');
const license = require('../server/providers/license');

function arg(name, fallback = '') {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function has(name) { return process.argv.includes('--' + name); }
function usage() {
  console.log([
    '用法：',
    '  node tools/auth-license.cjs issue --device <设备码> --version <x.y.z> [--note "备注"]',
    '  node tools/auth-license.cjs list [--device <设备码>] [--version <x.y.z>]',
    '  node tools/auth-license.cjs revoke <授权码> [--undo]',
    '  node tools/auth-license.cjs gen --version <x.y.z>',
  ].join('\n'));
}

(async () => {
  const cmd = process.argv[2];
  if (!cmd || cmd === 'help' || has('help')) { usage(); return; }
  try {
    if (cmd === 'gen') {
      const version = arg('version');
      if (!version) { usage(); process.exitCode = 1; return; }
      console.log(license.generateCode(version));
      return;
    }
    if (cmd === 'issue') {
      const device = arg('device');
      const version = arg('version');
      if (!device || !version) { usage(); process.exitCode = 1; return; }
      const r = await license.issue({ deviceId: device, version, note: arg('note') });
      console.log('授权码已生成：' + r.code);
      console.log('  设备：' + r.device_id);
      console.log('  版本：' + r.version);
      console.log('  存储：' + (license.useFile() ? '本地文件 ' + license.DATA_FILE : 'Supabase app_licenses'));
      return;
    }
    if (cmd === 'list') {
      const rows = await license.list({ deviceId: arg('device'), version: arg('version'), limit: Number(arg('limit', '200')) });
      if (!rows.length) { console.log('（没有记录）'); return; }
      console.log('授权码'.padEnd(26) + '设备码'.padEnd(18) + '版本'.padEnd(10) + '状态'.padEnd(8) + '备注');
      for (const r of rows) {
        console.log(String(r.code).padEnd(26) + String(r.device_id).padEnd(18) + String(r.version).padEnd(10)
          + (r.revoked ? '已停用' : (r.used_at ? '已使用' : '未使用')).padEnd(8) + (r.note || ''));
      }
      console.log('共 ' + rows.length + ' 条');
      return;
    }
    if (cmd === 'revoke') {
      const code = process.argv[3];
      if (!code) { usage(); process.exitCode = 1; return; }
      const r = await license.revoke(code, !has('undo'));
      console.log((r.revoked ? '已停用：' : '已恢复：') + r.code);
      return;
    }
    usage();
    process.exitCode = 1;
  } catch (e) {
    console.error('失败：' + (e && e.message ? e.message : e));
    process.exitCode = 1;
  }
})();
