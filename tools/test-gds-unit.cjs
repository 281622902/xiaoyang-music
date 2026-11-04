// 单测 gds.search → artist 匹配 → gds.url 全链
const gds = require('../server/providers/gds');
(async () => {
  console.log('--- gds.search 发如雪 周杰伦 ---');
  const r = await gds.search('netease', '发如雪 周杰伦', 1, 10);
  console.log('total:', r.total, 'count:', r.list.length);
  r.list.slice(0, 5).forEach((t) => console.log(' ', t.id, '|', t.name, '|', t.artist, '| dur:', t.duration));
  console.log('--- 逐个 gds.url ---');
  for (const c of r.list.slice(0, 3)) {
    const u = await gds.url('netease', c.id, '128');
    console.log(' ', c.id, c.name.slice(0, 20), '=>', u ? u.slice(0, 70) : 'EMPTY');
  }
  process.exit(0);
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
