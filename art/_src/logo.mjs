// v7 标题「方块矿工」：自绘 16×16 像素笔画字，每纹素放大 6px ——
// 奶油→蜜黄三段填色 + 顶部白高光 + 右下珊瑚色厚挤出 + 3px 梅棕描边 + 金色闪光；下方一条木牌副标
import { Canvas, hex, line } from './lib.mjs';
import { INK, sparkle, GOLD } from './px.mjs';

const GLYPHS = {
  方: [[[7, 0], [7, 1]], [[0, 3], [14, 3]], [[5, 7], [13, 7], [13, 13], [10, 14]], [[5, 5], [5, 9], [1, 14]]],
  块: [[[1, 0], [1, 12]], [[0, 4], [4, 4]], [[0, 13], [5, 11]], [[6, 3], [13, 3], [13, 8]], [[10, 0], [10, 8]], [[5, 8], [14, 8]], [[10, 9], [6, 14]], [[11, 10], [14, 14]]],
  矿: [[[0, 2], [6, 2]], [[3, 2], [0, 8]], [[2, 8], [6, 8]], [[2, 8], [2, 13]], [[6, 8], [6, 13]], [[2, 13], [6, 13]], [[11, 0], [11, 1]], [[8, 3], [14, 3]], [[8, 3], [8, 9], [7, 14]]],
  工: [[[1, 2], [13, 2]], [[7, 2], [7, 12]], [[0, 13], [14, 13]]]
};
const ON = [255, 255, 255, 255];

export function genLogo(out) {
  const S = 6, W = 512, H = 160, gap = 14, text = '方块矿工';
  const x0 = (W - (text.length * 16 * S + (text.length - 1) * gap)) >> 1, y0 = 14;
  const mask = new Canvas(W, H);
  [...text].forEach((ch, i) => {
    const g = new Canvas(16, 16);
    for (const s of GLYPHS[ch]) for (let k = 1; k < s.length; k++) line(g, s[k - 1][0], s[k - 1][1], s[k][0], s[k][1], ON, 2);
    g.each((x, y) => { if (g.alpha(x, y)) mask.rect(x0 + i * (16 * S + gap) + x * S, y0 + y * S, S, S, ON); });
  });
  const m = (x, y) => mask.alpha(x, y) > 0, c = new Canvas(W, H);
  // 挤出：向右下 7px，珊瑚 → 深珊瑚
  c.each((x, y) => { if (m(x, y)) return; for (let d = 1; d <= 7; d++) if (m(x - Math.round(d * 0.4), y - d)) { c.set(x, y, hex(d > 4 ? '#a83a44' : '#e2605a')); return; } });
  // 正面：三段填色（不做平滑渐变）+ 顶边白 / 左边亮 / 底边蜜橙
  const bands = [hex('#fffaf0'), hex('#ffe680'), hex('#ffc93c')];
  c.each((x, y) => {
    if (!m(x, y)) return;
    const ly = (y - y0) / S;
    let col = bands[ly < 5 ? 0 : ly < 10 ? 1 : 2];
    if (!m(x, y - 1) || !m(x, y - 2)) col = hex('#ffffff');
    else if (!m(x, y + 1) || !m(x, y + 2)) col = hex('#e8a820');
    else if (!m(x - 1, y)) col = hex('#fff4d0');
    c.set(x, y, col);
  });
  // 3px 梅棕描边
  for (let pass = 0; pass < 3; pass++) { const marks = []; c.each((x, y) => { if (!c.alpha(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => c.alpha(x + a, y + b))) marks.push([x, y]); }); for (const [x, y] of marks) c.set(x, y, INK); }
  // 副标：木牌条（两端铆钉）
  const by = y0 + 16 * S + 16, bx0 = 156, bx1 = 356;
  for (let y = by; y < by + 14; y++) for (let x = bx0; x < bx1; x++) {
    const e = Math.min(x - bx0, bx1 - 1 - x, y - by, by + 13 - y);
    c.set(x, y, e < 2 ? INK : y === by + 2 ? hex('#ecb67c') : y >= by + 11 ? hex('#8e5634') : (x * 7 + y * 3) % 23 === 0 ? hex('#b8743e') : hex('#c98a52'));
  }
  for (const x of [bx0 + 6, bx1 - 8]) { c.rect(x, by + 5, 3, 3, GOLD[1]); c.set(x, by + 5, GOLD[3]); }
  for (let k = 0; k < 6; k++) { const x = bx0 + 30 + k * 26; c.rect(x, by + 6, 10, 2, hex('#8e5634')); }
  for (const [x, y, s] of [[x0 - 12, y0 + 10, 4], [W - x0 + 10, y0 + 66, 3], [x0 + 210, y0 - 6, 3], [x0 + 70, y0 + 100, 2]]) sparkle(c, x, y, s, hex('#ffffff'), GOLD[3], GOLD[2]);
  out('logo/title.png', c, 'logo.title');
}
