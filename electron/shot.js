/* shot.js — 无头加载页面截图，验证桌面版渲染（v2 新功能验证） */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');

const URL = process.env.SHOT_URL || 'http://localhost:35220/';
const OUT = process.env.SHOT_OUT || 'D:/文档/workbuddy/2026-10-17-12-08-41/uzz-player/electron/shot_home.png';

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1180, height: 760, show: false,
    webPreferences: { offscreen: true },
  });
  win.webContents.on('console-message', (e, level, msg) => {
    if (level >= 3) console.log('CONSOLE_ERR ' + msg.slice(0, 200));
  });
  await win.loadURL(URL);
  await new Promise((r) => setTimeout(r, 2500));

  /* ── 1. 推荐页（banner + 推荐歌单宫格） ── */
  await new Promise((r) => setTimeout(r, 2500)); // 等推荐歌单加载
  const rec = await win.webContents.executeJavaScript(`JSON.stringify({
    banners: document.querySelectorAll('#bannerRow .banner').length,
    plCards: document.querySelectorAll('#plGrid .pl-card').length,
    firstPl: (document.querySelector('#plGrid .plc-name') || {}).textContent || '',
    brand: (document.querySelector('.brand-name') || {}).textContent,
    navTexts: [...document.querySelectorAll('#sideNav button')].map(b => b.textContent.trim())
  })`);
  console.log('RECOMMEND::' + rec);
  let img = await win.webContents.capturePage();
  fs.writeFileSync(OUT, img.toPNG());

  /* ── 2. 搜索建议浮层 ── */
  const sg = await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('searchInput').focus();
    await new Promise(r => setTimeout(r, 2500));
    return JSON.stringify({
      visible: !document.getElementById('suggestBox').classList.contains('hidden'),
      hotCount: document.querySelectorAll('#sgHot li').length,
      guessCount: document.querySelectorAll('#sgGuessChips button').length
    });
  })()`);
  console.log('SUGGEST::' + sg);
  img = await win.webContents.capturePage();
  fs.writeFileSync(OUT.replace('_home', '_suggest'), img.toPNG());
  await win.webContents.executeJavaScript("document.body.click(); 'ok'");

  /* ── 3. 搜索结果 ── */
  const sr = await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('searchInput').value = '晴天';
    document.getElementById('searchBtn').click();
    await new Promise(r => setTimeout(r, 3500));
    return JSON.stringify({
      songCount: document.querySelectorAll('#resultList .song').length,
      first: (document.querySelector('#resultList .song .name') || {}).textContent || ''
    });
  })()`);
  console.log('SEARCH::' + sr);
  img = await win.webContents.capturePage();
  fs.writeFileSync(OUT.replace('_home', '_search'), img.toPNG());

  /* ── 4. 播放一首（真实出声 + 桌面歌词通道） ── */
  const pr = await win.webContents.executeJavaScript(`(async () => {
    const li = document.querySelector('#resultList .song');
    li.click();
    await new Promise(r => setTimeout(r, 6000));
    return JSON.stringify({
      fullHidden: document.getElementById('fullPlayer').classList.contains('hidden'),
      song: (document.getElementById('fpSong') || {}).textContent,
      artist: (document.getElementById('fpArtist') || {}).textContent,
      vinylPlaying: document.getElementById('vinylDisc').classList.contains('playing'),
      lyricLines: document.querySelectorAll('#fpLyric p').length,
      coverShown: (document.getElementById('miniCover') || {}).src ? true : false
    });
  })()`);
  console.log('PLAYER::' + pr);
  await win.webContents.executeJavaScript('Player.openFull(); "opened"');
  await new Promise((r) => setTimeout(r, 1200));
  img = await win.webContents.capturePage();
  fs.writeFileSync(OUT.replace('_home', '_play'), img.toPNG());

  /* ── 5. 新建歌单 + 加入歌单 + 歌单视图 ── */
  const plr = await win.webContents.executeJavaScript(`(async () => {
    // 直接调内部流程：模拟点击新建歌单
    document.getElementById('btnNewPlaylist').click();
    document.getElementById('plModalName').value = '我的测试歌单';
    document.getElementById('plModalOk').click();
    await new Promise(r => setTimeout(r, 300));
    const navCount = document.querySelectorAll('#playlistNav li').length;
    // 打开歌单
    document.querySelector('#playlistNav li').click();
    await new Promise(r => setTimeout(r, 300));
    const plName = (document.getElementById('plpName') || {}).textContent;
    return JSON.stringify({ navCount, plName, viewVisible: !document.getElementById('viewPlaylist').classList.contains('hidden') });
  })()`);
  console.log('PLAYLIST::' + plr);

  /* ── 6. 主题切换 ── */
  const th = await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('#accentSwatches button[data-accent="#2f7ae5"]').click();
    await new Promise(r => setTimeout(r, 300));
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    document.querySelector('#themeMode button[data-mode="light"]').click();
    await new Promise(r => setTimeout(r, 300));
    const theme = document.documentElement.dataset.theme;
    return JSON.stringify({ accent, theme });
  })()`);
  console.log('THEME::' + th);
  img = await win.webContents.capturePage();
  fs.writeFileSync(OUT.replace('_home', '_light'), img.toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('#themeMode button[data-mode="dark"]').click(); 'ok'`);

  console.log('SHOTS_DONE');
  app.quit();
}).catch((e) => { console.error('ERR', e); app.quit(1); });
