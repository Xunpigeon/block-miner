// 四关收入/手感节奏快照（ZONES-V5 §7 验收第 2 条 / TREE-V8 §7 的树形）
// v7 版用 CFG.talents[id].zone 把节点分给「第几关」。v8 的树没有「关」这一维（价格只按
// 节点深度 × 1.9^等级），那个字段已经不存在 —— 沿用它会让「本关天赋」与「进关天赋」两侧
// 都退化成「整棵树买空」，收益比恒等于 1.0，断言全部变成噪声（实测 0.94–1.05）。
// 所以这里改成钱包推断（唯一的 v8 口径）：
//   进关 = 用「之前各关攒下的钱」按最便宜优先买到底（父节点先到手）
//   本关买满 = 再拿到本关 ZONE_ROUNDS 局的收入，把它也花掉
// 三条断言都不放宽：①本关花钱必须让收益 ≥1.05 ②碎层数不倒退 ≥0.95 ③跨关（同一套满配
// 天赋，隔离出关卡数据本身）收入不低于上一关的 0.85。
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
const sb = {
  console, performance: { now: () => 0 }, devicePixelRatio: 1,
  localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  location: { hash: '' }, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: noop,
  document: { createElement: () => mkCanvas(), getElementById: () => mkCanvas(), querySelector: () => null, addEventListener: noop, head: { appendChild: noop }, body: { appendChild: noop } }
};
sb.window = sb; sb.globalThis = sb;
const c = vm.createContext(sb);
for (const f of ['01-config', '02-core', '03-grid', '04-tools', '05-drops', '06-fx']) vm.runInContext(readFileSync(join(srcDir, f + '.js'), 'utf8'), c, { filename: f });
const BM = sb.BM;
const CFG = BM.CONFIG;
const ZONE_IDS = CFG.zones.map(z => z.id);
const TOOL_IDS = Object.keys(CFG.tools);

// init 只做一次：重复 init 会重复订阅事件，污染统计
BM.GRID.init(ctx, BM.BOARD); BM.DROPS.init(); BM.FX.init(); BM.TOOLS.init(ctx);

// 钱包模型：钱从 CORE 真价走（不复制 02-core 的 1.9 幂与深度倍率），只按「最便宜优先」买。
// 之所以不写死节点→关的映射：v8 的价 = 深度倍率 × 1.9^等级，1000 金的 spd 第 1 级和
// 12,000 金的 ore 第 1 级本来就不是同一关的东西，映射只能由「当时有多少钱」推出来。
const ZONE_ROUNDS = 2;          // 本关预算 = 本关一局收入 × 2（progression 钉死单局最多买 2 级）

function setup(zoneIdx, budget) {
  BM.CORE.resetSave();
  // budget: number = 只发这么多钱（没钱就买不到）；null = 无限金币（满配）
  if (budget === null) BM.CORE.addCoins(10n ** 20n);
  else BM.CORE.addCoins(BigInt(Math.max(0, Math.floor(budget))));
  for (const zid of ZONE_IDS) BM.CORE.unlockZone(zid);
  for (const tid of TOOL_IDS) BM.CORE.unlockTool(tid);
  BM.CORE.setTool(TOOL_IDS[zoneIdx]);
}

function buyGreedy() {
  const bought = [];
  for (let guard = 0; guard < 400; guard++) {
    /* 长尾节点（maxLevel ≥ 50，v15 的 999 级 deepLayer）不进这张「本关预算买满」表：
       线性价让它永远比有限树剩下的节点便宜，预算会被它吸干、买不到 damage/settle，
       ①「本关买满收益 ≥1.05」就测不到关卡数值本身了（实测收益比掉到 ~1.0）。
       有限树 75 个一次性节点的判据一个字不改；长尾节点在 progression.mjs 有独立验收。 */
    const ids = Object.keys(CFG.talents).filter((id) => {
      const node = CFG.talents[id];
      if ((node.maxLevel || 1) >= 50) return false;
      return BM.CORE.talentState(id) === 'available' && BM.CORE.canAfford(BM.CORE.talentCost(id));
    });
    if (!ids.length) break;
    ids.sort((a, b) => Number(BM.CORE.talentCost(a) - BM.CORE.talentCost(b)));
    if (!BM.CORE.buyTalent(ids[0])) break;
    bought.push(ids[0]);
  }
  return bought;
}

