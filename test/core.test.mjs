// v7 核心测试：真实读取 src/01-config.js + src/02-core.js，用 window/localStorage stub 求值
// 唯一真值 = src/01-config.js（数据源），02-core 的行为必须与之一致
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = ['01-config.js', '02-core.js'];

function makeStorage(init) {
  const map = new Map(init ? Object.entries(init) : []);
  return {
    getItem: function (k) { return map.has(k) ? map.get(k) : null; },
    setItem: function (k, v) { map.set(k, String(v)); },
    removeItem: function (k) { map.delete(k); },
    clear: function () { map.clear(); },
    dump: function () { return Object.fromEntries(map); }
  };
}

function boot(storage) {
  const sandbox = { window: { localStorage: storage }, console: { log: function () {}, warn: function () {} } };
  vm.createContext(sandbox);
  for (const f of SRC) {
    vm.runInContext(readFileSync(join(ROOT, 'src', f), 'utf8'), sandbox, { filename: f });
  }
  const bm = sandbox.window.BM;
  if (!bm || !bm.CONFIG || !bm.CORE || !bm.bus) throw new Error('BM 命名空间不完整');
  return bm;
}

const R = { pass: 0, fail: 0 };
function ok(cond, msg) {
  if (cond) { R.pass++; return true; }
  R.fail++;
  console.log('  FAIL ' + msg);
  return false;
}
function eq(actual, expected, msg) {
  return ok(String(actual) === String(expected), msg + ' -> 实际 ' + String(actual) + ' / 期望 ' + String(expected));
}
function near(actual, expected, msg) {
  return ok(Math.abs(actual - expected) < 1e-9, msg + ' -> 实际 ' + actual + ' / 期望 ' + expected);
}
function section(t) { console.log('\n== ' + t); }

/* 一次性读取配置作为「真值参照」；后续每个小节各自 boot 一份干净存档 */
const BASE = boot(makeStorage());
const CONFIG = BASE.CONFIG;
const TOOL_IDS = Object.keys(CONFIG.tools);
const ZONE_IDS = CONFIG.zones.map(function (z) { return z.id; });
const TALENT_IDS = Object.keys(CONFIG.talents);
const MAX_COUNT = 1000000000n; // 02-core 的计数硬上限（counts / lifetimeMined 共用）

/* ---- TREE-V8 的价格/结构工具（与 01-config 建树期、02-core 的 nodeCost 同口径）---- */

// 深度倍率表（docs/TREE-V8.md §3）：深度 1..7，超出取末一位
const DEPTH_MUL = CONFIG.talentCostTable.depthMul;
function depthMulFor(depth) {
  if (!(depth >= 1)) return 1;
  const i = Math.min(Math.round(depth), DEPTH_MUL.length) - 1;
  return DEPTH_MUL[i];
}
// 价格 = 首级价（baseCost × depthMul[深度]）× 1.9^(已买级数)，整数幂 + 一次向上取整
function priceAt(node, lv) {
  // v17：固定价节点（TNT 掉落链的软门槛）——购买 / 报价 / 返还都用这一个价
  if (node.fixedCost) return BigInt(node.fixedCost);
  // v15：长尾节点（maxLevel ≥ 50，如 999 级的 deepLayer）走线性价 300 × 第几级，
  // 不吃首环折扣、不吃深度倍率（与 02-core 的 isLinearNode / linearCostAt 同口径）
  if (Math.round(Number(node.maxLevel) || 1) >= 50) {
    return BigInt(Math.round(Number(node.baseCost))) * BigInt(lv + 1);
  }
  // v13：首环（深度 1）先 ×0.65（35% 折扣），再乘深度倍率（与 02-core firstCostOf 同口径）
  const ringMul = node.depth === 1 ? CONFIG.talentCostTable.firstRingMul : 1;
  let num = BigInt(Math.round(node.baseCost * ringMul)) * BigInt(depthMulFor(node.depth));
  let den = 1n;
  for (let i = 0; i < lv; i++) { num *= 19n; den *= 10n; }
  return (num + den - 1n) / den;
}
// §5 的 12 个程序化图标（Canvas 画，不依赖美术资产）
const ICONS = ['pick', 'laser', 'bomb', 'tntbox', 'chain', 'coin', 'gem', 'clock', 'ring', 'sword'];
// 中心在前：整棵树的 20 个节点
const CENTER = CONFIG.tree.center;
const ALL_NODES = [CENTER].concat(CONFIG.tree.nodes);
// parent 链步数（中心 = 0）；断链返回 -1
function chainDepth(n) {
  let d = 0;
  let cur = n;
  let guard = 0;
  while (cur && guard++ < 64) {
    const p = cur.parent;
    if (!p) return d;
    d++;
    if (p === CENTER.id) return d;
    cur = CONFIG.talents[p] || null;
  }
  return -1;
}
// 链 → 存档等级表：chainStore({ mine: 1, atk: 3 }) => { mine: 1, atk1: 1, atk2: 1, atk3: 1 }
function chainStore(map) {
  const out = {};
  for (const k of Object.keys(map)) {
    if (k === 'mine') { out.mine = 1; continue; }
    for (let i = 1; i <= map[k]; i++) out[k + i] = 1;
  }
  return out;
}
function reachesCenter(n, guard) {
  const g = guard || 0;
  if (g > 64) return false;
  if (!n || !n.parent) return !!n;
  if (n.parent === CENTER.id) return true;
  const p = CONFIG.talents[n.parent];
  return p ? reachesCenter(p, g + 1) : false;
}

/* ---------------- 1. CONFIG v7 形状 ---------------- */
section('1 CONFIG v7 形状：版本 / 存档 key / 五矿种 / 四工具 / 价格表');
{
  const { CONFIG: C } = boot(makeStorage());
  eq(C.version, 7, '存档版本号 7');
  eq(C.saveKey, 'blockminer.save.v7', '存档 key 是 v7');
  eq(C.legacySaveKeys.join(','), 'blockminer.save.v6,blockminer.save.v5,blockminer.save.v4,blockminer.save.v3',
    '旧档 key 记录 v6/v5/v4/v3');

  eq(Object.keys(C.ores).join(','), 'stone,coal,iron,gold,crystal', '矿种 stone/coal/iron/gold/crystal（金矿夹在铁与晶之间）');
  eq(Object.keys(C.ores).map(function (k) { return C.ores[k].price; }).join('/'), '1/6/40/150/400',
    '五矿单价 1/6/40/150/400（7 关共用，收益靠 coinMul）');
  ok(C.ores.iron.price < C.ores.gold.price && C.ores.gold.price < C.ores.crystal.price,
    '金矿单价 150 夹在铁 40 与晶 400 之间（既不贴铁也不贴晶）',
    [C.ores.iron.price, C.ores.gold.price, C.ores.crystal.price].join('/'));
  eq(C.ores.gold.id, 'gold', '金矿 id');
  eq(C.ores.gold.name, '金矿', '金矿名称');
  eq(C.ores.gold.vein, '#ffc857', '金矿主色 #ffc857（复用煤矿贴图后金色化）');
  for (const id of Object.keys(C.ores)) {
    const o = C.ores[id];
    eq(o.id, id, id + ' id 自洽');
    ok(typeof o.name === 'string' && o.name.length > 0, id + ' 有中文名');
    ok(o.hp > 0, id + ' 全局 hp 是正数回落值');
    eq(o.drop.join('-'), '1-1', id + ' 普通层掉落 1');
    eq(o.richDrop.join('-'), id === 'crystal' ? '1-1' : '2-2', id + ' 富矿层掉落');
    ok(/^#[0-9a-f]{6}$/i.test(o.color) && /^#[0-9a-f]{6}$/i.test(o.vein) && /^#[0-9a-f]{6}$/i.test(o.glow) && /^#[0-9a-f]{6}$/i.test(o.edge),
      id + ' 配色全为 6 位 hex');
  }

  eq(TOOL_IDS.join(','), 'wood,iron,diamond,laser',
    '四把工具 wood/iron/diamond/laser（v13：stone/quake/coreDrill 已删除）');
  const TOOLS_EXPECT = [
    ['wood', '木镐', 1, 'tap', 0.4, 'single'],
    ['iron', '铁镐', 3, 'hold', 0.42, 'column2'],
    ['diamond', '钻石镐', 10, 'tap', 0.55, 'square3'],
    ['laser', '激光钻', 8, 'hold', 0.15, 'columnAll']
  ];
  for (const row of TOOLS_EXPECT) {
    const t = C.tools[row[0]];
    eq(t.id, row[0], row[0] + ' id');
    eq(t.name, row[1], row[0] + ' 名称');
    eq(t.dmg, row[2], row[0] + ' 伤害 ' + row[2]);
    eq(t.mode, row[3], row[0] + ' 模式');
    near(t.interval, row[4], row[0] + ' 间隔 ' + row[4]);
    eq(t.shape, row[5], row[0] + ' 形状 ' + row[5]);
    ok(typeof t.desc === 'string' && t.desc.length > 0, row[0] + ' 有中文描述');
  }
  // v8 §4：取消「点按类/按住类」的区别，所有工具共用一份 interval 冷却（tap 也受频率约束）
  ok(C.tools.wood.interval > 0, '木镐也有攻击间隔（v8 §4：tap 与 hold 共用节拍，0.09 秒旁路已取消）');
  for (const id of TOOL_IDS) {
    if (C.tools[id].mode === 'hold') ok(C.tools[id].interval > 0, id + ' 按住类工具间隔 > 0');
  }
  eq(new Set(TOOL_IDS.map(function (id) { return C.tools[id].shape; })).size, 4,
    '四种形状（single / column2 / square3 / columnAll 各一把）');

  // ---- 价格表：depthMul 十档（= round(1.9^(d-1))），nodeCost 的唯一来源 ----
  const tbl = C.talentCostTable;
  eq(tbl.depthMul.join('/'), '1/3/7/18/46/119/309/803/2088/5430', 'depthMul = round(2.6^(d-1)) 十档（深度 1..10）');
  eq(tbl.depthMul.length, 10, 'depthMul 正好 10 档（最长链 atk 的终点在深度 10）');
  for (let i = 0; i < tbl.depthMul.length; i++) {
    const want = Math.round(Math.pow(2.6, i));
    eq(tbl.depthMul[i], want, 'depthMul[' + (i + 1) + '] = round(2.6^' + i + ') = ' + want + '（链上每环 ≈ ×2.6，v13 抬高为了让树铺满 45–80 局）');
  }
  eq(tbl.firstRingMul, 0.65, 'firstRingMul = 0.65（首环整环下调 35%）');
  eq(tbl.levelStep, 1.9, 'levelStep = 1.9（v8 的多级口径，v10 单级链不再使用，字段保留）');
  for (const v of tbl.depthMul) ok(typeof v === 'number' && Number.isFinite(v) && v > 0, 'depthMul 每档都是正数（' + v + '）');
  for (let i = 1; i < tbl.depthMul.length; i++) ok(tbl.depthMul[i] > tbl.depthMul[i - 1], 'depthMul 严格递增 ' + tbl.depthMul[i - 1] + ' -> ' + tbl.depthMul[i]);
  ok(tbl.tierBase === undefined, 'v7 的 tierBase 已删除（价格不再按 5 档 tier 取）');
  ok(tbl.zoneCoinTier === undefined && tbl.upgradeZoneMult === undefined,
    'v7 的 zoneCoinTier / upgradeZoneMult 已删除（价格不再按关卡倍率缩放）');

  // ---- 五项强化全部退休：效果并进节点树，只留空表让旧接口安全退化 ----
  eq(Object.keys(C.upgrades).length, 0, 'CONFIG.upgrades 是空表（工具威力/矿石精炼并入节点，磁力/作业时间/富矿本版不再提供）');
  eq(Object.keys(C.talents).length, 76, 'CONFIG.talents 索引 76 项 = 中心 mine + 75 个天赋节点（v17 TNT 掉落 10 环，含 deepLayer 999 级）');
}

