/* shot_tabs.js — 验证搜索「歌手/专辑/歌单」标签点击行为（bug 修复验证） */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');

const URL = process.env.SHOT_URL || 'http://localhost:3000/';
const OUT = 'D:/文档/workbuddy/2026-10-17-12-08-41/uzz-player/electron/shot_tabs.png';

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1180, height: 760, show: false,
    webPreferences: { offscreen: true },
  });
  win.webContents.on('console-message', (e, level, msg) => {
    if (level >= 3) console.log('CONSOLE_ERR ' + msg.slice(0, 200));
  });
  await win.loadURL(URL);
  await new Promise((r) => setTimeout(r, 3000));

  /* ── 1. 搜「欢子」→ 切「歌手」标签 → 实体行渲染 ── */
  const artistTab = await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('searchInput').value = '欢子';
    document.getElementById('searchBtn').click();
    await new Promise(r => setTimeout(r, 3500));
    document.querySelector('#tabs button[data-type="artist"]').click();
    await new Promise(r => setTimeout(r, 3500));
    const rows = document.querySelectorAll('#resultList .song.entity[data-etype="artist"]');
    return JSON.stringify({
      rowCount: rows.length,
      firstName: (rows[0] && rows[0].dataset.name) || '',
      firstId: (rows[0] && rows[0].dataset.id) || ''
    });
  })()`);
  console.log('ARTIST_TAB::' + artistTab);

  /* ── 2. 点歌手行 → 进入歌手热门歌曲视图 ── */
  const artistView = await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('#resultList .song.entity[data-etype="artist"]').click();
    await new Promise(r => setTimeout(r, 4500));
    return JSON.stringify({
      viewVisible: !document.getElementById('viewPlaylist').classList.contains('hidden'),
      name: (document.getElementById('plpName') || {}).textContent,
      stats: (document.getElementById('plpStats') || {}).textContent,
      tracks: document.querySelectorAll('#plpTracks .song').length,
      firstSong: (document.querySelector('#plpTracks .song .name') || {}).textContent || ''
    });
  })()`);
  console.log('ARTIST_VIEW::' + artistView);
  let img = await win.webContents.capturePage();
  fs.writeFileSync(OUT.replace('_tabs', '_artist'), img.toPNG());

  /* ── 3. 回搜索 → 专辑标签 → 点专辑行 → 专辑曲目视图 ── */
  const albumFlow = await win.webContents.executeJavaScript(`(async () => {
    // 返回搜索视图
    document.getElementById('searchInput').focus();
    await new Promise(r => setTimeout(r, 300));
    document.querySelector('#tabs button[data-type="album"]').click();
    await new Promise(r => setTimeout(r, 3500));
    const rows = document.querySelectorAll('#resultList .song.entity[data-etype="album"]');
    const first = { name: (rows[0] && rows[0].dataset.name) || '', id: (rows[0] && rows[0].dataset.id) || '' };
    if (!rows.length) return JSON.stringify({ rowCount: 0 });
    rows[0].click();
    await new Promise(r => setTimeout(r, 4500));
    return JSON.stringify({
      rowCount: rows.length,
      clickedAlbum: first.name,
      viewName: (document.getElementById('plpName') || {}).textContent,
      stats: (document.getElementById('plpStats') || {}).textContent,
      tracks: document.querySelectorAll('#plpTracks .song').length
    });
  })()`);
  console.log('ALBUM_FLOW::' + albumFlow);
  img = await win.webContents.capturePage();
  fs.writeFileSync(OUT.replace('_tabs', '_album'), img.toPNG());

  /* ── 4. 回搜索 → 歌单标签 → 点歌单行 → 在线歌单详情 ── */
  const plFlow = await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('searchInput').focus();
    await new Promise(r => setTimeout(r, 300));
    document.querySelector('#tabs button[data-type="playlist"]').click();
    await new Promise(r => setTimeout(r, 3500));
    const rows = document.querySelectorAll('#resultList .song.entity[data-etype="playlist"]');
    if (!rows.length) return JSON.stringify({ rowCount: 0 });
    const first = rows[0].dataset.name;
    rows[0].click();
    await new Promise(r => setTimeout(r, 6000));
    return JSON.stringify({
      rowCount: rows.length,
      clickedPl: first,
      viewName: (document.getElementById('plpName') || {}).textContent,
      tracks: document.querySelectorAll('#plpTracks .song').length
    });
  })()`);
  console.log('PLAYLIST_FLOW::' + plFlow);
  img = await win.webContents.capturePage();
  fs.writeFileSync(OUT.replace('_tabs', '_playlist'), img.toPNG());

  /* ── 5. 回到单曲标签确认仍正常渲染歌曲行 ── */
  const songTab = await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('searchInput').focus();
    await new Promise(r => setTimeout(r, 300));
    document.querySelector('#tabs button[data-type="song"]').click();
    await new Promise(r => setTimeout(r, 3500));
    return JSON.stringify({
      songRows: document.querySelectorAll('#resultList .song:not(.entity)').length,
      entityRows: document.querySelectorAll('#resultList .song.entity').length
    });
  })()`);
  console.log('SONG_TAB::' + songTab);

  console.log('TABS_DONE');
  app.quit();
}).catch((e) => { console.error('ERR', e); app.quit(1); });
