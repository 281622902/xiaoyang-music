/* Mini 模式：☰ 按钮直达「歌单目录」、歌词/目录切换、点击目录切歌。 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const PORT = process.env.MINI_TEST_PORT || '31078';
const BASE = `http://127.0.0.1:${PORT}`;

async function waitServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch (e) { /* keep polling */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('mini 测试：本地服务启动超时');
}

(async () => {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root, env: { ...process.env, PORT }, stdio: 'ignore',
  });
  try {
    await waitServer();
    const { chromium } = require(path.join(root, 'electron', 'node_modules', 'playwright'));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // 浏览器里没有 electron preload，补一个最小桥接
    await page.addInitScript(() => {
      window.uzzBridge = new Proxy({ isDesktop: true }, {
        get(t, k) { return k in t ? t[k] : () => Promise.resolve(); },
      });
    });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(1500);

    // 固定队列 / 歌词状态，排除真实后端波动
    await page.evaluate(() => {
      const queue = Array.from({ length: 6 }, (_, i) => ({
        id: 'q' + i, name: '目录歌曲' + i, artist: '歌手' + i, vendor: 'netease', pic: '', duration: 200,
      }));
      const lyrics = [
        { t: 0, text: '第一句歌词' }, { t: 5, text: '第二句歌词' }, { t: 10, text: '第三句歌词' },
      ];
      window.__played = [];
      const origGetState = window.Player.getState.bind(window.Player);
      window.Player.getState = () => ({ ...origGetState(), queue, current: queue[1], lyrics, tlyrics: [] });
      window.Player.getQueue = () => queue;
      window.Player.loadAndPlay = (t) => { window.__played.push(t.id); };
    });

    // 进入 mini 模式
    await page.evaluate(() => document.getElementById('tbMini').click());
    await page.waitForSelector('#miniMode:not(.hidden)', { timeout: 5000 });
    await page.waitForTimeout(1300);

    const r = {};
    r.miniVisible = await page.locator('#miniMode').isVisible();
    r.btnTitle = await page.getAttribute('#mmListToggle', 'title');
    r.queueRows = await page.locator('#mmList li[data-i]').count();
    r.activeQueueTab = await page.locator('.mm-viewtab[data-mmview="queue"].on').count();
    r.currentHighlighted = await page.locator('#mmList li[data-i].on').first().getAttribute('data-i');
    r.count = await page.textContent('#mmQueueCount');

    // 切到「歌词」tab
    await page.click('.mm-viewtab[data-mmview="lyric"]');
    await page.waitForTimeout(1200);
    r.lyricRows = await page.locator('#mmList li[data-t]').count();
    r.lyricTabOn = await page.locator('.mm-viewtab[data-mmview="lyric"].on').count();

    // 歌词态点 ☰ → 直达歌单目录
    await page.click('#mmListToggle');
    await page.waitForTimeout(1300);
    r.backToQueue = await page.locator('#mmList li[data-i]').count();
    r.panelVisible = await page.locator('#mmLyricBox').isVisible();

    // 再点 ☰ → 收起；再点 → 展开（仍是目录）
    await page.click('#mmListToggle');
    await page.waitForTimeout(400);
    r.collapsed = await page.locator('#mmLyricBox').isHidden();
    r.collapsedTitle = await page.getAttribute('#mmListToggle', 'title');
    await page.click('#mmListToggle');
    await page.waitForTimeout(1300);
    r.reopened = await page.locator('#mmLyricBox').isVisible();
    r.reopenedRows = await page.locator('#mmList li[data-i]').count();

    // 点目录中的第 5 首 → 调用 Player.loadAndPlay
    await page.click('#mmList li[data-i="4"]');
    r.played = await page.evaluate(() => window.__played);

    fs.mkdirSync(path.join(root, 'test-artifacts'), { recursive: true });
    await page.locator('#miniMode').screenshot({ path: path.join(root, 'test-artifacts', 'mini-queue.png') });
    await browser.close();

    const failed = [];
    const check = (name, ok, expect) => { if (!ok) failed.push(`${name} 期望 ${expect}`); };
    check('mini 可见', r.miniVisible, true);
    check('按钮标题', /歌单目录/.test(r.btnTitle || ''), '含歌单目录');
    check('目录默认打开', r.queueRows, 6);
    check('目录 tab 高亮', r.activeQueueTab, 1);
    check('当前曲目高亮', r.currentHighlighted, '1');
    check('数量显示', /6 首/.test(r.count || ''), '6 首');
    check('歌词 tab 行数', r.lyricRows, 3);
    check('歌词 tab 高亮', r.lyricTabOn, 1);
    check('☰ 直达目录', r.backToQueue, 6);
    check('切目录后展开', r.panelVisible, true);
    check('再点收起', r.collapsed, true);
    check('收起标题', /显示歌单目录/.test(r.collapsedTitle || ''), '显示歌单目录');
    check('再点展开', r.reopened, true);
    check('展开仍是目录', r.reopenedRows, 6);
    check('点曲目切歌', JSON.stringify(r.played), '["q4"]');
    check('页面错误', errors.length === 0, 0);
    if (failed.length) throw new Error(failed.join('；') + ' | 实测 ' + JSON.stringify(r));
    console.log('Mini 歌单目录检查通过：' + JSON.stringify(r));
  } finally {
    try { child.kill('SIGTERM'); } catch (e) { /* ignore */ }
  }
})().catch((e) => { console.error('Mini 歌单目录检查失败：' + e.message); process.exit(1); });
