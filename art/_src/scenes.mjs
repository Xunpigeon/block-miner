// v7 多层视差背景：每关 far / mid / near 三层，256×422（运行时 ×2 = 512×844 设计像素），水平无缝。
// 四关主题：煤矿层 = 晴天山坡矿口 / 铁矿层 = 苔藓蘑菇灯笼洞 / 金矿层 = 暖金火把矿道 / 晶石层 = 粉彩水晶洞。
// 另三张备用主题（星洞 / 月隙 / 地心）用同一套洞穴管线换色。另出缩略图 / 封面 / 通用层 / 尘埃 / 光柱 / 暗角。
import { Canvas, hex, rng, dither, tileNoise, BAYER4 } from './lib.mjs';
import { lighten, darken, pal, sparkle, INK, GOLD, withA } from './px.mjs';

export const W = 256, HH = 422;
const wx = x => ((Math.round(x) % W) + W) % W;
const put = (c, x, y, col) => { y = Math.round(y); if (y >= 0 && y < HH) c.set(wx(x), y, col); };
const rect = (c, x, y, w, h, col) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(c, x + i, y + j, col); };
const H = s => typeof s === 'string' ? hex(s) : s;
// 周期为 W 的一维起伏（整数谐波 → 天然无缝）
function wave(seed, harm) { const r = rng(seed), hs = harm.map(([k, a]) => [k, a, r() * 6.2832]), tot = hs.reduce((s, h) => s + h[1], 0);
  return x => 0.5 + hs.reduce((s, [k, a, p]) => s + a * Math.sin(6.2832 * k * x / W + p), 0) / tot / 2; }
// 抖动竖向渐变（2px 一格的 Bayer）
function vgrad(c, stops, y0 = 0, y1 = HH) {
  for (let y = y0; y < y1; y++) { const t = (y - y0) / (y1 - y0); let i = 0; while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
    const [ta, ca] = stops[i], [tb, cb] = stops[i + 1], f = Math.min(1, Math.max(0, (t - ta) / (tb - ta)));
    for (let x = 0; x < W; x++) c.set(x, y, dither(x >> 1, y >> 1, f) ? H(cb) : H(ca)); }
}
// 阶梯山体：top(x) 量化到 q；顶边 rim 亮、往下抖动变暗；左侧台阶面亮
function hill(c, f, base, amp, q, [fill, top, deep], o = {}) {
  fill = H(fill); top = H(top); deep = H(deep); const tops = [];
  for (let x = 0; x < W; x++) tops[x] = Math.round((base - amp * f(Math.floor(x / q) * q)) / q) * q;
  for (let x = 0; x < W; x++) { const t = tops[x];
    for (let y = Math.max(0, t); y < (o.bottom ?? HH); y++) { const d = y - t; let col = fill;
      if (dither(x >> 1, y >> 1, Math.min(1, d / (o.fade ?? 70)))) col = deep;
      if (d < (o.rim ?? 2) || (tops[wx(x - 1)] > y && d < 24)) col = top;
      c.set(x, y, col); } }
  return tops;
}
function ceiling(c, f, base, amp, q, [fill, rim]) { fill = H(fill); rim = H(rim);
  for (let x = 0; x < W; x++) { const b = Math.round((base + amp * f(Math.floor(x / q) * q)) / q) * q; for (let y = 0; y < b; y++) c.set(x, y, y >= b - 2 ? rim : fill); } }
