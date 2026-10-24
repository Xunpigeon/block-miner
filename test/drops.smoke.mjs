/* test/drops.smoke.mjs —— 05-drops.js 逐层掉落冒烟
 * 真实加载 src/01-config.js（真事件总线 + 真 CONFIG.ores）与 src/05-drops.js；
 * GRID / CORE / TOOLS 用契约形状的桩，事件由测试直接按 v2 payload 派发。 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const CONFIG_SRC = readFileSync(join(root, 'src', '01-config.js'), 'utf8');
const DROPS_SRC = readFileSync(join(root, 'src', '05-drops.js'), 'utf8');

let pass = 0;
const fails = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fails.push(name); console.log('  FAIL ' + name + (extra === undefined ? '' : ' >> ' + extra)); }
}
function section(name) { console.log('\n# ' + name); }

function fixedRandom(v) {
  const orig = Math.random;
  Math.random = () => v;
  return () => { Math.random = orig; };
}
function seedRandom(seed) {
  let a = seed >>> 0;
  const orig = Math.random;
  Math.random = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => { Math.random = orig; };
}

// 假 ART（00-art.js 契约）：记录请求的键与次数；returnNull 模拟「有模块但图未解码」
function makeArt(returnNull) {
  let calls = 0;
  const seen = new Set();
  const img = { width: 16, height: 16, fake: true };
  return {
    seen,
    one(key) { calls++; seen.add(key); return returnNull ? null : img; },
    all() { return returnNull ? [] : [img]; },
    has() { return !returnNull; },
    progress() { return returnNull ? 0 : 1; },
    get calls() { return calls; }
  };
}

// 只统计 05-drops 用到的绘制入口
function makeDrawCtx() {
  const c = { drawImage: 0, fillRect: 0, strokeRect: 0, stroke: 0, save: 0, restore: 0 };
  const ctx = {
    globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
    save() { c.save++; }, restore() { c.restore++; },
    beginPath() {}, moveTo() {}, lineTo() {},
    stroke() { c.stroke++; }, fillRect() { c.fillRect++; },
    strokeRect() { c.strokeRect++; }, drawImage() { c.drawImage++; }
  };
  return { ctx, c };
}

// 每个 world 一套干净上下文：真 01-config + 真 05-drops
function world(opt = {}) {
  const warns = [];
  const sandbox = {
    Math, Date, Object, Array, JSON, Number, String, isFinite, isNaN, parseInt, parseFloat,
    console: { log() {}, warn(...a) { warns.push(a.join(' ')); }, error(...a) { warns.push(a.join(' ')); } }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CONFIG_SRC, sandbox, { filename: '01-config.js' });
  const BM = sandbox.BM;
  if (opt.art) BM.ART = opt.art;
  if (opt.document) sandbox.document = opt.document;
  const mods = Object.assign({
    damage: 0, holdIntervalMul: 1, oreRateBonus: 0, extraLayers: 0,
    dropFlat: 0, dropMul: 1, richMul: 1, richRateBonus: 0,
    magnetSpeedMul: 1, magnetRadiusMul: 1,
    chainChance: 0, multiStrikeEvery: 0, multiStrikeMul: 0.5, overkillTransfer: 0,
    frenzyDropMul: 1.5, frenzySeconds: 4, roundSeconds: 30,
    tntLayerPierce: 4
  }, opt.mods || {});
  BM.CORE = { mods: () => mods };
  BM.TOOLS = { frenzyMult: 1 };
  const spawned = [];
  BM.bus.on('drop:spawn', (d) => spawned.push(d));
  const absorbed = [];
  BM.bus.on('drop:absorb', (d) => absorbed.push(d));
  vm.runInContext(DROPS_SRC, sandbox, { filename: '05-drops.js' });
  BM.DROPS.init();
  return {
    BM, DROPS: BM.DROPS, bus: BM.bus, mods, spawned, absorbed, warns,
    emit(t, d) { BM.bus.emit(t, d); },
    drain(frames = 400) {
      for (let i = 0; i < frames && BM.DROPS.inFlight > 0; i++) BM.DROPS.update(1 / 60);
    }
  };
}

// 一个 v2 形状的矿格；depth = 已经挖掉的层数（GRID 在派发前已 +1）
function cell(ore, rich, depth, ox = 2, oy = 3, extra = {}) {
  return Object.assign({
    ox, oy, x: 10 + ox * 60, y: 96 + oy * 60, s: 60,
    ore, rich: !!rich, maxHp: 3, hp: 3, depth,
    layers: 8 - depth, totalLayers: 8, broken: false,
    crack: 0, hitT: 0, hitDir: 0, seed: 1, appearT: 1
  }, extra);
}
// 从真 CONFIG 读掉落区间：v3 §2 的表格允许写成单值（铁 3/5、晶 2/4）或区间，测试不写死数字
function rng(w, ore, rich) {
  const o = w.BM.CONFIG.ores[ore];
  const pair = (v, fb) => {
    if (typeof v === 'number') return [Math.round(v), Math.round(v)];
    if (Array.isArray(v)) { const lo = Math.round(v[0]); return [lo, Math.round(v[1] === undefined ? lo : v[1])]; }
    return fb;
  };
  const base = pair(o.drop, [1, 1]);
  return rich ? pair(o.richDrop, base) : base;
}
// fixedRandom 采样端点：0 → 区间下沿，0.999 → 区间上沿
const LO = 0, HI = 0.999;

// 打穿第 n 层（1 起）的事件：block 已是下一层数据，prev 才是刚碎掉那层
function punch(w, b, ore, rich) {
  const next = cell(b.ore, b.rich, b.depth, b.ox, b.oy);
  w.emit('block:layer', { block: next, depth: next.depth, prev: { ore, rich: !!rich, maxHp: 3 } });
  return next;
}

/* ============================ 1. 订阅与单层掉落 ============================ */
section('1. 订阅 block:layer / block:break / block:empty，打穿一层掉一层');
{
  const w = world();
  const b = cell('coal', false, 1);
  w.emit('block:layer', { block: b, depth: 1, prev: { ore: 'coal', rich: false, maxHp: 1 } });
  ok(w.spawned.length === 1, 'block:layer 产生一次 drop:spawn（实际 ' + w.spawned.length + '）');
  const sp = w.spawned[0] || {};
  ok(sp.ore === 'coal', 'ore = coal', sp.ore);
  const cr = rng(w, 'coal', false);
  ok(sp.amount >= cr[0] && sp.amount <= cr[1], '普通煤掉落落在 CONFIG drop 区间 ' + cr.join('-') + '（实际 ' + sp.amount + '）');
  ok(Number.isInteger(sp.amount), '数量是整数');
  ok(sp.x === 10 + 2 * 60 + 30 && sp.y === 96 + 3 * 60 + 30, '坐标取格中心', sp.x + ',' + sp.y);
  ok(sp.rich === false, 'rich = false');

  const w2 = world();
  w2.emit('block:break', { block: cell('iron', false, 8, 4, 4, { layers: 0, broken: true }), ore: 'iron', rich: false, chain: 0, prev: { ore: 'iron', rich: false, maxHp: 4 } });
  ok(w2.spawned.length === 1, 'block:break 也产生掉落（实际 ' + w2.spawned.length + '）');
  const ir = rng(w2, 'iron', false);
  ok(w2.spawned[0].amount >= ir[0] && w2.spawned[0].amount <= ir[1], '铁矿落在 CONFIG drop 区间 ' + ir.join('-') + '（实际 ' + w2.spawned[0].amount + '）');

  const w3 = world();
  w3.emit('block:empty', { block: cell('stone', false, 8, 5, 5, { layers: 0, broken: true }) });
  ok(w3.spawned.length === 1, 'block:empty 单独到达也产生掉落（实际 ' + w3.spawned.length + '）');
  ok(w3.spawned[0].ore === 'stone', '没有 prev 时退回 block.ore', w3.spawned[0].ore);
  ok(w.warns.length + w2.warns.length + w3.warns.length === 0, '订阅者无抛错', w.warns.join('|') + w2.warns.join('|') + w3.warns.join('|'));
}

