// 由 build/icon.svg 生成多尺寸 PNG 并打包为 Windows .ico（PNG 内嵌格式）
// 用法: node make_icon.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const svgPath = path.join(__dirname, 'build', 'icon.svg');
const outDir = path.join(__dirname, 'build');
const svg = fs.readFileSync(svgPath, 'utf8');

function packIco(pngs) {
  // ICO 头(6) + 目录项(16*n) + 各 PNG 数据
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type icon
  header.writeUInt16LE(pngs.length, 4);

  let offset = 6 + 16 * pngs.length;
  const entries = [];
  const blobs = [];
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size % 256, 0);
    e.writeUInt8(size % 256, 1);
    e.writeUInt8(0, 2); // 调色板
    e.writeUInt8(0, 3); // 保留
    e.writeUInt16LE(1, 4); // 平面
    e.writeUInt16LE(32, 6); // 位深
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    blobs.push(data);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...blobs]);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 300, height: 300 } });
  const pngs = [];
  for (const size of SIZES) {
    await page.setContent(
      `<body style="margin:0;background:transparent">${svg.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body>`
    );
    const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    pngs.push({ size, data: buf });
    if (size === 256) fs.writeFileSync(path.join(outDir, 'icon.png'), buf);
    console.log(`rendered ${size}px, ${buf.length} bytes`);
  }
  await browser.close();

  const ico = packIco(pngs);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
  console.log('icon.ico written,', ico.length, 'bytes,', pngs.length, 'sizes');
})();
