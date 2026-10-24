// test/grid.smoke.mjs — 用 node 直接跑真实的 src/03-grid.js（stub 掉 canvas / bus / CONFIG / CORE）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src', '03-grid.js');
const code = readFileSync(SRC, 'utf8');

let pass = 0;
const fails = [];
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fails.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : ' → ' + detail)); }
}
function eq(actual, expected, label) {
  ok(Object.is(actual, expected), label, 'got ' + String(actual) + ', want ' + String(expected));
}
function near(actual, expected, tol, label) {
  const d = Math.abs(actual - expected);
  ok(d <= tol, label, 'got ' + actual.toFixed(4) + ', want ' + expected + ' ± ' + tol);
}
function section(t) { console.log('\n' + t); }

// ---------- 记录型 canvas / ctx stub ----------
const total = {
  getImageData: 0, createImageData: 0, putImageData: 0, drawImage: 0,
  fillRect: 0, stroke: 0, fill: 0, linearGrad: 0, radialGrad: 0
};
const rectLog = [];   // 记录 fillRect 的矩形与当时的样式
const drawLog = [];   // 记录 drawImage 的图与矩形（校验贴图接入 / 回退路径）

function makeCtx(owner) {
  const ops = { getImageData: 0, createImageData: 0, putImageData: 0, drawImage: 0, fillRect: 0, stroke: 0, fill: 0 };
  const ctx = {
    canvas: owner,
    ops,
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    globalAlpha: 1, imageSmoothingEnabled: true, globalCompositeOperation: 'source-over',
    getImageData() { ops.getImageData++; total.getImageData++; throw new Error('不允许调用 getImageData'); },
    createImageData(w, h) {
      ops.createImageData++; total.createImageData++;
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData(img) {
      ops.putImageData++; total.putImageData++;
      owner.img = img;
    },
    drawImage(img, x, y, w, h) {
      ops.drawImage++; total.drawImage++;
      drawLog.push({ ctx, img, x, y, w, h, smoothing: ctx.imageSmoothingEnabled, alpha: ctx.globalAlpha });
    },
    fillRect(x, y, w, h) {
      ops.fillRect++; total.fillRect++;
      rectLog.push({ x, y, w, h, style: ctx.fillStyle, alpha: ctx.globalAlpha });
    },
    stroke() { ops.stroke++; total.stroke++; },
    fill() { ops.fill++; total.fill++; },
    clearRect() {}, save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
    setTransform() {}, resetTransform() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, arc() {}, rect() {}, strokeRect() {}, clip() {},
    createLinearGradient() {
      total.linearGrad++;
      return { addColorStop() {} };
    },
    createRadialGradient() {
      total.radialGrad++;
      return { addColorStop() {} };
    }
  };
  return ctx;
}

let canvasCreations = 0;
class FakeCanvas {
  constructor(w = 300, h = 150) {
    this.width = w; this.height = h; this._ctx = null; this.img = null;
    canvasCreations++;
  }
  getContext() {
    if (!this._ctx) this._ctx = makeCtx(this);
    return this._ctx;
  }
}

globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error('意外元素: ' + tag);
    return new FakeCanvas();
  }
};
globalThis.localStorage = {
  _v: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._v, k) ? this._v[k] : null; },
  setItem(k, v) { this._v[k] = String(v); },
  removeItem(k) { delete this._v[k]; }
};

// ---------- 事件总线 / CONFIG / CORE stub（形状照 CONTRACT-V2 §1 §2 §3 §7 §8） ----------
const bus = {
  log: [],
  _subs: new Map(),
  on(type, fn) {
    const a = this._subs.get(type) || [];
    a.push(fn);
    this._subs.set(type, a);
    return () => this.off(type, fn);
  },
  off(type, fn) {
    const a = this._subs.get(type);
    if (!a) return;
    const i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  },
  emit(type, data) {
    this.log.push({ type, data });
    const a = this._subs.get(type);
    if (!a) return;
    for (const fn of a.slice()) fn(data);
  }
};

const CONFIG = {
  version: 4,
  ores: {
    stone: { id: 'stone', name: '石头', hp: 3, price: 1, drop: [1, 2], richDrop: [3, 6], color: '#7d7d7d', vein: '#5a5a5a' },
    coal: { id: 'coal', name: '煤矿', hp: 1, price: 6, drop: [1, 2], richDrop: [3, 6], color: '#7d7d7d', vein: '#171717' },
    iron: { id: 'iron', name: '铁矿', hp: 4, price: 40, drop: [1, 3], richDrop: [3, 9], color: '#7d7d7d', vein: '#d8b98a' },
    crystal: { id: 'crystal', name: '晶石', hp: 40, price: 400, drop: [2, 2], richDrop: [4, 4], color: '#4a3f5c', vein: '#6fd8e0' },
    gold: { id: 'gold', name: '金矿', hp: 24, price: 150, drop: [1, 1], richDrop: [2, 2], color: '#c8912e', vein: '#ffc857' }
  },
  // v3：layerCap 抬到 12，晶洞层 10–12 才不被削平
  tuning: { layerMin: 6, layerMax: 8, layerCap: 12, extraLayersCap: 6 },
  // v4 §4：zones[].ores[].hp 按关覆盖全局 CONFIG.ores[].hp（BALANCE-V4 血量表）
  // v4 §7：zones[].veins = [min,max] 矿脉条数区间（缺字段 → GRID 默认 2–4）
  zones: [
    {
      id: 'quarry', name: '采石场', coinBase: 1, timeSec: 60, cols: 6, rows: 8, filler: 'stone',
      layerMin: 6, layerMax: 8,
      ores: [{ ore: 'stone', weight: 80, richRate: 0.08, hp: 3 }, { ore: 'coal', weight: 20, richRate: 0.12, hp: 2 }]
    },
    {
      id: 'ironmine', name: '铁矿层', coinBase: 6, timeSec: 60, cols: 6, rows: 8, filler: 'coal',
      layerMin: 8, layerMax: 10, veins: [3, 5],
      ores: [{ ore: 'coal', weight: 65, richRate: 0.10, hp: 14 }, { ore: 'iron', weight: 35, richRate: 0.14, hp: 42 }]
    },
    {
      id: 'crystalcave', name: '晶洞层', coinBase: 40, timeSec: 60, cols: 6, rows: 8, filler: 'iron',
      layerMin: 10, layerMax: 12, veins: [2, 4],
      ores: [{ ore: 'iron', weight: 70, richRate: 0.10, hp: 120 }, { ore: 'crystal', weight: 30, richRate: 0.12, hp: 240 }]
    },
    // 第 5 关 starCave 的权重形状（晶石 75 / 铁 25，filler=iron）：v12 矿脉容量放大的主战场
    {
      id: 'starCave', name: '星辉晶洞', coinBase: 1, timeSec: 60, cols: 6, rows: 8, filler: 'iron',
      layerMin: 6, layerMax: 8,
      ores: [{ ore: 'crystal', weight: 75, richRate: 0.20, hp: 58 }, { ore: 'iron', weight: 25, richRate: 0.15, hp: 58 }]
    }
  ]
};

const CRYSTALCAVE = CONFIG.zones[2];

let MODS = {};
globalThis.BM = {
  bus,
  CONFIG,
  CORE: { mods() { return MODS; } },
  BOARD: { x: 10, y: 96, w: 370, h: 636 }
};

vm.runInThisContext(code, { filename: SRC });
const GRID = globalThis.BM.GRID;
const MAIN = makeCtx('main');
const QUARRY = CONFIG.zones[0];
const IRONMINE = CONFIG.zones[1];
const BLOCKS = 48;

function setMods(m) { MODS = m || {}; }
function events(type) { return bus.log.filter((e) => e.type === type); }
function lastEvent(type) { const l = events(type); return l.length ? l[l.length - 1] : null; }
function settle(n = 40) { for (let i = 0; i < n; i++) GRID.update(0.1); }

// zone.ores[].hp 按关覆盖；缺字段回落 CONFIG.ores[].hp（v4 §4）
function zoneHp(zone, oreId) {
  const e = (zone.ores || []).find((o) => o.ore === oreId);
  return e && typeof e.hp === 'number' ? e.hp : CONFIG.ores[oreId].hp;
}

// 顶层矿种的 4 邻接连通块 = 一条矿脉（矿脉之间不相邻，块数就是矿脉条数）
function veinComponents(zone, oreId) {
  const cols = zone.cols, rows = zone.rows;
  const at = (x, y) => (x >= 0 && y >= 0 && x < cols && y < rows) ? GRID.blocks[y][x] : null;
  const seen = new Set(), out = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const b = at(x, y);
      if (!b || b.ore !== oreId || seen.has(x + ',' + y)) continue;
      const st = [[x, y]], cells = [];
      seen.add(x + ',' + y);
      while (st.length) {
        const [cx, cy] = st.pop();
        cells.push({ x: cx, y: cy, b: at(cx, cy) });
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy, nb = at(nx, ny);
          if (!nb || nb.ore !== oreId || seen.has(nx + ',' + ny)) continue;
          seen.add(nx + ',' + ny);
          st.push([nx, ny]);
        }
      }
      out.push(cells);
    }
  }
  return out;
}

// 采样纹理的 16×16 逻辑像素（预渲染是 TEX_SCALE=6 的最近邻放大）
function px(canvas, lx, ly) {
  const side = canvas.width;
  const sx = lx * 6 + 3, sy = ly * 6 + 3;
  const o = (sy * side + sx) * 4;
  const d = canvas.img.data;
  return [d[o], d[o + 1], d[o + 2]];
}
function countColor(canvas, rgb) {
  let n = 0;
  for (let y = 1; y < 15; y++) {
    for (let x = 1; x < 15; x++) {
      const c = px(canvas, x, y);
      if (c[0] === rgb[0] && c[1] === rgb[1] && c[2] === rgb[2]) n++;
    }
  }
  return n;
}

// ---------- 1. 模块与契约 API ----------
section('1) 模块挂载与契约 API');
ok(!!GRID, 'BM.GRID 已挂载');
for (const k of ['init', 'build', 'at', 'damage', 'damageLayers', 'isEmpty', 'aliveCells',
                 'neighbors', 'richCells', 'update', 'draw', 'clear']) {
  eq(typeof GRID[k], 'function', 'API ' + k + ' 是函数');
}
ok(Array.isArray(GRID.blocks) && Array.isArray(GRID.flat), 'blocks / flat 是数组');

// ---------- 2. init：方块风贴图预渲染 ----------
section('2) init()：每 ore × {普通,富矿} × 4 seed 变体，一次性预渲染');
setMods({});
GRID.init(MAIN);
eq(canvasCreations, 41, 'init 生成 5 ore × 2 × 4 = 40 张纹理 + 1 张富矿光晕');
eq(total.radialGrad, 1, '只有光晕用了 1 次径向渐变（贴图内零渐变）');
eq(total.linearGrad, 0, '没有线性渐变');
eq(total.putImageData, 40, '像素数据只在 init 写入 40 次');

const ALL_ORES = ['stone', 'coal', 'iron', 'gold', 'crystal'];
const sigs = [];
let texCount = 0;
for (const ore of ALL_ORES) {
  const sets = GRID._tex[ore];
  ok(!!sets, ore + ' 有纹理表');
  for (const idx of [0, 1]) {
    eq(sets[idx].length, 4, ore + (idx ? ' 富矿' : ' 普通') + ' 变体数 = 4');
    for (const cv of sets[idx]) {
      texCount++;
      eq(cv.width, 96, '纹理边长 = 16×6');
      ok(cv.img !== null && cv.img.width === 96, '纹理来自 16×16 逻辑像素的最近邻放大');
    }
    for (const s of GRID._texSig[ore][idx]) sigs.push(s);
  }
}
eq(texCount, 40, '纹理总数 40');
eq(new Set(sigs).size, 40, '40 张纹理像素签名互不相同');

// 贴图规矩：16×16 逻辑像素 + #2a2a2a 外框 + 1px 内斜角 + 无渐变
section('2b) 贴图规矩：外框描边 / 内斜角 / 石底灰阶 / 矿斑配色');
let borderOk = true, borderSample = null;
for (const ore of ALL_ORES) {
  for (const idx of [0, 1]) {
    for (const cv of GRID._tex[ore][idx]) {
      for (let i = 0; i < 16; i++) {
        for (const p of [[i, 0], [i, 15], [0, i], [15, i]]) {
          const c = px(cv, p[0], p[1]);
          if (c[0] !== 42 || c[1] !== 42 || c[2] !== 42) {
            borderOk = false;
            borderSample = ore + '/' + p.join(',') + ' → ' + c.join(',');
          }
        }
      }
    }
  }
}
ok(borderOk, '全部纹理块边是 1px #2a2a2a 外框', borderSample);

// 内斜角：左上 #a0a0a0 / 右下 #4a4a4a（普通变体），方块贴图的立体感来源
let bevelOk = true, bevelSample = null;
for (const ore of ALL_ORES) {
  for (const cv of GRID._tex[ore][0]) {
    for (let i = 1; i < 15; i++) {
      for (const p of [[i, 1], [1, i]]) {
        const c = px(cv, p[0], p[1]);
        if (c[0] !== 160 || c[1] !== 160 || c[2] !== 160) {
          bevelOk = false; bevelSample = ore + ' 亮侧 ' + p.join(',') + ' → ' + c.join(',');
        }
      }
      if (i === 1) continue;                       // 左上角归亮侧
      for (const p of [[i, 14], [14, i]]) {
        const c = px(cv, p[0], p[1]);
        if (c[0] !== 74 || c[1] !== 74 || c[2] !== 74) {
          bevelOk = false; bevelSample = ore + ' 暗侧 ' + p.join(',') + ' → ' + c.join(',');
        }
      }
    }
  }
}
ok(bevelOk, '每块有 1px 内斜角：左上 #a0a0a0 / 右下 #4a4a4a', bevelSample);

// 富矿格：同结构金边（亮金 #e8cc60 / 暗金 #a67c28），外框仍是 #2a2a2a
let goldOk = true, goldSample = null;
for (const ore of ALL_ORES) {
  for (const cv of GRID._tex[ore][1]) {
    const hi = px(cv, 6, 1), lo = px(cv, 6, 14);
    if (hi[0] !== 232 || hi[1] !== 204 || hi[2] !== 96) { goldOk = false; goldSample = ore + ' 亮侧 ' + hi.join(','); }
    if (lo[0] !== 166 || lo[1] !== 124 || lo[2] !== 40) { goldOk = false; goldSample = ore + ' 暗侧 ' + lo.join(','); }
  }
}
ok(goldOk, '富矿格是金边（外框仍是 #2a2a2a）', goldSample);

// 石底：灰阶全落在 #6e6e6e–#8c8c8c（团块 #555 / 亮斑 #9a9a9a / 斜角 #a0a0a0 #4a4a4a 除外）
const FEATURE_GRAY = new Set([74, 85, 154, 160]);
const stoneCv = GRID._tex.stone[0][0];
const grays = new Set();
let baseOk = true, baseSample = null;
for (let y = 1; y < 15; y++) {
  for (let x = 1; x < 15; x++) {
    const c = px(stoneCv, x, y);
    if (c[0] !== c[1] || c[1] !== c[2]) continue;
    grays.add(c[0]);
    if (!FEATURE_GRAY.has(c[0]) && (c[0] < 110 || c[0] > 140)) {
      baseOk = false; baseSample = x + ',' + y + ' → ' + c.join(',');
    }
  }
}
ok(baseOk, '石底灰阶全在 #6e6e6e–#8c8c8c 抖动区间', baseSample);
ok(grays.size >= 6 && grays.size <= 40, '石底是离散灰阶噪声（无插值中间值）', 'distinct=' + grays.size);

// 石头：2–3 个明显深灰团块 #555 + 少量亮斑 #9a9a9a，远看才像石头而不是水泥
let stoneClump = 0, stoneSpeck = 0;
for (const cv of GRID._tex.stone[0]) {
  stoneClump += countColor(cv, [85, 85, 85]);
  stoneSpeck += countColor(cv, [154, 154, 154]);
}
ok(stoneClump >= 24, '石头有 2–3 个明显深灰团块 #555', 'px=' + stoneClump);
ok(stoneSpeck >= 6, '石头掺少量亮斑 #9a9a9a', 'px=' + stoneSpeck);

// 4 邻域连通块：查「碎渣」用
function comps(cv, rgb) {
  const seen = new Uint8Array(16 * 16);
  const at = (x, y) => {
    if (x < 1 || y < 1 || x > 14 || y > 14) return false;
    const c = px(cv, x, y);
    return c[0] === rgb[0] && c[1] === rgb[1] && c[2] === rgb[2];
  };
  const out = [];
  for (let y = 1; y <= 14; y++) {
    for (let x = 1; x <= 14; x++) {
      if (seen[y * 16 + x] || !at(x, y)) continue;
      let n = 0;
      const st = [[x, y]];
      seen[y * 16 + x] = 1;
      while (st.length) {
        const [cx, cy] = st.pop();
        n++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (seen[ny * 16 + nx] || !at(nx, ny)) continue;
          seen[ny * 16 + nx] = 1;
          st.push([nx, ny]);
        }
      }
      out.push(n);
    }
  }
  return out;
}

// 煤矿：#121212 大黑团占 25–35% 面积、4–6 团/张、边缘不碎渣、1–2 个 #3a3a3a 高光点
function coalCover(cv) { return countColor(cv, [18, 18, 18]) / 196; }
const coalNormal = GRID._tex.coal[0].map(coalCover);
const coalRich = GRID._tex.coal[1].map(coalCover);
const coalAvg = (arr) => arr.reduce((x, y) => x + y, 0) / arr.length;
ok(coalNormal.every((v) => v >= 0.25 && v <= 0.35), '煤矿黑斑 #121212 占 25–35% 面积',
  coalNormal.map((v) => (v * 100).toFixed(1) + '%').join(' / '));
ok(coalAvg(coalRich) > coalAvg(coalNormal), '富矿煤矿斑更密（富矿格仍是更密的矿斑）',
  coalAvg(coalNormal).toFixed(3) + ' → ' + coalAvg(coalRich).toFixed(3));
