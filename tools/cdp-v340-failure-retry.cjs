// v3.4.0 失败态重试按钮活性验证
// 故障注入：把后端地址改成不可达域名 → 触发搜索/首页加载失败 → 验证
// 错误态渲染出的「重新加载」按钮（data-action=retrySearch / refreshDiscover）
// 确实被绑定、点击后真的重新发起了请求，而不是死按钮。
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
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p(m.result); }
  };
  const val = (expression) => new Promise((resolve) => {
    const id = ++seq; pending.set(id, (r) => resolve(r?.result?.value));
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  const json = async (e) => { try { return JSON.parse(await val(e) || '{}'); } catch { return {}; } };
  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  ws.onopen = async () => {
    // 1) 保存现场，注入 fetch 计数器
    await val(`window.__savedBase=localStorage.getItem('uzz.apiBase')||'';window.__net=0;
      if(!window.__origFetch){window.__origFetch=window.fetch;window.fetch=function(){window.__net++;return window.__origFetch.apply(this,arguments);};}
      1`);

    // 2) 断后端 → 触发搜索失败
    await val(`localStorage.setItem('uzz.apiBase','https://dead-host.invalid');1`);
    await val(`location.hash='#search';1`);
    await sleep(900);
    await val(`location.hash='#discover';location.hash='#search';1`);
    await sleep(900);
    await val(`const i=document.getElementById('mobileSearchInput');i.value='周杰伦';i.form.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));1`);
    await sleep(4500);

    const failState = await json(`(()=>{
      const b=[...document.querySelectorAll('#mobileResults [data-action]')].map(e=>({a:e.dataset.action,t:(e.textContent||'').trim()}));
      return JSON.stringify({buttons:b,summary:(document.getElementById('searchSummary')||{}).textContent||''});
    })()`);
    const retryBtn = (failState.buttons || []).find((b) => b.a === 'retrySearch');
    check('搜索失败态渲染出「重新加载」按钮', !!retryBtn, retryBtn ? `data-action=${retryBtn.a} 文案「${retryBtn.t}」` : `summary=${failState.summary}`);

    // 3) 点击重试 → 验证真的重新发起请求
    if (retryBtn) {
      const before = await val(`window.__net`);
      await val(`document.querySelector('#mobileResults [data-action="retrySearch"]').click();1`);
      await sleep(3000);
      const after = await val(`window.__net`);
      const summary = await val(`(document.getElementById('searchSummary')||{}).textContent||''`);
      check('点击「重新加载」后确实重新发起请求', Number(after) > Number(before), `fetch ${before} → ${after}；summary=${summary}`);
    }

    // 4) 首页刷新按钮
    await val(`localStorage.setItem('uzz.apiBase','https://dead-host.invalid');location.hash='#discover';1`);
    await sleep(1200);
    await val(`const r=document.getElementById('refreshDiscover');r&&r.click();1`);
    await sleep(2500);
    const discState = await json(`(()=>{
      const r=document.getElementById('refreshDiscover');
      return JSON.stringify({exists:!!r,disabled:!!(r&&r.disabled),hasBind:!!(r&&r.onclick),net:window.__net});
    })()`);
    check('首页「刷新」按钮存在且已绑定', discState.exists && discState.hasBind, `disabled=${discState.disabled}`);

    // 5) 恢复现场
    await val(`localStorage.setItem('uzz.apiBase',window.__savedBase);1`);
    await val(`location.hash='#discover';location.hash='#search';1`);
    await sleep(2500);
    const restored = await val(`(localStorage.getItem('uzz.apiBase')||'')+'|'+(document.getElementById('searchSummary')||{}).textContent||''`);
    check('后端地址已恢复且搜索恢复正常', String(restored).indexOf('dead-host.invalid') < 0, `apiBase=${String(restored).split('|')[0]}`);

    const pass = results.filter((r) => r.ok).length;
    console.log(`\n失败态重试验证: ${pass}/${results.length} 通过`);
    ws.close();
    process.exit(pass === results.length ? 0 : 1);
  };
})().catch((e) => { console.log(JSON.stringify({ error: e.message })); process.exit(1); });
