
// scripts/tune.mjs —— 调参探针：与 test/progression.mjs 同一套玩家策略，外加分关读数
// 用法: node scripts/tune.mjs [--seed=N] [--patch=file.json] [--json]
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (k, d) => { const a = args.find(x => x.startsWith('--' + k)); return a ? a.split('=')[1] : d; };
const srcDir = argOf('src', join(here, '..', 'src'));
const SEED = Number(argOf('seed', 12345));
// 宿主侧随机（探针自己选目标格）也要用同一条种子流，否则同 seed 两次结果不同
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rng = mulberry32(SEED ^ 0x5bf03635);
const PATCH = argOf('patch', '');
const JSON_OUT = args.includes('--json');


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
// 沙箱有自己的一套 intrinsics：必须在 context 内部打种子，否则 Math.random 仍是宿主的
vm.runInContext('Date.now=function(){return 0;};', c);
vm.runInContext('Math.random=(function(){var a=' + (SEED >>> 0) + ';return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};})();', c);
for (const f of ['01-config', '02-core', '03-grid', '04-tools', '05-drops', '06-fx']) vm.runInContext(readFileSync(join(srcDir, f + '.js'), 'utf8'), c, { filename: f });
const BM = sb.BM;
const CFG = BM.CONFIG;
const ZONE_IDS = CFG.zones.map(z => z.id);
const ZONE_IDX = {}; ZONE_IDS.forEach((z, i) => ZONE_IDX[z] = i);

// patch 在 CORE 读取前注入（talentCost/upgradeCost/objective 都是运行时读 CFG）
if (PATCH) {
  const p = JSON.parse(readFileSync(PATCH, 'utf8'));
  if (p.zoneCoinTier) Object.assign(CFG.talentCostTable.zoneCoinTier, p.zoneCoinTier);
  if (p.tierBase) Object.assign(CFG.talentCostTable.tierBase, p.tierBase);
  if (p.need) for (const k in p.need) { const z = CFG.zones.find(z => z.id === k); if (z) z.objective.need = p.need[k]; }
  if (p.baseCost) for (const k in p.baseCost) CFG.upgrades[k].baseCost = p.baseCost[k];
  if (p.upgrades) for (const k in p.upgrades) Object.assign(CFG.upgrades[k], p.upgrades[k]);
  if (p.zones) for (const k in p.zones) { const z = CFG.zones.find(z => z.id === k); if (z) Object.assign(z, p.zones[k]); }
  if (p.ores) for (const k in p.ores) { const z = CFG.zones.find(z => z.id === k); if (z) for (const o of (p.ores[k] || [])) { const t = z.ores.find(x => x.ore === o.ore); if (t) Object.assign(t, o); } }
}

BM.GRID.init(ctx, BM.BOARD); BM.DROPS.init(); BM.FX.init(); BM.TOOLS.init(ctx);
BM.CORE.resetSave();

const SEC_PER_ROUND = 23;
const MAX_ROUNDS = 1000;
const RATE = 4;

function playRound() {
  const zone = BM.CORE.currentZone();
  BM.TOOLS.setZone(zone); BM.GRID.build(zone); BM.DROPS.reset(); BM.TOOLS.reset();
  const dt = 1 / 60;
  const seconds = BM.CORE.resolveRoundSeconds(zone);
  const toolId = BM.CORE.state.selectedTool;
  const hold = BM.CONFIG.tools[toolId] && BM.CONFIG.tools[toolId].mode === 'hold';
  let t = 0, taps = 0, target = null, nextTap = 0;
  while (t < seconds) {
    t += dt;
    BM.GRID.update(dt); BM.DROPS.update(dt); BM.TOOLS.update(dt, t); BM.FX.update(dt);
    if (!target || target.broken || target.layers <= 0) {
      const alive = BM.GRID.flat.filter(b => !b.broken && b.layers > 0);
      if (!alive.length) break;
      const rich = alive.filter(b => b.rich);
      const pool = (rich.length && rng() < 0.6) ? rich : alive;
      target = pool[(rng() * pool.length) | 0];
    }
    if ((hold || t >= nextTap) && BM.TOOLS.ready()) {
      if (BM.TOOLS.attack(toolId, target.x + target.s / 2, target.y + target.s / 2, { now: t })) {
        taps++;
        if (!hold) nextTap = t + 1 / RATE;
      }
    }
  }
  BM.DROPS.absorbAll();
  for (let i = 0; i < 60; i++) BM.DROPS.update(dt);
  const counts = { ...BM.DROPS.counts };
  const res = BM.CORE.settleRound({ zoneId: zone.id, counts, brokenBlocks: 0, maxCombo: 0, explosions: 0, maxChain: 0, timeLeft: 0 });
  return { coins: Number(res.coinsEarned), zone: zone.id, counts, objective: res.objective, nextZone: res.nextZoneId };
}

