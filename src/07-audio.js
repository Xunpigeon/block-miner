/* 07-audio.js — WebAudio 实时合成音效（零音频文件，零外部请求） */
(function () {
  'use strict';
  var BM = window.BM = window.BM || {};
  var EMPTY = {};
  var SOUNDS = {};

  var ctx = null;
  var master = null;
  var noiseBuf = null;
  var muted = false;
  var started = false;
  var busBound = false;
  var combo = 0;
  var lastAt = {};
  var drillNodes = null;
  var drillTimer = 0;
  var lastAbsorbAt = -1;
  var lastLaserAt = -1;
  var layerStamps = [];          // 最近 1 秒内的碎层时间戳（连击亮尾音的判据）
  var LAYER_WINDOW = 1;          // 窗口：1 秒
  var LAYER_CHAIN_AT = 3;        // 1 秒内碎层 >= 3 就叠一层亮尾音
  var CHAIN_BOOM_AT = 3;         // v9b：同屏 TNT >= 3 颗 → 叠一层「连环」尾音

  /* 同名音效的最小间隔（秒），防止密集事件堆出上百个节点 */
  var THROTTLE = {
    hit: 0.022, break: 0.028, absorb: 0.026, explode: 0.05,
    coin: 0.05, buy: 0.05, unlock: 0.08, ui: 0.04,
    frenzy: 0.2, roundStart: 0.25, roundEnd: 0.25,
    stoneHit: 0.024, ironHit: 0.03, layerBreak: 0.02,
    tntFuse: 0.25, tntBoom: 0.09, tntChain: 0.12, emptied: 0.05,
    laserTick: 0.05, quakeBlast: 0.12, luckyTNT: 0.2,
    execute: 0.05, layerBright: 0.06
  };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function numOr(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

  /* 事件里的 x 是棋盘像素坐标：映射到 -0.6 ~ 0.6 的声像（不依赖任何外部状态） */
  function panOfX(x) {
    var b = BM.BOARD;
    if (!b || typeof x !== 'number' || !b.w) return 0;
    return clamp((x - b.x) / b.w - 0.5, -0.5, 0.5) * 1.2;
  }
  function tnow() { return ctx ? ctx.currentTime : 0; }

  /* 每个音的出口：声像 → 总线 */
  function voice(pan) {
    var g = ctx.createGain();
    g.gain.value = 1;
    if (pan && ctx.createStereoPanner) {
      var p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      g.connect(p);
      p.connect(master);
    } else {
      g.connect(master);
    }
    return g;
  }

  function noise() {
    var s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    return s;
  }

  function env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function tone(dst, type, f0, f1, t, peak, attack, decay) {
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + attack + decay);
    env(g, t, peak, attack, decay);
    osc.connect(g);
    g.connect(dst);
    osc.start(t);
    osc.stop(t + attack + decay + 0.03);
    return osc;
  }

  /* ---------- 各音效 ---------- */

  SOUNDS.hit = function (o) {
    var t = tnow();
    var semis = clamp(combo + (o.combo || 0), 0, 7);           // 契约 §4.7：上限 +7 半音
    var p = Math.pow(2, semis / 12) * (o.pitch || 1);
    var dst = voice(o.pan);
    dst.gain.value = 0.5 * (o.gain || 1);
    var n = noise();
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1150 * p;
    bp.Q.value = 1.5;
    var g = ctx.createGain();
    env(g, t, 0.9, 0.004, 0.07);
    n.connect(bp); bp.connect(g); g.connect(dst);
    n.start(t); n.stop(t + 0.13);
    tone(dst, 'triangle', 250 * p, 110 * p, t, 0.26, 0.004, 0.07);
  };

  SOUNDS.break = function (o) {
    var t = tnow();
    var p = o.pitch || 1;
    var dst = voice(o.pan);
    dst.gain.value = 0.5 * (o.gain || 1);
    var n = noise();
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400 * p, t);
    lp.frequency.exponentialRampToValueAtTime(280 * p, t + 0.2);
    lp.Q.value = 1.1;
    var g = ctx.createGain();
    env(g, t, 0.85, 0.005, 0.24);
    n.connect(lp); lp.connect(g); g.connect(dst);
    n.start(t); n.stop(t + 0.32);
    tone(dst, 'sine', 190 * p, 55, t, 0.34, 0.005, 0.13);
  };

  SOUNDS.explode = function (o) {
    var t = tnow();
    var dst = voice(0);
    dst.gain.value = 0.55 * clamp(o.gain || 1, 0.3, 1.6);
    var n = noise();
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + 0.5);
    var g = ctx.createGain();
    env(g, t, 1, 0.01, 0.55);
    n.connect(lp); lp.connect(g); g.connect(dst);
    n.start(t); n.stop(t + 0.6);
    /* 低频下扫 */
    tone(dst, 'sine', 150, 32, t, 0.55, 0.01, 0.5);
    /* 立体声扩散：左右各一层快速衰减噪声 */
    for (var i = 0; i < 2; i++) {
      var side = voice(i === 0 ? -0.85 : 0.85);
      side.gain.value = 0.26;
      var nn = noise();
      var hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 700 + i * 400;
      var gg = ctx.createGain();
      env(gg, t + 0.01 * i, 0.8, 0.006, 0.22);
      nn.connect(hp); hp.connect(gg); gg.connect(side);
      nn.start(t); nn.stop(t + 0.3);
    }
  };

  /* 石头：钝响 —— 低通噪声 + 快速下滑的三角波 */
  SOUNDS.stoneHit = function (o) {
    var t = tnow();
    var p = (o.pitch || 1) * (1 + Math.min(combo, 7) * 0.02);
    var dst = voice(o.pan);
    dst.gain.value = 0.5 * (o.gain || 1);
    var n = noise();
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1500 * p, t);
    lp.frequency.exponentialRampToValueAtTime(420 * p, t + 0.09);
    lp.Q.value = 0.9;
    var g = ctx.createGain();
    env(g, t, 0.85, 0.003, 0.1);
    n.connect(lp); lp.connect(g); g.connect(dst);
    n.start(t); n.stop(t + 0.16);
    tone(dst, 'triangle', 195 * p, 92, t, 0.26, 0.003, 0.09);
  };

  /* 铁矿：金属「当」—— 低 Q 带通噪声 + 中低频的钝金属泛音。
     v7：旧版 1560/2340Hz 正弦泛音且音高随连击上升，第二关连按时像鸟叫（玩家反馈）。
     现在泛音压到 520/780Hz、短促衰减，音高只随连击轻微上浮（最多 +6%），保留打铁的质感。 */
  SOUNDS.ironHit = function (o) {
    var t = tnow();
    var p = (o.pitch || 1) * (1 + Math.min(combo, 6) * 0.01);
    var dst = voice(o.pan);
    dst.gain.value = 0.42 * (o.gain || 1);
    var n = noise();
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400 * p;
    bp.Q.value = 1.6;
    var g = ctx.createGain();
    env(g, t, 0.8, 0.002, 0.07);
    n.connect(bp); bp.connect(g); g.connect(dst);
    n.start(t); n.stop(t + 0.12);
    tone(dst, 'triangle', 520 * p, 470 * p, t, 0.16, 0.002, 0.06);
    tone(dst, 'sine', 780 * p, 700 * p, t, 0.07, 0.002, 0.04);
    tone(dst, 'triangle', 210 * p, 120, t, 0.26, 0.002, 0.08);
  };

  /* 打穿一层：短促的上顶音 + 一点碎屑 */
  SOUNDS.layerBreak = function (o) {
    // v7b：原来是 330Hz 起、向上滑到 693/1056Hz 的三层上扫泛音，连按时像鸟叫（玩家反馈）。
    // 现在与第一关 stoneHit 同色：低通噪声 + 低频三角波，只做“闷响”，不带任何上扫。
    var t = tnow();
    var dst = voice(o.pan || 0);
    dst.gain.value = 0.3 * (o.gain || 1);
    var p = o.pitch || 1;
    var nz = noise();
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1300 * p, t);
    lp.frequency.exponentialRampToValueAtTime(380 * p, t + 0.09);
    lp.Q.value = 0.8;
    var g = ctx.createGain();
    env(g, t, 0.7, 0.003, 0.09);
    nz.connect(lp); lp.connect(g); g.connect(dst);
    nz.start(t); nz.stop(t + 0.15);
    tone(dst, 'triangle', 180 * p, 86, t, 0.3, 0.003, 0.08);
  };

  /* 引信：高频嘶嘶，抖动衰减 */
  SOUNDS.tntFuse = function (o) {
    var t = tnow();
    var dst = voice(0);
    dst.gain.value = 0.3 * (o.gain || 1);
    var n = noise();
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3200;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 5200;
    bp.Q.value = 1.2;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
    for (var k = 0; k < 6; k++) g.gain.setValueAtTime(k % 2 ? 0.42 : 0.16, t + 0.1 + k * 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.52);
    n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(dst);
    n.start(t); n.stop(t + 0.56);
  };

  /* 爆炸：低频冲击 + 长下扫 + 立体声扩散 */
  SOUNDS.tntBoom = function (o) {
    var t = tnow();
    var dst = voice(0);
    dst.gain.value = 0.62 * clamp(o.gain || 1, 0.4, 1.6);
    var n = noise();
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1600, t);
    lp.frequency.exponentialRampToValueAtTime(70, t + 0.75);
    var g = ctx.createGain();
    env(g, t, 1, 0.008, 0.8);
    n.connect(lp); lp.connect(g); g.connect(dst);
    n.start(t); n.stop(t + 0.9);
    tone(dst, 'sine', 110, 26, t, 0.6, 0.008, 0.75);
    tone(dst, 'sine', 210, 48, t + 0.01, 0.3, 0.01, 0.4);
    for (var i = 0; i < 2; i++) {
      var side = voice(i === 0 ? -0.9 : 0.9);
      side.gain.value = 0.22;
      var nn = noise();
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900 + i * 700;
      bp.Q.value = 0.8;
      var gg = ctx.createGain();
      env(gg, t + 0.012 * i, 0.8, 0.006, 0.3);
      nn.connect(bp); bp.connect(gg); gg.connect(side);
      nn.start(t); nn.stop(t + 0.36);
    }
  };

  /* 连环炸（v9b）：同屏 TNT >= 3 颗时叠的尾音 —— 按数量串起一串越来越高的爆点，
     尾端一段下滑噪声收束，听感上把「A 炸 → 掉 B → B 炸」连成一条。 */
  SOUNDS.tntChain = function (o) {
    var t = tnow();
    var dst = voice(0);
    dst.gain.value = 0.3 * clamp(o.gain || 1, 0.4, 1.4);
    var n = clamp(Math.round(numOr(o.count, 3)), 1, 6);
    for (var i = 0; i < n; i++) {
      var f = 150 * Math.pow(1.18, i);
      tone(dst, 'square', f, f * 0.5, t + i * 0.055, 0.2, 0.004, 0.16);
      tone(dst, 'sine', f * 0.5, 0, t + i * 0.055, 0.18, 0.006, 0.22);
    }
    var tailT = t + n * 0.055;
    var nn = noise();
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1200, tailT);
    lp.frequency.exponentialRampToValueAtTime(120, tailT + 0.45);
    var g = ctx.createGain();
    env(g, tailT, 0.7, 0.006, 0.45);
    nn.connect(lp); lp.connect(g); g.connect(dst);
    nn.start(tailT); nn.stop(tailT + 0.5);
  };

  /* 坑洞见底：闷响 */
  SOUNDS.emptied = function (o) {
    var t = tnow();
    var dst = voice(o.pan || 0);
    dst.gain.value = 0.34 * (o.gain || 1);
    var n = noise();
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(620, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + 0.24);
    var g = ctx.createGain();
    env(g, t, 0.75, 0.008, 0.24);
    n.connect(lp); lp.connect(g); g.connect(dst);
    n.start(t); n.stop(t + 0.3);
    tone(dst, 'sine', 132, 52, t, 0.3, 0.008, 0.22);
  };

  /* 激光每 tick：细高频脉冲；连续 tick（0.05s 内）压低，避免糊成噪音 */
  /* v17：连续升级音 —— 低频木质感「哒」，音高随连击微升，绝不刺耳 */
  SOUNDS.upgradeTick = function (o) {
    var t = tnow();
    var dst = voice(o.pan || 0);
    var k = Math.min(12, numOr(o.streak, 0));
    dst.gain.value = 0.1 * (o.gain || 1);
    var f = 300 + k * 12;
    tone(dst, 'triangle', f, f * 0.86, t, 0.3, 0.003, 0.05);
    tone(dst, 'sine', f * 2, f * 1.8, t, 0.05, 0.003, 0.04);
  };
  SOUNDS.laserTick = function (o) {
    // v7c：原来是 2400–2900Hz 方波 + 1.7kHz 高通，0.15 秒一次，玩家反馈刺耳。
    // 改成柔和低频「嗡」+ 一层细碎噪声，只保留“持续在切”的质感，不刺耳。
    var t = tnow();
    var dense = lastLaserAt >= 0 && (t - lastLaserAt) < 0.05;
    lastLaserAt = t;
    var dst = voice(o.pan || 0);
    dst.gain.value = 0.13 * (dense ? 0.45 : 1) * (o.gain || 1);
    var p = o.pitch || 1;
    var h = clamp(numOr(o.h, 1), 1, 12) * 0.004;
    // 主体：中低频三角波，缓慢下沉
    var f0 = 460 + Math.random() * 60;
    tone(dst, 'triangle', f0 * p, f0 * 0.72 * p, t, 0.22, 0.004, 0.06 + h);
    // 一层很轻的正弦泛音（增加“金属被切开”的质感，但不刺耳）
    tone(dst, 'sine', f0 * 2.4 * p, f0 * 1.9 * p, t, 0.06, 0.004, 0.05 + h);
    // 细碎噪声：带通 1100Hz、低 Q，模拟切屑
    var nz = noise();
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100 * p;
    bp.Q.value = 0.8;
    var g = ctx.createGain();
    env(g, t, 0.5, 0.002, 0.05 + h);
    nz.connect(bp); bp.connect(g); g.connect(dst);
    nz.start(t); nz.stop(t + 0.09 + h);
  };

  /* 震荡器：低频冲击 + 长尾余震 */
  SOUNDS.quakeBlast = function (o) {
    var t = tnow();
    var dst = voice(0);
    dst.gain.value = 0.66 * clamp(o.gain || 1, 0.4, 1.6);
    var n = noise();
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(760, t);
    lp.frequency.exponentialRampToValueAtTime(48, t + 0.9);
    var g = ctx.createGain();
    env(g, t, 1, 0.012, 1);
    n.connect(lp); lp.connect(g); g.connect(dst);
    n.start(t); n.stop(t + 1.1);
    tone(dst, 'sine', 98, 24, t, 0.72, 0.01, 0.95);
    tone(dst, 'triangle', 330, 44, t + 0.02, 0.26, 0.01, 0.32);
    /* 长尾：只留低频噪声慢慢塌下去 */
    var tail = voice(0);
    tail.gain.value = 0.2;
    var tn = noise();
    var tp = ctx.createBiquadFilter();
    tp.type = 'lowpass';
    tp.frequency.value = 190;
    var tg = ctx.createGain();
    env(tg, t + 0.07, 0.55, 0.1, 1.15);
    tn.connect(tp); tp.connect(tg); tg.connect(tail);
    tn.start(t); tn.stop(t + 1.3);
  };

  /* 幸运 TNT：俏皮上行三连音 + 金色高音余韵 */
  SOUNDS.luckyTNT = function (o) {
    var t = tnow();
    var dst = voice(o.pan || 0);
    dst.gain.value = 0.3 * (o.gain || 1);
    var p = o.pitch || 1;
    var steps = [523.25, 659.25, 783.99, 1046.5];
    for (var i = 0; i < 3; i++) {
      tone(dst, 'triangle', steps[i] * p, 0, t + i * 0.055, 0.55, 0.004, 0.12);
      tone(dst, 'square', steps[i] * 2 * p, 0, t + i * 0.055, 0.1, 0.004, 0.06);
    }
    tone(dst, 'sine', steps[3] * p, 0, t + 0.17, 0.46, 0.004, 0.5);
    tone(dst, 'sine', steps[3] * 1.5 * p, 0, t + 0.17, 0.16, 0.004, 0.42);
  };

  /* 处决（v9）：短促高频锐音 + 一层上滑尾音，与普通命中 / 破层明确区分 */
  SOUNDS.execute = function (o) {
    var t = tnow();
    var dst = voice(o.pan || 0);
    dst.gain.value = 0.34 * (o.gain || 1);
    var n = noise();
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(4300, t);
    bp.frequency.exponentialRampToValueAtTime(7200, t + 0.04);
    bp.Q.value = 3.2;
    var g = ctx.createGain();
    env(g, t, 0.95, 0.002, 0.05);
    n.connect(bp); bp.connect(g); g.connect(dst);
    n.start(t); n.stop(t + 0.09);
    tone(dst, 'square', 1760, 2640, t, 0.22, 0.002, 0.035);
    /* 尾音：高频三角波缓慢下滑，落一刀的余韵 */
    tone(dst, 'triangle', 3120, 1560, t + 0.03, 0.16, 0.004, 0.16);
  };

  /* 连击碎层（v9）：1 秒内碎层 >= 3 时叠的一层更亮的尾音（连击越高越亮） */
  SOUNDS.layerBright = function (o) {
    // v10b：原来是 2.6–4.2kHz 上滑三角波，玩家反馈像鸟叫，改成低频「闷响」尾音
    var t = tnow();
    var dst = voice(o.pan || 0);
    dst.gain.value = 0.14 * (o.gain || 1);
    var n = noise();
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    var bright = 760 + Math.min(6, numOr(o.streak, 0)) * 70;   // 连击越高越亮（760–1180Hz，低频不刺耳）
    lp.frequency.setValueAtTime(bright, t);
    lp.frequency.exponentialRampToValueAtTime(bright * 0.32, t + 0.12);
    lp.Q.value = 0.7;
    var g = ctx.createGain();
    env(g, t, 0.7, 0.004, 0.13);
    n.connect(lp); lp.connect(g); g.connect(dst);
    n.start(t); n.stop(t + 0.18);
    tone(dst, 'sine', 120, 78, t, 0.5, 0.004, 0.12);
  };

  SOUNDS.absorb = function (o) {
    var t = tnow();
    var dense = lastAbsorbAt >= 0 && (t - lastAbsorbAt) < 0.055;
    lastAbsorbAt = t;
    var dst = voice(o.pan || 0);
    dst.gain.value = 0.22 * (dense ? 0.45 : 1) * (o.gain || 1);
    // v7：旧版 1.5–2kHz 方波上滑到 ×1.9，密集入包时一串「啾啾」像鸟叫。改成低频软「啵」，不上滑
    var f = 420 + Math.random() * 80;
    tone(dst, 'triangle', f, f * 0.8, t, 0.45, 0.003, 0.05);
  };

  SOUNDS.coin = function (o) {
    var t = tnow();
    var dst = voice(o.pan || 0);
    dst.gain.value = 0.3 * (o.gain || 1);
    tone(dst, 'triangle', 880 * (o.pitch || 1), 0, t, 0.5, 0.004, 0.09);
    tone(dst, 'triangle', 1320 * (o.pitch || 1), 0, t + 0.07, 0.45, 0.004, 0.13);
  };

  SOUNDS.buy = function (o) {
    var t = tnow();
    var dst = voice(o.pan || 0);
    dst.gain.value = 0.26 * (o.gain || 1);
    var f = 520 * (o.pitch || 1);
    tone(dst, 'triangle', f, 0, t, 0.5, 0.004, 0.09);
    tone(dst, 'triangle', f * 1.26, 0, t + 0.06, 0.5, 0.004, 0.09);
    tone(dst, 'triangle', f * 1.5, 0, t + 0.12, 0.45, 0.004, 0.16);
  };

  SOUNDS.unlock = function (o) {
    var t = tnow();
    var dst = voice(o.pan || 0);
    dst.gain.value = 0.28 * (o.gain || 1);
    var f = 740 * (o.pitch || 1);
    tone(dst, 'sawtooth', f, 0, t, 0.3, 0.006, 0.12);
    tone(dst, 'sawtooth', f * 1.26, 0, t + 0.09, 0.3, 0.006, 0.12);
    tone(dst, 'triangle', f * 2, 0, t + 0.18, 0.34, 0.006, 0.34);
    tone(dst, 'sine', f * 3, 0, t + 0.18, 0.14, 0.006, 0.4);
  };

  SOUNDS.frenzy = function (o) {
    var t = tnow();
    var dst = voice(o.pan || 0);
    dst.gain.value = 0.26 * (o.gain || 1);
    var osc = ctx.createOscillator();
    var bp = ctx.createBiquadFilter();
    var g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(1300, t + 0.45);
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.45);
    bp.Q.value = 2.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(bp); bp.connect(g); g.connect(dst);
    osc.start(t); osc.stop(t + 0.55);
  };

  SOUNDS.ui = function (o) {
    var t = tnow();
    var dst = voice(o.pan || 0);
    dst.gain.value = 0.16 * (o.gain || 1);
    var n = noise();
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2200;
    var g = ctx.createGain();
    env(g, t, 0.8, 0.002, 0.018);
    n.connect(hp); hp.connect(g); g.connect(dst);
    n.start(t); n.stop(t + 0.04);
  };

  SOUNDS.roundStart = function (o) {
    var t = tnow();
    var dst = voice(o.pan || 0);
    dst.gain.value = 0.26 * (o.gain || 1);
    tone(dst, 'triangle', 440, 0, t, 0.5, 0.005, 0.1);
    tone(dst, 'triangle', 660, 0, t + 0.11, 0.5, 0.005, 0.18);
  };

  SOUNDS.roundEnd = function (o) {
    var t = tnow();
    var dst = voice(o.pan || 0);
    dst.gain.value = 0.3 * (o.gain || 1);
    var root = 392;
    var chord = [1, 1.26, 1.5, 2];
    for (var i = 0; i < chord.length; i++) {
      tone(dst, i === 0 ? 'triangle' : 'sine', root * chord[i], 0, t + i * 0.02, 0.34, 0.02, 0.85);
    }
    tone(dst, 'sine', 98, 0, t, 0.24, 0.02, 0.7);
  };

  SOUNDS.drill = function (o) {
    if (o.on === false) { drillStop(); return; }
    if (!drillNodes) drillStart(o);
    clearTimeout(drillTimer);
    drillTimer = setTimeout(drillStop, 320);   // 事件流停止后自动收尾
  };

  function drillStart(o) {
    var t = tnow();
    var dst = voice(o.pan || 0);
    dst.gain.setValueAtTime(0.0001, t);
    dst.gain.linearRampToValueAtTime(0.2 * (o.gain || 1), t + 0.05);
    var a = ctx.createOscillator();
    var b = ctx.createOscillator();
    var lp = ctx.createBiquadFilter();
    a.type = 'square';
    a.frequency.value = 72;
    b.type = 'square';
    b.frequency.value = 109;
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 0.7;
    a.connect(lp); b.connect(lp); lp.connect(dst);
    var n = noise();
    var nf = ctx.createBiquadFilter();
    var ng = ctx.createGain();
    nf.type = 'bandpass';
    nf.frequency.value = 1700;
    nf.Q.value = 0.8;
    ng.gain.value = 0.34;
    n.connect(nf); nf.connect(ng); ng.connect(dst);
    a.start(t); b.start(t); n.start(t);
    drillNodes = { dst: dst, list: [a, b, n] };
  }

  function drillStop() {
    clearTimeout(drillTimer);
    drillTimer = 0;
    if (!drillNodes) return;
    var d = drillNodes;
    drillNodes = null;
    var t = tnow();
    try {
      d.dst.gain.cancelScheduledValues(t);
      d.dst.gain.setValueAtTime(Math.max(0.0001, d.dst.gain.value), t);
      d.dst.gain.linearRampToValueAtTime(0.0001, t + 0.09);
    } catch (e) { /* 节点已失效则忽略 */ }
    for (var i = 0; i < d.list.length; i++) {
      try { d.list[i].stop(t + 0.12); } catch (e) { /* 已停止 */ }
    }
  }

  /* ---------- 生命周期 ---------- */

  function makeNoise() {
    var len = Math.floor(ctx.sampleRate * 1);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function init() {
    if (started) return true;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      if (typeof ctx.createGain !== 'function') { ctx = null; return false; }
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 14;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      master = ctx.createGain();
      master.gain.value = muted ? 0.0001 : 0.85;
      master.connect(comp);
      comp.connect(ctx.destination);
      noiseBuf = makeNoise();
      started = true;
    } catch (e) {
      ctx = null;
      master = null;
      noiseBuf = null;
      started = false;
      return false;
    }
    poke();
    bindBus();
    return true;
  }

  function poke() {
    try {
      if (ctx && ctx.state === 'suspended' && ctx.resume) ctx.resume();
    } catch (e) { /* 用户未授权则保持静默 */ }
  }

  function play(name, opts) {
    if (!ctx || muted || !name) return;
    var fn = SOUNDS[name];
    if (!fn) return;
    var o = opts || EMPTY;
    var gap = THROTTLE[name] || 0;
    if (gap) {
      var t = tnow();
      if (lastAt[name] !== undefined && t - lastAt[name] < gap) return;
      lastAt[name] = t;
    }
    poke();
    try {
      fn(o);
    } catch (e) { /* 合成失败不能影响游戏 */ }
  }

  function setMuted(v) {
    muted = !!v;
    if (master) {
      try { master.gain.value = muted ? 0.0001 : 0.85; } catch (e) { /* 忽略 */ }
    }
    if (muted) drillStop();
    try {
      if (BM.CORE && BM.CORE.state) {
        BM.CORE.state.muted = muted;
        if (BM.CORE.save) BM.CORE.save();
      }
    } catch (e) { /* 存档失败不影响声音开关 */ }
    return muted;
  }

  /* 碎层计数：只留最近 1 秒的时间戳，返回窗口内的碎层数 */
  function stampLayer() {
    var t = tnow();
    layerStamps.push(t);
    var cut = t - LAYER_WINDOW;
    while (layerStamps.length && layerStamps[0] < cut) layerStamps.shift();
    return layerStamps.length;
  }

  function bindBus() {
    if (busBound) return;
    var bus = BM.bus;
    if (!bus || !bus.on) return;
    busBound = true;

    bus.on('block:hit', function (d) {
      if (!d) return;
      var ore = (d.block && d.block.ore) || d.ore || '';
      play(ore === 'iron' ? 'ironHit' : 'stoneHit', { pan: Math.sin(d.dir || 0) * 0.35 });
    });
    bus.on('block:layer', function (d) {
      play('layerBreak', { gain: 1 + Math.min(4, (d && d.depth) || 0) * 0.05 });
      /* 连续碎层：1 秒内 >= 3 层就叠一层更亮的尾音，做出「连击」听感 */
      if (stampLayer() >= LAYER_CHAIN_AT) play('layerBright', { streak: layerStamps.length });
    });
    bus.on('block:break', function (d) {
      if (!d) return;
      play('break', { pitch: 1 + Math.min(d.chain || 0, 5) * 0.06, gain: d.rich ? 1.15 : 1 });
      if (stampLayer() >= LAYER_CHAIN_AT) play('layerBright', { streak: layerStamps.length, gain: 0.9 });
    });
    bus.on('tool:execute', function (d) {
      play('execute', { pan: panOfX(d ? d.x : null), gain: 1 });
    });
    bus.on('block:empty', function (d) {
      play('emptied', { pan: d && d.pan ? d.pan : 0 });
    });
    bus.on('tnt:fuse', function () { play('tntFuse'); });
    bus.on('explosion', function (d) {
      var power = (d && d.power) || 0.2;
      var cells = (d && d.cells) || 1;
      /* 04-tools 对连锁破格与 TNT 都派发 explosion：只有 TNT（power>=1 / cells>=4）用长爆炸音 */
      if (power >= 1 || cells >= 4) {
        play('tntBoom', { gain: 0.85 + Math.min(0.55, power) });
        /* v9b 连环：同屏 TNT >= 3 颗再叠一层「连环」尾音（数量越多越亮） */
        var chain = numOr(d && d.tntCount, 1);
        if (chain >= CHAIN_BOOM_AT) play('tntChain', { count: chain, gain: 0.7 + Math.min(0.5, chain * 0.05) });
      } else play('explode', { gain: 0.8 + Math.min(0.6, power) });
    });
    bus.on('drop:absorb', function () { play('absorb'); });
    bus.on('frenzy:start', function () { play('frenzy'); });
    bus.on('round:start', function () { combo = 0; layerStamps.length = 0; drillStop(); play('roundStart'); });
    bus.on('round:end', function () { drillStop(); play('roundEnd'); });
    bus.on('combo:update', function (d) { if (d) combo = d.combo || 0; });
    bus.on('tool:swing', function (d) { if (d && d.tool === 'drill') play('drill', { on: true }); });
    /* v3 三种武器的独立音色：激光细脉冲 / 震荡器低频冲击 / 幸运 TNT 上行三连音 */
    bus.on('laser:tick', function (d) {
      play('laserTick', { pan: panOfX(d ? d.x : null), h: d ? d.h : 1 });
    });
    bus.on('quake:blast', function (d) {
      play('quakeBlast', { gain: 1 + Math.min(0.4, numOr(d && d.cells, 0) / 120) });
    });
    bus.on('lucky:tnt', function () { play('luckyTNT'); });
  }

  var API = {
    init: init,
    play: play,
    setMuted: setMuted,
    toggle: function () { return setMuted(!muted); },
    stopAll: drillStop
  };
  Object.defineProperty(API, 'muted', {
    get: function () { return muted; },
    set: function (v) { setMuted(v); },
    enumerable: true
  });
  BM.AUDIO = API;

  /* 核心已就绪时先读一次静音偏好（02-core 先于本模块加载） */
  try {
    if (BM.CORE && BM.CORE.state && BM.CORE.state.muted) muted = true;
  } catch (e) { /* 忽略 */ }
})();
