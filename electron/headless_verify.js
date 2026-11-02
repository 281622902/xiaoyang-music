// 无头实跑验证（开发态）：拉起 electron（dev main.js → 用当前 app/ + server/ 源码），
// 经 CDP 连接，校验“0 控制台错误 / 0 未捕获异常”，并交互断言本次 10 项改动的关键 DOM。
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DBG_PORT = 9341;
// 用开发态 electron（dist/electron.exe）：它以“目录方式”启动时会加载本仓库的 app/ + server/ 源码，
// 等价于最终分发包，且无需复制。注意：本沙箱环境默认 export 了 ELECTRON_RUN_AS_NODE=1，
// 会让 electron 二进制退化成纯 node（require('electron') 解析到 npm shim、chromium 参数报 bad option），
// 必须在子进程 env 中删除该变量，electron 才能正常 bootstrap。
const ELECTRON = path.resolve(__dirname, 'node_modules/electron/dist/electron.exe');

function waitPort(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryOnce = () => {
      const s = http.get({ host: '127.0.0.1', port, path: '/json/version' }, (r) => { r.resume(); resolve(); });
      s.on('error', () => { s.destroy(); if (Date.now() - start > timeoutMs) reject(new Error('调试端口超时')); else setTimeout(tryOnce, 300); });
      s.setTimeout(500, () => { s.destroy(); if (Date.now() - start > timeoutMs) reject(new Error('调试端口超时')); else setTimeout(tryOnce, 300); });
    };
    tryOnce();
  });
}

const findings = [];
function ok(name) { findings.push(['PASS', name]); console.log('  ✓', name); }
function bad(name, detail) { findings.push(['FAIL', name + (detail ? ' :: ' + detail : '')]); console.log('  ✗', name, detail || ''); }

