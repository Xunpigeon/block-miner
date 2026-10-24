
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
const srcDir = 'C:/Users/Administrator/Documents/deepseek-harness/default-workspace/blockminer/src';
const noop = () => {};
const grad = { addColorStop: noop };
const ctx = new Proxy({ canvas: { width: 390, height: 844 }, createLinearGradient: () => grad, createRadialGradient: () => grad, createPattern: () => null, measureText: () => ({ width: 8 }), getImageData: (x,y,w,h)=>({data:new Uint8ClampedArray(4)}), createImageData: (w,h)=>({data:new Uint8ClampedArray(4),width:w,height:h}) }, { get: (t,p) => (p in t ? t[p] : (typeof p === 'string' ? noop : undefined)), set: () => true });
const mkCanvas = () => ({ width: 390, height: 844, style: {}, getContext: () => ctx, addEventListener: noop, getBoundingClientRect: () => ({ left:0,top:0,width:390,height:844 }), appendChild: noop, setPointerCapture: noop, classList: { add: noop, remove: noop, toggle: noop, contains: () => false } });
const store = new Map();
const sb = { console, performance: { now: () => 0 }, devicePixelRatio: 1, localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k,v) => store.set(k, String(v)), removeItem: k => store.delete(k) }, location: { hash: '' }, requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: noop, document: { createElement: () => mkCanvas(), getElementById: () => mkCanvas(), querySelector: () => null, addEventListener: noop, head: { appendChild: noop }, body: { appendChild: noop } } };
sb.window = sb; sb.globalThis = sb;
const c = vm.createContext(sb);
for (const f of ['01-config', '02-core']) vm.runInContext(readFileSync(join(srcDir, f + '.js'), 'utf8'), c, { filename: f });
const BM = sb.BM; const CFG = BM.CONFIG;
console.log('zoneCoinTier', JSON.stringify(CFG.talentCostTable.zoneCoinTier));
console.log('tierBase', JSON.stringify(CFG.talentCostTable.tierBase));
for (const z of CFG.zones) {
  const ids = Object.keys(CFG.talents).filter(k => CFG.talents[k].zone === z.id);
  console.log(z.id, 'talents=', ids.map(i => i + '(t' + CFG.talents[i].tier + ')=' + BM.CORE.talentCost(i)).join(' '));
}
