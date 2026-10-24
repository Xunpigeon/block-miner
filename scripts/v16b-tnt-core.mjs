import { readFileSync, writeFileSync } from 'node:fs';
let k = readFileSync('src/02-core.js', 'utf8');
let n = 0;
const old = '    clampMods();\n    return M;';
const neu = [
  '    clampMods();',
  '    // v16b：TNT 首环只做「运气型引子」——点 tntDrop1 时把该环的 0.12 压成 0.01。',
  '    // （链定义是统一每级 +0.12，这里对首环做一次偏移，避免为 1% 单独拆一条链）',
  '    if (state.talents && state.talents.tntDrop1) {',
  '      M.luckyTNTChance = Math.max(0, M.luckyTNTChance - 0.11);',
  '    }',
  '    return M;'
].join('\n');
if (k.indexOf(old) >= 0) { k = k.replace(old, neu); n++; } else console.log('MISS return');
writeFileSync('src/02-core.js', k, 'utf8');
console.log('patched', n);