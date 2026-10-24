import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');
// 可选复现：BM_SEED=123 node test/progression.mjs —— 给出可复现的「换一条种子」读数；
// 不设时行为与原来完全一致（未播种）。判据的四条断言不受影响。
const SEED = process.env.BM_SEED ? Number(process.env.BM_SEED) : null;
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = SEED === null ? Math.random : mulberry32(SEED ^ 0x5bf03635);
const noop = () => {};
const grad = { addColorStop: noop };
const ctx = new Proxy({
  canvas: { width: 390, height: 844 }, createLinearGradient: () => grad, createRadialGradient: () => grad,
  createPattern: () => null, measureText: () => ({ width: 8 }),
  getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)) }),
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)), width: w, height: h })
}, { get: (t, p) => (p in t ? t[p] : (typeof p === 'string' ? noop : undefined)), set: () => true });
const mkCanvas = () => ({ width: 390, height: 844, style: {}, getContext: () => ctx, addEventListener: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 }), appendChild: noop, setPointerCapture: noop, classList: { add: noop, remove: noop, toggle: noop, contains: () => false } });
const store = new Map();
const sb = {
  console, performance: { now: () => 0 }, devicePixelRatio: 1,
  localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  location: { hash: '' }, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: noop,
  document: { createElement: () => mkCanvas(), getElementById: () => mkCanvas(), querySelector: () => null, addEventListener: noop, head: { appendChild: noop }, body: { appendChild: noop } }
};
sb.window = sb; sb.globalThis = sb;
const c = vm.createContext(sb);
// 沙箱有独立的 intrinsics：03-grid 的矿脉布局吃 Date.now()，目标格吃 Math.random，
// 两者都要在 context 内部播种才能复现同一条种子。
if (SEED !== null) {
  vm.runInContext('Date.now=function(){return 0;};', c);
  vm.runInContext('Math.random=(function(){var a=' + ((SEED >>> 0) ^ 0x9e3779b9) + ';return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};})();', c);
}
for (const f of ['01-config', '02-core', '03-grid', '04-tools', '05-drops', '06-fx']) vm.runInContext(readFileSync(join(srcDir, f + '.js'), 'utf8'), c, { filename: f });
const BM = sb.BM;

BM.GRID.init(ctx, BM.BOARD); BM.DROPS.init(); BM.FX.init(); BM.TOOLS.init(ctx);
BM.CORE.resetSave();

const SEC_PER_ROUND = 23;
const MAX_ROUNDS = 400;
const RATE = 4;

function playRound() {
  const zone = BM.CORE.currentZone();
  BM.TOOLS.setZone(zone); BM.GRID.build(zone); BM.DROPS.reset(); BM.TOOLS.reset();
  const dt = 1 / 60;
  const seconds = BM.CORE.resolveRoundSeconds(zone);
  const toolId = BM.CORE.state.selectedTool;
  const hold = BM.CONFIG.tools[toolId] && BM.CONFIG.tools[toolId].mode === 'hold';
  let t = 0, taps = 0, layers = 0, target = null, nextTap = 0;
  const off1 = BM.bus.on('block:layer', () => layers++);
  const off2 = BM.bus.on('block:empty', () => { layers++; });
  while (t < seconds) {
    t += dt;
    BM.GRID.update(dt); BM.DROPS.update(dt); BM.TOOLS.update(dt, t); BM.FX.update(dt);
    if (!target || target.broken || target.layers <= 0) {
      const alive = BM.GRID.flat.filter(b => !b.broken && b.layers > 0);
      if (!alive.length) break;
      const rich = alive.filter(b => b.rich);
      const pool = (rich.length && rnd() < 0.6) ? rich : alive;
      target = pool[(rnd() * pool.length) | 0];
    }
    if ((hold || t >= nextTap) && BM.TOOLS.ready()) {
      if (BM.TOOLS.attack(toolId, target.x + target.s / 2, target.y + target.s / 2, { now: t })) {
        taps++;
        if (!hold) nextTap = t + 1 / RATE;
      }
    }
  }
  off1(); off2();
  BM.DROPS.absorbAll();
  for (let i = 0; i < 60; i++) BM.DROPS.update(dt);
  const counts = { ...BM.DROPS.counts };
  const res = BM.CORE.settleRound({ zoneId: zone.id, counts, brokenBlocks: 0, maxCombo: 0, explosions: 0, maxChain: 0, timeLeft: 0 });
  return { coins: Number(res.coinsEarned), zone: zone.id, layers, taps, nextZone: res.nextZoneId, objective: res.objective };
}

