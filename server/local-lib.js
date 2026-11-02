/* ============================================================
 * local-lib.js — 本地音乐库（纯 Node，无原生依赖）
 * 职责：
 *   - 递归扫描目录，用 music-metadata 解析元数据（标题/歌手/专辑/时长/封面/ReplayGain）
 *   - JSON 媒体库持久化（userData/local-music/library.json）
 *   - LRC / CUE 解析、封面缓存、断点续听进度、重复文件检测
 *   - 文件系统监控（文件夹新增/删除自动更新，防抖）
 * 数据目录：优先 UZZ_USER_DATA/local-music（Electron 场景），否则 server/.localdata（开发）
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mm = require('music-metadata');

const AUDIO_EXT = new Set([
  '.mp3', '.flac', '.wav', '.ogg', '.opus', '.m4a', '.aac',
  '.ape', '.wma', '.mp2', '.tta', '.tak', '.mpc', '.dsf', '.dff', '.wv', '.aif', '.aiff', '.alac', '.mka', '.ac3',
]);
// 短音频也是有效音乐，扫描只跳过空文件。
const MIN_SIZE = 1;

function dataDir() {
  const base = process.env.UZZ_USER_DATA
    ? path.join(process.env.UZZ_USER_DATA, 'local-music')
    : path.join(__dirname, '.localdata');
  try { fs.mkdirSync(base, { recursive: true }); } catch (e) { /* 忽略 */ }
  return base;
}
function libPath() { return path.join(dataDir(), 'library.json'); }
function coverDir() { const d = path.join(dataDir(), 'covers'); try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} return d; }
function progressPath() { return path.join(dataDir(), 'progress.json'); }

function loadLib() {
  for (const fp of [libPath(), libPath() + '.bak']) {
    try {
      const o = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      if (!Array.isArray(o.tracks) || !Array.isArray(o.folders)) continue;
      return { version: 1, ...o };
    } catch (e) {}
  }
  return { version: 1, folders: [], tracks: [] };
}
function saveLib(lib) {
  const dest = libPath();
  if (fs.existsSync(dest)) {
    try { const old = JSON.parse(fs.readFileSync(dest, 'utf8')); if (Array.isArray(old.tracks)) fs.copyFileSync(dest, dest + '.bak'); } catch (e) {}
  }
  fs.writeFileSync(dest + '.tmp', JSON.stringify(lib));
  fs.renameSync(dest + '.tmp', dest);
}
let mutationQueue = Promise.resolve();
function serializeMutation(fn) {
  const next = mutationQueue.then(fn, fn);
  mutationQueue = next.catch(() => {});
  return next;
}
function loadProgress() {
  try { return JSON.parse(fs.readFileSync(progressPath(), 'utf-8')) || {}; } catch (e) { return {}; }
}
function saveProgress(p) { const dest = progressPath(); fs.writeFileSync(dest + '.tmp', JSON.stringify(p)); fs.renameSync(dest + '.tmp', dest); }

function idFor(p) { return crypto.createHash('sha1').update(p).digest('hex').slice(0, 16); }

function pickRG(meta) {
  const tags = meta.native || {};
  for (const key of Object.keys(tags)) {
    for (const t of tags[key]) {
      if (/replaygain_track_gain/i.test(t.id)) {
        const m = /([-\d.]+)\s*db/i.exec(t.value);
        if (m) return parseFloat(m[1]);
      }
    }
  }
  return 0;
}

function saveCover(buf) {
  try {
    const h = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
    const fp = path.join(coverDir(), h + '.jpg');
    fs.writeFileSync(fp, buf);
    return h;
  } catch (e) { return ''; }
}