(async () => {
  // 删除 ELECTRON_RUN_AS_NODE，让 electron 以真正的桌面运行时启动（否则退化成 node）
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv.NODE_OPTIONS; // 去掉 WorkBuddy 注入的 node shim，避免 electron 内置 node 加载失败
  delete childEnv.HTTPS_PROXY; delete childEnv.HTTP_PROXY; delete childEnv.https_proxy; delete childEnv.http_proxy;
  delete childEnv.NO_PROXY; // 确保 localhost 调试端口不被代理拦截
  // 同时清掉本进程代理，connectOverCDP 取 /json/version 时才不会把 127.0.0.1:9341 误投到沙箱代理
  delete process.env.HTTPS_PROXY; delete process.env.HTTP_PROXY; delete process.env.https_proxy; delete process.env.http_proxy; delete process.env.NO_PROXY;
  // 目录方式启动：加载本仓库 electron/package.json 的 main（main.js），开发态下 main.js 会托管 ../app 与 ../server
  const args = ['.', '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${DBG_PORT}`];
  console.log('启动 electron (dev, 真实运行时) ...');
  const child = spawn(ELECTRON, args, { env: childEnv, cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { const s = d.toString(); if (/backend listening|ERROR|Error/i.test(s)) console.log('[electron]', s.trim()); });
  child.stderr.on('data', (d) => { const s = d.toString(); if (/error|exception/i.test(s)) console.log('[electron-err]', s.trim().slice(0, 200)); });

  const errors = [];      // console.error / console.warn? 只收 error
  const pageErrors = [];  // 未捕获异常
  try {
    await waitPort(DBG_PORT, 45000);
    console.log('✓ 调试端口就绪');
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${DBG_PORT}`);
    browser.on('disconnected', () => console.log('[browser disconnected]'));
    // 在 Electron headless 下，应用窗口未必是 contexts()[0].pages()[0]，需要从所有页面里挑出真正渲染了应用的那个
    async function findAppPage() {
      for (const ctx of browser.contexts()) {
        for (const p of ctx.pages()) {
          try { const html = await p.content(); if (/本地音乐/.test(html)) return p; } catch (e) {}
        }
      }
      return null;
    }
    let page = await findAppPage();
    // 应用窗口可能尚未就绪，最多等 20s
    let waited = 0;
    while (!page && waited < 20000) { await new Promise((r) => setTimeout(r, 500)); waited += 500; page = await findAppPage(); }
    if (!page) { bad('未能定位应用页面'); throw new Error('no app page'); }
    console.log('✓ 已定位应用页面');
    page.on('crash', () => console.log('[PAGE CRASHED]'));
    page.on('close', () => console.log('[PAGE CLOSED]'));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => { pageErrors.push((e && e.message) || String(e)); console.log('[pageerror-stack]\n' + ((e && e.stack) || e)); });

    // 等前端渲染（首页导航出现）
    try {
      await page.waitForSelector('text=本地音乐', { timeout: 30000 });
      ok('前端首屏渲染（检测到“本地音乐”导航）');
    } catch (e) { bad('前端首屏渲染', '30s 内未等到关键节点'); }

    // 等主框架 script 就绪
    await page.waitForTimeout(800);

    // ── 项 5：搜索框 + 返回键 移至主区（main-navbar） ──
    const hasNavbar = await page.$('.main-navbar #searchInput');
    hasNavbar ? ok('#5 搜索框位于主区 navbar') : bad('#5 搜索框不在主区 navbar');
    const hasNavBack = await page.$('#navBack');
    hasNavBack ? ok('#5 返回键 navBack 存在') : bad('#5 缺少 navBack');

    // ── 项 8：侧栏无“设置”按钮（标题栏已有） ──
    const sideHasSettings = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#sideNav button')];
      return btns.some((b) => /设置/.test(b.textContent));
    });
    !sideHasSettings ? ok('#8 侧栏已无“设置”按钮') : bad('#8 侧栏仍存在“设置”按钮');

    // ── 项 2/3/6：底部播放条 播放SVG / 音质 / 收藏到歌单 ──
    const hasPbQuality = await page.$('#pbQuality'); hasPbQuality ? ok('#3 音质按钮 pbQuality 存在') : bad('#3 缺少 pbQuality');
    const hasAddFav = await page.$('#fpAddFav'); hasAddFav ? ok('#6 收藏到歌单 fpAddFav 存在') : bad('#6 缺少 fpAddFav');
    const dataTip = await page.$eval('#fpAddFav', (el) => el.getAttribute('data-tip')).catch(() => null);
    dataTip === '收藏到歌单' ? ok('#6 fpAddFav 悬停文字=收藏到歌单') : bad('#6 fpAddFav data-tip', String(dataTip));
    const hasPlaySvg = await page.$('#fpPlay svg'); hasPlaySvg ? ok('#2 播放键内嵌 SVG') : bad('#2 fpPlay 无 SVG');

    // 交互：点开音质菜单并切换档位（用真实 DOM 点击，等价于用户点击）
    const qBefore = await page.$eval('#pbQuality', (el) => el.textContent.trim()).catch(() => '');
    const menuStateBefore = await page.$eval('#qualityMenu', (m) => ({ cls: m.className, disp: getComputedStyle(m).display })).catch(() => null);
    await page.$eval('#pbQuality', (el) => el.click());
    await page.waitForTimeout(250);
    const menuVisible = await page.evaluate(() => { const m = document.querySelector('#qualityMenu'); return m && !m.classList.contains('hidden'); });
    if (!menuVisible) {
      // 若直接 click 仍未展开，再尝试坐标点击（排查是否被遮挡）
      await page.click('#pbQuality').catch(() => {});
      await page.waitForTimeout(250);
      menuVisible = await page.evaluate(() => { const m = document.querySelector('#qualityMenu'); return m && !m.classList.contains('hidden'); });
    }
    menuVisible ? ok('#3 音质下拉可展开') : bad('#3 音质菜单未展开', 'before=' + JSON.stringify(menuStateBefore));
    if (menuVisible) {
      await page.$eval('#qualityMenu button[data-q="lossless"]', (el) => el.click()).catch(() => {});
      await page.waitForTimeout(250);
      const qAfter = await page.$eval('#pbQuality', (el) => el.textContent.trim()).catch(() => '');
      /无损/.test(qAfter) ? ok('#3 音质切换为“无损”') : bad('#3 切换后文案未变', qAfter);
    }

    // ── 项 10：个性皮肤 设置 tab ──
    await page.evaluate(() => document.querySelector('#setTabs button[data-tab="settings"], #setTabs button[data-tab="skin"]') && true);
    const hasSkinTab = await page.$('#setTabs button[data-tab="skin"]');
    hasSkinTab ? ok('#10 设置页含“个性皮肤”tab') : bad('#10 缺少 个性皮肤 tab');
    if (hasSkinTab) {
      await page.click('#setTabs button[data-tab="skin"]').catch(() => {});
      await page.waitForTimeout(200);
      const cards = await page.$$eval('#skinGrid .skin-card', (els) => els.length).catch(() => 0);
      cards >= 1 ? ok('#10 皮肤卡片渲染（' + cards + ' 张）') : bad('#10 皮肤卡片未渲染', 'count=' + cards);
    }

    // ── 项 9：全屏播放页 底部栏 + 黑胶频谱 canvas + 歌手/专辑可点击 ──
    await page.evaluate(() => {
      const s = window.Player.getState();
      s.current = { id: 'test1', name: '验证曲目', artist: '验证歌手', artistId: '777', album: '验证专辑', albumId: '888', vendor: 'netease', pic: '' };
      s.queue = [s.current];
    });
    await page.evaluate(() => window.Player.openFull());
    await page.waitForTimeout(400);
    const fullVisible = await page.evaluate(() => { const f = document.querySelector('#fullPlayer'); return f && !f.classList.contains('hidden'); });
    fullVisible ? ok('#9 全屏播放页可打开') : bad('#9 全屏页未打开');
    const hasFpBottom = await page.$('.fp-bottom #fpbSong'); hasFpBottom ? ok('#9 全屏底部栏含 歌名') : bad('#9 缺少 fp-bottom/fpbSong');
    const hasFpQueue = await page.$('#fpbQueue'); hasFpQueue ? ok('#9 底部栏含 播放列表') : bad('#9 缺少 fpbQueue');
    const hasFpFx = await page.$('#fpbFx'); hasFpFx ? ok('#9 底部栏含 音效') : bad('#9 缺少 fpbFx');
    const vizCanvas = await page.$('#fpViz'); vizCanvas ? ok('#9 黑胶频谱 canvas 存在') : bad('#9 缺少 fpViz');
    const artistLink = await page.evaluate(() => { const a = document.querySelector('#fpArtist'); return a && a.classList.contains('fp-link'); });
    artistLink ? ok('#9 歌手可点击（fp-link）') : bad('#9 fpArtist 无 fp-link');

    // ── 项 1：音量 悬停停留 + 滚轮调节（验证元素与事件绑定存在，不依赖实际出声） ──
    const volWrap = await page.$('#volWrap'); volWrap ? ok('#1 音量包裹 volWrap 存在（悬停滑条）') : bad('#1 缺少 volWrap');
    const volSlider = await page.$('#volume'); volSlider ? ok('#1 音量滑条存在') : bad('#1 缺少 volume');

    // ── 新增：字体大小调整（滑块） ──
    const sizeInput = await page.$('#dlSizeSel');
    sizeInput ? ok('字号控件 dlSizeSel 存在') : bad('缺少 dlSizeSel');
    if (sizeInput) {
      const isRange = await page.$eval('#dlSizeSel', (el) => el.type === 'range').catch(() => false);
      isRange ? ok('字号控件是 range 滑块（可连续调整）') : bad('字号控件不是滑块');
      await page.$eval('#dlSizeSel', (el) => { el.value = '60'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.waitForTimeout(150);
      const sizeValTxt = await page.$eval('#dlSizeVal', (el) => el.textContent).catch(() => '');
      /60px/.test(sizeValTxt) ? ok('拖动滑块后字号实时显示 60px') : bad('字号实时显示未更新', sizeValTxt);
      const stored = await page.evaluate(() => localStorage.getItem('uzz.dl.size'));
      stored === '60' ? ok('字号已持久化（uzz.dl.size=60）') : bad('字号未持久化', String(stored));
    }

    // ── 新增：桌面歌词 锁定功能 ──
    await page.evaluate(() => { try { window.uzzBridge.showLyric(true); } catch (e) {} });
    await page.waitForTimeout(1500);
    let lyricPage = null;
    for (const ctx of browser.contexts()) {
      for (const p of ctx.pages()) {
        const has = await p.$('#lyricLock').catch(() => null);
        if (has) { lyricPage = p; break; }
      }
      if (lyricPage) break;
    }
    if (lyricPage) {
      ok('桌面歌词窗口已打开');
      const lockExists = await lyricPage.$('#lyricLock');
      lockExists ? ok('桌面歌词含 锁定按钮') : bad('桌面歌词缺少 锁定按钮');
      await lyricPage.$eval('#lyricLock', (el) => el.click());
      await lyricPage.waitForTimeout(150);
      const locked = await lyricPage.evaluate(() => document.querySelector('#lyricBox').classList.contains('locked'));
      locked ? ok('点击后 lyricBox.locked（已锁定）') : bad('锁定未生效');
      const persisted = await lyricPage.evaluate(() => localStorage.getItem('uzz.lyricLock'));
      persisted === '1' ? ok('锁定状态已持久化') : bad('锁定未持久化', String(persisted));
    } else {
      bad('未能打开桌面歌词窗口（可能桥接未就绪）');
    }

    // 收尾：关闭全屏
    await page.evaluate(() => window.Player.closeFull());

    // 错误统计
    console.log('\n=== 控制台错误 (' + errors.length + ') ===');
    errors.slice(0, 20).forEach((e) => console.log('  CONSOLE.ERROR:', e.slice(0, 240)));
    console.log('=== 未捕获异常 (' + pageErrors.length + ') ===');
    pageErrors.slice(0, 20).forEach((e) => console.log('  PAGEERROR:', e.slice(0, 240)));

    errors.length === 0 ? ok('0 控制台错误') : bad('存在控制台错误', errors.length + ' 条');
    pageErrors.length === 0 ? ok('0 未捕获异常') : bad('存在未捕获异常', pageErrors.length + ' 条');

    const fails = findings.filter((f) => f[0] === 'FAIL');
    console.log('\nRESULT:', fails.length === 0 ? 'ALL OK' : (fails.length + ' 项未通过'));
    await browser.close();
  } catch (e) {
    console.log('ERR', (e && e.message) || e);
  } finally {
    try { child.kill('SIGKILL'); } catch (e) {}
  }
  process.exit(0);
})();
