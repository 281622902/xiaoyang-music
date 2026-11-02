(function (global) {
  'use strict';
  function bindFavoriteButton({ button, status, getSong, onError }) {
    let generation = 0, busy = false, disposed = false;
    const say = text => { if (status) status.textContent = text; };
    function paint(on) {
      button.classList.toggle('is-favorited', on);
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute('aria-label', on ? '取消云端收藏' : '收藏到云端');
      button.title = on ? '取消云端收藏' : '收藏到云端';
    }
    async function refresh() {
      const ticket = ++generation;
      const song = getSong();
      button.disabled = true;
      if (!song?.url) { paint(false); button.title = song?.unavailableMessage || '请先播放在线歌曲'; say(button.title); return; }
      try {
        const on = await global.checkIsFavorited(song.url);
        if (!disposed && ticket === generation) { paint(on); say(on ? '已收藏' : '未收藏'); }
      } catch (error) {
        if (!disposed && ticket === generation) { paint(false); say(error.message); }
      } finally {
        if (!disposed && ticket === generation) button.disabled = busy;
      }
    }
    async function click() {
      if (busy || disposed) return;
      const song = getSong();
      if (!song?.url) { say('请先载入当前歌曲'); return; }
      const ticket = ++generation;
      busy = true; button.disabled = true; button.setAttribute('aria-busy', 'true');
      try {
        const wasFavorited = await global.checkIsFavorited(song.url);
        if (ticket !== generation || disposed) return;
        if (wasFavorited) await global.removeFavorite(song.url);
        else await global.addFavorite(song.name, song.url);

        // 按服务端结果变色；RLS 没允许 DELETE 时，不把零删除误报为成功。
        const on = await global.checkIsFavorited(song.url);
        if (ticket !== generation || disposed) return;
        if (wasFavorited === on) throw new Error(wasFavorited ? '取消收藏未生效，请检查 DELETE 和 SELECT 的 RLS 策略' : '未查询到新增收藏，请刷新重试');
        paint(on); say(on ? '收藏成功' : '已取消收藏');
        button.dispatchEvent(new CustomEvent('favoritechange', { detail: { songUrl: song.url, favorited: on } }));
      } catch (error) {
        if (ticket === generation && !disposed) { say(error.message); if (onError) onError(error); }
      } finally {
        busy = false; button.setAttribute('aria-busy', 'false');
        if (!disposed && ticket === generation) button.disabled = false;
        else if (!disposed) await refresh();
      }
    }
    button.addEventListener('click', click);
    const { data: { subscription } } = global.supabase.auth.onAuthStateChange(() => {
      generation++;
      // Auth 回调内不 await 数据查询，避免锁重入。
      setTimeout(() => { if (!disposed) refresh(); }, 0);
    });
    refresh();
    return {
      refresh, // 切歌后调用，异步旧结果不会覆盖新歌的红心状态。
      destroy() { disposed = true; generation++; button.removeEventListener('click', click); subscription.unsubscribe(); }
    };
  }
  global.bindFavoriteButton = bindFavoriteButton;
})(window);
