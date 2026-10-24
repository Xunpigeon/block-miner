// 06-fx.js 冒烟测试：node test/fx.smoke.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(here, '..', 'src', '06-fx.js'), 'utf8');

let pass = 0;
const fails = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fails.push(name); console.log('  FAIL ' + name + (extra ? ' >> ' + extra : '')); }
}

function makeBus() {
  const map = new Map();
  return {
    calls: {},
    on(t, fn) {
      if (!map.has(t)) map.set(t, []);
      map.get(t).push(fn);
      this.calls[t] = (this.calls[t] || 0) + 1;
      return () => this.off(t, fn);
    },
    off(t, fn) {
      const a = map.get(t);
      if (!a) return;
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    },
    emit(t, d) {
      const a = map.get(t);
      if (!a) return;
      for (const fn of a.slice()) {
        try { fn(d); } catch (e) { console.warn('[bus] 订阅者抛错 ' + t, e.message); }
      }
    },
    count(t) { return (map.get(t) || []).length; }
  };
}

// 带调用计数的 2D 假上下文
function makeCtx() {
  const c = { arc: 0, fill: 0, stroke: 0, fillRect: 0, strokeRect: 0, fillText: 0, drawImage: 0, font: 0, rectY: [], rects: [], fills: [], lines: 0 };
  const ctx = {
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
    textAlign: '', textBaseline: '',
    set font(v) { c.font++; },
    get font() { return ''; },
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, setTransform() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() { c.lines++; },
    arc() { c.arc++; }, fill() { c.fill++; }, stroke() { c.stroke++; },
    fillRect(x, y, w, h) { c.fillRect++; c.fills.push({ x, y, w, h, col: this.fillStyle }); },
    strokeRect(x, y, w, h) {
      c.strokeRect++;
      if (w > 10 && w < 60) c.rectY.push(y);
      c.rects.push({ x, y, w, h, col: this.strokeStyle });
    },
    fillText() { c.fillText++; }, strokeText() {}, clearRect() {},
    drawImage() { c.drawImage++; },
    measureText() { return { width: 12 }; }
  };
  return { ctx, c };
}

// 假 ART：记录被请求的贴图键；img 带 width/height 供绘制路径判断
function makeArt(returnNull) {
  const seen = new Set();
  let calls = 0;
  const img = { width: 16, height: 16, fake: true };
  return {
    seen,
    get calls() { return calls; },
    one(key) { calls++; seen.add(key); return returnNull ? null : img; },
    all() { return returnNull ? [] : [img]; },
    has() { return !returnNull; },
    progress() { return returnNull ? 0 : 1; }
  };
}

function loadFX(art) {
  const bus = makeBus();
  const win = {};
  win.BM = { bus, DESIGN: { w: 390, h: 844 } };
  if (art) win.BM.ART = art;
  const sandbox = { window: win, console: { warn() {}, log() {}, error() {} }, Math, Date, isFinite, Array, Object };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'src/06-fx.js' });
  const FX = win.BM.FX;
  FX.init();
  return { FX, bus, sandbox };
}

const block = (x = 100, y = 300, s = 28) => ({ x, y, s, ore: 'coal', seed: 1 });
const DT = 1 / 60;

console.log('\n== 1. 模块加载与契约 API ==');
{
  const { FX, bus } = loadFX();
  ok(FX && typeof FX === 'object', 'BM.FX 已挂载');
  ['init', 'update', 'draw', 'shake', 'flash', 'setQuality', 'offset', 'offsetReset'].forEach(k =>
    ok(typeof FX[k] === 'function', 'BM.FX.' + k + ' 是函数'));
  ok(FX.quality === 'high', "默认 quality === 'high'");
  ok(FX.timeScale === 1, '初始 timeScale === 1');
  ok(FX.stats.cap === 900, 'high 模式粒子上限 900', String(FX.stats.cap));
  ok(bus.count('block:hit') === 1 && bus.count('block:break') === 1 && bus.count('explosion') === 1, '核心事件各订阅 1 次');
  ok(bus.count('drop:absorb') === 1 && bus.count('combo:update') === 1 && bus.count('frenzy:start') === 1, '表现类事件已订阅');
}

console.log('\n== 2. 事件洪水后粒子数不超上限 ==');
{
  const { FX, bus } = loadFX();
  for (let i = 0; i < 500; i++) bus.emit('block:break', { block: block((i % 6) * 60, (i % 8) * 70), ore: 'coal', rich: i % 5 === 0, chain: 0 });
  for (let i = 0; i < 40; i++) bus.emit('explosion', { x: 195, y: 400, radiusPx: 80, power: 2 });
  for (let i = 0; i < 4000; i++) bus.emit('block:hit', { block: block(60, 300), dmg: 1, dir: -1.2 });
  for (let i = 0; i < 2000; i++) bus.emit('drop:absorb', { ore: i % 2 ? 'coal' : 'copper', amount: 3, x: 195, y: 70 });
  FX.update(DT);
  ok(FX.stats.alive <= 900, '洪水后 alive <= 900', 'alive=' + FX.stats.alive);
  ok(FX.stats.alive === 900, '洪水下池被填满但未溢出', 'alive=' + FX.stats.alive);
  let n = 0;
  FX.eachActive(() => { n++; });
  ok(n === FX.stats.alive, 'eachActive 计数与 stats.alive 一致', n + ' vs ' + FX.stats.alive);
  ok(n <= FX.stats.cap, '遍历计数不超过上限');
}

console.log('\n== 3. 连续 500 帧不抛错、无 NaN、可绘制 ==');
{
  const { FX, bus } = loadFX();
  const { ctx, c } = makeCtx();
  let threw = null;
  const dts = [DT, 0.016, 0.033, 0.05, 0.008];
  try {
    for (let f = 0; f < 500; f++) {
      if (f % 3 === 0) bus.emit('block:hit', { block: block(80 + (f % 5) * 40, 320), dmg: 1 + (f % 2), dir: f * 0.1 });
      if (f % 11 === 0) bus.emit('block:break', { block: block(120, 340), ore: f % 22 === 0 ? 'copper' : 'coal', rich: f % 33 === 0, chain: f % 4 });
      if (f % 47 === 0) bus.emit('explosion', { x: 195, y: 420, radiusPx: 70, power: 1.5, cells: [{ x: 150, y: 400, s: 28, ore: 'iron' }, { x: 210, y: 430, s: 28 }] });
      if (f % 9 === 0) bus.emit('block:layer', { block: block(60 + (f % 4) * 70, 300), depth: 1 + (f % 3) });
      if (f % 53 === 0) bus.emit('block:empty', { block: block(160, 380) });
      if (f % 97 === 0) bus.emit('tnt:fuse', { x: 195, y: 430, cells: 9, delay: 0.8 });
      if (f % 5 === 0) bus.emit('drop:spawn', { ore: 'coal', amount: 2, x: 150, y: 500, rich: false });
      if (f % 2 === 0) bus.emit('drop:absorb', { ore: 'coal', amount: 1, x: 195, y: 70 });
      if (f % 7 === 0) bus.emit('combo:update', { combo: f % 40, mult: 1 + (f % 5) * 0.2 });
      if (f === 100) bus.emit('frenzy:start', { seconds: 6, mult: 2 });
      if (f === 300) bus.emit('frenzy:end', {});
      if (f % 61 === 0) bus.emit('magnet:burst', { x: 180, y: 480 });
      if (f % 6 === 0) bus.emit('laser:tick', { x: 112, y: 400, h: 4, cells: [{ x: 96, y: 212, s: 58, ore: 'crystal' }, { x: 96, y: 270, s: 58, ore: 'iron' }] });
      if (f % 37 === 0) bus.emit('quake:blast', { x: 195, y: 420, cells: f % 74 === 0 ? 81 : 49 });
      if (f % 43 === 0) bus.emit('lucky:tnt', { x: 150, y: 380, delay: 0.45 });
      FX.update(dts[f % dts.length]);
      FX.draw(ctx);
    }
  } catch (e) {
    threw = e;
  }
  ok(!threw, '500 帧 update+draw 未抛错', threw && threw.stack);
  let bad = 0, badField = '';
  FX.eachActive(p => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.vx) || !Number.isFinite(p.vy) ||
        !Number.isFinite(p.size) || !Number.isFinite(p.rot) || !Number.isFinite(p.life) || !Number.isFinite(p.alpha)) {
      bad++; badField = p.kind + ':' + p.x + ',' + p.y;
    }
  });
  ok(bad === 0, '存活粒子无 NaN 坐标/速度/尺寸', badField);
  ok(FX.stats.alive <= FX.stats.cap, '500 帧内始终不超上限', String(FX.stats.alive));
  ok(c.fill + c.stroke + c.fillRect + c.strokeRect + c.fillText > 500, 'draw 确实产生了绘制调用', JSON.stringify(c));
  ok(Number.isFinite(FX.timeScale) && FX.timeScale > 0 && FX.timeScale <= 1, 'timeScale 落在 (0,1]', String(FX.timeScale));
}

