/* 构建前门禁：确保 Electron 打包白名单覆盖所有运行时加载的本地页面/脚本。 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkgPath = path.join(root, 'electron', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const whitelist = Array.isArray(pkg.build && pkg.build.files) ? pkg.build.files : [];
const required = [
  'main.js',
  'preload.js',
  'lyric.html',
  'lyric-settings.html',
  'lyric-themes.js',
  'desktop-music.html',
  'installer-launcher.js',
  'backend-start.js',
];
const missing = [];
for (const rel of required) {
  if (!whitelist.includes(rel)) missing.push(`白名单缺少: ${rel}`);
  if (!fs.existsSync(path.join(root, 'electron', rel))) missing.push(`文件不存在: electron/${rel}`);
}
for (const rel of ['app/index.html', 'server/index.js']) {
  if (!fs.existsSync(path.join(root, rel))) missing.push(`文件不存在: ${rel}`);
}
if (missing.length) {
  console.error('Electron 资源门禁失败：');
  missing.forEach((line) => console.error(' - ' + line));
  process.exit(1);
}
console.log(`Electron 资源门禁通过：${required.length} 个本地资源已纳入打包白名单`);
