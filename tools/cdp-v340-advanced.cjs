// v3.4.0 进阶功能验证：歌曲百科 / 相似推荐 / 歌单导入 / 歌词翻译 / 私人FM / 笔记关注
const http = require('http');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listTargets = () => new Promise((res, rej) => http.get('http://127.0.0.1:9222/json/list', (r) => {
  let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
}).on('error', rej));

(async () => {
  const t = (await listTargets()).find((x) => x.type === 'page');
  if (!t) { console.log(JSON.stringify({ error: 'no page target' })); process.exit(1); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p.resolve(m.result); }
  };
  const val = (expression) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('eval timeout')); }, 45000);
    pending.set(id, { resolve: (r) => { clearTimeout(timer); resolve(r?.result?.value); }, reject });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  const json = async (e) => { try { return JSON.parse(await val(e) || '{}'); } catch { return {}; } };

  const out = [];
  const check = (name, ok, detail) => { out.push({ name, ok, detail }); console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : '')); };

  ws.onopen = async () => {
    try {
      // ── 1) 歌曲百科 ──
      await val(`window.__t = {id:'451703096',name:'Shape of You',artist:'Ed Sheeran',vendor:'netease'}; 1`);
      const wiki = await val(`(async()=>{
        const r = await UzzApi.getWiki('451703096','netease');
        return JSON.stringify({keys:Object.keys(r||{}),info:r});
      })()`);
      const wj = JSON.parse(wiki || '{}');
      const wkeys = wj.keys || [];
      check('歌曲百科返回真实资料', wkeys.length > 0, '字段=' + wkeys.slice(0, 8).join(',') + ' | 样例=' + JSON.stringify(wj.info || {}).slice(0, 120));

      // ── 2) 相似推荐 ──
      const simi = await val(`(async()=>{
        const r = await UzzApi.getSimi('451703096','netease',10);
        return JSON.stringify({n:r.length, first:r.slice(0,3).map(x=>x.name+'/'+x.artist)});
      })()`);
      const sj = JSON.parse(simi || '{}');
      check('相似推荐返回真实曲目', (sj.n || 0) > 0, 'n=' + sj.n + ' 样例=' + (sj.first || []).join(' , '));

      // ── 3) 歌单导入 ──
      // 说明：线上公网模式（XY_PUBLIC_API=1）刻意不放行 /api/import/resolve
      //（server/public-api.js 白名单不含该路径，属安全设计，不是缺陷）。
      // 因此这里先测线上是否按预期被拒，再切本地后端测真实导入能力。
      const impOnline = await val(`(async()=>{
        try{ const r = await UzzApi.resolveImport('3778678','netease'); return JSON.stringify({ok:true,n:(r.tracks||[]).length,name:(r.info&&r.info.name)||''}); }
        catch(e){ return JSON.stringify({ok:false,msg:String(e.message||e)}); }
      })()`);
      const io = JSON.parse(impOnline || '{}');
      check('线上导入接口按公网安全策略受限', io.ok === false, 'msg=' + (io.msg || '').slice(0, 40));

      // 切到本地后端（10.0.2.2:3111）验证真实导入能力
      const savedBase = await val(`String(localStorage.getItem('uzz.apiBase')||'')`);
      await val(`localStorage.setItem('uzz.apiBase','http://10.0.2.2:3111'); 1`);
      const impLocal = await val(`(async()=>{
        try{ const r = await UzzApi.resolveImport('3778678','netease'); return JSON.stringify({ok:true,n:(r.tracks||[]).length,name:(r.info&&r.info.name)||''}); }
        catch(e){ return JSON.stringify({ok:false,msg:String(e.message||e)}); }
      })()`);
      const il = JSON.parse(impLocal || '{}');
      check('歌单导入解析真实内容（本地后端）', il.ok === true && (il.n || 0) > 0, `歌单=${il.name} 曲目=${il.n}`);
      // ⚠️ 必须写回原值而不是 removeItem：删掉后 getApiBase() 返回空，
      // 所有在线请求会落到同源 https://localhost（返回 App 自身 HTML），后续检查全废。
      await val(`localStorage.setItem('uzz.apiBase', ${JSON.stringify(savedBase)}); 1`);

      // ── 4) 歌词翻译（走线上后端）──
      const ly = await val(`(async()=>{
        const f = await UzzApi.getLyricEx('451703096','netease');
        return JSON.stringify({l:(f.lyric||'').length,t:(f.tlyric||'').length});
      })()`);
      const lj = JSON.parse(ly || '{}');
      check('歌词+译文接口返回真实数据', (lj.l || 0) > 0 && (lj.t || 0) > 0, `lyric=${lj.l} 字符, tlyric=${lj.t} 字符`);

      // ── 5) 先造真实数据（收藏 + 听歌），供私人FM/笔记关注/我的统计使用 ──
      await val(`(()=>{
        const favs=[
          {id:'2752778648',name:'发如雪',artist:'186靓仔',vendor:'netease',pic:''},
          {id:'2148822010',name:'发如雪',artist:'Choiyl',vendor:'netease',pic:''},
          {id:'451703096',name:'Shape of You',artist:'Ed Sheeran',vendor:'netease',pic:''}
        ];
        Player.replaceFavorites(favs);
        localStorage.setItem('uzz.history', JSON.stringify([
          {id:'2752778648',name:'发如雪',artist:'186靓仔',vendor:'netease',at:Date.now()},
          {id:'2148822010',name:'发如雪',artist:'Choiyl',vendor:'netease',at:Date.now()}
        ]));
        // history/favorites 是 player.js 的模块内变量，直接写 localStorage 不会生效，
        // 必须调 reloadLibrary() 让内存态与存储同步。
        Player.reloadLibrary();
        return 1;
      })()`);
      await sleep(1200);

      // ── 6) 私人FM 真实曲目 ──
      const fm = await val(`(async()=>{
        location.hash='#discover';
        await new Promise(r=>setTimeout(r,1200));
        document.querySelector('.home-tabs button[data-channel=fm]').click();
        await new Promise(r=>setTimeout(r,4000));
        const rows=[...document.querySelectorAll('#recommendations .fm-row')];
        return JSON.stringify({n:rows.length,titles:rows.slice(0,3).map(r=>r.querySelector('strong')?.textContent)});
      })()`);
      const fj = JSON.parse(fm || '{}');
      check('私人FM 返回真实歌曲列表', (fj.n || 0) > 0, 'n=' + fj.n + ' 样例=' + (fj.titles || []).join(' , '));

      // ── 7) 笔记「关注」页是真实数据 ──
      const notes = await val(`(async()=>{
        location.hash='#notes';
        await new Promise(r=>setTimeout(r,1500));
        document.querySelector('[data-notes=follow]').click();
        await new Promise(r=>setTimeout(r,1200));
        const cards=[...document.querySelectorAll('#notesGrid .note-card')];
        return JSON.stringify({
          n:cards.length,
          kinds:[...new Set(cards.map(c=>c.dataset.action||c.dataset.online||c.dataset.localPlaylist||'(无)'))],
          titles:cards.slice(0,3).map(c=>c.querySelector('strong')?.textContent||'')
        });
      })()`);
      const nj = JSON.parse(notes || '{}');
      check('笔记「关注」Tab 真实内容', (nj.n || 0) > 0, `卡数=${nj.n} 类型=${(nj.kinds || []).join('/')} 样例=${(nj.titles || []).join(' , ')}`);

      // ── 8) 我的页统计是真实计算 ──
      const me = await val(`(async()=>{
        location.hash='#me';
        await new Promise(r=>setTimeout(r,1200));
        const favs=Player.getFavorites().length, hist=Player.getHistory().length;
        return JSON.stringify({
          shown:[document.getElementById('meFollow')?.textContent,document.getElementById('meFans')?.textContent,document.getElementById('meLevel')?.textContent],
          real:{favs,hist,expectFollow:new Set(Player.getFavorites().map(t=>t.artist)).size,expectLevel:Math.min(20,Math.max(1,Math.floor((favs*3+hist)/12)+1))}
        });
      })()`);
      const mj = JSON.parse(me || '{}');
      // meLevel 的 DOM 里是纯数字（等级），Lv. 前缀在模板里
      const shownLevel = String((mj.shown && mj.shown[2]) || '').replace(/^Lv\.?/, '');
      check('我的页统计为真实推导值', shownLevel === String(mj.real && mj.real.expectLevel), `显示=${(mj.shown || []).join('/')} 实际收藏=${mj.real && mj.real.favs} 听歌=${mj.real && mj.real.hist} 期望等级=${mj.real && mj.real.expectLevel}`);

      const okAll = out.every((x) => x.ok);
      console.log('\n结果：' + (okAll ? '✓ 进阶功能全部通过' : '✗ 有失败项'));
      ws.close();
      process.exit(okAll ? 0 : 1);
    } catch (e) {
      console.log('FATAL', e.message, e.stack);
      ws.close(); process.exit(1);
    }
  };
})().catch((e) => { console.log(JSON.stringify({ error: e.message })); process.exit(1); });
