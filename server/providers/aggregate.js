const { upstreamFetch: fetch } = require('../request-context');
/* ============================================================
 * aggregate.js — 聚合解析兜底源（meting 公共实例）
 * 作用：当直连各音源取播放地址失败（反爬/风控/无 cookie）时，
 *       用 meting 公共接口按「网易云歌曲 ID」解析出真实音频地址。
 * 已实测：injahow 实例仅支持 netease 源；返回 302 → 真实 mp3。
 * ============================================================ */
const METING_URL = 'https://api.injahow.cn/meting/';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// 目前仅支持 netease；其他源传空直接跳过
async function url(vendor, id) {
  if (vendor !== 'netease' || !id) return '';
  try {
    const res = await fetch(`${METING_URL}?type=url&id=${encodeURIComponent(id)}`, {
      redirect: 'follow',
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) return '';
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    // 正常情况：302 跟随到 mp3，最终 content-type 为 audio/mpeg
    if (ct.includes('audio') || ct.includes('octet-stream')) return res.url || '';
    // 兼容返回 JSON 的部署 { url: '...' }
    const text = await res.text();
    if (text) {
      try {
        const j = JSON.parse(text);
        if (j && j.url) return j.url;
      } catch (e) { /* 非 JSON，忽略 */ }
    }
    return '';
  } catch (e) {
    return '';
  }
}

module.exports = { name: 'aggregate', url };
