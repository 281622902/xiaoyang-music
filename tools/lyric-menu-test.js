/**
 * 歌词窗设置菜单测试：验证打开/关闭菜单时窗口尺寸与歌词位置完全不变（不跳动）
 */
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'electron', 'node_modules', 'playwright'));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 880, height: 340 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  // 浏览器里没有 require/electron，先注入 shim 再加载页面
  await page.addInitScript(() => {
    window.require = (m) => (m === 'electron' ? { ipcRenderer: { send(){}, on(){} } } : {});
  });
  await page.goto('file:///' + path.join(__dirname, '..', 'electron', 'lyric.html').replace(/\\/g, '/'));
  await page.waitForTimeout(500);

  const snap = () => page.evaluate(() => {
    const box = document.getElementById('lyricBox');
    const menu = document.getElementById('menu');
    const bar = document.getElementById('bar');
    const bb = box.getBoundingClientRect();
    return {
      winH: window.innerHeight,
      bodyH: document.body.getBoundingClientRect().height,
      lyricTop: Math.round(bb.top),
      lyricH: Math.round(bb.height),
      lyricText: (document.getElementById('cur').textContent || '').slice(0, 10),
      menuOpen: menu.classList.contains('open'),
      menuH: Math.round(menu.getBoundingClientRect().height),
      menuTop: Math.round(menu.getBoundingClientRect().top),
      barTop: Math.round(bar.getBoundingClientRect().top),
      items: menu.querySelectorAll('.mi').length,
      // 菜单是否完全在窗口内（不被裁）
      menuWithin: menu.getBoundingClientRect().bottom <= window.innerHeight + 1,
    };
  });

  // 填入歌词
  await page.evaluate(() => {
    document.getElementById('cur').textContent = '这是一句测试歌词';
    document.getElementById('sub').textContent = 'This is a test line';
  });

  const s1 = await snap();

  // 打开菜单
  await page.evaluate(() => document.getElementById('bSet').dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true })));
  await page.waitForTimeout(250);
  const s2 = await snap();

  // 切换到二级子菜单
  await page.evaluate(() => {
    const sub = document.querySelector('#menu .mi[data-t="sub"]');
    if (sub) sub.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(200);
  const s3 = await snap();

  // 关闭菜单
  await page.evaluate(() => {
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(250);
  const s4 = await snap();

  console.log('=== 各状态快照 ===');
  [['关闭', s1], ['菜单展开', s2], ['二级子菜单', s3], ['再次关闭', s4]].forEach(([k, v]) => {
    console.log(k + ':', JSON.stringify(v));
  });

  console.log('\n=== 判定（关键：不跳动） ===');
  const same = (a, b) => a === b;
  console.log('  歌词位置不变   →', same(s1.lyricTop, s2.lyricTop) && same(s2.lyricTop, s3.lyricTop) && same(s3.lyricTop, s4.lyricTop) ? 'PASS' : 'FAIL');
  console.log('  歌词高度不变   →', same(s1.lyricH, s4.lyricH) ? 'PASS' : 'FAIL');
  console.log('  歌词文字未丢   →', s4.lyricText.length > 0 ? 'PASS' : 'FAIL');
  console.log('  菜单正常展开   →', s2.menuOpen && s2.items >= 7 ? 'PASS' : 'FAIL (' + s2.items + '项)');
  console.log('  菜单未被裁切   →', s2.menuWithin ? 'PASS' : 'FAIL');
  console.log('  子菜单可用     →', s3.menuOpen && s3.items > 0 ? 'PASS' : 'FAIL');
  console.log('  工具条位置不变 →', same(s1.barTop, s2.barTop) && same(s2.barTop, s4.barTop) ? 'PASS' : 'FAIL');

  console.log('\n=== JS 错误 ===', errs.length);
  errs.slice(0, 5).forEach((e) => console.log('  ', e));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
