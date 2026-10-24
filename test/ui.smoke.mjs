// test/ui.smoke.mjs — 迷你 DOM stub 上跑真实的 07-audio.js / 08-ui.js（v7：放射状天赋树 / 单一购买 API / 强化面板已删）
// 说明：01-config 与 02-core 由别的模块负责，这里用 CONTRACT-V2 形状的假对象替代；
//       BM.bus 不注入，因此总线订阅分支被跳过（07/08 都有 bus 缺失保护）。
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/* ---------------- 迷你 DOM ---------------- */

/* ---- 极简几何模型：getBoundingClientRect ----
   只实现「绝对定位 + 行内 px 尺寸」这一子集：08-ui 把 .talent-chip / .talent-node /
   .talent-cap / .talent-lv 的 left/top/width/height 全写成行内样式，所以这里累加出来的就是
   浏览器会拿到的那几个盒子（坐标原点 = .talent-map 左上，也就是地图坐标）。
   这样「徽章是正圆 / 说明在圆上方 / 等级在圆下方 / 两两不压线」都能用 getBoundingClientRect 真算。 */
const MAP_CLASS = 'talent-map';
function pxOfStyle(v) {
  const n = Number(String(v == null ? '' : v).replace('px', ''));
  return Number.isFinite(n) ? n : 0;
}
function rectOf(el) {
  let left = 0;
  let top = 0;
  let n = el;
  while (n) {
    left += pxOfStyle(n.style && n.style.left);
    top += pxOfStyle(n.style && n.style.top);
    if (n.className && String(n.className).split(' ').indexOf(MAP_CLASS) >= 0) break;
    n = n.parentNode;
  }
  const w = pxOfStyle(el.style && el.style.width);
  const h = pxOfStyle(el.style && el.style.height);
  return { left, top, width: w, height: h, right: left + w, bottom: top + h };
}

const byId = new Map();

function makeEl(tag) {
  const classes = new Set();
  const children = [];
  const attrs = Object.create(null);
  let id = '';
  let text = null;

  const el = {
    tagName: String(tag).toUpperCase(),
    children,
    childNodes: children,
    parentNode: null,
    dataset: {},
    // setProperty 记下来：08-ui 往 .talent-map 上写 --lv-fs（Lv 小字的反向缩放字号）
    style: { __props: Object.create(null), setProperty(k, v) { el.style.__props[k] = String(v); } },
    disabled: false,
    __listeners: Object.create(null),
    appendChild(child) { children.push(child); child.parentNode = el; return child; },
    removeChild(child) {
      const i = children.indexOf(child);
      if (i >= 0) children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    insertBefore(child, ref) {
      const i = children.indexOf(ref);
      if (i < 0) return el.appendChild(child);
      children.splice(i, 0, child);
      child.parentNode = el;
      return child;
    },
    setAttribute(name, value) {
      attrs[name] = String(value);
      if (name === 'disabled') el.disabled = true;
    },
    getAttribute(name) { return name in attrs ? attrs[name] : null; },
    removeAttribute(name) { delete attrs[name]; if (name === 'disabled') el.disabled = false; },
    addEventListener(type, fn) { (el.__listeners[type] || (el.__listeners[type] = [])).push(fn); },
    removeEventListener(type, fn) {
      const arr = el.__listeners[type];
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    getBoundingClientRect() { return rectOf(el); },
    /* Canvas 桩（程序化图标用）：记录 fillRect 次数，toDataURL 回一个可断言的 data URL */
    getContext(kind) {
      if (kind !== '2d') return null;
      const ops = [];
      el.__ops = ops;
      return {
        fillStyle: '#ffffff',
        fillRect(x, y, w, h) { ops.push([x, y, w, h]); },
        clearRect(x, y, w, h) { ops.push([x, y, w, h]); },
        beginPath() {}, closePath() {}, fill() {}, stroke() {},
        moveTo() {}, lineTo() {}, arc() {}, rect() {},
        save() {}, restore() {}, translate() {}, setTransform() {},
      };
    },
    toDataURL() { return 'data:image/png;base64,ICON-' + ((el.__ops || []).length); },
    focus() {},
    blur() {},
    click() { fire(el, 'click'); },
  };

  Object.defineProperty(el, 'id', {
    get: () => id,
    set: (v) => { id = String(v); if (id) byId.set(id, el); },
    enumerable: true,
  });
  const splitCls = (v) => String(v || '').split(' ').filter((c) => c.length > 0);
  Object.defineProperty(el, 'className', {
    get: () => Array.from(classes).join(' '),
    set: (v) => { classes.clear(); splitCls(v).forEach((c) => classes.add(c)); },
    enumerable: true,
  });
  Object.defineProperty(el, 'classList', {
    value: {
      add(...cs) { cs.forEach((c) => classes.add(c)); },
      remove(...cs) { cs.forEach((c) => classes.delete(c)); },
      contains: (c) => classes.has(c),
      toggle(c, on) {
        const v = on === undefined ? !classes.has(c) : !!on;
        if (v) classes.add(c); else classes.delete(c);
        return v;
      },
    },
    enumerable: true,
  });
  Object.defineProperty(el, 'textContent', {
    get() {
      if (text !== null) return text;
      return children.map((c) => c.textContent).join('');
    },
    set(v) {
      children.length = 0;
      text = v == null ? '' : String(v);
    },
    enumerable: true,
  });
  Object.defineProperty(el, 'innerHTML', {
    get: () => el.textContent,
    set(v) { children.length = 0; text = String(v == null ? '' : v); },
  });
  Object.defineProperty(el, 'firstChild', { get: () => children[0] || null });
  Object.defineProperty(el, 'lastChild', { get: () => children[children.length - 1] || null });
  return el;
}

function isAttached(el, rootEl) {
  let n = el;
  while (n) {
    if (n === rootEl) return true;
    n = n.parentNode;
  }
  return false;
}

// 同时认 className 与 class 属性（SVG 元素在浏览器里只有 SVGAnimatedString className）
function hasClass(el, cls) {
  if (!el || !cls) return false;
  if (el.className && el.className.split(' ').indexOf(cls) >= 0) return true;
  const attr = el.getAttribute ? el.getAttribute('class') : null;
  if (attr && String(attr).split(' ').indexOf(cls) >= 0) return true;
  return false;
}

function findAll(rootEl, cls, out) {
  const acc = out || [];
  if (!rootEl || !rootEl.children) return acc;
  for (const child of rootEl.children) {
    if (hasClass(child, cls)) acc.push(child);
    findAll(child, cls, acc);
  }
  return acc;
}

function findImgs(rootEl, out) {
  const acc = out || [];
  if (!rootEl || !rootEl.children) return acc;
  for (const child of rootEl.children) {
    if (child.tagName === 'IMG') acc.push(child);
    findImgs(child, acc);
  }
  return acc;
}

function fire(el, type) {
  return fireEv(el, type, null);
}

/* 拖动 / 滚轮要带 clientX / deltaY：事件对象在这里按需补充字段 */
function fireEv(el, type, extra) {
  const arr = el.__listeners[type];
  if (!arr || !arr.length) return 0;
  const ev = Object.assign({ type, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {} }, extra || {});
  arr.slice().forEach((fn) => fn(ev));
  return arr.length;
}

const doc = {
  createElement: (t) => makeEl(t),
  createElementNS: (ns, t) => makeEl(t),
  createTextNode: (t) => { const e = makeEl('#text'); e.textContent = t; return e; },
  getElementById: (id) => byId.get(id) || null,
  addEventListener() {},
  removeEventListener() {},
  body: makeEl('body'),
  documentElement: makeEl('html'),
};

const rafQueue = [];
const win = {
  innerWidth: 390,
  innerHeight: 844,
  console,
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame() { rafQueue.length = 0; },
};

const ctx = vm.createContext({ window: win, document: doc, console, setTimeout, clearTimeout });
const load = (rel) => {
  const abs = path.join(root, rel);
  vm.runInContext(fs.readFileSync(abs, 'utf8'), ctx, { filename: abs });
};

/* ---------------- v3：直接加载真实 01-config，桩 CORE 只补游戏规则 ---------------- */

load('src/01-config.js');
const CONFIG = win.BM.CONFIG;

/* ---------------- v13：直接读真实 CONFIG（四关 / 四工具） ---------------- */
const TALENTS = CONFIG.talents;
const LAST_ZONE_ID = CONFIG.zones[CONFIG.zones.length - 1].id;
const TOOL_IDS = Object.keys(CONFIG.tools);
const ORE_IDS = ['stone', 'coal', 'iron', 'gold', 'crystal'];
const SHAPE_EXPECT = {
  wood: '单格', iron: '纵向 2 格',
  diamond: '3×3 范围', laser: '整列贯穿',
};

/* 价格一律按 baseCost × depthMul[depth] × 1.9^已买级数 现算（与 CORE.nodeCost 同源），
   不读节点上的静态 cost 快照。TREE-V8 §3：价格只随「深度」缩放，没有关卡这一维。 */
const DEPTH_MUL = (CONFIG.talentCostTable && CONFIG.talentCostTable.depthMul) || [1];
const depthMulOf = (depth) => {
  const i = Math.round(Number(depth) || 0) - 1;
  if (!(i > 0)) return 1;
  return DEPTH_MUL[Math.min(i, DEPTH_MUL.length - 1)] || 1;
};
const firstCostOf = (n) => {
  const base = typeof n.baseCost === 'number' ? n.baseCost : (n.cost || 0);
  return BigInt(Math.round(base * depthMulOf(n.depth)));
};
const priceAtLevel = (n, lv) => {
  let num = firstCostOf(n);
  let den = 1n;
  for (let i = 0; i < lv; i += 1) { num *= 19n; den *= 10n; }
  return (num + den - 1n) / den;
};
const priceOf = (id) => String(priceAtLevel(TALENTS[id], 0)).replace(/([0-9])(?=([0-9]{3})+$)/g, '$1,');
/* 起手金币 = 中心节点「开始挖矿」的首级价：刚好买得起中心，又买不起第二个节点（用来验 poor 态） */
const START_COINS = Number(firstCostOf(CONFIG.tree.center));

const fixture = { damageBonus: 0 };
const owned = { handle: 1, steelTip: 1, oreSense: 1, glove: 1, blastIntro: 1 };

const zoneCfg = (id) => CONFIG.zones.filter((z) => z.id === id)[0] || CONFIG.zones[0];
const ORE_NAME = (id) => (CONFIG.ores[id] && CONFIG.ores[id].name) || String(id);
const QUARRY_NEED = zoneCfg('quarry').objective.need;
const QUARRY_ORE_NAME = ORE_NAME(zoneCfg('quarry').objective.ore);

const CORE = {
  state: {
    coins: BigInt(START_COINS),
    muted: false,
    selectedTool: 'wood',
    currentZone: 'quarry',
    unlockedTools: ['wood'],
    unlockedZones: ['quarry'],
    upgrades: {},
    talents: owned,
    roundsPlayed: 3,
    lifetimeCoins: 99n,
    lifetimeMined: { stone: 0, coal: 20, iron: 0, crystal: 0 },
    bestRound: { zoneId: 'quarry', coins: '88' },
  },
  fmt(v) { return String(v).replace(/[^0-9-]/g, '').replace(/^(-?)([0-9]+)$/, (m, s, d) => s + d.replace(/([0-9])(?=([0-9]{3})+$)/g, '$1,')); },
  abbr(v) {
    const n = Number(String(v));
    if (!isFinite(n)) return String(v);
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    return String(n);
  },
  canAfford(v) { try { return CORE.state.coins >= BigInt(String(v)); } catch (e) { return false; } },
  talentLevel(id) { return CORE.state.talents[id] || 0; },
  talentState(id) {
    const node = TALENTS[id];
    if (!node) return 'locked';
    if (CORE.talentLevel(id) >= (node.maxLevel || 1)) return 'owned';
    const req = node.requires || [];
    for (let i = 0; i < req.length; i++) if (CORE.talentLevel(req[i]) < 1) return 'locked';
    return 'available';
  },
  talentCost(id) {
    const n = TALENTS[id];
    if (!n) return 0n;
    return priceAtLevel(n, CORE.talentLevel(id));
  },
  upgradeLevel(id) { return (CORE.state.upgrades && CORE.state.upgrades[id]) || 0; },
  // 价格 = ceil(baseCost × 1.35^lv × zoneTier)：UI 只负责把 CORE 给的值显示出来
  upgradeCost(id) {
    const u = CONFIG.upgrades[id];
    if (!u) return 0n;
    const tier = { quarry: 1, ironmine: 6, crystalcave: 30, lavaedge: 150, stargeode: 750, moonsilver: 3800, coreheart: 19000 }[CORE.state.currentZone] || 1;
    return BigInt(Math.ceil(u.baseCost * Math.pow(1.35, CORE.upgradeLevel(id)) * tier));
  },
  toolDamage(id) { return CONFIG.tools[id].dmg + fixture.damageBonus; },
  mods() {
    return {
      damage: 0, holdIntervalMul: 1, oreRateBonus: 0, extraLayers: 0, dropFlat: 0, dropMul: 1,
      richMul: 1, richRateBonus: 0, magnetSpeedMul: 1, magnetRadiusMul: 1, chainChance: 0,
      multiStrikeEvery: 0, multiStrikeMul: 0.5, overkillTransfer: 0,
      frenzyDropMul: 1.5, frenzySeconds: 4, roundSeconds: 15,
      tntLayerPierce: 3,
      laserDamage: 0,
    };
  },
  nextObjective() {
    const z = zoneCfg(CORE.state.currentZone);
    const ob = z.objective;
    const have = CORE.state.lifetimeMined[ob.ore] || 0;
    return { zoneId: z.id, ore: ob.ore, need: ob.need, have: have, done: have >= ob.need };
  },
  hasTool(id) { return CORE.state.unlockedTools.indexOf(id) >= 0; },
  settleRound() { return null; },
  checkUnlocks() { return []; },
  addCoins() {},
  spendCoins() { return true; },
  save() { return true; },
  load() {},
  resetSave() { CORE.state.coins = 0n; },
};

win.BM.CORE = CORE;

/* ---------------- v7：CONFIG.tree（放射状天赋树）+ 单一购买 API 桩 ----------------
   docs/TREE-V7.md §1/§4：中心 1 个 + 6 lane × 7 ring（42）+ 并入的 5 条强化（ring 1）= 48 个节点。
   01-config 还没落地 CONFIG.tree 时由这里补齐；UI 只读这份数据，任何规则都不在 UI 里。 */
const HAD_TREE = !!CONFIG.tree;
const TREE_LANES = [
  { id: 'digChain', name: '采掘·连锁', short: '连', angle: 225 },
  { id: 'digPower', name: '采掘·威力', short: '力', angle: 315 },
  { id: 'veinRich', name: '矿脉·富矿', short: '富', angle: 180 },
  { id: 'veinLayer', name: '矿脉·层数', short: '层', angle: 135 },
  { id: 'lootTime', name: '采集·时间', short: '时', angle: 0 },
  { id: 'lootTrigger', name: '采集·触发', short: '触', angle: 45 },
];
const TREE_UPGRADES = [
  { lane: 'digPower', id: 'upPower', name: '工具威力', desc: '每级 伤害 +1', maxLevel: 5, cost: 40 },
  { lane: 'lootTrigger', id: 'upGear', name: '幸运齿轮', desc: '每级 连锁概率 +2pp', maxLevel: 10, cost: 40 },
  { lane: 'veinRich', id: 'upRefine', name: '矿石精炼', desc: '每级 本局结算 ×1.035', maxLevel: 10, cost: 40 },
  { lane: 'lootTime', id: 'upTime', name: '作业时间', desc: '每级 +0.5 秒', maxLevel: 10, cost: 40 },
  { lane: 'veinLayer', id: 'upRich', name: '富矿精炼', desc: '每级 富矿掉落 +8%', maxLevel: 10, cost: 40 },
];
if (!HAD_TREE) {
  const treeFixture = [];
  TREE_LANES.forEach((lane) => {
    for (let ring = 1; ring <= 7; ring += 1) {
      treeFixture.push({
        id: lane.id + ring, name: lane.name + ' ' + ring, lane: lane.id, ring,
        desc: '第 ' + ring + ' 环：' + lane.name + ' 再强一档',
        cost: 50 + (ring - 1) * 70, requires: ring === 1 ? ['core'] : [lane.id + (ring - 1)], maxLevel: 1,
      });
    }
  });
  TREE_UPGRADES.forEach((u) => {
    treeFixture.push({
      id: u.id, name: u.name, lane: u.lane, ring: 1, desc: u.desc,
      cost: u.cost, requires: [u.lane + '1'], maxLevel: u.maxLevel,
    });
  });
  CONFIG.tree = {
    center: { id: 'core', name: '所有武器伤害 +1', desc: '中心节点：所有武器伤害 +1', cost: 30 },
    lanes: TREE_LANES,
    nodes: treeFixture,
  };
}
/* 前向兼容探针（BM_TREE79=1）：把当前树撑成目标形状 —— 每条 lane 一条 10 层的单级节点链
   + 24 个侧枝（5 条 lane 时正好 74 个节点、最深 10 层）。用来证明 08-ui 的几何是
   「按 depth 现算」而不是照 12 个节点写死的：节点变多后同一套断言仍然成立。 */
if (process.env.BM_TREE79 === '1' && CONFIG.tree) {
  const probeIcons = ['pick', 'laser', 'bomb', 'tntbox', 'chain', 'coin', 'gem', 'clock', 'ring', 'sword'];
  const probeNodes = [];
  const laneIds = (CONFIG.tree.lanes || []).map((l) => l.id);
  const chains = Math.max(1, laneIds.length);
  for (let b = 0; b < chains; b += 1) {
    let prev = CONFIG.tree.center.id;
    for (let d = 1; d <= 10; d += 1) {
      const id = 'p' + b + 'd' + d;
      probeNodes.push({
        id, name: '枝' + b + ' 第 ' + d + ' 级', lane: laneIds[b % laneIds.length], ring: d,
        desc: '一条链上的单级节点', cost: 60 + d * 40, requires: [prev], maxLevel: 1,
        icon: probeIcons[(b + d) % probeIcons.length],
      });
      prev = id;
    }
  }
  /* 侧枝：让「一个父节点带两个子节点」也进几何测试（lane 留空，不算进直链） */
  for (let s = 0; s < 24; s += 1) {
    probeNodes.push({
      id: 'ps' + s, name: '侧枝 ' + s, lane: '', ring: 1 + Math.floor(s / 3),
      desc: '侧枝', cost: 80, requires: ['p' + (s % 3) + 'd' + (1 + Math.floor(s / 3))], maxLevel: 1,
      icon: probeIcons[s % probeIcons.length],
    });
  }
  CONFIG.tree.nodes = probeNodes;
}
const FIXTURE_TREE = !HAD_TREE;
const TREE = CONFIG.tree;
const TREE_NODES = {};
TREE.nodes.forEach((n) => { TREE_NODES[n.id] = n; });
if (TREE.center) TREE_NODES[TREE.center.id] = TREE.center;
const TREE_ALL = (TREE.center ? [TREE.center] : []).concat(TREE.nodes);
/* 目标数据里每个节点都 maxLevel=1（多级拆成一条链）：Lv x/N 的断言需要一个多级样本，
   配置里一个都没有时把第一个首环节点临时补到 4 级（与上面 MULTI_SHIM_ID 同一套路）。 */
if (!TREE.nodes.some((n) => (n.maxLevel || 1) > 1) && TREE.nodes.length) {
  const ring1 = TREE.nodes.filter((n) => (n.requires || []).indexOf(TREE.center.id) >= 0)[0] || TREE.nodes[0];
  if (ring1) ring1.maxLevel = 4;
}

/* 单一购买 API：等级 / 价格 / 状态都由 CORE 给，UI 只显示 */
/* 起手已购：中心 + 两个 ring 1 根节点 + 其中一个根的外圈子节点。
   外圈子节点已购 → 树里有一条「已购」连线；另一个根的外圈子节点则是「关未开」样本。 */
const treeRootsAtRing1 = TREE.nodes.filter((n) => (n.requires || []).indexOf(TREE.center.id) >= 0);
CORE.state.nodes = {};
if (TREE.center) CORE.state.nodes[TREE.center.id] = 1;
treeRootsAtRing1.slice(0, 2).forEach((n) => { CORE.state.nodes[n.id] = 1; });
const ownedDeepNode = TREE.nodes.filter((n) => (n.requires || []).indexOf((treeRootsAtRing1[0] || {}).id) >= 0)[0];
if (ownedDeepNode) CORE.state.nodes[ownedDeepNode.id] = 1;
CORE.nodeLevel = (id) => CORE.state.nodes[id] || 0;
CORE.nodeCost = (id) => {
  const n = TREE_NODES[id];
  if (!n) return null;
  const max = n.maxLevel || 1;
  const lv = CORE.nodeLevel(id);
  if (lv >= max) return null;
  return priceAtLevel(n, lv);
};
CORE.nodeZoneOf = (id) => {
  const n = TREE_NODES[id];
  return (n && typeof n.zone === 'string') ? n.zone : '';
};
CORE.nodeState = (id) => {
  const n = TREE_NODES[id];
  if (!n) return 'locked';
  const max = n.maxLevel || 1;
  const lv = CORE.nodeLevel(id);
  if (lv >= max) return max > 1 ? 'maxed' : 'owned';
  const zid = CORE.nodeZoneOf(id);
  if (zid && CORE.state.unlockedZones.indexOf(zid) < 0) return 'zonelocked';
  const req = n.requires || [];
  for (let i = 0; i < req.length; i += 1) if (CORE.nodeLevel(req[i]) < 1) return 'locked';
  const cost = CORE.nodeCost(id);
  if (cost == null) return 'locked';
  return CORE.canAfford(cost) ? 'available' : 'poor';
};
CORE.buyNode = (id) => {
  const cost = CORE.nodeCost(id);
  if (cost == null || !CORE.canAfford(cost)) return false;
  CORE.state.coins -= cost;
  CORE.state.nodes[id] = CORE.nodeLevel(id) + 1;
  return true;
};

/* ---------------- v4：美术图标桩（键一律取自 art/manifest.json） ---------------- */
const MANIFEST = JSON.parse(fs.readFileSync(path.join(root, 'art/manifest.json'), 'utf8'));
const ART_KEYS = new Set(Object.keys(MANIFEST));
const artCalls = [];
win.BM.ART = {
  total: ART_KEYS.size,
  has: (k) => ART_KEYS.has(k),
  one(key) {
    artCalls.push(key);
    if (!ART_KEYS.has(key)) return null;
    return { src: 'data:image/png;base64,ART-' + key, complete: true, naturalWidth: 24, naturalHeight: 24 };
  },
  all(key) {
    const one = win.BM.ART.one(key);
    return one ? [one] : [];
  },
  progress() { return 1; },
};

/* ---------------- 断言 ---------------- */
let pass = 0;
const fails = [];
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fails.push(label + (extra ? '  → ' + extra : '')); console.log('  FAIL  ' + label + (extra ? '  → ' + extra : '')); }
}
function section(t) { console.log('[' + t + ']'); }

