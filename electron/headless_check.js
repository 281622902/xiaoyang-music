// 无头实跑 + 截图：自己拉起 electron（headless + 远程调试端口），再用 CDP 连接并截图
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const DBG_PORT = 9333;
const OUT = 'C:/tmp/uzz-shot.png';

function waitPort(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryOnce = () => {
      const s = http.get({ host: '127.0.0.1', port, path: '/json/version' }, (r) => { r.resume(); resolve(); });
      s.on('error', () => { s.destroy(); if (Date.now() - start > timeoutMs) reject(new Error('调试端口超时')); else setTimeout(tryOnce, 300); });
      s.setTimeout(400, () => { s.destroy(); if (Date.now() - start > timeoutMs) reject(new Error('调试端口超时')); else setTimeout(tryOnce, 300); });
    };
    tryOnce();
  });
}

async function run(cand) {
  console.log('--- 启动:', cand.exe, cand.args.join(' ') || '(无额外参数)');
  const child = spawn(cand.exe, cand.args, { env: { ...process.env }, stdio: 'ignore' });
  let exited = false;
  child.on('exit', (code) => { exited = true; console.log('electron 进程退出 code=', code); });
  try {
    await waitPort(DBG_PORT, 40000);
    console.log('✓ 调试端口已就绪');
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${DBG_PORT}`);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();
    page.on('console', (m) => console.log('[page]', m.type(), m.text().slice(0, 200)));
    page.on('pageerror', (e) => console.log('[pageerror]', (e && e.message) || e));
    let reached = false;
    try {
      await page.waitForSelector('text=本地音乐', { timeout: 25000 });
      reached = true;
      console.log('✓ 前端已渲染（检测到“本地音乐”导航）');
    } catch (e) {
      console.log('✗ 25s 内未等到“本地音乐”');
    }
    await page.waitForTimeout(1200);
    await page.screenshot({ path: OUT });
    console.log('✓ 截图保存:', OUT, '| reachedApp=', reached);
    await browser.close();
    return reached;
  } finally {
    try { child.kill('SIGKILL'); } catch (e) {}
  }
}

(async () => {
  const baseArgs = ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', `--remote-debugging-port=${DBG_PORT}`];
  const candidates = [
    { exe: path.resolve(ROOT, 'dist/win-unpacked/小杨音乐.exe'), args: baseArgs },
    { exe: path.resolve(ROOT, 'node_modules/electron/dist/electron.exe'), args: ['.', ...baseArgs] },
  ];
  for (const c of candidates) {
    if (!fs.existsSync(c.exe)) { console.log('跳过（不存在）:', c.exe); continue; }
    try {
      const ok = await run(c);
      if (ok) { console.log('RESULT: OK via', c.exe); process.exit(0); }
    } catch (e) {
      console.log('启动失败:', (e && e.message) || e);
    }
  }
  console.log('RESULT: 所有候选均未能完成前端渲染截图');
  process.exit(2);
})();
