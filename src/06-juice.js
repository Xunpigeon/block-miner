/* 06-juice.js — v7「奶油果冻像素」手感层：叠在 06-fx 之上，不替换它。
   1) 打击：方向火花 + 冲击方环 + 选中框        2) 剥层：顶层「石板」翻飞 + 四角碎粒
   3) 击碎：旋转碎片（落地弹两次）+ 块状烟团 + 富矿经验球 + 晶/金闪光
   4) 爆炸：大烟团环 + 火星 + 碎片雨            5) 处决：金色斜斩 + 十字星
   6) 连锁：两格之间的电弧点列                  7) 入包：HUD 处小闪光
   8) 狂热：底部持续上升的火苗                  9) 宝藏：彩纸 + 金币雨
   10) 连击每 10 段：两侧彩纸炮                 11) 关卡氛围粒子（ambient）
   色板与 art/_src/px.mjs 同源（INK #352438）。全部硬边像素方块，对象池预分配，draw 内零分配。 */
(function () {
  'use strict';

  var BM = window.BM || (window.BM = {});
  var TAU = 6.2831853;
  var CAP = 420;
  var pool = [];
  for (var pi = 0; pi < CAP; pi++) pool.push({ on: 0, k: 0, x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 0, max: 1, s: 2, col: '#fff', col2: '#fff', fy: 0, b: 0, t: 0, r: 0, vr: 0, x2: 0, y2: 0 });

  var K_CUBE = 1, K_POOF = 2, K_ORB = 3, K_CRIT = 4, K_TWINK = 5, K_CONF = 6, K_EMBER = 7,
      K_SHARD = 8, K_SLAB = 9, K_RING = 10, K_SLASH = 11, K_ZAP = 12, K_FLAME = 13, K_COIN = 14;

  var INK = '#352438';
  // 矿种 → 碎块三色（亮 / 中 / 暗），与 px.mjs 的 ORE / STONE 同源
  var ORE_COL = {
    stone: ['#d9d4e1', '#a59eaf', '#6f6681'],
    coal: ['#5f586f', '#3d3849', '#262230'],
    iron: ['#ffc8a2', '#e8946e', '#b5644a'],
    gold: ['#ffe680', '#f2b82a', '#b87a10'],
    crystal: ['#a8fff2', '#3fd4d6', '#138c9c'],
    treasure: ['#fff4b8', '#ffd84a', '#a86e10']
  };
  var CONF = ['#ff7d6b', '#ffd84a', '#5cc86a', '#3fd4d6', '#b48cff', '#ffffff', '#6ec8ff'];
  var POOF_L = '#fff7e6', POOF_D = '#c9b8d0';

  function quality() { return (BM.FX && BM.FX.quality) || 'high'; }
  function qmul() { var q = quality(); return q === 'low' ? 0.35 : q === 'mid' ? 0.7 : 1; }

  // 环形游标：从上次位置往后找空槽，最多看 32 格；都满就直接顶掉游标处那颗（O(1)，不做全池扫描）
  var cursor = 0;
  function get() {
    for (var i = 0; i < 32; i++) {
      var p = pool[cursor];
      cursor = cursor + 1 === CAP ? 0 : cursor + 1;
      if (!p.on) return p;
    }
    var q = pool[cursor];
    cursor = cursor + 1 === CAP ? 0 : cursor + 1;
    return q;
  }
  function spawn(k, x, y, vx, vy, g, life, s, col, col2) {
    var p = get();
    p.on = 1; p.k = k; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.g = g;
    p.life = life; p.max = life; p.s = s; p.col = col; p.col2 = col2 || col; p.b = 0; p.t = Math.random() * TAU;
    p.r = 0; p.vr = 0; p.fy = 1e9;
    return p;
  }
  function oreOf(v) { return ORE_COL[v] ? v : 'stone'; }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  // 每帧生成预算：激光 / 震荡器一帧会命中几十格，超出预算的命中只刷新选中框，不再喷粒子
  var HIT_BUDGET = 6, hitBudget = HIT_BUDGET;
  var LAYER_BUDGET = 16, layerBudget = LAYER_BUDGET;
  var BREAK_BUDGET = 8, breakBudget = BREAK_BUDGET;

  // 选中框：最近一次命中的格子，0.35s 内闪烁描边并向外弹一下
  var sel = { on: 0, x: 0, y: 0, s: 0, t: 0 };
  var lastHitX = 195, lastHitY = 422, clock = 0;

  function onHit(e) {
    var b = e && e.block; if (!b) return;
    var s = b.s || 58, cx = b.x + s * 0.5, cy = b.y + s * 0.5;
    sel.on = 1; sel.x = b.x; sel.y = b.y; sel.s = s; sel.t = 0.35;
    lastHitX = cx; lastHitY = cy;
    if (hitBudget <= 0) return;
    hitBudget--;
    var q = qmul(), C = ORE_COL[oreOf(b.ore)];
    // 方向火花：向上扇形喷出，带重力
    var n = Math.round(4 * q) || 1;
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, sp = rnd(110, 220);
      spawn(K_CRIT, cx + (Math.random() - 0.5) * s * 0.4, cy - s * 0.1, Math.cos(a) * sp, Math.sin(a) * sp, 520, rnd(0.3, 0.45), 2, '#ffffff', '#ffd84a');
    }
    // 石屑：2~3 颗当前矿色小方块
    var m = Math.round(3 * q);
    for (var j = 0; j < m; j++) {
      var a2 = -Math.PI / 2 + (Math.random() - 0.5) * 2.6, sp2 = rnd(80, 170);
      var p = spawn(K_CUBE, cx + (Math.random() - 0.5) * s * 0.5, cy + (Math.random() - 0.5) * s * 0.3, Math.cos(a2) * sp2, Math.sin(a2) * sp2 - 60, 900, rnd(0.4, 0.6), 2, C[(Math.random() * 2) | 0], C[2]);
      p.fy = b.y + s + 2;
    }
    // 冲击方环：从格心长到 0.7 格
    if (q > 0.5) spawn(K_RING, cx, cy, 0, 0, 0, 0.18, s * 0.7, '#ffffff', '#ffffff');
  }

  // 剥层：顶层像一块石板一样翻飞出去（用被剥那层的颜色）
  function onLayer(e) {
    var b = e && e.block; if (!b) return;
    var s = b.s || 58, cx = b.x + s * 0.5, cy = b.y + s * 0.5, prevOre = e.prev && e.prev.ore;
    if (--layerBudget < 0) return;              // TNT 连环一帧几百层：只给前 16 层出特效
    var C = ORE_COL[oreOf(prevOre)], q = qmul();
    if (q > 0.5 && hitBudget > -4) {
      var dirx = Math.random() < 0.5 ? -1 : 1;
      var sl = spawn(K_SLAB, cx, cy, dirx * rnd(60, 120), rnd(-260, -200), 1300, 0.55, s * 0.78, C[1], C[0]);
      sl.vr = dirx * rnd(5, 9);
      hitBudget--;
    }
    // 四角碎粒
    var n = Math.round(4 * q);
    for (var i = 0; i < n; i++) {
      var ax = (i & 1) ? 1 : -1, ay = (i & 2) ? 1 : -1;
      var p = spawn(K_CUBE, cx + ax * s * 0.35, cy + ay * s * 0.35, ax * rnd(60, 140), ay * rnd(40, 90) - 120, 900, rnd(0.5, 0.7), 3, C[(Math.random() * 3) | 0], C[2]);
      p.fy = b.y + s + 2;
    }
    if (e.prev && (e.prev.rich || prevOre === 'crystal' || prevOre === 'gold')) twinkleBurst(cx, cy, s, e.prev.rich ? '#ffd84a' : C[0], 3);
  }

  function twinkleBurst(cx, cy, s, col2, n) {
    for (var t = 0; t < n; t++) spawn(K_TWINK, cx + (Math.random() - 0.5) * s, cy + (Math.random() - 0.5) * s, 0, -24, 0, rnd(0.45, 0.75), 2, '#ffffff', col2);
  }

  var lastBreak = null, lastBreakT = -1;
  function onBreak(e) {
    var b = e && e.block; if (!b) return;
    if (b === lastBreak && clock - lastBreakT < 0.05) return;   // break / empty 同帧去重
    lastBreak = b; lastBreakT = clock;
    if (--breakBudget < 0) return;
    var s = b.s || 58, cx = b.x + s * 0.5, cy = b.y + s * 0.5;
    var ore = oreOf(e.ore || (e.prev && e.prev.ore)), rich = !!(e.rich || (e.prev && e.prev.rich));
    var C = ORE_COL[ore], q = qmul();
    var floor = b.y + s + 2;
    // 旋转碎片：带描边的小方片，落地弹两次
    var n = Math.round(9 * q) + 2;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU, sp = rnd(70, 220);
      var p = spawn(K_SHARD, cx + (Math.random() - 0.5) * s * 0.6, cy + (Math.random() - 0.5) * s * 0.6,
        Math.cos(a) * sp, Math.sin(a) * sp - 170, 1000, rnd(0.75, 1.1), Math.random() < 0.5 ? 5 : 7, C[(Math.random() * 3) | 0], C[2]);
      p.fy = floor + Math.random() * 14; p.vr = (Math.random() - 0.5) * 18;
    }
    // 块状烟团：几颗方形云团向外扩散并长大
    var m = Math.round(6 * q) + 1;
    for (var j = 0; j < m; j++) {
      var a2 = (j / m) * TAU + Math.random() * 0.5, sp2 = rnd(30, 70);
      spawn(K_POOF, cx + Math.cos(a2) * s * 0.25, cy + Math.sin(a2) * s * 0.25, Math.cos(a2) * sp2, Math.sin(a2) * sp2 - 20, -10, rnd(0.45, 0.65), rnd(6, 10), POOF_L, POOF_D);
    }
    spawn(K_RING, cx, cy, 0, 0, 0, 0.24, s * 1.05, '#ffffff', C[0]);
    // 富矿：绿色经验球，先弹起再飘向顶部 HUD
    if (rich) {
      for (var k = 0; k < 4; k++) spawn(K_ORB, cx, cy, (Math.random() - 0.5) * 180, rnd(-200, -120), 0, rnd(1.1, 1.4), 5, '#e6ffc8', '#5cc86a');
    }
    if (ore === 'crystal' || ore === 'gold' || rich) twinkleBurst(cx, cy, s, rich ? '#ffd84a' : C[0], 5);
  }

  function onExplosion(e) {
    if (!e) return;
    var x = typeof e.x === 'number' ? e.x : 195, y = typeof e.y === 'number' ? e.y : 422, R = Math.min(160, Math.max(30, e.radiusPx || 60)), q = qmul();
    var n = Math.round(14 * q) + 4;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * TAU, sp = R * rnd(1.6, 2.4);
      spawn(K_POOF, x, y, Math.cos(a) * sp, Math.sin(a) * sp, -30, rnd(0.55, 0.8), rnd(9, 15), i % 3 ? POOF_L : '#ffd8a0', POOF_D);
    }
    var m = Math.round(18 * q) + 4;
    for (var j = 0; j < m; j++) {
      var a2 = Math.random() * TAU, sp2 = rnd(120, 380);
      spawn(K_EMBER, x, y, Math.cos(a2) * sp2, Math.sin(a2) * sp2 - 80, 500, rnd(0.5, 0.9), 3, '#fff4b8', '#ff7d6b');
    }
    // 碎片雨：被炸飞的石片
    var r = Math.round(10 * q);
    for (var k = 0; k < r; k++) {
      var a3 = -Math.PI / 2 + (Math.random() - 0.5) * 2.8, sp3 = rnd(200, 420);
      var p = spawn(K_SHARD, x, y, Math.cos(a3) * sp3, Math.sin(a3) * sp3, 1100, rnd(0.9, 1.3), 6, ORE_COL.stone[(Math.random() * 3) | 0], ORE_COL.stone[2]);
      p.fy = 740; p.vr = (Math.random() - 0.5) * 22;
    }
    spawn(K_RING, x, y, 0, 0, 0, 0.3, R * 2.2, '#fff4b8', '#ff7d6b');
  }

  // 处决：一道金色斜斩 + 中心十字星
  function onExecute(e) {
    if (!e) return;
    var x = typeof e.x === 'number' ? e.x : lastHitX, y = typeof e.y === 'number' ? e.y : lastHitY;
    var sl = spawn(K_SLASH, x, y, 0, 0, 0, 0.22, 58, '#ffffff', '#ffd84a');
    sl.r = Math.random() < 0.5 ? -0.75 : 0.75;
    spawn(K_TWINK, x, y, 0, 0, 0, 0.4, 4, '#ffffff', '#ffd84a');
  }

  // 连锁：从最近命中点到被连锁格之间画一串跳动的电弧点
  function onChain(e) {
    if (!e || typeof e.x !== 'number') return;
    var z = spawn(K_ZAP, lastHitX, lastHitY, 0, 0, 0, 0.2, 2, '#ffffff', '#6ec8ff');
    z.x2 = e.x; z.y2 = e.y;
    lastHitX = e.x; lastHitY = e.y;
  }

  // 入包：HUD 资源栏处的小闪光（每帧最多 2 次，避免磁吸时刷屏）
  var absorbBudget = 2;
  function onAbsorb(e) {
    if (!e || absorbBudget <= 0) return;
    absorbBudget--;
    var C = ORE_COL[oreOf(e.ore)];
    var x = 150 + Math.random() * 90, y = 72;
    for (var i = 0; i < 3; i++) {
      var a = Math.random() * TAU;
      spawn(K_CRIT, x, y, Math.cos(a) * 60, Math.sin(a) * 60, 0, 0.3, 2, '#ffffff', C[0]);
    }
  }

  // 狂热：持续期间从棋盘底部冒火苗
  var frenzyT = 0, flameAcc = 0;
  function onFrenzyStart(e) { frenzyT = (e && e.seconds) || 5; }
  function onFrenzyEnd() { frenzyT = 0; }

  // 宝藏：彩纸 + 金币雨
  function onTreasure(e) {
    if (!e) return;
    var x = typeof e.x === 'number' ? e.x : 195, y = typeof e.y === 'number' ? e.y : 422, q = qmul();
    var n = Math.round(40 * q) + 8;
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, sp = rnd(260, 520);
      var c = spawn(K_COIN, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 900, rnd(1.2, 1.8), 6, '#ffd84a', '#a86e10');
      c.fy = 760;
    }
    confettiBurst(x, y - 20, Math.round(30 * q), 360);
  }

  function confettiBurst(x, y, n, spd) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU, sp = rnd(spd * 0.5, spd);
      spawn(K_CONF, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 120, 420, rnd(1.3, 1.9), 4, CONF[(Math.random() * CONF.length) | 0], '#ffffff');
    }
  }

  var lastCombo = 0;
  function onCombo(e) {
    var c = (e && e.combo) | 0;
    if (c >= 10 && Math.floor(c / 10) > Math.floor(lastCombo / 10)) {
      var n = Math.round(36 * qmul());
      for (var i = 0; i < n; i++) {
        var side = i & 1, a = side ? Math.PI * 1.25 + Math.random() * 0.4 : -Math.PI * 0.25 - Math.random() * 0.4;
        var sp = rnd(260, 480);
        spawn(K_CONF, side ? 380 : 10, 120, Math.cos(a) * sp, Math.sin(a) * sp, 420, rnd(1.3, 1.8), 4, CONF[(Math.random() * CONF.length) | 0], '#ffffff');
      }
    }
    lastCombo = c;
  }

  function update(dt) {
    hitBudget = HIT_BUDGET; absorbBudget = 2; layerBudget = LAYER_BUDGET; breakBudget = BREAK_BUDGET;
    if (!(dt > 0)) return;
    if (dt > 0.05) dt = 0.05;
    clock += dt;
    if (sel.on) { sel.t -= dt; if (sel.t <= 0) sel.on = 0; }
    if (frenzyT > 0) {
      frenzyT -= dt;
      flameAcc += dt * 40 * qmul();
      while (flameAcc >= 1) {
        flameAcc -= 1;
        spawn(K_FLAME, rnd(14, 376), 736, rnd(-12, 12), rnd(-140, -70), 0, rnd(0.5, 0.9), 4, '#fff4b8', '#ff7d6b');
      }
    }
    for (var i = 0; i < CAP; i++) {
      var p = pool[i]; if (!p.on) continue;
      p.life -= dt; if (p.life <= 0) { p.on = 0; continue; }
      p.t += dt;
      if (p.k === K_ORB) {
        var age = p.max - p.life;
        if (age < 0.35) { p.vy += 420 * dt; p.vx *= 0.96; }
        else { var dx = 195 - p.x, dy = 64 - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1, acc = 1800; p.vx += dx / d * acc * dt; p.vy += dy / d * acc * dt; p.vx *= 0.93; p.vy *= 0.93; if (d < 14) p.on = 0; }
      } else {
        p.vy += p.g * dt;
        if (p.k === K_POOF) { p.vx *= 0.9; p.vy *= 0.9; p.s += 14 * dt; }
        else if (p.k === K_CONF) { p.vx *= 0.985; if (p.vy > 140) p.vy = 140; }
        else if (p.k === K_FLAME) { p.vx += Math.sin(p.t * 9) * 30 * dt; }
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.r += p.vr * dt;
      if ((p.k === K_CUBE || p.k === K_SHARD || p.k === K_COIN) && p.y > p.fy && p.vy > 0) {
        if (p.b < 2) { p.vy *= -0.42; p.vx *= 0.6; p.vr *= 0.5; p.y = p.fy; p.b++; } else { p.vy = 0; p.vx *= 0.8; p.vr = 0; p.y = p.fy; }
      }
    }
  }

  function px(ctx, x, y, s) { ctx.fillRect(Math.round(x - s * 0.5), Math.round(y - s * 0.5), s, s); }

  // 旋转方片：画成「描边 + 主体 + 底边暗线」，旋转量化到 4 档，保留像素硬边
  function shard(ctx, p, s) {
    var step = ((Math.round(p.r / 0.785) % 4) + 4) % 4;   // 0..3，每档 45°
    var X = Math.round(p.x), Y = Math.round(p.y), h = s >> 1;
    if (step & 1) {
      // 45°：菱形（三条横线叠出来）
      ctx.fillStyle = INK;
      ctx.fillRect(X - 1, Y - h - 1, 2, s + 2); ctx.fillRect(X - h - 1, Y - 1, s + 2, 2);
      ctx.fillStyle = p.col;
      ctx.fillRect(X - 1, Y - h, 2, s); ctx.fillRect(X - h, Y - 1, s, 2);
      ctx.fillRect(X - (h >> 1), Y - (h >> 1), h, h);
    } else {
      ctx.fillStyle = INK; px(ctx, X, Y, s + 2);
      ctx.fillStyle = p.col; px(ctx, X, Y, s);
      ctx.fillStyle = p.col2;
      if (step === 0) ctx.fillRect(X - h, Y + h - 1, s, 1); else ctx.fillRect(X - h, Y - h, s, 1);
    }
  }

  function draw(ctx) {
    var i, p, a, s;
    if (sel.on) {
      // 选中框：四角括号，命中瞬间外扩 4px 再收回，随剩余时间闪烁
      var k = sel.t / 0.35, pop = Math.round(4 * k * k);
      ctx.globalAlpha = (Math.floor(sel.t * 20) & 1) ? 0.95 : 0.65;
      var x0 = Math.round(sel.x) - 3 - pop, y0 = Math.round(sel.y) - 3 - pop, S = Math.round(sel.s) + 6 + pop * 2, L = Math.round(S * 0.28);
      for (var pass = 0; pass < 2; pass++) {
        var o = pass ? 0 : 1, w = pass ? 3 : 5;
        ctx.fillStyle = pass ? '#ffffff' : INK;
        ctx.fillRect(x0 - o, y0 - o, L + o, w); ctx.fillRect(x0 - o, y0 - o, w, L + o);
        ctx.fillRect(x0 + S - L, y0 - o, L + o, w); ctx.fillRect(x0 + S - w + o, y0 - o, w, L + o);
        ctx.fillRect(x0 - o, y0 + S - w + o, L + o, w); ctx.fillRect(x0 - o, y0 + S - L, w, L + o);
        ctx.fillRect(x0 + S - L, y0 + S - w + o, L + o, w); ctx.fillRect(x0 + S - w + o, y0 + S - L, w, L + o);
      }
    }
    for (i = 0; i < CAP; i++) {
      p = pool[i]; if (!p.on) continue;
      a = p.life / p.max;
      switch (p.k) {
        case K_CUBE:
          ctx.globalAlpha = a < 0.25 ? a * 4 : 1;
          ctx.fillStyle = INK; px(ctx, p.x, p.y, p.s + 2);
          ctx.fillStyle = p.col; px(ctx, p.x, p.y, p.s);
          break;
        case K_SHARD:
          ctx.globalAlpha = a < 0.25 ? a * 4 : 1;
          shard(ctx, p, p.s);
          break;
        case K_SLAB:
          // 石板：先压扁（翻转感）再淡出
          ctx.globalAlpha = a < 0.4 ? a / 0.4 : 1;
          var sw = Math.max(4, Math.round(p.s * Math.abs(Math.cos(p.r)))), sh = Math.round(p.s * (0.55 + 0.45 * a));
          var X = Math.round(p.x - sw / 2), Y = Math.round(p.y - sh / 2);
          ctx.fillStyle = INK; ctx.fillRect(X - 2, Y - 2, sw + 4, sh + 4);
          ctx.fillStyle = p.col; ctx.fillRect(X, Y, sw, sh);
          ctx.fillStyle = p.col2; ctx.fillRect(X, Y, sw, 2); ctx.fillRect(X, Y, 2, sh);
          break;
        case K_POOF:
          s = Math.round(p.s);
          ctx.globalAlpha = a * 0.85;
          ctx.fillStyle = p.col2; px(ctx, p.x + 1, p.y + 2, s);
          ctx.fillStyle = p.col; px(ctx, p.x, p.y, s);
          break;
        case K_RING:
          // 方环：从 0.35 长到满尺寸，线宽随寿命变细
          var R = Math.round(p.s * (1 - a * 0.65)), lw = a > 0.5 ? 3 : 2;
          ctx.globalAlpha = a;
          ctx.fillStyle = a > 0.5 ? p.col : p.col2;
          var rx = Math.round(p.x - R / 2), ry = Math.round(p.y - R / 2);
          ctx.fillRect(rx, ry, R, lw); ctx.fillRect(rx, ry + R - lw, R, lw);
          ctx.fillRect(rx, ry, lw, R); ctx.fillRect(rx + R - lw, ry, lw, R);
          break;
        case K_ORB:
          var pulse = 4 + ((Math.floor(p.t * 12) & 1) ? 2 : 0);
          ctx.globalAlpha = 0.35; ctx.fillStyle = p.col2; px(ctx, p.x, p.y, pulse + 6);
          ctx.globalAlpha = 1; ctx.fillStyle = INK; px(ctx, p.x, p.y, pulse + 2);
          ctx.fillStyle = p.col2; px(ctx, p.x, p.y, pulse);
          ctx.fillStyle = p.col; px(ctx, p.x - 1, p.y - 1, 2);
          break;
        case K_CRIT:
        case K_TWINK:
          ctx.globalAlpha = a;
          var arm = p.k === K_TWINK ? (a > 0.5 ? 3 : 2) : (a > 0.5 ? 2 : 1), u = p.s;
          ctx.fillStyle = p.col2;
          ctx.fillRect(Math.round(p.x - u * 0.5 - arm * u * 0.5), Math.round(p.y - u * 0.5), u * (arm + 1), u);
          ctx.fillRect(Math.round(p.x - u * 0.5), Math.round(p.y - u * 0.5 - arm * u * 0.5), u, u * (arm + 1));
          ctx.fillStyle = p.col; px(ctx, p.x, p.y, u);
          break;
        case K_SLASH:
          // 斜斩：一条 45° 的阶梯像素线，先满长后收缩
          ctx.globalAlpha = a;
          var L2 = Math.round(p.s * (0.6 + 0.4 * a)), dir = p.r < 0 ? -1 : 1;
          for (var t = -L2; t <= L2; t += 2) {
            var tx = Math.round(p.x + t), ty = Math.round(p.y + t * dir), wd = (Math.abs(t) < L2 * 0.5) ? 4 : 2;
            ctx.fillStyle = p.col2; ctx.fillRect(tx - 1, ty - wd / 2 - 1, 3, wd + 2);
            ctx.fillStyle = p.col; ctx.fillRect(tx, ty - wd / 2, 2, wd);
          }
          break;
        case K_ZAP:
          // 电弧：两点间每 6px 一个跳动方点
          ctx.globalAlpha = a;
          var zx = p.x2 - p.x, zy = p.y2 - p.y, zd = Math.sqrt(zx * zx + zy * zy) || 1, steps = Math.min(30, Math.ceil(zd / 6));
          for (var zi = 0; zi <= steps; zi++) {
            var f = zi / steps, j = (zi % 2 ? 1 : -1) * ((Math.floor(p.t * 40) + zi) % 3);
            ctx.fillStyle = zi % 3 ? p.col2 : p.col;
            ctx.fillRect(Math.round(p.x + zx * f - zy / zd * j * 2) - 1, Math.round(p.y + zy * f + zx / zd * j * 2) - 1, 3, 3);
          }
          break;
        case K_CONF:
          ctx.globalAlpha = a < 0.3 ? a / 0.3 : 1;
          ctx.fillStyle = p.col;
          var flip = Math.abs(Math.sin(p.t * 9));
          ctx.fillRect(Math.round(p.x - 2), Math.round(p.y - 2), Math.max(1, Math.round(4 * flip)), 4);
          break;
        case K_COIN:
          // 金币：横向缩放模拟旋转
          ctx.globalAlpha = a < 0.25 ? a * 4 : 1;
          var cw = Math.max(2, Math.round(6 * Math.abs(Math.cos(p.t * 8))));
          ctx.fillStyle = INK; ctx.fillRect(Math.round(p.x - cw / 2) - 1, Math.round(p.y) - 4, cw + 2, 8);
          ctx.fillStyle = p.col; ctx.fillRect(Math.round(p.x - cw / 2), Math.round(p.y) - 3, cw, 6);
          if (cw > 3) { ctx.fillStyle = '#fff4b8'; ctx.fillRect(Math.round(p.x - cw / 2), Math.round(p.y) - 3, 1, 3); }
          break;
        case K_FLAME:
          ctx.globalAlpha = a;
          ctx.fillStyle = a > 0.6 ? p.col : a > 0.3 ? '#ffd84a' : p.col2;
          px(ctx, p.x, p.y, a > 0.5 ? 4 : 2);
          break;
        case K_EMBER:
          ctx.globalAlpha = a;
          ctx.fillStyle = a > 0.5 ? p.col : p.col2; px(ctx, p.x, p.y, a > 0.5 ? 3 : 2);
          break;
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------- 关卡氛围（营地与挖矿都会画，叠在所有内容之上，极轻） ---------------- */
  var AMB_N = 44, amb = [];
  for (var ai = 0; ai < AMB_N; ai++) amb.push({ x: Math.random() * 390, y: Math.random() * 844, ph: Math.random() * TAU, sp: 0.5 + Math.random(), s: Math.random() });
  var STYLE = {
    quarry: { cols: ['#ffffff', '#ffb9a6', '#ffe680'], vy: 16, vx: 10, sway: 18, size: 2, mode: 'fall' },
    copperRidge: { cols: ['#b4f28e', '#ffd84a', '#a8fff2'], vy: -10, vx: 3, sway: 10, size: 2, mode: 'firefly' },
    blueIron: { cols: ['#c6ecff', '#6ec8ff'], vy: 120, vx: 0, sway: 0, size: 2, mode: 'drip' },
    lavaEdge: { cols: ['#fff4b8', '#ffd84a', '#ff7d6b'], vy: -46, vx: 6, sway: 14, size: 2, mode: 'rise' },
    starCave: { cols: ['#ffffff', '#e6c8ff', '#a8fff2'], vy: -4, vx: 0, sway: 4, size: 2, mode: 'twinkle' },
    moonRift: { cols: ['#e2b4ff', '#ffffff', '#b48cff'], vy: -12, vx: 0, sway: 6, size: 2, mode: 'portal' },
    coreHeart: { cols: ['#ffd84a', '#3fd4d6', '#fff4b8'], vy: -18, vx: 4, sway: 12, size: 2, mode: 'rise' }
  };
  var shoot = { on: 0, x: 0, y: 0, t: 0 };
  var lastAmbT = -1;

  function ambient(ctx, T, zone) {
    var z = zone || (BM.CORE && BM.CORE.state && BM.CORE.state.currentZone) || 'quarry';
    var st = STYLE[z] || STYLE.quarry;
    var n = quality() === 'low' ? 14 : quality() === 'mid' ? 28 : AMB_N;
    var dT = lastAmbT < 0 ? 1 / 60 : Math.min(0.05, Math.max(0, T - lastAmbT));
    lastAmbT = T;
    for (var i = 0; i < n; i++) {
      var m = amb[i], col = st.cols[i % st.cols.length];
      var y = m.y + T * st.vy * m.sp, x = m.x + T * st.vx * m.sp + Math.sin(T * 0.8 * m.sp + m.ph) * st.sway;
      y = ((y % 844) + 844) % 844; x = ((x % 390) + 390) % 390;
      var al = 0.75, sz = st.size + (m.s > 0.7 ? 1 : 0);
      if (st.mode === 'firefly') al = 0.25 + 0.75 * Math.max(0, Math.sin(T * 2 * m.sp + m.ph));
      else if (st.mode === 'twinkle') { al = Math.max(0, Math.sin(T * 1.6 * m.sp + m.ph)); if (al > 0.85) { ctx.globalAlpha = al * 0.7; ctx.fillStyle = col; ctx.fillRect(Math.round(x) - 3, Math.round(y), 7, 1); ctx.fillRect(Math.round(x), Math.round(y) - 3, 1, 7); } }
      else if (st.mode === 'drip') { if (i % 3) continue; sz = 2; ctx.globalAlpha = 0.6; ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y) - 4, 1, 4); }
      else if (st.mode === 'rise') { al = Math.min(1, (y / 844) * 1.4); if (m.s > 0.6) { ctx.globalAlpha = al * 0.22; ctx.fillStyle = col; ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, sz + 4, sz + 4); } }
      else if (st.mode === 'portal') al = 0.35 + 0.5 * Math.abs(Math.sin(T * m.sp + m.ph));
      else if (st.mode === 'fall' && i % 2 === 0) { sz = 3; } // 花瓣稍大
      ctx.globalAlpha = al;
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(x), Math.round(y), sz, sz);
      if (st.mode === 'firefly' && al > 0.6) { ctx.globalAlpha = al * 0.25; ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, sz + 4, sz + 4); }
    }
    // 夜空关卡：偶发流星（按真实帧间隔推进，不再写死 1/60）
    if (z === 'moonRift' || z === 'starCave') {
      if (!shoot.on && Math.random() < 0.004) { shoot.on = 1; shoot.x = 60 + Math.random() * 300; shoot.y = 30 + Math.random() * 140; shoot.t = 0; }
      if (shoot.on) {
        shoot.t += dT; var k = shoot.t / 0.7;
        if (k >= 1) shoot.on = 0;
        else for (var j = 0; j < 10; j++) { ctx.globalAlpha = (1 - k) * (1 - j / 10); ctx.fillStyle = j < 2 ? '#ffffff' : '#c8b8ff'; ctx.fillRect(Math.round(shoot.x - k * 160 + j * 4), Math.round(shoot.y + k * 70 - j * 2), 2, 2); }
      }
    }
    ctx.globalAlpha = 1;
  }

  function init() {
    var bus = BM.bus;
    if (!bus || !bus.on) return;
    bus.on('block:hit', onHit);
    bus.on('block:layer', onLayer);
    bus.on('block:break', onBreak);
    bus.on('block:empty', onBreak);
    bus.on('explosion', onExplosion);
    bus.on('tool:execute', onExecute);
    bus.on('tool:chain', onChain);
    bus.on('drop:absorb', onAbsorb);
    bus.on('frenzy:start', onFrenzyStart);
    bus.on('frenzy:end', onFrenzyEnd);
    bus.on('treasure:open', onTreasure);
    bus.on('combo:update', onCombo);
    bus.on('round:start', clear);
  }

  function clear() { for (var i = 0; i < CAP; i++) pool[i].on = 0; sel.on = 0; lastCombo = 0; frenzyT = 0; }

  // alive() 只给调试 / 测试读粒子数
  function alive() { var n = 0; for (var i = 0; i < CAP; i++) if (pool[i].on) n++; return n; }

  BM.JUICE = { draw: draw, ambient: ambient, update: update, clear: clear, alive: alive };
  init();
})();
