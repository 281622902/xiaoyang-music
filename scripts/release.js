'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { prepareRelease } = require('./update-supabase');
const { buildTag } = require('./version-tag.cjs');
const ROOT = path.resolve(__dirname, '..');

function configuredRepository(projectRoot) {
  const desktop = JSON.parse(fs.readFileSync(path.join(projectRoot, 'electron/package.json'), 'utf8').replace(/^\uFEFF/, ''));
  const provider = desktop.build.publish.find(item => item.provider === 'github');
  if (!provider?.owner || !provider?.repo) throw new Error('请先在 electron/package.json 配置 GitHub owner 和 repo');
  return provider.owner + '/' + provider.repo;
}

function releaseVersion(input, { projectRoot = ROOT, runGit, prepare = prepareRelease, repository, logger = console } = {}) {
  const version = String(input ?? '').trim();
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('请输入 X.Y.Z 格式版本号，例如 3.0.6；不要带 v 或其他字符');
  // 双端独立发版：由 XY_RELEASE_TARGET 决定 Tag 前缀。
  // pc → pc-v*、mobile → mobile-v*、all → all-v*（仅用户明确要求双端同步时用）。
  const target = String(process.env.XY_RELEASE_TARGET || 'mobile').trim().toLowerCase();
  if (!['pc', 'mobile', 'all'].includes(target)) throw new Error('XY_RELEASE_TARGET 只能是 pc / mobile / all');
  const tag = buildTag(target, version);
  if (!runGit) runGit = (args, { capture = false } = {}) => {
    const result = spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', args, {
      cwd: projectRoot, shell: false, encoding: 'utf8',
      stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit'
    });
    if (result.error) throw new Error('无法执行 Git：' + result.error.message);
    return { status: result.status, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim() };
  };
  const must = (args, label, capture = false) => {
    const result = runGit(args, { capture });
    if (result.status !== 0) throw new Error(label + '失败' + (result.stderr ? '：' + result.stderr : '（退出码 ' + result.status + '）'));
    return result;
  };
  const top = must(['rev-parse', '--show-toplevel'], '检查 Git 仓库', true).stdout;
  const normal = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (normal(top) !== normal(projectRoot)) throw new Error('请将 release.bat 放在 Git 仓库根目录运行，避免提交到其他仓库');
  const branch = must(['symbolic-ref', '--quiet', '--short', 'HEAD'], '读取当前分支（不能处于 detached HEAD）', true).stdout;
  must(['remote', 'get-url', 'origin'], '检查 origin 远端', true);
  const localTag = runGit(['show-ref', '--verify', '--quiet', 'refs/tags/' + tag], { capture: true });
  if (localTag.status === 0) throw new Error('本地 Tag ' + tag + ' 已存在，请输入新的版本号');
  if (localTag.status !== 1) throw new Error('检查本地 Tag 失败');
  const remoteTag = runGit(['ls-remote', '--exit-code', '--tags', 'origin', 'refs/tags/' + tag], { capture: true });
  if (remoteTag.status === 0) throw new Error('远端 Tag ' + tag + ' 已存在，请输入新的版本号');
  if (remoteTag.status !== 2) throw new Error('无法检查远端 Tag，请确认网络和 GitHub 登录状态' + (remoteTag.stderr ? '：' + remoteTag.stderr : ''));
  must(['var', 'GIT_AUTHOR_IDENT'], '检查 Git 作者配置', true);
  must(['var', 'GIT_COMMITTER_IDENT'], '检查 Git 提交者配置', true);

  logger.log('正在同步版本：' + version);
  prepare({ projectRoot, env: { RELEASE_TAG: tag, RELEASE_REPOSITORY: repository || configuredRepository(projectRoot) }, logger });
  must(['add', '.'], 'git add .');
  const diff = runGit(['diff', '--cached', '--quiet'], { capture: true });
  if (diff.status === 1) must(['commit', '-m', 'release: ' + tag], 'git commit');
  else if (diff.status === 0) logger.log('没有文件变化，使用当前提交创建 Tag。');
  else throw new Error('检查暂存区失败');
  must(['tag', tag], 'git tag');
  // 同一次推送包含代码和 Tag，不使用 --force，不改写已有 Tag。
  const pushed = runGit(['push', '--atomic', 'origin', 'HEAD:refs/heads/' + branch, 'refs/tags/' + tag]);
  if (pushed.status !== 0) throw new Error('推送失败，本地提交和 Tag 已保留。请修复网络、权限或远端分支冲突后，再推送当前分支和 ' + tag);
  logger.log('发布提交已推送：' + tag + '。请到 GitHub Actions 查看自动打包和正式发布进度。');
  return { version, tag, branch };
}

if (require.main === module) {
  try { releaseVersion(process.env.XY_RELEASE_VERSION); }
  catch (error) { console.error('[错误] ' + error.message); process.exitCode = 1; }
}
module.exports = { releaseVersion };
