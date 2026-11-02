const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { getReleaseConfig, verifyGitHubAsset, syncRelease, safeMessage } = require('../scripts/update-supabase');
const pkg = require('../package.json');
const desktop = require('../electron/package.json');
const env = { RELEASE_REPOSITORY: 'example-owner/music-player', RELEASE_TAG: 'v' + pkg.version,
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'mock-service-key', GH_TOKEN: 'mock-gh-token' };
const logger = { log() {}, warn() {} };
function mockGitHub({ draft = true, missing = false, httpError = false } = {}) {
  return async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer mock-gh-token');
    if (httpError) return { ok: false, status: 403 };
    const data = url.includes('/assets?') ? (missing ? [] : [{ name: getReleaseConfig(env).assetName, state: 'uploaded', size: 1024 }])
      : [{ id: 123, tag_name: env.RELEASE_TAG, draft }];
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
test('tag/version drift, invalid repository and mismatched assets fail before publishing', () => {
  assert.throws(() => getReleaseConfig({ ...env, RELEASE_TAG: 'v0.0.0' }), /Tag/);
  assert.throws(() => getReleaseConfig(env, { root: pkg, desktop: { ...desktop, version: '0.0.0' } }), /version/);
  assert.throws(() => getReleaseConfig(env, { root: pkg, desktop, clientVersion: '0.0.0' }), /appVersion/);
  assert.throws(() => getReleaseConfig({ ...env, RELEASE_REPOSITORY: 'owner/repo/extra' }), /owner\/repo/);
  assert.throws(() => getReleaseConfig({ ...env, RELEASE_ASSET_NAME: 'wrong.exe' }), /不一致/);
  assert.throws(() => getReleaseConfig({ ...env, RELEASE_ARCH: 'arm64' }), /x64/);
});
test('draft publish configuration explicitly identifies the repository and author', () => {
  assert.deepEqual(desktop.build.publish, [{ provider: 'github', owner: '281622902', repo: 'xiaoyang-music', releaseType: 'draft' }]);
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
  assert.deepEqual(workflow.on.push.tags, ['v*']);
  assert.equal(workflow.permissions.contents, 'write');
  const job = workflow.jobs['build-and-release']; assert.equal(job['runs-on'], 'windows-latest');
  const build = job.steps.find(step => step.run?.includes('npx electron-builder'));
  const sync = job.steps.find(step => step.run === 'node scripts/update-supabase.js');
  assert.equal(build['working-directory'], 'electron'); assert.match(build.run, /--publish always/);
  assert.equal(build.env.GH_TOKEN, '${{ secrets.GH_TOKEN }}');
  assert.equal(build.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(sync.env.SUPABASE_URL, '${{ secrets.SUPABASE_URL }}');
  assert.equal(sync.env.SUPABASE_SERVICE_ROLE_KEY, '${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}');
  assert.equal(sync.env.VERIFY_GITHUB_ASSET, 'true'); assert.ok(job.steps.indexOf(sync) > job.steps.indexOf(build));
  assert.ok(!job.steps.some(step => step.run?.includes('p.repository=')));
  const checks = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/windows-checks.yml'), 'utf8'));
  assert.deepEqual(checks.on.push.branches, ['**']); assert.equal(checks.on.push.tags, undefined);
  assert.ok(checks.jobs.windows.steps.some(step => step.run?.includes('--publish never')));
});
test('authenticated verification finds the expected draft and uploaded installer', async () => {
  const release = await verifyGitHubAsset(getReleaseConfig(env), env, mockGitHub());
  assert.equal(release.id, 123); assert.equal(release.draft, true);
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
  for (let i = 0; i < 2; i++) await syncRelease({ env: { ...env, VERIFY_GITHUB_ASSET: 'true' }, createClient, fetchImpl: mockGitHub(), logger: { log() {}, warn() { warnings++; } } });
  assert.equal(creations, 2); assert.equal(rows.size, 1); assert.equal(warnings, 2);
  assert.equal([...rows.values()][0].version, pkg.version);
});
test('missing service credentials and invalid URL fail without network writes', async () => {
  await assert.rejects(syncRelease({ env: { ...env, SUPABASE_SERVICE_ROLE_KEY: '' }, logger }), /缺少/);
  await assert.rejects(syncRelease({ env: { ...env, SUPABASE_URL: 'http://example.supabase.co' }, logger }), /https/);
  await assert.rejects(syncRelease({ env: { ...env, SUPABASE_URL: 'https://example.supabase.co/rest/v1' }, logger }), /根地址/);
});
test('database failures propagate and secret values are redacted in CLI messages', async () => {
  const createClient = () => ({ from: () => ({ upsert: async () => ({ error: { message: 'database unavailable' } }) }) });
  await assert.rejects(syncRelease({ env, createClient, logger }), /database unavailable/);
  assert.equal(safeMessage(new Error('bad ' + env.GH_TOKEN + '\n' + env.SUPABASE_SERVICE_ROLE_KEY), env), 'bad [REDACTED] [REDACTED]');
});