console.log('\n== 4. 命中停顿：0.06 → 回落 1 ==');
{
  const { FX, bus } = loadFX();
  bus.emit('block:break', { block: block(), ore: 'coal', rich: false, chain: 0 });
  ok(FX.timeScale === 0.06, '事件后 timeScale 立即为 0.06', String(FX.timeScale));
  FX.update(DT);
  ok(FX.timeScale === 0.06, '停顿期间保持 0.06', String(FX.timeScale));
  let frames = 0;
  while (FX.timeScale < 1 && frames < 120) { FX.update(DT); frames++; }
  ok(FX.timeScale === 1, '停顿结束后回到 1', 'frames=' + frames + ' ts=' + FX.timeScale);
  for (let i = 0; i < 30; i++) FX.update(DT);
  ok(FX.timeScale === 1, '之后保持 1');
  // 爆破本身也带 30ms 停顿
  bus.emit('explosion', { x: 195, y: 400, radiusPx: 60, power: 1 });
  ok(FX.timeScale === 0.06, 'explosion 也触发命中停顿');
}

console.log('\n== 5. setQuality 生效 ==');
{
  const { FX, bus } = loadFX();
  let highChips = 0;
  bus.emit('block:break', { block: block(), ore: 'coal', rich: false, chain: 0 });
  FX.update(DT);
  FX.eachActive(p => { if (p.kind === FX.KIND.CHIP) highChips++; });

  FX.setQuality('mid');
  ok(FX.quality === 'mid' && FX.stats.cap === 400, "mid 上限 400", String(FX.stats.cap));
  FX.setQuality('low');
  ok(FX.quality === 'low' && FX.stats.cap === 180, "low 上限 180", String(FX.stats.cap));

  let lowChips = 0;
  bus.emit('block:break', { block: block(), ore: 'coal', rich: false, chain: 0 });
  FX.update(DT);
  FX.eachActive(p => { if (p.kind === FX.KIND.CHIP) lowChips++; });
  ok(lowChips > 0, 'low 仍产生碎屑', String(lowChips));
  ok(lowChips <= highChips * 0.7, 'low 碎屑数量按 ×0.35 缩减', 'low=' + lowChips + ' high=' + highChips);

  FX.flash(0.4, 0.3);
  FX.update(DT);
  ok(FX.flashAlpha === 0, 'low 关闭全屏闪白', String(FX.flashAlpha));

  FX.setQuality('high');
  FX.flash(0.4, 0.3);
  FX.update(DT);
  ok(FX.flashAlpha > 0 && FX.flashAlpha <= 0.45, 'high 闪白生效且被 0.45 上限钳制', String(FX.flashAlpha));

  FX.setQuality('bogus');
  ok(FX.quality === 'high' && FX.stats.cap === 900, '非法档位回退 high');

  // 低档洪水同样不超上限
  FX.setQuality('low');
  for (let i = 0; i < 300; i++) bus.emit('explosion', { x: 195, y: 400, radiusPx: 90, power: 3 });
  FX.update(DT);
  ok(FX.stats.alive <= 180, 'low 洪水后 alive <= 180', String(FX.stats.alive));
}

console.log('\n== 6. 同矿跳字 120ms 内合并 ==');
{
  const { FX, bus } = loadFX();
  bus.emit('drop:absorb', { ore: 'coal', amount: 2, x: 195, y: 70 });
  bus.emit('drop:absorb', { ore: 'coal', amount: 3, x: 195, y: 70 });
  bus.emit('drop:absorb', { ore: 'coal', amount: 4, x: 195, y: 70 });
  FX.update(DT);
  const texts = [];
  FX.eachActive(p => { if (p.kind === FX.KIND.TEXT) texts.push(p); });
  ok(texts.length === 1, '3 次同矿跳字合并为 1 个粒子', 'count=' + texts.length);
  ok(texts[0] && texts[0].num === 9, '数量累加为 9', texts[0] && String(texts[0].num));
  ok(texts[0] && texts[0].str === '+9', '显示文本为 +9', texts[0] && texts[0].str);

  bus.emit('drop:absorb', { ore: 'copper', amount: 5, x: 195, y: 70 });
  FX.update(DT);
  const all = [];
  FX.eachActive(p => { if (p.kind === FX.KIND.TEXT) all.push(p); });
  ok(all.length === 2, '不同矿种各自跳字', 'count=' + all.length);

  // 超过 120ms 后不再合并
  bus.emit('drop:absorb', { ore: 'coal', amount: 1, x: 195, y: 70 });
  for (let i = 0; i < 12; i++) FX.update(DT); // ~200ms
  bus.emit('drop:absorb', { ore: 'coal', amount: 1, x: 195, y: 70 });
  FX.update(DT);
  const later = [];
  FX.eachActive(p => { if (p.kind === FX.KIND.TEXT) later.push(p); });
  ok(later.length >= 2, '间隔超过 120ms 后重新起跳字', 'count=' + later.length);
}

console.log('\n== 7. 震屏位移与上限 ==');
{
  const { FX } = loadFX();
  const o1 = FX.offset();
  ok(o1 && o1.x === 0 && o1.y === 0, '无震动时 offset() 返回 {0,0}');
  ok(FX.offset() === o1, 'offset() 复用同一对象，不每帧新建');
  FX.shake(999, 1);
  let maxAbs = 0;
  for (let i = 0; i < 90; i++) {
    FX.update(DT);
    const o = FX.offset();
    maxAbs = Math.max(maxAbs, Math.abs(o.x), Math.abs(o.y));
  }
  ok(maxAbs <= 18, '震屏幅度不超过 18px 硬上限', 'max=' + maxAbs.toFixed(2));
  ok(maxAbs > 0.5, '震屏确实产生了位移', 'max=' + maxAbs.toFixed(2));
  FX.offsetReset();
  const o2 = FX.offset();
  ok(o2.x === 0 && o2.y === 0, 'offsetReset 归零');
}

console.log('\n== 8. 无事件时粒子自然消亡 ==');
{
  const { FX, bus } = loadFX();
  const { ctx } = makeCtx();
  bus.emit('block:break', { block: block(), ore: 'copper', rich: true, chain: 2 });
  bus.emit('frenzy:start', { seconds: 1, mult: 2 });
  for (let i = 0; i < 400; i++) { FX.update(DT); FX.draw(ctx); }
  ok(FX.stats.alive === 0, '4 秒后池清空、无泄漏', 'alive=' + FX.stats.alive);
  ok(FX.stats.peak > 0, 'peak 有记录', String(FX.stats.peak));
  FX.clear();
  ok(FX.stats.alive === 0 && FX.timeScale === 1, 'clear() 复位');
}

console.log('\n== 9. 满池 update 开销（仅计时，不做机器相关断言）==');
{
  const { FX, bus } = loadFX();
  for (let i = 0; i < 60; i++) bus.emit('explosion', { x: 195, y: 400, radiusPx: 90, power: 3 });
  for (let i = 0; i < 200; i++) bus.emit('block:break', { block: block(), ore: 'coal', rich: true, chain: 0 });
  FX.update(DT);
  const filled = FX.stats.alive;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 600; i++) FX.update(DT);
  const t1 = process.hrtime.bigint();
  const perFrame = Number(t1 - t0) / 600 / 1e6;
  console.log('  存活粒子 ' + filled + ' 个时，update 平均 ' + perFrame.toFixed(3) + ' ms/帧');
  ok(filled > 400, '压测确实填入了大量粒子', String(filled));
}

