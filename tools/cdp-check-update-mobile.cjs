// CDP 驱动 MuMu 上的小杨音乐移动端：我的页 → 检查版本更新 全链路验证
const ID = process.argv[2];
if (!ID) { console.error('usage: node cdp-check-update-mobile.cjs <pageId>'); process.exit(1); }

const ws = new WebSocket('ws://localhost:9222/devtools/page/' + ID);
let nextId = 1;
const pending = new Map();

function evalJs(expr, ms) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
    setTimeout(() => reject(new Error('eval timeout #' + id)), ms || 25000);
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

  // 1) 首屏版本号（mobileVersion 初始值 + App.getInfo 真实值）
  const probe = await evalJs(`(async () => {
    const nativeInfo = window.XYNative?.App?.getInfo ? await window.XYNative.App.getInfo().catch(() => null) : null;
    return JSON.stringify({
      mobileVersionSpan: document.getElementById('mobileVersion')?.textContent ?? null,
      nativeVersion: nativeInfo?.version ?? null,
      cloudVersion: window.XYCloud?.appVersion ?? null,
      updateBtn: !!document.querySelector('[data-action="update"]'),
    });
  })()`);
  console.log('PROBE:', probe);

  // 2) 切到「我的」页，点「检查版本更新」
  const flow = await evalJs(`(async () => {
    document.querySelector('[data-nav="me"]')?.click();
    await new Promise(r => setTimeout(r, 500));
    const btn = document.querySelector('[data-action="update"]');
    if (!btn) return 'NO_UPDATE_BTN';
    btn.click();
    // 等检查完成（toast 或 sheet 二选一出现）
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const sheetVisible = !document.getElementById('sheetBackdrop')?.hidden;
      const sheetTitle = document.getElementById('sheetTitle')?.textContent || '';
      const toastEl = document.getElementById('toast');
      const toastText = toastEl && !toastEl.classList.contains('hidden') ? toastEl.textContent : '';
      if (sheetVisible && sheetTitle) {
        return JSON.stringify({
          result: 'SHEET', title: sheetTitle,
          body: (document.getElementById('sheetContent')?.textContent || '').slice(0, 120),
          hasDownloadBtn: !!document.getElementById('mobileUpdateDownload'),
        });
      }
      if (toastText) return JSON.stringify({ result: 'TOAST', text: toastText });
    }
    return JSON.stringify({ result: 'TIMEOUT' });
  })()`, 30000);
  console.log('FLOW:', flow);

  // 3) 若弹了窗，关掉（不真点下载，避免模拟器真去下载 APK）
  await evalJs(`(()=>{const b=document.getElementById('sheetBackdrop');if(b&&!b.hidden){const c=b.querySelector('[data-action="closeSheet"]');if(c)c.click();return 'closed';}return 'no sheet';})()`);
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