/* ---------------- 加载真实文件 ---------------- */
load('src/07-audio.js');
load('src/08-ui.js');
const BM = win.BM;

const css = fs.readFileSync(path.join(root, 'src/style.css'), 'utf8');
const audioSrc = fs.readFileSync(path.join(root, 'src/07-audio.js'), 'utf8');
const uiSrc = fs.readFileSync(path.join(root, 'src/08-ui.js'), 'utf8');

const AUDIO_NAMES = [
  'hit', 'break', 'drill', 'explode', 'absorb', 'coin', 'buy', 'unlock', 'frenzy', 'ui', 'roundStart', 'roundEnd',
  'stoneHit', 'ironHit', 'layerBreak', 'tntFuse', 'tntBoom', 'emptied',
  'laserTick', 'quakeBlast', 'luckyTNT',
];

/* ---------------- 1. 音频 ---------------- */
section('音频 07-audio.js（无 AudioContext 时静默降级 / v3 三个新音色）');
ok(typeof BM.AUDIO === 'object' && typeof BM.AUDIO.init === 'function', 'BM.AUDIO.init 存在');
ok(typeof BM.AUDIO.play === 'function' && typeof BM.AUDIO.setMuted === 'function', 'BM.AUDIO.play / setMuted 存在');
let threw = null;
try { BM.AUDIO.init(); } catch (e) { threw = e; }
ok(threw === null, 'init() 不抛错');
ok(BM.AUDIO.init() === false, '无 AudioContext 时 init() 返回 false（静默返回）');
threw = null;
try { AUDIO_NAMES.forEach((n) => BM.AUDIO.play(n, { pitch: 1.1, gain: 0.8, pan: -0.5 })); } catch (e) { threw = e; }
ok(threw === null, AUDIO_NAMES.length + ' 个音名（v1 12 + v2 6 + v3 3）play() 全部不抛错');
ok(BM.AUDIO.muted === false, 'muted 默认 false');
BM.AUDIO.setMuted(true);
ok(BM.AUDIO.muted === true, 'setMuted(true) 生效');
ok(CORE.state.muted === true, 'muted 已写入 BM.CORE.state.muted');
BM.AUDIO.setMuted(false);
threw = null;
try { BM.AUDIO.play('nonexistent'); BM.AUDIO.play('stoneHit'); } catch (e) { threw = e; }
ok(threw === null, '未知音名 / 缺参数不抛错');

section('v3 新音效注册与事件绑定');
for (const n of ['laserTick', 'quakeBlast', 'luckyTNT']) {
  ok(audioSrc.indexOf('SOUNDS.' + n + ' = function') > 0, '07-audio.js 注册音效 ' + n);
}
ok(audioSrc.indexOf('laserTick: 0.05') > 0, 'laserTick 进节流表（密集 tick 不堆节点）');
ok(/SOUNDS\.laserTick[\s\S]{0,600}dense/.test(audioSrc), 'laserTick 连续 tick 时压低音量（dense 分支）');
ok(audioSrc.indexOf("bus.on('laser:tick'") > 0, 'laser:tick 绑到 laserTick');
ok(audioSrc.indexOf("bus.on('quake:blast'") > 0, 'quake:blast 绑到 quakeBlast');
ok(audioSrc.indexOf("bus.on('lucky:tnt'") > 0, 'lucky:tnt 绑到 luckyTNT');
ok(/SOUNDS\.quakeBlast[\s\S]{0,900}tail/.test(audioSrc), 'quakeBlast 有独立长尾层（低频冲击 + 余震）');
ok(/SOUNDS\.luckyTNT[\s\S]{0,700}steps\[3\]/.test(audioSrc), 'luckyTNT 是三连音 + 金饰高音的独立音色');

/* ---------------- 2. UI init ---------------- */
section('UI 初始化');
const handlers = {
  start: [], next: 0, back: 0, buy: [], tool: [], resetTalents: 0, resetSave: 0,
  mute: 0, quality: 0, shake: 0, qualitySilent: false,
};
const host = doc.createElement('div');
host.id = 'app';
doc.body.appendChild(host);
threw = null;
let initRet = null;
/* HOOKS 要留引用：init() 每次都重设 H（幂等返回 true 但会换掉 handlers），
   后面的用例重新 install 一遍才能继续验证按钮回调。 */
const HOOKS = {
    onStartRound(z) { handlers.start.push(z); },
    onNextRound() { handlers.next++; },
    onBackToCamp() { handlers.back++; },
    onBuyNode(id) {
      handlers.buy.push(id);
      if (CORE && CORE.buyNode) CORE.buyNode(id);   // 与 09-main 的 handlers.onBuyNode 同构
    },
    onSelectTool(id) { handlers.tool.push(id); },
      onResetTalents() { handlers.resetTalents++; },
    onResetSave() { handlers.resetSave++; },
    onToggleMute() { handlers.mute++; },
    onCycleQuality() {
      handlers.quality++;
      if (!handlers.qualitySilent) BM.UI.setQualityLabel('中');
    },
    onToggleShake() { handlers.shake++; },
};
try {
  initRet = BM.UI.init(host, HOOKS);
} catch (e) { threw = e; }
ok(threw === null, 'BM.UI.init 不抛错', threw && threw.stack);
ok(initRet === true, 'init 返回 true');
ok(!!doc.getElementById('bm-ui'), '#bm-ui 层已挂到 root');
ok(!!doc.getElementById('bm-screen-camp') && !!doc.getElementById('bm-hud') && !!doc.getElementById('bm-screen-result'), '三个界面节点齐备');

/* ---------------- 3. 营地 ---------------- */
section('营地 renderCamp（v13：四工具卡 / 形状文案 / 推荐天赋 / 信息块）');
threw = null;
try { BM.UI.renderCamp(); } catch (e) { threw = e; }
ok(threw === null, 'renderCamp 不抛错', threw && threw.stack);
const startBtn = doc.getElementById('bm-btn-start');
ok(!!startBtn, '#bm-btn-start 存在');
ok(startBtn.textContent.indexOf('开始挖矿') >= 0, '开始按钮文案含「开始挖矿」', startBtn.textContent);
ok(doc.getElementById('bm-coins').textContent === String(START_COINS).replace(/\B(?=(\d{3})+(?!\d))/g, ','), '金币精确千分位文本 = ' + START_COINS, doc.getElementById('bm-coins').textContent);
ok(doc.getElementById('bm-zone-name').textContent === CONFIG.zones[0].name, '矿区名 = ' + CONFIG.zones[0].name);
ok(doc.getElementById('bm-obj-text').textContent === '下一目标 · ' + QUARRY_ORE_NAME + ' 20/' + QUARRY_NEED,
  '目标进度文案（关名/主矿/需求都读 CONFIG.zones）', doc.getElementById('bm-obj-text').textContent);
ok(doc.getElementById('bm-obj-fill').style.width === (Math.round((20 / QUARRY_NEED) * 1000) / 10) + '%',
  '进度条宽度 = 20/' + QUARRY_NEED + ' = ' + (Math.round((20 / QUARRY_NEED) * 1000) / 10) + '%', doc.getElementById('bm-obj-fill').style.width);

const toolCards = TOOL_IDS.map((id) => doc.getElementById('bm-tool-' + id));
ok(toolCards.every(Boolean), '四张工具卡（木镐/铁镐/钻石镐/激光钻）都存在');
ok(toolCards.length === 4 && toolCards.length === Object.keys(CONFIG.tools).length, '工具卡数量 = CONFIG.tools 的四种', 'count=' + toolCards.length);
ok(toolCards[0].textContent.indexOf(CONFIG.tools.wood.name) >= 0 &&
  toolCards[3].textContent.indexOf(CONFIG.tools.laser.name) >= 0,
  '首尾工具卡文案是 ' + CONFIG.tools.wood.name + ' / ' + CONFIG.tools.laser.name, toolCards[3].textContent);
ok(toolCards[0].classList.contains('selected') && !toolCards[0].classList.contains('locked'), '当前工具（木镐）已选中且未锁');
ok(toolCards.slice(1).every((n) => n.classList.contains('locked')), '未解锁的三把工具都带 locked', toolCards.slice(1).map((n) => n.textContent.slice(0, 12)).join(' | '));

