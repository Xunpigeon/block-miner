// v7 UI 九宫格：24×24，四角 8px，中间 8px 带横竖都一致（可拉伸）。CSS 以 slice 8 fill / width 16px 使用 → 1 纹素 = 2 CSS 像素。
// 视觉语言：奶油纸面 + 梅棕描边 + 木色内框；按钮是带「底唇」的果冻块（叶绿主按钮 / 奶油次按钮 / 珊瑚危险按钮）。
import { Canvas, hex, INK, lighten, darken, sparkle, roundIn, withA, GOLD } from './px.mjs';

// 圆角面板：rings 从外到内 [亮侧色, 暗侧色]；lip = 底部额外加厚的暗色像素行数（按钮的立体底唇）
function frame(w, h, o) {
  const c = new Canvas(w, h), r = o.r ?? 4, lip = o.lip ?? 0, H0 = h - lip;
  const body = roundIn(w, r, H0), full = roundIn(w, r, h);
  // 环带深度 = 到形状外缘的切比雪夫距离（0 = 最外圈）
  const depth = (x, y) => { let d = 0; while (d < 8) { let ok = true;
    for (let yy = y - d - 1; yy <= y + d + 1 && ok; yy++) for (let xx = x - d - 1; xx <= x + d + 1; xx++) if (!body(xx, yy)) { ok = false; break; }
    if (!ok) break; d++; } return d; };
  c.each((x, y) => {
    if (lip && !body(x, y) && full(x, y)) { c.set(x, y, y >= h - 1 || !full(x - 1, y) || !full(x + 1, y) ? INK : o.lipCol); return; }
    if (!body(x, y)) return;
    const d = depth(x, y), rings = o.rings;
    if (d < rings.length) { const [lit, sh] = rings[d]; const isLit = Math.min(x, y) <= Math.min(w - 1 - x, H0 - 1 - y); c.set(x, y, isLit ? lit : sh); return; }
    c.set(x, y, o.fill);
    if (o.shine && y === rings.length) c.set(x, y, o.shine);          // 内顶一行亮光（像釉面）
  });
  return c;
}
const two = (a, b) => [hex(a), hex(b ?? a)];
const INKR = [INK, INK];

// 九宫格自检：中间 8 列 / 8 行不能有变化（否则拉伸会出花纹）。生成时就校正：把 8..15 带统一成第 8 列/行
function flattenMid(c) {
  for (let y = 0; y < c.h; y++) for (let x = 9; x < c.w - 8; x++) c.set(x, y, c.get(8, y));
  for (let x = 0; x < c.w; x++) for (let y = 9; y < c.h - 8; y++) c.set(x, y, c.get(x, 8));
  return c;
}

