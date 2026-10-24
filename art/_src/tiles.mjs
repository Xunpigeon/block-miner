// v7 方块贴图：32×32 纹素 → ×2 放大到 64×64
// 圆润「枕头块」：圆角 + 梅棕描边 + 顶部奶油高光 + 底部柔影；矿物是带高光的圆矿块 / 宝石
// 矿石 4 种 × 普通/富矿 × 4 变体（金矿由运行时把煤矿图按亮度金色化）；岩底 7；裂纹 3×8；凹坑 4；岩层带 5；宝箱 2
import { Canvas, hex, rng, STONE, ORE, GOLD, INK, INK_SOFT, stoneTex, nugget, gem, pillow, upscale, sparkle, lighten, darken, pal, roundIn, withA } from './px.mjs';

export const TS = 64, K = 2, N = 32;
export const ORES = ['stone', 'coal', 'iron', 'crystal'];

// 在 32×32 内放 n 个互不重叠的点（留出圆角与描边）
function scatter(r, n, minD, lo = 7, hi = 24) {
  const pts = [];
  for (let t = 0; t < 400 && pts.length < n; t++) { const x = r.int(lo, hi), y = r.int(lo, hi); if (pts.every(([a, b]) => Math.hypot(a - x, b - y) >= minD)) pts.push([x, y]); }
  return pts;
}

// 32 纹素矿石面（未收边）
export function oreFace(ore, rich, v) {
  const oi = ORES.indexOf(ore), r = rng(9100 + oi * 97 + (rich ? 50 : 0) + v * 13);
  const c = stoneTex(4100 + v * 31 + oi * 7, STONE, ore === 'stone' ? 9 : 5);
  if (ore === 'stone') {
    for (const [x, y] of scatter(r, rich ? 3 : 2, 9)) nugget(c, x, y, 2.6, 2, pal('#8c8398', '#bdb7c6', '#e6e1ec', '#ffffff'), INK_SOFT, r);
    if (rich) for (const [x, y] of scatter(r, 3, 7)) nugget(c, x, y, 1.6, 1.3, ORE.gold, darken(ORE.gold[0], 0.3), r);
    return c;
  }
  if (ore === 'crystal') {
    for (const [x, y] of scatter(r, rich ? 4 : 3, 9)) gem(c, x, y, r.int(3, 4), ORE.crystal, darken(ORE.crystal[0], 0.35));
    if (rich) for (const [x, y] of scatter(r, 2, 6)) c.set(x, y, hex('#ffffff'));
    return c;
  }
  const P = ORE[ore], rim = ore === 'coal' ? hex('#1d1824') : darken(P[0], 0.4);
  for (const [x, y] of scatter(r, rich ? 6 : 4, 8)) nugget(c, x, y, 2.4 + r() * 1.2, 1.9 + r() * 0.8, P, rim, r);
  if (rich) for (const [x, y] of scatter(r, 3, 6)) nugget(c, x, y, 1.4, 1.2, ORE.gold, darken(ORE.gold[0], 0.3), r);
  return c;
}

// 富矿：金色 L 形包角 + 金色内描线 + 两颗闪光（64 像素级）
function richDeco(c, seed) {
  const [gd, gm, gl, gw] = GOLD, L = 11;
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const ox = sx > 0 ? 4 : 59, oy = sy > 0 ? 4 : 59;
    for (let i = 0; i < L; i++) for (let j = 0; j < 3; j++) {
      const col = j === 2 ? gd : j === 0 ? gl : gm;
      c.set(ox + sx * i, oy + sy * j, col); c.set(ox + sx * j, oy + sy * i, col);
    }
    c.set(ox, oy, gw); c.set(ox + sx, oy + sy, gl);
  }
  const r = rng(seed);
  for (let k = 0; k < 2; k++) sparkle(c, r.int(18, 45), r.int(18, 45), 3, hex('#ffffff'), GOLD[3], GOLD[2]);
  return c;
}
export function oreTile(ore, rich, v) {
  const c = upscale(pillow(oreFace(ore, rich, v)), K);
  return rich ? richDeco(c, 300 + v * 7 + ORES.indexOf(ore)) : c;
}