for (const id of TOOL_IDS) {
  const card = doc.getElementById('bm-tool-' + id);
  ok(card.textContent.indexOf(SHAPE_EXPECT[id]) >= 0, id + ' 卡显示形状文案「' + SHAPE_EXPECT[id] + '」', card.textContent);
  ok(card.textContent.indexOf('伤害 ' + CONFIG.tools[id].dmg) >= 0, id + ' 卡显示伤害 ' + CONFIG.tools[id].dmg + '（读 CORE.toolDamage）', card.textContent);
}
for (const key of ['square3', 'columnAll']) {
  ok(new RegExp(key + ": *'").test(uiSrc), '08-ui SHAPE_TEXT 补齐 ' + key);
}
ok(!/TOOL_ORDER/.test(uiSrc), '08-ui 不再写死 TOOL_ORDER（工具表数据驱动：遍历 CONFIG.tools）');
ok(/eachItem\(cf\.tools/.test(uiSrc), 'toolList() 直接遍历 cf.tools 生成卡片');

ok(toolCards[1].textContent.indexOf('按住') >= 0 && toolCards[1].textContent.indexOf('0.42s') >= 0, '铁镐卡显示攻击方式与节拍', toolCards[1].textContent);
/* 解锁文案：先在 zones[].enterUnlocks / zones[].unlocks 里查表，再和卡片文案比（不写死关名与阈值） */
const enterZoneOf = (id) => CONFIG.zones.filter((z) => (z.enterUnlocks || []).indexOf(id) >= 0)[0];
const unlockRuleOf = (id) => {
  for (const z of CONFIG.zones) for (const r of (z.unlocks || [])) if (r && (r.tools || []).indexOf(id) >= 0) return r;
  return null;
};
const unlockHintOf = (id) => {
  const ez = enterZoneOf(id);
  if (ez) return '进入「' + ez.name + '」解锁';
  const rule = unlockRuleOf(id);
  if (rule && rule.ore) return '累计采集 ' + ORE_NAME(rule.ore) + ' ' + rule.need + ' 解锁';
  return null;
};
for (const id of TOOL_IDS.slice(1)) {
  const hint = unlockHintOf(id);
  const card = doc.getElementById('bm-tool-' + id);
  if (hint) ok(card.textContent.indexOf(hint) >= 0, id + ' 解锁条件读 zones[]（' + hint + '）', card.textContent);
  else ok(card.textContent.indexOf('解锁') >= 0, id + ' 至少给出可读的解锁提示', card.textContent);
}
ok(TOOL_IDS.slice(1).some((id) => enterZoneOf(id)) || TOOL_IDS.slice(1).some((id) => unlockRuleOf(id)),
  'CONFIG.zones 里确实声明了工具解锁来源（enterUnlocks 或 unlocks）');
ok(toolCards[2].textContent.indexOf('点按') >= 0 && toolCards[3].textContent.indexOf('按住') >= 0, '点按 / 按住 两种攻击方式都能显示');

/* 有效伤害随天赋变化：CORE.toolDamage 提供时应显示现算值 */
fixture.damageBonus = 1;
BM.UI.renderCamp();
ok(doc.getElementById('bm-tool-iron').textContent.indexOf('伤害 4') >= 0, '工具卡伤害读 CORE.toolDamage（基础 3 + 1）', doc.getElementById('bm-tool-iron').textContent);
ok(doc.getElementById('bm-tool-laser').textContent.indexOf('伤害 9') >= 0, '激光钻同样是现算值（8 + 1）', doc.getElementById('bm-tool-laser').textContent);
fixture.damageBonus = 0;
BM.UI.renderCamp();
ok(doc.getElementById('bm-tool-iron').textContent.indexOf('伤害 3') >= 0, '移除加成后伤害回到 3');

const toolRow = doc.getElementById('bm-tools');
ok(toolCards.every((n) => n.parentNode === toolRow), '四张工具卡真正挂载在 #bm-tools 上');
ok(toolCards.every((n) => isAttached(n, host)), '工具卡从 #bm-tools 一路连到 #app（可见性前提）');

const recCard = doc.getElementById('bm-recommend');
ok(!!recCard && isAttached(recCard, doc.getElementById('bm-screen-camp')), '推荐卡存在且挂在营地里');
ok(recCard.textContent.indexOf('推荐天赋') >= 0, '推荐卡标题改为「推荐天赋」', recCard.textContent);
const commaOf = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const campSavedCoins = CORE.state.coins;
CORE.state.coins = BigInt('1000000000000000000');
BM.UI.renderCamp();
const affordableNodes = TREE_ALL.filter((n) => CORE.nodeState(n.id) === 'available');
const cheapestNode = affordableNodes
  .slice().sort((a, b) => Number(BigInt(CORE.nodeCost(a.id)) - BigInt(CORE.nodeCost(b.id))))[0];
ok(!!cheapestNode && CORE.nodeState(cheapestNode.id) === 'available',
  '最便宜的可买节点现算得出（' + (cheapestNode && cheapestNode.id) + '，跳过已购/缺前置/关未开）', cheapestNode && cheapestNode.id);
ok(doc.getElementById('bm-recommend-name').textContent === cheapestNode.name,
  '推荐卡 = 最便宜的可买节点（天赋与强化同在一棵树里）', doc.getElementById('bm-recommend-name').textContent);
ok(doc.getElementById('bm-recommend-cost').textContent === commaOf(CORE.nodeCost(cheapestNode.id)) + ' 金币',
  '推荐卡价格读 CORE.nodeCost（' + commaOf(CORE.nodeCost(cheapestNode.id)) + '）', doc.getElementById('bm-recommend-cost').textContent);
ok(doc.getElementById('bm-recommend-effect').textContent.indexOf(cheapestNode.desc) >= 0,
  '推荐卡显示效果一句话', doc.getElementById('bm-recommend-effect').textContent);
ok(recCard.classList.contains('can-buy'), '买得起时推荐卡高亮 can-buy');
CORE.state.coins = campSavedCoins;
BM.UI.renderCamp();

const statsBox = doc.getElementById('bm-camp-stats');
ok(!!statsBox && statsBox.children.length === 3, '信息块三个格子');
ok(doc.getElementById('bm-camp-mined').textContent === '20/' + QUARRY_NEED, '本图目标进度（读 zones[].objective）', doc.getElementById('bm-camp-mined').textContent);
ok(doc.getElementById('bm-camp-best').textContent === '88', '最高纪录读 bestRound', doc.getElementById('bm-camp-best').textContent);
const OWNED_COUNT = TREE_ALL.filter((n) => CORE.nodeLevel(n.id) > 0).length;
ok(doc.getElementById('bm-camp-talents').textContent === OWNED_COUNT + '/' + TREE_ALL.length,
  '已购天赋 / 整棵树 = ' + OWNED_COUNT + '/' + TREE_ALL.length, doc.getElementById('bm-camp-talents').textContent);

/* 营地通关徽标：只在最后一关达标后出现（最后一关由 CONFIG.zones 的 final 标记决定，不写死关名） */
const lastZone = zoneCfg(LAST_ZONE_ID);
ok(!!doc.getElementById('bm-camp-clear') && !doc.getElementById('bm-camp-clear').classList.contains('show'), '第 1 关未达标时营地不显示通关徽标');
CORE.state.currentZone = LAST_ZONE_ID;
CORE.state.lifetimeMined[lastZone.objective.ore] = lastZone.objective.need;
BM.UI.renderCamp();
ok(doc.getElementById('bm-camp-clear').classList.contains('show'), '最后一关达标后营地显示「主线通关」徽标');
ok(doc.getElementById('bm-camp-clear').textContent.indexOf('主线通关') >= 0, '营地徽标文案 = 主线通关', doc.getElementById('bm-camp-clear').textContent);
ok(doc.getElementById('bm-zone-name').textContent === lastZone.name, '徽标出现在最后一关（' + lastZone.name + '）', doc.getElementById('bm-zone-name').textContent);
CORE.state.currentZone = 'quarry';
CORE.state.lifetimeMined[lastZone.objective.ore] = 0;
BM.UI.renderCamp();
ok(!doc.getElementById('bm-camp-clear').classList.contains('show'), '回到非最终关后徽标隐藏');

/* 「下一关」：营地文案一律用 zones[].nextZone 查表，末关不显示 */
const campNext = doc.getElementById('bm-zone-next');
ok(!!campNext, '营地有「下一关」行 #bm-zone-next');
const NEXT_OF_QUARRY = zoneCfg(zoneCfg('quarry').nextZone);
ok(campNext.textContent === '下一关 · ' + NEXT_OF_QUARRY.name && campNext.classList.contains('show'),
  '第 1 关营地显示「下一关 · ' + NEXT_OF_QUARRY.name + '」（nextZone 查表）', campNext.textContent);
ok(/nextZoneOf/.test(uiSrc), '08-ui 用 nextZoneOf(zones[].nextZone) 查下一关，不写死关名');
CORE.state.currentZone = LAST_ZONE_ID;
BM.UI.renderCamp();
ok(campNext.textContent === '' && !campNext.classList.contains('show'), '末关 nextZone=null → 不显示「下一关」行', campNext.textContent);
CORE.state.currentZone = 'quarry';
BM.UI.renderCamp();
ok(doc.getElementById('bm-zone-name').textContent === CONFIG.zones[0].name, '回到第 1 关营地');

/* ---------------- 4. 天赋树（TREE-V8：parent 自动布局 / 画布图标 / 点击购买） ---------------- */
section('天赋树自动布局（depth → 半径 70+54d，扇区切角度，同深度不重叠 / 单链同角度）');
BM.UI.renderCamp();
const talentBody = doc.getElementById('bm-talents-body');
let stage = doc.getElementById('bm-talents-stage');
let mapEl = doc.getElementById('bm-talents-map');
ok(!!stage && !!mapEl, '抽屉里有 .talent-stage（裁剪视口）与 .talent-map（transform 层）');
const badges = findAll(talentBody, 'talent-node');
const chips = findAll(talentBody, 'talent-chip');   // 格子 = 命中区（状态 class 挂在格子上）
ok(badges.length === 1 + TREE.nodes.length, '徽章数 = 1 中心 + ' + TREE.nodes.length + ' 个节点', 'count=' + badges.length);
ok(badges.every((n) => isAttached(n, talentBody)), badges.length + ' 个徽章都挂在 #bm-talents-body 里');
ok(!HAD_TREE || TREE.nodes.every((n) => typeof n.icon === 'string' && n.icon.length > 0),
  'v8 每个节点都带 icon 字段（TREE-V8 §2）');
ok(!TREE.nodes.some((n) => typeof n.zone === 'string' && n.zone),
  'v8 的节点不再声明 zone（价格按深度缩放，整棵树不该被关序卡死）');
ok(!chips.some((el) => el.classList.contains('zonelocked')), '因此没有徽章会因为「关未开」变暗');

/* 一个节点 = 一个格子（命中区）里套一个圆徽章 + 上下两行字：
   nodeEl = 格子（#bm-talent-<id>），circleEl / capEl / lvEl = 格子里的三段。 */
const nodeEl = (id) => doc.getElementById('bm-talent-' + id);
const circleEl = (id) => findAll(nodeEl(id), 'talent-node')[0];
const capEl = (id) => findAll(nodeEl(id), 'talent-cap')[0];
const lvEl = (id) => findAll(nodeEl(id), 'talent-lv')[0];
const px = (v) => Number(String(v).replace('px', ''));
const NODE_D = 34, CENTER_D = 56, R0 = 70, DR = 54, MIN_ARC = 40;
const CHIP_W = 92, CHIP_H = 76;
const boxOf = (el) => el.getBoundingClientRect();
const badgeW = (el) => boxOf(el).width;          // 传圆徽章 = 34/56，传格子 = 92
const cxOf = (el) => { const r = boxOf(el); return r.left + r.width / 2; };   // 传格子：圆心与格子中心重合
const cyOf = (el) => { const r = boxOf(el); return r.top + r.height / 2; };
const MAP = px(mapEl.style.width);
const DCX = MAP / 2, DCY = MAP / 2;
const distOf = (el) => Math.sqrt(Math.pow(cxOf(el) - DCX, 2) + Math.pow(cyOf(el) - DCY, 2));
const depthOf = (id) => Number(nodeEl(id).dataset.depth);

/* 深度 = 父链长度（与 08-ui 的 treeLayout 同一口径：取第一个可解析的 requires） */
const BY_ID = {};
TREE_ALL.forEach((n) => { BY_ID[n.id] = n; });
const CENTER_ID_OF_TREE = TREE.center ? TREE.center.id : '';
const expectedDepth = (n, guard) => {
  if (!n || n.id === CENTER_ID_OF_TREE) return 0;
  const req = (n.requires || []).filter((r) => r && r !== n.id && BY_ID[r]);
  if (!req.length || (guard || 0) > 30) return 1;
  return 1 + expectedDepth(BY_ID[req[0]], (guard || 0) + 1);
};
const depthBad = TREE_ALL.filter((n) => depthOf(n.id) !== expectedDepth(n));
ok(depthBad.length === 0, '每个节点的 depth = 父链长度', depthBad.map((n) => n.id + ':' + depthOf(n.id)).join(','));

ok(!!TREE.center && depthOf(TREE.center.id) === 0 &&
  badgeW(circleEl(TREE.center.id)) === CENTER_D,
  '中心徽章 depth=0 / 直径 ' + CENTER_D + 'px',
  [depthOf(TREE.center.id), badgeW(circleEl(TREE.center.id))].join('/'));
ok(Math.abs(cxOf(nodeEl(TREE.center.id)) - DCX) <= 1 && Math.abs(cyOf(nodeEl(TREE.center.id)) - DCY) <= 1,
  '中心徽章圆心 = 地图中心（' + DCX + ',' + DCY + '）', [cxOf(nodeEl(TREE.center.id)), cyOf(nodeEl(TREE.center.id))].join(','));
ok(badges.every((el) => badgeW(el) === (Number(el.parentNode.dataset.depth) === 0 ? CENTER_D : NODE_D)),
  '徽章直径 34px（中心 56px）', badges.map((el) => badgeW(el)).join(',').slice(0, 40));

/* ---------------- 格子三段布局（用户反馈：① 徽章是椭圆 ② 等级字穿过圆圈） ----------------
   每个节点 = 92×76 的格子（命中区），内部三行：说明（圆上方）/ 圆形徽章 / 等级（圆下方）。
   几何全部写成行内 px，getBoundingClientRect（stub 按行内 px 累加）量到的就是真盒子。 */
section('格子三段布局（上方说明 / 方形徽章 / 下方等级，整格可点）');

const CAP_MAX = 6;
const textOf = (el, cls) => String((findAll(el, cls)[0] || {}).textContent || '');
const chipBad = chips.filter((el) => {
  const r = boxOf(el);
  return Math.abs(r.width - CHIP_W) > 0.5 || Math.abs(r.height - CHIP_H) > 0.5;
});
ok(chipBad.length === 0, '每个格子 ' + CHIP_W + '×' + CHIP_H + 'px（' + chips.length + ' 个节点）',
  chipBad.map((el) => el.dataset.node).slice(0, 4).join(','));
ok(chips.every((el) => el.tagName === 'BUTTON' && el.getAttribute('type') === 'button'),
  '命中区 = 格子本身（<button>，整格可点，键盘也能触发）');

/* ① 方形节点（v17）：宽高相等（border 计进 border-box）+ border-radius 4px */
const roundBad = chips.map((el) => {
  const r = boxOf(circleEl(el.dataset.node));
  return { id: el.dataset.node, dw: Math.abs(r.width - r.height), w: r.width };
}).filter((x) => x.dw >= 0.5);
ok(roundBad.length === 0, '徽章的 getBoundingClientRect 宽高差 <0.5px（方形节点，宽高相等）',
  roundBad.slice(0, 4).map((x) => x.id + ':' + x.dw.toFixed(2)).join(','));
ok(/\.talent-node *\{[^}]*border-radius: *[0-9]+px/.test(css), '徽章 border-radius 圆角（v17 方形节点）');
ok(/\.talent-node *\{[^}]*box-sizing: *border-box/.test(css), '徽章 box-sizing:border-box（2px 边框不会把盒子撑变形）');
ok(chips.every((el) => Math.abs(badgeW(circleEl(el.dataset.node)) -
  (Number(el.dataset.depth) === 0 ? CENTER_D : NODE_D)) < 0.5),
  '徽章直径恒为 ' + NODE_D + 'px（中心 ' + CENTER_D + 'px），不随图标 / 文字变化');

/* 同心：格子中心 = 圆心（缩放围绕地图中心，格子必须跟着节点坐标走） */
const offBad = chips.filter((el) => {
  const c = boxOf(el);
  const r = boxOf(circleEl(el.dataset.node));
  return Math.abs((c.left + c.width / 2) - (r.left + r.width / 2)) > 0.5 ||
    Math.abs((c.top + c.height / 2) - (r.top + r.height / 2)) > 0.5;
});
ok(offBad.length === 0, '格子中心与圆心重合（误差 <0.5px，' + chips.length + ' 个）',
  offBad.map((el) => el.dataset.node).slice(0, 4).join(','));

/* ② 三段顺序：说明在圆上方、等级在圆下方，且两行都不与圆盒相交 */
const orderBad = [];
const touchBad = [];
chips.forEach((el) => {
  const id = el.dataset.node;
  const r = boxOf(circleEl(id));
  const cap = boxOf(capEl(id));
  const lv = boxOf(lvEl(id));
  if (!(cap.top < r.top)) orderBad.push(id + ':cap ' + cap.top + '≥' + r.top);
  if (!(lv.top > r.bottom)) orderBad.push(id + ':lv ' + lv.top + '≤' + r.bottom);
  if (cap.bottom > r.top + 0.001 || lv.top < r.bottom - 0.001) touchBad.push(id);
});
ok(orderBad.length === 0, '说明行在圆圈上方（cap.top < circle.top）、等级行在圆圈下方（lv.top > circle.bottom）',
  orderBad.slice(0, 4).join(' '));
ok(touchBad.length === 0, '两行文字都不与圆盒重叠（一个字都不压线）', touchBad.slice(0, 4).join(','));

/* 说明文字：非空、≤6 字（超出省略号） */
const capBad = chips.filter((el) => {
  const t = textOf(el, 'talent-cap');
  return t.length === 0 || Array.from(t).length > CAP_MAX;
});
ok(capBad.length === 0, '每个格子都有一行 ≤' + CAP_MAX + ' 字的说明（不点开也看得出这是什么）',
  capBad.slice(0, 4).map((el) => el.dataset.node + ':' + textOf(el, 'talent-cap')).join(','));
const capHidden = chips.filter((el) => hasClass(capEl(el.dataset.node), 'is-hidden'));
ok(capHidden.length < chips.length / 2, '说明行默认都显示（只有沿链撞上父节点价格的那几行才收起，' +
  capHidden.length + '/' + chips.length + ' 行收起）',
  capHidden.map((el) => el.dataset.node).slice(0, 6).join(','));
ok(/\.talent-chip \.talent-cap *\{[^}]*pointer-events: *none/.test(css) &&
  /\.talent-chip \.talent-lv *\{[^}]*pointer-events: *none/.test(css),
  '说明行 / 等级行不吃指针 → 点它们等于点整个格子');

/* ③ 相邻不压线：任意两行可见文字都不能互相重叠（按字形宽度估盒，不是声明的 92px 宽） */
const glyphW = (t) => Array.from(String(t)).reduce((s, ch) => s + (ch.charCodeAt(0) > 0x2e80 ? 11 : 6.6), 0);
const textBoxOf = (el, text) => {
  const r = boxOf(el);
  const w = Math.min(r.width, glyphW(text));
  return { l: (r.left + r.right) / 2 - w / 2, r: (r.left + r.right) / 2 + w / 2, t: r.top, b: r.bottom };
};
const visibleTexts = [];
chips.forEach((el) => {
  const id = el.dataset.node;
  if (!hasClass(capEl(id), 'is-hidden')) visibleTexts.push({ id: id + ':cap', box: textBoxOf(capEl(id), textOf(el, 'talent-cap')) });
  const lvText = textOf(el, 'talent-lv');
  if (lvText.length) visibleTexts.push({ id: id + ':lv', box: textBoxOf(lvEl(id), lvText) });
});
const textClash = [];
for (let i = 0; i < visibleTexts.length; i += 1) {
  for (let j = i + 1; j < visibleTexts.length; j += 1) {
    const a = visibleTexts[i];
    const b = visibleTexts[j];
    if (a.box.l < b.box.r && b.box.l < a.box.r && a.box.t < b.box.b && b.box.t < a.box.b) {
      textClash.push(a.id + '/' + b.id);
    }
  }
}
ok(textClash.length === 0, visibleTexts.length + ' 行可见文字两两不重叠（最小的相邻圆心距只有 40px 量级）',
  textClash.slice(0, 6).join(' '));

const radiusOf = (n) => (depthOf(n.id) === 0 ? 0 : R0 + depthOf(n.id) * DR);
const radiusBad = TREE_ALL.filter((n) => Math.abs(distOf(nodeEl(n.id)) - radiusOf(n)) > 1.5);
ok(radiusBad.length === 0, '半径 = 70 + depth×54（' + TREE_ALL.length + ' 个节点全对）',
  radiusBad.map((n) => n.id + ':' + distOf(nodeEl(n.id)).toFixed(1)).slice(0, 5).join(','));

const rootKids = TREE.nodes.filter((n) => (n.requires || []).indexOf(CENTER_ID_OF_TREE) >= 0);
/* 根节点数不写死（TREE-V8 §7 删掉工具链后中心直接挂 5 条：攻击/结算/TNT掉落/TNT放置/连锁）：
   一律按 CONFIG.tree.lanes 现算 —— 每条扇区恰好一个根节点，互不共 lane。 */
ok(rootKids.length === (TREE.lanes || []).length && new Set(rootKids.map((n) => n.lane)).size === rootKids.length,
  '中心有 ' + rootKids.length + ' 个子节点 = ' + (TREE.lanes || []).length + ' 条 lane（各占一条扇区）', rootKids.map((n) => n.id).join(','));
if (rootKids.length >= 2) {
  const angs = rootKids.map((n) => {
    const a = Math.atan2(cyOf(nodeEl(n.id)) - DCY, cxOf(nodeEl(n.id)) - DCX) * 180 / Math.PI;
    return (a + 360) % 360;
  }).sort((a, b) => a - b);
  const gaps = angs.map((a, i) => (i + 1 < angs.length ? angs[i + 1] - a : angs[0] + 360 - a));
  ok(Math.max.apply(null, gaps) - Math.min.apply(null, gaps) <= 2.5,
    '根节点的子节点按 360° 均分（每 ' + (360 / rootKids.length).toFixed(1) + '°）', gaps.map((g) => g.toFixed(1)).join(','));
}

const spreadBad = [];
TREE_ALL.forEach((p) => {
  const kids = TREE_ALL.filter((n) => (n.requires || []).indexOf(p.id) >= 0);
  if (kids.length < 2 || p.id === CENTER_ID_OF_TREE) return;
  const base = Math.atan2(cyOf(nodeEl(p.id)) - DCY, cxOf(nodeEl(p.id)) - DCX) * 180 / Math.PI;
  kids.forEach((k) => {
    let d = Math.atan2(cyOf(nodeEl(k.id)) - DCY, cxOf(nodeEl(k.id)) - DCX) * 180 / Math.PI - base;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    if (Math.abs(d) > 50 + 2.5) spreadBad.push(p.id + '>' + k.id + ':' + d.toFixed(1));
  });
});
ok(spreadBad.length === 0, '同一父节点的子节点落在父角度 ±50° 内（spread 上限 100°）', spreadBad.slice(0, 4).join(','));

const overlap = [];
const rings = {};
TREE_ALL.forEach((n) => { const d = depthOf(n.id); (rings[d] = rings[d] || []).push(n); });
Object.keys(rings).forEach((d) => {
  const ring = rings[d];
  if (ring.length < 2) return;
  const R = R0 + Number(d) * DR;
  for (let i = 0; i < ring.length; i += 1) {
    for (let j = i + 1; j < ring.length; j += 1) {
      const e1 = nodeEl(ring[i].id), e2 = nodeEl(ring[j].id);
      let da = Math.abs(Math.atan2(cyOf(e1) - DCY,
        cxOf(e1) - DCX) - Math.atan2(cyOf(e2) - DCY, cxOf(e2) - DCX));
      if (da > Math.PI) da = 2 * Math.PI - da;
      const arc = R * da;
      if (arc < MIN_ARC - 2) overlap.push('d' + d + ':' + ring[i].id + '/' + ring[j].id + '=' + arc.toFixed(0));
    }
  }
});
ok(overlap.length === 0, '同一深度相邻节点弧长 ≥ ' + MIN_ARC + 'px（不重叠）', overlap.slice(0, 4).join(','));

const maxDepth = Math.max.apply(null, TREE_ALL.map((n) => depthOf(n.id)));
/* 地图 extent = 所有徽章（含半径）包围盒的正方形外接尺寸，且以中心徽章为圆心：
   取「中心到徽章外沿」的最大值 ×2 —— 08-ui 的 treeLayout 就按这个定尺寸（不再用 半径+34 留白）。 */
const halfSpan = Math.max.apply(null, badges.map((el) => Math.max(
  Math.abs(cxOf(el) - DCX), Math.abs(cyOf(el) - DCY)) + badgeW(el) / 2));
ok(Math.abs(MAP - 2 * halfSpan) <= 2, '地图 extent ≈ 2×「中心到最远徽章外沿」= ' + MAP,
  MAP + ' vs ' + (2 * halfSpan).toFixed(1));
ok(MAP <= 2 * (R0 + maxDepth * DR + NODE_D / 2 + 1), 'extent 不超过 树半径+徽章半径（按徽章算，不是旧的 +34 留白）',
  MAP + ' vs ' + (2 * (R0 + maxDepth * DR + NODE_D / 2 + 1)));

/* ---------------- 视口几何（初始 1:1 钉住中心 / 缩放 0.45–1.6 不跑） ----------------
   74 节点 / 10 层的树比视口大 3 倍以上：初始视图不再 fit 整棵树（那样每个徽章只有 3px），
   固定 1:1 只把中心徽章摆到视口正中，外圈靠拖动 / 缩放看。 */
const VW = 358, VH = 356, ZMIN = 0.45, ZMAX = 1.6, S0 = 1;   // 初始缩放固定 1.0
const clampZoom = (v) => Math.min(ZMAX, Math.max(ZMIN, v));
const panX = Math.round((VW - MAP * S0) / 2), panY = Math.round((VH - MAP * S0) / 2);
ok(MAP > Math.min(VW, VH), '地图 extent ' + MAP + ' 大于视口 358×356（不再把整棵树硬塞进来）', MAP + ' > 358');
ok(mapEl.style.transform === 'translate(' + panX + 'px, ' + panY + 'px) scale(' + S0.toFixed(2) + ')',
  '初始 transform = scale 1.0 + 地图中心（= 中心徽章）对齐视口中心', mapEl.style.transform);
/* 圆徽章矩形换算到视口坐标：transform-origin 0 0 → 屏幕 = pan + 地图坐标 × scale
   （el 传格子；量的是格子里的圆，格子比圆大，可见性仍按圆算） */
const rectAt = (chip, scale, shiftX, shiftY) => {
  const r = boxOf(findAll(chip, 'talent-node')[0]);
  return {
    id: chip.dataset.node,
    l: shiftX + r.left * scale, t: shiftY + r.top * scale,
    r: shiftX + r.right * scale, b: shiftY + r.bottom * scale,
  };
};
const inView = (r) => r.l >= -0.001 && r.t >= -0.001 && r.r <= VW + 0.001 && r.b <= VH + 0.001;
/* 08-ui 往 .talent-map 写 --lv-fs（1/scale 反向缩放的 Lv 字号） */
const lvFs = () => Number(String((mapEl.style.__props || {})['--lv-fs'] || '').replace('px', ''));
const showRect = (r) => r.id + ':' + [r.l, r.t, r.r, r.b].map((v) => Math.round(v)).join('/');
const badgesNow = () => findAll(talentBody, 'talent-chip');   // 格子（rectAt 会量里面的圆）
const visibleAt = (s, sx, sy) => badgesNow().filter((el) => inView(rectAt(el, s, sx, sy))).length;
const centerRect = rectAt(nodeEl(TREE.center.id), S0, panX, panY);
ok(Math.abs((centerRect.l + centerRect.r) / 2 - VW / 2) <= 2 && Math.abs((centerRect.t + centerRect.b) / 2 - VH / 2) <= 2,
  '初始视图：中心徽章圆心 = 视口中心（误差 ≤2px）',
  [((centerRect.l + centerRect.r) / 2 - VW / 2).toFixed(2), ((centerRect.t + centerRect.b) / 2 - VH / 2).toFixed(2)].join(','));
/* 内 1 环必须完整可见：开局看到「中心 + 每条枝的起点」，外圈本来就该在视口外 */
const inner = chips.filter((el) => Number(el.dataset.depth) <= 1);
const clipped0 = inner.map((el) => rectAt(el, S0, panX, panY)).filter((r) => !inView(r));
ok(inner.length > 1 && clipped0.length === 0, '初始视图里 depth ≤ 1 的 ' + inner.length + ' 个徽章完整可见',
  clipped0.map(showRect).join(' '));
ok(visibleAt(S0, panX, panY) >= inner.length,
  '初始视图至少看得见中心 + 每条枝的起点（' + visibleAt(S0, panX, panY) + ' / ' + badges.length + ' 个）');
/* 不重叠：两两圆心距 ≥ 两半径之和（34px 徽章 + 54px 环距，任何缩放都不叠） */
const circles0 = chips.map((el) => {
  const r = rectAt(el, S0, panX, panY);
  return { id: el.dataset.node, x: (r.l + r.r) / 2, y: (r.t + r.b) / 2, rad: (r.r - r.l) / 2 };
});
const overlaps = [];
for (let i = 0; i < circles0.length; i += 1) {
  for (let j = i + 1; j < circles0.length; j += 1) {
    const a = circles0[i], b = circles0[j];
    const d = Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
    if (d < a.rad + b.rad - 0.5) overlaps.push(a.id + '/' + b.id + '=' + d.toFixed(1));
  }
}
ok(overlaps.length === 0, '徽章两两不重叠（圆心距 ≥ 两半径之和，' + circles0.length + ' 个）', overlaps.slice(0, 4).join(' '));
ok(lvFs() > 0 && lvFs() * S0 >= 9 - 1e-6,
  'Lv 小字初始视图里视觉字号 ≥9px（--lv-fs ' + lvFs() + 'px × ' + S0.toFixed(2) + ' = ' + (lvFs() * S0).toFixed(2) + 'px）',
  (mapEl.style.__props || {})['--lv-fs']);

/* 同一条链上的节点角度必须一致（误差 <0.5°）：多级拆成单级后，一条枝就是一条直线 */
const angleOf = (id) => {
  const el = nodeEl(id);
  return Math.atan2(cyOf(el) - DCY, cxOf(el) - DCX) * 180 / Math.PI;
};
const angDiff = (a, b) => {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return Math.abs(d);
};
const kidsOf = (n) => TREE_ALL.filter((k) => (k.requires || []).indexOf(n.id) >= 0);
const singleChainBad = [];
TREE_ALL.forEach((n) => {
  if (n.id === CENTER_ID_OF_TREE) return;
  const only = kidsOf(n);
  if (only.length !== 1) return;              // 只有一个子节点 = 直链，父子必须同角
  if (angDiff(angleOf(n.id), angleOf(only[0].id)) > 0.5) singleChainBad.push(n.id + '>' + only[0].id);
});
ok(singleChainBad.length === 0, '单链父子角度一致（误差 <0.5°）：' + (TREE_ALL.length - 1) + ' 个节点逐条检查',
  singleChainBad.slice(0, 4).join(','));
/* 同 lane（一条链上的多个单级节点都挂在同一 lane）的角度也一致 */
const laneGroups = {};
TREE_ALL.forEach((n) => { if (n.lane) (laneGroups[n.lane] = laneGroups[n.lane] || []).push(n); });
const laneBad = [];
Object.keys(laneGroups).forEach((lane) => {
  const arr = laneGroups[lane];
  if (arr.length < 3) return;
  const inLane = (id) => arr.some((x) => x.id === id);
  const linear = arr.every((n) => (n.requires || []).filter(inLane).length <= 1 &&
    arr.filter((x) => (x.requires || []).indexOf(n.id) >= 0).length <= 1);
  if (!linear) return;                        // 带侧枝的 lane 不算直链
  const a0 = angleOf(arr[0].id);
  arr.forEach((n) => { if (angDiff(angleOf(n.id), a0) > 0.5) laneBad.push(lane + ':' + n.id); });
});
ok(laneBad.length === 0, '同一 lane 的直链节点角度一致（误差 <0.5°，共 ' +
  Object.keys(laneGroups).length + ' 条 lane）', laneBad.slice(0, 6).join(','));

/* 半径随深度单调递增：depth 每 +1 就是 +DR（最深一层也不能例外） */
const depthList = Array.from(new Set(TREE_ALL.map((n) => depthOf(n.id)))).sort((a, b) => a - b);
const ringSources = depthList.map((d) => ({
  d,
  expect: d === 0 ? 0 : R0 + d * DR,
  got: TREE_ALL.filter((n) => depthOf(n.id) === d).map((n) => distOf(nodeEl(n.id))),
}));
const monotoneBad = ringSources.filter((x) => !x.got.every((v) => Math.abs(v - x.expect) <= 1.5));
const growBad = ringSources.filter((x, i) => i > 0 && !(x.expect > ringSources[i - 1].expect));
ok(monotoneBad.length === 0 && growBad.length === 0 && ringSources[ringSources.length - 1].expect === R0 + maxDepth * DR,
  '半径随深度单调递增（' + depthList.length + ' 层，最深 ' + maxDepth + ' 层 = ' + (R0 + maxDepth * DR) + 'px）',
  ringSources.map((x) => 'd' + x.d + '=' + x.expect).join(' '));

/* 连线：一条 requires 一条线，坐标都在合法数字上 */
const linkNodes = findAll(talentBody, 'talent-link');
const expectLinks = (() => {
  const ids = new Set(TREE_ALL.map((x) => x.id));
  let n = 0;
  TREE_ALL.forEach((x) => (x.requires || []).forEach((r) => { if (ids.has(r)) n += 1; }));
  return n;
})();
ok(linkNodes.length === expectLinks, '连线数 = 前置关系数 ' + expectLinks, 'count=' + linkNodes.length);
ok(linkNodes.every((p) => p.tagName === 'PATH' && !/NaN/.test(p.getAttribute('d') || '')), '每条连线都是合法 <path>（无 NaN）',
  linkNodes[0] && linkNodes[0].getAttribute('d'));
/* 连线 class 取「目标节点」的状态：要让一条线变 owned，得把它的目标买满
   （v8 §7 的根节点全是多级，只买 1 级是 available，且前置也得先到位）。 */
const linkProbeRoot = rootKids.filter((n) => (n.maxLevel || 1) === 1)[0] || rootKids[0];
const savedLinkLv = CORE.nodeLevel(linkProbeRoot.id);
const savedLinkReq = (linkProbeRoot.requires || []).map((r) => [r, CORE.nodeLevel(r)]);
(linkProbeRoot.requires || []).forEach((r) => { CORE.state.nodes[r] = Math.max(1, CORE.nodeLevel(r)); });
CORE.state.nodes[linkProbeRoot.id] = Math.max(1, linkProbeRoot.maxLevel || 1);
BM.UI.renderCamp();
ok(linkNodes.some((p) => hasClass(p, 'owned')) && linkNodes.some((p) => hasClass(p, 'available')) && linkNodes.some((p) => hasClass(p, 'locked')),
  '连线三态齐备：已购亮橙 / 可买虚线 / 未解锁暗灰',
  ['owned', 'available', 'locked'].map((c) => linkNodes.filter((p) => hasClass(p, c)).length).join('/'));
CORE.state.nodes[linkProbeRoot.id] = savedLinkLv;
savedLinkReq.forEach((p) => { CORE.state.nodes[p[0]] = p[1]; });
BM.UI.renderCamp();

/* 长连线（>140px，v17 L 型折线）：临时把最深节点直接挂到中心，看是不是有虚线豁口。
   L 型折线有多个 M 命令（横段 + 竖段 + 可能的豁口），所以不再数 M 的个数，只看是否有 gap。 */
const deepestNode = TREE_ALL.slice().sort((a, b) => depthOf(a.id) - depthOf(b.id)).pop();
const deepEl = nodeEl(deepestNode.id);
const deepLen = Math.sqrt(Math.pow(cxOf(deepEl) - DCX, 2) + Math.pow(cyOf(deepEl) - DCY, 2));
ok(deepLen > 140, '最深节点离中心 ' + deepLen.toFixed(0) + 'px（>140，可造长连线样本）');
const savedDeepReq = (TREE_NODES[deepestNode.id].requires || []).slice();
TREE_NODES[deepestNode.id].requires = savedDeepReq.concat([TREE.center.id]);
BM.UI.renderCamp();
const gapsNow = findAll(talentBody, 'talent-link-gap');
ok(gapsNow.length >= 1, '相距 >140px 的连线画成 L 型折线 + 中段虚线豁口', 'gap=' + gapsNow.length);
ok(gapsNow.length > 0 && gapsNow.every((g) => /^talent-link-gap (locked|available|owned)$/.test(String(g.getAttribute('class')))),
  '豁口虚线跟着目标节点的状态上色', gapsNow.length && gapsNow[0].getAttribute('class'));
const gapLens = gapsNow.map((g) => {
  const d = String(g.getAttribute('d') || '');
  // L 型折线的 gap 是多段（横 + 竖），计算总长度
  const segs = d.match(/M(-?[0-9.]+) (-?[0-9.]+) L(-?[0-9.]+) (-?[0-9.]+)/g) || [];
  let total = 0;
  segs.forEach((seg) => {
    const m = /M(-?[0-9.]+) (-?[0-9.]+) L(-?[0-9.]+) (-?[0-9.]+)/.exec(seg);
    if (m) total += Math.sqrt(Math.pow(Number(m[3]) - Number(m[1]), 2) + Math.pow(Number(m[4]) - Number(m[2]), 2));
  });
  return total;
});
ok(gapLens.every((v) => v > 0), 'L 型豁口长度 > 0（' + gapLens.map((v) => v.toFixed(0)).join(',') + '）', gapsNow.length);
TREE_NODES[deepestNode.id].requires = savedDeepReq;
BM.UI.renderCamp();
ok(gapsNow.length > findAll(talentBody, 'talent-link-gap').length, '还原前置后那条长连线消失（几何跟着 CONFIG 走，不是写死的）');
/* 探针重建过徽章 / 视口：重新绑定这两个引用（后面的拖动、缩放、Tips 断言要用） */
stage = doc.getElementById('bm-talents-stage');
mapEl = doc.getElementById('bm-talents-map');
ok(!!stage && !!mapEl && mapEl.parentNode === stage, '探针后视口 / 地图重新挂好（stage 里有一张 map）');

/* ---------------- 程序化图标 ---------------- */
section('程序化图标（Canvas 24×24 单色像素 / TREE-V8 §5）');
const ICON_KINDS = ['pick', 'laser', 'bomb', 'tntbox', 'chain', 'coin', 'gem', 'clock', 'ring', 'sword'];
ok(Array.isArray(BM.UI.iconKinds) && BM.UI.iconKinds.length === 10 && ICON_KINDS.every((k) => BM.UI.iconKinds.indexOf(k) >= 0),
  '10 种图标齐备（' + ICON_KINDS.join('/') + '）', BM.UI.iconKinds.join(','));
const masks = ICON_KINDS.map((k) => BM.UI.iconMask(k));
ok(masks.every((m) => m && m.length === 24 * 24), '每个图标都是 24×24 = 576 格');
const filled = masks.map((m) => m.reduce((a, v) => a + (v ? 1 : 0), 0));
ok(filled.every((c) => c >= 40 && c <= 300), '每种图标都真的画了 40–300 个像素（不是空图）', filled.join(','));
ok(new Set(masks.map((m) => m.join(''))).size === 10, '10 种图标两两不同（不是同一张图换名字）');
const pickUrl = String(BM.UI.iconUrl('pick'));
ok(/^data:image\/png;base64,ICON-\d+$/.test(pickUrl), 'iconUrl 走 canvas.toDataURL（data URL，零外部资源）', pickUrl.slice(0, 42));
const icons = findAll(talentBody, 'talent-ico');
ok(icons.length === badges.length, '每个徽章内置一个 .talent-ico', icons.length);
ok(icons.every((el) => ICON_KINDS.indexOf(el.getAttribute('data-icon')) >= 0), '图标种类都取自 10 种之一');
ok(icons.every((el) => String(el.style.maskImage || el.style.webkitMaskImage || '').indexOf('url("data:image/png') === 0),
  '图标以 CSS mask 上色（颜色跟随徽章状态，不用第二套配色图）');
const iconOfId = (id) => {
  const el = findAll(nodeEl(id), 'talent-ico')[0];
  return el ? el.getAttribute('data-icon') : null;
};
ok(TREE_ALL.every((n) => !n.icon || iconOfId(n.id) === n.icon), '徽章图标 = 节点的 icon 字段',
  TREE_ALL.map((n) => n.id + '=' + iconOfId(n.id)).slice(0, 6).join(' '));
ok(TREE_ALL.every((n) => !n.icon || BM.UI.iconKinds.indexOf(n.icon) >= 0),
  '配置里的 icon 字段全部落在 10 种程序化图标里');

const costSpan = (el) => (findAll(el, 'talent-lv')[0] || {}).textContent;   // 圆圈下方那行（Lv x/N 或价格）
const multiProbe0 = TREE.nodes.filter((n) => (n.maxLevel || 1) > 1)[0];
ok(!!multiProbe0, 'CONFIG.tree 里有多级节点（maxLevel>1）', TREE.nodes.map((n) => n.id + ':' + n.maxLevel).join(' ').slice(0, 80));
ok(/^Lv \d+\/\d+$/.test(String(costSpan(nodeEl(multiProbe0.id)))),
  '多级节点图标下方显示 Lv x/N', costSpan(nodeEl(multiProbe0.id)));
ok(Number(String(costSpan(nodeEl(multiProbe0.id))).split('/')[1]) === (multiProbe0.maxLevel || 1),
  'Lv x/N 的 N = maxLevel', costSpan(nodeEl(multiProbe0.id)) + ' vs ' + multiProbe0.maxLevel);

/* ---------------- 点击链路 ---------------- */
section('点击链路（pointerdown → pointerup → click：可买直接买 / 不可买开详情卡）');
const detail = doc.getElementById('bm-talent-detail');
const dName = doc.getElementById('bm-td-name');
const dDesc = doc.getElementById('bm-td-desc');
const dCost = doc.getElementById('bm-td-cost');
const dState = doc.getElementById('bm-td-state');
const buyBtn = doc.getElementById('bm-td-buy');
ok(!!detail && !!dName && !!dDesc && !!dCost && !!dState && !!buyBtn, '详情卡 5 个部件齐备（#bm-talent-detail / bm-td-*）');

const pointerTap = (id) => {
  fireEv(stage, 'pointerdown', { clientX: 0, clientY: 0, pointerId: 2 });
  fireEv(stage, 'pointerup', { clientX: 0, clientY: 0, pointerId: 2 });
  fire(nodeEl(id), 'click');
};
const tapNode = pointerTap;      // 后面「多级节点」那节继续用这个名字
const dragThenClick = (id) => {
  fireEv(stage, 'pointerdown', { clientX: 100, clientY: 100, pointerId: 3 });
  fireEv(stage, 'pointermove', { clientX: 130, clientY: 130, pointerId: 3 });
  fireEv(stage, 'pointerup', { clientX: 130, clientY: 130, pointerId: 3 });
  fire(nodeEl(id), 'click');
};

const savedTreeCoins = CORE.state.coins;
CORE.state.coins = BigInt('1000000000000000000');
BM.UI.renderCamp();
const ownedId = TREE_ALL.filter((n) => ['owned', 'maxed'].indexOf(CORE.nodeState(n.id)) >= 0)[0];
const availId = TREE_ALL.filter((n) => CORE.nodeState(n.id) === 'available')[0];
const lockedId = TREE_ALL.filter((n) => CORE.nodeState(n.id) === 'locked')[0];
ok([ownedId, availId, lockedId].every(Boolean), '三态样本都能在 CONFIG.tree 里找到',
  [ownedId && ownedId.id, availId && availId.id, lockedId && lockedId.id].join(','));
ok(nodeEl(ownedId.id).classList.contains('owned'), '已购格子带 owned（实心橙，' + ownedId.id + '）');
ok(nodeEl(availId.id).classList.contains('available'), '可买格子带 available（橙描边 + 呼吸，' + availId.id + '）');
ok(nodeEl(lockedId.id).classList.contains('locked') && !nodeEl(lockedId.id).classList.contains('available'),
  '缺前置的格子带 locked（灰、不可买，' + lockedId.id + '）');
ok(String(costSpan(nodeEl(availId.id))).length > 0, '可买徽章显示价格缩写', costSpan(nodeEl(availId.id)));
ok(String(costSpan(nodeEl(lockedId.id))).length === 0 || /^Lv 0\/\d+$/.test(String(costSpan(nodeEl(lockedId.id)))),
  '缺前置的徽章不显示价格（多级节点只显示 Lv 0/N）', costSpan(nodeEl(lockedId.id)));
const singleLocked = TREE.nodes.filter((n) => (n.maxLevel || 1) === 1 && CORE.nodeLevel(n.id) === 0 &&
  (n.requires || []).some((r) => CORE.nodeLevel(r) === 0))[0];
ok(!singleLocked || String(costSpan(nodeEl(singleLocked.id))).length === 0,
  '单级节点缺前置时不显示价格', singleLocked && costSpan(nodeEl(singleLocked.id)));

/* 买不起 → poor：点了不改等级，但详情卡说明原因、购买按钮不可用 */
CORE.state.coins = 0n;
BM.UI.renderCamp();
const poorId = TREE_ALL.filter((n) => CORE.nodeState(n.id) === 'poor' && (n.requires || []).every((r) => CORE.nodeLevel(r) > 0) && CORE.nodeLevel(n.id) === 0)[0];
ok(!!poorId && nodeEl(poorId.id).classList.contains('poor'), '金币压到 0 后有可买节点转 poor（暗橙描边）', poorId && nodeEl(poorId.id).className);
if (poorId) {
  const beforePoor = CORE.nodeLevel(poorId.id);
  pointerTap(poorId.id);
  ok(CORE.nodeLevel(poorId.id) === beforePoor, '买不起时点徽章不扣钱、不升级');
  ok(detail.classList.contains('is-open') && dState.textContent.indexOf('金币不足') === 0,
    '买不起时点徽章打开详情卡说明「金币不足」', dState.textContent);
  ok(dCost.textContent === commaOf(CORE.nodeCost(poorId.id)) + ' 金币', '详情卡价格读 CORE.nodeCost', dCost.textContent);
  ok(buyBtn.getAttribute('disabled') === 'disabled', '买不起时购买按钮 disabled');
}
CORE.state.coins = BigInt('1000000000000000000');
BM.UI.renderCamp();

/* 缺前置 / 已购：同样只开卡不买 */
const beforeLocked = CORE.nodeLevel(lockedId.id);
pointerTap(lockedId.id);
ok(CORE.nodeLevel(lockedId.id) === beforeLocked, '缺前置的节点点了不升等级');
const lockedParent = (lockedId.requires || [])[0];
ok(dState.textContent.indexOf('缺前置') === 0 && dState.textContent.indexOf(BY_ID[lockedParent].name) >= 0,
  '缺前置的节点详情写明缺哪个前置（' + (BY_ID[lockedParent] && BY_ID[lockedParent].name) + '）', dState.textContent);
ok(buyBtn.getAttribute('disabled') === 'disabled', '缺前置时购买按钮 disabled');
pointerTap(ownedId.id);
ok(dState.textContent.indexOf('已购') === 0 || dState.textContent.indexOf('满级') === 0, '已购节点详情状态 =「已购 / 满级」', dState.textContent);
ok(buyBtn.getAttribute('disabled') === 'disabled', '已购节点购买按钮 disabled');

/* 拖动 > 6px 后被吞掉的那一次 click：不误买；再点一次仍然能买（吞点击只有一次） */
const dragProbe = TREE_ALL.filter((n) => CORE.nodeState(n.id) === 'available')[0];
ok(!!dragProbe, '拖动测试样本：' + (dragProbe && dragProbe.id));
if (dragProbe) {
  const beforeDrag = CORE.nodeLevel(dragProbe.id);
  dragThenClick(dragProbe.id);
  ok(CORE.nodeLevel(dragProbe.id) === beforeDrag, '拖动松手后的那一次 click 被吞掉（不误买）', CORE.nodeLevel(dragProbe.id));
  pointerTap(dragProbe.id);
  ok(CORE.nodeLevel(dragProbe.id) === beforeDrag + 1, '紧接着的正常点击仍然能买（吞点击只吞一次）', CORE.nodeLevel(dragProbe.id));
}

/* 每一个可买节点：真实点击 → 等级 +1 */
const buyables = TREE_ALL.filter((n) => CORE.nodeState(n.id) === 'available');
ok(buyables.length > 0, '可买节点样本 ' + buyables.length + ' 个', buyables.map((n) => n.id).join(','));
const buyMiss = [];
buyables.forEach((n) => {
  const before = CORE.nodeLevel(n.id);
  pointerTap(n.id);
  if (CORE.nodeLevel(n.id) !== before + 1) buyMiss.push(n.id + ':' + before + '→' + CORE.nodeLevel(n.id));
});
ok(buyMiss.length === 0, buyables.length + ' 个可买节点：点一下徽章就买下 1 级（CORE.nodeLevel +1）', buyMiss.join(','));
ok(buyables.every((n) => handlers.buy.indexOf(n.id) >= 0), '每次点击都回调 onBuyNode(id)（单一购买 API）');
ok(nodeEl(buyables[0].id).dataset.level === String(CORE.nodeLevel(buyables[0].id)),
  '买完徽章上的等级/价格同步刷新（data-level）', nodeEl(buyables[0].id).dataset.level);

/* 每一个不可买节点：点击后等级不变（不偷偷扣钱） */
const blocked = TREE_ALL.filter((n) => ['locked', 'owned', 'maxed'].indexOf(CORE.nodeState(n.id)) >= 0);
const blockedMiss = [];
let reasonBad = 0;
blocked.forEach((n) => {
  const before = CORE.nodeLevel(n.id);
  pointerTap(n.id);
  if (CORE.nodeLevel(n.id) !== before) blockedMiss.push(n.id);
  if (!String(dState.textContent).length) reasonBad += 1;
});
ok(blockedMiss.length === 0, blocked.length + ' 个不可买节点：点了等级不变（不会偷偷扣钱）', blockedMiss.join(','));
ok(reasonBad === 0, '点不可买节点会打开详情卡并写明原因（状态行非空）');

/* 详情卡购买按钮：可连点升级 */
const multiUp = TREE.nodes.filter((n) => (n.maxLevel || 1) >= 3)[0];
ok(!!multiUp, '有多级节点可做连点升级样本（' + (multiUp && multiUp.id) + '）', multiUp && multiUp.maxLevel);
if (multiUp) {
  (multiUp.requires || []).forEach((r) => { CORE.state.nodes[r] = 1; });
  CORE.state.nodes[multiUp.id] = 1;
  CORE.state.coins = BigInt('1000000000000000000');
  BM.UI.renderCamp();
  pointerTap(multiUp.id);
  ok(CORE.nodeLevel(multiUp.id) === 2, '点徽章直接买 1 级（多级节点 Lv 1 → 2）', CORE.nodeLevel(multiUp.id));
  ok(dState.textContent.indexOf('Lv 2/' + multiUp.maxLevel) >= 0, '详情卡显示升级后的 Lv 2/' + multiUp.maxLevel, dState.textContent);
  const beforeBtn = handlers.buy.length;
  fire(buyBtn, 'click');
  fire(buyBtn, 'click');
  ok(CORE.nodeLevel(multiUp.id) === 4, '详情卡购买按钮可连点升级（+2 级）', CORE.nodeLevel(multiUp.id));
  ok(handlers.buy.length === beforeBtn + 2, '连点两次 → onBuyNode 两次', handlers.buy.length - beforeBtn);

  CORE.state.nodes[multiUp.id] = multiUp.maxLevel;
  BM.UI.renderCamp();
  pointerTap(multiUp.id);
  ok(dState.textContent.indexOf('满级') === 0 && dState.textContent.indexOf('Lv ' + multiUp.maxLevel + '/' + multiUp.maxLevel) >= 0,
    '满级显示「满级 · Lv N/N」', dState.textContent);
  ok(dCost.textContent === '已满级', '满级不再显示价格', dCost.textContent);
  ok(buyBtn.getAttribute('disabled') === 'disabled', '满级时购买按钮 disabled');
  ok(nodeEl(multiUp.id).classList.contains('maxed') && /^Lv \d+\/\d+$/.test(String(costSpan(nodeEl(multiUp.id)))),
    '满级徽章带 maxed，小字仍是 Lv N/N', nodeEl(multiUp.id).className + ' / ' + costSpan(nodeEl(multiUp.id)));
  CORE.state.nodes[multiUp.id] = 2;
  BM.UI.renderCamp();
}

/* 价格必须现算：把配置里的 cost 快照改坏，详情卡仍读 CORE.nodeCost */
const snapProbe = TREE.nodes.filter((n) => (n.maxLevel || 1) > CORE.nodeLevel(n.id) &&
  (n.requires || []).every((r) => CORE.nodeLevel(r) > 0))[0];
ok(!!snapProbe, '价格快照测试样本：' + (snapProbe && snapProbe.id));
if (snapProbe) {
  const savedCost = TREE_NODES[snapProbe.id].cost;
  const savedCoins = CORE.state.coins;
  TREE_NODES[snapProbe.id].cost = 1;
  CORE.state.coins = 0n;                      // poor：开卡不买，价格仍要显示
  BM.UI.renderCamp();
  pointerTap(snapProbe.id);
  ok(dCost.textContent === commaOf(CORE.nodeCost(snapProbe.id)) + ' 金币',
    '详情卡价格读 CORE.nodeCost，不被 node.cost 快照带偏', dCost.textContent);
  TREE_NODES[snapProbe.id].cost = savedCost;
  CORE.state.coins = savedCoins;
  BM.UI.renderCamp();
}

/* 拖动平移 + 缩放（初始 1:1，范围 0.45–1.6） */
const readPan = () => {
  const m = /translate\(([-0-9]+)px, ([-0-9]+)px\)/.exec(mapEl.style.transform) || [0, 0, 0];
  return { x: Number(m[1]), y: Number(m[2]) };
};
const panAt0 = readPan();
const t0 = mapEl.style.transform;
fireEv(stage, 'pointerdown', { clientX: 100, clientY: 100, pointerId: 1 });
fireEv(stage, 'pointermove', { clientX: 103, clientY: 102, pointerId: 1 });
ok(mapEl.style.transform === t0, '移动不到 6px 不算拖拽（不抖）', mapEl.style.transform);
fireEv(stage, 'pointermove', { clientX: 140, clientY: 120, pointerId: 1 });
fireEv(stage, 'pointerup', { clientX: 140, clientY: 120, pointerId: 1 });
ok(mapEl.style.transform.indexOf('translate(' + (panAt0.x + 40) + 'px, ' + (panAt0.y + 20) + 'px)') >= 0 && mapEl.style.transform !== t0,
  '拖动 40/20px → transform 的 translate 同步', mapEl.style.transform);
threw = null;
try { fireEv(stage, 'pointermove', { clientX: 400, clientY: 400, pointerId: 1 }); } catch (e) { threw = e; }
ok(threw === null && mapEl.style.transform.indexOf('translate(' + (panAt0.x + 40) + 'px, ' + (panAt0.y + 20) + 'px)') >= 0,
  'pointerup 之后的 pointermove 不再平移', mapEl.style.transform);

const zoomIn = doc.getElementById('bm-talent-zoom-in');
const zoomOut = doc.getElementById('bm-talent-zoom-out');
ok(!!zoomIn && !!zoomOut && zoomIn.textContent === '+' && zoomOut.textContent === '−', '右下角有 + / − 两个缩放按钮',
  (zoomIn && zoomIn.textContent) + (zoomOut && zoomOut.textContent));
/* 缩放：一档 = 0.1，围绕中心（pan 恒等于 (视口 − extent×scale)/2）；
   期望值按 08-ui 的 zoomTree 同一套「先算档位、再夹到 0.45–1.6」逐步模拟，不写死绝对倍数。 */
const zoomScale = () => Number(/scale\(([0-9.]+)\)/.exec(mapEl.style.transform)[1]);
const zoomSteps = (from, delta, n) => {
  let s = from;
  for (let i = 0; i < n; i += 1) s = clampZoom(Math.round((s + delta) * 100) / 100);
  return s;
};
const centerScreen = () => {
  const p = readPan();
  const r = rectAt(nodeEl(TREE.center.id), zoomScale(), p.x, p.y);
  return { x: (r.l + r.r) / 2, y: (r.t + r.b) / 2 };
};
const centered = () => Math.abs(centerScreen().x - VW / 2) <= 2 && Math.abs(centerScreen().y - VH / 2) <= 2;

fire(zoomIn, 'click');
ok(Math.abs(zoomScale() - zoomSteps(S0, 0.1, 1)) <= 1e-9, '点「+」放大一档', mapEl.style.transform);
ok(centered(), '放大后中心徽章仍在视口中心（误差 ≤2px）', JSON.stringify(centerScreen()));
fire(zoomOut, 'click'); fire(zoomOut, 'click');
ok(Math.abs(zoomScale() - zoomSteps(zoomSteps(S0, 0.1, 1), -0.1, 2)) <= 1e-9, '点两次「−」缩回', mapEl.style.transform);
ok(centered(), '缩小后中心徽章仍在视口中心', JSON.stringify(centerScreen()));
for (let i = 0; i < 20; i += 1) fire(zoomIn, 'click');
ok(zoomScale() === ZMAX, '放大上限 1.6 倍', mapEl.style.transform);
ok(centered(), '1.6 倍时中心仍在视口中心', JSON.stringify(centerScreen()));
ok(!mapEl.classList.contains('far') && lvFs() * ZMAX >= 9 - 1e-6,
  '1.6 倍时小字恢复显示（.far 摘掉，--lv-fs ' + lvFs() + 'px）', mapEl.className);
for (let i = 0; i < 30; i += 1) fire(zoomOut, 'click');
ok(zoomScale() === ZMIN, '缩小下限 0.45 倍', mapEl.style.transform);
ok(centered(), '0.45 倍时中心仍在视口中心', JSON.stringify(centerScreen()));
ok(visibleAt(ZMIN, readPan().x, readPan().y) >= visibleAt(S0, panX, panY),
  '缩到 0.45 能看到不少于初始视图的徽章（' + visibleAt(ZMIN, readPan().x, readPan().y) + ' ≥ ' + visibleAt(S0, panX, panY) + '）');
ok(NODE_D * ZMIN >= 12, '缩到最小时徽章直径 ' + (NODE_D * ZMIN).toFixed(1) + 'px ≥ 12px（仍看得出哪里有节点）');
ok(mapEl.classList.contains('far') && lvFs() > 0,
  '缩到最小时关掉小字（.talent-map.far），只留圆点', mapEl.className);
fireEv(stage, 'wheel', { deltaY: -100 });
ok(zoomScale() === zoomSteps(ZMIN, 0.1, 1), '滚轮向上放大一档（0.45 → 0.55）', mapEl.style.transform);
ok(centered(), '滚轮缩放后中心徽章仍在视口中心', JSON.stringify(centerScreen()));
fireEv(stage, 'wheel', { deltaY: 100 }); fireEv(stage, 'wheel', { deltaY: 100 });
ok(zoomScale() === ZMIN, '滚轮向下缩小，撞到 0.45 下限', mapEl.style.transform);
for (let i = 0; i < 5; i += 1) fire(zoomIn, 'click');
/* 缩放后拖动仍按屏幕像素 1:1（translate 直接吃屏幕位移，不受 scale 影响） */
const zoomedScale = zoomScale();
const panBefore = readPan();
fireEv(stage, 'pointerdown', { clientX: 50, clientY: 50, pointerId: 9 });
fireEv(stage, 'pointermove', { clientX: 90, clientY: 70, pointerId: 9 });
fireEv(stage, 'pointerup', { clientX: 90, clientY: 70, pointerId: 9 });
const panAfter = readPan();
ok(zoomScale() === zoomedScale && panAfter.x === panBefore.x + 40 && panAfter.y === panBefore.y + 20,
  zoomedScale.toFixed(2) + ' 倍下拖动 40/20px → translate 也走 40/20px（屏幕像素 1:1）',
  [panBefore.x, panBefore.y, panAfter.x, panAfter.y].join(','));
fire(zoomIn, 'click');   // 回到居中，后面不再依赖拖动后的 pan

CORE.state.coins = savedTreeCoins;
BM.UI.renderCamp();
ok(doc.getElementById('bm-talent-zoom') && isAttached(doc.getElementById('bm-talent-zoom'), talentBody), '缩放按钮挂在视口上');
ok(!!doc.getElementById('bm-btn-reset-talents'), '「免费重置天赋」按钮保留');
fire(doc.getElementById('bm-btn-reset-talents'), 'click');
ok(handlers.resetTalents === 1, '免费重置天赋 → onResetTalents');

/* ---------------- 5. HUD ---------------- */
section('挖矿 HUD updateHUD（v3：四矿计数格按 zone.ores 过滤 + TNT + 连击/狂热/倒计时）');
ok(ORE_IDS.length === 5 && ORE_IDS.every((id) => !!CONFIG.ores[id]), 'CONFIG.ores 有石头/煤矿/铁矿/金矿/晶石五种');
ok(CONFIG.ores.gold.price === 150, '金矿单价 150（夹在铁矿 40 与晶石 400 之间）', String(CONFIG.ores.gold.price));
ok(CONFIG.ores.iron.price < CONFIG.ores.gold.price && CONFIG.ores.gold.price < CONFIG.ores.crystal.price,
  '金矿单价排序：铁 40 < 金 150 < 晶 400', [CONFIG.ores.iron.price, CONFIG.ores.gold.price, CONFIG.ores.crystal.price].join('/'));
const zoneUnion = [];
CONFIG.zones.forEach((z) => (z.ores || []).forEach((e) => { if (zoneUnion.indexOf(e.ore) < 0) zoneUnion.push(e.ore); }));
ok(zoneUnion.length === 5, CONFIG.zones.length + ' 关的 zone.ores 合起来覆盖五种矿', zoneUnion.join(','));
ok(zoneUnion.every((id) => ORE_IDS.indexOf(id) >= 0), 'zone.ores 里的矿种都在 ORE_IDS 里', zoneUnion.join(','));
ok(ORE_IDS.every((id) => zoneUnion.indexOf(id) >= 0), '五种矿分别出现在某关（不会永远不显示）', zoneUnion.join(','));

BM.UI.showScreen('mine');
threw = null;
try {
  BM.UI.updateHUD({ timeLeft: 9.4, counts: { stone: 5, coal: 7, iron: 2, crystal: 3 }, coins: 20n, combo: 4, frenzy: 0, tool: 'wood', explosiveLeft: 2 });
} catch (e) { threw = e; }
ok(threw === null, 'updateHUD 正常 tick 不抛错', threw && threw.stack);

const hudOres = doc.getElementById('bm-hud-ores');
let oreChips = findAll(hudOres, 'ore-chip');
ok(oreChips.map((c) => c.dataset.ore).join(',') === 'stone,coal', '采石场只显示该关存在的石头 / 煤矿两格（读 zone.ores）', oreChips.map((c) => c.dataset.ore).join(','));
ok(!!doc.getElementById('bm-count-stone') && !!doc.getElementById('bm-count-coal'), 'bm-count-stone / bm-count-coal 齐备');
ok(doc.getElementById('bm-count-iron') === null && doc.getElementById('bm-count-crystal') === null, '采石场不渲染铁矿 / 晶石格子');
ok(doc.getElementById('bm-count-stone').textContent === '5' && doc.getElementById('bm-count-coal').textContent === '7', '矿种计数分别写入', [doc.getElementById('bm-count-stone').textContent, doc.getElementById('bm-count-coal').textContent].join('/'));
ok(oreChips[0].textContent.indexOf('石头') >= 0 && oreChips[1].textContent.indexOf('煤矿') >= 0, '计数格带矿种名', oreChips.map((c) => c.textContent).join('|'));
let oreBlocks = findAll(hudOres, 'ore-block');
ok(oreBlocks.length === 2, '每格一个 CONFIG 配色色块图标（.ore-block）', 'count=' + oreBlocks.length);
ok(oreBlocks.every((b) => typeof b.style.background === 'string' && b.style.background.length > 0), '色块背景取自 CONFIG 配色', oreBlocks.map((b) => b.style.background).join(','));

const timeNode = doc.getElementById('bm-hud-time');
ok(timeNode.textContent === '10s', '倒计时取整显示 10s', timeNode.textContent);
ok(!timeNode.classList.contains('urgent'), '剩余 >5 秒不进入急迫态');

/* 换关：矿格按该关 zone.ores 过滤（关 id 与矿种都从 CONFIG 取） */
const zoneOreIds = (zid) => {
  const z = zoneCfg(zid);
  const ids = (z.ores || []).map((e) => e.ore);
  return ORE_IDS.filter((id) => ids.indexOf(id) >= 0);
};
const coalIronZone = CONFIG.zones.filter((z) => {
  const ids = (z.ores || []).map((e) => e.ore);
  return ids.indexOf('coal') >= 0 && ids.indexOf('iron') >= 0;
})[0];
const crystalZone = CONFIG.zones.filter((z) => (z.ores || []).some((e) => e.ore === 'crystal'))[0];
CORE.state.currentZone = coalIronZone.id;
BM.UI.updateHUD({ timeLeft: 9, counts: { coal: 4, iron: 9 }, coins: 20n });
oreChips = findAll(doc.getElementById('bm-hud-ores'), 'ore-chip');
ok(oreChips.map((c) => c.dataset.ore).join(',') === zoneOreIds(coalIronZone.id).join(','),
  coalIronZone.name + ' 显示该关的矿格（' + zoneOreIds(coalIronZone.id).join('/') + '）', oreChips.map((c) => c.dataset.ore).join(','));
CORE.state.currentZone = crystalZone.id;
BM.UI.updateHUD({ timeLeft: 8, counts: { iron: 2, crystal: 4 }, coins: 20n });
oreChips = findAll(doc.getElementById('bm-hud-ores'), 'ore-chip');
ok(oreChips.map((c) => c.dataset.ore).join(',') === zoneOreIds(crystalZone.id).join(','),
  crystalZone.name + ' 显示该关的矿格（' + zoneOreIds(crystalZone.id).join('/') + '）', oreChips.map((c) => c.dataset.ore).join(','));
/* ---- 金矿（v10）：chip 用 CONFIG 金色配色，图标复用煤矿图标金色化 ---- */
const goldChip = oreChips.filter((c) => c.dataset.ore === 'gold')[0];
ok(!!goldChip, '熔岩边缘的矿格里有金矿', oreChips.map((c) => c.dataset.ore).join(','));
const goldBlock = goldChip ? findAll(goldChip, 'ore-block')[0] : null;
const goldSpeck = goldChip ? findAll(goldChip, 'ore-speck')[0] : null;
ok(!!goldBlock && goldBlock.style.background === CONFIG.ores.gold.color, '金矿色块 = CONFIG.ores.gold.color', goldBlock && goldBlock.style.background);
ok(!!goldSpeck && goldSpeck.style.background === CONFIG.ores.gold.vein, '金矿矿斑 = CONFIG.ores.gold.vein（#ffc857）', goldSpeck && goldSpeck.style.background);
ok(CONFIG.ores.gold.vein === '#ffc857', '金矿主色就是 #ffc857', CONFIG.ores.gold.vein);
ok(!!goldChip && goldChip.textContent.indexOf('金矿') >= 0, 'chip 文字是「金矿」', goldChip && goldChip.textContent);

/* 色相工具：金矿最终绘制色必须落在金色区间，且饱和度明显高于煤矿（灰/黑） */
const rgbOf = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const hueSat = (rgb) => {
  const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0.0001) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: mx > 0 ? d / mx : 0, v: mx };
};
const goldMid = BM.UI._goldRamp(125, 125, 125);      // 中灰 → 金色中段
const goldDark = BM.UI._goldRamp(18, 18, 18);        // 煤矿暗斑 → 金色暗端
const goldLight = BM.UI._goldRamp(220, 220, 220);    // 煤矿亮斑 → 金色亮端
const hsMid = hueSat(goldMid), hsDark = hueSat(goldDark), hsLight = hueSat(goldLight);
ok(hsMid.h > 28 && hsMid.h < 52 && hsMid.s > 0.5, '金色化中段落在金色色相区间（h=' + hsMid.h.toFixed(0) + '°, s=' + hsMid.s.toFixed(2) + '）');
ok(hsDark.h > 28 && hsDark.h < 52 && hsDark.s > 0.5, '金色化暗端也在金色区间（h=' + hsDark.h.toFixed(0) + '°, s=' + hsDark.s.toFixed(2) + '）');
ok(hsLight.h > 28 && hsLight.h < 52 && hsLight.s > 0.5, '金色化亮端也在金色区间（h=' + hsLight.h.toFixed(0) + '°, s=' + hsLight.s.toFixed(2) + '）');
const coalSpeck = hueSat(rgbOf(CONFIG.ores.coal.vein));
ok(coalSpeck.s < 0.12 && hsMid.s > coalSpeck.s + 0.4, '煤矿矿斑是中性灰/黑（s=' + coalSpeck.s.toFixed(2) + '），金矿饱和度高出 0.4 以上', 'coal.s=' + coalSpeck.s.toFixed(3));
ok(CONFIG.ores.gold.vein === '#ffc857' && hueSat(rgbOf('#ffc857')).h > 30 && hueSat(rgbOf('#ffc857')).h < 50,
  'CONFIG 里金矿的 #ffc857 本身就在金色色相区间');

