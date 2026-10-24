/* 06-fx.js — 视觉爽感层：对象池粒子 / 震屏 / 闪白 / 命中停顿（全部由 bus 事件驱动） */
(function () {
  'use strict';

  var BM = window.BM || (window.BM = {});

  // 粒子上限：high 900 / mid 400 / low 180
  var CAP = { high: 900, mid: 400, low: 180 };
  var Q_DEBRIS = { high: 1, mid: 0.72, low: 0.35 };
  var Q_DUST = { high: 1, mid: 0.7, low: 0.32 };
  var Q_FLASH = { high: 1, mid: 0.7, low: 0 };

  var HS_SCALE = 0.06;      // 命中停顿期间的 timeScale
  var SHAKE_MAX = 18;       // 震屏幅度硬上限（设计空间像素）
  // v9 碎层爽感：震屏随本局累计碎层小幅上升，最多 +40%
  var SHAKE_MUL_MAX = 1.4;
  var SHAKE_MUL_PER = 0.002;
  // v9b 连环炸（docs/V9-JUICE.md §4）：一次连环里同屏 TNT >= 3 颗时，
  // 震屏倍率按「同屏 TNT 数」再放大（封顶仍是 SHAKE_MUL_MAX = 1.4），火花数量线性放大。
  var CHAIN_TNT_AT = 3;      // 同屏 3 颗起算连环
  var CHAIN_SHAKE_STEP = 0.1;
  var CHAIN_SPARK_STEP = 0.3;
  var CHAIN_WINDOW = 2.4;    // 超过 2.4 秒没有新爆炸 = 连环结束（幸运引线 1.8 秒 + 余量）
  var EXEC_SPARK_MIN = 8, EXEC_SPARK_MAX = 12;   // tool:execute 的金色十字火花数
  var EXEC_FLASH = 0.34, EXEC_FLASH_DUR = 1 / 30;   // 处决白闪：只亮 1 帧（60fps 下 dt=1/60 刚好在此内）
  var FLASH_MAX = 0.45;     // 全屏闪白硬上限，保证倒计时可读
  var HUD_X = 195, HUD_Y = 70;
  var CX = 195, CY = 422;   // 连击放射兜底原点：超过 HIT_MEMORY 没有命中才回退到这里
  var HIT_MEMORY = 1.5;     // 最近命中点的记忆时长（秒）
  var BNC_N = 10;           // 打穿一层的上弹提示槽位数
  var CELL_MAX = 25;        // 爆炸逐格碎裂最多参与格数
  var FUSE_SPARK_MAX = 128; // 单次引信最多冒出的火花数
  // v3：激光 / 震荡器 / 幸运 TNT
  var BEAM_LIFE = 0.2;      // 光束对象寿命：激光 tick 间隔 0.15s，靠刷新寿命做到不断线
  var BEAM_FADE = 0.08;     // 寿命末尾 80ms 淡出（契约要求 60~120ms）
  var BEAM_S_DEF = 58;      // 缺格尺寸时的默认格宽（棋盘 370 / 6 列）
  var BEAM_SPARK_N = 4;     // 顶端 / 末端每 tick 各喷的火花数
  var QUAKE_BASE = 24;      // 冲击波基准半径 R = 24 + sqrt(cells) * 6
  var QUAKE_PER = 6;        // 7×7(49) → 66px，9×9(81) → 78px，两档肉眼可分
  var QUAKE_R_MAX = 190;
  var QUAKE_CELL_MAX = 400;  // cells 计数钳制
  // v6：地心共振 / 宝藏开箱
  var RES_R = 470;              // 冲击波最大半径：中心(195,422) 到 390×844 最远角 ≈ 465
  var RES_RINGS = 3;            // 中心 3 层环
  var RES_FLASH = 0.35;         // 白闪
  var RES_SHAKE = 18;           // 震屏（= SHAKE_MAX 硬上限）
  var RES_PER_CELL = 3;         // 每格 ≈ 3 片碎屑，按 cells 比例分
  var RES_DEBRIS_MAX = 240;     // 单次共振碎屑上限（再往上由粒子池顶掉）
  var RES_DUST_N = 26;          // 中心尘团
  var TR_SPARK_MIN = 40, TR_SPARK_MAX = 60;   // 开箱金色粒子区间
  var TR_PILLARS = 8;           // 一圈金色光柱根数
  var TR_MOTES = 5;             // 每根光柱叠几颗金色微光
  var LK_N = 3;             // 空中幸运 TNT 槽位（模块加载时一次性分配）
  var LK_FLY = 0.26;        // 弹入飞行时间
  var LK_S = 20;            // 金框小炸药盒边长
  var LK_TRAIL_IV = 0.02;   // 拖影采样间隔
  var TAU = 6.2831853;
  var FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
  var FONT_N = 'bold 16px ' + FONT;
  var FONT_B = 'bold 21px ' + FONT;
  var FONT_S = 'bold 13px ' + FONT;

  // 粒子种类（数值常量，绘制时 switch 分发）
  var K_DUST = 1, K_CHIP = 2, K_SPARK = 3, K_RING = 4, K_SHOCK = 5,
      K_TEXT = 6, K_MOTE = 7, K_RIPPLE = 8, K_GLINT = 9, K_RADIAL = 10, K_BEAM = 11;

  // 回收优先级：数值小 = 先被回收（碎屑 → 碎片 → 跳字）
  var PRI = [];
  PRI[K_DUST] = 0; PRI[K_CHIP] = 1; PRI[K_SPARK] = 2; PRI[K_RING] = 2; PRI[K_SHOCK] = 2;
  PRI[K_MOTE] = 2; PRI[K_RIPPLE] = 2; PRI[K_GLINT] = 2; PRI[K_RADIAL] = 3; PRI[K_TEXT] = 4;
  PRI[K_BEAM] = 3;   // 光束只被跳字顶掉，不会被碎屑洪水冲掉

  // 颜色一律用字符串常量，绘制时只做引用赋值，不拼接，不产生每帧垃圾
  // 矿物碎屑配色（方块向，硬边多边形、无渐变）：石底 / 深灰斑 / 煤黑 / 铁米褐
  var C_STONE = '#7d7d7d', C_STONE_D = '#5a5a5a', C_STONE_L = '#9a9a9a';
  var C_ORE_COAL = '#171717', C_ORE_COAL_L = '#3a3a3a';
  var C_ORE_IRON = '#d8b98a', C_ORE_IRON_D = '#a9855c';
  var C_ACC_STONE = '#c6c6c6', C_ACC_COAL = '#b9c6d2', C_ACC_IRON = '#d8b98a';
  var C_TNT = '#e8412c', C_TNT_L = '#ff8a6a', C_FUSE_SPARK = '#ffd05a';
  var C_SPARK = '#ffd48a', C_SPARK_HOT = '#fffbe8';
  var C_DUST = '#b8c2cc', C_DUST_D = '#7d868f';
  var C_RING = '#ffeec0', C_RING_HOT = '#ffffff';
  var C_GOLD = '#ffd35c', C_GOLD_L = '#fff0b8';
  var C_EXEC = '#ffcf4a', C_EXEC_HOT = '#fff8d8';   // v9 处决：金色十字火花
  var C_TXT_STONE = '#e2e2e2', C_TXT_COAL = '#cfe0f5', C_TXT_IRON = '#ffca94';
  // v3 晶石：紫青三色碎屑（硬边多边形、无渐变）
  var C_ORE_CRYSTAL = '#a8e8ff', C_ORE_CRYSTAL_D = '#6fd8e0', C_ORE_CRYSTAL_DD = '#2f6f7a';
  var C_ACC_CRYSTAL = '#a8e8ff', C_TXT_CRYSTAL = '#cdf3ff';
  // 激光三层叠色：核心亮线 + 内侧辉光 + 外侧辉光（矩形叠层，不用 blur）
  var C_LASER = '#eafcff', C_LASER_SPARK = '#a8e8ff';
  var C_LASER_MID = 'rgba(168,232,255,0.55)', C_LASER_OUT = 'rgba(111,216,224,0.30)';

  // 五边形碎片的单位半径模板（预分配，绘制时不会新建数组）
  var SHX = [], SHY = [];
  (function () {
    for (var k = 0; k < 5; k++) {
      var a = k * 1.2566371;
      SHX.push(Math.cos(a));
      SHY.push(Math.sin(a));
    }
  })();
  var SH_R = [
    [1, 0.82, 0.95, 0.7, 0.88],
    [0.9, 1, 0.75, 0.92, 0.8],
    [0.86, 0.94, 1, 0.78, 0.9]
  ];

  var pool = [], free = [], cap = 0, alive = 0, peak = 0;
  var quality = 'high';
  var inited = false;
  var timeScale = 1, hitstopTimer = 0;
  var shakeAmp = 0, shakeDur = 0, shakeT = 0, shakeX = 0, shakeY = 0;
  var layersThisRound = 0;                        // 本局累计碎层（block:layer + block:break）
  var tntChainMul = 1;                            // 它带来的震屏再放大（1 ~ 1.4）
  var lastBoomClock = -1e9;                       // 最近一次爆炸的时刻（连环窗口判据）
  var chainInfo = { tnt: 1, shake: 1, sparks: 1 }; // 最近一次爆炸的连环读数（测试/调试可读）
  var execInfo = { count: 0, x: 0, y: 0, sparks: 0 };   // 最近一次 tool:execute 的读数
  var flashA = 0, flashDur = 0, flashT = 0, flashAlpha = 0;
  var comboLevel = 0, heat = 0;
  var frenzyTimer = 0, frenzyFade = 0, frenzyMul = 1, moteAcc = 0;
  var clock = 0;
  // 最近一次 block:hit / block:layer 的方块中心，连击放射从它发出（修 v1 固定从屏幕中心冒火花的 BUG）
  var lastHitX = CX, lastHitY = CY, lastHitT = -1e9;
  var lastFullBlock = null, lastFullClock = -1;   // block:break 与 block:empty 同帧去重
  var lastFullOx = -1, lastFullOy = -1;
  var fuseOn = 0, fuseX = 0, fuseY = 0, fuseT = 0, fuseDelay = 0.8;
  var fuseCells = 0, fuseAcc = 0, fuseSparks = 0;
  var lb = { cx: CX, top: 0, bot: 0, s: BEAM_S_DEF };   // 激光几何复用对象，draw/update 都不新建
  var lk = [];                                          // 幸运 TNT 空中槽位
  for (var lki = 0; lki < LK_N; lki++) {
    lk.push({ on: 0, t: 0, d: LK_FLY, x0: 0, y0: 0, x: 0, y: 0, tx: 0, ty: 0, delay: 0.45, acc: 0 });
  }
  var SPR_WHITE = null, SPR_GOLD = null, spriteTried = false;

  // 美术贴图（00-art.js → BM.ART）：键一律用 manifest 常量；未解码 / 键缺失时返回 null，
  // 调用方一律回退到下面的程序化绘制。解析结果按槽缓存，就绪后 draw 内不再访问 ART，也不拼字符串。
  var KEY_SPARK = 'fx.spark', KEY_DUST = 'fx.dust', KEY_STAR = 'fx.star', KEY_TNT_GOLD = 'fx.tnt_gold';
  var CHIP_KEY = { stone: 'fx.chip.stone', coal: 'fx.chip.coal', iron: 'fx.chip.iron', crystal: 'fx.chip.crystal', gold: 'fx.chip.coal' };
  var IMG_SPARK = null, IMG_DUST = null, IMG_STAR = null, IMG_TNT_GOLD = null;
  var IMG_DEEP = null;                     // fx.deep_ring（深核钻机 9×9 冲击波贴图）
  // 深核钻机的一次性环形贴图：{ 剩余时间, 总时长, 圆心, 半径 }
  var deepRing = { t: 0, max: 0, x: 0, y: 0, R: 0, hot: 0 };
  var CHIP_IMG = {
    stone: [null, null, null, null], coal: [null, null, null, null],
    iron: [null, null, null, null], crystal: [null, null, null, null]
  };

  function artOne(key, idx) {
    var A = BM.ART;
    if (!A || !A.one) return null;
    return A.one(key, idx) || null;
  }

  // 碎屑贴图按 ore + 形状变体缓一槽：fx.chip.* 是多张数组，避免每帧重复筛选
  function chipArt(ore, idx) {
    var slot = CHIP_IMG[ore] || CHIP_IMG.stone;
    var im = slot[idx];
    if (im) return im;
    im = artOne(CHIP_KEY[ore] || CHIP_KEY.stone, idx);
    if (im) slot[idx] = im;
    return im;
  }
  function sparkArt() { if (!IMG_SPARK) IMG_SPARK = artOne(KEY_SPARK, 0); return IMG_SPARK; }
  function dustArt() { if (!IMG_DUST) IMG_DUST = artOne(KEY_DUST, 0); return IMG_DUST; }
  function starArt() { if (!IMG_STAR) IMG_STAR = artOne(KEY_STAR, 0); return IMG_STAR; }
  function deepArt() { if (!IMG_DEEP) IMG_DEEP = artOne('fx.deep_ring', 0); return IMG_DEEP; }
  function tntGoldArt() { if (!IMG_TNT_GOLD) IMG_TNT_GOLD = artOne(KEY_TNT_GOLD, 0); return IMG_TNT_GOLD; }

  // 方块内闪：固定 16 槽，模块加载时一次性分配
  var BF_N = 16, bf = [];
  for (var bi = 0; bi < BF_N; bi++) bf.push({ on: 0, x: 0, y: 0, s: 0, t: 0, d: 0.08 });

  // 打穿一层时的上弹提示：固定槽位，模块加载时一次性分配
  var bnc = [];
  for (bi = 0; bi < BNC_N; bi++) bnc.push({ on: 0, x: 0, y: 0, s: 0, t: 0, d: 0.18, lift: 4 });

  var stats = { alive: 0, peak: 0, cap: 0 };
  // v6 表现层的最近一次读数（复用对象，测试与调试可核对半径/震屏值）
  var resInfo = { x: 0, y: 0, cells: 0, R: RES_R, rings: RES_RINGS, shake: RES_SHAKE, flash: RES_FLASH, count: 0 };
  var trInfo = { x: 0, y: 0, sparks: 0, pillars: 0, born: 0, count: 0 };
  var offsetObj = { x: 0, y: 0 };   // 复用同一个对象，main 每帧读取，不产生垃圾
  var hitPoint = { x: CX, y: CY, fresh: 0 };   // 最近命中点快照，同样复用

  // ---------- 对象池 ----------

  function rebuildPool(n) {
    cap = n;
    pool = new Array(n);
    free = [];
    for (var i = n - 1; i >= 0; i--) {
      pool[i] = {
        on: 0, kind: 0, pri: 0, fix: 0, delay: 0,
        x: 0, y: 0, sx: 0, sy: 0, vx: 0, vy: 0, grav: 0,
        life: 0, max: 1, size: 0, grow: 0, rot: 0, vrot: 0,
        col: C_SPARK, alpha: 1, num: 0, oreId: '', ore: '', str: '', state: 0, ground: 0, w: 1
      };
      free.push(i);
    }
    alive = 0;
    peak = 0;
    stats.alive = 0; stats.peak = 0; stats.cap = n;
  }

  function release(i) {
    var p = pool[i];
    if (!p.on) return;
    p.on = 0;
    alive--;
    free.push(i);
  }

  // 池满扫描节流：TNT 连环一帧会碎几百层，每次 spawn 都全池扫描是 O(粒子数²)（实测 4× 降速下单帧 300–900ms）。
  // 一帧只扫一次，记下本帧最低可回收优先级；同帧更低优先级的请求直接拒绝。
  var scanFrame = -1, scanFloor = -1, frameNo = 0;
  function acquire(pri, kind) {
    if (free.length === 0) {
      if (scanFrame === frameNo && pri <= scanFloor) return null;
      // 池满：找到当前最不重要的粒子（按优先级，最老的先走）
      var worst = -1, worstPri = 99, worstLeft = 1e9;
      for (var i = 0; i < cap; i++) {
        var q = pool[i];
        if (!q.on) continue;
        // 先比优先级（碎屑 → 碎片 → 跳字），同优先级回收最接近消亡的那个
        if (q.pri < worstPri || (q.pri === worstPri && q.life < worstLeft)) {
          worstPri = q.pri;
          worstLeft = q.life;
          worst = i;
        }
      }
      if (worst < 0 || worstPri > pri) { scanFrame = frameNo; scanFloor = pri; return null; } // 只允许顶掉更不重要的
      release(worst);
      if (free.length === 0) return null;
    }
    var idx = free.pop();
    var p = pool[idx];
    p.on = 1; p.kind = kind; p.pri = pri; p.fix = 0; p.delay = 0;
    p.x = 0; p.y = 0; p.sx = 0; p.sy = 0; p.vx = 0; p.vy = 0; p.grav = 0;
    p.life = 0.2; p.max = 0.2; p.size = 2; p.grow = 0; p.rot = 0; p.vrot = 0;
    p.col = C_SPARK; p.alpha = 1; p.num = 0; p.oreId = ''; p.ore = ''; p.str = ''; p.state = 0; p.ground = 0; p.w = 1;
    alive++;
    if (alive > peak) peak = alive;
    return p;
  }

  // ---------- 全局效果 ----------

  // 碎层越多手感越沉：1 + 0.002 × 层数，封顶 1.4
  function shakeMulOf(n) {
    if (!(n > 0)) return 1;
    var m = 1 + n * SHAKE_MUL_PER;
    return m > SHAKE_MUL_MAX ? SHAKE_MUL_MAX : m;
  }

  // 碎一层就记一次：block:layer（打穿一层）与 block:break（整格最后一层）各计 1
  function countLayer() {
    layersThisRound++;
    FX.layersThisRound = layersThisRound;
    FX.shakeMul = totalShakeMul();
  }

  // 连环：同屏 TNT 数 → 震屏再放大（3 颗起算，封顶 SHAKE_MUL_MAX）
  function chainShakeMulOf(n) {
    if (!(n >= CHAIN_TNT_AT)) return 1;
    var m = 1 + (n - CHAIN_TNT_AT + 1) * CHAIN_SHAKE_STEP;
    return m > SHAKE_MUL_MAX ? SHAKE_MUL_MAX : m;
  }

  // 连环：同屏 TNT 数 → 火花线性放大（不封顶，粒子上限兜底）
  function chainSparkMulOf(n) {
    if (!(n >= CHAIN_TNT_AT)) return 1;
    return 1 + (n - CHAIN_TNT_AT + 1) * CHAIN_SPARK_STEP;
  }

  // 总震屏倍率 = 碎层倍率 × 连环 TNT 倍率，封顶 1.4（18px 硬上限照旧在 shake() 里）
  function totalShakeMul() {
    var m = shakeMulOf(layersThisRound) * tntChainMul;
    return m > SHAKE_MUL_MAX ? SHAKE_MUL_MAX : m;
  }

  function shake(ampPx, dur) {
    var a = (Math.abs(ampPx) || 0) * totalShakeMul();
    if (a > SHAKE_MAX) a = SHAKE_MAX;
    var d = dur > 0 ? dur : 0.1;
    if (a <= shakeAmp && shakeT < shakeDur * 0.5) return; // 弱震动不打断正在衰减的强震动
    if (a < shakeAmp * 0.6) return;
    shakeAmp = a; shakeDur = d; shakeT = 0;
    if (a > SHAKE_MAX) shakeAmp = SHAKE_MAX;
    FX.shakeAmp = shakeAmp;
  }

  function flash(alpha, dur) {
    if (Q_FLASH[quality] === 0) return;
    var a = (alpha > 0 ? alpha : 0) * Q_FLASH[quality];
    if (a > FLASH_MAX) a = FLASH_MAX;
    if (a <= 0) return;
    if (a < flashA * 0.5) return;
    flashA = a;
    flashDur = dur > 0 ? dur : 0.14;
    flashT = 0;
  }

  function hitstop(sec) {
    if (!(sec > 0)) return;
    if (sec > hitstopTimer) hitstopTimer = sec;
    timeScale = HS_SCALE;
    FX.timeScale = HS_SCALE;
  }

  function addBlockFlash(x, y, s, dur) {
    var slot = null, oldest = 0, oldT = -1;
    for (var i = 0; i < BF_N; i++) {
      var b = bf[i];
      if (!b.on) { slot = b; break; }
      if (b.t > oldT) { oldT = b.t; oldest = i; }
    }
    if (!slot) slot = bf[oldest];
    slot.on = 1; slot.x = x; slot.y = y; slot.s = s; slot.t = 0; slot.d = dur;
  }

  // ---------- 事件处理 ----------

  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

  // v3 四个矿种；'copper' 是 v1 遗留 id，映射到铁的可视配色；未知 id 一律回落石头
  function oreId(v) {
    if (v === 'crystal') return 'crystal';
    if (v === 'iron' || v === 'copper') return 'iron';
    if (v === 'coal') return 'coal';
    if (v === 'gold') return 'gold';
    return 'stone';
  }

  function oreAccent(ore) {
    if (ore === 'crystal') return C_ACC_CRYSTAL;
    if (ore === 'iron') return C_ACC_IRON;
    if (ore === 'coal') return C_ACC_COAL;
    if (ore === 'gold') return '#ffc857';
    return C_ACC_STONE;
  }

  function oreTextCol(ore) {
    if (ore === 'crystal') return C_TXT_CRYSTAL;
    if (ore === 'iron') return C_TXT_IRON;
    if (ore === 'coal') return C_TXT_COAL;
    if (ore === 'gold') return '#ffc857';
    return C_TXT_STONE;
  }

  // 碎屑配色：硬边多边形，无渐变，只挑常量色
  function chipColor(ore, r) {
    if (ore === 'crystal') return r < 0.45 ? C_ORE_CRYSTAL : (r < 0.8 ? C_ORE_CRYSTAL_D : C_ORE_CRYSTAL_DD);
    if (ore === 'iron') return r < 0.34 ? C_STONE : (r < 0.62 ? C_STONE_D : (r < 0.9 ? C_ORE_IRON : C_ORE_IRON_D));
    if (ore === 'coal') return r < 0.42 ? C_STONE : (r < 0.58 ? C_STONE_D : (r < 0.88 ? C_ORE_COAL : C_ORE_COAL_L));
    return r < 0.46 ? C_STONE : (r < 0.82 ? C_STONE_D : C_STONE_L);
  }

  function noteHit(px, py) {
    lastHitX = px; lastHitY = py; lastHitT = clock;
  }

  function addBounce(b, s) {
    var slot = null, oldest = 0, oldT = -1;
    for (var i = 0; i < BNC_N; i++) {
      var n = bnc[i];
      if (!n.on) { slot = n; break; }
      if (n.t > oldT) { oldT = n.t; oldest = i; }
    }
    if (!slot) slot = bnc[oldest];
    slot.on = 1; slot.x = b.x; slot.y = b.y; slot.s = s;
    slot.t = 0;
    slot.d = 0.16 + Math.random() * 0.05;
    slot.lift = 3 + Math.random() * 2;      // 方块从下往上弹 3~5px
  }

  var HIT_FX_BUDGET = 12, hitFx = 0, RIPPLE_BUDGET = 12, rippleFx = 0;
  function onHit(e) {
    var b = e && e.block;
    if (!b) return;
    var s = num(b.s, 30);
    var dir = num(e.dir, -1.5707963);
    var dmg = num(e.dmg, 1);
    if (dmg < 1) dmg = 1;
    var n = 4 + (dmg > 4 ? 4 : dmg | 0);
    if (quality === 'low') n = Math.max(4, Math.round(n * 0.7));
    var back = dir + Math.PI;
    var cx = b.x + s * 0.5, cy = b.y + s * 0.5;
    noteHit(cx, cy);
    if (++hitFx > HIT_FX_BUDGET) return;   // 同帧几十格被命中（激光 / TNT）：只给前 12 格喷火花
    var fx = cx + Math.cos(dir) * s * 0.34, fy = cy + Math.sin(dir) * s * 0.34;
    var hot = 1 + Math.min(0.5, comboLevel * 0.03);
    for (var i = 0; i < n; i++) {
      var p = acquire(PRI[K_SPARK], K_SPARK);
      if (!p) break;
      var a = back + (Math.random() - 0.5) * 1.2;
      var sp = 300 + Math.random() * 250;
      p.x = fx + (Math.random() - 0.5) * s * 0.34;
      p.y = fy + (Math.random() - 0.5) * s * 0.34;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.max = 0.12 + Math.random() * 0.13;
      p.life = p.max;
      p.size = 2.4 + Math.random() * 2.2;
      p.col = i < 2 ? C_SPARK_HOT : C_SPARK;
      p.alpha = Math.min(1, 0.82 * hot);
    }
    addBlockFlash(b.x, b.y, s, 0.05 + Math.random() * 0.03);
    shake(2 + Math.min(1, dmg * 0.5), 0.08);
  }

  function spawnChip(cx, cy, span, power, groundY, ore, delay) {
    var p = acquire(PRI[K_CHIP], K_CHIP);
    if (!p) return null;
    var a = Math.random() * TAU;
    var sp = (70 + Math.random() * 150) * power;
    p.x = cx + (Math.random() - 0.5) * span;
    p.y = cy + (Math.random() - 0.5) * span;
    p.vx = Math.cos(a) * sp;
    p.vy = Math.sin(a) * sp - (40 + Math.random() * 90) * power;
    p.grav = 980 + Math.random() * 400;
    p.rot = Math.random() * TAU;
    p.vrot = (Math.random() - 0.5) * 16;
    p.size = 2.2 + Math.random() * 3.4;
    p.max = 0.55 + Math.random() * 0.45;
    p.life = p.max;
    p.ground = groundY + Math.random() * 18;
    p.w = (Math.random() * 3) | 0;
    p.col = chipColor(ore, Math.random());
    p.ore = ore;                       // 贴图键按 ore 查表；未归一化的 id 在 oreId() 已收敛到 4 种
    p.delay = delay > 0 ? delay : 0;
    p.alpha = 1;
    return p;
  }

  function spawnDust(cx, cy, span, n, q) {
    var cnt = Math.round(n * q);
    for (var i = 0; i < cnt; i++) {
      var p = acquire(PRI[K_DUST], K_DUST);
      if (!p) return;
      var a = Math.random() * TAU;
      var sp = 20 + Math.random() * 70;
      p.x = cx + (Math.random() - 0.5) * span;
      p.y = cy + (Math.random() - 0.5) * span;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - 20 - Math.random() * 40;
      p.max = 0.4 + Math.random() * 0.5;
      p.life = p.max;
      p.size = 3 + Math.random() * 5;
      p.grow = 6 + Math.random() * 10;
      p.col = Math.random() < 0.5 ? C_DUST : C_DUST_D;
      p.alpha = 0.42;
    }
  }

  function spawnRing(x, y, r0, r1, dur, lw, col, delay) {
    var p = acquire(PRI[K_RING], K_RING);
    if (!p) return;
    p.fix = 1;
    p.x = x; p.y = y;
    p.size = r0;
    p.grow = (r1 - r0) / dur;
    p.max = dur; p.life = dur;
    p.w = lw;
    p.col = col;
    p.delay = delay > 0 ? delay : 0;
  }

  // 整格挖空（坑洞）：碎屑 + 双环 + 白闪 + 命中停顿 + 震屏
  function onBreak(e) {
    var b = e && e.block;
    if (!b) return;
    // v2 里 block:break 与 block:empty 会对同一格先后到达，同帧只出一次全套表现
    var box = num(b.ox, -1), boy = num(b.oy, -1);
    if (clock - lastFullClock < 0.05 &&
        (b === lastFullBlock || (box >= 0 && box === lastFullOx && boy === lastFullOy))) return;
    lastFullBlock = b; lastFullClock = clock; lastFullOx = box; lastFullOy = boy;
    countLayer();                                  // 整格挖空的最后一层也算碎掉一层（去重后只计一次）
    var s = num(b.s, 30);
    var cx = b.x + s * 0.5, cy = b.y + s * 0.5;
    noteHit(cx, cy);
    var ore = oreId(e.ore);
    var rich = !!e.rich;
    var qd = Q_DEBRIS[quality];
    var n = Math.round((10 + Math.random() * 8) * qd * (rich ? 1.3 : 1));
    var groundY = b.y + s + 4;
    for (var i = 0; i < n; i++) spawnChip(cx, cy, s * 0.7, 1, groundY, ore, 0);
    // 快速扩散的亮环
    spawnRing(cx, cy, s * 0.3, s * 1.85, 0.22, 3.4, C_RING_HOT, 0);
    if (quality !== 'low') {
      spawnRing(cx, cy, s * 0.2, s * 1.2, 0.34, 1.6,
        comboLevel >= 10 ? C_GOLD_L : oreAccent(ore), 0.04);
    }
    spawnDust(cx, cy, s * 0.9, 7 + Math.random() * 4, Q_DUST[quality]);
    if (rich) {
      for (var k = 0; k < 3; k++) {
        var g = acquire(PRI[K_SPARK], K_SPARK);
        if (!g) break;
        var a = Math.random() * TAU;
        g.x = cx; g.y = cy;
        g.vx = Math.cos(a) * (140 + Math.random() * 130);
        g.vy = Math.sin(a) * (140 + Math.random() * 130);
        g.max = 0.24; g.life = 0.24;
        g.size = 3.2; g.col = C_GOLD_L; g.alpha = 1;
      }
    }
    flash(0.12, 0.12);
    hitstop(0.04 + Math.random() * 0.02);
    shake(5 + Math.random() * 3, 0.14);
  }

  // block:layer —— 只打穿一层（露出下一层），故意不用整格击碎的白闪与双环
  var LAYER_FX_BUDGET = 24, layerFx = 0;   // 每帧最多给 24 次剥层喷碎屑（视觉上已饱和）
  function onLayer(e) {
    var b = e && e.block;
    if (!b) return;
    countLayer();
    if (++layerFx > LAYER_FX_BUDGET) return;
    var s = num(b.s, 30);
    var cx = b.x + s * 0.5, cy = b.y + s * 0.5;
    noteHit(cx, cy);
    var ore = oreId(b.ore || e.ore);
    var qd = Q_DEBRIS[quality];
    var n = 4 + ((Math.random() * 5) | 0);          // 4~8 个碎屑
    if (qd < 1) n = Math.max(2, Math.round(n * qd)); // low 档碎屑 ×0.35
    var groundY = b.y + s + 3;
    for (var i = 0; i < n; i++) spawnChip(cx, cy + s * 0.28, s * 0.5, 0.8, groundY, ore, 0);
    spawnDust(cx, cy + s * 0.32, s * 0.6, 3, Q_DUST[quality]);
    addBounce(b, s);
    shake(1 + Math.random(), 0.1);                  // 1~2px
  }

  // tool:execute（v9 处决）：额外一帧白闪 + 金色十字火花 8~12 个
  function onExecute(e) {
    var x = num(e && e.x, lastHitX);
    var y = num(e && e.y, lastHitY);
    noteHit(x, y);
    flash(EXEC_FLASH, EXEC_FLASH_DUR);
    var want = EXEC_SPARK_MIN + ((Math.random() * (EXEC_SPARK_MAX - EXEC_SPARK_MIN + 1)) | 0);
    var made = 0;
    for (var i = 0; i < want; i++) {
      var p = acquire(PRI[K_SPARK], K_SPARK);
      if (!p) break;
      // 十字：四条臂各错开 90°，只做小幅抖动
      var a = (i % 4) * 1.5707963 + (Math.random() - 0.5) * 0.28;
      var sp = 300 + Math.random() * 240;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.max = 0.16 + Math.random() * 0.1;
      p.life = p.max;
      p.size = 2.6 + Math.random() * 2.4;
      p.col = i < 2 ? C_EXEC_HOT : C_EXEC;
      p.alpha = 1;
      made++;
    }
    execInfo.count++;
    execInfo.x = x; execInfo.y = y; execInfo.sparks = made;
    shake(3, 0.1);
  }

  // 引信：落点脉冲红圈 + 每 0.1s 一颗火花，最后 0.3 秒加速
  // lucky:tnt 落地后也走这里，全场只存在一套引信表现
  function startFuse(x, y, delay, cells) {
    fuseX = x; fuseY = y;
    fuseDelay = Math.max(0.12, delay);
    fuseCells = cells | 0;
    fuseT = 0; fuseAcc = 0; fuseSparks = 0; fuseOn = 1;
    spawnRing(fuseX, fuseY, 8, 34, 0.26, 2.6, C_TNT_L, 0);
  }

  function onFuse(e) {
    if (!e) return;
    startFuse(num(e.x, CX), num(e.y, CY), num(e.delay, 0.8), num(e.cells, 0));
    shake(1.4, 0.09);
  }

  function spawnFuseSpark() {
    if (fuseSparks >= FUSE_SPARK_MAX) return;
    var p = acquire(PRI[K_SPARK], K_SPARK);
    if (!p) return;
    fuseSparks++;
    var a = -1.5707963 + (Math.random() - 0.5) * 1.8;
    var sp = 40 + Math.random() * 90;
    p.x = fuseX + (Math.random() - 0.5) * 8;
    p.y = fuseY - 4 - Math.random() * 6;
    p.vx = Math.cos(a) * sp;
    p.vy = Math.sin(a) * sp;
    p.max = 0.16 + Math.random() * 0.12;
    p.life = p.max;
    p.size = 1.6 + Math.random() * 1.6;
    p.col = Math.random() < 0.5 ? C_FUSE_SPARK : C_TNT_L;
    p.alpha = 1;
  }

  // 按格分批碎裂：保持池内粒子数受上限约束，逐格只出 1~4 片
  function cellWave(x, y, R, pow, cells) {
    var qd = Q_DEBRIS[quality];
    var i, k, m, cx, cy, cs, dx, dy, dist, ratio, dl, a, rr;
    if (cells && cells.length) {
      var n = cells.length > CELL_MAX ? CELL_MAX : cells.length;
      for (i = 0; i < n; i++) {
        var c = cells[i];
        cx = num(c && c.x, x);
        cy = num(c && c.y, y);
        cs = num(c && c.s, R * 0.5);
        dx = cx - x; dy = cy - y;
        dist = Math.sqrt(dx * dx + dy * dy);
        ratio = R > 0 ? dist / R : 0;
        if (ratio > 1) ratio = 1;
        dl = 0.03 + ratio * 0.06;                       // 由内向外 30~90ms 错开
        m = Math.max(1, Math.round((2 + Math.random() * 2) * qd));
        for (k = 0; k < m; k++) spawnChip(cx, cy, cs * 0.7, 1 + pow * 0.2, cy + cs * 0.7, oreId(c && c.ore), dl);
      }
    } else {
      // cells 缺失或只是格数：在半径内合成格位，同样由内向外错开
      var cnt = typeof cells === 'number' && isFinite(cells) ? Math.round(cells) : 9;
      if (cnt < 1) cnt = 1; else if (cnt > CELL_MAX) cnt = CELL_MAX;
      for (i = 0; i < cnt; i++) {
        var ring = i % 3;
        a = (i / cnt) * TAU + Math.random() * 0.5;
        rr = R * (0.18 + 0.62 * (ring / 3));
        cx = x + Math.cos(a) * rr;
        cy = y + Math.sin(a) * rr;
        dl = 0.03 + 0.06 * (ring / 3);
        m = Math.max(1, Math.round((2 + Math.random() * 2) * qd));
        for (k = 0; k < m; k++) spawnChip(cx, cy, R * 0.22, 1 + pow * 0.2, cy + R * 0.3, 'stone', dl);
      }
    }
  }

  var BOOM_FX_BUDGET = 4, boomFx = 0;     // 同帧第 5 颗起只出冲击环（碎屑早已满屏）
  function onExplosion(e) {
    if (!e) return;
    var x = num(e.x, CX), y = num(e.y, CY);
    // 04-tools 的 tntCount = 这次爆炸后场上还排着的 TNT + 自己（缺省 1 = 单颗）
    var tntN = Math.round(num(e.tntCount, 1));
    if (!(tntN >= 1)) tntN = 1;
    tntChainMul = chainShakeMulOf(tntN);
    chainInfo.tnt = tntN;
    chainInfo.shake = tntChainMul;
    chainInfo.sparks = chainSparkMulOf(tntN);
    lastBoomClock = clock;
    FX.shakeMul = totalShakeMul();
    var R = num(e.radiusPx, 60);
    if (R < 24) R = 24;
    if (R > 180) R = 180;
    var pow = num(e.power, 1);
    if (pow < 0.4) pow = 0.4;
    if (pow > 4) pow = 4;
    var qd = Q_DEBRIS[quality];
    noteHit(x, y);
    boomFx++;

    flash(0.4, 0.3);
    // 双层冲击波：内层快而厚，外层慢而薄
    spawnRing(x, y, R * 0.28, R * 0.62, 0.16, 8.5, C_RING_HOT, 0);
    spawnRing(x, y, R * 0.2, R * 1.02, 0.44, 4.2, C_RING, 0);
    if (quality !== 'low') spawnRing(x, y, R * 0.5, R * 0.92, 0.3, 2.2, C_GOLD_L, 0.12);

    if (boomFx > BOOM_FX_BUDGET) { hitstop(0.03); shake(14 + Math.min(4, pow * 1.4), 0.3); return; }
    var n = Math.round((30 + Math.random() * 30) * qd * (0.85 + pow * 0.18) * chainInfo.sparks);
    for (var i = 0; i < n; i++) {
      spawnChip(x, y, R * 0.5, 1.3 + pow * 0.3, y + R * 0.55, 'stone', 0);
    }
    spawnDust(x, y, R * 0.8, 12, Q_DUST[quality]);
    cellWave(x, y, R, pow, e.cells);
    hitstop(0.03);
    shake(14 + Math.min(4, pow * 1.4), 0.3);
  }

  function onDropSpawn(e) {
    if (!e) return;
    if (++rippleFx > RIPPLE_BUDGET) return;
    var x = num(e.x, CX), y = num(e.y, CY);
    var p = acquire(PRI[K_RIPPLE], K_RIPPLE);
    if (!p) return;
    p.fix = 1;
    p.x = x; p.y = y;
    p.size = 4;
    p.grow = 34;
    p.max = 0.3; p.life = 0.3;
    p.w = 1.6;
    p.col = e.rich ? C_GOLD_L : oreAccent(oreId(e.ore));
  }

  function onAbsorb(e) {
    if (!e) return;
    var x = num(e.x, HUD_X), y = num(e.y, HUD_Y);
    var ore = oreId(e.ore);
    var amt = num(e.amount, 1);
    if (amt < 1) amt = 1;
    // 指向 HUD 的箭头状微光
    var g = acquire(PRI[K_GLINT], K_GLINT);
    if (g) {
      g.fix = 1;
      g.sx = x; g.sy = y; g.x = x; g.y = y;
      g.max = 0.26; g.life = 0.26;
      g.size = 3.4;
      g.col = ore === 'iron' ? C_ORE_IRON : C_GOLD_L;
    }
    addText(x, y + 12, ore, Math.round(amt));
  }

  function addText(x, y, ore, amount) {
    var i, p;
    // 同矿种 120ms 内合并累加
    for (i = 0; i < cap; i++) {
      p = pool[i];
      if (p.on && p.kind === K_TEXT && p.oreId === ore && (p.max - p.life) < 0.12) {
        p.num += amount;
        p.max = 0.95; p.life = 0.95;
        p.size = p.num >= 60 ? 21 : (p.num >= 12 ? 18 : 16);
        p.str = '+' + p.num;
        p.alpha = 1;
        return;
      }
    }
    p = acquire(PRI[K_TEXT], K_TEXT);
    if (!p) return;
    p.fix = 1;
    p.x = x + (Math.random() - 0.5) * 6;
    p.y = y;
    p.vx = 0;
    p.vy = -46 - Math.random() * 10;
    p.max = 0.95; p.life = 0.95;
    p.num = amount;
    p.oreId = ore;
    p.str = '+' + amount;
    p.size = amount >= 60 ? 21 : (amount >= 12 ? 18 : 16);
    p.col = oreTextCol(ore);
    p.alpha = 1;
  }

  function onCombo(e) {
    var c = e ? num(e.combo, 1) : 1;
    if (c < 0) c = 0;
    comboLevel = c > 60 ? 60 : c;
    if (comboLevel >= 8) {
      var n = 2 + Math.floor((comboLevel - 8) / 3);
      if (n > 8) n = 8;
      for (var i = 0; i < n; i++) {
        var p = acquire(PRI[K_RADIAL], K_RADIAL);
        if (!p) break;
        var a = Math.random() * TAU;
        var sp = 90 + Math.random() * 170;
        p.fix = 1;
        // 1.5 秒内有过命中就从命中格发出，否则回退屏幕中心
        var ox = (clock - lastHitT <= HIT_MEMORY) ? lastHitX : CX;
        var oy = (clock - lastHitT <= HIT_MEMORY) ? lastHitY : CY;
        p.x = ox + Math.cos(a) * 14;
        p.y = oy + Math.sin(a) * 14;
        p.vx = Math.cos(a) * sp;
        p.vy = Math.sin(a) * sp;
        p.max = 0.3 + Math.random() * 0.2;
        p.life = p.max;
        p.size = 2.6 + Math.random() * 2;
        p.col = comboLevel >= 14 ? C_GOLD_L : C_SPARK;
        p.alpha = 0.9;
      }
    }
  }

  function onFrenzyStart(e) {
    frenzyTimer = Math.max(0.5, num(e && e.seconds, 8));
    frenzyMul = Math.max(1, num(e && e.mult, 1));
    frenzyFade = 1;
    moteAcc = 0;
    flash(0.16, 0.24);
    shake(4, 0.18);
    for (var i = 0; i < 16; i++) spawnMote(true);
  }

  function onFrenzyEnd() {
    frenzyTimer = 0;
  }

  function spawnMote(burst) {
    var p = acquire(PRI[K_MOTE], K_MOTE);
    if (!p) return;
    p.x = Math.random() * 390;
    p.y = burst ? 844 - Math.random() * 120 : 848 + Math.random() * 40;
    p.vx = (Math.random() - 0.5) * 26;
    p.vy = -(60 + Math.random() * 110) * Math.min(1.6, frenzyMul);
    p.max = 0.9 + Math.random() * 1.1;
    p.life = p.max;
    p.size = 2 + Math.random() * 3.4;
    p.rot = Math.random() * TAU;      // 摆动相位
    p.col = Math.random() < 0.4 ? C_GOLD_L : C_GOLD;
    p.alpha = 0.55;
  }

  function onMagnetBurst(e) {
    if (!e) return;
    var x = num(e.x, CX), y = num(e.y, CY);
    var p = acquire(PRI[K_RING], K_RING);
    if (!p) return;
    p.fix = 1;
    p.x = x; p.y = y;
    p.size = 66;
    p.grow = -180;   // 向内收束
    p.max = 0.3; p.life = 0.3;
    p.w = 2.4;
    p.col = C_DUST;
  }

  // ---------- v3 事件：激光 / 震荡器 / 幸运 TNT ----------

  // 光束几何（写入复用对象 lb，不产生每 tick 垃圾）：
  // cells 是本次结算到的方块数组 → 顶端 = 该列最高格，末端 = 最低格下沿；
  // 只给 h（格数）时按 op 点向上推 h 格。
  function laserGeom(e) {
    var cells = e && e.cells;
    var s = BEAM_S_DEF, cx = 0, top = 0, bot = 0, n = 0, i, c, cs, cy0, minY = 1e9, maxB = -1e9, sumX = 0;
    if (cells && typeof cells.length === 'number' && cells.length > 0) {
      for (i = 0; i < cells.length; i++) {
        c = cells[i];
        if (!c) continue;
        cs = num(c.s, BEAM_S_DEF);
        if (!(cs > 4)) cs = BEAM_S_DEF;
        cy0 = num(c.y, 0);
        if (cy0 < minY) minY = cy0;
        if (cy0 + cs > maxB) maxB = cy0 + cs;
        sumX += num(c.x, 0) + cs * 0.5;
        s = cs;
        n++;
      }
      if (n > 0) { top = minY; bot = maxB; cx = sumX / n; }
    }
    if (!(n > 0)) {
      s = num(e && e.s, BEAM_S_DEF);
      if (!(s > 4)) s = BEAM_S_DEF;
      var h = Math.round(num(e && e.h, 1));
      if (h < 1) h = 1; else if (h > 16) h = 16;
      cx = num(e && e.x, CX);
      bot = num(e && e.y, CY) + s * 0.5;
      top = bot - h * s;
    }
    if (!(bot > top)) { top = num(e && e.y, CY); bot = top + BEAM_S_DEF; }
    lb.cx = cx; lb.top = top; lb.bot = bot; lb.s = s;
    return lb;
  }

  // 全场只允许一个光束对象：连续 tick 只刷新它的寿命与几何，绝不堆叠
  function findBeam() {
    for (var i = 0; i < cap; i++) {
      var p = pool[i];
      if (p.on && p.kind === K_BEAM) return p;
    }
    return null;
  }

  // 顶端 / 末端各喷一簇细火花（方向朝外，横向抖动很小 → 竖直感）
  function spawnBeamSparks(cx, y, w, up) {
    var n = quality === 'low' ? 2 : (quality === 'mid' ? 3 : BEAM_SPARK_N);
    for (var i = 0; i < n; i++) {
      var p = acquire(PRI[K_SPARK], K_SPARK);
      if (!p) return;
      var a = (up > 0 ? -1.5707963 : 1.5707963) + (Math.random() - 0.5) * 1.1;
      var sp = 90 + Math.random() * 180;
      p.x = cx + (Math.random() - 0.5) * w * 1.2;
      p.y = up > 0 ? y - 1 : y + 1;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.max = 0.14 + Math.random() * 0.12;
      p.life = p.max;
      p.size = 1.4 + Math.random() * 1.5;
      p.col = Math.random() < 0.45 ? C_LASER_SPARK : C_LASER;
      p.alpha = 1;
    }
  }

  // laser:tick {x, y, cells, h} —— 竖直光束：核心亮线 3~5px + 外侧 2 层半透明辉光
  function onLaser(e) {
    if (!e) return;
    var g = laserGeom(e);
    var w = 3 + g.s * 0.02;
    if (w < 3) w = 3; else if (w > 5) w = 5;
    var p = findBeam();
    if (!p) {
      p = acquire(PRI[K_BEAM], K_BEAM);
      if (!p) return;
      p.fix = 1;
      p.col = C_LASER;
    }
    p.x = g.cx;
    p.y = g.top;
    p.size = g.bot - g.top;      // 竖直：高度 >> 宽度
    p.w = w;
    p.max = BEAM_LIFE;
    p.life = BEAM_LIFE;          // 连续 tick 只刷新寿命 → 不闪断、不堆叠
    p.alpha = 1;
    noteHit(g.cx, g.top + p.size * 0.5);
    spawnBeamSparks(g.cx, g.top, w, 1);
    spawnBeamSparks(g.cx, g.bot, w, 0);
    shake(1.2, 0.07);
  }

  // 环形尘浪：粉尘沿圆周等角铺开并向外推
  function quakeDust(x, y, R) {
    var n = Math.round(16 * Q_DUST[quality]);
    if (n < 5) n = 5;
    for (var i = 0; i < n; i++) {
      var p = acquire(PRI[K_DUST], K_DUST);
      if (!p) return;
      var a = (i / n) * TAU + Math.random() * 0.18;
      var sp = R * (2.1 + Math.random() * 1.5);
      p.x = x + Math.cos(a) * R * 0.18;
      p.y = y + Math.sin(a) * R * 0.18;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.max = 0.34 + Math.random() * 0.22;
      p.life = p.max;
      p.size = 2.6 + Math.random() * 3;
      p.grow = 7 + Math.random() * 7;
      p.col = i % 3 === 0 ? C_DUST : C_DUST_D;
      p.alpha = 0.5;
    }
  }

  // quake:blast {x, y, cells} —— 三层同心冲击波（内快外慢）+ 环形尘浪 + 强震屏 + 停顿 + 白闪
  function onQuake(e) {
    if (!e) return;
    var x = num(e.x, CX), y = num(e.y, CY);
    var cells = e && e.cells;
    var isList = !!(cells && typeof cells.length === 'number');
    var cnt = isList ? cells.length : (num(cells, 49) | 0);
    if (cnt < 1) cnt = 1; else if (cnt > QUAKE_CELL_MAX) cnt = QUAKE_CELL_MAX;
    var R = QUAKE_BASE + Math.sqrt(cnt) * QUAKE_PER;   // cells 越多波纹越大：7×7 vs 9×9 可分
    if (R > QUAKE_R_MAX) R = QUAKE_R_MAX;
    noteHit(x, y);
    spawnRing(x, y, R * 0.12, R * 0.58, 0.13, 8.5, C_RING_HOT, 0);        // 内：快而厚
    spawnRing(x, y, R * 0.18, R * 0.86, 0.28, 4.6, C_RING, 0.02);           // 中
    spawnRing(x, y, R * 0.26, R * 1.28, 0.5, 2.4, C_DUST, 0.05);            // 外：慢而薄
    quakeDust(x, y, R);
    // 深核钻机（9×9 = 81 格，阈值取 64 区分 7×7 的 49 格）：额外铺一层环形贴图
    if (cnt >= 64 && deepArt()) {
      deepRing.t = 0.62;
      deepRing.max = 0.62;
      deepRing.x = x;
      deepRing.y = y;
      deepRing.R = R * 1.35;
      deepRing.hot = 1;
    }
    if (isList) cellWave(x, y, R * 0.9, 2.4, cells);
    flash(0.35, 0.3);
    hitstop(0.04);
    shake(18, 0.34);   // 契约要求 16~20px，受既有 18px 硬上限钳制
  }

  function addFreeText(x, y) {
    var p = acquire(PRI[K_TEXT], K_TEXT);
    if (!p) return;
    p.fix = 1;
    p.x = x;
    p.y = y - 12;
    p.vx = 0;
    p.vy = -58 - Math.random() * 12;
    p.max = 1.05; p.life = 1.05;
    p.num = 0;
    p.oreId = 'free';      // 独立标记，不参与同矿跳字合并
    p.str = 'FREE!';
    p.size = 21;
    p.col = C_GOLD_L;
    p.alpha = 1;
  }

  // 弹入途中的拖影：走金色微光通道（软圆 + 轻微摆动），池满时自然被顶掉
  function spawnLuckyTrail(t) {
    var p = acquire(PRI[K_MOTE], K_MOTE);
    if (!p) return;
    p.x = t.x + (Math.random() - 0.5) * 5;
    p.y = t.y + (Math.random() - 0.5) * 5;
    p.vx = (Math.random() - 0.5) * 20;
    p.vy = -18 - Math.random() * 36;
    p.max = 0.2 + Math.random() * 0.16;
    p.life = p.max;
    p.size = 2.4 + Math.random() * 1.8;
    p.rot = Math.random() * TAU;
    p.col = Math.random() < 0.5 ? C_GOLD : C_GOLD_L;
    p.alpha = 0.55;
  }

  // 落地：小尘爆 + 金色 FREE! 跳字，然后交给现有引信（不重复画引信）
  function luckyLand(t) {
    spawnDust(t.tx, t.ty, 14, 5, Q_DUST[quality]);
    addFreeText(t.tx, t.ty);
    startFuse(t.tx, t.ty, t.delay, 0);
    shake(2.6, 0.12);
  }

  // lucky:tnt {x, y, delay} —— 金框小炸药从上方弹入落点
  function onLucky(e) {
    if (!e) return;
    var slot = null, oldest = 0, oldT = -1, i;
    for (i = 0; i < LK_N; i++) {
      var q = lk[i];
      if (!q.on) { slot = q; break; }
      if (q.t > oldT) { oldT = q.t; oldest = i; }
    }
    if (!slot) slot = lk[oldest];
    var tx = num(e.x, CX), ty = num(e.y, CY);
    slot.on = 1; slot.t = 0; slot.d = LK_FLY;
    slot.tx = tx; slot.ty = ty;
    slot.x0 = tx + (Math.random() - 0.5) * 64;
    slot.y0 = ty - 96;
    slot.x = slot.x0; slot.y = slot.y0;
    slot.delay = Math.max(0.12, num(e.delay, 1.8));   // 缺省跟 CONFIG.tuning.luckyTNTFuseSec（1.8s 长引线）
    slot.acc = LK_TRAIL_IV;   // 立刻出一颗拖影，起飞就有尾迹
    shake(2.2, 0.12);
  }

  // ---------- v6：地心共振 / 宝藏开箱 ----------

  // resonance:blast {x, y, cells} —— 金色全屏冲击波（3 层环扩散到覆盖整屏）+ 白闪 0.35
  // + 震屏 18px + 各处同时喷碎屑（受粒子池上限约束，按 cells 比例分）
  function onResonance(e) {
    if (!e) return;
    var x = num(e.x, CX), y = num(e.y, CY);
    var cnt = num(e.cells, 0) | 0;
    if (cnt < 0) cnt = 0;
    noteHit(x, y);
    var R = RES_R;
    spawnRing(x, y, R * 0.04, R * 0.34, 0.18, 10, C_RING_HOT, 0);
    spawnRing(x, y, R * 0.06, R * 0.62, 0.32, 6, C_RING, 0.03);
    spawnRing(x, y, R * 0.08, R, 0.60, 3, C_GOLD, 0.07);
    // 全屏同时碎：位置在棋盘区域内随机撒开，数量按 cells 比例压缩到上限内
    var qd = Q_DEBRIS[quality];
    var n = Math.round(cnt * RES_PER_CELL * qd);
    if (n > RES_DEBRIS_MAX) n = RES_DEBRIS_MAX;
    for (var i = 0; i < n; i++) {
      spawnChip(16 + Math.random() * 358, 110 + Math.random() * 660, 10, 1.15, 844, 'crystal', 0);
    }
    spawnDust(x, y, 120, RES_DUST_N * qd, 1);
    flash(RES_FLASH, 0.34);
    shake(RES_SHAKE, 0.4);
    resInfo.x = x; resInfo.y = y; resInfo.cells = cnt;
    resInfo.R = R; resInfo.rings = RES_RINGS;
    resInfo.shake = RES_SHAKE; resInfo.flash = RES_FLASH;
    resInfo.count++;
  }

  // treasure:open {x, y} —— 40~60 颗金色粒子爆发 + 一圈金色光柱 + 亮环
  function onTreasureOpen(e) {
    if (!e) return;
    var x = num(e.x, CX), y = num(e.y, CY);
    noteHit(x, y);
    var want = TR_SPARK_MIN + ((Math.random() * (TR_SPARK_MAX - TR_SPARK_MIN + 1)) | 0);
    if (want > TR_SPARK_MAX) want = TR_SPARK_MAX;
    for (var i = 0; i < want; i++) {
      var p = acquire(PRI[K_SPARK], K_SPARK);
      if (!p) break;
      var a = Math.random() * TAU;
      var sp = 80 + Math.random() * 260;
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - 40;
      p.max = 0.35 + Math.random() * 0.4;
      p.life = p.max;
      p.size = 2 + Math.random() * 2.6;
      p.col = Math.random() < 0.5 ? C_GOLD : C_GOLD_L;
      p.alpha = 1;
    }
    // 一圈金色光柱：每根 = 竖直叠 TR_MOTES 颗金色微光（低画质减半）
    var pn = quality === 'low' ? ((TR_PILLARS / 2) | 0) : TR_PILLARS;
    if (pn < 1) pn = 1;
    for (var k = 0; k < pn; k++) {
      var ang = (k / pn) * TAU;
      var px = x + Math.cos(ang) * 26;
      var py = y + Math.sin(ang) * 26;
      for (var m = 0; m < TR_MOTES; m++) {
        var q = acquire(PRI[K_MOTE], K_MOTE);
        if (!q) break;
        q.x = px;
        q.y = py - m * 9;
        q.vx = 0;
        q.vy = -(40 + Math.random() * 40);
        q.max = 0.5 + Math.random() * 0.3;
        q.life = q.max;
        q.size = 3 - m * 0.3;
        q.rot = Math.random() * TAU;
        q.col = m < 2 ? C_GOLD_L : C_GOLD;
        q.alpha = 0.8;
      }
    }
    spawnRing(x, y, 6, 64, 0.40, 3.2, C_GOLD, 0);
    flash(0.22, 0.3);
    shake(7, 0.24);
    trInfo.x = x; trInfo.y = y; trInfo.sparks = want; trInfo.pillars = pn;
    trInfo.count++;
  }

  // ---------- 生命周期 ----------

  function update(dt) {
    frameNo++; layerFx = 0; boomFx = 0; hitFx = 0; rippleFx = 0;
    if (!(dt > 0)) dt = 0;
    else if (dt > 0.05) dt = 0.05;
    clock += dt;
    // 连环结束：CHAIN_WINDOW 秒内没有新爆炸 → 震屏倍率回落（连环只在「一次连环」里放大）
    if (tntChainMul > 1 && clock - lastBoomClock > CHAIN_WINDOW) {
      tntChainMul = 1;
      chainInfo.tnt = 1; chainInfo.shake = 1; chainInfo.sparks = 1;
      FX.shakeMul = totalShakeMul();
    }
    if (deepRing.t > 0) deepRing.t -= dt;

    // 命中停顿：内部计时器，暂停期间 timeScale=0.06，结束后快速回 1
    if (hitstopTimer > 0) {
      hitstopTimer -= dt;
      if (hitstopTimer < 0) hitstopTimer = 0;
      timeScale = HS_SCALE;
    } else if (timeScale < 1) {
      timeScale += dt * 12;
      if (timeScale > 1) timeScale = 1;
    }
    var sdt = hitstopTimer > 0 ? dt * 0.2 : dt;   // 物理时间：停顿期间近似冻结

    // 震屏：高频抖 + 平方衰减 + 硬上限
    if (shakeT < shakeDur) {
      shakeT += dt;
      var k = 1 - shakeT / shakeDur;
      if (k < 0) k = 0;
      var amp = shakeAmp * k * k;
      shakeX = Math.sin(shakeT * 63) * amp * 0.72 + Math.sin(shakeT * 41 + 1.3) * amp * 0.28;
      shakeY = Math.cos(shakeT * 71 + 0.7) * amp * 0.8;
      if (shakeX > SHAKE_MAX) shakeX = SHAKE_MAX; else if (shakeX < -SHAKE_MAX) shakeX = -SHAKE_MAX;
      if (shakeY > SHAKE_MAX) shakeY = SHAKE_MAX; else if (shakeY < -SHAKE_MAX) shakeY = -SHAKE_MAX;
    } else {
      shakeAmp = 0; shakeX = 0; shakeY = 0;
    }

    // 闪白衰减
    if (flashA > 0) {
      flashT += dt;
      var ft = flashT / flashDur;
      if (ft >= 1) { flashA = 0; flashAlpha = 0; }
      else { flashAlpha = flashA * (1 - ft) * (1 - ft); }
    } else flashAlpha = 0;

    // 连击热度
    var target = comboLevel / 14;
    if (target > 1) target = 1;
    heat += (target - heat) * Math.min(1, dt * 8);
    if (heat < 0) heat = 0;
    if (comboLevel > 0) {
      comboLevel -= dt * 2;     // TOOLS 会持续派发 combo:update，这里只是兜底衰减
      if (comboLevel < 0) comboLevel = 0;
    }

    // 狂热
    if (frenzyTimer > 0) {
      frenzyTimer -= dt;
      if (frenzyFade < 1) frenzyFade = Math.min(1, frenzyFade + dt * 4);
      moteAcc += dt;
      var step = quality === 'low' ? 0.11 : (quality === 'mid' ? 0.07 : 0.045);
      while (moteAcc >= step) { moteAcc -= step; spawnMote(false); }
    } else if (frenzyFade > 0) {
      frenzyFade -= dt * 2.5;
      if (frenzyFade < 0) frenzyFade = 0;
    }

    // 方块内闪
    for (var i = 0; i < BF_N; i++) {
      var b = bf[i];
      if (!b.on) continue;
      b.t += dt;
      if (b.t >= b.d) b.on = 0;
    }

    // 打穿一层的上弹提示
    for (i = 0; i < BNC_N; i++) {
      var nb = bnc[i];
      if (!nb.on) continue;
      nb.t += dt;
      if (nb.t >= nb.d) nb.on = 0;
    }

    // TNT 引信：每 0.1s 冒一颗火花，最后 0.3 秒加速到 0.05s
    if (fuseOn) {
      fuseT += dt;
      var fuseLeft = fuseDelay - fuseT;
      if (fuseLeft <= 0) {
        fuseOn = 0;
      } else {
        var fuseIv = fuseLeft < 0.3 ? 0.05 : 0.1;
        fuseAcc += dt;
        while (fuseAcc >= fuseIv) { fuseAcc -= fuseIv; spawnFuseSpark(); }
      }
    }

    // 幸运 TNT 弹入：落地瞬间尘爆 + FREE! 跳字，随后交给引信
    for (i = 0; i < LK_N; i++) {
      var lt = lk[i];
      if (!lt.on) continue;
      lt.t += dt;
      var lkr = lt.t / lt.d;
      if (lkr > 1) lkr = 1;
      var lke = 1 - (1 - lkr) * (1 - lkr);      // 缓出：越接近落点越快
      lt.x = lt.x0 + (lt.tx - lt.x0) * lke;
      lt.y = lt.y0 + (lt.ty - lt.y0) * lke;
      lt.acc += dt;
      while (lt.acc >= LK_TRAIL_IV) { lt.acc -= LK_TRAIL_IV; spawnLuckyTrail(lt); }
      if (lkr >= 1) { luckyLand(lt); lt.on = 0; }
    }

    // 粒子
    for (i = 0; i < cap; i++) {
      var p = pool[i];
      if (!p.on) continue;
      if (p.delay > 0) {
        p.delay -= dt;
        if (p.delay > 0) continue;
        p.delay = 0;
      }
      var d = p.fix ? dt : sdt;
      if (d > 0) {
        switch (p.kind) {
          case K_CHIP:
            p.vy += p.grav * d;
            p.x += p.vx * d;
            p.y += p.vy * d;
            p.rot += p.vrot * d;
            if (p.state === 0 && p.vy > 0 && p.y >= p.ground) {
              p.y = p.ground;
              if (p.vy > 110) {           // 一次弹跳，然后停住淡出
                p.vy = -p.vy * 0.34;
                p.vx *= 0.62;
                p.vrot *= 0.6;
              } else {
                p.state = 1;
                p.vy = 0;
                p.vx *= 0.3;
                p.vrot *= 0.15;
              }
            }
            if (p.state === 1) p.alpha -= d * 3.2;
            break;
          case K_DUST:
            p.vx *= (1 - 2.4 * d);
            p.vy *= (1 - 2.4 * d);
            p.vy -= 26 * d;
            p.x += p.vx * d;
            p.y += p.vy * d;
            p.size += p.grow * d;
            p.alpha -= d * 0.55;
            break;
          case K_SPARK:
          case K_RADIAL:
            p.vx *= (1 - 3.2 * d);
            p.vy *= (1 - 3.2 * d);
            p.x += p.vx * d;
            p.y += p.vy * d;
            p.alpha -= d * 1.4;
            break;
          case K_RING:
          case K_SHOCK:
          case K_RIPPLE:
            p.size += p.grow * d;
            if (p.size < 0) p.size = 0;
            break;
          case K_MOTE: {
            var sway = Math.sin(clock * 3 + p.rot) * 26;
            p.x += (p.vx + sway) * d;
            p.y += p.vy * d;
            break;
          }
          case K_TEXT:
            p.y += p.vy * d;
            p.vy *= (1 - 1.6 * d);
            break;
          case K_BEAM:
            // 前 0.12s 保持满亮（跨过 tick 间隔不断线），末尾 80ms 淡出
            p.alpha = p.life > BEAM_FADE ? 1 : (p.life / BEAM_FADE);
            break;
          case K_GLINT: {
            var t = 1 - p.life / p.max;
            var e2 = t * t;
            p.x = p.sx + (HUD_X - p.sx) * e2;
            p.y = p.sy + (HUD_Y - 16 - p.sy) * e2;
            break;
          }
        }
      }
      p.life -= d;
      if (p.life <= 0 || p.alpha <= 0 || p.size <= 0) release(i);
    }

    offsetObj.x = shakeX;
    offsetObj.y = shakeY;
    stats.alive = alive;
    stats.cap = cap;
    if (peak > stats.peak) stats.peak = peak;
    FX.timeScale = timeScale;
    FX.shakeX = shakeX;
    FX.shakeY = shakeY;
    FX.shakeAmp = shakeAmp;
    FX.flashAlpha = flashAlpha;
    FX.quality = quality;
    FX.combo = comboLevel;
    FX.frenzy = frenzyFade;
    FX.fusing = fuseOn ? 1 : 0;
    hitPoint.x = lastHitX;
    hitPoint.y = lastHitY;
    hitPoint.fresh = (clock - lastHitT <= HIT_MEMORY) ? 1 : 0;
  }

  // ---------- 绘制 ----------

  function makeGlow(inner, mid, outer) {
    var c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    var g = c.getContext('2d');
    if (!g || !g.createRadialGradient) return null;
    var grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, inner);
    grd.addColorStop(0.5, mid);
    grd.addColorStop(1, outer);
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  function ensureSprite() {
    if (spriteTried) return;
    spriteTried = true;
    if (typeof document === 'undefined' || !document.createElement) return;
    try {
      SPR_WHITE = makeGlow('rgba(255,255,255,1)', 'rgba(255,255,255,0.45)', 'rgba(255,255,255,0)');
      SPR_GOLD = makeGlow('rgba(255,246,214,1)', 'rgba(255,206,104,0.5)', 'rgba(255,166,60,0)');
    } catch (err) {
      SPR_WHITE = null; SPR_GOLD = null;
    }
  }

  function drawChip(ctx, p) {
    var img = chipArt(p.ore, p.w & 3);
    if (img) {                             // 贴图：沿用碎屑自己的 save/translate/rotate 变换
      var rh = p.size * 1.25;
      ctx.globalAlpha = p.alpha < 0 ? 0 : p.alpha;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.drawImage(img, -rh, -rh, rh * 2, rh * 2);
      ctx.restore();
      return;
    }
    var c = Math.cos(p.rot), s = Math.sin(p.rot);
    var sh = SH_R[p.w & 3];
    var r = p.size;
    ctx.globalAlpha = p.alpha < 0 ? 0 : p.alpha;
    ctx.fillStyle = p.col;
    ctx.beginPath();
    for (var k = 0; k < 5; k++) {
      var ux = SHX[k], uy = SHY[k], rr = r * sh[k];
      var vx = ux * c - uy * s, vy = ux * s + uy * c;
      if (k === 0) ctx.moveTo(p.x + vx * rr, p.y + vy * rr);
      else ctx.lineTo(p.x + vx * rr, p.y + vy * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawSpark(ctx, p) {
    var sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    if (sp < 1) sp = 1;
    var ux = p.vx / sp, uy = p.vy / sp;
    var px = -uy, py = ux;
    var sz = p.size;
    var tl = sz * 3.4;
    ctx.globalAlpha = p.alpha < 0 ? 0 : p.alpha;
    ctx.fillStyle = p.col;
    ctx.beginPath();
    // 三角形头部 + 拖尾四边形，一次 fill 完成
    ctx.moveTo(p.x + ux * sz * 1.5, p.y + uy * sz * 1.5);
    ctx.lineTo(p.x + px * sz * 0.62 - ux * sz * 0.45, p.y + py * sz * 0.62 - uy * sz * 0.45);
    ctx.lineTo(p.x + px * sz * 0.16 - ux * tl, p.y + py * sz * 0.16 - uy * tl);
    ctx.lineTo(p.x - px * sz * 0.16 - ux * tl, p.y - py * sz * 0.16 - uy * tl);
    ctx.lineTo(p.x - px * sz * 0.62 - ux * sz * 0.45, p.y - py * sz * 0.62 - uy * sz * 0.45);
    ctx.closePath();
    ctx.fill();
  }

  // 火花贴图：沿速度方向拉长，保留原来「三角头 + 拖尾」的朝向语义
  function drawSparkArt(ctx, p) {
    var img = sparkArt();
    if (!img) return false;
    var sz = p.size;
    var len = sz * 5.2, wide = sz * 2.2;
    ctx.globalAlpha = p.alpha < 0 ? 0 : p.alpha;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(p.vy, p.vx));
    ctx.drawImage(img, -len * 0.5, -wide * 0.5, len, wide);
    ctx.restore();
    return true;
  }

  // 尘团贴图：替换原来的白色径向光斑
  function drawDustArt(ctx, p) {
    var img = dustArt();
    if (!img) return false;
    var r = p.size * 1.5;
    ctx.globalAlpha = p.alpha < 0 ? 0 : p.alpha;
    ctx.drawImage(img, p.x - r, p.y - r, r * 2, r * 2);
    return true;
  }

  // 金星贴图：替换原来的四角星多边形
  function drawGlintArt(ctx, p) {
    var img = starArt();
    if (!img) return false;
    var t = 1 - p.life / p.max;
    var r = p.size * 2.2;
    ctx.globalAlpha = (1 - t) * 0.95;
    ctx.drawImage(img, p.x - r, p.y - r, r * 2, r * 2);
    return true;
  }

  function drawSoft(ctx, p, sprite) {
    var a = p.alpha < 0 ? 0 : p.alpha;
    ctx.globalAlpha = a;
    if (sprite) {
      var r = p.size * 2;
      ctx.drawImage(sprite, p.x - r, p.y - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = p.col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }
  }

  function draw(ctx) {
    if (!ctx) return;
    ensureSprite();
    var i, p, t;

    ctx.save();

    // 1) 碎屑（正常混合，最底层）
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    for (i = 0; i < cap; i++) {
      p = pool[i];
      if (!p.on || p.kind !== K_CHIP || p.delay > 0) continue;
      drawChip(ctx, p);
    }

    // 1b) 打穿一层的上弹提示：抬起 3~5px 的方块轮廓 + 底部露边
    for (i = 0; i < BNC_N; i++) {
      var nb = bnc[i];
      if (!nb.on) continue;
      var nbk = nb.t / nb.d;
      if (nbk > 1) nbk = 1;
      var up = nb.lift * Math.sin(Math.PI * nbk);
      var nba = 1 - nbk;
      ctx.globalAlpha = nba * 0.75;
      ctx.strokeStyle = C_STONE_L;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(nb.x + 0.8, nb.y - up + 0.8, nb.s - 1.6, nb.s - 1.6);
      ctx.globalAlpha = nba * 0.5;
      ctx.fillStyle = C_STONE_D;
      ctx.fillRect(nb.x + 2, nb.y - up + nb.s - 3, nb.s - 4, 2);
    }

    // 1c) 幸运 TNT 弹入途中的金框炸药盒（落地的引信由 2b) 统一画，不重复）
    for (i = 0; i < LK_N; i++) {
      var lt = lk[i];
      if (!lt.on) continue;
      var lkf = lt.t / lt.d;
      if (lkf > 1) lkf = 1;
      var ls = LK_S;
      var lx = lt.x - ls * 0.5, ly = lt.y - ls * 0.5;
      var tntImg = tntGoldArt();
      ctx.globalAlpha = 0.16 * (1 - lkf * 0.5);
      ctx.fillStyle = C_GOLD;
      ctx.fillRect(lx - 4, ly - 4, ls + 8, ls + 8);   // 金色光环属于弹入表现，两种路径都画
      if (tntImg) {
        ctx.globalAlpha = 0.92;
        ctx.drawImage(tntImg, lx, ly, ls, ls);
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = C_GOLD;
        ctx.lineWidth = 1.8;
        ctx.strokeRect(lx - 1.5, ly - 1.5, ls + 3, ls + 3);
      } else {
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = C_TNT;
        ctx.fillRect(lx, ly, ls, ls);
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = C_TNT_L;
        ctx.fillRect(lx + 2, ly + 2, ls - 4, 3);
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = C_GOLD_L;
        ctx.fillRect(lx + 6, ly + 8, 8, 6);
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = C_GOLD;
        ctx.lineWidth = 1.8;
        ctx.strokeRect(lx - 1.5, ly - 1.5, ls + 3, ls + 3);
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = C_GOLD_L;
        ctx.lineWidth = 1;
        ctx.strokeRect(lx + 1, ly + 1, ls - 2, ls - 2);
      }
    }

    // 2) 加色层：粉尘 / 火花 / 环 / 掉落微光 / 狂热金粒
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < cap; i++) {
      p = pool[i];
      if (!p.on || p.delay > 0) continue;
      switch (p.kind) {
        case K_DUST:
          if (!drawDustArt(ctx, p)) drawSoft(ctx, p, SPR_WHITE);
          break;
        case K_MOTE:
          drawSoft(ctx, p, SPR_GOLD);
          break;
        case K_SPARK:
          if (!drawSparkArt(ctx, p)) drawSpark(ctx, p);
          break;
        case K_RADIAL:
          drawSpark(ctx, p);
          break;
        case K_RING:
        case K_SHOCK:
        case K_RIPPLE: {
          t = 1 - p.life / p.max;
          if (t < 0) t = 0;
          var fade = 1 - t;
          ctx.globalAlpha = fade * fade * 0.95;
          ctx.strokeStyle = p.col;
          ctx.lineWidth = p.w * Math.pow(fade, 1.4) + 0.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size > 0.5 ? p.size : 0.5, 0, TAU);
          ctx.stroke();
          break;
        }
        case K_GLINT: {
          if (drawGlintArt(ctx, p)) break;
          var dx = HUD_X - p.x, dy = (HUD_Y - 16) - p.y;
          var len = Math.sqrt(dx * dx + dy * dy) || 1;
          var gx = dx / len, gy = dy / len;
          t = 1 - p.life / p.max;
          ctx.globalAlpha = (1 - t) * 0.95;
          ctx.fillStyle = p.col;
          ctx.beginPath();
          ctx.moveTo(p.x + gx * p.size * 2.2, p.y + gy * p.size * 2.2);
          ctx.lineTo(p.x - gy * p.size, p.y + gx * p.size);
          ctx.lineTo(p.x + gy * p.size, p.y - gx * p.size);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case K_BEAM: {
          // 竖直光束：外侧两层半透明辉光 + 核心亮线，全部矩形叠层，不用 blur
          var ba = p.alpha < 0 ? 0 : p.alpha;
          var bh = p.size, bw = p.w;
          ctx.globalAlpha = ba * 0.18;
          ctx.fillStyle = C_LASER_OUT;
          ctx.fillRect(p.x - bw * 3.2, p.y, bw * 6.4, bh);
          ctx.globalAlpha = ba * 0.38;
          ctx.fillStyle = C_LASER_MID;
          ctx.fillRect(p.x - bw * 1.9, p.y, bw * 3.8, bh);
          ctx.globalAlpha = ba * 0.95;
          ctx.fillStyle = p.col;
          ctx.fillRect(p.x - bw * 0.5, p.y, bw, bh);
          break;
        }
      }
    }

    // 2b) TNT 引信：脉冲红圈 + 倒计时环，最后 0.3 秒加速闪烁
    if (fuseOn) {
      var fuseK = fuseDelay > 0 ? 1 - fuseT / fuseDelay : 0;
      if (fuseK < 0) fuseK = 0;
      var fuseFast = (fuseDelay - fuseT) < 0.3;
      var flk = 0.5 + 0.5 * Math.sin(clock * (fuseFast ? 46 : 18));
      ctx.strokeStyle = fuseFast ? C_TNT_L : C_TNT;
      ctx.globalAlpha = 0.3 + 0.5 * flk;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(fuseX, fuseY, 7 + 19 * fuseK + (fuseCells > 9 ? 10 : 0), 0, TAU);   // 5×5 爆破画更大的圈
      ctx.stroke();
      ctx.globalAlpha = 0.2 + 0.4 * flk;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(fuseX, fuseY, 5 + 3 * flk + 7 * (1 - fuseK), 0, TAU);
      ctx.stroke();
    }

    // 方块内白闪
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < BF_N; i++) {
      var b = bf[i];
      if (!b.on) continue;
      var bk = 1 - b.t / b.d;
      ctx.globalAlpha = bk * bk * 0.62;
      ctx.fillStyle = C_RING_HOT;
      ctx.fillRect(b.x + 1, b.y + 1, b.s - 2, b.s - 2);
    }

    // 3) 跳字（最上层，保证可读）
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var curFont = '';
    for (i = 0; i < cap; i++) {
      p = pool[i];
      if (!p.on || p.kind !== K_TEXT || p.delay > 0) continue;
      t = 1 - p.life / p.max;
      if (t < 0) t = 0;
      var pop = 1 + 0.4 * Math.exp(-9 * t) * Math.cos(t * 11);   // 1.4 → 1.0 带过冲
      var al = t < 0.62 ? 1 : (1 - t) / 0.38;
      if (al < 0) al = 0;
      ctx.globalAlpha = al;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(pop, pop);
      var wantFont = p.size >= 20 ? FONT_B : (p.size >= 17 ? FONT_N : FONT_S);
      if (wantFont !== curFont) { ctx.font = wantFont; curFont = wantFont; }   // 避免每次重复解析字体
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10,14,20,0.85)';
      ctx.strokeText(p.str, 0, 0);
      ctx.fillStyle = p.col;
      ctx.fillText(p.str, 0, 0);
      ctx.restore();
    }

    ctx.restore();

    // 4) 全屏层：连击暖光 / 狂热金晕 / 闪白
    if (heat > 0.18 && SPR_GOLD && quality !== 'low') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.11 * heat;
      ctx.drawImage(SPR_GOLD, 30, 170, 330, 520);
    }
    if (frenzyFade > 0.01) {
      var pulse = 0.72 + 0.28 * Math.sin(clock * 6);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = C_GOLD;
      ctx.globalAlpha = 0.15 * frenzyFade * pulse;
      ctx.lineWidth = 16;
      ctx.strokeRect(3, 3, 384, 838);
      ctx.globalAlpha = 0.34 * frenzyFade * pulse;
      ctx.lineWidth = 3;
      ctx.strokeRect(2, 2, 386, 840);
    }
    // 深核钻机的环形贴图：向外扩散 + 淡出（lighter 混合，压在闪白之下）
    if (deepRing.t > 0) {
      var dimg = deepArt();
      if (dimg) {
        var k2 = 1 - deepRing.t / deepRing.max;          // 0 → 1
        var rr2 = deepRing.R * (0.55 + 0.75 * k2);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.max(0, 1 - k2) * 0.85;
        ctx.drawImage(dimg, deepRing.x - rr2, deepRing.y - rr2, rr2 * 2, rr2 * 2);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    if (flashAlpha > 0.004) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = flashAlpha;
      ctx.fillStyle = '#fff6e0';
      ctx.fillRect(-24, -24, 438, 892);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // ---------- 对外 ----------

  function setQuality(q) {
    var next = (q === 'mid' || q === 'low') ? q : 'high';
    if (next === quality && cap === CAP[next]) return;
    quality = next;
    rebuildPool(CAP[next]);
    if (next === 'low') { flashA = 0; flashAlpha = 0; shakeAmp = 0; shakeX = 0; shakeY = 0; }
    FX.quality = quality;
    FX.stats.cap = cap;
  }

  function clear() {
    deepRing.t = 0;
    for (var i = 0; i < cap; i++) if (pool[i].on) release(i);
    for (i = 0; i < BF_N; i++) bf[i].on = 0;
    for (i = 0; i < BNC_N; i++) bnc[i].on = 0;
    lastHitX = CX; lastHitY = CY; lastHitT = -1e9;
    lastFullBlock = null; lastFullClock = -1; lastFullOx = -1; lastFullOy = -1;
    fuseOn = 0; fuseT = 0; fuseAcc = 0; fuseSparks = 0;
    for (i = 0; i < LK_N; i++) lk[i].on = 0;
    hitPoint.x = CX; hitPoint.y = CY; hitPoint.fresh = 0;
    FX.fusing = 0;
    hitstopTimer = 0;
    timeScale = 1;
    shakeAmp = 0; shakeDur = 0; shakeT = 0; shakeX = 0; shakeY = 0;
    layersThisRound = 0; FX.layersThisRound = 0;
    tntChainMul = 1; lastBoomClock = -1e9;
    chainInfo.tnt = 1; chainInfo.shake = 1; chainInfo.sparks = 1;
    FX.shakeMul = 1;
    execInfo.count = 0; execInfo.sparks = 0;
    flashA = 0; flashAlpha = 0;
    comboLevel = 0; heat = 0;
    frenzyTimer = 0; frenzyFade = 0; moteAcc = 0;
    alive = 0; peak = 0;
    stats.alive = 0; stats.cap = cap;
    FX.timeScale = 1; FX.shakeX = 0; FX.shakeY = 0; FX.shakeAmp = 0; FX.flashAlpha = 0;
    resInfo.count = 0; resInfo.cells = 0;
    trInfo.count = 0; trInfo.sparks = 0; trInfo.pillars = 0;
  }

  function offset() { return offsetObj; }

  function offsetReset() { shakeAmp = 0; shakeDur = 0; shakeT = 0; shakeX = 0; shakeY = 0; offsetObj.x = 0; offsetObj.y = 0; FX.shakeX = 0; FX.shakeY = 0; FX.shakeAmp = 0; }

  function eachActive(fn) {
    for (var i = 0; i < cap; i++) {
      if (pool[i].on) fn(pool[i]);
    }
  }

  function init() {
    if (inited) return;
    var bus = BM.bus;
    if (!bus || typeof bus.on !== 'function') { console.warn('[FX] BM.bus 未就绪，未订阅事件'); return; }
    inited = true;
    bus.on('block:hit', onHit);
    bus.on('block:break', onBreak);
    bus.on('block:empty', onBreak);   // 整格挖空与 block:break 共用全套表现（同帧去重）
    bus.on('block:layer', onLayer);   // 只打穿一层：轻量表现
    bus.on('tnt:fuse', onFuse);
    bus.on('explosion', onExplosion);
    bus.on('drop:spawn', onDropSpawn);
    bus.on('drop:absorb', onAbsorb);
    bus.on('combo:update', onCombo);
    bus.on('frenzy:start', onFrenzyStart);
    bus.on('frenzy:end', onFrenzyEnd);
    bus.on('magnet:burst', onMagnetBurst);
    bus.on('laser:tick', onLaser);      // v3：竖直光束
    bus.on('quake:blast', onQuake);     // v3：三层冲击波
    bus.on('lucky:tnt', onLucky);       // v3：金框 TNT 弹入
    bus.on('resonance:blast', onResonance);     // v6：地心共振全屏冲击波
    bus.on('treasure:open', onTreasureOpen);    // v6：宝藏开箱金光
    bus.on('tool:execute', onExecute);          // v9：处决白闪 + 金色十字火花
    bus.on('round:start', onRoundStart);        // v9：新一局把碎层计数与震屏倍率归位
  }

  function onRoundStart() {
    layersThisRound = 0;
    execInfo.count = 0;
    tntChainMul = 1; lastBoomClock = -1e9;
    chainInfo.tnt = 1; chainInfo.shake = 1; chainInfo.sparks = 1;
    FX.layersThisRound = 0;
    FX.shakeMul = 1;
  }

  var FX = {
    init: init,
    update: update,
    draw: draw,
    shake: shake,
    flash: flash,
    setQuality: setQuality,
    clear: clear,
    offset: offset,
    offsetReset: offsetReset,
    eachActive: eachActive,
    stats: stats,
    KIND: { DUST: K_DUST, CHIP: K_CHIP, SPARK: K_SPARK, RING: K_RING, SHOCK: K_SHOCK, TEXT: K_TEXT, MOTE: K_MOTE, RIPPLE: K_RIPPLE, GLINT: K_GLINT, RADIAL: K_RADIAL, BEAM: K_BEAM },
    hitPoint: hitPoint,   // { x, y, fresh } 最近命中点，复用对象
    resonance: resInfo,   // 最近一次 resonance:blast 的读数（R / rings / shake / cells）
    execute: execInfo,    // 最近一次 tool:execute 的读数（count / x / y / sparks）
    layersThisRound: 0,   // 本局累计碎层（block:layer + block:break）
    shakeMul: 1,          // 震屏倍率 = min(1.4, (1 + 碎层 × 0.002) × 连环 TNT 倍率)
    chain: chainInfo,     // 最近一次爆炸的连环读数 { tnt, shake, sparks }
    treasure: trInfo,     // 最近一次 treasure:open 的读数（sparks / pillars）
    fusing: 0,
    timeScale: 1,
    quality: 'high',
    shakeX: 0,        // 与 offset() 同值，便于直接读字段；FX.draw 不做位移，由 main 施加
    shakeY: 0,
    shakeAmp: 0,      // 本次震屏的请求幅度（受 18px 硬上限钳制）
    flashAlpha: 0,
    combo: 0,
    frenzy: 0
  };

  rebuildPool(CAP.high);
  BM.FX = FX;
})();
