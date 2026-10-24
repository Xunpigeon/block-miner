import { readFileSync, writeFileSync } from 'node:fs';
let n = 0;

// 1) core：新增 chainCells（加法键，0–10）
let k = readFileSync('src/02-core.js', 'utf8');
if (k.indexOf('chainCells: 0') < 0) { k = k.replace('chainChance: 0,', 'chainChance: 0,\n    chainCells: 0,'); n++; }
if (k.indexOf('if (M.chainCells > 10)') < 0) {
  k = k.replace('if (M.chainChance > 1) M.chainChance = 1;',
    'if (M.chainCells > 10) M.chainCells = 10;\n    if (M.chainCells < 0) M.chainCells = 0;\n    if (M.chainChance > 1) M.chainChance = 1;');
  n++;
}
writeFileSync('src/02-core.js', k, 'utf8');

// 2) config：连锁链改成 10 个节点、每级 chainCells +1、首环 120、递增 1.6；删 chainRange 链
let c = readFileSync('src/01-config.js', 'utf8');
c = c.replace("effect: { chainChance: 0.15 }, baseCost: 180,", "effect: { chainCells: 1 }, baseCost: 90, levels: 10, grow: 1.6,");
c = c.replace(/\n\s*\{[^\n]*effect: \{ chainChance: 0\.08 \}, baseCost: 420,[^\n]*\},/, '');
writeFileSync('src/01-config.js', c, 'utf8');

// 3) tools：rollChain 改成确定性多破一格
let t = readFileSync('src/04-tools.js', 'utf8');
const oldRoll = [
  '  function rollChain(from) {',
  '    var chance = num(modsObj().chainChance, 0);',
  '    if (from && from.ore === \'iron\') chance += T.chainChanceBase;   // 铁矿更容易炸穿邻格',
  '    if (chance <= 0) return;',
  '    if (Math.random() < chance) pushChain(from, liveChainDmg);',
  '  }'
].join('\n');
const newRoll = [
  '  function rollChain(from) {',
  '    // v16：连锁改为**确定性**——每击碎一层，额外摧毁相邻 chainCells 格各一层（不递归）',
  '    if (!from || chaining) return;',
  '    var cells = num(modsObj().chainCells, 0);',
  '    if (cells <= 0) return;',
  '    var G = BM.GRID;',
  '    if (!G || !G.neighbors || !G.stripLayer) return;',
  '    var list = G.neighbors(from, \'cross\', 1);',
  '    if (!list.length) return;',
  '    chaining = true;',
  '    try {',
  '      var hit = 0;',
  '      for (var i = 0; i < list.length && hit < cells; i++) {',
  '        var nb = list[(i + ((Math.random() * list.length) | 0)) % list.length];',
  '        if (!nb || nb.broken) continue;',
  '        if (G.stripLayer(nb)) { hit++; chainIdx++; emit(\'tool:chain\', { x: nb.x + nb.s / 2, y: nb.y + nb.s / 2, cells: hit }); }',
  '      }',
  '      if (hit > stats.maxChain) stats.maxChain = hit;',
  '    } finally { chaining = false; }',
  '  }'
].join('\n');
if (t.indexOf(oldRoll) >= 0) { t = t.replace(oldRoll, newRoll); n++; } else { console.log('WARN: rollChain 未匹配'); }
if (t.indexOf('var chaining = false;') < 0) { t = t.replace('var chainQueue = [];', 'var chaining = false;\nvar chainQueue = [];'); n++; }
writeFileSync('src/04-tools.js', t, 'utf8');
console.log('patched', n);