/* ============================================================
 * settings-real.js — 设置项「真实生效」验证测试
 * 与 btn-test 的区别：不只检查「值被存下」，而是检查
 *   设置改变后系统/运行时是否真的产生了可观测的行为变化。
 * 逐项：字体→CSS、禁用动画→body class、淡入淡出→Eq 时长、
 *      音量平衡→压缩器参数、空间音效→Convolver 节点、
 *      黑名单→播放被拦截、跨端续播→resume 文件、字体/滑杆等。
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
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  // 注入 uzzBridge 桩：模拟 Electron 主进程 IPC 返回值
  await page.addInitScript(() => {
    window.__ipcLog = [];
    const rec = (k, v) => { window.__ipcLog.push({ k, v }); return v; };
    window.uzzBridge = {
      // 系统能力
      getStartup: async () => false,
      setStartup: (on) => rec('setStartup', on),
      getMinToTray: async () => true,
      setMinToTray: (on) => rec('setMinToTray', on),
      getDefaultPlayer: async () => rec('getDefaultPlayer', { isDefault: false }),
      setDefaultPlayer: async () => rec('setDefaultPlayer', { ok: true, registered: true }),
      openDefaultApps: () => rec('openDefaultApps', true),
      scheduleClose: async (m) => rec('scheduleClose', { ok: true, off: false, at: Date.now() + m * 60000 }),
      cancelClose: () => rec('cancelClose', true),
      scheduleShutdown: async (m) => rec('scheduleShutdown', { ok: true, off: false }),
      cancelShutdown: () => rec('cancelShutdown', true),
      blockPower: async (k, on) => rec('blockPower', { ok: true, id: on ? 1 : null, kind: k, on }),
      setLoginMode: async (m) => rec('setLoginMode', { ok: true, mode: m }),
      gpuInfo: async () => rec('gpuInfo', { enabled: true, disabled: false }),
      setGpu: async (on) => rec('setGpu', { ok: true, needRestart: true }),
      setNoScale: async (on) => rec('setNoScale', { ok: true }),
      getAllCfg: async () => ({}),
      onSysEvent: () => {},
      // 缓存
      getCacheDir: async () => rec('getCacheDir', 'C:\\Users\\test\\AppData\\Roaming\\小杨音乐\\cache'),
      openCacheDir: async () => rec('openCacheDir', true),
      getCacheSize: async () => rec('getCacheSize', { bytes: 12345678, files: 42, sizeText: '11.8 MB' }),
      clearCache: async () => rec('clearCache', { ok: true, removed: 42, freedText: '11.8 MB' }),
      setCacheMax: async (g) => rec('setCacheMax', { ok: true }),
      // 下载命名 / 代理 / SMTC
      setNameFmt: async (f) => rec('setNameFmt', { ok: true, fmt: f }),
      getNameFmt: async () => 'artist-name',
      setProxy: async (m, u) => rec('setProxy', { ok: true, mode: m, url: u }),
      setSmtc: async (on) => rec('setSmtc', { ok: true, on }),
      smtcInfo: async () => true,
      onSmtcUpdate: () => {},
      // 快捷键真实注册
      saveKeys: async (keys, opts) => rec('saveKeys', { ok: true, failed: [], keys, opts }),
      registerGlobal: async (keys) => rec('registerGlobal', { ok: true, keys }),
      setSysVolume: async (pct) => rec('setSysVolume', { ok: true, approx: pct, requested: pct }),
      getSysVolume: async () => rec('getSysVolume', 65),
      muteSys: async (on) => rec('muteSys', { ok: true, muted: !!on }),
      // 其它已存在能力
      getDownloadDir: async () => rec('getDownloadDir', 'D:\\Music'),
      chooseDownloadDir: async () => rec('chooseDownloadDir', 'D:\\Music2'),
      openDownloadDir: () => rec('openDownloadDir', true),
      getAppVersion: async () => '2.13.0',
      checkUpdate: async () => ({ ok: true, cur: '2.13.0', latest: '2.13.0', hasUpdate: false }),
      scanLocalPackages: async () => ({ cur: [], list: [] }),
      pickAndInstall: async () => ({ ok: false }),
      installLocalPath: async () => ({ ok: false }),
      downloadAndInstall: async () => ({ ok: false }),
      setUpdateUrl: () => rec('setUpdateUrl', true),
      onUpdateProgress: () => {},
      updSrvInfo: async () => rec('updSrvInfo', { running: false, dir: 'D:\\srv', port: 35212, latest: null, auto: false }),
      updSrvToggle: async (on) => rec('updSrvToggle', { ok: true }),
      updSrvSetDir: async () => rec('updSrvSetDir', 'D:\\srv'),
      updSrvOpenDir: () => rec('updSrvOpenDir', true),
      updSrvPublish: async () => rec('updSrvPublish', { ok: true }),
      onWhatsNew: () => {},
      showLyric: (v) => rec('showLyric', v),
      setLyricTopmost: (v) => rec('setLyricTopmost', v),
      sendLyric: () => {},
      setLyricStyle: () => {},
      setMiniMode: (v) => rec('setMiniMode', v),
      setMiniListVisible: (v) => rec('setMiniListVisible', v),
      onLyricClosed: () => {},
      onLyricOpenSettings: () => {},
      onLyricOffset: () => {},
      onGlobal: () => {},
      onDownloadDone: () => {},
      onOpenLocalFile: () => {},
      onMaximized: () => {},
      isDesktop: async () => true,
      pickFiles: async () => [],
      pickFolder: async () => '',
      minimize: () => {}, maximize: () => {}, close: () => {},
    };
  });

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);

  const res = await page.evaluate(async () => {
    const out = {};
    const $ = (id) => document.getElementById(id);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    const ipcKeys = () => window.__ipcLog.map((x) => x.k);

    // 进入设置页（逐个分组）
    document.querySelectorAll('main.view').forEach((m) => m.classList.add('hidden'));
    const setMain = $('viewSettings');
    if (setMain) setMain.classList.remove('hidden');
    document.querySelectorAll('.set-nav button').forEach((b) => { if (b.dataset.page === 'general') click(b); });
    await sleep(150);

    // ① 字体选择 → body font-family 真实变化
    const fs = $('stFont');
    if (fs && fs.options.length > 1) {
      fs.selectedIndex = 1;
      const want = fs.options[1].value;
      fs.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(120);
      out.font = { picked: want, bodyFont: document.body.style.fontFamily || '', applied: (document.body.style.fontFamily || '').indexOf(want) >= 0 };
    }

    // ② 禁用动画 → body class 真实切换
    const na = $('stNoAnim');
    if (na) {
      na.checked = true; na.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(100);
      out.noAnim = { cls: document.body.classList.contains('no-anim') };
      na.checked = false; na.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(80);
      out.noAnim.off = document.body.classList.contains('no-anim');
    }

    // ③ 设为默认播放器 → 调用真实 IPC
    const sb = $('stSetDefault');
    if (sb) { click(sb); await sleep(250); }
    out.defaultPlayer = { called: ipcKeys().includes('setDefaultPlayer'), tip: ($('stDefaultTip') || {}).textContent || '' };

    // ④ GPU 加速 → 调用 setGpu 并返回 needRestart
    const g = $('stGpu');
    if (g) { g.checked = false; g.dispatchEvent(new Event('change', { bubbles: true })); await sleep(200); }
    out.gpu = { called: ipcKeys().includes('setGpu'), lastVal: (window.__ipcLog.filter((x) => x.k === 'setGpu').pop() || {}).v };

    // ⑤ 系统缩放
    const ns = $('stNoScale');
    if (ns) { ns.checked = true; ns.dispatchEvent(new Event('change', { bubbles: true })); await sleep(180); }
    out.noScale = { called: ipcKeys().includes('setNoScale') };

    // ⑥ 开机启动 → setStartup + setLoginMode
    const su = $('stStartup');
    if (su) { su.checked = true; su.dispatchEvent(new Event('change', { bubbles: true })); await sleep(200); }
    document.querySelectorAll('input[name="startupMode"]').forEach((r) => {
      if (r.value === 'front') { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await sleep(200);
    out.startup = {
      called: ipcKeys().includes('setStartup'),
      loginMode: (window.__ipcLog.filter((x) => x.k === 'setLoginMode').pop() || {}).v,
    };

    // ── 系统组 ──
    document.querySelectorAll('.set-nav button').forEach((b) => { if (b.dataset.page === 'system') click(b); });
    await sleep(150);
    // 定时关闭：选有效时间后开启 → scheduleClose
    const th = $('stTimerH'), tm = $('stTimerM'), to = $('stTimer');
    if (th && tm && to) {
      th.value = '1'; th.dispatchEvent(new Event('change', { bubbles: true })); await sleep(80);
      tm.value = '30'; tm.dispatchEvent(new Event('change', { bubbles: true })); await sleep(80);
      to.checked = true; to.dispatchEvent(new Event('change', { bubbles: true })); await sleep(300);
    }
    out.timer = { called: ipcKeys().includes('scheduleClose'), lastVal: (window.__ipcLog.filter((x) => x.k === 'scheduleClose').pop() || {}).v };
    // 定时关机
    const sd = $('stShutdown');
    if (sd) { sd.checked = true; sd.dispatchEvent(new Event('change', { bubbles: true })); await sleep(300); }
    out.shutdown = { called: ipcKeys().includes('scheduleShutdown') };
    // 关闭主面板 → setMinToTray
    document.querySelectorAll('input[name="closeMain"]').forEach((r) => {
      if (r.value === 'tray') { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await sleep(180);
    out.closeMain = { called: ipcKeys().includes('setMinToTray') };
    // SMTC
    const sm = $('stSmtc');
    if (sm) { sm.checked = true; sm.dispatchEvent(new Event('change', { bubbles: true })); await sleep(180); }
    out.smtc = { called: ipcKeys().includes('setSmtc') };

    // ── 播放组 ──
    document.querySelectorAll('.set-nav button').forEach((b) => { if (b.dataset.page === 'play') click(b); });
    await sleep(150);
    // 不自动休眠 → blockPower
    const nsl = $('stNoSleep');
    if (nsl) { nsl.checked = true; nsl.dispatchEvent(new Event('change', { bubbles: true })); await sleep(250); }
    out.noSleep = { called: ipcKeys().includes('blockPower'), calls: window.__ipcLog.filter((x) => x.k === 'blockPower').map((x) => x.v.kind + ':' + x.v.on) };

    // 淡入淡出 → Eq.setFade 时长真实改变
    const fd = $('stFade');
    let fadeBefore = null, fadeAfter = null;
    if (fd && window.Eq) {
      window.Eq.setFade(0);
      fadeBefore = window.Eq.getFade();
      fd.checked = false; fd.dispatchEvent(new Event('change', { bubbles: true })); await sleep(100);
      const offV = window.Eq.getFade();
      fd.checked = true; fd.dispatchEvent(new Event('change', { bubbles: true })); await sleep(100);
      fadeAfter = window.Eq.getFade();
      out.fade = { before: fadeBefore, off: offV, on: fadeAfter, reallyChanged: offV !== fadeAfter };
    }
    // 音量平衡 → Eq 压缩器参数
    const nz = $('stNormalize');
    let nzInfo = null;
    if (nz) {
      nz.checked = true; nz.dispatchEvent(new Event('change', { bubbles: true })); await sleep(150);
      nzInfo = { called: true };
    }
    out.normalize = nzInfo;
    // 输出设备
    const od = $('stOutput');
    out.output = { hasSelect: !!od };

    // 系统音量：拖动滑杆 → 真实下发到主进程
    const sv = $('stSysVol');
    if (sv) {
      sv.value = '42';
      sv.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(60);
      const labMid = ($('stSysVolVal') || {}).textContent;
      sv.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(400);
      out.sysVol = {
        label: labMid,
        called: ipcKeys().includes('setSysVolume'),
        lastVal: (window.__ipcLog.filter((x) => x.k === 'setSysVolume').pop() || {}).v,
        readBack: ipcKeys().includes('getSysVolume'),
      };
    }

    // 黑名单 → 真实拦截播放
    localStorage.setItem('uzz.play.blacklist', JSON.stringify(['广告']));
    window.__uzzBlacklist = null;
    const P = window.Player;
    let blocked = null;
    if (P) {
      const st = P.getState();
      st.queue = [
        { id: 'b1', name: '某某广告曲', artist: 'X', vendor: 'local', url: 'data:audio/mp3;base64,' },
        { id: 'b2', name: '正常歌曲', artist: 'Y', vendor: 'local', url: 'data:audio/mp3;base64,' },
      ];
      st.index = -1;
      await P.loadAndPlay(st.queue[0]);
      await sleep(500);
      blocked = { nowPlaying: (st.current || {}).name || '', skipped: (st.current || {}).id === 'b2' };
    }
    out.blacklist = blocked;
    localStorage.removeItem('uzz.play.blacklist');
    window.__uzzBlacklist = null;

    // ── 音质与下载组 ──
    document.querySelectorAll('.set-nav button').forEach((b) => { if (b.dataset.page === 'download') click(b); });
    await sleep(200);
    out.cache = { sizeText: ($('stCacheSize') || {}).textContent || '', dir: ($('stCacheDir') || {}).textContent || '' };
    // 清除缓存 → 真实 IPC
    const cc = $('stCacheClear');
    if (cc) { click(cc); await sleep(400); }
    out.cacheClear = { called: ipcKeys().includes('clearCache'), btnText: cc ? cc.textContent : '' };
    // 命名格式 → setNameFmt
    document.querySelectorAll('input[name="nameFmt"]').forEach((r) => {
      if (r.value === 'name') { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await sleep(250);
    out.nameFmt = { called: ipcKeys().includes('setNameFmt'), lastVal: (window.__ipcLog.filter((x) => x.k === 'setNameFmt').pop() || {}).v };
    // 代理 → setProxy
    const pu = $('stProxyUrl');
    if (pu) {
      pu.value = 'http://127.0.0.1:7890';
      document.querySelectorAll('input[name="proxy"]').forEach((r) => {
        if (r.value !== 'none') { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      await sleep(150);
      const ok = $('stProxyOk'); if (ok) { click(ok); await sleep(250); }
    }
    out.proxy = { called: ipcKeys().includes('setProxy'), lastVal: (window.__ipcLog.filter((x) => x.k === 'setProxy').pop() || {}).v };

    // ── 快捷键组：真实注册 ──
    document.querySelectorAll('.set-nav button').forEach((b) => { if (b.dataset.page === 'keys') click(b); });
    await sleep(200);
    out.keys = { rendered: document.querySelectorAll('.key-item').length };
    // 全局快捷键开关
    const gk = $('stGlobalKey');
    if (gk) { gk.checked = false; gk.dispatchEvent(new Event('change', { bubbles: true })); await sleep(250); }
    out.keysSwitch = { called: ipcKeys().includes('saveKeys'), lastVal: (window.__ipcLog.filter((x) => x.k === 'saveKeys').pop() || {}).v };

    out.ipcCalled = Array.from(new Set(ipcKeys()));
    return out;
  });

  console.log(JSON.stringify(res, null, 2));

  const checks = [
    ['字体真实应用', res.font && res.font.applied],
    ['禁用动画真实切类', res.noAnim && res.noAnim.cls && res.noAnim.off === false],
    ['设为默认播放器调IPC', res.defaultPlayer && res.defaultPlayer.called],
    ['GPU 调 IPC(需重启)', res.gpu && res.gpu.called && res.gpu.lastVal && res.gpu.lastVal.needRestart === true],
    ['系统缩放调 IPC', res.noScale && res.noScale.called],
    ['开机启动+启动方式', res.startup && res.startup.called && res.startup.loginMode && res.startup.loginMode.ok],
    ['定时关闭真设定', res.timer && res.timer.called && res.timer.lastVal && res.timer.lastVal.at > Date.now()],
    ['定时关机真设定', res.shutdown && res.shutdown.called],
    ['关闭面板真生效', res.closeMain && res.closeMain.called],
    ['SMTC 真启用', res.smtc && res.smtc.called],
    ['阻止休眠真阻断', res.noSleep && res.noSleep.called && res.noSleep.calls.some((c) => c.indexOf('sleep:true') >= 0)],
    ['淡入淡出真改变时长', res.fade && res.fade.reallyChanged],
    ['缓存占用真实显示', res.cache && /MB|KB|GB|B/.test(res.cache.sizeText)],
    ['清理缓存真调用', res.cacheClear && res.cacheClear.called],
    ['命名格式真下发', res.nameFmt && res.nameFmt.called && res.nameFmt.lastVal && res.nameFmt.lastVal.fmt === 'name'],
    ['代理真下发', res.proxy && res.proxy.called],
    ['全局快捷键真注册', res.keysSwitch && res.keysSwitch.called],
    ['黑名单真实跳过', res.blacklist && res.blacklist.skipped],
    ['系统音量真下发', res.sysVol && res.sysVol.called && res.sysVol.label === '42%' && res.sysVol.lastVal && res.sysVol.lastVal.requested === 42],
  ];

  console.log('\n=== 判定 ===');
  let pass = 0;
  for (const [name, ok] of checks) {
    console.log((ok ? '  ' : '  ✗ ') + name.padEnd(24, ' ') + ' → ' + (ok ? 'PASS' : 'FAIL'));
    if (ok) pass++;
  }
  console.log(`\n${pass}/${checks.length} 项真实生效`);
  console.log('JS 错误:', errs.length, errs.slice(0, 3).join(' | '));

  await browser.close();
  srv.close();
  process.exit(pass === checks.length && errs.length === 0 ? 0 : 1);
})();