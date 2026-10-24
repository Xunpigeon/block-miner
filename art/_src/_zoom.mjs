// PNG 解码（verify.mjs 用）+ 放大查看：node _zoom.mjs out.png 倍数 a.png b.png ...
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { Canvas, hex } from './lib.mjs';
export function load(path) {
  const b = readFileSync(path); let p = 8, w, h; const idat = [];
  while (p < b.length) { const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); } if (type === 'IDAT') idat.push(d); p += 12 + len; }
  const raw = inflateSync(Buffer.concat(idat)), st = w * 4, c = new Canvas(w, h), px = c.px;
  for (let y = 0; y < h; y++) { const f = raw[y * (st + 1)];
    for (let i = 0; i < st; i++) { const x = raw[y * (st + 1) + 1 + i], a = i >= 4 ? px[y * st + i - 4] : 0, bb = y ? px[(y - 1) * st + i] : 0, cc = i >= 4 && y ? px[(y - 1) * st + i - 4] : 0;
      const pa = Math.abs(bb - cc), pb = Math.abs(a - cc), pc = Math.abs(a + bb - 2 * cc), pr = pa <= pb && pa <= pc ? a : pb <= pc ? bb : cc;
      px[y * st + i] = (x + [0, a, bb, (a + bb) >> 1, pr][f]) & 255; } }
  return c;
}
if (process.argv[2]) {
  const files = process.argv.slice(4), s = +process.argv[3], imgs = files.map(load);
  const W = imgs.reduce((a, i) => a + i.w * s + 8, 8), H = Math.max(...imgs.map(i => i.h * s)) + 16, c = new Canvas(W, H);
  c.rect(0, 0, W, H, hex('#30343a')); let x = 8; for (const i of imgs) { c.blit(i, x, 8, s); x += i.w * s + 8; }
  c.save(process.argv[2]);
}
