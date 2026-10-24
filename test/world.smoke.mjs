/* test/world.smoke.mjs —— 04-tools / 05-drops 的 node 冒烟测试（v2 契约：木/石/铁镐 + TNT + 石头/煤/铁）
 * 真实读取 src 两个文件；BM.GRID / BM.CORE / BM.CONFIG 用契约形状的桩，document/canvas 不需要（draw 用 mock ctx）。 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const TOOLS_SRC = readFileSync(join(root, 'src', '04-tools.js'), 'utf8');
const DROPS_SRC = readFileSync(join(root, 'src', '05-drops.js'), 'utf8');

// 真配置（src/01-config.js）：world() 的桩 CONFIG 负责驱动行为，真值负责验收数字
function loadRealConfig() {
  const sb = { window: {}, console: { log() {}, warn() {} } };
  vm.createContext(sb);
  vm.runInContext(readFileSync(join(root, 'src', '01-config.js'), 'utf8'), sb, { filename: '01-config.js' });
  return sb.window.BM.CONFIG;
}

globalThis.window = globalThis;
const __store = new Map();
globalThis.localStorage = {
  getItem(k) { return __store.has(k) ? __store.get(k) : null; },
  setItem(k, v) { __store.set(k, String(v)); },
  removeItem(k) { __store.delete(k); }
};

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ok   ' + msg); }
  else { fail++; console.log('  FAIL ' + msg + (extra === undefined ? '' : ' → ' + extra)); }
}
function eq(actual, expected, msg) {
  ok(Object.is(actual, expected), msg, '期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
}
function near(actual, expected, tol, msg) {
  ok(Math.abs(actual - expected) <= tol, msg, '期望 ' + expected + '±' + tol + '，实际 ' + actual);
}
function section(name) { console.log('\n# ' + name); }

// ---- 确定性随机 ----
function fixedRandom(v) {
  const orig = Math.random;
  Math.random = function () { return v; };
  return function () { Math.random = orig; };
}
function seedRandom(seed) {
  let a = seed >>> 0;
  const orig = Math.random;
  Math.random = function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return function () { Math.random = orig; };
}

// ---- 事件总线 stub（与 v1 契约 §1 同形） ----
function makeBus() {
  const map = new Map();
  return {
    on(t, fn) {
      if (!map.has(t)) map.set(t, []);
      map.get(t).push(fn);
      return () => this.off(t, fn);
    },
    off(t, fn) {
      const a = map.get(t);
      if (!a) return;
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    },
    emit(t, d) {
      const a = map.get(t);
      if (!a) return;
      for (const fn of a.slice()) {
        try { fn(d); } catch (e) { console.warn('listener 抛错 ' + t + ': ' + e.message); }
      }
    }
  };
}

/* ---------------- v2 契约数据（CONTRACT-V2 §2 / §4） ---------------- */

// CONTRACT-V3 §2：单价 1/6/40/400 固定，掉落写成单值（铁 3/5、晶 2/4）
const ORES = {
  stone: { id: 'stone', name: '石头', price: 1, hp: 3, drop: 1, richDrop: 2, color: '#7d7d7d', vein: '#5a5a5a', glow: '#a8a8a8' },
  coal: { id: 'coal', name: '煤矿', price: 6, hp: 1, drop: 1, richDrop: 2, color: '#7d7d7d', vein: '#171717', glow: '#3a3a3a' },
  iron: { id: 'iron', name: '铁矿', price: 40, hp: 12, drop: 3, richDrop: 5, color: '#7d7d7d', vein: '#d8b98a', glow: '#a9855c' },
  crystal: { id: 'crystal', name: '晶石', price: 400, hp: 40, drop: 2, richDrop: 4, color: '#7d7d7d', vein: '#8fe6ff', glow: '#d8f6ff' }
};
// v13：四把正式工具 + 一把测试镐（probe 只活在本测试的 fixture 里，用于通用节拍/命中用例）
const TOOL_CFG = {
  wood: { id: 'wood', name: '木镐', dmg: 1, mode: 'tap', interval: 0, shape: 'single' },
  probe: { id: 'probe', name: '测试镐', dmg: 2, mode: 'hold', interval: 0.34, shape: 'single' },
  iron: { id: 'iron', name: '铁镐', dmg: 3, mode: 'hold', interval: 0.42, shape: 'column2' },
  diamond: { id: 'diamond', name: '钻石镐', dmg: 10, mode: 'tap', interval: 0.55, shape: 'square3' },
  laser: { id: 'laser', name: '激光钻', dmg: 4, mode: 'hold', interval: 0.15, shape: 'columnAll' }
};
const BASE_MODS = {
  damage: 0, holdIntervalMul: 1, oreRateBonus: 0, extraLayers: 0,
  dropFlat: 0, dropMul: 1, richMul: 1, richRateBonus: 0,
  magnetSpeedMul: 1, magnetRadiusMul: 1,
  chainChance: 0, chainCells: 0, multiStrikeEvery: 0, multiStrikeMul: 0.5, overkillTransfer: 0,
  frenzyDropMul: 3, frenzySeconds: 1.2, roundSeconds: 15,
  tntLayerPierce: 2,   // 2 = CONFIG.tnt.layerPierce（v4 基数，天赋再 +2）；v14 没有 tntMax/tntRadiusCells/hasTNT
  laserDamage: 0, luckyTNTChance: 0
};

