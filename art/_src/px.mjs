// v7「晴空像素 RPG」公共件：统一调色板 / 32 纹素材质 / 圆润方块收边 / 矿块与宝石 / 闪光
// 视觉语言：深梅棕描边（不用纯黑）+ 奶油高光 + 柔和底部阴影；所有资产共享这一套色板。
import { Canvas, hex, rng, mix, tileNoise, outline, disc, poly, line, ring } from './lib.mjs';

export const INK = hex('#352438');          // 统一描边
export const INK_SOFT = hex('#5e4660');     // 次级描边（矿块与石面之间）
export const mixc = (a, b, t) => [0, 1, 2].map(k => Math.round(a[k] + (b[k] - a[k]) * t)).concat(a[3] ?? 255);
export const lighten = (c, t) => mixc(c, [255, 250, 240, 255], t);
export const darken = (c, t) => mixc(c, [46, 26, 52, 255], t);
export const pal = (...s) => s.map(x => hex(x));
export const withA = (c, a) => [c[0], c[1], c[2], a];

// ---------- 全局色板 ----------
export const C = {
  cream: hex('#fff7e6'), cream2: hex('#f7e8cc'), parch: hex('#ecd3a8'), parchD: hex('#c9a374'),
  wood: hex('#c98a52'), woodD: hex('#8e5634'), woodL: hex('#ecb67c'),
  leaf: hex('#5cc86a'), leafD: hex('#2f9a4a'), leafL: hex('#b4f28e'),
  coral: hex('#ff7d6b'), coralD: hex('#c9484e'), coralL: hex('#ffb9a6'),
  sky: hex('#6ec8ff'), skyD: hex('#3b8fd8'), skyL: hex('#c6ecff'),
  gold: hex('#ffc93c'), goldD: hex('#c88a14'), goldL: hex('#fff2a6'),
  plum: hex('#7a5a8c'), white: hex('#ffffff')
};
// 石面 5 阶：暖灰紫（明亮、与描边拉开）
export const STONE = pal('#6f6681', '#8c8398', '#a59eaf', '#bdb7c6', '#d9d4e1');
// 矿：[暗面, 主体, 亮面, 高光]
export const ORE = {
  coal: pal('#262230', '#3d3849', '#5f586f', '#cbd8ff'),
  iron: pal('#b5644a', '#e8946e', '#ffc8a2', '#fff4ea'),
  crystal: pal('#138c9c', '#3fd4d6', '#a8fff2', '#ffffff'),
  gold: pal('#b87a10', '#f2b82a', '#ffe680', '#ffffff'),
  stone: pal('#6f6681', '#8c8398', '#bdb7c6', '#f2eef6')
};
export const GOLD = pal('#a86e10', '#e8a820', '#ffd84a', '#fff4b8');

// ---------- 几何 ----------
export function roundIn(n, r, m = n) { // n×m 圆角矩形内判定（纹素级）
  return (x, y) => { if (x < 0 || y < 0 || x >= n || y >= m) return false;
    const cx = x < r ? r - x - 0.5 : x > n - 1 - r ? x - (n - 1 - r) - 0.5 : 0, cy = y < r ? r - y - 0.5 : y > m - 1 - r ? y - (m - 1 - r) - 0.5 : 0;
    return cx * cx + cy * cy <= r * r; };
}
export function upscale(src, k) { const c = new Canvas(src.w * k, src.h * k); c.each((x, y) => c.set(x, y, src.get((x / k) | 0, (y / k) | 0))); return c; }

// ---------- 32 纹素石面 ----------
export function stoneTex(seed, P = STONE, pebbles = 6) {
  const r = rng(seed), n = tileNoise(seed * 7 + 3, 8), c = new Canvas(32, 32);
  c.each((x, y) => { const v = n(x / 4, y / 4) * 0.72 + r() * 0.28; c.set(x, y, P[v < 0.34 ? 1 : v < 0.62 ? 2 : 3]); });
  for (let k = 0; k < pebbles; k++) { // 圆卵石：暗体 + 顶部亮边，像嵌在岩里的小石子
    const cx = r.int(4, 27), cy = r.int(4, 27), rx = r.int(1, 2) + 0.6, ry = rx * 0.7;
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) { const d = (x / rx) ** 2 + (y / ry) ** 2; if (d > 1) continue;
      c.set(cx + x, cy + y, y < -ry * 0.35 ? P[4] : y > ry * 0.35 ? P[0] : P[1]); }
  }
  return c;
}

