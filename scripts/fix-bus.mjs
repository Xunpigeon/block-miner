import { readFileSync, writeFileSync } from 'node:fs';
let t = readFileSync('src/04-tools.js', 'utf8');
let n = 0;
// 修掉丢失的 BM. 前缀
t = t.split('  bus.on(\'block:break\'').join('  BM.bus.on(\'block:break\'');
t = t.split('\nbus.on(').join('\n  BM.bus.on(');
writeFileSync('src/04-tools.js', t, 'utf8');
// 检查是否还有裸 bus.on(
const bad = t.split('\n').filter(l => /^\s*bus\.on\(/.test(l));
console.log('残留裸 bus.on 行数:', bad.length);
bad.slice(0, 3).forEach(l => console.log('  ', l.trim().slice(0, 80)));