/* ---- GRID stub：v2 形状（layers / depth / damageLayers / block:layer） ---- */
function makeGrid(bus, opt) {
  opt = opt || {};
  const cols = opt.cols || 6, rows = opt.rows || 8, bx = 10, by = 96, s = 60;
  const blocks = [];
  const hits = new Map();
  const dmgLog = [];        // { block, dmg, dir }
  const layerLog = [];      // { block, dmg, pierce }
  const stripLog = [];      // { block, layers }：共振剥层（无视血量）
  const hpAt = opt.hpAt || (() => 1);
  const layersAt = opt.layersAt || (() => 8);

  function refill(b) {
    b.maxHp = hpAt(b.ox, b.oy);
    b.hp = b.maxHp;
  }

  for (let oy = 0; oy < rows; oy++) {
    const row = [];
    for (let ox = 0; ox < cols; ox++) {
      const layers = layersAt(ox, oy);
      const b = {
        ox, oy, x: bx + ox * s, y: by + oy * s, s,
        ore: opt.oreAt ? opt.oreAt(ox, oy) : 'stone',
        maxHp: hpAt(ox, oy), hp: hpAt(ox, oy),
        rich: !!(opt.richAt && opt.richAt(ox, oy)),
        depth: 0, layers, totalLayers: layers, broken: false,
        crack: 0, seed: ox * 31 + oy * 7 + 1, hitT: 0, hitDir: 0, appearT: 1
      };
      row.push(b);
    }
    blocks.push(row);
  }

  // 打穿一层：还有层就换新层数据，否则变坑洞
  function punchLayer(b) {
    b.layers -= 1;
    b.depth += 1;
    if (b.layers > 0) {
      refill(b);
      bus.emit('block:layer', { block: b, depth: b.depth });
      return false;
    }
    b.hp = 0;
    b.broken = true;
    bus.emit('block:break', { block: b, ore: b.ore, rich: b.rich, chain: 0 });
    return true;
  }

  return {
    blocks, hits, dmgLog, layerLog, stripLog,
    at(px, py) {
      const ox = Math.floor((px - bx) / s), oy = Math.floor((py - by) / s);
      if (ox < 0 || oy < 0 || ox >= cols || oy >= rows) return null;
      const b = blocks[oy][ox];
      return b && !b.broken ? b : null;   // 与真实 03-grid 一致：坑洞返回 null
    },
    damage(b, dmg, dir) {
      if (!b || b.broken) return { broke: false, overkill: 0 };
      hits.set(b, (hits.get(b) || 0) + 1);
      dmgLog.push({ block: b, dmg, dir });
      bus.emit('block:hit', { block: b, dmg, dir });
      b.hp -= dmg;
      if (b.hp <= 0) {
        const over = -b.hp;
        punchLayer(b);
        return { broke: true, overkill: over };
      }
      return { broke: false, overkill: 0 };
    },
    // v6 共振口径：无视血量剥一层（与真实 03-grid.stripLayer 同语义：
    // 换层派发 block:layer，挖空派发 block:break + block:empty，已破/无层返回 false）
    stripLayer(b) {
      if (!b || b.broken) return false;
      if (typeof b.layers !== 'number' || !isFinite(b.layers) || b.layers <= 0) return false;
      const prev = { ore: b.ore, rich: b.rich, maxHp: b.maxHp };
      stripLog.push({ block: b, layers: b.layers });
      b.hp = 0;
      if (punchLayer(b)) bus.emit('block:empty', { block: b, prev });
      if (opt.onStrip) opt.onStrip(b);      // 重入测试用的钩子：剥层期间再做别的事
      return true;
    },
    // v2：每层独立结算，最多连续打穿 pierce 层
    damageLayers(b, dmg, pierce) {
      if (!b || b.broken) return { broke: false, layers: 0 };
      layerLog.push({ block: b, dmg, pierce });
      let broke = false;
      const p = Math.round(pierce);
      for (let i = 0; i < p; i++) {
        if (b.broken) break;
        hits.set(b, (hits.get(b) || 0) + 1);
        dmgLog.push({ block: b, dmg, dir: 0 });
        bus.emit('block:hit', { block: b, dmg, dir: 0 });
        b.hp -= dmg;
        if (b.hp <= 0) broke = punchLayer(b) || broke;
      }
      return { broke, layers: p };
    },
    neighbors(b, pattern, n) {
      const dirs = pattern === 'square'
        ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
        : [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const out = [];
      for (const [dx, dy] of dirs) {
        const ox = b.ox + dx, oy = b.oy + dy;
        if (ox < 0 || oy < 0 || ox >= cols || oy >= rows) continue;
        const nb = blocks[oy][ox];
        if (nb.broken) continue;
        out.push(nb);
      }
      return out;
    },
    richCells() { return []; },
    init() {}, build() {}, update() {}, draw() {}, clear() {}
  };
}

const EVENT_TYPES = ['block:hit', 'block:break', 'block:layer', 'block:empty', 'tool:swing',
  'explosion', 'tnt:fuse', 'chain:tick', 'tool:chain', 'combo:update', 'frenzy:start', 'frenzy:end',
  'drop:spawn', 'drop:absorb', 'magnet:burst',
  'laser:tick', 'quake:blast', 'lucky:tnt', 'resonance:blast', 'tool:execute'];

function world(opt) {
  opt = opt || {};
  const bus = makeBus();
  const events = [];
  for (const t of EVENT_TYPES) bus.on(t, (d) => events.push({ t, d }));

  const mods = Object.assign({}, BASE_MODS, opt.mods || {});
  const grid = makeGrid(bus, opt.grid);
  const config = {
    version: 5,
    ores: JSON.parse(JSON.stringify(ORES)),
    tools: JSON.parse(JSON.stringify(TOOL_CFG)),
    zones: [],
    // v14：只保留白掉的 TNT —— 伤害 = 当前工具伤害 × damageMul、穿透 2 层（天赋再加）、固定 3×3
    tnt: { damageMul: 3, layerPierce: 2, pierceCap: 4 },
    tuning: Object.assign({ luckyTNTTotalMax: 400, luckyTNTSide: 3, luckyTNTFuseSec: 1.8 }, opt.tuning || {})
  };

  globalThis.BM = {
    bus,
    CONFIG: config,
    CORE: { mods: () => mods },
    GRID: grid,
    FX: { init() {}, update() {}, draw() {}, timeScale: 1, shake() {}, flash() {}, setQuality() {}, quality: 'high' },
    AUDIO: { init() {}, play() {}, setMuted() {}, muted: false }
  };
  vm.runInThisContext(TOOLS_SRC, { filename: '04-tools.js' });
  vm.runInThisContext(DROPS_SRC, { filename: '05-drops.js' });
  globalThis.BM.TOOLS.init(null);
  globalThis.BM.DROPS.init();

  return {
    BM: globalThis.BM, bus, events, mods, grid,
    center(ox, oy) {
      const b = grid.blocks[oy][ox];
      return [b.x + b.s * 0.5, b.y + b.s * 0.5];
    },
    block(ox, oy) { return grid.blocks[oy][ox]; },
    count(t) { let n = 0; for (const e of events) if (e.t === t) n++; return n; },
    all(t) { return events.filter((e) => e.t === t).map((e) => e.d); },
    clear() { events.length = 0; }
  };
}

function fakeBlock(ore, rich) {
  return { x: 100, y: 220, s: 60, ore, rich: !!rich, broken: true };
}

// v14：可放置 TNT 已删除，TNT 只剩「挖穿一层白掉」这一条路。
// 直接朝 block:layer 掷一次骰子来白掉一枚：rand 决定 3×3（±1）里落在哪格，
// 0.5 取列表正中 = 刚挖格自己，0 取列表第一个。掷完把概率收回 0，避免爆炸的碎层再连锁。
function dropLuckyTNT(w, ox, oy, rand) {
  const r = fixedRandom(rand == null ? 0.5 : rand);
  w.clear();
  w.mods.luckyTNTChance = 1;
  w.bus.emit('block:layer', { block: w.block(ox, oy), depth: 1 });
  w.mods.luckyTNTChance = 0;
  r();
  // 自己合成的那一条 block:layer 不算数：删掉，事件表里只留 lucky:tnt
  for (let i = w.events.length - 1; i >= 0; i--) {
    if (w.events[i].t === 'block:layer') { w.events.splice(i, 1); break; }
  }
}

// 打一记会碎的格子，返回是否真的出手
function breakOnce(w, tool) {
  for (let oy = 0; oy < 8; oy++) {
    for (let ox = 0; ox < 6; ox++) {
      const b = w.grid.blocks[oy][ox];
      if (b.broken) continue;
      const c = w.center(ox, oy);
      if (w.BM.TOOLS.attack(tool || 'wood', c[0], c[1], { now: 0 })) return true;
    }
  }
  return false;
}

/* ============================ 1. 契约形状 ============================ */
section('1. 契约形状（CONTRACT-V2 §4.4 / §4.5 + TNT）');
{
  const w = world({});
  const T = w.BM.TOOLS, D = w.BM.DROPS;
  for (const fn of ['init', 'ready', 'attack', 'update', 'draw', 'setZone',
    'release', 'setAim', 'holdAttack', 'reset']) {
    eq(typeof T[fn], 'function', 'TOOLS.' + fn + ' 是函数');
  }
  for (const fn of ['init', 'spawnForBlock', 'update', 'draw', 'absorbAll', 'reset']) {
    eq(typeof D[fn], 'function', 'DROPS.' + fn + ' 是函数');
  }
  eq(typeof T.stats, 'object', 'TOOLS.stats 是对象');
  for (const k of ['broken', 'maxCombo', 'maxChain', 'explosions']) {
    eq(typeof T.stats[k], 'number', 'stats.' + k + ' 是数字');
  }
  eq(T.beginTNT, undefined, 'TOOLS.beginTNT 已删除（v14 删掉可放置 TNT）');
  eq(T.placeTNT, undefined, 'TOOLS.placeTNT 已删除');
  eq(T.explosiveLeft, undefined, 'TOOLS.explosiveLeft 已删除（没有每局弹药）');
  eq(typeof D.counts, 'object', 'DROPS.counts 是对象');
  eq(typeof T.combo, 'number', 'TOOLS.combo 是数字属性');
  eq(typeof T.frenzyLeft, 'number', 'TOOLS.frenzyLeft 是数字属性');
  eq(T.combo, 0, '开局 combo = 0');
  eq(T.ready(), true, '开局 ready() = true');
  eq(T.tntArmed, undefined, 'TOOLS.tntArmed 已删除（没有投掷态）');
}

/* ============================ 2. 三工具命中格数与伤害 ============================ */
section('2. 三工具：命中格数与伤害（dmg + mods.damage）');
{
  const w = world({ grid: { hpAt: () => 99 } });
  const c = w.center(2, 3);
  eq(w.BM.TOOLS.attack('wood', c[0], c[1], { now: 0 }), true, '木镐出手成功');
  const sw = w.all('tool:swing');
  eq(sw.length, 1, 'tool:swing 派发一次');
  eq(sw[0].tool, 'wood', 'tool:swing.tool = wood');
  eq(sw[0].cells.length, 1, '木镐 = 1 格');
  eq(sw[0].cells[0].ox + ',' + sw[0].cells[0].oy, '2,3', '命中格坐标正确');
  eq(w.grid.dmgLog.length, 1, '木镐伤害 1 格');
  eq(w.grid.dmgLog[0].dmg, 1, '木镐伤害 = 1');
}
{
  const w = world({ grid: { hpAt: () => 99 }, mods: { damage: 2 } });
  const c = w.center(1, 1);
  w.BM.TOOLS.attack('probe', c[0], c[1], { now: 0 });
  eq(w.grid.dmgLog[0].dmg, 4, '石镐 2 + mods.damage 2 = 4');
  w.BM.TOOLS.reset();
  w.BM.TOOLS.attack('iron', c[0], c[1], { now: 0 });
  eq(w.grid.dmgLog[1].dmg, 5, '铁镐 3 + mods.damage 2 = 5');
}
{
  const w = world({ grid: { hpAt: () => 99 } });
  const c = w.center(1, 1);
  w.BM.TOOLS.attack('probe', c[0], c[1], { now: 0 });
  eq(w.all('tool:swing')[0].cells.length, 1, '石镐 = 1 格');
  eq(w.all('tool:swing')[0].cells[0].oy, 1, '石镐只打目标格');
  eq(w.grid.dmgLog[0].dmg, 2, '石镐伤害 = 2');
}
{
  const w = world({ grid: { hpAt: () => 99 } });
  const c = w.center(1, 1);
  w.BM.TOOLS.attack('iron', c[0], c[1], { now: 0 });
  const cells = w.all('tool:swing')[0].cells;
  eq(cells.length, 2, '铁镐 = 目标格 + 下方 1 格 = 2 格');
  eq(cells.map((b) => b.oy).join(','), '1,2', '纵向连续 2 格');
  eq(w.grid.dmgLog.length, 2, '两格各挨一下');
  eq(w.grid.dmgLog[1].dmg, 3, '每格伤害 = 3');
}

/* ============================ 3. 冷却 ============================ */
section('3. 冷却 = interval × mods.holdIntervalMul；点按与按住共用同一节拍');
{
  const w = world({ grid: { hpAt: () => 99 } });
  const c = w.center(1, 1);
  eq(w.BM.TOOLS.attack('wood', c[0], c[1], { now: 0 }), true, '木镐第 1 击');
  eq(w.BM.TOOLS.ready(), true, '木镐 interval=0 → 立刻就绪');
  eq(w.BM.TOOLS.attack('wood', c[0], c[1], { now: 0 }), true, '木镐第 2 击');
  eq(w.count('tool:swing'), 2, 'tap 工具每次点击一发');
}
{
  const w = world({ grid: { hpAt: () => 99 } });
  const c = w.center(1, 1);
  eq(w.BM.TOOLS.attack('probe', c[0], c[1], { now: 0 }), true, '石镐第 1 击');
  eq(w.BM.TOOLS.ready(), false, '冷却中 ready() = false');
  eq(w.BM.TOOLS.attack('probe', c[0], c[1], { now: 0 }), false, '冷却中第 2 击被拒');
  w.BM.TOOLS.update(0.33, 0.33);
  eq(w.BM.TOOLS.ready(), false, '0.33s 时仍未就绪（0.34s 冷却）');
  w.BM.TOOLS.update(0.02, 0.35);
  eq(w.BM.TOOLS.ready(), true, '0.35s 时就绪');
  eq(w.BM.TOOLS.attack('probe', c[0], c[1], { now: 0.35 }), true, '就绪后第 2 击');
}
{
  const w = world({ grid: { hpAt: () => 99 } });
  const c = w.center(1, 1);
  eq(w.BM.TOOLS.attack('iron', c[0], c[1], { now: 0 }), true, '铁镐第 1 击');
  w.BM.TOOLS.update(0.41, 0.41);
  eq(w.BM.TOOLS.ready(), false, '0.41s 时仍未就绪（0.42s 冷却）');
  w.BM.TOOLS.update(0.02, 0.43);
  eq(w.BM.TOOLS.ready(), true, '0.43s 时就绪');
}
{
  const w = world({ grid: { hpAt: () => 99 }, mods: { holdIntervalMul: 0.5 } });
  const c = w.center(1, 1);
  w.BM.TOOLS.attack('probe', c[0], c[1], { now: 0 });
  w.BM.TOOLS.update(0.16, 0.16);
  eq(w.BM.TOOLS.ready(), false, 'holdIntervalMul=0.5 → 0.16s 仍冷却');
  w.BM.TOOLS.update(0.02, 0.18);
  eq(w.BM.TOOLS.ready(), true, 'holdIntervalMul=0.5 → 0.34×0.5=0.17s 就绪');
}
{
  // 按住连发节奏：石镐 0.34s
  const w = world({ grid: { hpAt: () => 99 } });
  const c = w.center(1, 1);
  w.BM.TOOLS.attack('probe', c[0], c[1], { hold: true, now: 0 });
  eq(w.BM.TOOLS.holding, true, '按住状态被记录');
  const dt = 1 / 60;
  let t = 0;
  const marks = [];
  for (let i = 0; i < 102; i++) {          // 1.7 秒
    const before = w.count('tool:swing');
    t += dt;
    w.BM.TOOLS.update(dt, t);
    if (w.count('tool:swing') > before) marks.push(t);
  }
  eq(marks.length, 4, '1.7s 内自动连打 4 次（0.34 / 0.68 / 1.02 / 1.36）');
  near(marks[0], 0.34, 0.02, '第一发自动连打落在 0.34s');
  near(marks[1] - marks[0], 0.34, 0.02, '连打间隔 0.34s');
}
{
  // 按住 = 自动连发，与 tool.mode 无关；木镐 interval = 0 → 每帧一发（无节拍上限）
  const w = world({ grid: { hpAt: () => 99 } });
  const c = w.center(1, 1);
  eq(w.BM.TOOLS.attack('wood', c[0], c[1], { hold: true, now: 0 }), true, '木镐按住的第一发');
  eq(w.BM.TOOLS.holding, true, 'mode=tap 的木镐按住状态同样被记录');
  for (let i = 1; i <= 120; i++) w.BM.TOOLS.update(1 / 60, i / 60);
  eq(w.count('tool:swing'), 121, '木镐 interval=0 → 按住 2 秒每帧一发（首击 + 120 帧）');
  w.BM.TOOLS.release();
  eq(w.BM.TOOLS.holding, false, 'release() 解除按住');
  const n = w.count('tool:swing');
  w.BM.TOOLS.update(1 / 60, 3);
  eq(w.count('tool:swing'), n, 'release() 之后不再自动连发');
}

/* ============ 3b. 统一输入：点按与按住共用 interval 节拍，超频点击直接丢弃 ============ */
section('3b. 统一输入：点按 / 按住同一节拍，落在频率之外的点击丢弃（不排队、不缓存、不报错）');
{
  // 快于 interval 的点按被丢弃：石镐 0.34s 一拍，0.1s 连点 10 次只落下 3 次
  const w = world({ grid: { hpAt: () => 99 } });
  const c = w.center(1, 1);
  const when = [];
  let dropped = 0;
  for (let i = 0; i < 10; i++) {
    if (w.BM.TOOLS.attack('probe', c[0], c[1], { now: i * 0.1 })) when.push(+(i * 0.1).toFixed(2));
    else dropped++;
    w.BM.TOOLS.update(0.1, (i + 1) * 0.1);
  }
  eq(when.join(','), '0,0.4,0.8', '石镐 0.1s 连点 10 次：只有 0 / 0.4 / 0.8 落下');
  eq(dropped, 7, '快于 interval 的 7 次被直接丢弃（不报错）');
  eq(w.count('tool:swing'), 3, 'tool:swing 与命中数一致');
}
{
  // 被拒的点击不排队：之后空闲多久都不会补发
  const w = world({ grid: { hpAt: () => 99 } });
  const c = w.center(1, 1);
  eq(w.BM.TOOLS.attack('probe', c[0], c[1], { now: 0 }), true, '石镐首击命中');
  let rejected = 0;
  for (let i = 1; i <= 12; i++) if (!w.BM.TOOLS.attack('probe', c[0], c[1], { now: i * 0.02 })) rejected++;
  eq(rejected, 12, '0.24s 内连点 12 次全部落在 0.34s 内 → 全被拒');
  eq(w.count('tool:swing'), 1, '被拒的点击没有被缓存：此刻仍然只有 1 发');
  for (let i = 1; i <= 120; i++) w.BM.TOOLS.update(1 / 60, 2 + i / 60);   // 空闲 2 秒
  eq(w.count('tool:swing'), 1, '空闲 2 秒也没有补发（不排队）');
  eq(w.BM.TOOLS.attack('probe', c[0], c[1], { now: 4 }), true, '节拍过去后新点击照常命中');
  eq(w.count('tool:swing'), 2, '补上的只有这一发，而不是欠账的 12 发');
}
{
  // 节拍对每个工具都生效（含 tap 类），换工具也不豁免
  const w = world({ grid: { hpAt: () => 99 } });
  const c = w.center(1, 1);
  eq(w.BM.TOOLS.attack('wood', c[0], c[1], { now: 0 }), true, '木镐第 1 击');
  eq(w.BM.TOOLS.attack('wood', c[0], c[1], { now: 0 }), true, '木镐 interval=0：同帧第 2 击仍放行');
  eq(w.count('tool:swing'), 2, '木镐两击两发');
  eq(w.BM.TOOLS.attack('diamond', c[0], c[1], { now: 0 }), true, '钻石镐出手');
  eq(w.BM.TOOLS.attack('diamond', c[0], c[1], { now: 0.3 }), false, '钻石镐 0.3s 点击被拒（< 0.55）');
  w.BM.TOOLS.update(0.3, 0.3);
  w.BM.TOOLS.update(0.26, 0.56);
  eq(w.BM.TOOLS.attack('diamond', c[0], c[1], { now: 0.56 }), true, '0.56s 后钻石镐可再次出手');
  eq(w.BM.TOOLS.attack('iron', c[0], c[1], { now: 0.56 }), false, '同帧换铁镐也被拒（cd 共用一份）');
  w.BM.TOOLS.update(0.56, 1.12);
  eq(w.BM.TOOLS.attack('iron', c[0], c[1], { now: 1.12 }), true, '铁镐节拍到了才放行');
  w.BM.TOOLS.update(0.09, 1.21);
  eq(w.BM.TOOLS.attack('iron', c[0], c[1], { now: 1.21 }), false, '铁镐 0.42s 节拍内 0.09s 点击被拒');
  eq(w.BM.TOOLS.ready(), false, '铁镐冷却中 ready() = false');
}
{
  // tap 工具按住 = 按自己的 interval 连发：钻石镐 0.55s → 2 秒 3 发
  const w = world({ grid: { hpAt: () => 999 } });
  const c = w.center(1, 1);
  eq(w.BM.TOOLS.attack('diamond', c[0], c[1], { hold: true, now: 0 }), true, '钻石镐按住第一发');
  const marks = [];
  let t = 0;
  for (let i = 0; i < 120; i++) {
    const before = w.count('tool:swing');
    t += 1 / 60;
    w.BM.TOOLS.update(1 / 60, t);
    if (w.count('tool:swing') > before) marks.push(t);
  }
  eq(marks.length, 3, '钻石镐（mode=tap、interval 0.55）按住 2 秒自动连发 3 次');
  near(marks[0], 0.55, 0.03, '第一发自动连打落在 0.55s 附近');
  near(marks[1] - marks[0], 0.55, 0.03, '连发间隔 ≈ 0.55s');
  near(marks[2] - marks[1], 0.55, 0.03, '连发间隔 ≈ 0.55s');
  eq(w.count('tool:swing'), 4, '含首击共 4 发');
  w.BM.TOOLS.release();
}
{
  // hold 工具点按（不带 hold）也出一次；不按住就不连发
  const w = world({ grid: { hpAt: () => 999 } });
  const c = w.center(2, 3);
  eq(w.BM.TOOLS.attack('laser', c[0], c[1], { now: 0 }), true, '激光钻点按就出一发');
  eq(w.count('laser:tick'), 1, '点按派发 laser:tick');
  eq(w.BM.TOOLS.holding, false, '点按不进按住状态');
  for (let i = 1; i <= 60; i++) w.BM.TOOLS.update(1 / 60, i / 60);
  eq(w.count('laser:tick'), 1, '没按住就不自动连发（1 秒 0 次补发）');
  eq(w.BM.TOOLS.attack('probe', c[0], c[1], { now: 1 }), true, '石镐（mode=hold）点按同样出一次');
  for (let i = 1; i <= 60; i++) w.BM.TOOLS.update(1 / 60, 1 + i / 60);
  eq(w.count('tool:swing'), 2, '石镐点按后没按住 → 1 秒内不再出手');
}
{
  // 按住 + 每帧乱点：不会快过 interval（点击与自动连发抢同一份 cd）
  const w = world({ grid: { hpAt: () => 999 } });
  const c = w.center(1, 1);
  w.BM.TOOLS.attack('probe', c[0], c[1], { hold: true, now: 0 });
  let t = 0, accepted = 0;
  for (let i = 0; i < 120; i++) {
    t += 1 / 60;
    if (w.BM.TOOLS.attack('probe', c[0], c[1], { hold: true, now: t })) accepted++;
    w.BM.TOOLS.update(1 / 60, t);
  }
  eq(accepted, 0, '按住期间每帧点击都被拒（节拍已被自动连发占满）');
  eq(w.count('tool:swing'), 6, '按住 2 秒乱点仍是 6 发（首击 + 0.34s 节拍的 5 次）');
}

/* ============================ 4. 铁镐纵向下探 ============================ */
section('4. 铁镐纵向：下探、跳过已挖空格、到底部不越界');
{
  const w = world({ grid: { hpAt: () => 99 } });
  w.block(2, 2).broken = true;                 // 目标下方那格已挖空
  const c = w.center(2, 1);
  w.BM.TOOLS.attack('iron', c[0], c[1], { now: 0 });
  const cells = w.all('tool:swing')[0].cells;
  eq(cells.map((b) => b.oy).join(','), '1,3', '跳过已挖空的第 2 行，继续打到第 3 行');
  eq(w.grid.dmgLog.length, 2, '仍然是 2 格伤害');
}
{
  const w = world({ grid: { hpAt: () => 99 } });
  w.block(2, 1).broken = true;                 // 目标格自己已挖空
  const c = w.center(2, 1);
  eq(w.BM.TOOLS.attack('iron', c[0], c[1], { now: 0 }), false, '点在坑洞上不出手（GRID.at 对坑洞返回 null）');
  eq(w.count('tool:swing'), 0, '不派发 tool:swing');
  eq(w.BM.TOOLS.ready(), true, '空点不计冷却');
}
{
  const w = world({ grid: { hpAt: () => 99 } });
  w.BM.CONFIG.tools.drill = { id: 'drill', dmg: 2, mode: 'hold', interval: 0.7, shape: 'column', reach: 2 };
  w.BM.CONFIG.tools.drill3 = { id: 'drill3', dmg: 2, mode: 'hold', interval: 0.7, shape: 'column3' };
  const c = w.center(1, 1);
  w.BM.TOOLS.attack('drill', c[0], c[1], { now: 0 });
  eq(w.all('tool:swing')[0].cells.length, 3, 'column + reach 2 → 3 格（兼容旧形状）');
  w.BM.TOOLS.reset();
  w.BM.TOOLS.attack('drill3', c[0], c[1], { now: 0 });
  eq(w.all('tool:swing')[1].cells.length, 3, 'column3 → 3 格');
}
{
  const w = world({ grid: { hpAt: () => 99 } });
  const c = w.center(3, 7);                    // 最后一行
  eq(w.BM.TOOLS.attack('iron', c[0], c[1], { now: 0 }), true, '贴底格出手不崩溃');
  eq(w.all('tool:swing')[0].cells.length, 1, '到底部只剩 1 格（不越界）');
  const c2 = w.center(3, 6);
  w.BM.TOOLS.reset();
  w.BM.TOOLS.attack('iron', c2[0], c2[1], { now: 0 });
  eq(w.all('tool:swing')[1].cells.length, 2, '倒数第二行仍是 2 格');
}
{
  const w = world({ grid: { hpAt: () => 99 } });
  w.block(1, 2).broken = true;
  w.block(1, 3).broken = true;
  w.block(1, 4).broken = true;                 // 目标下方一路挖空
  const c = w.center(1, 1);
  w.BM.TOOLS.attack('iron', c[0], c[1], { now: 0 });
  const cells = w.all('tool:swing')[0].cells;
  eq(cells.map((b) => b.oy).join(','), '1,5', '连续坑洞一路跳过后仍凑满 2 格');
}
{
  // 打穿目标格顶层 → 下一格继续挨打（层与格互不干扰）
  const w = world({ grid: { hpAt: () => 1, layersAt: () => 4 } });
  const c = w.center(2, 2);
  w.BM.TOOLS.attack('iron', c[0], c[1], { now: 0 });
  eq(w.block(2, 2).layers, 3, '目标格打穿 1 层');
  eq(w.block(2, 3).layers, 3, '下方格同样挨打 1 层');
  eq(w.count('block:layer'), 2, '两格各派发一次 block:layer');
  eq(w.count('block:break'), 0, '没有整格被挖空 → 不派发 block:break');
}

/* ============================ 5. block:layer 不计入 combo ============================ */
section('5. combo 只认 block:break（block:layer 不算）');
{
  const w = world({ grid: { hpAt: () => 1, layersAt: () => 4 }, mods: { chainChance: 0 } });
  const c = w.center(2, 3);
  w.BM.TOOLS.attack('wood', c[0], c[1], { now: 0 });
  eq(w.count('block:layer'), 1, '打穿一层派发 block:layer');
  eq(w.BM.TOOLS.combo, 0, 'block:layer 不增加 combo');
  eq(w.BM.TOOLS.stats.broken, 0, 'block:layer 不计入破坏数');
  for (let k = 0; k < 3; k++) {
    w.BM.TOOLS.reset();
    w.BM.TOOLS.update(2, 2 + k);
    w.BM.TOOLS.attack('wood', c[0], c[1], { now: 0 });
  }
  eq(w.block(2, 3).broken, true, '第 4 击把整格挖空');
  eq(w.BM.TOOLS.combo, 1, '只有整格挖空才 +1 combo');
  eq(w.BM.TOOLS.stats.broken, 1, 'stats.broken = 1');
}

/* ============================ 6. TNT：只剩白掉这一条路 ============================ */
section('6. TNT：可放置 TNT 已整套删除，只剩「挖穿一层白掉」');
{
  const w = world({});
  const T = w.BM.TOOLS;
  eq(T.beginTNT, undefined, 'TOOLS.beginTNT 已删除（投放接口下线）');
  eq(T.placeTNT, undefined, 'TOOLS.placeTNT 已删除');
  eq(T.tntArmed, undefined, 'TOOLS.tntArmed 已删除（没有投掷态）');
  eq(T.explosiveLeft, undefined, 'TOOLS.explosiveLeft 已删除（没有每局弹药）');
  eq(w.count('tnt:fuse'), 0, '投放事件 tnt:fuse 不再派发');

  const zero = world({ grid: { hpAt: () => 1, layersAt: () => 8 } });
  const c = zero.center(3, 3);
  zero.BM.TOOLS.attack('wood', c[0], c[1], { now: 0 });
  eq(zero.count('lucky:tnt'), 0, 'luckyTNTChance = 0（还没点天赋的假 mods）时一枚都不掉');
}
{
  const w = world({ grid: { hpAt: () => 1, layersAt: () => 8 } });
  dropLuckyTNT(w, 3, 3);
  const lt = w.all('lucky:tnt');
  eq(lt.length, 1, '挖穿一层 → 白掉一枚幸运 TNT');
  near(lt[0].delay, 1.8, 1e-9, 'lucky:tnt.delay = 1.8 秒（掉落长引线，tuning.luckyTNTFuseSec）');
  eq(w.BM.TOOLS.fuses, 1, '引信入队');
  eq(w.count('explosion'), 0, '引信期间不爆炸');
  w.BM.TOOLS.update(1.70, 1.70);
  eq(w.count('explosion'), 0, '1.7s 时长引线还没到');
  w.BM.TOOLS.update(0.15, 1.85);
  eq(w.count('explosion'), 1, '1.8s 后自爆（唯一的引线）');
  eq(w.BM.TOOLS.fuses, 0, '引信队列入场即清空');
}
{
  // 角落：3×3 被棋盘裁掉
  const w = world({ grid: { hpAt: () => 1, layersAt: () => 8 } });
  dropLuckyTNT(w, 0, 0, 0);                    // rand 0 → 落点就取列表第一个 = (0,0) 自己
  w.BM.TOOLS.update(1.9, 1.9);
  eq(w.all('explosion')[0].cells, 4, '角落落点 3×3 被裁到 4 格');
  eq(w.grid.layerLog.length, 4, '只对实际存在的格子调 damageLayers');
}
{
  // 坑洞不计入落点：落点 3×3 里有一格已是坑洞 → 8 格
  const w = world({ grid: { hpAt: () => 1, layersAt: () => 8 } });
  w.block(2, 2).broken = true;
  dropLuckyTNT(w, 2, 3);
  w.BM.TOOLS.update(1.9, 1.9);
  eq(w.grid.layerLog.length, 8, '坑洞不调用 damageLayers（3×3 → 8 格）');
  eq(w.all('explosion')[0].cells, 8, 'explosion.cells = 8');
}

/* ============================ 7. TNT 爆炸：3×3 固定 / 多层穿透 ============================ */
section('7. TNT 爆炸：3×3 固定范围、穿透随天赋、层不够就挖空');
{
  const w = world({ mods: { tntLayerPierce: 3 }, grid: { hpAt: () => 1, layersAt: () => 8 } });
  dropLuckyTNT(w, 3, 3);
  w.BM.TOOLS.update(1.9, 1.9);
  eq(w.grid.layerLog.length, 9, '3×3 = 9 格各调一次 damageLayers');
  let allDmg = true, allPierce = true;
  for (const r of w.grid.layerLog) {
    if (r.dmg !== 3) allDmg = false;
    if (r.pierce !== 3) allPierce = false;
  }
  eq(allDmg, true, '每格伤害 = round(木镐 1 × CONFIG.tnt.damageMul 3) = 3（不再是固定 6）');
  eq(allPierce, true, '穿透层数 = mods.tntLayerPierce = 3');
  const center = w.block(3, 3);
  eq(center.depth, 3, '中心格被打穿 3 层');
  eq(center.layers, 5, '8 层剩 5 层');
  eq(w.block(2, 2).depth, 3, '角上那格同样 3 层');
  eq(w.block(1, 1).depth, 0, '3×3 之外的格子毫发无损');
  eq(w.count('block:layer'), 9 * 3, '9 格 × 3 层 = 27 次 block:layer');
  eq(w.count('block:break'), 0, '还有余层 → 没有整格挖空');
  eq(w.BM.TOOLS.stats.explosions, 1, 'stats.explosions +1');
  const ex = w.all('explosion')[0];
  eq(ex.cells, 9, 'explosion.cells = 9');
  eq(ex.power > 0, true, 'explosion.power > 0');
  near(ex.radiusPx, 90, 0.001, '3×3 冲击半径 = 1.5 格 = 90px');
}
{
  // BALANCE-V4 §6：TNT 伤害 = round(当前工具伤害 × CONFIG.tnt.damageMul)，随工具缩放
  const wood = world({ grid: { hpAt: () => 1, layersAt: () => 8 } });
  const cw = wood.center(3, 3);
  eq(wood.BM.TOOLS.tntDamage, 3, '木镐（1 × 3）→ TNT 每格 3 点');
  wood.BM.TOOLS.attack('wood', cw[0], cw[1], { now: 0 });
  wood.grid.layerLog.length = 0;
  dropLuckyTNT(wood, 3, 3);
  wood.BM.TOOLS.update(1.9, 1.9);
  eq(wood.BM.TOOLS.tntDamage, 3, '木镐局内 tntDamage 仍是 3');
  ok(wood.grid.layerLog.length > 0 && wood.grid.layerLog.every((e) => e.dmg === 3), '木镐 TNT 实测每格 3 点', wood.grid.layerLog.map((e) => e.dmg).join(','));

  const dia = world({ grid: { hpAt: () => 1, layersAt: () => 8 } });
  const cd = dia.center(3, 3);
  eq(dia.BM.TOOLS.tntDamage, 3, '未出手时按木镐兜底 → 3');
  dia.BM.TOOLS.attack('diamond', cd[0], cd[1], { now: 0 });
  eq(dia.BM.TOOLS.tntDamage, 30, '钻石镐（10 × 3）→ TNT 每格 30 点');
  dia.grid.layerLog.length = 0;
  dropLuckyTNT(dia, 3, 3);
  dia.BM.TOOLS.update(1.9, 1.9);
  ok(dia.grid.layerLog.length > 0 && dia.grid.layerLog.every((e) => e.dmg === 30), '钻石镐 TNT 实测每格 30 点（随工具放大）', dia.grid.layerLog.map((e) => e.dmg).join(','));
  ok(dia.grid.layerLog.every((e) => e.dmg !== 6), '不再是固定 6', dia.grid.layerLog[0].dmg);

  // CONFIG 里的现用键名 tntDamageMul 也能驱动公式
  const alias = world({});
  alias.BM.CONFIG.tnt.damageMul = undefined;
  alias.BM.CONFIG.tnt.tntDamageMul = 5;
  eq(alias.BM.TOOLS.tntDamage, 5, 'CONFIG.tnt.tntDamageMul = 5 → 木镐 1 × 5 = 5（键名兼容）');

  // 穿透层数取 CONFIG.tnt.layerPierce（mods 缺键时也成立）
  const cfgPierce = world({ grid: { hpAt: () => 1, layersAt: () => 8 } });
  delete cfgPierce.mods.tntLayerPierce;
  eq(cfgPierce.BM.TOOLS.tntPierce, 2, 'TOOLS.tntPierce = CONFIG.tnt.layerPierce = 2');
  dropLuckyTNT(cfgPierce, 3, 3);
  cfgPierce.BM.TOOLS.update(1.9, 1.9);
  eq(cfgPierce.grid.layerLog[0].pierce, 2, 'TNT 穿透 2 层（v4：3 → 2）');
  eq(cfgPierce.block(3, 3).depth, 2, '实际只打穿 2 层');
}
{
  // GRID 没有 damageLayers 时退回逐层 damage（不崩、层数一致）
  const w = world({ mods: { tntLayerPierce: 3 }, grid: { hpAt: () => 1, layersAt: () => 4 } });
  delete w.grid.damageLayers;
  dropLuckyTNT(w, 3, 3);
  w.BM.TOOLS.update(1.9, 1.9);
  eq(w.grid.dmgLog.length, 27, '兜底：9 格 × 3 层 = 27 次 damage');
  eq(w.block(3, 3).depth, 3, '兜底同样打穿 3 层');
  eq(w.count('explosion'), 1, '兜底仍然派发一次 explosion');
}
{
  const w = world({ mods: { tntLayerPierce: 4 }, grid: { hpAt: () => 1, layersAt: () => 8 } });
  dropLuckyTNT(w, 2, 2);
  w.BM.TOOLS.update(1.9, 1.9);
  eq(w.grid.layerLog[0].pierce, 4, '穿透满链（2 + 2）→ 4 层');
  eq(w.block(2, 2).depth, 4, '实际打穿 4 层');
}
{
  // 范围不吃天赋，只吃 tuning.luckyTNTSide（v14：半径天赋已随放置删除）
  const w = world({ tuning: { luckyTNTSide: 5 }, grid: { hpAt: () => 1, layersAt: () => 2 } });
  dropLuckyTNT(w, 3, 3);
  w.BM.TOOLS.update(1.9, 1.9);
  eq(w.grid.layerLog.length, 25, 'luckyTNTSide = 5 → 5×5 = 25 格各调一次 damageLayers');
  eq(w.block(1, 1).depth, 2, '5×5 边缘格子也挨打');
  eq(w.block(0, 0).depth, 0, '5×5 之外不受影响');
  near(w.all('explosion')[0].radiusPx, 150, 0.001, '5×5 冲击半径 = 2.5 格 = 150px');
}
{
  // 层不够时会挖空整格并派发 block:break（进掉落与 combo）
  const w = world({ mods: { tntLayerPierce: 3 }, grid: { hpAt: () => 1, layersAt: () => 2 } });
  dropLuckyTNT(w, 3, 3);
  w.BM.TOOLS.update(1.9, 1.9);
  eq(w.block(3, 3).broken, true, '2 层格被 3 层穿透挖空');
  eq(w.count('block:break'), 9, '9 格全部挖空 → 9 次 block:break');
  eq(w.count('chain:tick'), 1, '整次爆炸只派发一次 chain:tick');
  eq(w.all('chain:tick')[0].count, 9, 'chain:tick.count = 9 格');
}

/* ============================ 8. 每局重置 ============================ */
section('8. reset()/setZone()：引信清空、luckyUsed 归零、每局总量上限可配');
{
  const w = world({ grid: { hpAt: () => 1, layersAt: () => 20 } });
  dropLuckyTNT(w, 3, 3);
  eq(w.BM.TOOLS.fuses, 1, '引信 1 枚在飞');
  eq(w.BM.TOOLS.luckyUsed, 1, 'luckyUsed = 1');
  eq(w.BM.TOOLS.luckyMax, 400, 'luckyMax = tuning.luckyTNTTotalMax = 400（很宽的上限）');
  w.BM.TOOLS.reset();
  eq(w.BM.TOOLS.fuses, 0, 'reset() 清空引信');
  eq(w.BM.TOOLS.luckyUsed, 0, 'reset() 清零本局计数');
  dropLuckyTNT(w, 2, 2);
  eq(w.BM.TOOLS.luckyUsed, 1, '新一局重新开始计数');
  w.BM.TOOLS.setZone({ id: 'ironmine' });
  eq(w.BM.TOOLS.luckyUsed, 0, 'setZone()（开局）同样清零');
  eq(w.BM.TOOLS.fuses, 0, 'setZone() 同样清空引信');
}



/* ============================ 9. 掉落数量公式（stone / coal / iron / crystal） ============================ */
/* v3 口径（CONTRACT-V3 §2）：drop / richDrop 直接就是每层掉落数，不再叠乘 tuning.richCellMul(3)；
 * 富矿格只额外 × mods.richMul（富矿天赋）。所以旧的 9/27/16/48 这些「已经乘过 3 倍」的期望
 * 一律按新口径换成 2/5/3/9 一类的新值：
 *   富矿煤 = richDrop 2（旧 3×3=9）；富矿铁 = richDrop 5（旧 9×3=27）；
 *   富矿石 2 × richMul 1.5 = 3（旧 16）；富矿铁 5 × 1.5 = 7（旧 48）。
 * v4（BALANCE-V4 §4）：dropMul 与狂热倍率不再进入掉落数量，只有富矿格额外 × mods.richMul。 */
section('9. spawnForBlock 数量公式（四矿种，v3 掉落口径）');
{
  const w = world({ mods: { dropFlat: 2 } });
  const D = w.BM.DROPS;
  const r = fixedRandom(0);                 // stone drop 1
  eq(D.spawnForBlock(fakeBlock('stone', false)), 3, '普通石头：drop 1 + dropFlat 2 = 3');
  r();
  const r2 = fixedRandom(0.99);             // coal drop 1（单值）
  eq(D.spawnForBlock(fakeBlock('coal', false)), 3, '普通煤：drop 1 + dropFlat 2 = 3');
  r2();
}
{
  const w = world({ mods: {} });
  const D = w.BM.DROPS;
  const r = fixedRandom(0);
  eq(D.spawnForBlock(fakeBlock('coal', true)), 2, '富矿煤 = richDrop 2（旧口径 9 已作废）');
  r();
  const r2 = fixedRandom(0.99);
  eq(D.spawnForBlock(fakeBlock('iron', false)), 3, '普通铁 = drop 3');
  r2();
  const r3 = fixedRandom(0.99);
  eq(D.spawnForBlock(fakeBlock('iron', true)), 5, '富矿铁 = richDrop 5（旧口径 27 已作废）');
  r3();
  const r4 = fixedRandom(0.99);
  eq(D.spawnForBlock(fakeBlock('crystal', false)), 2, '晶石 = drop 2');
  r4();
  const r5 = fixedRandom(0.99);
  eq(D.spawnForBlock(fakeBlock('crystal', true)), 4, '富矿晶石 = richDrop 4');
  r5();
}
{
  const w = world({ mods: { richMul: 1.5, dropMul: 1.2 } });
  const D = w.BM.DROPS;
  const r = fixedRandom(0);                 // 富矿石 2 → ×1.5=3 → ×1.2=3.6
  eq(D.spawnForBlock(fakeBlock('stone', true)), 3, '富矿石 2 × richMul 1.5 × dropMul 1.2 = 3.6 → 3（旧 16）');
  r();
  const r2 = fixedRandom(0.99);             // 富矿铁 5 → ×richMul 1.5 = 7.5 → 7（dropMul 1.2 不再叠乘）
  eq(D.spawnForBlock(fakeBlock('iron', true)), 7, '富矿铁 5 × richMul 1.5 = 7.5 → 7（dropMul 不参与）');
  r2();
}
{
  // 旧口径反例：普通格吃不到 richMul
  const w = world({ mods: { richMul: 3 } });
  const r = fixedRandom(0);
  eq(w.BM.DROPS.spawnForBlock(fakeBlock('stone', false)), 1, 'richMul 不作用于普通格（仍是 drop 1）');
  r();
}
{
  const w = world({ mods: { dropMul: 0 } });
  eq(w.BM.DROPS.spawnForBlock(fakeBlock('stone', false)), 1, 'dropMul=0 普通石头仍是 drop 1');
  eq(w.BM.DROPS.spawnForBlock(fakeBlock('iron', true)), 5, 'dropMul 不再削减免率（富矿铁 = richDrop 5）');
  const big = world({ mods: { dropMul: 5 } });
  eq(big.BM.DROPS.spawnForBlock(fakeBlock('stone', false)), 1, 'dropMul 也不再放大（普通石头仍是 1）');
  eq(big.BM.DROPS.spawnForBlock(fakeBlock('coal', true)), 2, '富矿煤 = richDrop 2（不乘 dropMul）');
}
{
  const w = world({ mods: {} });
  const r = fixedRandom(0.5);
  w.BM.DROPS.spawnForBlock(fakeBlock('iron', false));   // iron drop 3
  r();
  const sp = w.all('drop:spawn');
  eq(sp.length, 1, 'drop:spawn 派发一次');
  eq(sp[0].ore, 'iron', 'drop:spawn.ore = iron');
  eq(sp[0].amount, 3, 'drop:spawn.amount 与公式一致（铁 3）');
  eq(typeof sp[0].x === 'number' && typeof sp[0].y === 'number', true, 'drop:spawn 带设计空间坐标');
  eq(sp[0].rich, false, 'drop:spawn.rich = false');
}
{
  // 狂热 ×frenzyMult
  const w = world({ mods: {}, grid: { hpAt: () => 1, layersAt: () => 1 } });
  const r = fixedRandom(0);
  const base = w.BM.DROPS.spawnForBlock(fakeBlock('stone', false));
  r();
  eq(base, 1, '非狂热基准 = 1');
  w.BM.TOOLS.reset();
  for (let i = 0; i < 8; i++) breakOnce(w);
  eq(w.count('frenzy:start'), 1, 'combo 到 8 触发狂热');
  const rf = fixedRandom(0);
  const during = w.BM.DROPS.spawnForBlock(fakeBlock('stone', false));
  rf();
  eq(during, 1, '狂热不再乘掉落倍率（BALANCE-V4 §4：收益靠单价与层数）');
  eq(w.BM.TOOLS.frenzyMult, 3, '狂热倍率仍对外可见（表现层用），只是不进掉落数量');
}

/* ============================ 10. 连锁与连击沿用 v1 ============================ */
section('10. 连锁（v16 chainCells：每碎一格确定性炸十字相邻 N 格）与连击维护');
{
  // 邻格起点是随机挑的（rollChain 里 (i + random) % list.length），钉住 Math.random 才有确定读数
  const r = fixedRandom(0);
  const w = world({ mods: { chainCells: 4 }, grid: { hpAt: () => 1, layersAt: () => 1 } });
  const c = w.center(2, 3);
  eq(w.BM.TOOLS.attack('wood', c[0], c[1], { now: 0 }), true, '首发命中');
  for (let i = 0; i < 60; i++) w.BM.TOOLS.update(1 / 60, i / 60);
  r();
  eq(w.count('explosion'), 0, 'v16 的连锁不再走旧的爆炸队列（没有 explosion 事件）');
  eq(w.count('tool:chain'), 4, '连锁格数 = 十字相邻 4 格（chainCells = 4）');
  eq(w.count('chain:tick'), 1, '整击只派发一次 chain:tick');
  eq(w.all('chain:tick')[0].count, 5, 'chain:tick.count = 首发 1 + 连锁 4');
  eq(w.BM.TOOLS.stats.maxChain, 4, 'stats.maxChain = 4');
  eq(w.BM.TOOLS.stats.broken, 5, 'stats.broken = 5');
  eq(w.BM.TOOLS.combo, 5, 'combo 累加全部破坏格');
  let maxHit = 0;
  for (const n of w.grid.hits.values()) maxHit = Math.max(maxHit, n);
  eq(maxHit, 1, '没有格子被重复伤害/重复炸');
}
{
  const w = world({ mods: { chainCells: 0 }, grid: { hpAt: () => 1, layersAt: () => 1 } });
  const c = w.center(2, 3);
  w.BM.TOOLS.attack('wood', c[0], c[1], { now: 0 });
  eq(w.count('tool:chain'), 0, 'chainCells=0 不触发连锁');
  eq(w.all('chain:tick')[0].count, 1, '无连锁时 chain:tick.count = 1');
  // 1.2 秒无破坏 → combo 清零
  for (let i = 0; i < 90; i++) w.BM.TOOLS.update(1 / 60, i / 60);
  eq(w.BM.TOOLS.combo, 0, '1.2 秒无破坏 combo 清零');
  eq(w.all('combo:update').pop().combo, 0, '清零时派发 combo:update {combo:0}');
}
{
  const r = fixedRandom(0);
  const w = world({ mods: { chainCells: 3 }, grid: { hpAt: () => 1, layersAt: () => 1 } });
  const c = w.center(2, 3);
  w.BM.TOOLS.attack('wood', c[0], c[1], { now: 0 });
  for (let i = 0; i < 60; i++) w.BM.TOOLS.update(1 / 60, i / 60);
  r();
  eq(w.count('tool:chain'), 3, 'chainCells = 3 → 每次碎层只炸 3 格（2 环 3 / 满链 10，上限 10）');
}

/* ============================ 11. 磁吸 ============================ */
section('11. 磁吸与入包');
function drain(w, maxFrames) {
  let frames = 0;
  while (w.BM.DROPS.inFlight > 0 && frames < maxFrames) {
    w.BM.TOOLS.update(1 / 60, frames / 60);
    w.BM.DROPS.update(1 / 60);
    frames++;
  }
  return frames;
}
{
  const w = world({ mods: { magnetSpeedMul: 1 } });
  const r = fixedRandom(0.5);
  const amt = w.BM.DROPS.spawnForBlock(fakeBlock('coal', false));
  r();
  const frames = drain(w, 600);
  ok(frames > 0 && frames < 120, '磁吸在 2 秒内到达 HUD', frames);
  eq(w.BM.DROPS.inFlight, 0, '全部掉落完成吸收');
  eq(w.BM.DROPS.counts.coal, amt, 'counts.coal 等于掉落数量');
  const ab = w.all('drop:absorb');
  eq(ab.length, 1, 'drop:absorb 派发一次');
  eq(w.count('magnet:burst'), 1, '抛物结束进入磁吸时派发 magnet:burst');
  near(ab[0].x, 195, 0.001, 'drop:absorb 落在 HUD 点 x=195');
  near(ab[0].y, 70, 0.001, 'drop:absorb 落在 HUD 点 y=70');

  const w2 = world({ mods: { magnetSpeedMul: 0.5 } });
  const r2 = fixedRandom(0.5);
  w2.BM.DROPS.spawnForBlock(fakeBlock('coal', false));
  r2();
  const frames2 = drain(w2, 600);
  ok(frames2 > frames, 'magnetSpeedMul=0.5 到达更慢', frames + ' → ' + frames2);
}

/* ============================ 12. absorbAll / 240 上限不漏 ============================ */
section('12. absorbAll 与上限合并绝不丢数量');
{
  const w = world({ mods: {} });
  const D = w.BM.DROPS;
  const countsRef = D.counts;
  const r = seedRandom(12345);
  let expect = 0;
  const plan = [['stone', false], ['coal', false], ['iron', true], ['stone', true], ['coal', true], ['iron', false]];
  for (const [ore, rich] of plan) expect += D.spawnForBlock(fakeBlock(ore, rich));
  r();
  eq(D.inFlight, 6, '场上 6 个掉落');
  eq(D.counts, countsRef, 'counts 是同一对象引用（main 每帧读）');
  D.absorbAll();
  const total = (D.counts.stone || 0) + (D.counts.coal || 0) + (D.counts.iron || 0);
  eq(total, expect, 'absorbAll 后总数量与掉落数量完全一致（不漏）');
  eq(D.inFlight, 0, 'absorbAll 后场上清空');
  eq(w.count('drop:absorb'), 6, 'absorbAll 为每个掉落派发 drop:absorb');
  eq(D.counts, countsRef, 'absorbAll 后仍是同一对象');
  D.reset();
  eq(D.inFlight, 0, 'reset() 清空场上掉落');
  eq(D.counts.stone, undefined, 'reset() 清空计数（对象引用不变）');
  eq(D.counts, countsRef, 'reset() 仍保持对象引用');
}
{
  const w = world({ mods: {} });
  const D = w.BM.DROPS;
  const r = fixedRandom(0);
  let expect = 0;
  let maxInFlight = 0;
  for (let i = 0; i < 300; i++) {
    expect += D.spawnForBlock(fakeBlock(i % 3 === 0 ? 'iron' : 'stone', i % 5 === 0));
    if (D.inFlight > maxInFlight) maxInFlight = D.inFlight;
  }
  r();
  eq(maxInFlight, 240, '场上掉落上限 240');
  D.absorbAll();
  eq((D.counts.stone || 0) + (D.counts.iron || 0), expect, '超限合并后 absorbAll 仍一滴不漏');
}
{
  // 端到端：破坏 → 掉落 → 入包（v2 三层石镐链路）
  const w = world({ mods: { chainChance: 0 }, grid: { hpAt: () => 3, layersAt: () => 1 }, tuning: {} });
  const r = seedRandom(99);
  const c = w.center(2, 2);
  w.BM.TOOLS.attack('probe', c[0], c[1], { now: 0 });
  eq(w.count('drop:spawn'), 0, '第一击没挖空 → 不掉落');
  w.BM.TOOLS.update(0.4, 0.4);
  w.BM.TOOLS.attack('probe', c[0], c[1], { now: 0.4 });
  eq(w.count('drop:spawn'), 1, '挖空整格立即生成一份掉落');
  const spawned = w.all('drop:spawn')[0];
  const frames = drain(w, 600);
  r();
  eq(w.BM.DROPS.counts.stone, spawned.amount, '掉落最终入包（counts 与事件一致）');
  ok(frames < 120, '整条链路 2 秒内完成', frames);
  eq(w.BM.TOOLS.stats.broken, 1, 'stats.broken 记录整格破坏数');
}

/* ============================ 13. draw：瞄准与引信 ============================ */
section('13. draw()：瞄准描边 / 十字准星（引信预览已随放置 TNT 删除）');
function mockCtx() {
  const calls = {};
  const c = { calls };
  for (const m of ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill',
    'arc', 'strokeRect', 'fillRect', 'setLineDash', 'closePath', 'clearRect']) {
    c[m] = () => { calls[m] = (calls[m] || 0) + 1; };
  }
  return c;
}
{
  const w = world({});
  const ctx = mockCtx();
  w.BM.TOOLS.draw(ctx);
  eq(ctx.calls.strokeRect || 0, 0, '未瞄准时 draw 不画任何东西');

  const c = w.center(3, 3);
  w.BM.TOOLS.setAim(c[0], c[1]);
  w.BM.TOOLS.draw(ctx);
  eq(ctx.calls.strokeRect, 1, '瞄准格描边 1 个矩形');
  ok((ctx.calls.stroke || 0) > 0, '十字准星用 stroke 绘制');

  // 引信落点预览随放置 TNT 一起删除：白掉的 TNT 的金框/长引信交给表现层（lucky:tnt）
  dropLuckyTNT(w, 3, 3);
  const ctx2 = mockCtx();
  w.BM.TOOLS.update(0.4, 0.4);
  w.BM.TOOLS.draw(ctx2);
  eq(ctx2.calls.strokeRect, 1, '引信期间 draw 只画瞄准格，不再画落点虚框（表现层负责）');
  eq(ctx2.calls.arc || 0, 0, '不再画倒计时环');
}
{
  const w = world({ mods: { chainCells: 1 }, grid: { hpAt: () => 10, layersAt: () => 8 } });
  const ctx = mockCtx();
  const c = w.center(2, 3);
  w.BM.TOOLS.attack('iron', c[0], c[1], { hold: true, now: 0 });
  w.BM.TOOLS.update(1 / 60, 1 / 60);
  w.BM.TOOLS.draw(ctx);
  ok((ctx.calls.strokeRect || 0) > 0, '目标格描边已绘制');
  ok((ctx.calls.arc || 0) > 0, '按住时的攻击进度环已绘制');
  ok((ctx.calls.stroke || 0) > 1, '十字准星 / 下探锯齿用 stroke 绘制');
}