/* ============================ 2. prev 是刚碎掉那层的矿（最关键） ============================ */
section('2. 用 prev 计算掉落：碎掉的是煤就掉煤，不是新层的石头');
{
  const w = world();
  const b = cell('coal', false, 1, 3, 2);
  // GRID 语义：block 已换成下一层（石头），prev 才是刚打碎的煤
  const next = cell('stone', false, 1, 3, 2);
  w.emit('block:layer', { block: next, depth: 1, prev: { ore: 'coal', rich: false, maxHp: 1 } });
  ok(w.spawned.length === 1, '掉一份');
  ok(w.spawned[0].ore === 'coal', 'prev.ore = coal → 掉的是煤（不是石头）', w.spawned[0].ore);
  const cr2 = rng(w, 'coal', false);
  ok(w.spawned[0].amount >= cr2[0] && w.spawned[0].amount <= cr2[1], '按煤矿 CONFIG 区间 ' + cr2.join('-') + ' 结算（实际 ' + w.spawned[0].amount + '）');
  ok(b.ore === 'coal' && next.ore === 'stone', '测试前提：block 确实已换新层');

  // 富矿标记也跟 prev 走
  const w2 = world();
  w2.emit('block:layer', { block: cell('stone', false, 1), depth: 1, prev: { ore: 'stone', rich: true, maxHp: 3 } });
  ok(w2.spawned[0].rich === true, 'prev.rich = true → 按富矿结算', w2.spawned[0].rich);
  const sr = rng(w2, 'stone', true);
  ok(w2.spawned[0].amount >= sr[0] && w2.spawned[0].amount <= sr[1], '富矿石头落在 CONFIG richDrop 区间 ' + sr.join('-') + '（实际 ' + w2.spawned[0].amount + '）');

  // 没有 prev 的旧派发：退回 block.ore / block.rich，不崩
  const w3 = world();
  w3.emit('block:layer', { block: cell('iron', true, 1), depth: 1 });
  ok(w3.spawned.length === 1 && w3.spawned[0].ore === 'iron', '无 prev 时用 block.ore 兜底', JSON.stringify(w3.spawned[0] || null));
  ok(w3.warns.length === 0, '旧 payload 不抛错', w3.warns.join('|'));

  // 连 x/y/s/depth 都缺的残破 payload：不崩、不产生 NaN
  const w4 = world();
  const rest = fixedRandom(0.5);
  w4.emit('block:layer', { block: { ore: 'coal' } });
  rest();
  ok(w4.spawned.length === 1, '残缺 payload 仍掉一份（不崩）', String(w4.spawned.length));
  ok(Number.isFinite(w4.spawned[0].x) && Number.isFinite(w4.spawned[0].y), '坐标是有限数', w4.spawned[0].x + ',' + w4.spawned[0].y);
  w4.drain(600);
  ok(w4.DROPS.inFlight === 0, '残缺 payload 的掉落也能被吸走（不卡场）', String(w4.DROPS.inFlight));
}

