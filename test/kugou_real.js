/* kugou_real.js — 酷狗真实音源全链路实测（零依赖）
 * 沙箱内网易爆出歌，本脚本验证 search→url→lyric 全链路。
 * 用法：DEFAULT_VENDOR=kugou node test/kugou_real.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 3993;
const NODE = process.execPath;
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const srv = spawn(NODE, ['index.js'], { cwd: SERVER_DIR, env: Object.assign({}, process.env, { PORT: String(PORT), DEFAULT_VENDOR: 'kugou' }), stdio: 'ignore' });

function get(p) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}${p}`, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => {
        let j = null; try { j = b ? JSON.parse(b) : null; } catch (e) { j = null; }
        resolve({ status: res.statusCode, json: j, raw: b });
      });
    }).on('error', reject).setTimeout(20000, () => req.destroy(new Error('timeout')));
  });
}

async function main() {
  await new Promise((r) => setTimeout(r, 1500));
  console.log('\n=== 酷狗真实音源全链路实测 ===\n');
  const search = await get('/api/search?keyword=%E6%99%B4%E5%A4%A9&limit=5');
  if (search.status !== 200 || !search.json || !Array.isArray(search.json.result) || !search.json.result.length) {
    console.log('❌ 搜索失败：', search.status, search.raw.slice(0, 200));
    srv.kill(); process.exit(1);
  }
  const list = search.json.result;
  console.log('✅ 搜索成功，返回 ' + list.length + ' 条：');
  list.slice(0, 5).forEach((t, i) => console.log(`   ${i + 1}. 《${t.name}》 - ${t.artist}  [${t.album}]  id=${t.id}`));

  const first = list[0];
  const song = await get(`/api/song?id=${encodeURIComponent(first.id)}&vendor=kugou`);
  const urlOk = song.json && song.json.data && song.json.data.url;
  console.log(`\n${urlOk ? '✅' : '❌'} 单曲详情+播放地址：HTTP ${song.status}  url=${urlOk ? song.json.data.url.slice(0, 60) + '...' : '缺失'}`);

  const lyric = await get(`/api/lyric?id=${encodeURIComponent(first.id)}&vendor=kugou`);
  const lyrOk = lyric.json && typeof lyric.json.lyric === 'string';
  console.log(`${lyrOk ? '✅' : '❌'} 歌词：HTTP ${lyric.status}  ${lyrOk ? lyric.json.lyric.length + ' 字符' : '缺失'}`);
  if (lyrOk && lyric.json.lyric) console.log('   歌词预览：\n' + lyric.json.lyric.split('\n').slice(0, 4).join('\n'));

  const allOk = urlOk && lyrOk;
  console.log(`\n=== 酷狗真实链路：${allOk ? '全部通过 ✅（沙箱内可真实搜歌+播放地址+歌词）' : '部分失败 ❌'} ===`);
  srv.kill();
  process.exit(allOk ? 0 : 1);
}
main();