let coalDarkPx = 0, coalHiPx = 0;
for (const idx of [0, 1]) for (const cv of GRID._tex.coal[idx]) {
  coalDarkPx += countColor(cv, [18, 18, 18]);
  coalHiPx += countColor(cv, [58, 58, 58]);
}
ok(coalDarkPx >= 40, '煤矿是纯黑斑块 #121212', 'px=' + coalDarkPx);
ok(coalHiPx >= 4 && coalHiPx < coalDarkPx, '煤矿有少量 #3a3a3a 高光点', 'px=' + coalHiPx);
const coalComps = GRID._tex.coal[0].flatMap((cv) => comps(cv, [18, 18, 18]));
ok(coalComps.every((n) => n >= 10), '煤矿黑斑是成团的块，边缘不碎成渣',
  'min=' + Math.min(...coalComps));
ok(coalComps.length >= 8 && coalComps.length <= 24, '4–6 个大块/张（相邻团块可连成一块）',
  'comps=' + coalComps.length + ' sizes=' + coalComps.join(','));

// 铁矿：3–5 个米褐团 #d8b98a，下缘是 #a9855c 暗边
let ironBody = 0, ironEdge = 0;
for (const idx of [0, 1]) for (const cv of GRID._tex.iron[idx]) {
  ironBody += countColor(cv, [216, 185, 138]);
  ironEdge += countColor(cv, [169, 133, 92]);
}
ok(ironBody >= 40, '铁矿是米褐斑块 #d8b98a', 'px=' + ironBody);
ok(ironEdge >= 8, '铁矿斑块带暗边 #a9855c', 'px=' + ironEdge);
const ironComps = GRID._tex.iron[0].flatMap((cv) => comps(cv, [216, 185, 138]));
ok(ironComps.every((n) => n >= 3), '铁矿团斑不成噪点', 'min=' + Math.min(...ironComps));
ok(ironComps.length >= 12 && ironComps.length <= 24, '每张 3–5 个米褐团', 'comps=' + ironComps.length);
const isBody = (c) => c[0] === 216 && c[1] === 185 && c[2] === 138;
const isEdge = (c) => c[0] === 169 && c[1] === 133 && c[2] === 92;
let rimMiss = 0, rimSample = null;
for (const cv of GRID._tex.iron[0]) {
  for (let y = 2; y <= 12; y++) {
    for (let x = 2; x <= 13; x++) {
      if (!isBody(px(cv, x, y))) continue;
      const below = px(cv, x, y + 1);
      if (isBody(below) || isEdge(below)) continue;
      rimMiss++; rimSample = x + ',' + y;    // 团块下缘直接贴石底 = 缺暗边
    }
  }
}
eq(rimMiss, 0, '铁矿团斑下缘一律描 #a9855c 暗边' + (rimSample ? ' @' + rimSample : ''));

// 不规则斑块 ≠ 斜切长脉：统计单行最长同色连续段
function maxRun(cv, rgb) {
  let best = 0;
  for (let y = 1; y < 15; y++) {
    let run = 0;
    for (let x = 1; x < 15; x++) {
      const c = px(cv, x, y);
      if (c[0] === rgb[0] && c[1] === rgb[1] && c[2] === rgb[2]) { run++; if (run > best) best = run; }
      else run = 0;
    }
  }
  return best;
}
let maxIronRun = 0;
for (const idx of [0, 1]) for (const cv of GRID._tex.iron[idx]) maxIronRun = Math.max(maxIronRun, maxRun(cv, [216, 185, 138]));
ok(maxIronRun <= 8, '矿斑是团块不是横贯长脉', 'maxRowRun=' + maxIronRun);

// 晶石：偏紫深岩底 #4a3f5c + 紫青晶体团（亮心 #a8e8ff / 主色 #6fd8e0 / 暗边 #2f6f7a）
section('2c) 晶石 crystal：偏紫深岩底 + 紫青发光晶体团（硬像素、锐利边缘）');
const CRYS_BODY = [111, 216, 224];
const CRYS_CORE = [168, 232, 255];
const CRYS_EDGE = [47, 111, 122];
ok(!!GRID._tex.crystal, 'crystal 有纹理表');
eq(GRID._tex.crystal[0].length, 4, 'crystal 普通变体数 = 4');
eq(GRID._tex.crystal[1].length, 4, 'crystal 富矿变体数 = 4');

let cryBody = 0, cryCore = 0, cryEdge = 0;
for (const idx of [0, 1]) for (const cv of GRID._tex.crystal[idx]) {
  cryBody += countColor(cv, CRYS_BODY);
  cryCore += countColor(cv, CRYS_CORE);
  cryEdge += countColor(cv, CRYS_EDGE);
}
ok(cryBody >= 100, '晶石有紫青主色 #6fd8e0 晶体团', 'px=' + cryBody);
ok(cryCore >= 8, '晶体团内有亮心 #a8e8ff', 'px=' + cryCore);
ok(cryEdge >= 40, '晶体团有暗边 #2f6f7a', 'px=' + cryEdge);
ok(cryCore < cryBody, '亮心比主色克制（亮点，不是整团发亮）', cryCore + ' < ' + cryBody);
ok(cryEdge * 4 >= cryBody, '暗边足够厚：边缘是硬边而不是软过渡', cryEdge + ' vs ' + cryBody);

// 石底是「同一组离散偏移量加到偏紫深岩上」→ 通道差恒定（r-g=11 / b-r=18），插值渐变会破坏它
const FEATURE_RGB = new Set([
  '42,42,42', '160,160,160', '74,74,74', '85,85,85', '154,154,154',
  '232,204,96', '166,124,40', '196,196,196',
  CRYS_BODY.join(','), CRYS_CORE.join(','), CRYS_EDGE.join(',')
]);
let purplePx = 0, purpleBad = 0, purpleSample = null, purpleSum = [0, 0, 0];
for (const cv of GRID._tex.crystal[0]) {
  for (let y = 1; y < 15; y++) {
    for (let x = 1; x < 15; x++) {
      const c = px(cv, x, y);
      if (FEATURE_RGB.has(c.join(','))) continue;
      if (c[0] - c[1] === 11 && c[2] - c[0] === 18) {
        purplePx++;
        purpleSum[0] += c[0]; purpleSum[1] += c[1]; purpleSum[2] += c[2];
      } else {
        purpleBad++; purpleSample = x + ',' + y + ' → ' + c.join(',');
      }
    }
  }
}
ok(purpleBad === 0, '晶石石底是离散偏紫深岩（通道差恒定，无插值渐变）', purpleSample);
ok(purplePx >= 120, '晶石石底占了画面主体（不是把底色刷掉）', 'px=' + purplePx);
const purpleAvg = [0, 1, 2].map((k) => purpleSum[k] / (purplePx || 1));
ok(Math.abs(purpleAvg[0] - 74) <= 6 && Math.abs(purpleAvg[1] - 63) <= 6 && Math.abs(purpleAvg[2] - 92) <= 6,
  '石底均值贴近 #4a3f5c(74,63,92)', purpleAvg.map((v) => v.toFixed(1)).join(','));

// 锐利边缘：晶体团主体四周一律描暗边，不许直接贴石底（软边/发光会漏底色）
const isRgb = (c, rgb) => c[0] === rgb[0] && c[1] === rgb[1] && c[2] === rgb[2];
let cryBleed = 0, cryBleedSample = null;
for (const cv of GRID._tex.crystal[0]) {
  for (let y = 2; y <= 13; y++) {
    for (let x = 2; x <= 13; x++) {
      if (!isRgb(px(cv, x, y), CRYS_BODY)) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = px(cv, x + dx, y + dy);
        if (isRgb(c, CRYS_BODY) || isRgb(c, CRYS_EDGE) || isRgb(c, CRYS_CORE)) continue;
        cryBleed++; cryBleedSample = x + ',' + y + ' 邻 ' + (x + dx) + ',' + (y + dy) + ' → ' + c.join(',');
      }
    }
  }
}
eq(cryBleed, 0, '晶体团主体四周 1px 锐利暗边（不直接贴石底）' + (cryBleedSample ? ' @' + cryBleedSample : ''));

// 晶体感：亮心只出现在晶体团内部，不会漂到石底上
let coreOnBase = 0;
for (const cv of GRID._tex.crystal[0]) {
  for (let y = 1; y < 15; y++) {
    for (let x = 1; x < 15; x++) {
      if (!isRgb(px(cv, x, y), CRYS_CORE)) continue;
      let bodyNear = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (isRgb(px(cv, x + dx, y + dy), CRYS_BODY) || isRgb(px(cv, x + dx, y + dy), CRYS_CORE)) bodyNear = true;
      }
      if (!bodyNear) coreOnBase++;
    }
  }
}
eq(coreOnBase, 0, '亮心都被晶体团包住（不是浮在石底上的发光点）');
ok(GRID._texSig.crystal[0][0] !== GRID._texSig.stone[0][0], 'crystal 与 stone 像素签名不同（一眼能区分）');

// ---------- 3. build：48 格 + 层数 + 权重 ----------
section('3) build()：6×8 = 48 格、纵向堆叠 6–8 层、矿种权重');
setMods({});
GRID.build('quarry');
eq(GRID.blocks.length, 8, '8 行');
eq(GRID.blocks[0].length, 6, '6 列');
eq(GRID.flat.length, BLOCKS, 'flat = 48 格');
const b0 = GRID.flat[0];
for (const k of ['ox', 'oy', 'x', 'y', 's', 'ore', 'hp', 'maxHp', 'rich', 'depth', 'layers',
                 'totalLayers', 'broken', 'crack', 'hitT', 'hitDir', 'seed', 'appearT']) {
  ok(Object.prototype.hasOwnProperty.call(b0, k), '矿块字段 ' + k);
}
eq(b0.depth, 0, '开局 depth = 0');
ok(b0.layers === b0.totalLayers && b0.totalLayers >= 6 && b0.totalLayers <= 8,
  'totalLayers 在 6..8 且 layers = totalLayers', 'layers=' + b0.layers);
ok(GRID.flat.every((b) => b.totalLayers >= 6 && b.totalLayers <= 8), '全盘 totalLayers 都在 6..8');
ok(GRID.flat.every((b) => b.stack && b.stack.length === b.totalLayers), '每格有等长 stack');
ok(GRID.flat.every((b) => b.s === GRID.flat[0].s && Number.isInteger(b.x) && Number.isInteger(b.y)),
  '格边长为整数、坐标取整（像素对齐）');
ok(GRID.flat.every((b) => b.hp === b.maxHp && b.hp === zoneHp(QUARRY, b.ore)), 'hp / maxHp 取自 zone.ores[].hp（按关覆盖）');
eq(GRID.isEmpty(), false, '开局未挖空 isEmpty = false');
eq(GRID.aliveCells(), BLOCKS, '开局 aliveCells = 48');

let stoneN = 0, coalN = 0, richN = 0;
const ROUNDS = 200;
for (let i = 0; i < ROUNDS; i++) {
  GRID.build('quarry');
  for (const b of GRID.flat) {
    if (b.ore === 'stone') stoneN++; else if (b.ore === 'coal') coalN++;
    if (b.rich) richN++;
  }
}
const coalShare = coalN / (ROUNDS * BLOCKS);
near(coalShare, 0.20, 0.02, '采石场煤矿占比 ≈ 权重 20/100');
near(stoneN / (ROUNDS * BLOCKS), 0.80, 0.02, '采石场石头占比 ≈ 权重 80/100');
near(richN / (ROUNDS * BLOCKS), 0.088, 0.015, '富矿率 ≈ 0.8×0.08 + 0.2×0.12 = 0.088');

let coal2 = 0, iron2 = 0;
for (let i = 0; i < ROUNDS; i++) {
  GRID.build('ironmine');
  for (const b of GRID.flat) { if (b.ore === 'coal') coal2++; else if (b.ore === 'iron') iron2++; }
}
near(iron2 / (ROUNDS * BLOCKS), 0.35, 0.02, '铁矿层铁矿占比 ≈ 权重 35/100');
near(coal2 / (ROUNDS * BLOCKS), 0.65, 0.02, '铁矿层煤矿占比 ≈ 权重 65/100');
ok(GRID.flat.every((b) => b.ore === 'coal' || b.ore === 'iron'), '铁矿层不引入新矿种');

// 天赋 oreRateBonus：只压低石头权重 → 矿石占比提升
setMods({ oreRateBonus: 0.06 });
let coal3 = 0, stone3 = 0;
for (let i = 0; i < ROUNDS; i++) {
  GRID.build('quarry');
  for (const b of GRID.flat) { if (b.ore === 'coal') coal3++; else if (b.ore === 'stone') stone3++; }
}
near(coal3 / (ROUNDS * BLOCKS), 0.26, 0.02, 'oreRateBonus=+6pp 后矿石占比 ≈ 0.26');
near(stone3 / (ROUNDS * BLOCKS), 0.74, 0.02, '石头占比相应降到 ≈ 0.74');
setMods({ oreRateBonus: 0 });
let coal4 = 0;
for (let i = 0; i < ROUNDS; i++) {
  GRID.build('quarry');
  for (const b of GRID.flat) if (b.ore === 'coal') coal4++;
}
near(coal4 / (ROUNDS * BLOCKS), 0.20, 0.02, 'oreRateBonus=0 时回到 0.20（不叠加）');

// 铁矿层的填充矿是 coal：同一份天赋压低 coal，铁矿占比提升
setMods({ oreRateBonus: 0.06 });
let iron3 = 0, coal5 = 0;
for (let i = 0; i < ROUNDS; i++) {
  GRID.build('ironmine');
  for (const b of GRID.flat) { if (b.ore === 'iron') iron3++; else if (b.ore === 'coal') coal5++; }
}
near(iron3 / (ROUNDS * BLOCKS), 0.41, 0.02, '按 zone.filler=coal 压低填充矿 → 铁矿占比 ≈ 0.41');
near(coal5 / (ROUNDS * BLOCKS), 0.59, 0.02, '煤矿占比降到 ≈ 0.59');
setMods({});

/* ---------- 3c. 珍贵矿石占比链（v11 满链 +12pp）：权重表 + 实测占比 + 下限/夹紧 ---------- */
section('3c) 珍贵矿石占比链：满链 +12pp（石 80 → 42.5）/ 填充矿权重下限 8 / 超界值夹到 0.25');
const wOf = (pl, ore) => (pl.list.find((e) => e.ore === ore) || {}).w;
const basePl = GRID._pickList(QUARRY.ores, 0, QUARRY.filler);
const fullPl = GRID._pickList(QUARRY.ores, 0.12, QUARRY.filler);
eq(wOf(basePl, 'stone'), 80, '基准：石权重 = zone 权重 80');
eq(wOf(basePl, 'coal'), 20, '基准：煤权重 = zone 权重 20');
near(wOf(fullPl, 'stone'), 42.5, 1e-6, '满链：填充矿权重按份额换算压到 42.5（不是 0）');
near(wOf(fullPl, 'coal') / fullPl.total, 0.32, 1e-6, '满链：煤份额 = 0.20 + 12pp = 0.32');
ok(wOf(fullPl, 'stone') >= GRID._fillerMinW, '填充矿权重 ≥ 下限 ' + GRID._fillerMinW);
eq(GRID._fillerMinW, 8, '权重下限 = 8（绝对下限）');
eq(GRID._oreBonusCap, 0.25, 'oreRateBonus 上限 = 0.25（与 02-core 的 clampMods 同值）');

setMods({ oreRateBonus: 0.12 });
let coal6 = 0, stone6 = 0;
for (let i = 0; i < ROUNDS; i++) {
  GRID.build('quarry');
  for (const b of GRID.flat) { if (b.ore === 'coal') coal6++; else if (b.ore === 'stone') stone6++; }
}
near(coal6 / (ROUNDS * BLOCKS), 0.32, 0.02, '实测：满链 +12pp → 第 1 关煤占比 0.20 → 0.32');
near(stone6 / (ROUNDS * BLOCKS), 0.68, 0.02, '实测：填充矿（石）占比同步降到 0.68');
ok(stone6 > 0, '满链下石格仍然存在（权重没有被压没）');

// 填充矿本来就轻的关：份额换算会把它压到 0，下限必须兜住
const lightZone = [{ ore: 'stone', weight: 6, richRate: 0.05 }, { ore: 'crystal', weight: 94, richRate: 0.2 }];
const lightPl = GRID._pickList(lightZone, 0.25, 'stone');
eq(wOf(lightPl, 'stone'), GRID._fillerMinW, '轻填充矿（6）+ 0.25 → 权重被抬回下限 8，不是 0 / 负数');
ok(wOf(lightPl, 'stone') > 0 && lightPl.total > wOf(lightPl, 'stone'), '下限之后石头仍存在、也不是全盘唯一矿种');
GRID.build({ cols: 6, rows: 8, filler: 'stone', ores: lightZone });
ok(GRID.flat.some((b) => b.ore === 'stone'), '轻填充矿 + 满额加成：盘面上仍有填充矿格子');

// 超界值 0.5：core 侧夹在 0.25，grid 侧再夹一次（直接注入超界值验证第二道）
setMods({ oreRateBonus: 0.5 });
let coal7 = 0, stone7 = 0;
for (let i = 0; i < ROUNDS; i++) {
  GRID.build('quarry');
  for (const b of GRID.flat) { if (b.ore === 'coal') coal7++; else if (b.ore === 'stone') stone7++; }
}
// v12 起矿脉容量随 oreRateBonus 放大（5–9 格 × 4 条 = 36 格），盘面占比不再被旧容量（20 格）卡住：
// 0.25 的份额 = 0.45 会直接落到盘面上（旧容量下只有 0.417），精确份额仍由上面的权重表钉死。
near(coal7 / (ROUNDS * BLOCKS), 0.45, 0.02,
  '实测：0.5 超界 → 夹到 0.25 → 煤占比 ≈ 0.45（矿脉容量放大后份额直接落到盘面，不再被 0.417 卡住）');
ok(coal7 / (ROUNDS * BLOCKS) > 20 / BLOCKS,
  '实测：0.25 档煤占比超过旧的矿脉容量封顶 20/48 = 0.417（' + (coal7 / (ROUNDS * BLOCKS)).toFixed(3) + '）');
near(stone7 / (ROUNDS * BLOCKS), 0.55, 0.02,
  '实测：0.5 超界 → 石占比 ≈ 0.55（0.25 的份额，远不到 0.5 的份额）');
eq(JSON.stringify(GRID._pickList(QUARRY.ores, 0.5, QUARRY.filler).list),
  JSON.stringify(GRID._pickList(QUARRY.ores, 0.25, QUARRY.filler).list),
  'grid 侧把 0.5 夹成 0.25（权重表与 0.25 完全一致）');