async function readMeta(p) {
  let stat;
  try { stat = fs.statSync(p); } catch (e) { stat = { size: 0, mtimeMs: 0 }; }
  const base = path.basename(p, path.extname(p));
  const siblingLrc = path.join(path.dirname(p), base + '.lrc');
  const siblingCue = path.join(path.dirname(p), base + '.cue');
  const hasLrc = fs.existsSync(siblingLrc);
  const hasCue = fs.existsSync(siblingCue);
  const entry = {
    id: idFor(p), path: p, name: base, artist: '未知艺术家', album: '未知专辑',
    duration: 0, format: path.extname(p).replace('.', '').toUpperCase() || '?',
    size: stat.size || 0, mtime: stat.mtimeMs || 0, coverId: '', hasLrc, hasCue,
    replayGain: 0, genre: '', year: 0, composer: '', track: 0, disc: 0,
  };
  try {
    const meta = await mm.parseFile(p, { duration: true, skipCovers: false });
    const com = meta.common || {};
    const fmt = meta.format || {};
    if (com.title) entry.name = com.title;
    if (com.artists && com.artists.length) entry.artist = com.artists.join('/');
    else if (com.artist) entry.artist = com.artist;
    if (com.album) entry.album = com.album;
    if (fmt.duration) entry.duration = Math.round(fmt.duration);
    if (fmt.container) entry.format = String(fmt.container).replace('.', '').toUpperCase();
    if (com.picture && com.picture.length) entry.coverId = saveCover(com.picture[0].data);
    entry.replayGain = pickRG(meta);
    // ── 更细的元数据：风格 / 年份 / 作曲 / 曲目号 / 碟号（供智能歌单与分轨信息展示）──
    if (com.genre && com.genre.length) entry.genre = com.genre.join('/');
    if (com.year) entry.year = com.year;
    if (com.composer && com.composer.length) entry.composer = com.composer.join('/');
    if (com.track && com.track.no) entry.track = com.track.no;
    if (com.disk && com.disk.no) entry.disc = com.disk.no;
  } catch (e) {
    // 解析失败用文件名兜底，仍纳入媒体库（保证不漏歌）
  }
  return entry;
}

function addFile(fp) { return serializeMutation(() => addFileUnsafe(fp)); }
async function addFileUnsafe(fp) {
  const rp = path.resolve(fp);
  if (!AUDIO_EXT.has(path.extname(rp).toLowerCase())) throw new Error('not audio');
  const st = await fs.promises.stat(rp);
  if (!st.isFile()) throw new Error('not a file');
  const entry = await readMeta(rp);
  const lib = loadLib();
  const i = lib.tracks.findIndex(t => t.id === entry.id);
  if (i < 0) lib.tracks.push(entry); else lib.tracks[i] = entry;
  saveLib(lib);
  return getLibrary().find(t => t.id === entry.id);
}

async function walk(dir, out, errors) {
  let ents;
  try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); }
  catch (e) { errors.push(String(e && e.message || e)); return; }
  for (const ent of ents) {
    const fp = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'covers' || ent.name.startsWith('.')) continue; // 跳过缓存/隐藏
      await walk(fp, out, errors);
    } else if (ent.isFile()) {
      const ext = path.extname(fp).toLowerCase();
      if (!AUDIO_EXT.has(ext)) continue;
      try {
        const st = await fs.promises.stat(fp);
        if (st.size < MIN_SIZE) continue; // 忽略过小的片段
      } catch (e) { /* 忽略 */ }
      out.push(fp);
    }
  }
}

// 扫描：folders 为绝对目录数组。返回 { added, updated, total, errors }
function scan(folders, opts) { return serializeMutation(() => scanUnsafe(folders, opts)); }
async function scanUnsafe(folders, opts) {
  opts = opts || {};
  const lib = loadLib();
  const want = new Set(folders.map((f) => path.resolve(f)));
  // 合并已记录目录
  for (const f of want) if (!lib.folders.includes(f)) lib.folders.push(f);
  const existing = new Map(lib.tracks.map((t) => [t.id, t]));
  const found = new Set();
  const errors = [];
  let added = 0, updated = 0;
  for (const folder of want) {
    const files = [];
    await walk(folder, files, errors);
    for (const fp of files) {
      const id = idFor(fp);
      found.add(id);
      const old = existing.get(id);
      let st;
      try { st = fs.statSync(fp); } catch (e) { st = null; }
      const mtime = st ? st.mtimeMs : 0;
      if (old && old.mtime === mtime && !opts.force) {
        // 未变，保留
        continue;
      }
      const entry = await readMeta(fp);
      existing.set(id, entry);
      if (old) updated++; else added++;
    }
  }
  // 清理已不存在的文件
  if (opts.prune !== false) {
    lib.tracks = [...existing.values()].filter((t) => {
      if (!found.has(t.id)) {
        try { return fs.existsSync(t.path); } catch (e) { return false; }
      }
      return true;
    });
  } else {
    lib.tracks = [...existing.values()];
  }
  saveLib(lib);
  const total = lib.tracks.length;
  return { added, updated, total, errors: errors.slice(0, 10) };
}