/* ============================ 3. 整格挖空 = 层数份掉落 ============================ */
section('3. 完整挖空一格：layer×(n-1) + break + empty = n 份掉落');
{
  const N = 7;
  const w = world();
  const r = seedRandom(20240607);
  let b = cell('coal', false, 0, 1, 1, { layers: N, totalLayers: N });
  for (let i = 1; i < N; i++) b = punch(w, b, 'coal', false);
  const last = cell('coal', false, N, 1, 1, { layers: 0, broken: true, totalLayers: N });
  w.emit('block:break', { block: last, ore: 'coal', rich: false, chain: 0, prev: { ore: 'coal', rich: false, maxHp: 1 } });
  w.emit('block:empty', { block: last });
  r();
  ok(w.spawned.length === N, N + ' 层 → ' + N + ' 份掉落（实际 ' + w.spawned.length + '）');
  const total = w.spawned.reduce((s, d) => s + d.amount, 0);
  const lo = N * 1, hi = N * 2;
  ok(total >= lo && total <= hi, '总量落在 ' + lo + '..' + hi + '（实际 ' + total + '）');
  ok(w.spawned.every(d => d.amount >= 1 && d.amount <= 2), '每份都在煤矿区间内');
  w.drain();
  ok(w.DROPS.counts.coal === total, '入包总量 = 掉落总量（实际 ' + w.DROPS.counts.coal + '）');
}

/* ============================ 4. 同帧去重 ============================ */
section('4. 同帧同格同层只掉一次');
{
  const w = world();
  const b = cell('coal', false, 8, 2, 2, { layers: 0, broken: true });
  w.emit('block:break', { block: b, ore: 'coal', rich: false, chain: 0, prev: { ore: 'coal', rich: false, maxHp: 1 } });
  w.emit('block:empty', { block: b });
  ok(w.spawned.length === 1, 'break + empty 同帧同格 → 只掉 1 份（实际 ' + w.spawned.length + '）');

  const w2 = world();
  const b2 = cell('stone', false, 1, 2, 2);
  w2.emit('block:layer', { block: b2, depth: 1, prev: { ore: 'stone', rich: false, maxHp: 3 } });
  w2.emit('block:empty', { block: b2 });
  ok(w2.spawned.length === 1, 'layer + empty 同帧同格 → 只掉 1 份（实际 ' + w2.spawned.length + '）');

  const w3 = world();
  w3.emit('block:break', { block: cell('stone', false, 8, 0, 0, { layers: 0 }), ore: 'stone', rich: false, chain: 0 });
  w3.emit('block:empty', { block: cell('stone', false, 8, 1, 0, { layers: 0 }) });
  ok(w3.spawned.length === 2, '同帧不同格各掉一份（不去重过量，实际 ' + w3.spawned.length + '）');

  // TNT：同一格同帧连穿多层，逐层都要掉
  const w4 = world();
  w4.emit('block:layer', { block: cell('iron', false, 1), depth: 1, prev: { ore: 'iron', rich: false, maxHp: 4 } });
  w4.emit('block:layer', { block: cell('iron', false, 2), depth: 2, prev: { ore: 'iron', rich: false, maxHp: 4 } });
  const fin = cell('iron', false, 3, 2, 3, { layers: 0, broken: true });
  w4.emit('block:break', { block: fin, ore: 'iron', rich: false, chain: 0, prev: { ore: 'iron', rich: false, maxHp: 4 } });
  w4.emit('block:empty', { block: fin });
  ok(w4.spawned.length === 3, '同帧连穿 3 层 → 3 份掉落（实际 ' + w4.spawned.length + '）');

  // 换帧后同一层号再次打穿（新棋盘）不会误杀
  const w5 = world();
  const c5 = cell('coal', false, 1, 4, 4);
  w5.emit('block:layer', { block: c5, depth: 1, prev: { ore: 'coal', rich: false, maxHp: 1 } });
  w5.DROPS.update(1 / 60);
  w5.emit('block:layer', { block: cell('coal', false, 1, 4, 4), depth: 1, prev: { ore: 'coal', rich: false, maxHp: 1 } });
  ok(w5.spawned.length === 2, '换帧后同格同层各算一次（实际 ' + w5.spawned.length + '）');

  const w6 = world();
  w6.emit('block:break', { block: cell('stone', false, 8, 0, 0, { layers: 0 }), ore: 'stone', rich: false, chain: 0 });
  w6.emit('block:empty', { block: cell('stone', false, 8, 0, 0, { layers: 0 }) });
  ok(w6.spawned.length === 1, '同格不同对象的副本也去重（实际 ' + w6.spawned.length + '）');
  w6.DROPS.reset();
  w6.emit('block:break', { block: cell('stone', false, 8, 0, 0, { layers: 0 }), ore: 'stone', rich: false, chain: 0 });
  ok(w6.spawned.length === 2, 'reset() 后去重记录清空（实际 ' + w6.spawned.length + '）');
}