console.log('\n== 10. 连击放射跟随最近命中点（v1 BUG 修复） ==');
{
  const { FX, bus } = loadFX();
  const HIT = block(60, 150, 28);            // 方块中心 (74,164)
  bus.emit('block:hit', { block: HIT, dmg: 1, dir: -1.2 });
  FX.update(DT);
  ok(FX.hitPoint.x === 74 && FX.hitPoint.y === 164, 'hitPoint 记录最近命中格中心', JSON.stringify(FX.hitPoint));
  ok(FX.hitPoint.fresh === 1, '命中点处于新鲜状态');

  bus.emit('combo:update', { combo: 12, mult: 2 });
  const rad = [];
  FX.eachActive(p => { if (p.kind === FX.KIND.RADIAL) rad.push(p); });
  ok(rad.length > 0, '连击 >= 8 产生放射粒子', String(rad.length));
  const nearHit = rad.every(p => Math.hypot(p.x - 74, p.y - 164) <= 15);
  ok(nearHit, '放射粒子生成在命中格附近（半径 <= 15px）',
    rad.map(p => Math.round(p.x) + ',' + Math.round(p.y)).join(' '));
  ok(rad.every(p => Math.hypot(p.x - 195, p.y - 422) > 100), '放射粒子不再从屏幕中心 (195,422) 冒出');

  // 坐标不写死 195,422：换一个角落命中，原点跟着走
  bus.emit('block:hit', { block: block(300, 620, 28), dmg: 2, dir: 0.6 });
  FX.update(DT);
  bus.emit('combo:update', { combo: 20, mult: 2 });
  const rad2 = [];
  FX.eachActive(p => { if (p.kind === FX.KIND.RADIAL && Math.hypot(p.x - 314, p.y - 634) <= 15) rad2.push(p); });
  ok(rad2.length > 0, '换到右下角命中后放射原点随之改变', String(rad2.length));

  // 1.5 秒无命中 → 回退屏幕中心
  for (let i = 0; i < 100; i++) FX.update(DT);   // ~1.67s
  ok(FX.hitPoint.fresh === 0, '超过 1.5 秒没有命中，命中点失效');
  bus.emit('combo:update', { combo: 20, mult: 2 });
  let atCenter = 0;
  FX.eachActive(p => { if (p.kind === FX.KIND.RADIAL && Math.hypot(p.x - 195, p.y - 422) <= 15) atCenter++; });
  ok(atCenter > 0, '失效后回退到屏幕中心', String(atCenter));
}

console.log('\n== 11. block:layer 只打穿一层：轻量、不混淆 ==');
{
  const { FX, bus } = loadFX();
  const { ctx, c } = makeCtx();
  const b = block(100, 300, 28);            // 中心 (114,314)
  bus.emit('block:layer', { block: b, depth: 1 });
  ok(FX.timeScale === 1, 'block:layer 不触发命中停顿', String(FX.timeScale));
  ok(FX.hitPoint.fresh === 0, '命中点要等 update 才刷新（此刻仍是旧值）');

  FX.update(DT);
  ok(FX.flashAlpha === 0, 'block:layer 不触发全屏白闪', String(FX.flashAlpha));
  ok(FX.timeScale === 1, '更新后仍无命中停顿', String(FX.timeScale));
  let chips = 0, rings = 0, sparks = 0;
  FX.eachActive(p => {
    if (p.kind === FX.KIND.CHIP) chips++;
    else if (p.kind === FX.KIND.RING) rings++;
    else if (p.kind === FX.KIND.SPARK) sparks++;
  });
  ok(chips >= 4 && chips <= 8, 'layer 碎屑 4~8 个', String(chips));
  ok(rings === 0, 'layer 不出冲击环（避免与整格挖空混淆）', String(rings));
  ok(sparks === 0, 'layer 不出命中火花', String(sparks));
  ok(FX.hitPoint.x === 114 && FX.hitPoint.y === 314, 'block:layer 也刷新最近命中点', JSON.stringify(FX.hitPoint));

  // 上弹：轮廓矩形被抬到方块上方 3~5px
  let minRectY = Infinity;
  for (let f = 0; f < 12; f++) { FX.update(DT); FX.draw(ctx); }
  for (const y of c.rectY) if (y < minRectY) minRectY = y;
  const lift = 300 + 0.8 - minRectY;   // 轮廓矩形在 y 上有 +0.8 的描边内缩
  ok(c.rectY.length > 0, '绘制了方块轮廓（上弹提示）', String(c.rectY.length));
  ok(lift >= 2.9 && lift <= 5.1, '上弹位移 3~5px', 'lift=' + lift.toFixed(2));

  // 轻微震屏 1~2px
  const { FX: FX2, bus: bus2 } = loadFX();
  bus2.emit('block:layer', { block: block(120, 320, 28), depth: 2 });
  let amp = 0;
  for (let i = 0; i < 12; i++) {
    FX2.update(DT);
    const o = FX2.offset();
    amp = Math.max(amp, Math.abs(o.x), Math.abs(o.y));
  }
  ok(amp > 0 && amp <= 2.2, 'layer 震屏轻微（1~2px）', 'amp=' + amp.toFixed(2));
}

console.log('\n== 12. block:empty 保留整格挖空全套 ==');
{
  const { FX, bus } = loadFX();
  bus.emit('block:empty', { block: block(140, 320, 28) });
  ok(FX.timeScale === 0.06, 'block:empty 触发命中停顿', String(FX.timeScale));
  FX.update(DT);
  ok(FX.flashAlpha > 0, 'block:empty 触发全屏白闪', String(FX.flashAlpha));
  let chips = 0, rings = 0;
  FX.eachActive(p => { if (p.kind === FX.KIND.CHIP) chips++; else if (p.kind === FX.KIND.RING) rings++; });
  ok(chips > 8, 'block:empty 碎屑量是整格级（远多于 layer 的 4~8）', String(chips));
  ok(rings === 2, 'block:empty 出双环', String(rings));

  // v2 同一格同帧会先后发 block:break 与 block:empty，只应出一次全套
  const { FX: FX3, bus: bus3 } = loadFX();
  const same = block(100, 300, 28);
  bus3.emit('block:break', { block: same, ore: 'coal', rich: false, chain: 0 });
  bus3.emit('block:empty', { block: same });
  FX3.update(DT);
  let rings3 = 0, chips3 = 0;
  FX3.eachActive(p => { if (p.kind === FX.KIND.RING) rings3++; else if (p.kind === FX.KIND.CHIP) chips3++; });
  ok(rings3 === 2, 'block:break + block:empty 同帧同格只出一次双环', String(rings3));
  ok(chips3 <= 26, '同帧同格碎屑未翻倍', String(chips3));

  // 对象不同但 ox/oy 相同（GRID 可能各发一份副本），同帧同样只出一次
  const { FX: FX4, bus: bus4 } = loadFX();
  bus4.emit('block:break', { block: { ox: 3, oy: 4, x: 100, y: 300, s: 28, ore: 'iron' }, ore: 'iron', rich: false, chain: 0 });
  bus4.emit('block:empty', { block: { ox: 3, oy: 4, x: 100, y: 300, s: 28, ore: 'iron' } });
  FX4.update(DT);
  let rings4 = 0;
  FX4.eachActive(p => { if (p.kind === FX.KIND.RING) rings4++; });
  ok(rings4 === 2, '同一格换对象也去重', String(rings4));

  // 但同帧的两格必须各出一次，不能误杀
  FX4.clear();
  bus4.emit('block:break', { block: { ox: 0, oy: 0, x: 40, y: 200, s: 28 }, ore: 'stone', rich: false, chain: 0 });
  bus4.emit('block:empty', { block: { ox: 1, oy: 0, x: 70, y: 200, s: 28 } });
  FX4.update(DT);
  let rings5 = 0;
  FX4.eachActive(p => { if (p.kind === FX.KIND.RING) rings5++; });
  ok(rings5 === 4, '同帧不同格各出一次（不去重过量）', String(rings5));
}

console.log('\n== 13. tnt:fuse 引信：脉冲、火花、加速 ==');
{
  const { FX, bus } = loadFX();
  const { ctx, c } = makeCtx();
  bus.emit('tnt:fuse', { x: 120, y: 300, cells: 9, delay: 0.8 });
  FX.update(DT);
  ok(FX.fusing === 1, '引信已激活', String(FX.fusing));
  FX.draw(ctx);
  ok(c.arc > 0, '引信画出了脉冲红圈', String(c.arc));

  let earlyMax = 0, lateMax = 0;
  for (let f = 0; f < 48; f++) {
    FX.update(DT);
    const t = (f + 1) * DT;
    let sp = 0;
    FX.eachActive(p => { if (p.kind === FX.KIND.SPARK) sp++; });
    if (t > 0.15 && t < 0.45) earlyMax = Math.max(earlyMax, sp);
    if (t > 0.55 && t < 0.79) lateMax = Math.max(lateMax, sp);
    FX.draw(ctx);
  }
  ok(earlyMax > 0, '引信每 0.1s 冒出火花', String(earlyMax));
  ok(lateMax > earlyMax, '最后 0.3 秒火花加密（0.1s → 0.05s）', 'early=' + earlyMax + ' late=' + lateMax);
  ok(FX.fusing === 0, '引信到时自动熄灭', String(FX.fusing));
  ok(FX.stats.alive <= FX.stats.cap, '引信粒子不超上限', FX.stats.alive + '/' + FX.stats.cap);

  // 引信洪水仍受上限约束
  const { FX: FX2, bus: bus2 } = loadFX();
  for (let i = 0; i < 300; i++) bus2.emit('tnt:fuse', { x: 195, y: 420, cells: 9, delay: 0.8 });
  for (let f = 0; f < 30; f++) FX2.update(DT);
  ok(FX2.stats.alive <= 900, '引信洪水后 alive <= 900', String(FX2.stats.alive));
  FX2.setQuality('low');
  for (let i = 0; i < 300; i++) bus2.emit('tnt:fuse', { x: 195, y: 420, cells: 9, delay: 0.8 });
  for (let f = 0; f < 30; f++) FX2.update(DT);
  ok(FX2.stats.alive <= 180, 'low 档引信洪水后 alive <= 180', String(FX2.stats.alive));
}

