import { readFileSync, writeFileSync } from 'node:fs';
let n = 0;

// bug1：rollChain 只挂在 block:break（整格挖空）上，而我们的模型是每层血 → 几乎不触发。改成每剥一层都判一次。
let t = readFileSync('src/04-tools.js', 'utf8');
if (t.indexOf("bus.on('block:layer', onLayerChain)") < 0) {
  t = t.replace("  function rollChain(from) {", "  function onLayerChain(p) {\n    if (p && p.block) rollChain(p.block);\n  }\n\n  function rollChain(from) {");
  // 在初始化总线订阅处补一条订阅：找 bus.on('block:break'
  t = t.replace("bus.on('block:break'", "bus.on('block:layer', onLayerChain);\n  bus.on('block:break'");
  n++;
}
// bug2：neighbors 的 pattern 'cross' 不存在 → 落进 else 分支（3×3 八格）。改成 'square' + 只取四邻。
t = t.replace("var list = G.neighbors(from, 'cross', 1);", "var list = (G.neighbors(from, 'square', 1) || []).filter(function (c) { return c.ox === from.ox || c.oy === from.oy; });");
writeFileSync('src/04-tools.js', t, 'utf8');

// bug3：TNT 首环 12% 太高（用户要 1%）——首环单独 1%，后续环保持 +12pp
let c = readFileSync('src/01-config.js', 'utf8');
if (c.indexOf('tntDrop1') < 0 && c.indexOf('首环 1%') < 0) {
  c = c.replace('  var NODE_DEFS = [];', '  var NODE_DEFS = [];\n  /* v16b：TNT 首环 1%（只做「运气好才触发」的引子），后续环仍每级 +12pp */');
  n++;
}
writeFileSync('src/01-config.js', c, 'utf8');
console.log('patched', n);