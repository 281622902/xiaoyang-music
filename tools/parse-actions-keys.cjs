// 静态解析 app/js/android.js 中 `const actions={...}` 的顶层键名
// 用于和运行时收集到的 data-action 集合做交叉闭环校验
const fs = require('fs');
const path = require('path');

// 去掉 JS 注释（保留字符串内容），用于提取条目头部的纯键名
function stripComments(src) {
  let out = '';
  let quote = null;
  for (let k = 0; k < src.length; k++) {
    const ch = src[k];
    if (quote) {
      out += ch;
      if (ch === '\\') { out += src[k + 1] || ''; k++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; out += ch; continue; }
    if (ch === '/' && src[k + 1] === '/') { while (k < src.length && src[k] !== '\n') k++; out += ' '; continue; }
    if (ch === '/' && src[k + 1] === '*') { k += 2; while (k < src.length && !(src[k] === '*' && src[k + 1] === '/')) k++; k++; out += ' '; continue; }
    out += ch;
  }
  return out;
}

function parseActionsKeys(file) {
  const src = fs.readFileSync(file, 'utf8');
  const marker = 'const actions={';
  const i = src.indexOf(marker);
  if (i < 0) throw new Error('actions object not found in ' + file);
  const start = src.indexOf('{', i + 'const actions'.length);
  let depth = 0;
  let end = -1;
  let quote = null;
  for (let k = start; k < src.length; k++) {
    const ch = src[k];
    if (quote) {
      if (ch === '\\') { k++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '/' && src[k + 1] === '/') { while (k < src.length && src[k] !== '\n') k++; continue; }
    if (ch === '/' && src[k + 1] === '*') { k += 2; while (k < src.length && !(src[k] === '*' && src[k + 1] === '/')) k++; k++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = k; break; } }
  }
  if (end < 0) throw new Error('unbalanced actions object');
  const body = src.slice(start + 1, end);

  const keys = [];
  let d = 0;
  let quote2 = null;
  let segStart = 0; // 当前顶层条目起点
  const segs = [];
  for (let k = 0; k < body.length; k++) {
    const ch = body[k];
    if (quote2) {
      if (ch === '\\') { k++; continue; }
      if (ch === quote2) quote2 = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote2 = ch; continue; }
    if (ch === '/' && body[k + 1] === '/') { while (k < body.length && body[k] !== '\n') k++; continue; }
    if (ch === '/' && body[k + 1] === '*') { k += 2; while (k < body.length && !(body[k] === '*' && body[k + 1] === '/')) k++; k++; continue; }
    if (ch === '{' || ch === '[' || ch === '(') { d++; continue; }
    if (ch === '}' || ch === ']' || ch === ')') { d--; continue; }
    if (d !== 0) continue;
    if (ch === ',') { segs.push(body.slice(segStart, k)); segStart = k + 1; }
  }
  segs.push(body.slice(segStart));

  for (const seg of segs) {
    const s = stripComments(seg).trim();
    if (!s) continue;
    const colon = s.indexOf(':');
    const head = (colon >= 0 ? s.slice(0, colon) : s).trim();
    // 顶层条目形如 `name:...`（具名键）或 `name`（ES6 对象简写键）
    const m = head.match(/^([A-Za-z_$][\w$]*)$/);
    if (m) keys.push(m[1]);
  }

  // 补充：定义后动态挂载的 `actions.xxx = ...`
  const reAssign = /\bactions\.([A-Za-z_$][\w$]*)\s*=/g;
  let m2;
  while ((m2 = reAssign.exec(src))) {
    if (!keys.includes(m2[1])) keys.push(m2[1]);
  }
  return keys;
}

module.exports = { parseActionsKeys };

if (require.main === module) {
  const file = process.argv[2] || path.join(__dirname, '..', 'app', 'js', 'android.js');
  const keys = parseActionsKeys(file);
  console.log('actions 顶层键 ' + keys.length + ' 个:');
  console.log(keys.join(' '));
}