// 椭圆矿块：外圈 rim（嵌入感）+ 上左亮 / 右下暗 + 一颗高光
export function nugget(c, cx, cy, rx, ry, P, rim, r) {
  const jit = r ? [r(), r(), r(), r()] : [0, 0, 0, 0];
  const inside = (x, y) => { const a = Math.atan2(y, x), q = Math.floor(((a + Math.PI) / (Math.PI / 2))) % 4;
    const k = 1 + jit[q] * 0.18; return (x / (rx * k)) ** 2 + (y / (ry * k)) ** 2 <= 1; };
  const R = Math.ceil(Math.max(rx, ry) * 1.3) + 1;
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
    if (inside(x, y)) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => inside(x + a, y + b))) c.set(cx + x, cy + y, rim);
  }
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
    if (!inside(x, y)) continue; const t = x / rx + y / ry;
    c.set(cx + x, cy + y, t < -0.55 ? P[2] : t > 0.6 ? P[0] : P[1]);
  }
  c.set(Math.round(cx - rx * 0.45), Math.round(cy - ry * 0.45), P[3]);
}
// 宝石（拉长菱形）：左上亮面、右下暗面、中线高光棱
export function gem(c, cx, cy, s, P, rim) {
  const inside = (x, y) => Math.abs(x) / (s * 0.8) + Math.abs(y) / (s * 1.2) <= 1;
  const R = Math.ceil(s * 1.3) + 1;
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) { if (inside(x, y)) continue; if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => inside(x + a, y + b))) c.set(cx + x, cy + y, rim); }
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) { if (!inside(x, y)) continue;
    c.set(cx + x, cy + y, x < 0 && y < 0 ? P[2] : x >= 0 && y >= 0 ? P[0] : P[1]); }
  for (let y = -Math.floor(s * 1.1); y < 0; y++) if (inside(0, y)) c.set(cx, cy + y, P[3]);
}

// 圆润方块收边（32 纹素）：圆角 + 1 纹素描边 + 顶行奶油高光 / 左列亮 / 底部 2 行阴影 / 右列暗
export function pillow(c, o = {}) {
  const n = c.w, rr = o.r ?? 4, inn = roundIn(n, rr), ink = o.ink ?? INK;
  const edge = new Set(); c.each((x, y) => { if (inn(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !inn(x + a, y + b))) edge.add(x + y * n); });
  const in2 = (x, y) => inn(x, y) && !edge.has(x + y * n);
  const out = new Canvas(n, n);
  c.each((x, y) => {
    if (!inn(x, y)) return;
    if (edge.has(x + y * n)) { out.set(x, y, ink); return; }
    const p = c.get(x, y);
    let q = p;
    if (!in2(x, y - 1)) q = lighten(p, o.top ?? 0.55);
    else if (!in2(x, y - 2)) q = lighten(p, 0.2);
    else if (!in2(x, y + 1)) q = darken(p, 0.45);
    else if (!in2(x, y + 2)) q = darken(p, 0.25);
    else if (!in2(x - 1, y)) q = lighten(p, 0.24);
    else if (!in2(x + 1, y)) q = darken(p, 0.2);
    out.set(x, y, q);
  });
  return out;
}

// 四芒星闪光（像素硬边）
export function sparkle(c, x, y, s = 3, core = hex('#ffffff'), arm = hex('#fff2a6'), tip) {
  for (let i = -s; i <= s; i++) { const col = Math.abs(i) <= 1 ? core : Math.abs(i) === s && tip ? tip : arm; c.set(x + i, y, col); c.set(x, y + i, col); }
  if (s >= 3) for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) c.set(x + a, y + b, arm);
}
export const ink = (c, col = INK, diag = false) => { outline(c, col, diag); return c; };

export { Canvas, hex, rng, mix, tileNoise, outline, disc, poly, line, ring };
