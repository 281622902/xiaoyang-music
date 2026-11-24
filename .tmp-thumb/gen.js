// 生成任务栏缩略图工具栏按钮图标：16x16 PNG（白字形+深影，明暗任务栏都可见）
// 超采样：64x64 渲染 → 盒式降采样到 16x16
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(b) { let c = 0xFFFFFFFF; for (const x of b) c = CRC_TABLE[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(t, d) {
  const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t), d]);
  const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(td));
  return Buffer.concat([l, td, cr]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// —— 形状定义（64x64 画布） ——
// 同侧法判定点在三角形内
function triSign(p, a, b) { return (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]); }
function inTri(px, py, a, b, c) {
  const p = [px, py];
  const d1 = triSign(p, a, b), d2 = triSign(p, b, c), d3 = triSign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}
function inRect(px, py, r) { return px >= r[0] && px < r[0] + r[2] && py >= r[1] && py < r[1] + r[3]; }

const SHAPES = {
  play:  (x, y) => inTri(x, y, [22, 14], [50, 32], [22, 50]),
  pause: (x, y) => inRect(x, y, [17, 14, 9, 36]) || inRect(x, y, [38, 14, 9, 36]),
  prev:  (x, y) => inRect(x, y, [14, 14, 7, 36]) || inTri(x, y, [47, 14], [25, 32], [47, 50]),
  next:  (x, y) => inRect(x, y, [43, 14, 7, 36]) || inTri(x, y, [17, 14], [39, 32], [17, 50]),
};

// 渲染 64x64：影子（深灰,偏移4px）在下，白字形在上
function render64(fn) {
  const img = Buffer.alloc(64 * 64 * 4);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      const sx = x - 4, sy = y - 4; // 影子偏移 (+4,+4) → 判断 (x-4,y-4) 是否命中
      const sh = fn(sx, sy) ? 0x20 : 0;
      const gl = fn(x, y);
      let r, g, b, a;
      if (gl) { r = 255; g = 255; b = 255; a = 255; }
      else if (sh) { r = 0x18; g = 0x18; b = 0x1c; a = 150; }
      else { r = g = b = a = 0; }
      img[i] = r; img[i + 1] = g; img[i + 2] = b; img[i + 3] = a;
    }
  }
  return img;
}
// 64→16 盒式降采样（ premultiplied 简化：先分通道平均，再修正 alpha>0 的颜色）
function down16(big) {
  const out = Buffer.alloc(16 * 16 * 4);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
        const i = ((y * 4 + dy) * 64 + x * 4 + dx) * 4;
        r += big[i]; g += big[i + 1]; b += big[i + 2]; a += big[i + 3];
      }
      const n = 16;
      const i = (y * 16 + x) * 4;
      out[i] = Math.round(r / n); out[i + 1] = Math.round(g / n);
      out[i + 2] = Math.round(b / n); out[i + 3] = Math.round(a / n);
    }
  }
  return out;
}

const outDir = path.join(__dirname, '..', 'electron', 'build', 'thumbar');
fs.mkdirSync(outDir, { recursive: true });
for (const [name, fn] of Object.entries(SHAPES)) {
  fs.writeFileSync(path.join(outDir, name + '.png'), encodePNG(16, 16, down16(render64(fn))));
  console.log('wrote', name + '.png');
}
