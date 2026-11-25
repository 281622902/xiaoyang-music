// profile.js — 个人主页视图（网易云风格）：大头像 + 昵称 + 统计 + 歌单/收藏/最近播放/资料
// 渲染入口 XYProfile.render()：由 cloud-player.renderAuth 与 showView('profile') 调用。
(function (global) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const cloud = () => global.XYCloud || {};
  const PANES = ['playlists', 'favs', 'recent', 'settings', 'vipadmin'];
  let pfTab = 'playlists';

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('viewProfile')) return; // 移动端无此视图时静默退出

    // Tab 切换
    $('pfTabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.pf-tab');
      if (!btn) return;
      switchPane(btn.dataset.pf);
    });

    // 歌单卡片点击 → 直接播放该歌单
    $('pfPlaylistGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.pl-card');
      if (!card) return;
      const pl = readJSON('uzz.playlists', []).find((p) => String(p.id) === String(card.dataset.pl));
      if (!pl) return;
      const tracks = pl.tracks || [];
      if (!tracks.length) { global.toast && global.toast('歌单为空'); return; }
      if (global.Player) { global.Player.playQueue(tracks); }
      global.toast && global.toast('正在播放「' + pl.name + '」');
    });

    // 最近播放点击 → 播放该曲
    $('pfRecentList').addEventListener('click', (e) => {
      const row = e.target.closest('.pfr-row');
      if (!row) return;
      const idx = Number(row.dataset.idx || '-1');
      const list = historyList();
      const t = list[idx];
      if (t && global.Player) { global.Player.playQueue([t]); }
    });

    // 未登录 → 打开登录弹窗；编辑资料 → 跳设置 tab
    $('pfLoginBtn').addEventListener('click', () => { $('accountOpen').click(); $('cloudPhone')?.focus(); });

    // ── 会员管理（仅管理员）：用户列表 + 开通/取消会员 ──
    $('pfvaRefresh').addEventListener('click', () => renderVipAdmin(true));
    $('pfvaList').addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const phone = btn.dataset.phone, act = btn.dataset.act;
      const done = (msg) => { global.toast && global.toast(msg); renderVipAdmin(true); };
      try {
        if (act === 'remove') {
          btn.disabled = true;
          await global.adminRemoveVip(phone);
          done('已取消 ' + phone + ' 的会员');
        } else {
          const days = Number(btn.dataset.days || 0);
          const tier = btn.dataset.tier || 'vip';
          btn.disabled = true;
          await global.adminSetVip(phone, tier, days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null);
          done(days > 0 ? '已开通 ' + phone + ' 会员 ' + days + ' 天' : '已开通 ' + phone + ' 永久会员');
        }
      } catch (error) {
        global.toast && global.toast(error.message || '操作失败');
        btn.disabled = false;
      }
    });
    async function renderVipAdmin(force) {
      const list = $('pfvaList'), count = $('pfvaCount');
      const admin = !!(cloud().user && global.isAdmin && global.isAdmin());
      $('pfTabVipAdmin').classList.toggle('hidden', !admin);
      if (!admin) { list.innerHTML = '<div class="empty-state"><div class="empty-title">仅管理员可访问</div></div>'; return; }
      if (list.dataset.loaded && !force) return;
      list.dataset.loaded = '1';
      count.textContent = '用户列表加载中…';
      try {
        const users = await global.adminListUsers();
        count.textContent = '共 ' + users.length + ' 位注册用户 · 点击按钮开通/取消会员';
        if (!users.length) { list.innerHTML = '<div class="empty-state"><div class="empty-title">还没有注册用户</div></div>'; return; }
        const now = Date.now();
        list.innerHTML = users.map((u) => {
          const exp = u.vip_expires_at ? Date.parse(u.vip_expires_at) : null;
          const active = !!u.vip_tier && (exp === null || exp > now);
          const vipText = active ? (u.vip_tier === 'svip' ? 'SVIP' : 'VIP') + (exp === null ? ' · 永久' : ' · 至 ' + new Date(exp).toLocaleDateString()) : '非会员';
          return `<div class="pfva-row${active ? ' is-vip' : ''}">
            <div class="pfva-info">
              <b class="pfva-phone">${esc(u.phone)}${u.user_id === (cloud().user && cloud().user.id) ? '（我）' : ''}</b>
              <span class="pfva-meta">${esc(u.nickname || u.username || '未设置昵称')} · 注册于 ${new Date(u.created_at).toLocaleDateString()}</span>
            </div>
            <span class="pfva-vip">${vipText}</span>
            <span class="pfva-acts">
              ${active ? '' : `<button class="xy-secondary" data-act="grant" data-phone="${esc(u.phone)}" data-days="30" data-tier="vip">开通1月</button>
              <button class="xy-secondary" data-act="grant" data-phone="${esc(u.phone)}" data-days="90" data-tier="vip">开通3月</button>
              <button class="xy-secondary" data-act="grant" data-phone="${esc(u.phone)}" data-days="365" data-tier="vip">开通1年</button>
              <button class="xy-secondary" data-act="grant" data-phone="${esc(u.phone)}" data-days="0" data-tier="svip">永久SVIP</button>`}
              ${active ? `<button class="xy-secondary pfva-remove" data-act="remove" data-phone="${esc(u.phone)}">取消会员</button>` : ''}
            </span>
          </div>`;
        }).join('');
      } catch (error) {
        count.textContent = '';
        list.innerHTML = '<div class="empty-state"><div class="empty-title">加载失败</div><div class="empty-sub">' + esc(error.message || error) + '</div></div>';
        list.dataset.loaded = '';
      }
    }
    global.__renderVipAdmin = renderVipAdmin;

    /* ── 绑定手机号 / 换绑（依赖短信服务，两步验证） ── */
    const phoneStatus = (text) => { const el = $('dpPhoneStatus'); if (el) el.textContent = text || ''; };
    let phoneCdTimer = null;
    function phoneCooldown(sec) {
      const btn = $('dpPhoneSend');
      let left = sec; btn.disabled = true;
      const paint = () => { btn.textContent = left > 0 ? left + 's 后重发' : '获取验证码'; };
      paint();
      clearInterval(phoneCdTimer);
      phoneCdTimer = setInterval(() => { left -= 1; paint(); if (left <= 0) { clearInterval(phoneCdTimer); btn.disabled = false; } }, 1000);
    }
    const newPhoneVal = () => (($('dpNewPhone').value || '').replace(/\D/g, ''));
    $('dpPhoneSend').addEventListener('click', async () => {
      const u = cloud().user;
      if (!u) { phoneStatus('请先登录云端账户'); return; }
      if (!/^1\d{10}$/.test(newPhoneVal())) { phoneStatus('请输入正确的新手机号'); return; }
      const btn = $('dpPhoneSend');
      btn.disabled = true; btn.textContent = '发送中…';
      try {
        await global.requestPhoneChange(newPhoneVal());
        phoneStatus('验证码已发送到新手机号，请查收短信');
        phoneCooldown(60);
        $('dpNewPhoneCode').focus();
      } catch (error) {
        phoneStatus(error.message || '发送失败');
        btn.disabled = false; btn.textContent = '获取验证码';
      }
    });
    $('dpPhoneConfirm').addEventListener('click', async () => {
      const u = cloud().user;
      if (!u) { phoneStatus('请先登录云端账户'); return; }
      const code = ($('dpNewPhoneCode').value || '').trim();
      if (!/^\d{4,8}$/.test(code)) { phoneStatus('请输入短信验证码'); return; }
      const btn = $('dpPhoneConfirm');
      btn.disabled = true; phoneStatus('正在换绑…');
      try {
        await global.confirmPhoneChange(newPhoneVal(), code);
        phoneStatus('换绑成功，已绑定新手机号');
        $('dpNewPhoneCode').value = '';
        clearInterval(phoneCdTimer); const sb = $('dpPhoneSend'); sb.disabled = false; sb.textContent = '获取验证码';
        render();
        global.toast && global.toast('手机号换绑成功');
      } catch (error) {
        phoneStatus(error.message || '换绑失败');
      } finally { btn.disabled = false; }
    });
    $('pfEditBtn').addEventListener('click', () => switchPane('settings'));
  });

  function readJSON(key, def) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') || def; } catch (e) { return def; }
  }
  function historyList() {
    try { return (global.Player && global.Player.getHistory ? global.Player.getHistory() : []) || []; }
    catch (e) { return []; }
  }
  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function switchPane(name) {
    if (!PANES.includes(name)) name = 'playlists';
    pfTab = name;
    document.querySelectorAll('#pfTabs .pf-tab').forEach((b) => b.classList.toggle('active', b.dataset.pf === name));
    PANES.forEach((p) => {
      const el = $('pfPane' + p.charAt(0).toUpperCase() + p.slice(1));
      if (el) el.classList.toggle('hidden', p !== name);
    });
    renderPane(name);
  }

  function renderPane(name) {
    if (name === 'playlists') renderPlaylists();
    else if (name === 'recent') renderRecent();
    else if (name === 'vipadmin' && global.__renderVipAdmin) global.__renderVipAdmin(true);
  }

  function renderPlaylists() {
    const grid = $('pfPlaylistGrid');
    if (!grid) return;
    const local = readJSON('uzz.playlists', []).slice().reverse(); // 新建的排前面
    if (!local.length) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-ic">♪</div><div class="empty-title">还没有创建歌单</div><div class="empty-sub">播放页队列里点「存为歌单」，就能在这里看到</div></div>';
      return;
    }
    grid.innerHTML = local.map((p) => {
      const cover = p.cover ? esc(global.UzzApi?.picProxy ? global.UzzApi.picProxy(p.cover) : p.cover) : 'data:,';
      const first = (p.tracks && p.tracks[0] && p.tracks[0].cover) ? esc(p.tracks[0].cover) : '';
      const img = cover !== 'data:,' ? cover : first;
      return `<div class="pl-card" data-pl="${esc(p.id)}">
        <div style="position:relative">
          <img class="plc-img" src="${img || 'data:,'}" loading="lazy" onerror="this.style.visibility='hidden'" alt="" />
          <span class="plc-plays">${(p.tracks || []).length} 首</span>
        </div>
        <div class="plc-name">${esc(p.name)}</div>
      </div>`;
    }).join('');
  }

  function renderRecent() {
    const box = $('pfRecentList');
    if (!box) return;
    const list = historyList();
    if (!list.length) {
      box.innerHTML = '<div class="empty-state"><div class="empty-ic">◷</div><div class="empty-title">还没有播放记录</div><div class="empty-sub">去发现页找一首喜欢的歌吧</div></div>';
      return;
    }
    box.innerHTML = list.map((t, i) => `<div class="pfr-row" data-idx="${i}">
      <span class="pfr-ic">▶</span>
      <span class="pfr-name">${esc(t.name || '未知歌曲')}</span>
      <span class="pfr-artist">${esc(t.artist || '')}</span>
    </div>`).join('');
  }

  function render() {
    const user = cloud().user;
    const logged = !!user;
    const p = logged && cloud().profile ? cloud().profile(user) : null;
    const name = logged && cloud().displayName ? cloud().displayName(user) : '';
    $('pfName').textContent = logged ? (name || '云端账户') : '未登录';
    const av = p && p.avatar;
    const pf = $('pfAvatar');
    if (pf) pf.src = av || 'icon.svg';
    $('pfSub').textContent = logged
      ? (p && p.username ? '用户名 ' + p.username : '手机号 ' + (cloud().displayUser(user) || ''))
      : '登录云端账户，收藏与歌单随账号随身携带';
    $('pfCountPl').textContent = readJSON('uzz.playlists', []).length;
    $('pfCountFav').textContent = readJSON('uzz.fav', []).length;
    $('pfCountRecent').textContent = historyList().length;
    $('pfLoginBtn').classList.toggle('hidden', logged);
    $('cloudLogout').classList.toggle('hidden', !logged);
    $('pfEditBtn').classList.toggle('hidden', !logged);
    // 绑定手机号展示（脱敏）
    const pv = $('dpPhoneValue');
    if (pv) pv.textContent = logged ? (cloud().displayUser ? cloud().displayUser(user) : '已绑定') : '未登录';
    const ps = $('dpPhoneStatus');
    if (ps && !logged) ps.textContent = '';
    // 会员管理 tab：仅管理员可见
    const admin = logged && global.isAdmin && global.isAdmin();
    const vaTab = $('pfTabVipAdmin');
    if (vaTab) {
      vaTab.classList.toggle('hidden', !admin);
      if (!admin) { const pane = $('pfPaneVipadmin'); if (pane) pane.classList.add('hidden'); }
    }
    renderPane(pfTab);
  }

  global.XYProfile = { render, switchPane };
})(window);
