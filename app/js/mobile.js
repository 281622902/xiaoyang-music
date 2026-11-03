(function (global) {
  'use strict';
  const root = document.documentElement;
  const isAndroid = !!global.XYNative?.isAndroid || global.Capacitor?.getPlatform?.() === 'android' || /Android/i.test(navigator.userAgent);
  if (isAndroid) root.classList.add('native-android');
  const media = global.matchMedia('(max-width: 760px)');
  let frame = 0, revealTimer = 0, keyboardHeight = 0, baseline = global.innerHeight;
  const editable = node => node?.matches?.('input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable="true"]');

  function updateViewport() {
    frame = 0;
    if (!media.matches) {
      root.style.removeProperty('--xy-vh'); root.style.removeProperty('--xy-vv-top');
      document.body?.classList.remove('xy-keyboard-visible'); return;
    }
    const viewport = global.visualViewport;
    const height = Math.round(viewport?.height || global.innerHeight);
    const top = Math.max(0, Math.round(viewport?.offsetTop || 0));
    if (!editable(document.activeElement) && !keyboardHeight) baseline = global.innerHeight;
    baseline = Math.max(baseline, global.innerHeight, height);
    root.style.setProperty('--xy-vh', height + 'px');
    root.style.setProperty('--xy-vv-top', top + 'px');
    const keyboardVisible = keyboardHeight > 0 || (editable(document.activeElement) && baseline - height > 110);
    document.body?.classList.toggle('xy-keyboard-visible', keyboardVisible);
    if (keyboardVisible) revealFocused();
  }
  function scheduleViewport() { if (!frame) frame = global.requestAnimationFrame(updateViewport); }
  function revealFocused() {
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      const focused = document.activeElement;
      if (media.matches && editable(focused)) focused.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }, 100);
  }
  global.visualViewport?.addEventListener('resize', scheduleViewport);
  global.visualViewport?.addEventListener('scroll', scheduleViewport);
  global.addEventListener('resize', scheduleViewport);
  global.addEventListener('orientationchange', () => { baseline = global.innerHeight; scheduleViewport(); });
  document.addEventListener('focusin', () => { scheduleViewport(); revealFocused(); });
  document.addEventListener('focusout', () => setTimeout(scheduleViewport, 0));

  function setup() {
    const header = document.querySelector('.titlebar'), sidebar = document.querySelector('.sidebar');
    if (header && sidebar && !document.getElementById('mobileNavToggle')) {
      const toggle = document.createElement('button'), scrim = document.createElement('button');
      toggle.id = 'mobileNavToggle'; toggle.className = 'xy-mobile-nav-toggle'; toggle.type = 'button'; toggle.textContent = '☰';
      toggle.setAttribute('aria-label', '打开导航菜单'); toggle.setAttribute('aria-expanded', 'false');
      if (!sidebar.id) sidebar.id = 'mobileSidebar'; toggle.setAttribute('aria-controls', sidebar.id);
      scrim.className = 'xy-mobile-nav-scrim'; scrim.type = 'button'; scrim.setAttribute('aria-label', '关闭导航菜单'); scrim.tabIndex = -1;
      header.prepend(toggle); document.body.appendChild(scrim);
      function close() {
        document.body.classList.remove('xy-mobile-nav-open'); toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-label', '打开导航菜单');
      }
      toggle.addEventListener('click', () => {
        const open = document.body.classList.toggle('xy-mobile-nav-open'); toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
      });
      scrim.addEventListener('click', close);
      sidebar.addEventListener('click', event => { if (event.target.closest('[data-view], .playlist-nav li')) close(); });
      document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
      const changed = () => { baseline = global.innerHeight; if (!media.matches) close(); scheduleViewport(); };
      if (media.addEventListener) media.addEventListener('change', changed); else media.addListener(changed);
      global.XYMobile = { closeNavigation: close, updateViewport: scheduleViewport };
    }
    if (isAndroid) {
      for (const id of ['btnScanFolder', 'btnImportFiles', 'btnLocalDup', 'heroImport', 'openDlDir']) {
        const button = document.getElementById(id); if (button) { button.disabled = true; button.setAttribute('aria-disabled', 'true'); }
      }
      const local = document.getElementById('viewLocal');
      if (local && !document.getElementById('androidLocalNote')) {
        const note = document.createElement('p'); note.id = 'androidLocalNote'; note.setAttribute('role', 'note');
        note.textContent = '安卓本地文件导入暂未开放；在线播放和云端收藏可正常使用。电脑本地音乐库不会显示在此设备。';
        local.insertBefore(note, document.getElementById('localList'));
        const empty = document.getElementById('localEmpty'); if (empty) empty.textContent = '本地文件功能将在接入 Android 文件选择与存储插件后开放。';
      }
    }
    const keyboard = global.XYNative?.Keyboard;
    if (isAndroid && keyboard?.addListener) {
      for (const [name, listener] of [
        ['keyboardDidShow', event => { keyboardHeight = Number(event.keyboardHeight) || 1; scheduleViewport(); revealFocused(); }],
        ['keyboardDidHide', () => { keyboardHeight = 0; scheduleViewport(); }]
      ]) Promise.resolve(keyboard.addListener(name, listener)).catch(() => {});
    }
    scheduleViewport();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true }); else setup();
})(window);
