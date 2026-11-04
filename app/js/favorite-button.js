(function (global) {
  'use strict';
  // options:
  //   localState(song) -> boolean  歌曲是否已在本机收藏（uzz.fav）
  //   localSet(song, on)           本机收藏确定性增删（双写联动，云失败也保留）
  function bindFavoriteButton({ button, status, getSong, onError, localState, localSet }) {
    let generation = 0, busy = false, disposed = false;
    let state = false; // 乐观状态缓存：红心当前视觉态，点击时免网络预查询
    const isAuthMiss = (e) => /Auth session missing/i.test(String(e && e.message || e));
    const say = text => { if (status) status.textContent = isAuthMiss(text) ? '登录后收藏到云端' : text; };
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
      if (!song?.url) {
        // 无云端引用（本地文件 / 未登录无引用）：红心反映本机收藏状态
        const on = localState ? !!localState(song) : false;
        paint(on);
        button.title = song?.unavailableMessage || (on ? '已在本机收藏' : '收藏到本机');
        say(song?.unavailableMessage || (on ? '已在本机收藏' : '可收藏到本机'));
        button.disabled = false;
        return;
      }
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
    function toggleLocalOnly(song) {
      // 纯本机收藏（无云端引用）：切换本地列表 + 同步红心视觉，零网络请求
      const on = !(localState ? !!localState(song) : state);
      paint(on);
      if (localSet) localSet(song, on);
      say(on ? '已保存到本机喜欢' : '已取消本机喜欢');
      emit({ favorited: on, localOnly: true });
    }
    async function click() {
      if (busy || disposed) return;
      const song = getSong();
      if (!song) { say('请先载入当前歌曲'); return; }
      if (!song.url) { toggleLocalOnly(song); return; }
      const ticket = ++generation;
      // ── 乐观更新 + 双写联动：同步瞬间变色、本机列表先改，不等任何网络请求 ──
      const target = !state;
      paint(target);
      busy = true; button.setAttribute('aria-busy', 'true');
      say(target ? '正在收藏…' : '正在取消…');
      if (localSet) { try { localSet(song, target); } catch (_) {} }
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
          if (isAuthMiss(error)) {
            // 未登录：云端写不了，但本机收藏已生效（断网/未登录也能收藏）
            say('登录后收藏到云端（已保存到本机）');
            if (onError) onError(new Error('登录后可同步云端，已保存到本机喜欢'));
          } else {
            // ── 失败回滚：红心弹回原色，云端列表撤掉乐观项，弹窗报错；本机收藏保留 ──
            paint(!target);
            emit({ songUrl: song.url, favorited: !target, rollback: true });
            say(error.message);
            if (onError) onError(error);
          }
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
