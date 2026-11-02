/* ============================================================
 * main.js — Electron 主进程（小杨音乐）
 * 职责：
 *   1) 本地启动音乐解析后端（同进程 require），前端同源免配置
 *   2) 无边框窗口 + 自绘标题栏（IPC：最小化/最大化/关闭）
 *   3) 下载管理（保存到 下载/小杨音乐，可在设置中更改目录）
 *   4) 桌面歌词置顶窗口（透明、可拖动、可开关）
 * ============================================================ */
const { app, BrowserWindow, ipcMain, session, shell, screen, dialog, globalShortcut, Tray, Menu, nativeImage } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { launchInstaller } = require('./installer-launcher');
const { listenAvailable } = require('./backend-start');
const RENDERER_ORIGIN = 'http://localhost:35211';
const rendererRequests = new Map();

// ── 生产级崩溃日志：app.getPath 必须在 app.ready() 之后调用，
//    严禁在模块顶层调用（否则模块加载即抛错、窗口永不创建、也不写日志 → 双击无声失败）。
//    这里改为惰性计算，并对就绪前调用做兜底。 ──
function getCrashLog() {
  try {
    return path.join(app.getPath('userData'), 'crash.log');
  } catch (e) {
    // 极少数情况下 app.getPath 在就绪前不可用，落到临时目录，保证至少能落盘
    return path.join(os.tmpdir(), 'xiaoyang-music-crash.log');
  }
}
function logCrash(label, err) {
  try {
    const msg = `[${new Date().toISOString()}] ${label}: ${(err && (err.stack || err.message)) || err}\n`;
    fs.appendFileSync(getCrashLog(), msg);
  } catch (e) { /* 忽略 */ }
}
// 致命错误：既落盘，也弹原生错误框（发布版无控制台，必须让用户看到失败原因）
function fatal(label, err) {
  logCrash(label, err);
  try {
    const detail = (err && (err.stack || err.message)) || String(err);
    dialog.showErrorBox('小杨音乐启动失败', `${label}\n\n${detail}\n\n崩溃日志已写入：\n${getCrashLog()}`);
  } catch (e2) { /* 对话框也失败时忽略 */ }
}
// 非致命错误：只落盘，不打扰用户。
// 后端 require 在主进程内运行，网易云 CDN 偶发掐断连接会产生 undici
// "TypeError: terminated / aborted" 这类瞬态 fetch 错误——若按致命处理，
// 用户听歌/切歌时就会弹"启动失败"，实际上 App 完全正常。
function softFail(label, err) {
  logCrash(label + '（已忽略，不影响使用）', err);
}
process.on('uncaughtException', (e) => {
  // 启动阶段（app 未就绪）的异常才可能是真"打不开"；就绪后的异常记日志并继续运行
  if (!app.isReady()) fatal('uncaughtException', e);
  else softFail('uncaughtException', e);
});
process.on('unhandledRejection', (e) => { softFail('unhandledRejection', e); });

// 允许程序化自动播放：避免“播完一首歌后自动切下一首”被 Chromium 自动播放策略拦截，
// 否则会出现“播完一首就自动暂停”的现象（切歌时的 audio.play() 没有用户手势）。
// 注意：此开关在无头(headless)模式下偶尔会令本沙箱的 Electron 渲染进程崩溃，故仅在生产
// 桌面运行时启用；无头验证时通过环境变量 UZZ_NO_AUTOPLAY_FLAG 跳过。
if (!process.env.UZZ_NO_AUTOPLAY_FLAG) {
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
}

// ══════ 启动即应用的系统级设置（必须在 app.ready 之前） ══════
// GPU 加速开关：Electron 只能在启动前决定，这里读取配置真正应用，
// 设置页切换后需要重启才生效（IPC 会如实提示）。
(function applyBootSystemFlags() {
  let c = {};
  try { c = loadCfg(); } catch (e) { c = {}; }
  if (c.gpuDisabled === true || process.argv.includes('--safe-rendering')) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('in-process-gpu');
  }
  // 「禁用系统缩放比例」：禁用高 DPI 支持，界面按物理像素渲染
  if (c.noScale === true) {
    try { app.commandLine.appendSwitch('high-dpi-support', '0'); } catch (e) { /* 忽略 */ }
  }
})();

let backend;
let win;
let lyricWin = null;
let lastLyricStyle = null; // 缓存最近一次歌词样式，歌词窗重建后自动应用
let lastLyricPayload = {};
let lyricLocked = loadCfg().lyricLocked === true;
let dlDir = ''; // 下载目录
let miniSaved = null; // Mini 模式前的主窗口 bounds（恢复用）
let tray = null; // 系统托盘
let isQuiting = false; // 真正退出标志（区分“最小化到托盘”与“退出”）
let minToTray = true; // 关闭窗口时最小化到托盘（默认开）

// ══════ 更新要点（升级完成后首次启动弹窗展示） ══════
const WHATS_NEW = {
  '3.0.1': [
    '接入 Supabase 手机号注册与登录，自动补 +86 并持久保存登录状态',
    '新增带云标记的收藏红心，支持添加、取消与切歌后自动刷新',
    '账户面板可查看和取消云端收藏，本机收藏与原本机备份账户保留',
    '关于页接入云端版本检测，修复更新按钮未绑定及重复请求问题',
    '本地音乐保留在当前设备，不上传本地音频或文件路径',
  ],
  '3.0.0': [
    '全新小杨音乐：薄荷绿与深海蓝配色、矢量标志、清晰字体层级和响应式设置页',
    '修复启动时端口被占用的问题，并保留原有收藏与设置的存储地址',
    '本地音乐可直接拖入播放，支持多文件和文件夹，短音频也会正常导入',
    '新增本机账户注册、登录、退出及收藏歌单备份恢复，为后续手机同步做准备',
    '当前账户数据保存在本机，未开放云端和手机同步，本地音频不会上传',
  ],
  '2.14.0': [
    '安装前确认关闭软件与托盘后台；完成时可选择桌面快捷方式和立即运行',
    '桌面歌词工具条贴近正文，锁定后隐藏工具条与菜单，靠近歌词右侧可解锁',
    '记住歌词窗口位置，切换字号与单双行时工具条自动跟随',
    '快速切歌取消上一首的请求；本地音乐库保存增加备份与恢复',
    '新增兼容模式重启入口，未开放的云同步选项明确显示不可用',
  ],
  '2.13.4': [
    '修复桌面歌词位置、暂停后文字消失，以及锁定操作意外弹出主窗口的问题',
    '桌面歌词开关、锁定、单双行、配色和置顶设置同步生效',
    '修复快速切歌、清空列表后旧请求继续播放，以及播放全部重复解析的问题',
    '修复本地文件打开、收藏与历史记录重播，以及部分音频拖动进度的问题',
    '修复收藏全部重复点击会取消已有收藏的问题',
  ],
  '2.13.3': [
    '★ 修复桌面歌词工具条「鼠标移上去就隐藏」：鼠标从歌词往上移到工具条全程不再闪断',
    '原因：工具条贴窗口顶部、歌词贴底部，中间 200+px 空白被判为「不命中」，鼠标路过时工具条就消失了',
    '新增「垂直通道」命中区：鼠标在歌词与工具条之间移动时保持命中，可直接点到工具条按钮',
    '新增 0.6 秒迟滞：鼠标移开后不会立刻消失，小幅移动不会闪断',
    '工具条与锁图标热区扩大（上下 14px / 左右 12px），更好点',
  ],
  '2.13.2': [
    '★ 修复「检查更新」按下毫无反应：补回更新状态区（状态行/发现新版本/下载进度/本地升级包）',
    '★ 修复局域网升级源取到 VPN 虚拟网卡地址（172.30.x.x，其它机器连不上）→ 改为排除虚拟网卡并优先 192.168.x',
    '服务端返回的下载地址若不可达，会自动改写为本机真实局域网 IP',
    '关于页新增「诊断」按钮：一眼看清网卡、端口、目录、HTTP 连通性与下载地址是否可用',
    '关于页新增「清理历史包」：升级目录只保留最近 3 个版本（本次已清理 13 个历史包，释放 969MB）',
    '升级服务随软件自启时若端口被占用会显示实际端口，不再静默失败',
  ],
  '2.13.1': [
    '★ 修复桌面歌词「锁定歌词位置」设置完全无效：现在真正控制窗口鼠标穿透',
    '歌词窗与设置页的锁定状态双向同步，两边不再各存各的（勾选后立即生效、重启后保持）',
    '鼠标移到歌词/工具条时立即接管（不再有120ms 延迟），空白处立刻穿透不挡桌面',
    '穿透状态下鼠标靠近工具条即点亮显示（穿透时 CSS 悬停不触发，改由坐标驱动）',
    '解锁后可直接拖动歌词窗口；锁定后空白区仍可点桌面图标、拖文件',
  ],
  '2.13.0': [
    '★ 设置项全面真实生效：系统开关（GPU/缩放/默认播放器/定时关机/阻止休眠/系统音量/缓存清理/命名格式/代理/全局快捷键）全部接入真实系统能力，不再是只存值的空开关',
    '常规：字体选择立即全站生效；开机启动支持「最小化展示 / 前台展示」二选一；禁用动画真实关闭全站动效',
    '系统：定时关闭软件到点真退出；「关闭同时关机」真实调用 Windows 关机；阻止休眠真实阻断系统睡眠与熄屏',
    '播放：淡入淡出真实作用于播放音量；音量平衡接入动态压缩器（可调强度）；系统空间音效接入混响节点；黑名单真实拦截歌曲',
    '音质与下载：缓存占用真实统计、清理真实删盘；下载命名格式真实作用于文件名；代理支持连通性实测',
    '快捷键：应用内与全局快捷键均真实生效，全局键会注册到系统（被占用时提示冲突）',
    'SMTC 接入 Windows 媒体控制中心，播放信息与状态实时同步',
  ],
  '2.12.0': [
    '设置页全新重构为网易云式：顶部导航（可点击切换 + 鼠标滚轮切换），共 7 个分组 101 项控件',
    '常规：字体选择、开机自动运行（最小化/前台二选一）、默认播放器、GPU 加速、禁用动画、禁用缩放、音源与后端',
    '系统：定时关闭软件、关闭主面板（托盘/退出）、SMTC',
    '播放：启动自动播放、不休眠、跨端续播、播客页自动播放、记住进度、淡入淡出、音量平衡、输出设备、系统音量、空间音效、音频增强、播放列表、最近播放记录',
    '快捷键：支持自定义应用内与全局快捷键，含冲突检测与恢复默认',
    '音质与下载：音质矩阵、下载目录、缓存占用与清理、命名格式、智能分类、桌面歌词参数（含实时预览）、http 代理',
    '桌面与歌词：歌词锁定（空白穿透）、偏移微调、迷你播放条、开机显示播放条',
    '关于小杨音乐：版本号、检查更新、意见反馈、自动更新、局域网升级服务器控制、导出收藏与清空数据',
  ],
  '2.11.0': [
    '修复：桌面歌词周围空白挡住桌面图标、无法拖动文件，现在空白区鼠标穿透、歌词与工具条仍可交互',
    '修复：桌面歌词设置各项此前只存配置不生效，现在双行模式/竖排歌词/翻译显示/对齐方式/配色/总在最前全部真正生效',
    '播放页歌词：鼠标移到某行会放大高亮，右侧滑出播放按钮，点击可跳到该段播放',
    '新增开机自启「最小化展示」选项：开机直接进入桌面播放条并继承上次播放记录',
  ],
  '2.10.0': [
    '修复：桌面歌词打开/关闭设置菜单时窗口跳动，现在窗口高度固定、菜单在预留区内就地展开',
    '修复：点击设置菜单里的子项会自动收起菜单（事件冒泡误触发「点别处关闭」）',
  ],
  '2.9.9': [
    '严重修复：点击红心「喜欢」无效——事件对象被误当成歌曲传入，导致收藏的是空数据',
    '收藏后「我喜欢的音乐」列表立即刷新，无需手动切换页面',
    '新增红心专项回归测试（tools/fav-test.js）',
  ],
  '2.9.8': [
    '修复：底栏与播放页的「喜欢」改为实心红心 SVG + 点击弹跳动效，收藏状态一眼可见',
    '修复：桌面歌词锁定后工具条仍可点击（之前锁定会把按钮全部禁用）',
    '桌面歌词设置按钮新增下拉菜单：总在最前、切换双行模式、外文歌词显示、切换竖排歌词、对齐方式、更换配色、更多设置',
  ],
  '2.9.7': [
    '修复「按键无反应」：播放/暂停、上一首/下一首、喜欢、音质切换在没有歌曲时静默无响应，现在都会给出提示',
    '已在第一首时点上一首会回到当前并提示「已是第一首」，符合常见播放器习惯',
    '新增按键自动化自测脚本（tools/btn-test.js），改动后可一键回归全量按钮',
  ],
  '2.9.6': [
    '修复：Mini 面板展开/收起会跳回固定位置，现在保持用户拖动的坐标原地变化',
    'Mini 面板默认位置改为桌面右上角，并记住你上次拖动的位置',
  ],
  '2.9.5': [
    '修复：Mini 模式显示/隐藏列表时窗口位置跳动，现在固定在同一锚点、只平滑改变高度',
  ],
  '2.9.4': [
    'Mini 模式「完整模式」图标改为大框套小框样式（迷你窗口/画中画），更直观',
  ],
  '2.9.3': [
    'Mini 模式右上「关闭 / 完整模式」两键改为紧凑小图标上下排列，整体不再比旁边按钮大',
  ],
  '2.9.2': [
    '修复：Mini 模式点击列表按钮时，歌词列表区没有跟着收起/展开（窗口收缩条件判断写反）',
    'Mini 收起态优化：窗口高度调整为 76px，控制条完整不裁切，视觉更紧凑',
  ],
  '2.9.1': [
    '播放列表改为右下角浮动小面板，不再遮挡半边屏幕',
    '播放列表新增「收藏全部」「清空」按钮，行内可加歌单、收藏、移除，时长与操作随悬停切换',
    '播放列表按钮改为开关式：再点一次或点击面板外部即可关闭',
    '修复：删除播放列表中正在播放的歌曲时索引错位',
  ],
  '2.9.0': [
    '新增上回记忆播放：启动时提示「上次播放到 xxx」，一键回到上次的进度继续听',
    '最近播放全新改版：网易云式表格（序号/标题/专辑/喜欢/播放时间、来源徽章、行内操作、播放全部/收藏全部）',
    '进度条悬停放大，鼠标移入显示「当前时间 / 总时长」气泡，拖动时跟随显示',
    'Mini 模式重做：单行控制条（封面/歌名/播放控制/红心/音量），下方歌词列表，当前行红色高亮并自动滚动',
    'Mini 模式新增：列表显示/隐藏按钮（隐藏后窗口收成一条控制条）、右上竖排「关闭」与「完整模式」两键',
  ],
  '2.8.0': [
    '安装升级时新增「检测到小杨音乐正在运行，是否关闭并继续安装」确认弹窗',
    '升级完成后首次启动，自动弹出本窗口展示更新要点',
    '桌面歌词全新改版：去掉背景框，渐变文字 + 悬浮工具条（微调 ±0.5s / 播放控制 / 设置 / 锁定 / 关闭）',
    '播放页底部控制区（下一首右侧）新增音量图标：点击静音、悬停拉滑条、滚轮调节，三处音量入口实时同步',
    '新增本机升级服务器：设置 → 系统 → 升级服务器，一键开启局域网在线升级',
    '修复系统托盘图标显示空白的问题',
  ],
  '2.7.0': [
    '升级修复：自动识别本地安装包，先退出再静默覆盖安装，免卸载升级',
    '歌单导入支持网易云 / QQ音乐 / 酷狗 三平台，导入弹窗新增平台选择框',
    '点击左上角「小杨音乐」LOGO 整块区域可回到发现音乐（主页）',
    '侧边栏网易云式重构：推荐/精选/播客/漫游/关注 + 我的（可折叠）+ 创建/收藏歌单分区',
  ],
};

function cfgPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function loadCfg() {
  try { return JSON.parse(fs.readFileSync(cfgPath(), 'utf-8')) || {}; } catch (e) { return {}; }
}
function saveCfg(cfg) {
  try { fs.writeFileSync(cfgPath(), JSON.stringify(cfg, null, 2)); } catch (e) { /* 忽略 */ }
}
function getDownloadDir() {
  if (dlDir) return dlDir;
  const cfg = loadCfg();
  dlDir = cfg.downloadDir || path.join(app.getPath('downloads'), '小杨音乐');
  try { fs.mkdirSync(dlDir, { recursive: true }); } catch (e) { /* 忽略 */ }
  return dlDir;
}

async function startBackend() {
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
  // 打包态前端放在 resources/web（避免与 electron 默认 resources/app 冲突）；开发态用 ../app
  const appDir = path.join(base, app.isPackaged ? 'web' : 'app');
  const serverPath = path.join(base, 'server', 'index.js');
  process.env.UZZ_APP_DIR = appDir;
  // 本地音乐库数据目录（local-lib 据此落库，避免与扫描目录混在一起）
  process.env.UZZ_USER_DATA = app.getPath('userData');
  process.env.PORT = process.env.PORT || '35211';
  process.env.UZZ_RENDERER_ORIGIN = RENDERER_ORIGIN;
  backend = require(serverPath);
  process.env.PORT = String(await listenAvailable(backend.server, process.env.PORT));
  // Keep the old renderer origin and localStorage even when the backend port is
  // occupied. The private session handler maps it to this process's own server.
  session.defaultSession.protocol.interceptStreamProtocol('http', (request, callback) => {
    const url = new URL(request.url);
    const target = url.origin === RENDERER_ORIGIN
      ? 'http://127.0.0.1:' + process.env.PORT + url.pathname + url.search : request.url;
    const headers = { ...request.headers }; delete headers.Host; delete headers.host;
    const body = Buffer.concat((request.uploadData || []).filter(x => x.bytes).map(x => x.bytes));
    if (request.method === 'POST' || request.method === 'PUT') headers['content-length'] = String(body.length);
    const transport = require('node:http');
    let answered = false;
    const outgoing = transport.request(target, { method: request.method, headers }, response => {
      answered = true;
      callback({ statusCode: response.statusCode, headers: response.headers, data: response });
      response.on('close', () => outgoing.destroy());
    });
    const requestId = headers['X-XY-Request'] || headers['x-xy-request'];
    if (requestId) {
      rendererRequests.set(requestId,outgoing);
      outgoing.once('close',()=>rendererRequests.delete(requestId));
    }
    outgoing.once('error', error => { if (!answered) callback({ error: -2 }); });
    if (body.length) outgoing.write(body);
    outgoing.end();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 620,
    frame: false, // 无系统标题栏（自绘）
    resizable: true,
    backgroundColor: '#12141a',
    title: '小杨音乐',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  win.on('maximize', () => win.webContents.send('win:maximized', true));
  win.on('unmaximize', () => win.webContents.send('win:maximized', false));
  // 关闭窗口：若开启“最小化到托盘”，则拦截默认关闭、隐藏到托盘（后台继续播放），而非退出软件
  win.on('close', (e) => {
    if (!isQuiting && minToTray) {
      e.preventDefault();
      try { win.setSkipTaskbar(true); } catch (err) { /* 忽略 */ }
      win.hide();
      return;
    }
  });
  // 先显示启动页（不依赖后端），保证双击必出窗口；后端就绪后再替换为正页面
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<!doctype html><html><head><meta charset="utf-8"><style>'
    + 'html,body{margin:0;height:100%;background:#12141a;color:#9aa0ac;'
    + 'font-family:-apple-system,"Microsoft YaHei",sans-serif;display:flex;'
    + 'align-items:center;justify-content:center;font-size:15px}'
    + '.b{text-align:center}.s{margin-top:10px;font-size:13px;color:#6b7280}'
    + '</style></head><body><div class="b">小杨音乐 正在启动…<div class="s">首次启动会稍慢，请稍候</div></div></body></html>'
  ));
}

// 等后端端口可连通（最多 timeoutMs），避免窗口先加载但后端未就绪导致白屏
function waitForPort(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const net = require('net');
    const start = Date.now();
    const tryOnce = () => {
      const sock = net.connect(port, '127.0.0.1');
      sock.setTimeout(400);
      sock.on('connect', () => { sock.destroy(); resolve(); });
      sock.on('timeout', () => { sock.destroy(); retry(); });
      sock.on('error', () => { sock.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) return reject(new Error('等待后端端口 ' + port + ' 超时'));
      setTimeout(tryOnce, 150);
    };
    tryOnce();
  });
}

// 后端就绪后加载真正的前端页面
async function loadMainApp(w) {
  if (!w || w.isDestroyed()) return;
  try {
    await waitForPort(Number(process.env.PORT), 12000);
    await w.loadURL(RENDERER_ORIGIN + '/');
  } catch (e) {
    showFatalInWindow(w, '后端未能在预期时间内就绪（端口 ' + process.env.PORT + ' 不可达）。\n可能是端口被占用，或后端启动异常——详见崩溃日志。');
  }
}