/* ============================ 5. 富矿口径 ============================ */
section('5. 富矿 = richDrop 本身（不叠乘 3 倍），且 × mods.richMul');
{
  const w = world();
  const rd = rng(w, 'coal', true);
  const nrm = rng(w, 'coal', false);

  const lo = world();
  const r = fixedRandom(LO);
  lo.emit('block:layer', { block: cell('coal', true, 1), depth: 1, prev: { ore: 'coal', rich: true, maxHp: 1 } });
  r();
  ok(lo.spawned[0].amount === rd[0], '富矿煤下沿 = richDrop 下沿 ' + rd[0] + '（v2 旧口径会再 ×3）', lo.spawned[0].amount);

  const hi = world();
  const r2 = fixedRandom(HI);
  hi.emit('block:layer', { block: cell('coal', true, 1), depth: 1, prev: { ore: 'coal', rich: true, maxHp: 1 } });
  r2();
  ok(hi.spawned[0].amount === rd[1], '富矿煤上沿 = richDrop 上沿 ' + rd[1], hi.spawned[0].amount);

  const iron = world();
  const ird = rng(iron, 'iron', true);
  const r3 = seedRandom(7);
  let minA = Infinity, maxA = 0;
  for (let i = 0; i < 300; i++) {
    iron.emit('block:layer', { block: cell('iron', true, i + 1, i % 6, (i / 6) | 0), depth: i + 1, prev: { ore: 'iron', rich: true, maxHp: 4 } });
  }
  r3();
  for (const d of iron.spawned) { minA = Math.min(minA, d.amount); maxA = Math.max(maxA, d.amount); }
  ok(minA >= ird[0] && maxA <= ird[1], '富矿铁全部落在 CONFIG richDrop ' + ird.join('..') + '（实际 ' + minA + '..' + maxA + '）');
  if (ird[0] < ird[1]) ok(minA < ird[1] && maxA > ird[0], '区间被真正采样到（不是常数）', minA + '..' + maxA);
  else ok(minA === ird[0] && maxA === ird[0], '单值 richDrop → 恒定值', minA + '..' + maxA);

  // 普通格不吃 richDrop
  const norm = world();
  const r4 = fixedRandom(HI);
  norm.emit('block:layer', { block: cell('iron', false, 1), depth: 1, prev: { ore: 'iron', rich: false, maxHp: 4 } });
  r4();
  ok(norm.spawned[0].amount === rng(norm, 'iron', false)[1], '普通铁矿走上沿 ' + rng(norm, 'iron', false)[1] + '，不是富矿区间', norm.spawned[0].amount);
  ok(norm.spawned[0].amount !== rd[1] || nrm[1] === rd[1], '普通格没有取富矿口径', norm.spawned[0].amount);

  // 富矿天赋：richMul 只乘富矿格
  const plainRich = world({ mods: { richMul: 1 } });
  const r5 = fixedRandom(LO);
  plainRich.emit('block:layer', { block: cell('stone', true, 1), depth: 1, prev: { ore: 'stone', rich: true, maxHp: 3 } });
  r5();
  const srd = rng(plainRich, 'stone', true);
  ok(plainRich.spawned[0].amount === srd[0], 'richMul=1 → 富矿石头 = richDrop 下沿 ' + srd[0], plainRich.spawned[0].amount);

  const richMul15 = world({ mods: { richMul: 1.5 } });
  const r6 = fixedRandom(LO);
  richMul15.emit('block:layer', { block: cell('stone', true, 1), depth: 1, prev: { ore: 'stone', rich: true, maxHp: 3 } });
  r6();
  ok(richMul15.spawned[0].amount === Math.floor(srd[0] * 1.5), 'richMul=1.5 → ' + Math.floor(srd[0] * 1.5) + '（富矿天赋生效）', richMul15.spawned[0].amount);

  const richMul3 = world({ mods: { richMul: 3 } });
  const r7 = fixedRandom(LO);
  richMul3.emit('block:layer', { block: cell('stone', false, 1), depth: 1, prev: { ore: 'stone', rich: false, maxHp: 3 } });
  r7();
  const snd = rng(richMul3, 'stone', false);
  ok(richMul3.spawned[0].amount === snd[0], 'richMul 不碰普通格（普通石头仍是 ' + snd[0] + '）', richMul3.spawned[0].amount);
}

