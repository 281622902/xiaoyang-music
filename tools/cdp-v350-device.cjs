// v3.5.0 真机（MuMu）回归 —— 重点验证安卓原生能力：设备指纹、桌面歌词、授权门禁、页面差异化
// 用法：CDP_PORT=9334 node tools/cdp-v350-device.cjs
const http = require('http');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CDP_PORT = process.env.CDP_PORT || '9334';
const listTargets = () => new Promise((res, rej) => http.get(`http://127.0.0.1:${CDP_PORT}/json/list`, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } }); }).on('error', rej));

(async () => {
  const t = (await listTargets()).find(x => x.type === 'page');
  if (!t) { console.log(JSON.stringify({ error: 'no page target' })); process.exit(1); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); const logs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('ERR: ' + (m.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 200));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + ((m.params.exceptionDetails && m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text || '').slice(0, 200));
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p(m.result); }
  };
  const send = (m, p) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method: m, params: p })); });
  const val = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r && r.result && r.result.value; };
  const json = async e => { try { return JSON.parse(await val(e) || '{}'); } catch { return {}; } };
  await send('Runtime.enable'); await send('Page.enable');

  const out = { pass: [], fail: [], warn: [] };
  const check = (name, ok, detail) => (ok ? out.pass : out.fail).push(name + (detail ? ' — ' + detail : ''));
  const note = (name, detail) => out.warn.push(name + (detail ? ' — ' + detail : ''));

  // ── 0. 环境自检：是不是安卓原生 ──
  // 先把后端指向本机（adb reverse tcp:3000 → 宿主机 3112），公网 Render 还没发 v3.5.0
  await val(`localStorage.setItem('uzz.apiBase','http://localhost:3000');1`);
  const env = await json(`JSON.stringify({
    ua: navigator.userAgent,
    isAndroid: !!(window.XYNative && window.XYNative.isAndroid),
    hasDeviceAuth: !!(window.XYDeviceAuth),
    version: window.XYCloud?.appVersion,
    hasOverlay: !!(window.XYNative?.NativeMusic?.lyricOverlay)
  })`);
  check('运行在安卓原生壳里', env.isAndroid === true, JSON.stringify(env));
  check('版本号为 3.5.0', env.version === '3.5.0', String(env.version));
  check('桌面歌词原生能力已注册', env.hasOverlay === true, JSON.stringify(env));

  // ── 1. 设备指纹（原生） ──
  const dev = await json(`(async()=>{try{
    const p=window.XYNative?.DeviceAuth;
    const r=await p.deviceId();
    const v=await p.appVersion();
    return JSON.stringify({id:r.deviceId, androidId:r.androidId, pkg:r.packageName, signer:(r.signer||'').slice(0,16), ver:v.version, code:v.versionCode});
  }catch(e){return JSON.stringify({err:String(e)})}})()`);
  check('原生设备指纹可取到', /^[0-9a-f]{16}$/.test(dev.id || ''), JSON.stringify(dev));
  check('设备指纹含 ANDROID_ID / 包名 / 签名', !!dev.androidId && dev.pkg === 'com.xiaoyang.musicplayer' && !!dev.signer, JSON.stringify(dev));
  check('原生版本号与构建一致', dev.ver === '3.5.0' && Number(dev.code) === 3005000, JSON.stringify(dev));

  // ── 2. 授权门禁：状态查询 ──
  const auth = await json(`(async()=>{try{
    const s=await window.XYDeviceAuth.status();
    return JSON.stringify({authorized:s.authorized, service:s.service, deviceId:(s.deviceId||'').slice(0,16)});
  }catch(e){return JSON.stringify({err:String(e)})}})()`);
  check('授权状态接口可调通', auth.err === undefined, JSON.stringify(auth));
  note('当前授权状态', JSON.stringify(auth));

  // ── 3. 授权码校验：错误码必须被拒 ──
  const bad = await json(`(async()=>{try{
    const r=await window.XYDeviceAuth.verify('XY3.5.0-XXXX-XXXX-XXXX');
    return JSON.stringify({ok:r.ok, msg:r.msg});
  }catch(e){return JSON.stringify({err:String(e)})}})()`);
  check('错误授权码被服务端拒绝', bad.ok === false && !!bad.msg, JSON.stringify(bad));

  // ── 3b. 授权全流程：服务端签发 → 设备校验 → 状态变已授权 → 换设备码失效 ──
  {
    const issued = await (async () => {
      const http = require('http');
      const body = JSON.stringify({ deviceId: dev.id, version: '3.5.0', platform: 'android', note: 'mumu-device-test' });
      return new Promise(res => {
        const req = http.request({ host: '127.0.0.1', port: 3112, path: '/api/auth/license/issue', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Token': process.env.XY_ADMIN_TOKEN || 'test-token', 'Content-Length': Buffer.byteLength(body) } },
          r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch { res({}); } }); });
        req.on('error', () => res({})); req.write(body); req.end();
      });
    })();
    check('服务端可为该设备签发授权码', !!(issued.code && String(issued.code).startsWith('XY3.5.0-')), JSON.stringify(issued).slice(0, 200));

    const verified = await json(`(async()=>{try{
      const r=await window.XYDeviceAuth.verify(${JSON.stringify(issued.code || 'X')});
      return JSON.stringify({ok:r.ok, msg:r.msg});
    }catch(e){return JSON.stringify({err:String(e)})}})()`);
    check('设备用正确授权码可激活', verified.ok === true, JSON.stringify(verified));

    const after = await json(`(async()=>{try{const s=await window.XYDeviceAuth.status();return JSON.stringify({authorized:s.authorized,service:s.service})}catch(e){return JSON.stringify({err:String(e)})}})()`);
    check('激活后状态变为已授权', after.authorized === true, JSON.stringify(after));

    // 别的设备拿同一个码 → 必须失败（码与设备绑定）
    const stolen = await (async () => {
      const http = require('http');
      const body = JSON.stringify({ code: issued.code, deviceId: 'ffffffffffffffff', version: '3.5.0' });
      return new Promise(res => {
        const req = http.request({ host: '127.0.0.1', port: 3112, path: '/api/auth/license/verify', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
          r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch { res({}); } }); });
        req.on('error', () => res({})); req.write(body); req.end();
      });
    })();
    check('同一授权码在别的设备上失效', stolen.ok === false, JSON.stringify(stolen));

    // 旧版本码在新版本上失效
    const oldVer = await (async () => {
      const http = require('http');
      const body = JSON.stringify({ deviceId: dev.id, version: '3.4.0', platform: 'android', note: 'old-version-test' });
      return new Promise(res => {
        const req = http.request({ host: '127.0.0.1', port: 3112, path: '/api/auth/license/issue', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Token': process.env.XY_ADMIN_TOKEN || 'test-token', 'Content-Length': Buffer.byteLength(body) } },
          r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch { res({}); } }); });
        req.on('error', () => res({})); req.write(body); req.end();
      });
    })();
    const oldTry = await json(`(async()=>{try{const r=await window.XYDeviceAuth.verify(${JSON.stringify(oldVer.code || 'X')});return JSON.stringify({ok:r.ok,msg:r.msg})}catch(e){return JSON.stringify({err:String(e)})}})()`);
    check('旧版本授权码在 v3.5.0 上失效', oldTry.ok === false && /版本/.test(oldTry.msg || ''), JSON.stringify(oldTry));
  }

  // ── 4. 桌面歌词开关（原生路径） ──
  await val(`location.hash='#settings'`); await sleep(1500);
  await val(`document.getElementById('rowMobileLyric').click();1`); await sleep(3000);
  const mly = await json(`JSON.stringify({
    toast: document.getElementById('toast')?.textContent||'',
    val: document.getElementById('valMobileLyric')?.textContent||''
  })`);
  check('桌面歌词开关在真机可切换', mly.val === '已开启' || mly.val === '关闭', JSON.stringify(mly));
  note('桌面歌词开关结果', JSON.stringify(mly));

  // ── 5. 六页差异化结构（真机渲染） ──
  const pages = {
    discover: ['.quick-orbs', '#hotArtists .artist-chip'],
    search: ['#hotSearches .hot-cloud, #hotSearches', '.sticky-types'],
    notes: ['#notesTimeline', '#notesGrid .note-card'],
    library: ['#libraryStats .lib-stat', '#libraryTabs [data-library]'],
    me: ['#meLevelBar', '#meRecent'],
    settings: ['.settings-card .st-label', '#rowDeviceAuth'],
  };
  for (const [id, sels] of Object.entries(pages)) {
    await val(`location.hash='#${id}'`); await sleep(1600);
    const r = await json(`JSON.stringify(${JSON.stringify(sels)}.map(s=>document.querySelectorAll(s).length))`);
    check(`${id} 页差异化结构就位`, r.every(n => n > 0), JSON.stringify(r));
  }

  // ── 6. 搜索：歌手匹配 + 封面直出 ──
  await val(`location.hash='#search'`); await sleep(1200);
  await val(`document.getElementById('mobileSearchInput').value='晴天 周杰伦';document.getElementById('mobileSearchForm').dispatchEvent(new Event('submit',{cancelable:true}));1`);
  await sleep(9000);
  const s = await json(`JSON.stringify({
    sum: document.getElementById('searchSummary')?.textContent||'',
    rows: document.querySelectorAll('#mobileResults .track-row').length,
    covers: [...document.querySelectorAll('#mobileResults .track-row img')].filter(i=>i.src&&!i.src.endsWith('icon.svg')).length,
    first: [...document.querySelectorAll('#mobileResults .track-row')].slice(0,3).map(r=>r.querySelector('strong').textContent+'|'+r.querySelector('small').textContent.split('·')[0].trim())
  })`);
  check('真机搜索有结果', s.rows > 0, JSON.stringify(s));
  check('真机歌手匹配置顶周杰伦', (s.first || []).some(x => x.includes('周杰伦')), JSON.stringify(s.first));
  check('搜索结果直接带封面', s.covers > 0, '有封面 ' + s.covers + '/' + s.rows);

  // ── 7. 播放 + 播放器面板 ──
  await val(`document.querySelector('#mobileResults .track-main')?.click();1`); await sleep(6000);
  const play = await json(`JSON.stringify({
    cur:(window.Player&&window.Player.getState&&window.Player.getState().current||{}).name||'',
    mini:!document.getElementById('mobileMini').hidden
  })`);
  check('真机可进入播放状态', !!play.cur && play.mini === true, JSON.stringify(play));
  await val(`document.querySelector('#mobileMini [data-action=player]')?.click();1`); await sleep(1500);
  const pl = await json(`JSON.stringify({
    open:!document.getElementById('mobilePlayer').hidden,
    chips:[...document.querySelectorAll('.player-chip')].map(c=>c.id+':'+c.textContent.trim()),
    cover:(document.getElementById('mobileCover')?.src||'').slice(-30)
  })`);
  check('真机播放器可打开', pl.open === true, JSON.stringify(pl));
  check('真机播放器 3 个 chip 存在', pl.chips.length === 3, JSON.stringify(pl.chips));

  // ── 8. 歌词能拿到（getLyricEx 签名：id, vendor, signal, name, artist） ──
  const lrc = await json(`(async()=>{try{
    const t=window.Player.getState().current;
    const r=await window.UzzApi.getLyricEx(t.id, undefined, undefined, t.name, t.artist);
    return JSON.stringify({len:(r.lyric||'').length, source:r.source, has:(r.lyric||'').includes('[') });
  }catch(e){return JSON.stringify({err:String(e)})}})()`);
  check('真机可取到歌词', lrc.err === undefined && lrc.len > 40, JSON.stringify(lrc));

  // ── 9. 设置页关于/授权面板 ──
  await val(`location.hash='#settings'`); await sleep(1200);
  await val(`document.getElementById('rowDeviceAuth').click();1`); await sleep(1500);
  const dev2 = await json(`JSON.stringify({
    title: document.getElementById('sheetTitle')?.textContent||'',
    body: document.getElementById('sheetContent')?.textContent||''
  })`);
  check('授权面板可打开并显示设备码', dev2.title === '设备授权' && /[0-9a-f]{16}/.test(dev2.body), JSON.stringify(dev2).slice(0, 300));
  await val(`document.querySelector('[data-action=closeSheet]')?.click();1`); await sleep(500);

  await val(`document.querySelector('[data-action=about]')?.click();1`); await sleep(900);
  const about = await val(`document.getElementById('sheetTitle')?.textContent||''`);
  check('关于面板可打开', about === '关于小杨音乐', about);

  console.log('✅ PASS ' + out.pass.length);
  out.pass.forEach(x => console.log('   · ' + x));
  console.log('\n❌ FAIL ' + out.fail.length);
  out.fail.forEach(x => console.log('   ✗ ' + x));
  if (out.warn.length) { console.log('\n⚠️ 备注'); out.warn.forEach(x => console.log('   · ' + x)); }
  console.log('\n=== console 错误 (' + logs.length + ') ===');
  console.log([...new Set(logs)].slice(0, 15).join('\n') || '无');
  ws.close(); process.exit(0);
})();
