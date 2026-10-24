// scripts/audit.mjs —— 七关对照表 + core.test §11 的「35–85% / ≤20% / ≤50%」自查
// 用法: node scripts/audit.mjs [--src=dir] [--seeds=1,2,3]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (k, d) => { const a = args.find(x => x.startsWith('--' + k)); return a ? a.split('=')[1] : d; };
const SRC = argOf('src', '');
const SEEDS = argOf('seeds', '1,2,3').split(',').map(Number);
const PATCH = argOf('patch', '');
const ZONES = ['quarry', 'copperRidge', 'blueIron', 'lavaEdge', 'starCave', 'moonRift', 'coreHeart'];

const baseJson = spawnSync(process.execPath, [join(here, '_base.mjs'), ...(SRC ? [SRC] : [])], { encoding: 'utf8' }).stdout;
const B = JSON.parse(baseJson);

const runs = SEEDS.map(s => {
  const a = [join(here, 'tune.mjs'), '--seed=' + s, '--json'];
  if (SRC) a.push('--src=' + SRC);
  if (PATCH) a.push('--patch=' + PATCH);
  const r = spawnSync(process.execPath, a, { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
});

console.log('关'.padEnd(13) + '局数'.padStart(6) + '单局收入'.padStart(13) + '最低档价'.padStart(13) + '价/收入'.padStart(9) + 'need'.padStart(7) + '6节点/22局收入'.padStart(15) + '最贵/22局'.padStart(10) + '5强化首级/22局'.padStart(17));
for (const z of ZONES) {
  const zs = runs.map(r => r.zones.find(x => x.zone === z));
  const mean = zs.reduce((a, b) => a + b.mean, 0) / zs.length;
  const rounds = zs.reduce((a, b) => a + b.rounds, 0) / zs.length;
  const price = zs[0].t1;
  const income22 = mean * 22;
  const maxNode = Math.round(price * B.tierBase[5] / B.tierBase[B.minTier[z]]);
  const upg = 5 * 100 * B.zoneCoinTier[z];
  console.log(
    z.padEnd(13) +
    rounds.toFixed(1).padStart(6) +
    Math.round(mean).toString().padStart(13) +
    String(price).padStart(13) +
    (price / mean).toFixed(2).padStart(9) +
    String(B.need[z]).padStart(7) +
    ((6 * price / income22) * 100).toFixed(0).padStart(14) + '%' +
    ((maxNode / income22) * 100).toFixed(0).padStart(9) + '%' +
    ((upg / income22) * 100).toFixed(1).padStart(16) + '%');
}
const rounds = runs.reduce((a, r) => a + r.rounds, 0) / runs.length;
console.log('');
for (let i = 0; i < runs.length; i++) {
  const r = runs[i];
  console.log('seed ' + SEEDS[i] + ': 轮数=' + r.rounds + ' 时长=' + (r.rounds * 23 / 60).toFixed(1) + '分  单局购买max=' + r.maxPerRound + ' 中位=' + r.medianPerRound + ' 空窗max=' + r.maxGap + ' 分关=' + r.zones.map(z => z.rounds).join('/'));
}
console.log('平均轮数=' + rounds.toFixed(1) + ' (' + (rounds * 23 / 60).toFixed(1) + ' 分钟)');