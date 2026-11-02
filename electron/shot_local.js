/* 端到端验证：本地音乐模块（扫描→媒体库→播放→歌词→EQ/可视化→进度→去重）
 * 自包含：本脚本即为 Electron 主进程，内部 spawn 后端子进程。
 * 运行：electron shot_local.js（在 electron/ 目录）
 */
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'app');
const TMP = path.join(ROOT, '.localdata_test');
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
fs.mkdirSync(TMP, { recursive: true });

const PORT = 3099;
const LOCALTEST = 'D:/文档/workbuddy/2026-10-17-12-08-41/localtest';

function startBackend() {
  const env = Object.assign({}, process.env, {
    PORT: String(PORT),
    UZZ_USER_DATA: TMP,
    UZZ_APP_DIR: APP_DIR,
  });
  const cp = spawn('node',
    [path.join(ROOT, 'server', 'index.js')],
    { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  cp.stdout.on('data', (d) => process.stdout.write('[backend] ' + d));
  cp.stderr.on('data', (d) => process.stderr.write('[backend-err] ' + d));
  return cp;
}

async function waitPort() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/`);
      if (r.ok) return true;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

app.whenReady().then(async () => {
  const backend = startBackend();
  const up = await waitPort();
  if (!up) {
    console.log('BACKEND_FAIL');
    backend.kill('SIGKILL');
    app.exit(1);
    return;
  }
  const win = new BrowserWindow({ show: false, width: 1280, height: 820 });
  const pageErrors = [];
  win.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) pageErrors.push(msg);
  });
  win.webContents.on('page-error', (_e, msg) => pageErrors.push('PAGE_ERR: ' + msg));

  await win.loadURL(`http://localhost:${PORT}/`);
  await new Promise((r) => setTimeout(r, 2500));

  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const out = { steps: {}, errors: [] };
      try {
        const scan = await UzzApi.localScan([${JSON.stringify(LOCALTEST)}]);
        out.steps.scan = scan;
        const tracks = await UzzApi.localLibrary('all');
        out.steps.libCount = tracks.length;
        out.steps.sample = tracks[0] ? {
          id: tracks[0].id, name: tracks[0].name, artist: tracks[0].artist,
          album: tracks[0].album, duration: tracks[0].duration, hasLrc: tracks[0].hasLrc,
          urlOk: /\\/api\\/local\\/stream\\?id=/.test(tracks[0].url || '')
        } : null;
        if (tracks[0]) {
          Player.loadAndPlay({
            id: tracks[0].id, name: tracks[0].name, artist: tracks[0].artist,
            album: tracks[0].album, pic: tracks[0].pic, vendor: 'local',
            url: tracks[0].url, duration: tracks[0].duration, replayGain: tracks[0].replayGain
          });
          const a = document.querySelector('audio');
          let dur = 0, played = false;
          for (let i = 0; i < 40; i++) {
            await new Promise((r) => setTimeout(r, 250));
            if (a && a.duration && a.duration > 0) dur = a.duration;
            if (a && !a.paused) played = true;
            if (dur > 0 && played) break;
          }
          out.steps.audioDuration = dur;
          out.steps.audioPlayed = played;
          out.steps.eqReady = window.Eq ? window.Eq.isReady() : 'no-eq';
          const fp = document.querySelector('#fpLyric');
          out.steps.lyricTextLen = fp ? (fp.textContent || '').trim().length : -1;
          await UzzApi.localSetProgress(tracks[0].id, 5);
          out.steps.progressOk = true;
          const dups = await UzzApi.localDuplicates();
          out.steps.dupGroups = Array.isArray(dups) ? dups.length : -1;
        }
      } catch (e) { out.errors.push(String(e && e.message || e)); }
      return out;
    })()
  `);

  result.pageErrors = pageErrors;
  console.log('LOCAL_TEST_RESULT:', JSON.stringify(result, null, 2));

  // 过滤掉 Electron 开发期 CSP 安全警告（打包后不出现，非真实错误）
  const realErrors = pageErrors.filter((m) => !/Security Warning|Content-Security-Policy|security risks/i.test(m));
  const ok = result.steps &&
    result.steps.libCount > 0 &&
    result.steps.audioDuration > 0 &&
    result.steps.progressOk === true &&
    result.errors.length === 0 &&
    realErrors.length === 0;
  console.log('REAL_PAGE_ERRORS:', realErrors.length);
  console.log(ok ? 'LOCAL_E2E_PASS' : 'LOCAL_E2E_FAIL');

  backend.kill('SIGKILL');
  app.exit(ok ? 0 : 1);
});