setMods({});


// tuning 驱动层数上下限（zone 不带 layerMin/layerMax 时才用 tuning）
const noLayerFields = (zone) => {
  const c = Object.assign({}, zone);
  delete c.layerMin; delete c.layerMax;
  return c;
};
CONFIG.tuning.layerMin = 7; CONFIG.tuning.layerMax = 7;
GRID.build(noLayerFields(QUARRY));
ok(GRID.flat.every((b) => b.totalLayers === 7), 'zone 缺层数字段 + tuning.layerMin=layerMax=7 → 每格 7 层');
CONFIG.tuning.layerMin = 6; CONFIG.tuning.layerMax = 8;
GRID.build(noLayerFields(QUARRY));
ok(GRID.flat.every((b) => b.totalLayers >= 6 && b.totalLayers <= 8), 'tuning 复原后回到 6..8');

// extraLayers：每格层数 +N，上限 tuning.layerCap
setMods({ extraLayers: 2 });
GRID.build('quarry');
ok(GRID.flat.every((b) => b.totalLayers >= 8 && b.totalLayers <= 10), 'extraLayers=2 → 8..10 层',
  'layers=' + GRID.flat[0].totalLayers);
setMods({ extraLayers: 10 });
GRID.build('quarry');
ok(GRID.flat.every((b) => b.totalLayers === CONFIG.tuning.layerCap),
  '层数上限 = tuning.layerCap（' + CONFIG.tuning.layerCap + '）');
setMods({});

// ---------- 3b. zone 层数：zone.layerMin/layerMax 优先，缺字段回落 tuning ----------
section('3b) 三关层数：zone.layerMin/layerMax 优先（6–8 / 8–10 / 10–12），缺字段回落 tuning');
setMods({});
const ZONE_LAYERS = { quarry: [6, 8], ironmine: [8, 10], crystalcave: [10, 12] };
for (const zoneId of Object.keys(ZONE_LAYERS)) {
  const [lo, hi] = ZONE_LAYERS[zoneId];
  const seen = new Map();
  let inRange = true, minSeen = 99, maxSeen = 0;
  for (let i = 0; i < 40; i++) {
    GRID.build(zoneId);
    for (const b of GRID.flat) {
      const n = b.totalLayers;
      seen.set(n, (seen.get(n) || 0) + 1);
      if (n < lo || n > hi) inRange = false;
      if (n < minSeen) minSeen = n;
      if (n > maxSeen) maxSeen = n;
    }
  }
  ok(inRange, zoneId + ' 每格层数落在 zone 配置的 ' + lo + '–' + hi,
    'min=' + minSeen + ' max=' + maxSeen + ' seen=' + [...seen.keys()].sort((a, b) => a - b).join('/'));
  ok(minSeen === lo && maxSeen === hi, zoneId + ' 覆盖 ' + lo + '–' + hi + ' 全区间',
    'seen=' + [...seen.keys()].sort((a, b) => a - b).join('/'));
}

// zone 缺字段 → 回落 tuning（同一次 build 内按字段回落，不整体作废）
GRID.build(noLayerFields(IRONMINE));
ok(GRID.flat.every((b) => b.totalLayers >= 6 && b.totalLayers <= 8),
  'zone 缺 layerMin/layerMax → 回落 tuning 6..8（不是铁矿山层的 8..10）',
  'layers=' + [...new Set(GRID.flat.map((b) => b.totalLayers))].sort((a, b) => a - b).join('/'));
GRID.build(Object.assign(noLayerFields(IRONMINE), { layerMin: 7 }));
ok(GRID.flat.every((b) => b.totalLayers >= 7 && b.totalLayers <= 8),
  '只给 zone.layerMin=7 → 7..8（layerMax 回落 tuning）',
  'layers=' + [...new Set(GRID.flat.map((b) => b.totalLayers))].sort((a, b) => a - b).join('/'));
GRID.build(Object.assign(noLayerFields(QUARRY), { layerMax: 5 }));
ok(GRID.flat.every((b) => b.totalLayers >= 5 && b.totalLayers <= 6),
  '只给 zone.layerMax=5（< tuning.layerMin）→ 夹到 min..max 有序',
  'layers=' + [...new Set(GRID.flat.map((b) => b.totalLayers))].sort((a, b) => a - b).join('/'));

// 上限仍归 tuning.layerCap：cap=11 时晶洞层最高 11，12 层被削平
CONFIG.tuning.layerCap = 11;
GRID.build('crystalcave');
ok(GRID.flat.every((b) => b.totalLayers >= 10 && b.totalLayers <= 11), 'tuning.layerCap=11 时晶洞层夹到 10..11',
  'layers=' + [...new Set(GRID.flat.map((b) => b.totalLayers))].sort((a, b) => a - b).join('/'));
CONFIG.tuning.layerCap = 12;
GRID.build('crystalcave');
ok(GRID.flat.every((b) => b.totalLayers >= 10 && b.totalLayers <= 12), 'cap 复原后晶洞层回到 10..12',
  'layers=' + [...new Set(GRID.flat.map((b) => b.totalLayers))].sort((a, b) => a - b).join('/'));

// extraLayers 叠加在同一 zone 层数上，再受 cap 约束
setMods({ extraLayers: 2 });
GRID.build('crystalcave');
ok(GRID.flat.every((b) => b.totalLayers === 12), '晶洞层 + extraLayers=2 → 全部顶到 cap 12',
  'layers=' + [...new Set(GRID.flat.map((b) => b.totalLayers))].join('/'));
setMods({});
GRID.build('crystalcave');
eq(GRID.flat.every((b) => b.ore === 'iron' || b.ore === 'crystal'), true, '晶洞层只有铁 / 晶石两种矿');

/* v15：999 级「矿层加深」（mods.extraLayers = 999）真的加到每格层数上，并受 tuning.layerCap 夹紧。
   真实配置 layerCap = 1020 / 03-grid MAX_LAYERS = 1024；这里把 mock 的 cap 抬到同一量级验证：
   ① 999 级不被内部硬上限截断（10–12 + 999 = 1009–1011 层，层栈真的建这么多层）；
   ② cap 收紧到 1000 时逐格夹到 1000；
   ③ 额外层沿用同一套层血量（hpFor(hpMap, ore)，不是「新增层随便给血」）。 */
CONFIG.tuning.layerCap = 1020;
setMods({ extraLayers: 999 });
const bigT0 = Date.now();
GRID.build('crystalcave');
const bigMs = Date.now() - bigT0;
ok(GRID.flat.every((b) => b.totalLayers >= 1009 && b.totalLayers <= 1011),
  'extraLayers=999 + cap 1020 → 每格 1009–1011 层（999 级没有被夹平）',
  'layers=' + [...new Set(GRID.flat.map((b) => b.totalLayers))].sort((a, b) => a - b).join('/'));
ok(GRID.flat.every((b) => b.stack.length === b.totalLayers && b.layers === b.totalLayers),
  '层栈长度 = totalLayers（真的建了上千层，不是只改计数）',
  'stack=' + GRID.flat[0].stack.length + ' total=' + GRID.flat[0].totalLayers);
ok(GRID.flat.every((b) => b.stack.every((L) => L.maxHp === zoneHp(CRYSTALCAVE, L.ore))),
  '额外层沿用同一层血量（hpFor 同一入口，2 击碎一层的手感不变）');
ok(bigMs < 3000, '1020 层建盘不卡（' + bigMs + 'ms）', bigMs + 'ms');
CONFIG.tuning.layerCap = 1000;
GRID.build('crystalcave');
ok(GRID.flat.every((b) => b.totalLayers === 1000),
  'cap 收紧到 1000 → 逐格夹到 1000（上限仍归 tuning.layerCap）',
  'layers=' + [...new Set(GRID.flat.map((b) => b.totalLayers))].join('/'));
CONFIG.tuning.layerCap = 12;
setMods({});
GRID.build('crystalcave');
ok(GRID.flat.every((b) => b.hp === b.maxHp && b.hp === zoneHp(CRYSTALCAVE, b.ore)), '晶洞层 hp 来自 zone.ores[].hp（晶石 240 覆盖全局 40）',
  'crystal hp=' + GRID.flat.find((b) => b.ore === 'crystal' && b.maxHp)?.maxHp);

// 晶洞层能整盘绘制：crystal 贴图走 drawImage，不回落纯色块
settle();
MAIN.ops.drawImage = 0; MAIN.ops.fillRect = 0;
GRID.draw(MAIN);
ok(MAIN.ops.drawImage >= 48, '晶洞层 draw 画满 48 张矿块贴图（含 crystal）', 'drawImage=' + MAIN.ops.drawImage);
setMods({});

// ---------- 3c. 按关血量（BALANCE-V4 §4：zone.ores[].hp 覆盖全局） ----------
section('3c) 按关血量：zone.ores[].hp 覆盖 maxHp（进 stack 就带覆盖值，缺字段回落 CONFIG）');
const HP_TABLE = {
  quarry: { stone: 3, coal: 2 },
  ironmine: { coal: 14, iron: 42 },
  crystalcave: { iron: 120, crystal: 240 }
};
for (const zoneId of Object.keys(HP_TABLE)) {
  const table = HP_TABLE[zoneId];
  let topBad = null, stackBad = null;
  for (let i = 0; i < 12; i++) {
    GRID.build(zoneId);
    for (const b of GRID.flat) {
      if (b.maxHp !== table[b.ore] || b.hp !== table[b.ore]) topBad = b.ore + ' top=' + b.maxHp;
      for (const ly of b.stack) if (ly.maxHp !== table[ly.ore]) stackBad = ly.ore + ' layer=' + ly.maxHp;
    }
  }
  ok(!topBad && !stackBad, zoneId + ' hp/maxHp/stack 全用 zone 覆盖值 ' + JSON.stringify(table), topBad || stackBad);
}

// 第 2 关铁 42 血：打满 42 点才破一层
GRID.build('ironmine');
const ironB = GRID.flat.find((b) => b.ore === 'iron');
eq(ironB.maxHp, 42, '铁矿层铁矿 maxHp = 42（全局缺省 4）');
const ironLayers = ironB.layers;
GRID.damage(ironB, 41, 0);
eq(ironB.layers, ironLayers, '打 41 点：一层都没破');
eq(ironB.hp, 1, '打 41 点后剩 1 血');
GRID.damage(ironB, 1, 0);
eq(ironB.layers, ironLayers - 1, '再打 1 点（共 42）才破一层');
eq(ironB.hp, ironB.maxHp, '破层后 hp 刷新为新层满血');
eq(ironB.depth, 1, '破层后 depth = 1');

// 缺 hp 字段 → 回落 CONFIG.ores[].hp
GRID.build({ cols: 6, rows: 8, filler: 'stone', layerMin: 6, layerMax: 8,
  ores: [{ ore: 'stone', weight: 1, richRate: 0.1 }, { ore: 'coal', weight: 1, richRate: 0.1 }] });
ok(GRID.flat.every((b) => b.hp === b.maxHp && b.hp === CONFIG.ores[b.ore].hp),
  'zone 缺 hp 字段 → 回落 CONFIG.ores[].hp（coal 回到 1）',
  'coal=' + (GRID.flat.find((b) => b.ore === 'coal') || {}).maxHp);

// ---------- 3d. 稀有矿成脉（BALANCE-V4 §7） ----------
section('3d) 稀有矿成脉：每条 3–5 格四邻接连通，矿脉外全是填充矿');
const VEIN_SPEC = {
  quarry: { ore: 'coal', min: 2, max: 4 },        // 无 veins 字段 → GRID 默认 2–4
  ironmine: { ore: 'iron', min: 3, max: 5 },       // zone.veins = [3,5]
  crystalcave: { ore: 'crystal', min: 2, max: 4 }  // zone.veins = [2,4]
};
for (const zoneId of Object.keys(VEIN_SPEC)) {
  const spec = VEIN_SPEC[zoneId];
  const zone = CONFIG.zones.find((z) => z.id === zoneId);
  let minVeins = 99, maxVeins = 0, lenBad = null, lonely = null, stray = null, layerBad = null;
  for (let i = 0; i < 40; i++) {
    GRID.build(zoneId);
    const cs = veinComponents(zone, spec.ore);
    minVeins = Math.min(minVeins, cs.length);
    maxVeins = Math.max(maxVeins, cs.length);
    const inVein = new Set();
    for (const cells of cs) {
      if (cells.length < 3 || cells.length > 5) lenBad = 'len=' + cells.length;
      for (const c of cells) {
        inVein.add(c.x + ',' + c.y);
        let peers = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = c.x + dx, ny = c.y + dy;
          const nb = (nx >= 0 && ny >= 0 && nx < zone.cols && ny < zone.rows) ? GRID.blocks[ny][nx] : null;
          if (nb && nb.ore === spec.ore) peers++;
        }
        if (!peers) lonely = c.x + ',' + c.y;
        if (c.b.totalLayers < zone.layerMin || c.b.totalLayers > zone.layerMax) layerBad = 'layers=' + c.b.totalLayers;
      }
    }
    for (const b of GRID.flat) {
      if (!inVein.has(b.ox + ',' + b.oy) && b.ore !== zone.filler) stray = b.ore + '@' + b.ox + ',' + b.oy;
    }
  }
  ok(minVeins >= spec.min && maxVeins <= spec.max,
    zoneId + ' 矿脉条数落在 ' + spec.min + '–' + spec.max + '（' + spec.ore + '）', 'min=' + minVeins + ' max=' + maxVeins);
  ok(minVeins >= 1, zoneId + ' 每局至少 1 条矿脉', 'min=' + minVeins);
  ok(!lenBad, zoneId + ' 每条矿脉 3–5 格', lenBad);
  ok(!lonely, zoneId + ' 每个矿脉格至少有一个同类四邻（矿脉连通）', lonely);
  ok(!stray, zoneId + ' 矿脉外全是填充矿 ' + zone.filler, stray);
  ok(!layerBad, zoneId + ' 矿脉内格子仍各自独立 ' + zone.layerMin + '–' + zone.layerMax + ' 层', layerBad);
}

// 富矿概率不变，但优先落在矿脉内
GRID.build('crystalcave');
const caveZone = CONFIG.zones.find((z) => z.id === 'crystalcave');
const caveVein = new Set();
for (const cells of veinComponents(caveZone, 'crystal')) for (const c of cells) caveVein.add(c.x + ',' + c.y);
let richInVein = 0, richTotal = 0, veinCells = 0, richOutsideOk = true;
for (let i = 0; i < 40; i++) {
  GRID.build('crystalcave');
  const vs = new Set();
  for (const cells of veinComponents(caveZone, 'crystal')) for (const c of cells) vs.add(c.x + ',' + c.y);
  veinCells += vs.size;
  for (const b of GRID.flat) {
    if (!b.rich) continue;
    richTotal++;
    if (vs.has(b.ox + ',' + b.oy)) richInVein++;
  }
  // 只有「矿脉格全部已富矿」时，才允许富矿溢出到填充矿上
  const veinAllRich = GRID.flat.every((b) => !vs.has(b.ox + ',' + b.oy) || b.rich);
  if (!veinAllRich && GRID.flat.some((b) => b.rich && !vs.has(b.ox + ',' + b.oy))) richOutsideOk = false;
}
ok(richTotal > 0 && richInVein / richTotal >= 0.8, '富矿格绝大多数落在矿脉内',
  richInVein + '/' + richTotal);
ok(richOutsideOk, '矿脉里还有空位时富矿不落到填充矿上（优先落在矿脉里）', 'veinCells=' + veinCells);

// 无矿脉时不崩：单矿种（没有矿脉矿）与 veins:[0,0]
let noVeinThrew = false;
try {
  GRID.build({ cols: 4, rows: 4, ores: [{ ore: 'stone', weight: 1, richRate: 0.2 }] });
} catch (e) { noVeinThrew = true; }
ok(!noVeinThrew, '单矿种 zone（无矿脉矿）build 不抛错');
eq(GRID.flat.length, 16, '单矿种 zone 仍按 cols×rows 铺满');
eq(new Set(GRID.flat.map((b) => b.ore)).size, 1, '单矿种 zone 全部同一种矿');
let zeroThrew = false;
try {
  GRID.build({ cols: 6, rows: 8, filler: 'stone', veins: [0, 0],
    ores: [{ ore: 'stone', weight: 80, richRate: 0.1, hp: 3 }, { ore: 'coal', weight: 20, richRate: 0.2, hp: 2 }] });
} catch (e) { zeroThrew = true; }
ok(!zeroThrew, 'veins = [0,0] 时不抛错');
eq(GRID.flat.filter((b) => b.ore === 'coal').length, 0, 'veins = [0,0] → 没有矿脉矿，全盘填充矿');
ok(GRID.flat.every((b) => b.hp === 3), 'veins = [0,0] 时 hp 覆盖仍生效（石头 3）');
// 行内 zone（非 CONFIG 引用）也吃 hp 覆盖
GRID.build({ cols: 6, rows: 8, filler: 'coal', veins: [3, 5],
  ores: [{ ore: 'coal', weight: 65, richRate: 0.1, hp: 14 }, { ore: 'iron', weight: 35, richRate: 0.14, hp: 42 }] });
eq(GRID.flat.find((b) => b.ore === 'iron').maxHp, 42, '内联 zone 配置的 hp 覆盖同样生效');
eq(GRID.flat.find((b) => b.ore === 'coal').maxHp, 14, '内联 zone 的填充矿 hp 覆盖同样生效');
GRID.build('quarry');

// ---------- 3e. 矿脉容量随 oreRateBonus 放大（v12 方案 a） ----------
section('3e) 矿脉容量放大：簇 3–5 → 4–7 → 5–9、相邻上限 0/1/2、溢出散铺、68% 硬上限');
const STARC = CONFIG.zones.find((z) => z.id === 'starCave');
// 固定 seed（Date.now + Math.random 都钉死）：同一 zone 每次都长成同一张盘，可以断言精确格数
function buildSeeded(zone, bonus) {
  const realNow = Date.now, realRnd = Math.random;
  Date.now = () => 0;
  Math.random = () => 0;
  try { setMods({ oreRateBonus: bonus }); GRID.build(zone); }
  finally { Date.now = realNow; Math.random = realRnd; setMods({}); }
}
const preciousOf = (zone) => GRID.flat.filter((b) => b.ore !== zone.filler).length;
function maxAdjOf() {
  const lv = GRID.lastVein;
  let m = 0;
  if (lv) for (const c of lv.clusters) if (c.adj > m) m = c.adj;
  return m;
}

