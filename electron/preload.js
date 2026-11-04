/* preload.js — 主窗口桥接：窗口控制 / 下载 / 桌面歌词 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const dropListeners = new Set();
window.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', async e => {
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  const paths = Array.from(e.dataTransfer.files).map(file => {
    try { return webUtils?.getPathForFile ? webUtils.getPathForFile(file) : file.path; } catch { return ''; }
  }).filter(Boolean);
  if (!paths.length) return;
  try { const result = await ipcRenderer.invoke('local:importFiles', paths); dropListeners.forEach(cb => cb(result)); }
  catch (error) { dropListeners.forEach(cb => cb({ tracks: [], errors: [error.message] })); }
});
contextBridge.exposeInMainWorld('uzzBridge', {
  isDesktop: true,
  cancelWebRequest: (id) => ipcRenderer.send('net:cancelRequest', id),
  // 窗口控制（自绘标题栏）
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  setMiniMode: (on) => ipcRenderer.send('win:miniMode', on),
  setMiniListVisible: (on) => ipcRenderer.invoke('win:miniList', on),
  quitApp: () => ipcRenderer.send('win:quit'),
  onMaximized: (cb) => ipcRenderer.on('win:maximized', (e, m) => cb(m)),
  // 下载
  getDownloadDir: () => ipcRenderer.invoke('dl:getDir'),
  chooseDownloadDir: () => ipcRenderer.invoke('dl:chooseDir'),
  openDownloadDir: () => ipcRenderer.send('shell:openDownloadDir'),
  onDownloadDone: (cb) => ipcRenderer.on('dl:done', (e, r) => cb(r)),
  // 桌面歌词
  showLyric: (show) => ipcRenderer.send('lyric:show', show),
  // 锁定歌词位置（真实控制歌词窗鼠标穿透：锁定=空白穿透不挡桌面）
  setLyricLocked: (on) => ipcRenderer.invoke('lyric:setLocked', on),
  getLyricLocked: () => ipcRenderer.invoke('lyric:getLocked'),
  onLyricLocked: (cb) => ipcRenderer.on('lyric:lockedChanged', (e, on) => cb(on)),
  onLyricConfig: (cb) => ipcRenderer.on('lyric:configChanged', (e, cfg) => cb(cfg)),
  sendLyric: (p) => ipcRenderer.send('lyric:update', p),
  setLyricStyle: (s) => ipcRenderer.send('lyric:style', s),
  setLyricTopmost: (on) => ipcRenderer.send('lyric:topmost', on),
  onLyricClosed: (cb) => ipcRenderer.on('lyric:closed', () => cb()),
  // 本地音乐：选择文件夹 / 文件
  pickFolder: () => ipcRenderer.invoke('local:pickFolder'),
  pickFiles: () => ipcRenderer.invoke('local:pickFiles'),
  importFiles: (paths) => ipcRenderer.invoke('local:importFiles', paths),
  onDropResult: (cb) => { dropListeners.add(cb); return () => dropListeners.delete(cb); },
  // 开机启动 & 最小化到托盘设置
  getStartup: () => ipcRenderer.invoke('settings:getStartup'),
  setStartup: (on) => ipcRenderer.send('settings:setStartup', on),
  getMinToTray: () => ipcRenderer.invoke('settings:getMinToTray'),
  setMinToTray: (on) => ipcRenderer.send('settings:setMinToTray', on),
  // ═══ 系统能力（全部真实生效） ═══
  // 默认播放器
  getDefaultPlayer: () => ipcRenderer.invoke('sys:defaultPlayer'),
  setDefaultPlayer: () => ipcRenderer.invoke('sys:setDefaultPlayer'),
  openDefaultApps: () => ipcRenderer.send('sys:openDefaultApps'),
  // 定时关闭 / 定时关机
  scheduleClose: (min) => ipcRenderer.invoke('sys:scheduleClose', min),
  cancelClose: () => ipcRenderer.send('sys:cancelClose'),
  scheduleShutdown: (min) => ipcRenderer.invoke('sys:scheduleShutdown', min),
  cancelShutdown: () => ipcRenderer.send('sys:cancelShutdown'),
  // 阻止休眠 / 熄屏
  blockPower: (kind, on) => ipcRenderer.invoke('sys:blockPower', kind, on),
  // 开机启动模式：'tray' 最小化展示 | 'front' 前台展示
  setLoginMode: (mode) => ipcRenderer.invoke('sys:setLoginMode', mode),
  // GPU 加速 / 系统缩放（需重启生效）
  gpuInfo: () => ipcRenderer.invoke('sys:gpuInfo'),
  setGpu: (on) => ipcRenderer.invoke('sys:setGpu', on),
  restartSafe: () => ipcRenderer.invoke('sys:restartSafe'),
  setNoScale: (on) => ipcRenderer.invoke('sys:setNoScale', on),
  getAllCfg: () => ipcRenderer.invoke('sys:getAllCfg'),
  // 设置项变更通知（主进程 → 渲染），用于跨窗口同步
  onSysEvent: (cb) => ipcRenderer.on('sys:event', (e, p) => cb(p)),
  // ═══ 缓存管理（真实读写磁盘） ═══
  getCacheDir: () => ipcRenderer.invoke('cache:dir'),
  openCacheDir: () => ipcRenderer.invoke('cache:openDir'),
  getCacheSize: () => ipcRenderer.invoke('cache:size'),
  clearCache: () => ipcRenderer.invoke('cache:clear'),
  setCacheMax: (gb) => ipcRenderer.invoke('cache:setMax', gb),
  // 下载命名格式 / 代理
  setNameFmt: (f) => ipcRenderer.invoke('dl:setNameFmt', f),
  getNameFmt: () => ipcRenderer.invoke('dl:getNameFmt'),
  setProxy: (mode, url) => ipcRenderer.invoke('net:setProxy', mode, url),
  // SMTC（Windows 媒体控制中心）
  setSmtc: (on) => ipcRenderer.invoke('smtc:set', on),
  smtcInfo: (info) => ipcRenderer.invoke('smtc:info', info),
  onSmtcUpdate: (cb) => ipcRenderer.on('smtc:update', (e, p) => cb(p)),
  // 快捷键：真实注册到系统全局热键
  saveKeys: (keys, opts) => ipcRenderer.invoke('keys:save', keys, opts),
  registerGlobal: (keys) => ipcRenderer.invoke('keys:registerGlobal', keys),
  // 系统音量（真实调 Windows 主音量）
  setSysVolume: (pct) => ipcRenderer.invoke('sys:setSysVolume', pct),
  getSysVolume: () => ipcRenderer.invoke('sys:getSysVolume'),
  muteSys: (on) => ipcRenderer.invoke('sys:muteSys', on),
  // 全局快捷键（媒体键 / 自定义）：回调收到事件名
  onGlobal: (cb) => {
    ['global:toggle', 'global:next', 'global:prev', 'global:full', 'global:mini', 'global:lyric', 'global:miniMode'].forEach((ev) =>
      ipcRenderer.on(ev, () => cb(ev)));
  },
  // 双击关联音频文件 / 命令行传来的本地文件
  onOpenLocalFile: (cb) => ipcRenderer.on('local:openFile', (e, p) => cb(p)),
  // ══════ 软件升级 ══════
  getAppVersion: () => ipcRenderer.invoke('upd:info'),
  setUpdateUrl: (url) => ipcRenderer.send('upd:setUrl', url),
  checkUpdate: () => ipcRenderer.invoke('upd:check'),
  downloadAndInstall: (fileUrl) => ipcRenderer.invoke('upd:downloadInstall', fileUrl),
  cancelUpdateDownload: () => ipcRenderer.send('upd:cancelDownload'),
  pickAndInstall: () => ipcRenderer.invoke('upd:pickInstall'),
  scanLocalPackages: () => ipcRenderer.invoke('upd:scanLocal'),
  installLocalPath: (p) => ipcRenderer.invoke('upd:installPath', p),
  onUpdateProgress: (cb) => ipcRenderer.on('upd:progress', (e, p) => cb(p)),
  // 升级后首次启动：更新要点弹窗
  onWhatsNew: (cb) => ipcRenderer.on('upd:whatsnew', (e, d) => cb(d)),
  // 本机升级服务器
  updSrvInfo: () => ipcRenderer.invoke('updSrv:info'),
  updSrvToggle: (on) => ipcRenderer.invoke('updSrv:toggle', on),
  updSrvSetDir: () => ipcRenderer.invoke('updSrv:setDir'),
  updSrvOpenDir: () => ipcRenderer.send('updSrv:openDir'),
  updSrvPublish: (p) => ipcRenderer.invoke('updSrv:publish', p || ''),
  // 升级源诊断（排查检查更新不可用）+ 清理历史包
  updDiagnose: () => ipcRenderer.invoke('upd:diagnose'),
  prunePackages: (keep) => ipcRenderer.invoke('upd:prunePackages', keep || 3),
  // 桌面歌词工具条控制回调（主进程转发给主窗口）
  onLyricOffset: (cb) => ipcRenderer.on('lyric:offset', (e, d) => cb(d)),
  onLyricOpenSettings: (cb) => ipcRenderer.on('lyric:openSettings', () => cb()),
});
