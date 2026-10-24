import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('src/01-config.js', 'utf8');
const cur = [405, 850, 1344, 3300, 5140, 8622, 13439];
const to  = [430, 902, 1427, 3504, 5459, 9156, 14272];
let n = 0;
cur.forEach(function (v, i) {
  const re = new RegExp('need:\\s*' + v + '\\b');
  if (re.test(s)) { s = s.replace(re, 'need: ' + to[i]); n++; }
});
writeFileSync('src/01-config.js', s, 'utf8');

// 同步 core.test 里的 need 快照
let t = readFileSync('test/core.test.mjs', 'utf8');
let m = 0;
cur.forEach(function (v, i) {
  const re = new RegExp('\\b' + v + '\\b', 'g');
  if (re.test(t)) { t = t.replace(re, String(to[i])); m++; }
});
writeFileSync('test/core.test.mjs', t, 'utf8');
console.log('config', n, '/7 ->', to.join('/'), '| test', m, '/7');