const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const { once } = require('node:events');
let pw; try { pw = require('playwright'); } catch { pw = require(process.env.PLAYWRIGHT_MODULE || '../electron/node_modules/playwright'); }
const ROOT = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xy-android-test-'));
process.env.MOCK = '1'; process.env.UZZ_USER_DATA = temp;
const { server } = require('../server/index');
let browser, failures = 0;
async function check(name, fn) { try { await fn(); console.log('PASS ' + name); } catch (error) { failures++; console.error('FAIL ' + name + ': ' + error.stack); } }
async function pageFor(width, native = false) {
  const context = await browser.newContext({ viewport: { width, height: 820 }, ...(native ? { userAgent: 'Mozilla/5.0 (Linux; Android 12) Chrome/124 Mobile' } : {}) });
  const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('https://**/*', route => route.abort());
  await page.route('http://localhost:3000/**', route => route.fulfill({ json: { code: 200, result: [], list: [], tracks: [], hot: [], charts: [] } }));
  await page.route('**/api/**', route => route.fulfill({ json: { code: 200, result: [], list: [], tracks: [], hot: [], charts: [] } }));
  if (native) await page.addInitScript(() => {
    window.__nativeCalls = []; window.__keyboardEvents = {};
    window.androidBridge = { postMessage() {} };
    window.Capacitor = {
      PluginHeaders: [
        { name: 'Browser', methods: [{ name: 'open', rtype: 'promise' }] },
        { name: 'App', methods: [{ name: 'getInfo', rtype: 'promise' }] },
        { name: 'StatusBar', methods: ['setOverlaysWebView', 'setStyle', 'setBackgroundColor'].map(name => ({ name, rtype: 'promise' })) },
        { name: 'Keyboard', methods: [{ name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'promise' }] }
      ],
      nativePromise(plugin, method, data) { __nativeCalls.push({ plugin, method, data }); return Promise.resolve(plugin === 'App' ? { version: '3.0.1', build: '3000001' } : {}); },
      nativeCallback(plugin, method, data, callback) { if (method === 'addListener') __keyboardEvents[data.eventName] = callback; return 'mock-listener'; }
    };
  });
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => document.readyState === 'complete' && !!window.Player && !!window.XYNative);
  return { page, context, errors };
}
(async () => {
  await check('Android project, ABI and Gradle configuration are present and idempotent', () => {
    const { patchAndroid, androidVersion } = require('../scripts/prepare-android.cjs');
    const gradle = path.join(ROOT, 'android/app/build.gradle'); patchAndroid(); const first = fs.readFileSync(gradle, 'utf8'); patchAndroid();
    assert.equal(fs.readFileSync(gradle, 'utf8'), first); assert.match(first, /abiFilters 'x86_64', 'arm64-v8a'/);
    assert.equal((first.match(/XY_ANDROID_BEGIN/g) || []).length, 1); assert.equal(androidVersion('3.0.6').code, 3000006);
    const config = require('../capacitor.config.json'); assert.equal(config.webDir, 'capacitor/www'); assert.equal(config.plugins.StatusBar.overlaysWebView, false);
    assert.match(fs.readFileSync(path.join(ROOT, 'android/app/src/main/AndroidManifest.xml'), 'utf8'), /windowSoftInputMode="adjustResize"/);
    assert.match(fs.readFileSync(path.join(ROOT, 'android/gradle/wrapper/gradle-wrapper.properties'), 'utf8'), /gradle-8\.7-bin/);
  });
  await check('MuMu port discovery reads current nested instance configuration', () => {
    const home = path.join(temp, 'mumu');
    const file = path.join(home, 'vms/instance/configs/vm_config.json'); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ vm: { nat: { port_forward: { adb: { host_port: 23456 } } } } }));
    assert.deepEqual(require('../scripts/build-android').mumuPorts(home), [23456]);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  browser = await pw.chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined, headless: true });
  await check('all scripts are local and real Supabase SDK initializes without external network', async () => {
    const p = await pageFor(1180);
    assert.equal(await p.page.locator('script[src^="http"]').count(), 0);
    assert.equal(await p.page.evaluate(() => XYCloud.available), true);
    assert.equal(await p.page.locator('#viewDiscover').isVisible(), true);
    assert.deepEqual(p.errors, []); await p.context.close();
  });
  for (const width of [360, 390, 768]) await check('mobile layout and navigation at ' + width + 'px', async () => {
    const p = await pageFor(width, true);
    assert.equal(await p.page.evaluate(() => XYNative.isAndroid), true);
    const overflow = await p.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 1, 'horizontal overflow ' + overflow);
    if (width <= 760) {
      await p.page.click('#mobileNavToggle'); assert.equal(await p.page.locator('#mobileNavToggle').getAttribute('aria-expanded'), 'true');
      await p.page.click('.xy-mobile-nav-scrim'); assert.equal(await p.page.locator('#mobileNavToggle').getAttribute('aria-expanded'), 'false');
      assert.equal(await p.page.locator('#cloudSubmit').evaluate(el => getComputedStyle(el).touchAction), 'manipulation');
    }
    await p.page.click('#accountOpen');
    assert.equal(await p.page.locator('#legacyAccount').isVisible(), false);
    await p.page.fill('#cloudPhone', '13800000000'); await p.page.fill('#cloudPassword', 'test-password');
    const dialog = await p.page.locator('.xy-dialog').boundingBox(); assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= width + 1);
    assert.deepEqual(p.errors, []);
    if (process.env.SCREENSHOT_DIR) { fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true }); await p.page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'android-login-' + width + '.png') }); }
    await p.context.close();
  });
  await check('keyboard resize keeps login input reachable without double subtracting height', async () => {
    const p = await pageFor(390, true); await p.page.click('#accountOpen'); await p.page.locator('#cloudPassword').focus();
    await p.page.setViewportSize({ width: 390, height: 420 });
    await p.page.evaluate(() => { __keyboardEvents.keyboardDidShow?.({ keyboardHeight: 400 }); window.dispatchEvent(new Event('resize')); });
    await p.page.waitForTimeout(300);
    const input = await p.page.locator('#cloudPassword').boundingBox();
    assert.ok(input.y >= 0 && input.y + input.height <= 420, JSON.stringify(input));
    assert.equal(await p.page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--xy-vh'))), 420);
    assert.deepEqual(p.errors, []); await p.context.close();
  });
  await check('Android update opens native Browser only for APK and uses installed app version', async () => {
    const p = await pageFor(390, true);
    await p.page.evaluate(async () => {
      await XYNative.openUpdate('https://github.com/281622902/xiaoyang-music/releases/download/v4.0.0/app.apk');
      window.checkAppUpdate = async (version, platform) => { window.__updateArgs = { version, platform }; return null; };
      await XYCloud.getUpdateInfo();
    });
    const call = await p.page.evaluate(() => __nativeCalls.find(c => c.plugin === 'Browser' && c.method === 'open'));
    assert.ok(call.data.url.endsWith('.apk'));
    assert.deepEqual(await p.page.evaluate(() => __updateArgs), { version: '3.0.1', platform: 'android' });
    assert.equal(await p.page.evaluate(async () => { try { await XYNative.openUpdate('https://download.example/file.exe'); return false; } catch { return true; } }), true);
    assert.equal(await p.page.evaluate(async () => { try { await XYNative.openUpdate('http://download.example/app.apk'); return false; } catch { return true; } }), true);
    assert.equal(await p.page.evaluate(() => __nativeCalls.some(c => c.plugin === 'StatusBar' && c.method === 'setOverlaysWebView' && c.data.overlay === false)), true);
    assert.deepEqual(p.errors, []); await p.context.close();
  });
  await check('Android refuses access to the computer local media API', async () => {
    const p = await pageFor(390, true);
    const result = await p.page.evaluate(async () => { try { await UzzApi.localLibrary('all'); return false; } catch (error) { return error.message.includes('安卓端不访问电脑'); } });
    assert.equal(result, true); await p.context.close();
  });
})().catch(error => { failures++; console.error(error); }).finally(async () => {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(temp).startsWith('xy-android-test-'));
  fs.rmSync(temp, { recursive: true, force: true }); process.exitCode = failures ? 1 : 0;
});
