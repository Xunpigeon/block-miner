import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('src/01-config.js', 'utf8');
const from = [358, 752, 1189, 2920, 4549, 7630, 11893];
const to = from.map(function (v) { return Math.round(v * 1.13); });
let n = 0;
from.forEach(function (v, i) {
  const re = new RegExp('need:\\s*' + v + '\\b');
  if (re.test(s)) { s = s.replace(re, 'need: ' + to[i]); n++; }
});
writeFileSync('src/01-config.js', s, 'utf8');
console.log('need patched', n, '/7 ->', to.join('/'));