// 蓬松云：白顶 + 淡蓝底 + 深描边底线
function cloud(c, x, y, s) {
  const parts = [[0, 5, 12, 6], [4, 1, 9, 9], [10, 0, 10, 10], [17, 4, 9, 7]], Wc = hex('#ffffff'), S = hex('#dcefff'), L = hex('#b6d8f4');
  for (const [a, b, w, h] of parts) rect(c, x + a * s, y + b * s, w * s, h * s, Wc);
  rect(c, x + 1 * s, y + 9 * s, 24 * s, 2 * s, S); rect(c, x + 2 * s, y + 11 * s, 22 * s, s, L);
}
function tree(c, x, y, P = pal('#2f9a4a', '#4fb85a', '#7ad66a', '#b4f28e')) {
  rect(c, x - 1, y - 12, 4, 12, hex('#8e5634')); rect(c, x - 1, y - 12, 1, 12, hex('#c98a52'));
  const blobs = [[-9, -24, 22, 10], [-11, -18, 26, 8], [-6, -30, 16, 8]];
  for (const [a, b, w, h] of blobs) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const v = ((((x + a + i) >> 1) * 73856093) ^ (((y + b + j) >> 1) * 19349663)) >>> 0;
    const lit = (j < 3 ? 2 : 0) + (i < w * 0.45 ? 1 : 0) + (v % 3 === 0 ? 1 : 0);
    put(c, x + a + i, y + b + j, P[Math.min(3, lit)]);
  }
  for (const [a, b] of [[-5, -22], [4, -26], [8, -18]]) { put(c, x + a, y + b, hex('#ff7d6b')); put(c, x + a + 1, y + b, hex('#ffb9a6')); } // 小果子
}
function flower(c, x, y, k) {
  rect(c, x, y - 5, 1, 5, hex('#2f9a4a')); put(c, x + 1, y - 3, hex('#5cc86a'));
  const col = [['#ff7d6b', '#ffe680'], ['#ffd84a', '#fff7e6'], ['#8ab8ff', '#fff7e6'], ['#ff9ad0', '#ffe680']][k % 4];
  rect(c, x - 1, y - 8, 3, 3, hex(col[0])); put(c, x, y - 7, hex(col[1]));
}
function mushroom(c, x, y, s, cap = ['#ff6b6b', '#ffb0a0', '#c93c4c']) {
  rect(c, x - s, y - s * 2, s * 2, s * 2, hex('#fff1d8')); rect(c, x + s - 1, y - s * 2, 1, s * 2, hex('#e0c8a4'));
  for (let j = 0; j < s * 2; j++) { const hw = Math.round(s * 2.2 * Math.sqrt(1 - (j / (s * 2)) ** 2)); for (let i = -hw; i < hw; i++) put(c, x + i, y - s * 2 - j, hex(j > s * 1.5 ? cap[1] : i > hw * 0.5 ? cap[2] : cap[0])); }
  put(c, x - s, y - s * 3, hex('#ffffff')); put(c, x + s, y - s * 3.4, hex('#ffffff'));
}
function lantern(c, x, y, len) {
  for (let j = 0; j < len; j++) put(c, x, j, hex('#5e4660'));
  rect(c, x - 3, y, 7, 2, hex('#8e5634')); rect(c, x - 3, y + 2, 7, 8, hex('#ffd84a')); rect(c, x - 2, y + 3, 5, 6, hex('#fff4b8')); rect(c, x - 3, y + 10, 7, 2, hex('#8e5634'));
  put(c, x - 3, y + 2, hex('#c88a14')); put(c, x + 3, y + 9, hex('#c88a14'));
}
function torch(c, x, y) {
  rect(c, x, y, 2, 9, hex('#8e5634')); put(c, x, y, hex('#c98a52'));
  rect(c, x - 1, y - 5, 4, 5, hex('#ff9a3c')); rect(c, x, y - 5, 2, 3, hex('#fff2a6')); put(c, x, y - 7, hex('#ffd84a')); put(c, x + 1, y - 6, hex('#ffd84a'));
}
function crystal(c, x, y, h, dir, P) { // dir -1 朝上 / 1 朝下；P = [暗, 主, 亮, 高光]
  for (let i = 0; i < h; i++) { const w = Math.max(1, Math.round((h - i) / h * 4)); for (let k = -w; k < w; k++) put(c, x + k, y + dir * i, k === -w ? P[2] : k < 0 ? P[1] : k < w - 1 ? P[1] : P[0]); }
  for (let i = 1; i < h - 2; i++) put(c, x - 1, y + dir * i, P[3]);
}
function vine(c, x, len, berry) { for (let y = 0; y < len; y++) { const xx = x + (Math.floor(y / 7) % 2);
  put(c, xx, y, hex(y % 8 === 3 ? '#8ee07a' : '#4fae5c')); if (y % 9 === 5) { put(c, xx + 1, y, hex('#8ee07a')); put(c, xx + 2, y - 1, hex('#5cc86a')); }
  if (berry && y % 13 === 9) { rect(c, xx - 1, y, 3, 3, hex('#ffb43c')); put(c, xx - 1, y, hex('#fff2a6')); } } }