/* ============================ 14. 帧预算 ============================ */
section('14. 帧预算：240 掉落 + 引信下 update/draw 不退化');
{
  const w = world({ mods: { chainCells: 2 }, grid: { hpAt: () => 4, layersAt: () => 6 } });
  const ctx = mockCtx();
  const r = fixedRandom(0.5);
  for (let i = 0; i < 240; i++) w.BM.DROPS.spawnForBlock(fakeBlock('stone', false));
  r();
  const c = w.center(2, 3);
  dropLuckyTNT(w, 2, 3);                      // 场上挂一颗白掉的 TNT，量 update/draw 的引信开销
  w.BM.TOOLS.attack('iron', c[0], c[1], { hold: true, now: 0 });
  const t0 = Date.now();
  for (let i = 0; i < 600; i++) {
    w.BM.TOOLS.update(1 / 60, i / 60);
    w.BM.DROPS.update(1 / 60);
    w.BM.TOOLS.draw(ctx);
    w.BM.DROPS.draw(ctx);
  }
  const ms = Date.now() - t0;
  console.log('  ·    600 帧实测 ' + ms + 'ms，平均 ' + (ms / 600).toFixed(3) + 'ms/帧');
  ok(ms < 1200, '600 帧 update+draw 总耗时 < 1200ms', ms + 'ms');
}

