// 新 LOGO 无头验证：起真实后端 + 无头 Chromium 截标题栏，确认 icon.svg 渲染且无控制台报错
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = __dirname;
const SERVER = path.resolve(ROOT, '../server');
const PORT = 35778;
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uzz-logo-'));
process.env.UZZ_USER_DATA = USER_DATA;

process.env.PORT = String(PORT);
const { server } = require(path.join(SERVER, 'index.js'));

(async () => {
  server.listen(PORT);
  await new Promise(r => setTimeout(r, 1500));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const logo = await page.$('.brand-logo');
  const info = await page.evaluate(() => {
    const img = document.querySelector('.brand-logo');
    if (!img) return { ok: false, reason: 'no .brand-logo' };
    const r = img.getBoundingClientRect();
    return {
      ok: true, tag: img.tagName, complete: img.complete,
      natural: img.naturalWidth + 'x' + img.naturalHeight,
      box: Math.round(r.width) + 'x' + Math.round(r.height),
      src: img.getAttribute('src'),
    };
  });
  console.log('LOGO:', JSON.stringify(info));
  await page.screenshot({ path: 'C:/tmp/logo_titlebar.png', clip: { x: 0, y: 0, width: 640, height: 48 } });

  console.log('console errors:', errors.length, errors.slice(0, 3));
  await browser.close();
  process.exit(info.ok && info.complete && info.natural.startsWith('512') && errors.length === 0 ? 0 : 1);
})();
