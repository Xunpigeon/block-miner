import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('test/core.test.mjs', 'utf8');
let n = 0;
const R = [
  ["layerMin: 10, layerMax: 12, filler: 'iron',\n    objective: { ore: 'crystal', need: 28420 }", "layerMin: 14, layerMax: 16, filler: 'iron',\n    objective: { ore: 'crystal', need: 28420 }"],
  ["layerMin: 10, layerMax: 12, filler: 'iron',\n    objective: { ore: 'crystal', need: 45539 }", "layerMin: 16, layerMax: 18, filler: 'iron',\n    objective: { ore: 'crystal', need: 45539 }"],
  ["layerMin: 12, layerMax: 14, filler: 'iron',\n    objective: { ore: 'crystal', need: 57213 }", "layerMin: 18, layerMax: 20, filler: 'iron',\n    objective: { ore: 'crystal', need: 57213 }"],
];
for (const [a, b] of R) { if (s.includes(a)) { s = s.replace(a, b); n++; } else { console.log('MISS layer block'); } }
// tree.nodes 期望 10 -> 11（在期望对象里）
const m = s.match(/nodes:\s*10\b/);
if (m) { s = s.replace(/nodes:\s*10\b/, 'nodes: 11'); n++; }
writeFileSync('test/core.test.mjs', s, 'utf8');
console.log('patched', n);