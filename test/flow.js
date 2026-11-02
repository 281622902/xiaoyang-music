/* ============================================================
 * flow.js — 前后端全链路自测脚本（零依赖）
 *
 * 用法：
 *   本地真实音源：   node test/flow.js
 *   离线/沙箱自测：  MOCK=1 node test/flow.js
 *
 * 脚本会拉起 server（同进程子进程），依次请求：
 *   /api/health  /api/search  /api/song  /api/url  /api/lyric
 * 断言返回结构与前端 normalizeTrack 兼容，最后打印 PASS/FAIL 汇总。
 * ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 3991;
const USE_MOCK = process.env.MOCK === '1';
const NODE = process.execPath;
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const serverEnv = Object.assign({}, process.env, {
  PORT: String(PORT),
  MOCK: USE_MOCK ? '1' : '',
});

const srv = spawn(NODE, ['index.js'], { cwd: SERVER_DIR, env: serverEnv, stdio: 'ignore' });

function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${PORT}${pathname}`, (res) => {
      let buf = '';
      res.on('data', (d) => (buf += d));
      res.on('end', () => {
        let json = null;
        try { json = buf ? JSON.parse(buf) : null; } catch (e) { json = null; }
        resolve({ status: res.statusCode, json, raw: buf });
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

const CHECKS = [
  ['health', '/api/health', (j) => j && j.code === 200],
  ['search', '/api/search?keyword=晴天&limit=3', (j) => j && j.code === 200 && Array.isArray(j.result) && j.result.length > 0],
  ['song', '/api/song?id=181222', (j) => j && j.code === 200 && j.data && j.data.url && typeof j.data.lyric === 'string'],
  ['url', '/api/url?id=181222', (j) => j && j.code === 200 && j.url],
  ['lyric', '/api/lyric?id=181222', (j) => j && j.code === 200 && typeof j.lyric === 'string'],
];

async function main() {
  await new Promise((r) => setTimeout(r, 1500));
  let pass = 0;
  console.log(`\n=== 全链路自测 [${USE_MOCK ? 'MOCK 离线模式' : 'REAL 真实音源模式'}] ===\n`);
  for (const [name, p, fn] of CHECKS) {
    try {
      const { status, json } = await get(p);
      const ok = status === 200 && fn(json);
      if (ok) pass++;
      let info = '';
      if (json) {
        if (json.result) info = `(${json.result.length} 条结果)`;
        else if (json.data) info = `(${json.data.name})`;
        else if (json.url) info = `(url ok)`;
        else if (typeof json.lyric === 'string') info = `(${json.lyric.length} 字符歌词)`;
      } else if (status !== 200) info = `(HTTP ${status})`;
      console.log(`${ok ? '✅' : '❌'} ${name.padEnd(8)} HTTP ${status}  ${ok ? 'PASS' : 'FAIL'}  ${info}${json && json.msg ? '  msg=' + json.msg : ''}`);
    } catch (e) {
      console.log(`❌ ${name.padEnd(8)} 异常: ${e.message}`);
    }
  }
  const allOk = pass === CHECKS.length;
  console.log(`\n=== 结果：${pass}/${CHECKS.length} 通过 → ${allOk ? '全部通过 ✅' : '存在失败 ❌'} ===`);
  console.log(allOk ? '前后端全链路逻辑闭环，可进入真实音源/出包验证。' : '请检查失败项（真实模式失败多为网络限制，见 README 第七章）。');
  srv.kill();
  process.exit(allOk ? 0 : 1);
}

main();
