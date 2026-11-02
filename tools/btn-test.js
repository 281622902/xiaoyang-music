/**
 * 全量按钮点击测试：把每个视图 + 侧栏 + 底栏 + mini 都走一遍，
 * 对每个可见按钮派发真实 click，并监听 pageerror / console.error
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const ROOT = path.join(__dirname, '..', 'app');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const PORT = 39227;
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
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);


  // 注入测试数据，让动态列表渲染出来（覆盖行内按钮）
  await page.evaluate(() => {
    const P = window.Player;
    const mk = (id, n) => ({ id, name: n, artist: '歌手' + n, album: '专辑' + n, vendor: 'local', duration: 200, url: 'data:audio/mp3;base64,' });
    const st = P.getState();
    st.queue = [mk('d1', '甲'), mk('d2', '乙'), mk('d3', '丙')];
    st.index = 0; st.current = st.queue[0];
    // 塞进收藏与历史
    localStorage.setItem('uzz.fav', JSON.stringify([mk('f1', '收藏一'), mk('f2', '收藏二')]));
    localStorage.setItem('uzz.history', JSON.stringify([
      { id: 'h1', name: '历史一', artist: '歌手H', album: '专辑H', vendor: 'local', at: Date.now() },
      { id: 'h2', name: '历史二', artist: '歌手H', album: '专辑H', vendor: 'local', at: Date.now() - 3600e3 },
    ]));
    // 本地歌单
    localStorage.setItem('uzz.playlists', JSON.stringify([{ id: 'p1', name: '我的歌单', kind: 'created', tracks: [mk('t1', '歌单曲')] }]));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);

  // 侧栏「我的」先展开，暴露隐藏项
  await page.evaluate(() => {
    const more = document.getElementById('sideMore');
    if (more) more.click();
  });
  await page.waitForTimeout(200);

  const views = ['discover', 'search', 'playlist', 'fav', 'history', 'downloads', 'local',
    'charts', 'podcast', 'roam', 'follow', 'collect', 'settings'];

  const visited = new Set();
  const errButtons = [];
  let total = 0;

  for (const v of views) {
    await page.evaluate((vv) => {
      document.querySelectorAll('main.view').forEach((m) => m.classList.add('hidden'));
      const t = document.getElementById('view' + vv[0].toUpperCase() + vv.slice(1));
      if (t) t.classList.remove('hidden');
      // 侧栏选中态同步
      document.querySelectorAll('.side-nav button, .side-mine button').forEach((b) => b.classList.remove('on'));
    }, v);
    await page.waitForTimeout(140);
    // 设置页分页全部打开
    if (v === 'settings') {
      await page.evaluate(() => document.querySelectorAll('.set-page').forEach((p) => p.classList.remove('hidden')));
    }

    const ids = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('button').forEach((b) => {
        const r = b.getBoundingClientRect();
        if (!(r.width && r.height)) return;
        if (b.closest('.hidden')) return;
        if (b.disabled) return;
        const cls = (b.className || '').toString().trim().split(/\s+/)[0] || '';
        out.push(b.id || (cls ? '.' + cls : ''));  // 无 id 无 class 的跳过（纯文本按钮）
      });
      return out;
    });

    for (const key of ids) {
      if (!key) continue;
      if (visited.has(key)) continue;
      visited.add(key);
      total++;
      const before = errs.length;
      try {
        await page.evaluate((k) => {
          const el = k.startsWith('.') ? document.querySelector(k) : document.getElementById(k);
          if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        }, key);
      } catch (e) { errButtons.push({ v, key, why: String(e.message).slice(0, 80) }); continue; }
      await page.waitForTimeout(45);
      if (errs.length > before) {
        errButtons.push({ v, key, why: errs.slice(before).join(' | ').slice(0, 120) });
        errs.length = before;
      }
    }
  }

  console.log('=== 实际点击按钮总数 ===', total);
  console.log('=== 触发错误的按钮 ===', errButtons.length);
  errButtons.forEach((b) => console.log('  [' + b.v + ']', b.key, '→', b.why));
  console.log('');
  console.log('=== 遗留 JS 错误 ===', errs.length);
  errs.slice(0, 12).forEach((e) => console.log('  ', e));

  await browser.close();
  server.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