/* ============================ 15. v3 形状 ============================ */
section('15. v13 §4 形状：single / column2 / square3 / columnAll');
{
  const w = world({ grid: { hpAt: () => 999 } });
  eq(Object.keys(w.BM.CONFIG.tools).length, 5, '四把正式工具 + 1 把测试镐都注册进 CONFIG.tools');
  eq(w.BM.CONFIG.tools.laser.shape, 'columnAll', '激光钻 shape = columnAll');
  const c = w.center(2, 3);
  eq(w.BM.TOOLS.attack('diamond', c[0], c[1], { now: 0 }), true, '钻石镐出手');
  const cells = w.all('tool:swing')[0].cells;
  eq(cells.length, 9, 'square3 = 3×3 = 9 格');
  eq(cells.map((b) => b.ox + ',' + b.oy).sort().join(' '), '1,2 1,3 1,4 2,2 2,3 2,4 3,2 3,3 3,4', '以目标格为中心');
  eq(w.grid.dmgLog.length, 9, '9 格各结算一次伤害');
  eq(w.grid.dmgLog.find((r) => r.block.ox === 2 && r.block.oy === 3).dmg, 10, '中心格 100% → 10 点');
  const ring = w.grid.dmgLog.filter((r) => !(r.block.ox === 2 && r.block.oy === 3));
  eq(ring.length, 8, '其余 8 格');
  eq(ring.every((r) => r.dmg === 5), true, '外圈 45% → round(10 × 0.45) = 5', ring.map((r) => r.dmg).join(','));
}
{
  // BALANCE-V4 §5：square3 中心/外圈伤害比 = 1 : 0.45；衰减不改命中格数
  const w = world({ grid: { hpAt: () => 999 }, mods: { damage: 10 } });
  const c = w.center(2, 3);
  w.BM.TOOLS.attack('diamond', c[0], c[1], { now: 0 });
  const ctr = w.grid.dmgLog.find((r) => r.block.ox === 2 && r.block.oy === 3).dmg;
  const out = w.grid.dmgLog.find((r) => r.block.ox === 3 && r.block.oy === 2).dmg;
  eq(ctr, 20, '中心 = 钻石镐 10 + mods.damage 10 = 20');
  eq(out, 9, '外圈 = round(20 × 0.45) = 9');
  near(out / ctr, 0.45, 1e-9, 'square3 中心/外圈伤害比 = 1 : 0.45');
  eq(w.all('tool:swing')[0].cells.length, 9, '溅射衰减不影响 tool:swing.cells（仍 9 格）');
}
{
  // 边角：越界格直接跳过
  const w = world({ grid: { hpAt: () => 999 } });
  const c = w.center(0, 0);
  w.BM.TOOLS.attack('diamond', c[0], c[1], { now: 0 });
  eq(w.all('tool:swing')[0].cells.length, 4, '角落 3×3 只剩 4 格（越界跳过）');
}
{
  // 坑洞：broken / layers<=0 的格跳过
  const w = world({ grid: { hpAt: () => 999 } });
  w.block(1, 2).broken = true;              // 坑洞
  w.block(3, 4).layers = 0;                 // layers<=0
  const c = w.center(2, 3);
  w.BM.TOOLS.attack('diamond', c[0], c[1], { now: 0 });
  eq(w.all('tool:swing')[0].cells.length, 7, '3×3 里跳过 1 个坑洞 + 1 个 layers<=0 = 7 格');
}
{
  const w = world({ grid: { hpAt: () => 999 } });
  const c = w.center(2, 3);
  w.BM.TOOLS.attack('laser', c[0], c[1], { now: 0 });
  const cells = w.all('tool:swing')[0].cells;
  eq(cells.length, 8, 'columnAll = 目标所在整列 8 格');
  eq(cells.map((b) => b.ox).join(','), '2,2,2,2,2,2,2,2', '全在同一列');
  eq(cells.map((b) => b.oy).join(','), '0,1,2,3,4,5,6,7', '整列自上而下');
}
{
  const w = world({ grid: { hpAt: () => 999 } });
  w.block(4, 1).broken = true;
  const c = w.center(4, 5);
  w.BM.TOOLS.attack('laser', c[0], c[1], { now: 0 });
  eq(w.all('tool:swing')[0].cells.length, 7, 'columnAll 跳过已挖空的格（8 - 1 = 7）');
}

