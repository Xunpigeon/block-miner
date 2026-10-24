
// scripts/_base.mjs —— 打印基线配置里的价格/目标（调参回路的起点）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
const srcDir = process.argv[2] || join(process.cwd(), 'src');
const noop = () => {};
const ctx = new Proxy({ canvas: { width: 390, height: 844 }, createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }), createPattern: () => null, measureText: () => ({ width: 8 }), getImageData: () => ({ data: new Uint8ClampedArray(4) }), createImageData: () => ({ data: new Uint8ClampedArray(4) }) }, { get: (t, p) => (p in t ? t[p] : (typeof p === 'string' ? noop : undefined)), set: () => true });
const mk = () => ({ width: 390, height: 844, style: {}, getContext: () => ctx, addEventListener: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 }), appendChild: noop, setPointerCapture: noop, classList: { add: noop, remove: noop, toggle: noop, contains: () => false } });
const sb = { console, performance: { now: () => 0 }, devicePixelRatio: 1, localStorage: { getItem: () => null, setItem: noop, removeItem: noop }, location: { hash: '' }, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: noop, document: { createElement: mk, getElementById: mk, querySelector: null, addEventListener: noop, head: { appendChild: noop }, body: { appendChild: noop } } };
sb.window = sb; sb.globalThis = sb;
const c = vm.createContext(sb);
vm.runInContext(readFileSync(join(srcDir, '01-config.js'), 'utf8'), c, { filename: '01-config' });
const CFG = sb.BM.CONFIG;
const minTier = {};
for (const zid of CFG.zones.map(z => z.id)) {
  const ts = Object.keys(CFG.talents).filter(k => CFG.talents[k].zone === zid).map(k => CFG.talents[k].tier);
  minTier[zid] = Math.min(...ts);
}
console.log(JSON.stringify({
  tierBase: CFG.talentCostTable.tierBase,
  zoneCoinTier: CFG.talentCostTable.zoneCoinTier,
  need: Object.fromEntries(CFG.zones.map(z => [z.id, z.objective.need])),
  coinMul: Object.fromEntries(CFG.zones.map(z => [z.id, z.coinMul])),
  minTier
}));