/* 金矿图标：复用煤矿图标（icons.ore_coal）并金色化 → data URL；没有可画布时回退色块 */
const realCreate = doc.createElement;
const goldOps = [];
doc.createElement = (t) => {
  const el = realCreate(t);
  if (String(t).toLowerCase() === 'canvas') {
    el.getContext = (kind) => (kind === '2d' ? {
      drawImage() { goldOps.push('draw'); },
      getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(Math.max(4, w * h * 4)) }; },
      putImageData() { goldOps.push('put'); },
      fillRect() {}, clearRect() {}
    } : null);
    el.toDataURL = () => 'data:image/png;base64,GOLD-ICON';
  }
  return el;
};
const goldURL = BM.UI._goldIconURL();
doc.createElement = realCreate;
ok(goldURL === 'data:image/png;base64,GOLD-ICON', '金矿图标由煤矿图标经 canvas 金色化导出 data URL（零外部资源）', String(goldURL));
ok(goldOps.indexOf('draw') >= 0 && goldOps.indexOf('put') >= 0, '金色化流程真的把源图像素重映射后写回（drawImage → getImageData → putImageData）', goldOps.join(','));
ok(BM.UI.oreIconURL('gold') === goldURL, 'oreIconURL(gold) 走金色化缓存');
ok(BM.UI.oreIconURL('coal') === 'data:image/png;base64,ART-icons.ore_coal', 'oreIconURL(coal) 仍取煤矿原图（金矿复用它的金色化副本）');