// 三档簇大小与相邻上限（读数直接取 build 时的档位）
for (const [bonus, lo, hi, cap] of [[0, 3, 5, 0], [0.06, 4, 7, 1], [0.12, 5, 9, 2]]) {
  buildSeeded(STARC, bonus);
  const lv = GRID.lastVein;
  ok(!!lv, 'bonus=' + bonus + ' 下 lastVein 有读数（矿脉布局有账可查）');
  eq(lv.min, lo, 'bonus=' + bonus + ' 簇最小 ' + lo + ' 格');
  eq(lv.max, hi, 'bonus=' + bonus + ' 簇最大 ' + hi + ' 格');
  eq(lv.adjCap, cap, 'bonus=' + bonus + ' 单簇相邻上限 = ' + cap);
  eq(GRID._veinAdjCap(bonus), cap, 'veinAdjCap(' + bonus + ') = ' + cap);
  ok(lv.clusters.every((c) => c.cells >= lv.min && c.cells <= lv.max),
    'bonus=' + bonus + ' 每条簇 ' + lv.min + '–' + lv.max + ' 格',
    JSON.stringify(lv.clusters));
  ok(maxAdjOf() <= cap, 'bonus=' + bonus + ' 每簇贴住的别簇数 ≤ ' + cap, 'maxAdj=' + maxAdjOf());
}
// 0 档保持严格不相邻（原矿脉语义），0.06 / 0.12 允许相邻且确实发生过
buildSeeded(STARC, 0);
eq(maxAdjOf(), 0, 'bonus=0 簇与簇严格不相邻（相邻上限 0 生效）');
buildSeeded(STARC, 0.06);
ok(maxAdjOf() >= 1 && maxAdjOf() <= 1, 'bonus=0.06 允许贴 1 个邻簇（实测 maxAdj=' + maxAdjOf() + '）');
buildSeeded(STARC, 0.12);
ok(maxAdjOf() >= 1 && maxAdjOf() <= 2, 'bonus=0.12 允许贴到 2 个邻簇（实测 maxAdj=' + maxAdjOf() + '）');

// 精确格数：0 档必须与改动前逐格一致（固定 seed 的基准读数），三档单调递增
const tierCounts = {};
for (const id of ['quarry', 'starCave']) {
  const zone = CONFIG.zones.find((z) => z.id === id);
  tierCounts[id] = [0, 0.06, 0.12].map((b) => { buildSeeded(zone, b); return preciousOf(zone); });
}
eq(tierCounts.quarry[0], 10, 'bonus=0 第 1 关 quarry 贵重矿 = 10 格（与改动前完全一致）');
eq(tierCounts.starCave[0], 20, 'bonus=0 第 5 关 starCave 贵重矿 = 20 格（与改动前完全一致）');
ok(tierCounts.quarry[0] < tierCounts.quarry[1] && tierCounts.quarry[1] < tierCounts.quarry[2],
  'quarry 贵重矿格数随 bonus 单调递增', JSON.stringify(tierCounts.quarry));
ok(tierCounts.starCave[0] < tierCounts.starCave[1] && tierCounts.starCave[1] < tierCounts.starCave[2],
  'starCave 贵重矿格数随 bonus 单调递增', JSON.stringify(tierCounts.starCave));
eq(JSON.stringify(tierCounts.starCave), JSON.stringify([20, 28, 32]), 'starCave 三档 = 20 / 28 / 32 格（41.7% → 58.3% → 66.7%）');
ok(tierCounts.starCave[2] / BLOCKS >= 0.55,
  'bonus=0.12 时 starCave 贵重矿占比 ≥ 55%（实测 ' + (100 * tierCounts.starCave[2] / BLOCKS).toFixed(1) + '%）');
// 69% 是硬上限：任何档位都不许把对比矿挤掉
ok(tierCounts.starCave.every((c) => c / BLOCKS <= 0.68), 'starCave 三档占比均 ≤ 68%', JSON.stringify(tierCounts.starCave));
eq(GRID._oreRatioCap, 0.68, '贵重矿占比硬上限 = 48 × 0.68（留 32% 填充矿）');

// 全关全档随机采样：占比不越 68%、散点把「权重要求的格数」补齐
let capBad = null, wantBad = null, scatterSeen = 0, hpBad = null;
for (const zone of CONFIG.zones) {
  for (const b of [0, 0.06, 0.12, 0.25]) {
    setMods({ oreRateBonus: b });
    for (let i = 0; i < 12; i++) {
      GRID.build(zone);
      const p = preciousOf(zone), lv = GRID.lastVein;
      if (p / BLOCKS > 0.68) capBad = zone.id + '@' + b + ' → ' + p + '/' + BLOCKS;
      if (lv && b > 0 && (lv.placed + lv.scattered !== lv.want || p !== lv.want)) {
        wantBad = zone.id + '@' + b + ' placed=' + lv.placed + ' scatter=' + lv.scattered + ' want=' + lv.want + ' board=' + p;
      }
      if (lv && lv.scattered > 0) scatterSeen++;
      // 散点与矿脉格走同一条 hp 通道（zone.ores[].hp 覆盖）
      for (const cell of GRID.flat) if (cell.ore !== zone.filler && cell.maxHp !== zoneHp(zone, cell.ore)) hpBad = zone.id + '@' + b;
    }
  }
}
setMods({});
ok(!capBad, '任何关、任何档位：贵重矿占比 ≤ 68%（48 格最多 32 格）', capBad);
ok(!wantBad, '溢出散铺把「权重要求的格数」补齐：placed + scattered === want === 盘面贵重矿格数', wantBad);
ok(scatterSeen > 0, '溢出散铺在这批采样里确实触发过（' + scatterSeen + ' 次）');
ok(!hpBad, '矿脉格与散点的 hp 都吃 zone.ores[].hp 覆盖', hpBad);

// 溢出散铺专测：簇数上限放到 6–8 条 + 高档位 → 矿脉装不满，必须靠散点补
const SPILL = { id: 'spill', cols: 6, rows: 8, filler: 'iron', layerMin: 6, layerMax: 8, veins: [6, 8],
  ores: [{ ore: 'crystal', weight: 75, richRate: 0.20, hp: 58 }, { ore: 'iron', weight: 25, richRate: 0.15, hp: 20 }] };
let spillBuilds = 0, spillScattered = 0, spillBad = null;
setMods({ oreRateBonus: 0.06 });
for (let i = 0; i < 60; i++) {
  GRID.build(SPILL);
  const lv = GRID.lastVein;
  if (lv.scattered > 0) { spillBuilds++; spillScattered += lv.scattered; }
  if (lv.placed + lv.scattered !== lv.want || preciousOf(SPILL) !== lv.want) spillBad = 'placed=' + lv.placed + ' scatter=' + lv.scattered + ' want=' + lv.want;
  if (preciousOf(SPILL) !== lv.want) spillBad = 'board=' + preciousOf(SPILL) + ' want=' + lv.want;
}
setMods({});
ok(spillBuilds > 0, 'veins=[6,8] + bonus 0.06：矿脉装不满时散点补位（' + spillBuilds + '/60 局触发，共 ' + spillScattered + ' 个散点）');
ok(!spillBad, '散点补位后盘面格数 === 权重要求的 want（权重 → 占比映射成立）', spillBad);
ok(preciousOf(SPILL) / BLOCKS <= 0.68, '散点补位也不会越过 68% 硬上限（' + preciousOf(SPILL) + '/' + BLOCKS + '）');
eq(GRID.lastVein.adjCap, 1, 'bonus=0.06 的相邻上限仍是 1（散点不影响簇的相邻记账）');
GRID.build('quarry');

// ---------- 4. 入场波次 ----------
section('4) appearT：从中心向外扩散');
GRID.build('quarry');
ok(GRID.flat.every((b) => b.appearT === 0), 'build 后 appearT 全为 0');
const centerB = GRID.blocks[3][2];
const cornerB = GRID.blocks[0][0];
GRID.update(0.05);
ok(centerB.appearT > 0, '中心格先出现', 'appearT=' + centerB.appearT);
eq(cornerB.appearT, 0, '最远的角落格仍在等待');
settle();
ok(GRID.flat.every((b) => b.appearT === 1), '波次结束后全为 1');
eq(GRID.update(0), undefined, 'update(0) 不抛错');

// ---------- 5. damage：只打顶层 + block:layer ----------
section('5) damage()：打穿顶层换层、hp 刷新、block:layer / block:empty');
GRID.build('quarry');
bus.log.length = 0;
const cd = GRID.flat.find((b) => b.ore === 'coal');
eq(cd.maxHp, 2, '煤矿耐久 = 采石场 zone 覆盖值 2（全局缺省仍是 1）');
const cdLayers = cd.layers;
const r1 = GRID.damage(cd, cd.maxHp, 0.5);
eq(r1.broke, false, '打穿顶层但整格未挖空 → broke = false');
eq(r1.layersBroken, 1, '一次只打穿 1 层');
eq(r1.overkill, 0, '刚好打空本层，无溢出');
eq(events('block:layer').length, 1, '派发 1 次 block:layer');
eq(events('block:break').length, 0, '整格未挖空 → 不派发 block:break');
eq(events('block:hit').length, 1, '派发 1 次 block:hit');
const layerEv = lastEvent('block:layer');
eq(layerEv.data.block === cd, true, 'block:layer 带 block');
eq(layerEv.data.depth, 1, 'block:layer 的 depth = 1');
eq(cd.depth, 1, 'depth 递增');
eq(cd.layers, cdLayers - 1, 'layers 递减');
eq(cd.ore, cd.stack[1].ore, 'ore 换成下一层');
eq(cd.maxHp, cd.stack[1].maxHp, 'maxHp 换成下一层');
eq(cd.hp, cd.stack[1].maxHp, 'hp 刷新为新层满血');
eq(cd.crack, 0, '换层后裂纹归零');
eq(cd.layerT, 1, '换层触发一次上弹计时');
eq(cd.broken, false, '未挖空 broken = false');
eq(cd.totalLayers, cdLayers, 'totalLayers 不变（画堆叠边缘用）');
eq(cd.hitT, 1, '命中瞬间 hitT = 1');
eq(cd.hitDir, 0.5, 'hitDir 记录方向');

// 一路打穿到底
bus.log.length = 0;
const leftLayers = cd.layers;
let guard = 0;
while (!cd.broken && guard++ < 30) GRID.damage(cd, 99, 0);
eq(cd.broken, true, '挖空后 broken = true');
eq(cd.layers, 0, '挖空后 layers = 0');
eq(cd.depth, cdLayers, 'depth = totalLayers');
eq(events('block:empty').length, 1, 'layers 归零派发 1 次 block:empty');
eq(events('block:break').length, 1, '整格挖空派发 1 次 block:break');
eq(events('block:layer').length, leftLayers - 1, '剩余每中间层各派发 1 次 block:layer');
eq(lastEvent('block:empty').data.block === cd, true, 'block:empty 带 block');
eq(lastEvent('block:break').data.ore, cd.ore, 'block:break 带最后一层的 ore');
const deadLog = bus.log.length;
const rDead = GRID.damage(cd, 3, 0);
eq(rDead.broke, false, '已破碎格不再受击');
eq(rDead.layersBroken, 0, '已破碎格 layersBroken = 0');
eq(bus.log.length, deadLog, '已破碎格不派发事件');

// ---------- 5b. 事件 prev：结算按「刚挖掉那一层」 ----------
section('5b) block:layer / block:break / block:empty 的 prev = 刚打碎那一层');

// 找一格「首层与次层矿种不同」的，才能区分 prev 是旧层还是新层
let diffB = null;
for (let i = 0; i < 40 && !diffB; i++) {
  GRID.build('quarry');
  diffB = GRID.flat.find((b) => !b.broken && b.stack && b.stack.length > 1 && b.stack[0].ore !== b.stack[1].ore);
}
ok(!!diffB, '找到首层与次层矿种不同的格子');
bus.log.length = 0;
const prevOre = diffB.ore, prevMax = diffB.maxHp, prevRich = !!diffB.rich;
GRID.damage(diffB, prevMax, 0);
const pEv = lastEvent('block:layer');
ok(!!pEv, '打穿一层派发 block:layer');
eq(pEv.data.prev.ore, prevOre, 'block:layer 的 prev.ore = 被打碎那一层的 ore');
eq(pEv.data.prev.ore === diffB.ore, false, 'prev.ore ≠ 新层的 ore（不会错读一层）');
eq(pEv.data.prev.maxHp, prevMax, 'block:layer 的 prev.maxHp = 被打碎那一层的 maxHp');
eq(pEv.data.prev.rich, prevRich, 'block:layer 的 prev.rich = 被打碎那一层');
eq(Object.keys(pEv.data.prev).sort().join(','), 'maxHp,ore,rich', 'prev 就是 {ore, rich, maxHp}');
ok(pEv.data.prev !== pEv.data.block, 'prev 是独立对象，不是 block 本体');
eq(diffB.ore, diffB.stack[1].ore, 'block 自身已换成新层（prev 才是旧层）');

// 逐层挖穿：每层 prev 都指向刚打碎的那一层，block:break / block:empty 指最后一层
GRID.build('quarry');
const chainB = GRID.flat.find((b) => !b.broken);
let layerPrevOk = true, breakPrevOk = true, emptyPrevOk = true, layersSeen = 0, badLayer = '';
while (!chainB.broken) {
  const beforeOre = chainB.ore, beforeMax = chainB.maxHp, beforeRich = !!chainB.rich;
  bus.log.length = 0;
  GRID.damage(chainB, 99, 0);
  layersSeen++;
  const lv = lastEvent('block:layer'), br = lastEvent('block:break'), em = lastEvent('block:empty');
  if (lv) {
    const p = lv.data.prev;
    if (!p || p.ore !== beforeOre || p.maxHp !== beforeMax || p.rich !== beforeRich) {
      layerPrevOk = false; badLayer = beforeOre + ' → ' + (p && p.ore);
    }
  }
  if (br && (!br.data.prev || br.data.prev.ore !== beforeOre || br.data.prev.maxHp !== beforeMax)) breakPrevOk = false;
  if (em && (!em.data.prev || em.data.prev.ore !== beforeOre || em.data.prev.maxHp !== beforeMax)) emptyPrevOk = false;
}
eq(layersSeen, chainB.totalLayers, '逐层挖穿次数 = totalLayers');
ok(layerPrevOk, '每层 block:layer 的 prev 都指向刚打碎的那一层', badLayer);
ok(breakPrevOk, 'block:break 的 prev 指向最后一层');
ok(emptyPrevOk, 'block:empty 的 prev 指向最后一层');

// TNT 多层穿透也带 prev（每层各一次）
GRID.build('quarry');
bus.log.length = 0;
const tntPrevB = GRID.flat.find((b) => !b.broken && b.totalLayers >= 3);
const tntPrevOre = tntPrevB.ore;
GRID.damageLayers(tntPrevB, 99, 2);
const tntLayers = events('block:layer');
ok(tntLayers.length >= 1, 'damageLayers 穿透时也派发 block:layer');
eq(tntLayers[0].data.prev.ore, tntPrevOre, 'damageLayers 的第一层 prev.ore = 起始层 ore');

// overkill 语义：只溢出当前层
const ov = GRID.flat.find((b) => b.ore === 'stone' && !b.broken);
const rOv = GRID.damage(ov, ov.maxHp + 2, 0);
eq(rOv.overkill, 2, 'overkill = 溢出当前层的伤害');
eq(rOv.broke, false, '溢出不跨层，整格未挖空');

// ---------- 6. damageLayers：TNT 多层穿透 ----------
section('6) damageLayers()：每层独立吃 dmg，最多穿透 maxLayers 层');
GRID.build('quarry');
const tntB = GRID.flat.find((b) => b.ore === 'stone' && b.layers >= 5 && !b.broken);
const hpStone = CONFIG.ores.stone.hp;
eq(hpStone, 3, '石头耐久 = 3');
bus.log.length = 0;
const rWeak = GRID.damageLayers(tntB, 2, 3);
eq(rWeak.layersBroken, 0, 'dmg 2 < 层血 3：一层都打不穿');
eq(rWeak.emptied, false, '未挖空');
const rOne = GRID.damageLayers(tntB, 3, 1);
eq(rOne.layersBroken, 1, 'maxLayers=1 只穿透 1 层');
const rTwo = GRID.damageLayers(tntB, 3, 2);
eq(rTwo.layersBroken, 2, 'maxLayers=2 穿透 2 层');
eq(tntB.layers, tntB.totalLayers - 3, '剩余层数正确');
// 每层独立吃 dmg（4 点打 3 血的石头：溢出不会留到下一层，但每层都能各吃 4 点）
const rIndep = GRID.damageLayers(tntB, 4, 2);
eq(rIndep.layersBroken, 2, '每层独立结算 4 点伤害 → 打穿 2 层');
const capThree = GRID.damageLayers(tntB, 99, 3);
eq(capThree.layersBroken, Math.min(3, tntB.totalLayers - 5), 'maxLayers=3 严格封顶');
const big = GRID.flat.find((b) => b.layers === b.totalLayers && !b.broken);
bus.log.length = 0;
const rAll = GRID.damageLayers(big, 99, 11);
eq(rAll.emptied, true, '穿透到底 → emptied = true');
eq(rAll.layersBroken, big.totalLayers, 'layersBroken = totalLayers');
eq(big.layers, 0, 'layers 归零');
eq(big.broken, true, 'broken = true');
eq(events('block:empty').length, 1, '只派发 1 次 block:empty');
eq(events('block:break').length, 1, '只派发 1 次 block:break');
const rTntDead = GRID.damageLayers(big, 99, 3);
eq(rTntDead.layersBroken, 0, '坑洞不再吃 TNT 伤害');
eq(rTntDead.emptied, false, '坑洞 emptied = false');

