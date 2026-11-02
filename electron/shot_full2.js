const { app, BrowserWindow } = require('electron');
const BASE = 'http://localhost:3000';
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, width: 1280, height: 800 });
    await win.loadURL(BASE);
    await new Promise((r) => setTimeout(r, 1500));
    const r = await win.webContents.executeJavaScript(`
      (async () => {
        try {
          Player.loadAndPlay({ id: '94281', name: '得到你的人却得不到你的心', artist: '欢子', vendor: 'netease', pic: '', album: '' });
          for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            const a = document.querySelector('audio');
            if (a && a.duration > 100 && a.src.includes('126.net') === false) {}
            if (a && a.duration > 100 && a.currentTime > 0.5 && !a.paused) return { dur: a.duration, cur: a.currentTime, paused: a.paused };
          }
          const a = document.querySelector('audio');
          return { dur: a ? a.duration : 0, cur: a ? a.currentTime : 0, paused: a ? a.paused : true };
        } catch (e) { return { err: String(e && e.message || e) }; }
      })()
    `);
    console.log('VIP2_PLAY:', JSON.stringify(r));
    console.log(r.dur > 200 && !r.paused ? 'VIP2_PASS' : 'VIP2_FAIL');
    app.exit(r.dur > 200 ? 0 : 1);
  } catch (e) { console.log('SCRIPT_ERR:', String(e)); app.exit(1); }
});
