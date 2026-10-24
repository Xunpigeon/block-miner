import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('test/core.test.mjs', 'utf8');
let n = 0;
// 1) talents 索引数 + tree.nodes 数
s = s.replace("eq(Object.keys(C.talents).length, 11, 'CONFIG.talents 索引 12 项", "eq(Object.keys(C.talents).length, 12, 'CONFIG.talents 索引 12 项"); n++;
// 2) exec 的行改用 table 模式（levelEffect 是非线性 0.12/0.20/0.30）
s = s.replace("['exec', 'execThreshold', 'add', 0.08]", "['exec', 'execThreshold', 'table', [0.12, 0.20, 0.30]]"); n++;
// 3) cumOf 支持 table
s = s.replace(
  'const cumOf = function (mode, step, lv) {\n    return mode === \'add\' ? Math.round(step * lv * 1e6) / 1e6 : Math.round(Math.pow(step, lv) * 1e6) / 1e6;\n  };',
  'const cumOf = function (mode, step, lv) {\n    if (mode === \'table\') return step[lv - 1];\n    return mode === \'add\' ? Math.round(step * lv * 1e6) / 1e6 : Math.round(Math.pow(step, lv) * 1e6) / 1e6;\n  };'); n++;
// 4) wantMods：table 视作加法
s = s.replace("const wantMods = row[2] === 'add' ? zeroSnap[row[1]] + want : zeroSnap[row[1]] * want;",
              "const wantMods = (row[2] === 'add' || row[2] === 'table') ? zeroSnap[row[1]] + want : zeroSnap[row[1]] * want;"); n++;
// 5) 层数快照（第 5-7 关）
s = s.replace("'10-12'", "'14-16'");
writeFileSync('test/core.test.mjs', s, 'utf8');
console.log('patched', n);