/* ============================ 6. dropFlat 保留；dropMul / 狂热倍率不再进数量 ============================ */
section('6. dropFlat 加法生效；dropMul / 狂热等额外倍率不再乘（BALANCE-V4 §4）');
{
  const snd = rng(world(), 'stone', false);        // 基准区间来自真 CONFIG，不写死数字
  const r0 = fixedRandom(LO);
  const probe = world();
  probe.emit('block:layer', { block: cell('stone', false, 1), depth: 1, prev: { ore: 'stone', rich: false, maxHp: 3 } });
  r0();

  const flat = world({ mods: { dropFlat: 2 } });
  const r = fixedRandom(LO);
  flat.emit('block:layer', { block: cell('stone', false, 1), depth: 1, prev: { ore: 'stone', rich: false, maxHp: 3 } });
  r();
  ok(flat.spawned[0].amount === snd[0] + 2, snd[0] + ' + dropFlat 2 = ' + (snd[0] + 2), flat.spawned[0].amount);

  const mul = world({ mods: { dropFlat: 2, dropMul: 1.5 } });
  const r2 = fixedRandom(LO);
  mul.emit('block:layer', { block: cell('stone', false, 1), depth: 1, prev: { ore: 'stone', rich: false, maxHp: 3 } });
  r2();
  ok(mul.spawned[0].amount === snd[0] + 2, 'dropMul 1.5 不再叠乘 → ' + (snd[0] + 2), mul.spawned[0].amount);

  const fren = world({ mods: { dropFlat: 2, dropMul: 1.5 } });
  fren.BM.TOOLS.frenzyMult = 2;
  const r3 = fixedRandom(LO);
  fren.emit('block:layer', { block: cell('stone', false, 1), depth: 1, prev: { ore: 'stone', rich: false, maxHp: 3 } });
  r3();
  ok(fren.spawned[0].amount === snd[0] + 2, '狂热倍率不进掉落数量 → ' + (snd[0] + 2), fren.spawned[0].amount);
  ok(fren.BM.TOOLS.frenzyMult === 2, '狂热倍率仍对外可见（表现层用）', String(fren.BM.TOOLS.frenzyMult));

  const ird = rng(world(), 'iron', true);
  const big = world({ mods: { dropMul: 5 } });
  const rBig = fixedRandom(LO);
  big.emit('block:layer', { block: cell('iron', true, 1), depth: 1, prev: { ore: 'iron', rich: true, maxHp: 4 } });
  rBig();
  ok(big.spawned[0].amount === ird[0], 'dropMul 5 不放大富矿（= richDrop 下沿 ' + ird[0] + '）', big.spawned[0].amount);

  const zero = world({ mods: { dropMul: 0 } });
  const rZero = fixedRandom(LO);
  zero.emit('block:layer', { block: cell('iron', true, 1), depth: 1, prev: { ore: 'iron', rich: true, maxHp: 4 } });
  rZero();
  ok(zero.spawned[0].amount === ird[0], 'dropMul=0 也不削减（富矿铁仍是 ' + ird[0] + '）', zero.spawned[0].amount);

  const flo = world({ mods: { dropFlat: 1, dropMul: 1.15 } });
  const r4 = fixedRandom(HI);
  flo.emit('block:layer', { block: cell('stone', false, 1), depth: 1, prev: { ore: 'stone', rich: false, maxHp: 3 } });
  r4();
  ok(flo.spawned[0].amount === snd[1] + 1, '上沿 ' + snd[1] + ' + dropFlat 1 = ' + (snd[1] + 1), flo.spawned[0].amount);

  // 升级 / 狂热在事件路径上立刻生效（不读旧缓存）
  const live = world({ mods: { dropFlat: 0 } });
  const coal = rng(live, 'coal', false);
  const r5 = fixedRandom(LO);
  live.emit('block:layer', { block: cell('coal', false, 1), depth: 1, prev: { ore: 'coal', rich: false, maxHp: 1 } });
  live.mods.dropFlat = 4;
  live.emit('block:layer', { block: cell('coal', false, 2, 2, 3), depth: 2, prev: { ore: 'coal', rich: false, maxHp: 1 } });
  r5();
  ok(live.spawned[0].amount === coal[0] && live.spawned[1].amount === coal[0] + 4,
    '改 dropFlat 后立刻生效（' + coal[0] + ' → ' + (coal[0] + 4) + '）', live.spawned.map(d => d.amount).join(','));
  ok(probe.spawned[0].amount === snd[0], '基准探测与 snd 一致', probe.spawned[0].amount);
}