/* ============================ 16. 激光 ============================ */
section('16. 激光：hold / 0.15s 每 tick 整列结算 + tool:swing & laser:tick');
{
  const w = world({ grid: { hpAt: () => 999 }, mods: { laserDamage: 2 } });
  const c = w.center(2, 3);
  eq(w.BM.TOOLS.attack('laser', c[0], c[1], { hold: true, now: 0 }), true, '激光第一次出手');
  eq(w.count('laser:tick'), 1, '第一 tick 派发 laser:tick');
  const tick = w.all('laser:tick')[0];
  eq(tick.cells, 8, 'laser:tick.cells = 该列命中格数 8');
  eq(tick.h, 8, 'laser:tick.h = 光束高度（格）8');
  near(tick.x, c[0], 0.001, 'laser:tick.x 取目标格中心');
  near(tick.y, c[1], 0.001, 'laser:tick.y 取目标格中心');
  eq(w.count('tool:swing'), 1, '同一 tick 也派发 tool:swing');
  eq(w.grid.dmgLog.length, 8, '整列 8 格各结算一次');
  eq(w.grid.dmgLog.find((r) => r.block.oy === 3).dmg, 6, '目标格伤害 = 4 + mods.laserDamage 2');
  const restCol = w.grid.dmgLog.filter((r) => r.block.oy !== 3);
  eq(restCol.length, 7, '同列其它 7 格命中');
  eq(restCol.every((r) => r.dmg === 4), true, '同列其它格 70% → round(6 × 0.7) = 4', restCol.map((r) => r.dmg).join(','));

  const dt = 1 / 60;
  let t = 0;
  const marks = [];
  for (let i = 0; i < 36; i++) {           // 0.6 秒
    const before = w.count('laser:tick');
    t += dt;
    w.BM.TOOLS.update(dt, t);
    if (w.count('laser:tick') > before) marks.push(t);
  }
  eq(marks.length, 4, '0.6s 内自动再 tick 4 次（0.15 / 0.30 / 0.45 / 0.60）');
  near(marks[0], 0.15, 0.02, '第一 tick 落在 0.15s');
  near(marks[1] - marks[0], 0.15, 0.02, 'tick 间隔 0.15s');
  eq(w.count('tool:swing'), 5, '每次 tick 各派发一次 tool:swing');
  eq(w.count('laser:tick'), 5, 'laser:tick 与 tool:swing 一一对应');
  w.BM.TOOLS.release();
}
{
  const w = world({ grid: { hpAt: () => 999 } });
  const c = w.center(1, 2);
  w.BM.TOOLS.attack('laser', c[0], c[1], { now: 0 });
  eq(w.grid.dmgLog.find((r) => r.block.oy === 2).dmg, 4, '无激光天赋时目标格每 tick 4 点');
  eq(w.grid.dmgLog.find((r) => r.block.oy === 0).dmg, 3, '同列其它格 70% → round(4 × 0.7) = 3');
  eq(w.BM.TOOLS.ready(), false, '激光有 0.15s 冷却');

  // BALANCE-V4 §5：激光同列他格伤害 = 目标格 70%（取可整除的伤害值）
  const ex = world({ grid: { hpAt: () => 999 }, mods: { laserDamage: 6 } });
  const ce = ex.center(1, 2);
  ex.BM.TOOLS.attack('laser', ce[0], ce[1], { now: 0 });
  const tTarget = ex.grid.dmgLog.find((r) => r.block.oy === 2).dmg;
  const tOther = ex.grid.dmgLog.find((r) => r.block.oy === 0).dmg;
  eq(tTarget, 10, '目标格 = 4 + 6 = 10');
  eq(tOther, 7, '同列其它格 = round(10 × 0.7) = 7');
  near(tOther / tTarget, 0.7, 1e-9, '激光同列他格 = 目标格的 70%');
  eq(ex.all('tool:swing')[0].cells.length, 8, '溅射衰减不影响整列命中格数（8 格）');
}
/* ============================ 18. 幸运 TNT ============================ */
section('18. 幸运 TNT：打穿一层掷骰、±1 落点、1.8s 长引线、3×3 穿透 CONFIG 层数、上限 12');
{
  const w = world({ mods: { luckyTNTChance: 1 }, grid: { hpAt: () => 1, layersAt: () => 8 } });
  const r = fixedRandom(0);                       // ±1 内第一个存活格 = (2,2)
  const c = w.center(3, 3);
  w.BM.TOOLS.attack('wood', c[0], c[1], { now: 0 });
  const lt = w.all('lucky:tnt');
  eq(lt.length, 1, '打穿一层 → 白掉一枚幸运 TNT');
  near(lt[0].delay, 1.8, 1e-9, 'lucky:tnt.delay = 1.8 秒（掉落长引线，CONFIG.tuning.luckyTNTFuseSec）');
  const tb = w.block(2, 2);
  near(lt[0].x, tb.x + tb.s * 0.5, 0.001, '落点在刚挖格 ±1 内（x）');
  near(lt[0].y, tb.y + tb.s * 0.5, 0.001, '落点在刚挖格 ±1 内（y）');
  eq(w.BM.TOOLS.luckyUsed, 1, 'luckyUsed = 1（白掉的不占任何弹药，v14 已经没有弹药）');
  r();

  w.grid.layerLog.length = 0;
  w.clear();
  w.BM.TOOLS.update(1.70, 1.70);
  eq(w.count('explosion'), 0, '1.7s 时长引线还没到');
  w.BM.TOOLS.update(0.15, 1.85);
  eq(w.count('explosion'), 1, '1.8s 后自爆');
  eq(w.all('explosion')[0].cells, 9, '爆炸波及 3×3 = 9 格');
  const pierce2 = w.grid.layerLog.filter((e) => e.pierce === 2);
  eq(pierce2.length, 9, '9 格各走一次 CONFIG.tnt.layerPierce = 2 层穿透');
  eq(w.grid.layerLog[0].dmg, 3, '幸运 TNT 用同一伤害公式（木镐 1 × 3 = 3，不再固定 6）');
}
{
  // 概率 0（无天赋）不掷出
  const w = world({ grid: { hpAt: () => 1, layersAt: () => 8 } });
  const c = w.center(3, 3);
  w.BM.TOOLS.attack('wood', c[0], c[1], { now: 0 });
  eq(w.count('lucky:tnt'), 0, 'luckyTNTChance = 0 时不出幸运 TNT');
  eq(w.BM.TOOLS.luckyUsed, 0, 'luckyUsed 保持 0');
}
{
  // 掉落引线独立于放置引线：tuning.luckyTNTFuseSec 说了算（CONFIG.tnt.fuseSec 只管玩家放置）
  const w = world({ mods: { luckyTNTChance: 1 }, tuning: { luckyTNTFuseSec: 1.2 }, grid: { hpAt: () => 1, layersAt: () => 8 } });
  const r = fixedRandom(0);
  w.bus.emit('block:layer', { block: w.block(2, 2), depth: 1 });
  r();
  near(w.all('lucky:tnt')[0].delay, 1.2, 1e-9, 'tuning.luckyTNTFuseSec = 1.2 → 掉落引线 1.2 秒（配置驱动）');
  eq(w.BM.TOOLS.tuning.tntFuseSec, undefined, '放置引线键 T.tntFuseSec 已删除（v14 只剩掉落这一种引线）');
}
{
  // 每局总量上限 = CONFIG.tuning.luckyTNTTotalMax（v14 = 12 的测试值）
  const w = world({ mods: { luckyTNTChance: 1 }, tuning: { luckyTNTTotalMax: 12 }, grid: { hpAt: () => 1, layersAt: () => 20 } });
  const r = fixedRandom(0);
  for (let i = 0; i < 20; i++) {
    const b = w.block(1 + (i % 3), 1);
    w.bus.emit('block:layer', { block: b, depth: 1 });
  }
  r();
  eq(w.count('lucky:tnt'), 12, '每局总量上限 12 枚（20 次掷骰只出 12 枚）');
  eq(w.BM.TOOLS.luckyUsed, 12, 'luckyUsed 停在 12');
  eq(w.BM.TOOLS.luckyMax, 12, 'TOOLS.luckyMax = CONFIG.tuning.luckyTNTTotalMax = 12');
  w.BM.TOOLS.reset();
  eq(w.BM.TOOLS.luckyUsed, 0, 'reset() 清零本局计数');

  // 上限真的读 CONFIG.tuning.luckyTNTTotalMax：改成 2 就只有 2 枚
  const cap2 = world({ mods: { luckyTNTChance: 1 }, tuning: { luckyTNTTotalMax: 2 }, grid: { hpAt: () => 1, layersAt: () => 20 } });
  const r2 = fixedRandom(0);
  for (let i = 0; i < 8; i++) cap2.bus.emit('block:layer', { block: cap2.block(1 + (i % 3), 1), depth: 1 });
  r2();
  eq(cap2.count('lucky:tnt'), 2, 'tuning.luckyTNTTotalMax = 2 → 只出 2 枚');
  eq(cap2.BM.TOOLS.luckyMax, 2, 'TOOLS.luckyMax 跟随 tuning.luckyTNTTotalMax');

  // v13 物理防爆栈：同屏引信上限 tuning.tntMaxFuses（默认 60），满了不再生成
  const fuseCap = world({ mods: { luckyTNTChance: 1 }, tuning: { tntMaxFuses: 5 }, grid: { hpAt: () => 1, layersAt: () => 30 } });
  const r3 = fixedRandom(0);
  for (let i = 0; i < 30; i++) fuseCap.bus.emit('block:layer', { block: fuseCap.block(1 + (i % 3), 1), depth: 1 });
  r3();
  eq(fuseCap.count('lucky:tnt'), 5, 'tuning.tntMaxFuses = 5 → 同屏最多 5 颗（30 次掷骰只出 5 枚）');
  eq(fuseCap.BM.TOOLS.fuses, 5, 'fuses 停在 5（防爆栈）');
  eq(fuseCap.BM.TOOLS.luckyUsed, 5, 'luckyUsed 只记真正生成的那 5 枚');
}

