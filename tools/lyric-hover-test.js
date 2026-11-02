/* ============================================================
 * lyric-hover-test.js — 桌面歌词工具条「鼠标移上去就隐藏」修复验证
 *
 * 复现的真实场景（用户截图）：
 *   工具条贴在窗口顶部 top:4px，歌词贴在窗口底部，中间 200+px 空白。
 *   鼠标从歌词往上移向工具条 → 必然穿过中间空白
 *   → 旧逻辑判定"不命中" → near-bar 立刻移除 → 工具条中途消失 → 永远点不到
 *
 * 本测试模拟逐帧移动路径，断言：
 *   ① 从歌词向上移动到工具条的**整条路径**上，near-bar 始终保持
 *   ② 中途短暂离开后有 0.6s 迟滞（不会闪断）
 *   ③ 完全移出后才隐藏
 *   ④ 工具条本体与锁图标仍能命中
 * ============================================================ */
const path = require('path');

const LYRIC = path.join(__dirname, '..', 'electron', 'lyric.html');

(async () => {
  let pw;
  try { pw = require(path.join(__dirname, '..', 'electron', 'node_modules', 'playwright')); }
  catch (e) { console.log('playwright 不可用：', e.message); process.exit(1); }

  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 880, height: 340 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => {
    window.__sent = [];
    window.require = (m) => (m === 'electron' ? {
      ipcRenderer: {
        send: (ch, v) => { window.__sent.push({ ch, v }); },
        on: (ch, cb) => { (window.__handlers = window.__handlers || {})[ch] = cb; },
      },
    } : {});
  });
  await page.goto('file:///' + LYRIC.replace(/\\/g, '/'));
  await page.waitForTimeout(500);

  const res = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    const bar = document.getElementById('bar');
    const box = document.getElementById('lyricBox');
    const fire = (ch, v) => { const h = (window.__handlers || {})[ch]; if (h) h({ }, v); };

    // 锁定态（截图里就是锁定后工具条出现的场景）
    fire('lyric:locked', true);
    await sleep(200);
    // 注入歌词内容（真实使用时有文字，测试环境默认空盒高度只有 6px）
    document.getElementById('cur').textContent = '你的胆怯在我胸口';
    document.getElementById('sub').textContent = '修改任何已经审核通过的因果事实。';
    await sleep(120);
    out.locked = document.body.classList.contains('locked');

    const rb = bar.getBoundingClientRect();
    const rk = box.getBoundingClientRect();
    out.geom = {
      barTop: Math.round(rb.top), barBottom: Math.round(rb.bottom),
      lyricTop: Math.round(rk.top), lyricBottom: Math.round(rk.bottom),
      gap: Math.round(rk.top - rb.bottom),      // 中间空白高度
      barCx: Math.round(rb.left + rb.width / 2),
      lyricCy: Math.round(rk.top + rk.height / 2),
    };

    const move = async (x, y) => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
      await sleep(35);
      return document.body.classList.contains('near-bar');
    };

    // ① 起点：鼠标放在歌词上（此时工具条可能未亮）
    const pathStates = [];
    const x = out.geom.barCx;
    const yStart = out.geom.lyricCy;
    const yEnd = Math.round(out.geom.barTop + 14);
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const y = Math.round(yStart + (yEnd - yStart) * (i / steps));
      pathStates.push({ y, on: await move(x, y) });
    }
    out.pathStates = pathStates;
    // 路径中「曾经隐藏过」的点
    out.hiddenPoints = pathStates.filter((p) => !p.on).map((p) => p.y);
    // 到达工具条后应为亮
    out.atBar = pathStates[pathStates.length - 1].on;

    // ② 迟滞：从工具条稍微移开一点点（仍在通道内）应仍亮
    out.nearMissStillOn = await move(x, Math.round(out.geom.barBottom + 3));

    // ③ 完全移开（横向远离通道）→ 应隐藏（0.6s 后）
    await move(20, 5);
    const justAfter = document.body.classList.contains('near-bar');
    await sleep(800);   // 等迟滞到期
    out.hideAfterDelay = !document.body.classList.contains('near-bar');
    out.stillOnRightAfterLeave = justAfter;   // 刚离开时应仍亮（迟滞生效）

    // ④ 再移回工具条应能重新点亮
    out.reLight = await move(x, yEnd);

    // ⑤ 锁图标命中
    const lf = document.getElementById('lockFloat');
    const rl = lf.getBoundingClientRect();
    out.lockHit = await move(Math.round(rl.left + rl.width / 2), Math.round(rl.top + rl.height / 2));

    return out;
  });

  await browser.close();
  console.log(JSON.stringify(res, null, 2));

  const checks = [
    ['已处于锁定态', res.locked],
    ['歌词与工具条垂直分离（问题根源）', res.geom.gap !== 0],
    ['移动到工具条后工具条点亮', res.atBar],
    ['全程无隐藏点（核心修复）', res.hiddenPoints.length === 0],
    ['离开瞬间不闪断（0.6s迟滞）', res.stillOnRightAfterLeave === true],
    ['迟滞到期后正确隐藏', res.hideAfterDelay],
    ['移回工具条能重新点亮', res.reLight],
    ['锁图标仍可命中', res.lockHit],
  ];
  console.log('\n=== 判定 ===');
  let pass = 0;
  for (const [n, ok] of checks) {
    console.log((ok ? '  ' : '  ✗ ') + n.padEnd(30, ' ') + ' → ' + (ok ? 'PASS' : 'FAIL'));
    if (ok) pass++;
  }
  console.log(`\n${pass}/${checks.length} 项通过`);
  console.log('JS 错误:', errs.length, errs.slice(0, 2).join(' | '));
  process.exit(pass === checks.length ? 0 : 1);
})();