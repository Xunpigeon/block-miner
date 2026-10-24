import { readFileSync, writeFileSync } from 'node:fs';
let k = readFileSync('src/02-core.js', 'utf8');
let n = 0;
const old = "      if (nodeState(node.id) !== 'available') continue;";
const neu = [
  "      if (nodeState(node.id) !== 'available') continue;",
  "      // v16c：长尾节点（矿层加深 999 级）不参与推荐，让玩家自己决定要不要堆层数",
  "      if ((node.maxLevel || 1) >= 50) continue;"
].join('\n');
if (k.indexOf(old) >= 0 && k.indexOf('>= 50) continue;') < 0) { k = k.replace(old, neu); n++; }
writeFileSync('src/02-core.js', k, 'utf8');
console.log('patched', n);