// v3.3.0 登录代理取证：①初始化状态 ②hosts 屏蔽 supabase.co 后真实登录测试
const PAGE = process.argv[2];
if (!PAGE) { console.error('用法: node cdp-login-proxy-verify.cjs <pageId>'); process.exit(1); }
const ws = new WebSocket('ws://localhost:9222/devtools/page/' + PAGE);
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const evalJs = (expr) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } })); });

(async () => {
  ws.onopen = async () => {
    try {
      // ① 初始化状态取证
      const t1 = await evalJs(`(() => {
        const base = (window.UzzApi?.getApiBase?.() || '').trim();
        const isAndroid = !!window.XYNative?.isAndroid;
        const proxy = window.XYNetwork?.supabaseOrigin ? window.XYNetwork.supabaseOrigin() : '(XYNetwork 未加载)';
        const cloudOk = !!window.XYCloud?.available;
        const clientAuth = !!window.supabase?.auth;
        return JSON.stringify({ apiBase: base, isAndroid, proxyTarget: proxy, cloudAvailable: cloudOk, sdkAuth: clientAuth });
      })()`);
      console.log('① 初始化状态:', t1?.result?.value);
      const st = JSON.parse(t1.result.value);

      // ② 直接调登录（错误密码）：hosts 已屏蔽 supabase.co —— 400=走代理通，网络错=直连死
      const t2 = await evalJs(`(async () => {
        try {
          const { data, error } = await window.supabase.auth.signInWithPassword({ phone: '+8613800000000', password: 'wrong-test-only' });
          if (error) return JSON.stringify({ result: 'GOT_RESPONSE', code: error.status || error.message, msg: (error.message || '').slice(0, 80) });
          return JSON.stringify({ result: 'UNEXPECTED_SUCCESS' });
        } catch (e) { return JSON.stringify({ result: 'THROWN', err: (e.message || String(e)).slice(0, 140) }); }
      })()`);
      console.log('② 屏蔽 supabase.co 后登录测试:', t2?.result?.value);
      const r2 = JSON.parse(t2.result.value);
      const viaProxy = r2.result === 'GOT_RESPONSE';
      console.log(viaProxy ? '✓ 登录请求走了 Render 代理（被墙环境下依然收到业务响应）' : '✗ 登录请求直连 supabase.co（被墙即死）—— 需要修复！');
      process.exit(0);
    } catch (e) { console.error('FATAL', e.message); process.exit(1); }
  };
  setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 60000);
})();