const crystalChip = oreChips.filter((c) => c.dataset.ore === 'crystal')[0];
const crystalBlock = findAll(crystalChip, 'ore-block')[0];
const crystalSpeck = findAll(crystalChip, 'ore-speck')[0];
ok(!!crystalBlock && crystalBlock.style.background === CONFIG.ores.crystal.color, '晶石色块 = CONFIG.ores.crystal.color（紫青）', crystalBlock && crystalBlock.style.background);
ok(!!crystalSpeck && crystalSpeck.style.background === CONFIG.ores.crystal.vein, '晶石矿斑 = CONFIG.ores.crystal.vein', crystalSpeck && crystalSpeck.style.background);
ok(findAll(doc.getElementById('bm-hud-ores'), 'ore-chip').length === 2, '任何时候都只渲染当前关的两格', String(findAll(doc.getElementById('bm-hud-ores'), 'ore-chip').length));
CORE.state.currentZone = 'quarry';
BM.UI.updateHUD({ timeLeft: 5, counts: { stone: 5, coal: 7, iron: 2, crystal: 3 }, coins: 20n, combo: 6, frenzy: 0 });
ok(timeNode.textContent === '5s', '倒计时 5s', timeNode.textContent);
ok(timeNode.classList.contains('urgent'), '≤5 秒切换 urgent（红色脉冲）态');
ok(doc.getElementById('bm-hud').classList.contains('urgent'), 'HUD 根节点也进入 urgent 态');
ok(doc.getElementById('bm-hud-coins').textContent === '20', 'HUD 金币 = 20');
ok(doc.getElementById('bm-combo-fill').style.width === '75.0%', '连击条 6/8 = 75.0%', doc.getElementById('bm-combo-fill').style.width);
ok(doc.getElementById('bm-tool-name').textContent === '木镐', 'HUD 显示当前工具名', doc.getElementById('bm-tool-name').textContent);
ok(doc.getElementById('bm-tool-name').textContent !== '激光钻', 'HUD 工具名不会串到别的工具');

// v14：可放置 TNT 删除 → HUD 的 TNT 按钮（含「未解锁」占位）整套下线
ok(!doc.getElementById('bm-btn-tnt'), 'HUD 没有 TNT 按钮（可放置 TNT 已删除）');
ok(!doc.getElementById('bm-tnt-count'), 'HUD 没有 TNT 数量角标');
ok(!findAll(doc.getElementById('bm-hud'), 'hud-tnt') || findAll(doc.getElementById('bm-hud'), 'hud-tnt').length === 0, 'hud 子树里没有 .hud-tnt 节点');
ok(typeof BM.UI.setTNTArmed !== 'function', '08-ui 不再暴露 setTNTArmed');
ok(BM.UI.updateHUD({ explosiveLeft: 2 }) === undefined, 'updateHUD 不再消费 explosiveLeft（多余字段被忽略、不报错）');

BM.UI.updateHUD({ timeLeft: 12, counts: { stone: 5, coal: 7 }, coins: 20n, combo: 0, frenzy: { left: 2, mult: 2 } });
ok(!timeNode.classList.contains('urgent'), '时间回升后 urgent 态移除');
ok(doc.getElementById('bm-frenzy-row').classList.contains('active'), 'frenzy>0 时狂热条显示');

threw = null;
try { BM.UI.updateHUD({}); BM.UI.updateHUD(null); BM.UI.updateHUD({ timeLeft: 0, counts: null, combo: null }); } catch (e) { threw = e; }
ok(threw === null, '残缺/空 tick 不抛错');

/* ---------------- 6. 结算 ---------------- */
section('结算 renderResult（含主线通关大字）');
const result = {
  zoneId: 'quarry',
  counts: { stone: 40, coal: 12, iron: 3, crystal: 0 },
  lines: [
    { ore: 'stone', name: '石头', count: 40, price: 1, subtotal: '40' },
    { ore: 'coal', name: '煤矿', count: 12, price: 6, subtotal: '72' },
  ],
  coinsEarned: '1250',
  coinsTotal: '1270',
  coinsTotalAbbr: '1.27K',
  stats: { brokenBlocks: 88, maxCombo: 14, explosions: 3, maxChain: 5 },
  unlocked: ['tool:iron'],
  objective: { ore: 'coal', need: 50, have: 20, done: false },
  recommendUpgrade: null,
  nextZoneId: 'ironmine',
};
threw = null;
try { BM.UI.renderResult(result); } catch (e) { threw = e; }
ok(threw === null, 'renderResult 不抛错', threw && threw.stack);
ok(doc.getElementById('bm-screen-result').classList.contains('is-active'), '结算界面已激活');
ok(doc.getElementById('bm-res-lines').textContent.indexOf('石头 ×40') >= 0, '结算列出矿种 × 数量', doc.getElementById('bm-res-lines').textContent);


ok(doc.getElementById('bm-res-broken').textContent === '88' && doc.getElementById('bm-res-combo').textContent === '14' && doc.getElementById('bm-res-explosions').textContent === '3', '破坏格数/最大连击/爆破次数');
ok(doc.getElementById('bm-res-unlock').textContent.indexOf('铁镐') >= 0, '新解锁文案含铁镐', doc.getElementById('bm-res-unlock').textContent);
ok(doc.getElementById('bm-res-unlock').classList.contains('show'), '有解锁时解锁条显示');
ok(!doc.getElementById('bm-res-clear').classList.contains('show'), '未通关时通关大字隐藏');
const totalNode = doc.getElementById('bm-res-total');
ok(rafQueue.length === 1, '渲染后启动了扫描帧（滚动动画）', String(rafQueue.length));
rafQueue.shift()(0);
rafQueue.shift()(380);
ok(totalNode.textContent !== '1,250' && totalNode.textContent !== '', '滚动中显示中间值', totalNode.textContent);
fire(doc.getElementById('bm-screen-result'), 'click');
ok(totalNode.textContent === '1,250', '点击跳过立刻显示终值 1,250', totalNode.textContent);

/* 结算明细新增金矿：有独立一行、图标复用煤矿金色化、并挂 data-ore 供 CSS 上金色 */
const goldResult = {
  zoneId: 'lavaEdge',
  lines: [
    { ore: 'gold', name: '金矿', count: 2, price: 150, subtotal: '300' },
    { ore: 'crystal', name: '晶石', count: 1, price: 400, subtotal: '400' }
  ],
  coinsEarned: '700', coinsTotal: '700', stats: { brokenBlocks: 1, maxCombo: 1, explosions: 0 },
  unlocked: [], objective: null, nextZoneId: null
};
BM.UI.renderResult(goldResult);
const resLines = doc.getElementById('bm-res-lines');
const goldRow = findAll(resLines, 'res-line').filter((n) => n.dataset.ore === 'gold')[0];
ok(!!goldRow, '结算明细出现金矿行（data-ore=gold）', findAll(resLines, 'res-line').map((n) => n.dataset.ore).join(','));
ok(!!goldRow && goldRow.textContent.indexOf('金矿 ×2') >= 0 && goldRow.textContent.indexOf('+300') >= 0,
  '金矿行显示「金矿 ×2 / 150 × 2 / +300」', goldRow && goldRow.textContent);
const coalRow = null;   // 金矿行必须能被 CSS 单独着色
ok(/\.res-line\[data-ore="gold"\] \.res-ore \{[^}]*#ffc857/.test(css), 'style.css 给金矿结算行上金色 #ffc857');
ok(/\.ore-chip\[data-ore="gold"\] \.ore-name \{[^}]*#ffc857/.test(css), 'style.css 给金矿 chip 名字上金色 #ffc857');

BM.UI.renderResult(result);
const seen = [];
for (const ts of [0, 120, 240, 360, 480, 600, 720, 840, 960]) {
  const fn = rafQueue.shift();
  if (!fn) break;
  fn(ts);
  seen.push(Number(doc.getElementById('bm-res-total').textContent.replace(/,/g, '')));
}
ok(seen.length >= 3, '滚动至少产生 3 帧中间值', seen.join(' → '));
ok(seen.every((v) => Number.isFinite(v)), '滚动帧都是纯数字');
ok(seen.every((v) => v <= 1250), '滚动过程不出现大于终值的数');
ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), '滚动值单调不减');
ok(doc.getElementById('bm-res-total').textContent === '1,250', '滚动结束后严格等于终值', doc.getElementById('bm-res-total').textContent);
ok(doc.getElementById('bm-btn-continue').textContent === '继续挖' && doc.getElementById('bm-btn-back').textContent === '回营地', '两个主按钮文案正确');
threw = null;
try { BM.UI.renderResult({ zoneId: 'quarry', lines: [], stats: {}, unlocked: [], coinsEarned: '0' }); } catch (e) { threw = e; }
ok(threw === null, '空结算（无收获）不抛错');
ok(!doc.getElementById('bm-res-clear').classList.contains('show'), '缺 objective 的结算不显示通关大字');

