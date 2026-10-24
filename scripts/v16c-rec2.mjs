import { readFileSync, writeFileSync } from 'node:fs';
let u = readFileSync('src/08-ui.js', 'utf8');
let n = 0;
const old = "      var it = list[i];\n      var stt = nodeStateOf(it);";
const neu = [
  "      var it = list[i];",
  "      // v16c：长尾节点（矿层加深 999 级）不进推荐，玩家自己决定要不要堆层数",
  "      if ((it.maxLevel || 1) >= 50) continue;",
  "      var stt = nodeStateOf(it);"
].join('\n');
if (u.indexOf(old) >= 0 && u.indexOf('>= 50) continue;') < 0) { u = u.replace(old, neu); n++; }
writeFileSync('src/08-ui.js', u, 'utf8');
console.log('patched', n);