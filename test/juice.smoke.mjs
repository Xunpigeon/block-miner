// 06-juice.js 冒烟测试：node test/juice.smoke.mjs
// 验：事件订阅齐全 / 各事件能出粒子 / 每帧命中预算生效 / 粒子池封顶 / 全部寿命结束后归零 / draw 不抛错
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(here, '..', 'src', '06-juice.js'), 'utf8');

let pass = 0;
const fails = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fails.push(name); console.log('  FAIL ' + name + (extra ? ' >> ' + extra : '')); }
}

const map = new Map();
const bus = {
  on(t, fn) { if (!map.has(t)) map.set(t, []); map.get(t).push(fn); },
  emit(t, d) { for (const fn of map.get(t) || []) fn(d); },
  has(t) { return (map.get(t) || []).length > 0; }
};
const ctx = new Proxy({ fills: 0, globalAlpha: 1, fillStyle: '' }, {
  get(o, k) { if (k === 'fillRect') return () => { o.fills++; }; return o[k]; },
  set(o, k, v) { o[k] = v; return true; }
});
const sandbox = { window: {}, Math, console };
sandbox.window.BM = { bus, FX: { quality: 'high' } };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const J = sandbox.window.BM.JUICE;

ok(J && typeof J.draw === 'function' && typeof J.update === 'function' && typeof J.ambient === 'function', 'BM.JUICE 暴露 draw / update / ambient');
for (const t of ['block:hit', 'block:layer', 'block:break', 'block:empty', 'explosion', 'tool:execute', 'tool:chain', 'drop:absorb', 'frenzy:start', 'frenzy:end', 'treasure:open', 'combo:update', 'round:start']) {
  ok(bus.has(t), '订阅 ' + t);
}

const blk = (ore = 'stone') => ({ x: 100, y: 200, s: 58, ore });
function count(fn) { J.clear(); J.update(0.016); fn(); return J.alive(); }

ok(count(() => bus.emit('block:hit', { block: blk() })) > 0, '命中出火花');
ok(count(() => bus.emit('block:layer', { block: blk('iron'), prev: { ore: 'stone' } })) > 0, '剥层出石板 + 碎粒');
ok(count(() => bus.emit('block:break', { block: blk('crystal'), ore: 'crystal', rich: true })) > 10, '击碎出碎片 / 烟团 / 经验球');
ok(count(() => bus.emit('explosion', { x: 195, y: 400, radiusPx: 90 })) > 20, '爆炸出烟环 + 火星 + 碎片');
ok(count(() => bus.emit('tool:execute', { x: 195, y: 400 })) >= 2, '处决出斜斩 + 十字星');
ok(count(() => bus.emit('tool:chain', { x: 250, y: 300 })) === 1, '连锁出一条电弧');
ok(count(() => bus.emit('treasure:open', { x: 195, y: 400 })) > 30, '宝藏出金币 + 彩纸');
ok(count(() => bus.emit('combo:update', { combo: 10 })) > 10, '连击 10 段出彩纸炮');

// break 与 empty 同帧同格只算一次
J.clear(); J.update(0.016);
const b = blk('stone');
bus.emit('block:break', { block: b, ore: 'stone' }); const n1 = J.alive();
bus.emit('block:empty', { block: b }); const n2 = J.alive();
ok(n1 === n2, 'break / empty 同帧去重', n1 + ' vs ' + n2);

// 每帧命中预算：激光一帧命中 40 格，粒子数不随格数线性增长
const one = count(() => bus.emit('block:hit', { block: blk() }));
const many = count(() => { for (let i = 0; i < 40; i++) bus.emit('block:hit', { block: blk() }); });
ok(many <= one * 7, '每帧命中预算封顶（40 格 ≤ 7 格的量）', 'one=' + one + ' many=' + many);

// 粒子池封顶 + 不抛错
J.clear();
for (let i = 0; i < 30; i++) bus.emit('explosion', { x: 195, y: 400, radiusPx: 120 });
ok(J.alive() <= 420, '粒子池封顶 420', 'alive=' + J.alive());
let threw = null;
try { J.draw(ctx); J.ambient(ctx, 1.2, 'moonRift'); J.ambient(ctx, 1.3, 'nope'); } catch (e) { threw = e; }
ok(!threw, 'draw / ambient 不抛错', threw && threw.message);
ok(ctx.globalAlpha === 1, 'draw 结束后 globalAlpha 复位为 1');

// 狂热：持续冒火苗，结束后停
J.clear(); bus.emit('frenzy:start', { seconds: 2 });
for (let i = 0; i < 30; i++) J.update(0.016);
const fl = J.alive();
bus.emit('frenzy:end'); J.clear();
for (let i = 0; i < 30; i++) J.update(0.016);
ok(fl > 0 && J.alive() === 0, '狂热期间冒火苗，结束后停止', 'during=' + fl + ' after=' + J.alive());

// 全部寿命结束后归零
bus.emit('treasure:open', { x: 195, y: 400 });
for (let i = 0; i < 200; i++) J.update(0.05);
ok(J.alive() === 0, '10 秒后粒子全部回收', 'alive=' + J.alive());

// 低画质：粒子明显变少
sandbox.window.BM.FX.quality = 'low';
const lo = count(() => bus.emit('block:break', { block: blk('stone'), ore: 'stone' }));
sandbox.window.BM.FX.quality = 'high';
const hi = count(() => bus.emit('block:break', { block: blk('stone'), ore: 'stone' }));
ok(lo < hi, '低画质粒子更少', 'low=' + lo + ' high=' + hi);

console.log('\n通过 ' + pass + ' 项' + (fails.length ? '，失败 ' + fails.length + ' 项' : '，ALL GREEN'));
process.exit(fails.length ? 1 : 0);