/* 最后一关达标：objective.done && nextZoneId === null → 通关大字替换解锁条 */
const finalResult = {
  zoneId: LAST_ZONE_ID,
  counts: { iron: 12, crystal: 20 },
  lines: [{ ore: 'crystal', name: '晶石', count: 20, price: 400, subtotal: '8000' }],
  coinsEarned: '8000',
  coinsTotal: '9270',
  coinsTotalAbbr: '9.27K',
  stats: { brokenBlocks: 210, maxCombo: 22, explosions: 6, maxChain: 5 },
  unlocked: [],
  objective: { ore: 'crystal', need: 20, have: 20, done: true },
  recommendUpgrade: null,
  nextZoneId: null,
};
threw = null;
try { BM.UI.renderResult(finalResult); } catch (e) { threw = e; }
ok(threw === null, '最后一关达标结算不抛错', threw && threw.stack);
const clearNode = doc.getElementById('bm-res-clear');
ok(clearNode.classList.contains('show'), 'objective.done + nextZoneId=null → 显示主线通关', JSON.stringify(finalResult.objective));
ok(clearNode.textContent.indexOf('主线通关') >= 0, '通关大字文案 = 主线通关', clearNode.textContent);
const clearMain = findAll(clearNode, 'res-clear-main')[0];
ok(!!clearMain && clearMain.textContent === '主线通关', '通关大字在 .res-clear-main 里', clearMain && clearMain.textContent);
ok(!doc.getElementById('bm-res-unlock').classList.contains('show'), '通关时解锁条让位（不显示）');
ok(doc.getElementById('bm-res-zone').textContent === zoneCfg(LAST_ZONE_ID).name, '通关结算显示最后一关（' + zoneCfg(LAST_ZONE_ID).name + '）', doc.getElementById('bm-res-zone').textContent);
ok(doc.getElementById('bm-res-clear-sub').textContent === CONFIG.zones.length + ' 关全部达标 · 矿区不再有新的层',
  '通关副标题按 CONFIG.zones 长度现算（7 关）', doc.getElementById('bm-res-clear-sub').textContent);
ok(!doc.getElementById('bm-res-next').classList.contains('show'), '通关结算不再显示「下一关」');
fire(doc.getElementById('bm-screen-result'), 'click');

const MID_ZONE = CONFIG.zones[1];
const MID_NEXT = zoneCfg(MID_ZONE.nextZone);
BM.UI.renderResult({
  zoneId: MID_ZONE.id, lines: [], stats: {}, unlocked: [], coinsEarned: '0',
  objective: { ore: MID_ZONE.objective.ore, need: 30, have: 30, done: true }, nextZoneId: MID_ZONE.nextZone,
});
ok(!doc.getElementById('bm-res-clear').classList.contains('show'), '非最后一关达标不算通关（nextZoneId 不为 null）');
const resNext = doc.getElementById('bm-res-next');
ok(!!resNext, '结算页有「下一关」行 #bm-res-next');
ok(resNext.textContent === '下一关 · ' + MID_NEXT.name && resNext.classList.contains('show'),
  '结算「下一关」= nextZoneId 查 zones 表', resNext.textContent);

/* 缺 nextZoneId 时回落到 zones[].nextZone，仍然查表而不是写死 */
BM.UI.renderResult({ zoneId: MID_ZONE.id, lines: [], stats: {}, unlocked: [], coinsEarned: '0' });
ok(resNext.textContent === '下一关 · ' + MID_NEXT.name,
  '缺 nextZoneId → 回落到 zones[].nextZone 查表', resNext.textContent);

BM.UI.renderResult({
  zoneId: 'crystalcave', lines: [], stats: {}, unlocked: [], coinsEarned: '0',
  objective: { ore: 'crystal', need: 20, have: 4, done: false }, nextZoneId: null,
});
ok(!doc.getElementById('bm-res-clear').classList.contains('show'), '最后一关未达标不显示通关大字');
fire(doc.getElementById('bm-screen-result'), 'click');

/* ---------------- 7. handlers 回调 ---------------- */
section('交互回调');
BM.UI.showScreen('camp');
BM.UI.renderCamp();
fire(startBtn, 'click');
ok(handlers.start.length === 1 && handlers.start[0] === 'quarry', '点击开始 → onStartRound(当前矿区)', JSON.stringify(handlers.start));
fire(toolCards[0], 'click');
ok(handlers.tool.length === 1 && handlers.tool[0] === 'wood', '点击已解锁工具卡 → onSelectTool(wood)', JSON.stringify(handlers.tool));
fire(toolCards[3], 'click');
ok(handlers.tool.length === 1, '点击未解锁的钻石镐卡不触发回调');
ok(!doc.getElementById('bm-btn-upgrades'), '营地 dock 不再有「强化」按钮（TREE-V7 §2 已删除）');

fire(doc.getElementById('bm-btn-talents'), 'click');
ok(doc.getElementById('bm-drawer-talents').classList.contains('is-open'), '点「天赋」打开抽屉');
fire(doc.getElementById('bm-btn-talents-close'), 'click');
ok(!doc.getElementById('bm-drawer-talents').classList.contains('is-open'), '关闭天赋抽屉');
fire(doc.getElementById('bm-btn-hud-mute'), 'click');
ok(handlers.mute === 1, 'HUD 静音按钮 → onToggleMute');
BM.UI.setMuted(true);
ok(doc.getElementById('bm-btn-mute').textContent === '已静音', 'setMuted(true) 后按钮文案更新', doc.getElementById('bm-btn-mute').textContent);
BM.UI.setMuted(false);

fire(doc.getElementById('bm-btn-settings'), 'click');
fire(doc.getElementById('bm-btn-reset-save'), 'click');
ok(doc.getElementById('bm-confirm').classList.contains('is-open'), '点「重置存档」弹出二次确认');
ok(handlers.resetSave === 0, '确认前不触发 onResetSave');
fire(doc.getElementById('bm-confirm-cancel'), 'click');
ok(!doc.getElementById('bm-confirm').classList.contains('is-open') && handlers.resetSave === 0, '取消后关闭且不触发');
fire(doc.getElementById('bm-btn-reset-save'), 'click');
fire(doc.getElementById('bm-confirm-ok'), 'click');
ok(handlers.resetSave === 1, '确认后触发 onResetSave');

section('画质与震动开关');
const qBtn = doc.getElementById('bm-btn-quality');
const hqBtn = doc.getElementById('bm-btn-hud-quality');
const shBtn = doc.getElementById('bm-btn-shake');
ok(!!qBtn && qBtn.textContent === '高', '设置里有画质按钮，初始文案「高」', qBtn && qBtn.textContent);
ok(!!hqBtn && hqBtn.textContent === '高', 'HUD 有画质小按钮，初始文案「高」', hqBtn && hqBtn.textContent);
ok(!!shBtn && shBtn.textContent === '开', '震动开关占位存在');
fire(qBtn, 'click');
ok(handlers.quality === 1, '点画质 → onCycleQuality 回调一次');
ok(qBtn.textContent === '中' && hqBtn.textContent === '中', 'main 回写 setQualityLabel 后两处按钮同步为「中」');
handlers.qualitySilent = true;
fire(hqBtn, 'click');
ok(qBtn.textContent === '低' && hqBtn.textContent === '低', 'handler 未回写时 UI 自行循环到「低」', qBtn.textContent);
BM.UI.setQualityLabel('高');
handlers.qualitySilent = false;
fire(shBtn, 'click');
ok(handlers.shake === 1 && shBtn.textContent === '关', '震动开关点击回调并切文案', shBtn.textContent);
fire(shBtn, 'click');
ok(handlers.shake === 2 && shBtn.textContent === '开', '震动开关再次点击恢复');

BM.UI.showScreen('result');
fire(doc.getElementById('bm-btn-continue'), 'click');
ok(handlers.next === 1, '继续挖 → onNextRound');
fire(doc.getElementById('bm-btn-back'), 'click');
ok(handlers.back === 1, '回营地 → onBackToCamp');

threw = null;
try { BM.UI.toast('测试提示'); BM.UI.toast(''); } catch (e) { threw = e; }
ok(threw === null && doc.getElementById('bm-toast').textContent === '测试提示', 'toast 写入文本且不抛错');
threw = null;
try { BM.UI.init(host, {}); } catch (e) { threw = e; }
ok(threw === null, '重复 init 幂等不抛错');

/* ---------------- 8. 静态约束 ---------------- */
section('静态约束（CSS / 文件形态）');
const all = css + audioSrc + uiSrc;
const flat = (s) => s.split('\n').join(' ').split('\r').join(' ').replace(/ +/g, ' ');

ok(/--tap: *44px/.test(css) && /min-height: *var\(--tap\)/.test(css), 'CSS 含 44px 触控基准（--tap）');

const cssRules = [];
const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
let rm;
while ((rm = ruleRe.exec(css))) cssRules.push({ sel: rm[1].trim(), body: rm[2] });
const bodyOf = (sel) => {
  const hit = cssRules.filter((r) => r.sel === sel)[0];
  return hit ? hit.body : '';
};
const toolRules = cssRules.filter((r) => /\.tool-row|\.tool-card/.test(r.sel));
ok(toolRules.length >= 4, '.tool-row/.tool-card 相关规则存在', 'rules=' + toolRules.length);
const hidden = toolRules.filter((r) => /(^|[; ])height: *0(?![.0-9])/.test(r.body) || /display: *none/.test(r.body) || /opacity: *0(?![.0-9])/.test(r.body));
ok(hidden.length === 0, '.tool-row/.tool-card 无 height:0 / display:none / opacity:0', JSON.stringify(hidden));
const lockRules = toolRules.filter((r) => /\.tool-card\.locked/.test(r.sel));
ok(lockRules.length === 1 && /opacity: *0?[.][0-9]/.test(lockRules[0].body), '唯一半透明只作用于 .tool-card.locked 锁态', lockRules[0] && lockRules[0].body.trim());
ok(/\.tool-row *\{[^}]*display: *flex/.test(css), '.tool-row 的 display:flex 未被覆盖');
ok(/\.tool-card *\{[^}]*min-height: *128px/.test(css), '.tool-card 有 128px 最小高度（保证有体积）');
const toolCardCss = bodyOf('.tool-card');
ok(toolCardCss.indexOf('border-image-source: var(--art-ui-card') >= 0 && /border-image-slice: *[1-8]/.test(toolCardCss) && /border-image-repeat: *stretch/.test(toolCardCss), '.tool-card 只把 ui.card 当九宫格描框（slice ≤8 / stretch），不缩放整图', toolCardCss.replace(/\s+/g, ' ').slice(0, 140));
ok(toolCardCss.indexOf('background-image') < 0, '.tool-card 不把 24×24 的 ui.card 铺成整张底图（避免砖格/粗边）');
ok(/box-shadow:[^;]*inset/.test(toolCardCss), '.tool-card 有内高光（inset box-shadow）');
ok(/\.talent-chip\.zonelocked *\{[^}]*opacity/.test(css), '关未开的徽章更暗（不是隐藏，仍看得见）');
ok(/\.talent-stage *\{[^}]*overflow: *hidden/.test(css), '可视区裁剪外圈（靠拖动/缩放看，不是把抽屉撑大）');
const cardBox = bodyOf('.tool-card');
const mh = /min-height: *([0-9]+)px/.exec(cardBox);
const mw = /min-width: *([0-9]+)px/.exec(cardBox);
ok(!!mh && Number(mh[1]) >= 44 && !!mw && Number(mw[1]) >= 44, '工具卡每张可点区域 ≥44px（min-height / min-width）', 'h=' + (mh && mh[1]) + ' w=' + (mw && mw[1]));
ok(/\.tool-row *\{[^}]*overflow-x: *auto/.test(css), '六张卡放不下时横向滚动（.tool-row overflow-x:auto）');

const linesRule = /\.res-lines *\{([^}]*)\}/.exec(css);
ok(!!linesRule, '.res-lines 规则存在');
const lb = linesRule ? linesRule[1] : '';
ok(/max-height: *388px/.test(lb), '.res-lines 有 max-height 上限 388px');
ok(!/min-height:/.test(lb), '.res-lines 已去掉 min-height');
ok(/overflow-y: *auto/.test(lb), '.res-lines 超上限后内部滚动');
ok(/\.res-actions *\{[^}]*margin-top: *auto/.test(css), '两个主按钮贴底（.res-actions margin-top:auto）');

ok(/\.res-clear *\{[^}]*display: *none/.test(css), '通关大字默认隐藏（.res-clear）');
ok(/\.res-clear\.show *\{[^}]*display: *block/.test(css), '通关大字用 .res-clear.show 打开');
ok(/-webkit-text-stroke: *1px #ffe9a8/.test(bodyOf('.res-clear-main')), '通关大字带金色描边（-webkit-text-stroke）');
ok(/\.zone-clear\.show *\{[^}]*display: *block/.test(css), '营地通关徽标用 .zone-clear.show 打开');

/* 放射树静态约束：圆形徽章 + 三态连线 + 抽屉可滚动 + TNT 置灰态 */
ok(/\.talent-body *\{[^}]*padding/.test(css), '.talent-body 规则存在');
ok(/\.drawer-body *\{[^}]*overflow-y: *auto/.test(css), '抽屉主体纵向滚动');
ok(/\.talent-map *\{[^}]*position: *absolute[^}]*transform-origin/.test(css), '.talent-map 是 transform 层（平移与缩放都作用在它身上）');
ok(/\.talent-chip *\{[^}]*width: *92px[^}]*height: *76px[^}]*box-sizing: *border-box/.test(css),
  '格子 92×76 + border-box（三段命中区，border 撑不坏尺寸）');
ok(/\.talent-node *\{[^}]*box-sizing: *border-box[^}]*border-radius: *[0-9]+px/.test(css),
  '.talent-node = border-box + border-radius（v17 方形节点）');
ok(/\.talent-chip\.center \.talent-node *\{[^}]*border-color: *var\(--gold\)/.test(css), '中心徽章用金色描边（直径由 08-ui 写成 56px）');
ok(/\.talent-node \.talent-ico *\{[^}]*width: *18px[^}]*height: *18px/.test(css), '徽章内的画布图标 18×18（34px 徽章里放得下）');
ok(/\.talent-node \.talent-ico *\{[^}]*-webkit-mask-size: *100% 100%/.test(css) && /\.talent-node \.talent-ico *\{[^}]*mask-size: *100% 100%/.test(css),
  '图标用 mask 上色（size 100% 100%，颜色跟徽章状态走）', (/\.talent-node \.talent-ico *\{[^}]*\}/.exec(css) || [''])[0].replace(/\s+/g, ' ').slice(0, 110));
ok(/\.talent-node\.pop *\{[^}]*animation: *bm-node-pop/.test(css) && /@keyframes bm-node-pop/.test(css),
  '购买后徽章弹一下（.talent-node.pop → bm-node-pop，动画落在圆上）');
ok(/\.talent-link\.owned *\{[^}]*stroke: *var\(--orange\)/.test(css), '已购连线 = 亮橙实线');
ok(/\.talent-link\.available *\{[^}]*stroke-dasharray/.test(css), '可买连线 = 虚线');
ok(/\.talent-link\.locked *\{[^}]*stroke: *rgba/.test(css), '未解锁连线 = 暗灰');
ok(/\.talent-chip\.available \.talent-node *\{[^}]*animation: *bm-node-breathe/.test(css) && /@keyframes bm-node-breathe/.test(css),
  '可买徽章 = 橙描边 + 呼吸动画');
ok(/background-color: *var\(--orange\)/.test(css.slice(css.indexOf('.talent-chip.owned .talent-node'))), '已购徽章 = 实心橙');
ok(/\.talent-zoom *\{[^}]*position: *absolute[^}]*right:/.test(css) && /\.talent-zoom-btn *\{/.test(css), '缩放按钮钉在右下角');
ok(/\.ore-block *\{/.test(css) && /\.ore-speck *\{/.test(css), '矿物色块与矿斑样式存在');

ok(/font-family: *var\(--font\)/.test(css) || /--font:/.test(css), '系统字体栈，无外部字体');
ok(css.indexOf('@font-face') < 0 && css.indexOf('@import') < 0 && css.indexOf('url(') < 0, 'CSS 无 @font-face/@import/url() 外部资源');
// SVG 命名空间是常量标识符（不发起请求），断言时先剔除，再查是否还有别处的 http(s)
const allNoNs = all.split('http://www.w3.org/2000/svg').join('');
ok(allNoNs.indexOf('http') < 0 && all.indexOf('//cdn') < 0, '除 SVG 命名空间外零 http(s) / CDN 链接');
ok(all.indexOf('fetch(') < 0 && all.indexOf('XMLHttpRequest') < 0 && all.indexOf('import(') < 0, '无网络请求 API');
ok(all.indexOf('MC') < 0 && all.toLowerCase().indexOf('minecraft') < 0 && all.indexOf('我的世界') < 0, '无 Minecraft/我的世界/MC 字样');

for (const f of ['src/07-audio.js', 'src/08-ui.js']) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  ok(src.indexOf("'use strict';") >= 0 && src.indexOf('(function () {') >= 0, f + ' 用 IIFE + use strict 包裹');
  ok(src.trim().endsWith('})();'), f + ' 以 })(); 收尾');
  const esmLines = src.split('\n').filter((l) => /^(import|export) /.test(l.trim()));
  ok(esmLines.length === 0, f + ' 无 ESM import/export');
  ok(src.indexOf('.#') < 0, f + ' 无 class 私有字段');
  ok(src.indexOf('await ') < 0, f + ' 无顶层 await');
}
ok(uiSrc.indexOf('BM.UI = {') > 0 && uiSrc.indexOf('init: init') > 0, '08-ui.js 暴露 BM.UI API');
ok(uiSrc.indexOf('setTNTArmed') < 0, '08-ui.js 里 setTNTArmed 已彻底删除');
ok(audioSrc.indexOf('BM.AUDIO = API') > 0, '07-audio.js 暴露 BM.AUDIO');
for (const n of ['stoneHit', 'ironHit', 'layerBreak', 'tntFuse', 'tntBoom', 'emptied', 'laserTick', 'quakeBlast', 'luckyTNT']) {
  ok(audioSrc.indexOf('SOUNDS.' + n + ' = function') > 0, '07-audio.js 注册音效 ' + n);
}

/* ---------------- 8b. v6：胜利覆盖层 / 营地已通关角标 / 多级天赋 Lv ---------------- */
section('v6 胜利覆盖层 showVictory（铺满 390×844 / 大字 + 副标题 / 三格统计 / 两个按钮 / 缺字段占位）');
const victoryLayer = doc.getElementById('bm-ui');
const vicNode = doc.getElementById('bm-victory');
ok(typeof BM.UI.showVictory === 'function' && typeof BM.UI.hideVictory === 'function',
  'BM.UI.showVictory / hideVictory 已暴露（09-main 调用）');
ok(!!vicNode && isAttached(vicNode, victoryLayer), '#bm-victory 挂在 #bm-ui 上');
ok(!vicNode.classList.contains('show'), '默认不显示（没有 .show 类）');

let vicErr = null;
try { BM.UI.showVictory({}); } catch (e) { vicErr = e; }
ok(vicErr === null, 'showVictory({}) 不抛错', vicErr && vicErr.stack);
ok(vicNode.classList.contains('show'), 'showVictory 后带 .show（CSS 才铺满并播进场动画）');
ok(doc.getElementById('bm-victory-title').textContent === '游戏胜利', '大字标题 = 游戏胜利', doc.getElementById('bm-victory-title').textContent);
ok(doc.getElementById('bm-victory-sub').textContent === '你挖到了地心宝藏', '副标题 = 你挖到了地心宝藏', doc.getElementById('bm-victory-sub').textContent);
const vicStats = doc.getElementById('bm-victory-stats');
ok(!!vicStats && findAll(vicStats, 'stat-cell').length === 3, '三格统计', vicStats && String(findAll(vicStats, 'stat-cell').length));
ok(findAll(vicStats, 'stat-label').map((n) => n.textContent).join('|') === '总局数|累计金币|用时',
  '三格标签 = 总局数 / 累计金币 / 用时', findAll(vicStats, 'stat-label').map((n) => n.textContent).join('|'));
const VIC_IDS = ['bm-victory-rounds', 'bm-victory-coins', 'bm-victory-time'];
ok(VIC_IDS.every((id) => doc.getElementById(id).textContent === '\u2013'),
  'data 缺字段时三格都是占位符 – （不抛错、不显示 undefined/NaN）', VIC_IDS.map((id) => doc.getElementById(id).textContent).join('|'));

/* 全字段：总局数 / 累计金币（大数走 K/M/B，精确值在 title）/ 用时（毫秒 → N 分 M 秒） */
BM.UI.showVictory({ rounds: 154, coins: 1234567n, timeMs: 3725000 });
ok(doc.getElementById('bm-victory-rounds').textContent === '154', '总局数 = 154', doc.getElementById('bm-victory-rounds').textContent);
ok(doc.getElementById('bm-victory-coins').textContent === '1.23M' && doc.getElementById('bm-victory-coins').title === '1,234,567',
  '累计金币用缩写 + title 留精确值', doc.getElementById('bm-victory-coins').textContent + ' / ' + doc.getElementById('bm-victory-coins').title);
ok(doc.getElementById('bm-victory-time').textContent === '62 分 5 秒', '用时 3,725,000ms → 62 分 5 秒', doc.getElementById('bm-victory-time').textContent);
BM.UI.showVictory({ timeMs: 8400, timeText: null });
ok(doc.getElementById('bm-victory-time').textContent === '8 秒', '不足 1 分钟用时按秒显示', doc.getElementById('bm-victory-time').textContent);

/* 只给一部分字段：其余照旧留占位符（顺序也验证一遍，避免上一局的值残留） */
BM.UI.showVictory({ roundsPlayed: 12 });
ok(doc.getElementById('bm-victory-rounds').textContent === '12' &&
  doc.getElementById('bm-victory-coins').textContent === '\u2013' &&
  doc.getElementById('bm-victory-time').textContent === '\u2013',
  '只给 roundsPlayed 时其余两格仍是 –', VIC_IDS.map((id) => doc.getElementById(id).textContent).join('|'));
BM.UI.showVictory({ subtitle: '自定义副标题', timeText: '1 小时 02 分' });
ok(doc.getElementById('bm-victory-sub').textContent === '自定义副标题', 'subtitle 可覆盖副标题', doc.getElementById('bm-victory-sub').textContent);
ok(doc.getElementById('bm-victory-time').textContent === '1 小时 02 分', 'timeText 自带文案优先于 timeMs', doc.getElementById('bm-victory-time').textContent);
ok(findImgs(vicNode).length === 0, '覆盖层不用任何贴图（零 <img>）', 'count=' + findImgs(vicNode).length);
ok(findAll(vicNode, 'victory-btn').length === 0 && !!doc.getElementById('bm-btn-victory-next') && !!doc.getElementById('bm-btn-victory-camp'),
  '两个按钮「再挖一局」「回营地」都在', doc.getElementById('bm-btn-victory-next').textContent + ' / ' + doc.getElementById('bm-btn-victory-camp').textContent);

/* 两个按钮各自走 handlers，并且点完自动收起（不留一层挡住营地） */
BM.UI.init(host, HOOKS);                            // 上一节用 init(host, {}) 验幂等时把 H 换空了，这里装回来
const beforeNext = handlers.next;
const beforeBack = handlers.back;
BM.UI.showVictory({ rounds: 1 });
fire(doc.getElementById('bm-btn-victory-next'), 'click');
ok(handlers.next === beforeNext + 1, '「再挖一局」→ onNextRound', String(handlers.next));
ok(!vicNode.classList.contains('show'), '点「再挖一局」后覆盖层收起');
BM.UI.showVictory({ rounds: 1 });
fire(doc.getElementById('bm-btn-victory-camp'), 'click');
ok(handlers.back === beforeBack + 1, '「回营地」→ onBackToCamp', String(handlers.back));
ok(!vicNode.classList.contains('show'), '点「回营地」后覆盖层收起');
BM.UI.showVictory({ rounds: 1 });
BM.UI.showScreen('camp');
ok(!vicNode.classList.contains('show'), 'showScreen 切屏自动收起覆盖层');
ok(BM.UI.hideVictory() === true, 'hideVictory 幂等可用');
ok(!vicNode.classList.contains('show'), '隐藏后不带 .show');

/* 覆盖层静态形态：390×844 铺满、默认隐藏、.show 才 flex、0.6s 1.06 → 1.0 进场 */
const vicFlat = flat(css);
ok(/\.bm-victory *\{[^}]*width: *390px[^}]*height: *844px/.test(vicFlat), '覆盖层尺寸 = 设计空间 390×844');
ok(/\.bm-victory *\{[^}]*display: *none/.test(vicFlat), '覆盖层默认隐藏（.bm-victory display:none）');
ok(/\.bm-victory\.show *\{[^}]*display: *flex/.test(vicFlat), '.bm-victory.show 才铺开（flex 居中）');
ok(/\.bm-victory\.show *\{[^}]*animation: *bm-victory-in *0\.6s/.test(vicFlat), '进场动画 0.6 秒');
ok(/@keyframes bm-victory-in *\{ *from *\{[^}]*opacity: *0[^}]*scale\(1\.06\)[^}]*\} *to *\{[^}]*opacity: *1[^}]*scale\(1\)/.test(vicFlat),
  '进场动画 = 淡入 + 1.06 → 1.0 轻微缩放', (/@keyframes bm-victory-in[^@]*/.exec(vicFlat) || ['missing'])[0].slice(0, 120));