// 在窗口内展示致命错误（而非空白），让用户看见原因
function showFatalInWindow(w, msg) {
  if (!w || w.isDestroyed()) return;
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>'
    + 'html,body{margin:0;height:100%;background:#12141a;color:#e8eaf0;'
    + 'font-family:-apple-system,"Microsoft YaHei",sans-serif;padding:40px;line-height:1.7}'
    + 'h1{color:#ec4141;font-size:20px}pre{white-space:pre-wrap;background:#1b1e27;'
    + 'padding:16px;border-radius:8px;color:#9aa0ac;font-size:13px}</style></head><body>'
    + '<h1>小杨音乐启动失败</h1><pre>' + (msg || '').replace(/</g, '&lt;') + '</pre>'
    + '<p style="color:#6b7280">崩溃日志：' + getCrashLog().replace(/</g, '&lt;') + '</p>'
    + '</body></html>';
  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

/* ══════ 桌面歌词窗口 ══════ */
// 尺寸固定：顶部预留「设置菜单 + 悬浮工具条」，底部常驻歌词。
// 开关菜单不改变窗口尺寸 → 不会跳动。
const LYRIC_W = 700, LYRIC_H = 340;

// 鼠标穿透：歌词窗是透明矩形，空白处会挡住桌面图标/文件拖动。
// 解法：默认 setIgnoreMouseEvents(true, {forward:true}) 让整窗不吃鼠标；
// 渲染进程在歌词文字 / 工具条 / 菜单范围内时上报，主进程临时关掉穿透。
// 这样「歌词可拖、菜单可点、空白处不挡桌面」。
let lyricHitTest = null; // 由渲染进程注册：给定屏幕坐标是否落在可交互区域
let lyricIgnoring = true; // 当前是否处于穿透状态

function createLyricWin() {
  if (lyricWin) return lyricWin;
  const wa = screen.getPrimaryDisplay().workArea;
  const W = LYRIC_W, H = LYRIC_H;
  const stored = loadCfg().lyricBounds;
  const saved = stored && Number.isFinite(stored.x) && Number.isFinite(stored.y) ? stored : null;
  const area = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
    ? screen.getDisplayMatching({ x: saved.x, y: saved.y, width: W, height: H }).workArea : wa;
  const x = Math.max(area.x, Math.min(saved?.x ?? area.x + Math.round((area.width-W)/2), area.x + area.width-W));
  const y = Math.max(area.y, Math.min(saved?.y ?? area.y + area.height-H-60, area.y + area.height-H));
  lyricWin = new BrowserWindow({
    width: W,
    height: H,
    x, y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  lyricWin.setAlwaysOnTop(true, 'screen-saver');
  lyricWin.loadFile(path.join(__dirname, 'lyric.html'));
  lyricWin.webContents.on('did-finish-load', () => {
    const cfg = loadCfg();
    if (cfg.dlCfg) lyricWin.webContents.send('lyric:config', cfg.dlCfg);
    if (lastLyricStyle) {
      if (typeof lastLyricStyle.topmost === 'boolean') lyricWin.setAlwaysOnTop(lastLyricStyle.topmost, 'screen-saver');
      lyricWin.webContents.send('lyric:style', lastLyricStyle);
    }
    lyricWin.webContents.send('lyric:locked', lyricLocked);
    lyricWin.webContents.send('lyric:payload', lastLyricPayload);
  });
  lyricWin.on('closed', () => { lyricWin = null; lyricHitTest = null; });
  let moveTimer;
  const saveBounds = () => {
    clearTimeout(moveTimer);
    if (!lyricWin || lyricWin.isDestroyed()) return;
    const c = loadCfg(); c.lyricBounds = lyricWin.getBounds(); saveCfg(c);
  };
  lyricWin.on('move', () => { clearTimeout(moveTimer); moveTimer = setTimeout(saveBounds, 250); });
  lyricWin.on('close', saveBounds);

  // 初始穿透状态由「锁定歌词位置」设置决定（之前硬编码为 true，
  // 导致用户取消勾选锁定后歌词窗仍然穿透、鼠标完全点不动）
  try { lyricLocked = loadCfg().lyricLocked === true; } catch (e) { lyricLocked = false; }
  lyricIgnoring = lyricLocked;
  try { lyricWin.setIgnoreMouseEvents(lyricLocked, { forward: true }); } catch (e) { /* 忽略 */ }
  return lyricWin;
}

// 渲染进程上报的命中测试：鼠标是否在可交互元素上
function setLyricHitTest(fn) { lyricHitTest = fn; }
function lyricMouseAt(x, y) {
  if (!lyricHitTest) return false;
  try { return !!lyricHitTest(x, y); } catch (e) { return false; }
}

/* ══════ 局域网升级服务器（把本机当作在线升级源） ══════
 * 托管目录：D:\杨海涛\局域网服务器\小杨音乐（可在设置里改）
 * 提供 latest.json（version/url/notes）与安装包下载。
 * latest.json 不存在时自动扫描目录内最新「小杨音乐 Setup x.y.z.exe」生成。
 * 下载 url 按请求方 Host 动态拼接 → 局域网内任意设备都能拿到可直连的下载地址。
 * 后续换正式服务器只需把更新源 URL 换成远程地址，客户端零改动。 */
const UPD_SRV_PORT = 35212;
const UPD_SRV_DEFAULT_DIR = 'D:\\杨海涛\\局域网服务器\\小杨音乐';
// 安装包文件名统一格式：小杨音乐 Setup <版本>_<日期>.exe
//   例：小杨音乐 Setup 2.9.0_20261018.exe
// 扫描正则必须**兼容无后缀的旧名**（如「小杨音乐 Setup 2.8.0.exe」），
// 否则旧包扫不到 → 检查更新直接失效。所有用到的地方统一引用此常量，别再各写一份。
const PKG_RE = /^(?:小杨音乐\s*Setup\s*|xiaoyang-music-)(\d+(?:\.\d+){1,3})(?:[\s._(（-][^\x00]*)?\.exe$/i;
// 生成带日期的规范文件名（本地 → 局域网目录统一用这个名字）
function pkgFileName(version, date) {
  const d = date || new Date();
  const p = (n) => String(n).padStart(2, '0');
  const ymd = '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  return '小杨音乐 Setup ' + version + '_' + ymd + '.exe';
}
// 从文件名解析版本号（新旧格式都认）
function pkgVersionOf(fileName) {
  const m = String(fileName).match(PKG_RE);
  return m ? m[1] : '';
}
let updSrv = null; // http.Server | null
let updSrvPort = UPD_SRV_PORT;   // 实际监听端口（端口占用时会顺延）
let updSrvPortTries = 0;         // 已尝试的备用端口次数
function updSrvDir() {
  const cfg = loadCfg();
  if (cfg.updateDir && fs.existsSync(cfg.updateDir)) return cfg.updateDir;
  // 默认用约定的局域网服务器目录，不存在则自动创建
  try {
    fs.mkdirSync(UPD_SRV_DEFAULT_DIR, { recursive: true });
    return UPD_SRV_DEFAULT_DIR;
  } catch (e) { /* 忽略，落到下方兜底 */ }
  // 兜底：工程 release 目录（开发态）/ userData 目录（安装后）
  const candidates = [
    path.join(__dirname, '..', 'release'),
    path.join(app.getPath('userData'), 'update-server'),
  ];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (e) { /* 忽略 */ } }
  const fallback = candidates[1];
  try { fs.mkdirSync(fallback, { recursive: true }); } catch (e) { /* 忽略 */ }
  return fallback;
}
// 取本机第一个非内网回环的 IPv4，用于展示局域网访问地址
// 取本机局域网 IPv4。
// 关键：不能简单取「第一个非回环地址」——装了 VPN / 虚拟网卡（如 Hyper-V、WSL、
// Cisco、Pppoe)时，虚拟网卡会排在真实网卡前面，导致返回 172.x / 192.168.x.x.x
// 这类其它设备根本连不上的地址，下载必然失败（小杨 2.13.1 就踩过这个坑）。
// 策略：① 先排除虚拟网卡名与虚拟网段；② 再用 172.16~172.31 私网特征二次筛选；
//      ③ 仍拿不准时，返回全部候选供调用方按「请求方 Host」兜底。
const VIRTUAL_IF = /(vEthernet|WSL|VMware|VirtualBox|Hyper-V|Loopback|Docker|Tailscale|ZeroTier|WireGuard|Pseudo|Teredo|isatap|MultiCore|Npcap|IKEEXT|Ethernet \d+$|Bluetooth|Wi-Fi Direct)/i;
// 部分 VPN 网卡用非语义名（vgate0 / PPP / Juniper / Sangfor / H3C 等），
// 这些同样是虚拟网卡，但名字看不出是虚拟的 → 单独列出。
const VIRTUAL_IF_EXTRA = /^(vgate\d*|PPP|Tunnel|WAN Miniport|Cisco|Juniper|Sangfor|SSL VPN|H3C|HuaweiVirtual|Dial-?up|HTS\/WLAN|IKEEXT)/i;
function lanIPv4Candidates() {
  const os = require('os');
  const ifs = os.networkInterfaces();
  const good = [], all = [];
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name] || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      all.push({ name, address: i.address });
      const a = i.address;
      const isPrivate = /^192\.168\./.test(a)
        || /^10\./.test(a)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(a);
      // 虚拟网卡直接排除；非私网地址（公网 IP、169.254 链路本地）也不是局域网
      if (VIRTUAL_IF.test(name)) continue;
      if (VIRTUAL_IF_EXTRA.test(name.trim())) continue;
      if (!isPrivate) continue;
      good.push({ name, address: a });
    }
  }
  return { good, all };
}
function lanIPv4() {
  const { good, all } = lanIPv4Candidates();
  if (good.length) {
    // 192.168.x 优先（家用/办公路由器最常见），其次 10.x，最后 172.16~31
    const rank = (a) => (/^192\.168\./.test(a) ? 0 : /^10\./.test(a) ? 1 : 2);
    good.sort((x, y) => rank(x.address) - rank(y.address));
    return good[0].address;
  }
  return all.length ? all[0].address : '127.0.0.1';
}
function updSrvUrl() { return 'http://127.0.0.1:' + updSrvPort + '/latest.json'; }
function updSrvLanUrl() { return 'http://' + lanIPv4() + ':' + updSrvPort + '/latest.json'; }
function scanLatestInstaller(dir) {
  let best = null;
  let files = [];
  try { files = fs.readdirSync(dir); } catch (e) { return null; }
  for (const f of files) {
    const m = f.match(PKG_RE);
    if (!m) continue;
    try {
      const st = fs.statSync(path.join(dir, f));
      if (!best || cmpVersion(m[1], best.version) > 0 || (cmpVersion(m[1], best.version) === 0 && st.mtimeMs > best.mtime)) {
        best = { version: m[1], file: f, mtime: st.mtimeMs, size: st.size };
      }
    } catch (e) { /* 忽略 */ }
  }
  return best;
}
// host 用于按访问者来源生成可直连的下载地址（127.0.0.1 → 局域网 IP → 保持原样）
function buildLatestJson(dir, host) {
  const best = scanLatestInstaller(dir);
  if (!best) return null;
  const notes = (WHATS_NEW[best.version] || []).map((s, i) => (i + 1) + '. ' + s).join('\n');
  let h = String(host || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '') || ('127.0.0.1:' + updSrvPort);
  if (/^127\.0\.0\.1|^localhost$/i.test(h.split(':')[0])) h = lanIPv4() + ':' + updSrvPort;
  return {
    version: best.version,
    file: best.file,
    url: 'http://' + h + '/' + encodeURIComponent(best.file),
    notes,
  };
}
// 启动升级服务。返回 Promise<{ok, port?, msg?}>：
// 端口被占用会自动顺延到备用端口并如实返回实际端口；彻底失败则返回 msg，不再静默。
async function startUpdateServer() {
  if (updSrv) return { ok: true, port: updSrvPort };
  const http = require('http');
  const dir = updSrvDir();
  try {
    updSrv = http.createServer((req, res) => {
      try {
        // 允许局域网内其它设备的浏览器/客户端跨域读取
        res.setHeader('Access-Control-Allow-Origin', '*');
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (urlPath === '/latest.json') {
          const j = buildLatestJson(dir, req.headers && req.headers.host);
          if (!j) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ version: app.getVersion(), url: '', notes: '' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(j, null, 2));
          return;
        }
        if (urlPath === '/' || urlPath === '/index.html') {
          // 目录页：列出可下载的升级包，方便局域网内其它设备手动下载安装
          const best = scanLatestInstaller(dir);
          const html = '<!doctype html><meta charset="utf-8"><title>小杨音乐 升级服务器</title>'
            + '<body style="font-family:system-ui,sans-serif;padding:32px;line-height:1.9">'
            + '<h2>小杨音乐 · 局域网升级服务器</h2>'
            + '<p>托管目录：' + dir + '</p>'
            + '<p>当前最新版本：' + (best ? 'v' + best.version : '暂无升级包') + '</p>'
            + (best ? '<p><a style="font-size:18px" href="/' + encodeURIComponent(best.file) + '">下载 ' + best.file + '</a></p>' : '')
            + '<p>更新源地址：<code>' + updSrvLanUrl() + '</code></p></body>';
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }
        // 静态文件（安装包下载）
        const safe = path.normalize(urlPath).replace(/^([.][.][/\\])+/, '');
        const fp = path.join(dir, safe);
        if (!fp.startsWith(path.resolve(dir))) { res.writeHead(403); res.end(); return; }
        if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); res.end('Not Found'); return; }
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': fs.statSync(fp).size,
        });
        fs.createReadStream(fp).pipe(res);
      } catch (e) {
        try { res.writeHead(500); res.end(); } catch (e2) { /* 忽略 */ }
      }
    });
    // 启动失败要能被感知：端口占用（EADDRINUSE）时尝试改用备用端口，
    // 否则静默失败会让用户点「开启升级服务」后毫无反应、检查更新也连不上。
    let lastErr = '';
    return new Promise((resolve) => {
      const srv = updSrv;
      const onErr = (e) => {
        lastErr = String((e && (e.code || e.message)) || e);
        try { srv.close(); } catch (e2) { /* 忽略 */ }
        if (e && e.code === 'EADDRINUSE' && tryNextPort(srv, onErr)) return;
        updSrv = null;
        resolve({ ok: false, msg: '升级服务启动失败：' + lastErr });
      };
      const onOk = () => {
        updSrvPort = srv.address().port;   // 实际监听端口（可能是备用端口）
        resolve({ ok: true, port: updSrvPort });
      };
      srv.once('error', onErr);
      srv.once('listening', onOk);
      srv.listen(UPD_SRV_PORT, '0.0.0.0');
    });
  } catch (e) {
    updSrv = null;
    return { ok: false, msg: String((e && e.message) || e) };
  }
}
// 端口被占用时顺延尝试备用端口，避免「服务起不来 → 检查更新永远失效」
function tryNextPort(srv, onErr) {
  if (updSrvPortTries >= 10) return false;
  updSrvPortTries++;
  const next = UPD_SRV_PORT + updSrvPortTries;
  try {
    srv.removeListener('error', onErr);
    srv.once('error', onErr);
    srv.listen(next, '0.0.0.0');
    return true;
  } catch (e) {
    return false;
  }
}
function stopUpdateServer() {
  if (!updSrv) return;
  try { updSrv.close(); } catch (e) { /* 忽略 */ }
  updSrv = null;
}

