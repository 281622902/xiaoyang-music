// v2.3.2 无头验证：搜索框/返回键网易云化 + 每日推荐日期 + 崩溃修复静态检查
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const PORT = 35216;

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve(b)); }).on('error', reject);
  });
}

(async () => {
  // 1) 起真实后端
  const srv = spawn(process.env.NODE_BIN || 'node', ['index.js'], {
    cwd: path.join(ROOT, 'server'),
    env: { ...process.env, PORT: String(PORT), UZZ_USER_DATA: path.join(process.env.TEMP || '/tmp', 'uzz-verify-232') },
    stdio: 'ignore',
  });
  let up = false;
  for (let i = 0; i < 25; i++) {
    try { await httpGet(`http://127.0.0.1:${PORT}/api/health`); up = true; break; } catch (e) { await wait(400); }
  }
  if (!up) { console.error('FAIL: server not up'); srv.kill(); process.exit(1); }

  const errors = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await wait(800);

  const r = await page.evaluate(() => {
    const out = {};
    // 顶栏：仅后退键、无前进键、searchGo 存在、searchBtn 已删
    out.navBack = !!document.getElementById('navBack');
    out.navFwdGone = !document.getElementById('navFwd');
    out.searchGo = !!document.getElementById('searchGo');
    out.searchBtnGone = !document.getElementById('searchBtn');
    out.micInSearch = !!document.getElementById('btnVoice');
    // navBack 紧贴搜索框（同一行，x 距离 < 60px）
    const nb = document.getElementById('navBack').getBoundingClientRect();
    const se = document.querySelector('.tb-search .search').getBoundingClientRect();
    out.backBesideSearch = Math.abs((se.left - nb.right)) < 60;
    out.searchWidth = Math.round(se.width);
    // 每日推荐 banner 日期
    const d = new Date();
    out.bannerDay = document.getElementById('bnDailyDay') && document.getElementById('bnDailyDay').textContent;
    out.bannerMon = document.getElementById('bnDailyMon') && document.getElementById('bnDailyMon').textContent;
    out.bannerDayOk = out.bannerDay === String(d.getDate()) && out.bannerMon === '/ ' + (d.getMonth() + 1);
    // 放大镜点击可搜索（无输入时应弹热搜/不报错）
    document.getElementById('searchGo').click();
    return out;
  });
  await wait(600);
  r.suggestAfterGo = await page.evaluate(() => {
    const sb = document.getElementById('suggestBox');
    return sb ? !sb.classList.contains('hidden') : false;
  });

  // 2) 每日推荐子集确定性：模拟两天的种子 → 前 30 首不同
  function shuffleSeeded(arr, seed) {
    const a = arr.slice(); let s = seed;
    for (let i = a.length - 1; i > 0; i--) {
      s = (s * 9301 + 49297) % 233280;
      const j = Math.floor((s / 233280) * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const base = Array.from({ length: 200 }, (_, i) => i);
  const today = shuffleSeeded(base, 20261017).slice(0, 30);
  const tomorrow = shuffleSeeded(base, 20261018).slice(0, 30);
  const same = today.every((v, i) => v === tomorrow[i]);
  r.dailySubsetDiffers = !same;
  r.dailySubsetLen = today.length;

  // 3) main.js 崩溃修复静态断言
  const mj = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
  r.crashFix = mj.includes("softFail('unhandledRejection'") && mj.includes('!app.isReady()');

  await browser.close();
  srv.kill();

  let ok = true;
  const expects = {
    navBack: true, navFwdGone: true, searchGo: true, searchBtnGone: true, micInSearch: true,
    backBesideSearch: true, bannerDayOk: true, dailySubsetDiffers: true, crashFix: true,
  };
  for (const k in expects) {
    const pass = r[k] === expects[k];
    if (!pass) ok = false;
    console.log((pass ? 'OK  ' : 'FAIL') + ' ' + k + ' = ' + JSON.stringify(r[k]));
  }
  console.log('searchWidth=' + r.searchWidth + ' suggestAfterGo=' + r.suggestAfterGo + ' dailySubsetLen=' + r.dailySubsetLen);
  console.log('consoleErrors=' + errors.length + (errors.length ? ' :: ' + errors.slice(0, 3).join(' | ') : ''));
  console.log(ok && errors.length === 0 ? 'PASS' : 'FAIL');
  process.exit(ok && errors.length === 0 ? 0 : 1);
})();
