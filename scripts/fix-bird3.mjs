import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('src/07-audio.js', 'utf8');
const old = '    lp.frequency.setValueAtTime(900, t);';
const neu = '    var bright = 760 + Math.min(6, numOr(o.streak, 0)) * 70;   // 连击越高越亮（760–1180Hz，低频不刺耳）\n    lp.frequency.setValueAtTime(bright, t);';
if (s.indexOf(old) >= 0) { s = s.replace(old, neu); console.log('OK'); } else console.log('MISS');
writeFileSync('src/07-audio.js', s, 'utf8');