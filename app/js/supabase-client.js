// 原生脚本：不依赖测试页面的 DOM，不使用 npm 导入。
(function (global) {
  'use strict';
  const cloud = global.XYCloud = { appVersion: '3.1.0', user: null, currentSong: null, available: false, error: '' };
  try {
    if (!global.supabase?.auth) {
      if (typeof global.supabase?.createClient !== 'function') throw new Error('本地云端 SDK 文件缺失，请重新安装或重新同步应用资源');
      global.supabase = global.supabase.createClient(
        'https://codianpoqhqilkwviota.supabase.co',
        'sb_publishable__DRTgpxPfdR67tsFEJ_EDQ_gvZ8VvdM',
        { ...(global.XYNetwork ? {global:{fetch:global.XYNetwork.cloudFetch}} : {}), auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
          storage: global.XYAuthStorage || global.localStorage, storageKey: 'xiaoyang.supabase.auth.v1' } }
      );
    }
    cloud.available = true;
  } catch (error) { cloud.error = error.message; }
  function client() {
    if (!cloud.available) throw new Error(cloud.error);
    return global.supabase;
  }
  function normalizePhone(value) {
    let phone = String(value ?? '').trim().replace(/[\s-]/g, '').replace(/^(?:\+86|0086)/, '');
    if (/^86\d{11}$/.test(phone)) phone = phone.slice(2);
    if (!/^1\d{10}$/.test(phone)) throw new Error('请输入正确的 11 位中国大陆手机号');
    return '+86' + phone;
  }
  function passwordValue(value) {
    if (typeof value !== 'string' || !value.length) throw new Error('请输入密码');
    return value;
  }
  async function registerUser(phone, password) {
    const { data, error } = await client().auth.signUp({ phone: normalizePhone(phone), password: passwordValue(password) });
    if (error) throw new Error(global.XYNetwork?.describe(error) || error.message);
    return data;
  }
  async function loginUser(phone, password) {
    const { data, error } = await client().auth.signInWithPassword({ phone: normalizePhone(phone), password: passwordValue(password) });
    if (error) throw new Error(global.XYNetwork?.describe(error) || error.message);
    return data;
  }
  async function logoutUser() {
    const { error } = await client().auth.signOut({ scope: 'local' });
    if (error) throw error;
  }
  async function requireUser() {
    const { data, error } = await client().auth.getUser();
    if (error) throw error;
    if (!data.user) throw new Error('请先登录云端账户');
    return data.user;
  }
  function songUrl(value) {
    let url;
    try { url = new URL(String(value ?? '').trim()); } catch { throw new Error('歌曲地址无效'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('云端收藏仅支持 http 或 https 歌曲地址');
    return url.href;
  }
  async function addFavorite(songName, url) {
    const user = await requireUser();
    const name = String(songName ?? '').trim();
    if (!name) throw new Error('歌曲名称不能为空');
    const { data, error } = await client().from('user_favorites')
      .insert({ user_id: user.id, song_name: name, song_url: songUrl(url) })
      .select('id, user_id, song_name, song_url, created_at').single();
    if (error) throw new Error('添加收藏失败：' + error.message);
    return data;
  }
  async function getFavorites() {
    const user = await requireUser();
    const rows = []; let offset = 0;
    for (;;) {
      const { data, error, count } = await client().from('user_favorites')
        .select('id, user_id, song_name, song_url, created_at', { count: 'exact' })
        .eq('user_id', user.id).order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(offset, offset + 199);
      if (error) throw new Error('读取收藏失败：' + error.message);
      const page = data ?? []; rows.push(...page); offset += page.length;
      if (!page.length || (typeof count === 'number' ? offset >= count : page.length < 200)) return rows;
    }
  }
  cloud.displayUser = user => user?.phone ? user.phone.replace(/(\d{3})\d{4}(\d{4})$/, '$1****$2') : '云端账户';

  /* ---------- 云端歌单（user_playlists 表，见 supabase/playlists.sql） ---------- */
  // tracks 条目结构：{ name, url, added_at }；url 是稳定引用（provider 页面地址），
  // 播放时再解析，过期 CDN 直链不入库。
  function playlistName(value) {
    const name = String(value ?? '').trim();
    if (!name) throw new Error('歌单名不能为空');
    if (name.length > 100) throw new Error('歌单名最多 100 个字符');
    return name;
  }
  function playlistTrack(name, url) {
    return { name: String(name ?? '').trim() || '未知歌曲', url: songUrl(url), added_at: new Date().toISOString() };
  }
  async function createPlaylist(name, tracks) {
    const user = await requireUser();
    const rows = Array.isArray(tracks) ? tracks.map(t => playlistTrack(t?.name, t?.url)) : [];
    const { data, error } = await client().from('user_playlists')
      .insert({ user_id: user.id, name: playlistName(name), tracks: rows })
      .select('id, user_id, name, tracks, created_at, updated_at').single();
    if (error) throw new Error(/user_playlists_user_name_idx|duplicate key/i.test(error.message)
      ? '已有同名歌单' : '创建歌单失败：' + error.message);
    return data;
  }
  async function getPlaylists() {
    const user = await requireUser();
    const rows = []; let offset = 0;
    for (;;) {
      const { data, error, count } = await client().from('user_playlists')
        .select('id, user_id, name, tracks, created_at, updated_at', { count: 'exact' })
        .eq('user_id', user.id).order('updated_at', { ascending: false })
        .range(offset, offset + 199);
      if (error) throw new Error('读取歌单失败：' + error.message);
      const page = data ?? []; rows.push(...page); offset += page.length;
      if (!page.length || (typeof count === 'number' ? offset >= count : page.length < 200)) return rows;
    }
  }
  async function deletePlaylist(playlistId) {
    const user = await requireUser();
    const { data, error } = await client().from('user_playlists')
      .delete().eq('user_id', user.id).eq('id', playlistId).select('id');
    if (error) throw new Error('删除歌单失败：' + error.message);
    if (!data?.length) throw new Error('歌单不存在或已删除');
    return true;
  }
  async function renamePlaylist(playlistId, name) {
    const user = await requireUser();
    const { data, error } = await client().from('user_playlists')
      .update({ name: playlistName(name), updated_at: new Date().toISOString() })
      .eq('user_id', user.id).eq('id', playlistId)
      .select('id, name, updated_at').single();
    if (error) throw new Error(/user_playlists_user_name_idx|duplicate key/i.test(error.message)
      ? '已有同名歌单' : '重命名失败：' + error.message);
    return data;
  }
  // 原子加歌（playlist_add_tracks RPC，服务端按 url 去重），返回新增条数。
  async function addToPlaylist(playlistId, tracks) {
    const user = await requireUser();
    const items = (Array.isArray(tracks) ? tracks : [tracks]).map(t => playlistTrack(t?.name, t?.url));
    const { data, error } = await client().rpc('playlist_add_tracks', {
      expected_user: user.id, playlist_id: playlistId, new_tracks: items,
    });
    if (error) throw new Error(/playlist_not_found/.test(error.message) ? '歌单不存在'
      : /login_required/.test(error.message) ? '请先登录云端账户'
      : '加入歌单失败：' + error.message);
    return data ?? 0;
  }
  async function removeFromPlaylist(playlistId, url) {
    const user = await requireUser();
    const target = songUrl(url);
    const { data, error } = await client().from('user_playlists')
      .select('tracks').eq('user_id', user.id).eq('id', playlistId).single();
    if (error) throw new Error('读取歌单失败：' + error.message);
    const kept = (data?.tracks ?? []).filter(t => t?.url !== target);
    const removed = (data?.tracks?.length ?? 0) - kept.length;
    if (removed) {
      const { error: upErr } = await client().from('user_playlists')
        .update({ tracks: kept, updated_at: new Date().toISOString() })
        .eq('user_id', user.id).eq('id', playlistId);
      if (upErr) throw new Error('从歌单移除失败：' + upErr.message);
    }
    return removed;
  }
  Object.assign(global, { registerUser, loginUser, logoutUser, addFavorite, getFavorites,
    createPlaylist, getPlaylists, deletePlaylist, renamePlaylist, addToPlaylist, removeFromPlaylist });
  cloud.getUpdateInfo = async function () {
    client();
    const native = await global.uzzBridge?.getAppVersion?.();
    const androidInfo = global.XYNative?.isAndroid ? await global.XYNative.App.getInfo().catch(() => null) : null;
    const current = androidInfo?.version || native?.version || cloud.appVersion;
    const platform = global.Capacitor?.getPlatform?.() === 'android' || /Android/i.test(navigator.userAgent) ? 'android' : 'windows';
    const update = await global.checkAppUpdate(current, platform);
    return { ok: true, hasUpdate: !!update, latest: update?.version, url: update?.download_url,
      notes: update?.release_notes, cur: current, source: 'supabase' };
  };
})(window);
