// profile.js — 个人主页视图（网易云风格）：大头像 + 昵称 + 统计 + 歌单/收藏/最近播放/资料
// 渲染入口 XYProfile.render()：由 cloud-player.renderAuth 与 showView('profile') 调用。
(function (global) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const cloud = () => global.XYCloud || {};
  const PANES = ['playlists', 'favs', 'recent', 'settings'];
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
    renderPane(pfTab);
  }

  global.XYProfile = { render, switchPane };
})(window);
