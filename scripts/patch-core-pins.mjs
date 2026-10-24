import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('test/core.test.mjs', 'utf8');
const pairs = [
  ["'120/132/144/156/168'", "'138/152/166/180/194'"],
  ['tierBase = 120/132/144/156/168（定稿快照）', 'tierBase = 138/152/166/180/194（定稿快照：v7 涨价 15%）'],
  ["'100/90/110/130/105'", "'115/104/127/150/121'"],
  ['baseCost 100/90/110/130/105', 'baseCost 115/104/127/150/121（v7 涨价 15%）']
];
let n = 0;
for (const [a, b] of pairs) { if (s.includes(a)) { s = s.split(a).join(b); n++; } }
writeFileSync('test/core.test.mjs', s, 'utf8');
console.log('patched', n, '/', pairs.length);