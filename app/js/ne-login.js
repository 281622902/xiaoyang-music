// ne-login.js — 网易云风格登录弹窗：验证码登录 / 密码登录(含注册) / 扫码登录
// 依赖：XYCloud(supabase-client) 的 loginUser/registerUser/sendLoginCode/verifyLoginCode/
//       createLoginTicket/getLoginTicket；vendor/qr 的 qrcode 全局。
// 弹窗开关仍由 studio.js(#accountOpen) 触发；本模块负责卡片内部全部交互。
(function (global) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const cloud = () => global.XYCloud || {};
  const say = (text) => { const el = $('cloudAccountStatus'); if (el) el.textContent = text || ''; };
  const QR_TOKEN_PREFIX = 'xymusic://qr-login?t=';
  const POLL_MS = 2000;

  document.addEventListener('DOMContentLoaded', () => {
    const card = $('accountModal');
    if (!card) return; // 移动端无此弹窗时静默退出

    /* ── 模式管理：code（验证码）/ pwd（密码）/ register（注册） ── */
    let mode = localStorage.getItem('uzz.login.mode') || 'pwd';
    if (mode !== 'code' && mode !== 'pwd') mode = 'pwd';
    let registering = false;
    let sendTimer = null, pollTimer = null, qrToken = '', qrExpiresAt = 0, pollAbort = false;

    const phoneVal = () => ($('cloudPhone').value || '').replace(/\D/g, '');
    const validPhone = () => phoneVal().length === 11 && /^1\d{10}$/.test(phoneVal());

    function paintMode() {
      const code = mode === 'code';
      $('neModeCode').classList.toggle('active', code);
      $('neModePwd').classList.toggle('active', !code);
      $('nePwdField').classList.toggle('hidden', code);
      $('neCodeField').classList.toggle('hidden', !code);
      // 注册模式只在密码登录下出现：显示确认密码框
      $('neRegField').classList.toggle('hidden', !(!code && registering));
      // 忘记密码入口：仅在「密码登录」且非注册态显示
      $('neForgotPwd').classList.toggle('hidden', code || registering);
      $('cloudPassword').autocomplete = (!code && registering) ? 'new-password' : 'current-password';
      $('cloudPassword').placeholder = (!code && registering) ? '请设置登录密码（至少 6 位）' : '请输入登录密码';
      $('cloudSubmit').textContent = code ? '验证码登录' : (registering ? '注册并登录' : '密码登录');
      $('neRegisterLink').textContent = registering ? '返回密码登录' : '注册账户';
      localStorage.setItem('uzz.login.mode', mode);
    }
    function switchMode(next) {
      mode = next; registering = false; say(''); paintMode();
      if (codeMode()) $('neCodeInput').focus(); else $('cloudPassword').focus();
    }
    const codeMode = () => mode === 'code';
    $('neModeCode').addEventListener('click', () => switchMode('code'));
    $('neModePwd').addEventListener('click', () => switchMode('pwd'));
    $('neRegisterLink').addEventListener('click', () => { registering = !registering; say(''); paintMode(); });

    /* ── 验证码发送（60 秒倒计时） ── */
    function startCooldown(sec, btnId) {
      const btn = $(btnId || 'neSendCode');
      let left = sec;
      btn.disabled = true;
      const paint = () => { btn.textContent = left > 0 ? left + 's 后重发' : (btnId === 'neResetSend' ? '获取验证码' : '获取验证码'); };
      paint();
      clearInterval(sendTimer);
      sendTimer = setInterval(() => {
        left -= 1; paint();
        if (left <= 0) { clearInterval(sendTimer); btn.disabled = false; }
      }, 1000);
    }
    function stopCooldown() { clearInterval(sendTimer); for (const id of ['neSendCode', 'neResetSend']) { const b = $(id); if (b) { b.disabled = false; b.textContent = '获取验证码'; } } }
    $('neSendCode').addEventListener('click', async () => {
      if (!validPhone()) { say('请输入正确的 11 位手机号'); $('cloudPhone').focus(); return; }
      if (!$('neAgree').checked) { say('请先勾选同意《服务条款》和《隐私政策》'); return; }
      const btn = $('neSendCode');
      btn.disabled = true; btn.textContent = '发送中…';
      try {
        await global.sendLoginCode(phoneVal());
        say('验证码已发送，请查收短信（部分手机会拦截到垃圾箱）');
        startCooldown(60); $('neCodeInput').focus();
      } catch (error) {
        say(error.message || '验证码发送失败');
        btn.disabled = false; btn.textContent = '获取验证码';
      }
    });

    /* ── 提交（验证码 / 密码 / 注册） ── */
    $('cloudForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!validPhone()) { say('请输入正确的 11 位手机号'); $('cloudPhone').focus(); return; }
      if (!$('neAgree').checked) { say('请先勾选同意《服务条款》和《隐私政策》'); return; }
      const btn = $('cloudSubmit');
      btn.disabled = true; say('正在处理…');
      try {
        if (codeMode()) {
          const code = ($('neCodeInput').value || '').trim();
          if (!/^\d{4,8}$/.test(code)) { say('请输入短信中的验证码'); return; }
          await global.verifyLoginCode(phoneVal(), code);
        } else if (registering) {
          const pw = $('cloudPassword').value || '', pw2 = $('neRegPwd2').value || '';
          if (pw.length < 6) { say('密码至少 6 位'); return; }
          if (pw !== pw2) { say('两次输入的密码不一致'); return; }
          await global.registerUser(phoneVal(), pw);
        } else {
          const pw = $('cloudPassword').value || '';
          if (!pw) { say('请输入登录密码'); return; }
          await global.loginUser(phoneVal(), pw);
        }
        // 记住手机号与自动登录（登录成功的会话由 supabase-js 持久化）
        try {
          if ($('neAutoLogin').checked) localStorage.setItem('uzz.login.phone', phoneVal());
          else localStorage.removeItem('uzz.login.phone');
        } catch (e) { /* 忽略 */ }
        say(''); closeModal();
        if (global.toast) global.toast('登录成功，收藏与歌单已同步');
      } catch (error) {
        say(error.message || '登录失败，请稍后重试');
      } finally {
        btn.disabled = false;
      }
    });
    $('cloudPhone').addEventListener('input', () => {
      if (localStorage.getItem('uzz.login.phone') && phoneVal() !== localStorage.getItem('uzz.login.phone')) {
        localStorage.removeItem('uzz.login.phone'); // 改动手机号即不再自动登录
      }
    });

    /* ── 弹窗开关 ── */
    function closeModal() {
      card.classList.add('hidden');
      stopPoll();
      clearInterval(sendTimer);
      backToLogin();
    }
    card.addEventListener('click', (e) => { if (e.target === card) closeModal(); });
    $('accountClose').addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !card.classList.contains('hidden')) closeModal(); });
    // 打开时恢复记住的手机号
    const obs = new MutationObserver(() => {
      if (!card.classList.contains('hidden')) {
        const saved = localStorage.getItem('uzz.login.phone') || '';
        if (saved && !$('cloudPhone').value) $('cloudPhone').value = saved;
        paintMode();
      } else stopPoll();
    });
    obs.observe(card, { attributes: true, attributeFilter: ['class'] });

    /* ── 协议链接（占位：无正式条款页时给出说明） ── */
    for (const id of ['neTerms', 'nePrivacy']) {
      $(id).addEventListener('click', (e) => { e.preventDefault(); say('条款页面筹备中：本应用仅保存收藏/歌单/偏好，不上传本地音频文件'); });
    }

    /* ── 忘记密码视图 ── */
    const resetStatus = (text) => { $('neResetStatus').textContent = text || ''; };
    function showReset() {
      $('neLoginView').classList.add('hidden');
      $('neQrView').classList.add('hidden');
      $('neResetView').classList.remove('hidden');
      $('neResetPhone').value = $('cloudPhone').value || '';
      resetStatus('');
    }
    function backToLogin() {
      $('neResetView').classList.add('hidden');
      if ($('neQrView') && !$('neQrView').classList.contains('hidden')) { /* 扫码态保持 */ return; }
      $('neLoginView').classList.remove('hidden');
    }
    $('neForgotPwd').addEventListener('click', showReset);
    $('neResetBack').addEventListener('click', () => { $('neResetView').classList.add('hidden'); $('neLoginView').classList.remove('hidden'); });
    $('neResetSend').addEventListener('click', async () => {
      const phone = ($('neResetPhone').value || '').replace(/\D/g, '');
      if (!/^1\d{10}$/.test(phone)) { resetStatus('请输入正确的 11 位手机号'); return; }
      const btn = $('neResetSend');
      btn.disabled = true; btn.textContent = '发送中…';
      try {
        await global.sendLoginCode(phone);
        resetStatus('验证码已发送，请查收短信');
        startCooldown(60, 'neResetSend');
        $('neResetCode').focus();
      } catch (error) {
        resetStatus(error.message || '验证码发送失败');
        btn.disabled = false; btn.textContent = '获取验证码';
      }
    });
    $('neResetForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const phone = ($('neResetPhone').value || '').replace(/\D/g, '');
      const code = ($('neResetCode').value || '').trim();
      const pw = $('neResetPwd').value || '';
      if (!/^1\d{10}$/.test(phone)) { resetStatus('请输入正确的 11 位手机号'); return; }
      if (!/^\d{4,8}$/.test(code)) { resetStatus('请输入短信中的验证码'); return; }
      if (pw.length < 6) { resetStatus('新密码至少 6 位'); return; }
      try {
        await global.resetUserPassword(phone, code, pw);
        // 成功：回登录视图，预填手机号与新密码，直接可登录
        mode = 'pwd'; registering = false;
        $('cloudPhone').value = phone; $('cloudPassword').value = pw;
        $('neResetView').classList.add('hidden');
        $('neLoginView').classList.remove('hidden');
        paintMode(); stopCooldown();
        say('密码已重置，请用新密码登录');
        if (global.toast) global.toast('密码已重置');
      } catch (error) {
        resetStatus(error.message || '密码重置失败');
      }
    });

    /* ── 扫码登录 ── */
    function stopPoll() {
      pollAbort = true;
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }
    function paintMask(text, show) {
      $('neQrMask').classList.toggle('hidden', !show);
      $('neQrMaskText').textContent = text;
    }
    function paintQr(token) {
      const box = $('neQrBox');
      box.replaceChildren();
      try {
        const qr = global.qrcode(0, 'M');
        qr.addData(QR_TOKEN_PREFIX + token);
        qr.make();
        const count = qr.getModuleCount();
        const size = 200, cell = size / count;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#111318';
        for (let y = 0; y < count; y++) {
          for (let x = 0; x < count; x++) {
            if (qr.isDark(y, x)) ctx.fillRect(Math.floor(x * cell), Math.floor(y * cell), Math.ceil(cell), Math.ceil(cell));
          }
        }
        box.appendChild(canvas);
      } catch (e) {
        box.textContent = '二维码生成失败';
      }
    }
    async function startQrLogin() {
      $('neLoginView').classList.add('hidden');
      $('neResetView').classList.add('hidden');
      $('neQrView').classList.remove('hidden');
      $('neQrRefresh').classList.add('hidden');
      $('neQrMask').classList.remove('hidden');
      $('neQrMaskText').textContent = '生成中…';
      stopPoll(); pollAbort = false;
      try {
        if (!cloud().available) throw new Error('云端服务未连接，暂时无法扫码登录');
        const t = await global.createLoginTicket();
        qrToken = t.token; qrExpiresAt = Date.parse(t.expiresAt) || (Date.now() + 3 * 60 * 1000);
        paintQr(qrToken);
        paintMask('', false);
        pollTimer = setInterval(pollQr, POLL_MS);
      } catch (error) {
        paintMask(error.message || '二维码生成失败', true);
        $('neQrRefresh').classList.remove('hidden');
      }
    }
    async function pollQr() {
      if (pollAbort || !qrToken) return;
      if (Date.now() > qrExpiresAt) {
        stopPoll();
        paintMask('二维码已过期', true);
        $('neQrRefresh').classList.remove('hidden');
        return;
      }
      try {
        const row = await global.getLoginTicket(qrToken);
        if (pollAbort) return;
        if (!row) { // 票据过期被清理
          stopPoll();
          paintMask('二维码已过期', true);
          $('neQrRefresh').classList.remove('hidden');
          return;
        }
        if (row.status === 'scanned') paintMask('已扫码，请在手机上确认', true);
        else if (row.status === 'confirmed') {
          stopPoll();
          paintMask('已确认，正在登录…', true);
          // 手机端确认后会话交接由后续版本接入（见 supabase/login_tickets.sql）
          say('手机已确认登录，会话交接功能将在手机端支持扫码后开放');
        }
      } catch (e) { /* 网络抖动：下轮继续轮询 */ }
    }
    $('neOpenQr').addEventListener('click', startQrLogin);
    $('neQrCorner').addEventListener('click', startQrLogin);
    $('neQrRefresh').addEventListener('click', startQrLogin);
    $('neQrBack').addEventListener('click', () => {
      stopPoll();
      $('neQrView').classList.add('hidden');
      $('neLoginView').classList.remove('hidden');
    });

    paintMode();
  });
})(window);
