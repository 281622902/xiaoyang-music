(function (global) {
  'use strict';
  function bindFavoriteButton({ button, status, getSong, onError }) {
    let generation = 0, busy = false, disposed = false;
    let state = false; // 乐观状态缓存：红心当前视觉态，点击时免网络预查询
    const say = text => { if (status) status.textContent = /Auth session missing/i.test(String(text)) ? '登录后收藏到云端' : text; };
    function paint(on) {
      state = on;
      button.classList.toggle('is-favorited', on);
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute('aria-label', on ? '取消云端收藏' : '收藏到云端');
      button.title = on ? '取消云端收藏' : '收藏到云端';
    }
    function emit(detail) {
      button.dispatchEvent(new CustomEvent('favoritechange', { detail }));
    }
    async function refresh() {
      const ticket = ++generation;
      const song = getSong();
      button.disabled = true;
      if (!song?.url) { paint(false); button.title = song?.unavailableMessage || '请先播放在线歌曲'; say(button.title); return; }
      say('正在查询收藏…');
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
      // ── 乐观更新：同步瞬间变色 + 通知列表先改，不等任何网络请求 ──
      const target = !state;
      paint(target);
      busy = true; button.setAttribute('aria-busy', 'true');
      say(target ? '正在收藏…' : '正在取消…');
      emit({ songUrl: song.url, favorited: target, pending: true });
      try {
        // 只发一次写请求（用缓存状态判断方向，省掉原来的预查询往返）
        if (target) await global.addFavorite(song.name, song.url);
        else await global.removeFavorite(song.url);
        if (ticket !== generation || disposed) return;
        // 服务端校验一次：RLS 没允许 DELETE/INSERT 生效时不把零改动误报为成功。
        const on = await global.checkIsFavorited(song.url);
        if (ticket !== generation || disposed) return;
        if (on !== target) throw new Error(target ? '未查询到新增收藏，请检查 INSERT/SELECT 的 RLS 策略' : '取消收藏未生效，请检查 DELETE 和 SELECT 的 RLS 策略');
        say(target ? '收藏成功' : '已取消收藏');
        emit({ songUrl: song.url, favorited: target });
      } catch (error) {
        if (ticket === generation && !disposed) {
          // ── 失败回滚：红心弹回原色，列表撤掉乐观项，弹窗报错 ──
          paint(!target);
          emit({ songUrl: song.url, favorited: !target, rollback: true });
          say(error.message);
          if (onError) onError(error);
        }
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
