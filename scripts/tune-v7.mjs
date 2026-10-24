import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('src/01-config.js', 'utf8');
// tierBase 抬 15%（掐掉关界一次买 3 个的毛刺）
const from = 'tierBase: { 1: 120, 2: 132, 3: 144, 4: 156, 5: 168 }';
const to   = 'tierBase: { 1: 138, 2: 152, 3: 166, 4: 180, 5: 194 }';
if (!s.includes(from)) { console.log('tierBase 未匹配'); process.exit(2); }
s = s.replace(from, to);
// 强化 baseCost 抬 15%
const upPairs = [['baseCost: 100','baseCost: 115'],['baseCost: 90','baseCost: 104'],['baseCost: 110','baseCost: 127'],['baseCost: 130','baseCost: 150'],['baseCost: 105','baseCost: 121']];
let n = 0;
for (const [a,b] of upPairs) { if (s.includes(a)) { s = s.split(a).join(b); n++; } }
writeFileSync('src/01-config.js', s, 'utf8');
console.log('patched tierBase + ' + n + ' baseCost');