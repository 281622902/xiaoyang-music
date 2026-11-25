/* ══════════════════════════════════════════════════════════════════
 * account-settings.js — 设置页「账户与密保」分区逻辑（v3.15.4）
 * 资料编辑（头像/昵称/用户名/密码/换绑）由 cloud-player.js 绑定（ID 未变）
 * 本文件负责：密保状态检测 + 更改密保前校验原答案 + 设置/更改（3 题起步，支持自定义）
 * ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const SEC_PRESETS = ['你小学班主任的名字', '你母亲的姓名', '你出生的城市', '你第一只宠物的名字', '你最要好的朋友的名字', '你父亲的姓名', '你的第一所学校'];
  // 展示状态：idle 无表单 | verify 更改前校验 | edit 编辑表单
  let mode = 'idle';
  let currentQuestions = [];

  function status(text) { const el = $('secMgrStatus'); if (el) el.textContent = text || ''; }
  function state(text) { const el = $('secMgrState'); if (el) el.textContent = text || ''; }
  function escHtml(v) { return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  /* ── 显示模式切换 ── */
  function paintMode() {
    const verify = $('secMgrVerify');
    const form = $('secMgrForm');
    const toggle = $('secMgrToggle');
    if (verify) verify.classList.toggle('hidden', mode !== 'verify');
    if (form) form.classList.toggle('hidden', mode !== 'edit');
    if (toggle) {
      toggle.textContent = mode === 'edit' ? '收起编辑'
        : (toggle.dataset.mode === 'change' ? '更改密保' : '设置密保');
    }
  }

  /* ── 三题下拉：预设错开 + 自定义选项 ── */
  function paintSlots() {
    [1, 2, 3].forEach((i) => {
      const sel = $('secMgrQ' + i);
      if (!sel) return;
      const offset = (i - 1) % SEC_PRESETS.length;
      sel.innerHTML = SEC_PRESETS.slice(offset).concat(SEC_PRESETS.slice(0, offset))
        .map((q) => '<option>' + q + '</option>').join('') + '<option value="__custom__">自定义问题…</option>';
      sel.onchange = () => {
        const custom = $('secMgrCustom' + i);
        if (custom) custom.classList.toggle('hidden', sel.value !== '__custom__');
        if (sel.value === '__custom__') custom && custom.focus();
      };
    });
  }

  // 用已设置的密保问题预填编辑表单（预设内选中，自定义填输入框）；答案留空
  function prefillSlots() {
    [1, 2, 3].forEach((i) => {
      const sel = $('secMgrQ' + i);
      const custom = $('secMgrCustom' + i);
      const ans = $('secMgrA' + i);
      const q = currentQuestions[i - 1];
      if (!sel) return;
      if (ans) ans.value = '';
      if (!q) { sel.selectedIndex = 0; if (custom) { custom.value = ''; custom.classList.add('hidden'); } return; }
      const presetIdx = SEC_PRESETS.indexOf(q.question);
      if (presetIdx >= 0) {
        sel.value = SEC_PRESETS[presetIdx];
        if (custom) { custom.value = ''; custom.classList.add('hidden'); }
      } else {
        sel.value = '__custom__';
        if (custom) { custom.value = q.question; custom.classList.remove('hidden'); }
      }
    });
  }

  /* ── 更改密保：验证步骤（展示当前 3 题） ── */
  function showVerify() {
    const list = $('secMgrVList');
    if (list) {
      list.innerHTML = currentQuestions.map((item, idx) => `
        <p class="ne-sec-q">问题 ${idx + 1}：${escHtml(item.question)}</p>
        <div class="ne-field">
          <input type="text" class="sec-v-ans" data-slot="${item.slot}" maxlength="50" placeholder="请输入第 ${idx + 1} 题答案" aria-label="第 ${idx + 1} 题答案"/>
        </div>`).join('');
    }
    mode = 'verify';
    paintMode();
    status('');
    const first = list && list.querySelector('.sec-v-ans');
    if (first) first.focus();
  }

  /* ── 密保状态检测（登录态） ── */
  async function refresh() {
    const toggle = $('secMgrToggle');
    const user = global.XYCloud && global.XYCloud.user;
    if (!toggle) return;
    mode = 'idle';
    paintMode();
    if (!user) {
      state('未登录');
      toggle.classList.add('hidden');
      return;
    }
    try {
      const list = await global.getSecurityQuestion(user.phone);
      currentQuestions = Array.isArray(list) ? list : [];
      if (currentQuestions.length) {
        state('已设置 ' + currentQuestions.length + ' 题');
        toggle.textContent = '更改密保';
        toggle.dataset.mode = 'change';
        toggle.classList.remove('hidden');
      } else {
        state('未设置，建议立即设置以便找回密码');
        toggle.textContent = '设置密保';
        toggle.dataset.mode = 'set';
        toggle.classList.remove('hidden');
        currentQuestions = [];
      }
    } catch (e) {
      state('状态读取失败');
      toggle.classList.add('hidden');
    }
  }

  /* ── 验证提交：全部答对才进入编辑 ── */
  async function submitVerify(event) {
    event.preventDefault();
    const listEl = $('secMgrVList');
    const answers = listEl ? Array.from(listEl.querySelectorAll('.sec-v-ans')).map((input) => ({
      slot: Number(input.dataset.slot),
      answer: (input.value || '').trim(),
    })) : [];
    if (!answers.length || answers.some((a) => !a.answer)) { status('请填写全部密保答案'); return; }
    status('正在校验密保答案…');
    try {
      await global.verifySecurityAnswers(answers);
      status('');
      mode = 'edit';
      prefillSlots();
      paintMode();
      if (global.toast) global.toast('密保验证通过，可更改密保问题');
    } catch (error) {
      status(error.message || '验证失败，请稍后再试');
    }
  }

  /* ── 保存密保 ── */
  async function save(event) {
    event.preventDefault();
    const user = global.XYCloud && global.XYCloud.user;
    if (!user) { status('请先登录'); return; }
    const slots = [1, 2, 3].map((i) => {
      const selVal = $('secMgrQ' + i).value;
      return {
        question: selVal === '__custom__' ? ($('secMgrCustom' + i).value || '').trim() : selVal,
        answer: ($('secMgrA' + i).value || '').trim(),
      };
    });
    for (let i = 0; i < slots.length; i++) {
      if (!slots[i].question) { status('请填写第 ' + (i + 1) + ' 题的问题'); return; }
      if (!slots[i].answer) { status('请填写第 ' + (i + 1) + ' 题的答案'); return; }
    }
    const seen = new Set();
    for (let i = 0; i < slots.length; i++) {
      const key = slots[i].question.toLowerCase();
      if (seen.has(key)) { status('密保问题不能重复，请修改第 ' + (i + 1) + ' 题'); return; }
      seen.add(key);
    }
    status('正在保存…');
    try {
      await global.setSecurityQuestion(slots);
      status('');
      mode = 'idle';
      paintMode();
      if (global.toast) global.toast('密保已保存（3 题），忘记密码时凭答案找回');
      refresh();
    } catch (error) {
      status(error.message || '密保保存失败，请稍后再试');
    }
  }

  function init() {
    paintSlots();
    const toggle = $('secMgrToggle');
    if (toggle) toggle.addEventListener('click', () => {
      if (mode !== 'idle') { mode = 'idle'; paintMode(); return; }
      if (toggle.dataset.mode === 'change' && currentQuestions.length) showVerify();
      else { mode = 'edit'; prefillSlots(); paintMode(); status(''); }
    });
    const verifyForm = $('secMgrVerify');
    if (verifyForm) {
      verifyForm.addEventListener('submit', submitVerify);
      const cancel = $('secMgrVCancel');
      if (cancel) cancel.addEventListener('click', () => { mode = 'idle'; paintMode(); status(''); });
    }
    const form = $('secMgrForm');
    if (form) form.addEventListener('submit', save);
    // 打开「账户与密保」分区时刷新
    document.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('#setTabs button[data-tab="account"]');
      if (btn) setTimeout(refresh, 50);
    });
    refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.XYAccountSettings = { refresh };
})(window);
