import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('test/core.test.mjs', 'utf8');
const out = s.split('\n').map((ln) => {
  if (ln.indexOf("'CONFIG.talents 索引 76 项") >= 0) return ln.replace(/, 75,/, ', 76,');
  if (ln.indexOf("'tree.nodes = 75 个天赋节点") >= 0) return ln.replace(/, 74,/, ', 75,');
  if (ln.indexOf("'中心 1 + 天赋 75 = 76 个节点") >= 0) return ln.replace(/, 75,/, ', 76,');
  if (ln.indexOf('个 id 互不相同') >= 0) return ln.replace(/, 75,/, ', 76,');
  if (ln.indexOf("'合计 1074 级") >= 0) return ln.replace(/, 75,/, ', 1074,');
  if (ln.indexOf("'6 条分支") >= 0) return ln.replace(/, 5,/, ', 6,');
  if (ln.indexOf("'每层节点数 1/6/6/10") >= 0) return ln.replace(/, 75,/, ', 76,');
  if (ln.indexOf('第 1 关 quarry coinMul') >= 0) return ln.replace(/coinMul: 8/, 'coinMul: 3').replace(/\b8\b(, '第 1)/, '3$1');
  return ln;
});
s = out.join('\n');
// 单级断言：deepLayer 例外
s = s.replace("ok(ALL_NODES.every(function (n) { return n.maxLevel === 1; }), '每个节点都是单级：maxLevel = levels = 1')",
  "ok(ALL_NODES.every(function (n) { return n.maxLevel === 1 || n.id === 'deepLayer'; }), '除 deepLayer（999 级）外每个节点都是单级')");
writeFileSync('test/core.test.mjs', s, 'utf8');
console.log('ok');