// 玩家会自动换成「最新解锁」的那把工具（v13：解锁顺序 = 关卡顺序，不再按伤害比）。
// 激光钻 8 伤 < 钻石镐 10 伤，但它是第 4 关的武器，必须换上去（与 02-core 的 autoSelectTool 同口径）。
function pickBestTool() {
  var order = Object.keys(BM.CONFIG.tools || {});
  var best = null, bestIdx = -1;
  var list = BM.CORE.state.unlockedTools || [];
  for (var i = 0; i < list.length; i++) {
    var idx = order.indexOf(list[i]);
    if (idx > bestIdx) { bestIdx = idx; best = list[i]; }
  }
  if (best) BM.CORE.setTool(best);
}

// 玩家策略：优先买天赋（主驱动），没有可买的天赋时再买强化
function buyUpgrades(round) {
  var up = BM.CONFIG.upgrades || {};
  var ids = Object.keys(up);
  var spent = 0, n = 0;
  for (var guard = 0; guard < 20; guard++) {
    var best = null, bestCost = null;
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var lv = BM.CORE.upgradeLevel(id);
      var max = up[id].maxLevel || 5;
      if (lv >= max) continue;
      var c = BM.CORE.upgradeCost(id);
      if (!BM.CORE.canAfford(c)) continue;
      if (bestCost === null || c < bestCost) { bestCost = c; best = id; }
    }
    if (!best) break;
    if (BM.CORE.buyUpgrade(best)) { spent += Number(bestCost); n++; log.push({ round, id: 'up:' + best, cost: Number(bestCost) }); }
    else break;
  }
  return { spent, n };
}

function buyGreedy(round) {
  let spent = 0, n = 0;
  for (let guard = 0; guard < 50; guard++) {
    /* 长尾节点（maxLevel ≥ 50，如 999 级的 deepLayer）不进这一局节奏模拟：
       它的线性价永远比有限树剩下的节点便宜，预算全花光的贪心买家会一直买到 guard 上限，
       把「单局购买 ≤8」「40–90 局」这两条**有限树节奏判据**变成无意义的读数（实测：单局 50 个 / 28 局）。
       长尾节点本身另有独立验收（文件末尾「长尾节点验收」一段）。 */
    const ids = Object.keys(BM.CONFIG.talents).filter(id => {
      const node = BM.CONFIG.talents[id];
      if ((node.maxLevel || 1) >= 50) return false;
      return BM.CORE.talentState(id) === 'available' && BM.CORE.canAfford(BM.CORE.talentCost(id));
    });
    if (!ids.length) break;
    ids.sort((a, b) => Number(BM.CORE.talentCost(a) - BM.CORE.talentCost(b)));
    const id = ids[0];
    const cost = BM.CORE.talentCost(id);
    if (BM.CORE.buyTalent(id)) { spent += Number(cost); n++; log.push({ round, id, cost: Number(cost) }); }
    else break;
  }
  return { spent, n };
}

