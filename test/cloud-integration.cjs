// 使用模拟 SDK 测试完整主界面；不会访问 Supabase 或写入正式数据。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(process.env.PLAYWRIGHT_MODULE || '../electron/node_modules/playwright'); }
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xy-cloud-'));
process.env.MOCK = '1'; process.env.UZZ_USER_DATA = temp;
const { server } = require('../server/index');
const stub = `window.supabase={createClient(url,key,options){
  const callbacks=[];
  let user=JSON.parse(localStorage.getItem('mock.auth')||'null');
  const state=window.__cloudMock={calls:[],blockedDelete:false,error:null,versionRows:[{id:1,platform:'windows',version:'3.10.0',download_url:'https://download.example/app.exe',release_notes:'<b>纯文本更新说明</b>'},{id:2,platform:'windows',version:'3.9.0',download_url:'https://download.example/old.exe'}],options};
  const read=()=>JSON.parse(localStorage.getItem('mock.favorites')||'[]');
  const emit=event=>callbacks.forEach(fn=>fn(event,user?{user}:null));
  async function login(value){state.phone=value.phone;user={id:value.phone,phone:value.phone};localStorage.setItem('mock.auth',JSON.stringify(user));emit('SIGNED_IN');return {data:{user,session:{user}},error:null};}
  return {auth:{getUser:async()=>({data:{user},error:null}),signUp:login,signInWithPassword:login,
    signOut:async()=>{user=null;localStorage.removeItem('mock.auth');emit('SIGNED_OUT');return {error:null}},
    onAuthStateChange(fn){callbacks.push(fn);setTimeout(()=>fn('INITIAL_SESSION',user?{user}:null),0);return {data:{subscription:{unsubscribe(){const i=callbacks.indexOf(fn);if(i>=0)callbacks.splice(i,1)}}}}}},
    from(table){let filters=[],mode='read',inserted,single=false,start=0,end=Infinity,limit=Infinity;
      const q={select(){return q},eq(k,v){filters.push([k,v]);return q},order(){return q},limit(n){limit=n;return q},range(a,b){start=a;end=b;return q},delete(){mode='delete';return q},insert(row){mode='insert';inserted=row;return q},single(){single=true;return q},
        then(resolve,reject){state.calls.push({table,mode,filters});if(state.error)return Promise.resolve({error:{message:state.error}}).then(resolve,reject);
          let all=table==='user_favorites'?read():state.versionRows;
          let rows=all.filter(r=>filters.every(([k,v])=>r[k]===v));
          if(mode==='insert'){rows=[{id:crypto.randomUUID(),created_at:new Date().toISOString(),...inserted}];all.push(...rows);localStorage.setItem('mock.favorites',JSON.stringify(all));}
          if(mode==='delete'){if(state.blockedDelete)rows=[];else localStorage.setItem('mock.favorites',JSON.stringify(all.filter(r=>!rows.includes(r))));}
          const count=rows.length;rows=rows.slice(start,Math.min(end+1,start+limit,start+2));
          return Promise.resolve({data:single?rows[0]:rows,error:null,count}).then(resolve,reject);}};return q;}};
}};`;
let browser, failures = 0;
async function check(name, fn) { try { await fn(); console.log('PASS ' + name); } catch (error) { failures++; console.error('FAIL ' + name + ': ' + error.stack); } }
async function wait(page, fn) { await page.waitForFunction(fn); }
async function openPage({ sdk = true, android = false, nativeUpdater = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, ...(android ? { userAgent: 'Android test browser' } : {}) });
  const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(7000);
  page.on('pageerror', e => console.error('PAGEERROR', e.message));
  await page.route('https://**/*', route => route.request().url().includes('cdn.jsdelivr.net') && sdk
    ? route.fulfill({ contentType: 'text/javascript', body: stub }) : route.abort());
  await page.route('**/api/local/stream?**', route => route.fulfill({ status: 204 }));
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = async function () {};
    HTMLMediaElement.prototype.pause = function () {};
    HTMLMediaElement.prototype.load = function () {};
    window.__opens = []; window.open = (...args) => { window.__opens.push(args); };
  });
  if (nativeUpdater) await page.addInitScript(() => {
    window.__installCalls = [];
    window.uzzBridge = {
      getAppVersion: async () => ({ version: '3.4.0' }),
      downloadAndInstall: async url => { window.__installCalls.push(url); return { ok: true }; },
      onUpdateProgress() {}, onLyricClosed() {}, showLyric() {}, sendLyric() {}, setLyricStyle() {}
    };
  });
  await page.goto('http://127.0.0.1:' + server.address().port);
  await wait(page, () => !!window.XYCloud && !!window.Player && document.readyState === 'complete');
  return { page, context, errors };
}
async function play(page, id, extra = {}) {
  await page.evaluate(async ({ id, extra }) => {
    UzzApi.getSong = async t => ({ ...t, url: 'https://music.example/' + t.id + '.mp3', lyric: '[00:01]歌词' });
    UzzApi.getLyricEx = async () => ({ lyric: '[00:01]歌词', tlyric: '' });
    await Player.loadAndPlay({ id, name: '歌曲' + id, vendor: 'netease', ...extra });
  }, { id, extra });
}
async function login(page, phone = '13800000000') {
  await page.click('#accountOpen'); await page.fill('#cloudPhone', phone); await page.fill('#cloudPassword', 'test-password');
  await page.click('#cloudSubmit'); await wait(page, () => !document.getElementById('cloudMember').classList.contains('hidden'));
  await page.click('#accountClose');
}
(async () => {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  browser = await playwright.chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined, headless: true });
  const { page, context, errors } = await openPage();
  await check('defer order, clean UI, SDK persistence and phone login', async () => {
    assert.equal(await page.locator('#favoriteBtn').count(), 1);
    assert.equal(await page.locator('#songNameInput, #loadSongBtn, #currentVersionInput, #checkUpdateBtn').count(), 0);
    const scripts = await page.locator('script[src]').evaluateAll(nodes => nodes.map(n => ({ src: n.getAttribute('src'), defer: n.defer })));
    assert.ok(scripts.every(s => s.defer));
    assert.ok(scripts.findIndex(s => s.src.includes('supabase-client.js')) < scripts.findIndex(s => s.src.includes('cloud-features.js')));
    await play(page, 'A'); await wait(page, () => !document.getElementById('favoriteBtn').disabled);
    await page.click('#favoriteBtn'); assert.equal(await page.locator('#accountModal').evaluate(el => el.classList.contains('hidden')), false);
    await page.fill('#cloudPhone', '13800000000'); await page.fill('#cloudPassword', 'test-password'); await page.click('#cloudSubmit');
    await wait(page, () => !!XYCloud.user);
    assert.equal(await page.evaluate(() => __cloudMock.phone), '+8613800000000');
    assert.equal(await page.evaluate(() => __cloudMock.options.auth.persistSession), true);
    if (process.env.SCREENSHOT_DIR) { fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, '云端账户.png') }); }
    await page.click('#accountClose');
  });
  await check('real Player state, confirmed red heart and correct raw URL', async () => {
    await wait(page, () => !document.getElementById('favoriteBtn').disabled);
    await page.click('#favoriteBtn'); await wait(page, () => document.getElementById('favoriteBtn').getAttribute('aria-pressed') === 'true');
    const row = await page.evaluate(() => JSON.parse(localStorage.getItem('mock.favorites'))[0]);
    assert.equal(row.song_name, '歌曲A'); assert.equal(row.song_url, 'https://music.example/A.mp3');
    assert.equal(await page.locator('#favoriteBtn').evaluate(el => getComputedStyle(el).color), 'rgb(237, 86, 119)');
    assert.equal(await page.evaluate(() => Player.getFavorites().length), 0);
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, '播放器云端红心.png') });
  });
  await check('switch song refreshes heart; RLS zero-delete retains state', async () => {
    await play(page, 'B'); await wait(page, () => document.getElementById('favoriteBtn').getAttribute('aria-pressed') === 'false' && !document.getElementById('favoriteBtn').disabled);
    await play(page, 'A'); await wait(page, () => document.getElementById('favoriteBtn').getAttribute('aria-pressed') === 'true' && !document.getElementById('favoriteBtn').disabled);
    await page.evaluate(() => { __cloudMock.blockedDelete = true; }); await page.click('#favoriteBtn');
    await wait(page, () => document.getElementById('favoriteStatus').textContent.includes('未生效'));
    assert.equal(await page.locator('#favoriteBtn').getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => { __cloudMock.blockedDelete = false; }); await page.click('#favoriteBtn');
    await wait(page, () => document.getElementById('favoriteBtn').getAttribute('aria-pressed') === 'false');
  });
  await check('fallback getUrl and quality changes refresh actual song URL', async () => {
    await page.evaluate(async () => {
      UzzApi.getSong = async t => ({ ...t, url: '', lyric: '[00:01]歌词' });
      UzzApi.getUrl = async () => 'https://fallback.example/song.mp3';
      await Player.loadAndPlay({ id: 'fallback', name: '兜底歌曲', vendor: 'netease' });
    });
    assert.equal(await page.evaluate(() => XYCloud.currentSong.url), 'https://fallback.example/song.mp3');
    await page.evaluate(async () => { UzzApi.getSong = async t => ({ ...t, url: 'https://quality.example/song.flac' }); await Player.reloadQuality('lossless'); });
    assert.equal(await page.evaluate(() => XYCloud.currentSong.url), 'https://quality.example/song.flac');
    await page.evaluate(() => Player.clearQueue()); assert.equal(await page.locator('#favoriteBtn').isDisabled(), true);
  });
  await check('local playback retains local favorites without uploading file URLs', async () => {
    await page.evaluate(async () => {
      UzzApi.localLyric = async () => ({ lyric: '' });
      await Player.loadAndPlay({ id: 'local-file', name: '本机歌曲', vendor: 'local', url: '/api/local/stream?id=local-file' });
      Player.toggleFav();
    });
    assert.equal(await page.locator('#favoriteBtn').isDisabled(), true);
    assert.equal(await page.evaluate(() => Player.getFavorites()[0].vendor), 'local');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mock.favorites')).some(r => r.song_name === '本机歌曲')), false);
  });
  await check('session restores after reload; account switch clears prior cloud list', async () => {
    await play(page, 'A'); await wait(page, () => !document.getElementById('favoriteBtn').disabled); await page.click('#favoriteBtn');
    await wait(page, () => document.getElementById('favoriteBtn').getAttribute('aria-pressed') === 'true');
    await page.reload(); await wait(page, () => !!XYCloud.user && document.getElementById('cloudFavorites').textContent.includes('歌曲A'));
    await page.click('#accountOpen'); await page.click('#cloudLogout'); await wait(page, () => !XYCloud.user);
    assert.equal(await page.locator('#cloudFavorites').textContent(), '');
    await page.fill('#cloudPhone', '13900000000'); await page.fill('#cloudPassword', 'test-password'); await page.click('#cloudSubmit');
    await wait(page, () => XYCloud.user?.id === '+8613900000000' && document.getElementById('cloudAccountStatus').textContent.includes('暂无云端收藏'));
    await page.click('#accountClose');
    await play(page, 'A'); await wait(page, () => !document.getElementById('favoriteBtn').disabled);
    assert.equal(await page.locator('#favoriteBtn').getAttribute('aria-pressed'), 'false');
  });
  await check('existing updater uses semantic max, renders safe text, clears stale links on errors', async () => {
    await page.click('#tbSettings'); await page.locator('.set-nav [data-tab="about"]').click();
    await page.click('#abCheck'); await wait(page, () => document.getElementById('updNew').textContent === 'v3.10.0');
    assert.equal(await page.locator('#updNotes b').count(), 0);
    await page.click('#updInstall'); assert.equal(await page.evaluate(() => __opens.at(-1)[0]), 'https://download.example/app.exe');
    await page.evaluate(() => { __cloudMock.error = 'offline'; }); await page.click('#updCheck');
    await wait(page, () => document.getElementById('updStatus').textContent.includes('offline'));
    assert.equal(await page.locator('#updNewRow').evaluate(el => el.classList.contains('hidden')), true);
    const result = await page.evaluate(async () => { __cloudMock.error = null; __cloudMock.versionRows = []; return checkAppUpdate('3.0.0', 'windows'); });
    assert.equal(result, null);
  });
  await check('no duplicate IDs or page script errors', async () => {
    assert.deepEqual(await page.locator('[id]').evaluateAll(nodes => { const ids=nodes.map(n=>n.id);return ids.filter((id,i)=>ids.indexOf(id)!==i); }), []);
    assert.deepEqual(errors, []);
  });
  await context.close();
  await check('native updater uses installed version and binds install action once', async () => {
    const desktop = await openPage({ nativeUpdater: true });
    await desktop.page.click('#tbSettings'); await desktop.page.locator('.set-nav [data-tab="about"]').click();
    await desktop.page.click('#abCheck'); await wait(desktop.page, () => document.getElementById('updNew').textContent === 'v3.10.0');
    assert.equal(await desktop.page.locator('#abVer').textContent(), 'v3.4.0');
    await desktop.page.click('#updInstall');
    assert.deepEqual(await desktop.page.evaluate(() => __installCalls), ['https://download.example/app.exe']);
    assert.deepEqual(desktop.errors, []); await desktop.context.close();
  });
  await check('Android update checks use the Android platform', async () => {
    const mobile = await openPage({ android: true });
    const info = await mobile.page.evaluate(async () => {
      __cloudMock.versionRows.push({ id: 3, platform: 'android', version: '4.0.0', download_url: 'https://download.example/app.apk', release_notes: '安卓更新' });
      return XYCloud.getUpdateInfo();
    });
    assert.equal(info.latest, '4.0.0'); assert.equal(info.url, 'https://download.example/app.apk');
    assert.deepEqual(mobile.errors, []); await mobile.context.close();
  });
  await check('SDK network failure preserves playback and local account UI', async () => {
    const offline = await openPage({ sdk: false });
    assert.equal(await offline.page.locator('#favoriteBtn').isDisabled(), true);
    assert.equal(await offline.page.evaluate(() => XYCloud.available), false);
    await play(offline.page, 'offline'); assert.equal(await offline.page.evaluate(() => Player.getState().current.id), 'offline');
    await offline.page.click('#accountOpen'); await offline.page.locator('#legacyAccount summary').click();
    assert.equal(await offline.page.locator('#accountUsername').isVisible(), true);
    assert.deepEqual(offline.errors, []); await offline.context.close();
  });
})().catch(error => { failures++; console.error(error); }).finally(async () => {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  if (!path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(temp).startsWith('xy-cloud-')) throw new Error('Unexpected test cleanup path');
  fs.rmSync(temp, { recursive: true, force: true });
  process.exitCode = failures ? 1 : 0;
});