console.log('\n== 14. explosion 逐格分批 + 强震屏 + 白闪 0.4 ==');
{
  const { FX, bus } = loadFX();
  const cells = [];
  for (let i = 0; i < 9; i++) {
    cells.push({ ox: i % 3, oy: (i / 3) | 0, x: 140 + (i % 3 - 1) * 60, y: 310 + (((i / 3) | 0) - 1) * 60, s: 58, ore: 'iron' });
  }
  bus.emit('explosion', { x: 140, y: 310, radiusPx: 110, power: 3, cells });

  const delays = [];
  FX.eachActive(p => { if (p.kind === FX.KIND.CHIP && p.delay > 0) delays.push(p.delay); });
  ok(delays.length > 0, '爆炸先产生一批带延迟的逐格碎屑', String(delays.length));
  ok(delays.every(d => d >= 0.03 - 1e-9 && d <= 0.09 + 1e-9), '逐格延迟落在 30~90ms',
    Math.min(...delays).toFixed(3) + '..' + Math.max(...delays).toFixed(3));
  ok(Math.abs(Math.min(...delays) - 0.03) < 1e-6, '中心格最早炸（30ms）', String(Math.min(...delays)));
  ok(delays.some(d => d > 0.05), '外圈格延后（> 50ms）', String(Math.max(...delays)));

  FX.update(DT);
  ok(FX.flashAlpha > 0 && FX.flashAlpha <= 0.45, '爆炸白闪 0.4（被 0.45 上限钳制）', String(FX.flashAlpha));

  let amp = 0;
  for (let i = 0; i < 40; i++) {
    FX.update(DT);
    const o = FX.offset();
    amp = Math.max(amp, Math.abs(o.x), Math.abs(o.y));
  }
  ok(amp > 7 && amp <= 18, '爆炸震屏 14~18px（18px 硬上限内）', 'amp=' + amp.toFixed(2));

  // cells 只是格数也要能工作
  const { FX: FX2, bus: bus2 } = loadFX();
  bus2.emit('explosion', { x: 180, y: 400, radiusPx: 90, power: 2, cells: 9 });
  FX2.update(DT);
  let d2 = 0;
  FX2.eachActive(p => { if (p.kind === FX.KIND.CHIP) d2++; });
  ok(d2 > 0, 'cells 为格数时同样产生碎片波', String(d2));

  for (let i = 0; i < 200; i++) bus2.emit('explosion', { x: 195, y: 420, radiusPx: 120, power: 4, cells });
  FX2.update(DT);
  ok(FX2.stats.alive <= 900, '爆炸洪水后 alive <= 900', String(FX2.stats.alive));
  FX2.setQuality('low');
  for (let i = 0; i < 200; i++) bus2.emit('explosion', { x: 195, y: 420, radiusPx: 120, power: 4, cells });
  FX2.update(DT);
  ok(FX2.stats.alive <= 180, 'low 档爆炸洪水后 alive <= 180', String(FX2.stats.alive));
}

console.log('\n== 14b. 连环炸：同屏 TNT ≥3 → 震屏倍率（封顶 1.4）+ 火花线性放大 ==');
{
  const orig = Math.random;
  Math.random = function () { return 0; };      // 主爆火花基数固定 = 30，便于比较数量
  const run = (tnt) => {
    const { FX, bus } = loadFX();
    const d = { x: 195, y: 400, radiusPx: 60, power: 3, cells: 0 };
    if (tnt !== undefined) d.tntCount = tnt;
    bus.emit('explosion', d);
    let chips = 0;
    FX.eachActive((p) => { if (p.kind === FX.KIND.CHIP && p.delay === 0) chips++; });
    return { FX, bus, chips, mul: FX.shakeMul, tnt: FX.chain.tnt, shake: FX.chain.shake, sparks: FX.chain.sparks };
  };
  const solo = run(undefined);
  const one = run(1);
  const three = run(3);
  const six = run(6);
  const many = run(12);
  Math.random = orig;

  ok(solo.chips === one.chips, '没有 tntCount 字段时按单颗算（老事件不放大）', solo.chips + ' / ' + one.chips);
  ok(Math.abs(one.mul - 1) < 1e-9 && Math.abs(one.shake - 1) < 1e-9, '单颗爆炸：震屏倍率 1', String(one.mul));
  ok(Math.abs(three.mul - 1.1) < 1e-9 && three.tnt === 3, '同屏 3 颗：震屏倍率 1.1（1 + 1 × 0.1）', String(three.mul));
  ok(Math.abs(six.mul - 1.4) < 1e-9 && Math.abs(many.mul - 1.4) < 1e-9,
    '同屏 6 / 12 颗：震屏倍率封顶 1.4', six.mul + ' / ' + many.mul);
  ok(three.chips > one.chips && six.chips > three.chips && many.chips > six.chips,
    '火花数随同屏 TNT 数线性上升（1/3/6/12 → ' + one.chips + '/' + three.chips + '/' + six.chips + '/' + many.chips + '）');
  const r3 = three.chips / one.chips;
  ok(Math.abs(r3 - 1.3) < 0.06, '3 颗时火花 ≈ ×1.3（实测 ×' + r3.toFixed(2) + '）');
  ok(Math.abs(six.sparks - 2.2) < 1e-9, '6 颗时火花倍率 2.2 = 1 + (6-3+1) × 0.3（线性，不封顶）', String(six.sparks));

  let amp = 0;
  for (let i = 0; i < 40; i++) {
    many.FX.update(DT);
    const o = many.FX.offset();
    amp = Math.max(amp, Math.abs(o.x), Math.abs(o.y));
  }
  ok(amp > 0 && amp <= 18, '连环震屏仍受 18px 硬上限', 'amp=' + amp.toFixed(2));

  for (let i = 0; i < 160; i++) many.FX.update(DT);   // 2.67s 没有新爆炸
  ok(Math.abs(many.FX.shakeMul - 1) < 1e-9 && many.FX.chain.tnt === 1,
    '2.4s 没有新爆炸 → 连环倍率回落 1', String(many.FX.shakeMul));
  many.bus.emit('explosion', { x: 195, y: 400, radiusPx: 60, power: 3, tntCount: 4 });
  ok(Math.abs(many.FX.shakeMul - 1.2) < 1e-9, '同屏 4 颗 → 1.2', String(many.FX.shakeMul));
  many.bus.emit('round:start');
  ok(Math.abs(many.FX.shakeMul - 1) < 1e-9 && many.FX.chain.tnt === 1, 'round:start 把连环倍率归位');
}

console.log('\n== 15. 三矿碎屑配色（硬边、纯常量色） ==');
{
  const { FX, bus } = loadFX();
  const hex = /^#[0-9a-f]{6}$/;
  const gather = (ore, times) => {
    const set = new Set();
    for (let i = 0; i < times; i++) {
      bus.emit('block:break', { block: { x: 60, y: 200, s: 28, ore }, ore, rich: false, chain: 0 });
      FX.update(DT);
      FX.eachActive(p => { if (p.kind === FX.KIND.CHIP) set.add(p.col); });
      FX.clear();
    }
    return set;
  };
  const STONE = new Set(['#7d7d7d', '#5a5a5a', '#9a9a9a']);
  const COAL = new Set(['#7d7d7d', '#5a5a5a', '#9a9a9a', '#171717', '#3a3a3a']);
  const IRON = new Set(['#7d7d7d', '#5a5a5a', '#9a9a9a', '#d8b98a', '#a9855c']);

  const stone = gather('stone', 4);
  const coal = gather('coal', 6);
  const iron = gather('iron', 6);
  ok(stone.size > 0 && [...stone].every(c => STONE.has(c)), '石头碎屑只用石灰配色', [...stone].join(' '));
  ok([...coal].every(c => COAL.has(c)), '煤矿碎屑 = 石底 + 煤黑', [...coal].join(' '));
  ok([...coal].some(c => c === '#171717' || c === '#3a3a3a'), '煤矿出现黑色矿斑', [...coal].join(' '));
  ok([...iron].every(c => IRON.has(c)), '铁矿碎屑 = 石底 + 米褐', [...iron].join(' '));
  ok([...iron].some(c => c === '#d8b98a' || c === '#a9855c'), '铁矿出现米褐矿斑', [...iron].join(' '));
  const all = [...stone, ...coal, ...iron];
  ok(all.every(c => hex.test(c)), '碎屑色全是纯常量 hex（无渐变/无 rgba）', all.join(' '));
}

