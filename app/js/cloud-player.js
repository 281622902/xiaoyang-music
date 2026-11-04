// 将通用红心组件绑定到 Player 的真实播放状态；红心双写联动：云端与本机 uzz.fav 同步增删。
(function (global) {
  'use strict';
  document.addEventListener('DOMContentLoaded', () => {
    const cloud = global.XYCloud;
    const $ = id => document.getElementById(id);
    const button = $('favoriteBtn'), status = $('favoriteStatus');
    let mode = 'login', authGeneration = 0, listGeneration = 0, heart = null;
    const say = text => { $('cloudAccountStatus').textContent = text; };
    function notify(text) {
      $('toast').textContent = text; $('toast').classList.remove('hidden');
      clearTimeout(cloud.toastTimer); cloud.toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 3500);
    }
    function renderAuth() {
      $('cloudGuest').classList.toggle('hidden', !!cloud.user);
      $('cloudMember').classList.toggle('hidden', !cloud.user);
      $('cloudUserName').textContent = cloud.user ? cloud.displayUser(cloud.user) : '';
      if (cloud.user) $('accountLabel').textContent = cloud.displayUser(cloud.user);
      else $('accountLabel').textContent = '账户与云端';
    }
    function syncCurrent() {
      const track = global.Player.getState().current;
      // 使用解析后的原始播放地址，不把本机代理端口或本地文件路径保存到云端。
      let url = '';
      if (track && track.vendor !== 'local' && track.url) {
        try { const parsed = new URL(track.url); if (['http:', 'https:'].includes(parsed.protocol)) url = parsed.href; } catch {}
      }
      cloud.currentSong = track ? { name: track.name || '未知歌曲', url, favoriteUrl: cloud.trackReference(track),
        unavailableMessage: track.vendor === 'local' ? '本地音乐请使用本机收藏，音频不会上传' : '正在等待有效的在线播放地址' } : null;
      if (heart) heart.refresh();
    }
    async function refreshList() {
      const ticket = ++listGeneration, authTicket = authGeneration;
      if (!cloud.user) { $('cloudFavorites').replaceChildren(); return; }
      $('cloudRefresh').disabled = true;
      try {
        const rows = await global.getFavorites();
        if (ticket !== listGeneration || authTicket !== authGeneration) return;
        const fragment = document.createDocumentFragment();
        for (const row of rows) {
          const li = document.createElement('li'), name = document.createElement('span');
          li.dataset.url = row.song_url; // 乐观更新按 URL 增删列表项
          name.textContent = row.song_name; li.appendChild(name);
          const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '取消收藏';
          remove.addEventListener('click', async () => {
            if (authTicket !== authGeneration) return;
            remove.disabled = true;
            try {
              const count = await global.removeFavorite(row.song_url);
              if (authTicket !== authGeneration) return;
              if (!count) throw new Error('取消收藏未生效，请刷新并检查 DELETE 权限');
              await refreshList(); if (heart) await heart.refresh();
            } catch (error) { if (authTicket === authGeneration) say(error.message); }
            finally { remove.disabled = false; }
          });
          li.appendChild(remove); fragment.appendChild(li);
        }
        $('cloudFavorites').replaceChildren(fragment);
        say(rows.length ? '已读取 ' + rows.length + ' 首云端收藏' : '暂无云端收藏，播放在线歌曲后点带云标记的红心');
      } catch (error) { if (ticket === listGeneration && authTicket === authGeneration) say(error.message); }
      finally { if (ticket === listGeneration) $('cloudRefresh').disabled = false; }
    }
    function setMode(value) {
      mode = value; $('cloudLoginTab').classList.toggle('active', value === 'login');
      $('cloudRegisterTab').classList.toggle('active', value === 'register');
      $('cloudSubmit').textContent = value === 'login' ? '登录云端账户' : '注册并登录';
      $('cloudPassword').autocomplete = value === 'login' ? 'current-password' : 'new-password'; say('');
    }
    $('cloudLoginTab').onclick = () => setMode('login'); $('cloudRegisterTab').onclick = () => setMode('register');
    $('cloudForm').addEventListener('submit', async event => {
      event.preventDefault(); $('cloudSubmit').disabled = true; say('正在处理…');
      try {
        const data = await global[mode === 'login' ? 'loginUser' : 'registerUser']($('cloudPhone').value, $('cloudPassword').value);
        $('cloudPassword').value = '';
        say(data.session ? '登录成功' : '注册完成，尚未建立会话，请核对 Supabase 手机号确认设置');
      } catch (error) { say(error.message); }
      finally { $('cloudSubmit').disabled = !cloud.available; }
    });
    $('cloudLogout').addEventListener('click', async () => {
      $('cloudLogout').disabled = true;
      try { await global.logoutUser(); $('cloudPassword').value = ''; say('已退出云端账户'); }
      catch (error) { say(error.message); }
      finally { $('cloudLogout').disabled = false; }
    });
    $('cloudRefresh').addEventListener('click', refreshList);
    for(const [direction,label] of [['push','上传并合并歌单'],['pull','从云端合并歌单']]){
      const sync=document.createElement('button');sync.type='button';sync.className='xy-secondary';sync.textContent=label;
      let confirmedUser=null;sync.onclick=async()=>{sync.disabled=true;try{
        if(!cloud.user)throw Error('请先登录云端账户');
        if(confirmedUser!==cloud.user.id){const uid=cloud.user.id,p=await global.XYSync.preview();if(uid!==cloud.user?.id)throw Error('账户已切换，请重试');confirmedUser=uid;sync.textContent='确认合并';say('本机 '+p.localPlaylists+' 张歌单，云端 '+p.cloudPlaylists+' 张。合并保留双方歌曲，不同步删除；本地音频不会上传。');return;}
        const result=await global.XYSync[direction]();say('已合并 '+result.playlists+' 张歌单');confirmedUser=null;sync.textContent=label;
      }catch(e){say(e.message);confirmedUser=null;sync.textContent=label;}finally{sync.disabled=false;}};
      $('cloudMember').querySelector('.account-buttons').appendChild(sync);
    }
    renderAuth();
    if (!cloud.available) {
      button.disabled = true; status.textContent = cloud.error; say(cloud.error); $('cloudSubmit').disabled = true;
      return; // CDN 失败不影响播放、本地账户和本地收藏。
    }
    syncCurrent();
    button.addEventListener('click', event => {
      if (!cloud.user) { event.stopImmediatePropagation(); $('accountOpen').click(); $('cloudPhone').focus(); say('请先登录云端账户'); }
    });
    // ── 双写联动钩子：云端红心点击时，本机 uzz.fav 同步增删（确定性 set，非切换） ──
    const currentTrack = () => {
      const t = global.Player.getState().current;
      return (t && typeof t.id === 'string' && t.vendor) ? t : null;
    };
    heart = global.bindFavoriteButton({
      button, status,
      getSong: () => cloud.currentSong ? {...cloud.currentSong,url:cloud.currentSong.favoriteUrl || cloud.currentSong.url} : null,
      onError: error => notify(error.message),
      localState: () => { const t = currentTrack(); return !!(t && global.Player.isFavorite(t)); },
      localSet: (_song, on) => { const t = currentTrack(); if (t) global.Player.setFavorite(t, on); },
    });
    cloud.heart = heart;
    document.addEventListener('xy:trackChanged', syncCurrent);
    // ── 反向联动：本机红心（fpFav）点在当前歌上 → 云端同步增删 ──
    document.addEventListener('uzz:favCurrent', async event => {
      if (!cloud.user || !heart) return;
      const d = event.detail || {};
      const song = cloud.currentSong;
      const url = song && (song.favoriteUrl || song.url);
      if (!url) return;
      try {
        const cur = await global.checkIsFavorited(url);
        if (cur === d.added) { heart.refresh(); return; } // 云端已一致，免写
        if (d.added) await global.addFavorite(song.name, url);
        else await global.removeFavorite(url);
        heart.refresh(); refreshList();
      } catch (error) { notify('云端同步失败：' + error.message); }
    });
    // ── 账号切换数据隔离：换号即用云端收藏重置本机列表（全量拉取，防串号） ──
    async function syncLocalFromCloud() {
      const uid = cloud.user?.id;
      if (!uid) return;
      try {
        const rows = await global.getFavorites();
        if (uid !== cloud.user?.id) return; // 等待期间账号又切了，放弃这次结果
        const seen = new Set(), tracks = [];
        for (const row of rows) {
          const t = cloud.favoriteToTrack(row);
          if (t && t.id && t.vendor) {
            const key = t.vendor + '|' + t.id;
            if (!seen.has(key)) { seen.add(key); tracks.push({ ...t, at: Date.now() }); }
          }
        }
        global.Player.replaceFavorites(tracks);
        say('已用云端收藏重置本机喜欢（' + tracks.length + ' 首）');
      } catch (_) { /* 拉取失败保持本机现状，不清空 */ }
    }
    // 云端收藏列表乐观更新：不等网络，按 favoritechange 事件直接增删列表项；
    // refreshList() 随后后台对账，以服务端全量列表为准。
    function optimisticFavorites(d) {
      const ul = $('cloudFavorites');
      if (!ul || !d?.songUrl) return;
      const items = [...ul.children];
      if (d.favorited) {
        if (items.some(li => li.dataset.url === d.songUrl)) return;
        const li = document.createElement('li'), name = document.createElement('span');
        li.dataset.url = d.songUrl;
        name.textContent = cloud.currentSong?.name || '未知歌曲';
        li.appendChild(name); ul.insertBefore(li, ul.firstChild);
      } else {
        items.filter(li => li.dataset.url === d.songUrl).forEach(li => li.remove());
      }
    }
    button.addEventListener('favoritechange', event => {
      const d = event.detail || {};
      optimisticFavorites(d);
      if (d.localOnly) return; // 纯本机收藏，云端列表不参与
      if (d.pending) notify(d.favorited ? '正在收藏到云端…' : '正在取消云端收藏…');
      else if (!d.rollback) notify(d.favorited ? '已收藏到云端 ♥' : '已取消云端收藏');
      refreshList();
    });
    const { data: { subscription } } = global.supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user ?? null;
      const changed = cloud.user?.id !== next?.id;
      cloud.user = next;
      if (changed) { authGeneration++; listGeneration++; $('cloudFavorites').replaceChildren(); $('cloudRefresh').disabled = false; }
      renderAuth();
      // Auth 回调只改界面；数据库查询离开回调后再执行。
      if (changed || _event === 'INITIAL_SESSION') setTimeout(() => { refreshList(); if (changed && next) syncLocalFromCloud(); }, 0);
    });
    global.addEventListener('pagehide', () => { heart.destroy(); subscription.unsubscribe(); }, { once: true });
  });
})(window);