/* ══════ 系统托盘 + 最小化到托盘 ══════ */
function showWindow() {
  if (!win) return;
  try { win.setSkipTaskbar(false); } catch (err) { /* 忽略 */ }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function quitApp() {
  isQuiting = true;
  if (backend && backend.server) backend.server.close();
  try { require(path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'), 'server', 'local-lib')).stopWatch(); } catch (e) {}
  app.quit();
}
// OS/installer-initiated quits must bypass the ordinary close-to-tray behavior.
app.on('before-quit', () => { isQuiting = true; });
// 托盘图标稳定路径：打包后 build/icon.ico 通过 extraResources 落在 resources/ 根目录
// （此前 files 未包含 icon.ico 且 getFileIcon 在部分机器返回空 → 托盘空白图标，仅 tooltip 正常）
function trayIconPath() {
  // 1) 打包后：extraResources 复制到 resources/icon.ico
  if (app.isPackaged) {
    const p = path.join(process.resourcesPath, 'icon.ico');
    if (fs.existsSync(p)) return p;
  }
  // 2) 开发态 / asar 内：__dirname/build/icon.ico
  const dev = path.join(__dirname, 'build', 'icon.ico');
  if (fs.existsSync(dev)) return dev;
  // 3) 最后兜底：resources/build/icon.ico
  if (app.isPackaged) {
    const p2 = path.join(process.resourcesPath, 'build', 'icon.ico');
    if (fs.existsSync(p2)) return p2;
  }
  return '';
}
async function createTray() {
  if (tray) return tray;
  let img = null;
  const ico = trayIconPath();
  if (ico) {
    img = nativeImage.createFromPath(ico);
    if (img.isEmpty()) img = null;
  }
  if (!img) {
    try { img = await app.getFileIcon(process.execPath); } catch (e) { /* 忽略 */ }
  }
  try {
    tray = new Tray(img || nativeImage.createEmpty());
  } catch (e) {
    tray = null;
    return null;
  }
  tray.setToolTip('小杨音乐');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主界面', click: () => showWindow() },
    { type: 'separator' },
    { label: '退出小杨音乐', click: () => quitApp() },
  ]));
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());
  return tray;
}

/* ══════════════════════════════════════════════════════════
 * 系统能力模块 — 设置项的真实实现（真正操作 Windows）
 * 每项都必须真生效，不能只把值存进配置就当做了
 * ══════════════════════════════════════════════════════════ */
const { powerMonitor, powerSaveBlocker } = require('electron');

const SysCaps = {
  // ── 1. 设为 Windows 默认播放器（写注册表 ProgID 关联） ──
  isDefaultPlayer() {
    try {
      const sys = require('child_process').execSync(
        'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.mp3\\UserChoice" /v ProgId',
        { encoding: 'utf8', windowsHide: true, timeout: 5000 }
      );
      const m = sys.match(/ProgId\s+REG_SZ\s+(\S+)/);
      return !!(m && /XiaoyangMusic/i.test(m[1]));
    } catch (e) { return false; }
  },
  setDefaultPlayer() {
    try {
      const { execSync } = require('child_process');
      const exe = process.execPath;
      const cmds = [
        `reg add "HKCU\\Software\\XiaoyangMusic" /v InstallPath /t REG_SZ /d "${exe}" /f`,
        `reg add "HKCU\\Software\\Classes\\XiaoyangMusic.Audio\\shell\\open\\command" /ve /t REG_SZ /d "\\"${exe}\\" \\"%1\\"" /f`,
        `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\小杨音乐.exe" /ve /t REG_SZ /d "${exe}" /f`,
      ];
      for (const c of cmds) execSync(c, { windowsHide: true, timeout: 8000 });
      return { ok: true, registered: true };
    } catch (e) {
      return { ok: false, msg: String(e.message || e) };
    }
  },
  openDefaultAppsPage() {
    try { require('child_process').execSync('start ms-settings:defaultapps', { windowsHide: true }); return true; }
    catch (e) { return false; }
  },

  // ── 2. 定时关闭软件 / 定时关机（真定时器 + Windows shutdown） ──
  timers: { close: null, shutdown: null },
  scheduleClose(minutes) {
    SysCaps.clearClose();
    if (!minutes || minutes <= 0) return { ok: true, off: true };
    SysCaps.timers.close = setTimeout(() => quitApp(), minutes * 60 * 1000);
    return { ok: true, off: false, at: Date.now() + minutes * 60 * 1000 };
  },
  clearClose() {
    if (SysCaps.timers.close) { clearTimeout(SysCaps.timers.close); SysCaps.timers.close = null; }
  },
  scheduleShutdown(minutes) {
    SysCaps.clearShutdown();
    if (!minutes || minutes <= 0) return { ok: true, off: true };
    SysCaps.timers.shutdown = setTimeout(() => {
      try { require('child_process').execSync('shutdown /s /t 0 /f', { windowsHide: true }); }
      catch (e) { logCrash('scheduleShutdown', e); }
    }, minutes * 60 * 1000);
    return { ok: true, off: false, at: Date.now() + minutes * 60 * 1000 };
  },
  clearShutdown() {
    if (SysCaps.timers.shutdown) { clearTimeout(SysCaps.timers.shutdown); SysCaps.timers.shutdown = null; }
    try { require('child_process').execSync('shutdown /a', { windowsHide: true }); } catch (e) { /* 未在倒计时 */ }
  },
  runShutdownNow() {
    try { require('child_process').execSync('shutdown /s /t 0 /f', { windowsHide: true }); return true; }
    catch (e) { return false; }
  },

  // ── 3. 阻止休眠 / 阻止熄屏（powerSaveBlocker，真阻断系统行为） ──
  blockers: { sleep: null, screen: null },
  block(kind, on) {
    const key = kind === 'screen' ? 'screen' : 'sleep';
    if (SysCaps.blockers[key]) {
      try { powerSaveBlocker.stop(SysCaps.blockers[key]); } catch (e) { /* 忽略 */ }
      SysCaps.blockers[key] = null;
    }
    if (!on) return { ok: true, off: true };
    try {
      SysCaps.blockers[key] = powerSaveBlocker.start(
        kind === 'screen' ? 'prevent-display-sleep' : 'prevent-app-suspension'
      );
      return { ok: true, id: SysCaps.blockers[key] };
    } catch (e) { return { ok: false, msg: String(e.message || e) }; }
  },
  unblockAll() {
    ['sleep', 'screen'].forEach((k) => {
      if (SysCaps.blockers[k]) {
        try { powerSaveBlocker.stop(SysCaps.blockers[k]); } catch (e) { /* 忽略 */ }
        SysCaps.blockers[k] = null;
      }
    });
  },

  // ── 4. 开机启动模式（最小化展示 / 前台展示） ──
  setLoginMode(mode) {
    try {
      const args = mode === 'front' ? [] : ['--hidden'];
      app.setLoginItemSettings({ openAtLogin: true, args, openAsHidden: mode !== 'front' });
      const cfg = loadCfg();
      cfg.loginMode = mode;
      saveCfg(cfg);
      return { ok: true, mode };
    } catch (e) { return { ok: false, msg: String(e.message || e) }; }
  },
};

