/* ============================================================
 * cdp-v370-pages.cjs — v3.7.0 阶段二专项回归
 *
 * 覆盖：首页五频道差异 / 排行榜 2x2 宫格 + 独立页 / 换一批 /
 *       热门歌手实时 + 真实封面 / 笔记真瀑布流 / 我的页抽屉
 *
 * 桌面：CDP_PORT=9333（默认，静态站 3113 + 后端 3112）
 * 真机：CDP_PORT=9334 API_BASE=http://localhost:3000
 * ============================================================ */
'use strict';
const http = require('http');
const PORT = Number(process.env.CDP_PORT || 9333);
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:3112';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listTargets = () => new Promise((res, rej) => {
  http.get('http://127.0.0.1:' + PORT + '/json/list', (r) => {
    let d = ''; r.on('data', (c) => d += c);
    r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

let pass = 0, fail = 0;
const errs = [];
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}

(async () => {
  const targets = await listTargets();
  const target = targets.find((x) => x.type === 'page');
  if (!target) throw new Error('没有可用的 Chrome 页面');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') errs.push('exception: ' + (m.params.exceptionDetails.text || ''));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console: ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push('log: ' + m.params.entry.text);
  };
  const send = (method, params) => new Promise((r) => {
    const id = ++seq; pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const val = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return r && r.result && r.result.value;
  };
  const json = async (expr) => { const v = await val(expr); try { return JSON.parse(v); } catch (e) { return {}; } };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  const PAGE_URL = process.env.PAGE_URL ||
    ((/^https?:\/\//.test(target.url || '') && !/about:blank/.test(target.url) && !/127\.0\.0\.1:3113/.test(target.url))
      ? target.url : 'http://127.0.0.1:3113/android.html');

  console.log('── v3.7.0 阶段二专项回归 ──\n');
  await send('Page.navigate', { url: PAGE_URL });
  await sleep(2600);
  await val(`localStorage.setItem('uzz.apiBase',${JSON.stringify(API_BASE)});localStorage.removeItem('xy.deviceAuth');1`);
  await send('Page.reload', { ignoreCache: true });
  await sleep(4500);
  errs.length = 0;
  await val(`location.hash='#discover';1`); await sleep(5500);

  // ── 1. 五个频道：容器类名 + 首卡片类名两两不同 ──
  const forms = {};
  for (const ch of ['recommend', 'music', 'podcast', 'audiobook', 'radio']) {
    await val(`document.querySelector('[data-channel=${ch}]').click();1`);
    await sleep(7000);
    forms[ch] = await json(`JSON.stringify({cls:document.getElementById('recommendations').className,first:document.getElementById('recommendations').firstElementChild?.className||'',rows:document.getElementById('recommendations').children.length})`);
    check(`频道「${ch}」渲染出专属内容`, forms[ch].rows > 0 && !!forms[ch].first, JSON.stringify(forms[ch]));
  }
  const shapes = Object.values(forms).map((x) => x.cls + '/' + x.first);
  check('五个频道 UI 形态完全互不相同', new Set(shapes).size === 5, JSON.stringify(shapes));
  await val(`document.querySelector('[data-channel=recommend]').click();1`); await sleep(3000);

  // ── 2. 排行榜 2x2 宫格 ──
  const palace = await json(`JSON.stringify({cards:document.querySelectorAll('#chartCards .cp-card').length,cols:getComputedStyle(document.getElementById('chartCards')).gridTemplateColumns.split(' ').length,nav:document.querySelector('#chartCards .cp-card')?.dataset.nav||''})`);
  check('首页排行榜为 2x2 宫格', palace.cards === 4 && palace.cols === 2, JSON.stringify(palace));
  check('宫格点击目标是独立榜单页', palace.nav === 'charts', palace.nav);

  // ── 3. 跳独立榜单页 + 页内选榜 ──
  await val(`document.querySelector('#chartCards .cp-card').click();1`); await sleep(3200);
  const chartPage = await json(`JSON.stringify({hash:location.hash,visible:!document.getElementById('page-charts').hidden,grid:document.querySelectorAll('#chartsFullGrid button[data-chart-pick]').length,tracks:document.querySelectorAll('#chartsTracks .track-row').length,title:document.getElementById('chartsDetailTitle').textContent})`);
  check('跳转到全新独立榜单页', chartPage.hash === '#charts' && chartPage.visible === true, JSON.stringify(chartPage));
  check('独立页展示全部榜单', chartPage.grid >= 4, JSON.stringify(chartPage));
  check('独立页内直接展示榜单金曲', chartPage.tracks > 0, JSON.stringify(chartPage));
  const second = await val(`document.querySelectorAll('#chartsFullGrid button[data-chart-pick]')[1]?.dataset.chartPick||''`);
  if (second) {
    await val(`document.querySelectorAll('#chartsFullGrid button[data-chart-pick]')[1].click();1`); await sleep(3500);
    const picked = await json(`JSON.stringify({hash:location.hash,active:document.querySelectorAll('#chartsFullGrid button.active').length,tracks:document.querySelectorAll('#chartsTracks .track-row').length,title:document.getElementById('chartsDetailTitle').textContent})`);
    check('页内切换榜单生效（不跳走）', picked.hash === '#charts' && picked.active === 1 && picked.tracks > 0, JSON.stringify(picked));
  }

  await val(`location.hash='#discover';1`); await sleep(3000);

  // ── 4. 换一批真的换内容 ──
  const before = await val(`[...document.querySelectorAll('#recommendations .cover-card strong')].map(e=>e.textContent).join('|')`);
  await val(`document.getElementById('refreshDiscover').click();1`); await sleep(1600);
  const after = await val(`[...document.querySelectorAll('#recommendations .cover-card strong')].map(e=>e.textContent).join('|')`);
  check('「换一批」点击后内容真的变化', !!before && !!after && before !== after, JSON.stringify({ b: (before || '').slice(0, 40), a: (after || '').slice(0, 40) }));

  // ── 5. 热门歌手实时 + 卡片真实封面 ──
  const imgs = await json(`JSON.stringify({hot:document.querySelectorAll('#hotArtists .artist-chip').length,cards:document.querySelectorAll('#recommendations img').length,http:[...document.querySelectorAll('#recommendations img')].filter(i=>/^https?:/.test(i.src)).length,icons:[...document.querySelectorAll('#recommendations img')].filter(i=>/icon\\.svg/.test(i.src)).length})`);
  check('热门歌手有实时榜单数据', imgs.hot > 0, JSON.stringify(imgs));
  check('推荐卡片全部使用真实封面（无白块占位）', imgs.cards > 0 && imgs.http === imgs.cards && imgs.icons === 0, JSON.stringify(imgs));

  // ── 6. 笔记页真双列瀑布流 + 图片差异化 ──
  await val(`location.hash='#notes';1`); await sleep(3000);
  const notes = await json(`JSON.stringify({
    cols:getComputedStyle(document.getElementById('notesGrid')).columnCount,
    display:getComputedStyle(document.getElementById('notesGrid')).display,
    cards:document.querySelectorAll('#notesGrid .note-card').length,
    srcs:new Set([...document.querySelectorAll('#notesGrid .note-card>img')].map(i=>i.src)).size,
    heights:new Set([...document.querySelectorAll('#notesGrid .note-card>img')].map(i=>Math.round(i.getBoundingClientRect().height))).size
  })`);
  check('笔记页是双列 CSS 瀑布流', notes.cols === '2' && notes.display === 'block', JSON.stringify(notes));
  check('笔记卡片图片差异化', notes.cards > 0 && notes.srcs >= 3 && notes.heights >= 2, JSON.stringify(notes));

  // ── 7. 我的页：杂项收进抽屉、主界面干净 ──
  await val(`location.hash='#me';1`); await sleep(2200);
  const me = await json(`JSON.stringify({
    extra:document.querySelectorAll('#page-me .me-extra').length,
    quick:document.querySelectorAll('#page-me .ph-quick').length,
    settingsCards:document.querySelectorAll('#page-me .settings-card').length,
    love:document.querySelectorAll('#page-me .me-love-card').length,
    playlists:!!document.getElementById('mePlaylists'),
    hamLeft:document.querySelector('#page-me .hamburger')?.getBoundingClientRect().left||9999,
    half:window.innerWidth/2,
    drawerTools:document.querySelectorAll('#drawerBackdrop [data-action="networkDiagnostics"],#drawerBackdrop [data-action="about"],#drawerBackdrop [data-nav="settings"]').length,
    recentInDrawer:!!document.querySelector('#drawerBackdrop #meRecent')
  })`);
  check('设置/诊断等杂项已移出主界面', me.extra === 0 && me.quick === 0 && me.settingsCards === 0, JSON.stringify(me));
  check('主界面只留用户信息 + 我喜欢的音乐 + 歌单', me.love === 1 && me.playlists === true, JSON.stringify(me));
  check('汉堡按钮在左上角', me.hamLeft < me.half, JSON.stringify({ left: me.hamLeft, half: me.half }));
  check('杂项全部收进侧边抽屉', me.drawerTools >= 3 && me.recentInDrawer === true, JSON.stringify(me));
  await val(`document.querySelector('#page-me .hamburger').click();1`); await sleep(900);
  const drawerOpen = await val(`!document.getElementById('drawerBackdrop').hidden`);
  check('抽屉可正常打开', drawerOpen === true, String(drawerOpen));

  check('页面无 console 错误', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log('\n── 结果：✅ PASS ' + pass + ' / ❌ FAIL ' + fail + ' / console 错误 ' + errs.length + ' ──');
  ws.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('EXC', e); process.exit(2); });
