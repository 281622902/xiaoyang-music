// 一次性：开启悬浮窗并显示验收文案
const ID = process.argv[2];
const ws = new WebSocket('ws://localhost:9222/devtools/page/' + ID);
ws.onopen = () => ws.send(JSON.stringify({
  id: 1, method: 'Runtime.evaluate',
  params: {
    expression: `(async () => {
      await window.XYNative.NativeMusic.lyricOverlay({ show: true, cur: '验收测试当前句 · 周杰伦', next: '验收测试下一句预览', playing: true });
      return 'shown';
    })()`,
    awaitPromise: true, returnByValue: true,
  },
}));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id === 1) { console.log(m.result?.result?.value ?? 'ERR'); process.exit(0); }
};
setTimeout(() => process.exit(1), 20000);
