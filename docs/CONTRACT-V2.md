# 《方块矿工》v2 改造契约（MVP 重做版）

> 唯一协调文件。每个模块只依赖本文形状，不要读别的模块实现去猜。
> v1 契约（docs/CONTRACT.md）的模块边界与事件总线机制继续有效；本文覆盖数据与机制，冲突以本文为准。

## 0. 本轮目标

1. 矿格改成纵向堆叠 6–8 层（像一摞麻将牌）：挖掉顶层，下一层立刻可挖（无锁定期、无浮现动画），但视觉上要能看出它不是第一层（深度阴影 + 底部露出的下层边缘）。
2. 每格可以被挖空；整盘挖空 → 本局提前结束并正常结算。
3. 新增多 AOE 道具 TNT 炸药：一次对 3×3 区域造成伤害并穿透 3 层。
4. 矿物换成 MC 向三件套：石头 / 煤矿 / 铁矿；美术向 MC 靠拢（方块 + 环境），UI 保持现有深色现代风。
5. 天赋改成树枝状（前置连线），金币购买，是主要驱动力。
6. 修两个 BUG：(a) 连击放射粒子固定从屏幕中心发出（src/06-fx.js 第 16-17 行 HUD_X/HUD_Y 与 CX=195,CY=422），改成跟随最近命中点；(b) 指针坐标映射用了缓存的 view，窗口尺寸变化后错位，main 改为按画布 rect 现算（main 自己负责）。

## 1. 矿格数据模型（Block）

```js
{
  ox, oy, x, y, s,          // 格坐标与设计空间矩形
  ore: 'stone'|'coal'|'iron',
  hp, maxHp, rich,          // rich = 富矿格
  depth: 0,                 // 当前顶层是本格第几层（0 = 第一层）
  layers: 7,                // 本格剩余层数（含当前层）
  totalLayers: 7,           // 本局该格总层数（6..8 + 天赋），画堆叠边缘用
  broken: false,            // 仅当 layers === 0 时为 true（坑洞）
  crack: 0, hitT: 0, hitDir: 0, seed: 0, appearT: 1
}
```

- 打碎顶层：layers -= 1; depth += 1。
  - 若 layers > 0：立即用下一层数据刷新本格（ore/rich/maxHp/hp 全部换新），派发 block:layer {block, depth}。
  - 若 layers === 0：broken = true，派发 block:empty {block}。
- 没有锁定期，新露出的层立刻可挖。
- totalLayers = 6 + randInt(0..2) + mods.extraLayers，上限 11。
- 视觉要求：depth > 0 时叠加深度阴影（越深越暗、内阴影越重），并在方块底部露出 1–2px 下层边缘；层数越多边缘越明显。挖空的格子要有凹坑与碎石，不能是纯黑洞。

## 2. 矿物（MC 向）

| id | 名称 | 血 | 售价 | 掉落 | 富矿掉落 | 配色方向 |
|---|---|---:|---:|---|---|---|
| stone | 石头 | 3 | 1 | 1-2 | 3-6 | 石底 #7d7d7d，深灰斑点 #5a5a5a |
| coal | 煤矿 | 1 | 6 | 1-2 | 3-6 | 石底 + 纯黑矿斑 #171717，高光 #3a3a3a |
| iron | 铁矿 | 4 | 40 | 1-3 | 3-9 | 石底 + 米褐矿斑 #d8b98a，暗边 #a9855c |

贴图规矩：16×16 逻辑像素、无渐变、块边深色描边 #2a2a2a、矿物用不规则斑块（不要斜切长脉）。不得复刻原版点阵或配色组合。

## 3. 关卡

| id | 名称 | 组成 | 目标（累计采集） | 解锁 |
|---|---|---|---|---|
| quarry | 采石场 | 石头 80% / 煤 20% | 煤 50 个 | 解锁 ironmine 与石镐 |
| ironmine | 铁矿层 | 煤 65% / 铁 35% | 铁 30 个 | 解锁 crystal（占位不开放）|

每关矿物构成固定；天赋只把石头权重压低（矿石占比提升），不引入新矿种。

## 4. 工具（MVP 三种）

| id | 名称 | 伤害 | 模式 | 间隔 | 形状 | 解锁 |
|---|---|---:|---|---:|---|---|
| wood | 木镐 | 1 | tap | — | 单格 | 开局 |
| stone | 石镐 | 2 | hold | 0.34s | 单格 | 采石场累计 25 煤 |
| iron | 铁镐 | 3 | hold | 0.42s | 纵向 2 格（目标 + 下方 1 格）| 进入铁矿层 |