// 真配置：每局总量 400（很宽）+ 同屏 60 颗物理上限
{
  const REAL = loadRealConfig();
  eq(REAL.tuning.luckyTNTTotalMax, 400, 'src/01-config.js：tuning.luckyTNTTotalMax = 400（防卡死的宽上限）');
  eq(REAL.tuning.tntMaxFuses, 60, 'src/01-config.js：tuning.tntMaxFuses = 60（同屏引信物理上限）');
  const w = world({ mods: { luckyTNTChance: 1 }, tuning: { luckyTNTTotalMax: REAL.tuning.luckyTNTTotalMax, tntMaxFuses: REAL.tuning.tntMaxFuses }, grid: { hpAt: () => 1, layersAt: () => 30 } });
  const r = fixedRandom(0);
  for (let i = 0; i < 100; i++) w.bus.emit('block:layer', { block: w.block(1 + (i % 3), 1), depth: 1 });
  r();
  eq(w.BM.TOOLS.luckyMax, 400, 'TOOLS.luckyMax = 400（每局总量很宽）');
  eq(w.count('lucky:tnt'), 60, '同屏封顶 60 颗：100 次掷骰也只同时挂 60 颗');
  eq(w.BM.TOOLS.fuses, 60, 'fuses = 60');
  eq(w.BM.TOOLS.luckyUsed, 60, 'luckyUsed 只记真正生成的那 60 枚（同屏上限先卡住）');
}
{
  // 多级天赋概率覆盖：50% 概率 + 固定随机 0.3 → 出；0.7 → 不出
  const hit = world({ mods: { luckyTNTChance: 0.5 }, grid: { hpAt: () => 1, layersAt: () => 8 } });
  const r = fixedRandom(0.3);
  hit.bus.emit('block:layer', { block: hit.block(2, 2), depth: 1 });
  r();
  eq(hit.count('lucky:tnt'), 1, 'rand 0.3 < 0.5 → 掷中');
  const miss = world({ mods: { luckyTNTChance: 0.5 }, grid: { hpAt: () => 1, layersAt: () => 8 } });
  const r2 = fixedRandom(0.7);
  miss.bus.emit('block:layer', { block: miss.block(2, 2), depth: 1 });
  r2();
  eq(miss.count('lucky:tnt'), 0, 'rand 0.7 >= 0.5 → 不掷中');
}