// ---------- 7. isEmpty / aliveCells ----------
section('7) isEmpty() / aliveCells()');
GRID.build('quarry');
eq(GRID.isEmpty(), false, '新棋盘未挖空');
eq(GRID.aliveCells(), 48, '新棋盘 48 格存活');
const one = GRID.flat[0];
GRID.damageLayers(one, 99, 11);
eq(GRID.isEmpty(), false, '挖空 1 格后仍未挖空');
eq(GRID.aliveCells(), 47, 'aliveCells = 47');
for (const b of GRID.flat) GRID.damageLayers(b, 99, 11);
eq(GRID.isEmpty(), true, '全盘挖空 → isEmpty = true');
eq(GRID.aliveCells(), 0, 'aliveCells = 0');
// 只剩最后一层时仍算存活
GRID.build('quarry');
for (let i = 0; i < GRID.flat.length - 1; i++) GRID.damageLayers(GRID.flat[i], 99, 11);
const lastCell = GRID.flat[GRID.flat.length - 1];
while (lastCell.layers > 1) GRID.damageLayers(lastCell, 99, 1);
eq(lastCell.layers, 1, '最后一格剩 1 层');
eq(GRID.isEmpty(), false, '剩 1 层不算挖空');
GRID.damageLayers(lastCell, 99, 1);
eq(GRID.isEmpty(), true, '打掉最后一层 → 挖空');

// ---------- 8. 深度阴影参数 ----------
section('8) 深度阴影与堆叠边缘参数随深度递增');
const sh0 = GRID._layerShade(0);
const sh1 = GRID._layerShade(1);
const sh3 = GRID._layerShade(3);
const sh6 = GRID._layerShade(6);
eq(sh0.alpha, 0, 'depth 0 不加暗');
eq(sh0.inset, 0, 'depth 0 无内阴影');
ok(sh1.alpha > sh0.alpha && sh3.alpha > sh1.alpha && sh6.alpha > sh3.alpha, '阴影 alpha 随 depth 递增',
  [sh0.alpha, sh1.alpha, sh3.alpha, sh6.alpha].join(' → '));
ok(sh1.inset > sh0.inset && sh3.inset > sh1.inset && sh6.inset > sh3.inset, '内阴影 inset 随 depth 递增',
  [sh0.inset, sh1.inset, sh3.inset, sh6.inset].join(' → '));
near(sh1.alpha - sh0.alpha, 0.12, 1e-9, '每深一层 -12% 亮度（旧版 -8% 太含蓄）');
eq(GRID._depthDark, 0.12, '暗化系数常量 = 0.12');
let darkStepOk = true, darkStepSample = null;
for (let d = 1; d <= 4; d++) {
  const step = GRID._layerShade(d).alpha - GRID._layerShade(d - 1).alpha;
  if (Math.abs(step - 0.12) > 1e-9) { darkStepOk = false; darkStepSample = 'depth ' + (d - 1) + '→' + d + ' = ' + step.toFixed(4); }
}
ok(darkStepOk, '深度暗化步长恒为 0.12（第 1–5 层线性递增）', darkStepSample);
ok([1, 2, 3, 4, 5].every((d) => GRID._layerShade(d).alpha > GRID._layerShade(d - 1).alpha),
  '暗化系数随 depth 严格递增',
  [0, 1, 2, 3, 4, 5].map((d) => GRID._layerShade(d).alpha.toFixed(2)).join(' → '));
ok(GRID._layerShade(30).alpha <= 0.6 && GRID._layerShade(30).inset <= 0.5, '阴影有上限，不会变纯黑');
eq(GRID._edgeThickness(1), 0, '只有 1 层时不露下层边缘');
eq(GRID._edgeThickness(2), 1, '2 层露 1px 边缘');
eq(GRID._edgeThickness(4), 1, '4 层露 1px 边缘');
eq(GRID._edgeThickness(5), 2, '5 层以上露 2px 边缘（层数越多越明显）');
eq(GRID._edgeThickness(8), 2, '8 层露 2px 边缘');

// ---------- 9. at() ----------
section('9) at()：设计空间命中测试');
GRID.build('quarry');
const target = GRID.blocks[2][2];
eq(GRID.at(target.x + target.s / 2, target.y + target.s / 2) === target, true, '格中心命中自身');
const seamX = (GRID.blocks[2][2].x + GRID.blocks[2][3].x) / 2;
ok(GRID.at(seamX, target.y + target.s / 2) !== null, '点在缝隙上仍命中最近格');
eq(GRID.at(-500, 300), null, '左侧越界返回 null');
eq(GRID.at(2000, 300), null, '右侧越界返回 null');
eq(GRID.at(200, -500), null, '上方越界返回 null');
eq(GRID.at(200, 5000), null, '下方越界返回 null');
GRID.damageLayers(target, 99, 11);
eq(target.broken, true, '目标格已挖空');
eq(GRID.at(target.x + target.s / 2, target.y + target.s / 2), null, '已挖空格返回 null');
const c00 = GRID.blocks[0][0];
ok(GRID.at(c00.x - 1, c00.y - 1) !== null, '格左上 1px 处仍命中（缝隙不算空）');

// ---------- 10. neighbors / richCells ----------
section('10) neighbors() / richCells()');
GRID.build('quarry');
const mid = GRID.blocks[4][2];
eq(GRID.neighbors(mid, 'cross', 1).length, 4, 'cross n=1 → 4');
eq(GRID.neighbors(mid, 'square', 1).length, 8, 'square n=1 → 8');
eq(GRID.neighbors(mid, 'column', 1).length, 2, 'column n=1 → 2');
eq(GRID.neighbors(mid, 'row', 1).length, 2, 'row n=1 → 2');
eq(GRID.neighbors(mid, 'cross', 2).length, 12, 'cross n=2 → 12');
eq(GRID.neighbors(mid, 'square', 2).length, 24, 'square n=2 → 24');
eq(GRID.neighbors(mid, 'column', 3).length, 6, 'column n=3 → 6');
eq(GRID.neighbors(mid, 'row', 3).length, 5, 'row n=3 → 5（左侧越界 1 格被跳过）');
const corner = GRID.blocks[0][0];
eq(GRID.neighbors(corner, 'cross', 1).length, 2, '角格 cross n=1 → 2');
eq(GRID.neighbors(corner, 'square', 1).length, 3, '角格 square n=1 → 3');
eq(GRID.neighbors(null, 'cross', 1).length, 0, 'null 矿块返回空数组');
const nbTarget = GRID.blocks[4][2];
GRID.damageLayers(GRID.blocks[4][3], 99, 11);
eq(GRID.neighbors(nbTarget, 'cross', 1).length, 3, '相邻已挖空格被排除');

GRID.build('quarry');   // 重建：上面的打坑可能刚好吃掉唯一的富矿格
eq(GRID.richCells(2).length >= 1 && GRID.richCells(2).length <= 2, true, 'richCells(2) 返回 1–2 个');
ok(GRID.richCells(2).every((b) => b.rich && !b.broken), '返回的都是未挖空富矿格');
eq(GRID.richCells(0).length, 1, 'richCells(0) 至少返回 1 个');
let everyBoardHasRich = true;
for (let i = 0; i < 40; i++) {
  GRID.build('ironmine');
  if (GRID.flat.filter((b) => b.rich).length < 1) everyBoardHasRich = false;
}
ok(everyBoardHasRich, '每局至少 1 个富矿格');

// ---------- 11. draw ----------
section('11) draw()：不调用 getImageData / createImageData，含深度阴影与堆叠边缘');
GRID.build('quarry');
settle();
MAIN.ops.drawImage = 0; MAIN.ops.fillRect = 0;
total.getImageData = 0; total.createImageData = 0;
const canvasBefore = canvasCreations;
rectLog.length = 0;
GRID.draw(MAIN);
eq(total.getImageData, 0, 'draw 内 getImageData 调用 0 次');
eq(total.createImageData, 0, 'draw 内 createImageData 调用 0 次');
eq(canvasCreations, canvasBefore, 'draw 内未新建 canvas');
eq(MAIN.imageSmoothingEnabled, true, 'draw 结束后恢复 imageSmoothingEnabled');
ok(MAIN.ops.drawImage >= 48, '绘制了 48 张矿块纹理', 'drawImage=' + MAIN.ops.drawImage);
ok(MAIN.ops.fillRect > 50, '绘制了石壁/缝隙/内阴影', 'fillRect=' + MAIN.ops.fillRect);
const stackEdge = GRID.flat.filter((b) => b.layers > 1)[0];
const edgeRect = rectLog.find((r) => Math.abs(r.y - (stackEdge.y + stackEdge.s)) < 0.01 && r.h >= 1);
ok(!!edgeRect, '方块底部画出了下层边缘（堆叠观感）', edgeRect ? 'y=' + edgeRect.y + ' h=' + edgeRect.h : 'not found');

