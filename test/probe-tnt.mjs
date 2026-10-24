// 两处 TNT 收益实测（交付用）：v14 掉率 = 基础 50% + 每环 +5pp（满链 90%）
// 口径：
//   base = 一个天赋都不买（mods.luckyTNTChance = 0.5），第 1 关（木镐）
//   mid  = 按「最便宜优先」买到 tntDrop5（= 0.5 + 5×5pp = 75%）为止的那套天赋，第 2 关（铁镐）
//   late = 整棵树 75 个节点全买满（tntDrop8 = 90%），第 4 关（激光钻）
//   各跑 20 局，取金币 / 爆炸次数 / 碎层数的中位数。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');
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
const sb = { console, performance: { now: () => 0 }, devicePixelRatio: 1,
  localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  location: { hash: '' }, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: noop,
  document: { createElement: () => mkCanvas(), getElementById: () => mkCanvas(), querySelector: () => null, addEventListener: noop, head: { appendChild: noop }, body: { appendChild: noop } } };
sb.window = sb; sb.globalThis = sb;
const c = vm.createContext(sb);
for (const f of ['01-config', '02-core', '03-grid', '04-tools', '05-drops', '06-fx']) vm.runInContext(readFileSync(join(srcDir, f + '.js'), 'utf8'), c, { filename: f });
const BM = sb.BM;
BM.GRID.init(ctx, BM.BOARD); BM.DROPS.init(); BM.FX.init(); BM.TOOLS.init(ctx);

function buyGreedyTo(stopWhen) {
  for (let guard = 0; guard < 500; guard++) {
    const ids = Object.keys(BM.CONFIG.talents).filter(id => BM.CORE.talentState(id) === 'available' && BM.CORE.canAfford(BM.CORE.talentCost(id)));
    if (!ids.length) break;
    ids.sort((a, b) => Number(BM.CORE.talentCost(a) - BM.CORE.talentCost(b)));
    if (!BM.CORE.buyTalent(ids[0])) break;
    if (stopWhen && stopWhen()) break;
  }
}

function playRound(zoneId) {
  const zone = BM.CORE.zoneById(zoneId);
  BM.TOOLS.setZone(zone); BM.GRID.build(zone); BM.DROPS.reset(); BM.TOOLS.reset();
  const dt = 1 / 60, seconds = BM.CORE.resolveRoundSeconds(zone);
  const toolId = BM.CORE.state.selectedTool;
  const hold = BM.CONFIG.tools[toolId].mode === 'hold';
  let t = 0, layers = 0, target = null, nextTap = 0, maxFuse = 0;
  const off1 = BM.bus.on('block:layer', () => layers++);
  const off2 = BM.bus.on('block:empty', () => { layers++; });
  while (t < seconds) {
    t += dt;
    BM.GRID.update(dt); BM.DROPS.update(dt); BM.TOOLS.update(dt, t); BM.FX.update(dt);
    if (BM.TOOLS.fuses > maxFuse) maxFuse = BM.TOOLS.fuses;
    if (!target || target.broken || target.layers <= 0) {
      const alive = BM.GRID.flat.filter(b => !b.broken && b.layers > 0);
      if (!alive.length) break;
      const rich = alive.filter(b => b.rich);
      const pool = (rich.length && Math.random() < 0.6) ? rich : alive;
      target = pool[(Math.random() * pool.length) | 0];
    }
    if ((hold || t >= nextTap) && BM.TOOLS.ready()) {
      if (BM.TOOLS.attack(toolId, target.x + target.s / 2, target.y + target.s / 2, { now: t })) {
        if (!hold) nextTap = t + 1 / 4;
      }
    }
  }
  off1(); off2();
  // 结算剩余的引信（长引线 1.8s，回合末还在飞的要给它们时间炸完）
  for (let i = 0; i < 120; i++) {
    BM.TOOLS.update(dt, seconds + i * dt); BM.GRID.update(dt); BM.DROPS.update(dt);
  }
  const st = BM.TOOLS.stats;
  BM.DROPS.absorbAll();
  for (let i = 0; i < 60; i++) BM.DROPS.update(dt);
  const counts = { ...BM.DROPS.counts };
  // 结算会推进 lifetimeMined / 解锁下一关与下一把工具；测量时把它还原，
  // 保证「中期 20 局都留在第 2 关、开着铁镐」这个口径不被污染。
  const st0 = BM.CORE.state;
  const snap = { currentZone: st0.currentZone, zones: st0.unlockedZones.slice(), tools: st0.unlockedTools.slice(),
    tool: st0.selectedTool, mined: Object.assign({}, st0.lifetimeMined) };
  const res = BM.CORE.settleRound({ zoneId, counts, brokenBlocks: layers, maxCombo: 0, explosions: st.explosions, maxChain: 0, timeLeft: 0 });
  st0.currentZone = snap.currentZone; st0.unlockedZones = snap.zones; st0.unlockedTools = snap.tools;
  st0.selectedTool = snap.tool; st0.lifetimeMined = snap.mined;
  return { coins: Number(res.coinsEarned), explosions: st.explosions, layers, counts };
}

