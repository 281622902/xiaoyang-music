// 验证：推荐页按图2顺序排列 + 所有条目都带封面图（mock 后端）
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require(path.join(ROOT, 'electron', 'node_modules', 'playwright'));
const BASE = 'http://xy-test.local';

const mkPic = (seed) => `https://img.test/${seed}.jpg`;
const TRACKS = Array.from({ length: 30 }, (_, i) => ({
  id: 't' + i, name: '歌曲' + i, artist: '歌手' + (i % 5),
  album: '专辑', pic: mkPic('t' + i), vendor: 'netease', duration: 200,
}));
const CHARTS = Array.from({ length: 12 }, (_, i) => ({
  id: 'chart' + i, name: '榜单' + i, desc: '实时榜单', icon: '📊', cover: mkPic('c' + i),
}));
const PLAYLISTS = Array.from({ length: 60 }, (_, i) => ({
  id: 'pl' + i, name: '歌单' + i, cover: mkPic('p' + i), playCount: 10000 + i,
}));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(({ base, fav }) => {
    localStorage.setItem('uzz.apiBase', base);
    localStorage.setItem('uzz.home.cfg', JSON.stringify({ ver: 2 }));
    localStorage.setItem('uzz.fav', JSON.stringify(fav));
  }, { base: BASE, fav: [{ id: 'f1', name: '红心A', artist: '歌手A', vendor: 'netease', pic: 'https://img.test/f1.jpg', duration: 100 }] });
  await page.route(BASE + '/api/**', async (route) => {
    const u = new URL(route.request().url());
    let body = { code: 200 };
    if (u.pathname === '/api/charts') body.charts = CHARTS;
    else if (u.pathname === '/api/playlists') body.list = PLAYLISTS;
    else if (u.pathname === '/api/playlist') { body.info = { name: '列表', desc: '描述', playCount: 999 }; body.tracks = TRACKS; }
    else if (u.pathname === '/api/simi') body.tracks = TRACKS.slice(5, 20);
    else if (u.pathname === '/api/search') body = { code: 200, list: TRACKS, total: 30 };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file:///' + ROOT.replace(/\\/g, '/') + '/app/index.html');
  await page.waitForTimeout(4000);

  // 1) 模块顺序
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('#viewDiscover [data-module]')].map(e => e.dataset.module));
  const expected = ['hero', 'banners', 'charts', 'heart', 'playlists', 'vip', 'foryou', 'goodmusic', 'podcast', 'audiobook'];
  const orderOk = expected.every((id) => order.indexOf(id) >= 0) &&
    expected.every((id, i) => i === 0 || order.indexOf(id) > order.indexOf(expected[i - 1]));
  console.log('ORDER:', order.join(' > '));
  console.log('ORDER OK:', orderOk);

  // 2) 每个条目都有 img（封面）
  const coverStats = await page.evaluate(() => {
    const check = (itemSel, imgSel, label) => {
      const items = [...document.querySelectorAll(itemSel)];
      const withImg = items.filter((el) => el.querySelector(imgSel)).length;
      return { label, total: items.length, withImg };
    };
    return [
      check('#chartsRow .rec-chart-card .rcc-cover', 'img.rcc-cover-img', '榜单大封面'),
      check('#heartList li.song', 'img.cov', '红心歌曲封面'),
      check('#plGrid .pl-card', 'img.plc-img', '歌单封面'),
      check('#vipList li.song', 'img.cov', 'VIP歌曲封面'),
      check('#foryouList li.song', 'img.cov', '猜你喜欢封面'),
      check('#goodMusicGrid .mix-card', 'img.mix-img', '好音乐封面'),
      check('#homePodcastGrid .mix-card', 'img.mix-img', '播客封面'),
      check('#homeAudioGrid .mix-card', 'img.mix-img', '有声书封面'),
    ];
  });
  coverStats.forEach((s) => console.log(`COVER ${s.label}: ${s.withImg}/${s.total}`, s.total > 0 && s.withImg === s.total ? 'OK' : 'FAIL'));

  // 2b) 榜单卡片结构：前三首纯文字（无小缩略图）+ 卡片高度一致
  const chartStruct = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#chartsRow .rec-chart-card')];
    const heights = cards.map((c) => Math.round(c.getBoundingClientRect().height));
    const miniCovers = document.querySelectorAll('#chartsRow .rcc-song img').length;
    const songsPerCard = cards.map((c) => c.querySelectorAll('.rcc-song:not(.muted)').length);
    return { heights: [...new Set(heights)], heightsList: heights, miniCovers, songsPerCard };
  });
  const heightsOk = chartStruct.heights.length <= 1;
  console.log('CHART heights:', chartStruct.heightsList.join(','), heightsOk ? 'OK(统一)' : 'FAIL(参差)');
  console.log('CHART songs per card:', chartStruct.songsPerCard.join(','), chartStruct.songsPerCard.every((n) => n === 3) ? 'OK' : 'FAIL');
  console.log('CHART mini covers (should be 0):', chartStruct.miniCovers, chartStruct.miniCovers === 0 ? 'OK(纯文字)' : 'FAIL');

  // 3) 快捷入口背景图确实设置了
  const quickBg = await page.evaluate(() =>
    [...document.querySelectorAll('#quickRow .qc-bg')].filter((e) => e.style.backgroundImage).length);
  console.log('QUICK BG set:', quickBg + '/5');

  // 4) 数量统计
  const counts = await page.evaluate(() => ({
    charts: document.querySelectorAll('#chartsRow .chart-card').length,
    chartSongs: document.querySelectorAll('#chartsRow .rcc-song:not(.muted)').length,
    playlists: document.querySelectorAll('#plGrid .pl-card').length,
    heart: document.querySelectorAll('#heartList li.song').length,
    vip: document.querySelectorAll('#vipList li.song').length,
    foryou: document.querySelectorAll('#foryouList li.song').length,
    goodmusic: document.querySelectorAll('#goodMusicGrid .mix-card').length,
    podcast: document.querySelectorAll('#homePodcastGrid .mix-card').length,
    audiobook: document.querySelectorAll('#homeAudioGrid .mix-card').length,
  }));
  console.log('COUNTS:', JSON.stringify(counts));

  await page.screenshot({ path: path.join(__dirname, 'rec-order-full.png'), fullPage: true });

  // 5) 交互：VIP 播放全部
  await page.evaluate(() => document.querySelector('[data-playall="vip"]').click());
  await page.waitForTimeout(400);
  const vipQueue = await page.evaluate(() => window.Player.getQueue().length);
  console.log('VIP playall queue:', vipQueue);

  // 6) 刷新 VIP 换序
  const before = await page.evaluate(() => [...document.querySelectorAll('#vipList li.song .name')].map(e => e.textContent).join(','));
  await page.evaluate(() => document.querySelector('[data-refresh="vip"]').click());
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => [...document.querySelectorAll('#vipList li.song .name')].map(e => e.textContent).join(','));
  console.log('VIP refresh changed:', before !== after);

  console.log('PAGE ERRORS:', errors);
  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