console.log('\n== 16. laser:tick 竖直光束：不堆叠、不闪断 ==');
{
  const { FX, bus } = loadFX();
  const { ctx, c } = makeCtx();
  const cells = [];
  for (let i = 0; i < 6; i++) cells.push({ ox: 2, oy: i, x: 140, y: 200 + i * 58, s: 58, ore: 'crystal' });
  bus.emit('laser:tick', { x: 169, y: 200 + 5 * 58, cells, h: 6 });

  let spMinY = Infinity, spMaxY = -Infinity, spMinX = Infinity, spMaxX = -Infinity, sparks = 0;
  FX.eachActive(p => {
    if (p.kind !== FX.KIND.SPARK) return;
    sparks++;
    spMinY = Math.min(spMinY, p.y); spMaxY = Math.max(spMaxY, p.y);
    spMinX = Math.min(spMinX, p.x); spMaxX = Math.max(spMaxX, p.x);
  });
  ok(sparks > 0, '激光命中有火花', String(sparks));
  ok(spMaxY - spMinY > (spMaxX - spMinX) * 3, '火花竖直分布（y 跨度 >> x 跨度）',
    'dx=' + (spMaxX - spMinX).toFixed(1) + ' dy=' + (spMaxY - spMinY).toFixed(1));
  ok(spMinY < 212 && spMaxY > 540, '火花同时出现在光束顶端与末端',
    spMinY.toFixed(1) + '..' + spMaxY.toFixed(1));

  FX.update(DT);
  const beams = [];
  FX.eachActive(p => { if (p.kind === FX.KIND.BEAM) beams.push(p); });
  ok(beams.length === 1, '一条激光只产生一个光束对象', String(beams.length));
  const b = beams[0];
  ok(b && b.size > 300 && b.size < 380, '光束覆盖该列顶端到落点（6×58=348px）', b && b.size.toFixed(1));
  ok(b && b.w >= 3 && b.w <= 5, '核心亮线宽 3~5px', b && b.w.toFixed(2));
  ok(b && b.size > b.w * 20, '竖直：光束高度远大于宽度', b && (b.size / b.w).toFixed(1));
  ok(b && Math.abs(b.x - 169) < 0.5, '光束落在该列中心 x=169', b && b.x.toFixed(1));

  const before = c.fillRect;
  FX.draw(ctx);
  ok(c.fillRect - before >= 3, '光束用矩形叠层绘制（核心 + 2 层辉光）', String(c.fillRect - before));

  let maxBeams = 0, midAlive = -1;
  for (let fr = 1; fr <= 120; fr++) {
    if (fr % 9 === 0) bus.emit('laser:tick', { x: 169, y: 200 + 5 * 58, cells, h: 6 });
    FX.update(DT);
    let n = 0;
    FX.eachActive(p => { if (p.kind === FX.KIND.BEAM) n++; });
    if (n > maxBeams) maxBeams = n;
    if (fr === 5) midAlive = n;
  }
  ok(midAlive === 1, '两个 tick 之间（0.15s）光束仍存活，不闪断', String(midAlive));
  ok(maxBeams === 1, '连续 13 次 tick 从不堆叠光束对象', 'max=' + maxBeams);
  ok(FX.stats.alive <= FX.stats.cap, '激光洪水不超上限', FX.stats.alive + '/' + FX.stats.cap);

  for (let fr = 0; fr < 24; fr++) FX.update(DT);
  let gone = 0;
  FX.eachActive(p => { if (p.kind === FX.KIND.BEAM) gone++; });
  ok(gone === 0, '停止切割后 0.35s 内光束消失（寿命 0.2s + 80ms 淡出）', String(gone));

  const { FX: FX2, bus: bus2 } = loadFX();
  bus2.emit('laser:tick', { x: 200, y: 500, h: 4 });
  FX2.update(DT);
  let b2 = null;
  FX2.eachActive(p => { if (p.kind === FX2.KIND.BEAM) b2 = p; });
  ok(b2 && b2.size > 0 && b2.w <= 5, 'cells 缺失时按 h 格推算光束', b2 && b2.size.toFixed(1));
  ok(b2 && b2.size > b2.w * 20, '兜底几何同样竖直');
}

console.log('\n== 17. quake:blast 三环同心 + cells 越大波纹越大 ==');
{
  const { FX, bus } = loadFX();
  bus.emit('quake:blast', { x: 195, y: 420, cells: 49 });
  const rings = [];
  FX.eachActive(p => { if (p.kind === FX.KIND.RING) rings.push(p); });
  ok(rings.length === 3, '三层同心冲击波', String(rings.length));
  const endR = rings.map(r => r.size + r.grow * r.max);
  const speed = rings.map(r => r.grow);
  const iOut = endR.indexOf(Math.max(...endR));
  const iIn = endR.indexOf(Math.min(...endR));
  ok(speed[iIn] > speed[iOut], '内层快、外层慢',
    'inner=' + speed[iIn].toFixed(0) + 'px/s outer=' + speed[iOut].toFixed(0) + 'px/s');
  ok(Math.max(...endR) / Math.min(...endR) > 2, '三环最终半径成层次', endR.map(v => v.toFixed(0)).join(' / '));

  let dust = 0;
  FX.eachActive(p => { if (p.kind === FX.KIND.DUST) dust++; });
  ok(dust >= 8, '一次环形尘浪', String(dust));
  ok(FX.timeScale === 0.06, '命中停顿立即生效');
  ok(FX.shakeAmp >= 16 && FX.shakeAmp <= 20, '震屏请求 16~20px', String(FX.shakeAmp));

  let amp = 0, pauseFrames = 0, recoverFrame = -1, flashSeen = 0;
  for (let fr = 0; fr < 60; fr++) {
    FX.update(DT);
    const o = FX.offset();
    amp = Math.max(amp, Math.abs(o.x), Math.abs(o.y));
    if (fr === 0) flashSeen = FX.flashAlpha;
    if (FX.timeScale === 0.06) pauseFrames++;
    if (recoverFrame < 0 && FX.timeScale === 1) recoverFrame = fr;
  }
  ok(flashSeen > 0.2 && flashSeen <= 0.45, '白闪 0.35（<=0.45 上限）', String(flashSeen));
  ok(amp > 12 && amp <= 18, '实际位移峰值接近请求值且不越 18px 硬上限', 'amp=' + amp.toFixed(2));
  ok(pauseFrames >= 2 && pauseFrames <= 4, '满停顿约 40ms（2~4 帧）', 'pause=' + pauseFrames);
  ok(recoverFrame > 0 && recoverFrame <= 12, '停顿后 12 帧内回到 timeScale 1', 'frame=' + recoverFrame);

  const radiusOf = (cells) => {
    const { FX: F2, bus: b2 } = loadFX();
    b2.emit('quake:blast', { x: 195, y: 420, cells });
    let maxEnd = 0;
    F2.eachActive(p => { if (p.kind === F2.KIND.RING) maxEnd = Math.max(maxEnd, p.size + p.grow * p.max); });
    return maxEnd;
  };
  const r49 = radiusOf(49);
  const r81 = radiusOf(81);
  ok(r81 > r49 * 1.1, '9×9 波纹明显大于 7×7', '7×7=' + r49.toFixed(0) + 'px 9×9=' + r81.toFixed(0) + 'px');
  const rArr = radiusOf(Array.from({ length: 81 }, () => ({ x: 100, y: 300, s: 58, ore: 'iron' })));
  ok(Math.abs(rArr - r81) < 1, 'cells 为数组时按格数算半径', rArr.toFixed(1) + ' vs ' + r81.toFixed(1));

  const { FX: FL, bus: bL } = loadFX();
  FL.setQuality('low');
  bL.emit('quake:blast', { x: 195, y: 420, cells: 81 });
  FL.update(DT);
  ok(FL.flashAlpha === 0, 'low 档关白闪', String(FL.flashAlpha));
  ok(FL.stats.alive <= 180, 'low 档不超 180', String(FL.stats.alive));
}

