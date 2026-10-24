import { readFileSync, writeFileSync } from 'node:fs';
let ok = 0;

// 1) HUD 金币改用缩写（K/M/B），精确值放 title
let ui = readFileSync('src/08-ui.js', 'utf8');
const a1 = 'setText(R.hudCoins, fmtCoins(coins));';
if (ui.includes(a1)) {
  ui = ui.replace(a1, [
    'setText(R.hudCoins, abbrCoins(coins));',
    '    try { R.hudCoins.title = fmtCoins(coins); } catch (e) { /* 忽略 */ }'
  ].join('\n    '));
  ok++;
}

// 2) 回合内「返回」按钮（放在画质按钮之后）
const a2 = 'R.hudQuality.addEventListener(\'click\', cycleQuality);';
if (ui.includes(a2)) {
  ui = ui.replace(a2, [
    a2,
    "    R.hudExit = put(top, h('button', 'hud-exit ico-btn', null, 'bm-btn-hud-exit'));",
    "    R.hudExit.setAttribute('type', 'button');",
    "    put(R.hudExit, h('span', 'btn-lbl', '返回'));",
    "    R.hudExit.addEventListener('click', function () { call('onExitRound'); });"
  ].join('\n'));
  ok++;
}
writeFileSync('src/08-ui.js', ui, 'utf8');

// 3) CSS：返回按钮样式
let css = readFileSync('src/style.css', 'utf8');
const a3 = '.hud-quality.low { color: var(--gold); border-color: rgba(255, 200, 87, 0.55); }';
if (css.includes(a3)) {
  css = css.replace(a3, [a3,
    '.hud-exit {',
    '  pointer-events: auto; min-width: var(--tap); min-height: var(--tap);',
    '  margin-left: 6px; border-radius: 12px; font-size: 12px;',
    '  background: rgba(20, 27, 36, 0.9); border: 1px solid var(--line); color: var(--text);',
    '}',
    '.hud-exit:active { transform: translateY(1px); }'
  ].join('\n'));
  ok++;
}
writeFileSync('src/style.css', css, 'utf8');

// 4) main：onExitRound = 立即结算本局（不丢已挖的币）
let m = readFileSync('src/09-main.js', 'utf8');
const a4 = '    onSelectTool: function (id) {';
if (m.includes(a4)) {
  m = m.replace(a4, [
    '    // 回合内「返回」：立即结束本局并结算（保留已挖到的收益）',
    '    onExitRound: function () {',
    "      if (ROUND.state === 'running') endRound();",
    '    },',
    a4
  ].join('\n'));
  ok++;
}
writeFileSync('src/09-main.js', m, 'utf8');
console.log('patched', ok, '/4');