// 七关岩底（关卡材质预览 / 备用）
export const ROCK = {
  quarry: pal('#6f6681', '#8c8398', '#a59eaf', '#bdb7c6', '#d9d4e1'),
  copperridge: pal('#3f6a5a', '#538a6f', '#6ea887', '#8ec9a0', '#c0ecc6'),
  blueiron: pal('#6a4a3a', '#8a654c', '#a8805e', '#c79c74', '#ecc9a0'),
  lavaedge: pal('#6a5a9a', '#8676b8', '#a493d0', '#c2b4e6', '#e6dcff'),
  starcave: pal('#4a4f8a', '#5f66a8', '#7a82c4', '#9aa2dc', '#c8ceff'),
  moonrift: pal('#8a7aa0', '#a596bc', '#c0b2d6', '#d8ccec', '#f2ecff'),
  coreheart: pal('#7a4a5a', '#9a6070', '#b87a88', '#d49aa4', '#f2c8cc')
};
const ACC = { quarry: ORE.iron, copperridge: pal('#2f9a6a', '#5cd69a', '#b4ffd6', '#ffffff'), blueiron: ORE.gold, lavaedge: pal('#c25aa8', '#ff8ad0', '#ffd0ec', '#ffffff'),
  starcave: pal('#3b6fd8', '#6ea8ff', '#c6dcff', '#ffffff'), moonrift: pal('#7a4fc0', '#b48cff', '#e6d4ff', '#ffffff'), coreheart: ORE.gold };
export function rockTile(id, v) {
  const r = rng(12000 + v * 17 + id.length * 131), c = stoneTex(7000 + v * 11 + id.length, ROCK[id], 6);
  for (const [x, y] of scatter(r, 3, 9)) nugget(c, x, y, 2.2, 1.8, ACC[id], darken(ACC[id][0], 0.4), r);
  return upscale(pillow(c), K);
}

// 破坏裂纹：从中心向外分叉，3 阶逐级累加（同一变体的阶段是包含关系）
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
export function crackSet(g) {
  const r = rng(5000 + g * 37), cx = r.int(13, 18), cy = r.int(13, 18), cells = [], out = [];
  const mask = roundIn(N, 4);
  for (let stage = 0; stage < 3; stage++) {
    const arms = [3, 3, 4][stage], len = [6, 8, 9][stage];
    for (let a = 0; a < arms; a++) {
      let d = (a * 3 + r.int(0, 7)) % 8, x = cx, y = cy;
      if (stage > 0 && cells.length && r() < 0.65) [x, y] = cells[r.int(0, cells.length - 1)];
      for (let i = 0; i < len; i++) { if (r() < 0.3) d = (d + (r() < 0.5 ? 1 : 7)) % 8; x += DIRS[d][0]; y += DIRS[d][1]; if (x < 3 || y < 3 || x > 28 || y > 28) break; cells.push([x, y]); }
    }
    const c = new Canvas(N, N), ink = withA(INK, 215), lit = hex('#ffffff', 95);
    for (const [x, y] of cells) if (!c.alpha(x + 1, y + 1)) c.set(x + 1, y + 1, lit);
    c.set(cx, cy, ink); for (const [x, y] of cells) c.set(x, y, ink);
    if (stage === 2) for (let k = 0; k < 6; k++) { const [x, y] = cells[r.int(0, cells.length - 1)]; c.set(x + 1, y, ink); }
    c.each((x, y) => { if (!mask(x, y)) c.set(x, y, [0, 0, 0, 0]); });
    out.push(upscale(c, K));
  }
  return out;
}

// 凹坑：暖可可色坑底 + 上左内阴影 + 右下亮唇 + 坑底碎石
export function pitTile(v) {
  const r = rng(8000 + v * 29), c = stoneTex(8100 + v, pal('#2e2234', '#3a2c40', '#45364c', '#504058', '#6a5872'), 3);
  const inn = roundIn(N, 4);
  c.each((x, y) => {
    if (!inn(x, y)) { c.set(x, y, [0, 0, 0, 0]); return; }
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !inn(x + a, y + b));
    if (edge) { c.set(x, y, INK); return; }
    const d = Math.min(x, y);
    if (d < 6) c.set(x, y, darken(c.get(x, y), 0.6 - d * 0.09));
    if (x >= 29 || y >= 29) c.set(x, y, hex('#7a6684'));
  });
  for (let k = 0; k < 5; k++) { const x = r.int(8, 26), y = r.int(18, 27); nugget(c, x, y, 1.6, 1.2, STONE, hex('#2a1e30'), r); }
  return upscale(c, K);
}

