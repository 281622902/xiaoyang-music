// 电脑端「＋ 收藏歌单」Bug 回归（v3.6.0）
const http = require('http');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = process.env.CDP_PORT || '9333';
const listTargets = () => new Promise((res, rej) => http.get(`http://127.0.0.1:${PORT}/json/list`, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } }); }).on('error', rej));

(async () => {
  const t = (await listTargets()).find(x => x.type === 'page');
  if (!t) { console.log('no page'); process.exit(1); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); const logs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + ((m.params.exceptionDetails && m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text || '').slice(0, 200));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('ERR: ' + (m.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 200));
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p(m.result); }
  };
  const send = (m, p) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method: m, params: p })); });
  const val = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r && r.result && r.result.value; };
  const json = async e => { try { return JSON.parse(await val(e) || '{}'); } catch { return {}; } };
  await send('Runtime.enable'); await send('Page.enable');

  const out = { pass: [], fail: [] };
  const check = (name, ok, detail) => (ok ? out.pass : out.fail).push(name + (detail ? ' — ' + detail : ''));

  await send('Page.navigate', { url: 'http://127.0.0.1:3113/index.html' });
  await sleep(3500);
  await val(`localStorage.setItem('uzz.apiBase','http://127.0.0.1:3112');localStorage.removeItem('uzz.playlists');1`);
  await send('Page.reload', { ignoreCache: true });
  await sleep(5000);
  logs.length = 0;

  // ① 页面不该再出现 global is not defined
  const globalErr = logs.filter(l => /global is not defined/i.test(l));
  check('无 global is not defined 异常', globalErr.length === 0, globalErr.join(' | '));

  // ② 用户真实场景：搜索「周杰伦」→ 歌单 Tab → 点第一个歌单 → 详情页
  await val(`document.getElementById('searchInput').value='周杰伦';document.getElementById('searchGo').click();1`);
  await sleep(7000);
  await val(`document.querySelector('#tabs [data-type=playlist]')?.click();1`);
  await sleep(7000);
  const rows = await val(`document.querySelectorAll('#resultList li.song[data-etype=playlist]').length`);
  await val(`document.querySelector('#resultList li.song[data-etype=playlist]')?.click();1`);
  await sleep(7000);
  const page = await json(`JSON.stringify({saveVisible:!document.getElementById('plpSave')?.classList.contains('hidden'),name:document.getElementById('plpName')?.textContent||'',rows:document.querySelectorAll('#plpTracks li').length,playlistRows:${rows||0}})`);
  check('在线歌单详情可打开且收藏按钮可见', page.saveVisible === true && page.rows > 0, JSON.stringify(page));

  // ③ 点收藏
  await val(`document.getElementById('plpSave').click();1`);
  await sleep(1500);
  const saved = await json(`(()=>{let p=[];try{p=JSON.parse(localStorage.getItem('uzz.playlists')||'[]')}catch(e){};return JSON.stringify({count:p.length,kind:p[0]&&p[0].kind,name:p[0]&&p[0].name,tracks:p[0]&&p[0].tracks&&p[0].tracks.length,collected:document.getElementById('playlistCollected')?.textContent||'',toast:document.getElementById('toast')?.textContent||''})})()`);
  check('歌单确实写入 localStorage', saved.count >= 1, JSON.stringify(saved));
  check('kind 显式为 collected（不再靠封面猜）', saved.kind === 'collected', String(saved.kind));
  check('左侧「收藏的歌单」出现该歌单', (saved.collected || '').includes(saved.name || '###'), JSON.stringify(saved.collected).slice(0, 120));
  check('给出明确 Toast（不再静默）', /收藏|已保存|云端|登录/.test(saved.toast || ''), saved.toast);

  // ④ 重复点击去重
  await val(`document.getElementById('plpSave').click();1`);
  await sleep(900);
  const dup = await json(`(()=>{let p=[];try{p=JSON.parse(localStorage.getItem('uzz.playlists')||'[]')}catch(e){};return JSON.stringify({count:p.length,toast:document.getElementById('toast')?.textContent||''})})()`);
  check('重复收藏不产生重复歌单', dup.count === saved.count, JSON.stringify(dup));
  check('重复收藏给出明确提示', /已经在收藏/.test(dup.toast || ''), dup.toast);

  console.log('✅ PASS ' + out.pass.length);
  out.pass.forEach(x => console.log('   · ' + x));
  console.log('\n❌ FAIL ' + out.fail.length);
  out.fail.forEach(x => console.log('   ✗ ' + x));
  console.log('\n=== console 异常 (' + logs.length + ') ===');
  console.log([...new Set(logs)].slice(0, 8).join('\n') || '无');
  ws.close(); process.exit(0);
})();