/* ============================ 7. 240 上限 + absorbAll 不漏 ============================ */
section('7. 240 上限合并后 absorbAll 不丢数量');
{
  const w = world({ mods: { dropFlat: 1 } });
  const r = seedRandom(4242);
  let maxInFlight = 0;
  for (let i = 0; i < 300; i++) {
    const b = cell(i % 3 === 0 ? 'iron' : 'stone', i % 5 === 0, i + 1, i % 6, ((i / 6) | 0) % 8);
    w.emit('block:layer', {
      block: b, depth: b.depth,
      prev: { ore: i % 3 === 0 ? 'iron' : 'stone', rich: i % 5 === 0, maxHp: 3 }
    });
    if (w.DROPS.inFlight > maxInFlight) maxInFlight = w.DROPS.inFlight;
  }
  r();
  const expect = w.spawned.reduce((s, d) => s + d.amount, 0);
  ok(w.spawned.length === 300, '300 次打穿 → 300 份掉落（实际 ' + w.spawned.length + '）');
  ok(maxInFlight === 240, '场上掉落上限 240（实际 ' + maxInFlight + '）');
  w.DROPS.absorbAll();
  const got = Object.values(w.DROPS.counts).reduce((a, b) => a + b, 0);
  ok(got === expect, 'absorbAll 后总量与掉落总量完全一致（' + got + ' vs ' + expect + '）');
  ok(w.DROPS.inFlight === 0, 'absorbAll 后场上清空');
  ok(w.absorbed.length === 240, 'absorbAll 为场上 240 个掉落各派发一次 drop:absorb（实际 ' + w.absorbed.length + '）');
  const countsRef = w.DROPS.counts;
  w.DROPS.reset();
  ok(w.DROPS.counts === countsRef && Object.keys(w.DROPS.counts).length === 0, 'reset() 原地清空计数');
}

/* ============================ 8. 磁吸链路 ============================ */
section('8. 逐层掉落能被磁吸完整吸走');
{
  const w = world({ mods: { magnetSpeedMul: 1 } });
  const N = 8;
  let b = cell('coal', false, 0, 3, 3, { layers: N, totalLayers: N });
  for (let i = 1; i < N; i++) b = punch(w, b, 'coal', false);
  const last = cell('coal', false, N, 3, 3, { layers: 0, broken: true, totalLayers: N });
  w.emit('block:break', { block: last, ore: 'coal', rich: false, chain: 0, prev: { ore: 'coal', rich: false, maxHp: 1 } });
  w.emit('block:empty', { block: last });
  const expect = w.spawned.reduce((s, d) => s + d.amount, 0);
  let frames = 0;
  while (w.DROPS.inFlight > 0 && frames < 600) { w.DROPS.update(1 / 60); frames++; }
  ok(frames > 0 && frames < 180, '全部吸完 < 3 秒（实际 ' + frames + ' 帧）', frames);
  ok(w.DROPS.counts.coal === expect, '入包数量 = 掉落数量（' + w.DROPS.counts.coal + ' vs ' + expect + '）');
  ok(w.warns.length === 0, '整局无订阅者抛错', w.warns.join('|'));
}

/* ============================ 9. v3 掉落口径 ============================ */
section('9. v3 §2 口径：单值 drop/richDrop 与新矿种晶石');
{
  // 真 CONFIG 由 __other__ 负责改成 v3 数值；这里注入同形状矿石验证「单值」与「区间」都能读
  const CRYSTAL = { id: 'crystal', name: '晶石', price: 400, hp: 40, drop: 2, richDrop: 4, vein: '#8fe6ff', glow: '#d8f6ff' };

  const w = world();
  w.BM.CONFIG.ores.crystal = Object.assign({}, CRYSTAL);
  const r = fixedRandom(0.5);
  w.emit('block:layer', { block: cell('crystal', false, 1), depth: 1, prev: { ore: 'crystal', rich: false, maxHp: 40 } });
  r();
  ok(w.spawned[0].ore === 'crystal', '晶石掉落读 CONFIG.ores.crystal', w.spawned[0].ore);
  ok(w.spawned[0].amount === 2, '单值 drop 2 → 每层掉 2', w.spawned[0].amount);

  const wr = world();
  wr.BM.CONFIG.ores.crystal = Object.assign({}, CRYSTAL);
  const r2 = fixedRandom(0.5);
  wr.emit('block:layer', { block: cell('crystal', true, 1), depth: 1, prev: { ore: 'crystal', rich: true, maxHp: 40 } });
  r2();
  ok(wr.spawned[0].amount === 4, '单值 richDrop 4 → 富矿掉 4（不叠乘 3 倍）', wr.spawned[0].amount);
  ok(wr.spawned[0].rich === true, '富矿标记随 prev 传递', String(wr.spawned[0].rich));

  const range = world();
  range.BM.CONFIG.ores.crystal = Object.assign({}, CRYSTAL, { drop: [2, 4], richDrop: [4, 6] });
  const r3 = fixedRandom(LO);
  range.emit('block:layer', { block: cell('crystal', false, 1), depth: 1, prev: { ore: 'crystal', rich: false, maxHp: 40 } });
  const r4 = fixedRandom(HI);
  range.emit('block:layer', { block: cell('crystal', true, 2, 3, 3), depth: 2, prev: { ore: 'crystal', rich: true, maxHp: 40 } });
  r3(); r4();
  ok(range.spawned[0].amount === 2 && range.spawned[1].amount === 6,
    '区间写法照旧生效（普通下沿 2 / 富矿上沿 6）', range.spawned.map(d => d.amount).join(','));

  // 富矿天赋与晶石叠加：4 × richMul 1.5 → 6
  const tal = world({ mods: { richMul: 1.5 } });
  tal.BM.CONFIG.ores.crystal = Object.assign({}, CRYSTAL);
  const r5 = fixedRandom(0.5);
  tal.emit('block:layer', { block: cell('crystal', true, 1), depth: 1, prev: { ore: 'crystal', rich: true, maxHp: 40 } });
  r5();
  ok(tal.spawned[0].amount === 6, '晶石富矿 4 × richMul 1.5 = 6', tal.spawned[0].amount);
}

