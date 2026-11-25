/* ══════════════════════════════════════════════════════════════════
 * account-settings.js — 设置页「账户与密保」分区逻辑（v3.15.3）
 * 资料编辑（头像/昵称/用户名/密码/换绑）由 cloud-player.js 绑定（ID 未变）
 * 本文件只负责：密保状态检测 + 设置/更改密保（3 题起步，支持自定义）
 * ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const SEC_PRESETS = ['你小学班主任的名字', '你母亲的姓名', '你出生的城市', '你第一只宠物的名字', '你最要好的朋友的名字', '你父亲的姓名', '你的第一所学校'];

  let formOpen = false;

  function status(text) { const el = $('secMgrStatus'); if (el) el.textContent = text || ''; }
  function state(text) { const el = $('secMgrState'); if (el) el.textContent = text || ''; }

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

  function setFormOpen(open) {
    formOpen = open;
    const form = $('secMgrForm');
    const btn = $('secMgrToggle');
    if (form) form.classList.toggle('hidden', !open);
    if (btn) btn.textContent = open ? '收起编辑' : (btn.dataset.mode === 'change' ? '更改密保' : '设置密保');
    if (open) status('');
  }

  /* ── 密保状态检测（登录态） ── */
  async function refresh() {
    const toggle = $('secMgrToggle');
    const user = global.XYCloud && global.XYCloud.user;
    if (!toggle) return;
    if (!user) {
      state('未登录');
      toggle.classList.add('hidden');
      setFormOpen(false);
      return;
    }
    try {
      const list = await global.getSecurityQuestion(user.phone);
      if (Array.isArray(list) && list.length) {
        state('已设置 ' + list.length + ' 题');
        toggle.textContent = '更改密保';
        toggle.dataset.mode = 'change';
        toggle.classList.remove('hidden');
      } else {
        state('未设置，建议立即设置以便找回密码');
        toggle.textContent = '设置密保';
        toggle.dataset.mode = 'set';
        toggle.classList.remove('hidden');
      }
      if (!formOpen) setFormOpen(false);
    } catch (e) {
      state('状态读取失败');
      toggle.classList.add('hidden');
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
      setFormOpen(false);
      if (global.toast) global.toast('密保已保存（3 题），忘记密码时凭答案找回');
      refresh();
    } catch (error) {
      status(error.message || '密保保存失败，请稍后再试');
    }
  }

  function init() {
    paintSlots();
    const toggle = $('secMgrToggle');
    if (toggle) toggle.addEventListener('click', () => setFormOpen(!formOpen));
    const form = $('secMgrForm');
    if (form) form.addEventListener('submit', save);
    // 登录态变化时刷新
    global.addEventListener('uzz:auth', refresh);
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
