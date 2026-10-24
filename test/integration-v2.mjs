import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');
const noop = () => {};
const grad = { addColorStop: noop };
function makeCtx() {
  return new Proxy({
    canvas: { width: 390, height: 844 },
    createLinearGradient: () => grad, createRadialGradient: () => grad,
    createPattern: () => null, measureText: () => ({ width: 8 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)) }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)), width: w, height: h })
  }, { get: (t, p) => (p in t ? t[p] : (typeof p === 'string' ? noop : undefined)), set: () => true });
}
const ctx = makeCtx();
const mkCanvas = () => ({ width: 390, height: 844, style: {}, getContext: () => ctx, addEventListener: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 }), appendChild: noop, setPointerCapture: noop, classList: { add: noop, remove: noop, toggle: noop, contains: () => false } });
const store = new Map();
const sb = {
  console, performance: { now: () => 0 }, devicePixelRatio: 1,
  localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  location: { hash: '' }, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: noop,
  document: { createElement: t => (t === 'canvas' ? mkCanvas() : mkCanvas()), getElementById: id => (id === 'stage' ? mkCanvas() : null), querySelector: () => null, addEventListener: noop, head: { appendChild: noop }, body: { appendChild: noop } }
};
sb.window = sb; sb.globalThis = sb;
const c = vm.createContext(sb);
const files = ['01-config', '02-core', '03-grid', '04-tools', '05-drops', '06-fx', '07-audio'];
for (const f of files) {
  try { vm.runInContext(readFileSync(join(srcDir, f + '.js'), 'utf8'), c, { filename: f }); }
  catch (e) { console.error('LOAD FAIL ' + f + ': ' + e.message); process.exit(1); }
}
const BM = sb.BM;
const fail = [];
const ok = (cond, msg) => { if (!cond) fail.push(msg); };

ok(!!BM.CONFIG.ores.stone && !!BM.CONFIG.ores.coal && !!BM.CONFIG.ores.iron, 'CONFIG 缺 stone/coal/iron');
ok(BM.CONFIG.ores.stone.price === 1 && BM.CONFIG.ores.coal.price === 6 && BM.CONFIG.ores.iron.price === 40, '矿价不符 1/6/40');
ok(Object.keys(BM.CONFIG.tools).join(',') === 'wood,iron,diamond,laser' &&
  BM.CONFIG.tools.wood.dmg === 1 && BM.CONFIG.tools.iron.dmg === 3 &&
  BM.CONFIG.tools.diamond.dmg === 10 && BM.CONFIG.tools.laser.dmg === 8,
  '工具表不是 wood/iron/diamond/laser 1/3/10/8（实际 ' + Object.keys(BM.CONFIG.tools).join(',') + '）');
// 树的形状按 v16「一条链上的多个单级节点」钉死：中心 mine + 73 个天赋节点（10 条链 + 999 级的 deepLayer）、6 条 lane，
// 六把武器与只挂在它们下面的 diaRange/laserCol/quakeSpd 已整批删除（武器到下一关自动解锁）。
// 断言口径从「写死 12 个 id」改成「10 条链 × 各自链长 + deepLayer，除 deepLayer 外全部 maxLevel = 1」——节点变多也不会漏检。
const tree = BM.CONFIG.tree || {};
const talents = BM.CONFIG.talents || {};
const CHAIN_LEN = { atk: 10, exec: 3, spd: 8, settle: 10, ore: 5, tntDrop: 8, tntDmg: 8, tntPierce: 2, chain: 10, oreRate: 8 };
const TREE_IDS = ['mine', 'deepLayer'];
Object.keys(CHAIN_LEN).forEach((prefix) => {
  for (let i = 1; i <= CHAIN_LEN[prefix]; i += 1) TREE_IDS.push(prefix + i);
});
ok(Object.keys(talents).slice().sort().join(',') === TREE_IDS.slice().sort().join(','),
  '节点表 = 中心 mine + 73 个天赋节点（10 条链 + deepLayer，实际 ' + Object.keys(talents).length + ' 个）');
ok(Object.keys(talents).every((id) => (id === 'mine') ? true
  : (id === 'deepLayer' ? talents[id].maxLevel === 999 : talents[id].maxLevel === 1)),
  '每个天赋节点都是单级（maxLevel = 1），只有 deepLayer 是 999 级长尾节点');
ok(!!tree.center && tree.center.id === 'mine', '中心节点 = mine（开始挖矿）');
ok(Array.isArray(tree.nodes) && tree.nodes.length === 73, 'tree.nodes = 73（实际 ' + (tree.nodes || []).length + '）');
ok((tree.lanes || []).map(l => l.id).join(',') === 'power,settle,tntDrop,tnt,chain,deep',
  '6 条分支（含 deep 矿层枝）、武器分支已删（实际 ' + (tree.lanes || []).map(l => l.id).join(',') + '）');
