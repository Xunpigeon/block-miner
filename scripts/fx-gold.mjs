import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('src/06-fx.js', 'utf8');
let n = 0;
// 1) oreId：金矿映射成自己的 id（贴图仍用 coal 的金色化缓存，由 CHIP_KEY 指过去）
s = s.replace("    if (v === 'coal') return 'coal';", "    if (v === 'coal') return 'coal';\n    if (v === 'gold') return 'gold';"); n++;
// 2) CHIP_KEY：gold 复用 coal 的碎屑图
s = s.replace("crystal: 'fx.chip.crystal' };", "crystal: 'fx.chip.crystal', gold: 'fx.chip.coal' };"); n++;
// 3) 强调色与文字色：金矿用金色
s = s.replace("    if (ore === 'coal') return C_ACC_COAL;", "    if (ore === 'coal') return C_ACC_COAL;\n    if (ore === 'gold') return '#ffc857';"); n++;
s = s.replace("    if (ore === 'coal') return C_TXT_COAL;", "    if (ore === 'coal') return C_TXT_COAL;\n    if (ore === 'gold') return '#ffc857';"); n++;
writeFileSync('src/06-fx.js', s, 'utf8');
console.log('patched', n, '/4');