const titleBody = bodyOf('.victory-title');
const titleSize = Number((/font-size: *([0-9]+)px/.exec(titleBody) || [])[1]);
ok(titleSize >= 30 && titleSize <= 36, '标题字号落在 30–36px（' + titleSize + 'px）');
ok(titleBody.indexOf('-webkit-text-stroke') >= 0, '标题带金色描边');
ok(/\.victory-actions \.primary-btn/.test(vicFlat), '两个按钮等宽排成一行（.victory-actions）');

section('v6 营地「已通关」角标（CORE.state.victory === true 才出现）');
const campVic = doc.getElementById('bm-camp-victory');
const campScreen = doc.getElementById('bm-screen-camp');
ok(!!campVic && isAttached(campVic, campScreen), '#bm-camp-victory 挂在营地矿区卡里');
delete CORE.state.victory;
BM.UI.renderCamp();
ok(!campVic.classList.contains('show'), '没有 victory 字段时角标隐藏');
CORE.state.victory = false;
BM.UI.renderCamp();
ok(!campVic.classList.contains('show'), 'victory=false 时角标隐藏');
CORE.state.victory = true;
BM.UI.renderCamp();
ok(campVic.classList.contains('show'), 'CORE.state.victory=true → 角标显示');
ok(campVic.textContent === '已通关', '角标文案 = 已通关', campVic.textContent);
ok(isAttached(campVic, doc.getElementById('bm-tool-row') ? campScreen : campScreen), '角标仍在营地里');
delete CORE.state.victory;
BM.UI.renderCamp();
ok(!campVic.classList.contains('show'), '清掉 victory 后角标再次隐藏');
ok(/\.zone-victory *\{[^}]*position: *absolute/.test(vicFlat) && /\.zone-victory *\{[^}]*right:/.test(vicFlat),
  '角标纯 CSS 钉在矿区卡右上角');
ok(/\.zone-victory\.show *\{[^}]*display: *block/.test(vicFlat), '角标用 .zone-victory.show 打开');
ok(/\.zone-card *\{[^}]*position: *relative/.test(vicFlat), '矿区卡 position:relative 作为角标定位锚点');
ok(vicFlat.indexOf('url(') < 0, '新增样式不用任何 url() 资源');

section('v8 多级节点：Lv x/N 与下一级价格都走详情卡');
const multiNodes = TREE.nodes.filter((n) => (n.maxLevel || 1) > 1);
ok(multiNodes.length > 0, 'CONFIG.tree 里有多级节点（maxLevel>1）', multiNodes.map((n) => n.id).join(','));
const multi = multiNodes[0];
const multiMax = multi.maxLevel;
const savedSelfLv = CORE.nodeLevel(multi.id);
const savedReqLv = (multi.requires || []).map((r) => CORE.nodeLevel(r));
const savedMultiCoins = CORE.state.coins;
CORE.state.coins = BigInt('1000000000000000000');
(multi.requires || []).forEach((r) => { CORE.state.nodes[r] = 1; });
CORE.state.nodes[multi.id] = 1;
BM.UI.renderCamp();
tapNode(multi.id);                        // v8：点徽章 = 直接买 1 级
ok(CORE.nodeLevel(multi.id) === 2 && dState.textContent.indexOf('Lv 2/' + multiMax) >= 0,
  '点一次徽章 → 详情卡同步到「Lv 2/' + multiMax + '」', CORE.nodeLevel(multi.id) + ' / ' + dState.textContent);
ok(dCost.textContent === commaOf(CORE.nodeCost(multi.id)) + ' 金币', '价格 = 下一级价格（CORE.nodeCost，' + CORE.nodeCost(multi.id) + '）', dCost.textContent);
ok(buyBtn.getAttribute('disabled') !== 'disabled', '未满级的多级节点仍可购买');
const multiBtnCalls = handlers.buy.length;
fire(buyBtn, 'click');
ok(CORE.nodeLevel(multi.id) === 3 && handlers.buy.length === multiBtnCalls + 1,
  '详情卡购买按钮再升 1 级（Lv 3）', CORE.nodeLevel(multi.id));
CORE.state.nodes[multi.id] = multiMax;
BM.UI.renderCamp();
tapNode(multi.id);
ok(dState.textContent.indexOf('满级') >= 0 && dState.textContent.indexOf('Lv ' + multiMax + '/' + multiMax) >= 0,
  '满级显示「满级 · Lv N/N」', dState.textContent);
ok(dCost.textContent === '已满级', '满级不再显示价格', dCost.textContent);
ok(buyBtn.getAttribute('disabled') === 'disabled', '满级时购买按钮 disabled');
ok(nodeEl(multi.id).classList.contains('maxed') && /^Lv \d+\/\d+$/.test(String(costSpan(nodeEl(multi.id)))),
  '满级徽章带 maxed，小字仍是 Lv N/N', nodeEl(multi.id).className + ' / ' + costSpan(nodeEl(multi.id)));
CORE.state.nodes[multi.id] = savedSelfLv;
(multi.requires || []).forEach((r, i) => {
  if (savedReqLv[i] === 0) delete CORE.state.nodes[r];
  else CORE.state.nodes[r] = savedReqLv[i];
});
CORE.state.coins = savedMultiCoins;
BM.UI.renderCamp();
ok(String(costSpan(nodeEl(multi.id))) === 'Lv ' + CORE.nodeLevel(multi.id) + '/' + multiMax,
  '还原后徽章小字回到「Lv ' + CORE.nodeLevel(multi.id) + '/' + multiMax + '」', costSpan(nodeEl(multi.id)));

/* ---------------- 9. 音频合成路径 ---------------- */
section('音频合成路径（注入假 AudioContext，验证真正建节点不抛错）');
let nodesMade = 0;
const mkParam = (v) => ({
  value: v,
  setValueAtTime(o) { this.value = o; },
  linearRampToValueAtTime(o) { this.value = o; },
  exponentialRampToValueAtTime(o) { this.value = o; },
  cancelScheduledValues() { this.value = 0; },
});
const mkNode = (extra) => {
  nodesMade++;
  return Object.assign({ connect(n) { return n || this; }, disconnect() {}, start() {}, stop() {} }, extra);
};
class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.state = 'running';
    this.destination = mkNode({});
  }
  resume() { this.state = 'running'; }
  createGain() { return mkNode({ gain: mkParam(1) }); }
  createOscillator() { return mkNode({ type: 'sine', frequency: mkParam(440), detune: mkParam(0) }); }
  createBiquadFilter() { return mkNode({ type: 'lowpass', frequency: mkParam(1000), Q: mkParam(1), gain: mkParam(0) }); }
  createBufferSource() { return mkNode({ buffer: null, loop: false, playbackRate: mkParam(1) }); }
  createBuffer(ch, len) { return { length: len, getChannelData: () => new Float32Array(len) }; }
  createDynamicsCompressor() {
    return mkNode({ threshold: mkParam(-24), knee: mkParam(30), ratio: mkParam(12), attack: mkParam(0.003), release: mkParam(0.25) });
  }
  createStereoPanner() { return mkNode({ pan: mkParam(0) }); }
}
win.AudioContext = FakeAudioContext;
let audioInit = null;
threw = null;
try { audioInit = BM.AUDIO.init(); } catch (e) { threw = e; }
ok(threw === null && audioInit === true, '有 AudioContext 时 init() 返回 true', String(audioInit));
nodesMade = 0;
threw = null;
try { AUDIO_NAMES.forEach((n) => { BM.AUDIO.play(n, { pitch: 1.05, gain: 0.7, pan: 0.4 }); }); } catch (e) { threw = e; }
ok(threw === null, '合成路径 ' + AUDIO_NAMES.length + ' 个音名全部不抛错', threw && threw.stack);
ok(nodesMade > AUDIO_NAMES.length, '确实创建了音频节点（非空实现）', 'nodes=' + nodesMade);
threw = null;
try {
  BM.AUDIO.play('drill', { on: true });
  BM.AUDIO.play('drill', { on: true });
  BM.AUDIO.play('drill', { on: false });
  BM.AUDIO.play('laserTick', { h: 6 });
  BM.AUDIO.play('quakeBlast', { cells: 49 });
  BM.AUDIO.play('luckyTNT', { pan: -0.5 });
  BM.AUDIO.stopAll();
} catch (e) { threw = e; }
ok(threw === null, 'drill 循环开关 / 新音效带参 / stopAll 不抛错');
const before = nodesMade;
BM.AUDIO.setMuted(true);
try { AUDIO_NAMES.forEach((n) => BM.AUDIO.play(n)); } catch (e) { threw = e; }
ok(threw === null && nodesMade === before, '静音时不再创建任何音频节点');
BM.AUDIO.setMuted(false);
threw = null;
try { BM.AUDIO.play('ironHit', { combo: 99 }); } catch (e) { threw = e; }
ok(threw === null, 'combo 越界（+7 半音上限）不抛错');

/* ---------------- 10. 美术 UI：九宫格变量 + 图标 + 标题图 ---------------- */
/* ---------------- 12. 强化面板已删除（TREE-V7 §2：所有花费都在天赋树里） ---------------- */
section('强化面板已删除（天赋与强化合成单一系统）');
ok(!doc.getElementById('bm-drawer-upgrades'), '#bm-drawer-upgrades 不再构建');
ok(!doc.getElementById('bm-upgrades-body'), '#bm-upgrades-body 不再存在');
ok(!doc.getElementById('bm-btn-upgrades'), '营地 dock 的「强化」按钮已删除');
ok(!doc.getElementById('bm-btn-upgrades-close'), '强化抽屉的关闭按钮已删除');
const dockBtns = findAll(doc.getElementById('bm-screen-camp'), 'dock-btn');
ok(dockBtns.length === 1 && dockBtns[0].id === 'bm-btn-talents', '营地 dock 只剩「天赋」一个入口', dockBtns.map((b) => b.id).join(','));
ok(uiSrc.indexOf('drawer-upgrades') < 0 && uiSrc.indexOf('upgrades-body') < 0, '08-ui 里没有强化抽屉的构建代码');
ok(uiSrc.indexOf('onBuyUpgrade') < 0 && uiSrc.indexOf('onBuyTalent') < 0, '08-ui 只回调 onBuyNode（单一购买 API）');
ok(uiSrc.indexOf('renderUpgrades') < 0 && uiSrc.indexOf('makeUpRow') < 0 && uiSrc.indexOf('upgradeList') < 0,
  '强化渲染函数（renderUpgrades / makeUpRow / upgradeList）已删除');
