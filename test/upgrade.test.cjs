const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { launchInstaller } = require('../electron/installer-launcher');
const { audioExtension } = require('../server/audio-format');
const access = require('../server/local-access');
test('installer launch preserves a Unicode path and shows the interactive wizard', async () => {
  const exe = 'D:\\安装 包 & 资料\\小杨音乐 Setup 2.14.0.exe'; let call;
  await launchInstaller(exe, (...args) => {
    call=args; const child=new EventEmitter();child.unref=()=>{};
    queueMicrotask(()=>child.emit('spawn')); return child;
  });
  assert.equal(call[0],exe);assert.deepEqual(call[1],[]);assert.equal(call[2].shell,undefined);
  assert.equal(call[2].windowsHide,false);
});
test('failed installer launch rejects so the running application can remain open', async () => {
  await assert.rejects(launchInstaller('missing.exe', () => {
    const child=new EventEmitter();queueMicrotask(()=>child.emit('error',new Error('spawn failed')));return child;
  }), /spawn failed/);
});
test('local capabilities cannot be used by a foreign web origin', () => {
  const req={headers:{host:'localhost:35211',origin:'https://other.example','x-uzz-local-token':access.token},socket:{remoteAddress:'127.0.0.1'}};
  assert.equal(access.authorize(req,'/api/local/scan'),false);
});
test('media access rejects cross-site requests and non-loopback peers', () => {
  assert.equal(access.authorize({headers:{host:'localhost:35211','sec-fetch-site':'cross-site'},socket:{remoteAddress:'127.0.0.1'}},'/api/local/stream'),false);
  assert.equal(access.authorize({headers:{host:'localhost:35211'},socket:{remoteAddress:'192.0.2.1'}},'/api/local/session'),false);
});
test('malformed multi-byte tokens are rejected without throwing', () => {
  assert.equal(access.authorize({headers:{host:'localhost:35211','x-uzz-local-token':'中'.repeat(64)},socket:{remoteAddress:'127.0.0.1'}},'/api/local/scan'),false);
});
test('lossless download content uses its actual format rather than mp3 extension', () => {
  assert.equal(audioExtension('audio/flac; charset=binary','https://example.test/file.mp3'),'.flac');
  assert.equal(audioExtension('audio/mp4','https://example.test/file'),'.m4a');
});
test('opaque download types accept only known audio filename extensions', () => {
  assert.equal(audioExtension('application/octet-stream','https://example.test/song.wav?x=1'),'.wav');
  assert.equal(audioExtension('application/octet-stream','https://example.test/file.exe'),'.mp3');
});
test('installer config enables final-page choices without premature desktop shortcut creation', () => {
  const p=require('../electron/package.json');const fs=require('node:fs');const path=require('node:path');
  assert.equal(p.build.nsis.oneClick,false);assert.equal(p.build.nsis.createDesktopShortcut,false);
  const source=fs.readFileSync(path.join(__dirname,'../electron',p.build.nsis.include),'utf8');
  assert.match(source,/customCheckAppRunning/);assert.match(source,/MUI_FINISHPAGE_RUN_FUNCTION/);
  assert.match(source,/MUI_FINISHPAGE_SHOWREADME_FUNCTION/);
});