// 打穿一层后：draw 会叠 depth 阴影 + 裂纹仍用代码折线
const shTarget = GRID.flat.find((b) => b.ore === 'stone' && !b.broken);
GRID.damage(shTarget, CONFIG.ores.stone.hp, 0);
settle(20);
eq(shTarget.depth, 1, '被打穿的格 depth = 1');
rectLog.length = 0;
MAIN.ops.stroke = 0;
GRID.draw(MAIN);
const SINK = 2;
const shadeRect = rectLog.find((r) => Math.abs(r.x - shTarget.x) < 0.01 && Math.abs(r.y - (shTarget.y + SINK)) < 0.01 &&
  Math.abs(r.w - shTarget.s) < 0.01 && /^rgba\(0,0,0,/.test(r.style));
ok(!!shadeRect, 'depth > 0 的格叠加了深度阴影，且整体下沉 2px', shadeRect ? shadeRect.style : 'not found');
const sunkEdge = rectLog.find((r) => Math.abs(r.x - shTarget.x) < 0.01 && Math.abs(r.y - (shTarget.y + shTarget.s + SINK)) < 0.01 && r.h >= 1);
ok(!!sunkEdge, '下沉后露出的下层边缘跟着下移 2px（一摞牌更直观）');
ok(parseFloat(String(shadeRect && shadeRect.style).split(',')[3]) > 0, '深度阴影 alpha > 0');

GRID.build('quarry');
settle();
for (const b of GRID.flat) GRID.damageLayers(b, 99, 11);
settle(4);
MAIN.ops.drawImage = 0;
MAIN.ops.fill = 0;
GRID.draw(MAIN);
eq(MAIN.ops.drawImage, 0, '全挖空时不绘制纹理（只留凹坑）');
ok(MAIN.ops.fill > 0, '凹坑碎石用多边形绘制（不是纯黑洞）');

// ---------- 12. clear / 总线缺失 / 自定义矩形 ----------
section('12) clear()、事件总线缺失、自定义矩形与 zoneId');
GRID.clear();
eq(GRID.blocks.length, 0, 'clear 后 blocks 为空');
eq(GRID.flat.length, 0, 'clear 后 flat 为空');
eq(GRID.at(200, 300), null, 'clear 后 at() 返回 null');
eq(GRID.isEmpty(), true, 'clear 后 isEmpty = true');
eq(GRID.aliveCells(), 0, 'clear 后 aliveCells = 0');
GRID.build('quarry');
GRID.draw(MAIN);
ok(true, 'clear 后 build + draw 不抛错');

const savedBus = globalThis.BM.bus;
delete globalThis.BM.bus;
let threw = false;
try {
  GRID.build('quarry');
  GRID.damage(GRID.flat[0], 99, 0);
  GRID.damageLayers(GRID.flat[1], 99, 3);
} catch (e) { threw = true; }
ok(!threw, '没有 BM.bus 时 damage / damageLayers 不抛错');
globalThis.BM.bus = savedBus;

GRID.init(MAIN, { x: 0, y: 0, w: 300, h: 600 });
GRID.build({ cols: 6, rows: 8, ores: [{ ore: 'stone', weight: 1, richRate: 0.1 }] });
const fitted = GRID.blocks[0][0];
ok(fitted.s > 0 && fitted.x >= 0 && fitted.y >= 0, 'init(ctx, rect) 自定义棋盘矩形生效');
eq(GRID.at(fitted.x + 1, fitted.y + 1) === fitted, true, '自定义矩形下 at() 仍正确');
GRID.init(MAIN);
GRID.build('quarry');
eq(GRID.flat.length, 48, 'build(zoneId 字符串) 也能取到 6×8');
ok(GRID.flat.every((b) => b.ore === 'stone' || b.ore === 'coal'), '按 zoneId 取到采石场配置');

// ---------- 13. 美术贴图接入（假 BM.ART / 假 Image） ----------
section('13) 美术贴图：BM.ART 就绪走贴图，缺失或未解码回退程序化绘制');

const artCalls = [];
function fakeImg(tag) { return { tag, width: 1, height: 1, naturalWidth: 1, complete: true }; }
// mode 'img'：返回 1×1 假 Image；mode 'null'：模拟“键缺失 / 未解码完成”
function installArt(mode) {
  artCalls.length = 0;
  globalThis.BM.ART = {
    keys: [], total: 0, has() { return true; }, all() { return []; }, progress() { return 1; },
    one(key, index) {
      artCalls.push({ key, index });
      return mode === 'null' ? null : fakeImg(key + '#' + index);
    }
  };
}
function dropArt() { delete globalThis.BM.ART; }
function mainDraws() { return drawLog.filter((d) => d.ctx === MAIN); }

GRID.init(MAIN);
GRID.build('quarry');
settle();
installArt('img');
drawLog.length = 0; MAIN.ops.drawImage = 0;
GRID.draw(MAIN);

const oreKeys = artCalls.filter((c) => /^tiles\./.test(c.key));
ok(oreKeys.length >= 48, '48 格都向 BM.ART 查了贴图', 'calls=' + oreKeys.length);
ok(oreKeys.every((c) => /^tiles\.ore\.(stone|coal|iron|crystal)\.(normal|rich)$/.test(c.key)),
  '方块 key 一律是 tiles.ore.<ore>.<normal|rich>', oreKeys.map((c) => c.key).find((k) => !/^tiles\.ore\./.test(k)));
ok(MAIN.ops.drawImage >= 48, '走贴图路径：每格一次 drawImage', 'drawImage=' + MAIN.ops.drawImage);
const untagged = mainDraws().filter((d) => typeof d.img.tag !== 'string');
const richVisible = GRID.flat.filter((b) => b.rich && !b.broken && b.appearT > 0).length;
ok(untagged.every((d) => d.w > GRID.flat[0].s * 1.2), '无 tag 的 drawImage 只剩富矿呼吸光晕（尺寸大于方块）',
  untagged.map((d) => d.w).join(','));
eq(untagged.length, richVisible, '有贴图时不再画预渲染矿块纹理，仅保留富矿呼吸光晕');
ok(mainDraws().every((d) => d.smoothing === false), '贴图绘制时 imageSmoothingEnabled = false（硬边）');

const artB0 = GRID.flat[0];
const artKey0 = 'tiles.ore.' + artB0.ore + '.' + (artB0.rich ? 'rich' : 'normal');
const artD0 = mainDraws().find((d) => d.img.tag === artKey0 + '#' + artB0.seed);
ok(!!artD0, '方块贴图 key 用 ore+rich，index = seed', artKey0 + '#' + artB0.seed);
ok(!!artD0 && Math.abs(artD0.x - artB0.x) < 0.01 && Math.abs(artD0.y - artB0.y) < 0.01 &&
  Math.abs(artD0.w - artB0.s) < 0.01 && Math.abs(artD0.h - artB0.s) < 0.01,
  '贴图铺满方块矩形（x/y/w/h = 方块尺寸）', artD0 ? [artD0.x, artD0.y, artD0.w, artD0.h].join(',') : 'not found');

const richB = GRID.flat.find((b) => b.rich && !b.broken);
ok(!!richB && mainDraws().some((d) => d.img.tag === 'tiles.ore.' + richB.ore + '.rich#' + richB.seed),
  '富矿格用 .rich 贴图（金边在图中，不另叠金环）', richB ? richB.ore : 'no rich cell');

// 裂纹：阶段 1..3 → tiles.crack.1..3，叠在方块矩形上，且不再画程序化折线
const crackB = GRID.flat.find((b) => !b.broken);
for (const lv of [1, 2, 3]) {
  crackB.crack = lv;
  artCalls.length = 0; drawLog.length = 0; MAIN.ops.stroke = 0;
  GRID.draw(MAIN);
  const call = artCalls.find((c) => c.key === 'tiles.crack.' + lv);
  ok(!!call, 'crack=' + lv + ' 映射到 tiles.crack.' + lv, artCalls.map((c) => c.key).join(','));
  eq(call ? call.index : -1, crackB.seed % 8, 'crack=' + lv + ' 的 index = seed % 8');
  const cd = mainDraws().find((d) => d.img.tag === 'tiles.crack.' + lv + '#' + (crackB.seed % 8));
  ok(!!cd && Math.abs(cd.x - crackB.x) < 0.01 && Math.abs(cd.y - crackB.y) < 0.01 &&
    Math.abs(cd.w - crackB.s) < 0.01, 'crack=' + lv + ' 贴图叠在方块矩形上');
  eq(MAIN.ops.stroke, 0, 'crack=' + lv + ' 有贴图时不再画程序化裂纹折线');
}
crackB.crack = 0;
artCalls.length = 0;
GRID.draw(MAIN);
ok(!artCalls.some((c) => /^tiles\.crack\./.test(c.key)), 'crack=0 时不请求裂纹贴图');

// 凹坑：broken 格改用 tiles.pit
const pitB = GRID.flat.find((b) => !b.broken);
GRID.damageLayers(pitB, 99, 11);
settle(4);
artCalls.length = 0; drawLog.length = 0; MAIN.ops.fill = 0;
GRID.draw(MAIN);
const pitCall = artCalls.find((c) => c.key === 'tiles.pit');
ok(!!pitCall, 'broken 格请求 tiles.pit');
eq(pitCall ? pitCall.index : -1, pitB.seed % 4, '凹坑 index = seed % 4');
const pitDraw = mainDraws().find((d) => d.img.tag === 'tiles.pit#' + (pitB.seed % 4));
ok(!!pitDraw && Math.abs(pitDraw.x - pitB.x) < 0.01 && Math.abs(pitDraw.y - pitB.y) < 0.01 &&
  Math.abs(pitDraw.w - pitB.s) < 0.01, '凹坑贴图铺满该格');
eq(MAIN.ops.fill, 0, '有凹坑贴图时不再叠程序化碎石多边形');

// 未解码 / 键缺失：BM.ART.one 返回 null → 程序化回退
installArt('null');
artCalls.length = 0; drawLog.length = 0; MAIN.ops.drawImage = 0; MAIN.ops.fill = 0;
let nullThrew = false;
try { GRID.draw(MAIN); } catch (e) { nullThrew = true; }
ok(!nullThrew, 'BM.ART.one 全返回 null 时 draw 不抛错');
ok(artCalls.length >= 48, '仍逐格查询 BM.ART（拿到 null 即回退）', 'calls=' + artCalls.length);
ok(MAIN.ops.drawImage >= 47, '回退后画预渲染纹理（48 格 − 已挖空 1）', 'drawImage=' + MAIN.ops.drawImage);
ok(mainDraws().every((d) => typeof d.img.tag !== 'string'), '回退时画的都是预渲染 canvas，不是贴图');
ok(MAIN.ops.fill > 0, '回退时凹坑用程序化碎石多边形');

// 完全没有 BM.ART（旧环境）
dropArt();
MAIN.ops.drawImage = 0;
let noArtThrew = false;
try { GRID.draw(MAIN); } catch (e) { noArtThrew = true; }
ok(!noArtThrew, '没有 BM.ART 时 draw 不抛错');
ok(MAIN.ops.drawImage >= 47, '没有 BM.ART 时全部走程序化纹理', 'drawImage=' + MAIN.ops.drawImage);
ok(MAIN.imageSmoothingEnabled === true, '注入贴图后 draw 仍恢复 imageSmoothingEnabled');

// ---------- 14. 每层独立随机矿物 + 分层可视化 ----------
section('14) 每层独立随机矿物（深度偏置）');
const RARE_RATE = [];    // 深度 → { crystal, iron } 抽样计数
let sameCells = 0, cellTotal = 0;
const layerKinds = new Set();
// 采样量 1200 局：偏离 1.6σ 的相邻层落差（d0→d1 只差 0.008）原本约 5% 概率翻车，加大样本把噪声压下去
for (let i = 0; i < 1200; i++) {
  GRID.build('crystalcave');
  for (const b of GRID.flat) {
    const kinds = new Set();
    for (let d = 0; d < b.stack.length; d++) {
      const ore = b.stack[d].ore;
      kinds.add(ore);
      layerKinds.add(ore);
      if (!RARE_RATE[d]) RARE_RATE[d] = { iron: 0, crystal: 0 };
      RARE_RATE[d][ore]++;
    }
    cellTotal++;
    if (kinds.size < 2) sameCells++;    // 整根柱子同一种矿 = 用户反馈的「一根柱子」
  }
}
ok(layerKinds.size === 2, '12 层独立抽样后仍只用晶洞层的两种矿', [...layerKinds].join(','));
ok(1 - sameCells / cellTotal >= 0.95,
  '1200 次统计：≥95% 的格子 10–12 层里出现 ≥2 种矿（不再从顶到底同一种矿）',
  '同矿柱 ' + sameCells + '/' + cellTotal);

// 深度偏置：第 d 层把稀有矿（非填充矿）权重 +4%/层，第 12 层 ≈ +44%
const rareShare = (d) => RARE_RATE[d].crystal / (RARE_RATE[d].crystal + RARE_RATE[d].iron);
const rr0 = rareShare(0), rr1 = rareShare(1), rr9 = rareShare(9), rr11 = rareShare(11);
ok(rr9 > rr0 + 0.04, '第 10 层晶石出现率显著高于第 1 层（深度偏置生效）',
  'd0=' + rr0.toFixed(3) + ' d9=' + rr9.toFixed(3));
ok(rr0 < rr1 && rr1 < rr9 && rr9 < rr11, '晶石占比随深度单调上升',
  [rr0, rr1, rr9, rr11].map((v) => v.toFixed(3)).join(' → '));
near(rr1, 30 * 1.04 / (70 + 30 * 1.04), 0.02, '第 2 层晶石占比 ≈ 0.308（30×1.04 / (70+31.2)）');
near(rr11, 30 * 1.44 / (70 + 30 * 1.44), 0.02, '第 12 层晶石占比 ≈ 0.382（30×1.44 / (70+43.2)）');

// 富矿也每层独立掷：深层富矿率贴近该矿 richRate，且与顶层是否富矿无关
let deepRich = 0, deepN = 0, topRich = 0, topN = 0;
let dRichInRich = 0, dNInRich = 0, dRichInNot = 0, dNInNot = 0;
for (let i = 0; i < 120; i++) {
  GRID.build('crystalcave');
  for (const b of GRID.flat) {
    topN++; if (b.stack[0].rich) topRich++;
    for (let d = 1; d < b.stack.length; d++) {
      const rich = b.stack[d].rich;
      deepN++; if (rich) deepRich++;
      if (b.stack[0].rich) { dNInRich++; if (rich) dRichInRich++; }
      else { dNInNot++; if (rich) dRichInNot++; }
    }
  }
}
near(topRich / topN, 0.106, 0.02, '顶层富矿率 ≈ 0.7×0.10 + 0.3×0.12 = 0.106（优先落在矿脉里）');
near(deepRich / deepN, 0.107, 0.02, '深层富矿率 ≈ 0.107，每层按该层矿种 richRate 独立掷');
ok(deepRich > 0 && deepRich < deepN, '深层有富矿也有非富矿（是随机的，不是常量）');
ok(Math.abs(dRichInRich / dNInRich - dRichInNot / dNInNot) < 0.03,
  '深层富矿与顶层是否富矿基本无关（每层独立掷，不照抄顶层）',
  '顶层富 → ' + (dRichInRich / dNInRich).toFixed(3) + ' / 顶层不富 → ' + (dRichInNot / dNInNot).toFixed(3));

section('14b) 分层可视化：下一层预览条');
eq(GRID._previewThickness(1), 0, '只有 1 层（下面没有矿）→ 不画预览条');
eq(GRID._previewThickness(2), 4, '普通格预览条 4px');
eq(GRID._previewThickness(9), 4, '9 层仍是 4px');
eq(GRID._previewThickness(10), 5, '层数 ≥10 → 预览条 5px');
eq(GRID._previewThickness(12), 5, '12 层 → 5px');
eq(GRID._previewColor('crystal'), CONFIG.ores.crystal.vein, '预览色取 CONFIG.ores[].vein（晶石）');
eq(GRID._previewColor('iron'), CONFIG.ores.iron.vein, '预览色取 CONFIG.ores[].vein（铁）');

installArt('img');            // 贴图路径下也照样画预览条（fillRect，与贴图无关）
GRID.build('quarry');
settle();
const pvB = GRID.flat.find((b) => b.layers >= 3 && GRID._nextOre(b) && GRID._nextOre(b) !== b.ore);
ok(!!pvB, '找到一格「下一层是别的矿」的方块');
eq(GRID._nextOre(pvB), pvB.stack[pvB.depth + 1].ore, '_nextOre = 尚未露出的那一层的 ore');
eq(GRID._nextOre(Object.assign({}, pvB, { layers: 1 })), null, '只剩 1 层时没有「下一层」');
const pvBarH = GRID._previewThickness(pvB.layers);
eq(pvBarH, 4, '普通格（6–8 层）色条厚 4px');
const pvTop = pvB.y + pvB.s - pvBarH;              // 色条顶边 y
rectLog.length = 0;
GRID.draw(MAIN);
const pvBar = rectLog.find((r) => Math.abs(r.x - (pvB.x + 1)) < 0.01 &&
  Math.abs(r.y - pvTop) < 0.01 && Math.abs(r.w - (pvB.s - 2)) < 0.01 &&
  Math.abs(r.h - pvBarH) < 0.01);
ok(!!pvBar, '方块底部内侧画出 4px 下层矿色条（x+1 / 宽 s-2 / 底边对齐 / 高 4）',
  pvBar ? 'y=' + pvBar.y + ' h=' + pvBar.h + ' want y=' + pvTop : 'not found');
eq(pvBar ? pvBar.style : null, CONFIG.ores[GRID._nextOre(pvB)].vein,
  '预览条颜色 = 下一层矿的 vein（不是本层矿色）');
ok(!!pvBar && pvBar.style !== CONFIG.ores[pvB.ore].vein, '本层与下层矿色不同 → 一条就能看出「下面还有别的矿」');
// 色条正上方 1px 深色分隔线：整格宽、紧贴色条顶边
const pvSep = rectLog.find((r) => Math.abs(r.x - pvB.x) < 0.01 &&
  Math.abs(r.y - (pvTop - 1)) < 0.01 && Math.abs(r.w - pvB.s) < 0.01 && Math.abs(r.h - 1) < 0.01);
ok(!!pvSep && pvSep.style === '#1e2022', '色条上方 1px 深色分隔线，把色条与本层块面硬切开',
  pvSep ? pvSep.style + ' y=' + pvSep.y : 'not found');
// 色条顶边 1px 同色高光（「露出一角」的矿）
const pvHi = rectLog.find((r) => Math.abs(r.x - (pvB.x + 1)) < 0.01 &&
  Math.abs(r.y - pvTop) < 0.01 && Math.abs(r.w - (pvB.s - 2)) < 0.01 && Math.abs(r.h - 1) < 0.01);
ok(!!pvHi && pvHi.style === GRID._previewHi(GRID._nextOre(pvB)),
  '色条顶边 1px 同色高光（比 vein 更亮一档）', pvHi ? pvHi.style : 'not found');

GRID.build('crystalcave');
settle();
const pvDeep = GRID.flat.find((b) => b.layers >= 10 && GRID._nextOre(b));
eq(GRID._previewThickness(pvDeep.layers), 5, '晶洞层 ≥10 → 色条厚 5px');
rectLog.length = 0;
GRID.draw(MAIN);
ok(rectLog.some((r) => Math.abs(r.x - (pvDeep.x + 1)) < 0.01 &&
  Math.abs(r.y - (pvDeep.y + pvDeep.s - 5)) < 0.01 &&
  Math.abs(r.w - (pvDeep.s - 2)) < 0.01 && Math.abs(r.h - 5) < 0.01),
  '晶洞层（10–12 层）预览条加厚到 5px（贴块底边、宽 s-2）');

// 换层后预览条跟着换：色条取新的 stack[depth+1]
const pv3 = GRID.flat.find((b) => b.layers >= 3);
GRID.damage(pv3, pv3.maxHp, 0);      // 刚好打穿一层（晶洞层血量 120/240，给足一层血）
settle(2);
eq(pv3.depth, 1, '预览条测试格已换到第 2 层');
pv3.layerT = 0; pv3.hitT = 0;
const pv3BarH = GRID._previewThickness(pv3.layers);
rectLog.length = 0;
GRID.draw(MAIN);
const pvBar2 = rectLog.find((r) => Math.abs(r.x - (pv3.x + 1)) < 0.01 &&
  Math.abs(r.y - (pv3.y + SINK + pv3.s - pv3BarH)) < 0.01 && Math.abs(r.w - (pv3.s - 2)) < 0.01);
ok(!!pvBar2 && pvBar2.style === CONFIG.ores[pv3.stack[pv3.depth + 1].ore].vein,
  '换层后预览条换成新的下一层矿色', pvBar2 ? pvBar2.style : 'not found');

section('14c) 换层动效：layerT 通道 → 6px 从下往上滑入 + 一次短暂亮边');
GRID.build('quarry');
settle();
const animB = GRID.flat.find((b) => b.layers >= 3 && !b.broken);
const animLayers = animB.layers;
GRID.damage(animB, 99, 0);
eq(animB.layers, animLayers - 1, '打穿一层');
eq(animB.layerT, 1, 'block:layer 写入 layerT = 1（换层动效通道）');
eq(GRID._layerSlide, 6, '滑入幅度常量 = 6px');
animB.hitT = 0; animB.appearT = 1;
const animTag = 'tiles.ore.' + animB.ore + '.' + (animB.rich ? 'rich' : 'normal') + '#' + animB.seed;
drawLog.length = 0; rectLog.length = 0;
GRID.draw(MAIN);
const slideY = drawLog.filter((d) => d.ctx === MAIN && d.img.tag === animTag).map((d) => d.y);
ok(slideY.some((y) => Math.abs(y - (animB.y + SINK + 6)) < 0.01),
  '换层瞬间新方块从下方 6px 滑入（下沉 2 + 滑入 6）', slideY.join(','));
const flashRects = rectLog.filter((r) => /^rgba\(255,250,235,/.test(String(r.style)));
ok(flashRects.length >= 4, '换层瞬间画出一次短暂亮边（四边）', 'rects=' + flashRects.length);

settle(6);
eq(animB.layerT, 0, 'layerT 衰减回 0（亮边/滑入只持续一瞬）');
animB.hitT = 0;
drawLog.length = 0; rectLog.length = 0;
GRID.draw(MAIN);
const restY = drawLog.filter((d) => d.ctx === MAIN && d.img.tag === animTag).map((d) => d.y);
ok(restY.some((y) => Math.abs(y - (animB.y + SINK)) < 0.01), '动效结束后回位（只剩 2px 下沉）', restY.join(','));
eq(rectLog.filter((r) => /^rgba\(255,250,235,/.test(String(r.style))).length, 0, 'layerT = 0 时不再画亮边');

section('14d) 深度标识：剩余层数小方点');
const DOT_BANDS = [[0, 0], [1, 1], [5, 1], [6, 2], [9, 2], [10, 3], [12, 3], [20, 3]];
ok(DOT_BANDS.every(([layers, dots]) => GRID._layerDots(layers) === dots),
  '点位数与 layers 区间对应（0→0 / 1–5→1 / 6–9→2 / ≥10→3）',
  DOT_BANDS.map(([l, d]) => l + '→' + GRID._layerDots(l)).join(' '));

GRID.build('crystalcave');
settle();
rectLog.length = 0;
GRID.draw(MAIN);
const dotRects = rectLog.filter((r) => /^rgba\(255,246,225,/.test(String(r.style)));
let wantDots = 0;
for (const b of GRID.flat) if (!b.broken && b.appearT > 0) wantDots += GRID._layerDots(b.layers);
eq(dotRects.length, wantDots, '点位总数 = Σ _layerDots(layers)（48 格 × 3 点）');
ok(GRID.flat.every((b) => GRID._layerDots(b.layers) === 3), '晶洞层 10–12 层 → 每格 3 点');
ok(dotRects.every((r) => !!GRID.at(r.x + r.w / 2, r.y + r.h / 2)), '点位画在方块内部（底部内侧）');
ok(dotRects.every((r) => r.w >= 3 && r.w <= 5 && r.h === r.w), '点位是小方点（3–5px 见方）',
  [...new Set(dotRects.map((r) => r.w))].join('/'));

// 徽标几何：点位 4px 见方、右侧对齐、压在 1px 分隔线上方，每个点外圈 1px 深色描边
const gb = GRID.flat.find((b) => b.depth === 0 && GRID._layerDots(b.layers) === 3);
const gH = GRID._previewThickness(gb.layers);
const gBarTop = gb.y + gb.s - gH;
const gDs = GRID._dotSize(gb.s);
const gDots = dotRects.filter((r) => r.x >= gb.x - 0.01 && r.x + r.w <= gb.x + gb.s + 0.01 &&
  r.y >= gb.y - 0.01 && r.y + r.h <= gb.y + gb.s + 0.01);
eq(gDs, 4, '点位边长 = clamp(round(fw*0.075), 3, 5) → 4px（格宽 ' + gb.s + '）');
eq(gBarTop - gb.y, gb.s - 5, '≥10 层色条 5px，顶边落在 s-5');
eq(gDots.length, 3, '该格画出 3 个层数点位（≥10 层档）', 'dots=' + gDots.length);
eq(Math.round(gDots[0].y), gBarTop - gDs - 2, '点位底边紧贴分隔线（y = barTop - ds - 2）');
ok(gDots.every((r) => r.h === gDs && r.w === gDs), '点位 4px 见方', [...new Set(gDots.map((r) => r.w + 'x' + r.h))].join('/'));
eq(gDots[gDots.length - 1].x + gDs + 1, gb.x + gb.s - 2, '点位右对齐：最右点描边右边缘 = 块右内边（x+s-2）');
ok(gDots.every((r, i) => i === 0 || Math.abs(r.x - gDots[i - 1].x - (gDs + 3)) < 0.01),
  '点位间距 = 边长 + 3px', gDots.map((r) => Math.round(r.x - gb.x)).join('/'));
ok(gDots.every((r) => rectLog.some((e) => Math.abs(e.x - (r.x - 1)) < 0.01 &&
  Math.abs(e.y - (r.y - 1)) < 0.01 && Math.abs(e.w - (gDs + 2)) < 0.01 &&
  Math.abs(e.h - (gDs + 2)) < 0.01 && e.style === 'rgba(10,11,13,0.9)')),
  '每个点位外圈 1px 深色描边（亮灰石底上也分得开）');
ok(gDots.every((r) => r.y + r.h <= gBarTop - 1), '点位整体在深色分隔线上方，不压住色条');
GRID.build('quarry');
settle();
rectLog.length = 0;
GRID.draw(MAIN);
const qDots = rectLog.filter((r) => /^rgba\(255,246,225,/.test(String(r.style)));
eq(qDots.length, GRID.flat.filter((b) => b.appearT > 0).length * 2, '采石场 6–8 层 → 每格 2 点');

section('14e) 岩层分级（ZONES-V5 §1）：表层 / 蓝层 / 紫层 / 赤层');

// --- depth → band 区间映射：0–2 / 3–5 / 6–8 / 9–11，≥12 也归赤层 ---
const BAND_BY_DEPTH = [[0, 0], [1, 0], [2, 0], [3, 1], [4, 1], [5, 1], [6, 2], [7, 2], [8, 2],
  [9, 3], [10, 3], [11, 3], [12, 3], [15, 3], [20, 3]];
ok(BAND_BY_DEPTH.every(([d, band]) => GRID._band(d) === band),
  'depth 映射：0–2 表层 / 3–5 蓝层 / 6–8 紫层 / 9–11 赤层 / ≥12 夹到赤层',
  BAND_BY_DEPTH.map(([d, b2]) => d + '→' + GRID._band(d)).join(' '));
eq(GRID._band(-3), 0, '负 depth 归表层（不越界）');
eq(GRID._band('x'), 0, '非数字 depth 归表层（不抛错）');
eq(GRID._band(2.9), 0, '小数 depth 向下取整（2.9 → 表层）');

// --- 颜色与 alpha 全是 §1 表的常量 ---
const BAND_TINT_TBL = [null, 'rgba(70,120,255,0.18)', 'rgba(160,90,255,0.20)', 'rgba(255,90,70,0.20)'];
const BAND_EDGE_TBL = ['#2a2a2a', '#4d7cff', '#a05cff', '#ff5a46'];
const BAND_DOT_TBL = ['rgba(255,246,225,0.92)', 'rgba(70,120,255,0.92)',
  'rgba(160,90,255,0.94)', 'rgba(255,90,70,0.94)'];
ok([0, 1, 2, 3].every((i) => GRID._bandTint(i) === BAND_TINT_TBL[i]),
  '罩色 = §1 表常量（表层「无（原色）」→ null，其余 rgb + 0.18/0.20 alpha）',
  [0, 1, 2, 3].map((i) => i + ':' + GRID._bandTint(i)).join(' '));
ok([0, 1, 2, 3].every((i) => GRID._bandEdge(i) === BAND_EDGE_TBL[i]),
  '岩层描边色 = §1 表常量（#2a2a2a / #4d7cff / #a05cff / #ff5a46）',
  [0, 1, 2, 3].map((i) => GRID._bandEdge(i)).join(' '));
ok([0, 1, 2, 3].every((i) => GRID._bandDot(i) === BAND_DOT_TBL[i]),
  '点位填充色 = 当前岩层色（表层沿用原亮白，其余与罩色同色系）',
  [0, 1, 2, 3].map((i) => GRID._bandDot(i)).join(' '));
eq(GRID._bandEdgeWidth, 2, '方块内侧岩层描边宽度 = 2px');
ok(new Set([GRID._bandTint(1), GRID._bandTint(2), GRID._bandTint(3)]).size === 3,
  '三个带罩色互不相同（蓝 / 紫 / 赤一眼可分）');
ok(new Set([GRID._bandDot(1), GRID._bandDot(2), GRID._bandDot(3)]).size === 3,
  '三个带点位填充色互不相同');

// --- draw 层：逐带摆到对应 depth，罩色 / 描边 / 点位色都必须来自表 ---
GRID.build('crystalcave');
settle();
const bandB = GRID.flat.find((b) => !b.broken && b.stack.length >= 11);
ok(!!bandB, '找到一根 ≥11 层的柱子用于逐档验证');
if (bandB) {
  bandB.hitT = 0; bandB.layerT = 0; bandB.appearT = 1;
  const bandDepths = [0, 3, 6, 9];              // 每个带取一档（0–2 / 3–5 / 6–8 / 9–11）
  for (const depth of bandDepths) {
    const band = GRID._band(depth);
    bandB.depth = depth;
    bandB.layers = bandB.totalLayers - depth;
    const fy = bandB.y + (depth > 0 ? SINK : 0);   // depth > 0 整体下沉 2px
    const fx = bandB.x;
    const inside = (r) => r.x >= fx - 0.01 && r.x + r.w <= fx + bandB.s + 0.01 &&
      r.y >= fy - 0.01 && r.y + r.h <= fy + bandB.s + 0.01;
    bandB.hitT = 0; bandB.layerT = 0;
    rectLog.length = 0;
    GRID.draw(MAIN);
    const mine = rectLog.filter(inside);

    // 1) 罩色：整块面积，alpha 与 §1 表一致；表层不叠
    const tints = mine.filter((r) => Math.abs(r.w - bandB.s) < 0.01 && Math.abs(r.h - bandB.s) < 0.01 &&
      BAND_TINT_TBL.indexOf(String(r.style)) > 0);
    if (band === 0) {
      eq(tints.length, 0, '表层不叠罩色（保持原色）');
    } else {
      eq(tints.length, 1, '深度 ' + depth + '（' + band + ' 带）叠一层整块罩色');
      const want = BAND_TINT_TBL[band];
      eq(tints[0] ? tints[0].style : null, want, '罩色 = ' + want + '（§1 表里的常量）');
      ok(!!tints[0] && tints[0].alpha >= 0.99, '罩色用 globalAlpha 叠，不额外压暗整块', tints[0] ? tints[0].alpha : '');
    }

    // 2) 内侧 2px 岩层描边：四边各一条，颜色查表
    const edges = mine.filter((r) => String(r.style) === BAND_EDGE_TBL[band]);
    ok(edges.length === 4 && edges.every((r) => Math.abs(r.h - 2) < 0.01 || Math.abs(r.w - 2) < 0.01),
      '深度 ' + depth + ' 画出四边 2px 岩层描边（' + BAND_EDGE_TBL[band] + '）',
      'rects=' + edges.length);
    ok(edges.some((r) => Math.abs(r.y - fy) < 0.01 && Math.abs(r.w - bandB.s) < 0.01) &&
      edges.some((r) => Math.abs(r.y - (fy + bandB.s - 2)) < 0.01 && Math.abs(r.w - bandB.s) < 0.01),
      '描边贴在方块内侧（上沿 fy、下沿 fy+s-2）');

    // 3) 右下角层数点位：填充色 = 当前岩层色，1px 深色描边仍在
    const ds = GRID._dotSize(bandB.s);
    const dots = mine.filter((r) => Math.abs(r.w - ds) < 0.01 && Math.abs(r.h - ds) < 0.01 &&
      String(r.style) === BAND_DOT_TBL[band]);
    eq(dots.length, GRID._layerDots(bandB.layers), '深度 ' + depth + ' 点位填充色 = 当前岩层色（' + BAND_DOT_TBL[band] + '）');
    ok(dots.every((r) => mine.some((e) => Math.abs(e.x - (r.x - 1)) < 0.01 && Math.abs(e.y - (r.y - 1)) < 0.01 &&
      Math.abs(e.w - (ds + 2)) < 0.01 && e.style === 'rgba(10,11,13,0.9)')),
      '点位仍带 1px 深色描边（换层后颜色变了，边界还在）');

    // 4) 下一层矿色条保留：颜色仍取 nextOre 的 vein
    const nx = GRID._nextOre(bandB);
    if (nx && bandB.layers >= 2) {
      const barH = GRID._previewThickness(bandB.layers);
      const bar = mine.find((r) => Math.abs(r.x - (fx + 1)) < 0.01 &&
        Math.abs(r.y - (fy + bandB.s - barH)) < 0.01 && Math.abs(r.h - barH) < 0.01);
      eq(bar ? bar.style : null, CONFIG.ores[nx].vein,
        '深度 ' + depth + ' 下一层矿色条仍取 nextOre（' + nx + '）的 vein');
    }
  }

  // 换层跨带：depth 2 → 3 时表层换蓝层，罩色跟着出现
  bandB.depth = 2;
  bandB.layers = bandB.totalLayers - 2;
  GRID.damage(bandB, bandB.maxHp, 0);
  eq(bandB.depth, 3, '打穿一层：depth 2 → 3');
  eq(GRID._band(bandB.depth), 1, '跨过 3 层边界 → 表层换成蓝层（往下挖能看出换层）');
  bandB.hitT = 0; bandB.layerT = 0; bandB.appearT = 1;
  rectLog.length = 0;
  GRID.draw(MAIN);
  ok(rectLog.some((r) => r.style === BAND_TINT_TBL[1] && Math.abs(r.w - bandB.s) < 0.01),
    '打穿第 3 层后同一格开始叠蓝罩（岩层带跟着深度走）');
}

// --- 静态检查：draw 内零字符串拼接、零分配（颜色全部查表） ---
const drawAt = code.indexOf('draw: function (ctx) {');
let drawEnd = -1, braceDepth = 0;
for (let i = drawAt; i >= 0 && i < code.length; i++) {
  const ch = code[i];
  if (ch === '{') braceDepth++;
  else if (ch === '}') { braceDepth--; if (braceDepth === 0) { drawEnd = i + 1; break; } }
}
const drawBody = drawAt >= 0 && drawEnd > drawAt ? code.slice(drawAt, drawEnd) : '';
ok(drawBody.length > 500, '截出 draw() 函数体用于静态检查', 'len=' + drawBody.length);
ok(!/\+\s*['"]/.test(drawBody) && !/['"][^'"]*['"]\s*\+/.test(drawBody),
  'draw 内零字符串拼接（罩色/描边/点位色全部查表常量）');
ok(!/new\s+[A-Za-z_]+\s*\(/.test(drawBody) && !/=\s*\[\s*\]/.test(drawBody) && !/=\s*\{\s*\}/.test(drawBody),
  'draw 内零分配（无 new / 空数组 / 空对象字面量）');
ok(['_band', '_bandTint', '_bandEdge', '_bandDot', '_bandEdgeWidth'].every((k) => GRID[k] !== undefined),
  '岩层带查表 API 已导出（测试与调试可核对常量）');


// ---------- 22. 宝藏格：spawnTreasure ----------
section('22) 宝藏格：spawnTreasure 只在中心区域的存活格里替换一格');
{
  GRID.build('crystalcave');
  const cols = CONFIG.zones[2].cols, rows = CONFIG.zones[2].rows;
  const t = GRID.spawnTreasure();
  ok(!!t, 'spawnTreasure() 返回被替换的那一格');
  eq(t.treasure, true, 'b.treasure = true');
  eq(t.ore, 'treasure', "b.ore = 'treasure'");
  eq(t.rich, false, 'b.rich = false');
  eq(t.maxHp, 3000, 'b.maxHp = 3000（V6-ENDGAME §3）');
  eq(t.hp, 3000, 'b.hp = maxHp');
  eq(t.layers, 1, 'b.layers = 1（共振一次就破）');
  eq(t.totalLayers, 1, 'b.totalLayers = 1');
  eq(t.broken, false, '生成时不是坑洞');
  ok(t.ox >= Math.floor(cols * 0.25) && t.ox < cols * 0.75 &&
     t.oy >= Math.floor(rows * 0.25) && t.oy < rows * 0.75,
    '落在棋盘中心区域（ox=' + t.ox + ', oy=' + t.oy + '）');
  eq(t.stack.length, 1, 'stack 换成单层宝藏（换层不会翻出原矿层）');
  eq(t.stack[0].ore, 'treasure', 'stack[0].ore = treasure');
  ok(GRID.at(t.x + t.s * 0.5, t.y + t.s * 0.5) === t, '生成后 GRID.at() 仍能点中它');

  // 自定义 hp
  GRID.build('crystalcave');
  const h = GRID.spawnTreasure(1200);
  eq(h.hp, 1200, 'spawnTreasure(hp) 用传入的 hp');

  // 反复生成：仍只落在中心区域，且不会二次替换同一格
  let allCenter = true, allFresh = true;
  for (let i = 0; i < 8; i++) {
    GRID.build('crystalcave');
    const b = GRID.spawnTreasure();
    if (!b) { allFresh = false; break; }
    if (!(b.ox >= Math.floor(cols * 0.25) && b.ox < cols * 0.75 &&
          b.oy >= Math.floor(rows * 0.25) && b.oy < rows * 0.75)) allCenter = false;
    const marked = GRID.flat.filter((x) => x.treasure).length;
    if (marked !== 1) allFresh = false;
  }
  ok(allCenter, '8 次随机生成都落在中心区域');
  ok(allFresh, '每局只有一个宝藏格（已挖空/已标记的格不会被再挑中）');

  GRID.clear();
  eq(GRID.spawnTreasure(), null, '空棋盘 spawnTreasure() 返回 null');
}

// ---------- 23. 宝藏耐久：工具伤害走 hp，TNT 不秒杀，共振 1 点剥层 ----------
section('23) 宝藏格耐久：工具伤害走 hp，TNT 不秒杀，共振 1 点直接剥层');
{
  const fresh = () => {
    GRID.build('crystalcave');
    const b = GRID.spawnTreasure();
    settle(10);
    return b;
  };

  const t = fresh();
  let r = GRID.damage(t, 200, -Math.PI / 2);
  eq(t.hp, 2800, '普通工具 200 伤害 → hp 3000 - 200');
  eq(t.broken, false, '工具伤害不会秒破宝藏');
  eq(r.broke, false, 'damage() 返回 broke=false');

  bus.log.length = 0;
  r = GRID.damage(t, 1, 0);
  eq(r.broke, true, '共振口径（1 点）→ 直接剥掉唯一的层');
  eq(t.broken, true, '宝藏破');
  const open = events('treasure:open');
  eq(open.length, 1, '派发 1 次 treasure:open');
  ok(open[0] && Math.abs(open[0].data.x - (t.x + t.s * 0.5)) < 1e-6 &&
     Math.abs(open[0].data.y - (t.y + t.s * 0.5)) < 1e-6, 'treasure:open 坐标 = 宝箱格中心');
  eq(events('block:empty').length, 1, '同帧 block:empty 照常派发');
  eq(events('treasure:open').length, 1, 'treasure:open 只派发一次（不会重复）');

  // TNT（damageLayers）：只挨一份伤害、打不死
  const t2 = fresh();
  bus.log.length = 0;
  const r2 = GRID.damageLayers(t2, 999999, 3);
  eq(r2.layersBroken, 0, 'TNT 不产生「打穿层数」');
  eq(t2.broken, false, 'TNT 不秒杀宝藏');
  eq(t2.hp, 1, 'TNT 这一发把 hp 压到 1（留一口气，不能秒）');
  const hitCount = events('block:hit').filter((e) => e.data.block === t2).length;
  eq(hitCount, 1, '只结算 1 份普通伤害（不按穿透层数重复）');

  // 共振两次：第一次剥层已破，第二次对坑洞无副作用
  const t3 = fresh();
  bus.log.length = 0;
  eq(GRID.damage(t3, 1, 0).broke, true, '新宝藏同样被共振 1 点剥层');
  eq(GRID.damage(t3, 1, 0).broke, false, '对已破格再打不报错、不重复派发');
  eq(events('treasure:open').length, 1, '已破格不会重复 treasure:open');

  // 普通格被挖空不会误发 treasure:open
  GRID.build('crystalcave');
  const plain = GRID.blocks[0][0];
  bus.log.length = 0;
  GRID.damage(plain, 999999, -Math.PI / 2);
  eq(events('treasure:open').length, 0, '普通格挖空不派发 treasure:open');
}

// ---------- 24. 宝箱绘制：32×32 像素风 + 呼吸光柱 + tiles.treasure 优先 ----------
section('24) 宝箱绘制：木箱体 / 2px 描边 / 金锁扣 / 呼吸光柱 / tiles.treasure 优先');
{
  dropArt();
  GRID.build('crystalcave');
  const t = GRID.spawnTreasure();
  settle(10);
  GRID.draw(MAIN);

  const inCell = (r) => r.x >= t.x - 0.01 && r.x + r.w <= t.x + t.s + 0.01 &&
    r.y >= t.y - 0.01 && r.y + r.h <= t.y + t.s + 0.01;
  const cell = rectLog.filter(inCell);
  const count = (col) => cell.filter((r) => String(r.style) === col).length;
  ok(count('#6b4a2f') >= 2, '木箱体 #6b4a2f：盖 + 箱体各一块', count('#6b4a2f'));
  ok(count('#8a6440') >= 2, '高光 #8a6440：盖顶 + 左右内高光', count('#8a6440'));
  ok(count('#2a1c10') >= 3, '2px 深色描边 #2a1c10 至少 3 块', count('#2a1c10'));
  ok(count('#ffc857') >= 1 && count('#b8862a') >= 1, '金色锁扣 #ffc857 + 暗金底座 #b8862a');
  ok(cell.some((r) => Math.abs(r.h - 2 * (t.s / 32)) < 0.01 || Math.abs(r.w - 2 * (t.s / 32)) < 0.01),
    '描边宽度按 2 个逻辑像素缩放（32×32 像素风）');

  // 顶部光柱：画在格子上方，alpha 落在 0.15–0.35
  const beam = rectLog.filter((r) => String(r.style) === '#ffc857' && r.y < t.y);
  ok(beam.length >= 1, '宝箱上方画出金色光柱（从格子上方延伸进来）', beam.length);
  ok(beam.every((r) => r.alpha >= 0.149 && r.alpha <= 0.351),
    '光柱 alpha 在 0.15–0.35（缓慢呼吸）', beam.map((r) => r.alpha.toFixed(3)).join(','));

  // 呼吸：两次 draw 之间 alpha 不同
  const a1 = beam.length ? beam[0].alpha : 0;
  GRID.update(0.4);
  drawLog.length = 0; rectLog.length = 0;
  GRID.draw(MAIN);
  const beam2 = rectLog.filter((r) => String(r.style) === '#ffc857' && r.y < t.y);
  ok(beam2.length >= 1 && Math.abs(beam2[0].alpha - a1) > 1e-4,
    '光柱 alpha 随时间变化（呼吸）', a1.toFixed(3) + ' -> ' + (beam2[0] ? beam2[0].alpha.toFixed(3) : 'n/a'));

  // 宝藏格不再走矿物贴图路径
  ok(!drawLog.some((d) => d.ctx === MAIN && Math.abs(d.x - t.x) < 0.01 && Math.abs(d.y - t.y) < 0.01 &&
    Math.abs(d.w - t.s) < 0.01),
    '宝藏格不画矿物贴图（改用代码绘制）');

  // BM.ART.tiles.treasure 优先
  installArt('img');
  const before = MAIN.ops.drawImage;
  drawLog.length = 0; rectLog.length = 0;
  GRID.draw(MAIN);
  const artDraw = drawLog.find((d) => d.ctx === MAIN && d.img && String(d.img.tag) === 'tiles.treasure#' + (t.seed % 8));
  ok(!!artDraw, '有 tiles.treasure 贴图时优先用图', artCalls.filter((c) => c.key === 'tiles.treasure').length + ' 次查询');
  ok(MAIN.ops.drawImage > before, '走 drawImage 绘制宝箱');
  const trFills = rectLog.filter((r) => String(r.style) === '#6b4a2f');
  eq(trFills.length, 0, '用图时不再画代码木箱体');
  dropArt();
  GRID.draw(MAIN);
  ok(rectLog.some((r) => String(r.style) === '#6b4a2f'), '没有贴图时回退代码宝箱');
}

// ---------- 25. 端到端：04-tools 阈值共振 → 真 GRID 全屏剥离 → 宝藏破 ----------
section('25) 端到端：阈值共振打穿真棋盘，全屏各掉一层，宝藏被共振破');
{
  const TOOLS_SRC = readFileSync(join(here, '..', 'src', '04-tools.js'), 'utf8');
  globalThis.window = globalThis;
  vm.runInThisContext(TOOLS_SRC, { filename: 'src/04-tools.js' });
  const TOOLS = globalThis.BM.TOOLS;
  ok(!!TOOLS, 'BM.TOOLS 已挂载（与 03-grid 同时运行）');

  setMods({ resonanceThreshold: 1 });
  TOOLS.init(null);
  GRID.build('crystalcave');
  const t = GRID.spawnTreasure();
  settle(10);
  const alive = GRID.aliveCells();
  const layersBefore = GRID.flat.map((cell) => cell.layers);

  // 记录共振对每格的调用口径
  const calls = [];
  const realStrip = GRID.stripLayer.bind(GRID);
  GRID.stripLayer = function (b) { calls.push({ b }); return realStrip(b); };
  bus.log.length = 0;
  bus.emit('block:layer', { block: GRID.blocks[0][0], depth: 1 });
  GRID.stripLayer = realStrip;

  const blast = events('resonance:blast');
  eq(blast.length, 1, '阈值（1）达成立刻触发 1 次 resonance:blast');
  eq(blast[0].data.cells, alive, 'cells = 触发瞬间的存活格数 = ' + alive);
  const mid = GRID.blocks[(GRID.blocks.length / 2) | 0][(GRID.blocks[0].length / 2) | 0];
  near(blast[0].data.x, mid.x + mid.s * 0.5, 1e-6, 'x = 棋盘中心世界坐标');
  near(blast[0].data.y, mid.y + mid.s * 0.5, 1e-6, 'y = 棋盘中心世界坐标');
  eq(calls.length, alive, '存活格各被调用一次 stripLayer（全屏剥离，跳过空坑）');
  eq(new Set(calls.map((c) => c.b)).size, alive, '每格只剥一次（同格不重复）');

  // 数值验证：一次共振真的让全场每格少一层（而不是 1 点伤害擦破皮）
  let stepped = 0, emptied = 0, bad = 0;
  for (let i = 0; i < GRID.flat.length; i++) {
    const cell = GRID.flat[i];
    const before = layersBefore[i];
    if (cell.broken) {
      if (before === 1) { emptied++; stepped++; } else bad++;
    } else if (cell.layers === before - 1) stepped++;
    else bad++;
  }
  eq(bad, 0, '没有格被多剥或少剥');
  eq(stepped, GRID.flat.length, '一次共振让全场 ' + GRID.flat.length + ' 格各正好少一层');
  eq(emptied, 1, '只有 1 层的宝藏格被清空（其余晶洞格 10–12 层仍在）');
  eq(events('block:hit').length, 0, '共振走 stripLayer → 不产生 block:hit');
  eq(t.broken, true, '宝藏被共振剥掉');
  const open = events('treasure:open');
  eq(open.length, 1, '共振破宝藏 → treasure:open');
  near(open[0].data.x, t.x + t.s * 0.5, 1e-6, 'treasure:open 坐标 = 宝箱中心');
  const magnet = events('magnet:burst');
  eq(magnet.length, 1, '共振同时触发 magnet:burst（全屏吸入）');
  eq(magnet[0].data.all, true, 'magnet:burst.all = true');
  near(magnet[0].data.x, blast[0].data.x, 1e-6, '吸入原点 = 冲击波原点');

  // 每局最多 3 次；计数清零后可再次累计
  TOOLS.reset();
  bus.log.length = 0;
  for (let i = 0; i < 10; i++) bus.emit('block:layer', { block: GRID.blocks[0][0], depth: 1 });
  eq(events('resonance:blast').length, 3, '每局最多触发 3 次（10 次触发条件只出 3 次）');
  eq(TOOLS.resonanceUsed, 3, 'resonanceUsed = 3');
  eq(TOOLS.resonanceMax, 3, 'resonanceMax = 3');
  eq(TOOLS.resonanceCount, 0, '每次触发后累计计数清零');

  TOOLS.setZone({ id: 'crystalcave' });
  eq(TOOLS.resonanceUsed, 0, 'setZone()（新一局）清零已触发次数');
  eq(TOOLS.resonanceCount, 0, 'setZone() 清零累计计数');
  bus.log.length = 0;
  bus.emit('block:layer', { block: GRID.blocks[0][0], depth: 1 });
  eq(events('resonance:blast').length, 1, '新一局可以重新触发');

  // 未解锁（阈值 <= 0）不参与，也不影响别的事件
  setMods({});
  TOOLS.reset();
  bus.log.length = 0;
  for (let i = 0; i < 30; i++) bus.emit('block:layer', { block: GRID.blocks[0][0], depth: 1 });
  eq(events('resonance:blast').length, 0, 'resonanceThreshold = 0（未解锁）不触发共振');
  eq(TOOLS.resonanceCount, 0, '未解锁时累计计数保持 0');

  // 阈值 3 = 打满 3 层才触发（含 block:empty 计 1 层）
  setMods({ resonanceThreshold: 3 });
  TOOLS.reset();
  bus.log.length = 0;
  bus.emit('block:layer', { block: GRID.blocks[0][0], depth: 1 });
  bus.emit('block:layer', { block: GRID.blocks[0][0], depth: 2 });
  eq(events('resonance:blast').length, 0, '累计 2 层未达阈值 3 → 不触发');
  eq(TOOLS.resonanceCount, 2, '累计计数 = 2');
  bus.emit('block:empty', { block: GRID.blocks[0][0], prev: {} });
  eq(events('resonance:blast').length, 1, '第 3 层（block:empty）达标 → 触发');
  eq(TOOLS.resonanceCount, 0, '触发后清零');
}

// ---------- 26. GRID.stripLayer：无视血量剥一层（共振口径） ----------
section('26) GRID.stripLayer：hp 820 也照剥一层、宝藏秒开、已破/非法参数返回 false 且无事件');
{
  setMods({});
  BM.TOOLS.reset();          // 04-tools 缓存 mods（只有 reset/setZone 才刷新）：确保阈值 0 的共振不介入本段
  GRID.build('crystalcave');

  // 深层关的厚血晶石：hp 数百到 820，1 点伤害永远打不穿
  const thick = GRID.flat.find((b) => !b.broken && !b.treasure && b.layers >= 2);
  ok(!!thick, '晶洞层存在多层普通格（layers >= 2）');
  const was = { layers: thick.layers, depth: thick.depth, ore: thick.ore, rich: thick.rich };
  thick.maxHp = 820;
  thick.hp = 820;
  bus.log.length = 0;
  eq(GRID.stripLayer(thick), true, 'stripLayer 返回 true');
  eq(thick.layers, was.layers - 1, 'hp 820 的晶石格照样少一层（无视血量）');
  eq(thick.depth, was.depth + 1, 'depth +1');
  const layer = events('block:layer');
  eq(layer.length, 1, '派发 1 次 block:layer');
  eq(layer[0].data.block, thick, 'block:layer.block = 这一格');
  eq(layer[0].data.depth, thick.depth, 'block:layer.depth = 新深度');
  eq(layer[0].data.prev.ore, was.ore, 'prev.ore = 被打掉那层的矿种');
  eq(layer[0].data.prev.rich, was.rich, 'prev.rich = 被打掉那层的富矿标记');
  eq(layer[0].data.prev.maxHp, 820, 'prev.maxHp = 被打掉那层的满血 820');
  eq(thick.hp, thick.maxHp, '换上的新层是满血');
  eq(thick.crack, 0, '新层裂纹清零');
  eq(thick.layerT, 1, 'layerT = 1（换层上弹）');
  eq(thick.hitT, 1, 'hitT = 1（与打穿一层同口径）');
  eq(events('block:break').length, 0, '还有层 → 不派发 block:break');
  eq(events('block:empty').length, 0, '还有层 → 不派发 block:empty');
  eq(events('block:hit').length, 0, '剥层不是「打一下」→ 不派发 block:hit');

  // 一路剥到破格：中间每层一次 block:layer，最后一层 block:break + block:empty
  const cell = GRID.flat.find((b) => !b.broken && !b.treasure && b.layers >= 2);
  const total = cell.layers;
  cell.maxHp = 820;
  cell.hp = 820;
  bus.log.length = 0;
  let n = 0;
  while (GRID.stripLayer(cell)) n++;
  eq(n, total, '从 ' + total + ' 层剥到破格正好 ' + total + ' 次（第 ' + (total + 1) + ' 次拿 false）');
  eq(cell.broken, true, '最后一层被剥掉 → 破格');
  eq(cell.layers, 0, 'layers 归零');
  eq(events('block:layer').length, total - 1, '中间 ' + (total - 1) + ' 层各派发 1 次 block:layer');
  eq(events('block:break').length, 1, '破格派发 1 次 block:break');
  eq(events('block:empty').length, 1, '破格派发 1 次 block:empty');
  eq(events('block:layer').every((e) => e.data.prev && typeof e.data.prev.maxHp === 'number'), true,
    '每层的 prev 都带被打掉那层的读数');
  eq(events('block:empty')[0].data.prev.ore, cell.ore, 'block:empty.prev 指向最后被打掉那层（矿种一致）');
  eq(events('treasure:open').length, 0, '普通格剥穿不派发 treasure:open');

  // 宝藏格：stripLayer 直接破格 + treasure:open（共振能秒宝藏，设计意图）
  const t = GRID.spawnTreasure();
  settle(10);
  bus.log.length = 0;
  eq(GRID.stripLayer(t), true, '宝藏格 stripLayer 返回 true');
  eq(t.broken, true, '宝藏格直接破格');
  eq(events('block:break').length, 1, '宝藏格派发 block:break');
  eq(events('block:empty').length, 1, '宝藏格派发 block:empty');
  const open = events('treasure:open');
  eq(open.length, 1, '宝藏格派发 1 次 treasure:open');
  near(open[0].data.x, t.x + t.s * 0.5, 1e-6, 'treasure:open 坐标 = 宝箱中心（x）');
  near(open[0].data.y, t.y + t.s * 0.5, 1e-6, 'treasure:open 坐标 = 宝箱中心（y）');

  // 已破格 / 非法参数：返回 false，且一个事件都不派发
  bus.log.length = 0;
  eq(GRID.stripLayer(t), false, '已破格再剥 → false');
  eq(GRID.stripLayer(null), false, 'null → false');
  eq(GRID.stripLayer(undefined), false, 'undefined → false');
  eq(GRID.stripLayer('stone'), false, '字符串（非法参数）→ false');
  eq(GRID.stripLayer(42), false, '数字（非法参数）→ false');
  eq(GRID.stripLayer({}), false, '缺 layers 的假格 → false');
  eq(GRID.stripLayer({ layers: 0 }), false, 'layers = 0 → false');
  eq(GRID.stripLayer({ layers: -3 }), false, 'layers < 0 → false');
  eq(GRID.stripLayer({ layers: NaN }), false, 'layers = NaN → false');
  eq(GRID.stripLayer({ broken: true, layers: 3 }), false, '已破碎 → false');
  eq(bus.log.length, 0, '以上调用一个事件都不派发（含 treasure:open）');
}


/* ---------- 15. 金矿（v10）：复用煤矿贴图 + 金色化 ---------- */
section('15) 金矿：复用煤矿贴图并金色化；无 ART 时程序化金色块（颜色明显区别于煤矿）');
const GOLD_ZONE = { id: 'goldZone', name: '金矿层', cols: 6, rows: 8, filler: 'gold',
  layerMin: 2, layerMax: 2, ores: [{ ore: 'gold', weight: 100, richRate: 0 }] };
function hueSat(rgb) {
  const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0.0001) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: mx > 0 ? d / mx : 0, v: mx };
}

// 15a) 没有 ART：程序化金色块
delete globalThis.BM.ART;
GRID.init(MAIN);
GRID.build(GOLD_ZONE);
settle();
ok(GRID.flat.every((b) => b.ore === 'gold'), '测试前置：48 格全是金矿', GRID.flat.slice(0, 3).map((b) => b.ore).join(','));
ok(!!GRID._tex.gold && GRID._tex.gold[0].length === 4 && GRID._tex.gold[1].length === 4,
  '金矿有独立的程序化纹理（普通 + 富矿各 4 变体）');
const goldTex = GRID._tex.gold[0];
drawLog.length = 0;
GRID.draw(MAIN);
const goldDrawsNoArt = drawLog.filter((d) => d.ctx === MAIN && goldTex.indexOf(d.img) >= 0);
ok(goldDrawsNoArt.length >= 40, '无 ART 时金矿格全部画在金色程序化纹理上', 'draws=' + goldDrawsNoArt.length);
ok(GRID._goldTint[0] === null && GRID._goldTint[1] === null, '无 ART 时金色化缓存为空（不走 tint 路径）');

const avgGold = GRID._texAvg.gold[0];
const avgCoal = GRID._texAvg.coal[0];
const hsGold = hueSat(avgGold), hsCoal = hueSat(avgCoal);
ok(hsGold.h > 25 && hsGold.h < 55, '金矿程序化纹理平均色色相落在金色区间（h=' + hsGold.h.toFixed(0) + '°）', 'avg=' + avgGold.join(','));
ok(hsGold.s > 0.45, '金矿纹理饱和度足够（不是灰块）s=' + hsGold.s.toFixed(2), 'avg=' + avgGold.join(','));
ok(hsCoal.s < 0.12, '煤矿纹理平均色是中性灰/黑（s=' + hsCoal.s.toFixed(2) + '）', 'avg=' + avgCoal.join(','));
ok(hsGold.s > hsCoal.s + 0.3 && Math.abs(hsGold.h - hsCoal.h) > 15,
  '金矿与煤矿的最终绘制色明显不同（Δh=' + Math.abs(hsGold.h - hsCoal.h).toFixed(0) + '°, Δs=' + (hsGold.s - hsCoal.s).toFixed(2) + '）');

// goldRamp：把灰度/黑色重映射到金色梯度（ART 金色化用的同一把尺子）
const rampMid = GRID._goldRamp(125, 125, 125).slice();
const rampDark = GRID._goldRamp(18, 18, 18).slice();
const rampLight = GRID._goldRamp(220, 220, 220).slice();
for (const [name, c] of [['中段', rampMid], ['暗端', rampDark], ['亮端', rampLight]]) {
  const hs = hueSat(c);
  ok(hs.h > 25 && hs.h < 55 && hs.s > 0.5, 'goldRamp ' + name + ' ' + c.join(',') + ' 落在金色区间（h=' + hs.h.toFixed(0) + '°, s=' + hs.s.toFixed(2) + '）');
}
ok(rampLight[0] > rampDark[0] && rampLight[1] > rampDark[1] && rampLight[2] > rampDark[2],
  'goldRamp 保持亮度顺序（暗斑仍比亮斑暗，纹理不被压平）', [rampDark, rampLight].map((c) => c.join(',')).join(' | '));

// 15b) 有 ART：贴图键复用煤矿 + build 期金色化缓存
const goldArtCalls = [];
function goldFakeImg(tag) { return { tag, width: 96, height: 96, naturalWidth: 96, naturalHeight: 96, complete: true }; }
globalThis.BM.ART = {
  keys: [], total: 0, has() { return true; }, progress() { return 1; },
  one() { return null; },
  all(key) {
    goldArtCalls.push(key);
    return key === 'tiles.ore.coal.normal' || key === 'tiles.ore.coal.rich'
      ? [goldFakeImg(key + '#0'), goldFakeImg(key + '#1')] : [];
  }
};
const realCreateEl = globalThis.document.createElement;
const tintCanvases = [];
globalThis.document.createElement = (tag) => {
  const cv = new FakeCanvas();
  cv.goldTint = true;
  const realGet = cv.getContext.bind(cv);
  cv.getContext = () => {
    const c2 = realGet();
    c2.drawImage = (img) => { cv.srcTag = img && img.tag; };
    c2.getImageData = (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(125) });
    c2.putImageData = (img) => { cv.tinted = img; };
    return c2;
  };
  tintCanvases.push(cv);
  return cv;
};
GRID.build(GOLD_ZONE);
settle();
globalThis.document.createElement = realCreateEl;
ok(goldArtCalls.indexOf('tiles.ore.coal.normal') >= 0 && goldArtCalls.indexOf('tiles.ore.coal.rich') >= 0,
  '金矿贴图键复用煤矿的键（tiles.ore.coal.normal / .rich）', goldArtCalls.join(','));
ok(Array.isArray(GRID._goldTint[0]) && GRID._goldTint[0].length === 2 && GRID._goldTint[1].length === 2,
  'build 期把煤矿贴图金色化成离屏图缓存（普通 2 张 / 富矿 2 张）',
  JSON.stringify([GRID._goldTint[0] && GRID._goldTint[0].length, GRID._goldTint[1] && GRID._goldTint[1].length]));
ok(tintCanvases.length >= 4 && tintCanvases.every((cv) => cv.goldTint && cv.tinted),
  '金色化走 离屏 canvas：drawImage → getImageData → putImageData（像素被重写）', 'canvases=' + tintCanvases.length);
ok(tintCanvases.every((cv) => /^tiles\.ore\.coal\./.test(String(cv.srcTag))), '金色化的源图就是煤矿贴图', tintCanvases.map((cv) => cv.srcTag).join(','));
drawLog.length = 0;
artCalls.length = 0;
GRID.draw(MAIN);
const goldDraws = drawLog.filter((d) => d.ctx === MAIN && GRID._goldTint[0].indexOf(d.img) >= 0);
ok(goldDraws.length >= 40, '有 ART 时金矿格画在金色化缓存上（不是煤矿原图）', 'draws=' + goldDraws.length);
ok(goldDraws.every((d) => tintCanvases.indexOf(d.img) >= 0), '画出来的确实是 tint 后的离屏 canvas');
ok(!artCalls.some((c) => /tiles\.ore\.gold/.test(c.key)), 'draw 内不再请求 tiles.ore.gold.*（金矿没有独立美术）', artCalls.map((c) => c.key).join(','));
ok(goldDraws.every((d) => d.w === GRID.flat[0].s && d.h === GRID.flat[0].s), '金色贴图铺满方块矩形');
ok(goldDraws.every((d) => d.smoothing === false), '金色贴图同样走硬边（imageSmoothingEnabled = false）');

// 位置：第 3 / 4 关的矿表
const CFG_REAL = globalThis.BM.CONFIG;
ok(!CFG_REAL.zones.some((z) => z.id === 'blueIron'), '（grid 用测试自带 CONFIG，不含七关：位置断言在 core.test 里）');

dropArt();
GRID.build('quarry');

// ---------- 汇总 ----------

// ---------- 汇总 ----------
console.log('\n────────────────────────────────────────');
console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) {
  console.log('失败项：');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('全部断言通过 ✓');