/* ---------------- 2. 七关结构 ---------------- */
section('2 七关结构：id/coinMul/layerMin/layerMax/ores 权重与 hp/objective/nextZone/enterUnlocks');
// 目标值口径：ZONES-V5 §2 表格里的原始目标（460 / 240 / 120 / 520 / 2,600 / 13,000 / 60,000）在实测掉落下要
// 37 / 9 / 4 / 8 / 36 / 91 / 214 局（合计 400 局仍未通关），与 §7「140–175 局 / 54–67 分钟」自相矛盾。
// 这里按「实测每局目标矿掉落 × 22 局」标定，并由 test/progression.mjs 全链路回归守住这条节奏。
// v8 重标：价格改按节点深度缩放后，coinMul 只需把前两关的廉价矿（1/6/40）抬到能买 250–800 的
// 首级节点；第 3 关起晶石 400/个自己把收入顶起来，mul 回到 1。need 按「每关 20–35 局」重新标定
// （判据 140–175 局不变，实测 156–161 局）。
const ZONES_EXPECT = [
  { id: 'quarry', name: '煤矿层', coinMul: 3, layerMin: 8, layerMax: 10, filler: 'stone',
    ores: [['stone', 70, 3], ['coal', 30, 3]], objective: ['coal', 1800], nextZone: 'copperRidge', enter: [], final: false },
  { id: 'copperRidge', name: '铁矿层', coinMul: 2, layerMin: 12, layerMax: 14, filler: 'coal',
    ores: [['coal', 70, 14], ['iron', 30, 16]], objective: ['iron', 7000], nextZone: 'blueIron', enter: ['iron'], final: false },
  { id: 'blueIron', name: '金矿层', coinMul: 1, layerMin: 16, layerMax: 18, filler: 'iron',
    ores: [['iron', 70, 36], ['gold', 30, 62]], objective: ['gold', 20000], nextZone: 'lavaEdge', enter: ['diamond'], final: false },
  { id: 'lavaEdge', name: '晶石层', coinMul: 1, layerMin: 20, layerMax: 22, filler: 'gold',
    ores: [['gold', 65, 52], ['crystal', 35, 58]], objective: ['crystal', 52000], nextZone: null, enter: ['laser'], final: true }
];
ZONES_EXPECT.forEach(function (e, i) {
  const z = CONFIG.zones[i];
  const tag = '第 ' + (i + 1) + ' 关 ' + e.id;
  eq(z.id, e.id, tag + ' id');
  eq(z.name, e.name, tag + ' 名称');
  eq(z.coinMul, e.coinMul, tag + ' coinMul = ' + e.coinMul);
  eq(z.layerMin + '-' + z.layerMax, e.layerMin + '-' + e.layerMax, tag + ' 层数 ' + e.layerMin + '-' + e.layerMax);
  eq(z.filler, e.filler, tag + ' 填充矿');
  eq(z.ores.length, 2, tag + ' 两种矿');
  eq(z.ores.map(function (o) { return o.ore + ':' + o.weight; }).join('|'),
    e.ores.map(function (r) { return r[0] + ':' + r[1]; }).join('|'), tag + ' 矿种/权重（设计值，钉死）');
  for (const o of z.ores) ok(Number.isFinite(o.hp) && o.hp > 0, tag + ' ' + o.ore + ' hp 为正（数值转调口径，不钉死）');
  eq(z.ores.reduce(function (s, o) { return s + o.weight; }, 0), 100, tag + ' 权重合计 100');
  for (const o of z.ores) {
    ok(!!CONFIG.ores[o.ore], tag + ' 矿种 ' + o.ore + ' 在图鉴里');
    ok(o.hp > 0 && Number.isFinite(o.hp), tag + ' ' + o.ore + ' hp 为正数');
    ok(o.richRate > 0 && o.richRate <= 1, tag + ' ' + o.ore + ' richRate 在 (0,1]');
  }
  eq(new Set(z.ores.map(function (o) { return o.ore; })).size, z.ores.length, tag + ' 矿种不重复');
  eq(z.objective.ore, e.objective[0], tag + ' 目标矿种');
  eq(z.objective.need, e.objective[1], tag + ' 目标数量 = ' + e.objective[1]);
  ok(z.ores.some(function (o) { return o.ore === z.objective.ore; }), tag + ' 目标矿种属于本关矿表');
  eq(String(z.nextZone), String(e.nextZone), tag + ' nextZone');
  eq((z.enterUnlocks || []).join(','), e.enter.join(','), tag + ' enterUnlocks');
  eq(!!z.final, e.final, tag + ' final 标记');
  eq((z.unlocks || []).length, 0, tag + ' 关内不再挂半程解锁规则');
  ok(z.layerMin <= z.layerMax && z.layerMin >= 1, tag + ' 层数区间合法');
  ok(z.layerMax <= CONFIG.tuning.layerCap, tag + ' layerMax 不超过 layerCap');
  const prices = z.ores.map(function (o) { return CONFIG.ores[o.ore].price; });
  const cheapest = z.ores[prices.indexOf(Math.min.apply(null, prices))].ore;
  eq(z.filler, cheapest, tag + ' 填充矿是本关最便宜的矿');
  ok(z.timeSec > 0 && z.cols > 0 && z.rows > 0, tag + ' 时长/棋盘尺寸为正');
});

{
  const zs = CONFIG.zones;
  eq(zs.length, 4, '共四关（v13：7 关 → 4 关）');
  eq(new Set(ZONE_IDS).size, 4, '四关 id 互不相同');
  eq(ZONE_IDS.join('/'), 'quarry/copperRidge/blueIron/lavaEdge', '关卡顺序');
  // v13：四关的跨关收入比由 coinMul 8/2/1/1 压进 2–4 倍（test/balance.mjs 的满配跨关比实测 2.45/2.74/3.67）。
  const mulSeries = zs.map(function (z) { return z.coinMul; });
  eq(mulSeries.join('/'), '3/2/1/1', 'coinMul = 3/2/1/1（v15：第 1 关压低、让连锁当主角）');
  for (let i = 0; i < mulSeries.length; i++) ok(Number.isInteger(mulSeries[i]) && mulSeries[i] >= 1, zs[i].id + ' coinMul 是 ≥1 的整数');
  for (let i = 1; i < zs.length; i++) {
    const prevMax = Math.max.apply(null, zs[i - 1].ores.map(function (o) { return CONFIG.ores[o.ore].price; }));
    const curMax = Math.max.apply(null, zs[i].ores.map(function (o) { return CONFIG.ores[o.ore].price; }));
    ok(curMax >= prevMax, '第 ' + (i + 1) + ' 关有单价不低于上一关的矿（收益靠矿价升级，不靠拍倍率）');
    eq(zs[i - 1].nextZone, zs[i].id, '链式 nextZone ' + zs[i - 1].id + ' -> ' + zs[i].id);
    ok(zs[i].layerMin >= zs[i - 1].layerMin, '层数下限不倒退 ' + zs[i].id);
    ok(zs[i].layerMax >= zs[i - 1].layerMax, '层数上限不倒退 ' + zs[i].id);
  }
  eq(String(zs[3].nextZone), 'null', '最后一关 nextZone 为 null');
  eq(!!zs[3].final, true, '最后一关标记 final');
  for (let i = 0; i < 3; i++) eq(!!zs[i].final, false, zs[i].id + ' 不是最终关');
  eq(CONFIG.zones[ZONE_IDS.indexOf('blueIron')].objective.ore, 'gold', '第 3 关目标矿是金矿');
  eq(CONFIG.zones[ZONE_IDS.indexOf('lavaEdge')].objective.ore, 'crystal', '第 4 关目标矿是晶石');
  eq(CONFIG.zones[ZONE_IDS.indexOf('copperRidge')].objective.ore, 'iron', '第 2 关目标矿是铁');
  // 目标数量逐关递增（按实测每局产量标定，见交付说明）
  const needs = zs.map(function (z) { return z.objective.need; });
  for (let i = 1; i < needs.length; i++) ok(needs[i] > needs[i - 1], '目标数量逐关递增 ' + needs[i - 1] + ' -> ' + needs[i]);
}

/* ---------------- 3. 工具解锁链 ---------------- */
section('3 工具解锁：进入第 N 关解锁第 N 把 + hasTool/setTool');
{
  for (let i = 0; i < ZONE_IDS.length; i++) {
    const enter = CONFIG.zones[i].enterUnlocks || [];
    if (i === 0) {
      eq(enter.length, 0, '第 1 关无 enterUnlocks（木镐是开局自带）');
      ok(TOOL_IDS.indexOf('wood') === 0, 'wood 是工具表第一把（开局工具）');
    } else {
      eq(enter.join(','), TOOL_IDS[i], '第 ' + (i + 1) + ' 关进入即解锁 ' + TOOL_IDS[i]);
      eq(enter.length, 1, '第 ' + (i + 1) + ' 关只发一把工具');
    }
    for (const t of enter) ok(!!CONFIG.tools[t], 'enterUnlocks 里的 ' + t + ' 是合法工具');
  }
  const allEnter = [];
  for (const z of CONFIG.zones) for (const t of (z.enterUnlocks || [])) allEnter.push(t);
  eq(allEnter.join(','), TOOL_IDS.slice(1).join(','), '四关累计正好发放第 2-4 把工具，无重复无遗漏');
  ok(allEnter.indexOf('wood') < 0, '木镐不由任何关发放');
}
{
  const { CORE } = boot(makeStorage());
  eq(CORE.state.unlockedTools.join(','), 'wood', '开局只有木镐');
  eq(CORE.state.selectedTool, 'wood', '开局选中木镐');
  eq(CORE.hasTool('wood'), true, 'hasTool(wood)');
  eq(CORE.hasTool('iron'), false, 'hasTool(iron) 初始为假');
  eq(CORE.hasTool('nope'), false, 'hasTool 未知工具为假');
  eq(CORE.hasTool(undefined), false, 'hasTool(undefined) 为假');
  for (let i = 1; i < ZONE_IDS.length; i++) {
    const tool = TOOL_IDS[i];
    eq(CORE.hasTool(tool), false, '进入第 ' + (i + 1) + ' 关前 ' + tool + ' 未解锁');
    eq(CORE.unlockZone(ZONE_IDS[i]), true, 'unlockZone(' + ZONE_IDS[i] + ')');
    const list = CORE.checkUnlocks();
    eq(list.join(','), tool, '进入第 ' + (i + 1) + ' 关只解锁 ' + tool);
    eq(CORE.hasTool(tool), true, '进入第 ' + (i + 1) + ' 关后 hasTool(' + tool + ')');
    eq(CORE.state.unlockedTools.length, i + 1, '工具数随关卡 +1');
  }
  eq(CORE.state.unlockedTools.join(','), TOOL_IDS.join(','), '走完四关集齐四把工具');
  eq(CORE.unlockTool('laser'), false, '重复解锁返回 false');
  eq(CORE.unlockTool('plasma'), false, '未知工具解锁返回 false');
  eq(CORE.state.unlockedTools.length, 4, '未知/重复解锁不改变工具表');
}
{
  const storage = makeStorage();
  const { CORE } = boot(storage);
  eq(CORE.setTool('iron'), false, '未解锁的铁镐不能选');
  eq(CORE.state.selectedTool, 'wood', '选择失败不改 selectedTool');
  eq(CORE.setTool('wood'), true, '选当前已选中的工具返回 true');
  eq(CORE.setTool('nope'), false, '未知工具不能选');
  eq(CORE.setTool(123), false, '非字符串不能选');
  eq(CORE.setTool(), false, '缺参数不能选');
  eq(CORE.state.selectedTool, 'wood', '失败的选择不改 selectedTool');
  CORE.unlockTool('iron');
  eq(CORE.setTool('iron'), true, '解锁后可选中铁镐');
  eq(CORE.state.selectedTool, 'iron', 'selectedTool 已切到 iron');
  const again = boot(storage);
  eq(again.CORE.state.selectedTool, 'iron', 'selectedTool 写入存档并可读回');
}

/* ---------------- 4. coinMul 结算 ---------------- */
section('4 settleRound × zone.coinMul：同矿同量逐关放大');
{
  const { CORE, CONFIG: C } = boot(makeStorage());
  const counts = { stone: 7, coal: 11, iron: 5, crystal: 3 };
  const base = Object.keys(counts).reduce(function (s, id) {
    return s + BigInt(counts[id]) * BigInt(C.ores[id].price);
  }, 0n);
  const earned = [];
  for (const z of C.zones) {
    const res = CORE.settleRound({ zoneId: z.id, counts: Object.assign({}, counts) });
    eq(res.zoneId, z.id, z.id + ' 结算回传 zoneId');
    eq(res.coinMul, z.coinMul, z.id + ' 结算回传本关 coinMul');
    eq(res.coinsEarned, base * BigInt(z.coinMul), z.id + ' 金币 = 基础值 × coinMul');
    eq(res.lines.length, 4, z.id + ' 四种矿各一行明细');
    eq(res.lines.reduce(function (s, l) { return s + BigInt(l.subtotal); }, 0n), base, z.id + ' 明细小计合计正确');
    earned.push(BigInt(res.coinsEarned));
  }
  eq(earned.length, 4, '四关各结算一次');
  console.log('  NOTE: 同一份 counts 在 7 关的结算 = ' + earned.join('/') + '（coinMul 口径由数值转调决定）');
  // v8 的 coinMul 不再逐关递增（前两关补廉价矿、第 3 关起回到 1），所以只守「比值 = coinMul 之比」
  for (let i = 1; i < earned.length; i++) {
    ok(earned[i] * BigInt(C.zones[0].coinMul) === earned[0] * BigInt(C.zones[i].coinMul),
      '第 ' + (i + 1) + ' 关 / 第 1 关 的倍率正好是 coinMul 之比');
  }
  eq(CORE.state.coins.toString(), earned.reduce(function (s, v) { return s + v; }, 0n).toString(),
    '累计金币 = 四关结算之和（bigint 不丢精度）');
  eq(CORE.state.roundsPlayed, 4, '四次结算记 4 局');

  // 单矿同量：只结算 1 颗晶石（400 金），逐关放大
  const one = [];
  for (const z of C.zones) {
    one.push(BigInt(CORE.settleRound({ zoneId: z.id, counts: { crystal: 1 } }).coinsEarned));
  }
  eq(one.join('/'), C.zones.map(function (z) { return String(BigInt(C.ores.crystal.price) * BigInt(z.coinMul)); }).join('/'),
    '单颗晶石在 4 关的结算严格按 coinMul 放大');
  for (let i = 1; i < one.length; i++) {
    ok(one[i] * BigInt(C.zones[0].coinMul) === one[0] * BigInt(C.zones[i].coinMul), '单颗晶石第 ' + (i + 1) + ' 关 / 第 1 关 = coinMul 之比');
  }
}

