import { readFileSync, writeFileSync } from 'node:fs';
let n = 0;

// A) 08-ui：长尾节点（maxLevel>=50）按住 = 连续升级（rapid），不再弹详情
let u = readFileSync('src/08-ui.js', 'utf8');
if (u.indexOf('R.rapidTimer') < 0) {
  // 1) 在 onBadgeDown 开头插入长尾分支
  const anchor = '  function onBadgeDown(n, e) {\n    cancelLongPress();';
  const insert = [
    '  function onBadgeDown(n, e) {',
    '    cancelLongPress();',
    '    // v17：长尾节点（矿层加深 999 级）按住 = 连续购买，不弹详情',
    '    if ((n.maxLevel || 1) >= 50) {',
    '      R.pressId = n.id;',
    '      buyNodeNow(n.id, badgeNodeOf(n.id));',
    '      R.rapidTimer = setInterval(function () {',
    '        if (R.pressId !== n.id) { clearInterval(R.rapidTimer); R.rapidTimer = 0; return; }',
    '        var el = badgeNodeOf(n.id);',
    '        if (!buyNodeNow(n.id, el)) { clearInterval(R.rapidTimer); R.rapidTimer = 0; }',
    '      }, 110);',
    '      return;',
    '    }'
  ].join('\n');
  if (u.indexOf(anchor) >= 0) { u = u.replace(anchor, insert); n++; } else console.log('WARN onBadgeDown 未匹配');
  // 2) cancelLongPress 里一并清掉 rapidTimer
  u = u.replace('  function cancelLongPress() {', '  function cancelLongPress() {\n    if (R.rapidTimer) { clearInterval(R.rapidTimer); R.rapidTimer = 0; }');
  // 3) 松手时清 pressId（复用 pressId 作为“还按着”的标记）
  u = u.replace('  function onBadgeMove(e) {', '  function onBadgeUp() { R.pressId = \'\'; if (R.rapidTimer) { clearInterval(R.rapidTimer); R.rapidTimer = 0; } }\n\n  function onBadgeMove(e) {');
  n++;
}
writeFileSync('src/08-ui.js', u, 'utf8');

// B) 07-audio：新增柔和的连续升级音 upgradeTick（低频、短、音高微升）
let a = readFileSync('src/07-audio.js', 'utf8');
if (a.indexOf('SOUNDS.upgradeTick') < 0) {
  const ins = [
    '  /* v17：连续升级音 —— 低频木质感「哒」，音高随连击微升，绝不刺耳 */',
    '  SOUNDS.upgradeTick = function (o) {',
    '    var t = tnow();',
    '    var dst = voice(o.pan || 0);',
    '    var k = Math.min(12, numOr(o.streak, 0));',
    '    dst.gain.value = 0.1 * (o.gain || 1);',
    '    var f = 300 + k * 12;',
    '    tone(dst, \'triangle\', f, f * 0.86, t, 0.3, 0.003, 0.05);',
    '    tone(dst, \'sine\', f * 2, f * 1.8, t, 0.05, 0.003, 0.04);',
    '  };',
    ''
  ].join('\n');
  a = a.replace('  SOUNDS.laserTick = function (o) {', ins + '  SOUNDS.laserTick = function (o) {');
  n++;
}
writeFileSync('src/07-audio.js', a, 'utf8');
console.log('patched', n);