section('10. 掉落物贴图：注入 ART 走 drawImage，缺失 / 未解码回退方块');
{
  const art = makeArt(false);
  const w = world({ art });
  w.emit('block:layer', { block: cell('coal', false, 1), depth: 1, prev: { ore: 'coal', rich: false, maxHp: 3 } });
  w.emit('block:layer', { block: cell('iron', true, 1, 4, 5), depth: 1, prev: { ore: 'iron', rich: true, maxHp: 3 } });
  const n = w.DROPS.inFlight;
  ok(n === 2, '两颗掉落物在场', String(n));

  const d1 = makeDrawCtx();
  w.DROPS.draw(d1.ctx);
  ok(d1.c.drawImage === n, '每颗掉落物画一次贴图', d1.c.drawImage + ' vs ' + n);
  ok(d1.c.fillRect === 0 && d1.c.strokeRect === 0, '有贴图时不再画代码方块', JSON.stringify(d1.c));
  ok(d1.c.stroke > 0, '拖尾亮线保留', String(d1.c.stroke));
  ok(art.seen.has('drops.coal') && art.seen.has('drops.iron'), '键按 drops.<ore> 取', [...art.seen].join(','));
  ok(w.warns.length === 0, '贴图路径不抛错', w.warns.join('|'));

  // 键与句柄按 ore 缓存：第二帧不再访问 ART
  const before = art.calls;
  const d2 = makeDrawCtx();
  w.DROPS.draw(d2.ctx);
  ok(d2.c.drawImage === n, '第二次绘制仍用贴图', String(d2.c.drawImage));
  ok(art.calls === before, 'draw 内不重复解析贴图键（按 ore 缓存）', before + ' -> ' + art.calls);

  // 无 ART：回退方块
  const plain = world();
  plain.emit('block:layer', { block: cell('coal', false, 1), depth: 1, prev: { ore: 'coal', rich: false, maxHp: 3 } });
  const d3 = makeDrawCtx();
  plain.DROPS.draw(d3.ctx);
  ok(d3.c.drawImage === 0 && d3.c.fillRect === 1 && d3.c.strokeRect === 1, '无 ART 时回退代码方块', JSON.stringify(d3.c));

  // 有 ART 但图未解码：同样回退
  const nl = world({ art: makeArt(true) });
  nl.emit('block:layer', { block: cell('iron', false, 1), depth: 1, prev: { ore: 'iron', rich: false, maxHp: 3 } });
  const d4 = makeDrawCtx();
  nl.DROPS.draw(d4.ctx);
  ok(d4.c.drawImage === 0 && d4.c.fillRect === 1, 'ART 未解码时回退代码方块', JSON.stringify(d4.c));
}


