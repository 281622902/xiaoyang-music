// 探测 Supabase SDK 初始化 URL（代理 or 直连）——决定性证据
const PAGE = process.argv[2];
const ws = new WebSocket('ws://localhost:9222/devtools/page/' + PAGE);
ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `(() => {
  const sb = window.supabase;
  const out = {};
  try { out.restUrl = sb.rest?.url || null; } catch (e) { out.restErr = e.message; }
  try { out.authPrivateUrl = sb.auth?.['#url'] || null; } catch (e) {}
  // 遍历 auth 实例自有属性找 URL 痕迹
  try {
    const found = {};
    let o = sb.auth, depth = 0;
    while (o && depth < 3) {
      for (const n of Object.getOwnPropertyNames(o)) {
        try {
          const v = o[n];
          if (typeof v === 'string' && (v.startsWith('http') || v.includes('supabase') || v.includes('onrender')))
            found['d' + depth + '.' + n] = v.slice(0, 80);
          else if (n === 'url' || n.includes('Url')) found['d' + depth + '.' + n] = String(v).slice(0, 80);
        } catch (e) {}
      }
      o = Object.getPrototypeOf(o); depth++;
    }
    out.authUrlTraces = found;
  } catch (e) { out.authErr = e.message; }
  // storageUrl
  try { out.storageUrl = sb.storage?.url || null; } catch (e) {}
  return JSON.stringify(out);
})()`, awaitPromise: true, returnByValue: true } }));
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) { console.log(m.result?.result?.value ?? JSON.stringify(m.result).slice(0, 600)); process.exit(0); } };
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 25000);
