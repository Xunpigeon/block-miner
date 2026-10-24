// 美术自检（v6 方块 RPG 版）：node art/_src/verify.mjs
// 检查：期望键齐全 / 文件存在 / 尺寸 / 命名 / 总体积 ≤10MB / 方块不透明且有描边 / 关卡背景左右无缝 / 禁用词
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from './_zoom.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const man = JSON.parse(readFileSync(join(ROOT, 'art/manifest.json'), 'utf8'));
const files = Object.values(man).flat();
const fail = []; let bytes = 0;
const SIZE = [[/tiles\//, 64, 64], [/drops\//, 16, 16], [/fx\/chip_/, 12, 12], [/fx\/deep_ring/, 128, 128], [/fx\/(spark|star)/, 8, 8], [/fx\/dust/, 16, 16], [/fx\/tnt/, 24, 24],
  [/bg\/(cave_|zone_)/, 256, 422], [/bg\/dust_/, 256, 256], [/bg\/cover_/, 512, 160], [/bg\/thumb_/, 128, 128], [/vignette/, 195, 422], [/lightshaft/, 128, 256],
  [/ui\/bar_/, 32, 12], [/ui\/confirm/, 320, 200], [/ui\//, 24, 24], [/icons\//, 24, 24], [/logo\//, 512, 160]];
const ZONES = ['quarry', 'copperridge', 'blueiron', 'lavaedge', 'starcave', 'moonrift', 'coreheart'];
const expected = ['stone', 'coal', 'iron', 'crystal'].flatMap(o => ['normal', 'rich'].flatMap(r => [0, 1, 2, 3].map(v => `art/tiles/ore_${o}_${r}_${v}.png`)))
  .concat(ZONES.flatMap(z => ['far', 'mid', 'near'].map(l => `art/bg/zone_${z}_${l}.png`).concat(`art/bg/cover_${z}.png`, `art/bg/thumb_${z}.png`, [0, 1, 2, 3].map(i => `art/tiles/rock_${z}_${i}.png`))),
    [1, 2, 3, 4, 5].flatMap(i => [`art/tiles/band_tint_${i}.png`, `art/tiles/band_edge_${i}.png`]),
    [1, 2, 3].flatMap(s => [...Array(8).keys()].map(g => `art/tiles/crack_${s}_${g}.png`)), [0, 1, 2, 3].map(i => `art/tiles/pit_${i}.png`),
    ['art/icons/tool_coredrill.png', 'art/fx/deep_ring.png', 'art/logo/title.png', 'art/bg/vignette.png']);
for (const e of expected) if (!files.includes(e)) fail.push('missing ' + e);

for (const f of files) {
  const p = join(ROOT, f); if (!existsSync(p)) { fail.push('no file ' + f); continue; }
  bytes += statSync(p).size; const c = load(p);
  const spec = SIZE.find(([re]) => re.test(f)); if (!spec) { fail.push('no size rule ' + f); continue; }
  if (c.w !== spec[1] || c.h !== spec[2]) fail.push(`${f} size ${c.w}x${c.h} != ${spec[1]}x${spec[2]}`);
  if (!/^art\/[a-z]+\/[a-z0-9_]+\.png$/.test(f)) fail.push('bad name ' + f);
  if (/tiles\/(ore|rock)_/.test(f)) { // 方块：内容区不透明，四边中点是描边色（暗）
    for (let y = 4; y < 60; y++) for (let x = 4; x < 60; x++) if (c.get(x, y)[3] !== 255) { fail.push(`${f} hole @${x},${y}`); y = 99; break; }
    for (const [x, y] of [[32, 0], [0, 32], [63, 32], [32, 63]]) { const q = c.get(x, y); if (q[3] !== 255 || q[0] + q[1] + q[2] > 150) fail.push(`${f} edge @${x},${y}`); }
  }
  if (/bg\/(cave_|zone_)/.test(f)) { // 左右无缝：首尾列差 ≤ 图内相邻列差的最大值
    const diff = (a, b) => { let s = 0; for (let i = 0; i < c.h; i++) { const p = c.get(a, i), q = c.get(b, i); for (let k = 0; k < 4; k++) s += Math.abs(p[k] - q[k]); } return s; };
    let mx = 0; for (let i = 0; i < c.w - 1; i++) mx = Math.max(mx, diff(i, i + 1)); const seam = diff(c.w - 1, 0);
    if (seam > mx) fail.push(`${f} seam L/R ${seam} vs internal max ${mx}`);
  }
}
const html = existsSync(join(ROOT, 'index.html')) ? readFileSync(join(ROOT, 'index.html'), 'utf8') : '';
if (/minecraft|我的世界|mojang/i.test(html)) fail.push('forbidden word in index.html');

console.log(`${files.length} files, ${(bytes / 1024).toFixed(1)} KB (limit 10240 KB)`); if (bytes > 10 * 1024 * 1024) fail.push('total size over 10MB');
console.log(fail.length ? 'FAIL\n' + [...new Set(fail)].slice(0, 40).join('\n') : 'ALL CHECKS PASSED'); process.exit(fail.length ? 1 : 0);
