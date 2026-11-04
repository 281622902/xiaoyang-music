const { upstreamFetch: fetch, sleep } = require('../request-context');
/* ============================================================
 * gds.js — GDStudio 公共聚合解析源（完整版兜底）
 * 作用：网易云 VIP/付费歌在免登录接口下只给 30s 试听，
 *       本源按「网易云歌曲 ID」直接解析出完整版音频（128k/320k/无损）。
 * 已实测：VIP 歌《心痛2009》(266s) 可解析出 10.6MB 完整 320k mp3。
 * 注意：公共接口偶发 503 限流，内置重试 + 音质降级（320 → 128）。
 * ============================================================ */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';



// 目前 GDStudio 可靠支持 netease 源；其他源 ID 不通用，直接跳过
async function url(vendor, id, br) {
  if (vendor !== 'netease' || !id) return '';
  // 先高音质重试，再降级 128k
  const brs = [br || '320', '128'].filter((x, i, a) => a.indexOf(x) === i);
  for (const b of brs) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const u = `https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id=${encodeURIComponent(id)}&br=${b}`;
        const res = await fetch(u, { headers: { 'User-Agent': UA }, redirect: 'follow' });
        if (res.status === 503 || res.status === 429) {
          await sleep(6000); // 限流，稍等重试
          continue;
        }
        if (!res.ok) break; // 其他错误换下一档音质
        const text = await res.text();
        if (!text) continue;
        try {
          const j = JSON.parse(text);
          if (j && j.url) return j.url;
          // code 非空且无 url：该音质无版权，直接降级
          if (j && j.code) break;
          continue;
        } catch (e) { /* 非 JSON，重试 */ }
      } catch (e) {
        await sleep(2000);
      }
    }
  }
  return '';
}

// GDStudio 搜索（netease 源）：海外可达，直连网易搜索被风控/超时时的兜底。
// 真机 4G 实测：海外后端直连网易搜索经常失败，导致搜索结果全是酷狗曲目
// （酷狗解析在海外又被拒 → 必然「该音源暂无可播放地址」）。
// GDStudio 走 Cloudflare 全球节点，搜索+解析全链路海外可用。
async function search(vendor, keyword, page = 1, limit = 20) {
  if (vendor && vendor !== 'netease') return { list: [], total: 0 };
  const kw = String(keyword || '').trim();
  if (!kw) return { list: [], total: 0 };
  try {
    const u = `https://music-api.gdstudio.xyz/api.php?types=search&source=netease&name=${encodeURIComponent(kw)}&count=${limit}&pages=${page}`;
    // 公共实例对高频 IP 偶发 503/429 限流：失败后小退避重试一次（真机压测实测）
    let res;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch(u, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (res.ok) break;
      if ((res.status === 503 || res.status === 429) && attempt === 0) {
        await sleep(2500);
        continue;
      }
      return { list: [], total: 0 };
    }
    if (!res || !res.ok) return { list: [], total: 0 };
    const j = await res.json();
    const arr = Array.isArray(j) ? j : [];
    // GDStudio 字段形态不定：artist/album 可能是字符串、对象 {name} 或数组 [{name}]
    const flat = (v) => {
      if (!v) return '';
      if (typeof v === 'string') return v;
      if (Array.isArray(v)) return v.map((x) => (x && x.name) || x).filter(Boolean).join('/');
      return v.name || '';
    };
    const list = arr.map((s) => ({
      id: String(s.id || ''),
      name: s.name || s.title || '',
      artist: flat(s.artist),
      artistId: (s.artist && s.artist.id) || '',
      album: flat(s.album),
      albumId: (s.album && s.album.id) || '',
      pic: s.pic || s.picUrl || s.cover || '',
      vendor: 'netease',
      duration: Number(s.dt || s.duration || 0) || 0,
    })).filter((x) => x.id && x.name);
    // GDStudio 分页无精确 total：当前页不满则视为末页
    const total = (page - 1) * limit + list.length + (list.length >= limit ? 1 : 0);
    return { list, total };
  } catch (e) {
    return { list: [], total: 0 };
  }
}

module.exports = { name: 'gds', url, search };
