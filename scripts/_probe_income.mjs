
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
const srcDir = join(process.cwd(), 'src');
const noop = () => {};
const grad = { addColorStop: noop };
const ctx = new Proxy({ canvas: { width: 390, height: 844 }, createLinearGradient: () => grad, createRadialGradient: () => grad, createPattern: () => null, measureText: () => ({ width: 8 }), getImageData: (x,y,w,h)=>({data:new Uint8ClampedArray(Math.max(4,(w|0)*(h|0)*4))}), createImageData: (w,h)=>({data:new Uint8ClampedArray(Math.max(4,(w|0)*(h|0)*4)),width:w,height:h}) }, { get: (t,p) => (p in t ? t[p] : (typeof p === 'string' ? noop : undefined)), set: () => true });
const mkCanvas = () => ({ width: 390, height: 844, style: {}, getContext: () => ctx, addEventListener: noop, getBoundingClientRect: () => ({ left:0,top:0,width:390,height:844 }), appendChild: noop, setPointerCapture: noop, classList: { add: noop, remove: noop, toggle: noop, contains: () => false } });
const store = new Map();
const sb = { console, performance: { now: () => 0 }, devicePixelRatio: 1,
  localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k,v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  location: { hash: '' }, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: noop,
  document: { createElement: () => mkCanvas(), getElementById: () => mkCanvas(), querySelector: () => null, addEventListener: noop, head: { appendChild: noop }, body: { appendChild: noop } } };
sb.window = sb; sb.globalThis = sb;
const c = vm.createContext(sb);
for (const f of ['01-config','02-core','03-grid','04-tools','05-drops','06-fx']) vm.runInContext(readFileSync(join(srcDir, f + '.js'), 'utf8'), c, { filename: f });
const BM = sb.BM; const CFG = BM.CONFIG;
const ZONE_IDS = CFG.zones.map(z => z.id); const TOOL_IDS = Object.keys(CFG.tools);
BM.GRID.init(ctx, BM.BOARD); BM.DROPS.init(); BM.FX.init(); BM.TOOLS.init(ctx);
function setup(zoneIdx, budget) {
  BM.CORE.resetSave();
  if (budget === null) BM.CORE.addCoins(10n ** 20n); else BM.CORE.addCoins(BigInt(Math.max(0, Math.floor(budget))));
  for (const zid of ZONE_IDS) BM.CORE.unlockZone(zid);
  for (const tid of TOOL_IDS) BM.CORE.unlockTool(tid);
  BM.CORE.setTool(TOOL_IDS[zoneIdx]);
}
function buyGreedy() {
  for (let g = 0; g < 400; g++) {
    const ids = Object.keys(CFG.talents).filter((id) => BM.CORE.talentState(id) === 'available' && BM.CORE.canAfford(BM.CORE.talentCost(id)));
    if (!ids.length) break;
    ids.sort((a, b) => Number(BM.CORE.talentCost(a) - BM.CORE.talentCost(b)));
    if (!BM.CORE.buyTalent(ids[0])) break;
  }
}
function simRound(zoneId) {
  const zone = BM.CORE.zoneById(zoneId);
  BM.TOOLS.setZone(zone); BM.GRID.build(zone); BM.DROPS.reset(); BM.TOOLS.reset();
  const dt = 1/60; const seconds = BM.CORE.resolveRoundSeconds(zone);
  const toolId = BM.CORE.state.selectedTool; const hold = CFG.tools[toolId].mode === 'hold';
  let t = 0, layers = 0, target = null, nextTap = 0;
  const offL = BM.bus.on('block:layer', () => layers++); const offE = BM.bus.on('block:empty', () => { layers++; });
  while (t < seconds) {
    t += dt; BM.GRID.update(dt); BM.DROPS.update(dt); BM.TOOLS.update(dt, t); BM.FX.update(dt);
    if (!target || target.broken) {
      const alive = BM.GRID.flat.filter(b => !b.broken && b.layers > 0);
      if (!alive.length) break;
      const rich = alive.filter(b => b.rich);
      const pool = rich.length && Math.random() < 0.6 ? rich : alive;
      target = pool[(Math.random() * pool.length) | 0];
    }
    if ((hold || t >= nextTap) && BM.TOOLS.ready()) {
      if (BM.TOOLS.attack(toolId, target.x + target.s/2, target.y + target.s/2, { now: t })) { if (!hold) nextTap = t + 1/4; }
    }
  }
  offL(); offE(); BM.DROPS.absorbAll();
  for (let i = 0; i < 60; i++) BM.DROPS.update(dt);
  const counts = { ...BM.DROPS.counts };
  const res = BM.CORE.settleRound({ zoneId: zone.id, counts, brokenBlocks: layers, maxCombo: 0, explosions: 0, maxChain: 0, timeLeft: 0 });
  return { coins: Number(res.coinsEarned), counts, layers };
}
const RUNS = 31;
const med = a => { const s = a.slice().sort((x,y)=>x-y); return s[(s.length/2)|0]; };
for (let i = 0; i < ZONE_IDS.length; i++) {
  setup(i, null); buyGreedy();
  const runs = []; for (let k = 0; k < RUNS; k++) runs.push(simRound(ZONE_IDS[i]));
  const coins = med(runs.map(r => r.coins)); const layers = med(runs.map(r => r.layers));
  const keys = new Set(); runs.forEach(r => Object.keys(r.counts).forEach(k => keys.add(k)));
  const perOre = {}; for (const k of keys) perOre[k] = med(runs.map(r => r.counts[k] || 0));
  const z = CFG.zones[i];
  const wp = z.ores.reduce((s,o)=> s + (o.weight/100)*CFG.ores[o.ore].price, 0);
  console.log(ZONE_IDS[i].padEnd(12), 'mul=' + z.coinMul, 'coins=' + coins, 'layers=' + layers, 'wp=' + wp.toFixed(1),
    'raw=' + Math.round(coins / z.coinMul), 'counts=' + JSON.stringify(perOre));
}
