/**
 * 设置页专项测试：验证 7 个分组、导航点击/滚轮、各项控件绑定与持久化
 * 用法：node tools/settings-test.js
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const ROOT = path.join(__dirname, '..', 'app');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const PORT = 39241;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': (MIME[path.extname(fp)] || 'text/plain') + '; charset=utf-8' });
  fs.createReadStream(fp).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const { chromium } = require(path.join(__dirname, '..', 'electron', 'node_modules', 'playwright'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.stack||e.message)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push('C:' + m.text()); });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const out = await page.evaluate(async () => {
    const r = {};
    const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
    // 进入设置视图
    document.querySelectorAll('main.view').forEach((m) => m.classList.add('hidden'));
    const sv = document.getElementById('viewSettings');
    sv.classList.remove('hidden');
    await sleep(200);

    // 1) 7 个分组是否齐全
    const tabs = Array.from(document.querySelectorAll('#setTabs button')).map((b) => b.dataset.tab);
    r.tabs = tabs;
    r.tabCount = tabs.length;
    r.pageCount = document.querySelectorAll('.set-page').length;

    // 2) 点击切换
    document.querySelector('#setTabs button[data-tab="system"]').click();
    await sleep(150);
    r.afterClickSystem = {
      activeTab: document.querySelector('#setTabs button.active').dataset.tab,
      systemVisible: !document.querySelector('.set-page[data-page="system"]').classList.contains('hidden'),
      generalHidden: document.querySelector('.set-page[data-page="general"]').classList.contains('hidden'),
    };

    // 3) 滚轮切换
    const nav = document.getElementById('setTabs');
    nav.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
    await sleep(320);
    r.afterWheelDown = document.querySelector('#setTabs button.active').dataset.tab;
    nav.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
    await sleep(320);
    r.afterWheelUp = document.querySelector('#setTabs button.active').dataset.tab;

    // 4) 控件是否都有绑定（改一个复选框看是否写进 localStorage）
    document.querySelector('#setTabs button[data-tab="general"]').click();
    await sleep(150);
    const gpu = document.getElementById('stGpu');
    const before = gpu.checked;
    gpu.checked = !before;
    gpu.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(120);
    r.checkPersist = { stored: localStorage.getItem('uzz.gpu'), expected: !before ? '1' : '0' };

    // 5) 单选组持久化
    const sm = document.querySelector('input[name="closeMain"][value="exit"]');
    sm.checked = true;
    sm.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(120);
    r.radioPersist = localStorage.getItem('uzz.sys.closeMain');

    // 6) 滑杆
    const rv = document.getElementById('stSysVol');
    rv.value = 45;
    rv.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);
    r.rangePersist = { stored: localStorage.getItem('uzz.play.sysVol'), shown: document.getElementById('stSysVolVal').textContent };

    // 7) 快捷键表是否渲染
    document.querySelector('#setTabs button[data-tab="keys"]').click();
    await sleep(180);
    r.keyItems = document.querySelectorAll('.key-item').length;
    r.keyInputs = document.querySelectorAll('.key-input').length;

    // 8) 字体下拉
    document.querySelector('#setTabs button[data-tab="desktop"]').click();
    await sleep(150);
    const lf = document.getElementById('stLyricFont');
    r.fontOptions = lf ? lf.options.length : 0;

    // 9) 歌词预览
    const lc = document.getElementById('stLyricColor');
    lc.value = 'pink';
    lc.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(150);
    const pv = document.getElementById('stLyricPrev');
    r.preview = { solid: pv.classList.contains('solid'), color: getComputedStyle(pv).color };

    // 10) 关于页
    document.querySelector('#setTabs button[data-tab="about"]').click();
    await sleep(150);
    r.about = { hasCheck: !!document.getElementById('abCheck'), ver: (document.getElementById('abVer') || {}).textContent };

    // 11) 每个分组的控件数量
    r.controlsPerTab = {};
    tabs.forEach((t) => {
      document.querySelector('#setTabs button[data-tab="' + t + '"]').click();
      const p = document.querySelector('.set-page[data-page="' + t + '"]');
      r.controlsPerTab[t] = p ? p.querySelectorAll('input,select,button').length : 0;
    });

    return r;
  });

  console.log(JSON.stringify(out, null, 2));
  console.log('\n=== 判定 ===');
  const c = (v, msg) => console.log('  ' + msg.padEnd(24) + '→', v ? 'PASS' : 'FAIL');
  c(out.tabCount === 7, '7 个分组导航');
  c(out.pageCount === 7, '7 个分组内容页');
  c(out.afterClickSystem.systemVisible && out.afterClickSystem.generalHidden, '点击切换');
  c(out.afterWheelDown !== out.afterWheelUp, '滚轮切换');
  c(out.checkPersist.stored === out.checkPersist.expected, '复选框持久化');
  c(out.radioPersist === 'exit', '单选组持久化');
  c(out.rangePersist.stored === '45' && /45/.test(out.rangePersist.shown), '滑杆持久化+回显');
  c(out.keyItems >= 9 && out.keyInputs >= 18, '快捷键表渲染');
  c(out.fontOptions >= 10, '字体下拉填充');
  c(out.preview.solid, '歌词预览跟随配色');
  c(out.about.hasCheck, '关于页检查更新');
  const totalCtl = Object.values(out.controlsPerTab).reduce((a, b) => a + b, 0);
  c(totalCtl >= 60, '控件总数≥60 (实际' + totalCtl + ')');
  console.log('\n各分组控件数:', JSON.stringify(out.controlsPerTab));
  console.log('\n=== JS 错误 ===', errs.length);
  errs.slice(0, 8).forEach((e) => console.log('  ', e));
  await browser.close();
  server.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
