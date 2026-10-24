import { readFileSync, writeFileSync } from 'node:fs';
let n = 0;

// A) core：nodeCost 支持固定价 fixedCost（用于给 TNT 链做软门槛）
let k = readFileSync('src/02-core.js', 'utf8');
if (k.indexOf('node.fixedCost') < 0) {
  k = k.replace('  function nodeCost(id) {',
    '  function nodeCost(id) {\n    var fx = nodeById(id);\n    if (fx && fx.fixedCost) return BigInt(fx.fixedCost);');
  n++;
}
writeFileSync('src/02-core.js', k, 'utf8');

// B) config：TNT 链首环 5%/290，第 2 环起 10 万起（第一大关买不动的软门槛）
let c = readFileSync('src/01-config.js', 'utf8');
const marker = "treeNodes[qi].id === 'tntDrop1'";
const block = [
  '  (function () {',
  '    // v16c：TNT 掉落链的价格软门槛 —— 第 1 环 290 金/5%（第一大关随手点），',
  '    // 第 2 环直接 10 万（第一大关绝对买不动），之后 15/22/33/50/75/112 万。',
  '    var TNT_COST = [100000, 150000, 220000, 330000, 500000, 750000, 1120000];',
  '    for (var qi = 0; qi < treeNodes.length; qi++) {',
  '      var tn = treeNodes[qi];',
  '      if (tn.id === \'tntDrop1\') { tn.effect = { luckyTNTChance: 0.05 }; tn.fixedCost = 290; }',
  '      else {',
  '        var mt = /^tntDrop([2-9])$/.exec(tn.id);',
  '        if (mt) { tn.fixedCost = TNT_COST[Number(mt[1]) - 2]; }',
  '      }',
  '    }',
  '  })();',
].join('\n');
if (c.indexOf('var TNT_COST') < 0) {
  c = c.replace('  /* 索引表里也放中心节点：', block + '\n  /* 索引表里也放中心节点：');
  // 删掉旧的 tntDrop1 覆盖块（v16b 那段）
  c = c.replace(/  \(function \(\) \{\n    for \(var qi = 0; qi < treeNodes\.length; qi\+\+\) \{\n      if \(treeNodes\[qi\]\.id === 'tntDrop1'\) \{[\s\S]*?\n  \}\)\(\);\n/g, '');
  n++;
} else console.log('已存在 TNT_COST，跳过');
writeFileSync('src/01-config.js', c, 'utf8');
console.log('patched', n);