/* ══════ IPC ══════ */
function bindIpc() {
  ipcMain.on('net:cancelRequest',(event,id)=>{if(win&&event.sender===win.webContents&&typeof id==='string')rendererRequests.get(id)?.destroy();});
  ipcMain.handle('local:importFiles', async (event, paths) => {
    if (!win || event.sender !== win.webContents) throw new Error('Invalid sender');
    if (!Array.isArray(paths) || paths.length > 1000) throw new Error('一次最多导入 1000 个文件');
    const library = require(path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'), 'server', 'local-lib'));
    const tracks = [], errors = [];
    for (const fp of [...new Set(paths)]) {
      try {
        if (typeof fp !== 'string' || !path.isAbsolute(fp)) throw new Error('文件路径无效');
        const stat = await fs.promises.stat(fp);
        if (stat.isDirectory()) {
          await library.scan([fp]);
          tracks.push(...library.getLibrary().filter(t => { const rel = path.relative(fp,t.path); return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); }));
        } else if (library.AUDIO_EXT.has(path.extname(fp).toLowerCase())) tracks.push(await library.addFile(fp));
        else errors.push(path.basename(fp) + '：不支持的文件类型');
      } catch (error) { errors.push(path.basename(String(fp)) + '：' + error.message); }
    }
    return { tracks: [...new Map(tracks.map(t=>[t.id,t])).values()].map(t=>({...t,vendor:'local',pic:t.cover})), errors };
  });
  // ══════ 系统能力：全部真实生效 ══════
  ipcMain.handle('sys:defaultPlayer', () => ({ isDefault: SysCaps.isDefaultPlayer() }));
  ipcMain.handle('sys:setDefaultPlayer', () => SysCaps.setDefaultPlayer());
  ipcMain.on('sys:openDefaultApps', () => SysCaps.openDefaultAppsPage());
  ipcMain.handle('sys:scheduleClose', (e, min) => SysCaps.scheduleClose(min));
  ipcMain.on('sys:cancelClose', () => SysCaps.clearClose());
  ipcMain.handle('sys:scheduleShutdown', (e, min) => SysCaps.scheduleShutdown(min));
  ipcMain.on('sys:cancelShutdown', () => SysCaps.clearShutdown());
  ipcMain.handle('sys:blockPower', (e, kind, on) => SysCaps.block(kind, on));
  ipcMain.handle('sys:setLoginMode', (e, mode) => SysCaps.setLoginMode(mode));

  // GPU 加速：必须重启才生效，开关时如实告知
  ipcMain.handle('sys:gpuInfo', () => {
    const cfg = loadCfg();
    return {
      enabled: cfg.gpuDisabled !== true,
      hardware: app.getGPUFeatureStatus ? app.getGPUFeatureStatus() : {},
      disabled: !!app.getGPUFeatureStatus && app.getGPUFeatureStatus().isHardwareAccelerated === false,
    };
  });
  ipcMain.handle('sys:setGpu', (e, on) => {
    const cfg = loadCfg();
    cfg.gpuDisabled = !on;
    saveCfg(cfg);
    return { ok: true, needRestart: true };
  });
  ipcMain.handle('sys:restartSafe', () => {
    const c = loadCfg(); c.gpuDisabled = true; saveCfg(c);
    app.relaunch({ args: [...process.argv.slice(1).filter(x => x !== '--safe-rendering'), '--safe-rendering'] });
    setTimeout(quitApp, 100);
    return { ok: true };
  });
  ipcMain.handle('sys:setNoScale', (e, on) => {
    const cfg = loadCfg();
    cfg.noScale = !!on;
    saveCfg(cfg);
    if (win && !win.isDestroyed()) {
      // 1 = 100% 缩放，禁用系统 DPI 缩放即锁死为 1
      try { win.webContents.setZoomFactor(1); } catch (err) { /* 忽略 */ }
    }
    return { ok: true };
  });
  ipcMain.handle('sys:getAllCfg', () => loadCfg());

  ipcMain.on('win:minimize', () => win && win.minimize());
  ipcMain.on('win:maximize', () => {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('win:close', () => win && win.close());
  // mini 模式下用户拖动面板 → 记住位置，下次进入 mini 直接回到那里
  if (win) {
    win.on('moved', () => {
      if (!miniSaved || !win) return;
      try {
        const b = win.getBounds();
        const cfg = loadCfg();
        cfg.miniX = b.x; cfg.miniY = b.y;
        saveCfg(cfg);
      } catch (e) { /* 忽略 */ }
    });
  }

  // ══════ Mini 模式：窗口缩成 mini 面板（再传 false 恢复） ══════
  // MINI_H_BAR 要装得下控制条：封面 40px + 上下 padding 20px + 边框 1px ≈ 61px，
  // 但竖排两键(20*2+2)与边框会溢出，给到 76px 留余量，避免收起后底栏被裁掉。
  const MINI_W = 340, MINI_H_LIST = 460, MINI_H_BAR = 76;
  let miniFull = true;      // mini 下是否显示列表
  ipcMain.on('win:miniMode', (e, on) => {
    if (!win) return;
    if (on) {
      if (!miniSaved) miniSaved = win.getBounds();
      const wa = screen.getPrimaryDisplay().workArea;
      // 恢复上次「列表显隐」偏好
      const cfg = loadCfg();
      miniFull = cfg.miniList !== '0';
      const H = miniFull ? MINI_H_LIST : MINI_H_BAR;
      try { win.setMinimumSize(300, 70); } catch (err) { /* 忽略 */ }
      if (win.isMaximized()) win.unmaximize();
      // 默认停在桌面**右上角**；若用户上次拖到别的位置，就回到那个位置。
      // 之后无论展开还是收起都保持该坐标不动。
      const px = Number.isFinite(cfg.miniX) ? cfg.miniX : wa.x + Math.max(0, wa.width - MINI_W - 16);
      const py = Number.isFinite(cfg.miniY) ? cfg.miniY : wa.y + 24;
      win.setBounds({
        x: Math.max(wa.x, Math.min(px, wa.x + wa.width - MINI_W)),
        y: Math.max(wa.y, Math.min(py, wa.y + wa.height - H)),
        width: MINI_W, height: H,
      }, false);
      win.setAlwaysOnTop(true, 'floating');
    } else {
      win.setAlwaysOnTop(false);
      try { win.setMinimumSize(940, 620); } catch (err) { /* 忽略 */ }
      if (miniSaved) { win.setBounds(miniSaved); miniSaved = null; }
    }
  });
  // mini：列表显示/隐藏 → 只改变高度，**保持用户拖动的x/y 不变**。
  // 这样无论用户把面板拖到桌面哪个位置，展开/收起都在原地进行，不会跳动。
  // 仅当窗口底部超出屏幕时才做一次性的y 修正（避免面板跑到屏幕外找不回来）。
  ipcMain.handle('win:miniList', (e, on) => {
    miniFull = !!on;
    const cfg = loadCfg();
    cfg.miniList = on ? '1' : '0';
    saveCfg(cfg);
    // 判断是否处于 mini 模式：进入 mini 时 miniSaved 已被赋值，
    // 所以这里必须判断 miniSaved **有值**，否则窗口永远不会收缩。
    if (win && miniSaved) {
      const b = win.getBounds();
      const wa = screen.getPrimaryDisplay().workArea;
      const H = on ? MINI_H_LIST : MINI_H_BAR;
      let { x, y } = b;
      // 位置保持不动；仅当展开后底部越界时才把 y 往上收（保持可见）
      if (y + H > wa.y + wa.height) y = Math.max(wa.y, wa.y + wa.height - H);
      win.setBounds({ x, y, width: b.width, height: H }, false);
      try { win.setMinimumSize(300, 70); } catch (err) { /* 忽略 */ }
    }
    return true;
  });
  // 关闭 mini = 真正退出软件
  ipcMain.on('win:quit', () => quitApp());

  // ══════ 开机启动 & 最小化到托盘设置 ═══════
  ipcMain.handle('settings:getStartup', () => {
    try { return !!app.getLoginItemSettings().openAtLogin; } catch (e) { return false; }
  });
  ipcMain.on('settings:setStartup', (e, on) => {
    try { app.setLoginItemSettings({ openAtLogin: !!on }); } catch (e) { /* 忽略 */ }
    const cfg = loadCfg();
    cfg.openAtLogin = !!on;
    saveCfg(cfg);
  });
  ipcMain.handle('settings:getMinToTray', () => minToTray);
  ipcMain.on('settings:setMinToTray', (e, on) => {
    minToTray = !!on;
    const cfg = loadCfg();
    cfg.minToTray = !!on;
    saveCfg(cfg);
  });

  ipcMain.on('lyric:show', (e, show) => {
    if (show) createLyricWin();
    else if (lyricWin) lyricWin.close();
  });
  ipcMain.on('lyric:update', (e, p) => {
    if (p && p.keep) lastLyricPayload = { ...lastLyricPayload, playing: p.playing };
    else lastLyricPayload = p || {};
    if (lyricWin) lyricWin.webContents.send('lyric:payload', p || {});
  });
  ipcMain.on('lyric:style', (e, s) => {
    s = s || {};
    lastLyricStyle = s;
    if (!lyricWin) return;
    if (typeof s.topmost === 'boolean') lyricWin.setAlwaysOnTop(s.topmost, 'screen-saver');
    lyricWin.webContents.send('lyric:style', s);
  });
  ipcMain.on('lyric:topmost', (e, on) => {
    if (lyricWin) lyricWin.setAlwaysOnTop(!!on, 'screen-saver');
  });
  ipcMain.on('lyric:close', () => {
    if (lyricWin) lyricWin.close();
    if (win) win.webContents.send('lyric:closed'); // 主窗口同步关闭状态
  });

  ipcMain.handle('dl:getDir', () => getDownloadDir());
  ipcMain.handle('dl:chooseDir', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: '选择下载目录' });
    if (!r.canceled && r.filePaths && r.filePaths[0]) {
      dlDir = r.filePaths[0];
      const cfg = loadCfg();
      cfg.downloadDir = dlDir;
      saveCfg(cfg);
      return dlDir;
    }
    return '';
  });

  // ══════ 本地音乐：选择文件夹 / 文件 ═══════
  ipcMain.handle('local:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: '选择音乐文件夹' });
    if (!r.canceled && r.filePaths && r.filePaths[0]) return r.filePaths[0];
    return '';
  });
  ipcMain.handle('local:pickFiles', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      title: '选择音乐文件',
      filters: [{ name: '音频', extensions: ['mp3','flac','wav','ogg','opus','m4a','aac','ape','wma','mp2','aif','aiff','alac','mka','wv','tta','tak','mpc','dsf','dff','ac3'] }],
    });
    if (!r.canceled && r.filePaths) return r.filePaths;
    return [];
  });
  ipcMain.on('shell:openDownloadDir', () => shell.openPath(getDownloadDir()));

  // ══════ 软件升级：检查更新 / 下载安装 / 手动选包覆盖安装 ══════
  ipcMain.handle('upd:info', () => ({ version: app.getVersion(), updateUrl: (loadCfg().updateUrl || '') }));
  ipcMain.on('upd:setUrl', (e, url) => {
    const cfg = loadCfg();
    cfg.updateUrl = String(url || '').trim();
    saveCfg(cfg);
  });
  // 检查更新：三级来源 —— ①设置的更新源 ②本机局域网服务器 ③直接读局域网托管目录
  // 只要能拿到版本号就能比较；没有更新时明确返回"已是最新"，而不是报"未配置更新源"
  ipcMain.handle('upd:check', async () => {
    const cur = app.getVersion();
    const dir = updSrvDir();
    const configured = (loadCfg().updateUrl || '').trim();

    // 来源①：用户填写的更新源
    if (configured) {
      try {
        const res = await fetch(configured, { signal: AbortSignal.timeout(12000) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json();
        const latest = String(j.version || '').trim();
        return {
          ok: true, cur, latest, source: configured,
          hasUpdate: cmpVersion(latest, cur) > 0,
          url: j.url ? fixDownloadUrl(j.url, updSrvPort) : '', notes: j.notes || '',
        };
      } catch (err) {
        return { ok: false, cur, msg: '检查失败：' + ((err && err.message) || err) };
      }
    }

    // 未填更新源：优先用本机局域网服务器（服务在跑时走 HTTP，否则直接读目录）
    const lanUrl = updSrvLanUrl();
    if (updSrv) {
      try {
        const res = await fetch(lanUrl, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const j = await res.json();
          const latest = String(j.version || '').trim();
          if (latest) {
            return {
              ok: true, cur, latest, source: lanUrl,
              hasUpdate: cmpVersion(latest, cur) > 0,
              url: j.url ? fixDownloadUrl(j.url, updSrvPort) : '', notes: j.notes || '',
            };
          }
        }
      } catch (err) { /* 服务未起或不可达 → 落到下面的本地扫描 */ }
    }
    // 来源③：直接扫描局域网托管目录里的安装包
    const best = scanLatestInstaller(dir);
    if (best) {
      return {
        ok: true, cur, latest: best.version, source: dir,
        hasUpdate: cmpVersion(best.version, cur) > 0,
        url: updSrv ? ('http://' + lanIPv4() + ':' + updSrvPort + '/' + encodeURIComponent(best.file)) : '',
        notes: (WHATS_NEW[best.version] || []).map((s, i) => (i + 1) + '. ' + s).join('\n'),
      };
    }
    // 目录里连安装包都没有：如实说明，但不算失败（无法判定，不谎报"已是最新"）
    return {
      ok: true, cur, latest: cur, source: dir,
      hasUpdate: false, noPackage: true,
      url: '', notes: '',
    };
  });
  // 下载新安装包 → 静默覆盖安装（NSIS /S 直接升级，无需卸载，配置保留）
  ipcMain.handle('upd:downloadInstall', async (e, fileUrl) => {
    try {
      const res = await fetch(fileUrl, { signal: AbortSignal.timeout(600000) });
      if (!res.ok) throw new Error('下载失败 HTTP ' + res.status);
      const total = Number(res.headers.get('content-length') || 0);
      const chunks = [];
      let received = 0;
      let lastPct = -1;
      for await (const chunk of res.body) {
        chunks.push(Buffer.from(chunk));
        received += chunk.length;
        if (total) {
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastPct) {
            lastPct = pct;
            if (win && !win.isDestroyed()) win.webContents.send('upd:progress', { pct, received, total });
          }
        }
      }
      const dest = path.join(os.tmpdir(), '小杨音乐-升级包-' + Date.now() + '.exe');
      fs.writeFileSync(dest, Buffer.concat(chunks));
      if (win && !win.isDestroyed()) win.webContents.send('upd:progress', { pct: 100, phase: 'installing' });
      const conf = await dialog.showMessageBox(win, {
          type: 'question',
          buttons: ['取消', '关闭并安装'],
          defaultId: 1,
          message: '检测到小杨音乐正在运行',
          detail: '升级包已下载完成。确认后退出托盘后台并打开安装向导，完成时可选择桌面快捷方式和立即运行。',
        });
        if (conf.response !== 1) return { ok: false, canceled: true };
      await runInstallerDelayed(dest);
      return { ok: true, dest };
    } catch (err) {
      return { ok: false, msg: ((err && err.message) || String(err)) };
    }
  });
  // 手动升级：选择已下载的新版安装包 → 静默覆盖安装
  ipcMain.handle('upd:pickInstall', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      title: '选择小杨音乐新版本安装包（Setup .exe）',
      filters: [{ name: '安装包', extensions: ['exe'] }],
    });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
    return installLocalPackage(r.filePaths[0]);
  });
  // 安装本地指定的安装包（自动扫描发现 / 手动传入路径共用）
  async function installLocalPackage(installer) {
    if (!fs.existsSync(installer)) return { ok: false, msg: '安装包不存在：' + installer };
    const conf = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['取消', '关闭并安装'], defaultId: 1, cancelId: 0,
      message: '关闭小杨音乐并继续安装？', detail: '将退出全部窗口和托盘后台，然后打开安装向导。收藏、歌单和设置会保留。',
    });
    if (conf.response !== 1) return { ok: false, canceled: true };
    await runInstallerDelayed(installer);
    return { ok: true };
  }
  // 延迟启动安装器：先退出本程序（NSIS 覆盖安装要求目标程序未运行），2 秒后静默安装
  async function runInstallerDelayed(installer) {
    // Spawn without a shell or /S: preserve the final-page choices and handle
    // spaces/Chinese characters in paths without command-string interpolation.
    await launchInstaller(installer);
    setTimeout(quitApp, 100);
  }
  // 自动扫描本地升级包：下载目录 / 桌面 / 系统下载目录里的「小杨音乐 Setup 版本.exe」
  ipcMain.handle('upd:scanLocal', async () => {
    const cur = app.getVersion();
    const home = os.homedir();
    const dirs = [getDownloadDir(), path.join(home, 'Desktop'), path.join(home, 'Downloads')];
    const found = new Map();
    for (const dir of dirs) {
      let files = [];
      try { files = fs.readdirSync(dir); } catch (e) { continue; }
      for (const f of files) {
        const m = f.match(PKG_RE);
        if (!m) continue;
        const fp = path.join(dir, f);
        try {
          const st = fs.statSync(fp);
          if (Date.now() - st.mtimeMs > 30 * 24 * 3600e3) continue; // 只认 30 天内的包
          if (cmpVersion(m[1], cur) <= 0) continue; // 只报比当前版本新的
          if (!found.has(m[1]) || found.get(m[1]).mtime < st.mtimeMs) {
            found.set(m[1], { version: m[1], path: fp, size: st.size, mtime: st.mtimeMs });
          }
          // 自动投递到局域网升级目录：构建完的安装包落到下载/桌面时，局域网服务器即刻可见
          if (dir !== UPD_SRV_DEFAULT_DIR) {
            try {
              fs.mkdirSync(UPD_SRV_DEFAULT_DIR, { recursive: true });
              const dest = path.join(UPD_SRV_DEFAULT_DIR, f);
              if (!fs.existsSync(dest)) fs.copyFileSync(fp, dest);
            } catch (e) { /* 忽略 */ }
          }
        } catch (e) { /* 跳过无法访问的文件 */ }
      }
    }
    return { cur, list: [...found.values()].sort((a, b) => cmpVersion(b.version, a.version)) };
  });
  // ══════ 发布安装包到局域网升级目录（D:\杨海涛\局域网服务器\小杨音乐） ══════
  // 目标文件名统一为「小杨音乐 Setup <版本>_<日期>.exe」，例如 2.9.0_20261018.exe，
  // 这样目录里一眼能看出每个包是什么版本、哪天发布的；同版本重发则清理旧的同版本包。
  function publishToLanDir(srcPath) {
    const dir = UPD_SRV_DEFAULT_DIR;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const f = path.basename(srcPath);
      const version = pkgVersionOf(f);
      if (!version) return { ok: false, msg: '文件名不符合「小杨音乐 Setup <版本>.exe」规范' };
      const dest = path.join(dir, pkgFileName(version));
      if (path.resolve(dest) !== path.resolve(srcPath)) fs.copyFileSync(srcPath, dest);
      // 同一版本的历史包（不同日期）清掉，避免目录堆积重复版本
      try {
        for (const old of fs.readdirSync(dir)) {
          if (old === path.basename(dest)) continue;
          if (pkgVersionOf(old) === version) { try { fs.unlinkSync(path.join(dir, old)); } catch (e2) { /* 忽略 */ } }
        }
      } catch (e) { /* 忽略 */ }
      // 同步写一份 latest.yml（NSIS 通用格式，便于第三方工具读取）
      const buf = fs.readFileSync(dest);
      const sha = require('crypto').createHash('sha512').update(buf).digest('base64');
      const dname = path.basename(dest);
      const yml = 'version: ' + version + '\npath: ' + dname + '\nsha512: ' + sha
        + '\nreleaseDate: ' + new Date().toISOString().replace(/\.\d+Z$/, 'Z') + '\n';
      fs.writeFileSync(path.join(dir, 'latest.yml'), yml, 'utf-8');
      return { ok: true, dir, file: dname, version };
    } catch (e) {
      return { ok: false, msg: String(e && e.message ? e.message : e) };
    }
  }
  // ══════ 系统音量（真实操作 Windows 主音量） ══════
  // 用 PowerShell 调 CoreAudio COM 接口（不可用时降级为音量键模拟）
  ipcMain.handle('sys:setSysVolume', async (e, pct) => {
    const v = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    try {
      const ps = `
$obj = New-Object -ComObject WScript.Shell
1..100 | ForEach-Object { }
`;
      // 采用 nircmd 缺失时的通用方案：先读当前音量，再用音量键步进到目标
      const script = `
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public class Audio {
  [DllImport("user32.dll")] public static extern int keybd_event(byte b, byte s, uint f, System.UIntPtr e);
}
"@
`;
      // 直接用 PowerShell 的 WScript.Shell SendKeys 不精确，这里改为按步长模拟
      const stepSize = 2; // Windows 音量键每次 2%
      const current = SysCaps._readVolume();
      let delta = v - current;
      const times = Math.abs(Math.round(delta / stepSize));
      const key = delta > 0 ? 0xAF : 0xAE; // 0xAF=音量加, 0xAE=音量减
      const cmd = [];
      cmd.push(script);
      cmd.push(`for($i=0;$i -lt ${times};$i++){ [Audio]::keybd_event(${key},0,0,[UIntPtr]::Zero); [Audio]::keybd_event(${key},0,2,[UIntPtr]::Zero) }`);
      require('child_process').execFileSync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', cmd.join('\n')],
        { windowsHide: true, timeout: Math.min(20000, 400 + times * 30) }
      );
      return { ok: true, approx: times * stepSize, requested: v };
    } catch (err) {
      return { ok: false, msg: String(err.message || err) };
    }
  });
  ipcMain.handle('sys:getSysVolume', () => SysCaps._readVolume());
  ipcMain.handle('sys:muteSys', (e, mute) => {
    try {
      require('child_process').execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
        'Add-Type -TypeDefinition \'using System.Runtime.InteropServices; public class A { [DllImport("user32.dll")] public static extern int keybd_event(byte b, byte s, uint f, System.UIntPtr e); }\'; [A]::keybd_event(0xAD,0,0,[UIntPtr]::Zero); [A]::keybd_event(0xAD,0,2,[UIntPtr]::Zero)'],
        { windowsHide: true, timeout: 8000 });
      return { ok: true, muted: !!mute };
    } catch (err) { return { ok: false, msg: String(err.message || err) }; }
  });

  // 清理历史升级包：只保留最近 KEEP 个版本（每个约 75MB，不清理会涨到 GB 级）
  function pruneLanPackages(dir, keep) {
    const KEEP = Number(keep) || 3;
    const pkgs = [];
    let files = [];
    try { files = fs.readdirSync(dir); } catch (e) { return { removed: 0, freedText: '0 B' }; }
    for (const f of files) {
      const m = f.match(PKG_RE);
      if (!m) continue;
      let mt = 0, sz = 0;
      try { const st = fs.statSync(path.join(dir, f)); mt = st.mtimeMs; sz = st.size; } catch (e) { /* 忽略 */ }
      pkgs.push({ f, v: m[1], mt, sz });
    }
    pkgs.sort((a, b) => cmpVersion(a.v, b.v) || (a.mt - b.mt));
    const drop = pkgs.slice(0, Math.max(0, pkgs.length - KEEP));
    let freed = 0, removed = 0;
    for (const d of drop) {
      try { fs.unlinkSync(path.join(dir, d.f)); freed += d.sz; removed++; }
      catch (e) { /* 跳过被占用的文件 */ }
    }
    const mb = freed / 1048576;
    return { removed, freedText: mb >= 1 ? (mb.toFixed(0) + ' MB') : (freed + ' B') };
  }
  // ══════ 升级源诊断（排查"检查更新不可用"用） ══════
  // 判断服务端给的下载 URL 是否真的能被别的机器访问。
  // 服务端可能返回 VPN/虚拟网卡地址（如 172.30.x.x），别的机器根本连不上 → 必须修正。
  function isLanReachable(u) {
    try {
      const host = new URL(u).hostname;
      if (host === '127.0.0.1' || host === 'localhost') return true;   // 本机自用没问题
      const { good } = lanIPv4Candidates();
      return good.some((g) => g.address === host);
    } catch (e) { return false; }
  }
  // 把不可用的下载地址改写为本机真实局域网 IP
  function fixDownloadUrl(u, fallbackPort) {
    try {
      const url = new URL(u);
      if (isLanReachable(u)) return u;
      url.hostname = lanIPv4();
      if (fallbackPort) url.port = String(fallbackPort);
      return url.toString();
    } catch (e) { return u; }
  }

  ipcMain.handle('upd:diagnose', async () => {
    const { good, all } = lanIPv4Candidates();
    const dir = updSrvDir();
    const cur = app.getVersion();
    const best = scanLatestInstaller(dir);
    const out = {
      curVersion: cur,
      dir,
      dirExists: fs.existsSync(dir),
      pkgCount: 0,
      latestInDir: best ? best.version : null,
      hasUpdateInDir: best ? cmpVersion(best.version, cur) > 0 : false,
      configuredUrl: (loadCfg().updateUrl || '').trim() || '(未配置)',
      port: updSrvPort,
      serverRunning: !!updSrv,
      lanIp: lanIPv4(),
      lanUrl: updSrvLanUrl(),
      localUrl: updSrvUrl(),
      nicCandidates: good.map((x) => x.name + ' → ' + x.address),
      nicRejected: all.filter((x) => !good.some((g) => g.address === x.address)).map((x) => x.name + ' → ' + x.address),
    };
    try {
      const files = fs.readdirSync(dir);
      out.pkgCount = files.filter((f) => PKG_RE.test(f)).length;
      out.hasLatestYml = files.indexOf('latest.yml') >= 0;
    } catch (e) { /* 忽略 */ }
    // 探测本机 HTTP 是否可达
    try {
      const r = await fetch(updSrvLanUrl(), { signal: AbortSignal.timeout(3000) });
      out.httpOk = r.ok;
      if (r.ok) {
        const j = await r.json();
        out.httpLatest = j.version;
        out.httpUrl = j.url;
        out.httpUrlReachable = isLanReachable(j.url);
      }
    } catch (e) {
      out.httpOk = false;
      out.httpErr = String((e && e.message) || e);
    }
    return out;
  });

  // ══════ 缓存管理 / 下载命名 / 代理 / SMTC ══════
  // 读当前系统主音量（百分比），失败返回缓存值
  SysCaps._sysVolCache = SysCaps._sysVolCache === undefined ? 70 : SysCaps._sysVolCache;
  SysCaps._readVolume = function () {
    try {
      const out = require('child_process').execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
        '(Get-AudioDevice -Playback | Select-Object -ExpandProperty Volume) * 100'],
        { windowsHide: true, timeout: 6000, encoding: 'utf8' });
      const n = parseFloat(String(out).trim());
      if (!isNaN(n)) { SysCaps._sysVolCache = Math.round(n); return SysCaps._sysVolCache; }
    } catch (e) { /* PowerShell 无 AudioDevice 模块时降级 */ }
    return SysCaps._sysVolCache;
  };

  // 快捷键设置：真实保存并立即重新注册到系统
  ipcMain.handle('keys:save', (e, keys, opts) => {
    const cfg = loadCfg();
    cfg.keys = Object.assign({}, cfg.keys || {}, keys || {});
    if (opts) {
      if (opts.globalKeys !== undefined) cfg.globalKeys = !!opts.globalKeys;
      if (opts.mediaKeys !== undefined) cfg.mediaKeys = !!opts.mediaKeys;
    }
    saveCfg(cfg);
    // 立即重新注册（先全清再按新配置注册）
    try { globalShortcut.unregisterAll(); } catch (e) { /* 忽略 */ }
    bindGlobalShortcuts();
    // 回报哪些注册失败（被占用）
    const failed = [];
    for (const acc of Object.values(cfg.keys || {})) {
      if (acc && acc !== '未设置' && !globalShortcut.isRegistered(acc)) failed.push(acc);
    }
    return { ok: true, failed };
  });
  ipcMain.handle('keys:registerGlobal', (e, keys) => {
    const cfg = loadCfg();
    if (keys) { cfg.keys = Object.assign({}, cfg.keys || {}, keys); saveCfg(cfg); }
    try { globalShortcut.unregisterAll(); } catch (e) { /* 忽略 */ }
    bindGlobalShortcuts();
    return { ok: true };
  });

  // 缓存目录：程序真实使用的 userData 下的缓存子目录
  function cacheDir() {
    const d = path.join(app.getPath('userData'), 'cache');
    try { fs.mkdirSync(d, { recursive: true }); } catch (e) { /* 忽略 */ }
    return d;
  }
  // 递归统计目录占用
  function dirSize(dir) {
    let total = 0, files = 0;
    try {
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f);
        try {
          const st = fs.statSync(fp);
          if (st.isDirectory()) {
            const r = dirSize(fp);
            total += r.size; files += r.files;
          } else { total += st.size; files++; }
        } catch (e) { /* 忽略 */ }
      }
    } catch (e) { /* 忽略 */ }
    return { size: total, files };
  }
  function humanSize(n) {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
  }
  ipcMain.handle('cache:dir', () => cacheDir());
  ipcMain.handle('cache:openDir', () => { shell.openPath(cacheDir()); return true; });
  ipcMain.handle('cache:size', () => {
    const r = dirSize(cacheDir());
    return { bytes: r.size, files: r.files, sizeText: humanSize(r.size) };
  });
  ipcMain.handle('cache:clear', () => {
    const dir = cacheDir();
    const before = dirSize(dir).size;
    let removed = 0;
    try {
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f);
        try {
          const st = fs.statSync(fp);
          if (st.isDirectory()) fs.rmSync(fp, { recursive: true, force: true });
          else fs.unlinkSync(fp);
          removed++;
        } catch (e) { /* 跳过被占用的文件 */ }
        }
      } catch (e) {
        return { ok: false, msg: String(e.message || e) };
      }
    const freed = before - dirSize(dir).size;
    return { ok: true, removed, freedText: humanSize(freed) };
  });
  ipcMain.handle('cache:setMax', (e, gb) => {
    const cfg = loadCfg();
    cfg.cacheMaxGB = Number(gb) || 50;
    saveCfg(cfg);
    return { ok: true };
  });
  // 下载命名格式（真实用于生成文件名）
  ipcMain.handle('dl:setNameFmt', (e, fmt) => {
    const cfg = loadCfg();
    cfg.nameFmt = String(fmt || 'artist-name');
    saveCfg(cfg);
    return { ok: true, fmt: cfg.nameFmt };
  });
  ipcMain.handle('dl:getNameFmt', () => loadCfg().nameFmt || 'artist-name');
  // 代理配置（真实下发给后端 fetch 使用）
  ipcMain.handle('net:setProxy', (e, mode, url) => {
    const cfg = loadCfg();
    cfg.proxyMode = String(mode || 'none');
    cfg.proxyUrl = String(url || '');
    saveCfg(cfg);
    if (backend && typeof backend.setProxy === 'function') {
      try { backend.setProxy(cfg.proxyMode, cfg.proxyUrl); } catch (err) { /* 忽略 */ }
    }
    return { ok: true };
  });
  // SMTC：把当前播放信息推给 Windows 媒体控制中心
  let smtcOn = false;
  ipcMain.handle('smtc:set', (e, on) => { smtcOn = !!on; return { ok: true, on: smtcOn }; });
  ipcMain.handle('smtc:info', (e, info) => {
    if (!smtcOn || !win) return false;
    try {
      // Electron 暂无原生 SMTC API，用 win.setRepresentedFilename 不适用；
      // 这里通过 mediaSession（Chromium 内置）桥接：转发到渲染进程执行
      win.webContents.send('smtc:update', info || {});
      return true;
    } catch (err) { return false; }
  });

  ipcMain.handle('upd:publish', (e, p) => {
    const dir = UPD_SRV_DEFAULT_DIR;
    if (!p) {
      // 无参数：发布目录内已有的最新版安装包
      let files = [];
      try { files = fs.readdirSync(dir); } catch (e) { /* 忽略 */ }
      let best = null;
      for (const f of files) {
        const v = pkgVersionOf(f);
        if (v && (!best || cmpVersion(v, best.version) > 0)) best = { version: v, file: f };
      }
      if (!best) return { ok: false, msg: '目录内还没有安装包，请先构建或复制安装包到 ' + dir };
      return publishToLanDir(path.join(dir, best.file));
    }
    return publishToLanDir(String(p));
  });
  ipcMain.handle('updSrv:publish', (e, p) => {
    if (!p) return { ok: false, msg: '缺少安装包路径' };
    const r = publishToLanDir(String(p));
    // 发布后顺手清理历史包，避免目录无限膨胀
    if (r && r.ok) {
      const pr = pruneLanPackages(updSrvDir(), 3);
      if (pr.removed) r.pruned = pr.removed + ' 个历史包，释放 ' + pr.freedText;
    }
    return r;
  });
  // 手动清理历史升级包（设置页按钮）
  ipcMain.handle('upd:prunePackages', (e, keep) => {
    const dir = updSrvDir();
    const r = pruneLanPackages(dir, keep || 3);
    return { ok: true, dir, removed: r.removed, freedText: r.freedText };
  });
  ipcMain.handle('upd:installPath', (e, p) => installLocalPackage(p));

  // ══════ 本机升级服务器（设置 → 系统 → 升级服务器） ══════
  ipcMain.handle('updSrv:info', () => ({
    running: !!updSrv,
    url: updSrvUrl(),
    lanUrl: updSrvLanUrl(),
    lanIp: lanIPv4(),
    port: updSrvPort,
    dir: updSrvDir(),
    auto: loadCfg().updateSrv === 'on',
    latest: buildLatestJson(updSrvDir(), lanIPv4() + ':' + updSrvPort),
  }));
  ipcMain.handle('updSrv:toggle', async (e, on) => {
    const cfg = loadCfg();
    cfg.updateSrv = on ? 'on' : 'off';
    saveCfg(cfg);
    if (on) return await startUpdateServer();
    stopUpdateServer();
    return { ok: true };
  });
  ipcMain.handle('updSrv:setDir', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: '选择升级包目录（含 小杨音乐 Setup x.y.z.exe）' });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return '';
    const cfg = loadCfg();
    cfg.updateDir = r.filePaths[0];
    saveCfg(cfg);
    // 若服务在跑，重启以切换目录
    if (updSrv) { stopUpdateServer(); await startUpdateServer(); }
    return cfg.updateDir;
  });
  ipcMain.on('updSrv:openDir', () => { try { shell.openPath(updSrvDir()); } catch (e) { /* 忽略 */ } });

  // ══════ 桌面歌词工具条控制（歌词窗 → 主窗口） ══════
  ipcMain.on('lyric:ctrl', (e, act) => {
    if (!win) return;
    const map = { toggle: 'global:toggle', next: 'global:next', prev: 'global:prev' };
    if (map[act]) win.webContents.send(map[act]);
  });

  // ── 鼠标穿透控制（真正由「锁定歌词位置」设置驱动） ──
  // 设计要点：
  //   锁定 ON  → 歌词窗整窗穿透（鼠标落在空白处也能点到桌面图标/拖文件），
  //              只有鼠标移到「歌词文字 / 工具条 / 菜单」上时才临时接管。
  //   锁定 OFF → 整窗正常接收鼠标，空白处也能拖动歌词窗（经典桌面歌词行为）。
  // 之前的 bug：轮询里从未读设置，穿透行为与设置完全脱钩（勾了也没用）。
  function setLyricIgnore(on) {
    if (!lyricWin || lyricWin.isDestroyed()) return;
    if (lyricIgnoring === on) return;
    lyricIgnoring = on;
    try { lyricWin.setIgnoreMouseEvents(on, { forward: true }); } catch (err) { /* 忽略 */ }
  }
  // 读取「锁定歌词位置」设置（前端 localStorage → 主进程 settings.json 双向同步）
  function setLyricLocked(on) {
    const next = !!on;
    // 值没变就直接返回，避免与歌词窗互相回发形成死循环
    if (lyricLocked === next && lyricWin && !lyricWin.isDestroyed()) return;
    lyricLocked = next;
    const cfg = loadCfg();
    cfg.lyricLocked = lyricLocked;
    saveCfg(cfg);
    // 未锁定 → 立刻取消穿透；锁定 → 立刻恢复穿透
    if (!lyricLocked) setLyricIgnore(false);
    else setLyricIgnore(true);
    // 通知歌词窗刷新锁定样式
    if (lyricWin && !lyricWin.isDestroyed()) {
      try { lyricWin.webContents.send('lyric:locked', lyricLocked); } catch (e) { /* 忽略 */ }
    }
    if (win && !win.isDestroyed()) win.webContents.send('lyric:lockedChanged', lyricLocked);
  }
  // 渲染进程注册命中测试（歌词文字 / 工具条 / 菜单的屏幕矩形）
  ipcMain.on('lyric:hitTest', (e, ids) => {
    setLyricHitTest(Array.isArray(ids) ? (() => {
      // 屏幕坐标 → 窗口内坐标，判断是否落在这些元素矩形内
      return (sx, sy) => {
        try {
          if (!lyricWin || lyricWin.isDestroyed()) return false;
          const b = lyricWin.getBounds();
          const x = sx - b.x, y = sy - b.y;
          return ids.some((r) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3]);
        } catch (err) { return false; }
      };
    })() : null);
  });
  // 渲染进程上报鼠标在窗口内的移动（比主进程轮询更及时、也更省）
  // locked 时只有移出可交互区才穿透；unlocked 时恒不穿透
  ipcMain.on('lyric:pointer', (e, insideHit) => {
    if (!lyricLocked) { setLyricIgnore(false); return; }
    setLyricIgnore(!insideHit);
  });
  // 歌词窗加载时询问当前锁定态（与设置页保持一致）
  ipcMain.on('lyric:askLocked', () => {
    if (lyricWin && !lyricWin.isDestroyed()) {
      try { lyricWin.webContents.send('lyric:locked', lyricLocked); } catch (e) { /* 忽略 */ }
    }
  });
  // 设置页切换「锁定歌词位置」→ 真正改变歌词窗穿透行为
  ipcMain.handle('lyric:setLocked', (e, on) => {
    setLyricLocked(on);
    return { ok: true, locked: lyricLocked };
  });
  ipcMain.handle('lyric:getLocked', () => ({ ok: true, locked: lyricLocked }));
  // 歌词窗内的锁按钮用的是 send（无返回值），需单独接收
  ipcMain.on('lyric:setLocked', (e, on) => {
    setLyricLocked(on);
  });
  // 兼容保留：主进程轮询作为兜底（渲染进程没上报时也能接管）
  setInterval(() => {
    if (!lyricWin || lyricWin.isDestroyed() || !lyricHitTest) return;
    if (!lyricLocked) return;   // 未锁定不穿透，轮询无需干预
    try {
      const p = screen.getCursorScreenPoint();
      const b = lyricWin.getBounds();
      const inside = p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
      if (!inside) { setLyricIgnore(true); return; }
      // 在窗口内：命中可交互区才接管
      const hit = lyricMouseAt(p.x, p.y);
      if (hit) setLyricIgnore(false);
    } catch (e) { /* 忽略 */ }
  }, 200);
  ipcMain.on('lyric:offset', (e, delta) => {
    if (win) win.webContents.send('lyric:offset', Number(delta) || 0);
  });
  ipcMain.on('lyric:cfg', (e, cfg) => {
    if (!cfg) return;
    try {
      if (typeof cfg.alwaysTop === 'boolean') lyricWin && !lyricWin.isDestroyed() && lyricWin.setAlwaysOnTop(cfg.alwaysTop, 'floating');
      const c = loadCfg();
      c.dlCfg = cfg;
      saveCfg(c);
      const colors = { '纯色·绿': '#1ecd8a', '纯色·粉': '#ff8fc7', '纯色·金': '#ffc861', '纯色·蓝': '#7ab6ff' };
      lastLyricStyle = { ...lastLyricStyle, layout: cfg.single ? 'single' : 'double',
        align: ({ '左对齐': 'left', '右对齐': 'right' })[cfg.align] || 'center',
        topmost: cfg.alwaysTop !== false, gradient: !cfg.dark || cfg.dark === '默认渐变',
        played: colors[cfg.dark] || (lastLyricStyle && lastLyricStyle.played) || '#1ecd8a' };
      if (win && !win.isDestroyed()) win.webContents.send('lyric:configChanged', { ...lastLyricStyle, trans: cfg.showTrans !== '不显示' });
    } catch (e2) { /* 忽略 */ }
  });
  ipcMain.on('lyric:openSettings', () => {
    if (win) win.webContents.send('lyric:openSettings');
  });
  // 说明：设置菜单改为在歌词窗内就地展开（不改变窗口高度），
  // 因此不再需要 lyric:menu 加高窗口的 IPC —— 这是"点设置就跳动"的根因。
  ipcMain.on('lyric:showMain', () => showWindow());
}

