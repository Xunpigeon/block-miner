/* 03-grid.js — 棋盘生成 / 方块风程序化贴图 / 纵向堆叠层 / 裂纹与凹坑
   契约：docs/CONTRACT-V2.md §1 层堆叠、§2 矿物贴图、§5 TNT 多层穿透、§8 事件
   模块边界与事件总线见 docs/CONTRACT.md */
(function () {
  'use strict';

  var root = (typeof window !== 'undefined' && window) || globalThis;
  var BM = root.BM || (root.BM = {});

  var TEX_PX = 16;          // 每块 16x16 逻辑像素
  var TEX_SCALE = 6;        // 预渲染放大倍数；绘制时关闭平滑 → 硬边像素风
  var VARIANTS = 4;         // 每个矿种 × 富矿状态的 seed 变体数
  var CRACK_VARIANTS = 8;
  var PIT_VARIANTS = 8;
  var GAP = 4;              // 格间缝隙（设计空间像素）
  var HIT_DECAY = 6.6;      // hitT 每秒衰减（≈0.15 秒回弹）
  var LAYER_DECAY = 5.2;    // 层击穿上弹计时衰减
  var APPEAR_RATE = 4.6;
  var APPEAR_WAVE = 0.34;

  // totalLayers = layerMin + randInt(0, layerMax-layerMin) + mods.extraLayers，上限 layerCap
  // v3：layerMin/layerMax 优先取 zone 配置（CONFIG.zones[i]），缺字段回落到 BM.CONFIG.tuning
  var BASE_LAYERS = 6;
  var LAYER_MAX = 8;
  var LAYER_JITTER = 2;
  // v15：矿层加深 999 级（每级 +1 层）→ 内部硬上限同步 24 → 1024，tuning.layerCap 取 1020。
  // 抬的是「层数组能有多长」，每层血量仍然走 hpFor(hpMap, ore)：额外层与原有层同一套血量，
  // 所以「2 击碎一层」的手感不变，变的只是一格要挖多久。
  var MAX_LAYERS = 1024;    // 内部硬上限（v15：999 级矿层加深；v13 起是 24）
  var DEPTH_DARK = 0.12;    // 每深一层 -12% 亮度（-8% 太含蓄，玩家看不出「更深了」）
  var MAX_DEPTH_ALPHA = 0.6;
  var DEPTH_INSET = 0.05;   // 每深一层内阴影 +5%
  var MAX_DEPTH_INSET = 0.5;
  var SINK_PX = 2;          // 非首层整体下沉像素，堆叠观感更直观
  var LAYER_SLIDE = 6;      // 换层：新方块从下往上滑入 6px
  var PREVIEW_DEEP = 10;    // 层数 ≥ 10 的格子预览条加厚到 5px
  var DEPTH_RARE_BIAS = 0.04;   // 每深入一层，稀有矿（非填充矿）权重 +4%
  var DEPTH_RARE_CAP = 0.6;     // 稀有矿加权封顶 +60%（第 16 层往后不再加深偏置）

  var DEFAULT_RECT = { x: 10, y: 96, w: 370, h: 636 };
  // 契约 §2 的耐久；CONFIG 若已提供同 id 则以 CONFIG 为准
  var FALLBACK_ORES = {
    stone: { hp: 3, price: 1 },
    coal: { hp: 1, price: 6 },
    iron: { hp: 4, price: 40 },
    crystal: { hp: 40, price: 400 }
  };
  var GENERIC_ORE = { hp: 2, price: 1 };

  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  // 方块风调色板：离散灰阶石底 + 深灰团块 + 亮斑 + 大块矿斑
  var GRAY_BASE = 125;                                  // #7d7d7d
  var GRAY_MIN = 110, GRAY_MAX = 140;                   // 石底夹在 #6e6e6e–#8c8c8c
  var STONE_STEP = [-15, -9, -4, 4, 9, 15];
  var COARSE_STEP = [-6, -2, 2, 6];
  var OUT_R = 42, OUT_G = 42, OUT_B = 42;               // 块边描边 #2a2a2a
  var CLUMP = [85, 85, 85];                             // 深灰团块 #555
  var SPECK = [154, 154, 154];                          // 亮斑 #9a9a9a
  var BEV_HI = [160, 160, 160];                         // 内斜角左上 #a0a0a0
  var BEV_LO = [74, 74, 74];                            // 内斜角右下 #4a4a4a
  var GOLD_HI = [232, 204, 96];                         // 富矿金边（亮侧）
  var GOLD_LO = [166, 124, 40];                         // 富矿金边（暗侧）
  var COAL_DARK = [18, 18, 18];                         // 煤矿斑 #121212
  var COAL_HI = [58, 58, 58];                           // 煤高光 #3a3a3a
  var IRON_BODY = [216, 185, 138];                      // 铁矿斑 #d8b98a
  var IRON_EDGE = [169, 133, 92];                       // 铁暗边 #a9855c
  var GOLD_DEEP = [122, 84, 24];                        // 金矿暗端 #7a5418
  var GOLD_MID = [200, 145, 46];                        // 金矿中段 #c8912e
  var GOLD_BRIGHT = [255, 200, 87];                     // 金矿亮端 #ffc857
  var CRYS_BASE = [74, 63, 92];                         // 晶石石底 #4a3f5c（偏紫深岩）
  var CRYS_BODY = [111, 216, 224];                      // 晶石主色 #6fd8e0
  var CRYS_CORE = [168, 232, 255];                      // 晶石亮心 #a8e8ff
  var CRYS_EDGE = [47, 111, 122];                       // 晶石暗边 #2f6f7a
  var ORE_ART = {
    coal: { spots: 2, blob: COAL_DARK, blobHi: COAL_HI, edge: null, hiTop: true, hiN: 2, count: 5, size: 13, richSize: 13, jitter: 3 },
    // 金矿（v10）：没有独立美术 —— 有 BM.ART 时复用煤矿贴图再「金色化」（见 goldTint），
    // 没有 ART 时用这一份金色系程序化色块（暗端 #7a5418 / 亮块 #ffc857 / 高光 #c8912e）。
    // blob 结构与煤矿一致（圆钝团块 + 上缘高光），一眼就能和煤矿的纯黑团块区分开。
    gold: {
      spots: 2, blob: GOLD_BRIGHT, blobHi: GOLD_MID, edge: GOLD_DEEP, hiTop: true, hiN: 2,
      count: 5, size: 13, richSize: 13, jitter: 3, base: GOLD_DEEP
    },
    iron: { spots: 2, blob: IRON_BODY, blobHi: IRON_EDGE, edge: IRON_EDGE, hiTop: false, hiN: 0, count: 4, size: 10, richSize: 13, jitter: 2 },
    // 晶石：偏紫深岩底 + 紫青晶体团（四邻全晶体处点亮心、四周一圈锐利暗边）
    crystal: {
      spots: 1, facet: true, blob: CRYS_BODY, edge: CRYS_EDGE, core: CRYS_CORE,
      hiTop: false, hiN: 0, count: 4, size: 0, richSize: 0, jitter: 0, base: CRYS_BASE
    }
  };
  var STONE_ART = { spots: 0, blob: null, blobHi: null, edge: null, hiTop: false, hiN: 0, count: 0, size: 0, richSize: 0, jitter: 0 };
  // 贴图内部可画区域（外框 1px 描边与 1px 内斜角之内）
  var IN_LO = 2, IN_HI = TEX_PX - 3;

  // 常量样式串：draw 内不拼接字符串，避免每帧产生垃圾
  var C_WALL = '#1c1628';
  var C_WALL_LO = 'rgba(0,0,0,0.45)';
  var C_WALL_HI = 'rgba(150,130,190,0.14)';
  var C_SEAM = '#120c1c';
  var C_SOCKET = 'rgba(0,0,0,0.42)';
  var C_FRAME = 'rgba(0,0,0,0.55)';
  var C_PIT = '#1a1424';
  var C_PIT_SH = 'rgba(0,0,0,0.5)';
  var C_PIT_RIM = 'rgba(140,146,152,0.16)';
  var C_PIT_FLOOR = 'rgba(90,90,90,0.10)';
  var C_PIT_DEBRIS = 'rgba(96,98,100,0.66)';
  var C_PIT_DEBRIS_HI = 'rgba(150,152,154,0.5)';
  var C_EDGE_A = '#4c4e50';      // 下层边缘（露出的“下一张牌”）
  var C_EDGE_B = '#35373a';
  var C_EDGE_LINE = '#1e2022';
  var C_CRACK = 'rgba(10,11,13,0.9)';
  var C_CRACK_HI = 'rgba(196,200,206,0.2)';
  var C_CHIP = 'rgba(8,9,11,0.92)';
  var C_FLASH = 'rgba(255,250,238,0.38)';
  var C_LAYER_EDGE = 'rgba(255,250,235,0.85)';   // 换层瞬间的短暂亮边
  var C_DOT_EDGE = 'rgba(10,11,13,0.9)';         // 点位深色描边：亮灰石底上也分得开
  // v6 地心宝藏：32×32 逻辑像素的木箱 + 金锁 + 顶部呼吸光柱（全常量，draw 内不拼字符串）
  var C_TR_WOOD = '#6b4a2f';
  var C_TR_WOOD_HI = '#8a6440';
  var C_TR_LINE = '#2a1c10';
  var C_TR_GOLD = '#ffc857';
  var C_TR_GOLD_D = '#b8862a';
  var C_TR_GLOW = '#ffe9a8';
  var TREASURE_PX = 32;          // 宝箱逻辑像素边长
  var TREASURE_HP = 3000;        // 宝箱默认耐久（V6-ENDGAME §3）
  var TREASURE_ART_KEY = 'tiles.treasure';

  // v5 §1 岩层分级：每 3 层换一个岩层带（表层 / 蓝层 / 紫层 / 赤层），depth ≥9 一律归赤层
  // 罩色 / 描边色 / 点位填充色全部按 band 索引 0..3 常量查表，draw 内零拼接、零分配
  var BAND_LAYERS = 3;
  var BAND_MAX = 3;
  var BAND_EDGE_W = 2;                           // 方块内侧岩层描边宽度（px）
  var BAND_TINT = [                              // 罩色：贴图之上、裂纹之下；表层「无」（原色）
    null,
    'rgba(70,120,255,0.18)',
    'rgba(160,90,255,0.20)',
    'rgba(255,90,70,0.20)'
  ];
  var BAND_EDGE = ['#2a2a2a', '#4d7cff', '#a05cff', '#ff5a46'];   // 方块内侧 2px 描边
  var BAND_DOT = [                               // 层数点位填充 = 当前岩层色
    'rgba(255,246,225,0.92)',                    // 表层：保持原亮白（「现在的样子」）
    'rgba(70,120,255,0.92)',
    'rgba(160,90,255,0.94)',
    'rgba(255,90,70,0.94)'
  ];

  // v5 美术接线：岩层带纹理（tiles.band.tint.N / tiles.band.edge.N，N = band 索引 1..5）。
  // 有图就把纯色换成图（贴图之上、裂纹之下），没图（或旧环境 / 未解码）继续用上面的纯色，
  // 所以美术可以分批到货，grid.smoke 的纯色断言也仍然成立（测试环境不注入 BM.ART）。
  var BAND_TINT_ART = [];   // band → Image | null（undefined = 还没查过）
  var BAND_EDGE_ART = [];
  var BAND_ART_OWNER = null;    // 缓存归属的 BM.ART 实例；实例换了就清空（测试会换/删 BM.ART）

  function bandArt(kind, band) {
    var n = band | 0;
    if (n < 1) return null;
    var owner = BM.ART;
    if (owner !== BAND_ART_OWNER) {
      BAND_ART_OWNER = owner;
      BAND_TINT_ART.length = 0;
      BAND_EDGE_ART.length = 0;
    }
    var tbl = kind === 0 ? BAND_TINT_ART : BAND_EDGE_ART;
    var v = tbl[n];
    if (v !== undefined) return v;
    v = artOne('tiles.band.' + (kind === 0 ? 'tint.' : 'edge.') + n, 0);
    tbl[n] = v || null;
    return tbl[n];
  }

  var SHADE_FILL = [];      // depth → 叠暗填充串
  var SHADE_INNER = [];     // depth → 内阴影串

  function buildShades() {
    for (var d = 0; d <= MAX_LAYERS; d++) {
      var a = d * DEPTH_DARK;
      if (a > MAX_DEPTH_ALPHA) a = MAX_DEPTH_ALPHA;
      SHADE_FILL.push('rgba(0,0,0,' + a.toFixed(3) + ')');
      var ins = d > 0 ? 0.10 + d * DEPTH_INSET : 0;
      if (ins > MAX_DEPTH_INSET) ins = MAX_DEPTH_INSET;
      SHADE_INNER.push('rgba(0,0,0,' + ins.toFixed(3) + ')');
    }
  }
  buildShades();

  // ---------- 随机 / 噪声 ----------

  function mulberry32(a) {
    var s = a | 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash2(ix, iy, seed) {
    var h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 362437)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function clampByte(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

  function toInt(v, d) {
    var n = typeof v === 'number' ? Math.floor(v) : parseInt(v, 10);
    return isFinite(n) ? n : d;
  }

  function hexToRgb(hex) {
    var s = String(hex || '').replace('#', '');
    if (s.length === 3) s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    var v = parseInt(s, 16);
    if (!isFinite(v)) return [138, 138, 138];
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  function oreDef(id) {
    var C = BM.CONFIG;
    var d = C && C.ores ? C.ores[id] : null;
    return d || FALLBACK_ORES[id] || GENERIC_ORE;
  }

  function oreHash(id) {
    var h = 2166136261;
    var s = String(id);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // ---------- 分层可视化辅助 ----------

  var ORE_VEIN = {};        // ore -> 预览条颜色串（build 期预热，draw 内只查表不拼接）
  var ORE_VEIN_HI = {};     // ore -> 预览条顶端 1px 高光（同色提亮）

  // 下层矿色：CONFIG.ores[].vein 优先，其次 color，最后中性灰
  function oreVein(ore) {
    var s = ORE_VEIN[ore];
    if (s) return s;
    var d = oreDef(ore);
    s = d.vein || d.color || '#8a8a8a';
    ORE_VEIN[ore] = s;
    return s;
  }

  // 同色高光：把 vein 提亮一档，画在色条顶边，让色条像「露出一角」的矿
  function oreVeinHi(ore) {
    var s = ORE_VEIN_HI[ore];
    if (s) return s;
    var c = hexToRgb(oreVein(ore));
    s = 'rgb(' + clampByte(c[0] + 62) + ',' + clampByte(c[1] + 58) + ',' + clampByte(c[2] + 48) + ')';
    ORE_VEIN_HI[ore] = s;
    return s;
  }

  // 当前方块下面还没露出来的那一层矿种；没有下一层返回 null
  function nextOreOf(b) {
    if (!b || !b.stack || !(b.layers > 1)) return null;
    var nx = b.stack[b.depth + 1];
    return nx && nx.ore ? nx.ore : null;
  }

  // 底部内侧「下一层矿色条」厚度：没有下一层 → 0；普通 4px；层数 ≥10 → 5px
  function previewThickness(layers) {
    var n = typeof layers === 'number' && isFinite(layers) ? Math.floor(layers) : 0;
    if (n < 2) return 0;
    return n >= PREVIEW_DEEP ? 5 : 4;
  }

  // 剩余层数小方点：0 层 0 点 / 1–5 层 1 点 / 6–9 层 2 点 / ≥10 层 3 点
  function layerDots(layers) {
    var n = typeof layers === 'number' && isFinite(layers) ? Math.floor(layers) : 0;
    if (n < 1) return 0;
    if (n >= 10) return 3;
    return n >= 6 ? 2 : 1;
  }

  // ---------- 岩层分级（v5 §1） ----------

  // depth → 岩层带：0–2 表层 / 3–5 蓝层 / 6–8 紫层 / 9+ 赤层（越界夹紧，不凭空造带）
  function bandOf(depth) {
    var d = typeof depth === 'number' && isFinite(depth) ? Math.floor(depth) : 0;
    if (d <= 0) return 0;
    var b = (d / BAND_LAYERS) | 0;
    return b > BAND_MAX ? BAND_MAX : b;
  }

  function bandTint(band) { var t = BAND_TINT[band | 0]; return t === undefined ? null : t; }
  function bandEdge(band) { var c = BAND_EDGE[band | 0]; return c === undefined ? BAND_EDGE[0] : c; }
  function bandDot(band) { var c = BAND_DOT[band | 0]; return c === undefined ? BAND_DOT[0] : c; }

  // 点位边长：随格宽缩放，夹在 3–5px
  function dotSize(fw) {
    var ds = Math.round(fw * 0.075);
    if (ds < 3) return 3;
    if (ds > 5) return 5;
    return ds;
  }

  function newCanvas(w, h) {
    var c = null;
    if (typeof document !== 'undefined' && document && typeof document.createElement === 'function') {
      c = document.createElement('canvas');
    } else if (typeof OffscreenCanvas !== 'undefined') {
      c = new OffscreenCanvas(w, h);
    }
    if (!c) return null;
    c.width = w;
    c.height = h;
    return c;
  }

  // zoneCfg.layerMin/layerMax 优先，缺字段（或非数字）时按字段回落 tuning
  function layerBounds(zoneCfg) {
    var t = BM.CONFIG && BM.CONFIG.tuning;
    var min = BASE_LAYERS, max = LAYER_MAX, cap = MAX_LAYERS;
    if (t) {
      min = toInt(t.layerMin, BASE_LAYERS);
      max = toInt(t.layerMax, min + LAYER_JITTER);
      cap = toInt(t.layerCap, MAX_LAYERS);
    }
    if (zoneCfg) {
      min = toInt(zoneCfg.layerMin, min);
      max = toInt(zoneCfg.layerMax, max);
    }
    if (min < 1) min = 1;
    if (max < min) max = min;
    if (cap < min) cap = min;
    if (cap > MAX_LAYERS) cap = MAX_LAYERS;
    if (max > cap) max = cap;
    return { min: min, max: max, cap: cap };
  }

  function modsObj() {
    try {
      var m = (BM.CORE && typeof BM.CORE.mods === 'function') ? BM.CORE.mods() : null;
      return m || {};
    } catch (e) { return {}; }
  }

  // ---------- 预渲染资源（只在 init / build 生成一次） ----------

  var texMap = {};        // ore -> [普通变体[], 富矿变体[]]
  var texSig = {};        // ore -> [[sig...],[sig...]]
  var texAvg = {};        // ore -> [普通平均色, 富矿平均色]（调试/断言用）
  var crackTable = null;
  var pitTable = null;
  var wallLo = null;
  var wallHi = null;
  var glowSprite = null;
  var assetsReady = false;

  var geo = null;
  var apDelay = null;
  var baseRect = null;
  var timeT = 0;

  function artOf(oreId) {
    var art = ORE_ART[oreId];
    if (art) return art;
    if (oreId === 'stone') return STONE_ART;
    var def = oreDef(oreId);
    var c = hexToRgb(def.vein || def.color || '#8a8a8a');
    var dark = [Math.round(c[0] * 0.7), Math.round(c[1] * 0.7), Math.round(c[2] * 0.7)];
    return { spots: 2, blob: c, blobHi: dark, edge: dark, hiTop: false, hiN: 0, count: 4, size: 9, richSize: 12, jitter: 2 };
  }

  function putPx(buf, x, y, r, g, b) {
    if (x < 0 || y < 0 || x >= TEX_PX || y >= TEX_PX) return;
    var o = (y * TEX_PX + x) * 3;
    buf[o] = r; buf[o + 1] = g; buf[o + 2] = b;
  }

  // 4 邻域随机生长：得到不规则斑块（不用斜切长脉）；lo/hi 限定可画区域
  function growBlob(rng, size, lo, hi, ax, ay) {
    var set = new Uint8Array(TEX_PX * TEX_PX);
    var cells = [];
    var l = typeof lo === 'number' ? lo : 1;
    var h = typeof hi === 'number' ? hi : TEX_PX - 2;
    if (h - l < 2) { l = 1; h = TEX_PX - 2; }
    var sx = typeof ax === 'number' ? ax : l + ((rng() * (h - l + 1)) | 0);
    var sy = typeof ay === 'number' ? ay : l + ((rng() * (h - l + 1)) | 0);
    set[sy * TEX_PX + sx] = 1;
    cells.push(sx, sy);
    var want = size < 3 ? 3 : size;
    var guard = 0;
    while ((cells.length >> 1) < want && guard++ < 512) {
      var pick = ((rng() * (cells.length >> 1)) | 0) * 2;
      var px = cells[pick], py = cells[pick + 1];
      var dir = (rng() * 4) | 0;
      var nx = px + (dir === 0 ? 1 : dir === 1 ? -1 : 0);
      var ny = py + (dir === 2 ? 1 : dir === 3 ? -1 : 0);
      if (nx < l || ny < l || nx > h || ny > h) continue;
      var k = ny * TEX_PX + nx;
      if (set[k]) continue;
      set[k] = 1;
      cells.push(nx, ny);
    }
    return { set: set, cells: cells };
  }

  // 在 [lo,hi] 里挑一个离已用锚点最远的起点，避免几团矿斑叠成一坨
  function pickAnchor(rng, lo, hi, used) {
    var bestX = lo, bestY = lo, bestD = -1;
    for (var t = 0; t < 8; t++) {
      var ax = lo + ((rng() * (hi - lo + 1)) | 0);
      var ay = lo + ((rng() * (hi - lo + 1)) | 0);
      var d = 1e9, j;
      for (j = 0; j < used.length; j += 2) {
        var ddx = used[j] - ax, ddy = used[j + 1] - ay;
        var dd = ddx * ddx + ddy * ddy;
        if (dd < d) d = dd;
      }
      if (d > bestD) { bestD = d; bestX = ax; bestY = ay; }
    }
    return [bestX, bestY];
  }

  function pxIs(buf, x, y, rgb) {
    var o = (y * TEX_PX + x) * 3;
    return buf[o] === rgb[0] && buf[o + 1] === rgb[1] && buf[o + 2] === rgb[2];
  }

  // 晶石晶体团：菱形晶体面（45° 硬边，和煤/铁的圆钝团块一眼可分）
  // 外层 1px #2f6f7a 暗边 → 内层 #6fd8e0 主色 → 中心 #a8e8ff 亮心；菱形整块落在可画区内，绝不裁切
  function paintCrystal(buf, rng, rich, art) {
    var set = new Uint8Array(TEX_PX * TEX_PX);
    var pick = [];
    var used = [];
    var n = art.count + (rich ? 1 : 0);
    for (var i = 0; i < n; i++) {
      var r = 2 + ((rng() * (rich ? 2 : 1.4)) | 0);
      if (IN_LO + r > IN_HI - r) r = 2;
      var a = pickAnchor(rng, IN_LO + r, IN_HI - r, used);
      used.push(a[0], a[1]);
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          var d = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
          if (d > r) continue;
          var x = a[0] + dx, y = a[1] + dy;
          var k = y * TEX_PX + x;
          if (set[k]) continue;
          set[k] = 1;
          pick.push(x, y, d, r);
        }
      }
    }
    for (var j = 0; j < pick.length; j += 4) {
      var ring = pick[j + 2], rad = pick[j + 3];
      var col;
      if (ring >= rad) col = art.edge;                                    // 四边 1px 暗边
      else if (rad >= 3 && ring <= rad - 2) col = art.core;               // 大晶体才有亮心
      else col = art.blob;                                                // 主色
      putPx(buf, pick[j], pick[j + 1], col[0], col[1], col[2]);
    }
  }

  function paintBlob(buf, blob, rgb) {
    var c = blob.cells;
    for (var k = 0; k < c.length; k += 2) putPx(buf, c[k], c[k + 1], rgb[0], rgb[1], rgb[2]);
  }

  // 单块纹理：离散灰阶石底 → 1px 内斜角 → 深灰团块/亮斑 → 大块矿斑 → #2a2a2a 描边
  function paintTexture(oreId, variant, rich) {
    var art = artOf(oreId);
    var tseed = (oreHash(oreId) ^ Math.imul(variant + 7, 2654435761) ^ (rich ? 0x9e51 : 0)) | 0;
    var rng = mulberry32(tseed);
    var small = new Uint8ClampedArray(TEX_PX * TEX_PX * 3);
    var x, y, i, o, k;

    // 1) 石底：逐像素取离散灰阶并夹在 #6e6e6e–#8c8c8c（无插值 → 无渐变）
    //    晶石（art.base）换成偏紫深岩 #4a3f5c：同一组离散偏移量加到 RGB 三通道，仍是硬像素噪声
    var baseRgb = art.base || null;
    for (y = 0; y < TEX_PX; y++) {
      for (x = 0; x < TEX_PX; x++) {
        var fine = hash2(x, y, tseed);
        var coarse = hash2(x >> 2, y >> 2, tseed + 91);
        var off = STONE_STEP[(fine * 6) | 0] + COARSE_STEP[(coarse * 4) | 0];
        o = (y * TEX_PX + x) * 3;
        if (baseRgb) {
          small[o] = clampByte(baseRgb[0] + off);
          small[o + 1] = clampByte(baseRgb[1] + off);
          small[o + 2] = clampByte(baseRgb[2] + off);
        } else {
          var g = GRAY_BASE + off;
          if (g < GRAY_MIN) g = GRAY_MIN; else if (g > GRAY_MAX) g = GRAY_MAX;
          small[o] = g; small[o + 1] = g; small[o + 2] = g;
        }
      }
    }

    // 2) 1px 内斜角：左上 #a0a0a0 / 右下 #4a4a4a（富矿换成同结构的金边，外框仍是 #2a2a2a）
    var hiC = rich ? GOLD_HI : BEV_HI;
    var loC = rich ? GOLD_LO : BEV_LO;
    for (i = 1; i < TEX_PX - 1; i++) {
      putPx(small, i, 1, hiC[0], hiC[1], hiC[2]);
      putPx(small, 1, i, hiC[0], hiC[1], hiC[2]);
      putPx(small, i, TEX_PX - 2, loC[0], loC[1], loC[2]);
      putPx(small, TEX_PX - 2, i, loC[0], loC[1], loC[2]);
    }

    var baseBuf = small.slice();   // 内斜角之后的底图快照：修补被打边切断的孤立矿点

    // 3) 深灰团块 #555（2–3 个，明显但不压过矿斑）+ 少量亮斑 #9a9a9a
    var used = [];
    var clumpN = 2 + (rng() < 0.6 ? 1 : 0);
    for (i = 0; i < clumpN; i++) {
      var ca = pickAnchor(rng, IN_LO, IN_HI, used);
      used.push(ca[0], ca[1]);
      paintBlob(small, growBlob(rng, 5 + ((rng() * 6) | 0), IN_LO, IN_HI, ca[0], ca[1]), CLUMP);
    }
    var speckN = 3 + ((rng() * 3) | 0);
    for (i = 0; i < speckN; i++) {
      putPx(small, IN_LO + ((rng() * (IN_HI - IN_LO + 1)) | 0), IN_LO + ((rng() * (IN_HI - IN_LO + 1)) | 0),
        SPECK[0], SPECK[1], SPECK[2]);
    }
    // 矿石格再撒几颗深灰小点，做出矿石嵌在岩石里的质感
    for (i = 0; i < art.spots; i++) {
      putPx(small, IN_LO + ((rng() * (IN_HI - IN_LO + 1)) | 0), IN_LO + ((rng() * (IN_HI - IN_LO + 1)) | 0),
        CLUMP[0], CLUMP[1], CLUMP[2]);
    }

    // 4) 矿斑：成团的大块（不碎渣）→ 铁矿下缘暗边 / 煤矿 1–2 个高光点
    if (art.facet) {
      paintCrystal(small, rng, rich, art);          // 晶石：菱形晶体团
    } else if (art.blob) {
      var blobSet = new Uint8Array(TEX_PX * TEX_PX);
      var cells = [];
      var bn = art.count + (rich ? 1 : 0);
      var body = rich ? art.richSize : art.size;
      var anchors = [];
      for (i = 0; i < bn; i++) {
        var an = pickAnchor(rng, IN_LO, IN_HI, anchors);
        anchors.push(an[0], an[1]);
        var blob = growBlob(rng, body + ((rng() * (art.jitter + 1)) | 0) - (art.jitter >> 1),
          IN_LO, IN_HI, an[0], an[1]);
        for (k = 0; k < blob.cells.length; k += 2) {
          var bxx = blob.cells[k], byy = blob.cells[k + 1];
          blobSet[byy * TEX_PX + bxx] = 1;
          cells.push(bxx, byy);
        }
      }
      var br = art.blob[0], bg = art.blob[1], bb = art.blob[2];
      for (y = IN_LO; y <= IN_HI; y++) {
        for (x = IN_LO; x <= IN_HI; x++) {
          if (blobSet[y * TEX_PX + x]) putPx(small, x, y, br, bg, bb);
        }
      }
      if (art.edge) {
        // 下缘整段描暗边：连成一条，不碎成点
        for (y = IN_LO; y <= IN_HI; y++) {
          for (x = IN_LO; x <= IN_HI; x++) {
            if (!blobSet[y * TEX_PX + x]) continue;
            if (y >= IN_HI || !blobSet[(y + 1) * TEX_PX + x]) {
              putPx(small, x, y, art.edge[0], art.edge[1], art.edge[2]);
            }
          }
        }
      }
      if (art.edge) {
        // 修补：被暗边切断、四邻无同伴的孤立矿点退回底图，避免边缘碎成渣
        for (y = IN_LO; y <= IN_HI; y++) {
          for (x = IN_LO; x <= IN_HI; x++) {
            if (!pxIs(small, x, y, art.blob)) continue;
            var peers = 0;
            if (pxIs(small, x - 1, y, art.blob)) peers++;
            if (pxIs(small, x + 1, y, art.blob)) peers++;
            if (pxIs(small, x, y - 1, art.blob)) peers++;
            if (pxIs(small, x, y + 1, art.blob)) peers++;
            if (peers) continue;
            putPx(small, x, y, baseBuf[(y * TEX_PX + x) * 3], baseBuf[(y * TEX_PX + x) * 3 + 1], baseBuf[(y * TEX_PX + x) * 3 + 2]);
          }
        }
      }
      if (art.hiTop && cells.length) {
        // 高光只点在上/左边界上的团块像素，得到 1–2 颗干净的亮点
        var painted = 0, tries = 0, want = art.hiN + (rich ? 1 : 0);
        while (painted < want && tries++ < 60) {
          var pick = ((rng() * (cells.length >> 1)) | 0) * 2;
          var hx = cells[pick], hy = cells[pick + 1];
          var upOut = hy <= IN_LO || !blobSet[(hy - 1) * TEX_PX + hx];
          var lfOut = hx <= IN_LO || !blobSet[hy * TEX_PX + hx - 1];
          if (!upOut && !lfOut) continue;
          putPx(small, hx, hy, art.blobHi[0], art.blobHi[1], art.blobHi[2]);
          painted++;
        }
      }
      // 富矿：斑块里掺几颗更亮的结晶点
      if (rich && cells.length) {
        var spark = 2 + ((rng() * 2) | 0);
        for (i = 0; i < spark; i++) {
          var sp = ((rng() * (cells.length >> 1)) | 0) * 2;
          putPx(small, cells[sp], cells[sp + 1],
            br + 40 > 255 ? 255 : br + 40,
            bg + 34 > 255 ? 255 : bg + 34,
            bb + 30 > 255 ? 255 : bb + 30);
        }
      }
    } else if (rich) {
      // 富矿石头：掺几颗石英亮点
      for (i = 0; i < 3; i++) {
        putPx(small, IN_LO + ((rng() * (IN_HI - IN_LO + 1)) | 0), IN_LO + ((rng() * (IN_HI - IN_LO + 1)) | 0),
          196, 196, 196);
      }
    }

    // 5) 块边描边 #2a2a2a（整圈 1 逻辑像素）
    for (i = 0; i < TEX_PX; i++) {
      putPx(small, i, 0, OUT_R, OUT_G, OUT_B);
      putPx(small, i, TEX_PX - 1, OUT_R, OUT_G, OUT_B);
      putPx(small, 0, i, OUT_R, OUT_G, OUT_B);
      putPx(small, TEX_PX - 1, i, OUT_R, OUT_G, OUT_B);
    }

    var sig = 2166136261;
    for (i = 0; i < small.length; i++) { sig ^= small[i]; sig = Math.imul(sig, 16777619); }
    sig = sig >>> 0;

    // 平均色：测试用它断言「金矿明显不是煤矿的灰/黑」（不看像素、不依赖 canvas 实现）
    var avgR = 0, avgG = 0, avgB = 0, avgPx = TEX_PX * TEX_PX;
    for (i = 0; i < small.length; i += 3) { avgR += small[i]; avgG += small[i + 1]; avgB += small[i + 2]; }
    var avg = [Math.round(avgR / avgPx), Math.round(avgG / avgPx), Math.round(avgB / avgPx)];

    // 最近邻放大到实际显示尺寸（每逻辑像素 = TEX_SCALE 见方）
    var side = TEX_PX * TEX_SCALE;
    var cv = newCanvas(side, side);
    if (!cv) return null;
    var c2 = cv.getContext('2d');
    if (!c2) return null;
    var img = c2.createImageData(side, side);
    var dst = img.data;
    for (var ly = 0; ly < TEX_PX; ly++) {
      for (var lx = 0; lx < TEX_PX; lx++) {
        var so = (ly * TEX_PX + lx) * 3;
        var sr = small[so], sg = small[so + 1], sb = small[so + 2];
        for (var ry = 0; ry < TEX_SCALE; ry++) {
          var rowOff = ((ly * TEX_SCALE + ry) * side + lx * TEX_SCALE) * 4;
          for (var rx = 0; rx < TEX_SCALE; rx++) {
            var to = rowOff + rx * 4;
            dst[to] = sr; dst[to + 1] = sg; dst[to + 2] = sb; dst[to + 3] = 255;
          }
        }
      }
    }
    c2.putImageData(img, 0, 0);
    return { canvas: cv, sig: sig, avg: avg };
  }

  function walkCrack(rng, main) {
    var pts = [];
    var sx, sy;
    if (main) {
      var side = (rng() * 4) | 0;
      if (side === 0) { sx = rng(); sy = 0; }
      else if (side === 1) { sx = 1; sy = rng(); }
      else if (side === 2) { sx = rng(); sy = 1; }
      else { sx = 0; sy = rng(); }
    } else {
      sx = 0.15 + rng() * 0.7;
      sy = 0.15 + rng() * 0.7;
    }
    var tx = 0.26 + rng() * 0.48, ty = 0.26 + rng() * 0.48;
    pts.push(clamp01(sx), clamp01(sy));
    var cx = sx, cy = sy;
    for (var k = 0; k < 3; k++) {
      var nx = cx + (tx - cx) * (0.45 + rng() * 0.22) + (rng() - 0.5) * 0.26;
      var ny = cy + (ty - cy) * (0.45 + rng() * 0.22) + (rng() - 0.5) * 0.26;
      nx = clamp01(nx); ny = clamp01(ny);
      pts.push(nx, ny);
      cx = nx; cy = ny;
    }
    return new Float32Array(pts);
  }

  function walkBranch(rng, host) {
    var n = host.length / 2;
    var k = 1 + ((rng() * Math.max(1, n - 1)) | 0);
    var sx = host[k * 2], sy = host[k * 2 + 1];
    var dx = sx - 0.5, dy = sy - 0.5;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ang = Math.atan2(dy / len, dx / len) + (rng() - 0.5) * 0.9;
    var pts = [clamp01(sx), clamp01(sy)];
    var cx = sx, cy = sy;
    for (var j = 0; j < 2; j++) {
      var step = 0.15 + rng() * 0.16;
      cx = clamp01(cx + Math.cos(ang) * step + (rng() - 0.5) * 0.07);
      cy = clamp01(cy + Math.sin(ang) * step + (rng() - 0.5) * 0.07);
      pts.push(cx, cy);
    }
    return new Float32Array(pts);
  }

  function buildCrackTable() {
    var table = [];
    for (var v = 0; v < CRACK_VARIANTS; v++) {
      var rng = mulberry32(0x51ed + v * 7919);
      var levels = [];
      for (var lv = 0; lv < 3; lv++) {
        var mainLine = walkCrack(rng, true);
        var lines = [mainLine];
        for (var br = 0; br < lv; br++) lines.push(walkBranch(rng, mainLine));
        var i;
        var chips = [];
        var cn = 1 + lv * 2;
        for (i = 0; i < cn; i++) {
          chips.push(rng() * 0.86, rng() * 0.86, (rng() < 0.5 ? 1 : 2) / TEX_PX, (rng() < 0.5 ? 1 : 2) / TEX_PX);
        }
        levels.push({ lines: lines, chips: new Float32Array(chips) });
      }
      table.push(levels);
    }
    return table;
  }

  function buildPitTable() {
    var table = [];
    for (var v = 0; v < PIT_VARIANTS; v++) {
      var rng = mulberry32(0x9a3b + v * 6151);
      var quads = [];
      var qn = 5 + ((rng() * 3) | 0);
      for (var i = 0; i < qn; i++) {
        var cx = 0.16 + rng() * 0.68, cy = 0.16 + rng() * 0.68;
        var sz = 0.07 + rng() * 0.11;
        var rot = rng() * 3.14;
        var cs = Math.cos(rot), sn = Math.sin(rot);
        var w1 = sz * 0.5, h1 = sz * (0.3 + rng() * 0.4);
        quads.push(
          cx + (-w1 * cs + h1 * sn), cy + (-w1 * sn - h1 * cs),
          cx + (w1 * cs + h1 * sn), cy + (w1 * sn - h1 * cs),
          cx + (w1 * cs - h1 * sn), cy + (w1 * sn + h1 * cs),
          cx + (-w1 * cs - h1 * sn), cy + (-w1 * sn - h1 * cs)
        );
      }
      table.push(new Float32Array(quads));
    }
    return table;
  }

  function buildWallSpecks() {
    var rng = mulberry32(0x77ab11);
    var N = 54;
    var lo = [], hi = [];
    for (var i = 0; i < N; i++) {
      var nx = rng(), ny = rng(), w = 1 + rng() * 2.6, h = 1 + rng() * 2.2;
      if (rng() < 0.5) { hi.push(nx, ny, w, h); } else { lo.push(nx, ny, w, h); }
    }
    return { lo: new Float32Array(lo), hi: new Float32Array(hi) };
  }

  function buildGlow() {
    var size = 64;
    var cv = newCanvas(size, size);
    if (!cv) return null;
    var g2 = cv.getContext('2d');
    if (!g2) return null;
    var grad = g2.createRadialGradient(size * 0.5, size * 0.5, 0, size * 0.5, size * 0.5, size * 0.5);
    grad.addColorStop(0, 'rgba(255,236,180,0.42)');
    grad.addColorStop(0.45, 'rgba(255,214,140,0.16)');
    grad.addColorStop(1, 'rgba(255,200,120,0)');
    g2.fillStyle = grad;
    g2.fillRect(0, 0, size, size);
    return cv;
  }

  function ensureOreTex(ore) {
    if (!ore || texMap[ore]) return;
    var normal = [], rics = [], nSig = [], rSig = [], nAvg = null, rAvg = null;
    for (var v = 0; v < VARIANTS; v++) {
      var t0 = paintTexture(ore, v, false);
      if (t0) { normal.push(t0.canvas); nSig.push(t0.sig); if (!nAvg) nAvg = t0.avg; }
      var t1 = paintTexture(ore, v, true);
      if (t1) { rics.push(t1.canvas); rSig.push(t1.sig); if (!rAvg) rAvg = t1.avg; }
    }
    texMap[ore] = [normal, rics];
    texSig[ore] = [nSig, rSig];
    texAvg[ore] = [nAvg, rAvg];
    GRID._tex = texMap;
    GRID._texSig = texSig;
  }

  /* ---------- 金矿：复用煤矿贴图 + 金色化（build 期预生成，draw 内零分配） ----------
     没有独立美术资产：gold 的贴图键就是煤矿的键（tiles.ore.coal.normal / .rich），
     但在 build 期把每张煤矿图按亮度重映射到金色梯度（#7a5418 → #c8912e → #ffc857）
     存成离屏 canvas；draw 里只按 ore/rich 查表，不查 ART、不建对象。
     goldRamp 是纯函数（共享输出数组，零分配），测试直接用它断言色相落在金色区间。 */
  var GOLD_ORE = 'gold';
  var GOLD_SRC_ORE = 'coal';
  var GOLD_TINT_KEYS = ['tiles.ore.' + GOLD_SRC_ORE + '.normal', 'tiles.ore.' + GOLD_SRC_ORE + '.rich'];
  var goldOut = [0, 0, 0];
  var goldTint = [null, null];      // [普通[] , 富矿[]]：离屏金色化图
  var goldTintOwner = null;         // 缓存归属的 BM.ART 实例；换了就重建

  // 亮度 → 金色三段线性（暗端 #7a5418 / 中段 #c8912e / 亮端 #ffc857）
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
      if (d[i + 3] === 0) continue;                 // 透明像素保持透明
      var c = goldRamp(d[i], d[i + 1], d[i + 2]);
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
    }
    try { g.putImageData(img, 0, 0); } catch (e) { return null; }
    return cv;
  }

  // build 期调用：把煤矿贴图整批金色化成缓存（每张图只算一次）
  function buildGoldTint() {
    var art = BM.ART;
    if (goldTintOwner !== art) {
      goldTintOwner = art;
      goldTint[0] = null;
      goldTint[1] = null;
    }
    if (goldTint[0] || goldTint[1]) return;
    if (!art || typeof art.all !== 'function') return;
    for (var rich = 0; rich < 2; rich++) {
      var list = null;
      try { list = art.all(GOLD_TINT_KEYS[rich]); } catch (e) { list = null; }
      if (!list || !list.length) continue;
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var t = tintGold(list[i]);
        if (t) out.push(t);
      }
      if (out.length) goldTint[rich] = out;
    }
  }

  // draw 内只用这两个查表函数（不拼字符串、不分配）
  function goldArt(rich, seed) {
    var arr = goldTint[rich ? 1 : 0];
    if (!arr || !arr.length) return null;
    return arr[((seed >>> 2) % arr.length + arr.length) % arr.length];
  }

  function ensureAssets() {
    if (assetsReady) return;
    var C = BM.CONFIG;
    if (C && C.ores) { for (var id in C.ores) { if (C.ores[id]) ensureOreTex(id); } }
    for (var k in FALLBACK_ORES) { if (FALLBACK_ORES[k]) ensureOreTex(k); }
    ensureOreTex('stone'); ensureOreTex('coal'); ensureOreTex('iron'); ensureOreTex('crystal');
    if (!crackTable) crackTable = buildCrackTable();
    if (!pitTable) pitTable = buildPitTable();
    if (!wallLo) { var w = buildWallSpecks(); wallLo = w.lo; wallHi = w.hi; }
    if (!glowSprite) glowSprite = buildGlow();
    assetsReady = true;
  }

  function pickTex(ore, rich, seed) {
    var set = texMap[ore];
    if (!set) set = texMap.stone;
    if (!set) return null;
    var arr = rich ? set[1] : set[0];
    if (!arr || !arr.length) return null;
    return arr[((seed >>> 2) % arr.length + arr.length) % arr.length];
  }

  // ---------- 矿物权重 ----------

  // filler = 关卡里的"填充矿"（采石场 stone / 铁矿层 coal）；天赋 oreRateBonus 只压低它的权重。
  var FILLER_MIN_W = 8;          // 填充矿权重的绝对下限：份额换算不能把它压到 0 / 负数
  var ORE_BONUS_CAP = 0.25;      // 与 02-core 的 clamp 同一上限（build 也防外部注入的超界值）
  function pickList(entries, oreBonus, fillerId) {
    var list = [], total = 0, i, big = -1;
    for (i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || !e.ore) continue;
      var w = typeof e.weight === 'number' && e.weight > 0 ? e.weight : 0;
      if (w > 0 && (big < 0 || w > list[big].w)) big = list.length;
      list.push({ ore: e.ore, w: w });
      total += w;
    }
    if (!list.length) { list.push({ ore: 'stone', w: 1 }); total = 1; }
    if (total <= 0) { for (i = 0; i < list.length; i++) list[i].w = 1; total = list.length; }

    var fillerAt = -1;
    for (i = 0; i < list.length; i++) {
      if (fillerId && list[i].ore === fillerId) { fillerAt = i; break; }
    }
    if (fillerAt < 0) {
      for (i = 0; i < list.length; i++) if (list[i].ore === 'stone') { fillerAt = i; break; }
    }
    if (fillerAt < 0) fillerAt = big;      // 兜底：权重最大的那一种当填充矿

    var bonus = typeof oreBonus === 'number' && isFinite(oreBonus) ? oreBonus : 0;
    if (bonus < 0) bonus = 0;
    if (bonus > ORE_BONUS_CAP) bonus = ORE_BONUS_CAP;      // 超界值夹到 0.25（core 已夹一次，这里是第二道）
    if (bonus > 0 && fillerAt >= 0) {
      var fillerW = list[fillerAt].w;
      var others = total - fillerW;
      if (fillerW > 0 && others > 0) {
        var share = fillerW / total;
        var target = share - bonus;
        if (target < 0) target = 0;
        if (target > 0.9) target = 0.9;
        var nextW = others * target / (1 - target);
        if (nextW < 0) nextW = 0;
        /* 权重下限（安全边界）：填充矿永远还剩权重，不会被压到 0 / 负数。
           ① 绝对下限 FILLER_MIN_W = 8 恒生效；
           ② 相对下限「原权重 × (1 − bonus)」只在 target 已经压到 0 的那一段生效 ——
              份额换算在填充矿本来就重的关上算的是另一侧（第 1 关 stone 91 / coal 9：
              filler 91 → 79，coal 9 → 33.9 才是 +12pp 的正确换算），此时硬套
              91 × 0.88 = 80 会把还原封不动地留在 91 附近，把这条链的收益整条吃掉。 */
        var minW = target > 0 ? FILLER_MIN_W : Math.max(FILLER_MIN_W, fillerW * (1 - bonus));
        if (nextW < minW) nextW = minW;
        total = total - fillerW + nextW;
        list[fillerAt].w = nextW;
      }
    }
    if (total <= 0) { for (i = 0; i < list.length; i++) list[i].w = 1; total = list.length; }
    return { list: list, total: total, filler: fillerAt >= 0 ? list[fillerAt].ore : null };
  }

  function pickOre(pl, rng) {
    var r = rng() * pl.total;
    var acc = 0;
    for (var i = 0; i < pl.list.length; i++) {
      acc += pl.list[i].w;
      if (r < acc) return pl.list[i].ore;
    }
    return pl.list[pl.list.length - 1].ore;
  }

  // 深度偏置权重表：第 d 层把该关稀有矿（非填充矿）权重 ×(1 + 0.04d)，封顶 ×1.6
  // 越深越值钱，也让玩家愿意往下挖；表按层预计算，build 内不逐层重算
  function depthPool(pl, d) {
    var k = 1 + DEPTH_RARE_BIAS * (d > 0 ? d : 0);
    if (k > 1 + DEPTH_RARE_CAP) k = 1 + DEPTH_RARE_CAP;
    var list = pl.list, w = new Array(list.length), total = 0;
    for (var i = 0; i < list.length; i++) {
      var v = list[i].w;
      if (list[i].ore !== pl.filler) v = v * k;
      w[i] = v;
      total += v;
    }
    return { w: w, total: total };
  }

  function pickPoolOre(pool, pl, rng) {
    var r = rng() * pool.total, acc = 0;
    for (var i = 0; i < pool.w.length; i++) {
      acc += pool.w[i];
      if (r < acc) return pl.list[i].ore;
    }
    return pl.list[pl.list.length - 1].ore;
  }

  // ---------- 按关血量（v4 §4：zone.ores[].hp 覆盖 CONFIG.ores[].hp） ----------

  function hpOverrides(cfg) {
    var out = {};
    var list = cfg && cfg.ores;
    if (!list || !list.length) return out;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || !e.ore) continue;
      var h = toInt(e.hp, 0);
      if (h > 0) out[e.ore] = h;
    }
    return out;
  }

  function hpFor(map, id) {
    var v = map[id];
    if (typeof v === 'number' && v > 0) return v;
    var d = oreDef(id);
    return d.hp > 0 ? d.hp : 1;
  }

  // ---------- 稀有矿成脉（v4 §7） ----------

  var VEIN_MIN = 3;         // 每条矿脉最少格数（oreRateBonus = 0 的基准档）
  var VEIN_MAX = 5;         // 每条矿脉最多格数（oreRateBonus = 0 的基准档）
  var VEIN_TRIES = 40;      // 单条矿脉换个种子重试的次数
  // v12 矿脉容量三档：簇大小随 oreRateBonus 线性放大（0 → 3–5，0.06 → 4–7，0.12 → 5–9），
  // 超过最后一档按最后一档算（oreRateBonus 本身在 ORE_BONUS_CAP 封顶）
  var VEIN_SIZE_TIERS = [
    { bonus: 0, min: 3, max: 5 },
    { bonus: 0.06, min: 4, max: 7 },
    { bonus: 0.12, min: 5, max: 9 }
  ];
  var VEIN_ADJ_BONUS = 0.06;   // 从这一档起允许簇与簇相邻
  var VEIN_ADJ_BONUS2 = 0.12;  // 从这一档起允许贴 2 个
  var ORE_RATIO_CAP = 0.68;    // 贵重矿格数硬上限：留 32% 填充矿做对比
  var ADJ_DX = [1, -1, 0, 0];
  var ADJ_DY = [0, 0, 1, -1];

  // 某个 bonus 下的簇大小档（三档线性插值，0 档原样返回 3–5）
  function veinSizeTier(bonus) {
    var t = VEIN_SIZE_TIERS, last = t.length - 1, i;
    if (!(bonus > 0)) return { min: t[0].min, max: t[0].max };
    if (bonus >= t[last].bonus) return { min: t[last].min, max: t[last].max };
    for (i = 1; i <= last; i++) {
      if (bonus <= t[i].bonus) {
        var a = t[i - 1], b = t[i];
        var u = (bonus - a.bonus) / (b.bonus - a.bonus);
        return {
          min: Math.round(a.min + (b.min - a.min) * u),
          max: Math.round(a.max + (b.max - a.max) * u)
        };
      }
    }
    return { min: t[last].min, max: t[last].max };
  }

  // 簇与簇相邻的条数上限：0 档严格不相邻（原行为）
  function veinAdjCap(bonus) {
    if (bonus >= VEIN_ADJ_BONUS2) return 2;
    if (bonus >= VEIN_ADJ_BONUS) return 1;
    return 0;
  }

  // 矿脉条数区间：zone.veins（[min,max] 或 {min,max}）> zone.veinMin/veinMax > 默认 2–4
  function veinRange(cfg) {
    var lo = 2, hi = 4, v = cfg && cfg.veins;
    if (v && typeof v === 'object') {
      if (typeof v.length === 'number' && v.length >= 2) { lo = toInt(v[0], lo); hi = toInt(v[1], hi); }
      else { lo = toInt(v.min, lo); hi = toInt(v.max, hi); }
    } else if (cfg && (cfg.veinMin !== undefined || cfg.veinMax !== undefined)) {
      lo = toInt(cfg.veinMin, lo);
      hi = toInt(cfg.veinMax, hi);
    }
    if (lo < 0) lo = 0;
    if (hi < lo) hi = lo;
    return { min: lo, max: hi };
  }

  // 从随机种子格向四邻空位生长，长出连成一片的矿脉；凑不满 want 就换种子重试
  function growVein(rng, cols, rows, taken, near, want) {
    var n = cols * rows;
    var free = [];
    for (var i = 0; i < n; i++) if (!taken[i] && !near[i]) free.push(i);
    if (free.length < want) return null;
    var best = null;
    for (var attempt = 0; attempt < VEIN_TRIES; attempt++) {
      var cells = [free[(rng() * free.length) | 0]];
      var inside = {};
      inside[cells[0]] = 1;
      while (cells.length < want) {
        var cand = [];
        for (var c = 0; c < cells.length; c++) {
          var idx = cells[c], x = idx % cols, y = (idx - x) / cols;
          if (x + 1 < cols && !taken[idx + 1] && !near[idx + 1] && !inside[idx + 1]) cand.push(idx + 1);
          if (x > 0 && !taken[idx - 1] && !near[idx - 1] && !inside[idx - 1]) cand.push(idx - 1);
          if (y + 1 < rows && !taken[idx + cols] && !near[idx + cols] && !inside[idx + cols]) cand.push(idx + cols);
          if (y > 0 && !taken[idx - cols] && !near[idx - cols] && !inside[idx - cols]) cand.push(idx - cols);
        }
        if (!cand.length) break;
        var pick = cand[(rng() * cand.length) | 0];
        inside[pick] = 1;
        cells.push(pick);
      }
      if (cells.length >= want) return cells;
      if (cells.length >= VEIN_MIN && (!best || cells.length > best.length)) best = cells;
    }
    return best;
  }

  // 把 idx 四邻中「已属于别的簇」的簇号去重后写进 out，返回个数（out 至少 4 格）
  function adjIdsAt(idx, cols, rows, taken, clusterOf, out) {
    var x = idx % cols, y = (idx - x) / cols, m = 0;
    for (var k = 0; k < 4; k++) {
      var nx = x + ADJ_DX[k], ny = y + ADJ_DY[k];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      var ni = ny * cols + nx;
      if (!taken[ni]) continue;
      var cid = clusterOf[ni];
      if (!(cid >= 0)) continue;
      var dup = false;
      for (var s = 0; s < m; s++) if (out[s] === cid) { dup = true; break; }
      if (!dup) out[m++] = cid;
    }
    return m;
  }

  // 相邻是双向的：候选格四邻的簇号 ids[0..m) 里，既不能把本簇顶超 adjCap（have 已计入），
  // 也不能把任何一个已放置的簇顶超（对方的额度存在 clusterAdj 里）
  function fitsAdj(ids, m, clusterAdj, adjCap, have) {
    var extra = 0, s, h;
    for (s = 0; s < m; s++) {
      var cid = ids[s], known = false;
      if (have) for (h = 0; h < have.length; h++) if (have[h] === cid) { known = true; break; }
      if (known) continue;                              // 已记在本簇账上，不再重复计
      if (!(clusterAdj[cid] < adjCap)) return false;    // 对方额度已满
      extra++;
    }
    return (have ? have.length : 0) + extra <= adjCap;
  }

  // bonus ≥ 0.06 的矿脉生长：允许贴别的簇，但单簇贴住的簇数 ≤ adjCap；
  // 某格会贴超 → 该格不进候选；整簇长不满 want 就换种子重来，试满 VEIN_TRIES 次
  // 取「够 vmin 的最长一次」，都没有就放弃这条簇（剩余格数由溢出散铺补）
  function growVeinAdj(rng, cols, rows, taken, clusterOf, clusterAdj, adjCap, want, vmin) {
    var n = cols * rows;
    var free = [];
    for (var i = 0; i < n; i++) if (!taken[i]) free.push(i);
    if (!free.length) return null;
    if (want > free.length) want = free.length;
    var got = [0, 0, 0, 0], got2 = [0, 0, 0, 0];
    var best = null;
    for (var attempt = 0; attempt < VEIN_TRIES; attempt++) {
      var seedIdx = free[(rng() * free.length) | 0];
      var m0 = adjIdsAt(seedIdx, cols, rows, taken, clusterOf, got), s0, h;
      // 种子格：自己贴住的簇数 ≤ adjCap，且每个被贴的簇还有额度（相邻是双向的）
      if (!fitsAdj(got, m0, clusterAdj, adjCap, null)) continue;
      var cells = [seedIdx], inside = {}, have = [];
      inside[seedIdx] = 1;
      for (s0 = 0; s0 < m0; s0++) have.push(got[s0]);
      while (cells.length < want) {
        var cand = [];
        for (var c = 0; c < cells.length; c++) {
          var idx = cells[c], x = idx % cols, y = (idx - x) / cols;
          for (var k = 0; k < 4; k++) {
            var nx = x + ADJ_DX[k], ny = y + ADJ_DY[k];
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            var ni = ny * cols + nx;
            if (taken[ni] || inside[ni]) continue;
            var mm = adjIdsAt(ni, cols, rows, taken, clusterOf, got2);
            // 这一格若会让本簇贴超，或把某个已放置的簇顶到超限，就不进候选
            if (!fitsAdj(got2, mm, clusterAdj, adjCap, have)) continue;
            cand.push(ni);
          }
        }
        if (!cand.length) break;
        var pick = cand[(rng() * cand.length) | 0], gap;
        inside[pick] = 1;
        cells.push(pick);
        var mp = adjIdsAt(pick, cols, rows, taken, clusterOf, got2);
        for (gap = 0; gap < mp; gap++) {
          var pc = got2[gap], dup2 = false;
          for (h = 0; h < have.length; h++) if (have[h] === pc) { dup2 = true; break; }
          if (!dup2) have.push(pc);
        }
      }
      if (cells.length >= want) return cells;
      if (cells.length >= vmin && (!best || cells.length > best.length)) best = cells;
    }
    return best;
  }

  // 把 total 格摊到 k 条矿脉上，每条 vmin–vmax 格（缺参回落 3–5 的基准档）
  function veinLengths(rng, k, total, vmin, vmax) {
    var lo = vmin > 0 ? vmin : VEIN_MIN, hi = vmax >= lo ? vmax : VEIN_MAX;
    if (total < k * lo) total = k * lo;
    var lens = new Array(k), rest = total - k * lo, i;
    for (i = 0; i < k; i++) lens[i] = lo;
    while (rest > 0) {
      var at = -1, j = (rng() * k) | 0;
      if (lens[j] < hi) at = j;
      else for (i = 0; i < k; i++) if (lens[i] < hi) { at = i; break; }
      if (at < 0) break;
      lens[at]++;
      rest--;
    }
    return lens;
  }

  // ---------- 堆叠层 ----------

  function normalizeLayers(b) {
    if (typeof b.layers !== 'number' || !isFinite(b.layers)) b.layers = b.broken ? 0 : 1;
    if (typeof b.depth !== 'number' || !isFinite(b.depth)) b.depth = 0;
    if (typeof b.totalLayers !== 'number' || !isFinite(b.totalLayers)) b.totalLayers = b.layers + b.depth;
    if (typeof b.layerT !== 'number' || !isFinite(b.layerT)) b.layerT = 0;
  }

  function layerShade(depth) {
    var d = typeof depth === 'number' && depth > 0 ? Math.floor(depth) : 0;
    var alpha = d * DEPTH_DARK;
    if (alpha > MAX_DEPTH_ALPHA) alpha = MAX_DEPTH_ALPHA;
    var inset = d > 0 ? 0.10 + d * DEPTH_INSET : 0;
    if (inset > MAX_DEPTH_INSET) inset = MAX_DEPTH_INSET;
    return { alpha: alpha, inset: inset };
  }

  // 方块底部露出的下层边缘厚度（1–2px，层数越多越明显）
  function edgeThickness(layers) {
    var n = typeof layers === 'number' && isFinite(layers) ? Math.floor(layers) : 0;
    if (!(n > 1)) return 0;
    return n >= 5 ? 2 : 1;
  }

  function crackLevel(hp, maxHp) {
    if (hp <= 0) return 3;
    var ratio = maxHp > 0 ? hp / maxHp : 0;
    if (ratio <= 0.25) return 3;
    if (ratio <= 0.5) return 2;
    if (ratio <= 0.75) return 1;
    return 0;
  }

  function applyHit(block, dmg, dir) {
    var before = block.hp;
    var after = before - dmg;
    var overkill = after < 0 ? -after : 0;
    block.hp = after > 0 ? after : 0;
    block.hitT = 1;
    block.hitDir = dir;
    block.crack = crackLevel(block.hp, block.maxHp);
    emit('block:hit', { block: block, dmg: dmg, dir: dir });
    return overkill;
  }

  // 打穿当前顶层：刷新为下一层数据；归零则变坑洞
  // prev = 刚被打碎那一层的读数（05-drops 按它结算掉落；block 本身已是新层）
  function breakTopLayer(block) {
    var prev = { ore: block.ore, rich: !!block.rich, maxHp: block.maxHp };
    block.layers -= 1;
    block.depth += 1;
    if (block.layers > 0) {
      var nx = (block.stack && block.stack[block.depth]) ? block.stack[block.depth] : null;
      if (nx) {
        block.ore = nx.ore;
        block.rich = !!nx.rich;
        block.maxHp = nx.maxHp > 0 ? nx.maxHp : 1;
        if (typeof nx.seed === 'number') block.seed = nx.seed;
      } else {
        block.maxHp = block.maxHp > 0 ? block.maxHp : 1;
      }
      block.hp = block.maxHp;
      block.crack = 0;
      block.layerT = 1;                      // 下一层顶上来的小幅上弹
      emit('block:layer', { block: block, depth: block.depth, prev: prev });
      return false;
    }
    block.layers = 0;
    block.broken = true;
    block.hp = 0;
    block.crack = 3;
    emit('block:break', { block: block, ore: block.ore, rich: !!block.rich, chain: 0, prev: prev });
    emit('block:empty', { block: block, prev: prev });
    // 宝藏被挖穿：单独派发开箱事件（坐标 = 格中心世界坐标，表现层据此爆发金光）
    if (prev && prev.ore === 'treasure') {
      emit('treasure:open', {
        block: block,
        ox: block.ox,
        oy: block.oy,
        x: block.x + block.s * 0.5,
        y: block.y + block.s * 0.5
      });
    }
    return true;
  }

  // ---------- 绘制辅助（draw 内零分配） ----------

  // 美术贴图：BM.ART 缺失 / 图未解码 / 键不存在时返回 null，调用方一律回退程序化绘制
  var PIT_ART_KEY = 'tiles.pit';
  var CRACK_ART_KEYS = ['tiles.crack.1', 'tiles.crack.2', 'tiles.crack.3'];
  var ORE_ART_KEYS = {};          // ore -> { normal, rich }：key 只拼一次，draw 内只查表

  function artOne(key, index) {
    var art = BM.ART;
    if (!art || !art.one) return null;
    return art.one(key, index);
  }

  function oreArtKey(ore, rich) {
    var id = (typeof ore === 'string' && ore) ? ore : 'stone';
    var pair = ORE_ART_KEYS[id];
    if (!pair) pair = ORE_ART_KEYS[id] = { normal: '', rich: '' };
    if (rich) {
      if (!pair.rich) pair.rich = 'tiles.ore.' + id + '.rich';
      return pair.rich;
    }
    if (!pair.normal) pair.normal = 'tiles.ore.' + id + '.normal';
    return pair.normal;
  }

  // crack 阶段 0..3 → tiles.crack.1..3（越界夹紧，避免查不到键）
  function crackArtKey(crack) {
    var lv = crack | 0;
    if (lv > 3) lv = 3;
    if (lv < 1) lv = 1;
    return CRACK_ART_KEYS[lv - 1];
  }

  function drawCracks(ctx, b, w, ox, oy) {
    var crackArt = artOne(crackArtKey(b.crack), b.seed % 8);
    if (crackArt) { ctx.drawImage(crackArt, ox, oy, w, w); return; }
    var variants = crackTable ? crackTable[((b.seed % CRACK_VARIANTS) + CRACK_VARIANTS) % CRACK_VARIANTS] : null;
    var lv = variants ? variants[b.crack - 1] : null;
    if (!lv) return;
    var lw = w * 0.045;
    if (lw < 1) lw = 1;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = C_CRACK;
    ctx.beginPath();
    var i, j, p;
    for (i = 0; i < lv.lines.length; i++) {
      p = lv.lines[i];
      ctx.moveTo(ox + p[0] * w, oy + p[1] * w);
      for (j = 2; j < p.length; j += 2) ctx.lineTo(ox + p[j] * w, oy + p[j + 1] * w);
    }
    ctx.stroke();
    ctx.strokeStyle = C_CRACK_HI;
    ctx.lineWidth = Math.max(1, lw * 0.4);
    ctx.stroke();
    var chips = lv.chips;
    if (chips.length) {
      ctx.fillStyle = C_CHIP;
      for (i = 0; i < chips.length; i += 4) {
        ctx.fillRect(ox + chips[i] * w, oy + chips[i + 1] * w, chips[i + 2] * w, chips[i + 3] * w);
      }
    }
  }

  // 挖空的格子：有 tiles.pit 贴图就用贴图（贴图自带坑壁与碎石），否则回退程序化绘制
  // 宝箱的 32×32 逻辑像素换算：x/y/w/h 都是逻辑像素，u = 实际像素 / 32
  function trRect(ctx, ox, oy, u, x, y, w, h, col) {
    ctx.fillStyle = col;
    ctx.fillRect(ox + x * u, oy + y * u, w * u, h * u);
  }

  // 地心宝藏格：顶部呼吸光柱（alpha 0.15–0.35）+ 木箱体 + 2px 深描边 + 金锁扣
  // BM.ART 有 tiles.treasure 时优先用图（光柱仍然画）
  function drawTreasure(ctx, b, fx, fy, fw, alpha) {
    var u = fw / TREASURE_PX;
    var breath = 0.5 + 0.5 * Math.sin(timeT * 1.7 + (b.seed & 3));
    var ba = 0.15 + 0.20 * breath;                  // 0.15 → 0.35 缓慢呼吸
    if (ba < 0.15) ba = 0.15; else if (ba > 0.35) ba = 0.35;
    ctx.globalAlpha = alpha * ba * 0.5;
    trRect(ctx, fx, fy, u, 10, -14, 12, 18, C_TR_GLOW);
    ctx.globalAlpha = alpha * ba;
    trRect(ctx, fx, fy, u, 13, -14, 6, 18, C_TR_GOLD);
    ctx.globalAlpha = alpha;
    var art = artOne(TREASURE_ART_KEY, b.seed % 8);
    if (art) {
      ctx.drawImage(art, fx, fy, fw, fw);
      ctx.globalAlpha = alpha;
      return;
    }
    // 盖（描边 + 木体 + 顶面高光）
    trRect(ctx, fx, fy, u, 2, 4, 28, 9, C_TR_LINE);
    trRect(ctx, fx, fy, u, 4, 6, 24, 5, C_TR_WOOD);
    trRect(ctx, fx, fy, u, 4, 6, 24, 1, C_TR_WOOD_HI);
    // 箱体（描边 + 木体 + 左右高光 + 底部内阴影）
    trRect(ctx, fx, fy, u, 2, 13, 28, 17, C_TR_LINE);
    trRect(ctx, fx, fy, u, 4, 15, 24, 13, C_TR_WOOD);
    trRect(ctx, fx, fy, u, 4, 15, 2, 13, C_TR_WOOD_HI);
    trRect(ctx, fx, fy, u, 26, 15, 2, 13, C_TR_WOOD_HI);
    trRect(ctx, fx, fy, u, 4, 26, 24, 2, C_TR_LINE);
    // 金色锁扣（压在盖/体接缝上）+ 钥匙孔
    trRect(ctx, fx, fy, u, 13, 11, 6, 8, C_TR_GOLD_D);
    trRect(ctx, fx, fy, u, 14, 12, 4, 6, C_TR_GOLD);
    trRect(ctx, fx, fy, u, 15, 14, 2, 3, C_TR_LINE);
    ctx.globalAlpha = alpha;
  }

  function drawPit(ctx, b) {
    var pitArt = artOne(PIT_ART_KEY, b.seed % 4);
    if (pitArt) ctx.drawImage(pitArt, b.x, b.y, b.s, b.s);
    else paintPit(ctx, b);
    if (b.hitT > 0.002) {
      ctx.globalAlpha = 0.26 * b.hitT;
      ctx.fillStyle = C_FLASH;
      ctx.fillRect(b.x + 1, b.y + 1, b.s - 2, b.s - 2);
      ctx.globalAlpha = 1;
    }
  }

  // 程序化凹坑：坑底 + 内阴影 + 碎石堆，不是纯黑洞
  function paintPit(ctx, b) {
    var x = b.x, y = b.y, s = b.s;
    ctx.fillStyle = C_PIT;
    ctx.fillRect(x, y, s, s);
    var floor = s * 0.34; if (floor < 1) floor = 1;
    ctx.fillStyle = C_PIT_FLOOR;
    ctx.fillRect(x + s * 0.16, y + s * 0.3, s * 0.68, s * 0.56);
    var sh = s * 0.2; if (sh < 1) sh = 1;
    ctx.fillStyle = C_PIT_SH;
    ctx.fillRect(x, y, s, sh);
    ctx.fillRect(x, y, s * 0.14, s);
    ctx.fillStyle = C_PIT_RIM;
    var rim = s * 0.07; if (rim < 1) rim = 1;
    ctx.fillRect(x, y + s - rim, s, rim);
    ctx.fillRect(x + s - rim, y, rim, s);

    var quads = pitTable ? pitTable[((b.seed % PIT_VARIANTS) + PIT_VARIANTS) % PIT_VARIANTS] : null;
    if (quads && quads.length) {
      ctx.fillStyle = C_PIT_DEBRIS;
      ctx.beginPath();
      for (var i = 0; i < quads.length; i += 8) {
        ctx.moveTo(x + quads[i] * s, y + quads[i + 1] * s);
        ctx.lineTo(x + quads[i + 2] * s, y + quads[i + 3] * s);
        ctx.lineTo(x + quads[i + 4] * s, y + quads[i + 5] * s);
        ctx.lineTo(x + quads[i + 6] * s, y + quads[i + 7] * s);
        ctx.closePath();
      }
      ctx.fill();
      ctx.fillStyle = C_PIT_DEBRIS_HI;
      ctx.beginPath();
      for (var j = 0; j < quads.length; j += 8) {
        ctx.moveTo(x + quads[j] * s, y + quads[j + 1] * s);
        ctx.lineTo(x + quads[j + 2] * s, y + quads[j + 3] * s);
        ctx.closePath();
      }
      ctx.fill();
    }
  }

  // 换层瞬间的短暂亮边：趁 layerT 还在，四边扫一圈亮框，让「换了一层」被看见
  function drawLayerFlash(ctx, fx, fy, fw, a) {
    var ew = fw * 0.06;
    if (ew < 2) ew = 2;
    ctx.globalAlpha = a * 0.8;
    ctx.fillStyle = C_LAYER_EDGE;
    ctx.fillRect(fx, fy, fw, ew);
    ctx.fillRect(fx, fy + fw - ew, fw, ew);
    ctx.fillRect(fx, fy, ew, fw);
    ctx.fillRect(fx + fw - ew, fy, ew, fw);
  }

  // 岩层带标识：罩色（方块贴图之上、裂纹之下）+ 方块内侧 2px 岩层描边
  // 让「这是另一层岩」一眼可见；颜色一律查常量表，不拼字符串
  function drawStrata(ctx, b, fx, fy, fw, a) {
    var band = bandOf(b.depth);
    var tint = BAND_TINT[band];
    if (tint) {
      ctx.globalAlpha = a;
      ctx.fillStyle = tint;
      ctx.fillRect(fx, fy, fw, fw);
    }
    var ew = BAND_EDGE_W;
    var cap = fw * 0.18;
    if (ew > cap) ew = cap;
    ctx.globalAlpha = a * 0.95;
    ctx.fillStyle = BAND_EDGE[band];
    ctx.fillRect(fx, fy, fw, ew);                 // 上
    ctx.fillRect(fx, fy + fw - ew, fw, ew);       // 下
    ctx.fillRect(fx, fy, ew, fw);                 // 左
    ctx.fillRect(fx + fw - ew, fy, ew, fw);       // 右
    // 美术纹理（tiles.band.tint/edge.N）：叠在纯色之上只加细节，不替换纯色 ——
    // 纯色仍是主调（§1 表里的颜色是契约），纹理只是让岩层「有质地」。
    var tintImg = bandArt(0, band);
    if (tintImg && a > 0.02) {
      ctx.globalAlpha = a * 0.5;
      ctx.drawImage(tintImg, fx, fy, fw, fw);
    }
    var edgeImg = bandArt(1, band);
    if (edgeImg && a > 0.02) {
      ctx.globalAlpha = a * 0.45;
      ctx.drawImage(edgeImg, fx, fy, fw, fw);
    }
    ctx.globalAlpha = a;
  }

  // 分层徽标：底部内侧「下一层矿色条」+ 色条上方右侧的剩余层数点位
  // 竖向叠放（自上而下）：层数点位 → 1px 深色分隔线 → 矿色条（贴块底边）
  function drawLayerBadges(ctx, b, fx, fy, fw, a) {
    var barH = previewThickness(b.layers);
    var dots = layerDots(b.layers);
    if (barH <= 0 && dots <= 0) return;
    var cap = fw * 0.12;
    if (barH > cap) barH = cap;
    var barTop = fy + fw - barH;
    var ore = nextOreOf(b) || b.ore;
    if (barH > 0) {
      // 1) 半透明暗底：色条压在亮灰石面上不糊
      ctx.globalAlpha = a * 0.55;
      ctx.fillStyle = C_EDGE_LINE;
      ctx.fillRect(fx, barTop - 1, fw, barH + 1);
      // 2) 1px 深色分隔线：色条与本层块面硬切开
      ctx.globalAlpha = a * 0.95;
      ctx.fillStyle = C_EDGE_LINE;
      ctx.fillRect(fx, barTop - 1, fw, 1);
      // 3) 下一层矿色条 + 顶边 1px 同色高光（像「露出一角」的矿）
      ctx.fillStyle = oreVein(ore);
      ctx.fillRect(fx + 1, barTop, fw - 2, barH);
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = oreVeinHi(ore);
      ctx.fillRect(fx + 1, barTop, fw - 2, 1);
    }
    if (dots > 0) {
      // 层数档位：3–5px 实心方点，1px 深色描边 + 当前岩层色填充，右侧对齐压在分隔线上方
      var dotFill = BAND_DOT[bandOf(b.depth)];
      var ds = dotSize(fw);
      var boxW = ds + 2;
      var pitch = ds + 3;
      var boxTop = barTop - ds - 3;
      var firstX = fx + fw - 2 - boxW - (dots - 1) * pitch;
      if (firstX >= fx + 1) {
        for (var i = 0; i < dots; i++) {
          var bx = firstX + i * pitch;
          ctx.globalAlpha = a * 0.92;
          ctx.fillStyle = C_DOT_EDGE;
          ctx.fillRect(bx, boxTop, boxW, boxW);
          ctx.globalAlpha = a * 0.95;
          ctx.fillStyle = dotFill;
          ctx.fillRect(bx + 1, boxTop + 1, ds, ds);
        }
      }
    }
  }

  // ---------- BM.GRID ----------

  var GRID = {
    blocks: [],
    flat: [],

    init: function (ctx, rect) {
      var r = rect;
      if (!r) {
        var B = BM.BOARD;
        r = (B && B.w > 0 && B.h > 0) ? B : DEFAULT_RECT;
      }
      baseRect = {
        x: toInt(r.x, DEFAULT_RECT.x),
        y: toInt(r.y, DEFAULT_RECT.y),
        w: toInt(r.w, DEFAULT_RECT.w),
        h: toInt(r.h, DEFAULT_RECT.h)
      };
      GRID._ctx = ctx || null;
      timeT = 0;
      ensureAssets();
    },

    build: function (zoneCfg) {
      ensureAssets();
      buildGoldTint();          // 金矿：复用煤矿贴图并金色化（每关建棋盘时预生成一次）
      var cfg = zoneCfg;
      if (typeof cfg === 'string') {
        var C0 = BM.CONFIG;
        cfg = C0 && C0.zones ? findZone(C0.zones, zoneCfg) : null;
      }
      cfg = cfg || {};
      var cols = toInt(cfg.cols, 6);
      var rows = toInt(cfg.rows, 8);
      if (cols < 1) cols = 1;
      if (rows < 1) rows = 1;

      var rect = baseRect || DEFAULT_RECT;
      var step = Math.floor(Math.min(rect.w / cols, rect.h / rows));
      if (step < 10) step = 10;
      var gap = GAP;
      if (gap > step * 0.22) gap = Math.round(step * 0.22);
      var s = step - gap;
      var totalW = step * cols, totalH = step * rows;
      var originX = Math.round(rect.x + (rect.w - totalW) * 0.5);
      var originY = Math.round(rect.y + (rect.h - totalH) * 0.5);
      var halfGap = Math.round(gap * 0.5);
      geo = {
        x: rect.x, y: rect.y, w: rect.w, h: rect.h,
        step: step, gap: gap, s: s, cols: cols, rows: rows,
        originX: originX, originY: originY
      };

      var m = modsObj();
      var bounds = layerBounds(cfg);
      var extra = toInt(m.extraLayers, 0);
      if (extra < 0) extra = 0;
      var jitter = bounds.max - bounds.min;
      var oreBonus = typeof m.oreRateBonus === 'number' && isFinite(m.oreRateBonus) ? m.oreRateBonus : 0;
      if (oreBonus < 0) oreBonus = 0;

      var entries = (cfg.ores && cfg.ores.length) ? cfg.ores : [{ ore: 'stone', weight: 1, richRate: 0.10 }];
      var pl = pickList(entries, oreBonus, cfg.filler);
      var richOf = {};
      for (var e2 = 0; e2 < entries.length; e2++) {
        var en = entries[e2];
        if (!en || !en.ore) continue;
        richOf[en.ore] = typeof en.richRate === 'number' ? en.richRate : 0.10;
        ensureOreTex(en.ore);          // 区块配置里出现的新矿种在这里补贴图（不在 draw 里分配）
        oreVein(en.ore);               // 预览条颜色同样预热，draw 内只查表
        oreVeinHi(en.ore);             // 高光色同理
      }

      // 每层的加权池：第 d 层把稀有矿权重往 +4%/层 偏（越深越值钱）
      var depthPools = [];
      for (var dq = 0; dq <= bounds.cap; dq++) depthPools[dq] = depthPool(pl, dq);

      var rng = mulberry32((Date.now() ^ (Math.random() * 0xffffffff)) | 0);
      var n = cols * rows;
      var hpMap = hpOverrides(cfg);

      // 先按权重定「填充矿」（pickList 已按 zone.filler / 权重最大者挑好）与「矿脉矿」
      var veinOre = null;
      var veinPool = { list: [], total: 0 };
      for (var vi = 0; vi < pl.list.length; vi++) {
        var vp = pl.list[vi];
        if (!(vp.w > 0) || vp.ore === pl.filler) continue;
        veinPool.list.push(vp);
        veinPool.total += vp.w;
      }
      if (veinPool.list.length) veinOre = pickOre(veinPool, rng);

      var oreGrid = new Array(n), veinSet = null, i = 0;
      GRID.lastVein = null;        // 每局重置矿脉读数（本局无矿脉矿时保持 null）
      for (i = 0; i < n; i++) oreGrid[i] = pl.filler;

      // 稀有矿成脉：2–4 条（zone.veins 可调）、四邻接连通；簇大小与相邻上限随 oreRateBonus 放大，
      // 矿脉装不下的部分由「溢出散铺」以单格补上；其余格子全是填充矿
      if (veinOre) {
        var vr = veinRange(cfg);
        var share = 0;
        for (i = 0; i < pl.list.length; i++) if (pl.list[i].ore === veinOre) share = pl.list[i].w / pl.total;
        if (share > 0 && vr.max >= 1) {
          var tier = veinSizeTier(oreBonus);
          var vmin = tier.min, vmax = tier.max;
          var adjCap = veinAdjCap(oreBonus);
          var capCells = Math.floor(n * ORE_RATIO_CAP);     // 贵重矿格数硬上限（≤ 68%）
          var want = Math.round(share * n);                 // 矿量仍由权重份额决定（收益结构不变）
          if (want < vmin) want = vmin;                     // 每关至少 1 条矿脉
          if (want > vmax * vr.max) want = vmax * vr.max;
          if (want > capCells) want = capCells;
          // 条数：先按矿量份额定出「每条都能吃满 vmin–vmax 格」的可行区间，再用 zone.veins 收窄
          var kLo = Math.max(1, Math.ceil(want / vmax));
          var kHi = Math.max(kLo, Math.floor(want / vmin));
          if (kLo * vmin > n) kLo = Math.floor(n / vmin);
          if (kHi * vmin > n) kHi = Math.floor(n / vmin);
          kLo = Math.max(kLo, Math.min(vr.min, kHi));
          kHi = Math.min(kHi, Math.max(vr.max, kLo));
          if (kHi < kLo) kHi = kLo;
          var vk = kLo + ((rng() * (kHi - kLo + 1)) | 0);
          if (want < vk * vmin) want = vk * vmin;
          if (want > vk * vmax) want = vk * vmax;
          var lens = veinLengths(rng, vk, want, vmin, vmax);
          var taken = new Uint8Array(n);
          var near = new Uint8Array(n);       // 贴着别的矿脉的格子：再占就连成一片，矿脉条数会失真
          var clusterOf = new Int16Array(n);   // 簇号账本：放宽相邻时用它记账，0 档只用于出读数
          for (var cf = 0; cf < n; cf++) clusterOf[cf] = -1;
          var clusterAdj = new Int16Array(vk);  // 每条簇已贴住的别的簇数（双向记账）
          var placed = 0;
          veinSet = new Uint8Array(n);
          for (var vj = 0; vj < lens.length; vj++) {
            var vc = adjCap > 0
              ? growVeinAdj(rng, cols, rows, taken, clusterOf, clusterAdj, adjCap, lens[vj], vmin)
              : growVein(rng, cols, rows, taken, near, lens[vj]);
            if (!vc) continue;
            if (adjCap > 0) {
              // 先把这条簇贴住的别的簇统计出来（此时它自己的格还没进 taken，不会把自己数进去）
              var ownIds = [], tmpA = [0, 0, 0, 0], o, oi, oh, odup, oid, tmn;
              for (o = 0; o < vc.length; o++) {
                tmn = adjIdsAt(vc[o], cols, rows, taken, clusterOf, tmpA);
                for (oi = 0; oi < tmn; oi++) {
                  oid = tmpA[oi];
                  odup = false;
                  for (oh = 0; oh < ownIds.length; oh++) if (ownIds[oh] === oid) { odup = true; break; }
                  if (!odup) ownIds.push(oid);
                }
              }
              clusterAdj[vj] = ownIds.length;
              for (o = 0; o < ownIds.length; o++) clusterAdj[ownIds[o]]++;
            }
            for (var ck = 0; ck < vc.length; ck++) {
              var ci = vc[ck], cx2 = ci % cols, cy2 = (ci - cx2) / cols;
              taken[ci] = 1;
              clusterOf[ci] = vj;
              veinSet[ci] = 1;
              oreGrid[ci] = veinOre;
              placed++;
              if (adjCap > 0) continue;        // 放宽相邻时相邻账本由 clusterOf 记账，不再铺 near
              if (cx2 + 1 < cols) near[ci + 1] = 1;
              if (cx2 > 0) near[ci - 1] = 1;
              if (cy2 + 1 < rows) near[ci + cols] = 1;
              if (cy2 > 0) near[ci - cols] = 1;
            }
          }
          // 溢出散铺：权重要求的贵重矿格数 > 矿脉实际容纳的格数时，剩余部分以单格散点补在
          // 非矿脉格上（允许贴着矿脉），让「权重 → 盘面占比」的映射近似成立。
          // 只有 oreRateBonus > 0 才启用：0 加成时盘面与改动前逐格一致。
          var scattered = 0;
          if (oreBonus > 0 && placed < want) {
            var room = [];
            for (var ri = 0; ri < n; ri++) if (!taken[ri]) room.push(ri);
            while (scattered < want - placed && room.length) {
              var rpick = (rng() * room.length) | 0;
              var si = room[rpick];
              room[rpick] = room[room.length - 1];
              room.pop();
              taken[si] = 1;
              veinSet[si] = 1;                 // 散点与矿脉同等对待：吃 hp / 富矿率 / 富矿优先落点
              oreGrid[si] = veinOre;
              scattered++;
            }
          }
          // 测试只读读数：本局矿脉档位、簇格数与「每簇贴住了几个别的簇」
          var clCells = [], clAdj = [], seenPair = {};
          {
            for (var q2 = 0; q2 < n; q2++) {
              var cid2 = clusterOf[q2];
              if (!(cid2 >= 0)) continue;
              clCells[cid2] = (clCells[cid2] || 0) + 1;
              var qx = q2 % cols, qy = (q2 - qx) / cols;
              for (var qk = 0; qk < 4; qk++) {
                var qnx = qx + ADJ_DX[qk], qny = qy + ADJ_DY[qk];
                if (qnx < 0 || qny < 0 || qnx >= cols || qny >= rows) continue;
                var qid = clusterOf[qny * cols + qnx];
                if (!(qid >= 0) || qid === cid2) continue;
                var pkey = cid2 + ':' + qid;
                if (seenPair[pkey]) continue;
                seenPair[pkey] = 1;
                clAdj[cid2] = (clAdj[cid2] || 0) + 1;
              }
            }
          }
          var clList = [];
          for (var cl = 0; cl < clCells.length; cl++) {
            if (!clCells[cl]) continue;
            clList.push({ cells: clCells[cl], adj: clAdj[cl] || 0 });
          }
          GRID.lastVein = {
            bonus: oreBonus, min: vmin, max: vmax, adjCap: adjCap,
            want: want, placed: placed, scattered: scattered, clusters: clList
          };
        }
      }

      // 富矿：概率不变（仍按矿种 richRate），但优先落在矿脉里
      var richGrid = new Array(n);
      var richCount = 0;
      for (i = 0; i < n; i++) {
        var rr = typeof richOf[oreGrid[i]] === 'number' ? richOf[oreGrid[i]] : 0.10;
        richGrid[i] = rng() < rr;
        if (richGrid[i]) richCount++;
      }
      if (veinSet) {
        var spill = [], holes = [];
        for (i = 0; i < n; i++) {
          if (veinSet[i]) { if (!richGrid[i]) holes.push(i); }
          else if (richGrid[i]) spill.push(i);
        }
        for (i = 0; i < spill.length && holes.length; i++) {
          richGrid[holes.pop()] = true;
          richGrid[spill[i]] = false;
        }
      }

      var blocks = [];
      var flat = [];
      var delay = new Float32Array(n);
      var cx0 = cols * 0.5, cy0 = rows * 0.5;
      var maxDist = Math.sqrt(cx0 * cx0 + cy0 * cy0) || 1;

      for (var oy = 0; oy < rows; oy++) {
        var rowArr = [];
        for (var ox = 0; ox < cols; ox++) {
          var idx = oy * cols + ox;
          var oreId = oreGrid[idx];
          var rich = richGrid[idx] === true;

          // 纵向堆叠：每层独立一次矿种/耐久结算
          var tl = bounds.min + (jitter > 0 ? ((rng() * (jitter + 1)) | 0) : 0) + extra;
          if (tl > bounds.cap) tl = bounds.cap;
          if (tl < 1) tl = 1;
          // 第 0 层 = 矿脉/填充布局定下的地表矿；更深每层各自独立按权重抽样（不再沿用顶层），
          // 越深越偏稀有矿，富矿也每层独立掷
          var stack = new Array(tl);
          for (var li = 0; li < tl; li++) {
            var lo = li === 0 ? oreId : pickPoolOre(depthPools[li > bounds.cap ? bounds.cap : li], pl, rng);
            var lr = li === 0 ? rich : rng() < (typeof richOf[lo] === 'number' ? richOf[lo] : 0.10);
            stack[li] = {
              ore: lo,
              rich: lr,
              maxHp: hpFor(hpMap, lo),
              seed: (rng() * 0x7fffff) | 0
            };
          }

          var top = stack[0];
          var bx = originX + ox * step + halfGap;
          var by = originY + oy * step + halfGap;
          var b = {
            ox: ox, oy: oy,
            x: bx, y: by, s: s,
            ore: top.ore,
            maxHp: top.maxHp, hp: top.maxHp,
            rich: rich,
            depth: 0,
            layers: tl,
            totalLayers: tl,
            broken: false,
            stack: stack,
            crack: 0,
            seed: top.seed,
            hitT: 0,
            hitDir: 0,
            layerT: 0,
            appearT: 0
          };
          var ddx = ox + 0.5 - cx0, ddy = oy + 0.5 - cy0;
          var dist = Math.sqrt(ddx * ddx + ddy * ddy) / maxDist;
          delay[idx] = dist * dist * APPEAR_WAVE;
          rowArr.push(b);
          flat.push(b);
        }
        blocks.push(rowArr);
      }
      // 保证每局至少有 1 个富矿格（天赋"地层扫描"需要）
      if (richCount === 0 && flat.length) {
        var pool = flat;
        if (veinSet) {        // 有矿脉时这唯一一个富矿也优先落在矿脉里
          var veinFlat = [];
          for (var vf = 0; vf < flat.length; vf++) {
            if (veinSet[flat[vf].oy * cols + flat[vf].ox]) veinFlat.push(flat[vf]);
          }
          if (veinFlat.length) pool = veinFlat;
        }
        var lucky = pool[(rng() * pool.length) | 0];
        lucky.rich = true;
        if (lucky.stack) for (var q = 0; q < lucky.stack.length; q++) lucky.stack[q].rich = true;
      }

      GRID.blocks = blocks;
      GRID.flat = flat;
      apDelay = delay;
      timeT = 0;
    },

    at: function (px, py) {
      if (!geo || !GRID.blocks || !GRID.blocks.length) return null;
      var ix = Math.floor((px - geo.originX) / geo.step);
      var iy = Math.floor((py - geo.originY) / geo.step);
      if (!(ix >= 0 && iy >= 0 && ix < geo.cols && iy < geo.rows)) return null;
      var row = GRID.blocks[iy];
      if (!row) return null;
      var b = row[ix];
      return b && !b.broken ? b : null;
    },

    // 只打当前顶层；打穿一层派发 block:layer，整格挖空派发 block:break + block:empty
    damage: function (block, dmg, dir) {
      var res = { broke: false, overkill: 0, layersBroken: 0 };
      if (!block || block.broken || (typeof block.layers === 'number' && block.layers <= 0)) return res;
      normalizeLayers(block);
      if (block.layers <= 0) return res;
      var d = typeof dmg === 'number' && dmg > 0 ? dmg : 0;
      var hd = typeof dir === 'number' && isFinite(dir) ? dir : 0;
      var over = applyHit(block, d, hd);
      // 宝藏格：面板 hp 是工具伤害的口径，1 点伤害（最弱的一击）直接剥掉它唯一的层 = 破。
      // 共振已改走 stripLayer（无血量剥层，见下），这里保留 1 点口径给普通 1 伤命中；TNT 走 damageLayers，不在此列。
      if (block.treasure && d <= 1) block.hp = 0;
      if (block.hp > 0) return res;
      res.overkill = over;
      res.layersBroken = 1;
      res.broke = breakTopLayer(block);
      return res;
    },

    // 共振用：无视血量的「剥一层」——语义等价于这一层被打光，换层 / 破格 / 掉落 / 开箱全走 breakTopLayer
    // 传参非法、已破碎、无层可剥 → false，且不派发任何事件
    stripLayer: function (block) {
      if (!block || typeof block !== 'object' || block.broken) return false;
      if (typeof block.layers !== 'number' || !isFinite(block.layers) || block.layers <= 0) return false;
      normalizeLayers(block);
      // 宝藏格不叠层：共振一发即破格并开箱（共振能秒宝藏是设计意图）
      if (block.treasure) {
        block.layers = 1;
        if (block.ore !== 'treasure') block.ore = 'treasure';
      }
      block.hitT = 1;                        // 与「打穿一层」同口径的命中反馈
      breakTopLayer(block);
      return true;
    },

    // TNT 用：每层独立吃一次 dmg，最多打穿 maxLayers 层
    damageLayers: function (block, dmg, maxLayers) {
      var res = { layersBroken: 0, emptied: false };
      if (!block || block.broken) return res;
      normalizeLayers(block);
      if (block.layers <= 0) return res;
      var d = typeof dmg === 'number' && dmg > 0 ? dmg : 0;
      var cap = toInt(maxLayers, 1);
      if (cap < 1) cap = 1;
      if (cap > MAX_LAYERS) cap = MAX_LAYERS;
      // 宝藏格不吃 TNT 秒杀：只挨一次普通伤害（不按层数重复结算），且这一发不会把它打死
      if (block.treasure) {
        applyHit(block, d, 0);
        if (block.hp < 1) {
          block.hp = 1;
          block.crack = crackLevel(1, block.maxHp);
        }
        return res;
      }
      for (var i = 0; i < cap; i++) {
        if (block.layers <= 0) break;
        applyHit(block, d, 0);
        if (block.hp > 0) break;
        res.layersBroken += 1;
        if (breakTopLayer(block)) { res.emptied = true; break; }
      }
      return res;
    },

    // v6 终极目标：把棋盘中心区域的一个存活格替换成地心宝藏格。
    // hp 缺省 3000；layers 固定 1（共振一次就破），TNT 秒不掉，挖穿派发 treasure:open。
    spawnTreasure: function (hp) {
      var h = typeof hp === 'number' && isFinite(hp) && hp > 0 ? hp : TREASURE_HP;
      var flat = GRID.flat || [];
      var cols = geo ? geo.cols : 0, rows = geo ? geo.rows : 0;
      var all = [], center = [], i, b;
      for (i = 0; i < flat.length; i++) {
        b = flat[i];
        if (!b || b.broken || b.treasure) continue;
        if (typeof b.layers === 'number' && b.layers <= 0) continue;
        all.push(b);
        if (cols > 0 && rows > 0) {
          var cx = b.ox + 0.5, cy = b.oy + 0.5;
          if (cx >= cols * 0.25 && cx <= cols * 0.75 && cy >= rows * 0.25 && cy <= rows * 0.75) center.push(b);
        }
      }
      var pool = center.length ? center : all;      // 中心区优先，不够就退回全盘存活格
      if (!pool.length) return null;
      var t = pool[(Math.random() * pool.length) | 0];
      var seed = (Math.random() * 0x7fffff) | 0;
      t.treasure = true;
      t.ore = 'treasure';
      t.rich = false;
      t.maxHp = h;
      t.hp = h;
      t.layers = 1;
      t.totalLayers = 1;
      t.depth = 0;
      t.broken = false;
      t.crack = 0;
      t.hitT = 0;
      t.layerT = 0;
      t.seed = seed;
      // stack 换成一层的宝藏：换层逻辑不会再翻出原来的矿层
      t.stack = [{ ore: 'treasure', rich: false, maxHp: h, seed: seed }];
      return t;
    },

    isEmpty: function () {
      var flat = GRID.flat || [];
      if (!flat.length) return true;
      for (var i = 0; i < flat.length; i++) {
        var b = flat[i];
        if (b && !b.broken && !(typeof b.layers === 'number' && b.layers <= 0)) return false;
      }
      return true;
    },

    aliveCells: function () {
      var flat = GRID.flat || [];
      var n = 0;
      for (var i = 0; i < flat.length; i++) {
        var b = flat[i];
        if (b && !b.broken && !(typeof b.layers === 'number' && b.layers <= 0)) n++;
      }
      return n;
    },

    neighbors: function (block, pattern, n) {
      var out = [];
      if (!block || !GRID.blocks) return out;
      var r = toInt(n, 1);
      if (r < 1) r = 1;
      var ox = block.ox, oy = block.oy;
      var gx, gy, row, cell;
      if (pattern === 'square') {
        for (gy = -r; gy <= r; gy++) {
          for (gx = -r; gx <= r; gx++) {
            if (!gx && !gy) continue;
            row = GRID.blocks[oy + gy];
            cell = row ? row[ox + gx] : null;
            if (cell && !cell.broken) out.push(cell);
          }
        }
      } else if (pattern === 'column') {
        for (gy = 1; gy <= r; gy++) {
          row = GRID.blocks[oy - gy];
          cell = row ? row[ox] : null;
          if (cell && !cell.broken) out.push(cell);
          row = GRID.blocks[oy + gy];
          cell = row ? row[ox] : null;
          if (cell && !cell.broken) out.push(cell);
        }
      } else if (pattern === 'row') {
        for (gx = 1; gx <= r; gx++) {
          row = GRID.blocks[oy];
          cell = row ? row[ox - gx] : null;
          if (cell && !cell.broken) out.push(cell);
          cell = row ? row[ox + gx] : null;
          if (cell && !cell.broken) out.push(cell);
        }
      } else {
        for (gy = -r; gy <= r; gy++) {
          for (gx = -r; gx <= r; gx++) {
            if (!gx && !gy) continue;
            if ((gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy) > r) continue;
            row = GRID.blocks[oy + gy];
            cell = row ? row[ox + gx] : null;
            if (cell && !cell.broken) out.push(cell);
          }
        }
      }
      return out;
    },

    richCells: function (n) {
      var out = [];
      var lim = toInt(n, 1);
      if (lim < 1) lim = 1;
      var flat = GRID.flat || [];
      for (var i = 0; i < flat.length; i++) {
        var b = flat[i];
        if (b && b.rich && !b.broken) {
          out.push(b);
          if (out.length >= lim) break;
        }
      }
      return out;
    },

    update: function (dt) {
      var d = typeof dt === 'number' && dt > 0 ? dt : 0;
      if (d > 0.1) d = 0.1;
      if (d <= 0) return;
      timeT += d;
      var flat = GRID.flat;
      if (!flat || !flat.length) return;
      var delay = apDelay;
      var cols = geo ? geo.cols : 0;
      for (var i = 0; i < flat.length; i++) {
        var b = flat[i];
        if (b.hitT > 0) {
          b.hitT -= d * HIT_DECAY;
          if (b.hitT < 0) b.hitT = 0;
        }
        if (b.layerT > 0) {
          b.layerT -= d * LAYER_DECAY;
          if (b.layerT < 0) b.layerT = 0;
        }
        if (b.appearT < 1) {
          if (delay) {
            var idx = b.oy * cols + b.ox;
            if (delay[idx] > 0) {
              delay[idx] -= d;
              if (delay[idx] > 0) continue;
              delay[idx] = 0;
            }
          }
          b.appearT += d * APPEAR_RATE;
          if (b.appearT > 1) b.appearT = 1;
        }
      }
    },

    draw: function (ctx) {
      if (!ctx || !geo || !GRID.blocks || !GRID.blocks.length) return;
      var g = geo;
      var prevSmooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;

      // 1) 石壁底 + 静态岩粒
      ctx.fillStyle = C_WALL;
      ctx.fillRect(g.x - 8, g.y - 8, g.w + 16, g.h + 16);
      var i;
      if (wallHi) {
        ctx.fillStyle = C_WALL_HI;
        for (i = 0; i < wallHi.length; i += 4) {
          ctx.fillRect(g.x + wallHi[i] * g.w, g.y + wallHi[i + 1] * g.h, wallHi[i + 2], wallHi[i + 3]);
        }
      }
      if (wallLo) {
        ctx.fillStyle = C_WALL_LO;
        for (i = 0; i < wallLo.length; i += 4) {
          ctx.fillRect(g.x + wallLo[i] * g.w, g.y + wallLo[i + 1] * g.h, wallLo[i + 2], wallLo[i + 3]);
        }
      }

      // 2) 棋盘缝隙底色 + 外框
      var bx = g.originX, by = g.originY;
      var bw = g.step * g.cols, bh = g.step * g.rows;
      ctx.fillStyle = C_SEAM;
      ctx.fillRect(bx - 3, by - 3, bw + 6, bh + 6);
      ctx.fillStyle = C_FRAME;
      ctx.fillRect(bx - 3, by - 3, bw + 6, 3);
      ctx.fillRect(bx - 3, by + bh, bw + 6, 3);
      ctx.fillRect(bx - 3, by - 3, 3, bh + 6);
      ctx.fillRect(bx + bw, by - 3, 3, bh + 6);

      // 3) 每格的插槽内阴影
      var ox, oy, b, row;
      ctx.fillStyle = C_SOCKET;
      for (oy = 0; oy < g.rows; oy++) {
        row = GRID.blocks[oy];
        if (!row) continue;
        for (ox = 0; ox < g.cols; ox++) {
          b = row[ox];
          if (!b) continue;
          ctx.fillRect(b.x - 2, b.y - 1.5, b.s + 4, b.s + 4);
        }
      }

      // 4) 凹坑 / 矿块
      var gapRoom = g.gap > 1 ? g.gap : 1;
      for (oy = 0; oy < g.rows; oy++) {
        row = GRID.blocks[oy];
        if (!row) continue;
        for (ox = 0; ox < g.cols; ox++) {
          b = row[ox];
          if (!b) continue;
          if (b.broken) { drawPit(ctx, b); continue; }
          var p = b.appearT;
          if (p <= 0) continue;

          var sc = 1, alpha = 1;
          if (p < 1) {
            var e = 1 - (1 - p) * (1 - p) * (1 - p);
            sc = 0.58 + 0.42 * e + 0.055 * Math.sin(Math.PI * p);
            alpha = p * 2.4;
            if (alpha > 1) alpha = 1;
          }
          var hb = 0, dx = 0, dy = 0;
          if (b.hitT > 0.002) {
            hb = Math.sin(Math.PI * (1 - b.hitT));           // 压缩 sin 曲线
            sc *= 1 - 0.11 * hb;
            dx = Math.cos(b.hitDir) * 2.2 * hb;              // 沿 hitDir 位移
            dy = Math.sin(b.hitDir) * 2.2 * hb;
          }
          // 换层：新方块从下往上滑入 LAYER_SLIDE px（layerT 1 → 0 线性回位）
          if (b.layerT > 0.002) dy += b.layerT * LAYER_SLIDE;

          var sink = b.depth > 0 ? SINK_PX : 0;       // 非首层整体下沉，看着像一摞牌
          var fw = b.s * sc;
          var fx = b.x + b.s * 0.5 + dx - fw * 0.5;
          var fy = b.y + b.s * 0.5 + dy + sink - fw * 0.5;

          // 4a) 底部露出的下层边缘（麻将牌堆叠感）
          var et = edgeThickness(b.layers);
          if (et > 0) {
            var maxEt = Math.floor(gapRoom * 0.5);
            if (maxEt < 1) maxEt = 1;
            if (et > maxEt) et = maxEt;
            var ex = b.x + dx, ey = b.y + b.s + dy + sink;
            ctx.fillStyle = C_EDGE_A;
            ctx.fillRect(ex, ey, b.s, et);
            if (et > 1) {
              ctx.fillStyle = C_EDGE_B;
              ctx.fillRect(ex, ey + 1, b.s, et - 1);
            }
            ctx.fillStyle = C_EDGE_LINE;
            ctx.fillRect(ex, ey + et, b.s, 1);
          }

          if (b.rich && glowSprite) {
            ctx.globalAlpha = alpha * (0.20 + 0.10 * Math.sin(timeT * 2.4 + (b.seed & 7)));
            ctx.drawImage(glowSprite, fx - fw * 0.3, fy - fw * 0.3, fw * 1.6, fw * 1.6);
          }
          ctx.globalAlpha = alpha;
          // 地心宝藏走专用绘制（木箱 + 金锁 + 顶部光柱），其余格优先美术贴图、无图回退程序化
          if (b.treasure) drawTreasure(ctx, b, fx, fy, fw, alpha);
          else {
            var blockArt = (b.ore === GOLD_ORE) ? goldArt(b.rich, b.seed) : artOne(oreArtKey(b.ore, b.rich), b.seed);
            if (blockArt) ctx.drawImage(blockArt, fx, fy, fw, fw);
            else {
              var tex = pickTex(b.ore, b.rich, b.seed);
              if (tex) ctx.drawImage(tex, fx, fy, fw, fw);
              else {
                ctx.fillStyle = oreDef(b.ore).color || '#7d7d7d';
                ctx.fillRect(fx, fy, fw, fw);
              }
            }
          }

          // 4b) 深度阴影：越深越暗 + 内阴影更重
          if (b.depth > 0) {
            var dl = b.depth > MAX_LAYERS ? MAX_LAYERS : b.depth;
            ctx.fillStyle = SHADE_FILL[dl];
            ctx.fillRect(fx, fy, fw, fw);
            var th = fw * 0.14; if (th < 1) th = 1;
            ctx.fillStyle = SHADE_INNER[dl];
            ctx.fillRect(fx, fy, fw, th);
            ctx.fillRect(fx, fy, th, fw);
          }

          // 4c) 岩层带：罩色压在贴图之上、裂纹之下 + 内侧 2px 岩层描边
          drawStrata(ctx, b, fx, fy, fw, alpha);

          if (b.crack > 0) drawCracks(ctx, b, fw, fx, fy);
          if (hb > 0.02) {
            ctx.globalAlpha = alpha * 0.42 * hb;
            ctx.fillStyle = C_FLASH;
            ctx.fillRect(fx + 1, fy + 1, fw - 2, fw - 2);
          }
          if (b.layerT > 0.002) drawLayerFlash(ctx, fx, fy, fw, alpha * b.layerT);
          drawLayerBadges(ctx, b, fx, fy, fw, alpha);
        }
      }

      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = prevSmooth;
    },

    clear: function () {
      GRID.blocks = [];
      GRID.flat = [];
      apDelay = null;
      geo = null;
      timeT = 0;
    }
  };

  GRID._tex = texMap;
  GRID._texSig = texSig;
  GRID._texAvg = texAvg;
  GRID._goldRamp = goldRamp;
  GRID._goldTint = goldTint;
  GRID._goldSrcKeys = GOLD_TINT_KEYS.slice();
  GRID._layerShade = layerShade;
  GRID._edgeThickness = edgeThickness;
  GRID._nextOre = nextOreOf;
  GRID._previewColor = oreVein;
  GRID._previewThickness = previewThickness;
  GRID._previewHi = oreVeinHi;
  GRID._layerDots = layerDots;
  GRID._dotSize = dotSize;
  GRID._layerSlide = LAYER_SLIDE;
  GRID._depthDark = DEPTH_DARK;
  GRID._band = bandOf;
  GRID._bandTint = bandTint;
  GRID._bandEdge = bandEdge;
  GRID._bandDot = bandDot;
  GRID._bandEdgeWidth = BAND_EDGE_W;
  GRID._bandArt = bandArt;
  // 权重表（测试只读）：grid.smoke 用它钉住「oreRateBonus 压的是填充矿权重、且有 8 的下限」，
  // 比统计 48×N 局的矿种占比更直接（后者还会被矿脉封顶干扰）。
  GRID._pickList = pickList;
  GRID._fillerMinW = FILLER_MIN_W;
  GRID._oreBonusCap = ORE_BONUS_CAP;
  // 矿脉容量档位（测试只读）：簇大小三档 / 相邻上限 / 贵重矿占比硬上限
  GRID._veinSizeTier = veinSizeTier;
  GRID._veinAdjCap = veinAdjCap;
  GRID._oreRatioCap = ORE_RATIO_CAP;

  function findZone(zones, id) {
    for (var i = 0; i < zones.length; i++) if (zones[i] && zones[i].id === id) return zones[i];
    return null;
  }

  function emit(type, data) {
    var bus = BM.bus;
    if (!bus || typeof bus.emit !== 'function') return;
    try {
      bus.emit(type, data);
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) console.warn('[GRID] 事件派发失败: ' + type, e);
    }
  }

  BM.GRID = GRID;
})();

