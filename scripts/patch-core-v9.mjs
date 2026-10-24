import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('test/core.test.mjs', 'utf8');
const R = [
  ["eq(ALL_NODES.length, 11, '中心 1 + 天赋 10 = 11 个节点');", "eq(ALL_NODES.length, 12, '中心 1 + 天赋 11 = 12 个节点（含 v9 处决 exec）');"],
  ["eq(new Set(ALL_NODES.map(function (n) { return n.id; })).size, 11, '11 个 id 互不相同');", "eq(new Set(ALL_NODES.map(function (n) { return n.id; })).size, 12, '12 个 id 互不相同');"],
  ["ALL_NODES.reduce(function (s, n) { return s + n.maxLevel; }, 0), 71, '合计 71 级（对应手绘图上约 70 个圆圈）');", "ALL_NODES.reduce(function (s, n) { return s + n.maxLevel; }, 0), 74, '合计 74 级（含 v9 处决 3 级）');"],
  ["eq(byDepth[2], 5, '深度 2：5 个（spd/ore/tntDmg/tntRange/chainRange）');", "eq(byDepth[2], 6, '深度 2：6 个（spd/exec/ore/tntDmg/tntRange/chainRange）');"],
  ["eq(CUM.length, ALL_NODES.length, '逐级效果表覆盖 11 个节点');", "eq(CUM.length, ALL_NODES.length, '逐级效果表覆盖 12 个节点');"],
  ["    ['chainRange', 'chainChance', 'add', 0.03]", "    ['chainRange', 'chainChance', 'add', 0.03],\n    ['exec', 'execThreshold', 'add', 0.08]"],
  ["'CONFIG.talents 索引 11 项 = 中心 mine + 10 个天赋节点'", "'CONFIG.talents 索引 12 项 = 中心 mine + 11 个天赋节点'"],
  ["eq(CONFIG.talents ? Object.keys(CONFIG.talents).length : 0, 11,", "eq(CONFIG.talents ? Object.keys(CONFIG.talents).length : 0, 12,"],
  ["tree.nodes = 10 个天赋节点（§7.1 删掉了六把武器与只挂在它们下面的三个节点）", "tree.nodes = 11 个天赋节点（§7.1 删武器节点 + v9 处决）"],
  ["eq(T.nodes.length, 10,", "eq(T.nodes.length, 11,"],
  // 目标/层数快照按 v9 实测值更新
  ['= 245 -> 实际', '= 274 -> 实际'],
  ["'第 1 关 quarry 目标数量 = 245'", "'第 1 关 quarry 目标数量 = 274'"],
  ["'第 2 关 copperRidge 目标数量 = 903'", "'第 2 关 copperRidge 目标数量 = 1167'"],
  ["'第 3 关 blueIron 目标数量 = 2578'", "'第 3 关 blueIron 目标数量 = 3536'"],
  ["'第 4 关 lavaEdge 目标数量 = 7778'", "'第 4 关 lavaEdge 目标数量 = 10886'"],
  ["'第 5 关 starCave 目标数量 = 16928'", "'第 5 关 starCave 目标数量 = 28420'"],
  ["'第 6 关 moonRift 目标数量 = 24928'", "'第 6 关 moonRift 目标数量 = 45539'"],
  ["'第 7 关 coreHeart 目标数量 = 29488'", "'第 7 关 coreHeart 目标数量 = 57213'"],
  ["'第 5 关 starCave 层数 10-12'", "'第 5 关 starCave 层数 14-16'"],
  ["'第 6 关 moonRift 层数 10-12'", "'第 6 关 moonRift 层数 16-18'"],
  ["'第 7 关 coreHeart 层数 12-14'", "'第 7 关 coreHeart 层数 18-20'"],
];
let n = 0;
for (const [a, b] of R) { if (s.includes(a)) { s = s.split(a).join(b); n++; } else { console.log('MISS:', a.slice(0, 60)); } }
// 数值期望：need 数组与层数区间按关序替换（只在断言上下文里出现的字面量）
const nums = [[245,274],[903,1167],[2578,3536],[7778,10886],[16928,28420],[24928,45539],[29488,57213]];
for (const [a, b] of nums) {
  const re = new RegExp('\\b' + a + '\\b', 'g');
  if (re.test(s)) { s = s.replace(re, String(b)); n++; }
}
writeFileSync('test/core.test.mjs', s, 'utf8');
console.log('patched', n);