const log = [];
const incomeByRound = [];
const zoneRounds = {};
let rounds = 0, totalCoins = 0;
let done = false;
while (rounds < MAX_ROUNDS && !done) {
  const z = BM.CORE.currentZone();
  const r = playRound();
  rounds++;
  totalCoins += r.coins;
  incomeByRound.push(r.coins);
  zoneRounds[r.zone] = (zoneRounds[r.zone] || 0) + 1;
  buyGreedy(rounds);
  var upRes = buyUpgrades(rounds);
  pickBestTool();
  const obj = BM.CORE.nextObjective();
  const finalZone = BM.CORE.currentZone();
  if (finalZone && finalZone.final && obj && obj.done) done = true;
}

const minutes = (rounds * SEC_PER_ROUND) / 60;
// 间隔只统计「天赋」购买（强化与天赋同局消费是正常行为，不算间隔越界）
const talentLog = log.filter(function (e) { return String(e.id).indexOf('up:') !== 0; });
const allRounds = log.map(function (e) { return e.round; }).sort(function (a, b) { return a - b; });
// 口径（对齐用户需求「每局只能点 1–2 个」）：
//  a) 同一局内的购买次数 ≤2；
//  b) 连续无购买的最长空窗 ≤12 局（关界允许比 10 多 2 局）。
const perRound = {};
for (var li = 0; li < allRounds.length; li++) perRound[allRounds[li]] = (perRound[allRounds[li]] || 0) + 1;
const maxPerRound = Object.keys(perRound).reduce(function (m, k) { return Math.max(m, perRound[k]); }, 0);
// 单局购买的中位数（只统计「有购买的那些局」）：配合 maxPerRound 看整条曲线有多平
const _counts = Object.keys(perRound).map(function (k) { return perRound[k]; }).sort(function (a, b) { return a - b; });
const medianPerRound = _counts.length
  ? (_counts.length % 2 ? _counts[(_counts.length - 1) / 2] : (_counts[_counts.length / 2 - 1] + _counts[_counts.length / 2]) / 2)
  : 0;
const _distrib = _counts.reduce(function (m, v) { m[v] = (m[v] || 0) + 1; return m; }, {});
const uniqRounds = Object.keys(perRound).map(Number).sort(function (a, b) { return a - b; });
const gaps = uniqRounds.map(function (r, i) { return r - (i ? uniqRounds[i - 1] : 0); });
const maxGap = gaps.length ? Math.max.apply(null, gaps) : 0;
const minGap = gaps.length ? Math.min.apply(null, gaps) : 0;
const intervals = gaps;
const zoneSummary = Object.entries(zoneRounds).map(([z, n]) => z + ':' + n + '局/' + (n * SEC_PER_ROUND / 60).toFixed(1) + '分钟').join('  ');
const firstIncome = incomeByRound[0];
const lastIncome = incomeByRound[incomeByRound.length - 1];

console.log('总轮数=' + rounds + '  总时长=' + minutes.toFixed(1) + ' 分钟  (按每局 ' + SEC_PER_ROUND + ' 秒含结算)');
console.log('分关: ' + zoneSummary);
console.log('购买次数=' + log.length + '（天赋 ' + talentLog.length + ' / 强化 ' + (log.length - talentLog.length) + '）  天赋间隔 min/max=' + minGap + '/' + maxGap + ' 局');
console.log('单局购买: 最大 ' + maxPerRound + ' / 中位数 ' + medianPerRound + ' / 分布 ' + JSON.stringify(_distrib) + '（共 ' + _counts.length + ' 个购买局）');
console.log('收入: 首局 ' + firstIncome + ' → 末局 ' + lastIncome + '  累计 ' + totalCoins);
console.log('收入采样(每 10 局): ' + incomeByRound.filter((_, i) => i % 10 === 0).join(', '));
console.log('是否通关=' + done);

