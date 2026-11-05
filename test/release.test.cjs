const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { getReleaseConfig, prepareRelease, verifyGitHubAsset, syncRelease, safeMessage } = require('../scripts/update-supabase');
const { releaseVersion } = require('../scripts/release');
const pkg = require('../package.json');
const desktop = require('../electron/package.json');
const env = { RELEASE_REPOSITORY: 'example-owner/music-player', RELEASE_TAG: 'v' + pkg.version,
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'mock-service-key', GH_TOKEN: 'mock-gh-token' };
const logger = { log() {}, warn() {} };
function mockGitHub({ draft = false, prerelease = false, published = true, missing = false, httpError = false, downloadUrl } = {}) {
  return async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer mock-gh-token');
    if (httpError) return { ok: false, status: 403 };
    const config = getReleaseConfig(env);
    const data = url.includes('/assets?') ? (missing ? [] : [{ name: config.assetName, state: 'uploaded', size: 1024, browser_download_url: downloadUrl || config.row.download_url }])
      : { id: 123, tag_name: env.RELEASE_TAG, draft, prerelease, published_at: published && !draft ? '2026-11-03T00:00:00Z' : null };
    if (!url.includes('/assets?')) assert.ok(url.endsWith('/releases/tags/' + encodeURIComponent(env.RELEASE_TAG)));
    return { ok: true, json: async () => data };
  };
}
test('version, tag and ASCII artifact name produce the matching download URL', () => {
  const config = getReleaseConfig(env);
  assert.equal(config.tag, 'v' + pkg.version);
  assert.equal(config.row.version, pkg.version);
  assert.equal(config.row.platform, 'windows');
  assert.equal(config.assetName, `xiaoyang-music-${pkg.version}-x64-setup.exe`);
  assert.equal(config.row.download_url, `https://github.com/example-owner/music-player/releases/download/v${pkg.version}/${config.assetName}`);
  assert.equal(config.row.release_notes, '新版本发布');
});
test('invalid tags, repository and mismatched assets fail; version drift is only a warning', () => {
  assert.throws(() => getReleaseConfig({ ...env, RELEASE_TAG: 'vnot-a-version' }), /语义版本/);
  assert.throws(() => getReleaseConfig({ ...env, RELEASE_TAG: '3.0.3' }), /以 v 开头/);
  assert.ok(getReleaseConfig(env, { root: pkg, desktop: { ...desktop, version: '0.0.0' } }).warnings.some(w => w.includes('electron/package.json')));
  assert.ok(getReleaseConfig(env, { root: pkg, desktop, clientVersion: '0.0.0' }).warnings.some(w => w.includes('appVersion')));
  assert.throws(() => getReleaseConfig({ ...env, RELEASE_REPOSITORY: 'owner/repo/extra' }), /owner\/repo/);
  assert.throws(() => getReleaseConfig({ ...env, RELEASE_ASSET_NAME: 'wrong.exe' }), /不一致/);
  assert.throws(() => getReleaseConfig({ ...env, RELEASE_ARCH: 'arm64' }), /x64/);
});
test('v3.0.3 overrides all stale 3.0.1 values and generates the matching asset URL', () => {
  const config = getReleaseConfig({ ...env, RELEASE_TAG: 'v3.0.3' }, {
    root: { ...pkg, version: '3.0.1' }, desktop: { ...desktop, version: '3.0.1' }, clientVersion: '3.0.1'
  });
  assert.equal(config.version, '3.0.3'); assert.equal(config.tag, 'v3.0.3');
  assert.equal(config.assetName, 'xiaoyang-music-3.0.3-x64-setup.exe');
  assert.ok(config.row.download_url.includes('/v3.0.3/xiaoyang-music-3.0.3-x64-setup.exe'));
  assert.equal(config.row.version, '3.0.3'); assert.equal(config.warnings.length, 3);
});
test('实际 Release Tag 与发布 Tag 不同时，下载地址仍指向真实附件', () => {
  // pc-v3.5.2 触发构建，但 electron-builder 建的 Release 叫 v3.5.2。
  // 数据库 version 必须是纯 3.5.2，download_url 必须指向真实存在的 v3.5.2。
  const c = getReleaseConfig({ ...env, RELEASE_TAG: 'pc-v3.5.2', RELEASE_ACTUAL_TAG: 'v3.5.2' });
  assert.equal(c.version, '3.5.2');
  assert.equal(c.tag, 'pc-v3.5.2');
  assert.equal(c.actualTag, 'v3.5.2');
  assert.equal(c.row.version, '3.5.2');
  assert.ok(!c.row.download_url.includes('pc-v3.5.2'));
  assert.ok(c.row.download_url.includes('/v3.5.2/xiaoyang-music-3.5.2-x64-setup.exe'));
  // 不传实际 Tag 时保持旧行为（兼容历史 vX.Y.Z 发布）
  const legacy = getReleaseConfig({ ...env, RELEASE_TAG: 'v3.5.2' });
  assert.equal(legacy.actualTag, 'v3.5.2');
  assert.ok(legacy.row.download_url.includes('/v3.5.2/'));
});
test('GitHub ref variables are dynamic; local use without a tag reads package.json', () => {
  const base = { RELEASE_REPOSITORY: env.RELEASE_REPOSITORY };
  assert.equal(getReleaseConfig({ ...base, GITHUB_REF_NAME: 'v7.2.1', GITHUB_REF_TYPE: 'tag' }).version, '7.2.1');
  assert.equal(getReleaseConfig({ ...base, GITHUB_REF_NAME: 'v7.2.2' }).version, '7.2.2');
  assert.equal(getReleaseConfig({ ...base, GITHUB_REF: 'refs/tags/v7.2.3' }).version, '7.2.3');
  assert.equal(getReleaseConfig({ ...base, GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' }, {
    root: { ...pkg, version: '7.2.4' }, desktop: { ...desktop, version: '7.2.4' }, clientVersion: '7.2.4'
  }).version, '7.2.4');
});
test('validate CLI warns but exits zero on a version mismatch and does not modify files', () => {
  const script = path.join(root, 'scripts/update-supabase.js');
  const files = ['package.json', 'electron/package.json', 'app/js/supabase-client.js'];
  const before = files.map(file => fs.readFileSync(path.join(root, file), 'utf8'));
  const result = require('node:child_process').spawnSync(process.execPath, [script, '--validate'], {
    env: { ...process.env, RELEASE_REPOSITORY: env.RELEASE_REPOSITORY, RELEASE_TAG: 'v99.0.0' }, encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stderr, /::warning::/); assert.match(result.stdout, /v99\.0\.0/);
  assert.deepEqual(files.map(file => fs.readFileSync(path.join(root, file), 'utf8')), before);
});
test('prepare aligns installer, client and lock metadata without changing dependency versions', () => {
  const os = require('node:os');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xy-release-version-'));
  const write = (file, text) => { const target = path.join(temp, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
  try {
    write('package.json', JSON.stringify({ ...pkg, version: '3.0.1' }));
    write('electron/package.json', JSON.stringify({ ...desktop, version: '3.0.1' }));
    for (const file of ['package-lock.json', 'electron/package-lock.json']) write(file, JSON.stringify({ version: '3.0.1', packages: { '': { version: '3.0.1' }, 'node_modules/foo': { version: '3.0.1' } } }));
    write('app/js/supabase-client.js', "const cloud = { appVersion: '3.0.1', user: null };\n");
    const config = prepareRelease({ env: { ...env, RELEASE_TAG: 'v3.0.3' }, projectRoot: temp, logger });
    assert.equal(config.version, '3.0.3'); assert.equal(config.warnings.length, 0);
    for (const file of ['package.json', 'electron/package.json', 'package-lock.json', 'electron/package-lock.json']) assert.equal(JSON.parse(fs.readFileSync(path.join(temp, file))).version, '3.0.3');
    for (const file of ['package-lock.json', 'electron/package-lock.json']) {
      const lock = JSON.parse(fs.readFileSync(path.join(temp, file))); assert.equal(lock.packages[''].version, '3.0.3'); assert.equal(lock.packages['node_modules/foo'].version, '3.0.1');
    }
    assert.match(fs.readFileSync(path.join(temp, 'app/js/supabase-client.js'), 'utf8'), /appVersion: '3\.0\.3'/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(temp, 'electron/package.json'))).build.publish[0].owner, desktop.build.publish[0].owner);
  } finally {
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(temp).startsWith('xy-release-version-'));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
test('sync refuses an unprepared installer version before writing any database row', async () => {
  let called = false;
  await assert.rejects(syncRelease({ env: { ...env, RELEASE_TAG: 'v99.0.0' }, logger, createClient: () => { called = true; } }), /--prepare/);
  assert.equal(called, false);
});
test('formal publish configuration explicitly identifies the repository and author', () => {
  assert.deepEqual(desktop.build.publish, [{ provider: 'github', owner: '281622902', repo: 'xiaoyang-music', releaseType: 'release' }]);
  for (const metadata of [pkg, desktop]) {
    assert.ok(metadata.author.name);
    assert.deepEqual(metadata.repository, { type: 'git', url: 'https://github.com/281622902/xiaoyang-music.git' });
  }
  assert.equal(desktop.build.nsis.artifactName, 'xiaoyang-music-${version}-${arch}-setup.${ext}');
  assert.ok(pkg.dependencies['@supabase/supabase-js']);
  assert.ok(!desktop.build.files.some(file => /scripts|\.env/.test(file)));
});
test('native updater and LAN publisher recognize both old and new installer names', () => {
  for (const file of ['electron/main.js', 'tools/publish-lan.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const literal = /^const PKG_RE = (.+);$/m.exec(source)[1];
    const regex = require('node:vm').runInNewContext(literal);
    for (const name of ['小杨音乐 Setup 3.0.1.exe', '小杨音乐 Setup 3.0.1_20261103.exe', 'xiaoyang-music-3.0.1-x64-setup.exe']) assert.equal(regex.exec(name)?.[1], '3.0.1');
    assert.equal(regex.test('other-player-3.0.1.exe'), false);
  }
});
test('workflow parses and sends secrets only to the required steps', () => {
  const yaml = require(require.resolve('js-yaml', { paths: [path.join(root, 'electron'), root] }));
  const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/build-and-release.yml'), 'utf8'));
  // 双端独立发版准则：pc-v* 只发 Windows、all-v* 双端同步发、mobile-v* 不触发。
  assert.deepEqual(workflow.on.push.tags, ['pc-v*', 'all-v*']);
  const androidWf = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/android-release.yml'), 'utf8'));
  assert.deepEqual(androidWf.on.push.tags, ['mobile-v*', 'all-v*']);
  assert.equal(workflow.permissions.contents, 'write');
  const job = workflow.jobs['build-and-release']; assert.equal(job['runs-on'], 'windows-latest');
  const prepare = job.steps.find(step => step.run === 'node scripts/update-supabase.js --prepare');
  assert.ok(prepare); assert.ok(!job.steps.some(step => step.run === 'node scripts/update-supabase.js --validate'));
  const build = job.steps.find(step => step.run?.includes('npx electron-builder'));
  const sync = job.steps.find(step => step.run === 'node scripts/update-supabase.js');
  assert.equal(build['working-directory'], 'electron'); assert.match(build.run, /--publish always/);
  assert.equal(build.env.GH_TOKEN, '${{ secrets.GH_TOKEN }}');
  assert.equal(build.env.EP_DRAFT, 'false');
  assert.equal(build.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(sync.env.SUPABASE_URL, '${{ secrets.SUPABASE_URL }}');
  assert.equal(sync.env.SUPABASE_SERVICE_ROLE_KEY, '${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}');
  assert.equal(sync.env.GH_TOKEN, '${{ secrets.GH_TOKEN }}');
  const publish = job.steps.find(step => step.name === 'Ensure GitHub Release is published');
  assert.match(publish.run, /gh release edit/); assert.match(publish.run, /--draft=false --prerelease=false/);
  assert.equal(publish.env.GH_TOKEN, '${{ secrets.GH_TOKEN }}');
  assert.ok(job.steps.indexOf(publish) > job.steps.indexOf(build));
  assert.ok(job.steps.indexOf(sync) > job.steps.indexOf(publish));
  assert.ok(job.steps.indexOf(prepare) < job.steps.indexOf(build));
  assert.ok(!job.steps.some(step => step.run?.includes('p.repository=')));
  const checks = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/windows-checks.yml'), 'utf8'));
  assert.deepEqual(checks.on.push.branches, ['**']); assert.equal(checks.on.push.tags, undefined);
  assert.ok(checks.jobs.windows.steps.some(step => step.run?.includes('--publish never')));
});
test('verification finds the published release and returns the actual attachment download URL', async () => {
  const release = await verifyGitHubAsset(getReleaseConfig(env), env, mockGitHub());
  assert.equal(release.id, 123); assert.equal(release.draft, false); assert.equal(release.prerelease, false);
  assert.equal(release.download_url, getReleaseConfig(env).row.download_url);
});
test('draft, prerelease or unpublished records never reach the database client', async () => {
  let created = false;
  for (const options of [{ draft: true }, { prerelease: true }, { published: false }]) {
    await assert.rejects(syncRelease({ env, logger, fetchImpl: mockGitHub(options), createClient: () => { created = true; } }), /尚未正式发布/);
  }
  assert.equal(created, false);
});
test('wrong or external download links are rejected before database writes', async () => {
  let created = false;
  for (const downloadUrl of ['https://example.test/app.exe', 'https://github.com/example-owner/music-player/releases/download/v0.0.0/wrong.exe']) {
    await assert.rejects(syncRelease({ env, logger, fetchImpl: mockGitHub({ downloadUrl }), createClient: () => { created = true; } }), /下载地址.*不一致/);
  }
  assert.equal(created, false);
});
test('missing asset or denied GitHub access blocks database writes', async () => {
  let writes = 0;
  const createClient = () => { writes++; throw new Error('should not create client'); };
  await assert.rejects(syncRelease({ env: { ...env, VERIFY_GITHUB_ASSET: 'true' }, fetchImpl: mockGitHub({ missing: true }), createClient, logger }), /未找到上传完成/);
  await assert.rejects(syncRelease({ env: { ...env, VERIFY_GITHUB_ASSET: 'true' }, fetchImpl: mockGitHub({ httpError: true }), createClient, logger }), /HTTP 403/);
  assert.equal(writes, 0);
});
test('first sync inserts and retry updates the same platform/version record', async () => {
  const rows = new Map(); let creations = 0, warnings = 0;
  const createClient = (url, key, options) => {
    creations++; assert.equal(url, env.SUPABASE_URL); assert.equal(key, env.SUPABASE_SERVICE_ROLE_KEY);
    assert.deepEqual(options.auth, { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
    return { from(table) { assert.equal(table, 'app_versions'); return { async upsert(row, opts) {
      assert.equal(opts.onConflict, 'platform,version'); rows.set(row.platform + ':' + row.version, { ...row }); return { error: null };
    } }; } };
  };
  for (let i = 0; i < 2; i++) await syncRelease({ env, createClient, fetchImpl: mockGitHub(), logger: { log() {}, warn() { warnings++; } } });
  assert.equal(creations, 2); assert.equal(rows.size, 1); assert.equal(warnings, 0);
  assert.equal([...rows.values()][0].version, pkg.version);
});
test('missing service credentials and invalid URL fail without network writes', async () => {
  await assert.rejects(syncRelease({ env: { ...env, SUPABASE_SERVICE_ROLE_KEY: '' }, logger }), /缺少/);
  await assert.rejects(syncRelease({ env: { ...env, SUPABASE_URL: 'http://example.supabase.co' }, logger }), /https/);
  await assert.rejects(syncRelease({ env: { ...env, SUPABASE_URL: 'https://example.supabase.co/rest/v1' }, logger }), /根地址/);
});
test('database failures propagate and secret values are redacted in CLI messages', async () => {
  const createClient = () => ({ from: () => ({ upsert: async () => ({ error: { message: 'database unavailable' } }) }) });
  await assert.rejects(syncRelease({ env, createClient, fetchImpl: mockGitHub(), logger }), /database unavailable/);
  assert.equal(safeMessage(new Error('bad ' + env.GH_TOKEN + '\n' + env.SUPABASE_SERVICE_ROLE_KEY), env), 'bad [REDACTED] [REDACTED]');
});

function releaseHarness({ localExists = false, remoteExists = false, remoteFailure = false, detached = false, diff = 1, failCommand = '' } = {}) {
  const calls = []; let prepared;
  const runGit = args => {
    calls.push(args);
    if (args[0] === failCommand) return { status: 1, stderr: 'mock failure' };
    if (args[0] === 'rev-parse') return { status: 0, stdout: root };
    if (args[0] === 'symbolic-ref') return { status: detached ? 1 : 0, stdout: 'main' };
    if (args[0] === 'show-ref') return { status: localExists ? 0 : 1 };
    if (args[0] === 'ls-remote') return { status: remoteFailure ? 128 : remoteExists ? 0 : 2 };
    if (args[0] === 'diff') return { status: diff };
    return { status: 0, stdout: '' };
  };
  const options = { projectRoot: root, repository: '281622902/xiaoyang-music', runGit, logger,
    prepare(value) { prepared = value; } };
  return { calls, options, get prepared() { return prepared; } };
}
test('release.bat passes unexpanded input to Node and rejects malformed versions', () => {
  const batch = fs.readFileSync(path.join(root, 'release.bat'), 'utf8');
  assert.match(batch, /DisableDelayedExpansion/); assert.match(batch, /set \/p "XY_RELEASE_VERSION=/);
  assert.ok(!batch.includes('%XY_RELEASE_VERSION%'));
  for (const input of ['', 'v3.0.6', '3.0', '03.0.6', '3.0.6 & echo injected']) {
    const h = releaseHarness(); assert.throws(() => releaseVersion(input, h.options), /X.Y.Z/); assert.equal(h.calls.length, 0);
  }
});
test('release command prepares, stages, commits, tags and atomically pushes code plus tag', () => {
  // 双端独立发版准则：默认目标为手机端 → Tag 带 mobile-v 前缀。
  const h = releaseHarness(); const result = releaseVersion('3.0.6', h.options);
  assert.equal(h.prepared.env.RELEASE_TAG, 'mobile-v3.0.6');
  assert.deepEqual(h.calls.filter(a => ['add', 'commit', 'tag', 'push'].includes(a[0])), [
    ['add', '.'], ['commit', '-m', 'release: mobile-v3.0.6'], ['tag', 'mobile-v3.0.6'],
    ['push', '--atomic', 'origin', 'HEAD:refs/heads/main', 'refs/tags/mobile-v3.0.6']
  ]);
  assert.equal(result.tag, 'mobile-v3.0.6');
});

test('release target prefixes pick the right CI workflow', () => {
  const { parseReleaseTag, runsAndroid, runsWindows, buildTag } = require('../scripts/version-tag.cjs');
  assert.equal(buildTag('pc', '4.0.0'), 'pc-v4.0.0');
  assert.equal(buildTag('mobile', '3.6.0'), 'mobile-v3.6.0');
  assert.equal(buildTag('all', '3.7.0'), 'all-v3.7.0');
  assert.equal(parseReleaseTag('mobile-v3.6.0').version, '3.6.0');
  assert.equal(parseReleaseTag('pc-v4.0.0').version, '4.0.0');
  assert.equal(parseReleaseTag('all-v3.7.0').version, '3.7.0');
  // 前缀绝不写进数据库
  assert.ok(!parseReleaseTag('mobile-v3.6.0').version.includes('mobile'));
  assert.equal(runsAndroid('mobile-v3.6.0'), true);
  assert.equal(runsWindows('mobile-v3.6.0'), false);
  assert.equal(runsAndroid('pc-v4.0.0'), false);
  assert.equal(runsWindows('pc-v4.0.0'), true);
  assert.equal(runsAndroid('all-v3.7.0') && runsWindows('all-v3.7.0'), true);
  assert.throws(() => parseReleaseTag('v3.0.9-beta'), /语义版本/);
});
test('existing local tag prevents metadata changes and git add', () => {
  const h = releaseHarness({ localExists: true }); assert.throws(() => releaseVersion('3.0.6', h.options), /本地 Tag.*已存在/);
  assert.equal(h.prepared, undefined); assert.ok(!h.calls.some(a => a[0] === 'add'));
});
test('existing remote tag prevents metadata changes and git add', () => {
  const h = releaseHarness({ remoteExists: true }); assert.throws(() => releaseVersion('3.0.6', h.options), /远端 Tag.*已存在/);
  assert.equal(h.prepared, undefined); assert.ok(!h.calls.some(a => a[0] === 'add'));
});
test('remote check failure or detached HEAD stops before any release writes', () => {
  for (const options of [{ remoteFailure: true }, { detached: true }]) {
    const h = releaseHarness(options); assert.throws(() => releaseVersion('3.0.6', h.options)); assert.equal(h.prepared, undefined);
  }
});
test('failed commit never creates or pushes a release tag', () => {
  const h = releaseHarness({ failCommand: 'commit' }); assert.throws(() => releaseVersion('3.0.6', h.options), /git commit.*失败/);
  assert.ok(!h.calls.some(a => ['tag', 'push'].includes(a[0])));
});
test('failed push leaves local history intact and explains the partial result', () => {
  const h = releaseHarness({ failCommand: 'push' }); assert.throws(() => releaseVersion('3.0.6', h.options), /本地提交和 Tag 已保留/);
  assert.equal(h.calls.filter(a => a[0] === 'push').length, 1); assert.ok(!h.calls.some(a => a.includes('--force') || a.includes('--delete')));
});
test('unchanged staged content skips an empty commit and still pushes the new tag', () => {
  const h = releaseHarness({ diff: 0 }); releaseVersion('3.0.6', h.options);
  assert.ok(!h.calls.some(a => a[0] === 'commit')); assert.ok(h.calls.some(a => a[0] === 'push'));
});
