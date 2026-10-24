import { readFileSync, writeFileSync } from 'node:fs';
let n = 0;

// A) core.test：节点数 + 第 5-7 关层数与血量快照
let c = readFileSync('test/core.test.mjs', 'utf8');
c = c.replace('eq(tree.nodes.length, 10,', 'eq(tree.nodes.length, 11,'); n++;
const rows = [
  ["{ id: 'starCave', name: '星辉晶洞', coinMul: 1, layerMin: 10, layerMax: 12, filler: 'iron',",
   "{ id: 'starCave', name: '星辉晶洞', coinMul: 1, layerMin: 14, layerMax: 16, filler: 'iron',"],
  ["ores: [['crystal', 75, 104], ['iron', 25, 40]]", "ores: [['crystal', 75, 26], ['iron', 25, 22]]"],
  ["{ id: 'moonRift', name: '月银断层', coinMul: 1, layerMin: 10, layerMax: 12, filler: 'iron',",
   "{ id: 'moonRift', name: '月银断层', coinMul: 1, layerMin: 16, layerMax: 18, filler: 'iron',"],
  ["ores: [['crystal', 82, 320], ['iron', 18, 48]]", "ores: [['crystal', 82, 120], ['iron', 18, 80]]"],
  ["{ id: 'coreHeart', name: '地心核心', coinMul: 1, layerMin: 12, layerMax: 14, filler: 'iron',",
   "{ id: 'coreHeart', name: '地心核心', coinMul: 1, layerMin: 18, layerMax: 20, filler: 'iron',"],
  ["ores: [['crystal', 88, 1000], ['iron', 12, 55]]", "ores: [['crystal', 88, 360], ['iron', 12, 200]]"],
];
for (const [a, b] of rows) { if (c.includes(a)) { c = c.replace(a, b); n++; } else console.log('MISS', a.slice(0, 50)); }
writeFileSync('test/core.test.mjs', c, 'utf8');

// B) integration-v2：节点数 10 -> 11
let i = readFileSync('test/integration-v2.mjs', 'utf8');
const before = i;
i = i.replace(/tree\.nodes(\.length)?\s*[=:=]+\s*10\b/g, 'tree.nodes$1 = 11');
i = i.replace(/天赋节点\s*10/g, '天赋节点 11');
i = i.replace(/\bnodes\s*=\s*10\b/g, 'nodes = 11');
if (i !== before) n++;
writeFileSync('test/integration-v2.mjs', i, 'utf8');
console.log('patched', n);