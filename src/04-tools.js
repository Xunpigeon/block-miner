/* 04-tools.js —— 四种工具的形状与结算、幸运 TNT（挖矿白掉）的爆炸、连锁、连击与狂热 */
(function () {
  'use strict';

  var BM = window.BM = window.BM || {};

  // 手感调参，可被 BM.CONFIG.tuning 同名键覆盖（只取 number）
  var T = {
    chainMax: 5,          // 单次连锁最多波及的格数
    chainDelay: 0.06,     // 连锁逐格间隔（秒）
    chainFade: 0.72,      // 逐格伤害递减
    chainRadius: 26,      // 连锁爆破视觉半径（设计空间像素）
    chainPower: 0.55,
    chainChanceBase: 0,   // 铁矿的额外连锁率（CONFIG.tuning.chainChanceBase）
    columnExtra: 1,       // 纵向工具：目标格之外再往下打的格数（铁镐 = 1）
    columnScan: 7,        // 跳过已挖空格时最多下探多少次
    comboWindow: 1.2,     // 连击清零窗口（秒）
    comboFrenzyAt: 8,     // 进入狂热的连击阈值
    frenzyMax: 3,         // 每局最多几次狂热
    comboMultStep: 0.02,
    comboMultMax: 2,
    spinSpeed: 9,         // 纵向工具旋转视觉速度
    tntDamageMul: 4,      // TNT 每格伤害 = 当前工具伤害 × 该系数（CONFIG.tnt.tntDamageMul，v9b 3 → 4）
    tntLayerBase: 2,      // TNT 基础穿透层数（CONFIG.tnt.layerPierce）
    tntPower: 1.6,        // 爆炸表现强度
    luckyTNTTotalMax: 400,// 每局幸运 TNT 总量上限（CONFIG.tuning.luckyTNTTotalMax，防浏览器卡死）
    maxFuses: 60,         // 同屏引信物理上限（CONFIG.tuning.tntMaxFuses），防爆栈
    luckyTNTFuse: 1.8,    // 幸运掉落的 TNT 长引信（秒；CONFIG.tuning.luckyTNTFuseSec）
                          // v14 起这是唯一的引线：长引线给「A 炸 → 掉 B → B 炸」留时间
    luckyTNTSide: 3,      // 幸运 TNT 爆炸边长（3 = 3×3；CONFIG.tuning.luckyTNTSide）
    // AOE 溅射衰减（BALANCE-V4 §5）：只缩放伤害，不改命中格数与 tool:swing.cells
    splashSquare3: 0.45,  // square3：除中心外 8 格
    splashLaser: 0.7,     // columnAll：同列其它格
    resonanceCap: 3       // 地心共振：每局最多触发 3 次（V6-ENDGAME §2）
  };
  var DEFAULT_T = {};
  for (var dk in T) DEFAULT_T[dk] = T[dk];

  var ctx = null;
  var stats = { broken: 0, maxCombo: 0, maxChain: 0, explosions: 0, executes: 0 };
  var zone = null;

  var combo = 0;
  var comboT = 0;
  var frenzyLeft = 0;
  var frenzyCount = 0;
  var frenzyMult = 1;

  var cd = 0;
  var cdTotal = 0;
  var holding = false;
  var lastTool = null;
  var aim = { x: 0, y: 0, ok: false };

  var chaining = false;
var chainQueue = [];
  var chainUsed = [];
  var chainIdx = 0;
  var swingCount = 0;
  var hasSwing = false;
  var liveChainDmg = 1;
  var applyingChain = false;
  var spin = 0;

  var fuses = [];                 // { b, x, y, t, delay, side, s, lucky? }
  var luckyUsed = 0;              // 本局已掉落的幸运 TNT 枚数
  // 地心共振（v6）：每打穿一层 +1，攒满 mods.resonanceThreshold → 全屏剥离一层
  var resonanceCount = 0;         // 本局累计（触发后清零）
  var resonanceUsed = 0;          // 本局已触发次数（上限 T.resonanceCap）
  var resonating = false;         // 共振结算中：期间自己造成的 block:layer 不再计数（防递归）
  var executing = false;          // 处决剥层中：期间不再做处决判定（stripLayer 会派发 block:layer/break，防递归）

  var modsCache = null;
  var DASH = [3, 4];
  var NO_DASH = [];

  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function emit(type, data) { var bus = BM.bus; if (bus && bus.emit) bus.emit(type, data); }
  function grid() { return BM.GRID; }

  function modsObj() {
    if (modsCache) return modsCache;
    var m = null;
    try { m = (BM.CORE && BM.CORE.mods) ? BM.CORE.mods() : null; } catch (e) { m = null; }
    modsCache = m || {};
    return modsCache;
  }
  function freshMods() { modsCache = null; return modsObj(); }

  function resolveTool(tool) {
    var list = (BM.CONFIG && BM.CONFIG.tools) || {};
    if (typeof tool === 'string') return list[tool] || null;
    if (tool && tool.id) return list[tool.id] || tool;
    return null;
  }

  // 伤害 = CONFIG.tools[id].dmg + mods.damage；激光（columnAll）再叠天赋 mods.laserDamage
  function toolDamage(tool) {
    var m = modsObj();
    var dmg = Math.round(num(tool.dmg, 1) + num(m.damage, 0));
    if (isLaser(tool)) dmg += Math.round(num(m.laserDamage, 0));
    return dmg < 1 ? 1 : dmg;
  }

  // 当前工具：CORE.state.selectedTool 优先（main 的攻击路径），缺省回退上一次出手的工具
  function currentTool() {
    var st = BM.CORE && BM.CORE.state;
    var id = st && st.selectedTool;
    if (typeof id === 'string') {
      var t = resolveTool(id);
      if (t) return t;
    }
    return lastTool || resolveTool('wood');
  }

  // TNT 每格伤害 = round(当前工具伤害 × CONFIG.tnt.damageMul)（BALANCE-V4 §6：不再固定 6）
  // 兼容 CONFIG 里的两种键名：damageMul（BALANCE-V4 口径）/ tntDamageMul（01-config 现用名）
  function tntMulCfg() {
    var tc = (BM.CONFIG && BM.CONFIG.tnt) || null;
    var base = num(tc && tc.damageMul, num(tc && tc.tntDamageMul, T.tntDamageMul));
    // v6「雷管强化」：mods.tntDamageMul 是**倍率**（缺省 1），叠在配置基数上
    var m = modsObj();
    var boost = num(m && m.tntDamageMul, 1);
    if (!(boost > 0)) boost = 1;
    return base * boost;
  }

  function tntDamage() {
    var mul = tntMulCfg();
    if (!(mul > 0)) mul = T.tntDamageMul;
    var tool = currentTool();
    var base = 0;
    var c = BM.CORE;
    if (tool && c && typeof c.toolDamage === 'function') {
      try { base = num(c.toolDamage(tool.id), 0); } catch (e) { base = 0; }
    }
    if (!(base > 0)) base = tool ? toolDamage(tool) : 1;
    var d = Math.round(base * mul);
    return d < 1 ? 1 : d;
  }

  function comboMult() {
    var m = 1 + combo * T.comboMultStep;
    return m > T.comboMultMax ? T.comboMultMax : m;
  }

  /* ---------------- 形状（CONTRACT-V3 §4） ---------------- */

  function shapeOf(tool) {
    return (tool && typeof tool.shape === 'string') ? tool.shape : 'single';
  }

  function isColumnShape(tool) {
    var s = shapeOf(tool);
    return s === 'column' || /^column[0-9]+$/.test(s);
  }

  function isLaser(tool) { return shapeOf(tool) === 'columnAll'; }

  // 纵向工具在目标格之外还往下打几格：columnN → N-1；否则 tool.reach / tool.pierce，缺省 columnExtra
  function columnExtra(tool) {
    var m = /^column([0-9]+)$/.exec(shapeOf(tool));
    var e;
    if (m) e = parseInt(m[1], 10) - 1;
    else e = num(tool.reach, num(tool.pierce, T.columnExtra));
    e = Math.round(e);
    if (!(e >= 0)) e = 0;
    if (e > 6) e = 6;
    return e;
  }

  // 按格坐标读存活格：GRID.at 对坑洞返回 null，形状遍历一律直接读 blocks 并跳过坑洞与 layers<=0
  function gridCell(ox, oy) {
    var G = grid();
    if (!G || !G.blocks || !G.blocks[oy]) return null;
    var b = G.blocks[oy][ox] || null;
    if (!b || b.broken) return null;
    if (typeof b.layers === 'number' && b.layers <= 0) return null;
    return b;
  }

  // columnN：目标格 + 向下若干存活格；坑洞不占配额，继续往下
  function columnCells(block, want) {
    var out = [];
    var G = grid();
    if (!block || !G || !G.blocks) return out;
    if (gridCell(block.ox, block.oy) === block) out.push(block);
    var guard = want + T.columnScan;
    for (var oy = block.oy + 1; oy < G.blocks.length && out.length < want && guard > 0; oy++) {
      guard--;
      var b = gridCell(block.ox, oy);
      if (b) out.push(b);
    }
    return out;
  }

  // columnAll：目标所在整列全部存活格
  function columnAllCells(block) {
    var out = [];
    var G = grid();
    if (!block || !G || !G.blocks) return out;
    for (var oy = 0; oy < G.blocks.length; oy++) {
      var b = gridCell(block.ox, oy);
      if (b) out.push(b);
    }
    return out;
  }

  // squareN：以目标为中心 n×n，越界与坑洞直接跳过（本版只有 square3）
  function squareCells(block, side) {
    var out = [];
    if (!block) return out;
    var half = Math.floor(side / 2);
    for (var dy = -half; dy <= half; dy++) {
      for (var dx = -half; dx <= half; dx++) {
        var b = gridCell(block.ox + dx, block.oy + dy);
        if (b) out.push(b);
      }
    }
    return out;
  }

  function hitCells(tool, block) {
    if (!block) return [];
    var shape = shapeOf(tool);
    if (shape === 'columnAll') return columnAllCells(block);
    if (isColumnShape(tool)) return columnCells(block, 1 + columnExtra(tool));
    var sq = /^square([0-9]+)$/.exec(shape);
    if (sq) return squareCells(block, parseInt(sq[1], 10));
    return [block];
  }

  /* ---------------- 溅射衰减（BALANCE-V4 §5） ---------------- */

  // 相对目标格的溅射系数：中心 1；square3 外圈 0.45；激光同列 0.7
  function splashMul(tool, b, target) {
    if (!b || !target) return 1;
    if (b.ox === target.ox && b.oy === target.oy) return 1;
    var shape = shapeOf(tool);
    if (shape === 'columnAll') return T.splashLaser;
    if (!/^square[0-9]+$/.test(shape)) return 1;      // single / columnN 不分溅射
    return T.splashSquare3;
  }

  function splashDamage(base, mul) {
    var d = Math.round(base * mul);
    return d < 1 ? 1 : d;
  }

  /* ---------------- 一击的分组（chain:tick 用） ---------------- */

  function beginSwing() {
    if (hasSwing) return;
    swingCount = 0;
    chainIdx = 0;
    chainUsed.length = 0;
    hasSwing = true;
  }

  function finishSwing() {
    hasSwing = false;
    if (chainIdx > stats.maxChain) stats.maxChain = chainIdx;
    if (swingCount > 0) emit('chain:tick', { count: swingCount });
    swingCount = 0;
    chainIdx = 0;
    chainUsed.length = 0;
  }

  function pushChain(from, dmg) {
    if (chainIdx >= T.chainMax) return;
    var G = grid();
    if (!G || !G.neighbors) return;
    var list = null;
    try { list = G.neighbors(from, 'cross', 1); } catch (e) { list = null; }
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      var nb = list[i];
      if (!nb || nb === from || nb.broken) continue;
      if (chainUsed.indexOf(nb) >= 0) continue;
      chainUsed.push(nb);
      chainIdx++;
      var nd = Math.round(dmg * T.chainFade);
      chainQueue.push({ b: nb, dmg: nd < 1 ? 1 : nd, t: T.chainDelay });
      return;
    }
  }

  function onLayerChain(p) {
    if (p && p.block) rollChain(p.block);
  }

  var crossBuf = [];
  function rollChain(from) {
    // v16：连锁改为**确定性**——每击碎一层，额外摧毁相邻 chainCells 格各一层（不递归）
    if (!from || chaining) return;
    var cells = num(modsObj().chainCells, 0);
    if (cells <= 0) return;
    var G = BM.GRID;
    if (!G || !G.neighbors || !G.stripLayer) return;
    // 十字相邻 4 格（直接查表，不再对 8 邻格做 filter 分配新数组 —— 这是每层都会走的热路径）
    var list = crossBuf; list.length = 0;
    var c0;
    if ((c0 = gridCell(from.ox, from.oy - 1))) list.push(c0);
    if ((c0 = gridCell(from.ox + 1, from.oy))) list.push(c0);
    if ((c0 = gridCell(from.ox, from.oy + 1))) list.push(c0);
    if ((c0 = gridCell(from.ox - 1, from.oy))) list.push(c0);
    if (!list.length) return;
    chaining = true;
    try {
      var hit = 0;
      for (var i = 0; i < list.length && hit < cells; i++) {
        var nb = list[(i + ((Math.random() * list.length) | 0)) % list.length];
        if (!nb || nb.broken) continue;
        if (G.stripLayer(nb)) { hit++; chainIdx++; emit('tool:chain', { x: nb.x + nb.s / 2, y: nb.y + nb.s / 2, cells: hit }); }
      }
      if (hit > stats.maxChain) stats.maxChain = hit;
    } finally { chaining = false; }
  }

  function triggerFrenzy() {
    if (frenzyLeft > 0) return;
    if (frenzyCount >= T.frenzyMax) return;
    var m = modsObj();
    var secs = Math.max(0.5, num(m.frenzySeconds, 4));
    var mult = Math.max(1, num(m.frenzyDropMul, 2));
    frenzyCount++;
    frenzyLeft = secs;
    frenzyMult = mult;
    emit('frenzy:start', { seconds: secs, mult: mult });
  }

  // block:break 只在整格被挖空时派发；block:layer（打穿一层）不计入连击与破坏数
  function onBreak(p) {
    if (!p || !p.block) return;
    var b = p.block;
    stats.broken++;
    swingCount++;
    combo++;
    comboT = 0;
    if (combo > stats.maxCombo) stats.maxCombo = combo;
    emit('combo:update', { combo: combo, mult: comboMult() });
    if (combo >= T.comboFrenzyAt) triggerFrenzy();

    if (applyingChain || (typeof p.chain === 'number' && p.chain > 0)) {
      pushChain(b, liveChainDmg);
    } else {
      rollChain(b);
    }
  }

  function stepChain(dt) {
    if (!chainQueue.length) return;
    var G = grid();
    var i, e;
    var n = chainQueue.length;
    for (i = n - 1; i >= 0; i--) {
      e = chainQueue[i];
      e.t -= dt;
      if (e.t > 0) continue;
      chainQueue.splice(i, 1);
      var b = e.b;
      if (!b || b.broken) continue;
      emit('explosion', {
        x: b.x + b.s * 0.5, y: b.y + b.s * 0.5,
        radiusPx: T.chainRadius, power: T.chainPower, cells: 1
      });
      stats.explosions++;
      liveChainDmg = e.dmg;
      applyingChain = true;
      if (G && G.damage) G.damage(b, e.dmg, 0);
      applyingChain = false;
    }
    if (!chainQueue.length && hasSwing) finishSwing();
  }

  /* ---------------- TNT ---------------- */

  function tntPierce() {
    var tc = (BM.CONFIG && BM.CONFIG.tnt) || null;
    var base = Math.round(num(tc && tc.layerPierce, T.tntLayerBase));   // 基础层数读 CONFIG.tnt.layerPierce
    if (!(base > 0)) base = T.tntLayerBase;
    // mods.tntLayerPierce = CONFIG.tnt.layerPierce + tntPierce 天赋（满链 4）；缺键时回落到 CONFIG 基数
    var p = Math.round(num(modsObj().tntLayerPierce, base));
    if (p <= 0) p = base;
    if (p > 8) p = 8;
    return p;
  }

  // 以 block 为中心的正方形落点（含已挖空的格，用于计数与逐格表现）
  function footprint(block, side) {
    var out = [];
    if (!block) return out;
    var half = (side - 1) / 2;
    for (var dy = -half; dy <= half; dy++) {
      for (var dx = -half; dx <= half; dx++) {
        var b = gridCell(block.ox + dx, block.oy + dy);
        if (!b || b.broken) continue;       // 越界与已挖空的格不计入
        out.push(b);
      }
    }
    return out;
  }

  // 对一格造成 dmg 伤害并连续打穿多层；GRID v2 用 damageLayers，v1 形状则逐层 damage 兜底
  function damageCell(G, b, dmg, pierce) {
    if (!b) return;
    if (typeof G.damageLayers === 'function') {
      G.damageLayers(b, dmg, pierce);
      return;
    }
    if (!G.damage) return;
    for (var i = 0; i < pierce; i++) {
      if (!b || b.broken) break;
      G.damage(b, dmg, -Math.PI / 2);
    }
  }

  function explode(f) {
    var G = grid();
    if (!G) return;
    var side = f.side;
    var pierce = tntPierce();          // 穿透层数：CONFIG.tnt.layerPierce(2) + tntPierce 天赋（满链 4）
    var list = f.b ? footprint(f.b, side) : [];
    var i;
    var dmg = tntDamage();            // = round(当前工具伤害 × CONFIG.tnt.damageMul)
    if (hasSwing) finishSwing();      // 上一击的连锁还在飞：先收尾，避免串味
    beginSwing();
    for (i = 0; i < list.length; i++) {
      var b = list[i];
      if (!b || b.broken) continue;
      damageCell(G, b, dmg, pierce);
    }
    stats.explosions++;
    // tntCount = 这一次爆炸之后场上还排着的 TNT 数 + 自己（「同屏 TNT 数」）：
    // 连环里 06-fx 用它放大震屏与火花、07-audio 用它决定要不要叠「连环」尾音。
    emit('explosion', {
      x: f.x, y: f.y,
      radiusPx: side * f.s * 0.5,
      power: T.tntPower,
      cells: list.length,
      tntCount: fuses.length + 1
    });
    if (!chainQueue.length && hasSwing) finishSwing();
  }

  /* 每帧最多引爆 BOOMS_PER_FRAME 颗，其余顺延到下一帧（只是晚 16ms，结果完全一样）。
     原因：同一帧掉下来的 TNT 引信同时到点，会在同一帧一起炸；每颗打穿 ~36 层，每层又触发
     连锁 / 掉落 / 粒子 / 再掷 TNT —— 中期一帧 1000+ 次碎层，手机上直接卡 300–900ms。
     错开之后爆炸像涟漪一样一颗接一颗，观感反而更好。 */
  var BOOMS_PER_FRAME = 1;
  function stepFuses(dt) {
    var booms = 0;
    for (var i = 0; i < fuses.length; i++) fuses[i].t += dt;
    for (var j = 0; j < fuses.length && booms < BOOMS_PER_FRAME; ) {
      var f = fuses[j];
      if (f.t < f.delay) { j++; continue; }
      fuses.splice(j, 1);
      explode(f);
      booms++;
    }
  }

  /* ---------------- 幸运 TNT（打穿一层掷骰，自动落在刚挖格附近） ---------------- */

  // 刚打穿那格的 ±1 内随机取一个存活格（含自身下一层）
  function pickNearCell(ox, oy) {
    var list = [];
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        var b = gridCell(ox + dx, oy + dy);
        if (b) list.push(b);
      }
    }
    if (!list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
  }

  // block:layer（打穿一层）触发：命中则白掉一枚，T.luckyTNTFuse（CONFIG.tuning.luckyTNTFuseSec = 1.8）
  // 秒后自爆 3×3 穿透 CONFIG.tnt.layerPierce 层（v14 起这是唯一的 TNT 来源）。
  // TNT 爆炸本身也走 G.damageLayers → block:layer，所以炸出来的碎层同样会掷骰：
  // 新炸弹**当场** push 进 fuses（stepFuses 下一帧就认），这就是 A 炸 → 掉 B → B 炸 的链条。
  function rollLuckyTNT(p) {
    var b = p && p.block;
    if (!b || typeof b.ox !== 'number' || typeof b.oy !== 'number') return;
    if (luckyUsed >= T.luckyTNTTotalMax) return;   // 每局总量上限（很宽，只防卡死）
    if (fuses.length >= T.maxFuses) return;      // 同屏引信上限：防爆栈
    var chance = num(modsObj().luckyTNTChance, 0);
    if (!(chance > 0)) return;
    if (Math.random() >= chance) return;
    var target = pickNearCell(b.ox, b.oy);
    if (!target) return;
    luckyUsed++;
    var cx = num(target.x, 0) + num(target.s, 0) * 0.5;
    var cy = num(target.y, 0) + num(target.s, 0) * 0.5;
    fuses.push({
      b: target, x: cx, y: cy, t: 0, delay: T.luckyTNTFuse,
      side: T.luckyTNTSide, s: num(target.s, 0), lucky: true
    });
    emit('lucky:tnt', { x: cx, y: cy, delay: T.luckyTNTFuse });
  }

  /* ---------------- 地心共振（v6）：全屏剥离一层 ---------------- */

  // 阈值来自天赋 mods.resonanceThreshold（1/2/3 级 → 60/45/30 层）；未解锁（<=0）不参与
  function resonanceThreshold() {
    var v = num(modsObj().resonanceThreshold, 0);
    return v > 0 ? v : 0;
  }

  // 棋盘上所有存活格（跳过坑洞 / layers<=0）；优先用 GRID.flat，缺失时退回二维扫描
  function aliveCellsOf(G) {
    var out = [];
    if (!G) return out;
    var i, j, row, b;
    var flat = G.flat;
    if (flat && flat.length) {
      for (i = 0; i < flat.length; i++) {
        b = flat[i];
        if (!b || b.broken) continue;
        if (typeof b.layers === 'number' && b.layers <= 0) continue;
        out.push(b);
      }
      return out;
    }
    var blocks = G.blocks;
    if (!blocks || !blocks.length) return out;
    for (j = 0; j < blocks.length; j++) {
      row = blocks[j];
      if (!row || !row.length) continue;
      for (i = 0; i < row.length; i++) {
        b = row[i];
        if (!b || b.broken) continue;
        if (typeof b.layers === 'number' && b.layers <= 0) continue;
        out.push(b);
      }
    }
    return out;
  }

  // 棋盘中心的世界坐标：取中间那一格的中心（表现层的冲击波原点）
  function boardCenterOf(G) {
    var blocks = G && G.blocks;
    if (blocks && blocks.length && blocks[0] && blocks[0].length) {
      var row = blocks[(blocks.length / 2) | 0] || blocks[0];
      var b = row[(row.length / 2) | 0] || row[0];
      if (b) return { x: num(b.x, 0) + num(b.s, 0) * 0.5, y: num(b.y, 0) + num(b.s, 0) * 0.5 };
    }
    return { x: 195, y: 422 };       // 设计空间中心（390×844）兜底
  }

  // 触发一次共振：全屏每格各掉一层（无视距离）+ 金色冲击波 + 全屏吸入
  function fireResonance() {
    if (resonating) return false;
    resonanceCount = 0;
    if (resonanceUsed >= T.resonanceCap) return false;   // 每局最多 3 次
    resonanceUsed++;
    var G = grid();
    if (!G) return false;
    var list = aliveCellsOf(G);
    var c = boardCenterOf(G);
    resonating = true;
    emit('resonance:blast', { x: c.x, y: c.y, cells: list.length });
    for (var i = 0; i < list.length; i++) {
      if (!G.stripLayer) break;
      // 共振口径：无视血量直接剥一层（1 点伤害打不穿厚血矿）；返回 false = 该格已无可剥的层，跳过
      if (!G.stripLayer(list[i])) continue;
    }
    resonating = false;
    emit('magnet:burst', { x: c.x, y: c.y, all: true });
    return true;
  }

  // block:layer（打穿一层）+ block:empty（整格挖空的最后一层）各计 1 层
  function onResonanceLayer(p) {
    if (resonating) return;
    if (!(resonanceThreshold() > 0)) return;
    resonanceCount++;
    if (resonanceCount < resonanceThreshold()) return;
    fireResonance();
  }

  /* ---------------- 处决（v9）：命中后血量进入阈值区间直接剥层 ---------------- */

  // 天赋 mods.execThreshold = 0.12 / 0.20 / 0.30（3 级）；未解锁（<=0）不参与
  function execThreshold() {
    var v = num(modsObj().execThreshold, 0);
    if (!(v > 0)) return 0;
    return v > 1 ? 1 : v;
  }

  // 命中结算后调用：block.hp / block.maxHp <= 阈值 → 无视剩余血量剥掉这一层。
  // stripLayer 内部派发 block:layer / block:break，连锁（onBreak → rollChain）与幸运 TNT
  // 都由既有订阅链照常处理，这里不放行任何「再判一次」的路径，所以剥层期间置 executing。
  function tryExecute(b) {
    if (executing) return false;
    var th = execThreshold();
    if (!(th > 0)) return false;
    if (!b || b.broken) return false;
    if (!(b.hp > 0)) return false;
    var maxHp = num(b.maxHp, 0);
    if (!(maxHp > 0)) return false;
    if (b.hp / maxHp > th + 1e-9) return false;
    var G = grid();
    if (!G || typeof G.stripLayer !== 'function') return false;
    var cx = num(b.x, 0) + num(b.s, 0) * 0.5;
    var cy = num(b.y, 0) + num(b.s, 0) * 0.5;
    executing = true;
    var ok = false;
    try { ok = G.stripLayer(b) !== false; } catch (e) { ok = false; }
    executing = false;
    if (!ok) return false;
    stats.executes++;
    emit('tool:execute', { x: cx, y: cy, ox: b.ox, oy: b.oy, threshold: th });
    return true;
  }

  /* ---------------- 公开 API ---------------- */

  function init(c) {
    ctx = c || null;
    var t = BM.CONFIG && BM.CONFIG.tuning;
    if (t) {
      for (var k in DEFAULT_T) if (typeof t[k] === 'number') T[k] = t[k];
      // 契约里的别名键（单位为毫秒/秒的差异在这里换算）
      if (typeof t.chainIntervalMs === 'number') T.chainDelay = t.chainIntervalMs / 1000;
      if (typeof t.comboDecaySec === 'number') T.comboWindow = t.comboDecaySec;
      if (typeof t.chainChanceBase === 'number') T.chainChanceBase = t.chainChanceBase;
    }
    var tc = BM.CONFIG && BM.CONFIG.tnt;
    if (tc) {
      if (typeof tc.damageMul === 'number') T.tntDamageMul = tc.damageMul;
      else if (typeof tc.tntDamageMul === 'number') T.tntDamageMul = tc.tntDamageMul;
    }
    // 契约键名是 tuning.luckyTNTTotalMax，模块内的量叫 T.luckyTNTTotalMax
    if (t && typeof t.luckyTNTTotalMax === 'number') T.luckyTNTTotalMax = Math.max(0, Math.round(t.luckyTNTTotalMax));
    if (t && typeof t.luckyTNTSide === 'number') T.luckyTNTSide = Math.max(1, Math.round(t.luckyTNTSide));
    if (t && typeof t.tntMaxFuses === 'number') T.maxFuses = Math.max(1, Math.round(t.tntMaxFuses));
    // 幸运掉落的引线在 tuning 里（tnt.fuseSec 只管玩家放置的那一种）
    if (t && typeof t.luckyTNTFuseSec === 'number' && t.luckyTNTFuseSec > 0) T.luckyTNTFuse = t.luckyTNTFuseSec;
    if (BM.bus && BM.bus.on) {
      BM.bus.on('block:layer', onLayerChain);
  BM.bus.on('block:break', onBreak);
      BM.bus.on('block:layer', rollLuckyTNT);   // 每打穿一层掷一次幸运 TNT
      BM.bus.on('block:layer', onResonanceLayer);   // v6 地心共振：打穿一层 +1
      BM.bus.on('block:empty', onResonanceLayer);   // 整格挖空的最后一层同样算 1 层
    }
    reset();
  }

  function reset() {
    stats.broken = 0; stats.maxCombo = 0; stats.maxChain = 0; stats.explosions = 0; stats.executes = 0;
    combo = 0; comboT = 0;
    frenzyLeft = 0; frenzyCount = 0; frenzyMult = 1;
    cd = 0; cdTotal = 0; holding = false;
    chainQueue.length = 0; chainUsed.length = 0;
    chainIdx = 0; swingCount = 0; hasSwing = false;
    fuses.length = 0;
    luckyUsed = 0;
    resonanceCount = 0;
    resonanceUsed = 0;
    resonating = false;
    executing = false;
    freshMods();
    aim.ok = false;
  }

  function setZone(zoneCfg) {
    zone = zoneCfg || null;
    reset();
  }

  function setAim(px, py) {
    if (typeof px !== 'number' || typeof py !== 'number') return;
    aim.x = px; aim.y = py;
    var G = grid();
    var b = (G && G.at) ? G.at(px, py) : null;
    aim.ok = !!b;
  }

  function release() { holding = false; }
  function setHold(v) { holding = !!v; }
  function ready() { return cd <= 1e-6; }

  function attack(tool, px, py, opts) {
    opts = opts || {};
    if (typeof px !== 'number' || typeof py !== 'number') return false;
    var t = resolveTool(tool);
    if (!t) return false;
    var G = grid();
    if (!G || !G.at) return false;

    // 输入方式与工具无关：点按 = 打一发，按住 = 由 update() 按同一节拍自动连发。
    // tool.mode 只描述文案/表现，不再分叉输入路径。
    holding = opts.hold === true;
    aim.x = px; aim.y = py;

    var b = G.at(px, py);
    aim.ok = !!b;
    // 单一节拍：interval 冷却同时约束「点按」与「按住」。
    // 落在频率之外的点击直接丢弃（不排队、不缓存、不报错），只更新瞄准。
    if (cd > 1e-6) return false;
    if (!b) return false;                 // 空点不计冷却

    freshMods();
    lastTool = t;
    var cells = hitCells(t, b);
    var payload = [];
    var live = [];
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].broken) continue;
      payload.push({ ox: cells[i].ox, oy: cells[i].oy });
      live.push(cells[i]);
    }
    if (!payload.length) return false;
    var aimX = b.x + b.s * 0.5;
    var aimY = b.y + b.s * 0.5;
    emit('tool:swing', { tool: t.id, cells: payload, x: aimX, y: aimY, dir: -Math.PI / 2 });
    // 每种武器有自己的表现事件：激光每次结算派发 laser:tick
    if (isLaser(t)) {
      emit('laser:tick', { x: aimX, y: aimY, cells: payload.length, h: payload.length });
    }

    var interval = Math.max(0, num(t.interval, 0));
    var mul = num(modsObj().holdIntervalMul, 1);
    if (!(mul > 0)) mul = 1;
    cdTotal = interval * mul;
    cd = cdTotal;                         // 点按与按住共用这一份节拍（木镐 interval=0 → 不受限）

    var dmg = toolDamage(t);
    liveChainDmg = dmg;
    beginSwing();
    applyingChain = false;
    for (var j = 0; j < live.length; j++) {
      var cb = live[j];
      if (cb.broken) continue;
      G.damage(cb, splashDamage(dmg, splashMul(t, cb, b)), -Math.PI / 2);
    }
    // v9 处决：伤害结算完再判阈值（damage 已把这层打血的格子不再是「有血的命中格」）
    for (var k = 0; k < live.length; k++) {
      if (live[k].broken) continue;
      tryExecute(live[k]);
    }
    if (!chainQueue.length && hasSwing) finishSwing();
    return true;
  }

  // main 在按住期间每帧调用：只记录瞄准并置 holding，节奏由 ready()/冷却控制。
  // 四种工具一视同仁——任何工具按住都会按自己的 interval 连发。
  function holdAttack(px, py, now, tool) {
    var t = tool ? resolveTool(tool) : lastTool;
    if (t) lastTool = t;
    if (typeof px === 'number' && typeof py === 'number') { aim.x = px; aim.y = py; }
    if (!t) return false;
    return attack(t, aim.x, aim.y, { hold: true, now: now });
  }

  function update(dt, now) {
    if (!(dt > 0)) dt = 0;
    spin += dt * T.spinSpeed;
    if (cd > 0) { cd -= dt; if (cd < 0) cd = 0; }
    if (combo > 0) {
      comboT += dt;
      // v17：连击断档保底 —— 不清零，而是退一档（后期多格工具打起来不会突然泄气）
      if (comboT >= T.comboWindow) { combo = Math.max(0, combo - 1); comboT = 0; emit('combo:update', { combo: combo, mult: comboMult() }); }
    }
    if (frenzyLeft > 0) {
      frenzyLeft -= dt;
      if (frenzyLeft <= 0) { frenzyLeft = 0; frenzyMult = 1; emit('frenzy:end', {}); }
    }
    if (fuses.length) stepFuses(dt);
    if (chainQueue.length) stepChain(dt);
    // 按住连发：不看 mode，只看节拍（cd 由 interval × holdIntervalMul 决定）
    if (holding && cd <= 1e-6 && lastTool && aim.ok) {
      attack(lastTool, aim.x, aim.y, { hold: true, now: now });
    }
  }

  /* ---------------- 绘制 ---------------- */

  function draw(c) {
    c = c || ctx;
    if (!c) return;
    var i;

    // 引信落点预览已随放置 TNT 删除：白掉的 TNT 的金框 / 长引信由表现层（lucky:tnt）负责


    if (!aim.ok) return;
    var G = grid();
    var b = (G && G.at) ? G.at(aim.x, aim.y) : null;

    var tool = lastTool;
    c.save();
    c.lineWidth = 2;
    if (b && !b.broken) {
      c.strokeStyle = 'rgba(255,224,150,0.85)';
      c.strokeRect(b.x + 2, b.y + 2, b.s - 4, b.s - 4);
    }
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.beginPath();
    c.moveTo(aim.x - 9, aim.y); c.lineTo(aim.x - 3, aim.y);
    c.moveTo(aim.x + 3, aim.y); c.lineTo(aim.x + 9, aim.y);
    c.moveTo(aim.x, aim.y - 9); c.lineTo(aim.x, aim.y - 3);
    c.moveTo(aim.x, aim.y + 3); c.lineTo(aim.x, aim.y + 9);
    c.stroke();
    var n = chainQueue.length;
    if (n) {
      c.setLineDash(DASH);
      c.lineWidth = 1.5;
      c.strokeStyle = 'rgba(255,150,80,0.9)';
      for (i = 0; i < n; i++) {
        var cb = chainQueue[i].b;
        if (cb && !cb.broken) c.strokeRect(cb.x + 3, cb.y + 3, cb.s - 6, cb.s - 6);
      }
      c.setLineDash(NO_DASH);
    }
    if (holding && cd > 0 && cdTotal > 0) {
      var p = 1 - cd / cdTotal;
      var r = (b ? b.s * 0.62 : 16);
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(120,230,255,0.9)';
      c.beginPath();
      c.arc(aim.x, aim.y, r, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
      c.stroke();
    }
    // 纵向工具的下探锯齿（贴图之外的纯几何手感辅助）
    if (tool && tool.shape === 'column' && holding && b && !b.broken) {
      var cx = b.x + b.s * 0.5;
      var y0 = b.y + b.s * 0.18;
      var span = b.s * (1 + columnExtra(tool));
      var seg = span / 5;
      var wob = Math.sin(spin) * b.s * 0.1;
      c.lineWidth = 2;
      c.strokeStyle = 'rgba(255,190,120,0.92)';
      c.beginPath();
      c.moveTo(cx + wob, y0);
      for (var s2 = 1; s2 <= 5; s2++) {
        c.lineTo(cx + (s2 % 2 ? 1 : -1) * b.s * 0.16, y0 + seg * s2);
      }
      c.stroke();
    }
    c.restore();
  }

  BM.TOOLS = {
    init: init,
    reset: reset,
    setZone: setZone,
    ready: ready,
    attack: attack,
    update: update,
    draw: draw,
    holdAttack: holdAttack,
    release: release,
    setHold: setHold,
    setAim: setAim,
    stats: stats,
    tuning: T,
    get luckyUsed() { return luckyUsed; },
    get luckyMax() { return T.luckyTNTTotalMax; },
    get tntDamage() { return tntDamage(); },
    get tntPierce() { return tntPierce(); },
    get fuses() { return fuses.length; },
    get frenzyMult() { return frenzyMult; },
    get frenzyLeft() { return frenzyLeft; },
    get frenzyCount() { return frenzyCount; },
    get combo() { return combo; },
    get resonanceCount() { return resonanceCount; },
    get resonanceUsed() { return resonanceUsed; },
    get resonanceMax() { return T.resonanceCap; },
    get resonanceThreshold() { return resonanceThreshold(); },
    get execThreshold() { return execThreshold(); },
    get executes() { return stats.executes; },
    get holding() { return holding; },
    get zone() { return zone; }
  };
})();
