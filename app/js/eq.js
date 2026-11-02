/* ============================================================
 * eq.js — Web Audio 音效引擎（纯前端，可选增强）
 * 能力：10 段参数均衡器（EQ）、ReplayGain 音量归一化、频谱可视化、
 *      交叉淡入淡出（淡出→切歌→淡入）、输出设备由播放器层通过 setSinkId 处理。
 * 说明：媒体元素源只能创建一次，init(audio) 内部做了幂等保护；
 *       若环境不支持 Web Audio，则自动降级为默认输出，不影响播放。
 * ============================================================ */
(function (global) {
  'use strict';
  const BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const PRESETS = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    pop: [-1, 1, 3, 4, 3, 0, -1, -1, -1, -2],
    rock: [4, 3, 2, 1, -1, -1, 1, 3, 4, 4],
    vocal: [-2, -1, 0, 3, 5, 5, 4, 2, 0, -1],
    bass: [6, 6, 5, 3, 1, 0, 0, 0, 0, 0],
    classical: [0, 0, 0, 0, 0, 0, -1, -1, -2, -3],
  };

  let ctx = null, srcNode = null, filters = [], postGain = null, crossGain = null, analyser = null;
  let compNode = null;      // 音量平衡（动态压缩）
  let spatializer = null;   // 空间音效（ConvolverNode + 生成脉冲响应）
  let fadeGain = null;      // 淡入淡出用的独立增益
  let ready = false, enabled = false, bandVals = BANDS.map(() => 0);
  let fadeMs = 0;           // 淡入淡出时长（0 = 关闭）

  function init(audioEl) {
    if (ready) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      srcNode = ctx.createMediaElementSource(audioEl);
      let node = srcNode;
      filters = BANDS.map((f) => {
        const bp = ctx.createBiquadFilter();
        bp.type = 'peaking';
        bp.frequency.value = f;
        bp.Q.value = 1.0;
        bp.gain.value = 0;
        node.connect(bp);
        node = bp;
        return bp;
      });
      postGain = ctx.createGain(); postGain.gain.value = 1; node.connect(postGain);
      // 音量平衡：动态压缩器，压掉过 peaks、抬升安静段
      compNode = ctx.createDynamicsCompressor();
      postGain.connect(compNode);
      // 淡入淡出增益（默认 1）
      fadeGain = ctx.createGain(); fadeGain.gain.value = 1;
      crossGain = ctx.createGain(); crossGain.gain.value = 1;
      compNode.connect(fadeGain);
      fadeGain.connect(crossGain);
      analyser = ctx.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.8;
      crossGain.connect(analyser); analyser.connect(ctx.destination);
      ready = true;
    } catch (e) {
      ready = false;
    }
    return ready;
  }

  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }

  function applyGains() {
    filters.forEach((f, i) => { f.gain.value = enabled ? bandVals[i] : 0; });
  }
  function setEnabled(on) { enabled = !!on; applyGains(); }
  function setBand(i, db) {
    if (i < 0 || i >= BANDS.length) return;
    bandVals[i] = db;
    if (enabled && filters[i]) filters[i].gain.value = db;
  }
  function setPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    bandVals = p.slice();
    applyGains();
  }
  function setRG(db) {
    if (!postGain) return;
    const g = (db && Math.abs(db) > 0.05) ? Math.pow(10, db / 20) : 1;
    postGain.gain.setTargetAtTime(g, ctx ? ctx.currentTime : 0, 0.05);
  }
  function getAnalyser() { return analyser; }
  function isReady() { return ready; }

  // ── 音量平衡（真实接入动态压缩器） ──
  function setNormalize(on) {
    if (!compNode || !fadeGain) return;
    // 关闭时把压缩器参数恢复为「透明」
    compNode.threshold.value = on ? -28 : 0;
    compNode.knee.value = on ? 12 : 0;
    compNode.ratio.value = on ? 6 : 1;
    compNode.attack.value = 0.004;
    compNode.release.value = on ? 0.25 : 0;
  }
  // 微调节音量平衡强度（0~100 → ratio 1~12）
  function setNormalizeStrength(v) {
    if (!compNode) return;
    const k = Math.max(0, Math.min(100, Number(v) || 0)) / 100;
    compNode.threshold.value = -6 - k * 34;
    compNode.ratio.value = 1 + k * 11;
    compNode.knee.value = 4 + k * 16;
  }

  // ── 空间音效（真实接入 ConvolverNode，用合成脉冲响应模拟房间） ──
  function makeIR(seconds, decay) {
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }
  let spatNode = null;
  function setSpatial(on, sizePct) {
    if (!ready || !fadeGain || !ctx) return;
    // 移除旧节点
    if (spatNode) {
      try { fadeGain.disconnect(spatNode); } catch (e) { /* 忽略 */ }
      try { spatNode.disconnect(); } catch (e) { /* 忽略 */ }
      spatNode = null;
    }
    if (!on) {
      fadeGain.connect(crossGain);
      return;
    }
    const p = Math.max(0, Math.min(100, Number(sizePct) || 30)) / 100;
    const sec = 0.35 + p * 1.8;          // 0.35s ~ 2.15s
    const decay = 2.2 + (1 - p) * 2.6;
    spatNode = ctx.createConvolver();
    spatNode.buffer = makeIR(sec, decay);
    try { fadeGain.disconnect(crossGain); } catch (e) { /* 忽略 */ }
    fadeGain.connect(spatNode);
    spatNode.connect(crossGain);
  }

  // ── 淡入淡出（真实作用在播放音量上） ──
  function setFade(ms) { fadeMs = Math.max(0, Number(ms) || 0); }
  function getFade() { return fadeMs; }
  // 播放开始时淡入（0.001 → 1）
  function fadeIn() {
    if (!fadeGain || !ctx || fadeMs <= 0) return;
    const t = ctx.currentTime;
    const s = fadeMs / 1000;
    fadeGain.gain.cancelScheduledValues(t);
    fadeGain.gain.setValueAtTime(0.001, t);
    fadeGain.gain.linearRampToValueAtTime(1, t + s);
  }
  // 暂停时淡出到 0（真静音，不是只暂停）
  function fadeOut() {
    if (!fadeGain || !ctx || fadeMs <= 0) return;
    const t = ctx.currentTime;
    const s = fadeMs / 1000;
    fadeGain.gain.cancelScheduledValues(t);
    fadeGain.gain.setValueAtTime(fadeGain.gain.value, t);
    fadeGain.gain.linearRampToValueAtTime(0.001, t + s);
  }
  function fadeReset() {
    if (!fadeGain || !ctx) return;
    try { fadeGain.gain.cancelScheduledValues(ctx.currentTime); fadeGain.gain.value = 1; }
    catch (e) { /* 忽略 */ }
  }

  // 交叉淡入淡出：淡出当前 → 回调（切歌）→ 淡入
  function crossfadeTo(seconds, cb) {
    if (!ready || !crossGain || seconds <= 0) { cb && cb(); return; }
    const now = ctx.currentTime;
    crossGain.gain.cancelScheduledValues(now);
    crossGain.gain.setValueAtTime(crossGain.gain.value, now);
    crossGain.gain.linearRampToValueAtTime(0.0001, now + seconds);
    setTimeout(() => {
      cb && cb();
      // 下一首开始播放后由调用方淡入；这里先复位
      const t2 = ctx.currentTime;
      crossGain.gain.cancelScheduledValues(t2);
      crossGain.gain.setValueAtTime(0.0001, t2);
      crossGain.gain.linearRampToValueAtTime(1, t2 + seconds);
    }, seconds * 1000 + 30);
  }

  global.Eq = {
    init, resume, setEnabled, setBand, setPreset, setRG, getAnalyser, isReady, BANDS, PRESETS, crossfadeTo,
    // 新增：真实生效的音频能力
    setNormalize, setNormalizeStrength, setSpatial, setFade, getFade, fadeIn, fadeOut, fadeReset,
  };
})(window);
