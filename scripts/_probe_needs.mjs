
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
BM.GRID.init(ctx, BM.BOARD); BM.DROPS.init(); BM.FX.init(); BM.TOOLS.init(ctx);
BM.CORE.resetSave();
const SEC_PER_ROUND = 23, MAX_ROUNDS = 400, RATE = 4;
function playRound() {
  const zone = BM.CORE.currentZone();
  BM.TOOLS.setZone(zone); BM.GRID.build(zone); BM.DROPS.reset(); BM.TOOLS.reset();
  const dt = 1/60; const seconds = BM.CORE.resolveRoundSeconds(zone);
  const toolId = BM.CORE.state.selectedTool; const hold = CFG.tools[toolId] && CFG.tools[toolId].mode === 'hold';
  let t = 0, taps = 0, target = null, nextTap = 0;
  while (t < seconds) {
    t += dt; BM.GRID.update(dt); BM.DROPS.update(dt); BM.TOOLS.update(dt, t); BM.FX.update(dt);
    if (!target || target.broken || target.layers <= 0) {
      const alive = BM.GRID.flat.filter(b => !b.broken && b.layers > 0);
      if (!alive.length) break;
      const rich = alive.filter(b => b.rich);
      const pool = rich.length && Math.random() < 0.6 ? rich : alive;
      target = pool[(Math.random() * pool.length) | 0];
    }
    if ((hold || t >= nextTap) && BM.TOOLS.ready()) {
      if (BM.TOOLS.attack(toolId, target.x + target.s/2, target.y + target.s/2, { now: t })) { taps++; if (!hold) nextTap = t + 1/RATE; }
    }
  }
  BM.DROPS.absorbAll();
  for (let i = 0; i < 60; i++) BM.DROPS.update(dt);
  const counts = { ...BM.DROPS.counts };
  const res = BM.CORE.settleRound({ zoneId: zone.id, counts, brokenBlocks: 0, maxCombo: 0, explosions: 0, maxChain: 0, timeLeft: 0 });
  return { coins: Number(res.coinsEarned), zone: zone.id, counts, nextZone: res.nextZoneId };
}
function pickBestTool() {
  let best = null, bestDmg = -1;
  const list = BM.CORE.state.unlockedTools || [];
  for (const id of list) { const cfg = CFG.tools[id]; if (!cfg) continue; const dmg = BM.CORE.toolDamage ? BM.CORE.toolDamage(id) : cfg.dmg; if (dmg > bestDmg) { bestDmg = dmg; best = id; } }
  if (best) BM.CORE.setTool(best);
}
let buys = [];
function buyGreedy(round) {
  for (let g = 0; g < 50; g++) {
    const ids = Object.keys(CFG.talents).filter(id => BM.CORE.talentState(id) === 'available' && BM.CORE.canAfford(BM.CORE.talentCost(id)));
    if (!ids.length) break;
    ids.sort((a,b) => Number(BM.CORE.talentCost(a) - BM.CORE.talentCost(b)));
    if (BM.CORE.buyTalent(ids[0])) buys.push({ round, id: ids[0] }); else break;
  }
}
const zoneStats = {};
let rounds = 0, done = false;
const perRound = {};
while (rounds < MAX_ROUNDS && !done) {
  const z = BM.CORE.currentZone();
  const before = { ...BM.CORE.state.lifetimeMined };
  const r = playRound(); rounds++;
  const st = zoneStats[r.zone] || (zoneStats[r.zone] = { rounds: 0, coins: 0, mined: {} });
  st.rounds++; st.coins += r.coins;
  for (const k in r.counts) st.mined[k] = (st.mined[k] || 0) + r.counts[k];
  const b0 = buys.length; buyGreedy(rounds);
  perRound[rounds] = buys.length - b0;
  pickBestTool();
  const fz = BM.CORE.currentZone(); const obj = BM.CORE.nextObjective();
  if (fz && fz.final && obj && obj.done) done = true;
}
const zoneOrder = CFG.zones.map(z => z.id);
for (const zid of zoneOrder) {
  const st = zoneStats[zid]; if (!st) continue;
  const z = CFG.zones[zoneOrder.indexOf(zid)];
  const rates = Object.keys(st.mined).map(k => k + '=' + (st.mined[k]/st.rounds).toFixed(1)).join(' ');
  console.log(zid.padEnd(12), '局=' + String(st.rounds).padStart(3), 'need=' + z.objective.ore + ':' + z.objective.need, '每局(' + rates + ')', '→ 建议 need=' + Math.round((st.mined[z.objective.ore]||0)/st.rounds*22));
}
console.log('总轮数=' + rounds + ' 通关=' + done + ' 天赋=' + buys.length);
const maxPer = Math.max(...Object.values(perRound));
console.log('单局购买 最大=' + maxPer + ' 分布=' + JSON.stringify(Object.values(perRound).reduce((m,v)=>{m[v]=(m[v]||0)+1;return m;},{})));
const byRound = {};
for (const b of buys) (byRound[b.round] = byRound[b.round] || []).push(b.id);
for (const k of Object.keys(byRound)) if (byRound[k].length >= 3) console.log('  多买局 round=' + k + ' ' + byRound[k].join(','));
console.log('买空轮次=' + (buys.length ? buys[buys.length-1].round : 0));
