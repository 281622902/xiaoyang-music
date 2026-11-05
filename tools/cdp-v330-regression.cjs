// v3.3.0 全量回归：新 UI 四页 + 抽屉 + 登录链路 + 播放
const PAGE = process.argv[2];
const ws = new WebSocket('ws://localhost:9222/devtools/page/' + PAGE);
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const evalJs = (expr) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } })); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  ws.onopen = async () => {
    try {
      const out = {};
      // ① 底部导航 4 键
      const t1 = await evalJs(`(() => { const btns = [...document.querySelectorAll('.bottom-nav button')]; return JSON.stringify(btns.map(b => b.textContent.trim()) + '|' + btns.length); })()`);
      out.nav = t1?.result?.value;

      // ② 首页元素
      const t2 = await evalJs(`(() => JSON.stringify({ tabs: document.querySelectorAll('.home-tabs button').length, banners: document.querySelectorAll('.banner-card').length, quick: document.querySelectorAll('.quick-grid > button').length, recs: document.querySelectorAll('#recommendations .cover-card').length }))()`);
      out.home = t2?.result?.value;

      // ③ 笔记页（导航点击）
      await evalJs(`document.querySelector('[data-nav=notes]').click()`);
      await sleep(700);
      const t3 = await evalJs(`(() => JSON.stringify({ notesVisible: !document.getElementById('page-notes').hidden, cards: document.querySelectorAll('.notes-grid .note-card').length }))()`);
      out.notes = t3?.result?.value;

      // ④ 我的页
      await evalJs(`document.querySelector('[data-nav=me]').click()`);
      await sleep(600);
      const t4 = await evalJs(`(() => JSON.stringify({ meVisible: !document.getElementById('page-me').hidden, hero: !!document.querySelector('.profile-hero'), love: !!document.querySelector('.me-love-card'), playlists: document.querySelectorAll('#mePlaylists .me-row').length, version: document.getElementById('mobileVersion')?.textContent }))()`);
      out.me = t4?.result?.value;

      // ⑤ 抽屉开/关
      const t5 = await evalJs(`(() => { document.querySelector('[data-action=drawer]').click(); return new Promise(r => setTimeout(() => { const open = !document.getElementById('drawerBackdrop').hidden; const items = document.querySelectorAll('.drawer-list button').length; document.querySelector('[data-action=closeDrawer]').click(); setTimeout(() => r(JSON.stringify({ open, items, closed: document.getElementById('drawerBackdrop').hidden })), 400); }, 500)); })()`);
      out.drawer = t5?.result?.value;

      // ⑥ 搜索页 UI
      await evalJs(`document.querySelector('[data-nav=search]').click()`);
      await sleep(500);
      const t6 = await evalJs(`(() => JSON.stringify({ pill: !!document.querySelector('.search-pill'), mic: !!document.querySelector('.mic-button'), hotBanner: !!document.getElementById('hotBanner'), cats: document.querySelectorAll('.search-cats > button').length, hotWords: document.querySelectorAll('#hotSearches button').length }))()`);
      out.search = t6?.result?.value;

      // ⑦ 登录链路（cloudFetch 多栈重试回归：错误密码应得 400 业务错误）
      const t7 = await evalJs(`(async () => { try { const { error } = await window.supabase.auth.signInWithPassword({ phone: '+8613800000000', password: 'wrong-test' }); return JSON.stringify({ ok: !error, status: error?.status || 'none', msg: (error?.message || '').slice(0, 40) }); } catch (e) { return JSON.stringify({ thrown: (e.message || '').slice(0, 80) }); } })()`);
      out.login = t7?.result?.value;

      // ⑧ 播放回归（搜歌→播放→等 PLAYING）
      const t8 = await evalJs(`(async () => {
        document.querySelector('[data-nav=search]').click();
        const input = document.getElementById('mobileSearchInput');
        input.value = '晴天';
        document.getElementById('mobileSearchForm').dispatchEvent(new Event('submit'));
        await new Promise(r => setTimeout(r, 6000));
        const rows = document.querySelectorAll('#mobileResults .track-row');
        if (!rows.length) return JSON.stringify({ rows: 0 });
        rows[0].querySelector('.track-main')?.click() || rows[0].click();
        await new Promise(r => setTimeout(r, 15000));
        const st = window.XYAudio ? window.XYAudio.state : null;
        const native = window.Player ? window.Player.getState() : null;
        return JSON.stringify({ rows: rows.length, playing: st ? st.playing : null, pos: native ? Math.round(native.pos || 0) : null, cur: (native?.current?.name || '').slice(0, 16) });
      })()`);
      out.play = t8?.result?.value;

      console.log(JSON.stringify(out, null, 1));
      process.exit(0);
    } catch (e) { console.error('FATAL', e.message); process.exit(1); }
  };
  setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 120000);
})();