/* ---------------- 5. TREE-V8 的 11 个节点 ---------------- */
section('5 TREE-V16 节点表：中心 mine + 73 个天赋节点（10 条链 + deepLayer）/ parent 链 / 深度 / 图标');
{
  const { CONFIG: C } = boot(makeStorage());
  const tree = C.tree;
  ok(!!tree, 'CONFIG.tree 存在（树的数据模型）');
  eq(tree.center.id, 'mine', '中心节点 id = mine');
  eq(tree.center.name, '开始挖矿', '中心节点名「开始挖矿」');
  ok(tree.center.desc.indexOf('所有武器伤害 +1') >= 0, '中心 desc 写明「所有武器伤害 +1」');
  eq(JSON.stringify(tree.center.effect), JSON.stringify({ damage: 1 }), '中心 effect = { damage: 1 }');
  eq(tree.center.maxLevel, 1, '中心单级');
  eq((tree.center.requires || []).length, 0, '中心无前置（第一局结束就能买）');
  eq(tree.center.depth, 0, '中心深度 0');
  eq(tree.center.icon, 'pick', '中心图标 pick');
  eq(tree.nodes.length, 75, 'tree.nodes = 75 个天赋节点（10 条链 + deepLayer）');
  eq(ALL_NODES.length, 76, '中心 1 + 天赋 75 = 76 个节点（含 deepLayer）');
  eq(new Set(ALL_NODES.map(function (n) { return n.id; })).size, 76, '76 个 id 互不相同');
  eq(ALL_NODES.reduce(function (s, n) { return s + n.maxLevel; }, 0), 1074, '合计 1074 级（74 个单级 + 中心 1 + deepLayer 999）');
  eq(tree.lanes.length, 6, '6 条分支（含 v15 deep 车道）');
  /* v15：deepLayer 是唯一的 999 级长尾节点（用户要求），其余 74 个仍是单级拆链节点。 */
  const longNodes = tree.nodes.filter(function (n) { return n.maxLevel > 1; });
  eq(longNodes.length, 1, '只有 1 个多级节点（v15 的 deepLayer）');
  eq(longNodes[0] && longNodes[0].id, 'deepLayer', '多级节点 id = deepLayer');
  eq(longNodes[0] && longNodes[0].maxLevel, 999, '矿层加深 maxLevel = 999');
  eq(longNodes[0] && longNodes[0].levels, 999, 'levels 同样 999（UI 的 Lv 0/999 读它）');
  eq(longNodes[0] && longNodes[0].parent, 'mine', '挂中心 mine（用户口径：单节点、不是链）');
  ok(tree.nodes.filter(function (n) { return n.maxLevel === 1; })
    .every(function (n) { return n.levels === 1; }), '其余 72 个节点单级：maxLevel = levels = 1');
  ok(tree.nodes.every(function (n) { return n.levelEffect === undefined; }), '单级节点只写 effect，不写 levelEffect');

  // 12 条链：前缀 / 基名 / lane / 链头挂谁 / 链长 / 效果键（= v8 的 11 个多级节点逐个拆开 + v11 的珍贵矿石占比链）
  const CHAINS = [
    ['atk', '攻击', 'power', 'mine', 10, 'damage'],
    ['exec', '处决', 'power', 'atk2', 3, 'execThreshold'],
    ['spd', '攻速', 'power', 'atk2', 8, 'holdIntervalMul'],
    ['settle', '结算', 'settle', 'mine', 10, 'settleMul'],
    ['ore', '矿石掉落', 'settle', 'settle2', 5, 'dropFlat'],
    ['tntDrop', 'TNT 掉落', 'tntDrop', 'mine', 10, 'luckyTNTChance'],
    ['tntDmg', 'TNT 伤害', 'tntDrop', 'tntDrop2', 8, 'tntDamageMul'],
    ['tntPierce', 'TNT 穿透', 'tnt', 'mine', 2, 'tntLayerPierce'],
    ['chain', '连锁', 'chain', 'mine', 10, 'chainCells'],
    ['oreRate', '贵重占比', 'settle', 'settle1', 8, 'oreRateBonus']
  ];
  eq(CHAINS.length, 10, '§7 的表正好 10 条链（v16：连锁范围 4 环并进连锁链，连 8 → 10 环）');
  eq(CHAINS.reduce(function (s, r) { return s + r[4]; }, 0), 74, '10 条链合计 74 个节点');

  let longest = 0, longestId = '';
  for (const row of CHAINS) {
    const prefix = row[0], base = row[1], lane = row[2], head = row[3], count = row[4], key = row[5];
    if (count > longest) { longest = count; longestId = prefix; }
    for (let i = 1; i <= count; i++) {
      const id = prefix + i;
      const n = C.talents[id];
      ok(!!n, id + ' 在 CONFIG.talents 索引里');
      if (!n) continue;
      eq(n.name, base + ' +' + i, id + ' 名称 = ' + base + ' +' + i + '（编号区分第几级）');
      eq(n.parent, i === 1 ? head : prefix + (i - 1), id + ' parent = ' + (i === 1 ? head : prefix + (i - 1)));
      eq((n.requires || []).join(','), i === 1 ? head : prefix + (i - 1), id + ' requires = [parent]');
      eq(n.maxLevel, 1, id + ' maxLevel = 1（单级节点）');
      eq(n.lane, lane, id + ' lane = ' + lane);
      eq(n.kind, 'talent', id + ' kind = talent');
      eq(Object.keys(n.effect || {}).join(','), key, id + ' effect 只写活键 ' + key);
      ok(ICONS.indexOf(n.icon) >= 0, id + ' icon「' + n.icon + '」∈ §5 的程序化图标');
      ok(typeof n.desc === 'string' && n.desc.indexOf('链上第 ' + i + '/' + count + ' 个') === 0,
        id + ' desc 以「链上第 ' + i + '/' + count + ' 个」开头');
      // 深度 = parent 链步数：根链的第 i 个在深度 i，侧链整体 +1
      // 链头自身深度 + 链位置：根链链头 = 中心（深度 0）→ 第 1 环在深度 1；
      // 侧链链头挂在第 2 环（深度 2）→ 第 1 环在深度 3；oreRate 挂 settle1（深度 1）→ 第 1 环在深度 2。
      const headDepth = head === CENTER.id ? 0 : chainDepth(C.talents[head]);
      eq(n.depth, headDepth + i, id + ' depth = 链头深度 ' + headDepth + ' + ' + i);
      eq(n.ring, n.depth, id + ' ring = depth（UI 环号）');
    }
  }
  eq(longest, 10, '最长链 10 个节点（' + longestId + '）');
  eq(Math.max.apply(null, ALL_NODES.map(function (n) { return n.depth; })), 10, '最长链终点深度 10（验收口径：最长链 10）');

  // parent 链：每条都能走到中心，depth/ring 由链现算并写在节点上
  for (const n of ALL_NODES) {
    const d = chainDepth(n);
    ok(d >= 0, n.id + ' 的 parent 链可追溯到中心（深度 ' + d + '）');
    eq(n.depth, d, n.id + ' 身上的 depth 字段 = parent 链步数');
    ok(reachesCenter(n), n.id + ' 的整条链都通（没有孤儿/环）');
    if (n.parent && n.parent !== CENTER.id) ok(!!C.talents[n.parent], n.id + ' 的父节点 ' + n.parent + ' 存在');
  }
  const byDepth = {};
  for (const n of ALL_NODES) byDepth[n.depth] = (byDepth[n.depth] || 0) + 1;
  eq(Object.keys(byDepth).map(Number).sort(function (a, b) { return a - b; }).join(','), '0,1,2,3,4,5,6,7,8,9,10',
    '深度铺满 0..10（树真的长出 10 层）');
  eq([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (d) { return byDepth[d] || 0; }).join(','),
    '1,6,6,9,9,9,8,8,7,7,6', '每层节点数 1/6/6/9/9/9/8/8/7/7/6 = 76（deepLayer 在 depth 1）');

  const kids = ALL_NODES.filter(function (n) { return n.parent === 'mine'; }).map(function (n) { return n.id; }).sort();
  eq(kids.join(','), 'atk1,chain1,deepLayer,settle1,tntDrop1,tntPierce1', '中心的 6 个直接孩子 = 6 条根链的链头（含 deepLayer）');

  // §7.1：武器不进天赋树 —— 表里不能再有解锁型节点
  for (const n of ALL_NODES) eq(n.unlocksTool, undefined, n.id + ' 不是解锁型节点（武器不进树）');
  for (const gone of ['atk', 'toolStone', 'toolIron', 'toolDiamond', 'toolLaser', 'toolQuake', 'toolCore',
    'diaRange', 'laserCol', 'quakeSpd', 'spd', 'settle', 'tntDrop']) {
    eq(C.talents[gone], undefined, '旧的「多级节点」id ' + gone + ' 已经拆成链，不再单独存在');
  }
}

/* ---------------- 5.1 逐级效果 + 死键检测 ---------------- */
section('5.1 单级效果：每个节点买 1 次就让 mods 变；满链总效果与旧的多级节点完全一致（死键检测）');
{
  const { CORE, CONFIG: C } = boot(makeStorage());
  const N = C.talents;
  const KEYS = CORE.modKeys();
  const WHITE = KEYS.add.concat(KEYS.mul);
  ok(WHITE.length > 0 && KEYS.add.length > 0 && KEYS.mul.length > 0, 'CORE.modKeys() 暴露加法/乘法两张白名单');

  // 链 → (mods 键, 每级增量的类型, 每步幅度, 链长, 满链总贡献)
  // 「每步幅度」= 单级节点的 effect；「满链总贡献」= 旧多级节点买满的效果，两者必须对得上。
  const CHAIN = [
    ['mine', 'mine', 'damage', 'add', 1, 1],
    ['atk', 'atk', 'damage', 'add', 2, 10],
    ['spd', 'spd', 'holdIntervalMul', 'mul', 0.93, 8],
    ['settle', 'settle', 'settleMul', 'mul', 1.08, 10],
    ['ore', 'ore', 'dropFlat', 'add', 1, 5],
    ['tntDrop', 'tntDrop', 'luckyTNTChance', 'add', 0.01, 10],
    ['tntDmg', 'tntDmg', 'tntDamageMul', 'mul', 1.20, 8],
    ['tntPierce', 'tntPierce', 'tntLayerPierce', 'add', 1, 2],
    ['chain', 'chain', 'chainCells', 'add', 1, 10],
    ['oreRate', 'oreRate', 'oreRateBonus', 'add', 0.02, 8],
    ['exec', 'exec', 'execThreshold', 'table', [0.18, 0.12, 0.15], 3]
  ];
  // 满链总贡献（= 旧多级节点买满的值）：加法 = 步长 × 环数，乘法 = 步长 ^ 环数，处决 = 三步之和
  const fullOf = function (mode, step, count) {
    if (mode === 'table') return step.reduce(function (s, v) { return s + v; }, 0);
    return mode === 'add' ? step * count : Math.pow(step, count);
  };

  // effect 只允许写活键：白名单外的键在 mods() 里根本不会累加（= 花了钱没效果的死键）
  for (const n of ALL_NODES) {
    const keys = Object.keys(n.effect || {});
    ok(keys.length > 0, n.id + ' 有 effect');
    for (const k of keys) ok(WHITE.indexOf(k) >= 0, n.id + ' 的 effect 键 ' + k + ' 在 mods 白名单里（不是死键）');
    const pre = n.id === 'mine' ? 'mine' : String(n.id).replace(/[0-9]+$/, '');
    ok(pre === 'deepLayer' || CHAIN.some(function (r) { return r[0] === pre; }),
      n.id + ' 在效果表里被验证到（链 ' + pre + '）');
  }

  CORE.state.talents = {};
  const zero = CORE.mods();
  const zeroSnap = {};
  for (const k of WHITE) zeroSnap[k] = zero[k];

  // 逐节点：单独买这一个节点（其余全空）→ mods 对应键必须正好走到 基数 + 这一步
  for (const row of CHAIN) {
    const prefix = row[0], key = row[2], mode = row[3], step = row[4], count = row[5];
    const full = fullOf(mode, step, count);
    const ids = [];
    for (let i = 1; i <= count; i++) ids.push(prefix === 'mine' ? 'mine' : prefix + i);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const n = N[id];
      ok(!!n, id + ' 存在');
      if (!n) continue;
      eq(n.maxLevel, 1, id + ' 是单级节点');
      const delta = mode === 'table' ? step[i] : step;
      near(n.effect[key], delta, id + ' effect.' + key + ' = 本节点这一步 ' + delta);
      CORE.state.talents = {};
      CORE.state.talents[id] = 1;
      const m = CORE.mods();
      const wantMods = (mode === 'mul') ? Math.round(zeroSnap[key] * delta * 1e6) / 1e6
          : Math.round((zeroSnap[key] + delta) * 1e6) / 1e6;
      near(m[key], wantMods, id + ' 单独买 1 级 → mods.' + key + ' = ' + wantMods + '（基数 ' + zeroSnap[key] + '）');
      ok(m[key] !== zeroSnap[key], id + ' 买下去 mods.' + key + ' 真的变了（' + zeroSnap[key] + ' → ' + m[key] + '，不是死键）');
    }
    // 满链：整条链全买 → 总贡献 = 旧多级节点买满的值（拆链不改数值）
    CORE.state.talents = {};
    for (const id of ids) CORE.state.talents[id] = 1;
    const fullMods = CORE.mods();
    const wantFull = mode === 'mul' ? zeroSnap[key] * full : zeroSnap[key] + full;
    near(fullMods[key], wantFull, prefix + ' 满链（' + count + ' 个节点）→ mods.' + key + ' = ' + wantFull + '');
  }
  CORE.state.talents = {};

  /* v15 长尾节点（不是链）：deepLayer 999 级，effect 只写「每级 +1」，
     靠 02-core 的 applyLevelEffect 按 effect × 等级叠加 —— 不写 999 长度的 levelEffect 数组。 */
  {
    const dl = N.deepLayer;
    ok(!!dl, 'deepLayer 在 CONFIG.talents 索引里');
    eq(dl.name, '矿层加深 +1', '名称 = 矿层加深 +1');
    eq(dl.maxLevel, 999, 'maxLevel = 999');
    eq(dl.levels, 999, 'levels = 999');
    eq(dl.levelEffect, undefined, '不写 levelEffect 数组（用 effect × 等级 的加法口径）');
    eq(Object.keys(dl.effect || {}).join(','), 'extraLayers', 'effect 只写 extraLayers 一个活键');
    eq(dl.effect.extraLayers, 1, '每级 extraLayers +1');
    eq(dl.lane, 'deep', '独占 deep 枝（第 6 条 lane，中心 6 个孩子各占一条扇区）');
    eq(dl.parent, 'mine', 'parent = 中心 mine');
    eq(dl.depth, 1, '深度 1（挂中心）');
    const levels = [1, 2, 10, 100, 999];
    for (const lv of levels) {
      CORE.state.talents = { mine: 1, deepLayer: lv };
      near(CORE.mods().extraLayers, lv, 'Lv ' + lv + ' → mods.extraLayers = ' + lv + '（effect × 等级）');
    }
    CORE.state.talents = {};
    near(CORE.mods().extraLayers, 0, '未买 → mods.extraLayers = 0');
  }

  // 同键跨链相加 / 相乘
  CORE.state.talents = { mine: 1, atk1: 1, atk2: 1, atk3: 1, atk4: 1, atk5: 1, atk6: 1 };
  eq(CORE.mods().damage, 1 + 12, 'mine + atk1..atk6 = mods.damage 13（每环 +2，同键相加）');
  CORE.state.talents = { chain1: 1, chain2: 1, chain3: 1, chain4: 1, chain5: 1, chain6: 1, chain7: 1, chain8: 1, chain9: 1, chain10: 1 };
  eq(CORE.mods().chainCells, 10, '连锁满链 10 环（每环 +1 格）→ mods.chainCells = 10（v16 确定性连锁，不再是概率）');
  eq(CORE.mods().chainChance, 0, 'chainChance 停在 0：连锁已经不吃概率键（连锁范围链已并进来）');
  CORE.state.talents = { settle1: 1, settle2: 1, settle3: 1, settle4: 1, settle5: 1, settle6: 1, settle7: 1, settle8: 1, settle9: 1, settle10: 1 };
  near(CORE.mods().settleMul, Math.pow(1.08, 10), '结算满链 10 环 → settleMul = 1.08^10 = 2.158925（乘法键逐环相乘）');
  CORE.state.talents = { spd1: 1, spd2: 1, spd3: 1, spd4: 1, spd5: 1, spd6: 1, spd7: 1, spd8: 1 };
  near(CORE.mods().holdIntervalMul, Math.pow(0.93, 8), '攻速满链 8 环 → 按住间隔 ×0.55958');
  ok(CORE.mods().holdIntervalMul >= 0.5, 'holdIntervalMul 有 0.5 的下限夹紧（不会变成 0）');

  // 处决：三步增量 12% / 8% / 10% 累计到 12% / 20% / 30%（旧口径的非等差曲线）
  CORE.state.talents = {};
  near(CORE.mods().execThreshold, 0, '未买处决 → execThreshold = 0（不处决）');
  CORE.state.talents = { exec1: 1 };
  near(CORE.mods().execThreshold, 0.18, '处决 1 环 → 阈值 18%');
  CORE.state.talents = { exec1: 1, exec2: 1 };
  near(CORE.mods().execThreshold, 0.30, '处决 2 环 → 阈值 30%');
  CORE.state.talents = { exec1: 1, exec2: 1, exec3: 1 };
  near(CORE.mods().execThreshold, 0.45, '处决 3 环 → 阈值 45%（v13：+30~60% 加强后）');

  // TNT 穿透：CONFIG 的 pierceCap 必须装得下链长，否则后几环买了没效果
  CORE.state.talents = { tntPierce1: 1, tntPierce2: 1 };
  eq(CORE.mods().tntLayerPierce, 2 + 2, 'TNT 穿透满链 2 环 → mods.tntLayerPierce = 2 + 2 = 4（pierceCap 4 吃满）');
  // v14：可放置 TNT 删除后，弹药/半径两个键连 mods 都不再提供
  eq(CORE.mods().tntMax, undefined, 'mods.tntMax 已删除（放置 TNT 每局弹药随功能下线）');
  eq(CORE.mods().tntRadiusCells, undefined, 'mods.tntRadiusCells 已删除（幸运 TNT 固定 3×3，不吃半径天赋）');
  CORE.state.talents = {};
}

