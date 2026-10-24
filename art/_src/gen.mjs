// 生成全部美术资源：node art/_src/gen.mjs
import { writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, hex } from './lib.mjs';
import { genTiles, rockTile, ROCK } from './tiles.mjs';
import { genSprites } from './sprites.mjs';
import { genScenes, ZONES, W as BW, HH as BH } from './scenes.mjs';
import { genUI } from './ui.mjs';
import { genIcons } from './icons.mjs';
import { genLogo } from './logo.mjs';

const ART = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = {}, items = []; let bytes = 0;
const out = (rel, canvas, key) => {
  bytes += canvas.save(join(ART, rel));
  (manifest[key] ??= []).push('art/' + rel);
  items.push({ rel, canvas });
};
genTiles(out);
for (const z of ZONES) for (let v = 0; v < 4; v++) out(`tiles/rock_${z.id}_${v}.png`, rockTile(z.id, v), `tiles.rock.${z.key}`);
genScenes(out); genUI(out); genIcons(out); genSprites(out); genLogo(out);
writeFileSync(join(ART, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// 横向 2× 平铺预览（证明左右无缝）+ 七关叠层一览（不进 manifest）
const bgOf = n => items.find(i => i.rel === `bg/${n}.png`).canvas;
for (const z of ZONES) { const c = new Canvas(BW * 2, BH); for (const n of ['far', 'mid', 'near']) { const l = bgOf(`zone_${z.id}_${n}`); c.blit(l, 0, 0); c.blit(l, BW, 0); } c.save(join(ART, `_preview/zone_${z.id}_stack_2x.png`)); }
{ const lu = new Canvas(7 * 136 + 8, 144); lu.rect(0, 0, lu.w, lu.h, hex('#1c1424')); ZONES.forEach((z, i) => lu.blit(bgOf(`thumb_${z.id}`), 8 + i * 136, 8)); lu.save(join(ART, '_preview/zones_lineup.png')); }

// ---- contact-sheet ----
const FONT = { a: '010101111101101', b: '110101110101110', c: '011100100100011', d: '110101101101110', e: '111100110100111', f: '111100110100100', g: '011100101101011', h: '101101111101101', i: '111010010010111', j: '001001001101010', k: '101101110101101', l: '100100100100111', m: '101111111101101', n: '110101101101101', o: '010101101101010', p: '110101110100100', q: '010101101110011', r: '110101110101101', s: '011100010001110', t: '111010010010010', u: '101101101101111', v: '101101101101010', w: '101101111111101', x: '101101010101101', y: '101101010010010', z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110', 4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001110', _: '000000000000111', '.': '000000000000010', '/': '001001010100100', '-': '000000111000000', ' ': '000000000000000' };
function text(c, s, x, y, col, sc = 1) { for (const ch of s.toLowerCase()) { const g = FONT[ch] ?? FONT[' ']; for (let k = 0; k < 15; k++) if (g[k] === '1') c.rect(x + (k % 3) * sc, y + ((k / 3) | 0) * sc, sc, sc, col); x += 4 * sc; } }
const thumb = (src, f) => { const t = new Canvas(Math.ceil(src.w / f), Math.ceil(src.h / f)); t.each((x, y) => t.set(x, y, src.get(x * f, y * f))); return t; };
const up = (src, s) => { const t = new Canvas(src.w * s, src.h * s); t.blit(src, 0, 0, s); return t; };
const SECTIONS = [
  ['tiles/ore_', c => c], ['tiles/rock_', c => c], ['tiles/band_', c => c], ['tiles/crack_', c => c], ['tiles/pit_', c => c], ['drops/', c => up(c, 3)], ['fx/', c => up(c, 3)],
  ['icons/', c => up(c, 2)], ['ui/', c => c.w <= 32 ? up(c, 3) : c], ['bg/zone_', c => thumb(c, 2)], ['bg/', c => c.h > 300 ? thumb(c, 2) : c], ['logo/', c => c]
];
const SW = 1400, PAD = 12, layout = [], claimed = new Set(); let y = PAD;
for (const [prefix, view] of SECTIONS) {
  const list = items.filter(i => i.rel.startsWith(prefix) && !claimed.has(i)); list.forEach(i => claimed.add(i)); if (!list.length) continue;
  layout.push({ head: prefix.replace(/_$/, '').replace(/\/$/, ''), x: PAD, y }); y += 18;
  let x = PAD, rowH = 0;
  for (const it of list) {
    const v = view(it.canvas), label = basename(it.rel, '.png'), w = Math.max(v.w, label.length * 4) + 10;
    if (x + w > SW - PAD) { x = PAD; y += rowH + 4; rowH = 0; }
    layout.push({ v, label, x, y }); x += w; rowH = Math.max(rowH, v.h + 10);
  }
  y += rowH + 14;
}
const sheet = new Canvas(SW, y); sheet.rect(0, 0, SW, y, hex('#0b0e13'));
for (const L of layout) {
  if (L.head) { text(sheet, L.head, L.x, L.y, hex('#ff8a3d'), 2); sheet.hline(L.x, SW - PAD, L.y + 12, hex('#2a2a2a')); continue; }
  for (let j = 0; j < L.v.h; j++) for (let i = 0; i < L.v.w; i++) sheet.set(L.x + i, L.y + j, ((i >> 3) + (j >> 3)) & 1 ? hex('#1a2029') : hex('#141b24')); // 棋盘格看透明
  sheet.blit(L.v, L.x, L.y); text(sheet, L.label, L.x, L.y + L.v.h + 3, hex('#8a97a6'));
}
sheet.save(join(ART, 'contact-sheet.png'));
console.log(`generated ${items.length} assets, ${(bytes / 1024).toFixed(1)} KB total (excl. previews/contact sheet)`);
