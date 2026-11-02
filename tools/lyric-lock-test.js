/* ============================================================
 * lyric-lock-test.js — 桌面歌词「锁定/鼠标穿透」真实验证
 * 验证点：
 *   1) 设置页勾选「锁定歌词位置」→ 真的下发到主进程（改变窗口穿透）
 *   2) 歌词窗内点锁按钮 → 真的通知主进程（而不是只改自己的 localStorage）
 *   3) 锁定态下鼠标移到歌词/工具条 → 判定为命中（可交互）
 *      鼠标在空白处 → 判定为不命中（穿透，不挡桌面）
 *   4) 解锁态 → 歌词本体也算可交互（可拖动）
 *   5) 不出现死循环（锁定态来回同步不失控）
 * ============================================================ */
const path = require('path');
const http = require('http');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'app');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p === '/') p = '/index.html';
      const fp = path.join(APP, p);
      if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      res.end(fs.readFileSync(fp));
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

(async () => {
  const { srv, port } = await serve();
  let pw;
  try { pw = require(path.join(ROOT, 'electron', 'node_modules', 'playwright')); }
  catch (e) { console.log('playwright 不可用：', e.message); srv.close(); process.exit(1); }

  const browser = await pw.chromium.launch();
  const res = { main: {}, lyric: {} };
  let errs = [];

  /* ─────────── A. 主窗口（设置页） ─────────── */
  const page = await browser.newPage();
  page.on('pageerror', (e) => errs.push('[main] ' + e.message));
  await page.addInitScript(() => {
    window.__ipc = [];
    const rec = (k, v) => { window.__ipc.push({ k, v }); return v; };
    window.uzzBridge = {
      setLyricLocked: async (on) => rec('setLyricLocked', { ok: true, locked: !!on }),
      getLyricLocked: async () => rec('getLyricLocked', { ok: true, locked: false }),
      showLyric: (v) => rec('showLyric', v),
      setLyricTopmost: (v) => rec('setLyricTopmost', v),
      sendLyric: () => {}, setLyricStyle: () => {},
      getStartup: async () => false, setStartup: () => {},
      getMinToTray: async () => true, setMinToTray: () => {},
      getDownloadDir: async () => 'D:\\M', chooseDownloadDir: async () => '', openDownloadDir: () => {},
      getAppVersion: async () => '2.13.0',
      checkUpdate: async () => ({ ok: true, cur: '2.13.0', latest: '2.13.0', hasUpdate: false }),
      scanLocalPackages: async () => ({ list: [] }),
      pickAndInstall: async () => ({ ok: false }), installLocalPath: async () => ({ ok: false }),
      downloadAndInstall: async () => ({ ok: false }), setUpdateUrl: () => {},
      onUpdateProgress: () => {}, updSrvInfo: async () => ({ running: false, dir: '', port: 0, latest: null }),
      updSrvToggle: async () => ({ ok: true }), updSrvSetDir: async () => '', updSrvOpenDir: () => {}, updSrvPublish: async () => ({ ok: true }),
      onWhatsNew: () => {}, setMiniMode: () => {}, setMiniListVisible: () => {},
      onLyricClosed: () => {}, onLyricOpenSettings: () => {}, onLyricOffset: () => {},
      onGlobal: () => {}, onDownloadDone: () => {}, onOpenLocalFile: () => {}, onMaximized: () => {},
      isDesktop: async () => true, pickFiles: async () => [], pickFolder: async () => '',
      minimize: () => {}, maximize: () => {}, close: () => {},
      gpuInfo: async () => ({ enabled: true }), setGpu: async () => ({ ok: true, needRestart: true }),
      setNoScale: async () => ({ ok: true }), getAllCfg: async () => ({}), onSysEvent: () => {},
      getDefaultPlayer: async () => ({ isDefault: false }), setDefaultPlayer: async () => ({ ok: true }),
      openDefaultApps: () => {}, scheduleClose: async () => ({ ok: true, off: true }), cancelClose: () => {},
      scheduleShutdown: async () => ({ ok: true, off: true }), cancelShutdown: () => {},
      blockPower: async () => ({ ok: true }), setLoginMode: async () => ({ ok: true }),
      getCacheDir: async () => 'C:\\c', openCacheDir: async () => true,
      getCacheSize: async () => ({ bytes: 0, files: 0, sizeText: '0 B' }),
      clearCache: async () => ({ ok: true, freedText: '0 B' }), setCacheMax: async () => ({ ok: true }),
      setNameFmt: async () => ({ ok: true }), getNameFmt: async () => 'artist-name',
      setProxy: async () => ({ ok: true }), setSmtc: async () => ({ ok: true }),
      smtcInfo: async () => true, onSmtcUpdate: () => {},
      saveKeys: async () => ({ ok: true, failed: [] }), registerGlobal: async () => ({ ok: true }),
      setSysVolume: async () => ({ ok: true }), getSysVolume: async () => 60, muteSys: async () => ({ ok: true }),
    };
  });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  res.main = await page.evaluate(async () => {
    const $ = (id) => document.getElementById(id);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelectorAll('main.view').forEach((m) => m.classList.add('hidden'));
    const sm = $('viewSettings'); if (sm) sm.classList.remove('hidden');
    document.querySelectorAll('.set-nav button').forEach((b) => { if (b.dataset.page === 'desktop') b.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await sleep(200);

    const out = {};
    const lock = $('stDLyricLock');
    out.hasSwitch = !!lock;
    out.initialRead = (window.__ipc.filter((x) => x.k === 'getLyricLocked').length > 0);

    // 勾选锁定 → 应调用 setLyricLocked(true)
    if (lock) {
      lock.checked = true;
      lock.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(250);
    }
    const calls = window.__ipc.filter((x) => x.k === 'setLyricLocked');
    out.lockCalled = calls.length;
    out.lockValue = calls.length ? calls[calls.length - 1].v.locked : null;
    out.persisted = localStorage.getItem('uzz.lyricLock');

    // 取消锁定 → 应下发 false
    if (lock) {
      lock.checked = false;
      lock.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(250);
    }
    const calls2 = window.__ipc.filter((x) => x.k === 'setLyricLocked');
    out.unlockCalled = calls2.length;
    out.unlockValue = calls2.length ? calls2[calls2.length - 1].v.locked : null;
    return out;
  });
  await page.close();

  /* ─────────── B. 歌词窗 ─────────── */
  const lp = await browser.newPage();
  lp.on('pageerror', (e) => errs.push('[lyric] ' + e.message));
  // 记录所有 IPC 发送，模拟主进程
  await lp.addInitScript(() => {
    window.__sent = [];
    window.require = (m) => (m === 'electron' ? {
      ipcRenderer: {
        send: (ch, v) => { window.__sent.push({ ch, v }); },
        on: (ch, cb) => { (window.__handlers = window.__handlers || {})[ch] = cb; },
      },
    } : {});
  });
  const lyricPath = 'file:///' + path.join(ROOT, 'electron', 'lyric.html').replace(/\\/g, '/');
  await lp.goto(lyricPath);
  await lp.waitForTimeout(600);

  res.lyric = await lp.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    // 模拟主进程下发"锁定"
    const fire = (ch, v) => { const h = (window.__handlers || {})[ch]; if (h) h({ }, v); };

    // 初始：applyLock(false) 应已发出 setLocked(false)
    out.initSent = (window.__sent || []).filter((x) => x.ch === 'lyric:setLocked').map((x) => x.v);
    out.askedLocked = (window.__sent || []).some((x) => x.ch === 'lyric:askLocked');
    out.reportedRects = (window.__sent || []).some((x) => x.ch === 'lyric:hitTest');

    // 点锁按钮 → 必须发出 setLocked(true)（关键：不能只改本地）
    const bLock = document.getElementById('bLock');
    const before = (window.__sent || []).filter((x) => x.ch === 'lyric:setLocked').length;
    bLock.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(200);
    const after = (window.__sent || []).filter((x) => x.ch === 'lyric:setLocked');
    out.lockBtnSent = after.length - before;
    out.lockBtnValue = after.length ? after[after.length - 1].v : null;
    out.bodyHasLocked = document.body.classList.contains('locked');

    // 主进程下发锁定 → 歌词窗应接受且不再回发（防死循环）
    const cntBefore = (window.__sent || []).filter((x) => x.ch === 'lyric:setLocked').length;
    fire('lyric:locked', true);
    await sleep(150);
    const cntAfter = (window.__sent || []).filter((x) => x.ch === 'lyric:setLocked').length;
    out.echoLoop = cntAfter - cntBefore;   // 应为 0
    out.lockedAfterFire = document.body.classList.contains('locked');

    // 模拟鼠标移动 → 是否上报 pointer 状态
    const bar = document.getElementById('bar');
    const r = bar.getBoundingClientRect();
    const fireMove = (x, y) => window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
    // 移到工具条上（命中）
    fireMove(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    await sleep(200);
    const hitSends = (window.__sent || []).filter((x) => x.ch === 'lyric:pointer');
    out.pointerSends = hitSends.length;
    out.pointerValues = hitSends.map((x) => x.v);

    // 移到空白处（左上角，远离歌词/工具条）→ 应上报不命中
    const before2 = hitSends.length;
    fireMove(2, 2);
    await sleep(200);
    const after2 = (window.__sent || []).filter((x) => x.ch === 'lyric:pointer');
    out.pointerAfterBlank = after2.length - before2;
    out.pointerLast = after2.length ? after2[after2.length - 1].v : null;

    // 解锁 → 歌词本体应算可交互
    fire('lyric:locked', false);
    await sleep(150);
    const box = document.getElementById('lyricBox');
    const br = box.getBoundingClientRect();
    const before3 = (window.__sent || []).filter((x) => x.ch === 'lyric:pointer').length;
    fireMove(Math.round(br.left + br.width / 2), Math.round(br.top + br.height / 2));
    await sleep(200);
    const after3 = (window.__sent || []).filter((x) => x.ch === 'lyric:pointer');
    out.unlockedLyricHit = after3.length > before3 ? after3[after3.length - 1].v : null;

    return out;
  });

  await lp.close();
  await browser.close();
  srv.close();

  console.log(JSON.stringify(res, null, 2));

  const checks = [
    ['设置页有锁定开关', res.main.hasSwitch],
    ['启动即读取真实锁定态', res.main.initialRead],
    ['勾选锁定真下发主进程', res.main.lockCalled >= 1 && res.main.lockValue === true],
    ['取消锁定真下发 false', res.main.unlockValue === false],
    ['歌词窗初始上报锁定态', res.lyric.initSent.length >= 1],
    ['歌词窗主动询问锁定态', res.lyric.askedLocked],
    ['命中矩形已上报', res.lyric.reportedRects],
    ['锁按钮真通知主进程', res.lyric.lockBtnSent >= 1 && res.lyric.lockBtnValue === true],
    ['锁按钮切locked 类', res.lyric.bodyHasLocked],
    ['主进程下发被接受', res.lyric.lockedAfterFire],
    ['无回声死循环', res.lyric.echoLoop === 0],
    ['鼠标移向工具条→上报命中', res.lyric.pointerValues && res.lyric.pointerValues.includes(true)],
    ['鼠标移到空白→上报穿透', res.lyric.pointerAfterBlank >= 1 && res.lyric.pointerLast === false],
    ['解锁后歌词本体可交互', res.lyric.unlockedLyricHit === true],
  ];

  console.log('\n=== 判定 ===');
  let pass = 0;
  for (const [name, ok] of checks) {
    console.log((ok ? '  ' : '  ✗ ') + name.padEnd(26, ' ') + ' → ' + (ok ? 'PASS' : 'FAIL'));
    if (ok) pass++;
  }
  console.log(`\n${pass}/${checks.length} 项通过`);
  console.log('JS 错误:', errs.length, errs.slice(0, 3).join(' | '));
  process.exit(pass === checks.length ? 0 : 1);
})();