// 岩层带：后缀 1 表层 / 2 蓝 / 3 紫 / 4 赤 / 5 金（与 03-grid 的 bandOf(depth)+1 对齐）
export const BANDS = [['#fff7e6', 0], ['#6ea8ff', 46], ['#b48cff', 50], ['#ff7d6b', 50], ['#ffc93c', 40]];
export function bandTint(i) {
  const [col, a] = BANDS[i], r = rng(13000 + i * 7), t = new Canvas(N, N), base = hex(col), inn = roundIn(N, 4);
  if (a) t.each((x, y) => { if (!inn(x, y)) return; const v = r(); t.set(x, y, withA(base, Math.round(v < 0.2 ? a * 0.55 : v > 0.9 ? a * 1.7 : a))); });
  if (a) for (let k = 0; k < 4; k++) t.set(r.int(5, 26), r.int(5, 26), withA(lighten(base, 0.7), Math.min(255, a * 3 + 40)));
  return upscale(t, K);
}
export function bandEdge(i) {
  const [col] = BANDS[i], e = hex(col), hi = lighten(e, 0.5), lo = darken(e, 0.3), c = new Canvas(N, N);
  if (i === 0) return upscale(c, K);
  const inn = roundIn(N, 4), in2 = roundIn(N - 2, 3), in3 = roundIn(N - 4, 2);
  c.each((x, y) => {
    if (!inn(x, y) || !in2(x - 1, y - 1)) return;          // 跳过外描边那一圈
    if (in3(x - 2, y - 2)) return;
    c.set(x, y, y < 16 && x < 16 ? hi : x + y > 40 ? lo : e);
  });
  for (const [x, y] of [[4, 4], [27, 4], [4, 27], [27, 27]]) { c.set(x, y, hi); c.set(x + 1, y, e); c.set(x, y + 1, e); c.set(x + 1, y + 1, lo); }
  return upscale(c, K);
}

// 地心宝藏：木箱 + 金箍 + 锁扣 + 闪光（透明底，光柱由 03-grid 画）
export function treasureTile(v) {
  const c = new Canvas(N, N), W = pal('#7a4a2c', '#a8683c', '#d08e54', '#f2c18a'), G = GOLD;
  const rect = (x, y, w, h, col) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) c.set(i, j, col); };
  rect(4, 15, 24, 13, W[1]); rect(4, 15, 24, 2, W[2]); rect(4, 25, 24, 3, W[0]);   // 箱体
  for (let x = 6; x < 26; x += 5) rect(x, 17, 1, 8, W[0]);                          // 木板缝
  for (let y = 6; y < 15; y++) { const inset = y < 8 ? 2 : y < 10 ? 1 : 0; rect(4 + inset, y, 24 - inset * 2, 1, y < 8 ? W[3] : y < 11 ? W[2] : W[1]); } // 拱形盖
  rect(4, 13, 24, 2, W[0]);
  for (const x of [8, 22]) { rect(x, 6, 2, 22, G[1]); rect(x, 6, 1, 22, G[3]); }   // 金箍
  rect(4, 14, 24, 1, G[1]);
  rect(13, 11, 6, 8, G[0]); rect(14, 12, 4, 6, G[2]); rect(15, 14, 2, 3, INK); c.set(14, 12, G[3]); // 锁扣
  const out = upscale(c, K);
  outlineTex(out, INK);
  const r = rng(77 + v * 9);
  sparkle(out, 50 + r.int(-3, 3), 14 + r.int(-3, 3), 4, hex('#ffffff'), G[3], G[2]);
  if (v) sparkle(out, 10, 20, 3, hex('#ffffff'), G[3], G[2]);
  return out;
}
function outlineTex(c, col) { // 2px 外描边（与 ×2 纹素对齐）
  for (let pass = 0; pass < 2; pass++) { const m = []; c.each((x, y) => { if (!c.alpha(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => c.alpha(x + a, y + b))) m.push([x, y]); }); for (const [x, y] of m) c.set(x, y, col); }
}

export function genTiles(out) {
  for (const o of ORES) for (const rich of [false, true]) for (let v = 0; v < 4; v++)
    out(`tiles/ore_${o}_${rich ? 'rich' : 'normal'}_${v}.png`, oreTile(o, rich, v), `tiles.ore.${o}.${rich ? 'rich' : 'normal'}`);
  for (let g = 0; g < 8; g++) crackSet(g).forEach((c, s) => out(`tiles/crack_${s + 1}_${g}.png`, c, `tiles.crack.${s + 1}`));
  for (let v = 0; v < 4; v++) out(`tiles/pit_${v}.png`, pitTile(v), 'tiles.pit');
  BANDS.forEach((_, i) => { out(`tiles/band_tint_${i + 1}.png`, bandTint(i), `tiles.band.tint.${i + 1}`); out(`tiles/band_edge_${i + 1}.png`, bandEdge(i), `tiles.band.edge.${i + 1}`); });
  for (let v = 0; v < 2; v++) out(`tiles/treasure_${v}.png`, treasureTile(v), 'tiles.treasure');
}