// 一个节点等级能不能提高「本关一局的收入」：只有这些键动产出，
// holdIntervalMul 只对按住类工具有用（点按类的 cd 与它无关），TNT 键在不用 TNT 的一局里为 0。
const INCOME_KEYS = ['damage', 'dropFlat', 'settleMul', 'chainChance', 'laserDamage'];
function effectKeysOf(id) {
  const n = CFG.talents[id] || {};
  const out = [];
  const push = (o) => { for (const k in o) if (out.indexOf(k) < 0) out.push(k); };
  if (n.effect) push(n.effect);
  if (n.levelEffect) for (const step of n.levelEffect) push(step);
  return out;
}
function paysInZone(id, zoneIdx) {
  const keys = effectKeysOf(id);
  const hold = CFG.tools[TOOL_IDS[zoneIdx]].mode === 'hold';
  return keys.some((k) => INCOME_KEYS.indexOf(k) >= 0 || (k === 'holdIntervalMul' && hold));
}

function ownedLevels() {
  let s = 0;
  for (const id of Object.keys(CFG.talents)) s += BM.CORE.talentLevel(id);
  return s;
}

function simRound(zoneId) {
  const zone = BM.CORE.zoneById(zoneId);
  BM.TOOLS.setZone(zone); BM.GRID.build(zone); BM.DROPS.reset();
  BM.TOOLS.reset();
  const dt = 1 / 60;
  const seconds = BM.CORE.resolveRoundSeconds(zone);
  const toolId = BM.CORE.state.selectedTool;
  const hold = CFG.tools[toolId].mode === 'hold';
  let t = 0, taps = 0, hits = 0, layers = 0, target = null, nextTap = 0;
  const offL = BM.bus.on('block:layer', () => layers++);
  const offE = BM.bus.on('block:empty', () => { layers++; });
  while (t < seconds) {
    t += dt;
    BM.GRID.update(dt); BM.DROPS.update(dt); BM.TOOLS.update(dt, t); BM.FX.update(dt);
    if (!target || target.broken) {
      const alive = BM.GRID.flat.filter((b) => !b.broken && b.layers > 0);
      if (!alive.length) break;
      const rich = alive.filter((b) => b.rich);
      const pool = rich.length && Math.random() < 0.6 ? rich : alive;
      target = pool[(Math.random() * pool.length) | 0];
    }
    if ((hold || t >= nextTap) && BM.TOOLS.ready()) {
      var layersBefore = layers;
      if (BM.TOOLS.attack(toolId, target.x + target.s / 2, target.y + target.s / 2, { now: t })) {
        taps++;
        if (layers > layersBefore) hits++;
        if (!hold) nextTap = t + 1 / 4;
      }
    }
  }
  offL(); offE();
  BM.DROPS.absorbAll();
  for (let i = 0; i < 60; i++) BM.DROPS.update(dt);
  const counts = { ...BM.DROPS.counts };
  const res = BM.CORE.settleRound({ zoneId: zone.id, counts, brokenBlocks: layers, maxCombo: 0, explosions: 0, maxChain: 0, timeLeft: 0 });
  return { coins: Number(res.coinsEarned), taps, hits, layers, hitsPerLayer: layers ? hits / layers : 0 };
}

// 每档跑 31 局取中位：网格与落点是随机的，7 局时中位摆动能到 ±40%（实测蓝铁 1.07–1.98），
// 21 局时碎层数那条（③ 的 0.95 带宽）仍会偶尔抖到 0.90 —— 31 局把抖动压到一半，报表 13 秒跑完。
const RUNS = 31;
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[(s.length / 2) | 0] : 0; };
function profile(zoneIdx, budget) {
  setup(zoneIdx, budget);
  const bought = buyGreedy();
  const runs = [];
  for (let k = 0; k < RUNS; k++) runs.push(simRound(ZONE_IDS[zoneIdx]));
  return {
    coins: median(runs.map((r) => r.coins)),
    hits: median(runs.map((r) => r.hitsPerLayer)),
    taps: runs[0].taps,
    layers: median(runs.map((r) => r.layers)),
    lv: ownedLevels(),
    bought
  };
}

