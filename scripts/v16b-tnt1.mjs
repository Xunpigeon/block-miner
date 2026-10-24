import { readFileSync, writeFileSync } from 'node:fs';
let c = readFileSync('src/01-config.js', 'utf8');
const anchor = '  var tree = {\n    center: treeCenter,\n    lanes: lanes,\n    nodes: treeNodes\n  };';
const add = [
  '  /* v16b：TNT 首环只做「运气好才触发」的引子（1%），后续环仍每级 +12pp。',
  '     用户明确要求：第一大关的爽点是连锁，TNT 只是意思一下。 */',
  '  (function () {',
  '    for (var qi = 0; qi < treeNodes.length; qi++) {',
  '      if (treeNodes[qi].id === \'tntDrop1\') {',
  '        treeNodes[qi].effect = { luckyTNTChance: 0.01 };',
  '        treeNodes[qi].harm = \'击穿时 1% 概率白掉 TNT（运气型引子）\';',
  '      }',
  '    }',
  '  })();',
  ''
].join('
');
if (c.indexOf("treeNodes[qi].id === 'tntDrop1'") < 0) {
  // 插到 tree 定义之后（treeNodes 已填充）
  c = c.replace('  /* 索引表里也放中心节点：', add + '  /* 索引表里也放中心节点：');
  console.log('已插入 tntDrop1 覆盖');
} else console.log('已存在，跳过');
writeFileSync('src/01-config.js', c, 'utf8');