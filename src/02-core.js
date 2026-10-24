(function () {
  'use strict';
  window.BM = window.BM || {};
  var BM = window.BM;
  var CFG = BM.CONFIG;
  var T = CFG.tuning;

  var ORE_IDS = [];
  var TOOL_IDS = [];
  (function () {
    for (var k in CFG.ores) ORE_IDS.push(k);
    for (var t in CFG.tools) TOOL_IDS.push(t);
  })();
  var FIRST_TOOL = TOOL_IDS[0];
  var FIRST_ZONE = CFG.zones[0].id;

  var DEC_INT = /^-?\d+$/;
  var MAX_COUNT = 1000000000;

  /* ---------------- 小工具 ---------------- */

  function store() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    } catch (e) { /* 隐私模式下读 window.localStorage 会抛错 */ }
    try {
      if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    } catch (e2) { /* ignore */ }
    return null;
  }

  function toBig(v, dft) {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'string') {
      if (!DEC_INT.test(v)) return dft;
      try { return BigInt(v); } catch (e) { return dft; }
    }
    if (typeof v === 'number' && isFinite(v) && Math.floor(v) === v) {
      try { return BigInt(v); } catch (e) { return dft; }
    }
    return dft;
  }

  function clampInt(v, min, max, dft) {
    if (typeof v !== 'number' || !isFinite(v)) return dft;
    var n = Math.floor(v);
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function isPlaceholder(id) {
    return !!(CFG.placeholders && CFG.placeholders[id]);
  }

  function zoneCfgById(id) {
    if (typeof id !== 'string') return null;
    for (var i = 0; i < CFG.zones.length; i++) {
      if (CFG.zones[i].id === id) return CFG.zones[i];
    }
    return null;
  }

  function currentZoneCfg() {
    return zoneCfgById(state.currentZone) || CFG.zones[0];
  }

  // 矿物血量：zones[].ores[].hp 优先，缺省回落 CONFIG.ores[].hp（建格方按当前关取）
  function oreHp(zoneId, oreId) {
    var z = zoneCfgById(zoneId) || currentZoneCfg();
    var list = (z && z.ores) ? z.ores : [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e && e.ore === oreId && typeof e.hp === 'number' && e.hp > 0) return e.hp;
    }
    var g = CFG.ores[oreId];
    var hp = (g && typeof g.hp === 'number') ? g.hp : 0;
    return hp > 0 ? hp : 1;
  }

  function objectiveOf(zone) {
    var ob = (zone && zone.objective) ? zone.objective : { ore: ORE_IDS[0], need: 0 };
    var have = clampInt(state.lifetimeMined[ob.ore], 0, MAX_COUNT, 0);
    return { ore: ob.ore, need: ob.need, have: have, done: have >= ob.need };
  }

  /* ---------------- 状态 ---------------- */

  function freshState() {
    var ups = {};
    for (var id in CFG.upgrades) ups[id] = 0;
    var mined = {};
    for (var i = 0; i < ORE_IDS.length; i++) mined[ORE_IDS[i]] = 0;
    return {
      version: CFG.version,
      coins: 0n,
      lifetimeCoins: 0n,
      upgrades: ups,
      talents: {},
      unlockedTools: [FIRST_TOOL],
      selectedTool: FIRST_TOOL,
      currentZone: FIRST_ZONE,
      unlockedZones: [FIRST_ZONE],
      lifetimeMined: mined,
      roundsPlayed: 0,
      bestRound: { zoneId: FIRST_ZONE, coins: 0n },
      muted: false,
      victory: false,      // v6 §3：地心宝藏已挖开（胜利演出只播一次）
      victoryAt: 0,        // 首次胜利的时间戳（营地徽章/统计用）
      lastSavedAt: 0
    };
  }

  function copyUpgrades() {
    var out = {};
    for (var id in CFG.upgrades) out[id] = clampInt(state.upgrades[id], 0, CFG.upgrades[id].maxLevel, 0);
    return out;
  }

  function copyMined() {
    var out = {};
    for (var i = 0; i < ORE_IDS.length; i++) out[ORE_IDS[i]] = clampInt(state.lifetimeMined[ORE_IDS[i]], 0, MAX_COUNT, 0);
    return out;
  }

  // 天赋落盘为 { id: 等级 }，只保留已购节点（含中心节点 core0）
  function copyTalents() {
    var out = {};
    for (var i = 0; i < TALENT_LIST.length; i++) {
      var id = TALENT_LIST[i].id;
      var lv = nodeLevel(id);
      if (lv > 0) out[id] = lv;
    }
    return out;
  }

  var state = freshState();

  function sanitize(d) {
    var s = freshState();
    if (!d || typeof d !== 'object') return s;
    // v3 及更旧：矿种、工具、天赋全部不兼容，不做数值迁移，整体安全初始化
    if (d.version !== CFG.version) return s;

    var coins = toBig(d.coins, 0n);
    s.coins = coins > 0n ? coins : 0n;
    var life = toBig(d.lifetimeCoins, 0n);
    s.lifetimeCoins = life > 0n ? life : 0n;
    if (s.lifetimeCoins < s.coins) s.lifetimeCoins = s.coins;

    if (d.upgrades && typeof d.upgrades === 'object') {
      for (var up in CFG.upgrades) {
        s.upgrades[up] = clampInt(d.upgrades[up], 0, CFG.upgrades[up].maxLevel, 0);
      }
    }

    if (d.talents && typeof d.talents === 'object' && !Array.isArray(d.talents)) {
      for (var ti = 0; ti < TALENT_LIST.length; ti++) {
        var tn = TALENT_LIST[ti];
        s.talents[tn.id] = clampInt(d.talents[tn.id], 0, tn.maxLevel, 0);
      }
      /* v10 存档迁移：旧的「一个节点多级」（atk: 6 = 攻击 6 级）已经拆成 atk1..atk10 的单级链，
         老档里的 <前缀>: N 按「这条链的前 N 环都已买」落到链上，进度与钱都不丢。
         真·未知 id（链前缀也拼不出已知节点）照旧丢弃。 */
      for (var legacy in d.talents) {
        if (CFG.talents[legacy]) continue;              // 新 id 已在上面按等级读过
        var legacyLv = clampInt(d.talents[legacy], 0, 64, 0);
        for (var li = 1; li <= legacyLv; li++) {
          if (!CFG.talents[legacy + li]) break;         // 不是已知链前缀 → 丢弃
          s.talents[legacy + li] = 1;
        }
      }
    }

    if (Array.isArray(d.unlockedTools)) {
      s.unlockedTools = [];
      for (var j = 0; j < d.unlockedTools.length; j++) {
        var tool = d.unlockedTools[j];
        if (typeof tool === 'string' && CFG.tools[tool] && s.unlockedTools.indexOf(tool) < 0) s.unlockedTools.push(tool);
      }
    }
    if (s.unlockedTools.indexOf(FIRST_TOOL) < 0) s.unlockedTools.unshift(FIRST_TOOL);

    s.selectedTool = (typeof d.selectedTool === 'string' && s.unlockedTools.indexOf(d.selectedTool) >= 0)
      ? d.selectedTool : FIRST_TOOL;

    if (typeof d.currentZone === 'string' && zoneCfgById(d.currentZone)) s.currentZone = d.currentZone;

    if (Array.isArray(d.unlockedZones)) {
      s.unlockedZones = [];
      for (var z = 0; z < d.unlockedZones.length; z++) {
        var zid = d.unlockedZones[z];
        if (typeof zid === 'string' && (zoneCfgById(zid) || isPlaceholder(zid)) && s.unlockedZones.indexOf(zid) < 0) {
          s.unlockedZones.push(zid);
        }
      }
    }
    if (s.unlockedZones.indexOf(FIRST_ZONE) < 0) s.unlockedZones.unshift(FIRST_ZONE);
    if (s.unlockedZones.indexOf(s.currentZone) < 0) s.unlockedZones.push(s.currentZone);

    if (d.lifetimeMined && typeof d.lifetimeMined === 'object') {
      for (var m = 0; m < ORE_IDS.length; m++) {
        s.lifetimeMined[ORE_IDS[m]] = clampInt(d.lifetimeMined[ORE_IDS[m]], 0, MAX_COUNT, 0);
      }
    }

    s.roundsPlayed = clampInt(d.roundsPlayed, 0, MAX_COUNT, 0);

    if (d.bestRound && typeof d.bestRound === 'object') {
      s.bestRound.zoneId = zoneCfgById(d.bestRound.zoneId) ? d.bestRound.zoneId : s.currentZone;
      var best = toBig(d.bestRound.coins, 0n);
      s.bestRound.coins = best > 0n ? best : 0n;
    }

    s.muted = !!d.muted;
    s.victory = !!d.victory;
    s.victoryAt = clampInt(d.victoryAt, 0, Number.MAX_SAFE_INTEGER, 0);
    s.lastSavedAt = clampInt(d.lastSavedAt, 0, Number.MAX_SAFE_INTEGER, 0);
    return s;
  }

  function publish(next) {
    state = next;
    BM.CORE.state = state;
    return state;
  }

  /* ---------------- 读档 / 存档 ---------------- */

  function load() {
    var raw = null;
    try {
      var st = store();
      if (st) raw = st.getItem(CFG.saveKey);
    } catch (e) { raw = null; }

    var data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch (e2) { data = null; }
    }
    return publish(sanitize(data));
  }

  function save() {
    var st = store();
    if (!st) {
      BM.bus.emit('ui:toast', { text: '浏览器禁止本地存储，进度无法保存' });
      return false;
    }
    state.lastSavedAt = Date.now();
    var payload;
    try {
      payload = JSON.stringify({
        version: CFG.version,
        coins: state.coins.toString(),
        lifetimeCoins: state.lifetimeCoins.toString(),
        upgrades: copyUpgrades(),
        talents: copyTalents(),
        unlockedTools: state.unlockedTools.slice(),
        selectedTool: state.selectedTool,
        currentZone: state.currentZone,
        unlockedZones: state.unlockedZones.slice(),
        lifetimeMined: copyMined(),
        roundsPlayed: state.roundsPlayed,
        bestRound: { zoneId: state.bestRound.zoneId, coins: state.bestRound.coins.toString() },
        muted: !!state.muted,
        victory: !!state.victory,
        victoryAt: state.victoryAt,
        lastSavedAt: state.lastSavedAt
      });
    } catch (e) {
      BM.bus.emit('ui:toast', { text: '存档序列化失败，进度未保存' });
      return false;
    }
    try {
      st.setItem(CFG.saveKey, payload);
      return true;
    } catch (e2) {
      BM.bus.emit('ui:toast', { text: '存档写入失败，存储空间可能已满' });
      return false;
    }
  }

  function resetSave() {
    var st = store();
    try { if (st) st.removeItem(CFG.saveKey); } catch (e) { /* ignore */ }
    publish(freshState());
    save();
    return true;
  }

  /* ---------------- 金币与格式化 ---------------- */

  function fmt(n) {
    var v = toBig(n, 0n);
    var neg = v < 0n;
    if (neg) v = -v;
    return (neg ? '-' : '') + v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  var UNITS = ['', 'K', 'M', 'B', 'T'];

  function abbr(n) {
    var v = toBig(n, 0n);
    var neg = v < 0n;
    if (neg) v = -v;
    var s = v.toString();
    if (s.length <= 3) return (neg ? '-' : '') + s;
    var idx = Math.floor((s.length - 1) / 3);
    if (idx > UNITS.length - 1) idx = UNITS.length - 1;
    var unit = 10n ** BigInt(idx * 3);
    var scaled = v * 100n / unit;             // 截断到两位小数
    var intPart = scaled / 100n;
    var dec = (scaled % 100n).toString();
    if (dec.length < 2) dec = '0' + dec;
    dec = dec.replace(/0+$/, '');
    return (neg ? '-' : '') + intPart.toString() + (dec ? '.' + dec : '') + UNITS[idx];
  }

  function canAfford(cost) {
    var c = toBig(cost, 0n);
    return state.coins >= c;
  }

  function addCoins(n) {
    var v = toBig(n, 0n);
    if (v <= 0n) return state.coins;
    state.coins += v;
    state.lifetimeCoins += v;
    return state.coins;
  }

  function spendCoins(n) {
    var v = toBig(n, 0n);
    if (v < 0n) return false;
    if (state.coins < v) return false;
    state.coins -= v;
    return true;
  }

  /* ---------------- 节点树：唯一购买接口（docs/TREE-V7.md §4） ----------------

     天赋与强化合并成一棵树：数据在 CONFIG.tree（中心 1 + 天赋 44 + 强化 5）。
     对外只有一套读数与一套买法：
       CORE.nodeState(id) -> 'owned' | 'available' | 'locked' | 'maxed'
       CORE.nodeCost(id)  -> bigint（下一级报价；满级 0n）
       CORE.buyNode(id)   -> boolean（内部按 kind 分派，成功后 save）
     存档字段保持旧形状（state.talents 存天赋与中心、state.upgrades 存强化等级），
     这样 v7 旧档照样读得回来；两边的等级只通过 nodeLevel(id) 这一个口子读。 */

  var TREE = CFG.tree;

  var NODE_LIST = (function () {
    var out = [];
    if (TREE && TREE.center) out.push(TREE.center);
    var list = (TREE && TREE.nodes) || [];
    for (var i = 0; i < list.length; i++) out.push(list[i]);
    return out;
  })();

  var TALENT_LIST = (function () {
    var out = [];
    for (var i = 0; i < NODE_LIST.length; i++) {
      if (NODE_LIST[i].kind !== 'upgrade') out.push(NODE_LIST[i]);
    }
    return out;
  })();

  var NODE_INDEX = Object.create(null);
  (function () { for (var i = 0; i < NODE_LIST.length; i++) NODE_INDEX[NODE_LIST[i].id] = NODE_LIST[i]; })();
  function nodeById(id) {
    if (typeof id !== 'string') return null;
    return NODE_INDEX[id] || null;
  }

  // 等级存在哪张表：强化在 state.upgrades，天赋与中心在 state.talents
  function nodeStore(node) {
    return node.kind === 'upgrade' ? state.upgrades : state.talents;
  }

  function nodeLevel(id) {
    var n = nodeById(id);
    if (!n) return 0;
    return clampInt(nodeStore(n)[id], 0, n.maxLevel, 0);
  }

  /* 状态：
     'maxed'     多级节点已买满（maxLevel > 1）—— 还能看到效果，但没得买了
     'owned'     单级节点已买（含中心节点；maxLevel = 1 买到就是买满）
     'available' 可买下一级（前置全已购，等级未满）
     'locked'    有前置没买，或 id 不认
     跳级规则：只看**直接父节点**（v8 的 parent 链）是否已购，
     requires 全部 owned 就能买 —— 同层的其它分支互不影响。 */
  function nodeState(id) {
    var n = nodeById(id);
    if (!n) return 'locked';
    var lv = nodeLevel(id);
    if (lv >= n.maxLevel) return n.maxLevel > 1 ? 'maxed' : 'owned';
    var req = n.requires || [];
    for (var i = 0; i < req.length; i++) {
      if (nodeLevel(req[i]) < 1) return 'locked';
    }
    return 'available';
  }

  /* 价格 = 首级价 × 1.9^(已买级数) × depthMul[节点深度]（docs/TREE-V8.md §3）。

     v8 起价格没有「关」这一维：深度倍率表在 CONFIG.talentCostTable.depthMul
     （1/6/30/150/750/3800/19000，深度 1..7，超出取末一位），首级价基数写在节点的
     baseCost 上（§3 的首级价表；工具链那几条在 §7.1 已从树里删掉）。深度由 01-config
     建树期算好、写在 node.depth 上（parent 链步数，中心 = 0）。

     两点实现口径：
     1. 首级价 = baseCost × depthMul[depth]，一次整数乘，不引入浮点；
     2. 第 idx 级 = ceil(首级价 × 19^idx / 10^idx) —— 用 19/10 的整数幂，
        1.9^n 的浮点在边界上会少 1 金（同旧 talentCostAt 的理由）。 */
  function depthMulTable() {
    var tbl = CFG.talentCostTable || CFG.nodeCostTable || {};
    var arr = tbl.depthMul;
    return (arr && arr.length) ? arr : [1];
  }

  function depthMulOf(depth) {
    var list = depthMulTable();
    var i = Math.round(Number(depth) || 0) - 1;
    if (!(i > 0)) return 1;
    if (i > list.length - 1) i = list.length - 1;
    var v = list[i];
    return (typeof v === 'number' && isFinite(v) && v > 0) ? v : 1;
  }

  // 首级价（含深度倍率）：节点静态 cost 是同一口径的快照，表缺失时才回落到它
  function firstCostOf(node) {
    var base = typeof node.baseCost === 'number' && isFinite(node.baseCost) ? node.baseCost : -1;
    if (!(base >= 0)) return BigInt(node.cost || 0);
    // v13：首环（深度 1）额外 ×firstRingMul（0.65，整环下调 35%），再乘深度倍率
    var tbl = CFG.talentCostTable || CFG.nodeCostTable || {};
    var ringMul = (Math.round(Number(node.depth) || 0) === 1 && typeof tbl.firstRingMul === 'number' && tbl.firstRingMul > 0)
      ? tbl.firstRingMul : 1;
    return BigInt(Math.round(base * ringMul)) * BigInt(depthMulOf(node.depth));
  }

  function treeCostAt(node, idx) {
    var num = firstCostOf(node);
    var den = 1n;
    for (var i = 0; i < idx; i++) { num *= 19n; den *= 10n; }
    return (num + den - 1n) / den;
  }

  /* v15 长尾节点（maxLevel ≥ 50，如 999 级的矿层加深）走线性价：
       第 n 级 = baseCost × n（第 1 级 300 / 第 10 级 3,000 / 第 100 级 30,000 / 第 999 级 299,700）
     两条理由都是硬的：
     ① 语义 —— 999 级的线性长尾本来就不是「越买越贵 1.9 倍」，用户钉死 300 × 当前等级；
     ② 开销 —— 1.9^lv 的 BigInt 幂在 lv≈1000 时每次报价约 0.1ms（实测 200 次 21.6ms），
        本来就不是瓶颈；线性分支顺带把报价压成常数级，连点购买时不必担心越点越慢。
     其它节点（maxLevel = 1）继续走原来的 depthMul + 1.9 幂，一个字节都不变。 */
  function isLinearNode(node) {
    return !!node && Math.round(Number(node.maxLevel) || 1) >= 50;
  }

  function linearCostAt(node, idx) {
    var base = Math.round(Number(node.baseCost));
    if (!(base > 0)) base = Math.round(Number(node.cost) || 0);
    return BigInt(base) * BigInt(Math.max(0, Math.round(Number(idx) || 0)) + 1);
  }

  // 第 idx 级（idx = 已买级数）的报价：三条口径的唯一分岔点。
  // 固定价节点（TNT 掉落链的软门槛 fixedCost）也必须走这里 —— 购买和返还共用同一个价，
  // 否则 resetTalents 会按深度阶梯退钱（实测少退 300 万，v17 修）。
  function costAt(node, idx) {
    if (node && node.fixedCost) return BigInt(node.fixedCost);
    return isLinearNode(node) ? linearCostAt(node, idx) : treeCostAt(node, idx);
  }

  /* 统一报价：永远是「下一级」的价；满级（买不动了）一律 0n。
     兼容别名 CORE.talentCost 保留旧的「回传最后一级报价」行为（见下方别名段）。 */
  function nodeCost(id) {
    var n = nodeById(id);
    if (!n) return 0n;
    var lv = nodeLevel(id);
    if (lv >= n.maxLevel) return 0n;
    return costAt(n, lv);
  }

  // 中心节点的首级价按「第一关首局收入」标定（30 金，实测首局 128–392），打完第一局一定买得起。
  // 买完立刻 checkUnlocks()：v8 §7.1 之后树里没有武器节点，这一步只剩「enterUnlocks 补发」一条路，
  // 但保留它可以让「买节点 → 立刻拿到新东西」这条时序对将来的解锁型节点继续成立。
  function buyNode(id) {
    var n = nodeById(id);
    if (!n) return false;
    if (nodeState(id) !== 'available') return false;
    if (!spendCoins(nodeCost(id))) return false;
    nodeStore(n)[id] = nodeLevel(id) + 1;
    checkUnlocks();
    save();
    return true;
  }

  /* ---------------- 兼容别名（v7 起不是真值，只转发到新接口） ----------------

     08-ui / 09-main / 旧测试还按 talent* / upgrade* 的名字调；这里保留同名函数，
     语义各自维持旧口径（talentState 满级仍叫 'owned'、talentCost 满级仍回最后一级报价），
     所以面板合并不会把旧调用方一起拖下水。 */

  function talentLevel(id) {
    var n = nodeById(id);
    if (!n || n.kind === 'upgrade') return 0;
    return nodeLevel(id);
  }

  function hasTalent(id) {
    return talentLevel(id) > 0;
  }

  // UI 便捷视图：已购天赋（含中心节点）的 id 列表
  function ownedTalents() {
    var out = [];
    for (var i = 0; i < TALENT_LIST.length; i++) {
      if (nodeLevel(TALENT_LIST[i].id) > 0) out.push(TALENT_LIST[i].id);
    }
    return out;
  }

  // 旧口径：多级节点买满叫 'owned'（新接口 nodeState 里叫 'maxed'）
  function talentState(id) {
    var st = nodeState(id);
    return st === 'maxed' ? 'owned' : st;
  }

  // 旧口径：满级后仍回传最后一级的报价（UI 显示用，buyTalent 已经挡住）
  function talentCost(id) {
    var n = nodeById(id);
    if (!n || n.kind === 'upgrade') return 0n;
    /* 固定价节点（v16c：TNT 链的软门槛，node.fixedCost）必须和 nodeCost 同口径，
       否则「报价 450 / 实扣 100000」会让任何先用 talentCost 判钱、再调 buyTalent 的调用方
       （progression / balance 的贪心买家）每次都在第一个固定价节点上买失败，整局卡死。 */
    return costAt(n, nodeLevel(id));
  }

  function buyTalent(id) {
    var n = nodeById(id);
    if (!n || n.kind === 'upgrade') return false;
    return buyNode(id);
  }

  function upgradeLevel(id) {
    var n = nodeById(id);
    if (!n || n.kind !== 'upgrade') return 0;
    return nodeLevel(id);
  }

  function upgradeCost(id) {
    var n = nodeById(id);
    if (!n || n.kind !== 'upgrade') return 0n;
    return nodeCost(id);
  }

  function buyUpgrade(id) {
    var n = nodeById(id);
    if (!n || n.kind !== 'upgrade') return false;
    return buyNode(id);
  }

  // 全额返还已投入的金币（逐级累加实付价，1.9 递增的每一级都要算进去）；
  // lifetimeCoins 不动（返还不是新收入）。强化不参与（旧 resetTalents 语义）。
  function resetTalents() {
    var refund = 0n;
    for (var i = 0; i < TALENT_LIST.length; i++) {
      var n = TALENT_LIST[i];
      var lv = nodeLevel(n.id);
      for (var k = 0; k < lv; k++) {
        refund += costAt(n, k);
      }
    }
    state.talents = {};
    state.coins += refund;
    save();
    return refund;
  }

  /* ---------------- mods：每次现算，复用同一个对象避免每帧分配 ---------------- */

  // 加法键：基数即默认值，天赋/升级的增量直接相加。
  // 注意 richMul / magnetSpeedMul 这类「倍率」键也在这里，基数 1，所以天赋写 +0.25 = ×1.25。
  var MOD_ADD = {
    damage: 0,
    oreRateBonus: 0,
    extraLayers: 0,
    dropFlat: 0,
    dropMul: 1,
    richMul: 1,
    richRateBonus: 0,
    magnetSpeedMul: 1,
    chainChance: 0,
    chainCells: 0,
    multiStrikeEvery: 0,
    multiStrikeMul: T.multiStrikeMul,
    overkillTransfer: 0,
    frenzySeconds: T.frenzySeconds,
    roundSeconds: 0,
    tntLayerPierce: CFG.tnt.layerPierce,
    laserDamage: 0,
    // v17：掉率基数 0（掉率全给天赋），tntDrop 每环 +1pp → 10 环满链 0.10
    luckyTNTChance: 0,
    resonanceThreshold: 0,     // v6 地心共振：攒够这么多层触发全屏剥离；0 = 未启用
    // V9 §3 处决阈值：命中后若 block.hp / block.maxHp ≤ 该值就直接碎层；0 = 未买 = 不处决。
    // 逐级值由 01-config 的 exec 节点 levelFx 给（0.12 / 0.20 / 0.30），这里只提供活键与基数。
    execThreshold: 0
  };
  // 乘法键：倍率相乘。settleMul 是「本局结算倍率」，必须乘法叠加：
  // 加法叠加会让后期总倍率被前面的节点摊薄（第 7 关 +28% 实际只剩 +6%），关内成长无法设计。
  // 语义：1.18 = 本局结算 ×1.18；upgrades.bag 每级 ×1.035（与旧口径「+3.5%/级」等价）。
  /* tntDamageMul 是**乘法键**（基数 1）：04-tools 的 tntMulCfg() 口径是
       TNT 每格伤害 = CONFIG.tnt.tntDamageMul(4) × mods.tntDamageMul
     所以 mods 这一侧必须从 1 起步（1 = 不放大）。v7 把它放在 MOD_ADD 且基数是 3，
     实际起步就是 3 × 3 = 9 倍，再叠天赋变成 3 × (3 + 1.5) —— 双重计数。
     v8 的 tntDmg 节点写「每级 ×1.15」，只有乘法键表达得出这个语义。 */
  var MOD_MUL = { holdIntervalMul: 1, magnetRadiusMul: 1, frenzyDropMul: T.frenzyDropMul, settleMul: T.settleMul, tntDamageMul: 1 };

  var M = {};
  var roundBonus = null;   // 三选一加成：{ id, effect }，round:start 前由 UI 设，round 结束清空

  function applyEffect(eff, times) {
    for (var key in eff) {
      var v = eff[key];
      if (typeof v !== 'number' || !isFinite(v)) continue;
      if (MOD_ADD.hasOwnProperty(key)) M[key] += v * times;
      else if (MOD_MUL.hasOwnProperty(key)) M[key] *= Math.pow(v, times);
    }
  }

  // 多级节点（V6 §1）：node.levelEffect[i] 是「买到 i+1 级时的总贡献」，直接取当前等级那一格，
  // 所以 15% → 22% → 30% 这种非等差曲线也能逐级累积；同键跨节点仍然是相加
  // （连锁镐头 3 级 30% + 双刃镐 10% = 40%）。没有 levelEffect 的节点按 effect × 等级线性叠加。
  function applyLevelEffect(node, lv) {
    var list = node.levelEffect;
    if (list && list.length) {
      applyEffect(list[Math.min(lv, list.length) - 1], 1);
      return;
    }
    applyEffect(node.effect, lv);
  }

  function clampMods() {
    // v14：可放置 TNT 删除后只剩穿透一个 TNT 数值键（tntMax / tntRadiusCells 随投放一起下线）
    if (M.tntLayerPierce > CFG.tnt.pierceCap) M.tntLayerPierce = CFG.tnt.pierceCap;
    if (M.tntLayerPierce < 1) M.tntLayerPierce = 1;
    if (M.extraLayers > T.extraLayersCap) M.extraLayers = T.extraLayersCap;
    if (M.extraLayers < 0) M.extraLayers = 0;
    if (M.chainCells > 10) M.chainCells = 10;
    if (M.chainCells < 0) M.chainCells = 0;
    if (M.chainChance > 1) M.chainChance = 1;
    if (M.chainChance < 0) M.chainChance = 0;
    // 珍贵矿石占比（v11 的 8 环链）：03-grid 拿它压低本关填充矿的权重。
    // 夹在 [0, 0.25]——满链只有 0.12，0.25 是「再高就把填充矿压没」的硬边界（03-grid 还有
    // max(8, …) 的权重下限兜底）。负数 = 不生效，不做反向加成。
    if (M.oreRateBonus < 0) M.oreRateBonus = 0;
    if (M.oreRateBonus > 0.25) M.oreRateBonus = 0.25;
    if (M.overkillTransfer > 1) M.overkillTransfer = 1;
    if (M.damage < 0) M.damage = 0;
    if (M.holdIntervalMul < 0.5) M.holdIntervalMul = 0.5;
    if (M.holdIntervalMul > 1) M.holdIntervalMul = 1;
    if (M.frenzySeconds < 0) M.frenzySeconds = 0;
    if (M.laserDamage < 0) M.laserDamage = 0;
    // 掉率夹在 [0, 0.95]：满链 0.9 正好在夹紧线内，再叠任何东西也不会到「必掉」
    if (M.luckyTNTChance < 0) M.luckyTNTChance = 0;
    if (M.luckyTNTChance > 0.95) M.luckyTNTChance = 0.95;
    if (M.tntDamageMul < 1) M.tntDamageMul = 1;
    if (M.resonanceThreshold < 0) M.resonanceThreshold = 0;
    // 处决阈值 > 1 会变成「一击必碎」，夹在 0.9 以内（满级 0.30 远低于此）
    if (M.execThreshold < 0) M.execThreshold = 0;
    if (M.execThreshold > 0.9) M.execThreshold = 0.9;
  }

  /* mods() 是热路径：TNT 连环一帧碎几百层，掉落 / 网格每层都会读一次（实测一帧 40ms 花在这里）。
     按「天赋表 + 强化表 + 本局临时加成」的签名缓存：签名不变直接回同一个对象。
     签名是现拼的（不靠 buyNode 打标记），所以测试 / 存档直接改 state.talents 也一样立刻生效。 */
  var modsSig = null;
  function modsSignature() {
    var parts = '', k, t = state.talents, u = state.upgrades;
    for (k in t) parts += k + '=' + t[k] + ';';
    parts += '|';
    for (k in u) parts += k + '=' + u[k] + ';';
    parts += '|' + (roundBonus ? roundBonus.id : '');
    return parts;
  }
  // 运行时改了 CONFIG 里节点的 effect（只有测试会这么做）时手动作废缓存
  function invalidateMods() { modsSig = null; }
  function mods() {
    var sig = modsSignature();
    if (sig === modsSig) return M;
    modsSig = sig;
    var k;
    for (k in MOD_ADD) M[k] = MOD_ADD[k];
    for (k in MOD_MUL) M[k] = MOD_MUL[k];
    // 单一来源：整棵树按 kind 统一叠（强化 levelEffect 为空 → 按 effect × 等级线性叠加，
    // 天赋逐级取 levelEffect 的那一格，中心节点是 1 级节点）
    for (var ni = 0; ni < NODE_LIST.length; ni++) {
      var node = NODE_LIST[ni];
      var lvl = nodeLevel(node.id);
      if (lvl > 0) applyLevelEffect(node, lvl);
    }
    if (roundBonus && roundBonus.effect) applyEffect(roundBonus.effect, 1);
    clampMods();
    return M;
  }

  // 实际攻击力 = CONFIG.tools[id].dmg + mods().damage
  function toolDamage(id) {
    var tool = CFG.tools[id];
    if (!tool) return 0;
    return tool.dmg + mods().damage;
  }

  /* ---------------- 解锁与目标 ---------------- */

  function hasTool(id) {
    return state.unlockedTools.indexOf(id) >= 0;
  }

  function unlockTool(id) {
    if (typeof id !== 'string' || !CFG.tools[id]) return false;
    if (hasTool(id)) return false;
    state.unlockedTools.push(id);
    return true;
  }

  function hasZone(id) {
    return state.unlockedZones.indexOf(id) >= 0;
  }

  function unlockZone(id) {
    if (typeof id !== 'string') return false;
    if (!zoneCfgById(id) && !isPlaceholder(id)) return false;
    if (hasZone(id)) return false;
    state.unlockedZones.push(id);
    return true;
  }

  // 解锁规则由 zone.unlocks 数据驱动：{ ore, need, tools?[], zones?[] }
  function checkUnlocks() {
    var out = [];
    for (var i = 0; i < CFG.zones.length; i++) {
      var rules = CFG.zones[i].unlocks || [];
      for (var r = 0; r < rules.length; r++) {
        var rule = rules[r];
        var have = clampInt(state.lifetimeMined[rule.ore], 0, MAX_COUNT, 0);
        if (have < rule.need) continue;
        if (rule.zones) {
          for (var z = 0; z < rule.zones.length; z++) {
            if (unlockZone(rule.zones[z])) out.push(rule.zones[z]);
          }
        }
        if (rule.tools) {
          for (var t = 0; t < rule.tools.length; t++) {
            if (unlockTool(rule.tools[t])) out.push(rule.tools[t]);
          }
        }
      }
    }
    // 进入即解锁：已解锁矿区声明的 enterUnlocks（钻石镐靠这条到手）
    for (var zi = 0; zi < state.unlockedZones.length; zi++) {
      var zc = zoneCfgById(state.unlockedZones[zi]);
      var enter = (zc && zc.enterUnlocks) || [];
      for (var e = 0; e < enter.length; e++) {
        if (unlockTool(enter[e])) { out.push(enter[e]); autoSelectTool(enter[e]); }
      }
    }
    // v8 §7.1：武器到下一关自动解锁，天赋树里已经没有任何 unlocksTool 节点，
    // 所以这一圈现在恒为空转。保留成数据驱动的一支：将来若再放解锁型节点，买下即在手上（unlockTool 自己去重）。
    for (var ni = 0; ni < NODE_LIST.length; ni++) {
      var tn = NODE_LIST[ni];
      if (!tn.unlocksTool) continue;
      if (nodeLevel(tn.id) < 1) continue;
      if (unlockTool(tn.unlocksTool)) { out.push(tn.unlocksTool); autoSelectTool(tn.unlocksTool); }
    }
    return out;
  }

  /* 新到手的工具自动换上：「买了就必须真的在手上」。
     v13 起按 CONFIG.tools 的**解锁顺序**判断新旧（不再比伤害）：激光钻 8 伤 < 钻石镐 10 伤，
     但它是第 4 关的新工具，进关必须换上去；补买旧工具则不会把玩家打回上一把。 */
  function toolOrderIndex(id) {
    var ids = Object.keys(CFG.tools || {});
    var i = ids.indexOf(id);
    return i < 0 ? -1 : i;
  }

  function autoSelectTool(id) {
    var next = CFG.tools[id];
    if (!next) return false;
    var ni = toolOrderIndex(id);
    var ci = toolOrderIndex(state.selectedTool);
    if (ci >= 0 && ni < ci) return false;
    state.selectedTool = id;
    return true;
  }

  // 集成层展示用：'新工具：石镐' / '新区域：铁矿层'
  function describeUnlock(id) {
    if (CFG.tools[id]) return '新工具：' + CFG.tools[id].name;
    if (isPlaceholder(id)) return '已解锁（未开放）：' + CFG.placeholders[id].name;
    var z = zoneCfgById(id);
    if (z) return '新区域：' + z.name;
    return String(id);
  }

  function nextObjective() {
    var z = currentZoneCfg();
    var ob = objectiveOf(z);
    return { zoneId: z.id, ore: ob.ore, need: ob.need, have: ob.have, done: ob.done };
  }

  /* ---------------- 推荐升级 ---------------- */

  // 整棵树里最便宜的「现在买得起」的节点（天赋 / 强化 / 中心一视同仁）
  function recommendUpgrade() {
    var best = null;
    var bestCost = null;
    for (var i = 0; i < NODE_LIST.length; i++) {
      var node = NODE_LIST[i];
      if (nodeState(node.id) !== 'available') continue;
      // v16c：长尾节点（矿层加深 999 级）不参与推荐，让玩家自己决定要不要堆层数
      if ((node.maxLevel || 1) >= 50) continue;
      var cost = nodeCost(node.id);
      if (cost > state.coins) continue;
      if (bestCost === null || cost < bestCost) {
        best = { id: node.id, name: node.name };
        bestCost = cost;
      }
    }
    if (!best) return null;
    return { id: best.id, name: best.name, cost: bestCost.toString() };
  }

  /* ---------------- 结算 ---------------- */

  function scaleRound(total, mul) {
    if (typeof mul !== 'number' || !isFinite(mul) || mul <= 0 || mul === 1) return total;
    var m = Math.round(mul * 10000);
    if (m === 10000) return total;
    var num = total * BigInt(m);
    return (num + 5000n) / 10000n; // 正数四舍五入
  }

  function settleRound(stats) {
    var st = (stats && typeof stats === 'object') ? stats : {};
    var zone = zoneCfgById(st.zoneId) || currentZoneCfg();
    var src = (st.counts && typeof st.counts === 'object') ? st.counts : {};

    var counts = {};
    var lines = [];
    var total = 0n;
    for (var i = 0; i < ORE_IDS.length; i++) {
      var ore = ORE_IDS[i];
      var oreCfg = CFG.ores[ore];
      var c = clampInt(src[ore], 0, MAX_COUNT, 0);
      counts[ore] = c;
      if (c <= 0) continue;
      var price = BigInt(oreCfg.price || 0);
      var sub = BigInt(c) * price;
      total += sub;
      lines.push({ ore: ore, name: oreCfg.name, count: c, price: oreCfg.price || 0, subtotal: sub.toString() });
    }

    // 掉落数量与单价都不动（BALANCE-V4 §4）：收益靠本关 coinMul 放大（ZONES-V5 §2 的 1/5/25/…/15000）。
    // 默认倍率读 mods().settleMul（基础值就是 tuning.settleMul，bag 每级再 +0.035）；st.mul 可显式覆盖，
    // 但 coinMul 是本关的常数，任何倍率都要再乘它。
    var mul = (typeof st.mul === 'number' && isFinite(st.mul) && st.mul > 0) ? st.mul : mods().settleMul;
    var coinMul = (typeof zone.coinMul === 'number' && isFinite(zone.coinMul) && zone.coinMul > 0)
      ? Math.round(zone.coinMul) : 1;
    var earned = total > 0n ? scaleRound(total, mul) * BigInt(coinMul) : 0n;
    if (total > 0n && earned < 1n) earned = 1n; // 挖到东西就一定给到 1 金币

    addCoins(earned);
    for (var o = 0; o < ORE_IDS.length; o++) {
      if (counts[ORE_IDS[o]] > 0) {
        state.lifetimeMined[ORE_IDS[o]] = clampInt(state.lifetimeMined[ORE_IDS[o]], 0, MAX_COUNT, 0) + counts[ORE_IDS[o]];
      }
    }
    state.roundsPlayed += 1;
    if (earned > state.bestRound.coins) {
      state.bestRound.coins = earned;
      state.bestRound.zoneId = zone.id;
    }

    // 先推进关卡、再扫解锁：每关的新工具挂在 zones[].enterUnlocks 上，
    // 若先扫解锁再推进，玩家「刚进第 N 关」的第一局还得拿上一关的工具打（差一整局的手感）
    var objective = objectiveOf(zone);
    // v6 §3：最终关 objective 达标、且本档还没挖到宝箱 -> 让集成层生成本局地心宝藏
    var treasureReady = !!(zone.final && objective.done && !state.victory);
    var unlocked = [];
    if (objective.done && zone.nextZone && zoneCfgById(zone.nextZone)) {
      state.currentZone = zone.nextZone;
      if (unlockZone(zone.nextZone)) unlocked.push(zone.nextZone);
    }
    unlocked = unlocked.concat(checkUnlocks());

    save();

    return {
      zoneId: zone.id,
      counts: counts,
      lines: lines,
      coinsEarned: earned.toString(),
      coinMul: coinMul,
      coinsTotal: state.coins.toString(),
      coinsTotalAbbr: abbr(state.coins),
      stats: {
        brokenBlocks: clampInt(st.brokenBlocks, 0, MAX_COUNT, 0),
        maxCombo: clampInt(st.maxCombo, 0, MAX_COUNT, 0),
        explosions: clampInt(st.explosions, 0, MAX_COUNT, 0),
        maxChain: clampInt(st.maxChain, 0, MAX_COUNT, 0)
      },
      unlocked: unlocked,
      objective: objective,
      treasureReady: treasureReady,
      recommendUpgrade: recommendUpgrade(),
      nextZoneId: zone.nextZone || null
    };
  }

  /* ---------------- 集成层 API ---------------- */

  function zoneById(id) {
    var z = zoneCfgById(typeof id === 'string' ? id : (id && id.id));
    return z || currentZoneCfg();
  }

  function resolveRoundSeconds(zoneCfg) {
    var z = (zoneCfg && typeof zoneCfg.timeSec === 'number') ? zoneCfg : currentZoneCfg();
    var secs = z.timeSec + mods().roundSeconds;
    var cap = T.timeCapSec || 45;
    if (secs > cap) secs = cap;
    if (secs < 5) secs = 5;
    return Math.round(secs);
  }

  function setTool(id) {
    if (typeof id !== 'string' || !hasTool(id)) return false;
    if (state.selectedTool === id) return true;
    state.selectedTool = id;
    save();
    return true;
  }

  function setMuted(flag) {
    state.muted = !!flag;
    save();
    return state.muted;
  }

  function getMuted() {
    return !!state.muted;
  }

  // v6 §3：宝箱被挖穿 —— 只记首次胜利（victoryAt 不被后续调用覆盖），并立即落盘
  function markVictory() {
    if (state.victory) return false;
    state.victory = true;
    state.victoryAt = Date.now();
    save();
    return true;
  }

  /* ---------------- 导出 ---------------- */

  BM.CORE = {
    state: state,
    load: load,
    save: save,
    resetSave: resetSave,
    fmt: fmt,
    abbr: abbr,
    canAfford: canAfford,
    addCoins: addCoins,
    spendCoins: spendCoins,
    /* ---- v7 统一节点接口（TREE-V7 §4）---- */
    tree: TREE,
    nodeById: nodeById,
    nodeLevel: nodeLevel,
    nodeState: nodeState,
    nodeCost: nodeCost,
    buyNode: buyNode,
    /* ---- 兼容别名（全部转发到上面五个；面板合并前的老调用方用）---- */
    upgradeLevel: upgradeLevel,
    upgradeCost: upgradeCost,
    buyUpgrade: buyUpgrade,
    talentLevel: talentLevel,
    hasTalent: hasTalent,
    ownedTalents: ownedTalents,
    talentState: talentState,
    talentCost: talentCost,
    buyTalent: buyTalent,
    resetTalents: resetTalents,
    mods: mods,
    invalidateMods: invalidateMods,
    // effect 白名单（死键测试的唯一来源）：只有这两个表里的键会被 mods() 累加
    modKeys: function () {
      return { add: Object.keys(MOD_ADD), mul: Object.keys(MOD_MUL) };
    },
    toolDamage: toolDamage,
    oreHp: oreHp,
    settleRound: settleRound,
    markVictory: markVictory,
    checkUnlocks: checkUnlocks,
    describeUnlock: describeUnlock,
    unlockTool: unlockTool,
    hasTool: hasTool,
    unlockZone: unlockZone,
    hasZone: hasZone,
    nextObjective: nextObjective,
    zoneById: zoneById,
    currentZone: currentZoneCfg,
    resolveRoundSeconds: resolveRoundSeconds,
    setTool: setTool,
    setMuted: setMuted,
    getMuted: getMuted
  };

  load();
})();