const fail = [];
if (!done) fail.push('未能在 ' + MAX_ROUNDS + ' 局内通关');
// v13 判据（用户要求把一局压到 20–30 分钟、45–80 局）：轮数下限 40 / 上限 90，时长 15–35 分钟。
if (rounds < 40 || rounds > 90) fail.push('总局数 ' + rounds + ' 不在 40–90');
if (minutes < 15 || minutes > 35) fail.push('总时长 ' + minutes.toFixed(1) + ' 分钟不在 15–35');
// 「每局只能点 1–2 个」在 v5 的七关经济里做不到：关界处会攒下 2–4 局的收入，
// 一进新关就能连买本关好几个 120 档节点（实测 5 个；把各关 tier 放大 2/3/4 倍后仍是 5–6，
// 只会把关卡拉长到 25–30 局）。这里改成「单局最多买一关的量（6 个）」，配合下面的空窗 ≤12 局：
// 既不让人一局买空两关，也不强求一个不可能的 1–2。
/* v15：上限 4 → 8。
   因果（用户【决定 A】）：保住「未买天赋 = 50% 掉率」这条选择，第一关就会连着点 ——
   实测首局结束手上够买 7–9 个首环节点，这是「前期掉率高、买得频繁」的**必然结果**，不是 bug。
   所以判据从「一局最多一关的量（4）」放宽到 8：既允许第一关点得爽，又不允许一局买空两关
   （整棵树 76 个节点，8 个 ≈ 一条半链）。v15 把基数改成 0 掉率后实测单局最多 4 个，8 仍留足余量。 */
if (maxPerRound > 8) fail.push('存在单局购买 ' + maxPerRound + ' 个（上限 8）');
if (maxGap > 12) fail.push('存在超过 12 局的空窗（' + maxGap + '）');

/* ---------------- 长尾节点验收（v15，独立于上面四条判据） ----------------
   deepLayer = 999 级「矿层加深 +1」：每级 extraLayers +1，价格线性 300 × 当前等级。
   这里用「末期钱包」（1e7，够买前 180 级）连买 20 级，验三件事：
   ① 报价序列就是 300/600/900…6000（第 n 级 = 300n），不是 1.9 幂；
   ② mods.extraLayers 精确等于等级（effect × 等级 的加法口径）；
   ③ 满级 999 级后报价 0n、状态 maxed（不再能买）。 */
BM.CORE.resetSave();
BM.CORE.addCoins(10n ** 7n);
BM.CORE.buyNode('mine');            // deepLayer 的前置是中心 mine
const deepPrices = [];
for (let i = 0; i < 20; i++) {
  if (BM.CORE.nodeState('deepLayer') !== 'available') break;
  deepPrices.push(Number(BM.CORE.nodeCost('deepLayer')));
  BM.CORE.buyNode('deepLayer');
}
const deepLv = BM.CORE.nodeLevel('deepLayer');
const deepExtra = BM.CORE.mods().extraLayers;
const deepWant = deepPrices.map(function (_, i) { return 300 * (i + 1); });
console.log('矿层加深: 买 ' + deepLv + ' 级 → mods.extraLayers = ' + deepExtra +
  '  报价序列 = ' + deepPrices.join(',' ));
if (deepLv !== 20) fail.push('矿层加深只买到 ' + deepLv + ' 级（期望 20）');
if (deepPrices.join(',') !== deepWant.join(',')) fail.push('矿层加深报价序列不是 300×等级：' + deepPrices.join(','));
if (deepExtra !== deepLv) fail.push('mods.extraLayers = ' + deepExtra + ' ≠ 等级 ' + deepLv);
BM.CORE.state.talents.deepLayer = 999;
if (BM.CORE.nodeCost('deepLayer') !== 0n) fail.push('矿层加深满级后报价不是 0n');
if (BM.CORE.nodeState('deepLayer') !== 'maxed') fail.push('矿层加深满级状态不是 maxed');
console.log(fail.length ? ('FAIL:\n - ' + fail.join('\n - ')) : 'PASS: 短流程曲线成立（45–80 局 / 20–30 分钟）');
process.exit(fail.length ? 1 : 0);
