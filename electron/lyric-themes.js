/* 桌面歌词主题令牌：歌词窗与独立设置窗共用，避免两套映射漂移。 */
(function (global) {
  'use strict';
  const THEME_MAP = {
    '星云幻彩': 'nebula', '霓虹青': 'cyan', '熔岩橙': 'lava', '极光紫': 'aurora',
    '黑金': 'gold', '水墨': 'ink', '薄荷': 'mint', '纯净白': 'pearl',
    '默认渐变': 'nebula', '纯色·绿': 'mint', '纯色·粉': 'nebula', '纯色·金': 'gold', '纯色·蓝': 'cyan',
  };
  const THEME_NAMES = [
    '星云幻彩', '霓虹青', '熔岩橙', '极光紫', '黑金', '水墨', '薄荷', '纯净白',
  ];
  const THEME_SLUGS = {
    nebula: '#ffb1e1', cyan: '#8ff7e6', lava: '#ffd08a', aurora: '#c9a7ff',
    gold: '#ffe0a3', ink: '#f2efe6', mint: '#b7ffd8', pearl: '#ffffff',
  };
  const COLOR_THEME = { green: '薄荷', pink: '星云幻彩', gold: '黑金', blue: '霓虹青', gradient: '星云幻彩' };
  const FONT_SCALES = { '小': .84, '标准': 1, '大': 1.18, '超大': 1.4 };
  global.LyricThemes = { THEME_MAP, THEME_NAMES, THEME_SLUGS, COLOR_THEME, FONT_SCALES };
})(window);
