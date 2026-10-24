// scripts/tune-cycle.mjs —— 联合调参回路（多 seed 平均；价格 = R × 单局收入，目标 ≈ TARGET 局/关）
// 用法: node scripts/tune-cycle.mjs [--iters=6] [--ratio=1.7] [--target=22] [--seeds=1,2,3] [--src=dir] [--round-tiers] [--start=file]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const args = process.argv.slice(2);
const argOf = (k, d) => { const a = args.find(x => x.startsWith('--' + k)); return a ? a.split('=')[1] : d; };
const ITERS = Number(argOf('iters', 5));
const RATIO = Number(argOf('ratio', 1.7));
const TARGET = Number(argOf('target', 22));
const SEEDS = argOf('seeds', '1,2,3').split(',').map(Number);
const SRC = argOf('src', '');
const ROUND_TIERS = args.includes('--round-tiers');
const START = argOf('start', '');
// 常驻 patch（例如 upgrades.baseCost），每轮都随 patch 一起注入
const EXTRA = argOf('extra', '') ? JSON.parse(readFileSync(argOf('extra', ''), 'utf8')) : {};

const ZONES = ['quarry', 'copperRidge', 'blueIron', 'lavaEdge', 'starCave', 'moonRift', 'coreHeart'];
const OBJ_ORE = { quarry: 'coal', copperRidge: 'iron', blueIron: 'crystal', lavaEdge: 'crystal', starCave: 'crystal', moonRift: 'crystal', coreHeart: 'crystal' };
const tuneDir = join(root, '.tune');
mkdirSync(tuneDir, { recursive: true });

function loadBase() {
  const a = [join(here, '_base.mjs')];
  if (SRC) a.push(SRC);
  const r = spawnSync(process.execPath, a, { encoding: 'utf8', cwd: root });
  if (r.status !== 0) { console.error(r.stderr); throw new Error('base probe failed'); }
  return JSON.parse(r.stdout);
}

function runOne(patch, seed) {
  const pf = join(tuneDir, 'patch.json');
  writeFileSync(pf, JSON.stringify({ ...EXTRA, ...patch }, null, 1));
  const a = [join(here, 'tune.mjs'), '--seed=' + seed, '--patch=' + pf, '--json'];
  if (SRC) a.push('--src=' + SRC);
  const r = spawnSync(process.execPath, a, { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); throw new Error('probe failed seed ' + seed); }
  return JSON.parse(r.stdout);
}

function runAll(patch) {
  const runs = SEEDS.map(s => runOne(patch, s));
  const agg = ZONES.map(zid => {
    const zs = runs.map(r => r.zones.find(z => z.zone === zid));
    return {
      zone: zid,
      mean: zs.reduce((a, b) => a + b.mean, 0) / zs.length,
      rounds: zs.reduce((a, b) => a + b.rounds, 0) / zs.length
    };
  });
  const rounds = runs.reduce((a, r) => a + r.rounds, 0) / runs.length;
  return {
    agg, rounds,
    maxBuy: Math.max(...runs.map(r => r.maxPerRound)),
    maxGap: Math.max(...runs.map(r => r.maxGap)),
    perSeed: runs.map(r => r.rounds + '/' + r.maxPerRound + '/' + r.maxGap),
    runs
  };
}

const baseCfg = loadBase();
const MIN_TIER = baseCfg.minTier;
const clampMul = (m, lo, hi) => Math.min(hi, Math.max(lo, m));
const rnd = (v) => ROUND_TIERS ? Math.max(1, Math.round(v)) : Math.round(v * 100) / 100;
console.log('基线: tierBase=' + JSON.stringify(baseCfg.tierBase) + ' minTier=' + JSON.stringify(MIN_TIER) + ' coinMul=' + JSON.stringify(baseCfg.coinMul));

let patch = START ? JSON.parse(readFileSync(START, 'utf8')) : { zoneCoinTier: { ...baseCfg.zoneCoinTier }, need: { ...baseCfg.need } };

for (let it = 1; it <= ITERS; it++) {
  const res = runAll(patch);
  console.log('=== iter ' + it + '  rounds=' + res.rounds.toFixed(1) + '  (需 140-175)  maxBuy=' + res.maxBuy + '  maxGap=' + res.maxGap + '  per-seed rr/maxBuy/gap: ' + res.perSeed.join(' '));
  const nextTier = {}, nextNeed = {};
  let prevNeed = 0, prevOre = null;
  for (const z of res.agg) {
    const ore = OBJ_ORE[z.zone];
    if (ore !== prevOre) prevNeed = 0;
    const need = patch.need[z.zone];
    const inc = need - prevNeed;
    const price = baseCfg.tierBase[MIN_TIER[z.zone]] * patch.zoneCoinTier[z.zone];
    const ratio = price / Math.max(1, z.mean);
    console.log('   ' + z.zone.padEnd(12) + ' 局=' + z.rounds.toFixed(1).padStart(5) +
      '  收入=' + Math.round(z.mean).toString().padStart(12) +
      '  最低档价=' + Math.round(price).toString().padStart(12) +
      '  价/收入=' + ratio.toFixed(2).padStart(5) +
      '  need=' + String(need).padStart(6) +
      '  增量/局=' + (inc / Math.max(1, z.rounds)).toFixed(1));
    const wantTier = RATIO * z.mean / baseCfg.tierBase[MIN_TIER[z.zone]];
    nextTier[z.zone] = rnd(patch.zoneCoinTier[z.zone] * Math.pow(wantTier / patch.zoneCoinTier[z.zone], 0.6));
    const damp = clampMul(Math.pow(TARGET / Math.max(1, z.rounds), 0.85), 0.5, 2.0);
    nextNeed[z.zone] = Math.round(prevNeed + Math.max(1, inc * damp));
    prevNeed = nextNeed[z.zone]; prevOre = ore;
  }
  for (let i = 1; i < ZONES.length; i++) {
    if (!(nextTier[ZONES[i]] > nextTier[ZONES[i - 1]])) nextTier[ZONES[i]] = nextTier[ZONES[i - 1]] * 1.5;
    if (OBJ_ORE[ZONES[i]] === OBJ_ORE[ZONES[i - 1]] && !(nextNeed[ZONES[i]] > nextNeed[ZONES[i - 1]])) nextNeed[ZONES[i]] = nextNeed[ZONES[i - 1]] + 5;
  }
  console.log('   -> tier ' + JSON.stringify(nextTier));
  console.log('   -> need ' + JSON.stringify(nextNeed));
  patch = { zoneCoinTier: nextTier, need: nextNeed };
  writeFileSync(join(tuneDir, 'current.json'), JSON.stringify(patch, null, 1));
}
const fin = runAll(patch);
console.log('=== final rounds=' + fin.rounds.toFixed(1) + '  maxBuy=' + fin.maxBuy + '  maxGap=' + fin.maxGap + '  per-seed: ' + fin.perSeed.join(' '));
console.log(JSON.stringify(patch, null, 1));