// ---------- 煤矿层：晴天山坡矿口 ----------
const quarry = {
  far() { const c = new Canvas(W, HH);
    vgrad(c, [[0, '#5cb8ff'], [0.3, '#8ad2ff'], [0.55, '#c6ecff'], [0.72, '#fff3d6'], [1, '#ffe2b0']], 0, 330);
    for (let j = -30; j < 30; j++) for (let i = -30; i < 30; i++) { const d = Math.hypot(i, j); if (d > 13 && d < 28 && dither(i, j, (28 - d) / 15 * 0.55)) put(c, 70 + i, 64 + j, hex('#fff6c8')); }
    for (let j = -12; j < 12; j++) for (let i = -12; i < 12; i++) { const d = Math.hypot(i + 0.5, j + 0.5); if (d < 12) put(c, 70 + i, 64 + j, hex(d > 10.5 ? '#ffd84a' : d < 5 && i < 0 && j < 0 ? '#ffffff' : '#fff2a6')); }
    for (const [x, y, s] of [[120, 36, 2], [196, 96, 1], [12, 128, 1], [150, 160, 1], [230, 44, 1]]) cloud(c, x, y, s);
    const mt = hill(c, wave(102, [[1, 1], [3, 0.5], [6, 0.2]]), 262, 100, 4, ['#9ab4e6', '#d0def8', '#8aa2d6'], { fade: 120 });
    for (let x = 0; x < W; x++) for (let d = 0; d < 7; d++) if (mt[x] < 205 && dither(x >> 1, (mt[x] + d) >> 1, 1 - d / 7)) put(c, x, mt[x] + d, hex('#ffffff')); // 雪顶
    hill(c, wave(103, [[2, 1], [5, 0.4]]), 312, 40, 4, ['#7ec46e', '#b4e88a', '#5eaa60'], { fade: 90 });
    const r = rng(104); for (let k = 0; k < 10; k++) { const x = r.int(0, W - 1); tree(c, x, 314 - r.int(0, 14), pal('#3e8f5a', '#55a86a', '#72c27a', '#a2dc96')); }
    return c; },
  mid() { const c = new Canvas(W, HH), r = rng(111), D = pal('#9a5a34', '#b8744a', '#d49462'), G = pal('#3fa850', '#5cc86a', '#8ee07a', '#c8ff9a');
    const f = wave(112, [[1, 1], [3, 0.6], [6, 0.2]]), tops = [];
    for (let x = 0; x < W; x++) tops[x] = Math.round((330 - 40 * f(Math.floor(x / 8) * 8)) / 4) * 4;
    for (let x = 0; x < W; x++) for (let y = tops[x]; y < HH; y++) { const d = y - tops[x], v = (((x >> 1) * 73856093) ^ ((y >> 1) * 19349663)) >>> 0;
      let col = d < 2 ? G[3] : d < 5 ? G[2] : d < 9 + (x % 11 < 3 ? 2 : 0) ? G[v % 2 ? 1 : 0] : d < 40 ? D[v % 3] : [hex('#8c8398'), hex('#a59eaf'), hex('#bdb7c6')][v % 3];
      if (d >= 38 && d < 40) col = hex('#7a4a2c'); c.set(x, y, col); }
    // 矿口：木框 + 深色洞口
    const mx = 150, my = tops[mx] + 6; rect(c, mx - 18, my, 36, 30, hex('#2a1e30')); rect(c, mx - 14, my + 4, 28, 26, hex('#1c1424'));
    rect(c, mx - 20, my - 4, 40, 5, hex('#c98a52')); rect(c, mx - 20, my - 4, 40, 1, hex('#ecb67c')); rect(c, mx - 20, my + 1, 4, 30, hex('#c98a52')); rect(c, mx + 16, my + 1, 4, 30, hex('#8e5634'));
    for (let i = 0; i < 26; i += 2) put(c, mx - 13 + i, my + 28, hex('#8c8398'));
    for (let k = 0; k < 5; k++) { const x = r.int(0, W - 1); if (Math.abs(x - mx) > 30) tree(c, x, tops[x]); }
    for (let k = 0; k < 22; k++) { const x = r.int(0, W - 1); if (Math.abs(x - mx) > 22) flower(c, x, tops[x], k); }
    for (let x = 20; x < 90; x += 10) { rect(c, x, tops[x] - 8, 2, 8, hex('#c98a52')); rect(c, x - 4, tops[x] - 6, 10, 1, hex('#ecb67c')); }
    return c; },
  near() { const c = new Canvas(W, HH), G = pal('#2f9a4a', '#4fb85a', '#7ad66a', '#b4f28e'), f = wave(122, [[2, 1], [5, 0.6], [9, 0.3]]);
    for (let x = 0; x < W; x++) { const b = Math.round(f(Math.floor(x / 4) * 4) * 24 - 2); for (let y = 0; y < b; y++) { const v = (((x >> 1) * 2654435761) ^ (y >> 1) * 40503) >>> 0; c.set(x, y, G[y > b - 3 ? 0 : v % 4]); } }
    const r = rng(123); for (let k = 0; k < 8; k++) vine(c, r.int(0, W - 1), r.int(14, 40), false);
    const g2 = wave(124, [[3, 1], [7, 0.4]]);
    for (let x = 0; x < W; x++) { const t = HH - 16 - Math.round(g2(x) * 8); for (let y = t; y < HH; y++) { const d = y - t; c.set(x, y, d < 2 ? G[3] : d < 6 ? G[2] : G[d % 5 === 0 ? 0 : 1]); }
      if (x % 3 === 0) { put(c, x, t - 1, G[2]); if (x % 6 === 0) put(c, x, t - 2, G[3]); } }
    for (let k = 0; k < 12; k++) { const x = r.int(0, W - 1); flower(c, x, HH - 14, k + 1); }
    return c; }
};

