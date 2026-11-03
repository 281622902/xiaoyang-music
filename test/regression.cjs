const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const ROOT = process.env.TEST_ROOT || path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoyang-regression-'));
process.env.UZZ_USER_DATA = tmp;
process.env.MOCK = '1';
const { server } = require(path.join(ROOT, 'server/index.js'));
const lib = require(path.join(ROOT, 'server/local-lib.js'));
let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log('PASS ' + name); }
  catch (e) { failures++; console.error('FAIL ' + name + ': ' + e.message); }
}
(async () => {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const session = await (await fetch(base + '/api/local/session')).json();
  const localHeaders = { 'X-Uzz-Local-Token': session.token };
  await check('local library rejects missing token and foreign origins', async () => {
    assert.equal((await fetch(base + '/api/local/library')).status, 403, 'missing token');
    assert.equal((await fetch(base + '/api/local/session', { headers: { Origin: 'https://foreign.example' } })).status, 403, 'foreign origin');
    const rebound = await new Promise((resolve,reject) => { http.get(base + '/api/local/session', { headers:{Host:'rebinding.example'} }, res => { res.resume(); resolve(res.statusCode); }).on('error',reject); });
    assert.equal(rebound, 403, 'DNS rebinding host');
    assert.equal((await fetch(base + '/api/local/library', { headers: localHeaders })).status, 200);
    assert.equal((await fetch(base + '/api/local/library', { headers: { 'X-Uzz-Local-Token': 'x'.repeat(64) } })).status, 403);
  });
  const audioDir = path.join(tmp, 'music'); fs.mkdirSync(audioDir);
  const wav = path.join(audioDir, 'short.wav');
  const data = Buffer.alloc(8044); data.write('RIFF'); data.writeUInt32LE(8036, 4);
  data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22); data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(8000, 40);
  fs.writeFileSync(wav, data); fs.writeFileSync(path.join(audioDir, 'other.wav'), data);
  await check('open individual short audio outside scanned folders', async () => {
    const r = await fetch(base + '/api/local/addFile?path=' + encodeURIComponent(wav), { headers: localHeaders });
    assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.track.path, wav);
    assert.equal(lib.getLibrary().length, 1, 'must import only the selected file');
  });
  await check('suffix Range returns final bytes', async () => {
    const s = http.createServer((req, res) => lib.stream(wav, req, res));
    s.listen(0, '127.0.0.1'); await once(s, 'listening');
    try {
      const r = await fetch('http://127.0.0.1:' + s.address().port, { headers: { Range: 'bytes=-10' } });
      assert.equal(r.status, 206); assert.equal((await r.arrayBuffer()).byteLength, 10);
      assert.equal(r.headers.get('content-range'), 'bytes 8034-8043/8044');
      const h = await fetch('http://127.0.0.1:' + s.address().port, { method: 'HEAD' });
      assert.equal(h.headers.get('content-type'), 'audio/wav');
      const bad = await fetch('http://127.0.0.1:' + s.address().port, { headers: { Range: 'bytes=9000-' } });
      assert.equal(bad.status, 416); assert.equal(bad.headers.get('content-range'), 'bytes */8044');
    } finally { s.closeAllConnections(); await new Promise(r => s.close(r)); }
  });
  await check('malformed static path returns 400 without crashing server', async () => {
    assert.equal((await fetch(base + '/%ZZ')).status, 400);
    assert.equal((await fetch(base + '/api/health')).status, 200);
  });
  await check('grouping supports album names matching Object properties', async () => {
    const t = lib.getLibrary()[0]; assert.ok(t);
    await lib.updateMeta(t.id, { album: '__proto__', artist: 'constructor' });
    assert.ok(lib.getLibrary('album').some(g => g.name === '__proto__' && g.tracks.length === 1));
    assert.ok(lib.getLibrary('artist').some(g => g.name === 'constructor' && g.tracks.length === 1));
  });
  await check('concurrent media changes preserve imported files and metadata', async () => {
    const first = lib.getLibrary()[0];
    await Promise.all([lib.addFile(path.join(audioDir, 'other.wav')), lib.updateMeta(first.id, { name: 'retained edit' })]);
    assert.equal(lib.getLibrary().length, 2);
    assert.equal(lib.getLibrary().find(t => t.id === first.id).name, 'retained edit');
  });
  await check('corrupt library recovers from the previous saved copy', () => {
    const fp = path.join(lib.dataDir(), 'library.json'); const original = fs.readFileSync(fp);
    try { fs.writeFileSync(fp, '{broken'); assert.ok(lib.getLibrary().length >= 1); }
    finally { fs.writeFileSync(fp, original); }
  });
  await check('disconnecting an audio proxy cancels its upstream fetch', async () => {
    let upstreamClosed;
    const closed = new Promise(r => upstreamClosed = r);
    let accepted;
    const ready = new Promise(r => accepted = r);
    const slow = http.createServer((req, res) => { res.once('close', upstreamClosed); accepted(); });
    slow.listen(0, '127.0.0.1'); await once(slow, 'listening');
    const upstream = 'http://127.0.0.1:' + slow.address().port;
    const client = http.get(base + '/api/stream?url=' + encodeURIComponent(upstream)); client.on('error', () => {});
    let timer;
    try {
      await ready; client.destroy();
      await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('upstream still running')), 2000); })]);
    } finally { clearTimeout(timer); client.destroy(); slow.closeAllConnections(); await new Promise(r => slow.close(r)); }
  });
  await check('disconnecting an active audio body keeps backend alive and closes upstream', async () => {
    let upstreamClosed;
    const closed = new Promise(resolve => { upstreamClosed = resolve; });
    const source = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.write(Buffer.alloc(65536));
      const interval = setInterval(() => res.write(Buffer.alloc(65536)), 5);
      res.once('close', () => { clearInterval(interval); upstreamClosed(); });
    });
    source.listen(0, '127.0.0.1'); await once(source, 'listening');
    let client, timer;
    try {
      await new Promise((resolve, reject) => {
        client = http.get(base + '/api/stream?url=' + encodeURIComponent('http://127.0.0.1:' + source.address().port), response => {
          response.once('data', () => { response.destroy(); client.destroy(); resolve(); });
          response.on('error', () => {});
        });
        client.once('error', reject);
        timer = setTimeout(() => reject(new Error('audio body did not arrive')), 2000);
      });
      clearTimeout(timer);
      await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('audio upstream was not canceled')), 2000); })]);
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal((await fetch(base + '/api/health')).status, 200);
    } finally { clearTimeout(timer); client?.destroy(); source.closeAllConnections(); await new Promise(resolve => source.close(resolve)); }
  });
  let pw; try { pw = require('playwright'); } catch { pw = require(path.join(ROOT, 'electron/node_modules/playwright')); }
  const browser = await pw.chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined, headless: true });
  try {
    const lp = await browser.newPage({ viewport: { width: 700, height: 340 } });
    await lp.addInitScript(() => {
      window.__sent = []; window.__handlers = {};
      window.require = () => ({ ipcRenderer: { send: (ch, v) => __sent.push([ch, v]), on: (ch, cb) => __handlers[ch] = cb } });
    });
    await lp.goto(require('node:url').pathToFileURL(path.join(ROOT, 'electron/lyric.html')).href);
    await lp.waitForTimeout(150);
    await check('desktop lyrics occupy bottom of transparent window', async () => {
      const y = await lp.evaluate(() => { __handlers['lyric:payload']({}, { cur: '桌面歌词测试', next: '下一句' }); return document.getElementById('lyricBox').getBoundingClientRect().bottom; });
      assert.ok(y > 300 && y <= 340, 'lyric bottom is ' + y);
    });
    await check('play/pause state payload keeps visible lyric text', async () => {
      const txt = await lp.evaluate(() => { __handlers['lyric:payload']({}, { keep: true, playing: false, cur: '', next: '' }); return document.getElementById('cur').textContent; });
      assert.equal(txt, '桌面歌词测试');
    });
    await check('lock synchronization neither echoes nor opens main window', async () => {
      const sent = await lp.evaluate(() => { __sent.length = 0; __handlers['lyric:locked']({}, true); return __sent; });
      assert.equal(sent.filter(x => x[0] === 'lyric:setLocked' || x[0] === 'lyric:showMain').length, 0);
    });
    await check('style and menu agree on double-line setting', async () => {
      const single = await lp.evaluate(() => {
        __handlers['lyric:locked']({}, false);
        __handlers['lyric:style']({}, { layout: 'single', gradient: true, size: 30 });
        document.getElementById('bSet').click(); document.querySelector('[data-k="doubleMode"]').click();
        return document.body.classList.contains('single');
      }); assert.equal(single, false);
    });
    await check('lyric controls stay reachable and transparent blank stays outside hits', async () => {
      const result = await lp.evaluate(() => {
        __handlers['lyric:locked']({}, false);
        const b = document.getElementById('bar').getBoundingClientRect();
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: b.x + 20, clientY: b.y + 15 }));
        return { opacity: getComputedStyle(document.getElementById('bar')).opacity, rect: b.toJSON() };
      }); await lp.waitForTimeout(220);
      assert.equal(await lp.evaluate(() => getComputedStyle(document.getElementById('bar')).opacity), '1');
      assert.ok(result.rect.x >= 0 && result.rect.right <= 700);
    });
    await check('toolbar follows single and double lyrics with an 8px gap at different scales', async () => {
      for (const scale of [1, 1.25, 1.5]) {
        const context = await browser.newContext({ viewport: { width: 700, height: 340 }, deviceScaleFactor: scale });
        const p = await context.newPage();
        await p.addInitScript(() => { window.handlers = {}; window.require = () => ({ ipcRenderer: { send() {}, on: (ch, fn) => handlers[ch] = fn } }); });
        await p.goto(require('node:url').pathToFileURL(path.join(ROOT, 'electron/lyric.html')).href);
        for (const layout of ['single', 'double']) {
          await p.evaluate(layout => { handlers['lyric:payload']({}, { cur: '测试歌词', next: '下一句' }); handlers['lyric:style']({}, { size: 32, layout }); }, layout);
          await p.waitForTimeout(80);
          const gap = await p.evaluate(() => document.getElementById('lyricBox').getBoundingClientRect().top - document.getElementById('bar').getBoundingClientRect().bottom);
          assert.ok(Math.abs(gap-8)<1, `scale ${scale} layout ${layout} gap=${gap}`);
        }
        await context.close();
      }
    });
    await check('locking closes menu and hides toolbar even on hover', async () => {
      await lp.evaluate(() => { document.getElementById('bSet').click(); __handlers['lyric:locked']({}, true); });
      await lp.mouse.move(350, 280); await lp.waitForTimeout(80);
      const state = await lp.evaluate(() => ({ opacity: getComputedStyle(document.getElementById('bar')).opacity,
        events: getComputedStyle(document.getElementById('bar')).pointerEvents, menu: getComputedStyle(document.getElementById('menu')).display }));
      assert.deepEqual(state, { opacity: '0', events: 'none', menu: 'none' });
    });
    if (process.env.SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
      await lp.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'desktop-lyrics.png'), omitBackground: true });
    }
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/vendor/supabase.min.js', route => route.abort());
    await page.route('**/api/**', route => route.fulfill({ json: { code: 200, tracks: [], list: [], hot: [], charts: [], info: {} } }));
    await page.goto(base); await page.waitForFunction(() => window.Player && window.UzzApi);
    await page.evaluate(() => {
      window.Eq = null; const a = document.getElementById('audio');
      a.play = async () => {}; a.pause = () => {}; a.load = () => {};
      UzzApi.localLyric = async () => ({ lyric: '' }); UzzApi.getLyricEx = async () => ({ lyric: '', tlyric: '' });
    });
    await check('source fallback preserves original song identity', async () => {
      const vendor = await page.evaluate(async () => {
        UzzApi.getSong = async t => ({ ...t, vendor: 'kuwo', url: 'https://example.test/b.mp3', lyric: '[00:01]B' });
        await Player.loadAndPlay({ id: 'B', name: 'B', vendor: 'netease' }); return Player.getState().current.vendor;
      }); assert.equal(vendor, 'netease');
    });
    await check('repeated click while resolving never reuses previous source', async () => {
      const src = await page.evaluate(async () => {
        UzzApi.getSong = t => new Promise(resolve => window.__resolve = () => resolve({ ...t, url: 'https://example.test/c.mp3', lyric: '[00:01]C' }));
        const t = { id: 'C', name: 'C', vendor: 'netease' };
        window.__loading = Player.loadAndPlay(t); await Promise.resolve();
        Player.loadAndPlay(t); return document.getElementById('audio').getAttribute('src');
      }); assert.ok(!src, 'previous source still present: ' + src);
      await page.evaluate(async () => { __resolve(); await __loading; });
    });
    await check('clear queue cancels in-flight playback', async () => {
      const state = await page.evaluate(async () => {
        UzzApi.getSong = t => new Promise(resolve => window.__resolve2 = () => resolve({ ...t, url: 'https://example.test/d.mp3', lyric: '[00:01]D' }));
        const pending = Player.loadAndPlay({ id: 'D', name: 'D', vendor: 'netease' });
        document.getElementById('queueClear').click(); __resolve2(); await pending;
        return { current: Player.getState().current, queue: Player.getQueue().length, src: document.getElementById('audio').getAttribute('src') };
      }); assert.equal(state.current, null); assert.equal(state.queue, 0); assert.ok(!state.src);
    });
    await check('local favorite/history remains playable with missing URL', async () => {
      const src = await page.evaluate(async () => {
        await Player.loadAndPlay({ id: 'localX', vendor: 'local', name: '本地测试' });
        return document.getElementById('audio').getAttribute('src');
      }); assert.equal(src, '/api/local/stream?id=localX');
    });
    await check('online track clears previous CUE boundary and pending seek', async () => {
      const state = await page.evaluate(async () => {
        const st = Player.getState(); st.cueEnd = 20; st.pendingSeek = 10; st.tlyrics = [{ t: 1, text: 'old translation' }];
        UzzApi.getSong = async t => ({ ...t, url: 'https://example.test/e.mp3', lyric: '[00:01]E' });
        await Player.loadAndPlay({ id: 'E', name: 'E', vendor: 'netease' });
        return { cueEnd: st.cueEnd, pendingSeek: st.pendingSeek };
      }); assert.equal(state.cueEnd, 0); assert.equal(state.pendingSeek, 0);
    });
    await check('enqueue history does not resolve or start every song', async () => {
      const calls = await page.evaluate(async () => {
        let calls = 0; UzzApi.getSong = async t => { calls++; return t; };
        await Player.loadAndPlay({ id: 'quiet1', name: 'Q1', vendor: 'netease' }, { quiet: true });
        await Player.loadAndPlay({ id: 'quiet2', name: 'Q2', vendor: 'netease' }, { quiet: true });
        return calls;
      }); assert.equal(calls, 0);
    });
    await check('favorite all is idempotent and preserves existing favorites', async () => {
      const ids = await page.evaluate(() => {
        const q = Player.getQueue(); Player.toggleFav(q[0]);
        document.getElementById('queueFavAll').click();
        document.getElementById('queueFavAll').click();
        return { fav: Player.getFavorites().map(t => t.id).sort(), queue: q.map(t => t.id).sort() };
      }); assert.deepEqual(ids.fav, ids.queue);
    });
    await check('queue replacement deduplicates tracks and preserves local CUE fields', async () => {
      const state = await page.evaluate(async () => {
        const track=UzzApi.normalizeTrack({id:'local-cue#1',vendor:'local',name:'cue',audioId:'local-cue',cueStart:2,cueEnd:10,url:'/api/local/stream?id=local-cue'});
        await Player.playQueue([track,track,{id:'next-cue',vendor:'local',name:'next',url:'/api/local/stream?id=next-cue'}]);
        return {length:Player.getQueue().length,start:Player.getState().current.cueStart,audioId:Player.getState().current.audioId};
      }); assert.deepEqual(state,{length:2,start:2,audioId:'local-cue'});
    });
    await check('audio proxy uses configured backend address', async () => {
      const src = await page.evaluate(async () => {
        localStorage.setItem('uzz.apiBase', 'https://backend.example.test');
        UzzApi.getSong = async t => ({ ...t, url: 'https://cdn.example.test/song.mp3', lyric: '[00:01]test' });
        await Player.loadAndPlay({ id: 'remote', name: 'remote', vendor: 'netease' });
        return document.getElementById('audio').getAttribute('src');
      }); assert.ok(src.startsWith('https://backend.example.test/api/stream?'));
    });
    await check('switching tracks aborts the previous HTTP playback request', async () => {
      await page.addScriptTag({ path: path.join(ROOT, 'app/js/api.js') });
      const canceled = await page.evaluate(async () => {
        Player.clearQueue(); localStorage.removeItem('uzz.apiBase');
        let canceled = 0;
        const original = window.fetch;
        window.fetch = (url, options) => {
          if (!String(url).includes('/api/song')) return original(url, options);
          if (String(url).includes('id=slow')) return new Promise((resolve,reject) => options.signal.addEventListener('abort', () => { canceled++; reject(new DOMException('Aborted','AbortError')); }, {once:true}));
          return Promise.resolve(new Response(JSON.stringify({ code: 200, data: { id:'fast', vendor:'netease', url:'https://example.test/f.mp3', lyric:'[00:00]fast' } }), { headers:{'Content-Type':'application/json'} }));
        };
        UzzApi.getLyricEx = async () => ({ lyric:'',tlyric:'' });
        const first = Player.loadAndPlay({ id:'slow',vendor:'netease',name:'slow' });
        await Promise.resolve(); await Player.loadAndPlay({ id:'fast',vendor:'netease',name:'fast' }); await first;
        window.fetch=original; return canceled;
      }); assert.equal(canceled,1);
    });
    await check('UI has no uncaught JavaScript errors', () => assert.deepEqual(errors, []));
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'main-window.png') });
  } finally { await browser.close(); }
})().catch(e => { failures++; console.error(e); }).finally(async () => {
  lib.stopWatch(); server.closeAllConnections(); await new Promise(r => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exitCode = failures ? 1 : 0;
});