console.log('\n== 18. lucky:tnt 金框弹入 → FREE! → 接现有引信 ==');
{
  const { FX, bus } = loadFX();
  const { ctx, c } = makeCtx();
  bus.emit('lucky:tnt', { x: 150, y: 380, delay: 0.45 });
  FX.update(DT);
  FX.draw(ctx);

  const gold = c.rects.filter(r => r.col === '#ffd35c');
  ok(gold.length >= 1, '弹入时画出金色边框', JSON.stringify(gold.slice(0, 1)));
  ok(gold.every(r => r.w <= 40 && r.h <= 40), '金框是小炸药盒尺寸', gold.map(r => r.w.toFixed(0)).join(','));
  ok(gold.length > 0 && gold[0].y < 360, '金框还在落点上方飞行', gold.length && gold[0].y.toFixed(1));
  const body = c.fills.filter(r => r.col === '#e8412c');
  ok(body.length > 0 && body.every(r => r.w <= 40 && r.h <= 40), '金框内是炸药盒体', JSON.stringify(body.slice(0, 1)));

  let trail = 0, trailGold = 0;
  FX.eachActive(p => { if (p.kind === FX.KIND.MOTE) { trail++; if (p.col === '#ffd35c' || p.col === '#fff0b8') trailGold++; } });
  ok(trail > 0, '弹入带拖影', String(trail));
  ok(trailGold === trail, '拖影是金色微光', trailGold + '/' + trail);

  let landedAt = -1, fuseRings = 0;
  for (let fr = 0; fr < 20; fr++) {
    FX.update(DT);
    if (landedAt < 0) {
      let fr2 = 0;
      FX.eachActive(p => { if (p.kind === FX.KIND.RING && Math.abs(p.w - 2.6) < 1e-6) fr2++; });
      if (FX.fusing === 1) { landedAt = fr; fuseRings = fr2; }
    }
    FX.draw(ctx);
  }
  ok(landedAt >= 0 && landedAt <= 17, '约 0.26s 后落地并起引信', 'frame=' + landedAt);
  ok(fuseRings === 1, '落地只起一套引信（不重复画引信）', String(fuseRings));

  let freeTxt = 0, freeCol = '';
  FX.eachActive(p => { if (p.kind === FX.KIND.TEXT && p.str === 'FREE!') { freeTxt++; freeCol = p.col; } });
  ok(freeTxt === 1, '落地金色 FREE! 跳字', String(freeTxt));
  ok(freeCol === '#fff0b8', 'FREE! 用金色', freeCol);

  for (let fr = 0; fr < 40; fr++) FX.update(DT);
  ok(FX.fusing === 0, '沿用既有引信逻辑，到时熄灭', String(FX.fusing));

  for (let i = 0; i < 200; i++) bus.emit('lucky:tnt', { x: 100 + (i % 5) * 50, y: 300, delay: 0.45 });
  FX.update(DT);
  ok(FX.stats.alive <= FX.stats.cap, 'lucky 洪水不超上限', FX.stats.alive + '/' + FX.stats.cap);
  FX.setQuality('low');
  for (let i = 0; i < 200; i++) bus.emit('lucky:tnt', { x: 100 + (i % 5) * 50, y: 300, delay: 0.45 });
  FX.update(DT);
  ok(FX.stats.alive <= 180, 'low 档 lucky 洪水不超 180', String(FX.stats.alive));
}

console.log('\n== 19. 晶石碎屑配色 = 紫青三色 ==');
{
  const { FX, bus } = loadFX();
  const hex = /^#[0-9a-f]{6}$/;
  const gather = (ore, times) => {
    const set = new Set();
    for (let i = 0; i < times; i++) {
      bus.emit('block:break', { block: { x: 60, y: 200, s: 28, ore }, ore, rich: false, chain: 0 });
      FX.update(DT);
      FX.eachActive(p => { if (p.kind === FX.KIND.CHIP) set.add(p.col); });
      FX.clear();
    }
    return set;
  };
  const CR = new Set(['#a8e8ff', '#6fd8e0', '#2f6f7a']);
  const STONE = new Set(['#7d7d7d', '#5a5a5a', '#9a9a9a']);
  const cr = gather('crystal', 8);
  ok(cr.size >= 2, '晶石碎屑出现多种紫青色', [...cr].join(' '));
  ok([...cr].every(c => CR.has(c)), '晶石碎屑只用 #a8e8ff / #6fd8e0 / #2f6f7a', [...cr].join(' '));
  ok([...cr].every(c => hex.test(c)), '晶石碎屑是纯常量色（无渐变）');
  const unk = gather('mystery', 4);
  ok(unk.size > 0 && [...unk].every(c => STONE.has(c)), '未知 ore id 回落石头配色', [...unk].join(' '));
  const legacy = gather('copper', 4);
  ok([...legacy].some(c => c === '#d8b98a' || c === '#a9855c'), 'v1 遗留 copper 仍映射到铁', [...legacy].join(' '));
}


console.log('\n== 21. 贴图接入：注入假 BM.ART 走 drawImage，未就绪/缺失回退多边形 ==');
{
  // 1) 完全不注入 ART：碎屑 / 火花 / 尘团全走程序化绘制
  const plain = loadFX();
  const p0 = makeCtx();
  plain.bus.emit('block:break', { block: block(), ore: 'coal', rich: true, chain: 0 });
  plain.bus.emit('block:hit', { block: block(), dmg: 2, dir: -1.2 });
  plain.FX.update(DT);
  plain.FX.draw(p0.ctx);
  ok(p0.c.drawImage === 0, '无 ART 时不调用 drawImage', JSON.stringify(p0.c));
  ok(p0.c.fill > 0, '无 ART 时碎屑 / 火花 / 尘团走多边形 fill', String(p0.c.fill));

  // 无 ART 时金框 TNT 弹入仍是代码盒体（fillRect）
  const plain2 = loadFX();
  const p2 = makeCtx();
  plain2.bus.emit('lucky:tnt', { x: 150, y: 380, delay: 0.45 });
  plain2.FX.update(DT);
  plain2.FX.draw(p2.ctx);
  ok(p2.c.fillRect >= 1 && p2.c.drawImage === 0, '无 ART 时金框 TNT 走代码盒体', JSON.stringify(p2.c));

  // 2) 注入假 ART：同一批事件改走 drawImage，多边形 fill 归零
  const art = makeArt(false);
  const g = loadFX(art);
  const pa = makeCtx();
  g.bus.emit('block:break', { block: block(), ore: 'coal', rich: true, chain: 0 });
  g.bus.emit('block:hit', { block: block(), dmg: 2, dir: -1.2 });
  g.FX.update(DT);
  g.FX.draw(pa.ctx);
  ok(pa.c.drawImage > 0, '注入 ART 后改走 drawImage', String(pa.c.drawImage));
  ok(pa.c.fill === 0, '注入 ART 后碎屑 / 火花 / 尘团不再走多边形 fill', String(pa.c.fill));
  ['fx.chip.coal', 'fx.spark', 'fx.dust'].forEach(k =>
    ok(art.seen.has(k), '用到了贴图键 ' + k, [...art.seen].join(',')));
  ok(!art.seen.has('fx.chip.stone'), '碎屑键按 ore 取（coal 不查 stone）', [...art.seen].join(','));
  const callsBefore = art.calls;
  const pa2 = makeCtx();
  g.FX.update(DT);
  g.FX.draw(pa2.ctx);
  ok(pa2.c.drawImage > 0 && art.calls === callsBefore, 'draw 内不重复解析贴图（句柄缓存）', callsBefore + ' -> ' + art.calls);

  // 3) 金框 TNT 用 fx.tnt_gold
  const artLk = makeArt(false);
  const lkfx = loadFX(artLk);
  const pl = makeCtx();
  lkfx.bus.emit('lucky:tnt', { x: 150, y: 380, delay: 0.45 });
  lkfx.FX.update(DT);
  lkfx.FX.draw(pl.ctx);
  ok(artLk.seen.has('fx.tnt_gold'), '金框 TNT 用 fx.tnt_gold 贴图', [...artLk.seen].join(','));
  ok(pl.c.drawImage > 0, '金框 TNT 走 drawImage', String(pl.c.drawImage));

  // 3b) 金星：drop:absorb 的指路微光用 fx.star
  const artStar = makeArt(false);
  const gs = loadFX(artStar);
  const pg = makeCtx();
  gs.bus.emit('drop:absorb', { ore: 'coal', amount: 2, x: 150, y: 500 });
  gs.FX.update(DT);
  gs.FX.draw(pg.ctx);
  ok(artStar.seen.has('fx.star'), '金星用 fx.star 贴图', [...artStar.seen].join(','));
  ok(pg.c.drawImage > 0, '金星走 drawImage', String(pg.c.drawImage));

  const gsp = loadFX();
  const pgp = makeCtx();
  gsp.bus.emit('drop:absorb', { ore: 'coal', amount: 2, x: 150, y: 500 });
  gsp.FX.update(DT);
  gsp.FX.draw(pgp.ctx);
  ok(pgp.c.drawImage === 0 && pgp.c.fill > 0, '无 ART 时金星走多边形 fill', JSON.stringify(pgp.c));

  // 4) ART 在但图未解码（one() 返回 null）：仍是原有绘制，不白屏
  const nl = makeArt(true);
  const n = loadFX(nl);
  const pn = makeCtx();
  n.bus.emit('block:break', { block: block(), ore: 'iron', rich: false, chain: 0 });
  n.bus.emit('block:hit', { block: block(), dmg: 1, dir: 0.4 });
  n.FX.update(DT);
  n.FX.draw(pn.ctx);
  ok(pn.c.drawImage === 0 && pn.c.fill > 0, 'ART 未解码时回退多边形绘制', JSON.stringify(pn.c));
}

