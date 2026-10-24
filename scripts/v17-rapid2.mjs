import { readFileSync, writeFileSync } from 'node:fs';
let u = readFileSync('src/08-ui.js', 'utf8');
let n = 0;
// 1) 松手（pointerup / pointercancel / pointerleave）时停掉连续购买
u = u.replace("chip.addEventListener('pointerup', cancelLongPress);", "chip.addEventListener('pointerup', function () { cancelLongPress(); onBadgeUp(); });");
u = u.replace("chip.addEventListener('pointercancel', cancelLongPress);", "chip.addEventListener('pointercancel', function () { cancelLongPress(); onBadgeUp(); });");
u = u.replace("chip.addEventListener('pointerleave', cancelLongPress);", "chip.addEventListener('pointerleave', function () { cancelLongPress(); onBadgeUp(); });");
n++;
// 2) 长尾节点的购买改用柔和的 upgradeTick（并传入连击层数让音高微升）
const oldBuy = "    call('onBuyNode', id);\n    popBadge(el || badgeNodeOf(id));";
const neuBuy = [
  "    call('onBuyNode', id);",
  "    // v17：长尾节点连续升级用柔和的 upgradeTick（低频木质「哒」，音高微升），普通节点仍用买音",
  "    if ((n.maxLevel || 1) >= 50) {",
  "      R.rapidStreak = (R.rapidStreak || 0) + 1;",
  "      if (BM.AUDIO && BM.AUDIO.play) { try { BM.AUDIO.play('upgradeTick', { streak: R.rapidStreak }); } catch (e) { /* 忽略 */ } }",
  "    }",
  "    popBadge(el || badgeNodeOf(id));"
].join('\n');
if (u.indexOf(oldBuy) >= 0 && u.indexOf('upgradeTick') < 0) { u = u.replace(oldBuy, neuBuy); n++; }
// 3) 松开时把连击计数清零（下次按住重新从低音开始）
u = u.replace("  function onBadgeUp() { R.pressId = '';", "  function onBadgeUp() { R.pressId = ''; R.rapidStreak = 0;");
writeFileSync('src/08-ui.js', u, 'utf8');
console.log('patched', n);