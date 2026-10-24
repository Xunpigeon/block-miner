/* 集成层：回合流程 / 输入 / 主循环 / 绘制编排。规则逻辑一律委托给各模块。 */
(function () {
  'use strict';

  var BM = window.BM = window.BM || {};
  var D = BM.DESIGN;
  var stage = document.getElementById('stage');
  var ctx = stage.getContext('2d');
  var view = { w: 390, h: 844, scale: 1, ox: 0, oy: 0, dpr: 1 };
  var bgGrad = null;

  var ROUND = {
    state: 'idle',        // idle | running | settling | result
    zoneId: 'surface',
    seconds: 15,
    timeLeft: 0,
    settleIn: 0,
    tickAt: 0,
    rescued: false,
    counts: {},
    tool: 'wood'
  };

  var pointer = { down: false, x: 0, y: 0, id: null };
  var lastNow = 0;
  var perf = { ema: 1 / 60, sampled: 0, downgrades: 0, quality: 'high' };
  var bgT = 0;
  var BG_KEYS = ['bg.far', 'bg.mid', 'bg.near'];
  var BG_SUFFIX = ['.far', '.mid', '.near'];
  var bgZoneCache = { id: null, keys: null };

  // v5：7 关各有自己的三层背景（bg.zone.<zoneId>.far/mid/near）。
  // 关 id 只在这里拼一次并缓存，draw 内零分配；缺 key 时回落到通用 cave 背景。
  function bgKeysOf(zoneId) {
    if (bgZoneCache.id === zoneId) return bgZoneCache.keys;
    var keys = BG_KEYS;
    var art = BM.ART;
    if (zoneId && art && art.has) {
      var local = ['bg.zone.' + zoneId + BG_SUFFIX[0], 'bg.zone.' + zoneId + BG_SUFFIX[1], 'bg.zone.' + zoneId + BG_SUFFIX[2]];
      if (art.has(local[0]) || art.has(local[1]) || art.has(local[2])) keys = local;
    }
    bgZoneCache.id = zoneId;
    bgZoneCache.keys = keys;
    return keys;
  }

  // v6：多层视差。每层 256×422 像素图按 ×2 铺满（512×844 设计像素），只做横向平铺；
  // 远层慢、近层快，叠加缓慢的左右摇摆与近层上下浮动，让洞穴/天空"活"起来。
  var BG_DRIFT = [2, 5, 9];      // 持续横移 px/s
  var BG_SWAY = [5, 12, 22];     // 摇摆幅度 px
  var BG_BOB = [0, 1.5, 3.5];    // 上下浮动 px
  function drawBgLayers(ctx) {
    var art = BM.ART;
    var drew = false;
    var zoneId = bgZone();
    var keys = bgKeysOf(zoneId);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, D.w, D.h);
    ctx.clip();
    var prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    for (var i = 0; i < keys.length; i++) {
      var im = (art && art.one) ? art.one(keys[i], 0) : null;
      if (!im && keys[i] !== BG_KEYS[i]) im = (art && art.one) ? art.one(BG_KEYS[i], 0) : null;
      if (!im) continue;
      var tw = im.width * 2, th = D.h + 8;
      var off = bgT * BG_DRIFT[i] + Math.sin(bgT * 0.13 + i * 1.7) * BG_SWAY[i];
      off = ((off % tw) + tw) % tw;
      var by = -4 + Math.sin(bgT * 0.55 + i) * BG_BOB[i];
      for (var x = -off; x < D.w; x += tw) ctx.drawImage(im, Math.round(x), Math.round(by), tw, th);
      if (i === 0) {
        // 远景和中景之间加一层极淡的空气透视，拉开层次
        ctx.fillStyle = 'rgba(40,24,70,0.10)';
        ctx.fillRect(0, 0, D.w, D.h);
      }
      drew = true;
    }
    ctx.imageSmoothingEnabled = prevSmooth;
    var shaft = (art && art.one) ? art.one('bg.lightshaft', 0) : null;
    if (shaft) {
      for (var s = 0; s < 2; s++) {
        ctx.globalAlpha = 0.16 + 0.08 * Math.sin(bgT * 0.6 + s * 2.1);
        ctx.drawImage(shaft, 70 + s * 170 + Math.sin(bgT * 0.2 + s) * 18, -40, 120, D.h * 0.8);
      }
    }
    var dust = (art && art.one) ? art.one('bg.dust', 0) : null;
    if (dust) {
      ctx.globalAlpha = 0.5;
      var dx = (bgT * 6) % 256, dy = (bgT * 10) % 256;
      for (var yy = -256 + dy; yy < D.h; yy += 256) for (var xx = -256 + dx; xx < D.w; xx += 256) ctx.drawImage(dust, xx, yy);
    }
    ctx.globalAlpha = 1;
    // 顶 / 底两条淡色压边：保证 HUD 文字可读，又不把背景整片压黑
    var band = ctx.createLinearGradient(0, 0, 0, 120);
    band.addColorStop(0, 'rgba(20,12,32,0.55)');
    band.addColorStop(1, 'rgba(20,12,32,0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, D.w, 120);
    var band2 = ctx.createLinearGradient(0, D.h - 130, 0, D.h);
    band2.addColorStop(0, 'rgba(20,12,32,0)');
    band2.addColorStop(1, 'rgba(20,12,32,0.6)');
    ctx.fillStyle = band2;
    ctx.fillRect(0, D.h - 130, D.w, 130);
    if (!drew) {
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, D.w, D.h);
    }
    ctx.restore();
  }

  // 背景跟随「正在进行的这一局」的关卡；营地里跟随存档当前关
  function bgZone() {
    if (ROUND.state !== 'idle' && ROUND.zoneId) return ROUND.zoneId;
    return (BM.CORE && BM.CORE.state) ? BM.CORE.state.currentZone : null;
  }

  var motes = null;

  function initMotes() {
    motes = [];
    for (var i = 0; i < 34; i++) {
      motes.push({
        x: Math.random() * 390,
        y: Math.random() * 844,
        r: 0.8 + Math.random() * 1.8,
        sp: 6 + Math.random() * 16,
        ph: Math.random() * Math.PI * 2,
        a: 0.10 + Math.random() * 0.25
      });
    }
  }

  function drawAtmosphere(ctx) {
    // v6：关卡氛围粒子交给 06-juice（萤火 / 落叶 / 余烬 / 晶光…），缺模块时走下面的旧光柱 + 浮尘
    if (BM.JUICE && BM.JUICE.ambient) { BM.JUICE.ambient(ctx, bgT, bgZone()); return; }
    // 顶部斜射光柱：4 束，缓慢摆动
    for (var i = 0; i < 4; i++) {
      var bx = 40 + i * 92 + Math.sin(bgT * 0.25 + i) * 14;
      var w = 46 + i * 6;
      var g2 = ctx.createLinearGradient(bx, 0, bx + 120, D.h * 0.9);
      g2.addColorStop(0, 'rgba(255,208,150,0.085)');
      g2.addColorStop(0.6, 'rgba(255,190,130,0.035)');
      g2.addColorStop(1, 'rgba(255,190,130,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.moveTo(bx - w * 0.5, 0);
      ctx.lineTo(bx + w * 0.5, 0);
      ctx.lineTo(bx + w * 1.5 + 90, D.h * 0.92);
      ctx.lineTo(bx - w * 0.9 + 60, D.h * 0.92);
      ctx.closePath();
      ctx.fill();
    }
    // 浮尘：缓慢上升 + 横向摆动
    if (!motes) initMotes();
    for (var m = 0; m < motes.length; m++) {
      var p = motes[m];
      var y = (p.y - bgT * p.sp) % 844;
      if (y < 0) y += 844;
      var x = p.x + Math.sin(bgT * 0.6 + p.ph) * 12;
      ctx.globalAlpha = p.a * (0.6 + 0.4 * Math.sin(bgT * 1.3 + p.ph));
      ctx.fillStyle = '#ffd9a8';
      ctx.fillRect(x, y, p.r, p.r);
    }
    ctx.globalAlpha = 1;
  }

  function drawVignette(ctx) {
    var v = (BM.ART && BM.ART.one) ? BM.ART.one('bg.vignette', 0) : null;
    if (v) ctx.drawImage(v, 0, 0, D.w, D.h);
  }

  var DIAG = /diag/.test(location.hash);
  var diagErr = [];
  var evc = { hit: 0, brk: 0, spawn: 0, absorb: 0, warn: 0 };
  var origWarn = console.warn;
  console.warn = function () {
    evc.warn++;
    if (diagErr.length < 6) diagErr.push('WARN ' + Array.prototype.map.call(arguments, function (a) { return (a && a.message) || String(a); }).join(' ').slice(0, 90));
    return origWarn.apply(console, arguments);
  };
  window.addEventListener('error', function (e) { diagErr.push('ERR ' + (e.message || '') + ' @' + (e.lineno || 0)); });
  window.addEventListener('unhandledrejection', function (e) { diagErr.push('REJ ' + e.reason); });
  var tickCount = 0;
  var tapInfo = 'none';
  var DEMO = /demo/.test(location.hash);
  var demoAt = 0;

  function diagText() {
    var ui = document.getElementById('bm-ui');
    var r = ui ? ui.getBoundingClientRect() : null;
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, s = 0;
    for (var i = 0; i < BM.GRID.flat.length; i++) {
      var b = BM.GRID.flat[i];
      if (b.x < minX) minX = b.x;
      if (b.x + b.s > maxX) maxX = b.x + b.s;
      if (b.y < minY) minY = b.y;
      if (b.y + b.s > maxY) maxY = b.y + b.s;
      s = b.s;
    }
    return [
      'win ' + window.innerWidth + 'x' + window.innerHeight + ' dpr ' + window.devicePixelRatio,
      'scale ' + view.scale.toFixed(3) + ' ox ' + Math.round(view.ox) + ' oy ' + Math.round(view.oy),
      'canvasCss ' + stage.style.width + ' ' + stage.style.height,
      'uiRect ' + (r ? Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) : 'none'),
      'hudTime ' + ((document.getElementById('bm-hud-time') || {}).textContent || '-') + ' hudCoins ' + ((document.getElementById('bm-hud-coins') || {}).textContent || '-') + ' coalChip ' + ((document.getElementById('bm-count-coal') || {}).textContent || '-'),
      'coins ' + BM.CORE.fmt(BM.CORE.state.coins) + ' drops ' + JSON.stringify(BM.DROPS.counts),
      'ev hit' + evc.hit + ' brk' + evc.brk + ' spawn' + evc.spawn + ' absorb' + evc.absorb + ' warn' + evc.warn,
      'msg ' + (diagErr[0] || 'none'),
      tapInfo,
      (function () { var rr = stage.getBoundingClientRect(); return 'stageRect ' + Math.round(rr.left) + ',' + Math.round(rr.top) + ' ' + Math.round(rr.width) + 'x' + Math.round(rr.height) + ' scroll ' + window.scrollX + ',' + window.scrollY; })(),
      'blockS ' + Math.round(s) + ' x ' + Math.round(minX) + '..' + Math.round(maxX) + ' y ' + Math.round(minY) + '..' + Math.round(maxY),
      'state ' + ROUND.state + ' t ' + ROUND.timeLeft.toFixed(1) + ' ticks ' + tickCount + ' q ' + perf.quality + ' ff ' + ffPerf.toFixed(2) + 'ms/f',
    ];
  }

  function cssProbe(tag, sel) {
    var el = document.querySelector(sel);
    if (!el) return tag + ' MISSING';
    var cs = getComputedStyle(el);
    var r = el.getBoundingClientRect();
    return tag + ' bg=' + (cs.backgroundColor || '-').replace(/\s/g, '') + ' pos=' + cs.position + ' z=' + cs.zIndex +
      ' op=' + cs.opacity + ' r=' + Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.top);
  }

  var diagEl = null;

  function disableAnimations() {
    var st = document.createElement('style');
    st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
    document.head.appendChild(st);
  }

  function renderDiagDom(lines) {
    if (!diagEl) {
      diagEl = document.createElement('pre');
      diagEl.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;margin:0;padding:4px 6px;' +
        'background:rgba(0,0,0,0.94);color:#7dffb0;font:11px/14px ui-monospace,monospace;' +
        'white-space:pre;pointer-events:none;text-align:left;letter-spacing:0;max-width:100vw';
      document.body.appendChild(diagEl);
    }
    diagEl.textContent = lines.join('\n');
  }

  function drawDiag() {
    var lines = diagText();
    if (/drawer=/.test(location.hash)) {
      lines.push('--- css ---');
      lines.push(cssProbe('drw', '.bm-drawer.is-open'));
      lines.push(cssProbe('mask', '.bm-drawer.is-open .drawer-mask'));
      lines.push(cssProbe('sheet', '.bm-drawer.is-open .drawer-sheet'));
      var sp = document.getElementById('bm-panel-settings');
      lines.push('setw cls=' + (sp ? sp.className : 'MISSING'));
      lines.push(cssProbe('sheet2', '#bm-panel-settings .bm-sheet'));
      lines.push('anim ' + (/noanim/.test(location.hash) ? 'off' : 'on'));
      lines.push(cssProbe('camp', '#bm-screen-camp'));
    }
    renderDiagDom(lines);
  }
  var QUALITY_ORDER = ['high', 'mid', 'low'];

  function setQuality(q, persist) {
    if (QUALITY_ORDER.indexOf(q) < 0) q = 'high';
    perf.quality = q;
    if (BM.FX && BM.FX.setQuality) BM.FX.setQuality(q);
    if (BM.UI && BM.UI.setQualityLabel) {
      try { BM.UI.setQualityLabel(q === 'high' ? '高' : q === 'mid' ? '中' : '低'); } catch (e) {}
    }
    if (persist && BM.CORE.setQuality) BM.CORE.setQuality(q);
  }

  function cycleQuality() {
    var i = QUALITY_ORDER.indexOf(perf.quality);
    setQuality(QUALITY_ORDER[(i + 1) % QUALITY_ORDER.length], true);
    if (BM.UI && BM.UI.toast) BM.UI.toast('特效画质：' + (perf.quality === 'high' ? '高' : perf.quality === 'mid' ? '中' : '低'));
  }

  function watchPerf(dtReal) {
    if (ROUND.state !== 'running') { return; }
    perf.ema = perf.ema * 0.92 + dtReal * 0.08;
    perf.sampled += dtReal;
    if (perf.sampled < 2.5 || perf.downgrades >= 2) return;
    perf.sampled = 0;
    var fps = 1 / perf.ema;
    if (fps < 32 && perf.quality !== 'low') { perf.downgrades++; setQuality('low', false); }
    else if (fps < 46 && perf.quality === 'high') { perf.downgrades++; setQuality('mid', false); }
  }

  function resize() {
    rectCache = null;
    var vw = window.innerWidth, vh = window.innerHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    view.scale = Math.min(vw / D.w, vh / D.h);
    view.w = vw; view.h = vh; view.dpr = dpr;
    view.ox = (vw - D.w * view.scale) / 2;
    view.oy = (vh - D.h * view.scale) / 2;
    stage.width = Math.round(vw * dpr);
    stage.height = Math.round(vh * dpr);
    stage.style.width = vw + 'px';
    stage.style.height = vh + 'px';
    var g = ctx.createLinearGradient(0, 0, 0, D.h);
    g.addColorStop(0, '#1a2130');
    g.addColorStop(0.45, '#131a26');
    g.addColorStop(1, '#0a0e15');
    bgGrad = g;
  }

  // getBoundingClientRect 会强制同步布局：每帧调用在手机上是实打实的开销。按帧缓存，输入事件时强制刷新
  var rectCache = null, rectFrame = -1, frameCounter = 0;
  function stageRect(force) {
    if (force || !rectCache || rectFrame !== frameCounter) {
      if (force || !rectCache || frameCounter % 30 === 0) rectCache = stage.getBoundingClientRect();
      rectFrame = frameCounter;
    }
    return rectCache;
  }
  function metrics(force) {
    var r = stageRect(force);
    var w = r.width || window.innerWidth || D.w;
    var h = r.height || window.innerHeight || D.h;
    var sc = Math.min(w / D.w, h / D.h) || 1;
    return { left: r.left, top: r.top, scale: sc, ox: (w - D.w * sc) / 2, oy: (h - D.h * sc) / 2 };
  }

  function toDesign(clientX, clientY) {
    var m = metrics(true);
    return { x: (clientX - m.left - m.ox) / m.scale, y: (clientY - m.top - m.oy) / m.scale };
  }

  function mods() { return BM.CORE.mods(); }
  function nowSec() { return performance.now() / 1000; }

  function liveCoins() {
    var counts = BM.DROPS.counts || {};
    var total = 0n;
    for (var ore in counts) {
      var cfg = BM.CONFIG.ores[ore];
      if (!cfg) continue;
      total += BigInt(counts[ore] | 0) * BigInt(cfg.price);
    }
    return total;
  }

  function tryAttack(x, y) {
    if (ROUND.state !== 'running') return;
    var tool = ROUND.tool;
    try {
      BM.TOOLS.attack(tool, x, y, { hold: pointer.down, now: nowSec() });
    } catch (e) {
      console.warn('[main] attack failed', e);
    }
  }

  function startRound(zoneId) {
    var zone = BM.CORE.zoneById ? BM.CORE.zoneById(zoneId) : BM.CONFIG.zones[0];
    ROUND.zoneId = zone.id;
    ROUND.tool = BM.CORE.state.selectedTool;
    if (!BM.CORE.hasTool(ROUND.tool)) {
      ROUND.tool = 'wood';
      BM.CORE.setTool('wood');
    }
    ROUND.seconds = BM.CORE.resolveRoundSeconds ? BM.CORE.resolveRoundSeconds(zone) : zone.timeSec;
    ROUND.timeLeft = ROUND.seconds;
    ROUND.rescued = false;
    ROUND.counts = {};
    ROUND.state = 'running';
    BM.GRID.build(zone);
    BM.DROPS.reset();
    if (ROUND.treasureReady && BM.GRID.spawnTreasure) {
      var tr = BM.GRID.spawnTreasure(BM.CONFIG.treasure ? BM.CONFIG.treasure.hp : 3000);
      if (tr && BM.UI && BM.UI.toast) BM.UI.toast('地心宝藏出现了：挖开它！');
    }
    if (BM.TOOLS.setZone) BM.TOOLS.setZone(zone);
    if (BM.TOOLS.reset) BM.TOOLS.reset();
    pointer.down = false;
    if (BM.FX && BM.FX.clear) BM.FX.clear();
    if (BM.TOOLS && BM.TOOLS.release) BM.TOOLS.release();
    BM.UI.showScreen('mine');
    BM.bus.emit('round:start', { zoneId: zone.id, seconds: ROUND.seconds, tool: ROUND.tool });
    if (BM.AUDIO) BM.AUDIO.play('roundStart');
  }

  function endRound() {
    ROUND.state = 'settling';
    ROUND.settleIn = 0.7;
    ROUND.timeLeft = 0;
    try { BM.DROPS.absorbAll(); } catch (e) { console.warn(e); }
    if (BM.AUDIO) BM.AUDIO.play('roundEnd');
  }

  function settleRound() {
    var stats = (BM.TOOLS.stats) || {};
    var payload = {
      zoneId: ROUND.zoneId,
      counts: Object.assign({}, BM.DROPS.counts),
      brokenBlocks: stats.broken | 0,
      maxCombo: stats.maxCombo | 0,
      explosions: stats.explosions | 0,
      maxChain: stats.maxChain | 0,
      timeLeft: 0
    };
    var result = BM.CORE.settleRound(payload);
    // v6 §3：最终关目标达成 -> 下一局棋盘中心生出地心宝藏
    ROUND.treasureReady = !!(result && result.treasureReady);
    if (result && result.unlocked && result.unlocked.length) {
      result.unlocked = result.unlocked.map(formatUnlock);
    }
    ROUND.state = 'result';
    BM.bus.emit('round:end', { result: result });
    BM.UI.renderResult(result);
    BM.UI.showScreen('result');
  }

  function updateRound(dtReal) {
    if (ROUND.state === 'running') {
      ROUND.timeLeft -= dtReal;
      if (ROUND.timeLeft <= 0) endRound();
    } else if (ROUND.state === 'settling') {
      ROUND.settleIn -= dtReal;
      if (ROUND.settleIn <= 0) settleRound();
    }
  }

  function emitTick(now) {
    if (ROUND.state !== 'running' && ROUND.state !== 'settling') return;
    if (now - ROUND.tickAt < 0.05) return;
    ROUND.tickAt = now;
    tickCount++;
    BM.bus.emit('round:tick', {
      timeLeft: Math.max(0, ROUND.timeLeft),
      total: ROUND.seconds,
      counts: BM.DROPS.counts,
      coins: liveCoins(),
      combo: (BM.TOOLS && BM.TOOLS.combo) | 0,
      frenzy: (BM.TOOLS && BM.TOOLS.frenzyLeft) || 0,
      tool: ROUND.tool,
      tntPierce: (BM.TOOLS && BM.TOOLS.tntPierce) | 0
    });
  }

  function draw(dtScaled) {
    frameCounter++;
    var d = view.dpr;
    var m = metrics();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, stage.width, stage.height);
    ctx.fillStyle = '#080a0e';
    ctx.fillRect(0, 0, stage.width, stage.height);
    ctx.setTransform(m.scale * d, 0, 0, m.scale * d, m.ox * d, m.oy * d);
    drawBgLayers(ctx);

    if (ROUND.state === 'idle') {
      ctx.restore && ctx.restore();
      drawAtmosphere(ctx);
      drawVignette(ctx);
      return;
    }

    // 矿坑底板：让方块从背景里"立"出来
    var B = BM.BOARD;
    // v6：像素木框矿坑——深梅紫描边 + 木边（上左亮 / 右下暗）+ 四角金铆钉，坑内半透明压暗
    var fx0 = B.x - 6, fy0 = B.y - 10, fw0 = B.w + 12, fh0 = B.h + 20;
    ctx.fillStyle = 'rgba(12,8,22,0.55)';
    ctx.fillRect(fx0 + 4, fy0 + 6, fw0, fh0);                   // 投影
    ctx.fillStyle = '#352438';
    ctx.fillRect(fx0, fy0, fw0, fh0);
    ctx.fillStyle = '#c98a52';
    ctx.fillRect(fx0 + 2, fy0 + 2, fw0 - 4, fh0 - 4);
    ctx.fillStyle = '#ecb67c';
    ctx.fillRect(fx0 + 2, fy0 + 2, fw0 - 4, 2);
    ctx.fillRect(fx0 + 2, fy0 + 2, 2, fh0 - 4);
    ctx.fillStyle = '#8e5634';
    ctx.fillRect(fx0 + 2, fy0 + fh0 - 4, fw0 - 4, 2);
    ctx.fillRect(fx0 + fw0 - 4, fy0 + 2, 2, fh0 - 4);
    ctx.fillStyle = '#352438';
    ctx.fillRect(fx0 + 5, fy0 + 5, fw0 - 10, fh0 - 10);
    ctx.fillStyle = 'rgba(42,30,50,0.9)';
    ctx.fillRect(fx0 + 6, fy0 + 6, fw0 - 12, fh0 - 12);
    var rv = [[fx0 + 1, fy0 + 1], [fx0 + fw0 - 5, fy0 + 1], [fx0 + 1, fy0 + fh0 - 5], [fx0 + fw0 - 5, fy0 + fh0 - 5]];
    for (var ri = 0; ri < 4; ri++) {
      ctx.fillStyle = '#352438'; ctx.fillRect(rv[ri][0], rv[ri][1], 4, 4);
      ctx.fillStyle = '#ffd84a'; ctx.fillRect(rv[ri][0] + 1, rv[ri][1] + 1, 2, 2);
      ctx.fillStyle = '#fff4b8'; ctx.fillRect(rv[ri][0] + 1, rv[ri][1] + 1, 1, 1);
    }

    var off = (BM.FX && BM.FX.offset) ? BM.FX.offset() : { x: 0, y: 0 };
    ctx.save();
    ctx.translate(off.x || 0, off.y || 0);
    try {
      BM.GRID.draw(ctx);
      if (BM.TOOLS && BM.TOOLS.draw) BM.TOOLS.draw(ctx);
      BM.DROPS.draw(ctx);
      BM.FX.draw(ctx);
      if (BM.JUICE && BM.JUICE.draw) BM.JUICE.draw(ctx);
    } catch (e) {
      console.warn('[main] draw failed', e);
    }
    ctx.restore();
    drawAtmosphere(ctx);
    drawVignette(ctx);
  }

  function step(dtReal, now) {
    var scale = (BM.FX && typeof BM.FX.timeScale === 'number') ? BM.FX.timeScale : 1;
    var dtWorld = dtReal * scale;

    bgT += dtReal;
    watchPerf(dtReal);
    updateRound(dtReal);

    if (ROUND.state === 'running' || ROUND.state === 'settling') {
      var toolCfg = BM.CONFIG.tools[ROUND.tool];
      if (pointer.down && toolCfg && toolCfg.mode === 'hold' && ROUND.state === 'running') {
        if (BM.TOOLS.ready()) tryAttack(pointer.x, pointer.y);
      }
      try {
        BM.GRID.update(dtWorld);
        BM.DROPS.update(dtWorld);
        BM.TOOLS.update(dtWorld, now);
      } catch (e) { console.warn('[main] update failed', e); }
      if (ROUND.state === 'running' && BM.GRID && BM.GRID.isEmpty && BM.GRID.isEmpty()) {
        if (BM.UI && BM.UI.toast) BM.UI.toast('矿层挖空！');
        endRound();
      }
      emitTick(now);
    }
    if (BM.FX) BM.FX.update(dtReal);
    if (BM.JUICE) BM.JUICE.update(dtWorld);
    draw(dtWorld);
    if (DIAG) drawDiag();
    if (DEMO && ROUND.state === 'running' && now - demoAt > 0.075) {
      demoAt = now;
      var alive = [];
      for (var i = 0; i < BM.GRID.flat.length; i++) if (!BM.GRID.flat[i].broken) alive.push(BM.GRID.flat[i]);
      if (alive.length) {
        var t = alive[(Math.random() * alive.length) | 0];
        pointer.down = true;
        tryAttack(t.x + t.s * 0.5, t.y + t.s * 0.5);
      }
    }
  }

  function frame(ts) {
    var dtReal = lastNow ? Math.min((ts - lastNow) / 1000, 0.05) : 0.016;
    lastNow = ts;
    step(dtReal, ts / 1000);
    requestAnimationFrame(frame);
  }

  // 确定性快进：验收用，不依赖 rAF（headless 虚拟时间下 rAF 几乎不跑）
  var ffPerf = 0;

  function fastForward(frames, dt) {
    var t0 = 0.5;
    var started = (window.performance || Date).now();
    for (var i = 0; i < frames; i++) {
      step(dt, t0 + i * dt);
    }
    ffPerf = ((window.performance || Date).now() - started) / Math.max(1, frames);
  }

  function bindInput() {
    var el = stage;
    el.style.touchAction = 'none';
    function down(e) {
      var p = toDesign(e.clientX, e.clientY);
      tapInfo += ' | ev ' + Math.round(e.clientX) + ',' + Math.round(e.clientY) + ' -> ' + Math.round(p.x) + ',' + Math.round(p.y) + ' | v ' + view.scale.toFixed(3) + ' ' + Math.round(view.ox) + ',' + Math.round(view.oy);
      pointer.down = true; pointer.x = p.x; pointer.y = p.y; pointer.id = e.pointerId;
      if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch (err) {} }
      if (BM.AUDIO && !BM.AUDIO.__ready) { BM.AUDIO.init(); BM.AUDIO.__ready = true; }
      tryAttack(p.x, p.y);
      e.preventDefault();
    }
    function move(e) {
      var p = toDesign(e.clientX, e.clientY);
      pointer.x = p.x; pointer.y = p.y;
      if (BM.TOOLS && BM.TOOLS.setAim) BM.TOOLS.setAim(p.x, p.y);
    }
    function up(e) {
      pointer.down = false; pointer.id = null;
      if (BM.TOOLS && BM.TOOLS.release) BM.TOOLS.release();
    }
    el.addEventListener('pointerdown', down, { passive: false });
    el.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('pointercancel', up, { passive: true });
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
  }

  function formatUnlock(id) {
    try { if (BM.CORE.describeUnlock) { var d = BM.CORE.describeUnlock(id); if (d) return d; } } catch (e) {}
    var key = String(id).replace(/^tool:/, '').replace(/^zone:/, '');
    if (BM.CONFIG.tools[key]) return '新工具：' + BM.CONFIG.tools[key].name;
    for (var i = 0; i < BM.CONFIG.zones.length; i++) if (BM.CONFIG.zones[i].id === key) return '新矿区：' + BM.CONFIG.zones[i].name;
    if (BM.CONFIG.upgrades[key]) return '新强化：' + BM.CONFIG.upgrades[key].name;
    return '解锁：' + key;
  }

  function refreshCamp() {
    try { BM.UI.renderCamp(); } catch (e) { console.warn('[main] renderCamp', e); }
  }

  var handlers = {
    onStartRound: function (zoneId) {
      if (BM.AUDIO && !BM.AUDIO.__ready) { BM.AUDIO.init(); BM.AUDIO.__ready = true; }
      startRound(zoneId || BM.CORE.state.currentZone);
    },
    onNextRound: function () { startRound(ROUND.zoneId); },
    onBackToCamp: function () {
      ROUND.state = 'idle';
      refreshCamp();
      BM.UI.showScreen('camp');
    },
    // v7：天赋与强化合并成单一节点树，UI 只调这一条
    onBuyNode: function (id) {
      var ok = BM.CORE.buyNode ? BM.CORE.buyNode(id) : false;
      if (ok) {
        if (BM.AUDIO) BM.AUDIO.play('buy');
        refreshCamp();
      }
    },
    // 兼容别名（旧 UI/旧测试仍在调）
    onBuyUpgrade: function (id) { handlers.onBuyNode(id); },
    onBuyTalent: function (id) { handlers.onBuyNode(id); },
    // 回合内「返回」：立即结束本局并结算（保留已挖到的收益）
    onExitRound: function () {
      if (ROUND.state === 'running') endRound();
    },
    onSelectTool: function (id) {
      if (BM.CORE.setTool(id)) { if (BM.AUDIO) BM.AUDIO.play('ui'); refreshCamp(); }
    },
    onResetTalents: function () {
      BM.CORE.resetTalents();
      refreshCamp();
    },
    onResetSave: function () {
      BM.CORE.resetSave();
      ROUND.state = 'idle';
      if (BM.CORE.setMuted) BM.CORE.setMuted(false);
      if (BM.AUDIO) BM.AUDIO.setMuted(false);
      refreshCamp();
      BM.UI.showScreen('camp');
    },
    onCycleQuality: function () { cycleQuality(); },
    onToggleMute: function () {
      var next = !(BM.AUDIO ? BM.AUDIO.muted : false);
      if (BM.AUDIO) BM.AUDIO.setMuted(next);
      if (BM.CORE.setMuted) BM.CORE.setMuted(next);
      BM.UI.setMuted(next);
    }
  };

  function boot() {
    resize();
    BM.CORE.load();
    BM.bus.on('block:hit', function () { evc.hit++; });
    BM.bus.on('block:break', function () { evc.brk++; });
    BM.bus.on('drop:spawn', function () { evc.spawn++; });
    BM.bus.on('drop:absorb', function () { evc.absorb++; });
    // v6 §3：宝箱挖开 -> 记胜利 + 播胜利覆盖层（先切屏再显示，避免被 hideVictory 收掉）
    BM.bus.on('treasure:open', function () {
      var first = BM.CORE.markVictory ? BM.CORE.markVictory() : false;
      ROUND.treasureReady = false;
      if (BM.UI && BM.UI.showVictory) {
        BM.UI.renderResult && BM.UI.renderResult({
          zoneId: ROUND.zoneId, counts: {}, lines: [], coinsEarned: '0', coinsTotal: String(BM.CORE.state.coins),
          coinsTotalAbbr: BM.CORE.abbr(BM.CORE.state.coins), stats: {}, unlocked: [],
          objective: { ore: 'crystal', need: 0, have: 0, done: true }, nextZoneId: null
        });
        BM.UI.showScreen('result');
        BM.UI.showVictory({
          totalRounds: BM.CORE.state.roundsPlayed,
          coinsTotal: BM.CORE.state.lifetimeCoins,
          subtitle: first ? '你挖到了地心宝藏' : '地心宝藏已被你挖开过'
        });
      }
    });
    BM.GRID.init(ctx);
    BM.DROPS.init();
    BM.FX.init();
    BM.TOOLS.init(ctx);
    setQuality((BM.CORE.state.quality) || 'high', false);
    if (BM.TOOLS.reset) BM.TOOLS.reset();
    if (BM.AUDIO) BM.AUDIO.setMuted(!!BM.CORE.state.muted);
    BM.UI.init(document.getElementById('app'), handlers);
    BM.UI.setMuted(!!BM.CORE.state.muted);
    refreshCamp();
    BM.UI.showScreen('camp');
    bindInput();
    requestAnimationFrame(frame);
    if (/diag/.test(location.hash)) {
      setTimeout(function () {
        try {
          var ui = document.getElementById('bm-ui');
          var r = ui ? ui.getBoundingClientRect() : null;
          var bx = [], by = [], bs = 0;
          for (var i = 0; i < BM.GRID.flat.length; i++) {
            var b = BM.GRID.flat[i];
            bx.push(Math.round(b.x), Math.round(b.x + b.s));
            by.push(Math.round(b.y), Math.round(b.y + b.s));
            bs = Math.round(b.s);
          }
          var info = {
            win: [window.innerWidth, window.innerHeight],
            dpr: window.devicePixelRatio,
            viewScale: Math.round(view.scale * 1000) / 1000,
            ox: Math.round(view.ox), oy: Math.round(view.oy),
            canvasCss: [stage.style.width, stage.style.height],
            uiRect: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null,
            board: BM.BOARD,
            blockSize: bs,
            blockX: [Math.min.apply(null, bx), Math.max.apply(null, bx)],
            blockY: [Math.min.apply(null, by), Math.max.apply(null, by)],
            state: ROUND.state, zone: ROUND.zoneId, timeLeft: Math.round(ROUND.timeLeft * 10) / 10
          };
          document.documentElement.setAttribute('data-diag', JSON.stringify(info));
        } catch (e) { document.documentElement.setAttribute('data-diag', 'ERR ' + e.message); }
      }, 600);
    }
    if (/noanim/.test(location.hash)) disableAnimations();
    if (/diag|auto|demo|frames=/.test(location.hash)) {
      var zm = location.hash.match(/zone=([a-zA-Z]+)/);
      handlers.onStartRound(zm ? zm[1] : BM.CORE.state.currentZone);
      var m = location.hash.match(/frames=(\d+)/);
      if (m) fastForward(Math.min(1600, parseInt(m[1], 10)), 1 / 60);
      if (/tocamp/.test(location.hash)) handlers.onBackToCamp();
      var tm = location.hash.match(/tap=(\d+),(\d+)/);
      if (tm) {
        var cx = parseInt(tm[1], 10), cy = parseInt(tm[2], 10);
        var mk = function (type) {
          var ev;
          try { ev = new PointerEvent(type, { clientX: cx, clientY: cy, pointerId: 1, bubbles: true }); }
          catch (e) { ev = new MouseEvent(type, { clientX: cx, clientY: cy, bubbles: true }); }
          return ev;
        };
        tapInfo = 'tap ' + cx + ',' + cy;
        stage.dispatchEvent(mk('pointerdown'));
        tapInfo += ' -> ptr ' + Math.round(pointer.x) + ',' + Math.round(pointer.y);
        var bt = BM.GRID.at(pointer.x, pointer.y);
        tapInfo += ' block ' + (bt ? bt.ox + ',' + bt.oy : 'null');
      }
      var dm = location.hash.match(/drawer=(talents|settings)/);
      if (dm) {
        var btn = document.getElementById('bm-btn-' + dm[1]);
        if (btn) {
          btn.click();
          if (!document.querySelector('.bm-drawer.is-open, .bm-sheet-wrap.is-open')) {
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          }
        }
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // 供子代理自检与调试用
  BM.__debug = { ROUND: ROUND, view: view, startRound: startRound, view8: startRound };
})();
