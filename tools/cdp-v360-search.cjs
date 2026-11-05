/* ============================================================
 * cdp-v360-search.cjs — v3.6.0 阶段一专项回归
 *
 * 覆盖 5 项需求：
 *   ① 原唱强匹配（列表硬剔除 + 前端拦截提示 + 后端守卫）
 *   ② 全网底层聚合（后端 API 可用性）
 *   ③ 歌手去重合并（唯一歌手卡片）
 *   ④ 四 Tab 彻底差异化 UI + 定向加载
 *   ⑤ 页面无 console 错误
 *
 * 前置：静态服务 3113、后端 3112、Chrome CDP 9333（可用 CDP_PORT 覆盖）
 * ============================================================ */
'use strict';
const http = require('http');
const PORT = Number(process.env.CDP_PORT || 9333);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listTargets = () => new Promise((res, rej) => {
  http.get('http://127.0.0.1:' + PORT + '/json/list', (r) => {
    let d = ''; r.on('data', (c) => d += c);
    r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

let pass = 0, fail = 0;
const consoleErrors = [];
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
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('exception: ' + (m.params.exceptionDetails.text || ''));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push('console: ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErrors.push('log: ' + m.params.entry.text);
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
  // 桌面跑 3113 静态站；真机（MuMu WebView）直接用当前页面 URL + adb reverse 的后端
  const PAGE_URL = process.env.PAGE_URL ||
    ((/^https?:\/\//.test(target.url || '') && !/about:blank/.test(target.url) && !/127\.0\.0\.1:3113/.test(target.url))
      ? target.url : 'http://127.0.0.1:3113/android.html');
  const API_BASE = process.env.API_BASE || 'http://127.0.0.1:3112';

  console.log('── v3.6.0 阶段一专项回归 ──\n');
  await send('Page.navigate', { url: PAGE_URL });
  await sleep(2600);
  await val(`localStorage.setItem('uzz.apiBase',${JSON.stringify(API_BASE)});localStorage.removeItem('xy.deviceAuth');1`);
  await send('Page.reload', { ignoreCache: true });
  await sleep(4200);
  consoleErrors.length = 0;   // 只统计 reload 之后的错误
  // 必须显式进入搜索页：只检查 DOM 存在不够，隐藏页面里的断言没有意义
  await val(`location.hash='#search';1`); await sleep(1600);
  const onSearch = await json(`JSON.stringify({
    hash:location.hash,
    hidden:document.getElementById('page-search')?.hidden,
    width:document.getElementById('page-search')?.getBoundingClientRect().width||0
  })`);
  check('已进入搜索页且页面可见', onSearch.hidden === false && onSearch.width > 0, JSON.stringify(onSearch));

  // ── 0. 四个独立容器 + 定向提示条 ──
  const boxes = await json(`JSON.stringify({
    song:!!document.getElementById('mobileResults'),
    artist:!!document.getElementById('searchArtists'),
    album:!!document.getElementById('searchAlbums'),
    playlist:!!document.getElementById('searchPlaylists'),
    hint:!!document.getElementById('searchKindHint')
  })`);
  check('四个 Tab 各有独立容器', Object.values(boxes).every(Boolean), JSON.stringify(boxes));

  // ── 1. 单曲 Tab：带序号列表 + 原唱硬剔除 ──
  await val(`document.getElementById('mobileSearchInput').value='晴天 周杰伦';document.getElementById('mobileSearchForm').dispatchEvent(new Event('submit',{cancelable:true}));1`);
  await sleep(11000);
  const song = await json(`JSON.stringify({
    visible:[...['mobileResults','searchArtists','searchAlbums','searchPlaylists']].filter(id=>!document.getElementById(id).hidden),
    rows:document.querySelectorAll('#mobileResults .track-row').length,
    indexes:[...document.querySelectorAll('#mobileResults .track-index')].slice(0,5).map(e=>e.textContent.trim()),
    artists:[...document.querySelectorAll('#mobileResults .track-main small')].slice(0,8).map(e=>e.textContent),
    hint:document.getElementById('searchKindHint').textContent,
    summary:document.getElementById('searchSummary').textContent,
    pageWidth:document.getElementById('page-search')?.getBoundingClientRect().width||0,
    resultsWidth:document.getElementById('searchResults')?.getBoundingClientRect().width||0,
    hintWidth:document.getElementById('searchKindHint')?.getBoundingClientRect().width||0
  })`);
  check('搜索结果区域真实可见', song.pageWidth > 0 && song.resultsWidth > 0 && song.hintWidth > 0, JSON.stringify({ p: song.pageWidth, r: song.resultsWidth, h: song.hintWidth }));
  check('单曲 Tab 只显示序号列表容器', song.visible.length === 1 && song.visible[0] === 'mobileResults', JSON.stringify(song.visible));
  check('单曲列表有带序号的结果', song.rows > 0 && song.indexes[0] === '1' && song.indexes[1] === '2', JSON.stringify(song.indexes));
  check('原唱强匹配：结果里没有他人翻唱', song.artists.length > 0 && song.artists.every((a) => /周杰伦|Jay Chou/i.test(a)), JSON.stringify(song.artists));
  check('单曲 Tab 定向提示条正确', /原唱强匹配/.test(song.hint || ''), song.hint);

  // ── 2. 歌手 Tab：圆形头像列表 + 去重 ──
  await val(`document.querySelector('[data-type=artist]').click();1`);
  await sleep(11000);
  const artist = await json(`JSON.stringify({
    visible:[...['mobileResults','searchArtists','searchAlbums','searchPlaylists']].filter(id=>!document.getElementById(id).hidden),
    cards:document.querySelectorAll('#searchArtists .artist-circle-item').length,
    round:document.querySelector('#searchArtists .artist-circle-art')?getComputedStyle(document.querySelector('#searchArtists .artist-circle-art')).borderRadius:'',
    names:[...document.querySelectorAll('#searchArtists .artist-circle-meta strong')].map(e=>e.textContent.trim()),
    hint:document.getElementById('searchKindHint').textContent,
    summary:document.getElementById('searchSummary').textContent
  })`);
  check('歌手 Tab 只显示圆形头像容器', artist.visible.length === 1 && artist.visible[0] === 'searchArtists', JSON.stringify(artist.visible));
  check('歌手渲染为圆形头像列表', artist.cards > 0 && /50%/.test(artist.round || ''), JSON.stringify({ cards: artist.cards, round: artist.round }));
  check('歌手去重：没有重复歌手卡片', artist.names.length === new Set(artist.names).size, JSON.stringify(artist.names));
  check('歌手 Tab 定向提示条 + 去重回执', /多源去重/.test(artist.hint || ''), artist.hint + ' / ' + artist.summary);

  // ── 3. 专辑 Tab：方形图片网格 ──
  await val(`document.querySelector('[data-type=album]').click();1`);
  await sleep(11000);
  const album = await json(`JSON.stringify({
    visible:[...['mobileResults','searchArtists','searchAlbums','searchPlaylists']].filter(id=>!document.getElementById(id).hidden),
    cards:document.querySelectorAll('#searchAlbums .album-square').length,
    art:document.querySelector('#searchAlbums .album-square-art')?(()=>{const s=getComputedStyle(document.querySelector('#searchAlbums .album-square-art'));return {radius:s.borderRadius,ratio:s.aspectRatio}})():null,
    hint:document.getElementById('searchKindHint').textContent
  })`);
  check('专辑 Tab 只显示方形网格容器', album.visible.length === 1 && album.visible[0] === 'searchAlbums', JSON.stringify(album.visible));
  check('专辑渲染为方形图片网格', album.cards > 0 && album.art && /^8px/.test(album.art.radius || ''), JSON.stringify(album));
  check('专辑 Tab 定向提示条正确', /定向加载专辑/.test(album.hint || ''), album.hint);

  // ── 4. 歌单 Tab：长条卡片 ──
  await val(`document.querySelector('[data-type=playlist]').click();1`);
  await sleep(11000);
  const playlist = await json(`JSON.stringify({
    visible:[...['mobileResults','searchArtists','searchAlbums','searchPlaylists']].filter(id=>!document.getElementById(id).hidden),
    strips:document.querySelectorAll('#searchPlaylists .playlist-strip').length,
    dir:document.querySelector('#searchPlaylists .playlist-strip')?getComputedStyle(document.querySelector('#searchPlaylists .playlist-strip')).flexDirection:'',
    hint:document.getElementById('searchKindHint').textContent
  })`);
  check('歌单 Tab 只显示长条卡片容器', playlist.visible.length === 1 && playlist.visible[0] === 'searchPlaylists', JSON.stringify(playlist.visible));
  check('歌单渲染为横向长条卡片', playlist.strips > 0 && playlist.dir === 'row', JSON.stringify(playlist));
  check('歌单 Tab 定向提示条正确', /定向加载歌单/.test(playlist.hint || ''), playlist.hint);

  // ── 5. 四 Tab UI 互不相同（结构类名两两不重合）──
  const fourClasses = await val(`['song-rank-list','artist-circle-list','album-square-grid','playlist-strip-list'].every(c=>document.querySelector('.'+c))`);
  check('四个 Tab 使用四套完全不同的类名', fourClasses === true, String(fourClasses));

  // ── 6. 前端原唱守卫：显示歌手不符时直接拦截并提示 ──
  const guardRes = await json(`(async()=>{
    const before=(window.Player&&window.Player.getState)?window.Player.getState().current:null;
    await window.Player.loadAndPlay({id:'fake-cover-001',vendor:'netease',name:'晴天',artist:'张三',expectArtist:'周杰伦',strictOriginal:1});
    const t=document.getElementById('toast');
    return JSON.stringify({toast:t?t.textContent:'',hidden:t?t.classList.contains('hidden'):true,cur:((window.Player&&window.Player.getState)?window.Player.getState().current:null)===before});
  })()`);
  check('前端原唱守卫拦下不符歌手并给出「暂无原唱版权」',
    /暂无原唱版权/.test(guardRes.toast || '') && guardRes.hidden === false, JSON.stringify(guardRes));
  await sleep(3800);

  // ── 7. 后端 API：强匹配 / 去重 / 定向加载回执 ──
  const api = await json(`(async()=>{
    const base=localStorage.getItem('uzz.apiBase');
    const g=async(p)=>{const r=await fetch(base+p);return r.json()};
    const s=await g('/api/search?keyword='+encodeURIComponent('晴天 周杰伦')+'&type=song&artist='+encodeURIComponent('周杰伦')+'&limit=20');
    const a=await g('/api/search?keyword='+encodeURIComponent('周杰伦')+'&type=artist&limit=20');
    const al=await g('/api/search?keyword='+encodeURIComponent('周杰伦')+'&type=album&limit=20');
    const pl=await g('/api/search?keyword='+encodeURIComponent('周杰伦')+'&type=playlist&limit=20');
    return JSON.stringify({
      songCount:(s.result||[]).length,
      songAllOriginal:(s.result||[]).every(t=>t._original===true),
      artistNames:(a.result||[]).map(x=>x.name),
      artistDeduped:a.deduped,
      albumCount:(al.result||[]).length,
      albumUnique:new Set((al.result||[]).map(x=>x.name)).size,
      playlistCount:(pl.result||[]).length,
      playlistUnique:new Set((pl.result||[]).map(x=>x.name)).size
    });
  })()`);
  check('后端强匹配：结果全部标记为原唱', api.songCount > 0 && api.songAllOriginal === true, JSON.stringify(api));
  check('后端歌手去重：返回名字唯一', api.artistNames.length > 0 && api.artistNames.length === new Set(api.artistNames).size && api.artistDeduped > 0, JSON.stringify({ n: (api.artistNames || []).length, deduped: api.artistDeduped }));
  check('后端专辑定向加载且无重复', api.albumCount > 0 && api.albumCount === api.albumUnique, JSON.stringify({ c: api.albumCount, u: api.albumUnique }));
  check('后端歌单定向加载且无重复', api.playlistCount > 0 && api.playlistCount === api.playlistUnique, JSON.stringify({ c: api.playlistCount, u: api.playlistUnique }));

  check('页面无 console 错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  console.log('\n── 结果：✅ PASS ' + pass + ' / ❌ FAIL ' + fail + ' / console 错误 ' + consoleErrors.length + ' ──');
  ws.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('EXC', e); process.exit(2); });
