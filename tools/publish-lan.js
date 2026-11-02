#!/usr/bin/env node
/**
 * 一键发布到局域网升级目录
 *   node tools/publish-lan.js            自动取 dist 里最新版本的安装包
 *   node tools/publish-lan.js 2.9.0      指定版本
 *
 * 作用：把 electron/dist 里构建好的安装包复制到
 *      D:\杨海涛\局域网服务器\小杨音乐，目标文件名统一为
 *      「小杨音乐 Setup <版本>_<日期>.exe」（例：2.9.0_20261018.exe），
 *      并生成 latest.yml（sha512 校验）。同版本重发会清掉旧的同版本包。
 *      局域网内任意设备把「更新源地址」填成
 *      http://<本机IP>:35212/latest.json 即可发现并升级。
 * 用法：构建完成后跑一次即可（也可把它挂到构建后钩子上）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'electron', 'dist');
const LAN_DIR = 'D:\\杨海涛\\局域网服务器\\小杨音乐';
// 安装包文件名正则（兼容「Setup x.y.z.exe」与「Setup x.y.z_YYYYMMDD.exe」两种命名）
const PKG_RE = /^(?:小杨音乐\s*Setup\s*|xiaoyang-music-)(\d+(?:\.\d+){1,3})(?:[\s._(（-][^\x00]*)?\.exe$/i;

function cmpVersion(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

function pkgFileName(version) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const ymd = '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  return '小杨音乐 Setup ' + version + '_' + ymd + '.exe';
}

function main() {
  const want = process.argv[2];
  if (!fs.existsSync(DIST)) {
    console.error('[发布失败] 未找到构建目录：' + DIST + '\n           请先运行 npx electron-builder --win');
    process.exit(1);
  }
  const files = fs.readdirSync(DIST);
  let pick = null;
  for (const f of files) {
    const m = f.match(PKG_RE);
    if (!m) continue;
    if (want && m[1] !== want) continue;
    if (!pick || cmpVersion(m[1], pick.version) > 0) pick = { version: m[1], file: f };
  }
  if (!pick) {
    console.error('[发布失败] ' + (want ? '未找到版本 ' + want + ' 的安装包。' : '未找到任何「小杨音乐 Setup x.y.z.exe」。'));
    process.exit(1);
  }

  fs.mkdirSync(LAN_DIR, { recursive: true });
  const src = path.join(DIST, pick.file);
  const destName = pkgFileName(pick.version);
  const dest = path.join(LAN_DIR, destName);
  fs.copyFileSync(src, dest);

  // 清理历史包：只保留最近 KEEP 个版本（每个约 75MB，不清理会涨到 GB 级）
  const KEEP = 3;

  try {
    const pkgs = [];
    for (const f of fs.readdirSync(LAN_DIR)) {
      const m = f.match(PKG_RE);
      if (!m) continue;
      let mt = 0;
      try { mt = fs.statSync(path.join(LAN_DIR, f)).mtimeMs; } catch (e) { /* 忽略 */ }
      pkgs.push({ f, v: m[1], mt });
    }
    pkgs.sort((a, b) => cmpVersion(a.v, b.v) || (a.mt - b.mt));
    const drop = pkgs.slice(0, Math.max(0, pkgs.length - KEEP));
    let freed = 0;
    for (const d of drop) {
      try {
        const st = fs.statSync(path.join(LAN_DIR, d.f));
        freed += st.size;
        fs.unlinkSync(path.join(LAN_DIR, d.f));
        console.log('[清理] 已删除历史包 ' + d.f);
      } catch (e) { /* 忽略 */ }
    }
    if (freed) console.log('[清理] 释放 ' + (freed / 1048576).toFixed(0) + ' MB，保留最近 ' + KEEP + ' 个版本');
  } catch (e) { /* 清理失败不影响发布 */ }

  // 清掉同版本的旧命名包，目录里每个版本只留最新那份
  for (const old of fs.readdirSync(LAN_DIR)) {
    if (old === destName) continue;
    const m = old.match(PKG_RE);
    if (m && m[1] === pick.version) { try { fs.unlinkSync(path.join(LAN_DIR, old)); } catch (e) { /* 忽略 */ } }
  }

  const buf = fs.readFileSync(dest);
  const sha = crypto.createHash('sha512').update(buf).digest('base64');
  const yml = 'version: ' + pick.version + '\npath: ' + destName + '\nsha512: ' + sha
    + '\nreleaseDate: ' + new Date().toISOString().replace(/\.\d+Z$/, 'Z') + '\n';
  fs.writeFileSync(path.join(LAN_DIR, 'latest.yml'), yml, 'utf-8');

  console.log('[发布成功] v' + pick.version + ' → ' + LAN_DIR);
  console.log('           安装包 ' + destName + '（' + (buf.length / 1048576).toFixed(1) + ' MB）');
  console.log('           latest.yml 已生成（含 sha512）');
  console.log('[提醒] 请确认小杨音乐「设置 → 系统 → 局域网升级服务器」已开启，');
  console.log('       其它设备把更新源地址填成 http://<本机IP>:35212/latest.json');
}

main();
