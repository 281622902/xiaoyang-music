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

module.exports = { name: 'gds', url };
