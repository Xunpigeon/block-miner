// v7 图标 24×24：统一梅棕描边 + 上左受光 + 一颗高光；造型优先「一眼认得出」
// 工具 7 / 矿物 4（道具形态：卵石 / 煤块 / 铁矿块 / 宝石）/ TNT / 功能图标 9 / 强化线 5
import { Canvas, hex, line, disc, ring, poly, outline } from './lib.mjs';
import { INK, lighten, darken, pal, sparkle, ORE, GOLD, STONE } from './px.mjs';

const done = c => { outline(c, INK); return c; };
const STICK = pal('#7a4a2c', '#b8743e', '#ecb67c');

// 软体块：椭圆 + 上左亮 / 右下暗 + 高光点（矿物与掉落物共用）
export function lump(c, cx, cy, rx, ry, P, wob = 0) {
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, a = Math.atan2(dy, dx), k = 1 + wob * Math.sin(a * 3 + 1);
    if (dx * dx + dy * dy > k * k) continue; const t = dx + dy;
    c.set(x, y, t < -0.7 ? P[2] : t > 0.75 ? P[0] : P[1]);
  }
  c.set(Math.round(cx - rx * 0.45), Math.round(cy - ry * 0.5), P[3]);
}
export function gemShape(c, cx, cy, s, P) {
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy; if (Math.abs(dx) / (s * 0.85) + Math.abs(dy) / (s * 1.15) > 1) continue;
    c.set(x, y, dx < 0 && dy < 0 ? P[2] : dx >= 0 && dy >= 0 ? P[0] : P[1]);
  }
  for (let y = Math.round(cy - s + 2); y < cy; y++) c.set(Math.floor(cx) - 1, y, P[3]);
}
export function oreItem(ore, size = 24) {
  const c = new Canvas(size, size), m = size / 2, s = size / 24;
  if (ore === 'stone') { lump(c, m, m + s, 8 * s, 6.5 * s, pal('#6f6681', '#a59eaf', '#d9d4e1', '#ffffff'), 0.06); lump(c, m + 4 * s, m + 3 * s, 3 * s, 2.2 * s, pal('#6f6681', '#8c8398', '#bdb7c6', '#f2eef6')); }
  else if (ore === 'coal') { lump(c, m, m + s, 8 * s, 7 * s, ORE.coal, 0.14); c.set(Math.round(m + 2 * s), Math.round(m - 2 * s), ORE.coal[3]); }
  else if (ore === 'iron') { lump(c, m, m + s, 8 * s, 6.5 * s, ORE.iron, 0.12); lump(c, m - 3 * s, m + 3 * s, 2.4 * s, 1.8 * s, pal('#8a4a36', '#b5644a', '#e8946e', '#ffc8a2')); }
  else gemShape(c, m, m, 9 * s, ORE.crystal);
  return done(c);
}

