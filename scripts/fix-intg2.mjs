import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('test/integration-v2.mjs', 'utf8');
let n = 0;
if (s.indexOf('oreRate: 8') < 0) { s = s.replace(/chain: 8(\s*)\}/, 'chain: 8,$1  oreRate: 8 }'); n++; }
s = s.split('tree.nodes.length === 73').join('tree.nodes.length === 81');
s = s.split('73 个').join('81 个');
s = s.split('= 73').join('= 81');
writeFileSync('test/integration-v2.mjs', s, 'utf8');
console.log('patched', n);