/* ---------------- 5.2 武器只由关卡解锁 ---------------- */
section('5.2 武器不进天赋树（§7.1）：hasTool 只由 zones[].enterUnlocks 给，进关自动换上');
{
  const { CORE, CONFIG: C } = boot(makeStorage());
  eq(CORE.state.unlockedTools.join(','), 'wood', '开局只有木镐');
  eq(CORE.state.selectedTool, 'wood', '开局选中木镐');
  CORE.state.coins = 10n ** 12n;
  eq(CORE.buyNode('mine'), true, '买中心（树里没有武器节点）');
  eq(CORE.buyNode('toolIron'), false, 'toolIron 已从树里删除，买不了');
  eq(CORE.buyNode('toolCore'), false, 'toolCore 已从树里删除，买不了');
  eq(CORE.hasTool('iron'), false, '买完中心也没有铁镐（武器不靠天赋）');

  // 进关即解锁
  const got = [];
  for (let i = 1; i < C.zones.length; i++) {
    CORE.unlockZone(C.zones[i].id);
    const list = CORE.checkUnlocks();
    got.push(list.join(','));
    eq(CORE.hasTool(C.zones[i].enterUnlocks[0]), true, '进入第 ' + (i + 1) + ' 关后 hasTool(' + C.zones[i].enterUnlocks[0] + ')');
    // v13：按解锁顺序（CONFIG.tools 的插入顺序）换新，不再比伤害 —— 激光钻 8 伤也换得上去
    const order = Object.keys(C.tools);
    const best = CORE.state.unlockedTools.slice().sort(function (a, b) { return order.indexOf(b) - order.indexOf(a); })[0];
    eq(CORE.state.selectedTool, best, '进关后选中的是最新解锁的那把（自动换上，且不会降级）');
  }
  eq(got.join('|'), 'iron|diamond|laser', '三关依次只发一把工具（木镐开局自带）');
  eq(CORE.state.unlockedTools.length, 4, '走完四关集齐四把工具');
  eq(CORE.checkUnlocks().length, 0, '都解锁过 → 再扫一遍没有新东西');
  eq(CORE.state.selectedTool, 'laser', '再扫一遍不会把选中工具降级');
}

/* ---------------- 5.3 价格公式 ---------------- */
section('5.3 nodeCost = baseCost × depthMul[深度]（单级节点，链上第 i 环站在深度 i）');
{
  const { CORE, CONFIG: C } = boot(makeStorage());
  eq(C.talentCostTable.depthMul.join(','), '1,3,7,18,46,119,309,803,2088,5430', 'depthMul 十档（深度 1..10）');
  for (const n of ALL_NODES) {
    eq(CORE.nodeCost(n.id).toString(), priceAt(n, 0).toString(), n.id + ' 报价 = baseCost(' + n.baseCost + ') × depthMul(' + n.depth + ')');
    eq(n.cost, Number(priceAt(n, 0)), n.id + ' 静态 cost 快照 = 首级实价');
    // 单级：买到就是满级 → 报价 0n，买不动；长尾节点（999 级）买 1 级后报价 = 第 2 级（线性 600）
    CORE.state.talents = {};
    CORE.state.talents[n.id] = 1;
    if (n.maxLevel > 1) {
      eq(CORE.nodeCost(n.id).toString(), priceAt(n, 1).toString(), n.id + ' 买 1 级后报价 = 第 2 级线性价 ' + priceAt(n, 1));
      eq(CORE.nodeCost(n.id).toString(), '600', n.id + ' 第 2 级 = 300 × 2 = 600');
    } else {
      eq(CORE.nodeCost(n.id), 0n, n.id + ' 买完报价 0n（单级节点没有下一级）');
    }
  }
  CORE.state.talents = {};
  eq(CORE.nodeCost('mine').toString(), String(C.tree.center.cost), '中心价 = center.cost（深度 0 → 不加倍率）');
  eq(CORE.nodeCost('nope'), 0n, '未知 id 报价 0n');

  // 链内报价单调：第 i+1 环比第 i 环贵（每环 ≈ ×2.6，阶梯取整后 2.2–2.9 倍之间）
  const CHAIN_LEN = { atk: 10, exec: 3, spd: 8, settle: 10, ore: 5, tntDrop: 10, tntDmg: 8, tntPierce: 2, chain: 10, oreRate: 8 };
  for (const prefix of Object.keys(CHAIN_LEN)) {
    let prev = 0;
    for (let i = 1; i <= CHAIN_LEN[prefix]; i++) {
      const p = Number(CORE.nodeCost(prefix + i));
      ok(p > prev, prefix + i + ' 报价 ' + p + ' 高于链上前一环 ' + prev);
      if (i > 2 && prefix !== 'tntDrop') {   // tntDrop 走固定价软门槛（第 2 环起约 ×1.45），不是 2.6 阶梯
        // 第 1→2 环额外叠了首环 35% 折扣（比值 ≈4.6），从第 3 环起才是纯 2.6 阶梯
        const ratio = p / prev;
        ok(ratio > 2.2 && ratio < 2.9, prefix + i + ' / 上一环 = ' + ratio.toFixed(2) + '（≈ ×2.6 的整数阶梯）');
      }
      prev = p;
    }
  }
  // 根链首环与侧链首环的价格口径：侧链头部深度 2 → 首环 = baseCost × 2
  eq(CORE.nodeCost('atk1').toString(), '585', 'atk1 = 900 × 0.65（首环折扣）× depthMul[1] = 585');
  eq(CORE.nodeCost('spd1').toString(), String(C.talents.spd1.baseCost * 7), 'spd1 = 2000 × depthMul[3] = 14000（侧链链头在深度 3）');
  CORE.state.talents = {};
}
/* ---------------- 5.3b 珍贵矿石占比链（v11） ---------------- */
section('5.3b 珍贵矿石占比链：8 环 × +2pp / 满链 mods.oreRateBonus = 0.16 / clamp 0.25 / 价 2.6 幂 × depthMul');
{
  const { CORE, CONFIG: C } = boot(makeStorage());
  const ids = [];
  for (let i = 1; i <= 8; i++) ids.push('oreRate' + i);
  eq(ids.filter(function (id) { return !!C.talents[id]; }).length, 8, 'oreRate 链 8 环全部在 CONFIG.talents 里');
  eq(ids.map(function (id) { return C.talents[id].effect.oreRateBonus; }).join(','),
    '0.02,0.02,0.02,0.02,0.02,0.02,0.02,0.02', '8 个节点的 effect 都是 oreRateBonus = 0.02（+2pp）');
  eq(ids.map(function (id) { return Object.keys(C.talents[id].effect).join('+'); }).join(','),
    Array(8).fill('oreRateBonus').join(','), '8 个节点都只写 oreRateBonus 一个键（没有夹带别的影响）');
  eq(C.talents.oreRate1.parent, 'settle1', '链头挂 settle1（结算 lane 的第 1 环）');
  eq(C.talents.oreRate1.requires.join(','), 'settle1', '链头 requires = [settle1]');
  eq(C.talents.oreRate1.lane, 'settle', '与 ore 链同挂结算 lane（不新增扇区，ui.smoke 的根子节点数 = lanes 数）');
  eq(C.talents.oreRate8.parent, 'oreRate7', 'requires 串链：oreRate8 的父 = oreRate7');
  eq(ids.map(function (id) { return C.talents[id].maxLevel; }).join(','), '1,1,1,1,1,1,1,1', '每环 maxLevel = 1');
  eq(ids.map(function (id) { return C.talents[id].depth; }).join(','), '2,3,4,5,6,7,8,9', '8 环逐环站在深度 2..9（链头 settle1 在深度 1）');
  eq(ids.map(function (id) { return C.talents[id].baseCost; }).join(','), '800,800,800,800,800,800,800,800', '8 环 baseCost 都是 800');
  // 价格：400 × depthMul[深度]（depthMul 就是 round(1.9^(d-1))，所以报价天然是 400 × 1.9^(k-1) 阶梯）
  eq(ids.map(function (id) { return CORE.nodeCost(id).toString(); }).join(','),
    '2400,5600,14400,36800,95200,247200,642400,1670400', '8 环报价 = 800 × depthMul[2..9] = 2400 / 5600 / 14400 / 36800 / 95200 / 247200 / 642400 / 1670400');
  let sum = 0n;
  for (let i = 1; i <= 8; i++) sum += CORE.nodeCost('oreRate' + i);
  eq(sum.toString(), '2714400', '整链总价 = 800 × (3+7+18+46+119+309+803+2088) = 2,714,400 金');

  // 满链 / 逐级：加法叠加
  CORE.state.talents = chainStore({ mine: 1, oreRate: 8 });
  near(CORE.mods().oreRateBonus, 0.16, '满链 mods.oreRateBonus = 0.16（8 × 0.02 = +16pp）');
  CORE.state.talents = chainStore({ mine: 1, oreRate: 1 });
  near(CORE.mods().oreRateBonus, 0.02, '买 1 环 → mods.oreRateBonus = 0.02（死键检测见 §13）');
  CORE.state.talents = chainStore({ mine: 1, oreRate: 4 });
  near(CORE.mods().oreRateBonus, 0.08, '买 4 环 → mods.oreRateBonus = 0.08（逐环相加，不是相乘）');

  // clamp [0, 0.25]：满链只有 0.16，边界靠临时放大单节点 effect 来验
  const keep = C.talents.oreRate8.effect;
  C.talents.oreRate8.effect = { oreRateBonus: 0.30 }; CORE.invalidateMods();
  CORE.state.talents = { mine: 1, oreRate8: 1 };
  near(CORE.mods().oreRateBonus, 0.25, 'effect 写 0.30 → clampMods 夹到 0.25');
  C.talents.oreRate8.effect = { oreRateBonus: -0.5 }; CORE.invalidateMods();
  near(CORE.mods().oreRateBonus, 0, 'effect 写 -0.5 → 夹回 0（不做反向加成：不会提高填充矿）');
  C.talents.oreRate8.effect = keep; CORE.invalidateMods();
  CORE.state.talents = {};
  near(CORE.mods().oreRateBonus, 0, '清空天赋 → mods.oreRateBonus 回到 0');
}