// 镐：手柄左下→右上，镐头为以手柄底端为圆心的弧
function pick(P, gem) {
  const c = new Canvas(24, 24), cx = 4, cy = 20;
  line(c, 4, 20, 14, 10, STICK[1], 2); line(c, 3, 20, 13, 10, STICK[2]); line(c, 5, 21, 14, 12, STICK[0]);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx) * 180 / Math.PI;
    if (a < -84 || a > -6) continue; const t = 1 - Math.abs(a + 45) / 39, th = 1.2 + 1.7 * t;
    if (Math.abs(r - 15.6) > th) continue;
    c.set(x, y, r > 15.6 + th - 1.1 ? P[2] : r < 15.6 - th + 1.1 ? P[0] : P[1]);
  }
  c.rect(12, 9, 3, 3, P[0]); c.set(12, 9, P[2]);
  if (gem) { c.set(13, 10, gem); }
  return done(c);
}
const T = {
  wood: () => pick(pal('#8e5634', '#c98a52', '#f2c18a')),
  stone: () => pick(pal('#6f6681', '#a59eaf', '#e6e1ec')),
  iron: () => pick(pal('#8a8aa0', '#d8d8e6', '#ffffff')),
  diamond: () => { const c = pick(ORE.crystal.slice(0, 3)); sparkle(c, 19, 4, 2, hex('#ffffff'), ORE.crystal[2]); return c; },
  laser() { const c = new Canvas(24, 24);
    line(c, 4, 20, 9, 15, STICK[1], 3); poly(c, [[7, 12], [15, 4], [19, 8], [11, 16]], hex('#8c86a8')); line(c, 8, 12, 15, 5, hex('#d8d4ee'));
    poly(c, [[15, 4], [18, 1], [22, 5], [19, 8]], ORE.crystal[1]); c.set(18, 3, hex('#ffffff')); c.set(19, 4, ORE.crystal[2]);
    c.rect(10, 11, 2, 2, hex('#ff7d6b')); done(c); sparkle(c, 21, 2, 1, hex('#ffffff'), ORE.crystal[2]); return c; },
  quake() { const c = new Canvas(24, 24);
    line(c, 4, 21, 13, 12, STICK[1], 2); line(c, 3, 21, 12, 12, STICK[2]);
    poly(c, [[8, 7], [15, 0], [23, 8], [16, 15]], hex('#8c8398')); poly(c, [[9, 7], [15, 1], [16, 2], [10, 8]], hex('#d9d4e1'));
    poly(c, [[13, 7], [15, 5], [17, 7], [15, 9]], hex('#ff7d6b')); c.set(15, 6, hex('#ffd0c4')); return done(c); },
  coreDrill() { const c = new Canvas(24, 24);
    poly(c, [[2, 8], [8, 2], [15, 9], [9, 15]], hex('#7a5a8c')); line(c, 3, 8, 8, 3, hex('#b48cc8'));
    line(c, 5, 10, 10, 5, GOLD[2], 2); line(c, 10, 14, 14, 10, GOLD[1], 2);
    poly(c, [[11, 15], [15, 11], [23, 23]], hex('#d8d8e6')); for (const k of [0, 3, 6]) line(c, 13 + k, 16 + k, 16 + k, 13 + k, hex('#8a8aa0'));
    disc(c, 7.5, 7.5, 2, GOLD[2]); c.set(7, 7, hex('#ffffff')); return done(c); }
};
// TNT：红色炸药包 + 奶油标签 + 引信火花
export function tntIcon(gold) {
  const c = new Canvas(24, 24), R = pal('#c9484e', '#ff6b5e', '#ffb0a0');
  for (const [x, h] of [[4, 15], [9, 16], [14, 16], [19 - 0, 15]]) { c.rect(x, 22 - h, 4, h, R[1]); c.vline(x, 23 - h, 21, R[2]); c.vline(x + 3, 23 - h, 21, R[0]); }
  c.rect(4, 12, 19, 5, hex('#fff7e6')); c.hline(4, 22, 16, hex('#ecd3a8')); c.rect(9, 13, 9, 3, hex('#352438')); c.rect(10, 14, 7, 1, hex('#ff7d6b'));
  line(c, 13, 6, 14, 3, hex('#5e4660')); line(c, 14, 3, 16, 2, hex('#5e4660'));
  if (gold) c.each((x, y) => { const p = c.get(x, y); if (p[3] && (y === 6 || y === 7 || x === 4 || x === 22) && y > 5) c.set(x, y, GOLD[2]); });
  done(c); sparkle(c, 17, 1, 1, hex('#ffffff'), hex('#ffd84a')); c.set(18, 0, hex('#ff9a3c'));
  return c;
}

