import { readFileSync, writeFileSync } from 'node:fs';
let c = readFileSync('src/01-config.js', 'utf8');
let n = 0;
// 第一关：连锁给大（+6pp/环 → +12pp/环），首环便宜，让第 1 关靠连锁爽
if (c.includes('effect: { chainChance: 0.06 }, baseCost: 900,')) { c = c.replace('effect: { chainChance: 0.06 }, baseCost: 900,', 'effect: { chainChance: 0.12 }, baseCost: 300,'); n++; }
// 连锁范围也放大
if (c.includes('effect: { chainChance: 0.04 }, baseCost: 2000,')) { c = c.replace('effect: { chainChance: 0.04 }, baseCost: 2000,', 'effect: { chainChance: 0.06 }, baseCost: 700,'); n++; }
// TNT 掉落：从第 2 关开始点，数量暴增（+12pp/环，8 环 = 96%），首环更便宜
if (c.includes('effect: { luckyTNTChance: 0.05 }, baseCost: 1200,')) { c = c.replace('effect: { luckyTNTChance: 0.05 }, baseCost: 1200,', 'effect: { luckyTNTChance: 0.12 }, baseCost: 450,'); n++; }
// 第一关压低产出：coinMul 8 → 3（让第一关稍微苦一点）
if (c.includes("id: 'quarry', name: '煤矿层', coinMul: 8,")) { c = c.replace("id: 'quarry', name: '煤矿层', coinMul: 8,", "id: 'quarry', name: '煤矿层', coinMul: 3,"); n++; }
writeFileSync('src/01-config.js', c, 'utf8');

let k = readFileSync('src/02-core.js', 'utf8');
// TNT 基础掉率 0.5 → 0：第一关不掉 TNT，从第 2 关点天赋开始暴增
if (k.includes('luckyTNTChance: 0.5,')) { k = k.replace('luckyTNTChance: 0.5,', 'luckyTNTChance: 0,'); n++; }
writeFileSync('src/02-core.js', k, 'utf8');
console.log('patched', n, '/5');