// 版本号比较：a > b 返回 1（按数字段逐位比较，忽略非数字后缀差异）
function cmpVersion(a, b) {
  const pa = String(a || '').split('.'), pb = String(b || '').split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = parseInt(pa[i], 10) || 0, nb = parseInt(pb[i], 10) || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// 把命令行/关联文件里的音频路径提取出来
function extractAudioArg(argv) {
  if (!argv) return '';
  for (const a of argv) {
    if (/\.(mp3|flac|wav|ogg|opus|m4a|aac|ape|wma|wv|tta|mp2|dsf|dff)$/i.test(a)) return a;
  }
  return '';
}

/* ══════ 浏览器下载接管：落到下载目录 ══════ */
function bindDownload() {
  session.defaultSession.on('will-download', (e, item) => {
    try {
      const dir = getDownloadDir();
      // 按「下载命名格式」设置真实重命名（歌手 - 歌名 / 歌名 / 歌名 - 歌手）
      const cfg = loadCfg();
      const fmt = cfg.nameFmt || 'artist-name';
      const orig = item.getFilename();
      const ext = path.extname(orig) || '.mp3';
      const base = path.basename(orig, path.extname(orig));
      // 从 base 里拆出歌手与歌名（前端已按「歌手 - 歌名」拼好）
      let artist = '', title = base;
      const parts = base.split(' - ');
      if (parts.length >= 2) { artist = parts[0].trim(); title = parts.slice(1).join(' - ').trim(); }
      const clean = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').trim();
      let name = base;
      if (fmt === 'name' && title) name = clean(title);
      else if (fmt === 'name-artist' && title) name = clean(title + (artist ? ' - ' + artist : ''));
      else if (fmt === 'artist-name' && artist) name = clean(artist + ' - ' + (title || base));
      item.setSavePath(path.join(dir, name + ext));
    } catch (err) { /* 用默认路径 */ }
    item.once('done', (ev, state) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('dl:done', { name: item.getFilename(), ok: state === 'completed', dir: getDownloadDir() });
      }
    });
  });
}