/* ---------------- 5.4 放置 TNT 已删除 ---------------- */
section('5.4 可放置 TNT 已整套删除：没有投放接口 / 没有每局弹药 / 没有入口派生');
{
  const { CORE, CONFIG: C } = boot(makeStorage());
  CORE.state.talents = {};
  eq(CORE.mods().hasTNT, undefined, 'mods.hasTNT 已删除（放置 TNT 的入口标记）');
  eq(CORE.mods().tntMax, undefined, 'mods.tntMax 已删除（每局弹药）');
  eq(CORE.mods().tntRadiusCells, undefined, 'mods.tntRadiusCells 已删除（半径只服务放置）');
  eq(C.hasTNT, undefined, 'CONFIG 里没有 hasTNT 字段');
  eq(C.tnt.perRound, undefined, 'CONFIG.tnt.perRound / radiusCells / fuseSec / maxCap / radiusCap 全部删除');
  eq(C.tnt.fuseSec, undefined, '放置引线 CONFIG.tnt.fuseSec 已删除');
  eq(C.tuning.luckyTNTTotalMax, 400, '每局幸运 TNT 总量上限 = tuning.luckyTNTTotalMax = 400（很宽，只防卡死）');
  eq(C.tuning.luckyTNTCap, undefined, '旧的 tuning.luckyTNTCap 已改名成 luckyTNTTotalMax');
  eq(C.tuning.luckyTNTSide, 3, '幸运 TNT 固定 3×3（tuning.luckyTNTSide = 3）');
}
/* ---------------- 5.4b TNT 爽感：50% 起 / 满链 90% / 穿透 4 层 ---------------- */
section('5.4b TNT：掉率基数 0 → 满链 0.84（每环 +12pp，首环 −11pp 偏移）/ 穿透 2 + 2 = 4 / 每格伤害够炸穿 5 格');
{
  const { CORE, CONFIG: C } = boot(makeStorage());

  // 1) 掉率 = 基础 0.50 + 每环 +5pp，8 环满 = 0.90（clamp 0.95 装得下）
  const dropChain = Object.keys(C.talents).filter(function (id) { return /^tntDrop\d+$/.test(id); });
  eq(dropChain.length, 10, 'TNT 掉落链共 10 环（v17）');
  ok(dropChain.every(function (id) { return C.talents[id].maxLevel === 1; }), 'TNT 掉落链上全是单级节点');
  CORE.state.talents = {};
  eq(CORE.mods().luckyTNTChance, 0, '未买 TNT 掉落 → mods.luckyTNTChance = 0（v15：白掉率基数 0，掉率全给天赋）');
  CORE.state.talents = chainStore({ tntDrop: 1 });
  near(CORE.mods().luckyTNTChance, 0.01, 'TNT 掉落 1 环 → 0.01（每环 +1pp）');
  CORE.state.talents = chainStore({ tntDrop: 10 });
  near(CORE.mods().luckyTNTChance, 0.10, 'TNT 掉落满链（10 环）→ mods.luckyTNTChance = 0.10');
  CORE.state.talents = chainStore({ tntDrop: 4 });
  near(CORE.mods().luckyTNTChance, 0.04, 'TNT 掉落 4 环 → 0.04');
  // 软门槛：第 1 环第一关就买得起，第 2 环起 10 万（第一关买不动）
  eq(String(C.talents.tntDrop1.fixedCost), '290', 'tntDrop1 = 290 金（第一关随手点）');
  ok(C.talents.tntDrop2.fixedCost >= 100000, 'tntDrop2 ≥ 10 万（第二关才买得动）');

  // 2) 引线：只剩幸运掉落的 1.8 秒长引线（放置引线已随投放功能删除）
  eq(C.tuning.luckyTNTFuseSec, 1.8, '幸运掉落的引线 CONFIG.tuning.luckyTNTFuseSec = 1.8 秒');
  ok(C.tuning.luckyTNTFuseSec >= 1.5, '长引线（1.8s）留给「A 炸 → 掉 B → B 炸」的连环');

  // 3) 每格伤害基数
  eq(C.tnt.tntDamageMul, 4, 'CONFIG.tnt.tntDamageMul = 4（v9b 3 → 4）');
  eq(C.tnt.layerPierce, 2, '一颗 TNT 穿透 2 层');

  // 4) 第 4 关真实层血 vs 一颗 TNT 的每格伤害：
  //    每格伤害 = round(CORE.toolDamage(本关工具) × CONFIG.tnt.tntDamageMul × mods.tntDamageMul)
  //    （与 04-tools 的 tntMulCfg()/tntDamage() 同口径）
  CORE.state.talents = chainStore({ mine: 1, atk: 10 });   // 买满伤害链：mods.damage = 1 + 20 = 21
  const dmgMods = CORE.mods();
  eq(dmgMods.damage, 21, '买满 mine + 攻击 10 环（每环 +2）→ mods.damage = 21');
  near(dmgMods.tntDamageMul, 1, '没买 tntDmg 时 mods.tntDamageMul = 1（乘法键基数是 1）');
  const perCell = function (toolId, mul) {
    return Math.round(CORE.toolDamage(toolId) * C.tnt.tntDamageMul * mul);
  };
  ['lavaEdge'].forEach(function (zid) {
    const z = C.zones.find(function (v) { return v.id === zid; });
    ok(!!z, zid + ' 存在');
    if (!z) return;
    const tool = z.enterUnlocks[0];
    // 第 4 关是金 + 晶 —— 用「本关最贵的那种矿」当硬血上限
    const priciest = z.ores.slice().sort(function (a, b) { return CONFIG.ores[b.ore].price - CONFIG.ores[a.ore].price; })[0];
    const crystal = priciest.hp;
    const iron = z.ores.filter(function (o) { return o !== priciest; })[0].hp;
    const dmgBase = perCell(tool, dmgMods.tntDamageMul);         // 只买伤害链
    console.log('  · ' + z.name + '：' + tool + ' 伤害 ' + CORE.toolDamage(tool) +
      ' → TNT 每格 ' + dmgBase + ' 点 / 晶石层血 ' + crystal + ' / 铁层血 ' + iron);
    ok(dmgBase >= crystal, zid + ' 只买伤害链：TNT 每格 ' + dmgBase + ' ≥ 晶石层血 ' + crystal + '（5 格各炸穿 1 层）');
    ok(dmgBase >= iron, zid + ' 只买伤害链：TNT 每格 ' + dmgBase + ' ≥ 铁层血 ' + iron);
    // 再叠 TNT 伤害满链（1.20^8 = 4.2998）只会更狠
    CORE.state.talents = chainStore({ mine: 1, atk: 10, tntDmg: 8 });
    const full = CORE.mods().tntDamageMul;
    const dmgFull = perCell(tool, full);
    ok(dmgFull >= dmgBase, zid + ' 叠 TNT 伤害满链后每格 ' + dmgFull + ' ≥ 只买伤害链的 ' + dmgBase);
    ok(dmgFull >= crystal * 5, zid + ' 叠 TNT 伤害满链后每格 ' + dmgFull + ' ≥ 晶石层血 ×5（' + crystal * 5 + '）：一颗 TNT 的「上下左右 + 自身」5 格各自都能连穿多层');
    CORE.state.talents = chainStore({ mine: 1, atk: 10 });
  });
  CORE.state.talents = {};
}

/* ---------------- 5.5 地心宝藏与胜利 ---------------- */
section('5.5 地心宝藏：CONFIG.treasure / victory 存档字段 / treasureReady 触发条件 / markVictory');
{
  const { CORE, CONFIG: C } = boot(makeStorage());
  eq(C.treasure.hp, 3000, 'CONFIG.treasure.hp = 3000');
  eq(C.treasure.radiusCells, 0, 'CONFIG.treasure.radiusCells = 0（单格宝箱）');
  eq(CORE.state.victory, false, '新档 victory = false');
  eq(CORE.state.victoryAt, 0, '新档 victoryAt = 0');

  // 非最终关永远不生成宝箱（哪怕 objective 达标）
  const other = boot(makeStorage());
  other.CORE.state.lifetimeMined.gold = C.zones[2].objective.need;
  eq(other.CORE.settleRound({ zoneId: 'blueIron', counts: { crystal: 1 } }).treasureReady, false,
    '非最终关即使达标也不生成宝箱');

  // 第 4 关（最终关）：未达标 false / 达标 true
  CORE.state.currentZone = 'lavaEdge';
  CORE.unlockZone('lavaEdge');
  let res = CORE.settleRound({ zoneId: 'lavaEdge', counts: { crystal: 1 } });
  eq(res.treasureReady, false, '最终关 objective 未达标 → treasureReady = false');
  CORE.state.lifetimeMined.crystal = C.zones[3].objective.need;
  res = CORE.settleRound({ zoneId: 'lavaEdge', counts: { crystal: 1 } });
  eq(res.objective.done, true, '最终关 objective 已达标');
  eq(res.treasureReady, true, '最终关达标且 victory = false → treasureReady = true（main 据此生成宝箱）');

  // markVictory：只记首次，立即落盘，可读回
  const storage = makeStorage();
  const V = boot(storage);
  eq(V.CORE.markVictory(), true, 'markVictory() 返回 true');
  eq(V.CORE.state.victory, true, 'victory 置 true');
  ok(V.CORE.state.victoryAt > 0, 'victoryAt 记下时间戳');
  const at = V.CORE.state.victoryAt;
  eq(V.CORE.markVictory(), false, '重复调用返回 false（胜利只播一次）');
  eq(V.CORE.state.victoryAt, at, 'victoryAt 不被后续调用覆盖');
  const payload = JSON.parse(storage.getItem(C.saveKey));
  eq(payload.victory, true, '存档写入 victory');
  eq(payload.victoryAt, at, '存档写入 victoryAt');
  const W = boot(storage);
  eq(W.CORE.state.victory, true, '读回 victory');
  eq(W.CORE.state.victoryAt, at, '读回 victoryAt');
  W.CORE.state.currentZone = 'lavaEdge';
  W.CORE.state.lifetimeMined.crystal = C.zones[3].objective.need;
  eq(W.CORE.settleRound({ zoneId: 'lavaEdge', counts: { crystal: 1 } }).treasureReady, false,
    'victory 已置位 → 不再重复生成宝箱');

  // 坏存档：victory 转布尔、负 victoryAt 夹到 0
  const bad = boot(makeStorage({ [C.saveKey]: JSON.stringify({ version: 7, victory: 1, victoryAt: -5 }) }));
  eq(bad.CORE.state.victory, true, 'victory 转布尔');
  eq(bad.CORE.state.victoryAt, 0, '负 victoryAt 夹到 0');
}

