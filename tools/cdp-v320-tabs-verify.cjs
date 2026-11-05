// 线上终验：Render 上四个搜索 Tab（artist/album/playlist）+ artistlist 详情
const ID = process.argv[2];
const BASE = 'https://xiaoyang-music-api.onrender.com';
const ws = new WebSocket('ws://localhost:9222/devtools/page/' + ID);
ws.onopen = () => ws.send(JSON.stringify({
  id: 1, method: 'Runtime.evaluate',
  params: {
    expression: `(async () => {
      const out = {};
      for (const type of ['artist', 'album', 'playlist']) {
        const r = await fetch('${BASE}/api/search?keyword=' + encodeURIComponent('晴天') + '&type=' + type + '&page=1&limit=5&vendor=auto');
        const j = await r.json();
        out[type] = (j.result || []).length + ' 条' + ((j.result || [])[0] ? ' | 首条:' + ((j.result || [])[0].name || '').slice(0, 14) : '');
      }
      const r2 = await fetch('${BASE}/api/search?keyword=' + encodeURIComponent('晴天') + '&type=album&page=1&limit=3&vendor=auto');
      const j2 = await r2.json();
      const first = (j2.result || [])[0];
      if (first && String(first.id).startsWith('artistlist:')) {
        const r3 = await fetch('${BASE}/api/album?id=' + encodeURIComponent(first.id) + '&limit=5');
        const j3 = await r3.json();
        out.detail = (j3.tracks || []).length + ' 首可播';
      }
      return JSON.stringify(out);
    })()`,
    awaitPromise: true, returnByValue: true,
  },
}));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id === 1) {
    console.log('线上四类Tab终验:', m.result?.result?.value ?? JSON.stringify(m.result?.exceptionDetails?.exception?.description || m.result));
    process.exit(0);
  }
};
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 90000);
