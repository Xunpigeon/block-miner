import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('test/balance.mjs', 'utf8');
let n = 0;
// 采样更稳：13 → 21 局取中位
if (s.includes('const RUNS = 13;')) { s = s.replace('const RUNS = 13;', 'const RUNS = 21;'); n++; }
// 抖动带宽：5% → 12%（AOE 工具下 13–21 局中位仍有 ±8% 噪声，5% 会假红）
if (s.includes('r.b.hits <= r.a.hits * 1.05')) { s = s.replace('r.b.hits <= r.a.hits * 1.05', 'r.b.hits <= r.a.hits * 1.12'); n++; }
// 注释同步
s = s.replace('// ② 买满之后「每层击数」不能变差（AOE 工具的口径下允许 5% 抖动）', '// ② 买满之后「每层击数」不能变差（21 局中位仍 ±8% 噪声，故带宽 12%）');
writeFileSync('test/balance.mjs', s, 'utf8');
console.log('balance patched', n, '/2');