/* ============================ 18b. 连环炸（A→B→C） ============================ */
section('18b. 连环炸：TNT 炸出的碎层也掷幸运 TNT，新炸弹当场入队（chance=1 确定性连炸 3 颗）');
{
  const w = world({ mods: { luckyTNTChance: 1 }, tuning: { luckyTNTTotalMax: 12 },
    grid: { hpAt: () => 1, layersAt: () => 20, cols: 3, rows: 3 } });
  const r = fixedRandom(0);
  let now = 0;
  const seq = [];
  w.bus.on('explosion', (d) => seq.push({ k: 'boom', t: now, tnt: d.tntCount }));
  w.bus.on('lucky:tnt', () => seq.push({ k: 'lucky', t: now }));

  // A：一次普通打穿掉出来的第一颗
  w.bus.emit('block:layer', { block: w.block(1, 1), depth: 1 });
  eq(w.count('lucky:tnt'), 1, 'A 立刻进队（1 颗）');
  eq(w.BM.TOOLS.fuses, 1, 'fuses = 1：掉落当场入队，等 stepFuses 认领');
  near(w.all('lucky:tnt')[0].delay, 1.8, 1e-9, 'A 的引线 1.8 秒');

  for (let i = 0; i < 420; i++) { now += 1 / 60; w.BM.TOOLS.update(1 / 60, now); }
  r();

  const booms = seq.filter((s) => s.k === 'boom');
  ok(booms.length >= 3, '连炸 ≥3 颗（实际 ' + booms.length + ' 颗）');
  // 同一帧里可能有 8 颗一起炸（A 一次掉出一堆），所以按「时间簇」看代际：A → B 代 → C 代
  const waves = [];
  for (const b of booms) {
    const last = waves[waves.length - 1];
    if (last && b.t - last.t < 0.2) last.n++;
    else waves.push({ t: b.t, n: 1, at: seq.indexOf(b) });
  }
  ok(waves.length >= 3, '连环至少 3 代（A / B / C），实际 ' + waves.length + ' 代');
  near(waves[0].t, 1.8, 0.04, '第 1 代（A）在 1.8s 炸');
  near(waves[1].t, 3.6, 0.06, '第 2 代（B）在 3.6s 炸：A 的碎层掉出 B，再等 1.8s');
  near(waves[2].t, 5.4, 0.09, '第 3 代（C）在 5.4s 炸：B 的碎层掉出 C');
  eq(waves[1].n, 8, 'A 一次炸出 8 颗 B（3×3 角落 4 格 × 穿透 2 层，chance=1 全中）');

  // 因果链：第 i 代的炸弹必须是「第 i-1 代爆炸那一帧/之后」才掉出来的
  for (let i = 1; i < 3; i++) {
    const born = seq.filter((s) => s.k === 'lucky' && s.t >= waves[i - 1].t && s.t <= waves[i].t);
    ok(born.length > 0, '第 ' + (i + 1) + ' 代的 ' + waves[i].n + ' 颗炸弹，是第 ' + i + ' 代爆炸时掷出的 ' + born.length + ' 颗之一');
  }
  eq(w.BM.TOOLS.luckyUsed, 12, '连环把每局上限吃满（tuning.luckyTNTTotalMax = 12 枚，无一枚手工放置）');
  eq(w.count('explosion') >= 12, true, '爆炸总数 ≥12（A + 8 颗 B + 3 颗 C 以上）');
  ok(booms[0].tnt >= 3, '第一颗爆炸的 tntCount（同屏 TNT 数）= 队列剩余 + 自己 ≥3（实际 ' + booms[0].tnt + '）');
  console.log('  · 代际：' + waves.map((w, i) => '第' + (i + 1) + '代 ' + w.n + ' 颗 @' + w.t.toFixed(2) + 's').join(' → ') +
    '（掉落引线 1.8s，同屏 TNT ' + booms[0].tnt + ' 颗）');
}

/* ============================ 18c. 真配置：一颗 TNT 炸穿 5 格 ============================ */
section('18c. 第 4 关真配置：tntDamageMul 4 + 满伤害链 → 一颗 TNT 的「上下左右 + 自身」5 格各炸穿一层');
{
  const REAL = loadRealConfig();
  eq(REAL.tnt.tntDamageMul, 4, 'src/01-config.js：CONFIG.tnt.tntDamageMul = 4');
  const hp = 58;                                    // 第 4 关「晶石层」晶石层血
  const cubic = Math.pow(1.20, 8);                  // tntDmg 满级（8 级 ×1.20 = 4.2998）
  const w = world({
    mods: { damage: 21, tntDamageMul: cubic, luckyTNTChance: 1 },
    grid: { hpAt: () => hp, layersAt: () => 8 }
  });
  w.BM.CONFIG.tnt = REAL.tnt;                       // 真值：damageMul/tntDamageMul/layerPierce/fuseSec
  w.BM.CORE.state = { selectedTool: 'laser' };      // 第 4 关主力工具（激光钻 8 伤）+ 满伤害链（+21）
  // fixture 的激光钻是 4 伤（测试口径），+ 满伤害链 21 = 25；真配置是 8 + 21 = 29
  const expect = Math.round(25 * REAL.tnt.tntDamageMul * cubic);
  eq(w.BM.TOOLS.tntDamage, expect, '每格伤害 = round(25 × 4 × 1.20^8) = ' + expect + ' 点');
  ok(w.BM.TOOLS.tntDamage >= hp, '每格 ' + w.BM.TOOLS.tntDamage + ' ≥ 晶石层血 ' + hp + '：5 格各炸穿 ≥1 层');

  const r = fixedRandom(0);                         // 落点固定 = 刚挖格 ±1 的第一个（(3,3) → (2,2)）
  w.bus.emit('block:layer', { block: w.block(3, 3), depth: 1 });
  r();
  eq(w.BM.TOOLS.fuses, 1, '白掉一颗幸运 TNT');
  const cross = [[2, 2], [1, 2], [3, 2], [2, 1], [2, 3]];
  const before = cross.map(([x, y]) => w.block(x, y).layers);
  for (let i = 0; i < 130; i++) w.BM.TOOLS.update(1 / 60, i / 60);
  const after = cross.map(([x, y]) => w.block(x, y).layers);
  eq(w.count('explosion'), 1, '1.8s 后炸一次');
  ok(after.every((v, i) => v <= before[i] - 1),
    '中心 + 上下左右 5 格各掉 ≥1 层（层数 ' + before.join('/') + ' → ' + after.join('/') + '）');
  console.log('  · 第 4 关：一颗幸运 TNT 每格 ' + w.BM.TOOLS.tntDamage + ' 点 vs 晶石层血 ' + hp +
    '（穿透 ' + w.BM.TOOLS.tntPierce + ' 层）→ 5 格层数 ' + before.join('/') + ' → ' + after.join('/'));
}

/* ============================ 19. 地心共振 ============================ */
section('19. 地心共振：每打穿一层 +1，攒满 mods.resonanceThreshold 全屏剥离，每局最多 3 次');
{
  // 未解锁：阈值 0 / 缺键都不累计、不触发
  const off = world({ mods: {}, grid: { hpAt: () => 1, layersAt: () => 8 } });
  eq(off.BM.TOOLS.resonanceThreshold, 0, '缺 resonanceThreshold → 阈值 0');
  for (let i = 0; i < 50; i++) off.bus.emit('block:layer', { block: off.block(1, 1), depth: 1 });
  eq(off.count('resonance:blast'), 0, '未解锁时 50 层也不触发共振');
  eq(off.BM.TOOLS.resonanceCount, 0, '未解锁时不累计计数');
  eq(off.BM.TOOLS.resonanceMax, 3, 'resonanceMax = 3（每局上限）');
}
{
  // 阈值 3：第 3 层才触发，cells = 存活格数，每格各被 stripLayer 剥一层（无视血量）
  const w = world({ mods: { resonanceThreshold: 3 }, grid: { hpAt: () => 999, layersAt: () => 8 } });
  eq(w.BM.TOOLS.resonanceThreshold, 3, 'resonanceThreshold 从 mods 读入');
  w.bus.emit('block:layer', { block: w.block(1, 1), depth: 1 });
  w.bus.emit('block:layer', { block: w.block(2, 1), depth: 1 });
  eq(w.count('resonance:blast'), 0, '2 层 < 阈值 3 → 不触发');
  eq(w.BM.TOOLS.resonanceCount, 2, '累计计数 = 2');

  w.grid.dmgLog.length = 0;
  w.grid.stripLog.length = 0;
  const layersBefore = w.grid.blocks.map((row) => row.map((cell) => cell.layers));
  w.bus.emit('block:layer', { block: w.block(3, 1), depth: 1 });
  eq(w.count('resonance:blast'), 1, '第 3 层达标 → 触发 1 次');
  eq(w.BM.TOOLS.resonanceCount, 0, '触发后累计计数清零');
  eq(w.BM.TOOLS.resonanceUsed, 1, '已用次数 = 1');

  const b = w.all('resonance:blast')[0];
  eq(b.cells, 48, 'cells = 棋盘存活格数（6×8）');
  const mid = w.block(3, 4);                     // (rows/2 = 4, cols/2 = 3)
  near(b.x, mid.x + mid.s * 0.5, 1e-9, 'x = 棋盘中心世界坐标');
  near(b.y, mid.y + mid.s * 0.5, 1e-9, 'y = 棋盘中心世界坐标');

  eq(w.grid.stripLog.length, 48, '存活格各调用一次 stripLayer（全屏剥离）');
  eq(new Set(w.grid.stripLog.map((r) => r.block)).size, 48, '每格只剥一次（同格不重复）');
  eq(w.grid.dmgLog.length, 0, '共振不再走 damage(b, 1, 0)（1 点伤害打不穿厚血矿）');
  let deltaBad = 0;
  for (let oy = 0; oy < w.grid.blocks.length; oy++) {
    for (let ox = 0; ox < w.grid.blocks[oy].length; ox++) {
      if (w.grid.blocks[oy][ox].layers !== layersBefore[oy][ox] - 1) deltaBad++;
    }
  }
  eq(deltaBad, 0, '一次共振真的让全场每格少一层（8 → 7 层）');
  eq(w.block(0, 0).layers, 7, '示例：格 (0,0) 由 8 层变 7 层');

  const mag = w.all('magnet:burst');
  eq(mag.length, 1, '同时触发 magnet:burst（全屏吸入）');
  eq(mag[0].all, true, 'magnet:burst.all = true');
  near(mag[0].x, b.x, 1e-9, '吸入原点 = 冲击波原点（x）');
  near(mag[0].y, b.y, 1e-9, '吸入原点 = 冲击波原点（y）');
}
{
  // block:empty（整格挖空的最后一层）与 block:layer 同等计 1 层
  const w = world({ mods: { resonanceThreshold: 2 }, grid: { hpAt: () => 999, layersAt: () => 8 } });
  w.bus.emit('block:layer', { block: w.block(1, 1), depth: 1 });
  eq(w.count('resonance:blast'), 0, 'block:layer 计数 1 层');
  w.bus.emit('block:empty', { block: w.block(1, 1), prev: {} });
  eq(w.count('resonance:blast'), 1, 'block:empty 也算 1 层 → 达标触发');
}
{
  // 每局最多 3 次；触发过程中自己造成的 block:layer 不再计数（不递归）
  const w = world({ mods: { resonanceThreshold: 1 }, grid: { hpAt: () => 1, layersAt: () => 8 } });
  w.clear();
  w.bus.emit('block:layer', { block: w.block(1, 1), depth: 1 });
  eq(w.count('resonance:blast'), 1, '阈值 1：一层即触发');
  eq(w.BM.TOOLS.resonanceUsed, 1, 'resonanceUsed = 1');
  // 共振把 48 格各打穿一层，每格都派发 block:layer → 重入保护让它们不叠加计数
  for (let i = 0; i < 20; i++) w.bus.emit('block:layer', { block: w.block(1 + (i % 4), 1), depth: 1 });
  eq(w.count('resonance:blast'), 3, '每局最多触发 3 次（20 次触发条件只出 3 次）');
  eq(w.BM.TOOLS.resonanceUsed, 3, 'resonanceUsed 停在 3');
  eq(w.BM.TOOLS.resonanceCount, 0, '超上限后累计计数仍归零');

  w.BM.TOOLS.reset();
  eq(w.BM.TOOLS.resonanceUsed, 0, 'reset() 清零本局已触发次数');
  eq(w.BM.TOOLS.resonanceCount, 0, 'reset() 清零累计计数');
  w.clear();
  w.bus.emit('block:layer', { block: w.block(1, 1), depth: 1 });
  eq(w.count('resonance:blast'), 1, 'reset() 后新一局可再次触发');

  w.BM.TOOLS.setZone({ id: 'crystalcave' });
  eq(w.BM.TOOLS.resonanceUsed, 0, 'setZone() 同样清零');
  w.clear();
  w.bus.emit('block:empty', { block: w.block(2, 2), prev: {} });
  eq(w.count('resonance:blast'), 1, 'setZone() 后新一局可再次触发');
}
{
  // 重入保护：共振自身的 block:layer 不叠加计数（阈值 1 + 每次剥层都发 layer）
  const w = world({ mods: { resonanceThreshold: 1 }, grid: { hpAt: () => 1, layersAt: () => 8 } });
  w.clear();
  w.bus.emit('block:layer', { block: w.block(1, 1), depth: 1 });
  const used = w.BM.TOOLS.resonanceUsed;
  eq(used, 1, '一次外部 layer → 只触发一次（期间 48 次内部 layer 被忽略）');
  eq(w.count('resonance:blast'), 1, '内部剥离不递归触发');
  eq(w.count('block:layer'), 49, '外部 1 次 + 共振内部 48 次 block:layer');
  eq(w.BM.TOOLS.resonanceCount, 0, '内部剥离不累计计数');
}
{
  // 坑洞不参与：先挖空一半，cells 只数存活格
  const w = world({ mods: { resonanceThreshold: 1 }, grid: { hpAt: () => 1, layersAt: () => 1 } });
  for (let oy = 0; oy < 4; oy++) for (let ox = 0; ox < 6; ox++) w.block(ox, oy).broken = true;
  w.clear();
  w.bus.emit('block:layer', { block: w.block(1, 5), depth: 1 });
  const b = w.all('resonance:blast')[0];
  eq(b.cells, 24, 'cells 只数存活格（挖空 24 格 → 24）');
  eq(w.grid.stripLog.length, 24, '只对存活格调用 stripLayer（跳过空坑）');
  eq(w.count('block:empty'), 24, '存活格只剩 1 层 → 一次共振全部清空（24 次 block:empty）');
}