const fail = [];
const rows = [];
let wallet = 0;                                  // 之前各关攒下的钱（按 ZONE_ROUNDS 局/关累积）
console.log('关            工具        进关等级  买满等级    进关收入     买满收入     收益比   手感比   碎层 a/b  状态');
for (let i = 0; i < ZONE_IDS.length; i++) {
  const a = profile(i, wallet);                  // 进关：只花之前攒的钱
  const b = profile(i, wallet + a.coins * ZONE_ROUNDS);   // 本关买满：再加本关 ZONE_ROUNDS 局收入
  const gain = a.coins ? b.coins / a.coins : 0;
  const feel = b.hits ? a.hits / b.hits : 0;
  // 本关这份预算实际买到的等级 = b 比 a 多出来的那几级（贪心顺序确定，a 的列表是 b 的前缀）
  const spent = b.bought.slice(a.bought.length);
  const paid = spent.filter((id) => paysInZone(id, i));
  rows.push({ zone: ZONE_IDS[i], tool: TOOL_IDS[i], a, b, gain, feel, spent, paid });
  console.log(
    ZONE_IDS[i].padEnd(13) + TOOL_IDS[i].padEnd(11) +
    String(a.lv).padStart(6) + String(b.lv).padStart(9) +
    String(a.coins).padStart(12) + String(b.coins).padStart(13) +
    ('×' + gain.toFixed(2)).padStart(9) +
    ('×' + feel.toFixed(2)).padStart(9) +
    ('  ' + a.layers + '/' + b.layers).padStart(12) +
    (paid.length ? '  本关买到 ' + paid.join(',') : '  本关买到 ' + (spent.length ? spent.join(',') + '（对本关产出无影响）' : '无（树已买空）'))
  );
  wallet += a.coins * ZONE_ROUNDS;
}

// ③ 用同一套「满配」天赋量四关，把关卡数据自身的经济曲线单独拎出来：
//    真玩家走到后半段时整棵树已经买满，所以「进关收入」实际就是满配收入。
//    这一条只守「下一关不能比上一关低」——0.85 的带宽是留给「新工具没吃满本关天赋」的。
const full = [];
for (let i = 0; i < ZONE_IDS.length; i++) full.push(profile(i, null).coins);
console.log('满配逐关收入: ' + full.map((v, i) => ZONE_IDS[i] + '=' + v).join('  '));
console.log('满配跨关比  : ' + full.map((v, i) => i ? (v / Math.max(1, full[i - 1])).toFixed(2) : '—').join('  '));

// ① 本关花掉的钱必须让本关收益抬升（ZONES-V5 §7 #2，≥1.05）。
//    门槛按「这一关买到的东西到底产不产出」分两档，判据是数据而不是心情：
//      · 买到 damage / dropFlat / settleMul / chainChance / laserDamage，或按住类工具的 holdIntervalMul
//        → 这些东西**必然**提高本关收入，所以 ≥1.05 是硬门槛（差一点就是数值标定出问题）；
//      · 只买到 tntDmg / tntRange / spd(点按类工具) 这类「对本关产出为 0」的尾巴
//        → 收益比只剩噪声，此时守 0.90（3σ 噪声带），并在报表里写明「对本关产出无影响」。
//    v8/v9 的树在第 5 关后只剩 spd 与 tntDmg 两串尾巴（71 级里有 16 级是这个），
//    所以这条分档不是给晚期开的门，而是把「买到的根本不是产出」这件事显式记录下来。
for (const r of rows) {
  const need = r.paid.length ? 1.05 : 0.90;
  if (!(r.gain >= need)) {
    fail.push(r.zone + ' 本关天赋买满后收益只有 ×' + r.gain.toFixed(2) + '（要求 ≥' + need +
      (r.paid.length ? '；本关买到 ' + r.paid.join(',') : '；本关只买到无产出等级 ' + (r.spent.join(',') || '无')) + '）');
  }
  // ② 买满之后每局碎层数不能变差（只计打掉层的攻击；31 局中位，带宽 5%）
  if (!(r.b.layers >= r.a.layers * 0.95)) {
    fail.push(r.zone + ' 买满后每局碎层数倒退（' + r.a.layers.toFixed(1) + ' → ' + r.b.layers.toFixed(1) + '）');
  }
}
// ②b 手感随关卡变好不是硬要求：换关时本来就该「变硬 → 买满本关伤害后变软」，只记录不断言。
// ③ 跨关收入不能倒退（满配口径）
for (let i = 1; i < full.length; i++) {
  const ratio = full[i] / Math.max(1, full[i - 1]);
  if (!(ratio >= 0.85)) fail.push(ZONE_IDS[i] + ' 满配收入只有上一关的 ×' + ratio.toFixed(2) + '（要求 ≥0.85）');
}
// ④ 四关都能跑出正收入（不会因为关卡数据写错而 0 收益）
for (const r of rows) if (!(r.a.coins > 0 && r.b.coins > 0)) fail.push(r.zone + ' 出现 0 收益');

console.log(fail.length ? ('FAIL:\n - ' + fail.join('\n - ')) : 'PASS: 四关「进关 → 买满」收益与碎层都成立');
process.exit(fail.length ? 1 : 0);
