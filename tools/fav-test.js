/**
 * 红心（收藏）专项验证：变红 / 入库 / 列表即时刷新 / 取消
 * 用法：node tools/fav-test.js
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const ROOT = path.join(__dirname, '..', 'app');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const PORT = 39237;
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
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const out = await page.evaluate(async () => {
    const P = window.Player, st = P.getState();
    const r = {};
    const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
    const btn = document.getElementById('fpFav');
    const fl = document.getElementById('favList');

    // 停在「我喜欢的音乐」
    document.querySelectorAll('main.view').forEach((m) => m.classList.add('hidden'));
    document.getElementById('viewFav').classList.remove('hidden');
    await sleep(150);

    const t = { id: 'favX', name: '收藏测试歌', artist: '歌手X', album: '专辑X', vendor: 'local', url: 'data:audio/mp3;base64,' };
    st.queue = [t]; st.index = 0; st.current = t;
    await sleep(100);

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    await sleep(400);

    r.favCount = P.getFavorites().length;
    r.favName = P.getFavorites()[0] ? P.getFavorites()[0].name : null;
    r.cls = btn.className;
    r.color = getComputedStyle(btn).color;
    r.fill = getComputedStyle(btn.querySelector('svg path')).fill;
    r.toast = (document.getElementById('toast') || {}).textContent;
    r.ls = localStorage.getItem('uzz.fav');
    r.listHasSong = fl.innerHTML.indexOf('收藏测试歌') >= 0;
    r.countText = (document.getElementById('favCount') || {}).textContent;

    // 再点一次 = 取消收藏
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    await sleep(300);
    r.afterSecond = P.getFavorites().length;
    r.clsSecond = btn.className;
    r.listAfterSecond = fl.innerHTML.indexOf('收藏测试歌') >= 0;

    return r;
  });

  console.log(JSON.stringify(out, null, 2));
  console.log('\n判定：');
  console.log('  红心变红     →', out.color === 'rgb(236, 65, 65)' && out.fill === 'rgb(236, 65, 65)' ? 'PASS' : 'FAIL');
  console.log('  收藏入库     →', out.favCount === 1 && out.favName === '收藏测试歌' ? 'PASS' : 'FAIL');
  console.log('  列表即时刷新 →', out.listHasSong ? 'PASS' : 'FAIL');
  console.log('  再次点击取消 →', out.afterSecond === 0 && !out.listAfterSecond ? 'PASS' : 'FAIL');
  console.log('\n=== JS 错误 ===', errs.length);
  errs.slice(0, 5).forEach((e) => console.log('  ', e));
  await browser.close();
  server.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
