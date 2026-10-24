import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('test/ui.smoke.mjs', 'utf8');
const old = "ok(multiBought.length > 0, '样本里有多级节点买到 >1 级（覆盖 1.9 递增的每一级）', multiBought.join(','));";
const neu = [
  "const anyMulti = RTREE.nodes.concat([RCENTER]).some(function (n) { return (n.maxLevel || 1) > 1; });",
  "if (anyMulti) {",
  "  ok(multiBought.length > 0, '样本里有多级节点买到 >1 级（覆盖 1.9 递增的每一级）', multiBought.join(','));",
  "} else {",
  "  ok(RIDS.every(function (id) { return RCORE.nodeLevel(id) <= 1; }), '全部节点单级（v9 拆链后 1 级 = 1 节点），逐级价格由不同节点承担');",
  "}"
].join('\n');
if (s.indexOf(old) >= 0) { s = s.replace(old, neu); console.log('patched'); } else console.log('MISS');
writeFileSync('test/ui.smoke.mjs', s, 'utf8');