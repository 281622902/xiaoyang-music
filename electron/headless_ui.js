// 无头 UI 验证：起真实后端 + 用无头 Chromium 渲染前端（即 Electron 窗口内显示的内容）
// 并点开「智能歌单」「音乐榜单」两个新功能截图，验证 UI 与接口
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = __dirname;
const APP_DIR = path.resolve(ROOT, '../app');
const SERVER = path.resolve(ROOT, '../server');
const PORT = 35777;
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uzz-ui-'));
const OUT_DIR = 'C:/tmp';

// 预置一份带风格/年份/格式元数据的本地库，让“智能歌单”有内容可截
const lib = {
  version: 2,
  folders: [USER_DATA],
  tracks: [
    { id: '1', path: 'a.mp3', name: '晴天', artist: '周杰伦', album: '叶惠美', duration: 269, format: 'MP3', genre: '流行', year: 2003, composer: '周杰伦' },
    { id: '2', path: 'b.mp3', name: '稻香', artist: '周杰伦', album: '魔杰座', duration: 223, format: 'MP3', genre: '流行', year: 2008, composer: '周杰伦' },
    { id: '3', path: 'c.flac', name: '贝加尔湖畔', artist: '李健', album: '李健', duration: 251, format: 'FLAC', genre: '民谣', year: 2011, composer: '李健' },
    { id: '4', path: 'd.wav', name: '月光', artist: '贝多芬', album: '奏鸣曲', duration: 360, format: 'WAV', genre: '古典', year: 1801, composer: 'Beethoven' },
    { id: '5', path: 'e.mp3', name: '夜空中最亮的星', artist: '逃跑计划', album: '世界', duration: 252, format: 'MP3', genre: '摇滚', year: 2011, composer: '毛川' },
  ],
};
fs.mkdirSync(path.join(USER_DATA, 'local-music'), { recursive: true });
fs.writeFileSync(path.join(USER_DATA, 'local-music', 'library.json'), JSON.stringify(lib));

process.env.UZZ_USER_DATA = USER_DATA;
process.env.UZZ_APP_DIR = APP_DIR;
process.env.PORT = String(PORT);

const backend = require(path.join(SERVER, 'index.js'));

(async () => {
  await new Promise((r) => backend.server.listen(PORT, r));
  console.log('✓ 后端已启动 http://localhost:' + PORT);

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1180, height: 760 } });
  // 注入 preload 桩（等价 electron/preload.js 的uzzBridge），让本地音乐模块认为自己在桌面版里
  await page.addInitScript(() => {
    const noop = () => {};
    window.uzzBridge = {
      isDesktop: true,
      minimize: noop, maximize: noop, close: noop, onMaximized: noop,
      getDownloadDir: () => Promise.resolve('C:/tmp'), chooseDownloadDir: () => Promise.resolve('C:/tmp'),
      openDownloadDir: noop, onDownloadDone: noop,
      showLyric: noop, sendLyric: noop, setLyricStyle: noop, onLyricClosed: noop,
      pickFolder: () => Promise.resolve(null), pickFiles: () => Promise.resolve([]),
      onGlobal: noop, onOpenLocalFile: noop,
    };
  });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console.error] ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + ((e && e.message) || e)));

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#sideNav', { timeout: 15000 });
  console.log('✓ 前端已加载（侧边栏出现）');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT_DIR, 'uzz-1-home.png') });
  console.log('✓ 截图 主界面:', path.join(OUT_DIR, 'uzz-1-home.png'));

  // 本地音乐 → 智能歌单
  await page.click('[data-view="local"]');
  await page.waitForSelector('[data-f="smart"]', { timeout: 8000 });
  await page.click('[data-f="smart"]');
  try {
    await page.waitForSelector('.lg-head', { timeout: 8000 });
    console.log('✓ 智能歌单已渲染分组');
  } catch (e) { console.log('⚠ 智能歌单分组未出现（可能接口/渲染问题）'); }
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT_DIR, 'uzz-2-smart.png') });
  console.log('✓ 截图 智能歌单:', path.join(OUT_DIR, 'uzz-2-smart.png'));

  // 音乐榜单
  await page.click('[data-view="charts"]');
  try {
    await page.waitForSelector('.chart-card', { timeout: 8000 });
    console.log('✓ 音乐榜单已渲染卡片');
  } catch (e) { console.log('⚠ 音乐榜单卡片未出现'); }
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT_DIR, 'uzz-3-charts.png') });
  console.log('✓ 截图 音乐榜单:', path.join(OUT_DIR, 'uzz-3-charts.png'));

  console.log('=== 前端运行时错误 ===');
  console.log(errors.length ? errors.join('\n') : '（无）');
  await browser.close();
  backend.server.close();
  console.log('RESULT: UI 验证完成');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
