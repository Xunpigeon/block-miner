import { readFileSync, writeFileSync } from 'node:fs';
let c = readFileSync('src/01-config.js', 'utf8');
let n = 0;
// 连锁：性能再拉高、价格再压低（第一大关的绝对主角）
if (c.includes('effect: { chainChance: 0.12 }, baseCost: 300,')) { c = c.replace('effect: { chainChance: 0.12 }, baseCost: 300,', 'effect: { chainChance: 0.15 }, baseCost: 180,'); n++; }
if (c.includes('effect: { chainChance: 0.06 }, baseCost: 700,')) { c = c.replace('effect: { chainChance: 0.06 }, baseCost: 700,', 'effect: { chainChance: 0.08 }, baseCost: 420,'); n++; }
// TNT：入门价压到第一大关能点（150），后续靠 1.9 幂自然爬到第二大关档位
if (c.includes('effect: { luckyTNTChance: 0.12 }, baseCost: 450,')) { c = c.replace('effect: { luckyTNTChance: 0.12 }, baseCost: 450,', 'effect: { luckyTNTChance: 0.12 }, baseCost: 150,'); n++; }
writeFileSync('src/01-config.js', c, 'utf8');
console.log('patched', n, '/3');