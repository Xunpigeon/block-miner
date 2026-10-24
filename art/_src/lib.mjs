// 像素美术生成器公共库：零依赖 PNG 编码 + 画布 + 随机数 + 可平铺噪声 + 像素图元
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function paeth(a, b, c) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }

// RGBA8 PNG，逐行挑最省的滤波器
export function encodePNG(w, h, px) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h), tmp = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const row = y * stride, prev = y ? row - stride : -1;
    let best = null, bestScore = Infinity, bestF = 0;
    for (let f = 0; f < 5; f++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const x = px[row + i], a = i >= 4 ? px[row + i - 4] : 0, b = prev >= 0 ? px[prev + i] : 0, c = i >= 4 && prev >= 0 ? px[prev + i - 4] : 0;
        const v = (f === 0 ? x : f === 1 ? x - a : f === 2 ? x - b : f === 3 ? x - ((a + b) >> 1) : x - paeth(a, b, c)) & 255;
        tmp[i] = v; score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) { bestScore = score; bestF = f; best = Buffer.from(tmp); }
    }
    raw[y * (stride + 1)] = bestF; best.copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export function hex(s, a = 255) { const v = parseInt(s.replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a]; }

export class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.px = new Uint8Array(w * h * 4); }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { if (!this.inb(x, y)) return [0, 0, 0, 0]; const i = (y * this.w + x) * 4, p = this.px; return [p[i], p[i + 1], p[i + 2], p[i + 3]]; }
  alpha(x, y) { return this.inb(x, y) ? this.px[(y * this.w + x) * 4 + 3] : 0; }
  set(x, y, c) { if (!c || !this.inb(x, y)) return; const i = (y * this.w + x) * 4; this.px.set(c.length === 4 ? c : [...c, 255], i); }
  // 源 over 合成（只在需要半透明叠加时用）
  blend(x, y, c) {
    if (!this.inb(x, y)) return; const a = (c[3] ?? 255) / 255; if (a >= 1) return this.set(x, y, c);
    const d = this.get(x, y), da = d[3] / 255, oa = a + da * (1 - a); if (oa <= 0) return;
    this.set(x, y, [0, 1, 2].map(k => Math.round((c[k] * a + d[k] * da * (1 - a)) / oa)).concat(Math.round(oa * 255)));
  }
  rect(x, y, w, h, c) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c); }
  hline(x0, x1, y, c) { for (let x = x0; x <= x1; x++) this.set(x, y, c); }
  vline(x, y0, y1, c) { for (let y = y0; y <= y1; y++) this.set(x, y, c); }
  blit(src, dx, dy, scale = 1) {
    for (let y = 0; y < src.h * scale; y++) for (let x = 0; x < src.w * scale; x++) {
      const c = src.get((x / scale) | 0, (y / scale) | 0); if (c[3]) this.blend(dx + x, dy + y, c);
    }
  }
  each(fn) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) fn(x, y); }
  save(path) { mkdirSync(dirname(path), { recursive: true }); const b = encodePNG(this.w, this.h, this.px); writeFileSync(path, b); return b.length; }
}

export function rng(seed) {
  let a = seed >>> 0;
  const r = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pick = arr => arr[Math.floor(r() * arr.length)];
  return r;
}

// 周期为 period 的格点值噪声：四边天然无缝
export function tileNoise(seed, period) {
  const lat = new Float32Array(period * period), r = rng(seed);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  const L = (i, j) => lat[(((j % period) + period) % period) * period + (((i % period) + period) % period)];
  const s = t => t * t * (3 - 2 * t);
  return (x, y) => { const i = Math.floor(x), j = Math.floor(y), fx = s(x - i), fy = s(y - j);
    const a = L(i, j) + (L(i + 1, j) - L(i, j)) * fx, b = L(i, j + 1) + (L(i + 1, j + 1) - L(i, j + 1)) * fx; return a + (b - a) * fy; };
}
// size 像素的图上平铺 fbm；base 为最低频格点数（必须整除 size 的周期关系由 period 保证）
export function tileFbm(seed, size, base, oct = 4) {
  const ns = []; for (let o = 0; o < oct; o++) ns.push(tileNoise(seed + o * 101, base << o));
  return (x, y) => { let v = 0, amp = 0.5, tot = 0; for (let o = 0; o < oct; o++) { const p = base << o; v += ns[o](x * p / size, y * p / size) * amp; tot += amp; amp *= 0.5; } return v / tot; };
}

export const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
export const dither = (x, y, t) => (BAYER4[y & 3][x & 3] + 0.5) / 16 < t;

export function line(c, x0, y0, x1, y1, col, w = 1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
  for (;;) { c.rect(x0 - ((w - 1) >> 1), y0 - ((w - 1) >> 1), w, w, col); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
}
export function disc(c, cx, cy, r, col) { for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) c.set(x, y, col); }
export function ring(c, cx, cy, r0, r1, col, filter) { for (let y = Math.floor(cy - r1); y <= Math.ceil(cy + r1); y++) for (let x = Math.floor(cx - r1); x <= Math.ceil(cx + r1); x++) { const d = Math.hypot(x - cx, y - cy); if (d >= r0 && d <= r1 && (!filter || filter(x, y, Math.atan2(y - cy, x - cx)))) c.set(x, y, col); } }
export function poly(c, pts, col) {
  const ys = pts.map(p => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    const yc = y + 0.5, xs = [];
    for (let i = 0; i < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length]; if ((ay <= yc) !== (by <= yc)) xs.push(ax + (yc - ay) / (by - ay) * (bx - ax)); }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) c.set(x, y, col);
  }
}
// 给不透明像素外侧描一圈（4 邻域），用于图标/掉落物
export function outline(c, col, diag = false) {
  const marks = [];
  c.each((x, y) => { if (c.alpha(x, y)) return; const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].concat(diag ? [[1, 1], [-1, 1], [1, -1], [-1, -1]] : []);
    if (n.some(([dx, dy]) => c.alpha(x + dx, y + dy) > 0)) marks.push([x, y]); });
  for (const [x, y] of marks) c.set(x, y, col);
}
// 对不透明形状做上左亮、右下暗的 1px 内斜角
export function bevel(c, hi, lo) {
  const marks = [];
  c.each((x, y) => { if (!c.alpha(x, y)) return; if (!c.alpha(x - 1, y) || !c.alpha(x, y - 1)) marks.push([x, y, hi]); else if (!c.alpha(x + 1, y) || !c.alpha(x, y + 1)) marks.push([x, y, lo]); });
  for (const [x, y, k] of marks) c.set(x, y, k);
}
export const mix = (a, b, t) => [0, 1, 2].map(k => Math.round(a[k] + (b[k] - a[k]) * t)).concat(a[3] ?? 255);
