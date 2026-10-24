(function () {
  'use strict';
  window.BM = window.BM || {};
  var BM = window.BM;

  /* ---------------- §1 事件总线 ---------------- */

  var handlers = Object.create(null);
  var emitting = 0;

  function compact(list) {
    var w = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i] !== null) list[w++] = list[i];
    }
    list.length = w;
  }

  BM.bus = {
    on: function (type, fn) {
      if (typeof type !== 'string' || typeof fn !== 'function') return function () {};
      var list = handlers[type];
      if (!list) { list = handlers[type] = []; }
      list.push(fn);
      var cancelled = false;
      return function () {
        if (cancelled) return;
        cancelled = true;
        BM.bus.off(type, fn);
      };
    },

    off: function (type, fn) {
      var list = handlers[type];
      if (!list) return;
      for (var i = 0; i < list.length; i++) {
        if (list[i] === fn) {
          // 派发中只打标记，避免移位漏掉后面的订阅者
          if (emitting > 0) list[i] = null;
          else list.splice(i, 1);
          break;
        }
      }
      if (list.length === 0) delete handlers[type];
    },

    emit: function (type, data) {
      var list = handlers[type];
      if (!list || list.length === 0) return;
      if (emitting === 0) compact(list);
      if (list.length === 0) { delete handlers[type]; return; }
      // 快照长度：本次派发中途新加的订阅者留到下一次，符合直觉且不分配数组
      var n = list.length;
      emitting++;
      for (var i = 0; i < n; i++) {
        var fn = list[i];
        if (fn === null || fn === undefined) continue;
        try {
          fn(data);
        } catch (err) {
          console.warn('[BM.bus] 订阅者抛错 type=' + type, err);
        }
      }
      emitting--;
    }
  };

  /* ---------------- §2 设计空间 ---------------- */

  BM.DESIGN = { w: 390, h: 844 };
  BM.BOARD = { x: 10, y: 96, w: 370, h: 636 };

  /* ---------------- §5 价格：深度倍率（v10 单级链口径） ----------------

     v10 把「一个多级节点」拆成「一条链上的多个单级节点」。第 i 个节点就站在第 i 层深度上，
     每个节点只买一次（没有 1.9 的等级幂），所以

       价格 = baseCost × depthMul[深度]

     要让一条链的报价曲线仍然等于旧的「首级 × 1.9^(i-1)」，depthMul 必须是 ≈ 1.9^(d-1) 的整数阶梯。

     为什么不能沿用 1/6/30/150/750/3800/19000：那套阶梯每档 ×5，再乘上 1.9 的链位置，
     一条 10 节点的链光 baseCost=1 就要 1,205 万金（≈ 旧整树总价的 7 倍），与「整树总价 ±20%」
     直接冲突。换成 1/2/4/7/13/25/47/89/170/323（= round(1.9^(d-1))）之后，链上每一档与旧的
     多级价目差 <5%、整树总价差 <2%，而「越往外越贵」仍然成立（每一环比上一环贵 1.85–2 倍）。 */
  var NODE_PRICE = {
    // v13：阶梯从 1.9^(d-1) 抬到 2.6^(d-1)（深度 1..10）。原因不是「涨价」，而是**局数**：
    // TNT 满链后一局能覆盖整个盘面，单局收入到百万级；旧阶梯最深一环只有 30 万，
    // 一局就能买空剩下的树（单局购买 22 个）。2.6 的阶梯让最深一环到 160 万，
    // 树总价 ≈3,500 万，正好铺满 45–80 局、单局购买 ≤4。
    depthMul: [1, 3, 7, 18, 46, 119, 309, 803, 2088, 5430],  // round(2.6^(d-1))，深度 1..10（最长链 atk 10）
    // v13：首环（深度 1 = 中心直接挂的 5 个链头）整环再 ×0.65（下调 35%），
    // 让「第一关就能连着点」成立；深度 2 起维持 1.9 阶梯。
    firstRingMul: 0.65,
    levelStep: 1.9                    // 兼容字段：旧的「多级 ×1.9」口径，v10 不再使用
  };

  /* ---------------- §6 天赋树 v10：一条链上的多个单级节点 ----------------

     与 v8 的结构性差别（本轮的全部设计）：
     1. v8 的 10 个多级节点（+中心 mine）全部拆成链：一条链上的每个节点只买一次（maxLevel = 1），
        节点数 11 → 82（中心 1 + 天赋 81；v11 再加 8 环的珍贵矿石占比链），树在图上「看得出大」。
     2. 价格没有「关」这一维，也没有等级幂：每个节点的价 = baseCost × depthMul[它的深度]（§5）。
     3. **武器不进天赋树**（docs/TREE-V8.md §7.1）：六把工具的解锁只有 zones[].enterUnlocks
        一条路（到下一关自动到手）。武器形状本来就自带，所以范围/附加伤害类节点也一并删掉，
        checkUnlocks 里那圈 unlocksTool 循环因此没有节点可喂（保留为无副作用的数据驱动分支）。
     节点自有字段：id / name / parent / levels / effect(每级) / icon / desc；
     建树期再补：requires（= [parent]）/ depth（parent 链步数）/ ring（= depth，UI 环号）/
     cost（首级实价快照）/ effect（本节点这一步的增量）。

     effect 只允许写**活键**（03-grid / 04-tools / 05-drops 真会读的字段，白名单见
     02-core 的 MOD_ADD / MOD_MUL）：damage / dropFlat / chainChance / holdIntervalMul /
     settleMul / tntDamageMul / luckyTNTChance / oreRateBonus。
     （laserDamage 仍是活键，但 v8 §7.1 删掉 laserCol 后没有节点再写它 —— 激光的「整列」是工具形状自带的。）
     docs/TREE-V8.md 里两个代码里没有的键按等价强度落在这张表上，并在 desc 里写明。 */

  var CENTER_ID = 'mine';

  /* §6.1 五条分支（角度只给 UI 用：画布 y 向下，-90 = 正上方）。
     每条分支 = 从中心节点走出去的第一条边；节点自带 lane 归到其中一条。
     v8 §7.1 删掉武器链后「工具」分支为空，整条 lane 一起删（留着只会画一个没有节点的方向）。 */
  var lanes = [
    { id: 'power', name: '攻击', angle: -90, glyph: '攻' },
    { id: 'settle', name: '结算', angle: -30, glyph: '币' },
    { id: 'tntDrop', name: 'TNT 掉落', angle: 30, glyph: '弹' },
    { id: 'tnt', name: 'TNT', angle: 90, glyph: '穿' },
    { id: 'chain', name: '连锁', angle: 150, glyph: '连' },
    /* v15：999 级长尾节点「矿层加深」独占第 6 条枝。
       08-ui 的布局按 parent 算角度、按 360°/根子节点数 切扇区，ui.smoke 钉死
       「根的子节点数 = lanes 数、各占一条扇区」——所以给它单独一条 lane（角度 210 补满 6 等分）。 */
    { id: 'deep', name: '矿层', angle: 210, glyph: '层' }
  ];

  /* §6.2 单级节点链（v10：一个「大节点」= 一条链上的多个单级节点，用户明确要求树要看得出大）

     每条链 = v8 的一个多级节点。第 i 个节点：
       id       = <前缀>i（atk1 … atk10）
       name     = <基名> +<i>（攻击 +1 / 攻击 +2 …，靠编号区分第几级）
       maxLevel = 1（买一次就满，没有 Lv i/N）
       effect   = **只写这一步的增量**（加法键 +一次、乘法键 ×一次），不是累计值
       requires = [链上前一个]；链头（i=1）挂到 head（根链 = mine，侧链 = 对应 lane 的链头）
       desc     = 「第 i/N 个：<这一级给什么>」
     深度 = parent 链步数 = 链位置（侧链 +1），价格 = baseCost × depthMul[深度]（§5）。

     baseCost 一律按「旧的首级实价 = baseCost × 新阶梯[链头深度]」反解，与 v9b 的 ×1.5 收益补偿无关：
       根链（链头挂 mine，深度 1）= 旧 base（450/1.5 = 300 这一档，撤掉了 1.5 补偿）；
       侧链（链头挂第 2 环，深度 3）= 旧 base × 1.5 = 旧侧链首级实价（旧深度 2 倍率 6）÷ 新阶梯第 3 档 4。
     侧链之所以挂在第 2 环而不是第 1 环：UI 的扇区算法给每条枝 72°，链头同时挂 3 个子节点时
     第 2 环的相邻弧长会掉到 40px 以下（ui.smoke 的「同深度不重叠」会红）；挂在第 2 环让每个节点
     只有 2 个子节点，实测第 3 环最小弧长 53px。

     v14 链长（合计 74 个 + 中心 mine = 75）：atk 10 / settle 10 / spd 8 / tntDrop 8 / tntDmg 8 /
     chain 10 / oreRate 8 / ore 5 / exec 3 / tntPierce 2
     （可放置 TNT 整套删除：放置专属的 tntRange 4 环随之变成死键一起删，tntPierce 3 环收敛到 2 环
     —— 后期一局别清空盘面。节点数 80 → 75。） */
  var CHAIN_DEFS = [
    /* ---- v13：每级效果整体加强 30–60%（用户：树太短、第一关就点完很多） ---- */
    /* ---- 攻击 lane：伤害链 10 环 + 处决 3 环 + 攻速 8 环 ---- */
    { prefix: 'atk', base: '攻击', lane: 'power', head: CENTER_ID, count: 10, icon: 'pick',
      effect: { damage: 2 }, baseCost: 900,
      harm: '挖得更狠：每次多打 2 点血（四把工具一起变强）' },
    { prefix: 'exec', base: '处决', lane: 'power', head: 'atk2', count: 3, icon: 'sword',
      deltas: [{ execThreshold: 0.18 }, { execThreshold: 0.12 }, { execThreshold: 0.15 }], baseCost: 300,
      harm: '命中后该格剩余血量 ≤ 阈值就立刻碎层（三步累计 18% → 30% → 45%，本节点补到下表）',
      steps: ['阈值 18%', '阈值 30%（+12pp）', '阈值 45%（+15pp）'] },
    { prefix: 'spd', base: '攻速', lane: 'power', head: 'atk2', count: 8, icon: 'clock',
      effect: { holdIntervalMul: 0.93 }, baseCost: 2000,
      harm: '按住连发间隔 ×0.93（攻速 +7%，满链 ×0.56）' },

    /* ---- 结算 lane：结算倍率 10 环 + 掉落 5 环 ---- */
    { prefix: 'settle', base: '结算', lane: 'settle', head: CENTER_ID, count: 10, icon: 'coin',
      effect: { settleMul: 1.08 }, baseCost: 750,
      harm: '这一局结束后，金币多 8%' },
    { prefix: 'ore', base: '矿石掉落', lane: 'settle', head: 'settle2', count: 5, icon: 'gem',
      effect: { dropFlat: 1 }, baseCost: 4400,
      harm: '每打穿一层多掉 1 个矿（满链每层 +5）' },

    /* ---- 珍贵矿石占比 lane：8 环，每环 +2pp 本关贵重矿占比（满链 +16pp） ----
       oreRateBonus 在 03-grid 里只压低**本关填充矿**（zone.filler）的权重，所以这条链
       天然对准每关：第 1 关抬煤、第 2 关抬铁、第 3 关抬金、第 4 关抬晶。
       权重不会被压到 0/负数：03-grid 有 max(8, …) 的下限，02-core 把键夹在 [0, 0.25]。
       链头挂 settle1（第 2 环）而不是中心：ui.smoke 钉死「根的子节点数 = lanes 数、各占一条
       lane」，且 08-ui 的扇区是「根的子节点整圈均分」—— 中心多挂一条枝会把 5 条扇区从 72°
       压到 60°，实测 depth 2 的 exec1/spd1 弧长掉到 36px < 40px 下限（ui.smoke 会红）。
       与 ore 链同 lane（结算），挂在 settle1 下面：深度 2..9，ui 实测弧长仍 ≥ 40px。 */
    { prefix: 'oreRate', base: '贵重占比', lane: 'settle', head: 'settle1', count: 8, icon: 'gem',
      effect: { oreRateBonus: 0.02 }, baseCost: 800,
      harm: '这关值钱的矿更多一点' },

    /* ---- TNT 掉落 lane：掉落 8 环 + 伤害 8 环（掉率 50% 起步 → 满链 90% / ×4.30 的爽感） ---- */
    /* v17（用户）：5% 一步到位太高 —— 拉长成 10 环、每环 +1pp，满链 10%。
       价格走 fixedCost 软门槛（见下方 TNT_COST）：第 1 环第一关随手点，第 2 环起要第二关的收入。 */
    { prefix: 'tntDrop', base: 'TNT 掉落', lane: 'tntDrop', head: CENTER_ID, count: 10, icon: 'bomb',
      effect: { luckyTNTChance: 0.01 }, baseCost: 150,
      harm: '挖矿时偶尔会掉一颗 TNT（1%）' },
    { prefix: 'tntDmg', base: 'TNT 伤害', lane: 'tntDrop', head: 'tntDrop2', count: 8, icon: 'bomb',
      effect: { tntDamageMul: 1.20 }, baseCost: 2200,
      harm: 'TNT 每格伤害 ×1.20（满链 ×4.30）' },

    /* ---- TNT lane（v14：只剩「掉落的 TNT 怎么炸得更深」）----
       可放置 TNT 整套删除（按钮 / 投掷态 / placeTNT / 每局弹药全部下线），所以：
       · 放置专属的 tntRange 4 环失去唯一消费者（mods.tntRadiusCells 只被 tntSide() 读，
         而 tntSide() 只服务投放与投放预览），变成 4 个死键节点，随放置功能一起删掉；
       · 穿透链 tntPierce 3 环 → 2 环：mods.tntLayerPierce = 基础 2 + 2 环 = 4（pierceCap 4）。
         晚期的 TNT 连锁靠「掉率 90% + 同屏 60 引信」推动，再叠 5 层穿透会在十几秒内清空盘面。 */
    { prefix: 'tntPierce', base: 'TNT 穿透', lane: 'tnt', head: CENTER_ID, count: 2, icon: 'tntbox',
      effect: { tntLayerPierce: 1 }, baseCost: 600,
      harm: 'TNT 引爆时额外多炸 1 层（基础 2 层 → 满链 4 层）' },

    /* ---- 连锁 lane：连锁率 8 环 + 范围 4 环 ---- */
    { prefix: 'chain', base: '连锁', lane: 'chain', head: CENTER_ID, count: 10, icon: 'chain',
      effect: { chainCells: 1 }, baseCost: 90, levels: 10, grow: 1.6,
      harm: '一镐下去，旁边 1 格也跟着碎一层' }
  ];

  /* 链 → 单级节点表。顺序 = CHAIN_DEFS 顺序 + 链内由内向外（UI 只读这张表）。 */
  var NODE_DEFS = [];
  (function () {
    for (var ci = 0; ci < CHAIN_DEFS.length; ci++) {
      var ch = CHAIN_DEFS[ci];
      for (var i = 1; i <= ch.count; i++) {
        var eff = ch.deltas ? ch.deltas[i - 1] : ch.effect;
        NODE_DEFS.push({
          id: ch.prefix + i,
          name: ch.base + ' +' + i,
          lane: ch.lane,
          parent: i === 1 ? ch.head : (ch.prefix + (i - 1)),
          levels: 1,
          icon: ch.icon,
          effect: eff,
          baseCost: ch.baseCost,
          desc: ch.harm
        });
      }
    }
  })();

  /* §6.2b 长尾节点（v15）：999 级「矿层加深 +1」，单节点、不是链，直接挂中心 mine。
     用户明确要求：每级 = 每格矿多一层（effect × 等级 的加法口径，不写 999 长度的 levelEffect 数组）；
     价格线性 300 × 当前等级（第 1 级 300 / 第 10 级 3,000 / 第 100 级 30,000 / 第 999 级 299,700），
     由 02-core 的 nodeCost 按 maxLevel ≥ 50 分支现算，这里只给首级快照。
     它不进 CHAIN_DEFS：那条流水线专门生成「单级链节点」（maxLevel = 1、编号命名、parent = 上一环）。 */
  NODE_DEFS.push({
    id: 'deepLayer', name: '矿层加深 +1', lane: 'deep', parent: CENTER_ID,
    levels: 999, icon: 'gem',
    effect: { extraLayers: 1 }, baseCost: 300,
    desc: '每块矿多一层，挖得更久（越买越贵）'
  });

  var NODE_BY_ID = {};
  (function () {
    for (var i = 0; i < NODE_DEFS.length; i++) NODE_BY_ID[NODE_DEFS[i].id] = NODE_DEFS[i];
  })();

  // 深度 = parent 链走到中心的步数（中心自己 = 0）。父节点缺失时停在当前层，
  // 由 core.test 的「每条 parent 链可追溯到中心」把它钉死。
  function depthOf(id) {
    var d = 0;
    var cur = NODE_BY_ID[id];
    var guard = 0;
    while (cur && guard++ < 64) {
      var p = cur.parent;
      if (!p) break;
      d++;
      if (p === CENTER_ID) break;
      cur = NODE_BY_ID[p];
      if (!cur) break;
    }
    return d;
  }

  function depthMulOf(depth) {
    var list = NODE_PRICE.depthMul;
    var i = Math.round(depth) - 1;
    if (!(i > 0)) return 1;
    if (i > list.length - 1) i = list.length - 1;
    return list[i];
  }

  // 单级节点：只写 effect（= 本节点这一步的增量）。02-core 的 applyLevelEffect 在没有
  // levelEffect 时按 effect × 等级叠加，所以单级节点的 effect 等价于「加一次」；
  // v15 的 999 级节点同样只写「每级 +1」，等级由 02-core 现乘（不写 999 长度的 levelEffect 数组）。
  function buildNode(def) {
    var depth = depthOf(def.id);
    var maxLv = def.levels > 0 ? Math.round(def.levels) : 1;
    // 长尾节点（maxLevel ≥ 50）走线性价：第 n 级 = baseCost × n。首级不吃首环折扣
    // （用户钉死「第 1 级 300」），与 02-core 的 isLinearNode 分支同一口径。
    var linear = maxLv >= 50;
    return {
      id: def.id, name: def.name, kind: 'talent', icon: def.icon, desc: def.desc,
      lane: def.lane, parent: def.parent, depth: depth,
      ring: depth,                                   // UI 环号 = 深度（0 是中心）
      levels: maxLv,
      maxLevel: maxLv,                               // 单级节点 = 1；长尾节点 = 999
      requires: def.parent ? [def.parent] : [],
      baseCost: def.baseCost,
      linearCost: linear,                            // 长尾节点标记（02-core / 测试同口径）
      // 首级实价快照（真价由 CORE.nodeCost 现算）：首环吃 firstRingMul 的 35% 下调
      cost: linear
        ? def.baseCost
        : Math.round(def.baseCost * (depth === 1 ? NODE_PRICE.firstRingMul : 1)) * depthMulOf(depth),
      effect: def.effect
    };
  }

  /* §6.3 渲染顺序：按 lane 分组、组内由内向外（UI 只读这张表，不自己排序）。 */
  var treeNodes = [];
  var talents = {};
  for (var lj = 0; lj < lanes.length; lj++) {
    for (var nj = 0; nj < NODE_DEFS.length; nj++) {
      if (NODE_DEFS[nj].lane !== lanes[lj].id) continue;
      var built = buildNode(NODE_DEFS[nj]);
      treeNodes.push(built);
      talents[built.id] = built;
    }
  }

  /* §6.4 中心节点 mine（开始挖矿）：所有武器伤害 +1。
     价格 30 = 首局收入的 1/4 左右（test/progression.mjs 实测采石场首局 128–392 金，
     最差种子也有 40+）：打完第一局一定买得起，是整棵树的起点。 */
  var treeCenter = {
    id: CENTER_ID, name: '开始挖矿', kind: 'core', icon: 'pick',
    desc: '所有武器伤害 +1（一切的起点）',
    lanes: null, lane: null, parent: null, depth: 0, ring: 0,
    levels: 1, maxLevel: 1, requires: [],
    baseCost: 30, cost: 30, effect: { damage: 1 }
  };

  /* 数据模型：UI 只渲染，不改数据。
     中心 1 + 天赋 79 = 80 个节点（每个节点 maxLevel = 1，对应手绘图上一个圆圈）。 */
  var tree = {
    center: treeCenter,
    lanes: lanes,
    nodes: treeNodes
  };

  (function () {
    /* v17：TNT 掉落链的价格软门槛（固定价，不走深度阶梯）——
       第 1 环 290 金 / 1%：第一关随手点，偶尔掉落一颗当彩蛋；
       第 2 环直接 10 万：第一关买不动，第二关（TNT 关）才开始一环环往上点；
       之后每环约 ×1.45，第 10 环 190 万（第三关后半段收入）。 */
    var TNT_COST = [290, 100000, 150000, 220000, 330000, 480000, 700000, 950000, 1350000, 1900000];
    for (var qi = 0; qi < treeNodes.length; qi++) {
      var mt = /^tntDrop(\d+)$/.exec(treeNodes[qi].id);
      if (mt) { treeNodes[qi].fixedCost = TNT_COST[Number(mt[1]) - 1]; treeNodes[qi].cost = treeNodes[qi].fixedCost; }
    }
  })();
  /* 索引表里也放中心节点：旧调用方（test/progression.mjs 的贪心买家、08-ui 的
     「已购天赋」统计）都是「遍历 CONFIG.talents 逐个买」，中心不在索引里就永远买不到它，
     而 v8 的 10 个节点全部以 mine 为（间接）前置 —— 整棵树会永远锁死。 */
  talents[treeCenter.id] = treeCenter;

  /* ---------------- §4.1 BM.CONFIG v5 ---------------- */

  BM.CONFIG = {
    version: 7,
    saveKey: 'blockminer.save.v7',
    legacySaveKeys: ['blockminer.save.v6', 'blockminer.save.v5', 'blockminer.save.v4', 'blockminer.save.v3'],

    /* §2 矿物：单价固定 1/6/40/150/400（7 关共用 4 套美术；金矿复用煤矿贴图并金色化）；
       hp 只是缺省回落，实际血量由 zones[].ores[].hp 按关覆盖；
       收益靠 zones[].coinMul 放大，掉落数量不变 */
    ores: {
      stone: {
        id: 'stone', name: '石头', price: 1, hp: 3, drop: [1, 1], richDrop: [2, 2],
        color: '#7d7d7d', vein: '#5a5a5a', glow: '#9a9a9a', edge: '#2a2a2a'
      },
      coal: {
        id: 'coal', name: '煤矿', price: 6, hp: 2, drop: [1, 1], richDrop: [2, 2],
        color: '#7d7d7d', vein: '#171717', glow: '#3a3a3a', edge: '#2a2a2a'
      },
      iron: {
        id: 'iron', name: '铁矿', price: 40, hp: 42, drop: [1, 1], richDrop: [2, 2],
        color: '#7d7d7d', vein: '#d8b98a', glow: '#a9855c', edge: '#2a2a2a'
      },
      /* 金矿（v10）：单价 150 夹在铁 40 与晶 400 之间（既不贴铁也不贴晶，跨关跳变交给 coinMul）。
         没有独立美术：03-grid / 05-drops / 08-ui 都复用煤矿贴图并做「金色化」（金色 #ffc857）。
         hp 只是缺省回落，实际按关覆盖（第 3 关 24 / 第 4 关 44 = 本关主力工具约 2 击一层）。 */
      gold: {
        id: 'gold', name: '金矿', price: 150, hp: 24, drop: [1, 1], richDrop: [2, 2],
        color: '#c8912e', vein: '#ffc857', glow: '#ffe9a8', edge: '#7a5418'
      },
      crystal: {
        id: 'crystal', name: '晶石', price: 400, hp: 240, drop: [1, 1], richDrop: [1, 1],
        color: '#4a3f5c', vein: '#6fd8e0', glow: '#a8e8ff', edge: '#2a2a2a'
      }
    },

    /* §3 四关（v13：7 关 → 4 关，一关一种主矿）
       用户明确要求的结构：石+煤 / 煤+铁 / 铁+金 / 金+晶 —— 每关的「填充矿」就是上一关的目标矿，
       目标矿逐关升级，单价 1/6/40/150/400 不变。
       coinMul 的职责仍然只有一个：**把矿价台阶和工具几何之间对不齐的落差补平**，
       让四关的跨关收入比落在 2–4 倍（test/balance.mjs 的「满配跨关比」实测值见交付说明）。
       层数按用户要求大幅抬高：8–10 / 12–14 / 16–18 / 20–22（03-grid 的 MAX_LAYERS 同步抬到 24）。
       血量口径：以本关主力工具「买满本关伤害后」约 2 击碎一层为基准，再按实测碎层率微调；
       filler 是「填充矿」：由 zones[].ores[].weight 定基准，天赋 oreRateBonus（8 环 ×2pp）
       会继续压低填充矿权重，所以那条链天然对准每关的贵重矿。 */
    zones: [
      {
        // 第 1 关：石（填充）+ 煤（目标）。木镐 1 伤、tap 0.4 秒；石/煤 hp 3 → 起步 3 击一层。
        // coinMul 8：raw 单局收入只有几十金；×8 之后首局就买得起中心（30）与首环（162–520）。
        id: 'quarry', name: '煤矿层', coinMul: 3, timeSec: 15, cols: 6, rows: 8, filler: 'stone',
        layerMin: 8, layerMax: 10,
        ores: [
          { ore: 'stone', weight: 70, richRate: 0.05, hp: 3 },
          { ore: 'coal', weight: 30, richRate: 0.03, hp: 3 }
        ],
        // need = 实测每局煤产量 × 目标局数（见交付说明的实测读数）
        objective: { ore: 'coal', need: 1800 }, nextZone: 'copperRidge',
        unlocks: [], enterUnlocks: []
      },
      {
        // 第 2 关：煤（填充）+ 铁（目标）。铁镐 3 伤、column2（一次两格）、按住 0.42 秒。
        id: 'copperRidge', name: '铁矿层', coinMul: 2, timeSec: 15, cols: 6, rows: 8, filler: 'coal',
        layerMin: 12, layerMax: 14,
        ores: [
          { ore: 'coal', weight: 70, richRate: 0.04, hp: 14 },
          { ore: 'iron', weight: 30, richRate: 0.10, hp: 16 }
        ],
        objective: { ore: 'iron', need: 7000 }, nextZone: 'blueIron',
        unlocks: [], enterUnlocks: ['iron']
      },
      {
        // 第 3 关：铁（填充）+ 金（目标）。钻石镐 10 伤、3×3（外圈 ×0.45）、0.55 秒。
        // 金 hp 62：满伤害链（diamond 31 伤）2 击一层；外圈 14 伤约 5 击。
        id: 'blueIron', name: '金矿层', coinMul: 1, timeSec: 15, cols: 6, rows: 8, filler: 'iron',
        layerMin: 16, layerMax: 18,
        ores: [
          { ore: 'iron', weight: 70, richRate: 0.06, hp: 36 },
          { ore: 'gold', weight: 30, richRate: 0.12, hp: 62 }
        ],
        objective: { ore: 'gold', need: 20000 }, nextZone: 'lavaEdge',
        unlocks: [], enterUnlocks: ['diamond']
      },
      {
        // 第 4 关：金（填充）+ 晶（目标）。激光钻 8 伤、整列每格（同列 ×0.7）、按住 0.15 秒。
        // 晶 hp 58：满伤害链（laser 29 伤）2 击一层；同列其它格 20 伤约 3 击。
        id: 'lavaEdge', name: '晶石层', coinMul: 1, timeSec: 15, cols: 6, rows: 8, filler: 'gold',
        layerMin: 20, layerMax: 22,
        ores: [
          { ore: 'gold', weight: 65, richRate: 0.12, hp: 52 },
          { ore: 'crystal', weight: 35, richRate: 0.18, hp: 58 }
        ],
        objective: { ore: 'crystal', need: 52000 }, nextZone: null, final: true,
        unlocks: [], enterUnlocks: ['laser']
      }
    ],

    // v3 起没有占位区域；保留空表让旧接口安全退化
    placeholders: {},

    /* §4 四把工具（v13：7 把 → 4 把，一关一把）：
       single / column2 / square3 / columnAll —— 石镐（single 2 伤）与震荡器（square7）、
       深核钻机（square9）整批删除。解锁一律走 zones[].enterUnlocks（开局只有木镐）。 */
    tools: {
      // 木镐 interval 0.4：点按与按住共用同一份 cd（04-tools 的单一节拍）。
      wood: { id: 'wood', name: '木镐', dmg: 1, mode: 'tap', interval: 0.4, shape: 'single', desc: '单格点按，每击 1 点（每 0.4 秒一下）' },
      iron: { id: 'iron', name: '铁镐', dmg: 3, mode: 'hold', interval: 0.42, shape: 'column2', desc: '按住每 0.42 秒挖目标格与下方一格' },
      diamond: { id: 'diamond', name: '钻石镐', dmg: 10, mode: 'tap', interval: 0.55, shape: 'square3', desc: '一镐 3×3，间隔 0.55 秒' },
      laser: { id: 'laser', name: '激光钻', dmg: 8, mode: 'hold', interval: 0.15, shape: 'columnAll', desc: '按住每 0.15 秒对整列每格各结算一次' }
    },

    /* v6 §3 地心宝藏：最终关 objective 达标后棋盘中心生成 1 个宝箱格（单格，radiusCells = 0），
       挖穿 hp 3000 → CORE.markVictory()。不吃 TNT 秒杀，但吃地心共振的剥离。 */
    treasure: {
      hp: 3000,
      radiusCells: 0
    },

    /* §5 TNT：**只保留挖矿掉落的那一种**（v14 删掉「可放置 TNT」整套）。
       3×3 固定范围（tuning.luckyTNTSide）、伤害 = 当前工具伤害 × 4、穿透 2 层（天赋再加 2 环）、
       引线 1.8 秒（tuning.luckyTNTFuseSec；放置引线 tnt.fuseSec 随投放功能一起删除）。
       pierceCap 是 mods.tntLayerPierce 的夹紧上限：tntPierce 2 环 → 2 + 2 = 4，正好吃满。
       perRound / radiusCells / maxCap / radiusCap 也随「每局 N 枚 + 半径 +1 格」一起删除。 */
    /* v9b：TNT 爽感四件套（docs/V9-JUICE.md §4）——
       ① 每格伤害基数 tntDamageMul 3 → 4：满伤害链（mine +1 / atk 满级 +10 → mods.damage = 11）下
          第 7 关 211 × 4 = 844 点/格（再叠 tntDmg 满级 ×3.06 ≈ 2582），一颗 TNT 的 3×3 里
          「上下左右 + 自身」5 格各自都能一次打穿晶石层（第 7 关晶 360），这就是「至少炸 5 格」的底。
       ② 引线只剩一种：幸运掉落读 tuning.luckyTNTFuseSec = 1.8 秒的长引线（给连环炸留出
          「A 炸 → 掉 B → B 炸」的时间）。04-tools 里只剩 T.luckyTNTFuse 这一条。
       ③ v14：每局幸运 TNT 总量给一个很宽的上限（tuning.luckyTNTTotalMax = 400，防浏览器卡死），
          同屏引信仍夹在 60 颗（tuning.tntMaxFuses，防爆栈）。
       ④ v17 掉率 = 基数 0 + 每环 +1pp（10 环满链 10%），见 tntDrop1..10 这条链。 */
    tnt: {
      tntDamageMul: 4,
      layerPierce: 2,
      pierceCap: 4
    },

    /* TREE-V8 的唯一真值：单一节点树（中心 mine + 19 个天赋节点）。
       UI 只读 tree，不要再去拼 talents/upgrades 两个面板。 */
    tree: tree,

    /* v8：五项强化（工具威力/背包磁力/矿石精炼/作业时间/富矿精炼）全部退休 ——
       它们的效果要么并进节点（atk = 工具威力、settle = 矿石精炼），要么这一版不再提供
       （磁力/作业时间/富矿）。空表让 02-core 的旧循环与 09-main 的 describeUnlock 安全退化，
       CORE.upgradeLevel/upgradeCost/buyUpgrade 三个兼容别名对任何 id 都回 false/0/0n。 */
    upgrades: {},
    // talents = 10 个天赋节点的 id 索引（中心 mine 在 tree.center，不在这张表里）
    talents: talents,
    // CORE.nodeCost 的唯一来源：深度倍率 + 1.9 等级幂（§5）
    talentCostTable: NODE_PRICE,

    // 爽感相关常量集中放这里，其它模块只读
    tuning: {
      layerMin: 8,            // 每格基础层数下限（zone 未声明 layerMin 时的回落值）
      layerMax: 10,           // 每格基础层数上限（zone 未声明 layerMax 时的回落值）
      // v15：矿层加深 999 级 × 每级 +1 层 → 第 4 关 20–22 + 999 = 1021，cap 取 1020
      // （03-grid 的 MAX_LAYERS 硬上限同步 24 → 1024）。22 层那种格子到 999 级会被 1020 削掉 1 层，
      // 这是用户钉死的上限值；zones 1–3 的 8–18 层完全吃得满。
      layerCap: 1020,         // 每格总层数硬上限（v15：矿层加深 999 级）
      extraLayersCap: 999,    // mods.extraLayers 上限（= 矿层加深 maxLevel）
      frenzyMax: 3,           // 每局狂热次数上限
      chainMax: 5,            // 单次攻击连锁破坏格数上限
      dropCap: 240,           // 场上掉落上限
      comboFrenzyAt: 24,      // 连击数达到该值触发狂热（宽形武器连击太快，抬高门槛压经济）
      comboDecaySec: 1.2,     // 连击归零时间
      chainIntervalMs: 60,    // 连锁间隔
      chainChanceBase: 0.05,  // 连锁率基础值（mods.chainChance 额外叠加）
      multiStrikeMul: 0.5,    // 双刃镐邻格伤害系数
      frenzyDropMul: 1.10,    // 狂热掉落倍率
      frenzySeconds: 4,       // 狂热基础时长
      richCellMul: 3,         // 富矿格基础 3 倍
      hitStop: 0.06,          // 命中停顿 timeScale
      timeCapSec: 45,         // 单局时间硬上限
      settleMul: 1,           // 结算期总倍率（掉落倍率已在掉落时进入数量，这里默认 1）

      /* v3：激光 / 震荡器 / 连锁雷管 */
      laserTickSec: 0.15,     // 激光每 tick 的结算间隔（tool.interval 之外的表现层节拍）
      laserDamageStep: 2,     // 预留：激光每 tick 附加伤害。真值走 mods.laserDamage（laserCol 每级 +4）。
      // 幸运雷管每环的幅度写在节点天赋 tntDrop1..10 的 effect（+1pp/环，满链 10%），不用固定 step
      luckyTNTTotalMax: 400,  // v14：每局幸运 TNT 总量上限（很宽，只为防连环炸把浏览器拖死）
      tntMaxFuses: 60,        // 同屏引信物理上限（防爆栈）：满了之后幸运 TNT 不再生成
      luckyTNTFuseSec: 1.8,   // 掉落长引线（v14 起唯一的引线）
      luckyTNTSide: 3,        // 幸运 TNT 的爆炸边长（3 = 3×3；固定，不吃任何天赋）
      luckyTNTSpreadCells: 1  // 落在刚挖格 ±1 格内的随机存活格
    }
  };
})();