function median(arr) { const s = arr.slice().sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2); }
function mean(arr) { return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length); }

const RUNS = 20;
const report = {};

// ---- 基底：一个天赋都不买（v14 掉率基数 = 0.5），第 1 关木镐 ----
BM.CORE.resetSave();
BM.CORE.addCoins(10n ** 12n);
{
  const baseMods = BM.CORE.mods();
  const runs = [];
  BM.CORE.unlockZone('quarry');
  BM.CORE.setTool('wood');
  for (let i = 0; i < RUNS; i++) runs.push(playRound('quarry'));
  report.base = {
    zone: 'quarry', talentsBought: 0,
    luckyTNTChance: Number(baseMods.luckyTNTChance.toFixed(4)),
    tntLayerPierce: baseMods.tntLayerPierce,
    coinsMedian: median(runs.map(r => r.coins)),
    explosionsMedian: median(runs.map(r => r.explosions)),
    layersMedian: median(runs.map(r => r.layers))
  };
}

// ---- 中期：第 2 关 + tntDrop 5 环（50%）
BM.CORE.resetSave();
BM.CORE.addCoins(10n ** 12n);
BM.CORE.unlockZone('copperRidge');
BM.CORE.unlockTool('iron');
BM.CORE.setTool('iron');
buyGreedyTo(() => {
  const m = BM.CORE.mods();
  return m.luckyTNTChance >= 0.75 - 1e-9;
});
const midMods = BM.CORE.mods();
console.error('MID SETUP', BM.CORE.state.selectedTool, JSON.stringify(BM.CORE.state.unlockedTools), midMods.luckyTNTChance);
const midRuns = [];
for (let i = 0; i < RUNS; i++) midRuns.push(playRound('copperRidge'));
report.mid = {
  zone: 'copperRidge', tool: BM.CORE.state.selectedTool,
  luckyTNTChance: Number(midMods.luckyTNTChance.toFixed(4)),
  damage: midMods.damage, tntLayerPierce: midMods.tntLayerPierce,
  tntDamageMul: Number(midMods.tntDamageMul.toFixed(3)),
  coinsMedian: median(midRuns.map(r => r.coins)),
  coinsMean: mean(midRuns.map(r => r.coins)),
  explosionsMedian: median(midRuns.map(r => r.explosions)),
  layersMedian: median(midRuns.map(r => r.layers)),
  talentsBought: BM.CORE.ownedTalents().length
};

// ---- 后期：第 4 关 + 整树买满（tntDrop 8 → 掉率 90%）
BM.CORE.resetSave();
BM.CORE.addCoins(10n ** 13n);
buyGreedyTo(() => false);
BM.CORE.unlockZone('lavaEdge');
Object.keys(BM.CONFIG.tools).forEach((id) => BM.CORE.unlockTool(id));
BM.CORE.setTool('laser');
const lateMods = BM.CORE.mods();
const lateRuns = [];
for (let i = 0; i < RUNS; i++) lateRuns.push(playRound('lavaEdge'));
let maxFuse = 0;
report.late = {
  zone: 'lavaEdge', tool: BM.CORE.state.selectedTool,
  luckyTNTChance: Number(lateMods.luckyTNTChance.toFixed(4)),
  damage: lateMods.damage, tntLayerPierce: lateMods.tntLayerPierce,
  tntDamageMul: Number(lateMods.tntDamageMul.toFixed(3)),
  coinsMedian: median(lateRuns.map(r => r.coins)),
  coinsMean: mean(lateRuns.map(r => r.coins)),
  explosionsMedian: median(lateRuns.map(r => r.explosions)),
  explosionsMean: mean(lateRuns.map(r => r.explosions)),
  layersMedian: median(lateRuns.map(r => r.layers)),
  layersMean: mean(lateRuns.map(r => r.layers)),
  boardLayers: 48 * 21,
  talentsBought: BM.CORE.ownedTalents().length
};
report.ratio = Number((report.late.coinsMedian / Math.max(1, report.mid.coinsMedian)).toFixed(2));
report.limit = 400;
report.note = 'late 一局的碎层数 / 棋盘总层数 = ' + (report.late.layersMedian / report.late.boardLayers * 100).toFixed(1) + '%';
console.log(JSON.stringify(report, null, 2));
console.log('后期/中期 = ×' + report.ratio + (report.ratio > 400 ? '（>×400，需要极小幅度收敛）' : '（未超过 ×400，不动 coinMul）'));
console.log('后期一局碎层 = ' + report.late.layersMedian + ' / ' + report.late.boardLayers + '（' + report.note.split('= ')[1] + '）');
