// CDP 驱动 MuMu 上的小杨音乐，验证移动端「检查更新」全链路
const ID = process.argv[2];
if (!ID) { console.error('usage: node cdp-check-update.cjs <pageId>'); process.exit(1); }

const ws = new WebSocket('ws://localhost:9222/devtools/page/' + ID);
let nextId = 1;
const pending = new Map();

function evalJs(expr) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
    setTimeout(() => reject(new Error('eval timeout #' + id)), 25000);
  });
}

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.result?.exceptionDetails) reject(new Error(m.result.exceptionDetails.exception?.description || 'eval error'));
    else p.resolve(m.result?.result?.value);
  }
};

(async () => {
  await new Promise(r => ws.onopen = r);

  // 1) 版本号三来源 + 按钮存在性
  const probe = await evalJs(`(async () => {
    const nativeInfo = window.XYNative?.App?.getInfo ? await window.XYNative.App.getInfo().catch(() => null) : null;
    return JSON.stringify({
      abVer: document.getElementById('abVer')?.textContent ?? null,
      nativeVersion: nativeInfo?.version ?? null,
      cloudVersion: window.XYCloud?.appVersion ?? null,
      hasAbCheck: !!document.getElementById('abCheck'),
      hasUpdCheck: !!document.getElementById('updCheck'),
      hasUpdInstall: !!document.getElementById('updInstall'),
      aboutHidden: document.querySelector('.set-page[data-page="about"]')?.classList.contains('hidden') ?? null,
    });
  })()`);
  console.log('PROBE:', probe);

  // 2) 触发一次真实检查（直接调 doUpdateCheck 同款的云端链路）
  const check = await evalJs(`(async () => {
    const btn = document.getElementById('abCheck');
    if (!btn) return 'NO_BTN';
    btn.click();
    await new Promise(r => setTimeout(r, 8000));
    return JSON.stringify({
      status: document.getElementById('updStatus')?.textContent ?? null,
      newRowVisible: !document.getElementById('updNewRow')?.classList.contains('hidden'),
      newVer: document.getElementById('updNew')?.textContent ?? null,
      notes: (document.getElementById('updNotes')?.textContent || '').slice(0, 100) || null,
      abVerNow: document.getElementById('abVer')?.textContent ?? null,
    });
  })()`);
  console.log('CHECK:', check);
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