const LANE_IDS = new Set((tree.lanes || []).map(l => l.id));
ok((tree.nodes || []).every(n => LANE_IDS.has(n.lane)), '每个节点都挂在现存 lane 上');
ok((tree.nodes || []).every(n => !n.unlocksTool), '武器不进天赋树：没有任何 unlocksTool 节点');
ok(Object.keys(BM.CONFIG.upgrades || {}).length === 0, 'v8 没有强化面板（upgrades 空表）');

BM.CORE.load();
BM.GRID.init(ctx, BM.BOARD); BM.DROPS.init(); BM.FX.init(); BM.TOOLS.init(ctx);
const zone = BM.CONFIG.zones[0];
BM.TOOLS.setZone(zone); BM.GRID.build(zone);

const cells = BM.GRID.flat.filter(b => !b.broken);
ok(cells.length === 48, '应有 48 格存活（实际 ' + cells.length + '）');
const layerVals = cells.map(b => b.totalLayers);
ok(layerVals.every(v => v >= 8 && v <= 10), 'totalLayers 不在 8..10: ' + [...new Set(layerVals)].join(','));

const ev = { layer: 0, empty: 0, emptyFx: 0 };
BM.bus.on('block:layer', () => ev.layer++);
BM.bus.on('block:empty', () => ev.empty++);

let t = 0; const dt = 1 / 60;
const target = cells[0];
// 节拍：点按与按住共用 tool.interval（04-tools 的单一节拍）。木镐 interval = 0.4（2 秒 5 下），
// 比本文件原先假设的「每 6 帧一发」慢 4 倍，所以这里每帧都尝试、由 cd 自己丢点击，
// 并把时长放到 50 秒 —— 石头一格 4 点伤害 × 6–8 层要 ~30 击才挖穿。
for (let i = 0; i < 3000 && !target.broken; i++) {
  t += dt;
  BM.GRID.update(dt); BM.DROPS.update(dt); BM.TOOLS.update(dt, t); BM.FX.update(dt);
  BM.TOOLS.attack('wood', target.x + target.s / 2, target.y + target.s / 2, { now: t });
}
ok(ev.layer >= 5, '打穿多层应派发 block:layer（实际 ' + ev.layer + '）');
ok(target.broken && target.layers === 0, '应能整格挖空');
ok(ev.empty >= 1, '挖空应派发 block:empty');

BM.DROPS.absorbAll();
for (let i = 0; i < 90; i++) BM.DROPS.update(dt);
const counts = BM.DROPS.counts;
const total = Object.values(counts).reduce((a, b) => a + b, 0);
ok(total > 0, '掉落总量应 > 0');
const money = Object.entries(counts).reduce((s, [ore, n]) => s + n * (BM.CONFIG.ores[ore] ? BM.CONFIG.ores[ore].price : 0), 0);
console.log('counts=' + JSON.stringify(counts) + ' 折算金币=' + money + ' block:layer=' + ev.layer + ' block:empty=' + ev.empty);

BM.GRID.build(zone);
const alive = BM.GRID.flat.filter(b => !b.broken);
ok(typeof BM.GRID.damageLayers === 'function', '缺 GRID.damageLayers（TNT 依赖）');
if (typeof BM.GRID.damageLayers === 'function') {
  const cell = alive[0];
  const before = cell.layers;
  const res = BM.GRID.damageLayers(cell, 6, 3);
  ok(before - cell.layers >= 1, 'damageLayers 应打穿多层');
  const pierced = before - cell.layers;
  ok(pierced <= 3, 'damageLayers 穿透超过 3 层：' + pierced);
  console.log('damageLayers 穿透=' + pierced + ' 剩余层=' + cell.layers);
}
ok(typeof BM.GRID.isEmpty === 'function', '缺 GRID.isEmpty');

const result = BM.CORE.settleRound({ zoneId: zone.id, counts: { ...counts }, brokenBlocks: 1, maxCombo: 3, explosions: 0, maxChain: 0, timeLeft: 0 });
ok(result && BigInt(result.coinsEarned) > 0n, '结算金币应 > 0');
console.log('settle coinsEarned=' + result.coinsEarned + ' total=' + result.coinsTotal + ' unlocked=' + JSON.stringify(result.unlocked));

console.log(fail.length ? ('FAIL:\n - ' + fail.join('\n - ')) : 'PASS: v2 全链路（层叠/挖空/TNT/结算）打通');
process.exit(fail.length ? 1 : 0);