function getLibrary(filter) {
  const lib = loadLib();
  const prog = loadProgress();
  const tracks = lib.tracks.map((t) => ({
    ...t, url: '/api/local/stream?id=' + t.id,
    cover: t.coverId ? '/api/local/cover?id=' + t.coverId : '',
    resumeAt: prog[t.id] || 0,
  }));
  if (filter === 'album') {
    const map = Object.create(null);
    tracks.forEach((t) => { (map[t.album] = map[t.album] || []).push(t); });
    return Object.keys(map).sort().map((k) => ({ name: k, tracks: map[k] }));
  }
  if (filter === 'artist') {
    const map = Object.create(null);
    tracks.forEach((t) => { (map[t.artist] = map[t.artist] || []).push(t); });
    return Object.keys(map).sort().map((k) => ({ name: k, tracks: map[k] }));
  }
  if (filter === 'folder') {
    const map = Object.create(null);
    tracks.forEach((t) => {
      const f = path.dirname(t.path);
      (map[f] = map[f] || []).push(t);
    });
    return Object.keys(map).sort().map((k) => ({ name: k, tracks: map[k] }));
  }
  return tracks;
}

function setProgress(id, sec) {
  const p = loadProgress();
  if (sec && sec > 3) p[id] = Math.round(sec);
  else delete p[id];
  saveProgress(p);
}

function updateMeta(id, patch) {
  const lib = loadLib();
  const t = lib.tracks.find((x) => x.id === id);
  if (!t) return null;
  if (patch.name != null) t.name = patch.name;
  if (patch.artist != null) t.artist = patch.artist;
  if (patch.album != null) t.album = patch.album;
  saveLib(lib);
  return t;
}

function removeTrack(id) {
  const lib = loadLib();
  lib.tracks = lib.tracks.filter((t) => t.id !== id);
  saveLib(lib);
  return lib.tracks.length;
}

function findDuplicates() {
  const lib = loadLib();
  const groups = {};
  lib.tracks.forEach((t) => {
    const key = (t.artist + '||' + t.name + '||' + Math.round(t.duration / 5)).toLowerCase();
    (groups[key] = groups[key] || []).push(t);
  });
  return Object.values(groups).filter((g) => g.length > 1).map((g) => ({
    name: g[0].name, artist: g[0].artist, count: g.length,
    tracks: g.map((t) => ({ id: t.id, path: t.path, duration: t.duration })),
  }));
}

function readLrc(p) {
  const base = path.basename(p, path.extname(p));
  const lrc = path.join(path.dirname(p), base + '.lrc');
  try { return fs.readFileSync(lrc, 'utf-8'); } catch (e) { return ''; }
}

