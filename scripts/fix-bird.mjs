import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('src/07-audio.js', 'utf8');
const old = [
  '  SOUNDS.layerBright = function (o) {',
  '    var t = tnow();',
  '    var dst = voice(o.pan || 0);',
  '    dst.gain.value = 0.16 * (o.gain || 1);',
  '    var f = 2600 + Math.min(6, numOr(o.streak, 0)) * 240;',
  '    tone(dst, \'triangle\', f, f * 1.6, t, 0.5, 0.003, 0.16);',
  '    tone(dst, \'sine\', f * 2, f * 2.4, t + 0.01, 0.2, 0.004, 0.2);',
  '  };'
].join('\n');
const neu = [
  '  SOUNDS.layerBright = function (o) {',
  '    // v10b：原来是 2.6–4.2kHz 上滑三角波，玩家反馈像鸟叫，改成低频「闷响」尾音',
  '    var t = tnow();',
  '    var dst = voice(o.pan || 0);',
  '    dst.gain.value = 0.14 * (o.gain || 1);',
  '    var n = noise();',
  '    var lp = ctx.createBiquadFilter();',
  '    lp.type = \'lowpass\';',
  '    lp.frequency.setValueAtTime(900, t);',
  '    lp.frequency.exponentialRampToValueAtTime(260, t + 0.12);',
  '    lp.Q.value = 0.7;',
  '    var g = ctx.createGain();',
  '    env(g, t, 0.7, 0.004, 0.13);',
  '    n.connect(lp); lp.connect(g); g.connect(dst);',
  '    n.start(t); n.stop(t + 0.18);',
  '    tone(dst, \'sine\', 120, 78, t, 0.5, 0.004, 0.12);',
  '  };'
].join('\n');
if (s.indexOf(old) >= 0) { s = s.replace(old, neu); console.log('layerBright 已换成低频闷响'); } else console.log('MISS');
writeFileSync('src/07-audio.js', s, 'utf8');