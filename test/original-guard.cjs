/* v3.6.0 阶段一：原唱守卫 / 搜索硬剔除 / 歌手去重 的纯逻辑单测 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../server/original-guard');
const { mergeResults, mergeArtists } = require('../server/search-merge');

test('歌手别名与繁简归一到同一个规范名', () => {
  assert.equal(guard.canonical('周杰倫'), '周杰伦');
  assert.equal(guard.canonical('Jay Chou'), '周杰伦');
  assert.equal(guard.canonical('周董'), '周杰伦');
  assert.equal(guard.canonical('陳奕迅'), '陈奕迅');
  assert.equal(guard.canonical('G.E.M.'), '邓紫棋');
});

test('二次创作识别：翻唱标记 / Live / 伴奏 / 原唱标注都不能算原唱', () => {
  assert.equal(guard.isDerivative('晴天', '周杰伦'), false);
  assert.equal(guard.isDerivative('晴天 (原唱 周杰伦)', 'RyaVocal'), true);
  assert.equal(guard.isDerivative('晴天 (Live)', '周杰伦'), true);
  assert.equal(guard.isDerivative('晴天 (DJ版)', '周杰伦'), true);
  assert.equal(guard.isDerivative('晴天 伴奏', '周杰伦'), true);
  assert.equal(guard.isDerivative('晴天', '周杰伦 Cover'), true);
});

test('歌手严格匹配：完全命中 / 合唱 / 近似粉丝号不能冒充', () => {
  assert.equal(guard.artistMatch('周杰伦', '周杰伦'), 3);
  assert.equal(guard.artistMatch('周杰伦/费玉清', '周杰伦'), 3);
  assert.equal(guard.artistMatch('Jay Chou', '周杰伦'), 3);
  assert.equal(guard.artistMatch('周杰伦的粉丝后援会', '周杰伦'), 0);
  assert.equal(guard.artistMatch('林俊杰', '周杰伦'), 0);
});

test('judge：原唱放行，歌手不符 / 二次创作一律拒绝', () => {
  assert.equal(guard.judge({ name: '晴天', artist: '周杰伦' }, '周杰伦').ok, true);
  const wrong = guard.judge({ name: '晴天', artist: '张三' }, '周杰伦');
  assert.equal(wrong.ok, false);
  assert.match(wrong.reason, /歌手不匹配/);
  // 歌手字段里写「XX 翻唱」也要按二次创作直接拦掉
  const singerCover = guard.judge({ name: '晴天', artist: '某翻唱者' }, '周杰伦');
  assert.equal(singerCover.ok, false);
  assert.equal(singerCover.derivative, true);
  const cover = guard.judge({ name: '晴天 (翻唱)', artist: '周杰伦' }, '周杰伦');
  assert.equal(cover.ok, false);
  assert.equal(cover.derivative, true);
  // 无歌手约束时只挡明显二次创作，不误伤正常条目
  assert.equal(guard.judge({ name: '晴天', artist: '周杰伦' }, '').ok, true);
  assert.equal(guard.judge({ name: '晴天 伴奏', artist: '' }, '').ok, false);
});

test('期望歌手推断：弱名（未知 / 网络歌手）不能当强约束', () => {
  assert.equal(guard.expectedArtist({ explicit: '周杰伦', display: '周杰伦' }), '周杰伦');
  assert.equal(guard.expectedArtist({ explicit: '未知', display: '周杰伦' }), '周杰伦');
  assert.equal(guard.expectedArtist({ explicit: '网络歌手', display: '群星' }), '');
});

const GROUPS = [
  { source: 'netease', list: [{ id: '1', name: '晴天', artist: '周杰伦', pic: 'a.jpg', vendor: 'netease' }] },
  { source: 'tencent', list: [{ id: '2', name: '晴天 (原唱 周杰伦)', artist: 'RyaVocal', pic: 'b.jpg', vendor: 'tencent' }] },
  { source: 'kugou', list: [{ id: '3', name: '晴天', artist: '张三', pic: 'c.jpg', vendor: 'kugou' }] },
];

test('搜索硬剔除：指定歌手时只保留真原唱，翻唱/他人版本不进列表', () => {
  const out = mergeResults(GROUPS, { title: '晴天', artist: '周杰伦' }, 20);
  assert.equal(out.length, 1);
  assert.equal(out[0].artist, '周杰伦');
  assert.equal(out[0]._original, true);
});

test('向后兼容：未指定歌手时不硬剔除，避免泛搜索 0 结果', () => {
  const out = mergeResults(GROUPS, { title: '晴天' }, 20);
  assert.equal(out.length, 3);
  assert.equal(out.some((t) => t._original === false), true);
});

test('歌手去重：别名 / 繁简 / 相关歌曲集后缀合并为唯一卡片', () => {
  const rows = [
    { id: 'name:周杰伦', name: '周杰伦', artist: '周杰伦', pic: '', vendor: 'netease' },
    { id: 'name:周杰倫', name: '周杰倫', artist: '周杰倫', pic: '', vendor: 'kugou' },
    { id: 'name:Jay Chou', name: 'Jay Chou', artist: 'Jay Chou', pic: '', vendor: 'tencent' },
    { id: 'artistlist:周杰伦', name: '周杰伦 · 相关歌曲集', artist: '周杰伦', pic: '', vendor: 'gds' },
    { id: 'name:周杰伦♚', name: '周杰伦♚', artist: '周杰伦♚', pic: '', vendor: 'kugou' },
    { id: 'name:周杰伦jay', name: '周杰伦jay', artist: '周杰伦jay', pic: '', vendor: 'tencent' },
    { id: '2080', name: '周杰伦', artist: '周杰伦', pic: 'real.jpg', vendor: 'netease' },
  ];
  const out = mergeArtists(rows, { limit: 20 });
  assert.equal(out.length, 1, '装饰性变体也应并进主名');
  assert.equal(out[0].name, '周杰伦');
  assert.equal(out[0].id, '2080', '真实平台 id 应覆盖 name:/artistlist: 伪 id');
  assert.equal(out[0].pic, 'real.jpg', '有封面的应覆盖白块');
  assert.equal(out[0]._mergedCount, 7);
});

test('歌手去重：不同歌手不会被误合并', () => {
  const rows = [
    { id: '1', name: '周杰伦', artist: '周杰伦', pic: '', vendor: 'netease' },
    { id: '2', name: '林俊杰', artist: '林俊杰', pic: '', vendor: 'netease' },
    { id: '3', name: '周杰倫', artist: '周杰倫', pic: '', vendor: 'kugou' },
  ];
  const out = mergeArtists(rows, { limit: 20 });
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((x) => x.name).sort(), ['周杰伦', '林俊杰']);
});
