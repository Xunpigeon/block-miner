import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('src/08-ui.js', 'utf8');
let n = 0;

// 1) 记住布局，供缩放/居中复用
if (s.includes('var lay = treeLayout(cfg);')) { s = s.replace('var lay = treeLayout(cfg);', 'var lay = treeLayout(cfg);\n    R.lay = lay;'); n++; }

// 2) 初始缩放自适应：整棵树塞进视口
const old1 = "    R.panX = Math.round((TREE_STAGE_W - lay.size) / 2);\n    R.panY = Math.round((TREE_STAGE_H - lay.size) / 2);\n    syncTreeTransform();";
const new1 = [
  '    R.scale = fitScale(lay.size);',
  '    centerTree();'
].join('\n');
if (s.includes(old1)) { s = s.replace(old1, new1); n++; }

// 3) 缩放后重新居中（原来 scale 变化会把整棵树推向一角）
const old2 = "    R.scale = s;\n    syncTreeTransform();";
const new2 = "    R.scale = s;\n    centerTree();";
if (s.includes(old2)) { s = s.replace(old2, new2); n++; }

// 4) 新增两个工具函数（插在 syncTreeTransform 之前）
const anchor = '  function syncTreeTransform() {';
const helpers = [
  '  /* 自适应缩放：整棵树（含徽章半径）塞进视口，留 8px 边距 */',
  '  function fitScale(size) {',
  '    var m = Math.min(TREE_STAGE_W, TREE_STAGE_H) - 8;',
  '    var sc = m / size;',
  '    if (sc > ZOOM_MAX) sc = ZOOM_MAX;',
  '    if (sc < ZOOM_MIN) sc = ZOOM_MIN;',
  '    return Math.round(sc * 100) / 100;',
  '  }',
  '',
  '  function centerTree() {',
  '    var size = (R.lay && R.lay.size) ? R.lay.size : TREE_STAGE_W;',
  '    R.panX = Math.round((TREE_STAGE_W - size * R.scale) / 2);',
  '    R.panY = Math.round((TREE_STAGE_H - size * R.scale) / 2);',
  '    syncTreeTransform();',
  '  }',
  ''
].join('\n');
if (s.includes(anchor) && !s.includes('function fitScale')) { s = s.replace(anchor, helpers + anchor); n++; }

writeFileSync('src/08-ui.js', s, 'utf8');
console.log('patched', n, '/4');