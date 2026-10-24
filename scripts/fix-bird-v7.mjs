import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('src/07-audio.js', 'utf8');
let n = 0;
// layerBreak：去掉上扫的三次泛音（鸟叫来源），改成与第一关 stoneHit 同色的低频钝响
const start = s.indexOf('  SOUNDS.layerBreak = function (o) {');
const end = s.indexOf('};', start) + 2;
if (start > 0 && end > start) {
  const neu = [
    '  SOUNDS.layerBreak = function (o) {',
    '    // v7b：原来是 330Hz 起、向上滑到 693/1056Hz 的三层上扫泛音，连按时像鸟叫（玩家反馈）。',
    '    // 现在与第一关 stoneHit 同色：低通噪声 + 低频三角波，只做“闷响”，不带任何上扫。',
    '    var t = tnow();',
    '    var dst = voice(o.pan || 0);',
    '    dst.gain.value = 0.3 * (o.gain || 1);',
    '    var p = o.pitch || 1;',
    '    var nz = noise();',
    '    var lp = ctx.createBiquadFilter();',
    '    lp.type = \'lowpass\';',
    '    lp.frequency.setValueAtTime(1300 * p, t);',
    '    lp.frequency.exponentialRampToValueAtTime(380 * p, t + 0.09);',
    '    lp.Q.value = 0.8;',
    '    var g = ctx.createGain();',
    '    env(g, t, 0.7, 0.003, 0.09);',
    '    nz.connect(lp); lp.connect(g); g.connect(dst);',
    '    nz.start(t); nz.stop(t + 0.15);',
    '    tone(dst, \'triangle\', 180 * p, 86, t, 0.3, 0.003, 0.08);',
    '  };'
  ].join('\n');
  s = s.slice(0, start) + neu + s.slice(end);
  n++;
}
writeFileSync('src/07-audio.js', s, 'utf8');
console.log('patched', n);