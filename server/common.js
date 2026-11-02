const { upstreamFetch: fetch } = require('./request-context');
/* ============================================================
 * common.js — 加密与 HTTP 公共工具（零依赖，仅用 Node 内置 crypto + fetch）
 * 网易云 weapi 加密采用社区公开固定参数（与官方前端一致）。
 * ============================================================ */
const crypto = require('crypto');

const IV = '0102030405060708';
const NONCE = '0CoJUm6Qyw8W8jud';
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// 网易云公开 RSA 公钥（PEM）。weapi 用“无填充”方式对 16 位随机密钥做 RSA 加密。
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`;
const RSA_PUBKEY = crypto.createPublicKey(PUBLIC_KEY_PEM);
const RSA_KEYSIZE = RSA_PUBKEY.asymmetricKeyDetails.modulusLength / 8; // 字节数

function randomKey(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += BASE62[Math.floor(Math.random() * BASE62.length)];
  return s;
}

function aesEncrypt(text, key) {
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(IV, 'utf8'));
  return cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
}

function rsaEncrypt(text) {
  const reversed = text.split('').reverse().join('');
  const buf = Buffer.from(reversed, 'utf8');
  const padded = Buffer.alloc(RSA_KEYSIZE);
  buf.copy(padded, RSA_KEYSIZE - buf.length);
  const enc = crypto.publicEncrypt({ key: RSA_PUBKEY, padding: crypto.constants.RSA_NO_PADDING }, padded);
  return enc.toString('hex');
}

// 生成 weapi 请求体 { params, encSecKey }
function weapi(obj) {
  const text = JSON.stringify(obj);
  const secKey = randomKey(16);
  const encText = aesEncrypt(aesEncrypt(text, NONCE), secKey);
  const encSecKey = rsaEncrypt(secKey);
  return { params: encText, encSecKey };
}

// 健壮 GET：网络异常 / 空响应 / 非 JSON 一律返回「伪响应」，.json() 解析失败返回 null，绝不抛异常
async function jget(url, headers) {
  try {
    const res = await fetch(url, { headers: headers || {} });
    const text = await res.text();
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch (e) { json = null; } }
    return {
      ok: res.ok,
      status: res.status,
      json: async () => json,
      text: async () => text,
    };
  } catch (e) {
    return { ok: false, status: 0, json: async () => null, text: async () => '' };
  }
}

// 健壮 POST（form-urlencoded）：同上
async function jpost(url, data, headers) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, headers || {}),
      body: new URLSearchParams(data).toString(),
    });
    const text = await res.text();
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch (e) { json = null; } }
    return {
      ok: res.ok,
      status: res.status,
      json: async () => json,
      text: async () => text,
    };
  } catch (e) {
    return { ok: false, status: 0, json: async () => null, text: async () => '' };
  }
}

// 兼容别名（旧调用点保持 res.json() 写法）
async function getJson(url, headers) { return jget(url, headers); }
async function postForm(url, data, headers) { return jpost(url, data, headers); }

function md5(str) {
  return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}

function randHex(len) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}

module.exports = { weapi, postForm, getJson, md5, randHex, IV, NONCE, rsaEncrypt };
