import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('src/07-audio.js', 'utf8');
const old = "    lp.frequency.setValueAtTime(900, t);";
const neu = "    var bright = 760 + Math.min(6, numOr(o.streak, 0)) * 70;   // 连击越高越亮，但仍在 760–1180Hz，不会像鸟叫\n    lp.frequency.setValueAtTime(bright, t);";
if (s.indexOf(old) >= 0) { s = s.replace(old, neu); console.log('streak 已接回（低频范围内）'); } else console.log('MISS');
s = s.replace("lp.frequency.exponentialRampToValueAtTime(260, t + 0.12);", "lp.frequency.exponentialRampToValueAtTime(bright * 0.32, t + 0.12);");
writeFileSync('src/07-audio.js', s, 'utf8');