/* ---------------- 6. 购买 / 状态机 / 返还 ---------------- */
section('6 节点购买：nodeState 跳级规则 / 扣款精确 / 落盘 / resetTalents 全额返还 / 退休强化的空操作');
{
  const { CORE, CONFIG: C } = boot(makeStorage());
  eq(CORE.tree, C.tree, 'CORE.tree 就是 CONFIG.tree（同一对象）');
  eq(CORE.nodeById('nope'), null, '未知 id → null');
  eq(CORE.nodeLevel('nope'), 0, '未知 id 等级 0');
  eq(CORE.nodeState('nope'), 'locked', '未知 id 状态 locked');
  eq(CORE.buyNode('nope'), false, '未知 id 买不了');

  CORE.state.coins = 10n ** 9n;
  // 只有中心天然可买，其余全锁在 mine（或链上前一环）后面
  eq(CORE.nodeState('mine'), 'available', '开局中心可买');
  eq(CORE.nodeState('atk1'), 'locked', '攻击 1 环的前置 mine 未购 → locked');
  eq(CORE.nodeState('toolStone'), 'locked', 'toolStone 的前置 mine 未购 → locked');
  eq(CORE.mods().damage, 0, '什么都没买 → mods.damage = 0');
  eq(CORE.buyNode('mine'), true, '买中心 mine');
  eq(CORE.nodeLevel('mine'), 1, 'mine 记 1 级');
  eq(CORE.nodeState('mine'), 'owned', '单级节点买完 = owned');
  eq(CORE.buyNode('mine'), false, '单级节点不能重复买');
  eq(CORE.mods().damage, 1, '中心给 mods.damage +1');

  // 跳级规则：只看直接父节点是否已购（链上前一环，别的枝互不影响）
  eq(CORE.nodeState('atk1'), 'available', 'mine 已购 → 攻击 1 环可买');
  eq(CORE.nodeState('settle1'), 'available', '结算 1 环也直接挂在 mine 上，同样可买');
  eq(CORE.nodeState('atk2'), 'locked', '攻击 2 环的前置是攻击 1 环（还没买）');
  eq(CORE.nodeState('spd1'), 'locked', '攻速 1 环挂在攻击 1 环下面');
  eq(CORE.nodeState('tntDmg1'), 'locked', 'TNT 伤害 1 环挂在 TNT 掉落 1 环下面');
  eq(CORE.nodeState('ore1'), 'locked', '矿石掉落 1 环挂在结算 1 环下面');
  eq(CORE.nodeState('chain1'), 'available', '连锁 1 环挂在 mine 上，和攻击互不影响');
  eq(CORE.buyNode('atk1'), true, '买攻击 1 环');
  eq(CORE.nodeState('atk2'), 'available', '攻击 1 环一买 → 攻击 2 环立刻可买');
  eq(CORE.nodeState('spd1'), 'locked', '攻速 1 环挂在攻击 2 环下面，还没解锁');
  eq(CORE.nodeState('exec1'), 'locked', '处决 1 环同样挂在攻击 2 环下面');
  eq(CORE.nodeState('atk3'), 'locked', '攻击 3 环还要等攻击 2 环');

  // 扣款精确：链上每一环单独报价、单独扣款，买完即满（maxLevel = 1）
  CORE.state.coins = 10n ** 6n;
  const c1 = CORE.nodeCost('atk2');
  eq(c1.toString(), priceAt(C.talents.atk2, 0).toString(), '攻击 2 环报价 = baseCost × depthMul[2]');
  const before = CORE.state.coins;
  eq(CORE.buyNode('atk2'), true, '买攻击 2 环');
  eq(before - CORE.state.coins, c1, '实付 = nodeCost');
  eq(CORE.nodeLevel('atk2'), 1, '攻击 2 环记 1 级');
  eq(CORE.mods().damage, 5, 'mine + 攻击 1 环 + 攻击 2 环 = damage 5（每环 +2）');
  eq(CORE.toolDamage('wood'), C.tools.wood.dmg + 5, 'toolDamage = tools.dmg + mods.damage');
  eq(CORE.nodeState('spd1'), 'available', '攻击 2 环一买 → 攻速 1 环解锁（侧链挂在第 2 环）');
  eq(CORE.nodeState('exec1'), 'available', '处决 1 环同步解锁');
  eq(CORE.nodeState('atk3'), 'available', '攻击 3 环也解锁');

  // 单级节点买完就是 maxed（旧口径 talentState 回 owned）
  eq(CORE.nodeCost('atk2'), 0n, '买完 nodeCost = 0n');
  eq(CORE.nodeState('atk2'), 'owned', '单级节点买完 = owned');
  eq(CORE.buyNode('atk2'), false, '单级节点不能重复买');
  eq(CORE.talentState('atk2'), 'owned', '兼容别名 talentState 也回 owned');

  // 没钱：拒绝且不涨级
  CORE.state.coins = 0n;
  eq(CORE.buyNode('chain1'), false, '没钱买不了');
  eq(CORE.nodeLevel('chain1'), 0, '没钱不涨级');

  // 落盘：buyNode 内部 save，重新 boot 读得回
  const storage = makeStorage();
  const B = boot(storage);
  B.CORE.state.coins = 10n ** 7n;
  eq(B.CORE.buyNode('mine'), true, 'B 买 mine');
  eq(B.CORE.buyNode('settle1'), true, 'B 买结算 1 环');
  eq(B.CORE.buyNode('settle2'), true, 'B 再买结算 2 环');
  eq(B.CORE.buyNode('settle2'), false, 'B 重复买结算 2 环被拒（单级）');
  const R2 = boot(storage);
  eq(R2.CORE.state.talents.mine, 1, 'mine 写入存档');
  eq(R2.CORE.state.talents.settle2, 1, '结算 2 环写入存档');
  eq(R2.CORE.mods().damage, 1, '读回后 mods.damage 仍是 1');
  near(R2.CORE.mods().settleMul, Math.pow(1.08, 2), '读回后 settleMul = 1.08^2（两环相乘）');

  // resetTalents：逐级实付全额返还
  const T = boot(makeStorage());
  T.CORE.state.coins = 10n ** 7n;
  T.CORE.buyNode('mine');
  T.CORE.buyNode('atk1');
  T.CORE.buyNode('atk2');
  const left = T.CORE.state.coins;
  const refund = T.CORE.resetTalents();
  eq(refund.toString(), (10n ** 7n - left).toString(), 'resetTalents 返还 = 已花掉的全部金币（逐级累加实付价）');
  eq(T.CORE.state.coins, 10n ** 7n, '返还后金币回到买之前');
  eq(Object.keys(T.CORE.state.talents).length, 0, 'resetTalents 清空天赋等级');
  eq(T.CORE.mods().damage, 0, '返还后 mods.damage 回到 0');

  // v8：五项强化退休 → upgrade* 兼容别名是空操作（旧 08-ui / 09-main 调它不会炸）
  eq(CORE.upgradeLevel('pickDamage'), 0, 'upgradeLevel(退休强化) = 0');
  eq(CORE.upgradeCost('pickDamage'), 0n, 'upgradeCost(退休强化) = 0n');
  eq(CORE.buyUpgrade('pickDamage'), false, 'buyUpgrade(退休强化) = false');
  eq(Object.keys(CORE.state.upgrades).length, 0, 'state.upgrades 是空表（存档字段形状不变）');
  eq(CORE.upgradeLevel('atk1'), 0, '升级接口不认天赋节点（kind 不同）');
  eq(CORE.buyUpgrade('atk1'), false, 'buyUpgrade 不认天赋节点');
}

/* ---------------- 8. 存档 v7 ---------------- */
section('8 存档 v7：往返 / 旧档安全初始化 / 字段夹紧');
{
  const storage = makeStorage();
  const A = boot(storage);
  eq(A.CORE.state.version, 7, '新档版本号 7');
  eq(A.CORE.state.coins, 0n, '新档 0 金');
  eq(A.CORE.state.unlockedTools.join(','), 'wood', '新档只有木镐');
  eq(A.CORE.state.unlockedZones.join(','), 'quarry', '新档只有第一关');
  eq(A.CORE.state.roundsPlayed, 0, '新档 0 局');
  eq(A.CORE.state.selectedTool, 'wood', '新档选中木镐');
  eq(A.CORE.state.currentZone, 'quarry', '新档当前关 quarry');
  eq(A.CORE.state.bestRound.zoneId, 'quarry', '新档最佳局关 = quarry');
  eq(A.CORE.state.bestRound.coins, 0n, '新档最佳局金币 0');
  eq(A.CORE.state.muted, false, '新档未静音');
  for (const id in A.CONFIG.upgrades) eq(A.CORE.upgradeLevel(id), 0, '新档 ' + id + ' 0 级');
  for (const id of Object.keys(A.CONFIG.ores)) eq(A.CORE.state.lifetimeMined[id], 0, '新档累计 ' + id + ' = 0');

  // ---- 往返：写入 -> 重新 boot -> 读回 ----
  A.CORE.addCoins(123456n);
  A.CORE.unlockZone('blueIron');
  A.CORE.checkUnlocks();
  A.CORE.state.currentZone = 'blueIron';
  A.CORE.buyUpgrade('magnet');
  A.CORE.state.coins = 10n ** 9n;
  eq(A.CORE.buyTalent('mine'), true, '先买中心（一切节点的根）');
  const settleCost = A.CORE.talentCost('settle1');   // 购买前报价（链上每一环单独定价）
  eq(A.CORE.buyTalent('settle1'), true, '再买结算链第 1 环');
  A.CORE.state.lifetimeMined.coal = 77;
  A.CORE.state.roundsPlayed = 3;
  A.CORE.state.bestRound = { zoneId: 'blueIron', coins: 999n };
  A.CORE.setMuted(true);
  eq(A.CORE.save(), true, 'save() 返回 true');
  const raw = storage.getItem(A.CONFIG.saveKey);
  ok(raw !== null, '存档写在 blockminer.save.v7');
  const payload = JSON.parse(raw);
  eq(payload.version, 7, '载荷 version = 7');
  // 独立口径（不拿 state 自己比自己）：coins = 1e9 减去刚买的结算 1 环
  const expectCoins = 10n ** 9n - BigInt(A.CONFIG.tree.center.cost) - settleCost;
  eq(payload.coins, expectCoins.toString(), 'coins 以字符串存（bigint 不丢精度）= 1e9 - 中心 - 结算 1 环 = ' + expectCoins);
  eq(Object.keys(payload).sort().join(','),
    ['version', 'coins', 'lifetimeCoins', 'upgrades', 'talents', 'unlockedTools', 'selectedTool', 'currentZone',
      'unlockedZones', 'lifetimeMined', 'roundsPlayed', 'bestRound', 'muted', 'victory', 'victoryAt',
      'lastSavedAt'].sort().join(','),
    '存档字段集合完整（v6 加 victory / victoryAt）');
  const B = boot(storage);
  const S = B.CORE.state;
  eq(S.coins, expectCoins, '读回金币 = 1e9 - settle 那一级的价');
  eq(S.lifetimeCoins, S.coins, 'lifetimeCoins 不小于 coins');
  eq(Object.keys(S.upgrades).length, 0, '读回的强化表是空表（v8 五项强化已退休）');
  eq(S.talents.mine, 1, '读回中心等级');
  eq(S.talents.settle1, 1, '读回结算 1 环等级');
  eq(S.unlockedTools.join(','), 'wood,diamond', '读回工具（blueIron 的 enterUnlocks 是 diamond）');
  eq(S.unlockedZones.join(','), 'quarry,blueIron', '读回已解锁关');
  eq(S.currentZone, 'blueIron', '读回当前关');
  eq(S.selectedTool, 'diamond', '读回选中工具（进 blueIron 发的是 diamond，进关即自动换上）');
  eq(S.lifetimeMined.coal, 77, '读回累计矿量');
  eq(S.roundsPlayed, 3, '读回局数');
  eq(S.bestRound.zoneId, 'blueIron', '读回最佳局关');
  eq(S.bestRound.coins, 999n, '读回最佳局金币');
  eq(S.muted, true, '读回静音标记');
  ok(storage.getItem('blockminer.save.v6') === null, '只写 v7 key，不碰旧 key');
  eq(B.CORE.hasTool('diamond'), true, '读回后 hasTool(diamond)');
}

{
  // ---- 旧档（v6）安全初始化：整体重置，不迁移污染数值 ----
  const v6payload = JSON.stringify({
    version: 6, coins: '999999', lifetimeCoins: '999999',
    upgrades: { magnet: 3, pickDamage: 2 }, talents: { handle: 1 },
    unlockedTools: ['wood', 'diamond'], selectedTool: 'diamond',
    currentZone: 'ironmine', unlockedZones: ['quarry', 'ironmine'],
    lifetimeMined: { coal: 100, iron: 50 }, roundsPlayed: 9,
    bestRound: { zoneId: 'ironmine', coins: '5000' }, muted: true
  });
  const B = boot(makeStorage({ [BASE.CONFIG.saveKey]: v6payload }));
  const S = B.CORE.state;
  eq(S.version, 7, 'v6 载荷落到当前版本 7');
  eq(S.coins, 0n, 'v6 档的金币不迁移');
  eq(S.lifetimeCoins, 0n, 'v6 档的累计金币不迁移');
  eq(Object.keys(S.upgrades).length, 0, 'v6 档的强化等级不迁移（v8 的强化表是空的）');
  eq(Object.keys(S.talents).length, 0, 'v6 档的天赋不迁移');
  eq(S.unlockedTools.join(','), 'wood', 'v6 档的工具表重置为木镐');
  eq(S.selectedTool, 'wood', 'v6 档选中工具重置');
  eq(S.currentZone, 'quarry', 'v6 档未知关 ironmine 重置为 quarry');
  eq(S.unlockedZones.join(','), 'quarry', 'v6 档解锁关重置');
  eq(S.lifetimeMined.coal, 0, 'v6 档累计矿量不迁移');
  eq(S.roundsPlayed, 0, 'v6 档局数不迁移');
  eq(S.bestRound.zoneId, 'quarry', 'v6 档最佳局关重置');
  eq(S.muted, false, 'v6 档静音标记重置');

  const legacyStorage = makeStorage({ 'blockminer.save.v6': v6payload });
  const C = boot(legacyStorage);
  eq(C.CORE.state.version, 7, '只有旧 key 时也安全初始化到 v7');
  eq(C.CORE.state.coins, 0n, '只有旧 key 时金币为 0');
  eq(legacyStorage.getItem(BASE.CONFIG.saveKey), null, '启动不写新 key（只 load）');
  C.CORE.save();
  eq(legacyStorage.getItem(BASE.CONFIG.saveKey) !== null, true, '首次 save 才写 v7 key');
  eq(legacyStorage.getItem('blockminer.save.v6'), v6payload, '旧 key 原样保留，不删除用户数据');
}

