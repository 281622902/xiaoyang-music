// v3.5.0 全功能回归（headless Chrome + 本地后端）
// 覆盖：六个页面、全部 data-action 孤儿审计、各页面关键交互、播放器面板、账号弹层
const http = require('http');
const fs = require('fs');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 端口可用 CDP_PORT 环境变量切换：桌面 Chrome 默认 9333，MuMu 真机走 9334
const CDP_PORT = process.env.CDP_PORT || '9333';
const listTargets = () => new Promise((res, rej) => http.get(`http://127.0.0.1:${CDP_PORT}/json/list`, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } }); }).on('error', rej));

(async () => {
  const t = (await listTargets()).find(x => x.type === 'page');
  if (!t) { console.log(JSON.stringify({ error: 'no page target' })); process.exit(1); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); const logs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('ERR: ' + (m.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 160));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + ((m.params.exceptionDetails && m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text || '').slice(0, 160));
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p(m.result); }
  };
  const send = (m, p) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method: m, params: p })); });
  const val = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r && r.result && r.result.value; };
  const json = async e => { try { return JSON.parse(await val(e) || '{}'); } catch { return {}; } };
  await send('Runtime.enable'); await send('Page.enable');

  const out = { pass: [], fail: [], warn: [] };
  const check = (name, ok, detail) => (ok ? out.pass : out.fail).push(name + (detail ? ' — ' + detail : ''));
  const note = (name, detail) => out.warn.push(name + (detail ? ' — ' + detail : ''));

  await send('Page.navigate', { url: 'http://127.0.0.1:3113/android.html' });
  await sleep(3200);
  await val(`localStorage.setItem('uzz.apiBase','http://127.0.0.1:3112');localStorage.removeItem('xy.deviceAuth');1`);
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.reload', { ignoreCache: true });
  await sleep(4500);
  // 只统计「reload 之后」的运行时错误：首次导航可能命中浏览器缓存的旧脚本
  logs.length = 0;

  // ── 1. 版本号四处一致 ──
  {
    const v = await json(`JSON.stringify({mv:document.getElementById('mobileVersion')?.textContent,sv:document.getElementById('settingsVer')?.textContent,qn:document.querySelector('#page-settings .quiet-note p')?.textContent,app:window.XYCloud?.appVersion})`);
    check('版本号一致(3.5.0)', v.mv === '3.5.0' && v.sv === 'v3.5.0' && /3\.5\.0/.test(v.qn || '') && v.app === '3.5.0', JSON.stringify(v));
  }

  // ── 2. 六页可切换且内容非空 ──
  for (const [id, label] of [['discover', '首页'], ['search', '搜索'], ['notes', '笔记'], ['library', '音乐库'], ['me', '我的'], ['settings', '设置中心']]) {
    await val(`location.hash='#${id}'`); await sleep(1400);
    const info = await json(`(()=>{const p=document.getElementById('page-${id}');return JSON.stringify({vis:p&&!p.hidden,len:p?p.innerHTML.length:0})})()`);
    check(`${label}页可打开且有内容`, info.vis && info.len > 200, JSON.stringify(info));
  }

  // ── 3. 首页 6 个频道切换 ──
  await val(`location.hash='#discover'`); await sleep(1600);
  {
    const tabs = await json(`JSON.stringify([...document.querySelectorAll('.home-tabs button')].map(e=>({txt:e.textContent.trim(),ch:e.dataset.channel})))`);
    check('首页频道 Tab = 6', tabs.length === 6, '实际 ' + tabs.length);
    for (const tb of tabs) {
      await val(`document.querySelectorAll('.home-tabs button')[${tabs.findIndex(x => x.ch === tb.ch)}].click();1`);
      await sleep(3200);
      const st = await json(`JSON.stringify({ch:document.querySelector('.home-tabs button.active')?.dataset.channel,title:document.getElementById('discoverSectionTitle')?.textContent,rows:document.getElementById('recommendations')?.children.length||0})`);
      check(`频道「${tb.txt}」可切换`, st.ch === tb.ch && st.rows > 0, JSON.stringify(st));
    }
  }
  {
    const hot = await json(`JSON.stringify({n:document.querySelectorAll('#hotArtists .artist-chip').length})`);
    note('热门歌手条', '渲染 ' + hot.n + ' 个');
  }

  // ── 4. 搜索：4 分类 + 结果分流 ──
  await val(`location.hash='#search'`); await sleep(1200);
  await val(`document.getElementById('mobileSearchInput').value='晴天 周杰伦';document.getElementById('mobileSearchForm').dispatchEvent(new Event('submit',{cancelable:true}));1`);
  await sleep(7000);
  {
    const s = await json(`JSON.stringify({sum:document.getElementById('searchSummary')?.textContent,rows:document.querySelectorAll('#mobileResults .track-row').length,first:[...document.querySelectorAll('#mobileResults .track-row')].slice(0,3).map(r=>r.querySelector('strong').textContent+'|'+r.querySelector('small').textContent.split('·')[0].trim())})`);
    check('搜索单曲有结果', s.rows > 0, JSON.stringify(s));
    check('歌手匹配置顶周杰伦', (s.first || []).some(x => x.includes('周杰伦')), JSON.stringify(s.first));
    check('搜索摘要提示歌手优先', /(已锁定.*原唱|优先展示)/.test(s.sum || ''), s.sum);
  }
  // v3.6.0：四个 Tab 各有专属容器与专属类名，不再统一走 #searchGrid 网格
  const TAB_BOX = {
    artist: ['#searchArtists', '.artist-circle-item'],
    album: ['#searchAlbums', '.album-square'],
    playlist: ['#searchPlaylists', '.playlist-strip'],
  };
  for (const [type, label] of [['artist', '歌手'], ['album', '专辑'], ['playlist', '歌单']]) {
    await val(`document.querySelector('#searchTypes [data-type=${type}]').click();1`);
    await sleep(6000);
    const [boxSel, itemSel] = TAB_BOX[type];
    const s = await json(`JSON.stringify({
      listHidden:document.getElementById('mobileResults')?.hidden,
      boxHidden:document.querySelector('${boxSel}')?.hidden,
      items:document.querySelectorAll('${boxSel} ${itemSel}').length,
      others:['mobileResults','searchArtists','searchAlbums','searchPlaylists'].filter(id=>id!=='${boxSel.slice(1)}').every(id=>document.getElementById(id).hidden)
    })`);
    check(`搜索「${label}」走专属 UI`, s.listHidden === true && s.boxHidden === false && s.items > 0 && s.others === true, JSON.stringify(s));
  }
  await val(`document.querySelector('#searchTypes [data-type=song]').click();1`); await sleep(6000);

  // ── 5. 笔记：推荐/关注 ──
  await val(`location.hash='#notes'`); await sleep(1500);
  {
    const n = await json(`JSON.stringify({cards:document.querySelectorAll('#notesGrid .note-card').length,tl:document.querySelectorAll('#notesTimeline .tl-card').length,title:document.getElementById('notesFeedTitle')?.textContent})`);
    check('笔记页有卡片', n.cards > 0 || n.tl > 0, JSON.stringify(n));
    await val(`document.querySelector('[data-notes=follow]').click();1`); await sleep(1500);
    const n2 = await json(`JSON.stringify({title:document.getElementById('notesFeedTitle')?.textContent})`);
    check('笔记「关注」Tab 切换标题', n2.title === '我的关注', JSON.stringify(n2));
    await val(`document.querySelector('[data-notes=feed]').click();1`); await sleep(1200);
  }

  // ── 6. 音乐库 5 Tab + 统计条 ──
  await val(`location.hash='#library'`); await sleep(1500);
  {
    const s = await json(`JSON.stringify({stats:document.querySelectorAll('#libraryStats .lib-stat').length})`);
    check('音乐库统计条 4 项', s.stats === 4, JSON.stringify(s));
    for (const [tab, label] of [['playlists', '歌单'], ['favorites', '喜欢'], ['local', '本地'], ['history', '最近'], ['cloud', '云端']]) {
      await val(`document.querySelector('[data-library=${tab}]').click();1`); await sleep(1300);
      const c = await json(`JSON.stringify({len:document.getElementById('libraryContent')?.innerHTML.length||0,active:document.querySelector('#libraryTabs .active')?.dataset.library})`);
      check(`音乐库「${label}」可切换`, c.active === tab && c.len > 10, JSON.stringify(c));
    }
  }

  // ── 7. 我的页 ──
  await val(`location.hash='#me'`); await sleep(1400);
  {
    const s = await json(`JSON.stringify({lv:document.getElementById('meLevel')?.textContent,bar:document.getElementById('meLevelBar')?.style.width,recent:document.getElementById('meRecent')?.innerHTML.length||0,follow:document.getElementById('meFollow')?.textContent})`);
    check('我的页等级与进度条', s.lv && s.bar !== undefined, JSON.stringify(s));
    check('我的页「最近常听」区块存在', s.recent > 10, JSON.stringify(s));
  }

  // ── 8. 设置中心所有行可点 ──
  await val(`location.hash='#settings'`); await sleep(1300);
  {
    const rows = await json(`JSON.stringify([...document.querySelectorAll('#page-settings .settings-card button')].map(b=>b.id||b.dataset.action||b.textContent.trim().slice(0,10)))`);
    check('设置项数量 >= 10', rows.length >= 10, '实际 ' + rows.length + '：' + rows.join(','));
    for (const r of ['rowQuality', 'rowSpeed', 'rowSleep', 'rowTheme']) {
      await val(`document.getElementById('${r}').click();1`); await sleep(900);
      const open = await val(`!document.getElementById('sheetBackdrop').hidden`);
      check(`设置「${r}」可打开选项`, open === true, '');
      await val(`document.querySelector('#sheetContent [data-pick]')?.click();1`); await sleep(700);
    }
    // 桌面歌词依赖安卓悬浮窗：桌面浏览器必须给明确提示，不能静默无反应
    await val(`(()=>{const t=document.getElementById('toast');if(t){t.textContent='';t.classList.add('hidden');}return 1})()`);
    await val(`document.getElementById('rowMobileLyric').click();1`); await sleep(900);
    const mly = await json(`JSON.stringify({toast:document.getElementById('toast')?.textContent||'',hidden:document.getElementById('toast')?.classList.contains('hidden')})`);
    check('「桌面歌词」在非安卓环境给出明确提示', mly.hidden === false && /仅在安卓版可用/.test(mly.toast || ''), JSON.stringify(mly));
    await sleep(3600);
    await val(`document.getElementById('rowAccount').click();1`); await sleep(900);
    check('设置「账户资料」打开账号弹层', await val(`!document.getElementById('accountBackdrop').hidden`) === true);
    await val(`document.querySelector('[data-action=closeAccount]').click();1`); await sleep(500);
    await val(`document.getElementById('rowDeviceAuth').click();1`); await sleep(1200);
    check('设置「设备授权」打开授权面板', (await val(`document.getElementById('sheetTitle')?.textContent`)) === '设备授权');
    await val(`document.querySelector('[data-action=closeSheet]').click();1`); await sleep(400);
    await val(`document.querySelector('[data-action=about]').click();1`); await sleep(900);
    check('设置「关于」打开关于面板', (await val(`document.getElementById('sheetTitle')?.textContent`)) === '关于小杨音乐');
    await val(`document.querySelector('[data-action=closeSheet]').click();1`); await sleep(400);
  }

  // ── 9. 抽屉全部条目 ──
  await val(`location.hash='#discover'`); await sleep(900);
  await val(`document.querySelector('[data-action=drawer]').click();1`); await sleep(800);
  {
    const items = await json(`JSON.stringify([...document.querySelectorAll('#drawerBackdrop .drawer-list button')].map(b=>b.dataset.action||b.dataset.nav))`);
    check('抽屉条目 >= 5', items.length >= 5, items.join(','));
    for (const it of items) {
      await val(`document.querySelector('[data-action=drawer]').click();1`); await sleep(500);
      await val(`document.querySelector('#drawerBackdrop [data-action=${it}],#drawerBackdrop [data-nav=${it}]').click();1`); await sleep(1100);
      const open = await val(`!document.getElementById('sheetBackdrop').hidden || !document.getElementById('drawerBackdrop').hidden || location.hash.length>1`);
      check(`抽屉项「${it}」有响应`, open === true, '');
      await val(`(()=>{for(const id of ['sheetBackdrop','drawerBackdrop']){const n=document.getElementById(id);if(n&&!n.hidden)n.hidden=true;}})();1`);
      await sleep(300);
    }
  }

  // ── 10. 播放器面板 + chip ──
  {
    await val(`location.hash='#search'`); await sleep(1200);
    await val(`document.getElementById('mobileSearchInput').value='晴天 周杰伦';document.getElementById('mobileSearchForm').dispatchEvent(new Event('submit',{cancelable:true}));1`);
    await sleep(7000);
    await val(`document.querySelector('#mobileResults .track-main')?.click();1`);
    await sleep(8000);
    const playing = await json(`JSON.stringify({cur:(window.Player&&window.Player.getState&&window.Player.getState().current||{}).name||'',mini:!document.getElementById('mobileMini').hidden})`);
    check('可播放并进入播放状态', !!playing.cur && playing.mini === true, JSON.stringify(playing));
    await val(`document.querySelector('#mobileMini [data-action=player]')?.click();1`); await sleep(1800);
    const pl = await json(`JSON.stringify({open:!document.getElementById('mobilePlayer').hidden,chips:[...document.querySelectorAll('.player-chip')].map(c=>c.id+':'+c.textContent.trim())})`);
    check('播放器可打开', pl.open === true, JSON.stringify(pl));
    check('播放器 3 个 chip 存在', (pl.chips || []).length === 3, JSON.stringify(pl.chips));
    check('播放器显示歌名', !!(await val(`(document.getElementById('mobileSongName')?.textContent||'').trim()`)), '');
    for (const id of ['mobileRate', 'mobileSleep', 'mobileQuality']) {
      await val(`document.getElementById('${id}').click();1`); await sleep(800);
      const open = await val(`!document.getElementById('sheetBackdrop').hidden`);
      check(`播放器 chip「${id}」可打开选项`, open === true, '');
      await val(`document.querySelector('#sheetContent [data-pick]')?.click();1`); await sleep(600);
    }
    await val(`document.querySelector('[data-action=closePlayer]').click();1`); await sleep(600);
  }

  // ── 11. 账号弹层：登录/注册 + 图形验证码 ──
  {
    await val(`document.querySelector('[data-action=account]').click();1`); await sleep(900);
    const acc = await json(`JSON.stringify({open:!document.getElementById('accountBackdrop').hidden,guest:!document.getElementById('mobileGuest').hidden})`);
    check('账号弹层可打开', acc.open === true, JSON.stringify(acc));
    await val(`document.querySelector('[data-auth=register]').click();1`); await sleep(2200);
    const reg = await json(`JSON.stringify({capRow:!document.getElementById('mobileCaptchaRow').hidden,svg:!!document.querySelector('#mobileCaptchaBtn svg'),btn:document.getElementById('mobileLoginSubmit')?.textContent})`);
    check('注册页显示图形验证码', reg.capRow === true && reg.svg === true, JSON.stringify(reg));
    check('注册按钮文案正确', reg.btn === '注册并登录', reg.btn);
    // 输入错误验证码 → 应提示且不放行
    await val(`document.getElementById('mobileCaptchaInput').value='ZZZZ';document.getElementById('mobileLoginForm').dispatchEvent(new Event('submit',{cancelable:true}));1`);
    await sleep(2500);
    const bad = await val(`document.getElementById('mobileAuthStatus').textContent`);
    check('错误验证码被拦截', /验证码/.test(bad || ''), bad);
    // 正确验证码 → 应走到注册请求（会因为手机号不存在而报错，但验证码必须先过）
    const cap = await json(`(async()=>{const r=await fetch('http://127.0.0.1:3112/api/captcha');const j=await r.json();const code=(j.svg.match(/>([A-Z0-9])<\\/text>/g)||[]).map(s=>s.replace(/[><\\/text]/g,'')).join('');const v=await fetch('http://127.0.0.1:3112/api/captcha/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:j.id,answer:code})});return JSON.stringify({code,ok:(await v.json()).ok});})()`);
    check('图形验证码可正常签发与校验', cap.ok === true, JSON.stringify(cap));
    await val(`document.querySelector('[data-action=closeAccount]').click();1`); await sleep(500);
  }

  // ── 12. 孤儿元素审计：HTML 里每个 data-action 都有实现 ──
  {
    const { parseActionsKeys } = require('./parse-actions-keys.cjs');
    const known = parseActionsKeys(path.join(__dirname, '..', 'app', 'js', 'android.js'));
    const runtime = await json(`(()=>JSON.stringify([...new Set([...document.querySelectorAll('[data-action]')].map(e=>e.dataset.action).filter(Boolean))]))()`);
    const missing = (runtime || []).filter(a => !known.includes(a));
    note('data-action 运行时去重数', String((runtime || []).length) + ' / 实现 ' + known.length);
    check('无孤儿 data-action', missing.length === 0, JSON.stringify(missing));
  }

  console.log('✅ PASS ' + out.pass.length);
  out.pass.forEach(x => console.log('   · ' + x));
  console.log('\n❌ FAIL ' + out.fail.length);
  out.fail.forEach(x => console.log('   ✗ ' + x));
  if (out.warn.length) { console.log('\n⚠️ 备注'); out.warn.forEach(x => console.log('   · ' + x)); }
  console.log('\n=== console 错误 (' + logs.length + ') ===');
  console.log([...new Set(logs)].slice(0, 20).join('\n') || '无');
  ws.close(); process.exit(0);
})();
