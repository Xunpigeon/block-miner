/* 05-drops.js —— 掉落物：每打穿一层掉那一层的矿（drop/richDrop 直接口径，富矿再 × mods.richMul），
   BALANCE-V4 §4：每层 1 个 / 富矿 2 个，收益靠单价与层数，不叠乘 dropMul / 狂热等额外倍率；
   抛物散开 → 磁吸 → 入包；上限合并绝不丢数量 */
(function () {
  'use strict';

  var BM = window.BM = window.BM || {};

  var TARGET_X = 195, TARGET_Y = 70;   // HUD 资源栏
  var MAX_ITEMS = 240;                 // 场上掉落上限
  var BASE_SPEED = 900;                // 磁吸基速（设计空间像素/秒）
  var FLY_MIN = 0.35, FLY_MAX = 0.6;   // 抛物散开时长
  var GRAVITY = 700;
  var DAMP = 6;                        // 抛物阻尼
  var ABSORB_PAD = 12;                 // 到达判定的额外半径

  var items = [];
  var counts = {};                     // ore -> number，始终是同一个对象引用
  var modsCache = null;

  // 同帧去重：一次打穿只掉一份。GRID 对同一次打穿可能广播两条事件
  // （break + empty，或某些实现下 layer + empty），键 = ox,oy,被打碎层号；
  // 换帧清空，因此 TNT 同帧连穿多层仍各掉各的。
  var frameId = 0;
  var seenFrame = -1;
  var seen = null;

  var view = { ore: 'stone', rich: false, x: 0, y: 0, s: 0 };   // 事件取数视图，不每层新建对象

  // 掉落物贴图（00-art.js → BM.ART）。键与句柄都按 ore 缓存一次，draw 内不拼字符串、不产生垃圾；
  // 查不到（未解码 / 键缺失）返回 null，draw 回退到原来的方块绘制。
  var artKeys = Object.create(null), artImgs = Object.create(null);

  /* ---- 金矿（v10）：没有独立美术，复用煤矿掉落图并「金色化」 ----
     源键优先 drops.coal，缺图再退 fx.chip.coal；金色化结果在开局/每局 reset 时预生成一次
     （离屏 canvas 按亮度重映射到 #7a5418 → #c8912e → #ffc857），draw 内只读缓存。
     goldRamp 是纯函数（共享输出数组），测试用它断言金色区间。 */
  var GOLD_ORE = 'gold';
  var GOLD_ART_KEYS = ['drops.coal', 'fx.chip.coal'];
  var GOLD_DEEP = [122, 84, 24];
  var GOLD_MID = [200, 145, 46];
  var GOLD_BRIGHT = [255, 200, 87];
  var goldOut = [0, 0, 0];
  var goldImg = null;
  var goldOwner = null;

  function goldRamp(r, g, b) {
    var L = (r * 299 + g * 587 + b * 114) / 255000;
    if (!(L > 0)) L = 0; else if (L > 1) L = 1;
    var a, c, k;
    if (L <= 0.5) { a = GOLD_DEEP; c = GOLD_MID; k = L * 2; }
    else { a = GOLD_MID; c = GOLD_BRIGHT; k = (L - 0.5) * 2; }
    goldOut[0] = Math.round(a[0] + (c[0] - a[0]) * k);
    goldOut[1] = Math.round(a[1] + (c[1] - a[1]) * k);
    goldOut[2] = Math.round(a[2] + (c[2] - a[2]) * k);
    return goldOut;
  }

  function newCanvas(w, h) {
    var cv = null;
    if (typeof document !== 'undefined' && document && typeof document.createElement === 'function') {
      try { cv = document.createElement('canvas'); } catch (e) { cv = null; }
    }
    if (!cv) return null;
    cv.width = w;
    cv.height = h;
    return cv;
  }

  function tintGold(src) {
    var w = src ? (src.naturalWidth || src.width) : 0;
    var h = src ? (src.naturalHeight || src.height) : 0;
    if (!(w > 0) || !(h > 0)) return null;
    var cv = newCanvas(w, h);
    if (!cv || typeof cv.getContext !== 'function') return null;
    var g = cv.getContext('2d');
    if (!g || typeof g.drawImage !== 'function' || typeof g.getImageData !== 'function') return null;
    var img = null;
    try {
      g.drawImage(src, 0, 0);
      img = g.getImageData(0, 0, w, h);
    } catch (e) { return null; }
    var d = img && img.data;
    if (!d || d.length < w * h * 4) return null;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var c = goldRamp(d[i], d[i + 1], d[i + 2]);
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
    }
    try { g.putImageData(img, 0, 0); } catch (e) { return null; }
    return cv;
  }

  // 预生成（开局 / 每局 reset 各试一次；拿到图就固定下来，draw 内不再做任何解码/着色）
  function buildGoldDrop() {
    var A = BM.ART;
    if (goldOwner !== A) { goldOwner = A; goldImg = null; }
    if (goldImg || !A || !A.one) return;
    for (var i = 0; i < GOLD_ART_KEYS.length; i++) {
      var src = null;
      try { src = A.one(GOLD_ART_KEYS[i], 0); } catch (e) { src = null; }
      if (!src) continue;
      var t = tintGold(src);
      if (t) { goldImg = t; return; }
    }
  }

  function dropArt(ore) {
    if (ore === GOLD_ORE) {
      if (!goldImg) buildGoldDrop();
      return goldImg;
    }
    var img = artImgs[ore];
    if (img) return img;
    var A = BM.ART;
    if (!A || !A.one) return null;
    var key = artKeys[ore];
    if (key === undefined) { key = 'drops.' + ore; artKeys[ore] = key; }
    img = A.one(key, 0) || null;
    if (img) artImgs[ore] = img;
    return img;
  }

  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function emit(type, data) { var bus = BM.bus; if (bus && bus.emit) bus.emit(type, data); }

  function modsObj() {
    if (modsCache) return modsCache;
    var m = null;
    try { m = (BM.CORE && BM.CORE.mods) ? BM.CORE.mods() : null; } catch (e) { m = null; }
    modsCache = m || {};
    return modsCache;
  }

  function oreCfg(id) {
    var ores = (BM.CONFIG && BM.CONFIG.ores) || {};
    return ores[id] || null;
  }

  function randInt(a, b) {
    a = Math.round(num(a, 1));
    b = Math.round(num(b, a));
    if (b < a) { var t = a; a = b; b = t; }
    return a + Math.floor(Math.random() * (b - a + 1));
  }

  // drop / richDrop 允许写成 [min,max] 或单值（CONTRACT-V3 §2 的表格是单值，如铁 3/5、晶 2/4）
  function rangeNums(range, fallback) {
    if (typeof range === 'number' && isFinite(range)) return [range, range];
    if (range && range.length) {
      var lo = Math.round(num(range[0], fallback[0]));
      var hi = Math.round(num(range[1], lo));
      return hi < lo ? [hi, lo] : [lo, hi];
    }
    return fallback;
  }

  // 普通 = rand(drop) + dropFlat；富矿 = rand(richDrop) + dropFlat（richDrop 本身就是富矿口径）。
  // BALANCE-V4 §4：不再乘 dropMul / 狂热倍率等任何额外倍率；只有富矿格额外 × mods.richMul（富矿天赋），
  // dropFlat 是加法不是倍率。向下取整，最低 1。
  function amountFor(block) {
    var o = oreCfg(block.ore);
    if (!o) return 1;
    var m = modsObj();
    var base = rangeNums(o.drop, [1, 1]);
    var range = block.rich ? rangeNums(o.richDrop, base) : base;
    var n = randInt(range[0], range[1]) + num(m.dropFlat, 0);
    if (block.rich) n = n * num(m.richMul, 1);
    n = Math.floor(n);
    return n < 1 ? 1 : n;
  }

  function credit(ore, amount) {
    counts[ore] = (counts[ore] || 0) + amount;
  }

  // 超限时把数量并进最近同矿种掉落；没有同矿种就直接入包，绝不丢
  function mergeIntoNearest(ore, amount, x, y) {
    var best = -1, bestD = Infinity;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.ore !== ore) continue;
      var dx = it.x - x, dy = it.y - y;
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { items[best].amount += amount; return; }
    credit(ore, amount);
    emit('drop:absorb', { ore: ore, amount: amount, x: x, y: y });
  }

  function pushItem(ore, amount, x, y, rich) {
    if (items.length >= MAX_ITEMS) { mergeIntoNearest(ore, amount, x, y); return; }
    var o = oreCfg(ore) || {};
    var ang = Math.random() * Math.PI * 2;
    var spd = 90 + Math.random() * 170;
    items.push({
      ore: ore, amount: amount,
      x: x, y: y, px: x, py: y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 70,
      t: 0,
      fly: FLY_MIN + Math.random() * (FLY_MAX - FLY_MIN),
      rich: !!rich,
      color: o.vein || '#ffb066',
      glow: o.glow || o.vein || '#ffe0b0'
    });
  }

  function dropAt(ore, rich, x, y, amount) {
    emit('drop:spawn', { ore: ore, amount: amount, x: x, y: y, rich: !!rich });
    pushItem(ore, amount, x, y, rich);
    return amount;
  }

  function spawnForBlock(block) {
    if (!block) return 0;
    modsCache = null;                 // 每格刷新一次数值，升级/狂热立刻生效
    var amount = amountFor(block);
    var x = num(block.x, 0) + num(block.s, 0) * 0.5;
    var y = num(block.y, 0) + num(block.s, 0) * 0.5;
    return dropAt(block.ore, block.rich, x, y, amount);
  }

  // 被打碎那一层的数据：契约给的 prev 优先，其次 GRID 内部层栈，最后退回 block 自身（v1 旧派发）
  function layerData(p, layerNo) {
    if (p.prev && typeof p.prev.ore === 'string') return p.prev;
    var b = p.block;
    if (b && b.stack && layerNo >= 0 && b.stack[layerNo]) return b.stack[layerNo];
    return b;
  }

  // true = 这一层本帧已经掉过，跳过
  function duplicate(b, layerNo) {
    if (typeof b.ox !== 'number' || typeof b.oy !== 'number') return false;
    if (!(layerNo >= 0)) return false;
    if (seenFrame !== frameId) { seen = Object.create(null); seenFrame = frameId; }
    var k = b.ox + ',' + b.oy + ',' + layerNo;
    if (seen[k]) return true;
    seen[k] = 1;
    return false;
  }

  // block:layer / block:break / block:empty 共用：谁先到谁掉，同帧同层只掉一次
  function onPunch(p) {
    var b = p && p.block;
    if (!b) return 0;
    var depth = num(b.depth, -1);              // GRID 在派发前已 depth += 1
    var layerNo = depth - 1;
    if (duplicate(b, layerNo)) return 0;
    modsCache = null;
    var src = layerData(p, layerNo);
    view.ore = src.ore;
    view.rich = !!src.rich;
    view.x = num(b.x, 0);
    view.y = num(b.y, 0);
    view.s = num(b.s, 0);
    var amount = amountFor(view);
    return dropAt(view.ore, view.rich, view.x + view.s * 0.5, view.y + view.s * 0.5, amount);
  }

  function absorbAt(i) {
    var it = items[i];
    credit(it.ore, it.amount);
    emit('drop:absorb', { ore: it.ore, amount: it.amount, x: TARGET_X, y: TARGET_Y });
    var last = items.length - 1;
    if (i !== last) items[i] = items[last];
    items.pop();
  }

  function update(dt) {
    frameId++;
    if (!items.length) return;
    if (!(dt > 0)) return;
    var m = modsObj();
    var speed = BASE_SPEED * Math.max(0.01, num(m.magnetSpeedMul, 1));
    var damp = Math.exp(-DAMP * dt);
    var step = speed * dt;
    for (var i = items.length - 1; i >= 0; i--) {
      var it = items[i];
      it.px = it.x; it.py = it.y;
      if (it.t < it.fly) {
        it.t += dt;
        it.vy += GRAVITY * dt;
        it.x += it.vx * dt;
        it.y += it.vy * dt;
        it.vx *= damp;
        it.vy *= damp;
        if (it.t >= it.fly) {
          it.t = it.fly;
          emit('magnet:burst', { x: it.x, y: it.y });   // 抛物结束、开始磁吸的瞬间
        }
        continue;
      }
      var dx = TARGET_X - it.x, dy = TARGET_Y - it.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= step + ABSORB_PAD) { absorbAt(i); continue; }
      var k = step / dist;
      it.x += dx * k;
      it.y += dy * k;
    }
  }

  function draw(c) {
    var n = items.length;
    if (!n || !c) return;
    c.save();
    for (var i = 0; i < n; i++) {
      var it = items[i];
      var s = it.rich ? 9 : 7;
      var h = s * 0.5;
      var img = dropArt(it.ore);
      // 拖尾亮线（同色，不引图）
      c.globalAlpha = 0.35;
      c.strokeStyle = it.color;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(it.px, it.py);
      c.lineTo(it.x, it.y);
      c.stroke();
      // 晶体：有贴图用 16×16 原图（按 1.5 倍盒边绘制，保持旧方块的视觉重量），否则回退方块
      c.globalAlpha = 1;
      if (img) {
        var dw = s * 1.5, dh = s * 1.5;
        c.drawImage(img, it.x - dw * 0.5, it.y - dh * 0.5, dw, dh);
      } else {
        c.fillStyle = it.color;
        c.fillRect(it.x - h, it.y - h, s, s);
        c.strokeStyle = it.glow;
        c.lineWidth = 1;
        c.strokeRect(it.x - h + 0.5, it.y - h + 0.5, s - 1, s - 1);
      }
    }
    c.globalAlpha = 1;
    c.restore();
  }

  function absorbAll() {
    if (!items.length) return;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      credit(it.ore, it.amount);
      emit('drop:absorb', { ore: it.ore, amount: it.amount, x: it.x, y: it.y });
    }
    items.length = 0;
  }

  function reset() {
    buildGoldDrop();               // 金矿掉落图：每局开局补一次（美术解码晚于 init 也能补上）
    items.length = 0;
    for (var k in counts) { if (Object.prototype.hasOwnProperty.call(counts, k)) delete counts[k]; }
    modsCache = null;
    seen = null;
    seenFrame = -1;
    frameId = 0;
  }

  function init() {
    buildGoldDrop();
    if (BM.bus && BM.bus.on) {
      BM.bus.on('block:layer', onPunch);     // 打穿一层（block 已换新层，掉落取 prev）
      BM.bus.on('block:break', onPunch);     // 整格挖空
      BM.bus.on('block:empty', onPunch);     // 同上，与 break 同帧去重
    }
    reset();
  }

  BM.DROPS = {
    init: init,
    reset: reset,
    spawnForBlock: spawnForBlock,
    update: update,
    draw: draw,
    absorbAll: absorbAll,
    counts: counts,
    target: { x: TARGET_X, y: TARGET_Y },
    get inFlight() { return items.length; },
    _goldRamp: goldRamp,
    _goldSrcKeys: GOLD_ART_KEYS.slice(),
    get _goldImg() { return goldImg; },
    get maxItems() { return MAX_ITEMS; }
  };
})();
