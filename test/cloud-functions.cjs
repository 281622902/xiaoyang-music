const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = require('node:path').resolve(__dirname, '../app/js') + require('node:path').sep;
let tests = 0;
async function test(name, fn) { await fn(); tests++; console.log('PASS', name); }
function setup() {
  const state = { user: { id: 'alice' }, favorites: [], versions: [], cap: 2, error: null, ranges: [] };
  const auth = { getUser: async () => ({ data: { user: state.user }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) };
  function from(table) {
    const filters = []; let deleting = false;
    const run = (start = 0, end = Infinity) => {
      if (state.error) return Promise.resolve({ error: { message: state.error } });
      const key = table === 'user_favorites' ? 'favorites' : 'versions';
      const all = state[key].filter(row => filters.every(([k, v]) => row[k] === v));
      if (deleting) state[key] = state[key].filter(row => !all.includes(row));
      return Promise.resolve({ data: all.slice(start, Math.min(end + 1, start + state.cap)), count: all.length, error: null });
    };
    const q = {
      delete() { deleting = true; return q; },
      select() { return deleting ? run() : q; },
      eq(k, v) { filters.push([k, v]); return q; },
      limit(n) { return run(0, n - 1); }, order() { return q; },
      range(a, b) { state.ranges.push([a, b]); return run(a, b); }
    };
    return q;
  }
  const context = { supabase: { auth, from }, URL, setTimeout, CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = opts.detail; } } };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(root + 'cloud-features.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync(root + 'favorite-button.js', 'utf8'), context);
  return { state, c: context };
}
function button() {
  const listeners = {}, classes = new Set(), attrs = {};
  return { disabled: false, attrs, classes, events: [],
    classList: { toggle(k, on) { on ? classes.add(k) : classes.delete(k); } },
    setAttribute(k, v) { attrs[k] = v; },
    addEventListener(k, fn) { listeners[k] = fn; }, removeEventListener(k) { delete listeners[k]; },
    dispatchEvent(e) { this.events.push(e); }, click() { return listeners.click(); }
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
(async () => {
  await test('favorite status, duplicate deletion and user isolation', async () => {
    const { state, c } = setup();
    state.favorites = [1, 2].map(id => ({ id, user_id: 'alice', song_url: 'https://music.example/a' }));
    state.favorites.push({ id: 3, user_id: 'bob', song_url: 'https://music.example/a' });
    assert.equal(await c.checkIsFavorited('https://music.example/a'), true);
    assert.equal(await c.removeFavorite('https://music.example/a'), 2);
    assert.equal(await c.checkIsFavorited('https://music.example/a'), false);
    assert.equal(state.favorites[0].user_id, 'bob');
  });
  await test('authentication and query errors reject', async () => {
    const { state, c } = setup(); state.user = null;
    await assert.rejects(c.removeFavorite('https://music.example/a'), /请先登录/);
    await assert.rejects(c.checkIsFavorited('https://music.example/a'), /请先登录/);
    state.user = { id: 'alice' }; state.error = 'RLS denied';
    await assert.rejects(c.removeFavorite('https://music.example/a'), /RLS denied/);
    await assert.rejects(c.checkIsFavorited('https://music.example/a'), /RLS denied/);
  });
  await test('SemVer numeric, prerelease, build metadata, huge numbers', () => {
    const { c } = setup();
    const chain = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.9.0', '1.10.0'];
    chain.slice(1).forEach((v, i) => assert.equal(c.compareVersions(v, chain[i]), 1));
    assert.equal(c.compareVersions('1.0.0+abc', '1.0.0+def'), 0);
    assert.equal(c.compareVersions('99999999999999999999.0.0', '99999999999999999998.0.0'), 1);
    ['1.0', '01.0.0', '1.0.0-01', 'v1.0.0'].forEach(v => assert.throws(() => c.compareVersions(v, '1.0.0')));
  });
  await test('semantic highest version and platform, capped pagination', async () => {
    const { state, c } = setup();
    state.versions = ['1.10.0', '1.9.0', '1.8.0', '1.2.0', '1.1.0'].map((version, i) => ({ id: i + 1, platform: 'windows', version, download_url: 'https://download.example/app.exe', release_notes: '修复' }));
    state.versions.push({ id: 6, platform: 'android', version: '99.0.0', download_url: 'https://download.example/app.apk' });
    const update = await c.checkAppUpdate('1.9.0', 'windows');
    assert.equal(update.version, '1.10.0'); assert.equal(update.release_notes, '修复');
    assert.deepEqual(state.ranges.map(x => x[0]), [0, 2, 4]);
    assert.equal(await c.checkAppUpdate('1.10.0', 'windows'), null);
    assert.equal(await c.checkAppUpdate('2.0.0', 'windows'), null);
    state.versions = []; assert.equal(await c.checkAppUpdate('1.0.0', 'android'), null);
  });
  await test('version failures reject rather than returning null', async () => {
    const { state, c } = setup();
    await assert.rejects(c.checkAppUpdate('1.0.0', 'ios'), /platform/);
    state.error = 'offline'; await assert.rejects(c.checkAppUpdate('1.0.0', 'windows'), /offline/);
    state.error = null; state.versions = [{ id: 1, platform: 'windows', version: '2.0.0', download_url: 'javascript:alert(1)' }];
    await assert.rejects(c.checkAppUpdate('1.0.0', 'windows'), /http/);
  });
  await test('heart serializes clicks and paints confirmed add/remove', async () => {
    const { c } = setup(); let on = false, adds = 0, removes = 0;
    c.checkIsFavorited = async () => on; c.addFavorite = async () => { adds++; on = true; };
    c.removeFavorite = async () => { removes++; on = false; return 1; };
    const b = button(), status = {}; const binding = c.bindFavoriteButton({ button: b, status, getSong: () => ({ name: '歌', url: 'https://music.example/a' }) });
    await tick(); await Promise.all([b.click(), b.click()]);
    assert.equal(adds, 1); assert.equal(b.attrs['aria-pressed'], 'true'); assert.equal(b.classes.has('is-favorited'), true);
    await b.click(); assert.equal(removes, 1); assert.equal(b.attrs['aria-pressed'], 'false');
    assert.equal(b.events.length, 2); binding.destroy();
  });
  await test('zero deletion and network failure preserve heart', async () => {
    const { c } = setup(); c.checkIsFavorited = async () => true; c.removeFavorite = async () => 0;
    const b = button(), status = {}; const binding = c.bindFavoriteButton({ button: b, status, getSong: () => ({ name: '歌', url: 'https://music.example/a' }) });
    await tick(); await b.click(); assert.equal(b.attrs['aria-pressed'], 'true'); assert.match(status.textContent, /未生效/);
    c.removeFavorite = async () => { throw Error('offline'); };
    await b.click(); assert.equal(b.attrs['aria-pressed'], 'true'); assert.match(status.textContent, /offline/); binding.destroy();
  });
  await test('old song query cannot repaint newly selected song', async () => {
    const { c } = setup(); const wait = deferred(); let song = { name: 'A', url: 'https://music.example/a' };
    c.checkIsFavorited = url => url.endsWith('/a') ? wait.promise : Promise.resolve(false);
    const b = button(), status = {}; const binding = c.bindFavoriteButton({ button: b, status, getSong: () => song });
    song = { name: 'B', url: 'https://music.example/b' }; await binding.refresh();
    wait.resolve(true); await tick(); assert.equal(b.attrs['aria-pressed'], 'false'); binding.destroy();
  });
  console.log(`${tests} groups passed; no remote requests or production data mutations.`);
})().catch(error => { console.error(error); process.exitCode = 1; });

