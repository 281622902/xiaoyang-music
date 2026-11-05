/* ============================================================
 * check-v361.cjs — v3.6.1 两个真机 Bug 的可复跑验证
 *
 * ① 上游整体不可达时不能再误报「暂无原唱版权」：
 *    - 正常后端：严格播放失败 → noOriginal（上游可达，确实无原唱）
 *    - 故障后端（XY_FORCE_UPSTREAM_DOWN=1）→ networkTimeout，且降级放宽
 * ② 云端歌单：
 *    - user_playlists 表存在且有数据（PC 已写入）
 *    - user_music_state 表与 save_music_state RPC 已初始化
 *    - /api/supabase 代理可读
 *
 * 前置：3112 正常后端、3115 故障模拟后端、SUPABASE_SERVICE_KEY 环境变量
 * ============================================================ */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const NORMAL = 'http://127.0.0.1:3112';
const DOWN = 'http://127.0.0.1:3115';
const SU = 'https://codianpoqhqilkwviota.supabase.co';
const ANON = 'sb_publishable__DRTgpxPfdR67tsFEJ_EDQ_gvZ8VvdM';
const SERVICE = process.env.SUPABASE_SERVICE_KEY ||
  (() => { try { return fs.readFileSync(path.join(__dirname, '..', 'tmp-test', '.sb-service-key'), 'utf8').trim(); } catch { return ''; } })();

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};
function req(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const r = lib.request({ hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method, headers }, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ _raw: d }); } });
    });
    r.on('error', (e) => resolve({ _error: e.message }));
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  console.log('── v3.6.1 Bug 修复验证 ──\n');

  // ① 正常后端：四类搜索都要有结果（并行兜底不能把本地搜好的搞坏）
  for (const type of ['song', 'artist', 'album', 'playlist']) {
    const j = await req(`${NORMAL}/api/search?keyword=${encodeURIComponent('周杰伦')}&type=${type}&artist=${encodeURIComponent('周杰伦')}&limit=20`);
    check(`正常后端 ${type} 搜索有结果`, (j.result || []).length > 0, JSON.stringify({ n: (j.result || []).length, degraded: j.degraded }));
  }

  // ② 正常后端：上游可达，解析失败应判「无原唱」
  const okSong = await req(`${NORMAL}/api/song?id=186016&vendor=netease&name=${encodeURIComponent('晴天')}&artist=${encodeURIComponent('周杰伦')}&expectArtist=${encodeURIComponent('周杰伦')}&strict=1`);
  const okData = okSong.data || {};
  check('正常后端失败判定为「暂无原唱版权」', !!okData.url || okData.noOriginal === true, JSON.stringify({ url: !!okData.url, noOriginal: okData.noOriginal }));

  // ③ 故障后端：绝不能再说没版权，必须给网络超时
  const downSong = await req(`${DOWN}/api/song?id=186016&vendor=netease&name=${encodeURIComponent('晴天')}&artist=${encodeURIComponent('周杰伦')}&expectArtist=${encodeURIComponent('周杰伦')}&strict=1`);
  const downData = downSong.data || {};
  check('上游全挂时回 networkTimeout 而非 noOriginal',
    downData.networkTimeout === true && !downData.noOriginal && /网络超时/.test(downData.msg || ''), JSON.stringify(downData));

  const downUrl = await req(`${DOWN}/api/url?id=186016&vendor=netease&name=${encodeURIComponent('晴天')}&artist=${encodeURIComponent('周杰伦')}&expectArtist=${encodeURIComponent('周杰伦')}&strict=1`);
  check('/api/url 同样区分网络故障', downUrl.networkTimeout === true && !downUrl.noOriginal, JSON.stringify(downUrl));

  // ④ 故障后端：严格过滤为空时降级放宽，不再全部拦截
  const downSearch = await req(`${DOWN}/api/search?keyword=${encodeURIComponent('不存在的歌XYZ')}&type=song&artist=${encodeURIComponent('不存在歌手ABC')}&limit=20`);
  check('搜索降级：上游全挂时放宽筛选而非 0 结果硬拦',
    downSearch.relaxed === true && downSearch.networkTimeout === true && !downSearch.noOriginal,
    JSON.stringify({ relaxed: downSearch.relaxed, msg: downSearch.msg }));

  // ⑤ Supabase：两套表 / RPC 都在
  const h = { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE };
  const pl = await req(`${SU}/rest/v1/user_playlists?select=id,name&limit=5`, { headers: h });
  check('user_playlists 表存在且含 PC 收藏数据', Array.isArray(pl) && pl.length > 0, JSON.stringify(pl).slice(0, 160));
  const state = await req(`${SU}/rest/v1/user_music_state?select=user_id&limit=1`, { headers: h });
  check('user_music_state 表已初始化', Array.isArray(state), JSON.stringify(state).slice(0, 160));
  const rpc = await req(`${SU}/rest/v1/rpc/save_music_state`, {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_user: '00000000-0000-0000-0000-000000000000', expected_revision: 0, new_payload: {} }),
  });
  check('save_music_state RPC 已创建（返回 login_required 说明已被调用）', rpc.code === 'P0001' && /login_required/.test(rpc.message || ''), JSON.stringify(rpc).slice(0, 160));

  // ⑥ /api/supabase 代理（带重试）可读
  const proxy = await req(`${NORMAL}/api/supabase/rest/v1/app_versions?select=version&limit=1`, { headers: { apikey: ANON, Authorization: 'Bearer ' + ANON } });
  check('/api/supabase 代理可用', Array.isArray(proxy) && proxy.length > 0, JSON.stringify(proxy).slice(0, 160));

  console.log('\n── 结果：✅ PASS ' + pass + ' / ❌ FAIL ' + fail + ' ──');
  process.exit(fail ? 1 : 0);
})();