console.log('\n== 22. 低画质档配额不受贴图影响 ==');
{
  const hi = loadFX(makeArt(false));
  hi.bus.emit('block:break', { block: block(), ore: 'coal', rich: false, chain: 0 });
  hi.FX.update(DT);
  let hiChips = 0;
  hi.FX.eachActive(p => { if (p.kind === hi.FX.KIND.CHIP) hiChips++; });

  const lo = loadFX(makeArt(false));
  lo.FX.setQuality('low');
  ok(lo.FX.stats.cap === 180, 'low 档粒子上限仍为 180', String(lo.FX.stats.cap));
  lo.bus.emit('block:break', { block: block(), ore: 'coal', rich: false, chain: 0 });
  lo.FX.update(DT);
  let loChips = 0;
  lo.FX.eachActive(p => { if (p.kind === lo.FX.KIND.CHIP) loChips++; });
  ok(loChips > 0, 'low 档贴图路径仍有碎屑', String(loChips));
  ok(loChips <= hiChips * 0.7, 'low 档碎屑 ×0.35 缩减不变', 'low=' + loChips + ' high=' + hiChips);

  const ctxL = makeCtx();
  for (let i = 0; i < 300; i++) lo.bus.emit('explosion', { x: 195, y: 400, radiusPx: 90, power: 3 });
  lo.FX.update(DT);
  lo.FX.draw(ctxL.ctx);
  ok(lo.FX.stats.alive <= 180, 'low 档洪水后 alive <= 180', String(lo.FX.stats.alive));
}
console.log('\n== 23. 地心共振：3 层金色冲击波覆盖整屏 + 白闪 0.35 + 震屏 18px + 各处碎屑 ==');
{
  const { FX, bus } = loadFX();
  FX.clear();
  const rings = () => {
    const out = [];
    FX.eachActive((p) => { if (p.kind === FX.KIND.RING) out.push(p); });
    return out;
  };
  bus.emit('resonance:blast', { x: 195, y: 422, cells: 48 });
  const rs = rings();
  ok(rs.length === 3, '中心喷出 3 层环', rs.length);
  ok(rs.every((p) => p.grow > 0), '3 层环全部向外扩散');
  const targets = rs.map((p) => p.size + p.grow * p.life);
  const maxR = Math.max(...targets);
  ok(maxR >= 465, '最外层最终半径覆盖 390×844（中心到对角 ≈ 465px）', maxR.toFixed(1));
  ok(rs.some((p) => p.delay === 0) && rs.some((p) => p.delay > 0), '三层环错峰扩散（内快外慢）');

  ok(FX.resonance.R === 470, 'FX.resonance.R = 470', String(FX.resonance.R));
  ok(FX.resonance.rings === 3, 'FX.resonance.rings = 3', String(FX.resonance.rings));
  ok(FX.resonance.cells === 48, 'FX.resonance.cells 回读 events.cells', String(FX.resonance.cells));
  ok(FX.resonance.shake === 18, 'FX.resonance.shake = 18', String(FX.resonance.shake));
  ok(FX.shakeAmp === 18, '震屏幅度 = 18px（SHAKE_MAX 硬上限内）', String(FX.shakeAmp));

  let chips = 0;
  FX.eachActive((p) => { if (p.kind === FX.KIND.CHIP) chips++; });
  ok(chips > 0, '全屏各处同时喷碎屑', String(chips));
  ok(chips <= 240, '单次共振碎屑不超过 240（受粒子池上限约束）', String(chips));

  FX.update(DT);
  ok(FX.flashAlpha > 0.3, '白闪 0.35（一帧后仍 > 0.3）', FX.flashAlpha.toFixed(3));
  const p0 = makeCtx();
  FX.draw(p0.ctx);
  ok(p0.c.fillRect + p0.c.stroke + p0.c.fill > 0, '共振表现可正常绘制');
}
{
  // 低画质档：碎屑按 ×0.35 缩减，粒子总数不超 180
  const { FX, bus } = loadFX();
  FX.setQuality('low');
  for (let i = 0; i < 6; i++) bus.emit('resonance:blast', { x: 195, y: 422, cells: 48 });
  FX.update(DT);
  ok(FX.stats.cap === 180, 'low 档粒子上限 180', String(FX.stats.cap));
  ok(FX.stats.alive <= 180, 'low 档连续共振不超上限', String(FX.stats.alive));
  ok(FX.flashAlpha === 0, 'low 档不闪白（既有画质策略不变）', String(FX.flashAlpha));
  const p1 = makeCtx();
  FX.draw(p1.ctx);
  ok(FX.stats.alive <= 180, 'low 档 draw 之后仍在上限内', String(FX.stats.alive));
}

console.log('\n== 24. 宝藏开箱：40–60 颗金色粒子 + 一圈金色光柱 ==');
{
  const { FX, bus } = loadFX();
  FX.clear();
  bus.emit('treasure:open', { x: 120, y: 380 });
  const sparks = [], motes = [];
  FX.eachActive((p) => {
    if (p.kind === FX.KIND.SPARK) sparks.push(p);
    else if (p.kind === FX.KIND.MOTE) motes.push(p);
  });
  ok(sparks.length >= 40 && sparks.length <= 60, '40–60 颗金色粒子', String(sparks.length));
  ok(sparks.every((p) => p.col === '#ffd35c' || p.col === '#fff0b8'), '粒子只用金色常量',
    [...new Set(sparks.map((p) => p.col))].join(','));
  ok(sparks.some((p) => p.vx !== 0 || p.vy !== 0), '粒子向四周爆发（有速度）');
  ok(motes.length >= 8 * 5, '一圈金色光柱（8 根 × 5 颗微光）', String(motes.length));
  ok(FX.treasure.sparks === sparks.length && FX.treasure.pillars === 8,
    'FX.treasure 读数：sparks / pillars = 8', JSON.stringify(FX.treasure));
  ok(FX.treasure.x === 120 && FX.treasure.y === 380, 'FX.treasure 记录开箱位置');
  ok(FX.shakeAmp > 0, '开箱有轻微震屏', String(FX.shakeAmp));

  const p2 = makeCtx();
  FX.update(DT);
  FX.draw(p2.ctx);
  ok(p2.c.fill + p2.c.fillRect + p2.c.strokeRect > 0, '开箱表现可正常绘制');

  // 池上限：连开 8 次不超 high 档 900
  for (let i = 0; i < 8; i++) bus.emit('treasure:open', { x: 120, y: 380 });
  FX.update(DT);
  ok(FX.stats.alive <= 900, 'high 档连开箱不超 900', String(FX.stats.alive));
}
{
  // 低画质档：光柱减半，总数不超 180
  const { FX, bus } = loadFX();
  FX.setQuality('low');
  for (let i = 0; i < 4; i++) bus.emit('treasure:open', { x: 120, y: 380 });
  FX.update(DT);
  ok(FX.treasure.pillars === 4, 'low 档光柱减半（4 根）', String(FX.treasure.pillars));
  ok(FX.stats.alive <= 180, 'low 档连开箱不超 180', String(FX.stats.alive));
}

console.log('\n== 25. v9 碎层爽感：震屏幅度随本局碎层上升（封顶 1.4） ==');
{
  const { FX, bus } = loadFX();
  FX.clear();
  ok(FX.layersThisRound === 0, '初始碎层 0', String(FX.layersThisRound));
  ok(FX.shakeMul === 1, '初始倍率 1', String(FX.shakeMul));

  bus.emit('block:layer', { block: block(100, 300), depth: 1 });
  ok(FX.layersThisRound === 1, 'block:layer 计 1 层', String(FX.layersThisRound));
  ok(Math.abs(FX.shakeMul - 1.002) < 1e-9, '倍率 = 1 + 1 × 0.002', String(FX.shakeMul));

  // block:break 与 block:empty 同帧成对派发，只计 1 层
  const b1 = block(140, 300);
  bus.emit('block:break', { block: b1, ore: 'coal', chain: 0 });
  bus.emit('block:empty', { block: b1 });
  ok(FX.layersThisRound === 2, 'block:break + block:empty 只计 1 层（去重）', String(FX.layersThisRound));
  ok(Math.abs(FX.shakeMul - 1.004) < 1e-9, '倍率随层数线性上升', String(FX.shakeMul));

  // 大量碎层 → 倍率封顶
  for (let i = 0; i < 700; i++) bus.emit('block:layer', { block: block((i % 6) * 60, 340), depth: 1 });
  ok(FX.layersThisRound === 702, '累计碎层 = 702', String(FX.layersThisRound));
  ok(FX.shakeMul === 1.4, '倍率封顶 1.4（不再上升）', String(FX.shakeMul));

  // 同一发 10px 请求：高碎层时被放大到 14px，仍受 18px 硬上限
  FX.offsetReset();
  FX.shake(10, 0.3);
  ok(Math.abs(FX.shakeAmp - 14) < 1e-9, 'shake(10) 在封顶档被放大到 14px', String(FX.shakeAmp));
  FX.offsetReset();
  FX.shake(30, 0.3);
  ok(FX.shakeAmp === 18, '放大后仍被 18px 硬上限钳制', String(FX.shakeAmp));
  let amp = 0;
  for (let i = 0; i < 30; i++) {
    FX.update(DT);
    const o = FX.offset();
    amp = Math.max(amp, Math.abs(o.x), Math.abs(o.y));
  }
  ok(amp > 8 && amp <= 18, '高碎层时位移明显变大且不破上限', 'amp=' + amp.toFixed(2));

  // round:start / clear() 归位
  bus.emit('round:start', {});
  ok(FX.layersThisRound === 0 && FX.shakeMul === 1, 'round:start 归零碎层与倍率');
  bus.emit('block:layer', { block: block(60, 300), depth: 1 });
  ok(FX.layersThisRound === 1, '新一局重新开始计数');
  FX.clear();
  ok(FX.layersThisRound === 0 && FX.shakeMul === 1, 'clear() 同样归零');
}

