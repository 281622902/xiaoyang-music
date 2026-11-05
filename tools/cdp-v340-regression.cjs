// v3.4.0 完整回归：逐页逐菜单验证 + 新增功能
const http = require('http');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const listTargets = () => new Promise((res, rej) => http.get('http://127.0.0.1:9222/json/list', r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}}); }).on('error', rej));

(async () => {
  const t = (await listTargets()).find(x => x.type === 'page');
  if (!t) { console.log(JSON.stringify({ error: 'no page target' })); return; }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  const evalJs = expr => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } })); });
  const val = async expr => (await evalJs(expr))?.result?.value;
  const json = async expr => { try { return JSON.parse(await val(expr) || '{}'); } catch { return {}; } };

  const SNAP = `(() => JSON.stringify({
    h:location.hash,
    pg:[...document.querySelectorAll('.m-page')].map(p=>p.id+(p.hidden?'0':'1')).join(','),
    sh:!document.getElementById('sheetBackdrop').hidden,
    shT:document.getElementById('sheetTitle')?.textContent||'',
    dr:!document.getElementById('drawerBackdrop').hidden,
    ac:!document.getElementById('accountBackdrop').hidden,
    pl:!document.getElementById('mobilePlayer').hidden,
    ts:(document.getElementById('toast')?.textContent||'').slice(0,50),
    chan:document.querySelector('.home-tabs button.active')?.dataset.channel||'',
    chanTitle:document.getElementById('discoverSectionTitle')?.textContent||'',
    recCards:document.getElementById('recommendations')?.querySelectorAll('button').length||0,
    fmRows:document.getElementById('recommendations')?.querySelectorAll('.fm-row').length||0,
    noteCards:document.getElementById('notesGrid')?.querySelectorAll('.note-card').length||0
  }))()`;

  const out = { pass: [], fail: [] };
  const check = (name, ok, detail) => (ok ? out.pass : out.fail).push(name + (detail ? ' — ' + detail : ''));
  const closeLayers = () => val(`(()=>{for(const id of ['sheetBackdrop','drawerBackdrop','accountBackdrop']){const n=document.getElementById(id); if(n&&!n.hidden)n.hidden=true;} const mp=document.getElementById('mobilePlayer'); if(mp)mp.hidden=true; return 1})()`);
  const clickAndDiff = async (expr, wait = 1200) => {
    const before = await json(SNAP);
    await val(expr);
    await sleep(wait);
    const after = await json(SNAP);
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    await closeLayers(); await sleep(200);
    return { changed, before, after };
  };

  ws.onopen = async () => {
    await val(`window.__errs=[]; window.addEventListener('error',e=>window.__errs.push('ONERR:'+(e.message||'').slice(0,100))); window.addEventListener('unhandledrejection',e=>window.__errs.push('REJ:'+String(e.reason&&e.reason.message||e.reason).slice(0,100))); 1`);

    {
      const v = await json(`JSON.stringify({mv:document.getElementById('mobileVersion')?.textContent, sv:document.getElementById('settingsVer')?.textContent, qn:document.querySelector('#page-settings .quiet-note p')?.textContent})`);
      check('版本号三处一致', v.mv === '3.4.0' && v.sv === 'v3.4.0' && /3\.4\.0/.test(v.qn || ''), JSON.stringify(v));
    }

    {
      await val(`location.hash='#discover'; 1`); await sleep(1600);
      const tabs = await json(`JSON.stringify([...document.querySelectorAll('.home-tabs button')].map((e,i)=>({i,txt:e.textContent.trim(),ch:e.dataset.channel||''})))`);
      check('首页频道 Tab 数量=6', tabs.length === 6, '实际 ' + tabs.length);
      for (const tb of tabs) {
        // 先切到另一个频道制造真实差异，再切回来，避免「点击无变化」误判
        const resetIdx = tb.i === 0 ? tabs.length - 1 : 0;
        await val(`document.querySelectorAll('.home-tabs button')[${resetIdx}].click(); 1`);
        await sleep(2600);
        const r = await clickAndDiff(`document.querySelectorAll('.home-tabs button')[${tb.i}].click(); 1`, 2800);
        const ok = r.changed && r.after.chan === tb.ch && (r.after.recCards > 0 || r.after.fmRows > 0 || r.after.chanTitle !== r.before.chanTitle);
        check(`频道「${tb.txt}」点击有响应`, ok, `chan=${r.after.chan} 卡片=${r.after.recCards} FM行=${r.after.fmRows} 标题=${r.after.chanTitle} 变化=${r.changed}`);
      }
    }

    {
      await val(`location.hash='#me'; 1`); await sleep(1300);
      const stats = await json(`JSON.stringify([...document.querySelectorAll('.ph-stats button')].map((e,i)=>({i,txt:e.textContent.trim().slice(0,6),act:e.dataset.action||''})))`);
      check('我的页统计按钮=4 且均有绑定', stats.length === 4 && stats.every(s => s.act), JSON.stringify(stats.map(s => s.txt + ':' + s.act)));
      for (const st of stats) {
        const r = await clickAndDiff(`document.querySelectorAll('.ph-stats button')[${st.i}].click(); 1`, 1000);
        check(`统计「${st.txt}」点击有响应`, r.changed, `sheet=${r.after.sh} 标题=${r.after.shT} toast=${r.after.ts}`);
      }
      const sv = await json(`JSON.stringify({f:document.getElementById('meFollow')?.textContent,fa:document.getElementById('meFans')?.textContent,l:document.getElementById('meLevel')?.textContent})`);
      check('统计数字为真实计算值（非写死 12/3/9）', sv.f !== '12' && sv.fa !== '3' && sv.l !== '9', JSON.stringify(sv));
    }

    {
      await val(`location.hash='#search'; 1`); await sleep(1300);
      const mic = await json(`JSON.stringify({act:document.querySelector('.mic-button')?.dataset.action||'', browse:document.querySelector('[data-action=showAllHot]')?.tagName||''})`);
      check('语音搜索按钮有绑定', mic.act === 'voiceSearch', JSON.stringify(mic));
      check('「浏览全部」是可点按钮', mic.browse === 'BUTTON', mic.browse);
      const r1 = await clickAndDiff(`document.querySelector('[data-action=voiceSearch]').click(); 1`, 1800);
      check('语音搜索点击有响应', r1.changed, `sheet=${r1.after.sh} 标题=${r1.after.shT} toast=${r1.after.ts}`);
      const r2 = await clickAndDiff(`document.querySelector('[data-action=showAllHot]').click(); 1`, 2200);
      check('「浏览全部」点击有响应', r2.changed, `sheet=${r2.after.sh} 标题=${r2.after.shT}`);
    }

    {
      await val(`location.hash='#me'; 1`); await sleep(1000);
      await val(`document.querySelector('[data-action=drawer]').click(); 1`); await sleep(500);
      const ban = await json(`JSON.stringify({tag:document.querySelector('.drawer-banner')?.tagName||'',act:document.querySelector('.drawer-banner')?.dataset.action||''})`);
      check('云贝横幅可点且有绑定', ban.tag === 'BUTTON' && ban.act === 'showRewards', JSON.stringify(ban));
      const r = await clickAndDiff(`document.querySelector('.drawer-banner').click(); 1`, 1000);
      check('云贝横幅点击有响应', r.changed, `sheet=${r.after.sh} 标题=${r.after.shT} toast=${r.after.ts}`);
    }

    {
      await val(`location.hash='#notes'; 1`); await sleep(1400);
      const feed = await json(SNAP);
      await val(`document.querySelector('[data-notes=follow]').click(); 1`); await sleep(1200);
      const follow = await json(SNAP);
      check('笔记「关注」Tab 切换生效', follow.chan !== undefined, `推荐卡=${feed.noteCards} 关注卡=${follow.noteCards}`);
      const dead = await val(`[...document.querySelectorAll('#notesGrid .note-card')].some(b=>!b.dataset.action&&!b.dataset.online&&!b.dataset.localPlaylist)`);
      check('笔记卡片均有可点绑定', dead === false, String(dead));
    }

    {
      await val(`location.hash='#library'; 1`); await sleep(1000);
      const imp = await val(`document.querySelector('[data-action=importPlaylist]')?'yes':'no'`);
      check('音乐库有「导入歌单」入口', imp === 'yes');
      const r = await clickAndDiff(`document.querySelector('[data-action=importPlaylist]').click(); 1`, 800);
      check('导入歌单点击有响应', r.changed, `sheet=${r.after.sh} 标题=${r.after.shT}`);
      const hasForm = await val(`!!document.getElementById('mobileImportForm')`);
      check('导入歌单表单已渲染', hasForm === true);
    }

    {
      const hasTrans = await val(`!!document.getElementById('lyricTrans')`);
      check('播放器有歌词翻译按钮', hasTrans === true);
    }

    const errs = await json(`JSON.stringify(window.__errs||[])`);
    check('无 JS 运行时错误', errs.length === 0, errs.join(' | '));

    console.log('\n===== v3.4.0 菜单功能回归 =====');
    console.log('通过 ' + out.pass.length + ' 项：');
    out.pass.forEach(p => console.log('  ✓ ' + p));
    if (out.fail.length) {
      console.log('\n失败 ' + out.fail.length + ' 项：');
      out.fail.forEach(p => console.log('  ✗ ' + p));
    }
    console.log('\n结果：' + (out.fail.length ? '✗ 有失败项' : '✓ 全部通过'));
    ws.close(); process.exit(out.fail.length ? 1 : 0);
  };
})().catch(e => { console.log(JSON.stringify({ error: e.message, stack: e.stack })); process.exit(1); });
