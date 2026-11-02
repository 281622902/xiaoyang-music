/**
 * 歌词设置功能验证：逐项点击菜单，检查界面是否真的变化
 * 用法：node tools/lyric-cfg-test.js
 */
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'electron', 'node_modules', 'playwright'));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 700, height: 340 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => {
    const sent = [];
    window.__sent = sent;
    window.require = (m) => (m === 'electron' ? { ipcRenderer: { send: (c, v) => sent.push([c, v]), on() {} } } : {});
  });
  await page.goto('file:///' + path.join(__dirname, '..', 'electron', 'lyric.html').replace(/\\/g, '/'));
  await page.waitForTimeout(500);

  // 填入歌词
  await page.evaluate(() => {
    document.getElementById('cur').textContent = '测试当前歌词';
    document.getElementById('sub').textContent = 'Test lyric line';
  });

  const openMenu = () => page.evaluate(() => document.getElementById('bSet')
    .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  const clickItem = (sel) => page.evaluate((s) => {
    const el = document.querySelector('#menu ' + s);
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  }, sel);

  const state = () => page.evaluate(() => ({
    single: document.body.classList.contains('single'),
    hideSub: document.body.classList.contains('hide-sub'),
    vertical: document.body.classList.contains('vertical'),
    writingMode: document.getElementById('lyricBox').style.writingMode,
    align: document.getElementById('lyricBox').style.textAlign,
    color: getComputedStyle(document.getElementById('cur')).color,
    solid: document.getElementById('cur').classList.contains('solid'),
    cfg: JSON.parse(localStorage.getItem('uzz.dl.cfg') || '{}'),
    subVisible: getComputedStyle(document.getElementById('sub')).display !== 'none',
    hitRects: window.__sent.filter((x) => x[0] === 'lyric:hitTest').length,
    cfgSent: window.__sent.filter((x) => x[0] === 'lyric:cfg').length,
  }));

  const results = {};

  // 1. 双行模式
  await openMenu(); await page.waitForTimeout(120);
  await clickItem('.mi[data-k="doubleMode"]');
  await page.waitForTimeout(200);
  results.doubleMode = await state();

  // 2. 竖排歌词
  await openMenu(); await page.waitForTimeout(120);
  await clickItem('.mi[data-k="vertical"]');
  await page.waitForTimeout(200);
  results.vertical = await state();

  // 3. 外文歌词显示 → 不显示
  await openMenu(); await page.waitForTimeout(120);
  await clickItem('.mi[data-k="showTrans"]');
  await page.waitForTimeout(120);
  await clickItem('.mi[data-t="pick"][data-v="不显示"]');
  await page.waitForTimeout(200);
  results.transHide = await state();

  // 4. 对齐方式 → 右对齐
  await openMenu(); await page.waitForTimeout(120);
  await clickItem('.mi[data-k="align"]');
  await page.waitForTimeout(120);
  await clickItem('.mi[data-t="pick"][data-v="右对齐"]');
  await page.waitForTimeout(200);
  results.alignRight = await state();

  // 5. 配色 → 纯色粉
  await openMenu(); await page.waitForTimeout(120);
  await clickItem('.mi[data-k="dark"]');
  await page.waitForTimeout(120);
  await clickItem('.mi[data-t="pick"][data-v="纯色·粉"]');
  await page.waitForTimeout(200);
  results.colorPink = await state();

  // 6. 总在最前
  await openMenu(); await page.waitForTimeout(120);
  await clickItem('.mi[data-k="alwaysTop"]');
  await page.waitForTimeout(200);
  results.alwaysTop = await state();

  console.log(JSON.stringify(results, null, 2));
  console.log('\n=== 判定 ===');
  const c = (v, msg) => console.log('  ' + msg.padEnd(20) + '→', v ? 'PASS' : 'FAIL');
  c(results.doubleMode.single, '双行模式生效');
  c(results.vertical.vertical && results.vertical.writingMode === 'vertical-rl', '竖排歌词生效');
  c(results.transHide.hideSub && !results.transHide.subVisible, '翻译「不显示」生效');
  c(results.alignRight.align === 'right', '对齐方式生效');
  c(results.colorPink.solid && /255,\s*143,\s*199/.test(results.colorPink.color), '配色生效');
  c(results.alwaysTop.cfgSent > 0, '总在最前已下发');
  c(results.vertical.hitRects > 0, '命中矩形已上报');
  console.log('\n=== JS 错误 ===', errs.length);
  errs.slice(0, 5).forEach((e) => console.log('  ', e));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