console.log('\n== 26. v9 处决：tool:execute 一帧白闪 + 金色十字火花 8–12 个 ==');
{
  const { FX, bus } = loadFX();
  FX.clear();
  bus.emit('tool:execute', { x: 120, y: 400 });
  ok(FX.execute.count === 1, 'FX.execute.count = 1', String(FX.execute.count));
  ok(FX.execute.x === 120 && FX.execute.y === 400, 'FX.execute 记录处决位置',
    JSON.stringify(FX.execute));

  const sparks = [];
  FX.eachActive((p) => { if (p.kind === FX.KIND.SPARK) sparks.push(p); });
  ok(sparks.length >= 8 && sparks.length <= 12, '金色火花 8–12 个', String(sparks.length));
  ok(FX.execute.sparks === sparks.length, 'FX.execute.sparks 与粒子数一致', String(FX.execute.sparks));
  ok(sparks.every((p) => p.col === '#ffcf4a' || p.col === '#fff8d8'), '只用金色常量',
    [...new Set(sparks.map((p) => p.col))].join(','));
  ok(sparks.every((p) => p.x === 120 && p.y === 400), '全部从处决点喷出');

  // 十字：每颗都贴着一根正十字臂飞出，横竖两向都有、左右上下对称
  const horiz = sparks.filter((p) => Math.abs(p.vx) > Math.abs(p.vy) * 3);
  const vert = sparks.filter((p) => Math.abs(p.vy) > Math.abs(p.vx) * 3);
  ok(horiz.length + vert.length === sparks.length, '每颗火花都贴着十字臂（横或竖）',
    horiz.length + '+' + vert.length + '/' + sparks.length);
  ok(horiz.length > 0 && vert.length > 0, '横竖两向都有（十字而不是圆爆）');
  ok(sparks.some((p) => p.vx > 0) && sparks.some((p) => p.vx < 0), '横臂左右对称');
  ok(sparks.some((p) => p.vy > 0) && sparks.some((p) => p.vy < 0), '竖臂上下对称');
  ok(FX.shakeAmp > 0, '处决有轻微震屏', String(FX.shakeAmp));

  FX.update(DT);
  ok(FX.flashAlpha > 0 && FX.flashAlpha <= 0.45, '白闪亮起（且在 0.45 上限内）', String(FX.flashAlpha));
  ok(FX.hitPoint.x === 120 && FX.hitPoint.y === 400, '处决点写入最近命中点',
    JSON.stringify(FX.hitPoint));
  FX.update(DT);
  ok(FX.flashAlpha === 0, '下一帧白闪就消失（只亮 1 帧）', String(FX.flashAlpha));

  // 连发不失控
  for (let i = 0; i < 120; i++) bus.emit('tool:execute', { x: 60 + (i % 5) * 60, y: 380 });
  FX.update(DT);
  ok(FX.stats.alive <= 900, '处决洪水后 alive <= 900', String(FX.stats.alive));
  ok(FX.execute.count === 121, 'FX.execute.count 累计 121', String(FX.execute.count));

  const p2 = makeCtx();
  FX.draw(p2.ctx);
  ok(p2.c.fill + p2.c.fillRect + p2.c.strokeRect > 0, '处决表现可正常绘制');
}
{
  // 低画质：不给全屏白闪（Q_FLASH = 0），火花照常
  const { FX, bus } = loadFX();
  FX.setQuality('low');
  FX.clear();
  bus.emit('tool:execute', { x: 100, y: 300 });
  FX.update(DT);
  ok(FX.flashAlpha === 0, 'low 档不白闪');
  let sparks = 0;
  FX.eachActive((p) => { if (p.kind === FX.KIND.SPARK) sparks++; });
  ok(sparks >= 8 && sparks <= 12, 'low 档仍出 8–12 颗金色火花', String(sparks));
}

console.log('\n== 27. v9 07-audio：execute 音效 + 连击亮尾音（纯合成，无音频文件） ==');
{
  const audioSrc = readFileSync(join(here, '..', 'src', '07-audio.js'), 'utf8');
  ok(audioSrc.indexOf('SOUNDS.execute = function') > 0, '注册音效 execute');
  ok(audioSrc.indexOf('SOUNDS.layerBright = function') > 0, '注册音效 layerBright（连击亮尾音）');
  ok(audioSrc.indexOf('execute: 0.05') > 0, 'execute 进节流表（连发不堆节点）');
  ok(audioSrc.indexOf('layerBright: 0.06') > 0, 'layerBright 进节流表');
  ok(audioSrc.indexOf("bus.on('tool:execute'") > 0, 'tool:execute 绑到 execute 音效');
  ok(audioSrc.indexOf('LAYER_WINDOW = 1') > 0 && audioSrc.indexOf('LAYER_CHAIN_AT = 3') > 0,
    '1 秒窗口内碎层 >= 3 才叠亮尾音');
  ok(/SOUNDS\.execute[\s\S]{0,1400}4300[\s\S]{0,200}7200/.test(audioSrc),
    'execute 是短促高频（带通 4300 → 7200）');
  ok(/SOUNDS\.execute[\s\S]{0,1600}tone\(dst, 'triangle', 3120/.test(audioSrc),
    'execute 带一层下滑尾音');
  ok(/SOUNDS\.layerBright[\s\S]{0,600}streak/.test(audioSrc), 'layerBright 用连击数决定亮度');
  ok(/stampLayer\(\) >= LAYER_CHAIN_AT/.test(audioSrc), '碎层计数驱动亮尾音');
  ok(audioSrc.indexOf('layerStamps.length = 0') > 0, 'round:start 清空碎层时间戳');

  // v9b 连环炸尾音：同屏 TNT >= 3 颗时叠一层「连环」
  ok(audioSrc.indexOf('SOUNDS.tntChain = function') > 0, '注册音效 tntChain（连环尾音）');
  ok(audioSrc.indexOf('tntChain: 0.12') > 0, 'tntChain 进节流表（连环不堆节点）');
  ok(audioSrc.indexOf('CHAIN_BOOM_AT = 3') > 0, '同屏 TNT >= 3 颗才叠连环尾音');
  ok(/bus\.on\('explosion'[\s\S]{0,700}tntCount/.test(audioSrc), 'explosion 用 04-tools 的 tntCount 判连环');
  ok(/play\('tntChain'/.test(audioSrc), '连环尾音由 explosion 触发');
  ok(/SOUNDS\.tntChain[\s\S]{0,900}numOr\(o\.count, 3\)/.test(audioSrc), 'tntChain 的音符数跟同屏 TNT 数走');

  // 无 AudioContext 时静默降级：新音名 play() 不抛错
  const win = { BM: { bus: makeBus() } };
  const sandbox = { window: win, console: { warn() {}, log() {}, error() {} }, Math, Date, isFinite, Array, Object };
  vm.createContext(sandbox);
  vm.runInContext(audioSrc, sandbox, { filename: 'src/07-audio.js' });
  const A = win.BM.AUDIO;
  ok(A && typeof A.play === 'function', 'BM.AUDIO.play 存在');
  let threw = null;
  try { A.init(); A.play('execute', { pan: 0.2 }); A.play('layerBright', { streak: 4 }); A.play('tntChain', { count: 5 }); } catch (e) { threw = e; }
  ok(threw === null, '无 AudioContext 时 execute / layerBright / tntChain 静默降级不抛错',
    threw && threw.message);
}

console.log('\n---------------------------------------');
if (fails.length) {
  console.log('FAILED ' + fails.length + ' / ' + (pass + fails.length));
  fails.forEach(f => console.log(' - ' + f));
  process.exit(1);
}
console.log('ALL GREEN  ' + pass + ' assertions passed');
