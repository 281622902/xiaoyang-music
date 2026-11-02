/* 端到端验证：VIP 歌播放是否为完整版（audio.duration 应 > 200s 而非 30s） */
const { app, BrowserWindow } = require('electron');

const BASE = 'http://localhost:3000';

async function playCheck(win, track, ms) {
  const r = await win.webContents.executeJavaScript(`
    (async () => {
      try {
        Player.loadAndPlay(${JSON.stringify(track)});
        await new Promise((r) => setTimeout(r, ${ms}));
        const a = document.querySelector('audio');
        return { dur: a ? a.duration : 0, cur: a ? a.currentTime : 0, paused: a ? a.paused : true };
      } catch (e) { return { err: String(e && e.message || e) }; }
    })()
  `);
  return r;
}

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, width: 1280, height: 800 });
    const errs = [];
    win.webContents.on('console-message', (_e, level, msg) => {
      if (level >= 2) errs.push(msg);
    });
    await win.loadURL(BASE);
    await new Promise((r) => setTimeout(r, 2000));

    const r1 = await playCheck(win, { id: '94240', name: '心痛2009', artist: '欢子', vendor: 'netease', pic: '', album: '' }, 9000);
    console.log('VIP_PLAY:', JSON.stringify(r1));
    const r2 = await playCheck(win, { id: '94281', name: '得到你的人却得不到你的心', artist: '欢子', vendor: 'netease', pic: '', album: '' }, 9000);
    console.log('VIP2_PLAY:', JSON.stringify(r2));

    const pass = r1.dur > 200 && r2.dur > 200 && !r1.paused && !r2.paused;
    console.log(pass ? 'FULL_VERSION_PASS' : 'FULL_VERSION_FAIL');
    if (errs.length) console.log('CONSOLE_ERRS:', errs.slice(0, 3).join(' | '));
    app.exit(pass ? 0 : 1);
  } catch (e) {
    console.log('SCRIPT_ERR:', String(e && e.message || e));
    app.exit(1);
  }
});
