/* ============================================================
 * mock.js — 离线自测 provider（不联网，返回结构化示例数据）
 * 用途：在无法访问外网的环境（如受限沙箱）下，验证前后端全链路逻辑。
 *       不影响生产：默认不启用，仅在 MOCK=1 时挂载。
 * ============================================================ */
const SONGS = [
  { id: '181222', name: '晴天', artist: '周杰伦', album: '叶惠美', duration: 269 },
  { id: '186016', name: '七里香', artist: '周杰伦', album: '七里香', duration: 299 },
  { id: '25700841', name: '稻香', artist: '周杰伦', album: '魔杰座', duration: 223 },
  { id: '347230', name: '青花瓷', artist: '周杰伦', album: '我很忙', duration: 239 },
];

// 一个公开可访问的示例音频（仅作占位，验证 url 字段能下发给前端）
const SAMPLE_URL = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';
const SAMPLE_LRC =
  '[00:00.00]（本地自测占位歌词）\n[00:04.00]这是 mock provider 返回的示例数据\n[00:08.00]用于验证前后端全链路逻辑\n[00:12.00]真实环境请改用默认音源\n';

function find(id) {
  return SONGS.find((s) => s.id === String(id)) || SONGS[0];
}

async function search(keyword, type = 'song', page = 1, limit = 20) {
  const kw = (keyword || '').toLowerCase();
  const filtered = SONGS.filter(
    (s) => !kw || s.name.toLowerCase().includes(kw) || s.artist.toLowerCase().includes(kw)
  );
  const list = filtered.slice((page - 1) * limit, page * limit);
  return {
    list: list.map((s) => ({ ...s, pic: '', vendor: 'mock' })),
    total: filtered.length,
  };
}

async function detail(id) {
  const s = find(id);
  return { ...s, pic: '', vendor: 'mock' };
}

async function url(id) {
  return SAMPLE_URL;
}

async function lyric(id) {
  return SAMPLE_LRC;
}

async function song(id) {
  const d = await detail(id);
  return { ...d, vendor: 'mock', url: await url(id), lyric: await lyric(id) };
}

module.exports = { name: 'mock', search, song, url, lyric, detail };
