// 一次性：双搜索验证 Render 上缓存代码是否生效（第二次同词搜索应显著加速）
const ID = process.argv[2];
const ws = new WebSocket('ws://localhost:9222/devtools/page/' + ID);
ws.onopen = () => ws.send(JSON.stringify({
  id: 1, method: 'Runtime.evaluate',
  params: {
    expression: `(async () => {
      const t = async (k) => {
        const s = Date.now();
        const r = await fetch('https://xiaoyang-music-api.onrender.com/api/search?keyword=' + encodeURIComponent(k) + '&type=song&page=1&limit=3&vendor=auto');
        const j = await r.json();
        return k + ' => total:' + (j.total || 0) + ' ' + (Date.now() - s) + 'ms';
      };
      const a = await t('晴天');
      const b = await t('晴天');
      return a + ' | ' + b;
    })()`,
    awaitPromise: true, returnByValue: true,
  },
}));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id === 1) {
    console.log('CACHE CHECK:', m.result?.result?.value ?? JSON.stringify(m.result?.exceptionDetails?.exception?.description || m.result));
    process.exit(0);
  }
};
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 60000);
