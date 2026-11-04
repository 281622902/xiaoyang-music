// 一次性：点「检查版本更新」等 12s 读最终结果（sheet 或 toast）
const ID = process.argv[2];
const ws = new WebSocket('ws://localhost:9222/devtools/page/' + ID);
ws.onopen = () => ws.send(JSON.stringify({
  id: 1, method: 'Runtime.evaluate',
  params: {
    expression: `(async () => {
      document.querySelector('[data-action="update"]')?.click();
      await new Promise(r => setTimeout(r, 12000));
      const sheet = document.getElementById('sheetBackdrop');
      const toast = document.getElementById('toast');
      return JSON.stringify({
        sheetVisible: !sheet.hidden,
        sheetTitle: document.getElementById('sheetTitle')?.textContent || null,
        sheetBody: (document.getElementById('sheetContent')?.textContent || '').slice(0, 150) || null,
        hasDownloadBtn: !!document.getElementById('mobileUpdateDownload'),
        toastVisible: !toast.classList.contains('hidden'),
        toastText: toast.textContent || null,
      });
    })()`,
    awaitPromise: true, returnByValue: true,
  },
}));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id === 1) {
    console.log('RESULT:', m.result?.result?.value ?? JSON.stringify(m.result?.exceptionDetails?.exception?.description || m.result));
    process.exit(0);
  }
};
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 30000);
