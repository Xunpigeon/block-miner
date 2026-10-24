// v7 掉落物 16×16 / 碎屑 12×12 / 火花·星 8×8 / 烟团 16×16 / TNT 24×24 / 冲击波 128×128
// 掉落物与图标同一造型（卵石 / 煤块 / 铁矿块 / 宝石），只是更小 → 挖到什么、飞进包里的就是什么
import { Canvas, hex, rng, disc, outline, dither } from './lib.mjs';
import { INK, lighten, darken, sparkle, ORE, GOLD, STONE } from './px.mjs';
import { oreItem, tntIcon } from './icons.mjs';

function drop(ore) { const c = oreItem(ore, 16); if (ore === 'crystal' || ore === 'iron') sparkle(c, 13, 2, 1, hex('#ffffff'), ore === 'crystal' ? ORE.crystal[2] : ORE.iron[2]); return c; }
// 碎屑：一块圆角小方片（矿物主色 + 顶部亮边 + 底部暗边）
function chip(ore) {
  const P = { stone: STONE.slice(1), coal: ORE.coal, iron: ORE.iron, crystal: ORE.crystal }[ore], c = new Canvas(12, 12);
  for (let y = 2; y < 10; y++) for (let x = 2; x < 10; x++) { if ((x === 2 || x === 9) && (y === 2 || y === 9)) continue; c.set(x, y, y < 4 ? P[2] : y > 7 ? P[0] : P[1]); }
  c.set(3, 3, ore === 'coal' ? ORE.coal[3] : P[3] || hex('#ffffff')); outline(c, INK); return c;
}
function spark(core, mid, edge) { const c = new Canvas(8, 8);
  c.rect(3, 3, 2, 2, core); for (const [x, y] of [[3, 2], [4, 2], [3, 5], [4, 5], [2, 3], [2, 4], [5, 3], [5, 4]]) c.set(x, y, mid);
  for (const [x, y] of [[3, 1], [4, 6], [1, 4], [6, 3], [3, 0], [4, 7], [0, 4], [7, 3]]) c.set(x, y, edge); return c; }
// 烟团：圆滚滚的奶油色小云（底部淡紫阴影）
function dust() { const c = new Canvas(16, 16);
  for (const [x, y, rr] of [[6, 9, 4.3], [10, 8, 3.7], [8, 5, 3.4], [4, 7, 2.6]]) disc(c, x, y, rr, hex('#fffaf0'));
  c.each((x, y) => { if (!c.alpha(x, y)) return; if (!c.alpha(x, y + 1) || !c.alpha(x + 1, y + 1)) c.set(x, y, hex('#d8cce6')); else if (!c.alpha(x, y - 1)) c.set(x, y, hex('#ffffff')); });
  c.each((x, y) => { const p = c.get(x, y); if (p[3]) c.set(x, y, [p[0], p[1], p[2], 225]); });
  return c; }
function star() { const c = new Canvas(8, 8); sparkle(c, 3, 3, 3, hex('#ffffff'), GOLD[2], GOLD[1]); c.set(4, 4, GOLD[3]); return c; }
function tnt(gold) { return tntIcon(gold); }
// 9×9 冲击波：14px 一格，金边 + 珊瑚内框 + 十字符文，按切比雪夫环衰减
function deepRing() {
  const c = new Canvas(128, 128), K = [1, 1, 0.55, 0.3, 0.15];
  for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) {
    const k = K[Math.max(Math.abs(i - 4), Math.abs(j - 4))], x0 = 1 + i * 14, y0 = 1 + j * 14;
    for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) {
      const e = Math.min(x, y, 13 - x, 13 - y);
      if (e === 0) c.set(x0 + x, y0 + y, hex(k >= 1 ? '#fff4b8' : '#ffd84a', Math.round(255 * k)));
      else if (e === 1) c.set(x0 + x, y0 + y, hex('#ff9a7a', Math.round(200 * k)));
      else if ((x === 6 || x === 7 || y === 6 || y === 7) && e >= 3) c.set(x0 + x, y0 + y, hex('#fff7e6', Math.round(180 * k)));
      else if (dither(x0 + x, y0 + y, 0.25)) c.set(x0 + x, y0 + y, hex('#ffb43c', Math.round(120 * k)));
    }
  }
  c.rect(58, 58, 12, 12, hex('#ffffff')); c.rect(61, 61, 6, 6, hex('#fff4b8'));
  return c;
}

export function genSprites(out) {
  for (const o of ['stone', 'coal', 'iron', 'crystal']) out(`drops/drop_${o}.png`, drop(o), `drops.${o}`);
  for (const o of ['stone', 'coal', 'iron', 'crystal']) out(`fx/chip_${o}.png`, chip(o), `fx.chip.${o}`);
  out('fx/spark.png', spark(hex('#ffffff'), hex('#fff2a6'), hex('#ffb43c')), 'fx.spark');
  out('fx/spark_gold.png', spark(hex('#ffffff'), GOLD[2], GOLD[1]), 'fx.spark_gold');
  out('fx/dust.png', dust(), 'fx.dust'); out('fx/star.png', star(), 'fx.star');
  out('fx/tnt.png', tnt(false), 'fx.tnt'); out('fx/tnt_gold.png', tnt(true), 'fx.tnt_gold');
  out('fx/deep_ring.png', deepRing(), 'fx.deep_ring');
}