// ---------- 洞穴管线 ----------
function caveFar(z) {
  const c = new Canvas(W, HH), n = tileNoise(z.seed + 5, 32), ramp = z.ramp.map(H), B = 16;
  for (let y = 0; y < HH; y++) for (let x = 0; x < W; x++) {
    const bx = Math.floor(x / B), off = bx & 1 ? 8 : 0, by = Math.floor((y + off) / B), lx = x - bx * B, ly = (y + off) - by * B;
    const h = ((((bx % 16) * 73856093) ^ (by * 19349663) ^ z.seed) >>> 0) % 1000 / 1000, tx = x >> 1, ty = y >> 1;
    let v = 0.28 + (h - 0.5) * 0.16 + (n(tx / 4, ty / 4) - 0.5) * 0.24;
    if (lx < 2 || ly < 2) v += 0.08; if (lx >= B - 2 || ly >= B - 2) v -= 0.1; if (lx === B - 1 || ly === B - 1) v -= 0.2;
    let lit = 0, tint = null;
    for (const L of z.lights) { let dx = Math.abs(x - L[0]); dx = Math.min(dx, W - dx); const d = Math.hypot(dx, y - L[1]) / L[2]; const e = Math.exp(-d * d) * (L[4] ?? 0.55); if (e > lit * 0.5) tint = L[3]; lit += e; }
    v += lit;
    const idx = Math.max(0, Math.min(ramp.length - 1, Math.floor(v * ramp.length + (BAYER4[ty & 3][tx & 3] / 16 - 0.5))));
    let col = ramp[idx];
    if (tint && lit > 0.1) { const tc = H(tint), k = Math.min(0.5, lit * 0.5); col = [0, 1, 2].map(i => Math.round(col[i] + (tc[i] - col[i]) * k)).concat(255); }
    if (h > 0.86 && lx > 3 && ly > 3 && lx < 12 && ly < 12 && n(tx * 1.7, ty * 1.7) > 0.6) col = H(z.accent[(tx + ty) & 1]);
    c.set(x, y, col);
  }
  z.far?.(c, rng(z.seed + 7));
  return c;
}
function caveMid(z) {
  const c = new Canvas(W, HH), R = z.rock.map(H), r = rng(z.seed + 11);
  ceiling(c, wave(z.seed + 12, [[2, 1], [5, 0.6], [11, 0.3]]), 18, 44, 4, [R[0], R[2]]);
  hill(c, wave(z.seed + 13, [[2, 1], [4, 0.5], [9, 0.3]]), 388, 40, 4, [R[1], R[2], R[0]], { fade: 50 });
  for (let k = 0; k < 9; k++) { const x = r.int(0, W - 1), L = r.int(18, 64), w = r.int(3, 6) * 2; // 钟乳石
    for (let s = 0; s < L; s += 4) { const ww = Math.max(1, Math.round(w * (1 - s / L) / 2)); for (let j = 0; j < 4; j++) for (let i = -ww; i < ww; i++) put(c, x + i, 28 + s + j, i === -ww ? R[2] : R[0]); } }
  for (let k = 0; k < 6; k++) { const x = r.int(0, W - 1), L = r.int(14, 48), w = r.int(3, 6) * 2; // 石笋
    for (let s = 0; s < L; s += 4) { const ww = Math.max(1, Math.round(w * (1 - s / L) / 2)); for (let j = 0; j < 4; j++) for (let i = -ww; i < ww; i++) put(c, x + i, 384 - s - j, i === -ww || (j === 3 && s + 4 >= L) ? R[2] : R[1]); } }
  z.mid?.(c, r);
  return c;
}
function caveNear(z) {
  const c = new Canvas(W, HH), D = H(z.near[0]), rim = H(z.near[1]), r = rng(z.seed + 21);
  ceiling(c, wave(z.seed + 22, [[1, 1], [3, 0.7], [7, 0.4]]), 4, 40, 4, [D, rim]);
  hill(c, wave(z.seed + 23, [[1, 1], [3, 0.6], [8, 0.3]]), HH - 8, 28, 4, [D, rim, D], { fade: 999 });
  for (let k = 0; k < 5; k++) { const x = r.int(0, W - 1), L = r.int(26, 70);
    for (let s = 0; s < L; s += 4) { const ww = Math.max(1, Math.round(6 * (1 - s / L))); for (let j = 0; j < 4; j++) for (let i = -ww; i < ww; i++) put(c, x + i, 18 + s + j, i === ww - 1 ? rim : D); } }
  z.near2?.(c, r);
  return c;
}