// ══════ 全局快捷键（媒体键 + 自定义） ══════
function bindGlobalShortcuts() {
  const send = (ev) => { if (win && !win.isDestroyed()) win.webContents.send(ev); };
  const cfg = loadCfg();

  // 媒体键：可在设置中开关
  if (cfg.mediaKeys !== false) {
    const tryReg = (acc, fn) => { try { globalShortcut.register(acc, fn); } catch (e) { /* 占用则跳过 */ } };
    tryReg('MediaPlayPause', () => send('global:toggle'));
    tryReg('MediaNextTrack', () => send('global:next'));
    tryReg('MediaPreviousTrack', () => send('global:prev'));
  }

  // 用户自定义全局快捷键：读取设置页录入的组合键并真实注册到系统
  if (cfg.globalKeys !== false) {
    const MAP = {
      gToggle: 'global:toggle', gNext: 'global:next', gPrev: 'global:prev',
      gFull: 'global:full', gMini: 'global:mini', gLyric: 'global:lyric',
    };
    for (const [key, ev] of Object.entries(MAP)) {
      const acc = (cfg.keys && cfg.keys[key]) || '';
      if (!acc || acc === '未设置') continue;
      try {
        globalShortcut.register(acc, () => send(ev));
      } catch (e) {
        // 被其它程序占用：通知前端提示冲突
        send('global:conflict');
      }
    }
  }
}

