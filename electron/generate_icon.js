// 生成一张 256x256 的 .ico（纯前端无依赖），主题色与播放器一致（青色 #00e0c6）
const fs = require('fs');
const path = require('path');

const SIZE = 256;
const bg = [0x00, 0xe0, 0xc6]; // BGR for #00e0c6
const fg = [0xff, 0xff, 0xff];

// 像素缓冲（BGRA），自下而上
const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // 以中心为圆心画一个白色圆（留青色边）
    const dx = x - SIZE / 2 + 0.5;
    const dy = y - SIZE / 2 + 0.5;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const i = (y * SIZE + x) * 4;
    let c = bg;
    if (dist < SIZE * 0.34) c = fg; // 内圆
    pixels[i] = c[0];
    pixels[i + 1] = c[1];
    pixels[i + 2] = c[2];
    pixels[i + 3] = 255;
  }
}

const andMask = Buffer.alloc((SIZE * SIZE) / 8); // 全 0（不透明）

const bmpHeader = Buffer.alloc(40);
bmpHeader.writeUInt32LE(40, 0);
bmpHeader.writeUInt32LE(SIZE, 4);
bmpHeader.writeUInt32LE(SIZE * 2, 8); // 含 AND mask
bmpHeader.writeUInt16LE(1, 12);
bmpHeader.writeUInt16LE(32, 14);
bmpHeader.writeUInt32LE(0, 16);
bmpHeader.writeUInt32LE(pixels.length + andMask.length, 20);
bmpHeader.writeUInt32LE(2835, 24);
bmpHeader.writeUInt32LE(2835, 28);

const imageData = Buffer.concat([bmpHeader, pixels, andMask]);

const dirEntry = Buffer.alloc(16);
dirEntry.writeUInt8(SIZE % 256, 0); // 256 用 0 表示
dirEntry.writeUInt8(SIZE % 256, 1);
dirEntry.writeUInt8(0, 2);
dirEntry.writeUInt8(0, 3);
dirEntry.writeUInt16LE(1, 4);
dirEntry.writeUInt16LE(32, 6);
dirEntry.writeUInt32LE(imageData.length, 8);
dirEntry.writeUInt32LE(6 + 16, 12);

const iconDir = Buffer.alloc(6);
iconDir.writeUInt16LE(0, 0);
iconDir.writeUInt16LE(1, 2);
iconDir.writeUInt16LE(1, 4);

const ico = Buffer.concat([iconDir, dirEntry, imageData]);
fs.writeFileSync(path.join(__dirname, 'build', 'icon.ico'), ico);
console.log('icon.ico written, bytes =', ico.length);