section('11. 金矿（v10）：掉落图复用煤矿并金色化，颜色明显区别于煤矿');
{
  const hueSat = (rgb) => {
    const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d > 0.0001) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return { h, s: mx > 0 ? d / mx : 0 };
  };
  const rgbOf = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

  // 记录 fillStyle / drawImage 的自定义 ctx（makeDrawCtx 只记次数）
  function makeLogCtx() {
    const log = { fill: [], draw: [] };
    const ctx = {
      globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
      stroke() {}, strokeRect() {},
      fillRect() { log.fill.push(ctx.fillStyle); },
      drawImage(img, x, y, w, h) { log.draw.push({ img, x, y, w, h }); }
    };
    return { ctx, log };
  }

  const p0 = world();
  const goldCfg = p0.BM.CONFIG.ores.gold;
  ok(!!goldCfg && goldCfg.price === 150, 'CONFIG.ores.gold 单价 150', goldCfg && String(goldCfg.price));
  ok(goldCfg.name === '金矿' && goldCfg.vein === '#ffc857', '金矿名称与主色 #ffc857', goldCfg.name + '/' + goldCfg.vein);
  ok(goldCfg.drop.join('-') === '1-1' && goldCfg.richDrop.join('-') === '2-2', '金矿普通掉 1 / 富矿掉 2', goldCfg.drop + '|' + goldCfg.richDrop);

  // 无 ART：金矿掉落回退成金色实心方块（fillStyle 取 CONFIG 的 vein）
  p0.emit('block:layer', { block: cell('gold', false, 1), depth: 1, prev: { ore: 'gold', rich: false, maxHp: 24 } });
  const n0 = makeLogCtx();
  p0.DROPS.draw(n0.ctx);
  ok(n0.log.draw.length === 0 && n0.log.fill.length === 1, '无 ART 时金矿掉落画代码方块', JSON.stringify([n0.log.draw.length, n0.log.fill.length]));
  ok(n0.log.fill[0] === goldCfg.vein, '金矿方块用 #ffc857（与煤矿 #171717 一眼区分）', n0.log.fill[0]);
  const hsGoldFill = hueSat(rgbOf(goldCfg.vein));
  const hsCoalFill = hueSat(rgbOf(p0.BM.CONFIG.ores.coal.vein));
  ok(hsGoldFill.h > 25 && hsGoldFill.h < 55 && hsGoldFill.s > 0.5,
    '金矿掉落最终色相落在金色区间（h=' + hsGoldFill.h.toFixed(0) + '°, s=' + hsGoldFill.s.toFixed(2) + '）');
  ok(hsCoalFill.s < 0.12 && hsGoldFill.s > hsCoalFill.s + 0.4,
    '金矿与煤矿掉落色差明显（Δs=' + (hsGoldFill.s - hsCoalFill.s).toFixed(2) + '）');

  // goldRamp：ART 金色化用的同一把尺子
  const ramps = [[125, 125, 125, '中段'], [18, 18, 18, '暗端'], [220, 220, 220, '亮端']];
  for (const [r, g, b, name] of ramps) {
    const c = p0.DROPS._goldRamp(r, g, b).slice();
    const hs = hueSat(c);
    ok(hs.h > 25 && hs.h < 55 && hs.s > 0.5, 'goldRamp ' + name + ' ' + c.join(',') + ' 落在金色区间（h=' + hs.h.toFixed(0) + '°, s=' + hs.s.toFixed(2) + '）');
  }

  // 有 ART + 可写 canvas：金矿掉落图 = 煤矿掉落图金色化后的离屏 canvas
  const sinks = [];
  const doc = {
    createElement(tag) {
      const cv = { width: 0, height: 0, tinted: null, src: null,
        getContext() {
          return {
            drawImage(img) { cv.src = img; },
            getImageData(x, y, w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(125) }; },
            putImageData(img) { cv.tinted = img; }
          };
        },
        toDataURL() { return 'data:image/png;base64,X'; } };
      sinks.push(cv);
      return cv;
    }
  };
  const art = makeArt(false);
  const w1 = world({ art, document: doc });
  ok(art.seen.has('drops.coal'), '金矿掉落复用煤矿贴图键 drops.coal', [...art.seen].join(','));
  ok(sinks.length >= 1 && !!sinks[0].tinted, 'build/init 期就把煤矿掉落图金色化进离屏 canvas', 'canvases=' + sinks.length);
  ok(!!w1.DROPS._goldImg && w1.DROPS._goldImg === sinks[0], '缓存句柄就是那张金色化 canvas');
  w1.emit('block:layer', { block: cell('gold', false, 1), depth: 1, prev: { ore: 'gold', rich: false, maxHp: 24 } });
  const n1 = makeLogCtx();
  w1.DROPS.draw(n1.ctx);
  ok(n1.log.draw.length === 1 && n1.log.draw[0].img === w1.DROPS._goldImg, 'draw 用的是金色化缓存（不是煤矿原图）', n1.log.draw.length + ' draws');
  ok(n1.log.fill.length === 0, '有金色化贴图时不再画代码方块');

  // drops.coal 缺图时退到 fx.chip.coal
  const art2 = { seen: new Set(), one(k) { this.seen.add(k); return k === 'fx.chip.coal' ? { width: 16, height: 16 } : null; }, all() { return []; }, has() { return true; }, progress() { return 1; } };
  const sinks2 = [];
  const w2 = world({ art: art2, document: { createElement() { const cv = { width: 0, height: 0, getContext() { return { drawImage(img) { cv.src = img; }, getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4).fill(40) }; }, putImageData(img) { cv.px = img; } }; }, toDataURL() { return 'data:image/png;base64,Y'; } }; sinks2.push(cv); return cv; } } });
  ok(w2.DROPS._goldImg === sinks2[0], 'drops.coal 不可用时退到 fx.chip.coal 金色化', 'srcKeys=' + [...art2.seen].join(','));
}

console.log('\n---------------------------------------');
if (fails.length) {
  console.log('FAILED ' + fails.length + ' / ' + (pass + fails.length));
  fails.forEach(f => console.log(' - ' + f));
  process.exit(1);
}
console.log('ALL GREEN  ' + pass + ' assertions passed');
