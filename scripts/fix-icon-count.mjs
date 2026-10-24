import { readFileSync, writeFileSync } from 'node:fs';
let u = readFileSync('test/ui.smoke.mjs', 'utf8');
u = u.replace('BM.UI.iconKinds.length === 12', 'BM.UI.iconKinds.length === 13');
u = u.replace("new Set(masks.map((m) => m.join(''))).size === 12, '12 种图标两两不同", "new Set(masks.map((m) => m.join(''))).size === 13, '13 种图标两两不同");
writeFileSync('test/ui.smoke.mjs', u, 'utf8');
console.log('ok');