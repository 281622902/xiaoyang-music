const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
let pw; try { pw = require('playwright'); } catch { pw = require('../electron/node_modules/playwright'); }
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoyang-electron-'));
let app, failures = 0;
async function check(name, fn) {
  try { await fn(); console.log('PASS ' + name); }
  catch (e) { failures++; console.error('FAIL ' + name + ': ' + e.message); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const http=require('node:http');
  const blocker=http.createServer((req,res)=>res.end('occupied by another application'));
  await new Promise(resolve=>blocker.listen(0,'127.0.0.1',resolve));
  globalThis.portBlocker=blocker;
  const blockedPort=blocker.address().port;
  app = await pw._electron.launch({
    executablePath: process.env.ELECTRON_PATH || undefined,
    args: [...(process.env.PACKAGED_APP ? [] : [path.join(root, 'electron')]), '--user-data-dir=' + profile, '--disable-gpu', '--in-process-gpu', '--no-sandbox'],
    env: { ...process.env, MOCK: '1', PORT: String(blockedPort), UZZ_NO_AUTOPLAY_FLAG: '1' }, timeout: 30000,
  });
  const page = await app.firstWindow();
  await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
  await page.waitForURL('http://localhost:*/', { timeout: 20000 });
  await page.waitForFunction(() => window.Player && window.uzzBridge);
  await page.route('**/api/**', route => {
    if (/\/api\/(local|account)\//.test(route.request().url())) return route.continue();
    return route.fulfill({ json: { code: 200, tracks: [], list: [], hot: [], charts: [], info: {} } });
  });
  // 阻止启动更新提示遮挡测试操作，所有设置保存在独立临时用户目录。
  await page.evaluate(() => document.getElementById('whatsNewModal')?.classList.add('hidden'));
  await check('native desktop version', async () => {
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), require('../electron/package.json').version);
  });
  await check('packaged renderer includes cloud account and favorite integrations', async () => {
    await page.waitForFunction(() => document.readyState === 'complete');
    const integrated = await page.evaluate(() => ({
      version: window.XYCloud?.appVersion,
      functions: ['registerUser', 'loginUser', 'removeFavorite', 'checkIsFavorited', 'checkAppUpdate', 'bindFavoriteButton'].every(name => typeof window[name] === 'function'),
      heart: !!document.getElementById('favoriteBtn'),
      login: !!document.getElementById('cloudForm')
    }));
    assert.equal(integrated.version, require('../electron/package.json').version);
    assert.equal(integrated.functions && integrated.heart && integrated.login, true);
  });
  await check('native occupied port fallback keeps the historical renderer origin',async()=>{
    const port=await app.evaluate(()=>Number(process.env.PORT));assert.notEqual(port,blockedPort);
    assert.equal(await page.evaluate(()=>location.origin),'http://localhost:35211');
    await page.evaluate(()=>localStorage.setItem('xy.port-check','retained'));await page.reload();
    assert.equal(await page.evaluate(()=>localStorage.getItem('xy.port-check')),'retained');
  });
  await check('native account registration and backup POSTs work through port mapping',async()=>{
    await page.click('#accountOpen');await page.locator('#legacyAccount summary').click();await page.click('#accountRegisterTab');
    await page.fill('#accountUsername','native_user');await page.fill('#accountPassword','native-test-password');await page.click('#accountSubmit');
    try { await page.waitForFunction(()=>!document.getElementById('accountMember').classList.contains('hidden'),undefined,{timeout:5000}); }
    catch { throw Error('Account UI: '+await page.locator('#accountStatus').textContent()); }
    await page.click('#accountBackup');await page.waitForFunction(()=>document.getElementById('accountStatus').textContent.includes('已备份'));await page.click('#accountClose');
  });
  await check('lock preference survives creating lyric window', async () => {
    await page.evaluate(async () => {
      await uzzBridge.setLyricLocked(true); uzzBridge.showLyric(true); Player.pushLyricStyle();
    }); await wait(500);
    const lyric = app.windows().find(w => w.url().endsWith('/lyric.html'));
    assert.ok(lyric, 'native lyric BrowserWindow missing');
    assert.equal(await lyric.evaluate(() => document.body.classList.contains('locked')), true);
    assert.equal(await page.evaluate(async () => (await uzzBridge.getLyricLocked()).locked), true);
  });
  const lyric = app.windows().find(w => w.url().endsWith('/lyric.html'));
  await check('native pause update preserves current lyric', async () => {
    await page.evaluate(() => {
      uzzBridge.sendLyric({ cur: '原生桌面歌词验证', next: '第二行', playing: true });
      uzzBridge.sendLyric({ keep: true, cur: '', next: '', playing: false });
    }); await wait(100);
    assert.equal(await lyric.locator('#cur').textContent(), '原生桌面歌词验证');
    assert.equal(await lyric.locator('#bPlay').textContent(), '▶');
  });
  await check('native lyric unlock updates main settings checkbox', async () => {
    await lyric.evaluate(() => document.getElementById('bLock').click()); await wait(100);
    assert.equal(await page.evaluate(async () => (await uzzBridge.getLyricLocked()).locked), false);
    assert.equal(await page.locator('#stDLyricLock').isChecked(), false);
  });
  await check('native lyric menu updates main settings and persists after reopening', async () => {
    await lyric.evaluate(() => { document.getElementById('bSet').click(); document.querySelector('[data-k="doubleMode"]').click(); });
    await wait(100);
    assert.equal(await page.evaluate(() => localStorage.getItem('uzz.dl.layout')), 'single');
    await page.evaluate(() => uzzBridge.showLyric(false)); await wait(100);
    await page.evaluate(() => { uzzBridge.showLyric(true); Player.pushLyricStyle(); }); await wait(350);
    const reopened = app.windows().find(w => w.url().endsWith('/lyric.html'));
    assert.equal(await reopened.evaluate(() => document.body.classList.contains('single')), true);
  });
  await check('desktop settings enable/disable lyric and keep two switches synchronized', async () => {
    await page.evaluate(() => {
      const el = document.getElementById('stDLyric'); el.checked = false; el.dispatchEvent(new Event('change'));
    }); await wait(100);
    assert.equal(app.windows().filter(w => w.url().endsWith('/lyric.html')).length, 0);
    assert.equal(await page.locator('#stLyricEnable').isChecked(), false);
    await page.evaluate(() => {
      const el = document.getElementById('stDLyric'); el.checked = true; el.dispatchEvent(new Event('change'));
    }); await wait(350);
    assert.equal(app.windows().filter(w => w.url().endsWith('/lyric.html')).length, 1);
    assert.equal(await page.locator('#stLyricEnable').isChecked(), true);
  });
  await check('native font color and always-on-top settings apply', async () => {
    await page.evaluate(() => {
      const color = document.getElementById('stLyricColor'); color.value = 'blue'; color.dispatchEvent(new Event('change'));
      const top = document.getElementById('stDLyricTop'); top.checked = false; top.dispatchEvent(new Event('change'));
    }); await wait(100);
    const lp = app.windows().find(w => w.url().endsWith('/lyric.html'));
    assert.equal(await lp.evaluate(() => getComputedStyle(document.getElementById('cur')).color), 'rgb(122, 182, 255)');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/lyric.html')).isAlwaysOnTop()), false);
  });
  await check('native local WAV loads and playback clock advances', async () => {
    const wav = path.join(profile, 'native-short.wav');
    const data = Buffer.alloc(64044); data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4);
    data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20);
    data.writeUInt16LE(1, 22); data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28);
    data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(64000, 40);
    fs.writeFileSync(wav, data); fs.writeFileSync(wav.replace('.wav', '.lrc'), '[00:00.00]本地播放验证\n[00:02.00]第二句');
    await app.evaluate(({ BrowserWindow }, fp) => {
      BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('http:')).webContents.send('local:openFile', fp);
    }, wav);
    await page.waitForFunction(() => {
      const audio = document.getElementById('audio'); return audio.duration === 4 && audio.currentTime > 0.1;
    }, { timeout: 5000 });
    await page.evaluate(() => Player.toggle());
  });
  await check('native global lyric event reaches renderer and toggles window', async () => {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('http:')).webContents.send('global:lyric');
    }); await wait(100);
    assert.equal(app.windows().filter(w => w.url().endsWith('/lyric.html')).length, 0);
    assert.equal(await page.locator('#stDLyric').isChecked(), false);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('http:')).webContents.send('global:lyric');
    }); await wait(300);
    assert.equal(app.windows().filter(w => w.url().endsWith('/lyric.html')).length, 1);
  });
  await check('native dropped files import deduplicates and starts the first valid track',async()=>{
    const first=path.join(profile,'native-short.wav'),second=path.join(profile,'second.wav'),unsupported=path.join(profile,'notes.txt');
    fs.copyFileSync(first,second);fs.writeFileSync(unsupported,'not audio');
    const result=await page.evaluate(paths=>uzzBridge.importFiles(paths),[first,second,first,unsupported]);
    assert.equal(result.tracks.length,2);assert.equal(result.errors.length,1);
    await page.evaluate(result=>XYStudio.importResult(result),result);
    assert.equal(await page.evaluate(()=>Player.getQueue().length),2);
    await page.waitForFunction(()=>document.getElementById('audio').currentTime>0.1);await page.evaluate(()=>Player.toggle());
  });
  await check('native folder import includes short audio and ignores non-audio files',async()=>{
    const folder=path.join(profile,'dropped-folder');fs.mkdirSync(folder);fs.copyFileSync(path.join(profile,'native-short.wav'),path.join(folder,'clip.wav'));fs.writeFileSync(path.join(folder,'readme.txt'),'ignore');
    const result=await page.evaluate(paths=>uzzBridge.importFiles(paths),[folder]);assert.equal(result.tracks.length,1);assert.equal(result.tracks[0].name,'clip');
  });
  await check('native OS-backed drop events import and play the dropped file',async()=>{
    const file=path.join(profile,'actual-drop.wav');fs.copyFileSync(path.join(profile,'native-short.wav'),file);
    const cdp=await page.context().newCDPSession(page);const data={items:[],files:[file],dragOperationsMask:1};
    await cdp.send('Input.dispatchDragEvent',{type:'dragEnter',x:420,y:300,data});
    await cdp.send('Input.dispatchDragEvent',{type:'drop',x:420,y:300,data});
    await page.waitForFunction(()=>Player.getState().current?.name==='actual-drop',undefined,{timeout:5000});
    assert.equal(await page.evaluate(()=>Player.getQueue().length),1);await page.evaluate(()=>Player.toggle());await cdp.detach();
  });
  await check('native locked lyric hides toolbar and menu', async () => {
    const lp = app.windows().find(w => w.url().endsWith('/lyric.html'));
    await page.evaluate(() => uzzBridge.setLyricLocked(true)); await wait(80);
    const state = await lp.evaluate(() => ({ bar:getComputedStyle(document.getElementById('bar')).opacity, menu:getComputedStyle(document.getElementById('menu')).display }));
    assert.deepEqual(state, {bar:'0',menu:'none'});
    await lp.evaluate(() => document.getElementById('lockFloat').click()); await wait(80);
    assert.equal(await page.evaluate(async () => (await uzzBridge.getLyricLocked()).locked), false);
  });
  await check('native lyric position survives window recreation', async () => {
    const before = await app.evaluate(({ BrowserWindow, screen }) => {
      const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/lyric.html'));
      const a=screen.getPrimaryDisplay().workArea; w.setPosition(a.x+40,a.y+60); return w.getBounds();
    }); await wait(300);
    await page.evaluate(() => uzzBridge.showLyric(false)); await wait(60);
    await page.evaluate(() => { uzzBridge.showLyric(true); Player.pushLyricStyle(); }); await wait(250);
    const after=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/lyric.html')).getBounds());
    assert.equal(after.x,before.x); assert.equal(after.y,before.y);
  });
  await check('canceling updater leaves application running', async () => {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox=async()=>({response:0}); });
    const result=await page.evaluate(()=>uzzBridge.installLocalPath('C:\\Windows\\System32\\where.exe'));
    assert.equal(result.canceled,true); assert.ok(!page.isClosed());
  });
  if (process.env.SCREENSHOT_DIR) {
    await page.evaluate(()=>{
      document.getElementById('whatsNewModal')?.classList.add('hidden');
      localStorage.setItem('uzz.theme.mode','dark');document.dispatchEvent(new CustomEvent('xy:libraryRestore'));
      document.dispatchEvent(new CustomEvent('uzz:view',{detail:'discover'}));
    });await wait(220);await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'native-home.png')});
    await page.click('#accountOpen');await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'native-account.png')});await page.click('#accountClose');
    const lp = app.windows().find(w => w.url().endsWith('/lyric.html'));
    await page.evaluate(() => uzzBridge.sendLyric({ cur: '小杨音乐 · 桌面歌词', next: '设置与播放状态同步', playing: false }));
    await lp.evaluate(() => {
      const r=document.getElementById('lyricBox').getBoundingClientRect();
      window.dispatchEvent(new MouseEvent('mousemove',{clientX:r.x+20,clientY:r.y+10}));
    }); await wait(220);
    await lp.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'native-desktop-lyrics.png'), omitBackground: true });
    await page.evaluate(()=>uzzBridge.setLyricLocked(true)); await wait(60);
    await lp.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'native-desktop-lyrics-locked.png'), omitBackground: true });
  }
  await check('installer exit command closes tray-resident application', async () => {
    const child=app.process();
    const exited=new Promise(resolve=>child.once('exit',resolve));
    const spawn=require('node:child_process').spawn;
    const args=[...(process.env.PACKAGED_APP?[]:[path.join(root,'electron')]),'--user-data-dir='+profile,'--quit-for-install'];
    const second=spawn(process.env.ELECTRON_PATH || require('electron'),args,{env:{...process.env,MOCK:'1'},stdio:'ignore'});
    second.on('error',()=>{}); let timer;
    try { await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('app remained in tray')),5000);})]); }
    finally { clearTimeout(timer); if(second.exitCode===null) second.kill(); }
  });
})().catch(e => { failures++; console.error(e); }).finally(async () => {
  if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
  if(globalThis.portBlocker)await new Promise(resolve=>portBlocker.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  process.exitCode = failures ? 1 : 0;
});