const AME = pal('#7a4fc0', '#b48cff', '#e6d4ff', '#ffffff'), PINK = pal('#c25aa8', '#ff8ad0', '#ffd0ec', '#ffffff'), CYAN = pal('#138c9c', '#3fd4d6', '#a8fff2', '#ffffff');
const CAVES = {
  // 铁矿层：苔藓蘑菇灯笼洞（青绿 + 暖灯）
  copperridge: { seed: 301, ramp: ['#24423e', '#2e5650', '#3a6c60', '#4a8470', '#5e9e80', '#7cba92', '#a6d8a8'], accent: ['#8ee07a', '#ffb43c'],
    lights: [[48, 150, 66, '#ffd27a', 0.5], [180, 96, 70, '#ffd27a', 0.48], [124, 320, 80, '#a6ffd0', 0.38]],
    rock: ['#2a4c42', '#3a6a56', '#7cc48a'], near: ['#16302a', '#5cb07a'],
    far(c, r) { for (let k = 0; k < 14; k++) { const x = r.int(0, W - 1), y = r.int(60, 380); put(c, x, y, hex('#c8ffd8')); put(c, x + 1, y, hex('#8ee0b0')); } },
    mid(c, r) { for (let k = 0; k < 11; k++) vine(c, r.int(0, W - 1), r.int(40, 140), true);
      for (const x of [40, 120, 200]) lantern(c, x, 62 + (x % 30), 62 + (x % 30));
      for (let x = 0; x < W; x++) for (let y = 300; y < HH; y++) if (c.alpha(x, y) && !c.alpha(x, y - 1)) { rect(c, x, y, 1, 3, hex(x % 5 ? '#6cc878' : '#a8ec8a')); break; }
      for (let k = 0; k < 7; k++) { const x = r.int(0, W - 1); let y = 300; while (y < HH && !c.alpha(wx(x), y)) y++; if (y < HH - 4) mushroom(c, x, y + 1, r.int(2, 3), k % 2 ? ['#ff6b6b', '#ffb0a0', '#c93c4c'] : ['#ffb43c', '#ffe08a', '#c8781a']); } },
    near2(c, r) { for (let k = 0; k < 6; k++) vine(c, r.int(0, W - 1), r.int(40, 96), true); for (let k = 0; k < 3; k++) mushroom(c, r.int(0, W - 1), HH - 12, 4); } },
  // 金矿层：暖金火把矿道（琥珀 + 木梁 + 金脉）
  blueiron: { seed: 401, ramp: ['#3a2430', '#4e3038', '#664040', '#82544a', '#a06a52', '#c28a60', '#e6b478'], accent: ['#ffd84a', '#fff2a6'],
    lights: [[62, 172, 58, '#ffc860', 0.66], [192, 122, 58, '#ffc860', 0.66], [128, 320, 80, '#ffe08a', 0.36]],
    rock: ['#4a2e30', '#6a4238', '#e6a840'], near: ['#2a1820', '#e0a040'],
    far(c) { torch(c, 61, 168); torch(c, 191, 118); for (let k = 0; k < 26; k++) { const x = (k * 61) % W, y = 40 + (k * 89) % 330; put(c, x, y, hex('#ffd84a')); put(c, x + 1, y + 1, hex('#fff2a6')); } },
    mid(c, r) { for (const x0 of [24, 152]) { rect(c, x0, 60, 5, 330, hex('#8e5634')); rect(c, x0, 60, 1, 330, hex('#c98a52')); rect(c, x0 + 52, 60, 5, 330, hex('#8e5634')); rect(c, x0 + 52, 60, 1, 330, hex('#c98a52'));
        rect(c, x0 - 3, 56, 63, 6, hex('#c98a52')); rect(c, x0 - 3, 56, 63, 1, hex('#ecb67c')); rect(c, x0 - 3, 61, 63, 1, hex('#5e3a24')); }
      for (let x = 0; x < W; x++) { if (x % 8 < 3) rect(c, x, 372, 1, 3, hex('#8e5634')); put(c, x, 370, hex('#c0c0d0')); put(c, x, 375, hex('#c0c0d0')); }
      const cx = 96; rect(c, cx, 352, 30, 16, hex('#6a6478')); rect(c, cx, 352, 30, 2, hex('#a8a2b8')); rect(c, cx + 3, 348, 24, 5, hex('#ffd84a')); rect(c, cx + 6, 346, 6, 3, hex('#fff2a6'));
      for (const wxp of [cx + 5, cx + 22]) { rect(c, wxp, 367, 4, 4, hex('#352438')); put(c, wxp + 1, 368, hex('#8c8398')); } },
    near2(c) { for (let k = 0; k < 10; k++) { const x = (k * 37) % W, y = 30 + (k * 53) % 40; put(c, x, y, hex('#ffd84a')); put(c, x + 1, y, hex('#fff2a6')); } } },
  // 晶石层：粉彩水晶洞（薰衣草 + 粉 + 青）
  lavaedge: { seed: 501, ramp: ['#2e2850', '#3c3466', '#4c4280', '#5e549a', '#7468b4', '#9488ce', '#bcb0e8'], accent: ['#ff8ad0', '#a8fff2'],
    lights: [[60, 320, 76, '#ff9ad8', 0.5], [200, 70, 76, '#a8f0ff', 0.48], [140, 200, 60, '#e6d4ff', 0.36]],
    rock: ['#342c5a', '#4a3e7a', '#c8a8ff'], near: ['#1e1838', '#b48cff'],
    far(c, r) { for (let k = 0; k < 40; k++) { const x = r.int(0, W - 1), y = r.int(10, 400); put(c, x, y, hex(k % 3 ? '#ffffff' : '#ffd0ec')); } },
    mid(c, r) { for (let k = 0; k < 14; k++) { const x = r.int(0, W - 1); crystal(c, x, 386 - r.int(0, 18), r.int(12, 30), -1, [AME, PINK, CYAN][k % 3]); }
      for (let k = 0; k < 10; k++) crystal(c, r.int(0, W - 1), 40 + r.int(0, 18), r.int(8, 20), 1, [AME, PINK, CYAN][k % 3]); },
    near2(c, r) { for (let k = 0; k < 6; k++) crystal(c, r.int(0, W - 1), HH - 14, r.int(18, 38), -1, [PINK, CYAN, AME][k % 3]);
      for (let x = 0; x < W; x++) for (let y = HH - 6; y < HH; y++) c.set(x, y, hex((x + y) % 7 < 2 ? '#d8f6ff' : '#9ad8f0')); } },
  // 备用主题
  starcave: { seed: 601, ramp: ['#1e2450', '#283066', '#323e80', '#3e4e9a', '#5064b4', '#6a80ce', '#94a8e8'], accent: ['#c6dcff', '#ffe680'],
    lights: [[70, 320, 70, '#a8c8ff', 0.5], [200, 70, 70, '#ffe680', 0.4]], rock: ['#222a5a', '#323e7a', '#8ab0ff'], near: ['#121838', '#6e9aff'],
    mid(c, r) { for (let k = 0; k < 12; k++) crystal(c, r.int(0, W - 1), 386 - r.int(0, 16), r.int(10, 22), -1, pal('#3b6fd8', '#6ea8ff', '#c6dcff', '#ffffff')); } },
  moonrift: { seed: 701, ramp: ['#3e2e58', '#4e3c6e', '#604c86', '#765e9e', '#8e74b6', '#aa90ce', '#ccb4e6'], accent: ['#ffd0ec', '#ffffff'],
    lights: [[128, 80, 90, '#ffe6f4', 0.5], [40, 320, 60, '#ffb0dc', 0.36]], rock: ['#3a2c54', '#54427a', '#ffb0dc'], near: ['#221834', '#e090c8'],
    mid(c, r) { for (let k = 0; k < 9; k++) crystal(c, r.int(0, W - 1), 386, r.int(10, 22), -1, PINK); } },
  coreheart: { seed: 801, ramp: ['#40202c', '#562a36', '#6e3640', '#88464a', '#a65c54', '#c87a62', '#eaa476'], accent: ['#ffd84a', '#ffffff'],
    lights: [[128, 220, 90, '#ffd27a', 0.5], [30, 90, 50, '#ff9a7a', 0.36]], rock: ['#4a2430', '#6a3440', '#ffc060'], near: ['#2a1218', '#ffb04a'],
    mid(c, r) { for (let k = 0; k < 8; k++) crystal(c, r.int(0, W - 1), 386, r.int(10, 24), -1, pal('#b87a10', '#f2b82a', '#ffe680', '#ffffff')); } }
};