{
  // ---- 字段夹紧：level 越界 / 未知工具 / 未知关 / 坏值 ----
  const payload = {
    version: 7, coins: '-5', lifetimeCoins: '-5',
    upgrades: { pickDamage: 99, magnet: -3, bag: 3.9, bogus: 4 },
    talents: { atk1: 99, chain1: -1, tntDrop1: 99, atk2: 0, unknown: 2 },
    unlockedTools: ['plasma', 'wood', 'wood', 'iron'], selectedTool: 'plasma',
    currentZone: 'atlantis', unlockedZones: ['atlantis', 'quarry'],
    lifetimeMined: { coal: -5, stone: 2.7, iron: '7' },
    roundsPlayed: -2, bestRound: { zoneId: 'atlantis', coins: '-1' },
    muted: 1, lastSavedAt: -9
  };
  const B = boot(makeStorage({ [BASE.CONFIG.saveKey]: JSON.stringify(payload) }));
  const S = B.CORE.state;
  eq(S.coins, 0n, '负金币夹到 0');
  eq(S.lifetimeCoins, 0n, '负累计金币夹到 0');
  eq(Object.keys(S.upgrades).length, 0, '退休强化的等级全部丢弃（v8 的 upgrades 是空表）');
  eq(S.talents.atk1, BASE.CONFIG.talents.atk1.maxLevel, '天赋等级越界夹到自己的 maxLevel（攻击 1 环 = 1）');
  eq(S.talents.chain1, 0, '负天赋等级夹到 0');
  eq(S.talents.tntDrop1, BASE.CONFIG.talents.tntDrop1.maxLevel, '单级天赋越界夹到自己的 maxLevel（TNT 掉落 1 环 = 1）');
  eq(S.talents.atk2, 0, '0 级照原样落成 0（不是购买）');
  eq(Object.prototype.hasOwnProperty.call(S.talents, 'unknown'), false, '未知天赋被丢弃');

  // v10 存档迁移：老档的「一个节点多级」按链展开（atk: 4 → atk1..atk4 各 1 级）
  const M = boot(makeStorage({ [BASE.CONFIG.saveKey]: JSON.stringify({
    version: 7, coins: '0',
    talents: { mine: 1, atk: 4, settle: 10, spd: 3, chain: 2, bogus: 5 }
  }) })).CORE.state;
  eq([M.talents.atk1, M.talents.atk2, M.talents.atk3, M.talents.atk4].join(','), '1,1,1,1', '旧档 atk: 4 → 攻击链前 4 环各 1 级');
  eq(M.talents.atk5, 0, '攻击链第 5 环没被解锁（只迁移已买的级数）');
  eq([M.talents.settle1, M.talents.settle10].join(','), '1,1', '旧档 settle: 10 → 结算链 10 环全买');
  eq([M.talents.spd1, M.talents.spd2, M.talents.spd3].join(','), '1,1,1', '旧档 spd: 3 → 攻速链前 3 环');
  eq([M.talents.chain1, M.talents.chain2].join(','), '1,1', '旧档 chain: 2 → 连锁链前 2 环');
  eq(Object.prototype.hasOwnProperty.call(M.talents, 'bogus'), false, '迁移只认已知链前缀，bogus 仍被丢弃');
  eq(M.talents.mine, 1, '中心节点照旧读回');
  eq(S.unlockedTools.join(','), 'wood,iron', '未知工具/重复工具被过滤');
  eq(S.selectedTool, 'wood', '未解锁的选中工具回落到木镐');
  eq(S.currentZone, 'quarry', '未知当前关回落到第一关');
  eq(S.unlockedZones.join(','), 'quarry', '未知解锁关被过滤');
  eq(S.lifetimeMined.stone, 2, '小数累计矿量向下取整');
  eq(S.lifetimeMined.coal, 0, '负累计矿量夹到 0');
  eq(S.lifetimeMined.iron, 0, '字符串累计矿量按坏值丢弃');
  eq(S.roundsPlayed, 0, '负局数夹到 0');
  eq(S.bestRound.zoneId, 'quarry', '未知最佳局关回落到当前关');
  eq(S.bestRound.coins, 0n, '负最佳局金币夹到 0');
  eq(S.muted, true, 'muted 转布尔');
  eq(S.lastSavedAt, 0, '负时间戳夹到 0');

  // lifetimeCoins 不得小于 coins
  const B2 = boot(makeStorage({
    [BASE.CONFIG.saveKey]: JSON.stringify({ version: 7, coins: '100', lifetimeCoins: '50' })
  }));
  eq(B2.CORE.state.coins, 100n, '读回 coins');
  eq(B2.CORE.state.lifetimeCoins, 100n, 'lifetimeCoins 被抬到不小于 coins');

  // 坏载荷一律安全初始化，不抛错
  for (const bad of ['{ 这不是 json', '"字符串"', 'null', '[]', '42', 'true']) {
    const Bx = boot(makeStorage({ [BASE.CONFIG.saveKey]: bad }));
    eq(Bx.CORE.state.coins, 0n, '坏载荷 ' + bad + ' 安全初始化');
    eq(Bx.CORE.state.selectedTool, 'wood', '坏载荷 ' + bad + ' 回到木镐');
  }
  // resetSave 清档
  const storage3 = makeStorage();
  const B3 = boot(storage3);
  B3.CORE.addCoins(500n);
  B3.CORE.save();
  B3.CORE.resetSave();
  eq(B3.CORE.state.coins, 0n, 'resetSave 清空金币');
  eq(JSON.parse(storage3.getItem(BASE.CONFIG.saveKey)).coins, '0', 'resetSave 立即落盘 0 金');
}

/* ---------------- 9. 结算与目标 ---------------- */
section('9 结算与目标：objective 进度 / nextZoneId 推进 / 最后一关为 null');
{
  const { CORE, CONFIG: C } = boot(makeStorage());
  const q = C.zones[0];
  const obj0 = CORE.nextObjective();
  eq(obj0.zoneId, q.id, 'nextObjective 回传当前关');
  eq(obj0.ore, q.objective.ore, 'nextObjective 目标矿种');
  eq(obj0.need, q.objective.need, 'nextObjective 目标数量');
  eq(obj0.have, 0, 'nextObjective 初始进度 0');
  eq(obj0.done, false, 'nextObjective 初始未完成');

  const r1 = CORE.settleRound({ zoneId: q.id, counts: { coal: 100 } });
  eq(r1.objective.ore, q.objective.ore, '结算回传 objective.ore');
  eq(r1.objective.need, q.objective.need, '结算回传 objective.need');
  eq(r1.objective.have, 100, '结算回传 objective.have = 累计进度');
  eq(r1.objective.done, false, '未达标 done=false');
  eq(r1.nextZoneId, q.nextZone, 'nextZoneId 是本关声明的下一关');
  eq(CORE.state.currentZone, q.id, '未达标不推进关卡');
  eq(r1.unlocked.join(','), '', '未达标不解锁新东西');

  const r2 = CORE.settleRound({ zoneId: q.id, counts: { coal: q.objective.need - 100 } });
  eq(r2.objective.have, q.objective.need, 'progress 累计到目标值');
  eq(r2.objective.done, true, '达到目标 done=true');
  eq(CORE.state.currentZone, q.nextZone, '达标后 currentZone 推进到下一关');
  ok(r2.unlocked.indexOf(q.nextZone) >= 0, '达标后 unlocked 里出现下一关');
  ok(r2.unlocked.indexOf(TOOL_IDS[1]) >= 0, '推进到第 2 关同时发放石镐（enterUnlocks）');
  eq(r2.nextZoneId, q.nextZone, 'nextZoneId 仍是本关的 nextZone');
  eq(CORE.nextObjective().zoneId, q.nextZone, 'nextObjective 跟着切到新关');

  // 每关的 nextZoneId 都等于该关声明的 nextZone，最后一关为 null
  for (const z of C.zones) {
    const res = CORE.settleRound({ zoneId: z.id, counts: { stone: 1 } });
    eq(String(res.nextZoneId), String(z.nextZone), z.id + ' 结算回传 nextZoneId');
    eq(res.coinMul, z.coinMul, z.id + ' 结算回传 coinMul');
  }
  eq(String(CORE.settleRound({ zoneId: 'lavaEdge', counts: {} }).nextZoneId), 'null', '最后一关 nextZoneId 为 null');

  // 最后一关达标：不越界、不崩溃
  const B2 = boot(makeStorage());
  B2.CORE.state.currentZone = 'lavaEdge';
  B2.CORE.unlockZone('lavaEdge');
  B2.CORE.checkUnlocks(); // 先走一遍进入解锁，确保核心钻机已在手里
  B2.CORE.state.lifetimeMined.crystal = C.zones[3].objective.need;
  const rf = B2.CORE.settleRound({ zoneId: 'lavaEdge', counts: { crystal: 5 } });
  eq(rf.objective.done, true, '最后一关目标达成');
  eq(String(rf.nextZoneId), 'null', '最后一关 nextZoneId = null');
  eq(B2.CORE.state.currentZone, 'lavaEdge', '最后一关达标后仍停在 coreHeart');
  eq(rf.unlocked.join(','), '', '最后一关没有新工具/新关可解锁');

  // 结算回传的统计字段与 bestRound
  const B3 = boot(makeStorage());
  const rs = B3.CORE.settleRound({ zoneId: 'quarry', counts: { coal: 10 }, brokenBlocks: 12, maxCombo: 30, explosions: 1, maxChain: 4 });
  eq(rs.stats.brokenBlocks, 12, 'stats.brokenBlocks 回传');
  eq(rs.stats.maxCombo, 30, 'stats.maxCombo 回传');
  eq(rs.stats.explosions, 1, 'stats.explosions 回传');
  eq(rs.stats.maxChain, 4, 'stats.maxChain 回传');
  eq(B3.CORE.state.bestRound.zoneId, 'quarry', 'bestRound.zoneId 记录本局');
  eq(B3.CORE.state.bestRound.coins, rs.coinsEarned, 'bestRound.coins 记录本局收入');
  eq(rs.coinsTotal, rs.coinsEarned, '首局 coinsTotal = 本局收入');
  eq(rs.counts.stone, 0, 'counts 补齐全部矿种（未挖为 0）');
}

/* ---------------- 10. 边界 ---------------- */
section('10 边界：空 counts / 全 0 / 坏计数 / 超大数量（bigint 不丢精度）');
{
  const { CORE, CONFIG: C } = boot(makeStorage());
  const before = CORE.state.coins;
  const r0 = CORE.settleRound({ zoneId: 'lavaEdge', counts: {} });
  eq(r0.coinsEarned, '0', '空 counts 不产出金币（哪怕在最高倍率关）');
  eq(r0.coinMul, C.zones[3].coinMul, '空 counts 仍回传 coinMul');
  eq(r0.lines.length, 0, '空 counts 没有明细行');
  eq(CORE.state.coins, before, '空 counts 不改金币');
  eq(CORE.state.roundsPlayed, 1, '空 counts 仍记一局');
  eq(r0.objective.have, 0, '空 counts 目标进度 0');
  for (const id of Object.keys(C.ores)) eq(CORE.state.lifetimeMined[id], 0, '空 counts 不改累计 ' + id);

  const rz = CORE.settleRound({ zoneId: 'quarry', counts: { stone: 0, coal: 0, iron: 0, crystal: 0 } });
  eq(rz.coinsEarned, '0', '全 0 counts 不产出金币');
  eq(rz.lines.length, 0, '全 0 counts 没有明细行');
  eq(CORE.state.coins, before, '全 0 counts 不改金币');

  const rbad = CORE.settleRound({ zoneId: 'quarry', counts: { coal: '7', stone: -3, iron: NaN, crystal: 1.9, copper: 5 } });
  eq(rbad.coinsEarned, (BigInt(C.ores.crystal.price) * 1n * BigInt(C.zones[0].coinMul)).toString(), '坏计数被夹紧（字符串/负数/NaN 记 0，小数取整，未知矿种忽略）');
  eq(rbad.counts.coal, 0, '字符串计数被丢弃');
  eq(rbad.counts.stone, 0, '负计数夹到 0');
  eq(rbad.counts.iron, 0, 'NaN 计数记 0');
  eq(rbad.counts.crystal, 1, '小数计数向下取整');
  eq(Object.prototype.hasOwnProperty.call(rbad.counts, 'copper'), false, '未知矿种不进入 counts');

  // 超大数量：1e9 颗晶石 × 400 金 × 15000 倍 = 6e15，必须一位不差
  const B2 = boot(makeStorage());
  const big = 1000000000n;
  const rh = B2.CORE.settleRound({ zoneId: 'lavaEdge', counts: { crystal: Number(big) } });
  const expectBig = big * BigInt(C.ores.crystal.price) * BigInt(C.zones[3].coinMul);
  eq(rh.coinsEarned, expectBig.toString(), '1e9 颗晶石在地心核心的结算精确（' + expectBig.toString() + '）');
  eq(B2.CORE.state.coins, expectBig, '金币以 bigint 保存，无精度损失');
  eq(String(B2.CORE.state.coins), expectBig.toString(), '超大金币没有被转成指数记法');
  eq(rh.coinsTotal, expectBig.toString(), 'coinsTotal 字符串精确');
  eq(B2.CORE.state.lifetimeMined.crystal, Number(big), '累计矿量精确记录到上限');

  // 计数上限：超过 MAX_COUNT 的部分不再计入（与恰好 MAX_COUNT 等价）
  const B3 = boot(makeStorage());
  const rOver = B3.CORE.settleRound({ zoneId: 'quarry', counts: { stone: Number(MAX_COUNT) * 5 } });
  const B4 = boot(makeStorage());
  const rCap = B4.CORE.settleRound({ zoneId: 'quarry', counts: { stone: Number(MAX_COUNT) } });
  eq(rOver.coinsEarned, rCap.coinsEarned, '超出计数上限被夹紧，与上限值等价');
  eq(rCap.coinsEarned, (MAX_COUNT * BigInt(C.ores.stone.price) * BigInt(C.zones[0].coinMul)).toString(), '计数上限结算精确');

  // addCoins / fmt 的 bigint 精度
  const B5 = boot(makeStorage());
  const huge = 123456789012345678901234567890n;
  B5.CORE.addCoins(huge);
  eq(B5.CORE.state.coins, huge, 'addCoins 保留 30 位大整数');
  eq(B5.CORE.state.lifetimeCoins, huge, 'lifetimeCoins 同步');
  eq(B5.CORE.fmt(huge), '123,456,789,012,345,678,901,234,567,890', 'fmt 千分位精确');
  eq(B5.CORE.fmt(0n), '0', 'fmt(0)');
  eq(B5.CORE.canAfford(huge), true, 'canAfford 大额');
  eq(B5.CORE.canAfford(huge + 1n), false, 'canAfford 刚好不够');
  eq(B5.CORE.spendCoins(huge + 1n), false, 'spendCoins 不足时拒绝');
  eq(B5.CORE.state.coins, huge, '拒绝后金币不变');
  eq(B5.CORE.spendCoins(1n), true, 'spendCoins 正常扣款');
  eq(B5.CORE.state.coins, huge - 1n, '扣款精确');
}