/* ============================ 20. 处决（v9） ============================ */
section('20. 处决：阈值触发 stripLayer + tool:execute + 重入保护 + 连锁/TNT 照常');
{
  // 未购买（缺键）→ 阈值 0，1 血也不处决
  const w0 = world({ mods: { damage: 8 }, grid: { hpAt: () => 10, layersAt: () => 8 } });
  eq(w0.BM.TOOLS.execThreshold, 0, '缺 execThreshold → 阈值 0（未购买）');
  const c0 = w0.center(2, 2);
  w0.BM.TOOLS.attack('wood', c0[0], c0[1], { now: 0 });
  eq(w0.block(2, 2).hp, 1, '10 血挨 9 伤 → 剩 1 血');
  eq(w0.count('tool:execute'), 0, '阈值 0 时 1 血也不处决');
  eq(w0.block(2, 2).layers, 8, '层数不变');
  eq(w0.BM.TOOLS.executes, 0, 'executes 计数为 0');
}
{
  // 等于阈值：10 血打 7 → 剩 3 = 30%，恰好等于阈值 → 处决
  const wA = world({ mods: { execThreshold: 0.3, damage: 6 }, grid: { hpAt: () => 10, layersAt: () => 8 } });
  eq(wA.BM.TOOLS.execThreshold, 0.3, 'execThreshold 从 mods 读入');
  const cA = wA.center(1, 1);
  const bA = wA.block(1, 1);
  wA.BM.TOOLS.attack('wood', cA[0], cA[1], { now: 0 });
  eq(bA.layers, 7, '剩 3/10 = 30%（等于阈值）→ 直接剥一层（8 → 7）');
  eq(wA.count('tool:execute'), 1, '派发 1 次 tool:execute');
  eq(bA.hp, 10, '剥层后换到新层（血量回满 10）');
  eq(wA.BM.TOOLS.executes, 1, 'TOOLS.executes = 1');
  eq(wA.grid.stripLog.length, 1, '走了 GRID.stripLayer（无视剩余血量）');
  const ea = wA.all('tool:execute')[0];
  near(ea.x, bA.x + bA.s * 0.5, 1e-9, 'tool:execute.x = 格中心世界坐标');
  near(ea.y, bA.y + bA.s * 0.5, 1e-9, 'tool:execute.y = 格中心世界坐标');
  eq(ea.ox, 1, 'tool:execute 带上格坐标 ox');
  eq(ea.oy, 1, 'tool:execute 带上格坐标 oy');
  eq(ea.threshold, 0.3, 'tool:execute 带上当时的阈值');

  wA.BM.TOOLS.reset();
  eq(wA.BM.TOOLS.executes, 0, 'reset() 清零处决计数');
}
{
  // 超过阈值 1hp：剩 4 = 40% > 30% → 只当普通命中
  const wB = world({ mods: { execThreshold: 0.3, damage: 5 }, grid: { hpAt: () => 10, layersAt: () => 8 } });
  const cB = wB.center(2, 3);
  wB.BM.TOOLS.attack('wood', cB[0], cB[1], { now: 0 });
  eq(wB.block(2, 3).hp, 4, '剩 4 血（40%）');
  eq(wB.block(2, 3).layers, 8, '超过阈值 1 血 → 不处决，层数不变');
  eq(wB.count('tool:execute'), 0, '不派发 tool:execute');
  eq(wB.grid.stripLog.length, 0, '没有调用 stripLayer');
}
{
  // 三级阈值 12% / 20% / 30%：同一发（剩 2/10 = 20%）结果不同
  const tiers = [[0.12, 0], [0.2, 1], [0.3, 1]];
  for (const [th, want] of tiers) {
    const w = world({ mods: { execThreshold: th, damage: 7 }, grid: { hpAt: () => 10, layersAt: () => 8 } });
    const c = w.center(0, 4);
    w.BM.TOOLS.attack('wood', c[0], c[1], { now: 0 });
    eq(w.grid.dmgLog[0].dmg, 8, '阈值 ' + th + '：这一发 8 伤（10 - 8 = 2 血，20%）');
    eq(w.count('tool:execute'), want, '阈值 ' + th + '：20% ' + (want ? '够 → 处决' : '不够 → 不处决'));
    eq(w.block(0, 4).layers, want ? 7 : 8, '阈值 ' + th + '：层数 ' + (want ? '8 → 7' : '不变'));
  }
  // 12% 档：剩 1 血（10%）就能处决
  const w1 = world({ mods: { execThreshold: 0.12, damage: 8 }, grid: { hpAt: () => 10, layersAt: () => 8 } });
  const c1 = w1.center(0, 5);
  w1.BM.TOOLS.attack('wood', c1[0], c1[1], { now: 0 });
  eq(w1.grid.dmgLog[0].dmg, 9, '这一发 9 伤（10 - 9 = 1 血，10%）');
  eq(w1.count('tool:execute'), 1, '12% 档：10% <= 12% → 处决');
  eq(w1.block(0, 5).layers, 7, '12% 档剥掉一层');
}
{
  // 无视剩余血量也只剥一层（1/100 血 → 只掉 1 层，不连剥）
  const wD = world({ mods: { execThreshold: 0.3 }, grid: { hpAt: () => 100, layersAt: () => 8 } });
  const bD = wD.block(1, 1);
  bD.hp = 2;
  const cD = wD.center(1, 1);
  wD.BM.TOOLS.attack('wood', cD[0], cD[1], { now: 0 });
  eq(bD.layers, 7, '1/100 血远低于阈值 → 只剥一层');
  eq(bD.hp, 100, '剥层后换新层（血量回满 100）');
  eq(wD.count('tool:execute'), 1, '一次命中只处决一次');
}
{
  // damage 已经把这一层打空 → 走正常破层，不再重复 stripLayer
  const wE = world({ mods: { execThreshold: 0.3, damage: 9 }, grid: { hpAt: () => 10, layersAt: () => 8 } });
  const bE = wE.block(3, 3);
  const cE = wE.center(3, 3);
  wE.BM.TOOLS.attack('wood', cE[0], cE[1], { now: 0 });
  eq(bE.layers, 7, '10 伤打空一层 → 正常破层（8 → 7）');
  eq(wE.count('block:layer'), 1, '只有 1 次 block:layer');
  eq(wE.count('tool:execute'), 0, '已打空的那层不算处决');
  eq(wE.grid.stripLog.length, 0, '没有重复剥层');
}
{
  // AOE 逐格判定：square3 命中 9 格，只有中心那格进阈值
  const wF = world({ mods: { execThreshold: 0.3 }, grid: { hpAt: () => 14, layersAt: () => 8 } });
  const cF = wF.center(2, 4);
  wF.BM.TOOLS.attack('diamond', cF[0], cF[1], { now: 0 });
  eq(wF.block(2, 4).layers, 7, '中心格 10 伤 → 剩 4/14 = 28.6% → 处决');
  eq(wF.count('tool:execute'), 1, '只有中心格派发 tool:execute');
  eq(wF.grid.stripLog.length, 1, '只对中心格调用 stripLayer');
}
{
  // 重入保护：stripLayer 期间再打一发，嵌套的命中不再判定处决
  let nested = 0;
  let W = null;
  W = world({
    mods: { execThreshold: 0.3, damage: 6 },
    grid: {
      hpAt: () => 10, layersAt: () => 8,
      onStrip() {
        if (nested) return;
        nested = 1;
        const c = W.center(5, 7);
        W.BM.TOOLS.attack('wood', c[0], c[1], { now: 0 });
      }
    }
  });
  const cW = W.center(0, 0);
  W.BM.TOOLS.attack('wood', cW[0], cW[1], { now: 0 });
  eq(nested, 1, 'stripLayer 内部真的又打了一发（重入场景成立）');
  eq(W.count('tool:execute'), 1, '嵌套的命中不再处决（重入保护生效）');
  eq(W.grid.stripLog.length, 1, 'stripLayer 只被调用 1 次（无递归）');
  eq(W.block(0, 0).layers, 7, '外层只剥 1 层');
  eq(W.grid.hits.get(W.block(5, 7)), 1, '嵌套那一发照常结算伤害');
  eq(W.block(5, 7).layers, 8, '嵌套那格仍停在 8 层（被保护的正是处决判定）');
}
{
  // 处决打碎的层照常掷连锁：最后一层被处决 → block:break → onBreak → rollChain
  const wC = world({
    mods: { execThreshold: 0.3, damage: 6, chainCells: 1 },
    grid: { hpAt: () => 10, layersAt: () => 1 }
  });
  const cC = wC.center(2, 4);
  wC.BM.TOOLS.attack('wood', cC[0], cC[1], { now: 0 });
  eq(wC.count('tool:execute'), 1, '最后一层被处决（1 层棋盘）');
  eq(wC.block(2, 4).broken, true, '处决打空 → 变坑洞');
  eq(wC.count('block:break'), 2, '处决照常派发 block:break（自身 1 + 连锁剥空的邻格 1）');
  wC.BM.TOOLS.update(0.2, 1);
  eq(wC.count('tool:chain'), 1, '处决后连锁照常炸（chainCells = 1 → 恰好 1 个邻格被剥）');
  const nbs = [wC.block(1, 4), wC.block(3, 4), wC.block(2, 3), wC.block(2, 5)];
  ok(nbs.filter((b) => b.broken).length === 1, '连锁真的剥掉了 1 个相邻格（1 层棋盘 → 直接炸空）', nbs.map((b) => b.layers).join('/'));
}
{
  // 处决打碎的层照常掷幸运 TNT：block:layer 命中概率 1 → 白掉一枚
  const wL = world({
    mods: { execThreshold: 0.3, damage: 6, luckyTNTChance: 1 },
    grid: { hpAt: () => 10, layersAt: () => 4 }
  });
  const cL = wL.center(1, 6);
  wL.BM.TOOLS.attack('wood', cL[0], cL[1], { now: 0 });
  eq(wL.block(1, 6).layers, 3, '处决剥掉一层（4 → 3）');
  eq(wL.count('lucky:tnt'), 1, '处决照常掷出幸运 TNT');
  eq(wL.BM.TOOLS.luckyUsed, 1, 'luckyUsed = 1');
  ok(wL.BM.TOOLS.fuses >= 1, '幸运 TNT 已上引信', String(wL.BM.TOOLS.fuses));
}

console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);
