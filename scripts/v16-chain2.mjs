import { readFileSync, writeFileSync } from 'node:fs';
let c = readFileSync('src/01-config.js', 'utf8');
let n = 0;
// 1) 删掉 chainRange 链（连锁已无概率/范围概念，这是死键）
const block = [
  "    { prefix: 'chainRange', base: '连锁范围', lane: 'chain', head: 'chain2', count: 4, icon: 'ring',",
  "      effect: { chainChance: 0.08 }, baseCost: 420,",
  "      harm: '连锁概率再 +4pp（mods 无 chainExtraCells 活键，按等价 +4pp 连锁率实现）' }"
].join('\n');
if (c.indexOf(block) >= 0) {
  // 同时移除前面的逗号换行
  c = c.replace(",\n" + block, '');
  n++;
} else console.log('WARN chainRange block 未匹配');
// 2) 连锁链：8 环 → 10 环（用户：可升级次数你看着来，第一大关要能一直点）
c = c.replace("{ prefix: 'chain', base: '连锁', lane: 'chain', head: CENTER_ID, count: 8, icon: 'chain',",
              "{ prefix: 'chain', base: '连锁', lane: 'chain', head: CENTER_ID, count: 10, icon: 'chain',");
// 3) desc 文案改成新机制
c = c.replace("harm: '连锁概率 +6pp（满链 48%）'", "harm: '击碎时额外摧毁相邻 1 格（每级 +1 格，满链 10 格）'");
// 4) 注释同步
c = c.replace('chain 8 / oreRate 8 / ore 5 / chainRange 4 / exec 3 / tntPierce 2', 'chain 10 / oreRate 8 / ore 5 / exec 3 / tntPierce 2');
writeFileSync('src/01-config.js', c, 'utf8');
console.log('patched', n + 3);