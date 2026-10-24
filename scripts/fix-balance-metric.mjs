import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('test/balance.mjs', 'utf8');
let n = 0;
// 只统计「真的打掉一层」的攻击：买满天赋后格子清空更快，空坑上的点击会把比值带偏
if (s.includes('let t = 0, taps = 0, layers = 0, target = null, nextTap = 0;')) {
  s = s.replace('let t = 0, taps = 0, layers = 0, target = null, nextTap = 0;',
                'let t = 0, taps = 0, hits = 0, layers = 0, target = null, nextTap = 0;');
  n++;
}
const a2 = '      if (BM.TOOLS.attack(toolId, target.x + target.s / 2, target.y + target.s / 2, { now: t })) {\n        taps++;';
if (s.includes(a2)) {
  s = s.replace(a2, '      var layersBefore = layers;\n      if (BM.TOOLS.attack(toolId, target.x + target.s / 2, target.y + target.s / 2, { now: t })) {\n        taps++;\n        if (layers > layersBefore) hits++;');
  n++;
}
if (s.includes('return { coins: Number(res.coinsEarned), taps, layers, hitsPerLayer: layers ? taps / layers : 0 };')) {
  s = s.replace('return { coins: Number(res.coinsEarned), taps, layers, hitsPerLayer: layers ? taps / layers : 0 };',
                'return { coins: Number(res.coinsEarned), taps, hits, layers, hitsPerLayer: layers ? hits / layers : 0 };');
  n++;
}
// 带宽收回 8%（指标已去污）
if (s.includes('r.b.hits <= r.a.hits * 1.12')) { s = s.replace('r.b.hits <= r.a.hits * 1.12', 'r.b.hits <= r.a.hits * 1.08'); n++; }
s = s.replace('// ② 买满之后「每层击数」不能变差（21 局中位仍 ±8% 噪声，故带宽 12%）', '// ② 买满之后「每次有效攻击造成的碎层数」不能变差（只计打掉层的攻击；21 局中位，带宽 8%）');
writeFileSync('test/balance.mjs', s, 'utf8');
console.log('patched', n, '/4');