实际攻击力 = CONFIG.tools[id].dmg + mods.damage。石头 3 血：木镐 3 下、石镐 2 下、铁镐 1 下 —— 这是「中期变爽」的来源。

## 5. TNT 炸药（新增，AOE + 多层）

- 投放：点 HUD 的 TNT 按钮进入投掷模式 → 点棋盘某格 → 0.8 秒引信 → 爆炸。
- 爆炸：以该格为中心的 3×3，每格造成 6 点伤害，并且连续打穿最多 3 层（每层血量独立结算）。
- 每局 1 枚；天赋 spareTNT 每级 +1（上限 3 枚）；blastExpert 每级穿透 +1 层（上限 5 层）；wideBlast 半径 3×3 → 5×5。
- 视觉：引信闪烁 + 倒计时环 → 白闪 + 双层冲击波 + 逐格碎裂 + 强烈震屏。

## 6. 天赋树（树枝状，金币）

节点形状：{ id, name, branch:'dig'|'vein'|'loot', tier, cost, desc, requires:[id...], effect:{...} }
价格按 tier：t1 8、t2 18、t3 36、t4 70、t5 130 金币。

```text
dig（采掘）  : 木柄强化(伤害+1,t1) → 钨钢尖(伤害+1,t2) → 连环镐(攻击间隔-15%,t2) → 双刃镐(每第4击打左右邻格50%,t3) → 破岩锤(伤害+2,t4)
vein（矿脉） : 矿脉直觉(矿石占比+6pp,t1) → 深层纹理(每格层数+1,t2) → 富矿直觉(富矿率+8pp,t2) → 深挖者(每格层数+1,t3) → 矿脉共振(击碎后3秒内邻格伤害+30%,t4)
loot（采集） : 磁石手套(吸入速度+25%,t1) → 满载矿袋(掉落+1,t2) → 爆破入门(解锁TNT,t2) → 备用炸药(TNT+1枚,t3) → 爆破专家(TNT穿透+1层,t3) → 广域爆破(3×3→5×5,t4)
```

天赋界面必须做成树枝状可视化：节点卡片 + 前置连线（已购=亮色实线，可购=虚线高亮，未解锁=暗色），点击可购节点直接购买。DOM + SVG 连线或绝对定位实现均可。

## 7. mods() v2（02-core 提供，各模块只读）

```js
{
  damage, holdIntervalMul, oreRateBonus, extraLayers,
  dropFlat, dropMul, richMul, richRateBonus,
  magnetSpeedMul, magnetRadiusMul,
  chainChance, multiStrikeEvery, multiStrikeMul, overkillTransfer,
  frenzyDropMul, frenzySeconds, roundSeconds,
  tntMax, tntLayerPierce, tntRadiusCells, hasTNT
}
```

## 8. 事件（v1 基础上新增）

- block:hit {block, dmg, dir} —— 每次造成伤害
- block:layer {block, depth} —— 新增：顶层被打穿，露出下一层（block 已换新层数据）
- block:break {block, ore, rich, chain} —— 语义收窄：整格被彻底挖空时才派发
- block:empty {block} —— 新增：该格变坑洞
- tnt:fuse {x, y, cells, delay} —— 新增：引信开始
- explosion {x, y, radiusPx, power, cells} —— 扩展：带受影响格子数
- drops / combo / frenzy / round:* 沿用 v1

## 9. 平衡目标（数值验收口径）

| 阶段 | 局数 | 单局金币 | 玩家状态 |
|---|---|---|---|
| 采石场前期 | 1-3 | 40-70 | 木镐敲石头 3 下，难受 |
| 采石场中期 | 5-8 | 90-140 | 石镐 + 1-2 天赋，明显变快 |
| 采石场后期 | 10-14 | 150-210 | 铁镐一镐一层 |
| 铁矿层前期 | 1-3 | 220-300 | 铁 4 血，铁镐也要 2 下 |
| 铁矿层中期 | 5-8 | 350-450 | 天赋叠加，TNT 上线 |
| 铁矿层后期 | 10-14 | 500-650 | 一炮清一片 |

硬要求：中期→后期的局数/耗时 ≈ 前期→中期（每段约 5 局），不能后期一局顶前期十局。

## 10. 边界

- 只改自己负责的文件；不要动 src/09-main.js；不要动别人模块。
- 零外部资源、无 ESM、IIFE 包裹、'use strict'、node --check 通过。
- 不得出现 Minecraft / 我的世界 / MC 字样与原版素材。
- 中文文本；注释只在非显然处写。