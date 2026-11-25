// 临时验证：推荐页重构后的真实交互（mock 后端 API）
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require(path.join(ROOT, 'electron', 'node_modules', 'playwright'));
const BASE = 'http://xy-test.local';

const TRACKS = Array.from({ length: 20 }, (_, i) => ({
  id: 't' + i, name: '测试歌曲 ' + i, artist: '歌手 ' + (i % 4),
  album: '专辑', pic: '', vendor: 'netease', duration: 200,
}));
const CHARTS = Array.from({ length: 12 }, (_, i) => ({
  id: 'chart' + i, name: '测试榜 ' + i, desc: '实时榜单', icon: '📊',
}));
const PLAYLISTS = Array.from({ length: 40 }, (_, i) => ({
  id: 'pl' + i, name: '测试歌单 ' + i, cover: '', playCount: 10000 + i,
}));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript((base) => {
    localStorage.setItem('uzz.apiBase', base);
    localStorage.setItem('uzz.fav', JSON.stringify([
      { id: 'f1', name: '红心歌曲A', artist: '歌手A', vendor: 'netease', pic: '', duration: 100 },
      { id: 'f2', name: '红心歌曲B', artist: '歌手B', vendor: 'netease', pic: '', duration: 100 },
      { id: 'f3', name: '红心歌曲C', artist: '歌手C', vendor: 'netease', pic: '', duration: 100 },
    ]));
  }, BASE);
  await page.route(BASE + '/api/**', async (route) => {
    const u = new URL(route.request().url());
    let body = { code: 200 };
    if (u.pathname === '/api/charts') body.charts = CHARTS;
    else if (u.pathname === '/api/playlists') body.list = PLAYLISTS;
    else if (u.pathname === '/api/playlist') { body.info = { name: '测试列表', desc: '描述', playCount: 999 }; body.tracks = TRACKS; }
    else if (u.pathname === '/api/simi') body.tracks = TRACKS.slice(5, 15);
    else if (u.pathname === '/api/search') body = { code: 200, list: TRACKS, total: 20 };
    else if (u.pathname === '/api/ping') body = { code: 200 };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file:///' + ROOT.replace(/\\/g, '/') + '/app/index.html');
  await page.waitForTimeout(3000);

  const stats = await page.evaluate(() => ({
    quick: document.querySelectorAll('#quickRow .quick-card').length,
    charts: document.querySelectorAll('#chartsRow .chart-card').length,
    chartSongs: document.querySelectorAll('#chartsRow .rcc-song').length,
    playlists: document.querySelectorAll('#plGrid .pl-card').length,
    heartSongs: document.querySelectorAll('#heartList li.song').length,
    foryouSongs: document.querySelectorAll('#foryouList li.song').length,
    refreshBtns: document.querySelectorAll('.rec-refresh').length,
    playalls: document.querySelectorAll('.rec-playall').length,
  }));
  console.log('STATS:', stats);
  await page.screenshot({ path: path.join(__dirname, 'rec-full.png'), fullPage: true });

  // 刷新榜单：种子改变，卡片顺序应变化
  const before = await page.evaluate(() => [...document.querySelectorAll('#chartsRow .ch-name')].map(e => e.textContent).join(','));
  await page.evaluate(() => document.querySelector('[data-refresh="charts"]').click());
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => [...document.querySelectorAll('#chartsRow .ch-name')].map(e => e.textContent).join(','));
  console.log('REFRESH changed order:', before !== after);

  // 点「私人漫游」→ 打开榜单歌单视图
  await page.evaluate(() => document.querySelector('[data-qk="roam"]').click());
  await page.waitForTimeout(800);
  const roam = await page.evaluate(() => ({
    playlistView: !document.getElementById('viewPlaylist').classList.contains('hidden'),
    rows: document.querySelectorAll('#plpTracks li.song').length,
  }));
  console.log('ROAM:', roam);

  // 点心动模式 → 红心歌曲进入播放队列
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('uzz:view', { detail: 'discover' }));
    document.getElementById('viewDiscover').classList.remove('hidden');
    document.querySelector('[data-qk="heart"]').click();
  });
  await page.waitForTimeout(500);
  const heartQueue = await page.evaluate(() => window.Player.getQueue().map(t => t.id));
  console.log('HEART MODE queued favorites:', ['f1', 'f2', 'f3'].every(id => heartQueue.includes(id)));

  // 点红心模块播放按钮 → 播放队列
  await page.evaluate(() => document.querySelector('[data-playall="heart"]').click());
  await page.waitForTimeout(500);

  console.log('PAGE ERRORS:', errors);
  // 回到推荐页并滚到底部，检查下半部分模块
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('uzz:view', { detail: 'discover' }));
    const v = document.getElementById('viewDiscover');
    v.classList.remove('hidden'); document.getElementById('viewPlaylist').classList.add('hidden');
    v.scrollTop = v.scrollHeight;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(__dirname, 'rec-bottom.png') });
  await browser.close();
  console.log('DONE');
})();