export const ZONES = [
  { id: 'quarry', key: 'quarry' }, { id: 'copperridge', key: 'copperRidge' }, { id: 'blueiron', key: 'blueIron' }, { id: 'lavaedge', key: 'lavaEdge' },
  { id: 'starcave', key: 'starCave' }, { id: 'moonrift', key: 'moonRift' }, { id: 'coreheart', key: 'coreHeart' }
];
export function layers(id) {
  if (id === 'quarry') return [quarry.far(), quarry.mid(), quarry.near()];
  const z = CAVES[id]; return [caveFar(z), caveMid(z), caveNear(z)];
}
function stack(ls) { const c = new Canvas(W, HH); for (const l of ls) c.blit(l, 0, 0); return c; }
function crop(src, x0, y0, w, h) { const c = new Canvas(w, h); c.each((x, y) => c.set(x, y, src.get(((x0 + x) % src.w + src.w) % src.w, Math.min(src.h - 1, y0 + y)))); return c; }
function framed(c) { // 缩略图 / 封面：圆角 + 2px 梅棕描边 + 1px 奶油内亮边
  const r = 6; c.each((x, y) => { const cx = Math.max(0, r - Math.min(x, c.w - 1 - x)), cy = Math.max(0, r - Math.min(y, c.h - 1 - y)), d = Math.hypot(cx, cy);
    if (d > r) c.set(x, y, [0, 0, 0, 0]); else if (d > r - 2 || Math.min(x, y, c.w - 1 - x, c.h - 1 - y) < 2) c.set(x, y, INK); else if (d > r - 3 || Math.min(x, y, c.w - 1 - x, c.h - 1 - y) === 2) c.set(x, y, lighten(c.get(x, y), 0.45)); });
  return c;
}