export function genUI(out) {
  const F = (o) => flattenMid(frame(24, 24, o));
  // ---- 按钮（底唇 3 纹素，按下态唇变 1） ----
  const btn = (fill, hi, lo, lipCol, down) => F({ r: 4, lip: down ? 1 : 3, lipCol: hex(lipCol), rings: [INKR, [hex(hi), hex(lo)]], fill: hex(fill), shine: lighten(hex(fill), 0.35) });
  out('ui/btn_primary.png', btn('#5cc86a', '#b4f28e', '#3fa850', '#2a7a3c'), 'ui.btn_primary');
  out('ui/btn_primary_down.png', btn('#4fb85a', '#8ee07a', '#3fa850', '#2a7a3c', true), 'ui.btn_primary_down');
  out('ui/btn_ghost.png', btn('#fff7e6', '#ffffff', '#ecd3a8', '#c9a374'), 'ui.btn_ghost');
  out('ui/btn_danger.png', btn('#ff7d6b', '#ffc0b0', '#e2605a', '#a83a44'), 'ui.btn_danger');
  // ---- 面板 / 卡片：梅棕描边 → 木色框 → 奶油纸面 ----
  const WOOD = two('#ecb67c', '#b8743e');
  out('ui/panel.png', F({ r: 5, rings: [INKR, WOOD, two('#c98a52', '#8e5634'), two('#fff2d6', '#e6cc9e')], fill: hex('#fff7e6') }), 'ui.panel');
  out('ui/card.png', F({ r: 4, rings: [INKR, two('#ffffff', '#e6cc9e')], fill: hex('#fff7e6') }), 'ui.card');
  out('ui/card_selected.png', F({ r: 4, rings: [INKR, two('#ffe680', '#e8a820'), two('#fff4b8', '#ffd84a')], fill: hex('#fff6d0') }), 'ui.card_selected');
  out('ui/card_locked.png', F({ r: 4, rings: [two('#7a6a80', '#7a6a80'), two('#f2ece4', '#cfc4bc')], fill: hex('#e8e0d6') }), 'ui.card_locked');
  out('ui/chip.png', F({ r: 4, rings: [INKR, two('#e6cc9e', '#ffffff')], fill: hex('#fff7e6') }), 'ui.chip');            // 内凹（上暗下亮）
  out('ui/tooltip.png', F({ r: 4, rings: [INKR, two('#ffffff', '#ecd3a8')], fill: hex('#fffdf6') }), 'ui.tooltip');
  // ---- 天赋节点三态 / 关键节点 / 分区标题（备用键，CSS 天赋节点走纯色） ----
  out('ui/node_owned.png', F({ r: 5, rings: [INKR, two('#ffb27a', '#e2605a')], fill: hex('#ff9a5a') }), 'ui.node_owned');
  out('ui/node_avail.png', F({ r: 5, rings: [INKR, two('#b4f28e', '#3fa850')], fill: hex('#fff7e6') }), 'ui.node_avail');
  out('ui/node_locked.png', F({ r: 5, rings: [two('#9a8c9c', '#9a8c9c')], fill: hex('#e8e0d6') }), 'ui.node_locked');
  out('ui/node_capstone.png', F({ r: 5, rings: [INKR, two('#fff4b8', '#c88a14'), two('#ffd84a', '#e8a820')], fill: hex('#fff6d0') }), 'ui.node_capstone');
  const head = F({ r: 3, rings: [INKR, two('#ffb9a6', '#e2605a')], fill: hex('#ff7d6b') });
  out('ui/band_header.png', head, 'ui.band_header');
  // ---- 进度条：深槽 + 叶绿果冻填充（两端圆、中间可拉伸） ----
  const bar = fill => { const c = new Canvas(32, 12), inn = roundIn(32, 4, 12);
    c.each((x, y) => { if (!inn(x, y)) return; const e = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !inn(x + a, y + b));
      if (e) return c.set(x, y, INK);
      if (!fill) return c.set(x, y, y <= 2 ? hex('#4a3448') : hex('#6a5470'));
      c.set(x, y, y <= 2 ? hex('#e6ffc8') : y <= 4 ? hex('#a8ec8a') : y >= 9 ? hex('#3fa850') : hex('#5cc86a')); });
    return c; };
  out('ui/bar_bg.png', bar(false), 'ui.bar_bg'); out('ui/bar_fill.png', bar(true), 'ui.bar_fill');
  // ---- 确认弹窗：木框窗口 + 珊瑚色标题栏 + 奶油纸面 ----
  const cf = frame(320, 200, { r: 8, rings: [INKR, INKR, WOOD, WOOD, two('#c98a52', '#8e5634'), INKR], fill: hex('#fff7e6') });
  for (let y = 7; y < 40; y++) for (let x = 7; x < 313; x++) if (cf.get(x, y).join() === hex('#fff7e6').join()) cf.set(x, y, y >= 38 ? INK : y < 10 ? hex('#ffb9a6') : hex('#ff7d6b'));
  for (const [x, y] of [[14, 20], [306, 20]]) sparkle(cf, x, y, 3, hex('#ffffff'), GOLD[3], GOLD[2]);
  out('ui/confirm.png', cf, 'ui.confirm');
}
