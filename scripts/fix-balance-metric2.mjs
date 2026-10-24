import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('test/balance.mjs', 'utf8');
let n = 0;
// layers 也用中位（原来取 runs[0]，单局噪声大）
if (s.includes('    layers: runs[0].layers,')) { s = s.replace('    layers: runs[0].layers,', '    layers: median(runs.map(r => r.layers)),'); n++; }
// ② 改成「每局碎层数不倒退」：伤害溢出会让「每次攻击的碎层」变差，那不是回归
const oldAssert = "if (!(r.b.hits <= r.a.hits * 1.08)) {\n    fail.push(r.zone + ' 买满后每层击数反而变多（' + r.a.hits.toFixed(2) + ' → ' + r.b.hits.toFixed(2) + '）');";
const newAssert = "if (!(r.b.layers >= r.a.layers * 0.95)) {\n    fail.push(r.zone + ' 买满后每局碎层数倒退（' + r.a.layers.toFixed(1) + ' → ' + r.b.layers.toFixed(1) + '）');";
if (s.includes(oldAssert)) { s = s.replace(oldAssert, newAssert); n++; } else { console.log('WARN: 断言片段未匹配'); }
writeFileSync('test/balance.mjs', s, 'utf8');
console.log('patched', n, '/2');