export function genScenes(out) {
  const all = {};
  for (const z of ZONES) {
    const ls = layers(z.id); all[z.id] = ls;
    ['far', 'mid', 'near'].forEach((n, i) => out(`bg/zone_${z.id}_${n}.png`, ls[i], `bg.zone.${z.key}.${n}`));
    const st = stack(ls);
    out(`bg/thumb_${z.id}.png`, framed(crop(st, 88, z.id === 'quarry' ? 236 : 250, 128, 128)), `bg.thumb.${z.key}`);
    const wide = new Canvas(512, 160); wide.blit(crop(st, 0, 220, 256, 160), 0, 0); wide.blit(crop(st, 0, 220, 256, 160), 256, 0);
    out(`bg/cover_${z.id}.png`, framed(wide), `bg.cover.${z.key}`);
  }
  const g = all.copperridge;
  out('bg/cave_far.png', g[0], 'bg.far'); out('bg/cave_mid.png', g[1], 'bg.mid'); out('bg/cave_near.png', g[2], 'bg.near');
  // 尘埃：稀疏的暖色光点（四边无缝）
  const d = new Canvas(256, 256), r = rng(9); for (let k = 0; k < 60; k++) { const x = r.int(0, 255), y = r.int(0, 255), a = r.int(70, 170); d.set(x, y, hex('#fff6dc', a)); if (r() < 0.35) d.set((x + 1) % 256, y, hex('#fff6dc', a >> 1)); }
  out('bg/dust_layer.png', d, 'bg.dust');
  // 光柱：中心亮两边淡出（运行时拉伸，用平滑 alpha）
  const s = new Canvas(128, 256); s.each((x, y) => { const t = 1 - Math.abs(x - 63.5) / 64, v = Math.pow(Math.max(0, t), 1.6) * (1 - y / 256 * 0.75); s.set(x, y, hex('#fff4d0', Math.round(v * 150))); });
  out('bg/lightshaft.png', s, 'bg.lightshaft');
  // 暗角：暖梅色，很轻（明亮风格不压黑）
  const v = new Canvas(195, 422); v.each((x, y) => { const dx = (x - 97) / 110, dy = (y - 211) / 250, t = Math.max(0, Math.hypot(dx, dy) - 0.7); v.set(x, y, hex('#3a2040', Math.min(150, Math.round(t * t * 700)))); });
  out('bg/vignette.png', v, 'bg.vignette');
  return all;
}
