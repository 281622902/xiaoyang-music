'use strict';
// 仅在 Node.js / GitHub Actions 中执行，不要引入播放器 HTML。
// 项目根目录安装依赖：npm install @supabase/supabase-js
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const readJSON = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));

function getReleaseConfig(env = process.env, packages = {}) {
  const root = packages.root || readJSON('package.json');
  const desktop = packages.desktop || readJSON('electron/package.json');
  const version = root.version;
  const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  const parsed = typeof version === 'string' && semver.exec(version);
  if (!parsed || parsed[4]?.split('.').some(x => /^0\d+$/.test(x))) throw new Error('package.json 中的 version 必须是合法语义版本号');
  if (desktop.version !== version) throw new Error('根目录与 electron/package.json 的 version 不一致');
  const clientVersion = packages.clientVersion ?? /appVersion:\s*'([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'app/js/supabase-client.js'), 'utf8'))?.[1];
  if (clientVersion !== version) throw new Error('app/js/supabase-client.js 的 appVersion 与 package.json 不一致');
  const expectedTag = 'v' + version;
  const tag = env.RELEASE_TAG || (env.GITHUB_REF_TYPE === 'tag' ? env.GITHUB_REF_NAME : '') || expectedTag;
  if (tag !== expectedTag) throw new Error('Tag 必须为 ' + expectedTag + '，当前是 ' + tag);
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
  return { version, tag, repository, assetName, row: {
    platform: 'windows', version, download_url: downloadUrl, release_notes: '新版本发布'
  } };
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
  let release;
  // 草稿不能依赖公开 tag 下载接口；使用带身份验证的列表查找。
  for (let page = 1; page <= 100; page++) {
    const releases = await get(base + '/releases?per_page=100&page=' + page);
    release = releases.find(item => item.tag_name === config.tag);
    if (release || releases.length < 100) break;
  }
  if (!release) throw new Error('未找到对应 GitHub Release，请先完成 electron-builder 发布');
  let asset;
  for (let page = 1; page <= 100; page++) {
    const assets = await get(base + '/releases/' + release.id + '/assets?per_page=100&page=' + page);
    asset = assets.find(item => item.name === config.assetName);
    if (asset || assets.length < 100) break;
  }
  if (!asset || asset.state !== 'uploaded' || !(asset.size > 0)) throw new Error('GitHub Release 中未找到上传完成的安装包：' + config.assetName);
  return release;
}

async function syncRelease({ env = process.env, createClient, fetchImpl = globalThis.fetch, logger = console } = {}) {
  const config = getReleaseConfig(env);
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY');
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('SUPABASE_URL 格式无效'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) throw new Error('SUPABASE_URL 必须是 https 项目根地址');
  if (env.VERIFY_GITHUB_ASSET === 'true') {
    const release = await verifyGitHubAsset(config, env, fetchImpl);
    if (release.draft) logger.warn('::warning::按配置同步草稿版本；该下载链接需手动 Publish release 后才能公开访问。');
  }
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
    if (process.argv.includes('--validate')) {
      const config = getReleaseConfig();
      console.log('版本与安装包校验通过：' + config.tag + ' / ' + config.assetName);
    } else await syncRelease();
  })().catch(error => { console.error('发布同步失败：' + safeMessage(error)); process.exitCode = 1; });
}
module.exports = { getReleaseConfig, verifyGitHubAsset, syncRelease, safeMessage };
