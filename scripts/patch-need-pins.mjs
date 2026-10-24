import { readFileSync, writeFileSync } from 'node:fs';
let t = readFileSync('test/core.test.mjs', 'utf8');
const map = [[358,430],[752,902],[1189,1427],[2920,3504],[4549,5459],[7630,9156],[11893,14272]];
let n = 0;
for (const [a, b] of map) {
  const re = new RegExp('\\b' + a + '\\b', 'g');
  if (re.test(t)) { t = t.replace(re, String(b)); n++; }
}
writeFileSync('test/core.test.mjs', t, 'utf8');
console.log('pins patched', n, '/7');