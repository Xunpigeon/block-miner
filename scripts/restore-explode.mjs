import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('src/07-audio.js', 'utf8');
const bad = "    var bright = 760 + Math.min(6, numOr(o.streak, 0)) * 70;   // 连击越高越亮，但仍在 760–1180Hz，不会像鸟叫\n    lp.frequency.setValueAtTime(bright, t);\n    lp.frequency.exponentialRampToValueAtTime(90, t + 0.5);";
const good = "    lp.frequency.setValueAtTime(900, t);\n    lp.frequency.exponentialRampToValueAtTime(90, t + 0.5);";
if (s.indexOf(bad) >= 0) { s = s.replace(bad, good); console.log('explode 已还原'); } else console.log('MISS explode');
writeFileSync('src/07-audio.js', s, 'utf8');