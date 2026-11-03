// 在现有 Supabase 客户端与 addFavorite() 之后加载；不重复初始化客户端。
(function (global) {
  'use strict';
  function client() {
    if (!global.supabase?.auth || !global.supabase?.from) throw new Error('请先初始化 Supabase 客户端');
    return global.supabase;
  }
  async function loggedInUser() {
    const { data, error } = await client().auth.getUser();
    if (error) throw error;
    if (!data.user) throw new Error('请先登录');
    return data.user;
  }
  function favoriteUrl(value) {
    // 与原 addFavorite() 的 httpUrl() 保持相同规范化规则。
    let url;
    try { url = new URL(String(value ?? '').trim()); } catch { throw new Error('歌曲地址无效'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('歌曲地址必须使用 http 或 https');
    return url.href;
  }
  async function removeFavorite(songUrl) {
    const user = await loggedInUser();
    const { data, error } = await client()
      .from('user_favorites')
      .delete()
      .eq('user_id', user.id)
      .eq('song_url', favoriteUrl(songUrl))
      .select('id');
    if (error) throw new Error('取消收藏失败：' + error.message);
    return data?.length ?? 0; // 删除全部匹配记录，包括历史重复项；返回删除条数。
  }
  async function checkIsFavorited(songUrl) {
    const user = await loggedInUser();
    const { data, error } = await client()
      .from('user_favorites')
      .select('id')
      .eq('user_id', user.id)
      .eq('song_url', favoriteUrl(songUrl))
      .limit(1);
    if (error) throw new Error('查询收藏状态失败：' + error.message);
    return Boolean(data?.length);
  }
  // Provider page URLs are stable identifiers; expiring CDN URLs are only used for playback.
  function trackReference(track) {
    if (!track || ['local','device'].includes(track.vendor)) return '';
    if (track.cloudUrl) return track.cloudUrl;
    const id=String(track.id||'');
    if(track.vendor==='netease'&&/^\d+$/.test(id))return 'https://music.163.com/song?id='+id;
    if(track.vendor==='tencent'&&/^[A-Za-z0-9]{6,64}$/.test(id))return 'https://y.qq.com/n/ryqq/songDetail/'+id;
    if(track.vendor==='kugou'&&/^[A-Fa-f0-9]{32}$/.test(id))return 'https://www.kugou.com/song/#hash='+id.toUpperCase();
    if(track.vendor==='kuwo'&&/^\d+$/.test(id))return 'https://www.kuwo.cn/play_detail/'+id;
    return /^https?:\/\//i.test(track.url||'')?track.url:'';
  }
  function favoriteToTrack(row) {
    const base={name:row.song_name,artist:'',album:'',cloudUrl:row.song_url};let u;
    try{u=new URL(row.song_url);}catch{return null;}
    let vendor,id;
    if(u.hostname==='music.163.com'&&u.pathname==='/song'){vendor='netease';id=u.searchParams.get('id');}
    if(u.hostname==='y.qq.com'&&u.pathname.startsWith('/n/ryqq/songDetail/')){vendor='tencent';id=u.pathname.split('/').pop();}
    if(u.hostname==='www.kugou.com'&&u.pathname==='/song/'){vendor='kugou';id=new URLSearchParams(u.hash.slice(1)).get('hash');}
    if(u.hostname==='www.kuwo.cn'&&u.pathname.startsWith('/play_detail/')){vendor='kuwo';id=u.pathname.split('/').pop();}
    if(vendor&&id&&trackReference({vendor,id})===u.href)return {...base,id,vendor,url:''};
    return /^https?:$/.test(u.protocol)?{...base,id:'cloud:'+row.id,vendor:'cloud',url:u.href}:null;
  }
  Object.assign(global.XYCloud || (global.XYCloud={}),{trackReference,favoriteToTrack});

  function parseVersion(version) {
    const text = String(version ?? '').trim();
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(text);
    if (!match) throw new Error('无效版本号：' + text + '，请使用 1.2.3 格式');
    const pre = match[4] ? match[4].split('.') : [];
    if (pre.some(x => /^\d+$/.test(x) && x.length > 1 && x.startsWith('0'))) throw new Error('先行版本的数字不能有前导零：' + text);
    return { core: match.slice(1, 4), pre };
  }
  function compareNumber(a, b) {
    if (a.length !== b.length) return a.length > b.length ? 1 : -1;
    return a === b ? 0 : a > b ? 1 : -1;
  }
  function compareVersions(a, b) {
    const x = parseVersion(a), y = parseVersion(b);
    for (let i = 0; i < 3; i++) {
      const result = compareNumber(x.core[i], y.core[i]);
      if (result) return result;
    }
    if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
    for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
      const left = x.pre[i], right = y.pre[i];
      if (left === undefined) return -1;
      if (right === undefined) return 1;
      if (left === right) continue;
      const ln = /^\d+$/.test(left), rn = /^\d+$/.test(right);
      if (ln && rn) return compareNumber(left, right);
      if (ln !== rn) return ln ? -1 : 1;
      return left > right ? 1 : -1;
    }
    return 0; // 构建元数据 +build 不影响版本优先级。
  }
  async function checkAppUpdate(currentVersion, platform) {
    parseVersion(currentVersion);
    platform = String(platform ?? '').trim().toLowerCase();
    if (!['windows', 'android'].includes(platform)) throw new Error('platform 只能为 windows 或 android');

    // version 是文本，不能用 order('version').limit(1)：1.10.0 会被误排在 1.9.0 前面。
    // 分页读取该平台记录，再用 SemVer 规则选择最高版本，避免默认行数上限截断结果。
    const pageSize = 200;
    let offset = 0, latest = null;
    for (;;) {
      const { data, error, count } = await client()
        .from('app_versions')
        .select('id, platform, version, download_url, release_notes', { count: 'exact' })
        .eq('platform', platform)
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error('检查更新失败：' + error.message);
      const rows = data ?? [];
      if (!rows.length) break;
      for (const row of rows) {
        parseVersion(row.version);
        if (!latest || compareVersions(row.version, latest.version) >= 0) latest = row;
      }
      offset += rows.length;
      if (typeof count === 'number' && offset >= count) break;
      if (count == null && rows.length < pageSize) break;
    }
    if (!latest || compareVersions(latest.version, currentVersion) <= 0) return null;
    const downloadUrl = favoriteUrl(latest.download_url);
    if (platform === 'android' && !new URL(downloadUrl).pathname.toLowerCase().endsWith('.apk')) throw new Error('安卓版本记录需要提供 .apk 安装包下载链接');
    return { ...latest, download_url: downloadUrl };
  }
  Object.assign(global, { removeFavorite, checkIsFavorited, checkAppUpdate, compareVersions });
})(window);
