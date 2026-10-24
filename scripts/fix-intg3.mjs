import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('test/integration-v2.mjs', 'utf8');
s = s.replace('chain: 8, chainRange: 4 };', 'chain: 8, chainRange: 4, oreRate: 8 };');
s = s.split('tree.nodes = 81（实际').join('tree.nodes = 81（实际');
s = s.split('中心 mine + 81 个单级天赋节点').join('中心 mine + 81 个单级天赋节点');
writeFileSync('test/integration-v2.mjs', s, 'utf8');
console.log('CHAIN_LEN 已补 oreRate');