/* ---------------- 11. 价格量级 ---------------- */
section('11 价格量级：整棵树 73 个节点的总价，与一次通关的累计收入同量级');
{
  const { CONFIG: C } = boot(makeStorage());
  let total = 0n;          // 有限树（73 个一次性节点）
  let longTotal = 0n;      // 长尾节点 deepLayer（999 级，单独算）
  const perDepth = {};
  for (const n of ALL_NODES) {
    let sum = 0n;
    for (let lv = 0; lv < n.maxLevel; lv++) sum += priceAt(n, lv);
    if (n.maxLevel > 1) { longTotal += sum; continue; }
    total += sum;
    perDepth[n.depth] = (perDepth[n.depth] || 0n) + sum;
  }
  console.log('  NOTE: 有限树 73 个节点合计 ' + total + ' 金 · 分深度 = ' +
    Object.keys(perDepth).sort(function (a, b) { return a - b; }).map(function (d) { return 'd' + d + ':' + perDepth[d]; }).join(' '));
  // 长尾节点单算：300 × (1+2+…+999) = 300 × 499500 = 149,850,000 —— 它是无尽深水区，不进「与累计收入同量级」那条判据。
  eq(longTotal.toString(), '149850000', 'deepLayer 999 级总价 = 300 × (1+…+999) = 149,850,000（长尾，单独结算）');
  // v13：depthMul 抬到 2.6^(d-1) 之后整树 ≈6,000 万，与 progression 实测累计收入 66.9M 同量级
  // （买得完、但一局买不快：实测单局最多 4 个）。区间 40M–90M 是「同量级」的硬边界。
  ok(total > 40000000n && total < 90000000n, '总价 ' + total + ' 落在 40M–90M（progression 实测累计收入 ≈66.9M，同量级）');
  const RUN_INCOME = 66932561;
  const drift = total - BigInt(RUN_INCOME);
  const driftPct = Math.abs(Number(drift)) / RUN_INCOME * 100;
  ok(driftPct <= 25, '整树总价 ' + total + ' 与实测通关累计收入 ' + RUN_INCOME +
    ' 相差 ' + driftPct.toFixed(2) + '%（判据 ±25%）');
  // 深度越深，该层最便宜的首级价越高（1/2/4/…/323 真的在当倍率用）
  const minFirst = {};
  for (const n of ALL_NODES) {
    const p = Number(priceAt(n, 0));
    if (minFirst[n.depth] === undefined || p < minFirst[n.depth]) minFirst[n.depth] = p;
  }
  for (let d = 1; d <= 10; d++) {
    ok(minFirst[d] > minFirst[d - 1], '深度 ' + d + ' 的最便宜首级价 ' + minFirst[d] + ' > 深度 ' + (d - 1) + ' 的 ' + minFirst[d - 1]);
  }
  // 六条根链的入口：v16 的报价逐个钉死（都在「第 1–2 关买得起」的千元档以内）
  // 首环价 = round(baseCost × 0.65) × depthMul[1]：atk 900 / settle 750 / tntDrop 150 / tntPierce 600 / chain 90 / deepLayer 300（线性首级）。
  const entry = C.tree.nodes.filter(function (n) { return n.parent === 'mine'; });
  eq(entry.length, 6, '根链入口正好 6 个（每条 lane 一个链头，含 deepLayer）');
  ok(Number(priceAt(C.talents.oreRate1, 0)) === 2400, 'oreRate1 是侧链入口（挂 settle1，深度 2）→ 800 × 3 = 2400');
  eq(entry.map(function (n) { return n.id + ':' + priceAt(n, 0); }).join(' '),
    'atk1:585 settle1:488 tntDrop1:290 tntPierce1:390 chain1:59 deepLayer:300',
    '六个根链入口的首级价逐个钉死（该档 = round(baseCost × 0.65) × depthMul[1]）');
  for (const n of entry) {
    const p = Number(priceAt(n, 0));
    ok(p > 0 && p <= 1000, n.id + ' 的首级价 ' + p + ' 是正数且 ≤1000（第 1–2 关买得起的千元档）');
  }
}

/* ---------------- 12. 中心节点与数据自洽 ---------------- */
section('12 中心 mine 首局可买 + v10 数据自洽（无死节点 / 链内价单调 / 合计节点数）');
{
  const { CORE, CONFIG: C } = boot(makeStorage());
  // progression 实测采石场首局收入 128–392 金（coinMul 8）；保守取 40 兜住最差种子
  const FIRST_INCOME_MIN = 40;
  ok(C.tree.center.cost >= 10 && C.tree.center.cost <= FIRST_INCOME_MIN,
    '中心价 ' + C.tree.center.cost + ' 落在 10–' + FIRST_INCOME_MIN + '（首局最差收入以下，第一局结束必买得起）');
  const F = boot(makeStorage());
  F.CORE.addCoins(BigInt(FIRST_INCOME_MIN));
  eq(F.CORE.canAfford(F.CORE.nodeCost('mine')), true, '首局收入 ' + FIRST_INCOME_MIN + ' 买得起中心节点');
  eq(F.CORE.buyNode('mine'), true, '首局结束就能点下中心节点');
  eq(F.CORE.state.coins.toString(), String(FIRST_INCOME_MIN - C.tree.center.cost), '买完还剩 ' + (FIRST_INCOME_MIN - C.tree.center.cost) + ' 金');
  eq(F.CORE.mods().damage, 1, '买完中心 → 所有武器伤害 +1');
  eq(F.CORE.toolDamage('wood'), C.tools.wood.dmg + 1, '木镐 1 → 2');

  // 没有孤儿节点，也没有「白送」的节点：除中心外每个节点的首级价 > 0 且父节点在索引里
  for (const n of C.tree.nodes) {
    ok(Number(CORE.nodeCost(n.id)) > 0, n.id + ' 的首级价是正数（不是白送）');
    ok(n.parent === 'mine' || !!C.talents[n.parent], n.id + ' 的父节点可解析');
    ok(n.depth >= 1 && n.depth <= 10, n.id + ' 的深度在 1..10（depthMul 十档，超出取末位）');
  }
  // 链上每一环都比上一环贵（链内单调，见 §5.3 的比值检查）
  for (const prefix of ['atk', 'exec', 'spd', 'settle', 'ore', 'oreRate', 'tntDrop', 'tntDmg', 'tntPierce', 'chain']) {
    let prev = 0n;
    for (let i = 1; ; i++) {
      const n = C.talents[prefix + i];
      if (!n) break;
      const p = priceAt(n, 0);
      ok(p > prev, prefix + i + ' 报价 ' + p + ' 高于链上前一环 ' + prev);
      prev = p;
    }
  }
  // 白名单与 CONFIG 的联动：CONFIG.tnt 的 cap 必须装得下链长
  const tntPierce = Object.keys(C.talents).filter(function (id) { return /^tntPierce\d+$/.test(id); }).length;
  eq(tntPierce, 2, 'TNT 穿透链 2 环（v14：3 环 → 2 环，满穿透 2 + 2 = 4）');
  eq(Object.keys(C.talents).filter(function (id) { return /^tntRange\d+$/.test(id); }).length, 0, 'TNT 范围链已随放置 TNT 一起删除');
  eq(C.tnt.layerPierce + tntPierce, C.tnt.pierceCap, 'CONFIG.tnt.pierceCap 恰好 = 2 + ' + tntPierce + ' 环（满链正好吃满）');
  eq(C.tnt.maxCap, undefined, 'CONFIG.tnt.maxCap 已删除（放置 TNT 的每局上限）');
  eq(C.tnt.radiusCap, undefined, 'CONFIG.tnt.radiusCap 已删除（半径天赋已删）');
}
/* ---------------- 13. 逐节点死键检查（82 行表） ---------------- */
section('13 逐节点死键检查：每个节点单独买 1 级（父链先置满）→ mods 对应字段必须变化');
{
  const { CORE, CONFIG: C } = boot(makeStorage());
  const KEYS = CORE.modKeys();
  const WHITE = KEYS.add.concat(KEYS.mul);
  // 链前缀 → 这个节点动到的活键（mine 单独算）
  const KEY_OF = {
    atk: 'damage', exec: 'execThreshold', spd: 'holdIntervalMul', settle: 'settleMul',
    ore: 'dropFlat', tntDrop: 'luckyTNTChance', tntDmg: 'tntDamageMul', tntPierce: 'tntLayerPierce',
    chain: 'chainCells',
    oreRate: 'oreRateBonus', deepLayer: 'extraLayers'
  };
  const fmtN = function (v) { return (Math.round(v * 1e6) / 1e6).toString(); };
  const pad = function (s, n) { s = String(s); while (s.length < n) s += ' '; return s; };
  const padL = function (s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; };

  const rows = [];
  let spent = 0n;
  for (const n of ALL_NODES) {
    const key = n.id === 'mine' ? 'damage' : KEY_OF[String(n.id).replace(/[0-9]+$/, '')];
    ok(!!key && WHITE.indexOf(key) >= 0, n.id + ' 的活键 ' + key + ' 在 mods 白名单里');

    // 父链先置满：从 mine 一路到 n.parent
    const chainIds = [];
    let cur = n.parent;
    let guard = 0;
    while (cur && guard++ < 64) { chainIds.push(cur); cur = (cur === 'mine' ? null : C.talents[cur].parent); }
    CORE.state.talents = {};
    for (const id of chainIds) CORE.state.talents[id] = 1;

    const price = CORE.nodeCost(n.id);
    eq(CORE.nodeState(n.id), 'available', n.id + ' 在父链置满后可买（' + chainIds.length + ' 个前置）');
    const before = CORE.mods()[key];
    CORE.state.coins = 10n ** 12n;
    const bought = CORE.buyNode(n.id);
    const after = CORE.mods()[key];
    const spentNow = 10n ** 12n - CORE.state.coins;
    spent += spentNow;

    ok(bought === true, n.id + ' 买得下来（' + price + ' 金）');
    eq(spentNow, price, n.id + ' 实付 = nodeCost');
    ok(after !== before, n.id + ' 买 1 级后 mods.' + key + ' 真的变了（' + fmtN(before) + ' → ' + fmtN(after) + '，不是死键）');
    eq(CORE.nodeState(n.id), n.maxLevel > 1 ? 'available' : 'owned',
      n.id + ' 买完状态 = ' + (n.maxLevel > 1 ? 'available（还剩 998 级可买）' : 'owned（单级节点）'));
    rows.push({
      id: n.id, name: n.name, depth: n.depth, price: price.toString(), key: key,
      before: fmtN(before), after: fmtN(after), delta: fmtN(after - before), name2: n.name
    });
    CORE.state.talents = {};
  }

  // 74 行一张表（id / 名称 / 深度 / 价格 / 活键 / 买前 → 买后 / Δ）
  console.log('  ┌────┬────────────┬──────┬──────────────┬──────────────────┬────────────────────┬──────────────┐');
  console.log('  │ #  │ 节点       │ 深度 │ 价格         │ 活键             │ 买前 → 买后        │ Δ            │');
  console.log('  ├────┼────────────┼──────┼──────────────┼──────────────────┼────────────────────┼──────────────┤');
  rows.forEach(function (r, i) {
    console.log('  │ ' + padL(i + 1, 2) + ' │ ' + pad(r.id, 10) + ' │ ' + padL(r.depth, 4) + ' │ ' +
      padL(Number(r.price).toLocaleString('en-US'), 12) + ' │ ' + pad(r.key, 16) + ' │ ' +
      pad(r.before + ' → ' + r.after, 18) + ' │ ' + pad((Number(r.delta) > 0 ? '+' : '') + r.delta, 12) + ' │');
  });
  console.log('  └────┴────────────┴──────┴──────────────┴──────────────────┴────────────────────┴──────────────┘');

  eq(rows.length, 76, '死键检查覆盖全部 76 个节点（中心 1 + 链上 74 + 长尾 deepLayer）');
  // 逐节点买一遍 = Σ 首级价（每个节点只买 1 级；deepLayer 首级 300）。逐节点的单价已由 §5.3 精确钉死，
  // 这里只需要「实付合计 = 首级价合计」，避免把一张还在被设计侧调价的快照写成魔数。
  let wantSpent = 0n;
  for (const n of ALL_NODES) wantSpent += priceAt(n, 0);
  eq(spent.toString(), wantSpent.toString(), '逐节点买一遍的实付合计 = Σ 首级价 ' + wantSpent + ' 金（含 deepLayer 首级 300）');
  ok(rows.every(function (r) { return r.before !== r.after; }), '76 个节点没有一个是死键（每个都改到了 mods）');
  CORE.state.talents = {};
  eq(CORE.mods().damage, 0, '收尾清空天赋 → mods.damage 回到 0');
}

console.log('');
console.log('通过 ' + R.pass + ' 项 / 失败 ' + R.fail + ' 项');
process.exit(R.fail ? 1 : 0);
