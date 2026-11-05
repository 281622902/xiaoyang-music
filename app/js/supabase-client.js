// 原生脚本：不依赖测试页面的 DOM，不使用 npm 导入。
(function (global) {
  'use strict';
  const cloud = global.XYCloud = { appVersion: '3.8.0', user: null, currentSong: null, available: false, error: '' };
  try {
    if (!global.supabase?.auth) {
      if (typeof global.supabase?.createClient !== 'function') throw new Error('本地云端 SDK 文件缺失，请重新安装或重新同步应用资源');
      // 手机端走音乐后端的 Supabase 反向代理（/api/supabase/*）：国内运营商掐断
      // supabase.co（登录 Connection reset），由 Render/电脑后端（海外→海外或国内直连）
      // 原样透传 auth/rest/storage。桌面与无后端时保持直连。
      const apiBase = (global.UzzApi?.getApiBase?.() || '').trim();
      const useProxy = global.XYNative?.isAndroid && !!apiBase && global.XYNetwork?.supabaseProxyAvailable !== false;
      const suBase = useProxy ? (global.XYNetwork?.supabaseOrigin ? global.XYNetwork.supabaseOrigin() : apiBase.replace(/\/+$/, '') + '/api/supabase') : 'https://codianpoqhqilkwviota.supabase.co';
      global.supabase = global.supabase.createClient(
        suBase,
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

  /* ---------- 资料中心：昵称 / 用户名 / 头像 / 密码 ---------- */
  // 资料统一存在 Supabase Auth 的 user_metadata 里：
  //   nickname  昵称（界面上显示的友好名称）
  //   username  用户名（唯一登录别名，登录时可用手机号或用户名）
  //   avatar_url 头像（前端压缩后的 data:image/jpeg;base64,...）
  function profileMeta(user) {
    const meta = (user && user.user_metadata) || {};
    return {
      nickname: String(meta.nickname || '').trim(),
      username: String(meta.username || '').trim(),
      avatar: String(meta.avatar_url || '').trim(),
    };
  }
  cloud.profile = profileMeta;
  // 昵称优先，其次用户名，其次脱敏手机号
  cloud.displayName = user => {
    const p = profileMeta(user);
    if (p.nickname) return p.nickname;
    if (p.username) return p.username;
    return cloud.displayUser(user);
  };
  function validUsername(value) {
    const name = String(value ?? '').trim();
    if (!name) throw new Error('用户名不能为空');
    if (name.length < 3 || name.length > 20) throw new Error('用户名长度需在 3-20 个字符之间');
    if (!/^[a-zA-Z0-9_.@-]+$/.test(name)) throw new Error('用户名只能包含字母、数字、下划线、点、@ 和连字符');
    return name;
  }
  function validNickname(value) {
    const name = String(value ?? '').trim();
    if (!name) throw new Error('昵称不能为空');
    if (name.length > 24) throw new Error('昵称最多 24 个字符');
    return name;
  }
  // 头像：仅接受 http(s) 直链或 data:image/... 内联图，拒绝其它协议
  function validAvatar(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(raw)) {
      if (raw.length > 300000) throw new Error('头像图片过大，请换一张');
      return raw;
    }
    if (/^https?:\/\//i.test(raw)) return raw;
    throw new Error('头像格式不支持');
  }
  async function updateProfile(patch) {
    const user = await requireUser();
    const data = {};
    if (patch && patch.nickname !== undefined) data.nickname = validNickname(patch.nickname);
    if (patch && patch.username !== undefined) data.username = validUsername(patch.username);
    if (patch && patch.avatar !== undefined) data.avatar_url = validAvatar(patch.avatar);
    if (!Object.keys(data).length) throw new Error('没有需要保存的修改');
    const { data: out, error } = await client().auth.updateUser({ data });
    if (error) throw new Error(global.XYNetwork?.describe(error) || error.message);
    cloud.user = out?.user || user;
    return cloud.user;
  }
  // 改密码：先验旧密码（Supabase 不返回旧密码，只能重新登录验证），再改密
  async function changePassword(oldPassword, newPassword) {
    const user = await requireUser();
    if (!user.phone) throw new Error('当前账号没有绑定手机号，无法验证原密码');
    const oldPw = passwordValue(oldPassword);
    const newPw = passwordValue(newPassword);
    if (newPw.length < 6) throw new Error('新密码至少 6 位');
    if (oldPw === newPw) throw new Error('新密码不能与原密码相同');
    const { error: signErr } = await client().auth.signInWithPassword({ phone: normalizePhone(user.phone), password: oldPw });
    if (signErr) throw new Error('原密码不正确');
    const { error } = await client().auth.updateUser({ password: newPw });
    if (error) throw new Error(global.XYNetwork?.describe(error) || error.message);
    return true;
  }
  // 头像本地压缩：≤128×128 的 JPEG data URL（省流量 + 适配 user_metadata 体积）
  function compressAvatar(file, size) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type || '')) return reject(new Error('请选择图片文件'));
      if (file.size > 8 * 1024 * 1024) return reject(new Error('图片过大，请选择 8MB 以内的图片'));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('图片解析失败，请换一张'));
        img.onload = () => {
          const max = size || 128;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          try { resolve(canvas.toDataURL('image/jpeg', 0.82)); }
          catch (e) { reject(new Error('头像处理失败')); }
        };
        img.src = String(reader.result || '');
      };
      reader.readAsDataURL(file);
    });
  }

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
    createPlaylist, getPlaylists, deletePlaylist, renamePlaylist, addToPlaylist, removeFromPlaylist,
    updateProfile, changePassword, compressAvatar });
  cloud.getUpdateInfo = async function () {
    let native = null, androidInfo = null;
    try { native = await global.uzzBridge?.getAppVersion?.(); } catch (e) { /* 桌面外无此桥 */ }
    if (global.XYNative?.isAndroid && global.XYNative.App?.getInfo) {
      androidInfo = await global.XYNative.App.getInfo().catch(() => null);
    }
    const current = androidInfo?.version || native?.version || cloud.appVersion;
    const platform = global.Capacitor?.getPlatform?.() === 'android' || /Android/i.test(navigator.userAgent) ? 'android' : 'windows';
    let update = null, source = 'supabase';
    try {
      // 8 秒竞速：Supabase 被墙时 reset 通常几秒内报错，超时兜底防止长时间转圈
      update = await Promise.race([
        global.checkAppUpdate(current, platform),
        new Promise((_, rej) => setTimeout(() => rej(new Error('supabase timeout')), 8000)),
      ]);
    } catch (e) {
      // Supabase 被墙降级兜底（真机实测 Connection reset）：改走音乐后端的
      // /api/version 代理（Render 海外→海外查 Supabase），下载地址已由后端
      // 改写为它自己的 /api/release-file 流式代理（supabase.co 域名同样被墙）。
      const base = (global.UzzApi?.getApiBase?.() || '').trim();
      if (!base) throw e;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      try {
        const r = await fetch(base + '/api/version/' + platform + '?current=' + encodeURIComponent(current), { signal: ctrl.signal });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || j.code !== 200) throw new Error((j && j.msg) || 'HTTP ' + r.status);
        source = 'render';
        update = j.version && j.version !== current
          ? { version: j.version, download_url: j.download_url, release_notes: j.release_notes }
          : null;
      } finally { clearTimeout(timer); }
    }
    // 防御性净化（v3.2.3 热修）：安卓端任何来源的 supabase.co 下载直链一律改写为
    // 音乐后端 /api/release-file 流式代理。v3.1.8 后 Supabase 查询经 /api/supabase
    // 反代可成功，返回的是 DB 原始 supabase.co 直链——原生下载器直连被墙
    // （真机实测 15s connect 超时）。改写后下载流量经 Render（国内可达）转发。
    if (update && update.download_url && /supabase\.co/i.test(update.download_url)
        && (platform === 'android' || global.XYNative?.isAndroid)) {
      const base = (global.UzzApi?.getApiBase?.() || '').replace(/\/+$/, '');
      if (base) update.download_url = base + '/api/release-file?v=' + encodeURIComponent(update.version);
    }
    return { ok: true, hasUpdate: !!update, latest: update?.version, url: update?.download_url,
      notes: update?.release_notes, cur: current, source };
  };
})(window);
