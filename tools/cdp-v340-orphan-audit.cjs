// v3.4.0 补充审计（闭环版）：逐页扫所有可点元素，找出「无任何绑定」的孤儿
// 1) 表单 submit 按钮由 form.onsubmit 接管，不算孤儿（消除假阳性）
// 2) 运行时收集全量 data-action，与 app/js/android.js 的 actions 键做差集，
//    差集为 0 即证明「HTML 里出现的每一个 data-action 都有真实实现」
const http = require('http');
const path = require('path');
const { parseActionsKeys } = require('./parse-actions-keys.cjs');

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

  const PAGES = ['discover', 'search', 'notes', 'library', 'me', 'settings'];
  const PANELS = [['抽屉', '#drawerBackdrop'], ['播放器', '#mobilePlayer'], ['弹层', '#sheetBackdrop'], ['登录', '#accountBackdrop']];
  const out = [];
  const allActions = new Set();

  // 扫描逻辑：既找无绑定元素，也收集 data-action
  const SCAN = (rootSel) => `(()=>{
    const box=document.querySelector('${rootSel}');
    if(!box)return JSON.stringify({err:'none'});
    const nodes=[...box.querySelectorAll('button,a[href],input,select,textarea,[role=button],[data-action],[data-nav],[data-tab],[data-type],[data-notes],[data-channel],[data-view]')];
    const orphan=[];const submitBound=[];const actions=[];
    for(const n of nodes){
      if(n.dataset&&n.dataset.action)actions.push(n.dataset.action);
      if(n.disabled)continue;
      const attrs=[...n.attributes].map(a=>a.name).filter(a=>a.startsWith('data-')&&a!=='data-icon');
      const hasHandler=!!n.onclick||!!n.getAttribute('onclick');
      const isNav=n.hasAttribute('data-nav');
      const hasId=!!n.id;
      // 表单 submit 按钮：由最近的 form.onsubmit 接管，不算孤儿
      const isSubmit=(n.tagName==='BUTTON'||n.tagName==='INPUT')&&n.type==='submit';
      const form=n.closest&&n.closest('form');
      const submitOk=isSubmit&&!!form&&(!!form.onsubmit||!!form.getAttribute('onsubmit'));
      if(submitOk){submitBound.push(n.tagName+'「'+(n.textContent||'').trim().slice(0,14)+'」');continue;}
      if(!attrs.length&&!hasHandler&&!isNav&&!hasId){
        orphan.push((n.tagName+'.'+(n.className||'').toString().split(' ').slice(0,2).join('.')+'#'+(n.id||'-')+'「'+(n.textContent||'').trim().slice(0,14)+'」'));
      }
    }
    return JSON.stringify({total:nodes.length,orphanCount:orphan.length,orphan:orphan.slice(0,14),submitBound,actions:[...new Set(actions)]});
  })()`;

  ws.onopen = async () => {
    await val(`window.__errs=[];window.addEventListener('error',e=>window.__errs.push(String(e.message||'').slice(0,80)));1`);
    for (const p of PAGES) {
      await val(`location.hash='#${p}'; 1`);
      await sleep(1400);
      const info = await json(SCAN(`#page-${p}`));
      (info.actions || []).forEach((a) => allActions.add(a));
      out.push({ page: p, ...info });
      console.log(`【${p}】可点元素 ${info.total} | 无绑定 ${info.orphanCount} | 表单提交 ${(info.submitBound || []).length} | 动作 ${(info.actions || []).length} 个`);
      if (info.orphan && info.orphan.length) info.orphan.forEach((o) => console.log('    ⚠ ' + o));
    }

    for (const [name, sel] of PANELS) {
      const info = await json(SCAN(sel));
      (info.actions || []).forEach((a) => allActions.add(a));
      console.log(`【${name}】可点 ${info.total} | 无绑定 ${info.orphanCount} | 动作 ${(info.actions || []).length} 个`);
      if (info.orphan && info.orphan.length) info.orphan.forEach((o) => console.log('    ⚠ ' + o));
    }

    // 静态 actions 键 × 运行时 data-action 差集
    const keys = parseActionsKeys(path.join(__dirname, '..', 'app', 'js', 'android.js'));
    const keySet = new Set(keys);
    const missing = [...allActions].filter((a) => !keySet.has(a));
    const unused = keys.filter((k) => !allActions.has(k));

    console.log('\n──── 闭环校验 ────');
    console.log(`actions 处理器 ${keys.length} 个 | 运行时采集 data-action ${allActions.size} 个`);
    console.log('HTML 有但 actions 无实现: ' + (missing.length ? '❌ ' + missing.join(' ') : '0 个 ✅'));
    console.log('actions 有但运行时未采集到: ' + (unused.length ? unused.join(' ') : '0 个 ✅'));
    const totalOrphan = out.reduce((s, x) => s + (x.orphanCount || 0), 0);
    console.log('全页孤儿元素合计: ' + (totalOrphan ? '❌ ' + totalOrphan : '0 ✅'));

    const errs = await json(`JSON.stringify(window.__errs||[])`);
    console.log('运行时错误: ' + (errs.length ? errs.join(' | ') : '无 ✅'));
    ws.close();
    process.exit(0);
  };
})().catch((e) => { console.log(JSON.stringify({ error: e.message })); process.exit(1); });
