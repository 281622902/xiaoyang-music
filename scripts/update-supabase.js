'use strict';
// 仅在 Node.js / GitHub Actions 中执行，不要引入播放器 HTML。
// 项目根目录安装依赖：npm install @supabase/supabase-js
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const readJSON = (file, projectRoot = ROOT) => JSON.parse(fs.readFileSync(path.join(projectRoot, file), 'utf8').replace(/^\uFEFF/, ''));
const CLIENT_VERSION = /(\bappVersion\s*:\s*)(['"])([^'"]*)\2/;

function getReleaseConfig(env = process.env, packages = {}) {
  const projectRoot = packages.projectRoot || ROOT;
  const root = packages.root || readJSON('package.json', projectRoot);
  const desktop = packages.desktop || readJSON('electron/package.json', projectRoot);
  const refTag = env.GITHUB_REF?.startsWith('refs/tags/') ? env.GITHUB_REF.slice('refs/tags/'.length) : '';
  const namedTag = env.GITHUB_REF_TYPE === 'tag' || (!env.GITHUB_REF_TYPE && env.GITHUB_REF_NAME?.startsWith('v')) ? env.GITHUB_REF_NAME : '';
  const suppliedTag = env.RELEASE_TAG || namedTag || refTag;
  if (suppliedTag && !suppliedTag.startsWith('v')) throw new Error('发布 Tag 必须以 v 开头，并包含合法版本号');
  // CI 以当前 Tag 为发布版本；本机未传 Tag 时才从根 package.json 读取。
  const version = suppliedTag ? suppliedTag.slice(1) : root.version;
  const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  const parsed = typeof version === 'string' && semver.exec(version);
  if (!parsed || parsed[4]?.split('.').some(x => /^0\d+$/.test(x))) throw new Error('Tag 或 package.json 必须包含合法语义版本号');
  const clientFile = path.join(projectRoot, 'app/js/supabase-client.js');
  const clientVersion = packages.clientVersion ?? (fs.existsSync(clientFile) ? CLIENT_VERSION.exec(fs.readFileSync(clientFile, 'utf8'))?.[3] : undefined);
  const warnings = [];
  for (const [file, found] of [['package.json', root.version], ['electron/package.json', desktop.version], ['app/js/supabase-client.js appVersion', clientVersion]]) {
    if (found !== version) warnings.push(file + ' 当前为 ' + (found ?? '未设置') + '，发布版本为 ' + version + '；CI 将在打包前同步。');
  }
  const tag = suppliedTag || 'v' + version;
  const repository = (env.RELEASE_REPOSITORY || env.GITHUB_REPOSITORY || '').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('请设置 RELEASE_REPOSITORY 或 GITHUB_REPOSITORY，格式为 owner/repo');
  const arch = env.RELEASE_ARCH || 'x64';
  if (arch !== 'x64') throw new Error('当前工作流仅构建 Windows x64');
  const pattern = desktop.build?.nsis?.artifactName;
  if (!pattern) throw new Error('请配置 electron/package.json 的 build.nsis.artifactName');
  const values = { version, arch, ext: 'exe', name: desktop.name, productName: desktop.build.productName };
  const configuredName = pattern.replace(/\$\{([^}]+)\}/g, (_all, key) => {
    if (!(key in values)) throw new Error('不支持的安装包文件名变量：' + key);
    return values[key];
  });
  const assetName = env.RELEASE_ASSET_NAME || configuredName;
  if (!/^[A-Za-z0-9_.-]+\.exe$/i.test(assetName)) throw new Error('安装包名称必须为无路径的 ASCII .exe 文件名');
  if (assetName !== configuredName) throw new Error('RELEASE_ASSET_NAME 与 electron-builder 生成的文件名不一致');
  const downloadUrl = 'https://github.com/' + repository + '/releases/download/' + encodeURIComponent(tag) + '/' + encodeURIComponent(assetName);
  return { version, tag, repository, assetName, warnings, rootVersion: root.version, desktopVersion: desktop.version, clientVersion, row: {
    platform: 'windows', version, download_url: downloadUrl, release_notes: '新版本发布'
  } };
}

function reportWarnings(config, logger = console) {
  for (const message of config.warnings) logger.warn('::warning::' + message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A'));
}

function prepareRelease({ env = process.env, projectRoot = ROOT, logger = console } = {}) {
  const config = getReleaseConfig(env, { projectRoot });
  reportWarnings(config, logger);
  // 只修改 Runner 工作副本，不提交代码、不修改 Tag，也不改依赖树版本。
  for (const file of ['package.json', 'electron/package.json', 'package-lock.json', 'electron/package-lock.json']) {
    const target = path.join(projectRoot, file);
    if (!fs.existsSync(target)) continue;
    const data = readJSON(file, projectRoot);
    const changed = data.version !== config.version || (data.packages?.[''] && data.packages[''].version !== config.version);
    data.version = config.version;
    if (data.packages?.['']) data.packages[''].version = config.version;
    if (changed) fs.writeFileSync(target, JSON.stringify(data, null, 2) + '\n');
  }
  const clientFile = path.join(projectRoot, 'app/js/supabase-client.js');
  if (fs.existsSync(clientFile)) {
    const before = fs.readFileSync(clientFile, 'utf8');
    const after = before.replace(CLIENT_VERSION, (_match, prefix, quote) => prefix + quote + config.version + quote);
    if (after !== before) fs.writeFileSync(clientFile, after);
  }
  const prepared = getReleaseConfig(env, { projectRoot });
  logger.log('CI 发布版本已同步：' + prepared.tag + ' / ' + prepared.assetName);
  return prepared;
}

async function verifyGitHubAsset(config, env, fetchImpl = globalThis.fetch) {
  if (!env.GH_TOKEN) throw new Error('验证 GitHub Release 附件需要 GH_TOKEN');
  async function get(url) {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + env.GH_TOKEN, 'User-Agent': 'xiaoyang-release-sync' },
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error('GitHub Release 查询失败，HTTP ' + response.status);
    return response.json();
  }
  const base = 'https://api.github.com/repos/' + config.repository;
  const release = await get(base + '/releases/tags/' + encodeURIComponent(config.tag));
  if (release.tag_name !== config.tag) throw new Error('GitHub Release 的 Tag 与当前版本不一致');
  if (release.draft !== false || release.prerelease !== false || !Number.isFinite(Date.parse(release.published_at))) {
    throw new Error('该 Tag 尚未正式发布（可能是草稿或预发布），此次不写入 Supabase');
  }
  let asset;
  for (let page = 1; page <= 100; page++) {
    const assets = await get(base + '/releases/' + release.id + '/assets?per_page=100&page=' + page);
    asset = assets.find(item => item.name === config.assetName);
    if (asset || assets.length < 100) break;
  }
  if (!asset || asset.state !== 'uploaded' || !(asset.size > 0)) throw new Error('GitHub Release 中未找到上传完成的安装包：' + config.assetName);
  let download;
  try { download = new URL(asset.browser_download_url); } catch { throw new Error('GitHub 未返回有效的安装包下载链接'); }
  const expected = new URL(config.row.download_url);
  if (download.origin !== expected.origin || download.pathname !== expected.pathname || download.search || download.hash) {
    throw new Error('GitHub 附件下载地址与当前仓库、Tag 或安装包名称不一致');
  }
  return { ...release, download_url: download.href };
}

async function syncRelease({ env = process.env, createClient, fetchImpl = globalThis.fetch, logger = console } = {}) {
  const config = getReleaseConfig(env);
  reportWarnings(config, logger);
  if (config.desktopVersion !== config.version) throw new Error('安装包版本尚未同步到 Tag；请先执行 node scripts/update-supabase.js --prepare 再打包。此次未写入数据库。');
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY');
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('SUPABASE_URL 格式无效'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) throw new Error('SUPABASE_URL 必须是 https 项目根地址');
  // 同步始终校验正式发布状态及实际附件，不能通过环境变量绕过。
  const release = await verifyGitHubAsset(config, env, fetchImpl);
  config.row.download_url = release.download_url;
  if (!createClient) {
    try { ({ createClient } = require('@supabase/supabase-js')); }
    catch { throw new Error('请先在项目根目录运行 npm install @supabase/supabase-js'); }
  }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  // 首次插入；同 Tag 重跑更新同一记录，需要现有 (platform, version) 唯一约束。
  const { error } = await client.from('app_versions').upsert(config.row, { onConflict: 'platform,version' });
  if (error) throw new Error('同步 app_versions 失败：' + (error.message || error.code || '未知数据库错误'));
  logger.log('已同步 Windows ' + config.version + '：' + config.row.download_url);
  return config.row;
}

function safeMessage(error, env = process.env) {
  let message = String(error?.message || '未知错误');
  for (const value of [env.SUPABASE_SERVICE_ROLE_KEY, env.GH_TOKEN]) if (value) message = message.split(value).join('[REDACTED]');
  return message.replace(/[\r\n]+/g, ' ');
}

if (require.main === module) {
  (async () => {
    if (process.argv.includes('--prepare')) {
      console.log('版本来源：' + path.join(ROOT, 'package.json') + '；提交：' + (process.env.GITHUB_SHA || '本机'));
      prepareRelease();
    } else if (process.argv.includes('--validate')) {
      const config = getReleaseConfig();
      reportWarnings(config);
      console.log('版本预检完成（版本差异仅警告）：' + config.tag + ' / ' + config.assetName);
    } else await syncRelease();
  })().catch(error => { console.error('发布同步失败：' + safeMessage(error)); process.exitCode = 1; });
}
module.exports = { getReleaseConfig, prepareRelease, reportWarnings, verifyGitHubAsset, syncRelease, safeMessage };
