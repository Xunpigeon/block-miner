import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('src/07-audio.js', 'utf8');
const start = s.indexOf('  SOUNDS.laserTick = function (o) {');
if (start < 0) { console.log('MISS'); process.exit(1); }
// 找到函数体结束（从 start 起第一个 '\n  };' ）
const end = s.indexOf('\n  };', start) + 5;
const neu = [
  '  SOUNDS.laserTick = function (o) {',
  '    // v7c：原来是 2400–2900Hz 方波 + 1.7kHz 高通，0.15 秒一次，玩家反馈刺耳。',
  '    // 改成柔和低频「嗡」+ 一层细碎噪声，只保留“持续在切”的质感，不刺耳。',
  '    var t = tnow();',
  '    var dense = lastLaserAt >= 0 && (t - lastLaserAt) < 0.05;',
  '    lastLaserAt = t;',
  '    var dst = voice(o.pan || 0);',
  '    dst.gain.value = 0.13 * (dense ? 0.45 : 1) * (o.gain || 1);',
  '    var p = o.pitch || 1;',
  '    var h = clamp(numOr(o.h, 1), 1, 12) * 0.004;',
  '    // 主体：中低频三角波，缓慢下沉',
  '    var f0 = 460 + Math.random() * 60;',
  '    tone(dst, \'triangle\', f0 * p, f0 * 0.72 * p, t, 0.22, 0.004, 0.06 + h);',
  '    // 一层很轻的正弦泛音（增加“金属被切开”的质感，但不刺耳）',
  '    tone(dst, \'sine\', f0 * 2.4 * p, f0 * 1.9 * p, t, 0.06, 0.004, 0.05 + h);',
  '    // 细碎噪声：带通 1100Hz、低 Q，模拟切屑',
  '    var nz = noise();',
  '    var bp = ctx.createBiquadFilter();',
  '    bp.type = \'bandpass\';',
  '    bp.frequency.value = 1100 * p;',
  '    bp.Q.value = 0.8;',
  '    var g = ctx.createGain();',
  '    env(g, t, 0.5, 0.002, 0.05 + h);',
  '    nz.connect(bp); bp.connect(g); g.connect(dst);',
  '    nz.start(t); nz.stop(t + 0.09 + h);',
  '  };'
].join('\n');
s = s.slice(0, start) + neu + s.slice(end);
writeFileSync('src/07-audio.js', s, 'utf8');
console.log('laserTick 已重写');