ok(!/\.up-row *\{/.test(css) && !/\.up-cost *\{/.test(css), '旧强化样式（.up-row / .up-cost）已删除');
ok(uiSrc.indexOf('cf.tree') >= 0, '08-ui 读 CONFIG.tree（放射树唯一数据源）');
ok(uiSrc.indexOf("'translate('") >= 0 && uiSrc.indexOf(' scale(') >= 0, '平移 + 缩放都通过 transform 实现');
ok(/\.talent-detail *\{[^}]*height: *92px/.test(css), '详情卡固定 92px 高');
ok(/\.talent-detail *\{[^}]*font-size/.test(css) === false, '详情卡自身不设字号（各段分别 ≥12px）');

section('美术 UI（--art-* 九宫格 / BM.ART 图标 / 标题图）');

const artRefs = css.match(/var\(--art-[a-z0-9_-]+/g) || [];
ok(artRefs.length >= 10, 'style.css 引用 --art-* 变量 ≥10 处', 'refs=' + artRefs.length);

const ART_MAP = [
  ['ui-btn_primary', ['.start-btn', '.primary-btn']],
  ['ui-btn_ghost', ['.ghost-btn']],
  ['ui-btn_danger', ['.danger-btn']],
  ['ui-card', ['.zone-card', '.tool-card', '.rec-card']],
  ['ui-card_selected', ['.tool-card.selected']],
  ['ui-card_locked', ['.tool-card.locked']],
  ['ui-panel', ['.drawer-sheet', '.bm-sheet']],
  ['ui-chip', ['.coin-box', '.ore-chip']],
  ['ui-bar_bg', ['.obj-bar', '.combo-bar']],
  ['ui-bar_fill', ['.obj-fill', '.combo-fill']],
  ['ui-confirm', ['#bm-confirm .modal-box']],
];
// 行内注释会被并进选择器（如「/* 推荐升级卡 */ .rec-card」），这里按选择器末行取规则体
const bodyFor = (sel) => {
  const hit = cssRules.filter((r) => r.sel.split('\n').pop().trim() === sel)[0];
  return hit ? hit.body : '';
};
for (const [name, sels] of ART_MAP) {
  for (const sel of sels) {
    ok(bodyFor(sel).indexOf('var(--art-' + name) >= 0, sel + ' 使用 --art-' + name, bodyFor(sel).replace(/\s+/g, ' ').slice(0, 100));
  }
}

/* 天赋卡可读性（用户反馈「天赋界面看不清字和金币数」）：
   最小字号 11px、行高 ≥1.35、价格 14px 等宽金色且独占一行、卡面纯色不铺贴图。 */
const fsOf = (sel) => {
  const m = /font-size: *([0-9.]+)px/.exec(bodyFor(sel));
  return m ? Number(m[1]) : 0;
};
const lhOf = (sel) => {
  const m = /line-height: *([0-9.]+)/.exec(bodyFor(sel));
  return m ? Number(m[1]) : 0;
};
const opOf = (sel) => {
  const m = /opacity: *([0-9.]+)/.exec(bodyFor(sel));
  return m ? Number(m[1]) : 1;
};
ok(fsOf('.td-name') >= 13 && /color: *var\(--orange-soft\)/.test(bodyFor('.td-name')),
  '详情卡名称 ≥13px + 橙色（--orange-soft）', fsOf('.td-name') + 'px');
ok(fsOf('.td-desc') >= 12 && lhOf('.td-desc') >= 1.2,
  '详情卡效果 ≥12px 且行高 ≥1.2（长文本唯一去处）', fsOf('.td-desc') + 'px / ' + lhOf('.td-desc'));
ok(fsOf('.td-cost') >= 12 && /font-family: *var\(--mono\)/.test(bodyFor('.td-cost')) && /color: *var\(--gold\)/.test(bodyFor('.td-cost')),
  '详情卡价格 ≥12px 等宽金色', fsOf('.td-cost') + 'px');
ok(fsOf('.td-state') >= 12, '详情卡状态 ≥12px', fsOf('.td-state') + 'px');
ok(/height: *92px/.test(bodyFor('.talent-detail')) && /overflow: *hidden/.test(bodyFor('.talent-detail')),
  '详情卡固定 92px 且溢出裁掉（不撑破抽屉）', bodyFor('.talent-detail').replace(/\s+/g, ' ').slice(0, 90));
ok(/font-size: *var\(--lv-fs/.test(bodyFor('.talent-chip .talent-lv')) && /color: *var\(--gold\)/.test(bodyFor('.talent-chip .talent-lv')),
  '等级行在圆圈下方，按 --lv-fs（1/scale 反向缩放，视觉 ≥9px）且是金色',
  bodyFor('.talent-chip .talent-lv').replace(/\s+/g, ' ').slice(0, 90));
ok(/white-space: *nowrap/.test(bodyFor('.talent-chip .talent-lv')), '等级行不换行（不会被折成两截）');
ok(/\.talent-chip \.talent-lv *\{[^}]*font-family: *var\(--mono\)/.test(css), '等级行用等宽字体（数字不抖）');
const capRule = bodyFor('.talent-chip .talent-cap');
ok(/font-size: *11px/.test(capRule) && /text-align: *center/.test(capRule),
  '说明行 11px / 居中（圆圈上方）', capRule.replace(/\s+/g, ' ').slice(0, 90));
ok(/white-space: *nowrap/.test(capRule) && /text-overflow: *ellipsis/.test(capRule) && /overflow: *hidden/.test(capRule),
  '说明行不换行 + 超出省略号（≤6 字，不裁字）');
ok(/\.talent-map\.far \.talent-cap/.test(css) && /\.talent-map\.far \.talent-lv/.test(css),
  '缩到 0.7 倍以下说明行与等级行一起收起（和原有小字规则一致）');
ok(/\.talent-node *\{[^}]*pointer-events: *none/.test(css), '圆徽章不吃指针（命中区是整个格子）');
ok(/background-color: *#[0-9a-f]{6}/.test(bodyFor('.talent-node')), '徽章纯色底（不铺美术贴图）', bodyFor('.talent-node').replace(/\s+/g, ' ').slice(0, 80));
ok(!/\.talent-capstone/.test(css) && !/\.talent-foot *\{/.test(css) && !/\.capstone/.test(css),
  '旧天赋卡样式（capstone / talent-foot）已删除');
ok(/\.talent-empty *\{/.test(css), 'CONFIG.tree 缺失时有 .talent-empty 占位（UI 不崩）');

for (const sel of ['.start-btn', '.primary-btn', '.ghost-btn', '.danger-btn']) {
  const b = bodyFor(sel);
  ok(/border-image-slice: *8 *fill/.test(b), sel + ' 九宫格切边 border-image-slice: 8 fill');
  ok(/border-style: *solid/.test(b), sel + ' 有 border-style 兜底（art 缺失时原边框照常显示）');
  ok(/background-color: *[^;]+/.test(b), sel + ' 保留 background-color 兜底（图缺失也不白块）');
}
for (const sel of ['.zone-card', '.tool-card', '.rec-card', '.drawer-sheet', '.bm-sheet', '.coin-box',
  '.ore-chip', '.obj-bar', '.obj-fill', '.combo-bar', '.combo-fill', '.talent-node', '.talent-chip', '.talent-detail',
  '.talent-stage', '.modal-box']) {
  ok(/background-color: *[^;]+/.test(bodyFor(sel)), sel + ' 有 background-color 兜底');
}
ok(/\.tool-ico[^{]*\{[^}]*width: *24px/.test(css), '图标 24×24（width）');
ok(/\.tool-ico[^{]*\{[^}]*height: *24px/.test(css), '图标 24×24（height）');
ok(/\.tool-ico[^{]*\{[^}]*image-rendering: *pixelated/.test(css), '图标 image-rendering: pixelated');
ok(/\.camp-logo-row:empty *\{[^}]*display: *none/.test(css), '没有标题图时顶部那一行不留空档');
ok(/\.ore-chip \.ore-ico \+ \.ore-block *\{[^}]*display: *none/.test(css), '矿种贴图就位后程序化色块让位');

const uiLayer = doc.getElementById('bm-ui');
const uiImgs = findImgs(uiLayer);
ok(uiImgs.length >= 14, '界面里插入了 ≥14 个图标 <img>', 'count=' + uiImgs.length);
ok(uiImgs.every((n) => ART_KEYS.has(String(n.getAttribute('data-art')))), '每个图标的来源键都在 art/manifest.json 里', uiImgs.map((n) => n.getAttribute('data-art')).join(','));
ok(uiImgs.every((n) => String(n.getAttribute('src')) === 'data:image/png;base64,ART-' + n.getAttribute('data-art')), '图标 src 就是 BM.ART.one 返回的 data URL');
ok(artCalls.indexOf('icons.tool_wood') >= 0 && artCalls.indexOf('logo.title') >= 0, '图标/标题确实经 BM.ART.one 取图', 'calls=' + artCalls.length);

const iconOf = (el) => {
  const n = findImgs(el);
  return n.length ? n[0].getAttribute('data-art') : null;
};
const iconIn = (id) => iconOf(doc.getElementById(id));
/* 专属武器图缺失时回退到已有的武器图（manifest 里有什么用什么），都没有就不放图标 */
const expectedToolArt = (id) => {
  const own = 'icons.tool_' + id;
  if (ART_KEYS.has(own)) return own;
  return ART_KEYS.has('icons.tool_diamond') ? 'icons.tool_diamond' : null;
};
for (const id of TOOL_IDS) {
  ok(iconIn('bm-tool-' + id) === expectedToolArt(id),
    '工具卡左侧图标 = ' + expectedToolArt(id) + '（' + id + '）', String(iconIn('bm-tool-' + id)));
}
ok(ART_KEYS.has('icons.tool_laser') || iconIn('bm-tool-laser') === 'icons.tool_diamond' ||
  iconIn('bm-tool-laser') === null, '激光钻无专属图 → 回退 icons.tool_diamond，或干脆不放图');
ok(!doc.getElementById('bm-btn-tnt'), 'TNT 按钮图标槽已随按钮一起移除');
ok(iconIn('bm-btn-talents') === 'icons.icon_talent', 'dock 天赋图标 = icons.icon_talent');
ok(!doc.getElementById('bm-btn-upgrades') && !doc.getElementById('bm-btn-upgrades-close'), '强化按钮与强化抽屉的图标槽已随面板一起移除');
ok(iconIn('bm-btn-settings') === 'icons.icon_settings', '设置按钮图标 = icons.icon_settings');
ok(iconIn('bm-btn-quality') === 'icons.icon_quality', '设置里画质图标 = icons.icon_quality');
ok(iconIn('bm-btn-hud-quality') === 'icons.icon_quality', 'HUD 画质图标 = icons.icon_quality');
ok(iconIn('bm-btn-reset-save') === 'icons.icon_reset', '重置存档图标 = icons.icon_reset');
ok(iconIn('bm-btn-mute') === 'icons.sound_on', '音效图标 = icons.sound_on');
BM.UI.setMuted(true);
ok(iconIn('bm-btn-mute') === 'icons.sound_off' && iconIn('bm-btn-hud-mute') === 'icons.sound_off', '静音后图标换成 sound_off');
BM.UI.setMuted(false);
ok(iconIn('bm-btn-mute') === 'icons.sound_on', '取消静音后图标切回 sound_on');

const statIco = (id) => {
  const cell = doc.getElementById(id).parentNode;
  const n = findImgs(cell);
  return n.length ? n[0].getAttribute('data-art') : null;
};
ok(statIco('bm-res-broken') === 'icons.icon_record', '结算「破坏格数」图标 = icons.icon_record', String(statIco('bm-res-broken')));
ok(statIco('bm-res-combo') === 'icons.icon_combo', '结算「最大连击」图标 = icons.icon_combo', String(statIco('bm-res-combo')));
ok(statIco('bm-res-explosions') === 'icons.clock', '结算「爆破次数」图标 = icons.clock', String(statIco('bm-res-explosions')));

const logoImg = findAll(doc.getElementById('bm-screen-camp'), 'game-logo')[0];
ok(!!logoImg && logoImg.tagName === 'IMG' && logoImg.getAttribute('data-art') === 'logo.title', '营地顶部标题图 = logo.title', logoImg && logoImg.getAttribute('data-art'));
ok(logoImg && logoImg.parentNode === doc.getElementById('bm-screen-camp').children[0], '标题图挂在营地第一行（camp-logo-row）');

/* 换关重建矿种格后图标要跟着重建（槽位不指向旧节点） */
BM.UI.showScreen('mine');
CORE.state.currentZone = coalIronZone.id;
BM.UI.updateHUD({ timeLeft: 9, counts: { coal: 3, iron: 4 }, coins: 20n });
const chips2 = findAll(doc.getElementById('bm-hud-ores'), 'ore-chip');
ok(chips2.length === 2 && iconOf(chips2[0]) === 'icons.ore_coal', '换关后重建矿种格并补图标 icons.ore_coal', String(iconOf(chips2[0])));
ok(iconOf(chips2[1]) === 'icons.ore_iron', '第二格图标 = icons.ore_iron', String(iconOf(chips2[1])));
ok(findAll(doc.getElementById('bm-hud-ores'), 'ore-block').length === 2, '贴图就位时程序化色块仍在 DOM（CSS 让位、不删节点）');
CORE.state.currentZone = 'quarry';
BM.UI.updateHUD({ timeLeft: 9, counts: { stone: 1, coal: 2 }, coins: 20n });
ok(iconOf(findAll(doc.getElementById('bm-hud-ores'), 'ore-chip')[0]) === 'icons.ore_stone', '切回第 1 关后图标同步为 icons.ore_stone');
BM.UI.showScreen('camp');

/* ---------------- 11. 没有 BM.ART 时的回退路径 ---------------- */
section('没有 BM.ART 时的回退（旧环境 / 图未就绪）');
const host2 = doc.createElement('div');
host2.id = 'app2';
doc.body.appendChild(host2);
const win2 = {
  innerWidth: 390, innerHeight: 844, console,
  addEventListener() {}, removeEventListener() {},
  requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
};
const ctx2 = vm.createContext({ window: win2, document: doc, console, setTimeout, clearTimeout });
vm.runInContext(fs.readFileSync(path.join(root, 'src/08-ui.js'), 'utf8'), ctx2, { filename: '08-ui.noart' });
win2.BM.CORE = CORE;
win2.BM.CONFIG = CONFIG;
let threw2 = null;
try {
  win2.BM.UI.init(host2, {});
  win2.BM.UI.renderCamp();
  win2.BM.UI.showScreen('mine');
  win2.BM.UI.updateHUD({ timeLeft: 8, counts: { stone: 1, coal: 2 }, coins: 20n, combo: 2, tool: 'wood', explosiveLeft: 1 });
  win2.BM.UI.renderResult({ zoneId: 'quarry', lines: [{ ore: 'stone', name: '石头', count: 1, price: 1, subtotal: '1' }], coinsEarned: '1', stats: { brokenBlocks: 1, maxCombo: 1, explosions: 0 }, unlocked: [], objective: null, nextZoneId: null });
  win2.BM.UI.showScreen('camp');
} catch (e) { threw2 = e; }
ok(threw2 === null, '没有 BM.ART 时 init/renderCamp/showScreen/updateHUD/renderResult 全不抛错', threw2 && threw2.stack);
ok(win2.BM.ART === undefined, '第二个上下文确实没有 BM.ART');
ok(findImgs(host2).length === 0, '没有 ART 时一个 <img> 都不插（全走文字/程序化）', 'count=' + findImgs(host2).length);
const cards2 = findAll(host2, 'tool-card');
ok(cards2.length === 4 && cards2[0].textContent.indexOf('木镐') >= 0, '没有 ART 时四张工具卡照常渲染文字', 'count=' + cards2.length);
ok(findImgs(cards2[3]).length === 0 && cards2[3].textContent.indexOf('激光钻') >= 0,
  '没有 BM.ART 时激光钻卡不放图标，只留文字', String(findImgs(cards2[3]).length));
ok(findAll(host2, 'ore-chip').length === 2 && findAll(host2, 'ore-block').length === 2, '没有 ART 时矿种走程序化色块');
const mute2 = findAll(host2, 'pill-btn').filter((n) => n.id === 'bm-btn-mute')[0];
ok(!!mute2 && mute2.textContent === '音效', '没有 ART 时静音按钮只有文字（兜底）', mute2 && mute2.textContent);

/* BM.ART 已注册但图还没解码：one() 全 null（浏览器 init 时的真实状态），解码完成后靠重试补图 */
const host3 = doc.createElement('div');
host3.id = 'app3';
doc.body.appendChild(host3);
const win3 = {
  innerWidth: 390, innerHeight: 844, console,
  addEventListener() {}, removeEventListener() {},
  requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
};
const timers3 = [];
const ctx3 = vm.createContext({
  window: win3, document: doc, console,
  setTimeout: (fn) => { timers3.push(fn); return timers3.length; },
  clearTimeout() {},
});
vm.runInContext(fs.readFileSync(path.join(root, 'src/08-ui.js'), 'utf8'), ctx3, { filename: '08-ui.pending' });
let artReady = false;
win3.BM.CORE = CORE;
win3.BM.CONFIG = CONFIG;
win3.BM.ART = {
  total: ART_KEYS.size,
  has: () => true,
  one(key) {
    if (!artReady || !ART_KEYS.has(key)) return null;
    return { src: 'data:image/png;base64,ART-' + key, complete: true };
  },
  all() { return []; },
  progress() { return artReady ? 1 : 0; },
};
let threw3 = null;
try {
  win3.BM.UI.init(host3, {});
  win3.BM.UI.renderCamp();
  win3.BM.UI.showScreen('mine');
  win3.BM.UI.updateHUD({ timeLeft: 9, counts: { stone: 1, coal: 2 }, coins: 20n, combos: 0, tool: 'wood', explosiveLeft: 1 });
} catch (e) { threw3 = e; }
ok(threw3 === null, '图未解码（one() 全 null）时 init/renderCamp/updateHUD 不抛错', threw3 && threw3.stack);
ok(findImgs(host3).length === 0, '未解码时一个 <img> 都不插（走程序化兜底）', 'count=' + findImgs(host3).length);
ok(findAll(host3, 'tool-card').length === 4 && findAll(host3, 'tool-card')[0].textContent.indexOf('木镐') >= 0, '未解码时工具卡文字照常');
ok(findAll(host3, 'ore-block').length === 2, '未解码时矿种走程序化色块');
ok(timers3.length === 1, '解码未完成时排了一次补图重试', 'timers=' + timers3.length);
timers3[0]();
ok(findImgs(host3).length === 0, '第一次重试仍无图（图还没好）');
artReady = true;
timers3[1]();
ok(findImgs(host3).length >= 14, '解码完成后重试把图标补进 DOM（无需重渲染）', 'count=' + findImgs(host3).length);
const toolIco3 = findImgs(findAll(host3, 'tool-card')[0])[0];
ok(!!toolIco3 && toolIco3.getAttribute('data-art') === 'icons.tool_wood', '补图后工具卡图标键正确', toolIco3 && toolIco3.getAttribute('data-art'));
ok(findImgs(host3).every((n) => ART_KEYS.has(String(n.getAttribute('data-art')))), '补进来的图标键都在 manifest 里');
ok(timers3.length === 2, '图全部就绪后轮询自停（不再排定时器）', 'timers=' + timers3.length);

/* ---------------- 12. 天赋树交互细化（TREE-V8 §7.4：单击购买 / 长按详情 / Tips / 全额返还） ---------------- */
section('天赋树交互细化（长按 300ms 开详情卡不购买 · 单击仍买一级 · 拖动不误触 · 顶部 Tips）');

/* 元素一律从主宿主 host 里取：第 11 节的 ctx2/ctx3 用同一个 doc 建了同 id 的树，
   doc.getElementById('bm-talent-*') 会指向 host3 那一份（它的 setTimeout 还是桩，长按永远不触发）。 */
const badgeIn = (id) => findAll(talentBody, 'talent-chip').filter((n) => n.dataset.node === id)[0];
const tapBadge = (el) => {
  fireEv(stage, 'pointerdown', { clientX: 30, clientY: 30, pointerId: 21 });
  fireEv(stage, 'pointerup', { clientX: 30, clientY: 30, pointerId: 21 });
  fire(el, 'click');
};
const tipsEl = findAll(talentBody, 'talent-tips')[0];
ok(!!tipsEl && isAttached(tipsEl, talentBody), '天赋树顶部有 Tips 行 .talent-tips（挂在 #bm-talents-body 里）', tipsEl && tipsEl.className);
ok(!!tipsEl && tipsEl.textContent === '单击购买 · 长按查看详情', 'Tips 文案 =「单击购买 · 长按查看详情」', tipsEl && tipsEl.textContent);
ok(!!tipsEl && talentBody.children.indexOf(tipsEl) === 0 && talentBody.children.indexOf(stage) === 1,
  'Tips 在 stage 上方（天赋体第 1 个元素，stage 第 2 个）', talentBody.children.slice(0, 3).map((n) => n.className).join(' | '));
const tipsRule = (/\.talent-tips *\{([^}]*)\}/.exec(css) || ['', ''])[1];
ok(/font-size: *11px/.test(tipsRule) && /text-align: *center/.test(tipsRule) && /color: *var\(--dim\)/.test(tipsRule),
  'Tips 样式 = 11px / 居中 / color var(--dim)', tipsRule.split('\n').join(' ').replace(/ +/g, ' '));
ok(/var LONG_PRESS_MS = 300/.test(uiSrc), '长按阈值是具名常量 LONG_PRESS_MS = 300');
ok(/R\.pressTimer = setTimeout\(function \(\)/.test(uiSrc) && /LONG_PRESS_MS\);/.test(uiSrc),
  '长按定时器 = 徽章 pointerdown 起的 setTimeout(LONG_PRESS_MS)（R.pressTimer）');
ok(/chip\.addEventListener\('pointerdown', function \(e\) \{ onBadgeDown/.test(uiSrc) && /pointerup', cancelLongPress/.test(uiSrc),
  '格子上有 pointerdown 起定时器 / pointerup 取消（提前松手 = 单击）');

const commaN = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
CORE.state.coins = BigInt('1000000000000000000');
BM.UI.renderCamp();
const lpNode = TREE_ALL.filter((n) => CORE.nodeState(n.id) === 'available' && n.name !== dName.textContent)[0];
ok(!!lpNode, '长按样本：可买节点 ' + (lpNode && lpNode.name), lpNode && lpNode.id);
const lpEl = badgeIn(lpNode.id);
ok(!!lpEl && isAttached(lpEl, talentBody), '长按样本徽章取自主宿主（' + (lpNode && lpNode.id) + '）');
const lpLv = CORE.nodeLevel(lpNode.id);
const lpCoins = CORE.state.coins;

/* 提前松手（< 300ms）：定时器被 pointerup 取消，不算长按 */
fireEv(lpEl, 'pointerdown', { clientX: 20, clientY: 20, pointerId: 11 });
fireEv(stage, 'pointerdown', { clientX: 20, clientY: 20, pointerId: 11 });
await new Promise((r) => setTimeout(r, 250));
ok(dName.textContent !== lpNode.name, '按住 250ms（未到阈值）详情卡不换人', dName.textContent);
fireEv(lpEl, 'pointerup', { clientX: 20, clientY: 20, pointerId: 11 });
fireEv(stage, 'pointerup', { clientX: 20, clientY: 20, pointerId: 11 });
ok(dName.textContent !== lpNode.name, '提前松手不触发长按（定时器已取消）', dName.textContent);

/* 真·长按：按住到 300ms 以上 → 开详情卡 */
fireEv(lpEl, 'pointerdown', { clientX: 20, clientY: 20, pointerId: 12 });
fireEv(stage, 'pointerdown', { clientX: 20, clientY: 20, pointerId: 12 });
await new Promise((r) => setTimeout(r, 340));
ok(detail.classList.contains('is-open') && dName.textContent === lpNode.name,
  '长按 ≥300ms 打开详情卡（' + lpNode.name + '）', dName.textContent);
ok(CORE.nodeLevel(lpNode.id) === lpLv && CORE.state.coins === lpCoins,
  '长按只开卡不购买：等级仍是 Lv ' + lpLv + '、金币没变 (' + commaN(lpCoins) + ')',
  'Lv ' + CORE.nodeLevel(lpNode.id) + ' / ' + commaN(CORE.state.coins));
ok(dState.textContent.length > 0 && dCost.textContent.length > 0, '详情卡给出状态与每级价格', dState.textContent + ' / ' + dCost.textContent);

/* 长按松手后浏览器仍会补一次 click：被 suppressClick 吞掉，不涨价 */
fireEv(lpEl, 'pointerup', { clientX: 20, clientY: 20, pointerId: 12 });
fireEv(stage, 'pointerup', { clientX: 20, clientY: 20, pointerId: 12 });
fire(lpEl, 'click');
ok(CORE.nodeLevel(lpNode.id) === lpLv && CORE.state.coins === lpCoins, '长按松手后的那次 click 被吞掉（不涨价）',
  'Lv ' + CORE.nodeLevel(lpNode.id) + ' / ' + commaN(CORE.state.coins));

/* 紧接着的正常单击照常买 1 级（吞点击只吞一次） */
tapBadge(lpEl);
ok(CORE.nodeLevel(lpNode.id) === lpLv + 1, '紧接着单击照常买 1 级（' + lpLv + '→' + (lpLv + 1) + '）', CORE.nodeLevel(lpNode.id));

/* 拖动 > 6px：长按被位移取消，松手后的 click 也不误买 */
const dragNode = TREE_ALL.filter((n) => CORE.nodeState(n.id) === 'available' && n.name !== dName.textContent)[0];
ok(!!dragNode, '拖动样本：可买节点 ' + (dragNode && dragNode.name), dragNode && dragNode.id);
const dragEl = badgeIn(dragNode.id);
const dragLv = CORE.nodeLevel(dragNode.id);
const dragCoins = CORE.state.coins;
fireEv(dragEl, 'pointerdown', { clientX: 100, clientY: 100, pointerId: 13 });
fireEv(stage, 'pointerdown', { clientX: 100, clientY: 100, pointerId: 13 });
fireEv(dragEl, 'pointermove', { clientX: 130, clientY: 120, pointerId: 13 });
fireEv(stage, 'pointermove', { clientX: 130, clientY: 120, pointerId: 13 });
await new Promise((r) => setTimeout(r, 340));
ok(dName.textContent !== dragNode.name, '拖动 30/20px 后按住 340ms 也不开详情卡（位移取消长按）', dName.textContent);
fireEv(dragEl, 'pointerup', { clientX: 130, clientY: 120, pointerId: 13 });
fireEv(stage, 'pointerup', { clientX: 130, clientY: 120, pointerId: 13 });
fire(dragEl, 'click');
ok(CORE.nodeLevel(dragNode.id) === dragLv && CORE.state.coins === dragCoins, '拖动松手后的 click 不误买（等级 / 金币不变）',
  'Lv ' + CORE.nodeLevel(dragNode.id) + ' / ' + commaN(CORE.state.coins));
tapBadge(dragEl);
ok(CORE.nodeLevel(dragNode.id) === dragLv + 1, '拖动之后单击仍然买 1 级（吞点击只吞一次）', CORE.nodeLevel(dragNode.id));

/* ---------------- 13. 重置天赋 = 全额返还（真实 01-config + 02-core） ---------------- */
section('重置天赋全额返还（真实 CORE.resetTalents：coins 回到购买前 / 所有节点 Lv 0）');
const coreBox = { window: { localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } }, console };
vm.createContext(coreBox);
for (const f of ['src/01-config.js', 'src/02-core.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), coreBox, { filename: f });
}
const RCORE = coreBox.window.BM.CORE;
const RTREE = coreBox.window.BM.CONFIG.tree;
ok(!!RCORE && typeof RCORE.resetTalents === 'function' && !!RTREE && !!RTREE.center,
  '真实 02-core 加载成功，CORE.resetTalents / CONFIG.tree 可用');
const RCENTER = RTREE.center.id;
const RIDS = [RCENTER].concat(RTREE.nodes.map((n) => n.id));
RCORE.state.coins = BigInt('100000000000');
const coinsAtStart = RCORE.state.coins;
let paid = 0n;
const buyOne = (id) => {
  const price = RCORE.nodeCost(id);
  if (!RCORE.buyNode(id)) return false;
  paid += price;                                  // 每级实付（多级节点逐级累加）
  return true;
};
buyOne(RCENTER);
for (const n of RTREE.nodes) {
  for (let i = 0; i < 2; i += 1) {
    if (RCORE.nodeState(n.id) !== 'available') break;
    if (!buyOne(n.id)) break;
  }
}
const deep = RTREE.nodes.filter((n) => (n.requires || []).indexOf(RCENTER) < 0)[0];
if (deep) for (let i = 0; i < 2; i += 1) { if (RCORE.nodeState(deep.id) !== 'available') break; buyOne(deep.id); }
ok(paid > 0n && RCORE.state.coins === coinsAtStart - paid,
  '买之前先花钱：扣掉的金币 = Σ 每级实付（' + commaN(paid) + '）', commaN(coinsAtStart - RCORE.state.coins) + ' vs ' + commaN(paid));
const multiBought = RIDS.filter((id) => RCORE.nodeLevel(id) > 1);
const anyMulti = RTREE.nodes.concat([RCENTER]).some(function (n) { return (n.maxLevel || 1) > 1; });
if (anyMulti) {
  ok(multiBought.length > 0, '样本里有多级节点买到 >1 级（覆盖 1.9 递增的每一级）', multiBought.join(','));
} else {
  ok(RIDS.every(function (id) { return RCORE.nodeLevel(id) <= 1; }), '全部节点单级（v9 拆链后 1 级 = 1 节点），逐级价格由不同节点承担');
}
const refund = RCORE.resetTalents();
ok(refund === paid, 'resetTalents 返还 = Σ 每级实付（' + commaN(paid) + '）', commaN(refund));
ok(RCORE.state.coins === coinsAtStart, '重置后金币精确回到购买前（' + commaN(coinsAtStart) + '）', commaN(RCORE.state.coins));
const notZero = RIDS.filter((id) => RCORE.nodeLevel(id) !== 0);
ok(notZero.length === 0, '重置后所有 ' + RIDS.length + ' 个节点 Lv 0', notZero.join(','));

/* ---------------- 汇总 ---------------- */
console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) {
  console.log('失败清单：');
  fails.forEach((f) => console.log(' - ' + f));
  process.exit(1);
}
console.log('OK: ui.smoke 全绿');
