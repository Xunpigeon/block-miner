import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('test/core.test.mjs', 'utf8');
let n = 0;
const R = [
  ['CONFIG.talents 索引 75 项 = 中心 mine + 74 个单级天赋节点（v14 删掉放置 TNT 后）', 'CONFIG.talents 索引 76 项 = 中心 mine + 75 个天赋节点（含 v15 deepLayer 999 级）'],
  ["eq(CONFIG.talents ? Object.keys(CONFIG.talents).length : 0, 75", "eq(CONFIG.talents ? Object.keys(CONFIG.talents).length : 0, 76"],
  ['第 1 关 quarry coinMul = 8', '第 1 关 quarry coinMul = 3'],
  ['coinMul = 8/2/1/1（第 1 关补廉价矿；后三关矿价自己爬升）', 'coinMul = 3/2/1/1（v15：第 1 关压低、让连锁当主角）'],
  ["'8/2/1/1'", "'3/2/1/1'"],
  ['tree.nodes = 74 个天赋节点（11 条链上的单级节点）', 'tree.nodes = 75 个天赋节点（11 条链 + deepLayer）'],
  ['中心 1 + 天赋 74 = 75 个节点（验收口径：节点总数 75）', '中心 1 + 天赋 75 = 76 个节点（含 deepLayer）'],
  ['75 个 id 互不相同', '76 个 id 互不相同'],
  ['合计 75 级（75 个节点，每个 maxLevel = 1）', '合计 1074 级（75 个单级 + deepLayer 999）'],
  ['5 条分支（oreRate 链与 ore 链同挂结算 lane，不新增扇区）', '6 条分支（含 v15 deep 车道）'],
  ['每层节点数 1/5/6/10/10/10/9/8/7/5/4 = 75（2–9 环各多一个 oreRate）', '每层节点数 1/6/6/10/10/10/9/8/7/5/4 = 76（deepLayer 在 depth 1）'],
  ['中心的 5 个直接孩子 = 5 条根链的链头（oreRate 是 settle1 的侧链）', '中心的 6 个直接孩子 = 6 条根链的链头（含 deepLayer）'],
  ['= 5 条根链', '= 6 条根链'],
];
for (const [a, b] of R) { if (s.includes(a)) { s = s.split(a).join(b); n++; } }
// 数值型 pins：chainChance / tntDrop 每环 + 基数 0
s = s.split('luckyTNTChance = 0.5').join('luckyTNTChance = 0');
s = s.split('未买 TNT 掉落 → mods.luckyTNTChance = 0.5').join('未买 TNT 掉落 → mods.luckyTNTChance = 0');
s = s.split('0.05').join('0.12');
s = s.split('chainChance: 0.06').join('chainChance: 0.12');
s = s.split('0.04]').join('0.06]');
writeFileSync('test/core.test.mjs', s, 'utf8');
console.log('patched', n);