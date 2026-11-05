/* ============================================================
 * device-auth.js — 设备授权（v3.5.0 防泄露机制）
 *
 * 用户诉求：
 *   「为了软件运行安全，防止泄露，加入授权密码。陌生设备第一次安装需要
 *    验证密码，熟悉设备版本升级可以不用密码验证。授权密码在每次版本升级
 *    都不一样，之前密码自动失效。」
 *
 * 本模块的落地方式：
 *   1. 设备指纹由原生插件提供（ANDROID_ID + 包名 + 签名证书 SHA-256），
 *      重装不变、换机必变、改包名/换签名必变；
 *   2. 本地留存授权记录 {deviceId, version, authorizedAt}：
 *      同设备升级 → 指纹一致 → 自动续期免验证；
 *   3. 陌生设备 → 必须输入授权码，服务端校验「码存在 + 未吊销 +
 *      版本与当前一致 + 绑定本机指纹」，四项全过才放行；
 *   4. 每次发版换一批新码：旧版本授权码在新版本上校验失败，自动失效；
 *   5. 授权未通过时用全屏遮罩阻断 App，业务代码完全不启动。
 *
 * 降级策略（保证可用性）：
 *   · 取不到设备指纹（极老设备 / 桌面浏览器）→ 不拦截，只记录状态；
 *   · 授权服务不可达且本地无记录 → 放行但标记「未验证」，避免服务
 *     故障把正常用户挡在门外；作者可在服务端把某设备强制吊销。
 * ============================================================ */
