// 从模拟器测 Render health + 登录代理链
const PAGE = process.argv[2];
const ws = new WebSocket('ws://localhost:9222/devtools/page/' + PAGE);
ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `(async () => {
  const t = async (u, opt) => { try { const s = Date.now(); const r = await fetch(u, opt); let body = ''; try { body = (await r.text()).slice(0, 120); } catch (e) {} return 'HTTP ' + r.status + ' (' + (Date.now() - s) + 'ms) ' + body; } catch (e) { return 'FAIL: ' + e.message; } };
  const health = await t('https://xiaoyang-music-api.onrender.com/api/health');
  const login = await t('https://xiaoyang-music-api.onrender.com/api/supabase/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: 'sb_publishable__DRTgpxPfdR67tsFEJ_EDQ_gvZ8VvdM', 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '+8613800000000', password: 'wrong-test-only' }),
  });
  return JSON.stringify({ health, login });
})()`, awaitPromise: true, returnByValue: true } }));
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) { console.log(m.result?.result?.value ?? JSON.stringify(m.result).slice(0, 400)); process.exit(0); } };
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 40000);