function pickBestTool() {
  var best = null, bestDmg = -1;
  var list = BM.CORE.state.unlockedTools || [];
  for (var i = 0; i < list.length; i++) {
    var cfg = BM.CONFIG.tools[list[i]];
    if (!cfg) continue;
    var dmg = BM.CORE.toolDamage ? BM.CORE.toolDamage(list[i]) : cfg.dmg;
    if (dmg > bestDmg) { bestDmg = dmg; best = list[i]; }
  }
  if (best) BM.CORE.setTool(best);
}

const log = [];
function buyUpgrades(round) {
  var up = BM.CONFIG.upgrades || {};
  var ids = Object.keys(up);
  for (var guard = 0; guard < 20; guard++) {
    var best = null, bestCost = null;
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var lv = BM.CORE.upgradeLevel(id);
      if (lv >= (up[id].maxLevel || 5)) continue;
      var cc = BM.CORE.upgradeCost(id);
      if (!BM.CORE.canAfford(cc)) continue;
      if (bestCost === null || cc < bestCost) { bestCost = cc; best = id; }
    }
    if (!best) break;
    if (BM.CORE.buyUpgrade(best)) log.push({ round, id: 'up:' + best, cost: Number(bestCost) });
    else break;
  }
}
function buyGreedy(round) {
  for (let guard = 0; guard < 50; guard++) {
    const ids = Object.keys(BM.CONFIG.talents).filter(id => BM.CORE.talentState(id) === 'available' && BM.CORE.canAfford(BM.CORE.talentCost(id)));
    if (!ids.length) break;
    ids.sort((a, b) => Number(BM.CORE.talentCost(a) - BM.CORE.talentCost(b)));
    const id = ids[0];
    const cost = BM.CORE.talentCost(id);
    if (BM.CORE.buyTalent(id)) log.push({ round, id, cost: Number(cost) });
    else break;
  }
}

const incomeByRound = [];
const zoneRounds = {};
const boundary = [];   // 每次进新关那一局的购买明细
let rounds = 0, done = false, prevZone = null;
const coinBefore = [];  // 每局买入前的余额
while (rounds < MAX_ROUNDS && !done) {
  const before = Number(BM.CORE.state.coins);
  const r = playRound();
  rounds++;
  incomeByRound.push({ round: rounds, zone: r.zone, coins: r.coins });
  zoneRounds[r.zone] = (zoneRounds[r.zone] || 0) + 1;
  if (prevZone && r.zone !== prevZone) {
    boundary.push({ round: rounds, from: prevZone, to: r.zone, banked: before, income: r.coins, counts: r.counts });
  }
  prevZone = r.zone;
  coinBefore.push(before);
  const n0 = log.length;
  buyGreedy(rounds);
  buyUpgrades(rounds);
  pickBestTool();
  const obj = BM.CORE.nextObjective();
  const fz = BM.CORE.currentZone();
  if (fz && fz.final && obj && obj.done) done = true;
}

// ---------- 统计 ----------
const perRound = {};
for (const e of log) perRound[e.round] = (perRound[e.round] || 0) + 1;
const prVals = Object.values(perRound).sort((a, b) => a - b);
const med = (arr) => { if (!arr.length) return 0; const k = arr.length; return k % 2 ? arr[(k - 1) / 2] : (arr[k / 2 - 1] + arr[k / 2]) / 2; };
const maxPerRound = prVals.length ? prVals[prVals.length - 1] : 0;
const medianPerRound = med(prVals);
const uniqRounds = Object.keys(perRound).map(Number).sort((a, b) => a - b);
const gaps = uniqRounds.map((r, i) => r - (i ? uniqRounds[i - 1] : 0));
const maxGap = gaps.length ? Math.max(...gaps) : 0;
const minGap = gaps.length ? Math.min(...gaps) : 0;

