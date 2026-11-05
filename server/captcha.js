/* ============================================================
 * captcha.js — 图形验证码（注册防机器注册）
 *
 * 设计要点：
 *  - 零依赖：直接生成 SVG 文本，前端内联 <svg> 渲染，
 *    不引入 canvas / 图形库，安卓 WebView 与桌面浏览器都能显示；
 *  - 一次性：校验成功即作废，5 分钟过期；
 *  - 与手机短信验证码互为补充 —— 短信通道依赖第三方短信服务是否配置，
 *    图形验证码永远可用，保证「注册必须校验」这一硬要求不被短信服务拖垮。
 * ============================================================ */
const crypto = require('node:crypto');

// 去掉容易混淆的字符（0/O/1/I/l），降低用户手输错误率
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TTL_MS = 5 * 60 * 1000;
const MAX_ITEMS = 2000;
const store = new Map();

function randomCode(len = 4) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function sweep() {
  const now = Date.now();
  for (const [id, item] of store) {
    if (item.expiresAt <= now) store.delete(id);
  }
  while (store.size > MAX_ITEMS) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
  }
}

/** 生成一段 SVG：随机字符 + 干扰线 + 噪点 + 字符基线抖动 */
function renderSvg(code) {
  const w = 132, h = 44;
  const rand = (n) => crypto.randomBytes(2).readUInt16BE(0) % n;
  const palette = ['#2f6f5e', '#3b5bdb', '#c2410c', '#7c3aed', '#0f766e', '#b91c1c'];
  const parts = [];
  parts.push(`<rect width="${w}" height="${h}" rx="8" fill="#f4f7f5"/>`);
  // 干扰线
  for (let i = 0; i < 4; i++) {
    const y1 = rand(h), y2 = rand(h);
    parts.push(`<path d="M0 ${y1} Q ${w / 2} ${rand(h)} ${w} ${y2}" stroke="${palette[rand(palette.length)]}" stroke-opacity="0.28" stroke-width="1.2" fill="none"/>`);
  }
  // 噪点
  for (let i = 0; i < 26; i++) {
    parts.push(`<circle cx="${rand(w)}" cy="${rand(h)}" r="${1 + (rand(2))}" fill="#94a3b8" fill-opacity="0.4"/>`);
  }
  // 字符
  const step = (w - 16) / code.length;
  for (let i = 0; i < code.length; i++) {
    const x = 10 + step * i + rand(4);
    const y = 30 + rand(5) - 2;
    const rot = rand(30) - 15;
    const size = 22 + rand(4);
    parts.push(`<text x="${x}" y="${y}" font-size="${size}" font-family="Georgia,serif" font-weight="700" fill="${palette[rand(palette.length)]}" transform="rotate(${rot} ${x} ${y})">${code[i]}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="图形验证码">${parts.join('')}</svg>`;
}

/** 生成一个新的验证码，返回 { id, svg }（code 不外传） */
function issue() {
  sweep();
  const code = randomCode(4);
  const id = crypto.randomBytes(12).toString('hex');
  store.set(id, { code, expiresAt: Date.now() + TTL_MS, used: false });
  return { id, svg: renderSvg(code) };
}

/** 校验验证码；无论成功失败都立即作废该验证码（一次性） */
function verify(id, answer) {
  sweep();
  const key = String(id || '').trim();
  const item = store.get(key);
  if (!item) return { ok: false, msg: '验证码已过期，请点击图片刷新' };
  store.delete(key);
  if (item.expiresAt <= Date.now()) return { ok: false, msg: '验证码已过期，请点击图片刷新' };
  const given = String(answer || '').trim().toUpperCase();
  if (!given) return { ok: false, msg: '请输入图形验证码' };
  if (given !== item.code) return { ok: false, msg: '图形验证码不正确' };
  return { ok: true, msg: '' };
}

module.exports = { issue, verify, renderSvg, randomCode };
