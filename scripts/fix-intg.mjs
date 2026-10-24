import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('test/integration-v2.mjs', 'utf8');
s = s.replace('tree.nodes.length = 11', 'tree.nodes.length === 11');
writeFileSync('test/integration-v2.mjs', s, 'utf8');
console.log(s.includes('tree.nodes.length === 11') ? 'fixed' : 'still broken');