// ── 更细的 CUE 解析 ──
// 抓取：全局 REM（GENRE/DATE/DISCID/COMMENT/LABEL）+ CATALOG + 专辑级 TITLE/PERFORMER
//       每轨 TITLE/PERFORMER/SONGWRITER/ISRC/FLAGS + 全部 INDEX（含 00 前导静音段）
// 返回 { meta, tracks }；每轨字段：no,title,performer,songwriter,isrc,flags,indices,start,pre,end,file
function parseCue(cuePath) {
  try {
    const text = fs.readFileSync(cuePath, 'utf-8');
    const dir = path.dirname(cuePath);
    const lines = text.split(/\r?\n/);
    const meta = { albumTitle: '', albumPerformer: '', catalog: '', genre: '', date: 0, discid: '', comment: '', label: '' };
    let file = '';
    let fileFmt = '';
    const tracks = [];
    let cur = null;
    const pushCur = () => { if (cur) tracks.push(cur); };
    const q = (s) => { const m = s.match(/^"([^"]*)"$/); return m ? m[1] : s.trim(); };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) continue;
      let m;
      // FILE
      m = line.match(/^\s*FILE\s+"?([^"]+)"?\s*(WAVE|AIFF|MP3|FLAC|BINARY|MOTOROLA)?/i);
      if (m) { file = m[1]; fileFmt = (m[2] || '').toUpperCase(); continue; }
      // TRACK
      m = line.match(/^\s*TRACK\s+(\d+)\s+(\w+)/i);
      if (m) {
        pushCur();
        cur = { no: parseInt(m[1], 10), type: m[2].toUpperCase(), file, fileFmt, index: 0, pre: 0, title: '', performer: '', songwriter: '', isrc: '', flags: [], indices: {} };
        continue;
      }
      // 全局 REM 字段
      m = line.match(/^\s*REM\s+(\w+)\s+(.*)$/i);
      if (m) {
        const key = m[1].toUpperCase();
        const val = q(m[2]);
        if (key === 'GENRE') meta.genre = val;
        else if (key === 'DATE') meta.date = parseInt(val, 10) || 0;
        else if (key === 'DISCID') meta.discid = val;
        else if (key === 'COMMENT' || key === 'COMMENT[XXX]') meta.comment = val;
        else if (key === 'LABEL') meta.label = val;
        else if (key === 'ISRC' && cur) cur.isrc = val;
        continue;
      }
      // CATALOG
      m = line.match(/^\s*CATALOG\s+"?([\d-]+)"?/i);
      if (m) { meta.catalog = m[1]; continue; }
      if (!cur) {
        // 专辑级 TITLE / PERFORMER（无轨时）
        m = line.match(/^\s*TITLE\s+"?([^"]*)"?/i); if (m) { meta.albumTitle = q(m[1]); continue; }
        m = line.match(/^\s*PERFORMER\s+"?([^"]*)"?/i); if (m) { meta.albumPerformer = q(m[1]); continue; }
        continue;
      }
      // 每轨字段
      m = line.match(/^\s*TITLE\s+"?([^"]*)"?/i); if (m) { cur.title = q(m[1]); continue; }
      m = line.match(/^\s*PERFORMER\s+"?([^"]*)"?/i); if (m) { cur.performer = q(m[1]); continue; }
      m = line.match(/^\s*SONGWRITER\s+"?([^"]*)"?/i); if (m) { cur.songwriter = q(m[1]); continue; }
      m = line.match(/^\s*ISRC\s+"?([\w-]+)"?/i); if (m) { cur.isrc = m[1]; continue; }
      m = line.match(/^\s*FLAGS\s+(.*)$/i); if (m) { cur.flags = m[1].trim().toUpperCase().split(/\s+/).filter(Boolean); continue; }
      m = line.match(/^\s*INDEX\s+(\d+)\s+(\d+):(\d+):(\d+)/i);
      if (m) {
        const num = +m[1];
        const sec = (+m[2]) * 60 + (+m[3]) + (+m[4]) / 75;
        cur.indices[num] = sec;
        if (num === 0) cur.pre = sec;
        else if (num === 1) cur.index = sec;
      }
    }
    pushCur();
    // 确定每轨 start（优先 INDEX 01，否则 00），end = 下一轨 start（或 0 表示到文件尾）
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      t.start = t.index || t.pre || 0;
      t.pregap = t.pre || 0;
      t.hasPregap = t.pre > 0 && t.index > t.pre;
      const next = tracks[i + 1];
      t.end = next ? (next.index || next.pre || 0) : 0;
      t.file = path.resolve(dir, t.file);
      delete t.indices;
    }
    return { meta, tracks };
  } catch (e) { return { meta: {}, tracks: [] }; }
}

function getCues(p) {
  const base = path.basename(p, path.extname(p));
  const cue = path.join(path.dirname(p), base + '.cue');
  if (!fs.existsSync(cue)) return { meta: {}, tracks: [] };
  return parseCue(cue);
}

// 流式播放：支持 Range
function stream(p, req, res) {
  try {
    const stat = fs.statSync(p);
    const total = stat.size;
    const range = req.headers.range;
    const mime = { '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac' }[path.extname(p).toLowerCase()] || 'audio/mpeg';
    const pipe = (opts) => {
      if (req.method === 'HEAD') return res.end();
      const input = fs.createReadStream(p, opts);
      input.on('error', () => res.destroy());
      res.on('close', () => input.destroy());
      input.pipe(res);
    };
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      const invalid = () => { res.writeHead(416, { 'Content-Range': `bytes */${total}` }); return res.end(); };
      if (!m || (!m[1] && !m[2])) return invalid();
      let start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2]));
      let end = m[1] && m[2] ? Number(m[2]) : total - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= total) return invalid();
      end = Math.min(end, total - 1);
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': mime,
        'Cache-Control': 'no-store',
      });
      pipe({ start, end });
    } else {
      res.writeHead(200, {
        'Accept-Ranges': 'bytes',
        'Content-Length': total,
        'Content-Type': mime,
        'Cache-Control': 'no-store',
      });
      pipe();
    }
  } catch (e) {
    if (!res.headersSent) res.writeHead(404);
    res.end('not found');
  }
}