const perZone = ZONE_IDS.map((zid, i) => {
  const inc = incomeByRound.filter(x => x.zone === zid).map(x => x.coins);
  const n = inc.length;
  const mean = n ? inc.reduce((a, b) => a + b, 0) / n : 0;
  const t1 = Number(BM.CORE.talentCost(Object.keys(CFG.talents).find(k => CFG.talents[k].zone === zid && CFG.talents[k].tier === Math.min(...Object.values(CFG.talents).filter(t => t.zone === zid).map(t => t.tier)))));
  const firstT3 = inc.slice(0, 3);
  const buys = log.filter(e => incomeByRound[e.round - 1] && incomeByRound[e.round - 1].zone === zid && String(e.id).indexOf('up:') !== 0);
  return { zone: zid, rounds: n, mean, first: inc[0] || 0, last: inc[n - 1] || 0, t1, ratio: mean ? t1 / mean : 0, t1first: inc[0] ? t1 / inc[0] : 0, buys: buys.length };
});

const boundaryBursts = boundary.map(b => {
  const buys = log.filter(e => e.round === b.round);
  return { ...b, buys: buys.length, buyIds: buys.map(x => x.id) };
});

if (JSON_OUT) {
  console.log(JSON.stringify({
    seed: SEED, rounds, minutes: rounds * SEC_PER_ROUND / 60, done,
    zones: perZone.map(z => ({ ...z, mean: Math.round(z.mean), ratio: +z.ratio.toFixed(2), t1first: +z.t1first.toFixed(2) })),
    maxPerRound, medianPerRound, maxGap, minGap,
    distrib: prVals.reduce((m, v) => (m[v] = (m[v] || 0) + 1, m), {}),
    boundary: boundaryBursts.map(b => ({ round: b.round, from: b.from, to: b.to, banked: b.banked, income: b.income, buys: b.buys, ids: b.buyIds })),
    bigRounds: Object.keys(perRound).filter(k => perRound[k] >= 2).map(k => ({ round: +k, n: perRound[k], zone: (incomeByRound[+k - 1] || {}).zone, income: (incomeByRound[+k - 1] || {}).coins, banked: coinBefore[+k - 1], ids: log.filter(e => e.round === +k).map(e => e.id + '@' + e.cost) }))
  }, null, 1));
  process.exit(0);
}

console.log('seed=' + SEED + '  总轮数=' + rounds + '  总时长=' + (rounds * SEC_PER_ROUND / 60).toFixed(1) + ' 分钟  通关=' + done);
console.log('分关: ' + Object.entries(zoneRounds).map(([z, n]) => z + ':' + n).join('  '));
console.log('单局购买  max=' + maxPerRound + '  中位数=' + medianPerRound + '  分布=' + JSON.stringify(prVals.reduce((m, v) => (m[v] = (m[v] || 0) + 1, m), {})));
console.log('天赋间隔 min/max=' + minGap + '/' + maxGap);
console.log('');
console.log('关'.padEnd(12) + '局数'.padStart(5) + '单局收入均值'.padStart(13) + '首局'.padStart(11) + '末局'.padStart(11) + 't1价'.padStart(11) + 't1/均值'.padStart(9) + 't1/首局'.padStart(9) + '买天赋'.padStart(7));
for (const z of perZone) {
  console.log(z.zone.padEnd(12) + String(z.rounds).padStart(5) + String(Math.round(z.mean)).padStart(13) + String(z.first).padStart(11) + String(z.last).padStart(11) + String(z.t1).padStart(11) + (+z.ratio).toFixed(2).padStart(9) + (+z.t1first).toFixed(2).padStart(9) + String(z.buys).padStart(7));
}
console.log('');
console.log('关界（进新关那一局）:');
for (const b of boundaryBursts) console.log('  round ' + b.round + '  ' + b.from + ' → ' + b.to + '  攒钱=' + b.banked + '  本局收入=' + b.income + '  当局购买=' + b.buys + '  [' + b.buyIds.join(',') + ']');