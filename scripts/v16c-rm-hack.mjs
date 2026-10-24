import { readFileSync, writeFileSync } from 'node:fs';
let k = readFileSync('src/02-core.js', 'utf8');
// 移除 v16b 的 -0.11 补偿（现在由 config 的 fixedCost/effect 直接给 5%）
k = k.replace(/    \/\/ v16b：TNT 首环只做[\s\S]*?      M\.luckyTNTChance = Math\.max\(0, M\.luckyTNTChance - 0\.11\);\n    \}\n/, '');
writeFileSync('src/02-core.js', k, 'utf8');
console.log('有 -0.11:', k.indexOf('- 0.11') >= 0);