function serveCover(id, res) {
  if (!/^[a-f0-9]{16}$/.test(id || '')) { res.writeHead(400); return res.end('bad cover id'); }
  const fp = path.join(coverDir(), id + '.jpg');
  try {
    const buf = fs.readFileSync(fp);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=604800' });
    res.end(buf);
  } catch (e) {
    res.writeHead(404); res.end('no cover');
  }
}

function folders() { return loadLib().folders; }

// ══════ 智能歌单：按风格（语种 / 曲风 / 无损）自动归类本地媒体库 ══════
const LOSSLESS_FMT = new Set(['FLAC', 'APE', 'DSF', 'DFF', 'WAV', 'WV', 'TTA', 'TAK', 'MPC', 'AIFF']);

function classifyLang(t) {
  const s = (t.artist || '') + ' ' + (t.name || '');
  if (/[가-힣]/.test(s)) return '韩语';
  if (/[ぁ-んァ-ヿ]/.test(s)) return '日语';
  if ((t.genre || '').includes('粤语') || (t.genre || '').toLowerCase().includes('cantonese')) return '粤语';
  if (/[一-鿿]/.test(s)) return '华语';
  return '欧美';
}
function classifyGenre(t) {
  const g = (t.genre || '').toLowerCase();
  const s = (t.name || '').toLowerCase();
  if (/rock|金属|metal/.test(g)) return '摇滚';
  if (/electronic|electro|edm|电音|电子/.test(g)) return '电子';
  if (/classical|古典/.test(g)) return '古典';
  if (/jazz|爵士/.test(g)) return '爵士';
  if (/hip|rap|说唱|嘻哈/.test(g)) return '说唱';
  if (/folk|民谣/.test(g)) return '民谣';
  if (/ambient|new age|instrumental|纯音乐|轻音乐|后摇/.test(g)) return '纯音乐';
  if (/pop|流行/.test(g)) return '流行';
  if (/伴奏|instrumental|inst\.|\(instr|纯音乐/.test(s)) return '纯音乐';
  return '';
}

function smartPlaylists() {
  const lib = loadLib();
  const buckets = {};
  const ensure = (n) => (buckets[n] = buckets[n] || []);
  for (const t of lib.tracks) {
    const g = classifyGenre(t);
    if (g) ensure(g).push(t);
    ensure(classifyLang(t)).push(t);
    if (LOSSLESS_FMT.has((t.format || '').toUpperCase())) ensure('无损母带').push(t);
  }
  const ORDER = ['华语', '欧美', '日语', '韩语', '粤语', '流行', '摇滚', '电子', '古典', '爵士', '说唱', '民谣', '纯音乐', '无损母带'];
  const playlists = ORDER.filter((n) => buckets[n] && buckets[n].length).map((n) => ({
    key: n,
    name: n,
    count: buckets[n].length,
    tracks: buckets[n].map((t) => ({
      id: t.id, name: t.name, artist: t.artist, album: t.album, duration: t.duration,
      cover: t.coverId ? '/api/local/cover?id=' + t.coverId : '',
      url: '/api/local/stream?id=' + t.id, genre: t.genre, year: t.year, format: t.format,
    })),
  }));
  return { playlists };
}

// ══════ 文件夹监控（防抖） ══════
let watchTimer = null;
const watchers = [];
function stopWatch() { clearTimeout(watchTimer); watchTimer = null; watchers.forEach((w) => { try { w.close(); } catch (e) {} }); watchers.length = 0; }
function startWatch(onChange) {
  stopWatch();
  const dirs = folders();
  dirs.forEach((d) => {
    try {
      const w = fs.watch(d, { recursive: true }, () => {
        if (watchTimer) clearTimeout(watchTimer);
        watchTimer = setTimeout(() => {
          scan(dirs, {}).then(() => onChange && onChange()).catch(() => {});
        }, 2500);
      });
      watchers.push(w);
    } catch (e) { /* 不支持递归监控则忽略 */ }
  });
}

module.exports = {
  AUDIO_EXT, scan, addFile, getLibrary, setProgress,
  updateMeta: (...args) => serializeMutation(() => updateMeta(...args)),
  removeTrack: (...args) => serializeMutation(() => removeTrack(...args)),
  findDuplicates, readLrc, getCues, smartPlaylists, stream, serveCover, folders,
  startWatch, stopWatch, dataDir,
};
