/* 08-ui.js — 营地 / 挖矿 HUD / 结算 / 放射状天赋树，纯 DOM+CSS，不写游戏规则 */
(function () {
  'use strict';
  var BM = window.BM = window.BM || {};
  var D = document;
  var W = window;

  var DW = 390, DH = 844;
  var COMBO_FULL = 8;                                   // 连击条满格所需的连击数（只影响视觉）
  /* v13：工具表完全数据驱动 —— 顺序就是 CONFIG.tools 的插入顺序（= 关卡解锁顺序），
     不再写死把数；新增/删除工具只改 01-config。 */
  var ORE_ORDER = ['stone', 'coal', 'iron', 'gold', 'crystal'];
  var MODE_TEXT = { tap: '点按', hold: '按住' };
  /* v5 七种形状各有一句文案；后四个键为旧契约保留，缺键时不会渲染成空 */
  var SHAPE_TEXT = {
    single: '单格',
    column2: '纵向 2 格',
    square3: '3×3 范围',
    columnAll: '整列贯穿',
    column: '纵向多格', row: '横向多格', wide: '宽幅', cross: '十字'
  };
  var QUALITY_CYCLE = ['高', '中', '低'];
  var SVGNS = 'http://www.w3.org/2000/svg';

  /* 天赋树几何（TREE-V8 §1：按 parent 自动生成，不再有 lane/ring 常量）

     半径 R = 70 + depth × 54；徽章直径 34px（中心 56px）；同深度相邻弧长 ≥ 40px。
     坐标全部算术算出（不量 DOM），整棵树靠 transform 平移 + 缩放。
     「一个节点多级」拆成「一条链上的多个单级节点」后树会到 10 层 / 70+ 个节点：
     初始视图固定 1:1 只露中心 + 内环，外圈靠拖动 / 缩放看（硬塞进 358×356 会压成 3px）。 */
  var TREE_STAGE_W = 358, TREE_STAGE_H = 356;   // 可视区（与 style.css 的 .talent-stage 一致）
  var TREE_R0 = 70, TREE_DR = 54;               // 节点圆心半径 = 70 + 54 × depth
  var NODE_D = 34, CENTER_D = 56;               // 圆形徽章直径
  var CHIP_W = 92, CHIP_H = 76;                 // 格子（说明 / 徽章 / 等级 三段命中区，圆心对齐节点坐标）
  var CAP_MAX = 6;                              // 圆圈上方说明最多 6 个字符（再长用省略号）
  var TEXT_LH = 11, TEXT_GAP = 1;               // 说明 / 等级的行高，以及它们到圆边的间距
  var TEXT_MAX_W = 66, LV_MAX_W = 44;           // 一行说明 / 一行等级的最宽像素（判断「两行字会不会撞上」用）
  var MIN_ARC = 40;                             // 同深度相邻节点的最小弧长
  var CHILD_SPREAD_MAX = 100;                   // 子节点扇面上限（±50°，度）
  var LV_HIDE_SCALE = 0.7;                      // 缩到 0.7 以下只画圆点：小字会比节点还宽
  var INIT_SCALE = 1;                           // 初始 1:1，不 fit 整棵树
  var LINK_LONG = 140, LINK_STUB = 26;          // 长连线：中段留虚线豁口，提示「后面还有」
  var LV_FS_MIN = 9, LV_FS_BASE = 11;           // 等级小字：缩放后的视觉下限 9px / 地图坐标基准字号 11px
  var ZOOM_MIN = 0.45, ZOOM_MAX = 1.6, ZOOM_STEP = 0.1;
  var DRAG_PX = 6;                              // 移动超过 6px 才算拖拽，否则算点击
  var LONG_PRESS_MS = 300;                      // 长按 300ms 才开详情卡（提前松手 = 单击购买）
  var TIPS_TEXT = '单击购买 · 长按查看详情';       // 树页面顶部一行小字（TREE-V8 §7.4）

  var EMPTY_STATE = {};

  var R = { panX: 0, panY: 0, scale: 1 };
  var H = {};
  var built = false;
  var busBound = false;
  var sigTools = '', sigTalents = '', sigOres = '';

  /* ---------------- 基础工具 ---------------- */

  function h(tag, cls, text, id) {
    var e = D.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (id) e.id = id;
    return e;
  }

  function put(parent, child) {
    parent.appendChild(child);
    return child;
  }

  function clearNode(n) {
    if (!n) return;
    while (n.firstChild) n.removeChild(n.firstChild);
  }

  function setText(node, txt) {
    if (!node || node.__t === txt) return;
    node.__t = txt;
    node.textContent = txt;
  }

  function setNum(node, n) {
    if (!node || node.__n === n) return;
    node.__n = n;
    node.textContent = String(n);
  }

  function setCls(node, cls, on) {
    if (!node) return;
    var k = '__c_' + cls;
    if (node[k] === !!on) return;
    node[k] = !!on;
    if (on) node.classList.add(cls);
    else node.classList.remove(cls);
  }

  function setWidth(node, pct) {
    if (!node) return;
    var s = pct.toFixed(1) + '%';
    if (node.__w === s) return;
    node.__w = s;
    node.style.width = s;
  }

  /* ---------------- 美术图标（BM.ART 缺失 / 未解码一律返回 null，调用方保留文字与色块兜底） ---------------- */

  function artSrc(key) {
    var a = BM.ART;
    if (!a || typeof a.one !== 'function') return null;
    var im = null;
    try { im = a.one(key); } catch (e) { return null; }
    return (im && typeof im.src === 'string' && im.src) ? im.src : null;
  }

  // 把贴图当作 CSS 背景铺到现有元素上（v5：天赋分区条 / 尾节点金框 / 营地矿区缩略图）。
  // 只改背景，不改布局与 DOM 结构；没有图就完全不碰元素，退回原来的纯 CSS 样式。
  var cssApplied = Object.create(null);
  function paintBg(el, key, style) {
    if (!el) return false;
    var tag = key + '|' + (style && style.size || '') + '|' + (style && style.repeat || '');
    if (cssApplied[tag] === false) return false;
    var src = artSrc(key);
    if (!src) { cssApplied[tag] = false; return false; }
    cssApplied[tag] = true;
    el.style.backgroundImage = 'url("' + src + '")';
    if (style) {
      if (style.size) el.style.backgroundSize = style.size;
      if (style.repeat) el.style.backgroundRepeat = style.repeat;
      if (style.pos) el.style.backgroundPosition = style.pos;
    }
    return true;
  }

  // 清单里有没有这张图：BM.ART 缺失 → false（调用方据此决定「不放图标」）
  function artHas(key) {
    var a = BM.ART;
    if (!a) return false;
    if (typeof a.has === 'function') { try { return !!a.has(key); } catch (e) { return false; } }
    return !!artSrc(key);
  }

  function artIcon(key, cls, srcOverride) {
    var src = srcOverride || artSrc(key);
    if (!src) return null;
    var el = h('img', cls || 'bm-ico');
    el.setAttribute('alt', '');
    el.setAttribute('src', src);
    el.setAttribute('data-art', key);
    return el;
  }

  /* ---- 金矿（v10）：没有独立美术，复用煤矿图标并「金色化」 ----
     icons.ore_coal 是 24×24 的 PNG，解码后画进离屏 canvas，按亮度重映射到
     #7a5418 → #c8912e → #ffc857 再导出 data URL（只算一次）。没有 ART / 图未解码 /
     canvas 不可用时返回 null —— 调用方退回 config 里的金色色块，不会出现空洞。 */
  var GOLD_ORE = 'gold';
  var GOLD_ICON_SRC = 'icons.ore_coal';
  var GOLD_DEEP = [122, 84, 24];
  var GOLD_MID = [200, 145, 46];
  var GOLD_BRIGHT = [255, 200, 87];
  var goldOut = [0, 0, 0];
  var goldIconCache = null;          // undefined = 还没算过；null = 不可用；string = data URL
  var goldIconOwner = null;

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

  function goldIconURL() {
    var a = BM.ART;
    if (goldIconOwner !== a) { goldIconOwner = a; goldIconCache = null; }
    if (goldIconCache !== null) return goldIconCache;
    goldIconCache = null;            // 默认不可用：下面拿到图再覆盖
    if (!a || typeof a.one !== 'function' || !D.createElement) return null;
    var src = null;
    try { src = a.one(GOLD_ICON_SRC); } catch (e) { src = null; }
    var w = src ? (src.naturalWidth || src.width) : 0;
    var h = src ? (src.naturalHeight || src.height) : 0;
    if (!(w > 0) || !(h > 0)) return null;
    var cv = null;
    try { cv = D.createElement('canvas'); } catch (e2) { cv = null; }
    if (!cv || typeof cv.getContext !== 'function' || typeof cv.toDataURL !== 'function') return null;
    cv.width = w; cv.height = h;
    var g = cv.getContext('2d');
    if (!g || typeof g.drawImage !== 'function' || typeof g.getImageData !== 'function') return null;
    var img = null;
    try {
      g.drawImage(src, 0, 0);
      img = g.getImageData(0, 0, w, h);
    } catch (e3) { return null; }
    var d = img && img.data;
    if (!d || d.length < w * h * 4) return null;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      var c = goldRamp(d[i], d[i + 1], d[i + 2]);
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
    }
    try { g.putImageData(img, 0, 0); } catch (e4) { return null; }
    var url = null;
    try { url = cv.toDataURL('image/png'); } catch (e5) { url = null; }
    if (typeof url !== 'string' || url.indexOf('data:image') !== 0) return null;
    goldIconCache = url;
    return url;
  }

  // 矿种图标地址：金矿走金色化缓存，其余直接取 manifest 键
  function oreIconURL(ore) {
    if (ore === GOLD_ORE) return goldIconURL();
    return artSrc('icons.ore_' + ore);
  }

  /* 图标槽位：构建时只登记「图该挂在哪（宿主 + 键）」，图就绪后再补插 <img>。
     这样 init 早于图片解码也不会丢图标，ART 全程缺失也只是少一张图、不抛错。
     urlFn 可选：自定义取图函数（金矿用它返回金色化后的 data URL）。 */
  function iconSlot(host, key, cls, group, urlFn) {
    if (!host) return null;
    var s = { host: host, key: key, cls: cls || 'bm-ico', group: group || '', node: null, urlFn: urlFn || null };
    if (!R.artSlots) R.artSlots = [];
    R.artSlots.push(s);
    R.artLeft = (R.artLeft || 0) + 1;
    return s;
  }

  // 重建子树（工具卡 / 矿种格）前丢掉失效槽位，避免指向已脱离的旧节点
  function clearSlots(group) {
    var s = R.artSlots;
    if (!s || !group) return;
    for (var i = s.length - 1; i >= 0; i--) {
      if (s[i].group !== group) continue;
      if (!s[i].node) R.artLeft = Math.max(0, (R.artLeft || 1) - 1);
      s.splice(i, 1);
    }
  }

  function paintIcons() {
    var s = R.artSlots;
    if (!s || !s.length || !R.artLeft) return;
    for (var i = 0; i < s.length; i++) {
      var it = s[i];
      if (it.node || !it.host) continue;
      var img = artIcon(it.key, it.cls, it.urlFn ? it.urlFn() : null);
      if (!img) continue;
      it.node = img;
      R.artLeft = Math.max(0, (R.artLeft || 1) - 1);
      it.host.insertBefore(img, it.host.firstChild || null);
    }
  }

  // 同一槽位换键（音效开/关）：已插入的就地换 src，没插入的等 paintIcons 按新键补
  function swapIcon(slot, key) {
    if (!slot || slot.key === key) return;
    slot.key = key;
    if (!slot.node) return;
    var src = artSrc(key);
    if (!src) return;
    slot.node.setAttribute('src', src);
    slot.node.setAttribute('data-art', key);
  }

  // 图片是 data URL 异步解码的：有限次重试直到 BM.ART.progress() 满，之后不再轮询
  function kickIcons() {
    var n = 0;
    var tick = function () {
      paintIcons();
      n++;
      var a = BM.ART, done = true;
      if (a && typeof a.progress === 'function') {
        try { done = a.progress() >= 1; } catch (e) { done = true; }
      }
      if (done || n >= 40) return;
      setTimeout(tick, 100);
    };
    setTimeout(tick, 60);
  }

  function call(name, a, b) {
    var fn = H[name];
    if (typeof fn !== 'function') return;
    try {
      fn(a, b);
    } catch (e) {
      if (W.console && console.warn) console.warn('[UI] handler ' + name + ' 抛错', e);
    }
  }

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

  function core() { return BM.CORE || null; }
  function config() { return BM.CONFIG || null; }

  function state() {
    var c = core();
    return (c && c.state) || EMPTY_STATE;
  }

  function indexOf(arr, v) {
    if (!arr) return -1;
    for (var i = 0; i < arr.length; i++) if (arr[i] === v) return i;
    return -1;
  }

  function groupNum(v) {
    var s = String(v == null ? 0 : v);
    var dot = s.indexOf('.');
    if (dot >= 0) s = s.slice(0, dot);
    var neg = s.charAt(0) === '-';
    if (neg) s = s.slice(1);
    s = s.replace(/[^0-9]/g, '').replace(/^0+(?=[0-9])/, '');
    if (!s) s = '0';
    var out = '', c = 0;
    for (var i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out;
      if (++c === 3 && i > 0) { out = ',' + out; c = 0; }
    }
    return (neg ? '-' : '') + out;
  }

  function fmtCoins(v) {
    var c = core();
    if (c && c.fmt) { try { return String(c.fmt(v)); } catch (e) { /* 退回收视 */ } }
    return groupNum(v);
  }

  function abbrCoins(v) {
    var c = core();
    if (c && c.abbr) { try { return String(c.abbr(v)); } catch (e) { /* 退回收视 */ } }
    return groupNum(v);
  }

  function coinsNow() {
    var st = state();
    return st.coins == null ? 0 : st.coins;
  }

  function oreCfg(ore) {
    var cf = config();
    return cf && cf.ores ? cf.ores[ore] : null;
  }

  function oreName(ore) {
    var o = oreCfg(ore);
    return (o && o.name) || String(ore || '矿石');
  }

  function zoneOf(id) {
    var cf = config();
    if (!cf || !cf.zones || !cf.zones.length) return null;
    for (var i = 0; i < cf.zones.length; i++) if (cf.zones[i].id === id) return cf.zones[i];
    return cf.zones[0];
  }

  /* 严格按 id 查关（zoneOf 会回落第一关，用于「下一关」这类必须查准的场合） */
  function zoneById(id) {
    var cf = config();
    if (!cf || !cf.zones || !id) return null;
    for (var i = 0; i < cf.zones.length; i++) if (cf.zones[i] && cf.zones[i].id === id) return cf.zones[i];
    return null;
  }

  /* 「下一关」一律查 zones[].nextZone 表，不在 UI 里写死关名；末关返回 null */
  function nextZoneOf(z) {
    if (!z) return null;
    var id = typeof z.nextZone === 'string' ? z.nextZone : '';
    return id ? zoneById(id) : null;
  }

  /* 通关大字副标题：关数取自 CONFIG.zones（3 关 / 7 关都不写死） */
  function zoneCountText() {
    var n = zoneList().length;
    return n > 1 ? (n + ' 关全部达标 · 矿区不再有新的层') : '全部达标 · 矿区不再有新的层';
  }

  /* 天赋按关分组：区块顺序、名称都取自 CONFIG.zones，不在 UI 里写死 */
  function zoneList() {
    var cf = config(), out = [];
    if (!cf || !cf.zones) return out;
    for (var i = 0; i < cf.zones.length; i++) {
      var z = cf.zones[i];
      if (z && z.id) out.push({ id: z.id, name: z.name || z.id });
    }
    return out;
  }

  function zoneIndexOf(id) {
    var list = zoneList();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }

  function zoneUnlocked(id) {
    var c = core();
    if (c && c.hasZone) { try { return !!c.hasZone(id); } catch (e) { /* 退回状态推断 */ } }
    var st = state();
    if (indexOf(st.unlockedZones, id) >= 0) return true;
    var zi = zoneIndexOf(id), ci = zoneIndexOf(st.currentZone);
    if (zi < 0) return true;
    return ci >= 0 && zi <= ci;
  }

  function nextObjective() {
    var c = core();
    if (c && c.nextObjective) { try { return c.nextObjective(); } catch (e) { /* 忽略 */ } }
    return null;
  }

  function eachItem(src, fn) {
    if (!src) return;
    if (Object.prototype.toString.call(src) === '[object Array]') {
      for (var i = 0; i < src.length; i++) if (src[i] && typeof src[i] === 'object') fn(src[i], '');
    } else {
      for (var k in src) {
        if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
        if (src[k] && typeof src[k] === 'object') fn(src[k], k);
      }
    }
  }

  function lessThan(a, b) {
    if (a == null) return false;
    if (b == null) return true;
    try { return BigInt(String(a)) < BigInt(String(b)); } catch (e) { return Number(a) < Number(b); }
  }

  function canAfford(cost) {
    var c = core();
    if (c && c.canAfford) { try { return !!c.canAfford(cost); } catch (e) { /* 用乐观值 */ } }
    return true;
  }

  function playUi(name) {
    if (BM.AUDIO && BM.AUDIO.play) { try { BM.AUDIO.play(name); } catch (e) { /* 静默 */ } }
  }

  /* ---------- 数据视图（只读 CONFIG/CORE，不写规则） ---------- */

  function toolList() {
    var cf = config(), out = [];
    if (!cf || !cf.tools) return out;
    // 数据驱动：按 CONFIG.tools 的插入顺序渲染（= 关卡解锁顺序），不写死把数
    eachItem(cf.tools, function (t, k) { out.push(pickTool(t, k)); });
    return out;
  }

  function pickTool(t, k) {
    return {
      id: t.id || k,
      name: t.name || k,
      dmg: t.dmg,
      mode: t.mode,
      interval: t.interval,
      shape: t.shape,
      desc: t.desc || '',
      unlock: t.unlock,
      unlockText: t.unlockText || t.unlockHint || t.requirement
    };
  }

  /* 放射树的数据视图：只读 CONFIG.tree（01-config 提供），UI 不算任何规则。
     lanes 只描述方向，nodes 只描述前置/关卡/价格上限。 */
  function treeCfg() {
    var cf = config();
    var t = cf && cf.tree;
    if (!t || !t.nodes || !t.nodes.length) return null;
    return t;
  }

  function laneList(cfg) {
    var out = [];
    if (!cfg || !cfg.lanes) return out;
    eachItem(cfg.lanes, function (l, k) {
      var name = l.name || l.id || '';
      out.push({
        id: l.id || k || ('lane' + out.length),
        name: name,
        /* 圆心只放一个中文字：lane 自带 short 优先，否则退到名字首字 */
        short: String(l.short || l.glyph || l.mark || l.char || name.charAt(0) || '·').charAt(0),
        angle: num(l.angle, 0)
      });
    });
    return out;
  }

  function laneIdx(cfg, id) {
    var list = laneList(cfg);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return list.length;
  }

  function laneOf(cfg, id) {
    var list = laneList(cfg);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function reqListOf(n) {
    var r = n.requires != null ? n.requires : n.req;
    if (typeof r === 'string') return r ? [r] : [];
    var out = [];
    if (Object.prototype.toString.call(r) === '[object Array]') {
      for (var i = 0; i < r.length; i++) if (typeof r[i] === 'string' && r[i]) out.push(r[i]);
    }
    return out;
  }

  function treeNodes(cfg) {
    var out = [], seq = 0;
    if (!cfg) return out;
    eachItem(cfg.nodes, function (n, k) {
      var id = n.id || k;
      if (!id) return;
      out.push({
        id: id,
        name: n.name || id,
        desc: n.desc || n.text || n.info || '',
        lane: typeof n.lane === 'string' ? n.lane : '',
        ring: num(n.ring, 1),
        cost: n.cost == null ? null : n.cost,
        req: reqListOf(n),
        max: Math.max(1, num(n.maxLevel != null ? n.maxLevel : n.max, 1)),
        /* 自动布局与程序化图标只读这两个字段：icon 由配置给，effect 用来兜底选图标 */
        icon: typeof n.icon === 'string' ? n.icon : '',
        effect: n.effect || null,
        kind: typeof n.kind === 'string' ? n.kind : 'talent',
        zone: typeof n.zone === 'string' ? n.zone : '',
        seq: seq++
      });
    });
    out.sort(function (a, b) {
      if (a.ring !== b.ring) return a.ring - b.ring;
      var la = laneIdx(cfg, a.lane), lb = laneIdx(cfg, b.lane);
      if (la !== lb) return la - lb;
      return a.seq - b.seq;
    });
    return out;
  }

  function treeCenter(cfg) {
    var c = cfg && cfg.center;
    if (!c || (!c.id && !c.name)) return null;
    return {
      id: c.id || 'center',
      name: c.name || c.id || '中心',
      desc: c.desc || c.text || '',
      lane: '',
      ring: 0,
      cost: c.cost == null ? null : c.cost,
      req: reqListOf(c),
      max: Math.max(1, num(c.maxLevel != null ? c.maxLevel : c.max, 1)),
      icon: typeof c.icon === 'string' ? c.icon : '',
      effect: c.effect || null,
      kind: 'core',
      zone: typeof c.zone === 'string' ? c.zone : '',
      seq: -1
    };
  }

  /* 整棵树的节点表（中心在前）：推荐卡与「已购天赋」统计都走这一条 */
  function treeAll() {
    var cfg = treeCfg(), out = [];
    var c = treeCenter(cfg);
    if (c) out.push(c);
    return out.concat(treeNodes(cfg));
  }

  function nodeData(cfg, id) {
    if (!cfg || !id) return null;
    var c = treeCenter(cfg);
    if (c && c.id === id) return c;
    var list = treeNodes(cfg);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* 等级与价格一律问 CORE（单一购买系统的唯一真相），UI 只留配置快照兜底 */
  function nodeLevelOf(id) {
    var c = core();
    if (c && c.nodeLevel) { try { return num(c.nodeLevel(id), 0); } catch (e) { /* 视为 0 级 */ } }
    return 0;
  }

  function nodeCostOf(n) {
    var c = core();
    if (c && c.nodeCost) {
      try {
        var v = c.nodeCost(n.id);
        if (v != null) return v;
      } catch (e) { /* 用配置快照 */ }
    }
    return n.cost == null ? null : n.cost;
  }

  /* 只有节点自己声明了 zone 的旧配置才做「关未开」限制：
     v8 起价格按深度（node.depth）缩放，节点不再绑关卡，整棵树不该被关序卡死。 */
  function nodeZoneOf(n) {
    return (n && typeof n.zone === 'string' && n.zone) ? n.zone : '';
  }

  /* 六态：owned / maxed / available / poor / locked(缺前置) / zonelocked(关未开) */
  function nodeStateOf(n) {
    var max = n.max > 0 ? n.max : 1;
    var lv = nodeLevelOf(n.id);
    if (lv >= max) return max > 1 ? 'maxed' : 'owned';
    var zid = nodeZoneOf(n);
    if (zid && !zoneUnlocked(zid)) return 'zonelocked';
    for (var i = 0; i < n.req.length; i++) if (nodeLevelOf(n.req[i]) < 1) return 'locked';
    var cost = nodeCostOf(n);
    if (cost == null) return 'locked';
    return canAfford(cost) ? 'available' : 'poor';
  }

  function missingNames(n) {
    var cfg = treeCfg(), out = [];
    for (var i = 0; i < n.req.length; i++) {
      if (nodeLevelOf(n.req[i]) >= 1) continue;
      var p = nodeData(cfg, n.req[i]);
      out.push(p ? p.name : n.req[i]);
    }
    return out;
  }

  function stateTextOf(n) {
    var stt = nodeStateOf(n);
    if (stt === 'owned') return '已购';
    if (stt === 'maxed') return '满级';
    if (stt === 'available') return '可买';
    if (stt === 'poor') return '金币不足';
    if (stt === 'zonelocked') {
      var zc = zoneOf(nodeZoneOf(n));
      return '关未开 · ' + (zc ? zc.name : '');
    }
    var miss = missingNames(n);
    return miss.length ? ('缺前置 ' + miss.join(' + ')) : '未解锁';
  }

  /* ---------------- 程序化图标（TREE-V8 §5）：Canvas 24×24 单色像素 ----------------

     10 种：pick / laser / bomb / tntbox / chain / coin / gem / clock / ring / sword。
     每个图标先画进一张 24×24 的 0/1 掩码（纯算术，不碰 canvas），再 fillRect 到 canvas
     取 data URL，按种类缓存；图标当 CSS mask 用，颜色由徽章状态（currentColor）决定。
     canvas 不可用时（极老环境）退回一个圆点占位，UI 不崩。 */

  var ICON_SIZE = 24;
  var ICON_KINDS = ['pick', 'laser', 'bomb',
    'tntbox', 'chain', 'coin', 'gem', 'clock', 'ring', 'sword']
  var iconURLs = {};

  function maskNew() {
    var m = new Array(ICON_SIZE * ICON_SIZE), i;
    for (i = 0; i < m.length; i += 1) m[i] = 0;
    return m;
  }

  function mSet(m, x, y) {
    var xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= ICON_SIZE || yi >= ICON_SIZE) return;
    m[yi * ICON_SIZE + xi] = 1;
  }

  function rectPts(m, x, y, w, h, v) {
    var ww = Math.round(w), hh = Math.round(h), x0 = Math.round(x), y0 = Math.round(y);
    for (var yy = 0; yy < hh; yy += 1) {
      for (var xx = 0; xx < ww; xx += 1) {
        var px = x0 + xx, py = y0 + yy;
        if (px < 0 || py < 0 || px >= ICON_SIZE || py >= ICON_SIZE) continue;
        m[py * ICON_SIZE + px] = v;
      }
    }
  }
  function mRect(m, x, y, w, h) { rectPts(m, x, y, w, h, 1); }
  function mClearRect(m, x, y, w, h) { rectPts(m, x, y, w, h, 0); }

  function mDisc(m, cx, cy, r) {
    for (var y = Math.ceil(cy - r); y <= Math.floor(cy + r); y += 1) {
      for (var x = Math.ceil(cx - r); x <= Math.floor(cx + r); x += 1) {
        var dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r * r + 0.25) mSet(m, x, y);
      }
    }
  }

  function mRing(m, cx, cy, rOut, rIn) {
    for (var y = Math.ceil(cy - rOut); y <= Math.floor(cy + rOut); y += 1) {
      for (var x = Math.ceil(cx - rOut); x <= Math.floor(cx + rOut); x += 1) {
        var dx = x - cx, dy = y - cy, d = dx * dx + dy * dy;
        if (d <= rOut * rOut + 0.25 && d >= rIn * rIn - 0.25) mSet(m, x, y);
      }
    }
  }

  // 粗线段：Bresenham 走一遍，每个落点盖一个半径 thick/2 的圆点
  function mLine(m, x0, y0, x1, y1, thick) {
    var ax = Math.round(x0), ay = Math.round(y0), bx = Math.round(x1), by = Math.round(y1);
    var dx = Math.abs(bx - ax), sx = ax < bx ? 1 : -1;
    var dy = -Math.abs(by - ay), sy = ay < by ? 1 : -1;
    var err = dx + dy, guard = 0, r = Math.max(0, (thick || 1) / 2);
    while (guard < 200) {
      guard += 1;
      if (r > 0) mDisc(m, ax, ay, r); else mSet(m, ax, ay);
      if (ax === bx && ay === by) break;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; ax += sx; }
      if (e2 <= dx) { err += dx; ay += sy; }
    }
  }

  // 圆弧（角度制，0° = 正右，y 轴向下）：沿弧撒圆点
  function mArc(m, cx, cy, r, a0, a1, thick) {
    var steps = Math.max(10, Math.round(Math.abs(a1 - a0) * 1.5));
    for (var i = 0; i <= steps; i += 1) {
      var a = (a0 + (a1 - a0) * i / steps) * Math.PI / 180;
      mDisc(m, cx + r * Math.cos(a), cy + r * Math.sin(a), (thick || 1) / 2);
    }
  }

  /* 10 种图标的画法：全部是 24×24 内的像素原语，没有外部资源、没有字体 */
  var ICON_PAINT = {
    // 镐：斜柄 + 上半弧镐头
    pick: function (m) {
      mLine(m, 5, 21, 14, 9, 2.4);
      mArc(m, 14, 9, 9, 200, 340, 2.6);
    },
    // 激光钻：机身 + 向下的光束 + 两侧散热齿
    laser: function (m) {
      mRect(m, 8, 6, 8, 6);
      mRect(m, 11, 12, 2, 8);
      mRect(m, 9, 20, 6, 2);
      mRect(m, 5, 7, 2, 3);
      mRect(m, 17, 7, 2, 3);
    },
    // 炸弹：圆球 + 引信 + 火星
    bomb: function (m) {
      mDisc(m, 11, 15, 6);
      mClearRect(m, 7, 11, 2, 2);
      mLine(m, 15, 10, 19, 5, 1.8);
      mRect(m, 20, 3, 2, 2);
    },
    // TNT 箱：描框 + 三条竖纹 + 引信
    tntbox: function (m) {
      mRect(m, 4, 9, 16, 11);
      mClearRect(m, 6, 11, 12, 7);
      mRect(m, 8, 11, 2, 7);
      mRect(m, 11, 11, 2, 7);
      mRect(m, 14, 11, 2, 7);
      mLine(m, 12, 9, 16, 4, 1.6);
      mRect(m, 17, 3, 1, 1);
    },
    // 连锁：两只斜扣的环
    chain: function (m) {
      mRing(m, 8, 8, 6, 3.6);
      mRing(m, 16, 16, 6, 3.6);
    },
    // 金币：外圈 + 中间的竖杠
    coin: function (m) {
      mRing(m, 12, 12, 8, 6);
      mRect(m, 11, 7, 2, 9);
      mRect(m, 9, 7, 4, 2);
      mRect(m, 9, 15, 4, 2);
    },
    // 宝石：上宽下尖的菱形 + 一道横向切面
    gem: function (m) {
      var y, w;
      for (y = 4; y <= 8; y += 1) {
        w = 4 + (y - 4) * 3;
        mRect(m, 12 - w / 2, y, w, 1);
      }
      for (y = 9; y <= 20; y += 1) {
        w = Math.round(16 - (y - 8) * 1.6);
        if (w < 1) break;
        mRect(m, 12 - w / 2, y, w, 1);
      }
      mClearRect(m, 5, 8, 14, 1);
    },
    // 时钟：表圈 + 两根指针
    clock: function (m) {
      mRing(m, 12, 12, 9, 7.2);
      mLine(m, 12, 12, 12, 6, 1.4);
      mLine(m, 12, 12, 17, 12, 1.4);
    },
    // 剑：竖刃 + 十字护手 + 柄
    sword: function (m) {
      mRect(m, 11, 2, 2, 11);
      mRect(m, 6, 13, 12, 2);
      mRect(m, 9, 15, 6, 2);
      mRect(m, 11, 17, 2, 5);
      mRect(m, 10, 21, 4, 2);
    },
    // 环：圆环 + 四个方向的刻度
    ring: function (m) {
      mRing(m, 12, 12, 9, 6.2);
      mRect(m, 11, 1, 2, 3);
      mRect(m, 11, 20, 2, 3);
      mRect(m, 1, 11, 3, 2);
      mRect(m, 20, 11, 3, 2);
    }
  };

  function iconMask(kind) {
    var m = maskNew();
    var fn = ICON_PAINT[kind] || ICON_PAINT.pick;
    fn(m);
    return m;
  }

  /* 掩码 → canvas → data URL（按种类缓存；用 CSS mask 上色，所以只画白色） */
  function iconURL(kind) {
    var k = String(kind || '');
    if (Object.prototype.hasOwnProperty.call(iconURLs, k)) return iconURLs[k];
    var url = null;
    var m = iconMask(k);
    if (D.createElement) {
      var cv = null;
      try { cv = D.createElement('canvas'); } catch (e) { cv = null; }
      var ctx = null;
      if (cv && cv.getContext) {
        cv.width = ICON_SIZE;
        cv.height = ICON_SIZE;
        try { ctx = cv.getContext('2d'); } catch (e2) { ctx = null; }
      }
      if (ctx && typeof ctx.fillRect === 'function' && typeof cv.toDataURL === 'function') {
        ctx.fillStyle = '#ffffff';
        for (var y = 0; y < ICON_SIZE; y += 1) {
          for (var x = 0; x < ICON_SIZE; x += 1) {
            if (m[y * ICON_SIZE + x]) ctx.fillRect(x, y, 1, 1);
          }
        }
        try { url = cv.toDataURL('image/png'); } catch (e3) { url = null; }
        if (typeof url !== 'string' || url.indexOf('data:image') !== 0) url = null;
      }
    }
    iconURLs[k] = url;
    return url;
  }

  /* 节点 → 10 种图标之一：配置的 icon 字段优先，其次 id 表，再按 effect 活键 / 名字兜底 */
  var ICON_BY_ID = {
    // TREE-V8 §2 的 20 个节点
    mine: 'pick', atk: 'pick', spd: 'clock', settle: 'coin', ore: 'gem',
    tntDrop: 'bomb', tntDmg: 'bomb', tntPierce: 'tntbox',
    chain: 'chain', chainRange: 'ring',
    toolIron: 'pick', toolDiamond: 'pick',
    diaRange: 'ring', toolLaser: 'laser', laserCol: 'laser',
    // v7 的节点（配置还没切到 v8 时兜底；v8 落地后这张表自动只用于旧档）
    core0: 'pick', core: 'pick',
    handle: 'pick', recycle: 'pick', hardEdge: 'pick', rockHammer: 'pick',
    coreAuger: 'pick', singularity: 'pick', laserSpec: 'laser', pierceCore: 'laser',
    steelTip: 'chain', chainPick: 'chain', twinEdge: 'chain', overclock: 'clock',
    overload: 'clock', coreResonance: 'ring',
    pouch: 'clock', frenzyBody: 'clock', blastIntro: 'tntbox', blastExpert: 'coin',
    richCycle: 'gem', blastLattice: 'coin', frenzySurge: 'clock',
    glove: 'ring', coil: 'ring', luckyTNT: 'bomb', tntMaster: 'bomb',
    spareTNT: 'tntbox', wideBlast: 'ring', magnetStorm: 'ring', furyCore: 'coin',
    oreSense: 'gem', deepTexture: 'laser', veinResonance: 'chain', veinEcho: 'chain',
    veinCore: 'chain', deepPocket: 'laser', coreVein: 'chain',
    richSense: 'gem', deepDigger: 'gem', richVein: 'gem', deepShaft: 'laser',
    deepMatrix: 'laser', crystalLode: 'gem', mantleSense: 'gem',
    pickDamage: 'pick', magnet: 'ring', bag: 'coin', workTime: 'clock', richBonus: 'gem'
  };

  var ICON_BY_EFFECT = [
    ['laserDamage', 'laser'], ['resonanceThreshold', 'ring'],
    ['tntLayerPierce', 'tntbox'], ['tntDamageMul', 'bomb'], ['luckyTNTChance', 'bomb'],
    ['chainChance', 'chain'], ['settleMul', 'coin'], ['richMul', 'gem'],
    ['oreRateBonus', 'gem'], ['extraLayers', 'gem'], ['magnetSpeedMul', 'ring'],
    ['holdIntervalMul', 'clock'], ['frenzySeconds', 'clock'], ['roundSeconds', 'clock'],
    ['damage', 'pick']
  ];

  function iconKindOf(n) {
    if (!n) return 'pick';
    if (typeof n.icon === 'string' && ICON_KINDS.indexOf(n.icon) >= 0) return n.icon;
    if (ICON_BY_ID[n.id]) return ICON_BY_ID[n.id];
    var e = n.effect, i;
    if (e) {
      for (i = 0; i < ICON_BY_EFFECT.length; i += 1) {
        if (e[ICON_BY_EFFECT[i][0]] != null) return ICON_BY_EFFECT[i][1];
      }
    }
    var nm = String(n.name || '');
    if (nm.indexOf('激光') >= 0) return 'laser';
    if (nm.indexOf('时间') >= 0 || nm.indexOf('狂热') >= 0 || nm.indexOf('攻速') >= 0) return 'clock';
    if (nm.indexOf('金币') >= 0 || nm.indexOf('结算') >= 0) return 'coin';
    if (nm.indexOf('连锁') >= 0) return 'chain';
    if (nm.indexOf('TNT') >= 0) return 'bomb';
    return n.kind === 'core' ? 'pick' : 'gem';
  }

  /* ---------------- 自动布局：只按 parent 摆放（TREE-V8 §1） ----------------

     depth = 父链长度；半径 = 70 + 54 × depth。
     角度按扇区切：根的子节点整圈均分，其余节点把父扇区按「子树节点数」分给子节点，
     每个子节点至少拿到 minArcDeg(子深度) —— 同深度相邻弧长 ≥ MIN_ARC，不重叠。
     只有一个子节点时扇区原样下传 → 子节点角度 = 父角度，一条 lane 就是一条直线枝。 */

  /* 第 dep 环上刚好摆满 MIN_ARC 弧长所需的圆心角（度） */
  function minArcDeg(dep) {
    return MIN_ARC / (TREE_R0 + dep * TREE_DR) * 180 / Math.PI;
  }

  /* 把 width 度按权重切给 n 个子节点，每个至少 floor 度：
     先按权重占比分，不够 floor 的抬到 floor、剩下的按比例重分；实在挤不下就均分（尽力而为）。 */
  function splitWidths(weights, width, floor) {
    var n = weights.length, out = [], fixed = [], i;
    if (!n) return out;
    if (!(width > 0)) { for (i = 0; i < n; i += 1) out.push(0); return out; }
    if (floor * n >= width) { for (i = 0; i < n; i += 1) out.push(width / n); return out; }
    for (i = 0; i < n; i += 1) { out.push(0); fixed.push(false); }
    var guard = 0;
    while (guard <= n) {
      guard += 1;
      var used = 0, freeW = 0, changed = false;
      for (i = 0; i < n; i += 1) {
        if (fixed[i]) used += out[i]; else freeW += weights[i];
      }
      var remain = width - used;
      for (i = 0; i < n; i += 1) {
        if (fixed[i]) continue;
        var v = freeW > 0 ? remain * weights[i] / freeW : 0;
        if (v < floor - 1e-9) { out[i] = floor; fixed[i] = true; changed = true; }
      }
      if (changed) continue;
      for (i = 0; i < n; i += 1) {
        if (fixed[i]) continue;
        out[i] = freeW > 0 ? remain * weights[i] / freeW : 0;
        fixed[i] = true;
      }
      break;
    }
    for (i = 0; i < n; i += 1) if (!fixed[i]) out[i] = floor;
    return out;
  }

  function treeLayout(cfg) {
    var list = treeAll();
    var byId = {}, ids = [], kids = {}, parent = {}, depth = {}, angle = {}, i, j;
    for (i = 0; i < list.length; i += 1) {
      byId[list[i].id] = list[i];
      ids.push(list[i].id);
    }
    var center = treeCenter(cfg);
    var rootId = center ? center.id : '';

    function parentOf(n) {
      for (var k = 0; k < n.req.length; k += 1) {
        var r = n.req[k];
        if (r && r !== n.id && byId[r]) return r;
      }
      return (rootId && n.id !== rootId) ? rootId : '';
    }

    for (i = 0; i < ids.length; i += 1) {
      var id = ids[i];
      if (id === rootId) { parent[id] = ''; continue; }
      parent[id] = parentOf(byId[id]);
      if (parent[id]) {
        if (!kids[parent[id]]) kids[parent[id]] = [];
        kids[parent[id]].push(id);
      }
    }

    /* BFS 定深度（父链有环时按已访问截断，绝不递归爆栈） */
    var seen = {}, frontier = [];
    if (rootId) { depth[rootId] = 0; seen[rootId] = true; frontier = [rootId]; }
    while (frontier.length) {
      var next = [];
      for (i = 0; i < frontier.length; i += 1) {
        var cs = kids[frontier[i]] || [];
        for (j = 0; j < cs.length; j += 1) {
          if (seen[cs[j]]) continue;
          seen[cs[j]] = true;
          depth[cs[j]] = depth[frontier[i]] + 1;
          next.push(cs[j]);
        }
      }
      frontier = next;
    }
    for (i = 0; i < ids.length; i += 1) {
      if (!seen[ids[i]]) { depth[ids[i]] = 1; seen[ids[i]] = true; }   // 孤儿 / 断链
    }

    /* 角度 = 扇区中点。根的子节点整圈均分（360°/k 一条枝），
       其余节点把父扇区按子树大小切给子节点（每个至少 minArcDeg 度）。
       单链子节点继承整块扇区 → 角度与父完全一致，一条 lane 画出来就是一条直线枝。 */
    var secA = {}, secB = {}, wSum = {}, rootKids, rw, ra;
    rootKids = rootId ? (kids[rootId] || []) : [];
    if (rootKids.length) {
      rw = 360 / rootKids.length;
      for (i = 0; i < rootKids.length; i += 1) {
        ra = -90 + i * rw;
        angle[rootKids[i]] = ra;
        secA[rootKids[i]] = ra - rw / 2;
        secB[rootKids[i]] = ra + rw / 2;
      }
    }

    /* 子树权重 = 这条枝上的节点数（深的先算，父 = 1 + Σ 子） */
    var deepFirst = ids.slice().sort(function (a, b) { return depth[b] - depth[a]; });
    for (i = 0; i < deepFirst.length; i += 1) {
      var wnode = deepFirst[i], wsum = 1, wk = kids[wnode] || [];
      for (j = 0; j < wk.length; j += 1) wsum += wSum[wk[j]] || 1;
      wSum[wnode] = wsum;
    }

    /* 自上而下切扇区：子节点按权重分配父扇区，不够 minArcDeg 的抬到下限再重分 */
    var shallowFirst = ids.slice().sort(function (a, b) { return depth[a] - depth[b]; });
    for (i = 0; i < shallowFirst.length; i += 1) {
      var pnode = shallowFirst[i];
      if (pnode === rootId) continue;              // 根的子节点已经按 360° 均分
      var pch = kids[pnode] || [];
      if (!pch.length) continue;
      var lo, hi;
      if (secA[pnode] == null) {                   // 孤儿 / 断链：没有父扇区，按父角度给满宽
        if (angle[pnode] == null) angle[pnode] = -90;
        lo = angle[pnode] - CHILD_SPREAD_MAX / 2;
        hi = angle[pnode] + CHILD_SPREAD_MAX / 2;
      } else {
        lo = secA[pnode];
        hi = secB[pnode];
      }
      if (hi - lo > CHILD_SPREAD_MAX) {            // 子节点扇面不超过 ±50°
        var pmid = (lo + hi) / 2;
        lo = pmid - CHILD_SPREAD_MAX / 2;
        hi = pmid + CHILD_SPREAD_MAX / 2;
      }
      var wts = [], kk, kk2;
      for (kk = 0; kk < pch.length; kk += 1) wts.push(wSum[pch[kk]] || 1);
      var total = hi - lo;
      var floor = minArcDeg(depth[pnode] + 1);
      var widths = splitWidths(wts, total, floor);
      /* 主干 = 子树最大的那个子节点（同权重取第一个）：钉死在父角度上，
         其余子节点分到它左右两侧。一条 lane 的长链因此始终是一条直线枝，
         侧枝从旁边岔出去，不会把主干顶弯。 */
      var trunk = 0;
      for (kk = 1; kk < wts.length; kk += 1) if (wts[kk] > wts[trunk]) trunk = kk;
      var leftIdx = [], rightIdx = [], leftWeights = [], rightWeights = [];
      for (kk = 0; kk < pch.length; kk += 1) {
        if (kk < trunk) { leftIdx.push(kk); leftWeights.push(wts[kk]); }
        else if (kk > trunk) { rightIdx.push(kk); rightWeights.push(wts[kk]); }
      }
      var trunkW = widths[trunk] > 0 ? Math.min(total, widths[trunk]) : total;
      /* v15：两侧各自至少要 floor × 子节点数，凑不出来就从主干宽度里让出来。
         6 条枝（60° 扇区）时 atk2 有三个孩子（atk3 + exec1 + spd1）：原来两侧各拿
         (63.5-30)/2 的固定半边，exec1/spd1 被压到 8.7°，第 3 环弧长 35px < MIN_ARC 40px。
         让主干收窄到「扇面 - 两侧下限」之后，两侧各自够 floor，弧长回到 40px 线。
         5 条枝（72°）时两侧本来就够 floor，主干宽度不变 —— 旧的布局一个像素都不动。 */
      var needL = floor * leftIdx.length, needR = floor * rightIdx.length;
      if (trunkW + needL + needR > total) trunkW = Math.max(0, total - needL - needR);
      var side = total - trunkW;
      if (side < 0) side = 0;
      var leftTotal, rightTotal;
      if (!leftIdx.length) { leftTotal = 0; rightTotal = side; }
      else if (!rightIdx.length) { leftTotal = side; rightTotal = 0; }
      else {
        var minL = Math.min(needL, side), minR = Math.min(needR, Math.max(0, side - minL));
        leftTotal = minL + (side - minL - minR) * 0.5;
        rightTotal = side - leftTotal;
      }
      var leftWidths = splitWidths(leftWeights, leftTotal, floor);
      var rightWidths = splitWidths(rightWeights, rightTotal, floor);
      var mid2 = (lo + hi) / 2, cursor = lo;
      for (kk = 0; kk < leftIdx.length; kk += 1) {
        var lw = leftWidths[kk] > 0 ? leftWidths[kk] : 0;
        secA[pch[leftIdx[kk]]] = cursor;
        secB[pch[leftIdx[kk]]] = cursor + lw;
        angle[pch[leftIdx[kk]]] = cursor + lw / 2;
        cursor += lw;
      }
      secA[pch[trunk]] = mid2 - trunkW / 2;
      secB[pch[trunk]] = mid2 + trunkW / 2;
      angle[pch[trunk]] = mid2;
      cursor = mid2 + trunkW / 2;
      for (kk2 = 0; kk2 < rightIdx.length; kk2 += 1) {
        var rw2 = rightWidths[kk2] > 0 ? rightWidths[kk2] : 0;
        secA[pch[rightIdx[kk2]]] = cursor;
        secB[pch[rightIdx[kk2]]] = cursor + rw2;
        angle[pch[rightIdx[kk2]]] = cursor + rw2 / 2;
        cursor += rw2;
      }
    }
    for (i = 0; i < ids.length; i += 1) {
      if (angle[ids[i]] == null) angle[ids[i]] = -90;
    }

    var maxDepth = 0;
    for (i = 0; i < ids.length; i += 1) {
      if (depth[ids[i]] > maxDepth) maxDepth = depth[ids[i]];
    }
    var maxR = TREE_R0 + maxDepth * TREE_DR;
    var cx = maxR, cy = maxR;                     // 先按「半径 + 0 留白」摆，包围盒尺寸最后由徽章定
    var raw = {};
    for (i = 0; i < ids.length; i += 1) {
      var nid = ids[i], dep = depth[nid];
      var r = TREE_R0 + dep * TREE_DR;
      var a = (dep === 0 ? 0 : angle[nid]) * Math.PI / 180;
      raw[nid] = dep === 0
        ? { x: cx, y: cy }
        : { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    }

    /* extent = 所有徽章（含半径）包围盒的正方形外接尺寸，且以中心徽章为圆心：
       取四个方向上离中心最远的那一个 —— 这样初始缩放（fitScale）与居中（centerTree）
       只用 extent 一个数，中心徽章正好落在视口正中，谁也不被视口裁掉。 */
    var left = 0, right = 0, top = 0, bottom = 0;
    for (i = 0; i < ids.length; i += 1) {
      var q = raw[ids[i]];
      var rad = (depth[ids[i]] === 0 ? CENTER_D : NODE_D) / 2;
      var dx = q.x - cx, dy = q.y - cy;
      if (rad - dx > left) left = rad - dx;
      if (dx + rad > right) right = dx + rad;
      if (rad - dy > top) top = rad - dy;
      if (dy + rad > bottom) bottom = dy + rad;
    }
    var extent = 2 * Math.ceil(Math.max(left, right, top, bottom));
    var shift = extent / 2 - cx;                  // 平移到「中心徽章 = extent/2」
    var pos = {}, out = [];
    for (i = 0; i < ids.length; i += 1) {
      var nid2 = ids[i], dep2 = depth[nid2], q2 = raw[nid2];
      var p = { x: Math.round(q2.x + shift), y: Math.round(q2.y + shift) };
      pos[nid2] = p;
      out.push({
        id: nid2, node: byId[nid2], depth: dep2, angle: dep2 === 0 ? 0 : angle[nid2],
        r: TREE_R0 + dep2 * TREE_DR, x: p.x, y: p.y
      });
    }
    return {
      list: out, pos: pos, depth: depth, size: extent, extent: extent,
      cx: extent / 2, cy: extent / 2, maxDepth: maxDepth, maxR: maxR
    };
  }

  function toolById(id) {
    var cf = config();
    var t = cf && cf.tools ? cf.tools[id] : null;
    return t ? { id: t.id || id, name: t.name || id } : null;
  }

  /* ---------------- 布局测量：与 main 的 contain 缩放保持一致 ---------------- */

  function measure() {
    if (!R.layer) return;
    var vw = num(W.innerWidth, DW);
    var vh = num(W.innerHeight, DH);
    var s = Math.min(vw / DW, vh / DH);
    if (s <= 0) s = 1;
    R.layer.style.transform = 'translate(-50%,-50%) scale(' + s.toFixed(4) + ')';
  }

  /* ---------------- 构建 ---------------- */

  function ensureBuilt() {
    if (built) return;
    built = true;
    R.artSlots = [];
    R.artLeft = 0;
    R.muted = null;
    R.frenzyMax = 0;
    R.comboMult = 1;
    R.qualityText = QUALITY_CYCLE[0];
    buildLayer();
    buildCamp();
    buildHud();
    buildResult();
    buildOverlays();
    buildToast();
    buildVictory();
    buildWatermark();
  }

  /* 署名水印：最后挂载 + 高 z-index，任何界面 / 抽屉 / 弹窗都压不住；不吃点击 */
  function buildWatermark() {
    var wm = put(R.layer, h('div', 'bm-watermark', null, 'bm-watermark'));
    put(wm, h('div', 'wm-line', '制作：驯鸽鸽'));
    put(wm, h('div', 'wm-line', '发布：明月庄主'));
    R.watermark = wm;
  }

  function buildLayer() {
    var layer = h('div', 'bm-layer', null, 'bm-ui');
    R.layer = layer;
    (R.host || D.body || D.documentElement).appendChild(layer);
  }

  function buildCamp() {
    var s = h('div', 'bm-screen bm-camp', null, 'bm-screen-camp');
    R.camp = put(R.layer, s);

    /* 标题图：槽位先占好，BM.ART 解码完成后自动补进 <img>，没有图时这行不留高度 */
    R.logoRow = put(s, h('div', 'camp-logo-row'));
    iconSlot(R.logoRow, 'logo.title', 'game-logo', '');

    var top = put(s, h('div', 'camp-top'));
    var coinBox = put(top, h('div', 'coin-box'));
    put(coinBox, h('span', 'coin-dot'));
    R.coins = put(coinBox, h('span', 'coin-num', '0', 'bm-coins'));
    R.coinsAbbr = put(coinBox, h('span', 'coin-abbr', '0', 'bm-coins-abbr'));
    var tops = put(top, h('div', 'top-btns'));
    R.muteBtn = put(tops, h('button', 'pill-btn ico-btn', null, 'bm-btn-mute'));
    R.muteBtn.setAttribute('type', 'button');
    R.muteLbl = put(R.muteBtn, h('span', 'btn-lbl', '音效'));
    R.muteIco = iconSlot(R.muteBtn, 'icons.sound_on', 'set-ico', '');
    R.muteBtn.addEventListener('click', onMuteClick);
    R.settingsBtn = put(tops, h('button', 'pill-btn ico-btn', null, 'bm-btn-settings'));
    R.settingsBtn.setAttribute('type', 'button');
    put(R.settingsBtn, h('span', 'btn-lbl', '设置'));
    iconSlot(R.settingsBtn, 'icons.icon_settings', 'set-ico', '');
    R.settingsBtn.addEventListener('click', function () { openSheet(R.settingsPanel, true); call('onUi', 'settings'); });

    var zone = put(s, h('div', 'zone-card'));
    var zhead = put(zone, h('div', 'zone-head'));
    R.zoneHead = zhead;
    R.zoneName = put(zhead, h('div', 'zone-name', '—', 'bm-zone-name'));
    R.zoneTag = put(zhead, h('div', 'zone-tag', '', 'bm-zone-tag'));
    R.objText = put(zone, h('div', 'zone-obj', '下一目标', 'bm-obj-text'));
    var bar = put(zone, h('div', 'obj-bar'));
    R.objFill = put(bar, h('div', 'obj-fill', null, 'bm-obj-fill'));
    /* v5：下一关提示（读 zones[].nextZone 查表；末关或查不到时整行隐藏） */
    R.zoneNext = put(zone, h('div', 'zone-next', '', 'bm-zone-next'));
    /* v3：最后一关达标后的营地通关徽标（默认隐藏） */
    R.campClear = put(zone, h('div', 'zone-clear', '主线通关', 'bm-camp-clear'));
    /* v6：挖到地心宝藏后的金色「已通关」角标（纯 CSS，钉在矿区卡右上角） */
    R.campVictory = put(zone, h('div', 'zone-victory', '已通关', 'bm-camp-victory'));

    var startWrap = put(s, h('div', 'start-wrap'));
    R.startBtn = put(startWrap, h('button', 'start-btn', null, 'bm-btn-start'));
    R.startBtn.setAttribute('type', 'button');
    put(R.startBtn, h('span', 'start-main', '开始挖矿'));
    R.startSub = put(R.startBtn, h('span', 'start-sub', ''));
    R.startBtn.addEventListener('click', function () {
      call('onStartRound', (state().currentZone) || 'quarry');
      renderCamp();
    });

    R.toolRow = put(s, h('div', 'tool-row', null, 'bm-tools'));

    R.recCard = put(s, h('button', 'rec-card', null, 'bm-recommend'));
    R.recCard.setAttribute('type', 'button');
    var recHead = put(R.recCard, h('div', 'rec-head'));
    R.recLabel = put(recHead, h('div', 'rec-label', '推荐天赋'));
    R.recName = put(recHead, h('div', 'rec-name', '', 'bm-recommend-name'));
    var recBody = put(R.recCard, h('div', 'rec-body'));
    R.recEffect = put(recBody, h('div', 'rec-effect', '', 'bm-recommend-effect'));
    R.recCost = put(recBody, h('div', 'rec-cost', '', 'bm-recommend-cost'));
    R.recCard.addEventListener('click', function () {
      if (!R.recId) return;
      if (!R.recAfford) { playUi('ui'); toast('金币不足，还差 ' + fmtCoins(R.recGap || 0)); return; }
      playUi('ui');
      call('onBuyNode', R.recId);
      renderCamp();
    });

    var stats = put(s, h('div', 'camp-stats', null, 'bm-camp-stats'));
    R.statMined = statCell(stats, '本图目标', 'bm-camp-mined');
    R.statBest = statCell(stats, '最高纪录', 'bm-camp-best');
    R.statTalents = statCell(stats, '已购天赋', 'bm-camp-talents');

    var dock = put(s, h('div', 'camp-dock'));
    R.talentsBtn = put(dock, h('button', 'dock-btn has-ico', null, 'bm-btn-talents'));
    R.talentsBtn.setAttribute('type', 'button');
    put(R.talentsBtn, h('span', 'btn-lbl', '天赋'));
    iconSlot(R.talentsBtn, 'icons.icon_talent', 'btn-ico', '');
    R.talentsBtn.addEventListener('click', function () { renderCamp(); openDrawer('talents'); });
  }

  function buildHud() {
    var hud = h('div', 'bm-hud', null, 'bm-hud');
    R.hud = put(R.layer, hud);

    var top = put(hud, h('div', 'hud-top'));
    R.hudTime = put(top, h('div', 'hud-time', '15s', 'bm-hud-time'));
    var cw = put(top, h('div', 'hud-coins-wrap'));
    put(cw, h('span', 'coin-dot small'));
    R.hudCoins = put(cw, h('div', 'hud-coins', '0', 'bm-hud-coins'));
    R.hudMute = put(top, h('button', 'hud-mute ico-btn', null, 'bm-btn-hud-mute'));
    R.hudMute.setAttribute('type', 'button');
    R.hudMuteLbl = put(R.hudMute, h('span', 'btn-lbl', '音'));
    R.hudMuteIco = iconSlot(R.hudMute, 'icons.sound_on', 'set-ico', '');
    R.hudMute.addEventListener('click', onMuteClick);
    R.hudQuality = put(top, h('button', 'hud-quality ico-btn', null, 'bm-btn-hud-quality'));
    R.hudQuality.setAttribute('type', 'button');
    R.hudQualityLbl = put(R.hudQuality, h('span', 'btn-lbl', '高'));
    iconSlot(R.hudQuality, 'icons.icon_quality', 'set-ico', '');
    R.hudQuality.addEventListener('click', cycleQuality);
    R.hudExit = put(top, h('button', 'hud-exit ico-btn', null, 'bm-btn-hud-exit'));
    R.hudExit.setAttribute('type', 'button');
    put(R.hudExit, h('span', 'btn-lbl', '返回'));
    R.hudExit.addEventListener('click', function () { call('onExitRound'); });
    R.hudOres = put(hud, h('div', 'hud-ores', null, 'bm-hud-ores'));

    var bottom = put(hud, h('div', 'hud-bottom'));
    var cRow = put(bottom, h('div', 'combo-row'));
    var cBar = put(cRow, h('div', 'combo-bar'));
    R.comboFill = put(cBar, h('div', 'combo-fill', null, 'bm-combo-fill'));
    R.comboMultNode = put(cRow, h('div', 'combo-mult', '×1', 'bm-combo-mult'));
    R.frenzyRow = put(bottom, h('div', 'frenzy-row', null, 'bm-frenzy-row'));
    put(R.frenzyRow, h('span', 'frenzy-text', '狂热'));
    var fBar = put(R.frenzyRow, h('div', 'frenzy-bar'));
    R.frenzyFill = put(fBar, h('div', 'frenzy-fill', null, 'bm-frenzy-fill'));

    var foot = put(bottom, h('div', 'hud-foot'));
    R.toolName = put(foot, h('div', 'hud-tool', '', 'bm-tool-name'));
  }

  function buildResult() {
    var s = h('div', 'bm-screen bm-result', null, 'bm-screen-result');
    R.resScreen = put(R.layer, s);
    var head = put(s, h('div', 'res-head'));
    put(head, h('div', 'res-title', '本局结算'));
    R.resZone = put(head, h('div', 'res-zone', '', 'bm-res-zone'));
    R.resLines = put(s, h('div', 'res-lines', null, 'bm-res-lines'));
    var total = put(s, h('div', 'res-total-box'));
    put(total, h('div', 'res-total-label', '总收入'));
    R.resTotal = put(total, h('div', 'res-total', '0', 'bm-res-total'));
    R.resTotalAbbr = put(total, h('div', 'res-total-abbr', '', 'bm-res-total-abbr'));
    var stats = put(s, h('div', 'res-stats'));
    R.statBroken = statCell(stats, '破坏格数', 'bm-res-broken', 'icons.icon_record');
    R.statCombo = statCell(stats, '最大连击', 'bm-res-combo', 'icons.icon_combo');
    R.statBoom = statCell(stats, '爆破次数', 'bm-res-explosions', 'icons.clock');
    /* v3：主线通关大字，占用原来解锁条的位置（副标题在 renderResult 里按关数现算） */
    R.resClear = put(s, h('div', 'res-clear', null, 'bm-res-clear'));
    put(R.resClear, h('div', 'res-clear-main', '主线通关'));
    R.resClearSub = put(R.resClear, h('div', 'res-clear-sub', '', 'bm-res-clear-sub'));
    /* v5：下一关提示（result.nextZoneId → zones 查表） */
    R.resNext = put(s, h('div', 'res-next', '', 'bm-res-next'));
    R.resUnlock = put(s, h('div', 'res-unlock', '', 'bm-res-unlock'));
    var acts = put(s, h('div', 'res-actions'));
    R.continueBtn = put(acts, h('button', 'primary-btn', '继续挖', 'bm-btn-continue'));
    R.continueBtn.setAttribute('type', 'button');
    R.continueBtn.addEventListener('click', function () { call('onNextRound'); });
    R.backBtn = put(acts, h('button', 'ghost-btn', '回营地', 'bm-btn-back'));
    R.backBtn.setAttribute('type', 'button');
    R.backBtn.addEventListener('click', function () { call('onBackToCamp'); });

    /* 点任意空白处跳过滚动 */
    R.resScreen.addEventListener('click', function () {
      if (R.rolling) skipRoll();
    });
  }

  function statCell(parent, label, id, icoKey) {
    var cell = put(parent, h('div', 'stat-cell'));
    if (icoKey) iconSlot(cell, icoKey, 'res-ico', '');
    put(cell, h('div', 'stat-label', label));
    return put(cell, h('div', 'stat-value', '0', id));
  }

  function buildOverlays() {
    /* 天赋抽屉（树枝） */
    var dt = h('div', 'bm-drawer', null, 'bm-drawer-talents');
    R.talentsDrawer = put(R.layer, dt);
    put(dt, h('div', 'drawer-mask')).addEventListener('click', function () { openDrawer(null); });
    var sheetT = put(dt, h('div', 'drawer-sheet'));
    var headT = put(sheetT, h('div', 'drawer-head'));
    put(headT, h('div', 'drawer-title', '天赋树'));
    R.talentsClose = put(headT, h('button', 'close-btn', '关闭', 'bm-btn-talents-close'));
    R.talentsClose.setAttribute('type', 'button');
    R.talentsClose.addEventListener('click', function () { openDrawer(null); });
    R.talentsBody = put(sheetT, h('div', 'drawer-body talent-body', null, 'bm-talents-body'));
    var footT = put(sheetT, h('div', 'drawer-foot'));
    R.resetTalentsBtn = put(footT, h('button', 'ghost-btn', '免费重置天赋', 'bm-btn-reset-talents'));
    R.resetTalentsBtn.setAttribute('type', 'button');
    R.resetTalentsBtn.addEventListener('click', function () {
      call('onResetTalents');
      renderCamp();
    });

    /* 设置面板 */
    var ps = h('div', 'bm-sheet-wrap', null, 'bm-panel-settings');
    R.settingsPanel = put(R.layer, ps);
    put(ps, h('div', 'drawer-mask')).addEventListener('click', function () { openSheet(R.settingsPanel, false); });
    var box = put(ps, h('div', 'bm-sheet'));
    var ph = put(box, h('div', 'drawer-head'));
    put(ph, h('div', 'drawer-title', '设置'));
    var pclose = put(ph, h('button', 'close-btn', '关闭', 'bm-btn-settings-close'));
    pclose.setAttribute('type', 'button');
    pclose.addEventListener('click', function () { openSheet(R.settingsPanel, false); });
    var pb = put(box, h('div', 'sheet-body'));

    var qRow = put(pb, h('div', 'setting-row'));
    put(qRow, h('div', 'setting-label', '特效画质'));
    R.qualityBtn = put(qRow, h('button', 'pill-btn setting-btn ico-btn', null, 'bm-btn-quality'));
    R.qualityBtn.setAttribute('type', 'button');
    R.qualityLbl = put(R.qualityBtn, h('span', 'btn-lbl', '高'));
    iconSlot(R.qualityBtn, 'icons.icon_quality', 'set-ico', '');
    R.qualityBtn.addEventListener('click', cycleQuality);

    var sRow = put(pb, h('div', 'setting-row'));
    put(sRow, h('div', 'setting-label', '屏幕震动'));
    R.shakeBtn = put(sRow, h('button', 'pill-btn setting-btn on', '开', 'bm-btn-shake'));
    R.shakeBtn.setAttribute('type', 'button');
    R.shakeBtn.addEventListener('click', function () {
      var off = R.shakeBtn.classList.contains('on');
      setCls(R.shakeBtn, 'on', !off);
      setText(R.shakeBtn, off ? '关' : '开');
      playUi('ui');
      call('onToggleShake');
    });

    R.resetSaveBtn = put(pb, h('button', 'danger-btn ico-btn', null, 'bm-btn-reset-save'));
    R.resetSaveBtn.setAttribute('type', 'button');
    put(R.resetSaveBtn, h('span', 'btn-lbl', '重置存档'));
    iconSlot(R.resetSaveBtn, 'icons.icon_reset', 'btn-ico', '');
    R.resetSaveBtn.addEventListener('click', function () { openConfirm(true); });
    put(pb, h('div', 'hint', '重置会清空金币、天赋与已解锁工具，不可撤销。'));

    /* 二次确认 */
    var cf = h('div', 'bm-modal', null, 'bm-confirm');
    R.confirm = put(R.layer, cf);
    var mbox = put(cf, h('div', 'modal-box'));
    put(mbox, h('div', 'modal-title', '确认重置存档？'));
    put(mbox, h('div', 'modal-text', '金币、天赋、工具进度都会归零。'));
    var macts = put(mbox, h('div', 'modal-actions'));
    R.confirmOk = put(macts, h('button', 'danger-btn', '确认重置', 'bm-confirm-ok'));
    R.confirmOk.setAttribute('type', 'button');
    R.confirmOk.addEventListener('click', function () {
      openConfirm(false);
      openSheet(R.settingsPanel, false);
      call('onResetSave');
      renderCamp();
    });
    R.confirmCancel = put(macts, h('button', 'ghost-btn', '取消', 'bm-confirm-cancel'));
    R.confirmCancel.setAttribute('type', 'button');
    R.confirmCancel.addEventListener('click', function () { openConfirm(false); });
  }

  function buildToast() {
    R.toastNode = put(R.layer, h('div', 'bm-toast', '', 'bm-toast'));
  }

  /* ---------------- v6：地心宝藏 → 游戏胜利覆盖层 ----------------
     铺满 390×844 的金色渐隐层，DOM 序排在 toast 之后 = 压在全部界面之上。
     三格统计复用 .stat-cell（与结算页一致），两个按钮复用 .primary-btn / .ghost-btn。 */

  var VICTORY_DASH = '\u2013';                          // 缺字段时的占位符（–）

  function buildVictory() {
    var v = put(R.layer, h('div', 'bm-victory', null, 'bm-victory'));
    R.victory = v;
    put(v, h('div', 'victory-title', '游戏胜利', 'bm-victory-title'));
    R.vicSub = put(v, h('div', 'victory-sub', '你挖到了地心宝藏', 'bm-victory-sub'));
    var stats = put(v, h('div', 'victory-stats', null, 'bm-victory-stats'));
    R.vicRounds = statCell(stats, '总局数', 'bm-victory-rounds');
    R.vicCoins = statCell(stats, '累计金币', 'bm-victory-coins');
    R.vicTime = statCell(stats, '用时', 'bm-victory-time');
    var acts = put(v, h('div', 'victory-actions'));
    R.vicNext = put(acts, h('button', 'primary-btn', '再挖一局', 'bm-btn-victory-next'));
    R.vicNext.setAttribute('type', 'button');
    R.vicNext.addEventListener('click', function () { hideVictory(); call('onNextRound'); });
    R.vicCamp = put(acts, h('button', 'ghost-btn', '回营地', 'bm-btn-victory-camp'));
    R.vicCamp.setAttribute('type', 'button');
    R.vicCamp.addEventListener('click', function () { hideVictory(); call('onBackToCamp'); });
  }

  function firstField(d, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = d[keys[i]];
      if (v === null || v === undefined || v === '') continue;
      return v;
    }
    return null;
  }

  function victoryTime(ms) {
    var s = Math.round(ms / 1000);
    if (!(s > 0)) s = 0;
    if (s < 60) return s + ' 秒';
    return Math.floor(s / 60) + ' 分 ' + (s % 60) + ' 秒';
  }

  /* data 的字段全都可以缺：缺哪个就把那一格留成 – ，绝不抛错。
       subtitle                                     副标题（默认「你挖到了地心宝藏」）
       rounds / roundsPlayed / totalRounds          总局数
       coins / coinsTotal / lifetimeCoins           累计金币（大数走 K/M/B 缩写，精确值在 title）
       timeText                                     自带用时文案（优先）
       timeMs / ms / durationMs                     用时（毫秒，格式化成「N 分 M 秒」） */
  function showVictory(data) {
    ensureBuilt();
    var d = (data && typeof data === 'object') ? data : {};

    var sub = firstField(d, ['subtitle', 'sub']);
    setText(R.vicSub, sub == null ? '你挖到了地心宝藏' : String(sub));

    var rounds = firstField(d, ['rounds', 'roundsPlayed', 'totalRounds']);
    setText(R.vicRounds, rounds == null ? VICTORY_DASH : fmtCoins(rounds));

    var coins = firstField(d, ['coins', 'coinsTotal', 'lifetimeCoins']);
    if (coins == null) {
      setText(R.vicCoins, VICTORY_DASH);
      R.vicCoins.title = '';
    } else if (typeof coins === 'string') {
      setText(R.vicCoins, coins);
      R.vicCoins.title = '';
    } else {
      setText(R.vicCoins, abbrCoins(coins));
      R.vicCoins.title = fmtCoins(coins);
    }

    var tText = firstField(d, ['timeText']);
    var msRaw = firstField(d, ['timeMs', 'ms', 'durationMs']);
    var ms = (typeof msRaw === 'number' && isFinite(msRaw)) ? msRaw : null;
    if (tText != null) setText(R.vicTime, String(tText));
    else setText(R.vicTime, ms === null ? VICTORY_DASH : victoryTime(ms));

    setCls(R.victory, 'show', true);
    return R.victory;
  }

  function hideVictory() {
    if (!R.victory) return false;
    setCls(R.victory, 'show', false);
    return true;
  }

  /* ---------------- 交互 ---------------- */

  function onMuteClick() {
    call('onToggleMute');
    syncMute();
  }

  function openDrawer(which) {
    setCls(R.talentsDrawer, 'is-open', which === 'talents');
  }

  function closeDrawers() {
    openDrawer(null);
    openSheet(R.settingsPanel, false);
    openConfirm(false);
  }

  function openSheet(node, on) {
    setCls(node, 'is-open', on);
  }

  function openConfirm(on) {
    setCls(R.confirm, 'is-open', on);
    if (on) playUi('ui');
  }

  function syncMute() {
    var m = uiMuted();
    setText(R.muteLbl, m ? '已静音' : '音效');
    setCls(R.muteBtn, 'off', m);
    setText(R.hudMuteLbl, m ? '静' : '音');
    setCls(R.hudMute, 'off', m);
    var key = m ? 'icons.sound_off' : 'icons.sound_on';
    swapIcon(R.muteIco, key);
    swapIcon(R.hudMuteIco, key);
  }

  /* 画质：main 负责真正切档与持久化，切完调 setQualityLabel 回写文案；
     若 handler 未回写则 UI 自行按 高→中→低 循环，绝不让按钮卡住 */
  function cycleQuality() {
    R.qualityCalled = false;
    call('onCycleQuality');
    if (R.qualityCalled) return;
    var i = indexOf(QUALITY_CYCLE, R.qualityText);
    setQualityLabel(QUALITY_CYCLE[(i + 1) % QUALITY_CYCLE.length]);
  }

  function setQualityLabel(text) {
    R.qualityCalled = true;
    var s = text == null ? '' : String(text);
    R.qualityText = s;
    setText(R.qualityLbl, s);
    setText(R.hudQualityLbl, s);
    setCls(R.qualityBtn, 'low', s === '低');
    setCls(R.hudQuality, 'low', s === '低');
  }

  function uiMuted() {
    if (R.muted !== null && R.muted !== undefined) return !!R.muted;
    return !!state().muted;
  }

  /* ---------------- 营地渲染 ---------------- */

  function renderCamp() {
    ensureBuilt();
    var st = state();
    R.muted = st.muted === true;
    var c = coinsNow();
    setText(R.coins, fmtCoins(c));
    setText(R.coinsAbbr, abbrCoins(c));

    var z = zoneOf(st.currentZone);
    setText(R.zoneName, z ? z.name : '未知矿区');
    setText(R.zoneTag, z ? (num(z.timeSec, 15) + ' 秒 / 局') : '');
    // v5：营地矿区卡头图 = 当前关缩略图（没有该关的图就保留原底色）
    if (z && R.zoneHead) paintBg(R.zoneHead, 'bg.thumb.' + z.id, { size: 'cover', repeat: 'no-repeat', pos: 'center' });

    var obj = nextObjective();
    if (obj) {
      var need = num(obj.need, 0);
      var have = Math.min(num(obj.have, 0), need);
      setText(R.objText, '下一目标 · ' + oreName(obj.ore) + ' ' + have + '/' + need);
      setWidth(R.objFill, need > 0 ? clamp01(have / need) * 100 : 0);
      setCls(R.objFill, 'done', !!obj.done);
    } else {
      setText(R.objText, '下一目标 · 已全部达成');
      setWidth(R.objFill, 100);
    }

    var nz = nextZoneOf(z);
    setText(R.zoneNext, nz ? ('下一关 · ' + nz.name) : '');
    setCls(R.zoneNext, 'show', !!nz);

    setCls(R.campClear, 'show', campCleared(z, obj));
    /* v6：宝箱挖开 → CORE.state.victory=true → 矿区卡右上角钉一枚「已通关」（与主线通关徽标互不影响） */
    setCls(R.campVictory, 'show', st.victory === true);

    var best = st.bestRound;
    var bestTxt = best && best.coins ? ('最佳 ' + abbrCoins(best.coins)) : '首次下矿';
    setText(R.startSub, (z ? z.name : '') + ' · ' + bestTxt);

    renderTools(st);
    renderTalents(st);
    renderRecommend();
    renderStats(st, obj);
    syncMute();
    var q = st.quality;
    if (typeof q === 'string' && q) setQualityLabel(q);
    paintIcons();
  }

  /* 主线通关：当前已是最后一关，且该关目标已达标 */
  function campCleared(z, obj) {
    if (!z || z.final !== true) return false;
    return !obj || obj.done === true;
  }

  function renderTools(st) {
    var list = toolList();
    var sig = '';
    for (var i = 0; i < list.length; i++) sig += list[i].id + '|';
    if (sig !== sigTools) {
      sigTools = sig;
      clearSlots('tools');
      clearNode(R.toolRow);
      R.toolNodes = [];
      for (var j = 0; j < list.length; j++) R.toolNodes.push(makeToolCard(list[j], R.toolRow));
    }
    var nodes = R.toolNodes || [];
    var unlocked = st.unlockedTools || [];
    for (var k = 0; k < nodes.length; k++) {
      var n = nodes[k];
      var tool = list[k];
      if (!tool) continue;
      var has = unlocked.length ? indexOf(unlocked, tool.id) >= 0 : (k === 0);
      setCls(n.node, 'locked', !has);
      setCls(n.node, 'selected', st.selectedTool === tool.id);
      setText(n.meta, toolMetaText(tool));
      setText(n.shape, toolShapeText(tool));
      setText(n.dmg, toolDmgText(tool));
      setText(n.lock, has ? '' : unlockHint(tool));
      if (n.node.setAttribute) {
        if (has) n.node.removeAttribute('disabled');
        else n.node.setAttribute('disabled', 'disabled');
      }
    }
  }

  /* 攻击方式：模式与节拍 */
  function toolMetaText(tool) {
    var detail = MODE_TEXT[tool.mode] || (tool.mode || '点按');
    if (tool.mode === 'hold' && num(tool.interval, 0) > 0) detail += ' ' + tool.interval + 's';
    return detail;
  }

  /* 攻击形状：七种 shape 的独立文案（缺键回落到 shape 原名，不渲染成空） */
  function toolShapeText(tool) {
    return SHAPE_TEXT[tool.shape] || (tool.shape ? String(tool.shape) : '单格');
  }

  function toolDmgText(tool) {
    return '伤害 ' + toolDamageOf(tool);
  }

  // 有效伤害 = 基础 + mods.damage（CORE 提供时用现算值，否则退回配置值）
  function toolDamageOf(tool) {
    var c = core();
    if (c && c.toolDamage) {
      try {
        var d = c.toolDamage(tool.id);
        if (typeof d === 'number' && isFinite(d)) return d;
      } catch (e) { /* 用配置值 */ }
    }
    return tool.dmg;
  }

  function unlockHint(tool) {
    var direct = tool.unlockText;
    if (typeof direct === 'string' && direct) return direct;
    var u = tool.unlock;
    if (typeof u === 'string' && u) return u;
    if (u && typeof u === 'object') {
      if (u.ore) return '累计采集 ' + oreName(u.ore) + ' ' + num(u.need, 0) + ' 解锁';
      if (u.zone) {
        var zz = zoneOf(u.zone);
        return '进入「' + (zz ? zz.name : u.zone) + '」解锁';
      }
      if (u.text) return String(u.text);
    }
    var cf = config();
    if (!cf || !cf.zones) return '未解锁';
    var i, r;
    /* v2：zones[].unlocks = [{ ore, need, tools: [...], zones: [...] }] */
    for (i = 0; i < cf.zones.length; i++) {
      var rules = cf.zones[i].unlocks || [];
      for (r = 0; r < rules.length; r++) {
        var rule = rules[r];
        if (!rule || !rule.tools || indexOf(rule.tools, tool.id) < 0) continue;
        if (rule.ore) return '累计采集 ' + oreName(rule.ore) + ' ' + num(rule.need, 0) + ' 解锁';
        return '完成「' + (cf.zones[i].name || '矿区') + '」目标解锁';
      }
    }
    /* v3：zones[].enterUnlocks —— 解锁矿区那一刻自动到手的工具（钻石镐） */
    for (i = 0; i < cf.zones.length; i++) {
      var enter = cf.zones[i].enterUnlocks || [];
      if (indexOf(enter, tool.id) >= 0) return '进入「' + (cf.zones[i].name || '矿区') + '」解锁';
    }
    for (i = 0; i < cf.zones.length; i++) {
      if (cf.zones[i].reward === 'tool:' + tool.id) return '完成「' + (cf.zones[i].name || '矿区') + '」目标解锁';
    }
    return '未解锁';
  }

  /* 工具图标键：没有专属图时回退到已有的武器图（新武器先落地、美术后补）；
     BM.ART 整体缺失或连回退图都没有 → 返回 null，卡片只留文字 */
  function toolIconKey(tool) {
    if (!tool || !BM.ART) return null;
    var own = 'icons.tool_' + tool.id;
    if (artHas(own)) return own;
    if (artHas('icons.tool_diamond')) return 'icons.tool_diamond';
    return null;
  }

  function makeToolCard(tool, parent) {
    var card = h('button', 'tool-card', null, 'bm-tool-' + tool.id);
    card.setAttribute('type', 'button');
    card.dataset.tool = tool.id;
    var head = put(card, h('div', 'tool-head'));
    var icoKey = toolIconKey(tool);
    if (icoKey) iconSlot(head, icoKey, 'tool-ico', 'tools');
    put(head, h('div', 'tool-name', tool.name));
    var meta = put(card, h('div', 'tool-meta', toolMetaText(tool)));
    var shape = put(card, h('div', 'tool-shape', toolShapeText(tool)));
    var dmg = put(card, h('div', 'tool-dmg', toolDmgText(tool)));
    put(card, h('div', 'tool-desc', tool.desc || ''));
    var lock = put(card, h('div', 'tool-lock', ''));
    card.addEventListener('click', function () {
      if (card.classList.contains('locked')) return;
      playUi('ui');
      call('onSelectTool', tool.id);
      renderCamp();
    });
    if (parent) parent.appendChild(card);
    return { node: card, lock: lock, meta: meta, shape: shape, dmg: dmg, tool: tool };
  }

  /* 推荐天赋：从 CORE 读最便宜且买得起的可购节点；一个都买不起时给出最便宜的可购节点 */
  function renderRecommend() {
    var list = treeAll();
    var best = null, bestCost = null;
    var cheap = null, cheapCost = null;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      // v16c：长尾节点（矿层加深 999 级）不进推荐，玩家自己决定要不要堆层数
      if ((it.maxLevel || 1) >= 50) continue;
      var stt = nodeStateOf(it);
      if (stt !== 'available' && stt !== 'poor') continue;
      var cost = nodeCostOf(it);
      if (cost == null) continue;
      if (!cheap || lessThan(cost, cheapCost)) { cheap = it; cheapCost = cost; }
      if (stt !== 'available') continue;
      if (!best || lessThan(cost, bestCost)) { best = it; bestCost = cost; }
    }
    var pick = best || cheap;
    if (!pick) {
      R.recId = '';
      R.recAfford = false;
      setText(R.recLabel, '推荐天赋');
      setText(R.recName, '暂无可购天赋');
      setText(R.recEffect, '先攒金币，或点开天赋树看前置');
      setText(R.recCost, '—');
      setCls(R.recCard, 'can-buy', false);
      setCls(R.recCard, 'maxed', true);
      return;
    }
    var costVal = best ? bestCost : cheapCost;
    R.recId = pick.id;
    R.recAfford = !!best;
    R.recGap = best ? 0 : gapOf(costVal);
    setText(R.recLabel, '推荐天赋');
    setText(R.recName, pick.name);
    setText(R.recEffect, pick.desc || '天赋效果提升');
    setText(R.recCost, fmtCoins(costVal) + ' 金币');
    setCls(R.recCard, 'can-buy', !!best);
    setCls(R.recCard, 'maxed', false);
  }

  function gapOf(cost) {
    try {
      var c = BigInt(String(cost)) - BigInt(String(coinsNow()));
      return c > 0n ? c : 0;
    } catch (e) {
      return 0;
    }
  }

  function renderStats(st, obj) {
    var need = obj ? num(obj.need, 0) : 0;
    var have = obj ? Math.min(num(obj.have, 0), need) : 0;
    setText(R.statMined, need > 0 ? (have + '/' + need) : '已达成');
    var best = st.bestRound;
    setText(R.statBest, best && best.coins ? abbrCoins(best.coins) : '—');
    var list = treeAll(), owned = 0;
    for (var i = 0; i < list.length; i++) if (nodeLevelOf(list[i].id) > 0) owned++;
    setText(R.statTalents, owned + '/' + list.length);    setText(R.statTalents, owned + '/' + list.length);
  }

  /* ---------------- 天赋树（自动布局 + 画布图标 + 点击购买） ----------------

     数据全在 CONFIG.tree（01-config 提供），UI 只做四件事：
     按 parent 链算深度 → 半径 / 角度（treeLayout）→ 画徽章 / SVG 连线 / 24×24 画布图标
     → 点徽章买一级（不可买时打开底部详情卡说明原因）。
     树在 .talent-stage 里被裁剪，.talent-map 用 transform 平移 + 缩放（初始 1:1，范围 0.45–1.6）。 */

  function makeSvgEl(tag) {
    if (D.createElementNS) {
      try { return D.createElementNS(SVGNS, tag); } catch (e) { /* 退回普通元素 */ }
    }
    return D.createElement(tag);
  }

  /* 一条连线的 path（v17 横平竖直）：先横后竖的 L 型折线。
     短连线直接 L 型；长连线（> LINK_LONG）两端各留 LINK_STUB 的实线头，中段给虚线豁口。 */
  function linkGeo(from, to) {
    var dx = to.x - from.x, dy = to.y - from.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    // 折点：横向走一半，然后竖向到终点（先横后竖的 L 型）
    var mx = Math.round(from.x + dx * 0.5), my = to.y;
    var line = 'M' + from.x + ' ' + from.y + ' L' + mx + ' ' + from.y + ' L' + mx + ' ' + my + ' L' + to.x + ' ' + to.y;
    if (!(len > LINK_LONG)) return { d: line, gap: null };
    // 长连线：横段留 stub，竖段留 stub，中间走虚线
    var hLen = Math.abs(dx * 0.5), vLen = Math.abs(dy);
    var stubH = Math.min(LINK_STUB, hLen * 0.4), stubV = Math.min(LINK_STUB, vLen * 0.4);
    var ax = Math.round(from.x + (dx > 0 ? stubH : -stubH)), ay = from.y;
    var bx = mx, by = Math.round(from.y + (dy > 0 ? stubV : -stubV));
    var cx = mx, cy = Math.round(to.y - (dy > 0 ? stubV : -stubV));
    var ex = Math.round(to.x - (dx > 0 ? stubH : -stubH)), ey = to.y;
    return {
      d: 'M' + from.x + ' ' + from.y + ' L' + ax + ' ' + ay +
         ' M' + cx + ' ' + cy + ' L' + mx + ' ' + my + ' L' + ex + ' ' + ey +
         ' M' + ex + ' ' + ey + ' L' + to.x + ' ' + to.y,
      gap: 'M' + ax + ' ' + ay + ' L' + mx + ' ' + by + ' M' + bx + ' ' + by + ' L' + cx + ' ' + cy
    };
  }

  function buildTalentTree() {
    var body = R.talentsBody;
    var cfg = treeCfg();
    clearNode(body);
    R.talentNodes = [];
    R.badgeById = {};
    R.talentLinks = [];
    R.talentGaps = [];
    R.treeMap = null;
    R.treeStage = null;
    R.detailCard = null;
    R.treeLayout = null;
    cancelLongPress();            // 重建徽章前掐掉上一次没触发的长按定时器

    if (!cfg) {
      put(body, h('div', 'talent-empty', '天赋树数据缺失（CONFIG.tree）'));
      return;
    }

    var lay = treeLayout(cfg);
    R.lay = lay;
    R.treeLayout = lay;

    put(body, h('div', 'talent-tips', TIPS_TEXT, 'bm-talents-tips'));
    var stage = put(body, h('div', 'talent-stage', null, 'bm-talents-stage'));
    R.treeStage = stage;
    var map = put(stage, h('div', 'talent-map', null, 'bm-talents-map'));
    map.style.width = lay.size + 'px';
    map.style.height = lay.size + 'px';
    R.treeMap = map;

    var svg = makeSvgEl('svg');
    svg.setAttribute('class', 'talent-links');
    svg.setAttribute('viewBox', '0 0 ' + lay.size + ' ' + lay.size);
    svg.setAttribute('width', String(lay.size));
    svg.setAttribute('height', String(lay.size));
    map.appendChild(svg);

    var i, j;
    /* 连线：一条 requires 一条线；前置不在这棵树里就不画（不画无名线）。
       跨度 > LINK_LONG 的连线两端各留一段实线头，中段交给 .talent-link-gap 的虚线：
       枝太长时连成一片就分不清哪根接到哪根了。 */
    for (i = 0; i < lay.list.length; i += 1) {
      var it = lay.list[i];
      for (j = 0; j < it.node.req.length; j += 1) {
        var from = lay.pos[it.node.req[j]];
        if (!from) continue;
        var geo = linkGeo(from, it);
        var path = makeSvgEl('path');
        path.setAttribute('d', geo.d);
        path.setAttribute('fill', 'none');
        path.setAttribute('class', 'talent-link locked');
        svg.appendChild(path);
        R.talentLinks.push({ node: path, from: it.node.req[j], to: it.id });
        if (geo.gap) {
          var hole = makeSvgEl('path');
          hole.setAttribute('d', geo.gap);
          hole.setAttribute('fill', 'none');
          hole.setAttribute('class', 'talent-link-gap locked');
          svg.appendChild(hole);
          R.talentGaps.push({ node: hole, to: it.id });
        }
      }
    }

    for (i = 0; i < lay.list.length; i += 1) {
      var badge = makeBadge(lay.list[i].node, lay.list[i]);
      map.appendChild(badge.node);
      R.talentNodes.push(badge);
      R.badgeById[badge.data.id] = badge;
    }

    var zoom = put(stage, h('div', 'talent-zoom', null, 'bm-talent-zoom'));
    R.zoomOut = put(zoom, h('button', 'talent-zoom-btn', '−', 'bm-talent-zoom-out'));
    R.zoomOut.setAttribute('type', 'button');
    R.zoomOut.addEventListener('click', function () { zoomTree(-ZOOM_STEP); });
    R.zoomIn = put(zoom, h('button', 'talent-zoom-btn', '+', 'bm-talent-zoom-in'));
    R.zoomIn.setAttribute('type', 'button');
    R.zoomIn.addEventListener('click', function () { zoomTree(ZOOM_STEP); });

    stage.addEventListener('pointerdown', onTreeDown);
    stage.addEventListener('pointermove', onTreeMove);
    stage.addEventListener('pointerup', onTreeUp);
    stage.addEventListener('pointercancel', onTreeUp);
    stage.addEventListener('wheel', onTreeWheel);

    var det = put(body, h('div', 'talent-detail', null, 'bm-talent-detail'));
    R.detailCard = det;
    var main = put(det, h('div', 'td-main'));
    R.dName = put(main, h('div', 'td-name', '点一个圆点', 'bm-td-name'));
    R.dDesc = put(main, h('div', 'td-desc', '拖动平移 · +/− 缩放 · 点徽章买一级', 'bm-td-desc'));
    var row = put(main, h('div', 'td-row'));
    R.dState = put(row, h('div', 'td-state', '', 'bm-td-state'));
    R.dCost = put(row, h('div', 'td-cost', '', 'bm-td-cost'));
    R.dBuy = put(det, h('button', 'td-buy primary-btn', '购买', 'bm-td-buy'));
    R.dBuy.setAttribute('type', 'button');
    R.dBuy.addEventListener('click', onDetailBuy);

    /* 地图比视口大得多（10 层 / 70+ 节点）：初始 1:1，只把中心徽章摆到视口正中。
       外圈靠拖动 / 缩放看 —— fit 整棵树会把 34px 的徽章压成 3px，等于什么都看不见。 */
    R.scale = INIT_SCALE;
    centerTree();
    renderDetail();
  }

  /* 圆圈上方那行说明：节点名的「基名」（去掉链上的 +N 编号），最多 CAP_MAX 个字符。
     70+ 个节点同屏时这行只当指路牌（「这是什么」），详细效果交给底部详情卡。 */
  function capLabelOf(n) {
    var s = String((n && n.name) || (n && n.id) || '');
    s = s.replace(/\s*\+[0-9]+\s*$/, '').trim();
    return s.length > CAP_MAX ? s.slice(0, CAP_MAX - 1) + '…' : s;
  }

  function setBox(el, w, h) {
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    return el;
  }

  /* 格子 = 三段（说明 / 圆形徽章 / 等级），整格都能点。几何只在这里算一次（行内 px）：
       格子 92×76 绝对定位，中心 = 原节点坐标；
       圆徽章 34px（中心 56px），宽高相等 + border-box（见 CSS）→ 正圆，border 撑不出椭圆；
       说明 top = 圆顶 − TEXT_GAP − TEXT_LH，等级 top = 圆底 + TEXT_GAP —— 都在圆外，不穿圈。
     中心徽章 56px 时上下两行各溢出 5px（格子 overflow:visible，字不会被裁）。 */
  function makeBadge(n, item) {
    var d = item.depth === 0 ? CENTER_D : NODE_D;
    var top = (CHIP_H - d) / 2;                    // 圆心在格子里恒为 (46, 38)
    var chip = h('button', 'talent-chip' + (item.depth === 0 ? ' center' : ''), null, 'bm-talent-' + n.id);
    chip.setAttribute('type', 'button');
    chip.dataset.node = n.id;
    chip.dataset.depth = String(item.depth);
    chip.dataset.angle = String(Math.round(item.angle * 10) / 10);
    setBox(chip, CHIP_W, CHIP_H);
    chip.style.left = (item.x - CHIP_W / 2) + 'px';
    chip.style.top = (item.y - CHIP_H / 2) + 'px';

    var cap = put(chip, h('span', 'talent-cap', capLabelOf(n)));
    setBox(cap, CHIP_W, TEXT_LH);
    cap.style.top = (top - TEXT_GAP - TEXT_LH) + 'px';

    var node = put(chip, h('span', 'talent-node'));
    node.dataset.node = n.id;
    setBox(node, d, d);                            // width == height：正圆的前提
    node.style.left = ((CHIP_W - d) / 2) + 'px';
    node.style.top = top + 'px';

    var kind = iconKindOf(n);
    var ico = put(node, h('span', 'talent-ico'));
    ico.setAttribute('data-icon', kind);
    var url = iconURL(kind);
    if (url) {
      ico.style.webkitMaskImage = 'url("' + url + '")';
      ico.style.maskImage = 'url("' + url + '")';
      if (ico.style.setProperty) {
        ico.style.setProperty('-webkit-mask-image', 'url("' + url + '")');
        ico.style.setProperty('mask-image', 'url("' + url + '")');
      }
      ico.classList.add('has-canvas');
    } else {
      ico.classList.add('no-canvas');       // canvas 不可用（极老环境）：退回一个圆点占位
      ico.textContent = '·';
    }
    var lv = put(chip, h('span', 'talent-lv', ''));
    setBox(lv, CHIP_W, TEXT_LH);
    lv.style.top = (top + d + TEXT_GAP) + 'px';

    /* 命中区 = 整个格子（三个子元素都 pointer-events:none）：点说明 / 点等级 / 点圆都是同一个节点。
       长按手势（TREE-V8 §7.4）：pointerdown 起 300ms 定时器 → 期间松手算单击（照常走 click 购买），
       定时器先到算长按（开详情卡 + 吞掉松手后那一次 click）；位移 > DRAG_PX 视为拖拽，两者都不触发。 */
    chip.addEventListener('click', function (e) { onBadgeClick(n, chip, e); });
    chip.addEventListener('pointerdown', function (e) { onBadgeDown(n, e); });
    chip.addEventListener('pointermove', onBadgeMove);
    chip.addEventListener('pointerup', function () { cancelLongPress(); onBadgeUp(); });
    chip.addEventListener('pointercancel', function () { cancelLongPress(); onBadgeUp(); });
    chip.addEventListener('pointerleave', function () { cancelLongPress(); onBadgeUp(); });
    chip.__circle = node;                          // pop 动画只作用在圆徽章上
    return {
      node: chip, circle: node, cap: cap, lv: lv, data: n, ico: ico, icon: kind,
      depth: item.depth, x: item.x, y: item.y,
      capTop: top - TEXT_GAP - TEXT_LH, lvTop: top + d + TEXT_GAP
    };
  }

  function badgeNodeOf(id) {
    var it = R.badgeById && R.badgeById[id];
    return it ? it.node : null;
  }

  /* 买下 1 级的视觉反馈：圆徽章弹一下（0.2s 缩放；传格子进来也认，动画落在圆上） */
  function popBadge(chip) {
    var el = (chip && chip.__circle) || chip;
    if (!el || !el.classList) return;
    el.classList.add('pop');
    if (R.popTimer) clearTimeout(R.popTimer);
    R.popTimer = setTimeout(function () {
      if (el && el.classList) el.classList.remove('pop');
    }, 220);
  }

  function openDetail(id) {
    R.detailId = id || '';
    renderDetail();
  }

  function setBuyEnabled(on) {
    if (!R.dBuy) return;
    setCls(R.dBuy, 'can-buy', !!on);
    if (on) {
      if (R.dBuy.removeAttribute) R.dBuy.removeAttribute('disabled');
      R.dBuy.disabled = false;
    } else {
      if (R.dBuy.setAttribute) R.dBuy.setAttribute('disabled', 'disabled');
      R.dBuy.disabled = true;
    }
  }

  /* 详情卡是唯一显示长文本的地方：名称 / 效果 / 价格 / 状态 / 购买按钮 */
  function renderDetail() {
    var card = R.detailCard;
    if (!card) return;
    var n = nodeData(treeCfg(), R.detailId);
    setCls(card, 'is-open', !!n);
    if (!n) {
      setText(R.dName, '点一个圆点');
      setText(R.dDesc, '拖动平移 · +/− 缩放 · 点徽章买一级');
      setText(R.dState, '');
      setText(R.dCost, '');
      setBuyEnabled(false);
      return;
    }
    var stt = nodeStateOf(n);
    /* 价格只在「还能买」时报：满级 / 已购给状态词，避免把静态快照当成下一级报价 */
    var cost = (stt === 'available' || stt === 'poor') ? nodeCostOf(n) : null;
    var lv = nodeLevelOf(n.id);
    var max = n.max > 0 ? n.max : 1;
    var st = stateTextOf(n);
    if (max > 1) st += ' · Lv ' + lv + '/' + max;
    setText(R.dName, n.name);
    setText(R.dDesc, n.desc || '—');
    setText(R.dState, st);
    setText(R.dCost, cost != null ? (fmtCoins(cost) + ' 金币') : (stt === 'maxed' ? '已满级' : (stt === 'owned' ? '已购' : '—')));
    setBuyEnabled(stt === 'available');
  }

  /* 唯一购买入口：可买才回调 onBuyNode（09-main 转发给 CORE.buyNode），然后全量刷新 */
  function buyNodeNow(id, el) {
    var n = nodeData(treeCfg(), id);
    if (!n) return false;
    if (nodeStateOf(n) !== 'available') {
      renderDetail();
      return false;
    }
    call('onBuyNode', id);
    // v17：长尾节点连续升级用柔和的 upgradeTick（低频木质「哒」，音高微升），普通节点仍用买音
    if ((n.maxLevel || 1) >= 50) {
      R.rapidStreak = (R.rapidStreak || 0) + 1;
      if (BM.AUDIO && BM.AUDIO.play) { try { BM.AUDIO.play('upgradeTick', { streak: R.rapidStreak }); } catch (e) { /* 忽略 */ } }
    }
    popBadge(el || badgeNodeOf(id));
    renderCamp();          // 等级 / 价格 / 连线三态全部由 CORE 现算
    return true;
  }

  /* 点徽章：可买 → 直接买一级；不可买 → 开详情卡说明原因（金币不足 / 缺前置 / 关未开 / 已满级） */
  function onBadgeClick(n, el, e) {
    if (e && e.stopPropagation) e.stopPropagation();
    var t = nowMs();
    if (R.suppressClick) {
      R.suppressClick = false;
      if (t - (R.suppressAt || 0) < 500) return;   // 拖动松手后的那一次 click：不买、不开卡
    }
    playUi('ui');
    openDetail(n.id);
    if (nodeStateOf(n) === 'available') buyNodeNow(n.id, el);
  }

  function onDetailBuy() {
    var n = nodeData(treeCfg(), R.detailId);
    if (!n) return;
    var stt = nodeStateOf(n);
    if (stt === 'available') {
      playUi('ui');
      buyNodeNow(n.id, badgeNodeOf(n.id));
      return;
    }
    playUi('ui');
    if (stt === 'poor') toast('金币不足，还差 ' + fmtCoins(gapOf(nodeCostOf(n))));
    else if (stt === 'zonelocked') {
      var zc2 = zoneOf(nodeZoneOf(n));
      toast((zc2 ? zc2.name : '当前矿区') + ' 还没开');
    }
    else if (stt === 'locked') toast('缺前置 ' + missingNames(n).join(' + '));
    else toast(stateTextOf(n));
  }

  function nowMs() {
    return (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;
  }

  /* 长按 = 打开详情卡，不改等级：定时器挂在徽章 pointerdown 上，300ms 内松手就取消
     （那次 click 照常购买）；定时器先到则开卡并把 suppressClick 置上，onBadgeClick 吞掉那一次 click。 */
  function cancelLongPress() {
    if (R.rapidTimer) { clearInterval(R.rapidTimer); R.rapidTimer = 0; }
    if (!R.pressTimer) return;
    clearTimeout(R.pressTimer);
    R.pressTimer = 0;
  }

  function onBadgeDown(n, e) {
    cancelLongPress();
    // v17：长尾节点（矿层加深 999 级）按住 = 连续购买，不弹详情
    if ((n.maxLevel || 1) >= 50) {
      R.pressId = n.id;
      buyNodeNow(n.id, badgeNodeOf(n.id));
      R.rapidTimer = setInterval(function () {
        if (R.pressId !== n.id) { clearInterval(R.rapidTimer); R.rapidTimer = 0; return; }
        var el = badgeNodeOf(n.id);
        if (!buyNodeNow(n.id, el)) { clearInterval(R.rapidTimer); R.rapidTimer = 0; }
      }, 110);
      return;
    }
    R.pressId = n.id;
    R.pressX = num(e && e.clientX, 0);
    R.pressY = num(e && e.clientY, 0);
    R.pressTimer = setTimeout(function () {
      R.pressTimer = 0;
      if (R.pressId !== n.id) return;
      R.pressId = '';
      R.suppressClick = true;        // 松手时那一次 click：不买
      R.suppressAt = nowMs();
      playUi('ui');
      openDetail(n.id);              // 只开卡，不做购买
    }, LONG_PRESS_MS);
  }

  // 长按期间位移 > 6px：算拖拽，长按不触发（松手后的 click 由 onTreeUp 的 suppressClick 吞掉）
  function onBadgeUp() { R.pressId = ''; R.rapidStreak = 0; if (R.rapidTimer) { clearInterval(R.rapidTimer); R.rapidTimer = 0; } }

  function onBadgeMove(e) {
    if (!R.pressTimer) return;
    var dx = num(e && e.clientX, 0) - R.pressX;
    var dy = num(e && e.clientY, 0) - R.pressY;
    if (dx < DRAG_PX && dx > -DRAG_PX && dy < DRAG_PX && dy > -DRAG_PX) return;
    cancelLongPress();
  }

  /* 拖动平移：pointerdown 记起点 → 超过 6px 才算拖拽 → pointerup 记下「吞掉下一次 click」

     不在这里 preventDefault / setPointerCapture：
     两者都会掐断徽章的 click（前者抑制兼容鼠标事件，后者把 pointerup 重定向到视口），
     用户反馈「天赋树点不进去」就是这条链路断的。只有真的拖起来才捕获指针。 */
  function treeExtent() {
    var e = (R.lay && R.lay.size) ? R.lay.size : Math.min(TREE_STAGE_W, TREE_STAGE_H);
    return e > 0 ? e : Math.min(TREE_STAGE_W, TREE_STAGE_H);
  }

  /* 居中：extent×scale 是缩放后的正方形边长，摆到视口正中即可。
     围绕中心缩放 → 加减号 / 滚轮换挡后中心徽章不动（要求 2）。 */
  function centerTree() {
    var ext = treeExtent();
    R.panX = Math.round((TREE_STAGE_W - ext * R.scale) / 2);
    R.panY = Math.round((TREE_STAGE_H - ext * R.scale) / 2);
    syncTreeTransform();
  }
  /* transform-origin: 0 0（style.css）→ translate 就是视口像素：
     拖动 1:1、缩放只改变边长（要求 3）。 */
  function syncTreeTransform() {
    if (!R.treeMap) return;
    R.treeMap.style.transform = 'translate(' + Math.round(R.panX) + 'px, ' + Math.round(R.panY) +
      'px) scale(' + R.scale.toFixed(2) + ')';
    /* 缩到 LV_HIDE_SCALE 以下：只留圆点。这时徽章只有 20px 出头，
       反向放大的小字比节点本身还宽，反而看不出哪里有节点。 */
    setCls(R.treeMap, 'far', R.scale < LV_HIDE_SCALE - 1e-9);
    syncLvFont();
  }
  /* Lv 小字按 1/scale 反向放大：视觉字号 = --lv-fs × scale ≥ 9px（要求 4）。
     向上取整到 0.01，缩放越大字越小，视觉尺寸恒定在 9px 这条线上。 */
  function syncLvFont() {
    var st = R.treeMap && R.treeMap.style;
    if (!st || !st.setProperty) return;
    var s = R.scale > 0 ? R.scale : 1;
    var fs = LV_FS_MIN / s;
    if (fs < LV_FS_BASE) fs = LV_FS_BASE;
    st.setProperty('--lv-fs', (Math.ceil(fs * 100) / 100) + 'px');
  }

  function zoomTree(delta) {
    var s = Math.round((R.scale + delta) * 100) / 100;
    if (s < ZOOM_MIN) s = ZOOM_MIN;
    if (s > ZOOM_MAX) s = ZOOM_MAX;
    R.scale = s;
    centerTree();
  }

  function onTreeDown(e) {
    R.dragOn = true;
    R.dragMoved = false;
    R.suppressClick = false;      // 新手势开始：上一次拖动留下的「吞点击」标记最多只活一次
    R.dragX = num(e && e.clientX, 0);
    R.dragY = num(e && e.clientY, 0);
    R.dragPanX = R.panX;
    R.dragPanY = R.panY;
  }

  function onTreeMove(e) {
    if (!R.dragOn) return;
    var dx = num(e && e.clientX, 0) - R.dragX;
    var dy = num(e && e.clientY, 0) - R.dragY;
    if (!R.dragMoved) {
      if (dx < DRAG_PX && dx > -DRAG_PX && dy < DRAG_PX && dy > -DRAG_PX) return;
      R.dragMoved = true;
      var st = R.treeStage;
      if (st && st.setPointerCapture && e && e.pointerId != null) {
        try { st.setPointerCapture(e.pointerId); } catch (err) { /* 不支持就算了 */ }
      }
    }
    R.panX = R.dragPanX + dx;
    R.panY = R.dragPanY + dy;
    syncTreeTransform();
    if (e && e.preventDefault) e.preventDefault();
  }

  function onTreeUp(e) {
    var moved = !!R.dragMoved;
    R.dragOn = false;
    R.dragMoved = false;
    var st = R.treeStage;
    if (moved && st && st.releasePointerCapture && e && e.pointerId != null) {
      try { st.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    }
    if (moved) {
      R.suppressClick = true;
      R.suppressAt = nowMs();
    }
  }

  function onTreeWheel(e) {
    var d = num(e && e.deltaY, 0);
    if (!d) return;
    zoomTree(d > 0 ? -ZOOM_STEP : ZOOM_STEP);
    if (e && e.preventDefault) e.preventDefault();
  }

  function treeSig(cfg) {
    var s = cfg ? ('C:' + (cfg.center && cfg.center.id)) : 'none';
    var lanes = laneList(cfg), i;
    for (i = 0; i < lanes.length; i++) s += '|' + lanes[i].id + ':' + lanes[i].angle + ':' + lanes[i].short;
    var list = treeNodes(cfg);
    for (i = 0; i < list.length; i++) {
      s += '>' + list[i].id + ':' + list[i].ring + ':' + list[i].lane + ':' + list[i].req.join(',') + ':' + list[i].max;
    }
    return s;
  }

  function renderTalents(st) {
    var cfg = treeCfg();
    var sig = treeSig(cfg);
    if (sig !== sigTalents) {
      sigTalents = sig;
      buildTalentTree();
    }
    var items = R.talentNodes || [], i;
    var states = {}, lvText = {};
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      var d = it.data;
      var stt = nodeStateOf(d);
      var cost = nodeCostOf(d);
      var lv = nodeLevelOf(d.id);
      var max = d.max > 0 ? d.max : 1;
      states[d.id] = stt;
      setCls(it.node, 'owned', stt === 'owned' || stt === 'maxed');
      setCls(it.node, 'maxed', stt === 'maxed');
      setCls(it.node, 'available', stt === 'available');
      setCls(it.node, 'poor', stt === 'poor');
      setCls(it.node, 'locked', stt === 'locked');
      setCls(it.node, 'zonelocked', stt === 'zonelocked');
      setCls(it.node, 'leveled', lv > 0 && lv < max);
      it.node.dataset.level = String(lv);
      /* 圆圈下方那行只给「解锁了」的节点：多级 = Lv x/N，单级 = 这级的价格。
         70+ 个徽章同屏时，未解锁节点的价格纯属噪声（详情卡里照样看得到）。 */
      var unlocked = stt === 'available' || stt === 'poor' || stt === 'owned' || stt === 'maxed';
      if (!unlocked) lvText[d.id] = '';
      else if (max > 1) lvText[d.id] = 'Lv ' + lv + '/' + max;
      else lvText[d.id] = (cost != null && (stt === 'available' || stt === 'poor')) ? abbrCoins(cost) : '';
      setText(it.lv, lvText[d.id]);
      setCls(it.lv, 'is-lv', max > 1);
      it.node.title = d.name + ' · ' + stateTextOf(d);
    }
    /* 相邻两个节点圆心只差 54px（同一条链）/ 40px 量级（同一环），中缝塞不下两行 11px 字。
       说明行让位：只要它和任何一行「等级 / 价格」的包围盒相交，就收起这行说明 ——
       同一条链上的说明本来一模一样（「攻击」×10），收起重复的那行比两行叠字可读得多；
       价格 / 等级是每帧都会变的信息，永远不收起。 */
    var lvBoxes = [], j;
    for (i = 0; i < items.length; i++) {
      if (!lvText[items[i].data.id]) continue;
      lvBoxes.push({
        x: items[i].x,
        y: items[i].y - CHIP_H / 2 + items[i].lvTop + TEXT_LH / 2
      });
    }
    for (i = 0; i < items.length; i++) {
      var it2 = items[i];
      var capY = it2.y - CHIP_H / 2 + it2.capTop + TEXT_LH / 2;
      var hide = false;
      for (j = 0; j < lvBoxes.length && !hide; j++) {
        if (Math.abs(lvBoxes[j].x - it2.x) < (TEXT_MAX_W + LV_MAX_W) / 2 &&
            Math.abs(lvBoxes[j].y - capY) < TEXT_LH) hide = true;
      }
      setCls(it2.cap, 'is-hidden', hide);
    }
    var links = R.talentLinks || [];
    for (i = 0; i < links.length; i++) {
      var lk = links[i];
      var s = states[lk.to] || 'locked';
      var cls = (s === 'owned' || s === 'maxed') ? 'owned' : ((s === 'available' || s === 'poor') ? 'available' : 'locked');
      lk.node.setAttribute('class', 'talent-link ' + cls);
    }
    var gaps = R.talentGaps || [];
    for (i = 0; i < gaps.length; i += 1) {
      var gs = states[gaps[i].to] || 'locked';
      var gc = (gs === 'owned' || gs === 'maxed') ? 'owned' : ((gs === 'available' || gs === 'poor') ? 'available' : 'locked');
      gaps[i].node.setAttribute('class', 'talent-link-gap ' + gc);
    }
    renderDetail();
  }

  /* ---------------- HUD ---------------- */

  /* 当前关存在的矿种：读 zone.ores，顺序按 ORE_ORDER 归一 */
  function zoneOreIds() {
    var cf = config();
    var ores = cf && cf.ores ? cf.ores : null;
    var z = zoneOf(state().currentZone);
    var src = (z && z.ores && z.ores.length) ? z.ores : null;
    var out = [];
    var i, k, id;
    function known(v) { return v && (!ores || ores[v]); }
    if (src) {
      for (i = 0; i < ORE_ORDER.length; i++) {
        for (k = 0; k < src.length; k++) if (zoneOreIdOf(src[k]) === ORE_ORDER[i] && known(ORE_ORDER[i])) out.push(ORE_ORDER[i]);
      }
      for (k = 0; k < src.length; k++) {
        id = zoneOreIdOf(src[k]);
        if (known(id) && indexOf(out, id) < 0) out.push(id);
      }
      return out;
    }
    /* 老 Config 没有 zone.ores 时退回全表 */
    if (ores) {
      for (i = 0; i < ORE_ORDER.length; i++) if (ores[ORE_ORDER[i]]) out.push(ORE_ORDER[i]);
      for (var key in ores) {
        if (!Object.prototype.hasOwnProperty.call(ores, key)) continue;
        if (indexOf(out, key) < 0) out.push(key);
      }
    }
    return out;
  }

  function zoneOreIdOf(entry) {
    if (!entry) return '';
    if (typeof entry === 'string') return entry;
    return entry.ore || entry.id || '';
  }

  function syncOreChips() {
    var cf = config();
    var ores = cf && cf.ores ? cf.ores : null;
    var order = zoneOreIds();
    var sig = zoneOf(state().currentZone) ? (state().currentZone + ':' + order.join('|')) : order.join('|');
    if (sig === sigOres) return;
    sigOres = sig;
    clearSlots('ores');
    clearNode(R.hudOres);
    R.oreChips = [];
    for (var n = 0; n < order.length; n++) {
      var id = order[n];
      var o = ores[id] || {};
      var chip = put(R.hudOres, h('div', 'ore-chip'));
      chip.dataset.ore = id;
      // 金矿没有独立美术：槽位键挂煤矿图标（data-art 仍指向真实存在的资产），src 用金色化副本
      iconSlot(chip, id === GOLD_ORE ? GOLD_ICON_SRC : 'icons.ore_' + id, 'ore-ico', 'ores', id === GOLD_ORE ? goldIconURL : null);
      var block = put(chip, h('span', 'ore-block'));
      block.style.background = o.color || '#7d7d7d';
      if (o.edge) block.style.borderColor = o.edge;
      var speck = put(block, h('span', 'ore-speck'));
      speck.style.background = o.vein || '#5a5a5a';
      put(chip, h('span', 'ore-name', oreName(id)));
      var cnt = put(chip, h('span', 'ore-count', '0', 'bm-count-' + id));
      R.oreChips.push({ ore: id, node: cnt, chip: chip, v: -1 });
    }
  }

  function updateHUD(tick) {
    if (!R.hud || !tick) return;
    syncOreChips();
    paintIcons();

    var tl = tick.timeLeft;
    if (typeof tl === 'number') {
      var secs = tl > 0 ? Math.ceil(tl) : 0;
      if (R.__secs !== secs) {
        R.__secs = secs;
        setText(R.hudTime, secs + 's');
        setCls(R.hudTime, 'urgent', secs <= 5);
        setCls(R.hud, 'urgent', secs <= 5);
      }
    }

    var coins = tick.coins == null ? coinsNow() : tick.coins;
    if (R.__coinsKey !== coins) {
      R.__coinsKey = coins;
      setText(R.hudCoins, abbrCoins(coins));
        try { R.hudCoins.title = fmtCoins(coins); } catch (e) { /* 忽略 */ }
    }

    var chips = R.oreChips;
    if (chips && tick.counts) {
      for (var i = 0; i < chips.length; i++) {
        var it = chips[i];
        var v = tick.counts[it.ore];
        v = typeof v === 'number' ? v : 0;
        if (it.v !== v) {
          it.v = v;
          setNum(it.node, v);
        }
      }
    }

    var combo = tick.combo;
    if (typeof combo === 'object' && combo) combo = combo.combo;
    if (typeof combo === 'number') {
      setWidth(R.comboFill, clamp01(combo / COMBO_FULL) * 100);
      setCls(R.comboFill, 'hot', combo > 0);
    }

    var fz = tick.frenzy;
    var left = 0;
    if (typeof fz === 'number') left = fz;
    else if (fz && typeof fz === 'object') left = num(fz.left != null ? fz.left : (fz.seconds != null ? fz.seconds : fz.t), 0);
    var active = left > 0;
    setCls(R.frenzyRow, 'active', active);
    if (active) setWidth(R.frenzyFill, clamp01(left / (R.frenzyMax || left || 1)) * 100);

    if (tick.tool) {
      var t = toolById(tick.tool);
      setText(R.toolName, t ? t.name : String(tick.tool));
    }
  }

  function setCombo(combo, mult) {
    if (!R.hud) return;
    var c = typeof combo === 'number' ? combo : 0;
    setWidth(R.comboFill, clamp01(c / COMBO_FULL) * 100);
    setCls(R.comboFill, 'hot', c > 0);
    if (typeof mult === 'number') {
      R.comboMult = mult;
      setText(R.comboMultNode, '×' + (mult % 1 === 0 ? mult : mult.toFixed(1)));
      setCls(R.comboMultNode, 'bump', true);
      clearTimeout(R.bumpTimer);
      R.bumpTimer = setTimeout(function () { setCls(R.comboMultNode, 'bump', false); }, 120);
    }
  }

  function pulseOre(ore) {
    var chips = R.oreChips;
    if (!chips || !ore) return;
    for (var i = 0; i < chips.length; i++) {
      if (chips[i].ore !== ore) continue;
      var it = chips[i];
      if (it.pulse) return;
      it.pulse = true;
      it.chip.classList.add('pop');
      clearTimeout(it.timer);
      it.timer = setTimeout(function () {
        it.chip.classList.remove('pop');
        it.pulse = false;
      }, 150);
      return;
    }
  }

  /* ---------------- 结算 ---------------- */

  function renderResult(result) {
    ensureBuilt();
    if (!result) return;
    showScreen('result');
    var z = zoneOf(result.zoneId);
    setText(R.resZone, z ? z.name : '');

    clearNode(R.resLines);
    clearSlots('res');
    var lines = result.lines || [];
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i] || {};
      var row = put(R.resLines, h('div', 'res-line'));
      row.dataset.ore = ln.ore || '';
      iconSlot(row, ln.ore === GOLD_ORE ? GOLD_ICON_SRC : 'icons.ore_' + ln.ore, 'res-ico', 'res', ln.ore === GOLD_ORE ? goldIconURL : null);
      put(row, h('span', 'res-ore', (ln.name || oreName(ln.ore)) + ' ×' + num(ln.count, 0)));
      put(row, h('span', 'res-calc', num(ln.price, 0) + ' × ' + num(ln.count, 0)));
      put(row, h('span', 'res-sub', '+' + (ln.subtotal == null ? '0' : ln.subtotal)));
    }
    if (!lines.length) put(R.resLines, h('div', 'res-empty', '本局没有收获'));

    setText(R.resTotalAbbr, result.coinsTotalAbbr ? ('累计 ' + result.coinsTotalAbbr) : '');

    var stats = result.stats || {};
    setText(R.statBroken, String(num(stats.brokenBlocks, 0)));
    setText(R.statCombo, String(num(stats.maxCombo, 0)));
    setText(R.statBoom, String(num(stats.explosions, 0)));

    /* 最后一关达标（objective.done 且没有下一关）：用通关大字替换解锁条 */
    var cleared = !!(result.objective && result.objective.done === true && result.nextZoneId === null);
    setCls(R.resClear, 'show', cleared);
    if (cleared) setText(R.resClearSub, zoneCountText());

    /* 下一关：nextZoneId 优先，缺字段时回落到 zones[].nextZone，一律查表取关名 */
    var ahead = result.nextZoneId ? zoneById(result.nextZoneId) : null;
    var curZone = zoneById(result.zoneId);
    if (!ahead && curZone) ahead = nextZoneOf(curZone);
    var aheadText = (!cleared && ahead) ? ('下一关 · ' + ahead.name) : '';
    setText(R.resNext, aheadText);
    setCls(R.resNext, 'show', !!aheadText);

    if (cleared) {
      setText(R.resUnlock, '');
      setCls(R.resUnlock, 'show', false);
    } else {
      setText(R.resUnlock, unlockText(result.unlocked));
      setCls(R.resUnlock, 'show', R.resUnlock.__t ? true : false);
    }

    startRoll(result.coinsEarned == null ? 0 : result.coinsEarned);
    if (cleared) playUi('unlock');
    else playUi(result.coinsEarned && coinsPositive(result.coinsEarned) ? 'coin' : 'ui');
    paintIcons();
  }

  function coinsPositive(v) {
    try {
      return BigInt(String(v)) > 0;
    } catch (e) {
      return parseFloat(v) > 0;
    }
  }

  function unlockText(list) {
    if (!list || !list.length) return '';
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var id = list[i];
      var s = String(id);
      if (s.indexOf('tool:') === 0) {
        var t = toolById(s.slice(5));
        s = '新工具 · ' + (t ? t.name : s.slice(5));
      } else if (s.indexOf('zone:') === 0) {
        var z = zoneOf(s.slice(5));
        s = '新矿区 · ' + (z ? z.name : s.slice(5));
      } else {
        s = '解锁 · ' + s;
      }
      out.push(s);
    }
    return out.join('   ');
  }

  function startRoll(target) {
    stopRoll();
    R.rolling = true;
    R.rollTarget = target;
    var raf = W.requestAnimationFrame;
    if (!raf) {
      skipRoll();
      return;
    }
    var t0 = -1;
    var step = function (ts) {
      if (!R.rolling) return;
      var now = typeof ts === 'number' ? ts : 0;
      if (t0 < 0) t0 = now;
      var p = (now - t0) / 820;
      if (p >= 1) {
        skipRoll();
        return;
      }
      var e = 1 - Math.pow(1 - p, 3);
      setText(R.resTotal, groupNum(rollPart(target, e)));
      R.rollRaf = raf(step);
    };
    R.rollRaf = raf(step);
  }

  function rollPart(target, e) {
    try {
      var b = BigInt(String(target));
      if (b <= 0) return 0;
      var n = Number(b);
      if (!isFinite(n)) return target;
      return Math.floor(n * e);
    } catch (err) {
      var f = parseFloat(target);
      return isFinite(f) ? Math.max(0, Math.floor(f * e)) : 0;
    }
  }

  function skipRoll() {
    R.rolling = false;
    stopRoll();
    setText(R.resTotal, fmtCoins(R.rollTarget));
  }

  function stopRoll() {
    if (R.rollRaf && W.cancelAnimationFrame) {
      try { W.cancelAnimationFrame(R.rollRaf); } catch (e) { /* 忽略 */ }
    }
    R.rollRaf = 0;
  }

  /* ---------------- 对外 API ---------------- */

  function showScreen(name) {
    ensureBuilt();
    hideVictory();                                      // 切屏即收起胜利层（它只能由 showVictory 打开）
    var n = name || 'camp';
    R.screen = n;
    setCls(R.camp, 'is-active', n === 'camp');
    setCls(R.hud, 'is-active', n === 'mine');
    setCls(R.resScreen, 'is-active', n === 'result');
    setCls(R.layer, 'is-camp', n === 'camp');
    setCls(R.layer, 'is-mine', n === 'mine');
    setCls(R.layer, 'is-result', n === 'result');
    if (n !== 'camp') closeDrawers();
    if (n === 'camp') renderCamp();
    if (n === 'mine') resetHud();
    paintIcons();
  }

  function resetHud() {
    R.__secs = -1;
    R.__coinsKey = null;
    R.frenzyMax = 0;
    setCls(R.hud, 'urgent', false);
    setCls(R.frenzyRow, 'active', false);
    setWidth(R.comboFill, 0);
    setWidth(R.frenzyFill, 0);
    var chips = R.oreChips;
    if (chips) for (var i = 0; i < chips.length; i++) { chips[i].v = -1; setNum(chips[i].node, 0); }
    setText(R.comboMultNode, '×1');
  }

  function toast(text) {
    ensureBuilt();
    if (!R.toastNode || !text) return;
    setText(R.toastNode, String(text));
    R.toastNode.classList.add('show');
    clearTimeout(R.toastTimer);
    R.toastTimer = setTimeout(function () {
      if (R.toastNode) R.toastNode.classList.remove('show');
    }, 1600);
  }

  function setMutedUi(v) {
    R.muted = !!v;
    syncMute();
  }

  function bindBus() {
    if (busBound) return;
    var bus = BM.bus;
    if (!bus || !bus.on) return;
    busBound = true;
    bus.on('round:tick', function (d) { updateHUD(d); });
    bus.on('round:start', function (d) {
      resetHud();
      if (d && typeof d.seconds === 'number') setText(R.hudTime, Math.ceil(d.seconds) + 's');
      if (d && d.tool) {
        var t = toolById(d.tool);
        if (t) setText(R.toolName, t.name);
      }
    });
    bus.on('combo:update', function (d) { if (d) setCombo(d.combo, d.mult); });
    bus.on('frenzy:start', function (d) {
      R.frenzyMax = num(d && d.seconds, 3);
      setCls(R.frenzyRow, 'active', true);
      setWidth(R.frenzyFill, 100);
    });
    bus.on('frenzy:end', function () {
      R.frenzyMax = 0;
      setCls(R.frenzyRow, 'active', false);
    });
    bus.on('drop:absorb', function (d) { if (d) pulseOre(d.ore); });
    bus.on('ui:toast', function (d) { if (d && d.text) toast(d.text); });
  }

  function init(root, handlers) {
    H = handlers || {};
    if (built) return true;
    R.host = root || D.body || D.documentElement;
    if (!R.host) return false;
    ensureBuilt();
    if (W.addEventListener) W.addEventListener('resize', measure);
    measure();
    bindBus();
    showScreen('camp');
    kickIcons();
    return true;
  }

  BM.UI = {
    init: init,
    showScreen: showScreen,
    renderCamp: renderCamp,
    renderResult: renderResult,
    showVictory: showVictory,
    hideVictory: hideVictory,
    updateHUD: updateHUD,
    toast: toast,
    setMuted: setMutedUi,
    setQualityLabel: setQualityLabel,
    cycleQuality: cycleQuality,
    /* 供 09-main 与冒烟测试只读诊断 */
    refs: R,
    /* 程序化图标与自动布局的只读诊断口（测试用；UI 自己不用） */
    iconKinds: ICON_KINDS,
    iconMask: iconMask,
    iconUrl: iconURL,
    oreIconURL: oreIconURL,
    _goldRamp: goldRamp,
    _goldIconURL: goldIconURL,
    layout: function () { return treeLayout(treeCfg()); }
  };
})();