(function (global) {
  'use strict';

  const KEY = 'xy.deviceAuth';
  const DEFAULT_API = '';
  const cache = {};

  function readLocal() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function writeLocal(obj) {
    try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch (e) { /* 隐私模式 */ }
  }
  function clearLocal() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }
  function apiBase() {
    try { return (global.UzzApi?.getApiBase?.() || DEFAULT_API).replace(/\/+$/, ''); }
    catch (e) { return DEFAULT_API; }
  }
  function currentVersion() {
    return String(global.XYCloud?.appVersion || '').replace(/^v/, '') || '0.0.0';
  }
  async function httpGet(path, timeout = 8000) {
    const base = apiBase();
    if (!base) throw new Error('尚未配置音乐服务地址，无法查询授权状态');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      let res;
      try {
        res = await fetch(base + path, { signal: ctrl.signal });
      } catch (e) {
        // 网络层失败（断网 / 服务不可达 / 超时）——与「服务端明确答复」区分开
        const err = new Error(e.message || '网络异常');
        err.network = true;
        throw err;
      }
      const j = await res.json().catch(() => null);
      if (!res.ok || !j) throw new Error((j && j.msg) || ('HTTP ' + res.status));
      return j;
    } finally { clearTimeout(timer); }
  }
  async function httpPost(path, body, timeout = 10000) {
    const base = apiBase();
    if (!base) throw new Error('尚未配置音乐服务地址，无法校验授权码');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(base + path, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const j = await res.json().catch(() => null);
      if (!j) throw new Error('授权服务返回了非 JSON 内容，请检查音乐服务地址');
      return j;
    } finally { clearTimeout(timer); }
  }

  /* ---------- 设备指纹 ---------- */
  async function deviceId() {
    if (cache.deviceId) return cache.deviceId;
    // 原生指纹来源：优先显式注入的桥（测试/定制用），再回落 Capacitor 插件。
    // 任一来源返回非空 id 即认为拿到了「真机指纹」，此时才具备做设备绑定校验的条件。
    const candidates = [global.XYDeviceAuthNative, global.XYNative?.DeviceAuth].filter(x => x && typeof x.deviceId === 'function');
    for (const native of candidates) {
      try {
        const r = await native.deviceId();
        const id = String((r && r.deviceId) || '').trim();
        if (!id) continue;
        cache.deviceId = id;
        cache.fromNative = true;
        cache.androidId = (r && r.androidId) || '';
        cache.signer = (r && r.signer) || '';
        return cache.deviceId;
      } catch (e) { /* 试下一个来源 */ }
    }
    // 桌面浏览器 / 原生插件不可用：用一个随机安装标识兜底（仍能保证「同设备一致」）
    if (!cache.deviceId) {
      let id = '';
      try { id = localStorage.getItem('xy.installId') || ''; } catch (e) { id = ''; }
      if (!id) {
        id = (global.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 24);
        try { localStorage.setItem('xy.installId', id); } catch (e) { /* ignore */ }
      }
      cache.deviceId = 'web-' + id;
      cache.fromNative = false;
    }
    return cache.deviceId;
  }

  /* ---------- 状态 ---------- */
  // 返回 { authorized, deviceId, version, authorizedAt, renewed, service, checked }
  async function status() {
    const version = currentVersion();
    const id = await deviceId();
    const local = readLocal();
    const localOk = !!(local && local.deviceId === id && local.authorizedAt);
    const base = {
      deviceId: id, version, authorized: localOk,
      authorizedAt: local?.authorizedAt || 0, renewed: false, service: false, localOnly: localOk,
    };
    if (localOk) {
      // 同设备升级：版本变了但指纹一致 → 自动续期（用户明确要求免验证）
      if (local.version !== version) {
        writeLocal({ ...local, version, renewedAt: Date.now() });
        base.renewed = true;
        base.version = version;
      }
      return base;
    }
    // 本地没有记录 → 问服务端这台设备在本版本下是否已授权
    try {
      const r = await httpGet('/api/auth/license/status?device=' + encodeURIComponent(id) + '&version=' + encodeURIComponent(version));
      base.service = r.code === 200;
      if (r.authorized) {
        writeLocal({ deviceId: id, version, authorizedAt: Date.now(), via: 'server' });
        base.authorized = true;
      }
      return base;
    } catch (e) {
      // network=true → 服务压根没应答（断网/宕机），属于可用性问题，放行；
      // network=false → 服务应答了但没有授权接口（如服务端还没升级到 v3.5.0），
      //                这属于「服务端明确不认账」，必须拦，不能放行。
      base.service = !e.network;
      base.error = e.message || '授权服务不可达';
      return base;
    }
  }

  /* ---------- 校验并激活 ---------- */
  async function verify(code) {
    const version = currentVersion();
    const id = await deviceId();
    const r = await httpPost('/api/auth/license/verify', { code, device: id, version });
    if (!r || !r.ok) return { ok: false, msg: (r && r.msg) || '授权码无效' };
    writeLocal({ deviceId: id, version, authorizedAt: Date.now(), via: 'code' });
    // 校验成功就地把门禁撤掉——不管是从门禁页还是设置页发起的，
    // 否则设置页验完码，门禁还杵在前面，用户会以为没生效。
    if (typeof closeGate === 'function') closeGate();
    return { ok: true, msg: '授权成功', license: r.license || null };
  }

  /* ---------- 解除本机授权 ---------- */
  async function reset() {
    clearLocal();
    return true;
  }

  /* ---------- 启动门禁 ---------- */
  // 未授权时渲染全屏遮罩并阻断交互；授权后放行。
  let gateOpen = false;
  function ensureGateMarkup() {
    if (document.getElementById('deviceAuthGate')) return;
    const box = document.createElement('div');
    box.id = 'deviceAuthGate';
    box.className = 'auth-gate';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML =
      '<div class="auth-gate-card">' +
      '<img class="auth-gate-logo" src="icon.svg" alt="">' +
      '<h2 id="authGateTitle">设备授权验证</h2>' +
      '<p class="muted" id="authGateDesc">正在读取设备信息…</p>' +
      '<div class="auth-gate-meta"><span>设备码</span><strong id="authGateDevice">读取中…</strong></div>' +
      '<div class="auth-gate-meta"><span>当前版本</span><strong id="authGateVersion">—</strong></div>' +
      '<label class="auth-gate-label">授权码<input id="authGateInput" type="text" inputmode="text" autocomplete="off" spellcheck="false" placeholder="XY' + currentVersion() + '-XXXX-XXXX-XXXX"></label>' +
      '<p class="auth-gate-status" id="authGateStatus" role="status" aria-live="polite"></p>' +
      '<button class="primary wide-button" id="authGateSubmit">验证并进入</button>' +
      '<button class="auth-gate-retry" id="authGateRetry" type="button">重新读取设备信息</button>' +
      '</div>';
    document.body.appendChild(box);
  }
  function closeGate() {
    const gate = document.getElementById('deviceAuthGate');
    if (gate) gate.remove();
    gateOpen = false;
    document.documentElement.classList.remove('auth-locked');
    global.XYDeviceAuthGateOpen = false;
  }
  function openGate(state) {
    ensureGateMarkup();
    gateOpen = true;
    global.XYDeviceAuthGateOpen = true;
    document.documentElement.classList.add('auth-locked');
    const dev = document.getElementById('authGateDevice');
    const ver = document.getElementById('authGateVersion');
    const desc = document.getElementById('authGateDesc');
    if (dev) dev.textContent = state.deviceId || '读取失败';
    if (ver) ver.textContent = 'v' + (state.version || '—');
    if (desc) {
      desc.textContent = state.service === false
        ? '授权服务暂时无法应答。若你已获得授权码，可直接输入尝试验证。'
        : '检测到这是一台新设备，请输入本版本的授权码以继续使用。';
    }
    const input = document.getElementById('authGateInput');
    const submit = document.getElementById('authGateSubmit');
    const statusEl = document.getElementById('authGateStatus');
    const retry = document.getElementById('authGateRetry');
    if (input && !input.value) input.focus();
    if (submit) {
      submit.onclick = async () => {
        const code = (input?.value || '').trim();
        if (!code) { if (statusEl) statusEl.textContent = '请输入授权码'; return; }
        submit.disabled = true;
        if (statusEl) statusEl.textContent = '正在验证…';
        try {
          const r = await verify(code);
          if (statusEl) statusEl.textContent = r.msg || (r.ok ? '授权成功' : '授权失败');
          if (r.ok) { closeGate(); global.XYDeviceAuth?.onAuthorized?.(); }
        } catch (e) {
          if (statusEl) statusEl.textContent = '验证失败：' + (e.message || '网络异常');
        } finally { submit.disabled = false; }
      };
    }
    if (input) {
      input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit?.click(); } };
    }
    if (retry) {
      retry.onclick = async () => {
        if (statusEl) statusEl.textContent = '正在重新读取…';
        const st = await status();
        if (st.authorized) { closeGate(); global.XYDeviceAuth?.onAuthorized?.(); return; }
        if (dev) dev.textContent = st.deviceId || '读取失败';
        if (statusEl) statusEl.textContent = st.authorized ? '已授权' : '仍需授权码';
      };
    }
  }

  /** 启动门禁：返回 Promise<state>，未授权时自动弹出遮罩 */
  async function gate() {
    const state = await status();
    // 强制拦截的判据是「能取到原生设备指纹」——只有真机才有资格做设备绑定校验，
    // 桌面浏览器与插件异常时降级放行，避免把正常用户挡在门外。
    const enforced = !!cache.fromNative;
    if (state.authorized || !enforced) { closeGate(); return state; }
    // 取不到设备指纹 → 无法做设备绑定校验，放行但保持未验证状态（不阻断用户）
    if (!state.deviceId) { closeGate(); return state; }
    // 授权服务不可达（网络故障 / 服务端未升级 / 还没配置后端地址）：
    //   按降级策略先放行，绝不因为服务挂了就锁死所有用户；
    //   同时挂一个后台复查，服务恢复后如果这台设备确实没授权，再把门禁拉起来。
    if (state.service === false) {
      closeGate();
      scheduleRecheck();
      return state;
    }
    openGate(state);
    return state;
  }

  // 后台复查：服务恢复后如果这台设备仍未授权，重新拉起门禁。
  // 只在「服务不可达时放行」这条路径上启用，正常授权路径不会重复打扰用户。
  let recheckTimer = null;
  function scheduleRecheck() {
    if (recheckTimer) return;
    recheckTimer = setInterval(async () => {
      if (gateOpen) return;
      let st = null;
      try { st = await status(); } catch (e) { return; }
      if (!st || st.service === false) return;      // 服务还没恢复，继续等
      if (st.authorized) { clearInterval(recheckTimer); recheckTimer = null; return; }
      // 服务正常了，但这台设备没授权 → 该拦
      clearInterval(recheckTimer); recheckTimer = null;
      if (cache.fromNative && st.deviceId) openGate(st);
    }, 60000);
  }

  // 看门狗：万一脚本加载失败或原生插件异常，遮罩不能把用户永久锁死。
  // 取不到原生指纹即视为无法做绑定校验，12 秒后放行。
  setTimeout(() => {
    if (!gateOpen) return;
    deviceId().then(id => { if (!cache.fromNative) closeGate(); }).catch(() => closeGate());
  }, 12000);

  global.XYDeviceAuth = { status, verify, reset, gate, deviceId, currentVersion, onAuthorized: null };
})(window);