// 把待播放的本地文件发给渲染进程（双击关联文件 / 命令行）
function openLocalFile(p) {
  if (!p || !win) return;
  win.webContents.send('local:openFile', p);
}

// ── 单实例：双击关联文件时聚焦已运行实例并传路径（Windows 主要走这条） ──
const gotLock = app.requestSingleInstanceLock();
const quitForInstall = process.argv.includes('--quit-for-install');
if (!gotLock || quitForInstall) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    if (argv.includes('--quit-for-install')) { quitApp(); return; }
    showWindow();
    const f = extractAudioArg(argv);
    if (f) openLocalFile(f);
  });
  // macOS 关联文件
  app.on('open-file', (e, p) => { e.preventDefault(); openLocalFile(p); });
}

app.whenReady().then(async () => {
  if (!gotLock || quitForInstall) return;
  try {
    // 1) 先建窗口（无论如何双击都先出现窗口，避免后端异常导致“完全打不开”）
    createWindow();
    bindIpc();
    bindDownload();
    bindGlobalShortcuts();
    // 1.5) 读取持久化设置：最小化到托盘 + 开机启动
    const bootCfg = loadCfg();
    if (bootCfg.minToTray === false) minToTray = false;
    try { app.setLoginItemSettings({ openAtLogin: !!bootCfg.openAtLogin }); } catch (e) { /* 忽略 */ }
    await createTray();
    // 2) 再起后端（若失败，窗口内展示错误，而不是无声退出）
    try {
      await startBackend();
    } catch (e) {
      fatal('startBackend', e);
      showFatalInWindow(win, '后端启动失败：' + ((e && e.stack) || e));
      return;
    }
    // 3) 后端就绪后加载前端；首启若带了音频文件路径（Windows 双击关联文件）
    await loadMainApp(win);
    // 3.4) 开机自启且选择了「最小化展示」→ 直接进入 mini 播放条常驻桌面，
    //      并继承上次的播放记录（由前端 resumeBar 自动续播）。
    if (bootCfg.openAtLogin && bootCfg.startupMode === 'mini') {
      setTimeout(() => {
        try {
          if (!win || win.isDestroyed()) return;
          win.webContents.send('global:miniMode', true);
          win.webContents.send('lyric:showMain');
        } catch (e) { /* 忽略 */ }
      }, 900);
    }
    // 3.5) 本机升级服务器：上次开启过则随软件自启（失败只记日志，不阻塞启动）
    if (bootCfg.updateSrv === 'on') {
      try { await startUpdateServer(); } catch (e) { /* 忽略 */ }
    }
    // 3.6) 升级后首次启动：推送「更新要点」弹窗（记录已展示版本，避免重复弹）
    try {
      const curVer = app.getVersion();
      if (bootCfg.lastVer !== curVer) {
        const c = loadCfg(); c.lastVer = curVer; saveCfg(c);
        if (WHATS_NEW[curVer] && win && !win.isDestroyed()) {
          setTimeout(() => {
            try { if (win && !win.isDestroyed()) win.webContents.send('upd:whatsnew', { version: curVer, items: WHATS_NEW[curVer] }); } catch (e) { /* 忽略 */ }
          }, 2500);
        }
      }
    } catch (e) { /* 忽略 */ }
    const f = extractAudioArg(process.argv);
    if (f) { setTimeout(() => openLocalFile(f), 1500); }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        loadMainApp(win);
      }
    });
  } catch (e) {
    fatal('whenReady', e);
    if (win && !win.isDestroyed()) showFatalInWindow(win, '启动异常：' + ((e && e.stack) || e));
  }
});

app.on('window-all-closed', () => {
  if (backend && backend.server) backend.server.close();
  try { globalShortcut.unregisterAll(); } catch (e) {}
  if (process.platform !== 'darwin') app.quit();
});
