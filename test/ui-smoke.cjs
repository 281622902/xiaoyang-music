/* UI 冒烟门禁：启动后端、打开真实页面、检查关键模块并留截图。 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const PORT = process.env.UI_SMOKE_PORT || '31077';
const BASE = `http://127.0.0.1:${PORT}`;
const shotDir = path.join(root, 'test-artifacts');

async function waitServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch (e) { /* keep polling */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('UI 冒烟测试：本地服务启动超时');
}

(async () => {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT },
    stdio: 'ignore',
  });
  try {
    await waitServer();
    const { chromium } = require(path.join(root, 'electron', 'node_modules', 'playwright'));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('#plGrid .pl-card', { timeout: 30000 });

    const checks = {
      playlistCards: await page.locator('#plGrid .pl-card').count(),
      chartCards: await page.locator('#chartsRow .chart-card').count(),
      moduleButton: await page.locator('#homeModuleBtn').count(),
      vendorFilter: await page.locator('#searchVendor').count(),
      fxScenes: await page.locator('#fxScenes button').count(),
      recommendationSource: await page.locator('.plc-src').count(),
    };
    fs.mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, 'ui-smoke.png'), fullPage: false });
    await browser.close();

    const failed = [];
    if (checks.playlistCards < 15) failed.push(`推荐歌单不足 15 张（${checks.playlistCards}）`);
    if (checks.chartCards < 9) failed.push(`榜单卡片不足 9 张（${checks.chartCards}）`);
    if (!checks.moduleButton) failed.push('缺少模块管理按钮');
    if (!checks.vendorFilter) failed.push('缺少音源筛选');
    if (checks.fxScenes < 5) failed.push('音效场景按钮不足 5 个');
    if (!checks.recommendationSource) failed.push('缺少推荐来源说明');
    if (errors.length) failed.push('页面错误：' + errors.join(' | '));
    if (failed.length) throw new Error(failed.join('；'));
    console.log('UI 冒烟门禁通过：' + JSON.stringify(checks));
  } finally {
    try { child.kill('SIGTERM'); } catch (e) { /* ignore */ }
  }
})().catch((e) => { console.error('UI 冒烟门禁失败：' + e.message); process.exit(1); });