const MISC = {
  icon_talent() { const c = new Canvas(24, 24); // 发光的书
    c.rect(4, 4, 15, 17, hex('#7a5ac8')); c.rect(4, 4, 2, 17, hex('#4a3488')); c.rect(17, 5, 3, 15, hex('#fff7e6')); c.vline(19, 5, 19, hex('#ecd3a8'));
    poly(c, [[11, 8], [15, 12], [11, 16], [7, 12]], GOLD[2]); c.set(11, 10, hex('#ffffff')); c.set(10, 11, GOLD[3]);
    for (const [x, y] of [[6, 4], [16, 4], [6, 20], [16, 20]]) c.set(x, y, GOLD[2]);
    done(c); sparkle(c, 20, 3, 2, hex('#ffffff'), hex('#e6d4ff')); return c; },
  icon_upgrade() { const c = new Canvas(24, 24), P = pal('#5e5670', '#8c86a8', '#d8d4ee'); // 铁砧 + 星
    poly(c, [[2, 7], [21, 7], [21, 11], [15, 12], [15, 16], [8, 16], [8, 12], [5, 11]], P[1]); c.hline(3, 20, 7, P[2]); c.hline(3, 20, 8, P[2]);
    c.rect(5, 17, 14, 4, P[0]); c.hline(5, 18, 17, P[1]); done(c); sparkle(c, 18, 3, 2, hex('#ffffff'), GOLD[2]); return c; },
  icon_settings() { const c = new Canvas(24, 24), P = pal('#6f6681', '#a59eaf', '#e6e1ec');
    for (let a = 0; a < 8; a++) { const t = a * Math.PI / 4, x = 12 + Math.cos(t) * 8.5, y = 12 + Math.sin(t) * 8.5; c.rect(Math.round(x - 1.5), Math.round(y - 1.5), 3, 3, P[1]); }
    ring(c, 11.5, 11.5, 3, 7.5, P[1]); ring(c, 11.5, 11.5, 6.3, 7.5, P[2], (x, y) => x + y < 23); ring(c, 11.5, 11.5, 3, 4, P[0]); return done(c); },
  speaker(on) { const c = new Canvas(24, 24);
    c.rect(3, 9, 5, 6, hex('#a59eaf')); poly(c, [[7, 9], [13, 3], [13, 21], [7, 15]], hex('#e6e1ec')); c.vline(12, 4, 20, hex('#a59eaf'));
    if (on) { ring(c, 13, 12, 4, 5.2, hex('#5cc86a'), x => x > 15); ring(c, 13, 12, 7, 8.2, hex('#8ee07a'), x => x > 17); }
    else { line(c, 15, 8, 21, 16, hex('#ff6b5e'), 2); line(c, 21, 8, 15, 16, hex('#ff6b5e'), 2); }
    return done(c); },
  icon_quality() { const c = new Canvas(24, 24); gemShape(c, 12, 12, 9.5, ORE.crystal); done(c); sparkle(c, 19, 4, 2, hex('#ffffff'), ORE.crystal[2]); return c; },
  icon_reset() { const c = new Canvas(24, 24);
    ring(c, 11.5, 12.5, 5, 8, hex('#5cc86a'), (x, y) => !(x > 12 && y < 9)); ring(c, 11.5, 12.5, 7, 8, hex('#b4f28e'), (x, y) => y < 12 && !(x > 12 && y < 9));
    poly(c, [[13, 1], [21, 5], [14, 10]], hex('#5cc86a')); c.set(15, 4, hex('#b4f28e')); return done(c); },
  clock() { const c = new Canvas(24, 24);
    disc(c, 11.5, 12.5, 9.5, GOLD[1]); disc(c, 11.5, 12.5, 7.5, hex('#fff7e6')); ring(c, 11.5, 12.5, 8.6, 9.5, GOLD[2], (x, y) => x + y < 24);
    c.vline(11, 7, 12, INK); c.hline(12, 15, 12, INK); c.set(11, 12, hex('#ff6b5e')); c.rect(10, 1, 4, 2, GOLD[1]); return done(c); },
  icon_combo() { const c = new Canvas(24, 24);
    poly(c, [[13, 1], [4, 13], [11, 13], [8, 23], [20, 9], [13, 9], [17, 1]], hex('#ffd84a')); poly(c, [[13, 2], [6, 12], [9, 12], [14, 4]], hex('#fff4b8')); return done(c); },
  icon_record() { const c = new Canvas(24, 24);
    poly(c, [[5, 3], [19, 3], [18, 10], [14, 14], [10, 14], [6, 10]], GOLD[2]); ring(c, 5, 7, 2, 3.5, GOLD[1], x => x < 6); ring(c, 19, 7, 2, 3.5, GOLD[1], x => x > 18);
    c.rect(10, 14, 4, 4, GOLD[1]); c.rect(7, 18, 10, 3, hex('#b8743e')); c.hline(7, 16, 18, hex('#ecb67c')); c.vline(8, 4, 9, GOLD[3]);
    done(c); sparkle(c, 15, 6, 1, hex('#ffffff'), GOLD[3]); return c; }
};

