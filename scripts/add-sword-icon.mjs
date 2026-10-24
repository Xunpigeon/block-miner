import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('src/08-ui.js', 'utf8');
let n = 0;
if (s.indexOf("'sword'") < 0) {
  s = s.replace("'tntbox', 'chain', 'coin', 'gem', 'clock', 'ring'];", "'tntbox', 'chain', 'coin', 'gem', 'clock', 'ring', 'sword'];".replace('];',']'));
  n++;
}
const anchor = '    // 环：圆环 + 四个方向的刻度';
const sword = [
  '    // 剑：竖刃 + 十字护手 + 柄',
  '    sword: function (m) {',
  '      mRect(m, 11, 2, 2, 11);',
  '      mRect(m, 6, 13, 12, 2);',
  '      mRect(m, 9, 15, 6, 2);',
  '      mRect(m, 11, 17, 2, 5);',
  '      mRect(m, 10, 21, 4, 2);',
  '    },',
  ''
].join('\n');
if (s.indexOf(anchor) >= 0 && s.indexOf('sword: function') < 0) { s = s.replace(anchor, sword + anchor); n++; }
writeFileSync('src/08-ui.js', s, 'utf8');
let i = readFileSync('test/integration-v2.mjs', 'utf8');
i = i.split('中心 mine + 10 个天赋节点').join('中心 mine + 11 个天赋节点');
writeFileSync('test/integration-v2.mjs', i, 'utf8');
console.log('patched', n);