const UP = {
  pickDamage() { const c = T.iron(); poly(c, [[17, 13], [22, 18], [19, 18], [19, 23], [15, 23], [15, 18], [12, 18]], hex('#5cc86a')); c.rect(16, 15, 2, 7, hex('#b4f28e')); return done(c); },
  magnet() { const c = new Canvas(24, 24), red = hex('#ff6b5e');
    ring(c, 12, 11, 4, 8.6, red, (x, y) => y >= 11); c.rect(4, 4, 5, 7, red); c.rect(16, 4, 5, 7, red); ring(c, 12, 11, 7.6, 8.6, hex('#ffb0a0'), (x, y) => y >= 11 && x < 12);
    c.rect(4, 2, 5, 3, hex('#e6e1ec')); c.rect(16, 2, 5, 3, hex('#e6e1ec')); done(c); sparkle(c, 12, 4, 2, hex('#ffffff'), GOLD[3]); return c; },
  bag() { const c = new Canvas(24, 24), P = pal('#8e5634', '#c98a52', '#f2c18a');
    disc(c, 12, 15, 7.5, P[1]); poly(c, [[8, 5], [16, 5], [14, 9], [10, 9]], P[1]); ring(c, 12, 15, 6.5, 7.5, P[2], (x, y) => x + y < 26);
    c.hline(9, 15, 9, P[0]); c.hline(9, 15, 10, hex('#ff7d6b')); gemShape(c, 12, 15, 3.5, ORE.crystal); return done(c); },
  workTime() { const c = new Canvas(24, 24), F = hex('#b8743e');
    c.rect(5, 2, 14, 2, F); c.rect(5, 20, 14, 2, F); c.hline(5, 18, 2, hex('#ecb67c'));
    poly(c, [[7, 4], [17, 4], [13, 12], [17, 20], [7, 20], [11, 12]], hex('#d8f4ff'));
    poly(c, [[9, 6], [15, 6], [12, 11]], GOLD[2]); poly(c, [[8, 19], [16, 19], [12, 15]], GOLD[2]); c.vline(12, 11, 15, GOLD[3]); return done(c); },
  richBonus() { const c = new Canvas(24, 24);
    const ingot = (x, y) => { poly(c, [[x + 2, y], [x + 12, y], [x + 14, y + 5], [x, y + 5]], GOLD[1]); c.hline(x + 2, x + 11, y, GOLD[3]); c.hline(x + 1, x + 12, y + 1, GOLD[2]); };
    ingot(1, 15); ingot(9, 15); ingot(5, 9); done(c); sparkle(c, 19, 5, 3, hex('#ffffff'), GOLD[3], GOLD[2]); return c; }
};

export function genIcons(out) {
  for (const o of ['stone', 'coal', 'iron', 'crystal']) out(`icons/ore_${o}.png`, oreItem(o), `icons.ore_${o}`);
  for (const id of ['wood', 'stone', 'iron', 'diamond', 'laser', 'quake']) out(`icons/tool_${id}.png`, T[id](), `icons.tool_${id}`);
  out('icons/tool_coredrill.png', T.coreDrill(), 'icons.tool_coreDrill');
  out('icons/tnt.png', tntIcon(false), 'icons.tnt');
  for (const k of ['icon_talent', 'icon_upgrade', 'icon_settings', 'icon_quality', 'icon_reset', 'clock', 'icon_combo', 'icon_record']) out(`icons/${k}.png`, MISC[k](), `icons.${k}`);
  out('icons/sound_on.png', MISC.speaker(true), 'icons.sound_on'); out('icons/sound_off.png', MISC.speaker(false), 'icons.sound_off');
  for (const [id, fn] of Object.entries(UP)) out(`icons/upgrade_${id.toLowerCase()}.png`, fn(), `icons.upgrade_${id}`);
}
