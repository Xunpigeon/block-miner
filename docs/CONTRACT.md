
# 《方块矿工：深层开采》阶段 A — 接口契约 v1

> 这是并行开发的唯一协调产物。**每个模块只依赖本文件描述的形状，不要读其它模块实现去猜。**
> 策划案原文：`C:\Users\Administrator\AppData\Roaming\dsh-launcher\dsh-packs\pack-test\attachments\v1\files\2d\2d42c98021749425a1c84d5c8180ebf8b05b45767effbf2121cd24e4c4cda052\方块矿工-游戏策划案.md`

## 0. 运行形态

- 最终产物：**单个自包含 index.html**（零依赖、无构建依赖、双击可玩、可上传 B 站 Toy）。
- 开发形态：src/NN-*.js 按文件名数字顺序拼接进模板的同一个 script 里；src/style.css 注入 style。
- 拼接由 build.mjs 完成（**不要手改 index.html，不要自己写构建**）。
- 所有模块挂在全局 **window.BM** 下，**不要用 ESM import/export**。
- 每个文件以 (function(){ 'use strict'; ... })(); 包裹。
- 目标：移动 Chrome/Safari + 桌面 Chrome/Edge。不用需要 polyfill 的新 API，不用顶层 await。

## 1. 事件总线（唯一模块间通信通道）

01-config.js 提供 BM.bus：

~~~
BM.bus.on(type, fn)      // 订阅；返回取消函数
BM.bus.off(type, fn)
BM.bus.emit(type, data)  // 同步派发；单个订阅者抛错必须捕获并 console.warn，不能中断其它订阅者
~~~

### 事件清单（payload 固定）

- **block:hit** `{ block, dmg, dir }` — 每次造成伤害后派发（dir 为弧度）
- **block:break** `{ block, ore, rich, chain }` — chain=本次连锁第几格，0=首发
- **drop:spawn** `{ ore, amount, x, y, rich }` — 设计空间像素坐标
- **drop:absorb** `{ ore, amount, x, y }`
- **tool:swing** `{ tool, cells:[{ox,oy}], x, y, dir }`
- **explosion** `{ x, y, radiusPx, power }`
- **chain:tick** `{ count }` — 一次攻击累计破坏格数
- **combo:update** `{ combo, mult }`
- **frenzy:start** `{ seconds, mult }` / **frenzy:end** `{}`
- **magnet:burst** `{ x, y }`
- **round:start** `{ zoneId, seconds, tool }`
- **round:tick** `{ timeLeft, counts, coins, combo, frenzy, explosiveLeft }` — 由 main 每帧最多派发一次
- **round:end** `{ result }`
- **ui:toast** `{ text }`

**派发者**：GRID 只有 block:hit / block:break；TOOLS 有 tool:swing / explosion / chain:tick / combo:update / frenzy:*；DROPS 有 drop:spawn / drop:absorb / magnet:burst；main 有 round:*。
**订阅者**：FX 与 AUDIO 订阅全部表现类事件；UI 订阅 round:tick / drop:absorb / combo:update / frenzy:* / ui:toast；TOOLS 订阅 block:break 做连锁。

## 2. 设计空间与绘制分层

~~~
BM.DESIGN = { w: 390, h: 844 };
BM.BOARD  = { x: 10, y: 96, w: 370, h: 636 };
~~~

- main 建立唯一 canvas（#stage），按 min(vw/390, vh/844) 等比 contain 缩放居中，setTransform 到设计空间后交给各模块绘制。
- **绘制顺序**：GRID.draw(ctx) → DROPS.draw(ctx) → FX.draw(ctx)。
- **HUD 与界面全是 DOM**（UI 负责）；canvas 只画棋盘/掉落/粒子。
- 粒子与掉落的速度单位统一为 **设计空间像素/秒**。

## 3. 矿块对象（Block）

~~~
{
  ox, oy,            // 格坐标 0-based
  x, y, s,           // 屏幕矩形：左上角、边长（设计空间像素）
  ore: 'coal'|'copper',
  maxHp, hp,
  rich: boolean,
  broken: boolean,
  crack: 0|1|2|3,
  seed: number,
  hitT: number,      // 命中反应 0..1（1=刚命中），GRID 自己衰减
  hitDir: number,
  appearT: number    // 入场动画 0..1，GRID 衰减
}
~~~

## 4. 模块 API

### 4.1 BM.CONFIG（01-config.js）

~~~
BM.CONFIG = {
  version: 3,
  saveKey: 'blockminer.save.v3',
  ores: {
    coal:  { id:'coal',  name:'煤晶', price:1,  hp:1, drop:[1,2], richDrop:[3,6], color:'#3a424c', vein:'#ff8a3d', glow:'#ffb066' },
    copper:{ id:'copper',name:'赤铜', price:10, hp:2, drop:[1,3], richDrop:[3,9], color:'#4a332b', vein:'#d3683c', glow:'#ffa06a' }
  },
  zones: [
    { id:'surface', name:'地表矿脉', coinBase:1, timeSec:15, cols:6, rows:8,
      ores:[{ore:'coal', weight:100, richRate:0.10}],
      objective:{ ore:'coal', need:100 }, nextZone:'trench', reward:'tool:powerPick' },
    { id:'trench', name:'铜脉坑道', coinBase:10, timeSec:15, cols:6, rows:8,
      ores:[{ore:'coal', weight:40, richRate:0.10},{ore:'copper', weight:60, richRate:0.12}],
      objective:{ ore:'copper', need:60 }, nextZone:null, reward:'tool:drill' }
  ],
  tools: {
    pickaxe:  { id:'pickaxe',  name:'矿工镐', dmg:1, mode:'tap',  interval:0,    shape:'single', desc:'单格点按' },
    powerPick:{ id:'powerPick',name:'动力镐', dmg:2, mode:'hold', interval:0.45, shape:'single', desc:'按住每 0.45 秒攻击' },
    drill:    { id:'drill',    name:'钻头',   dmg:2, mode:'hold', interval:0.7,  shape:'column', desc:'穿透纵向 3 格' }
  },
  upgrades: { /* 见 §6 */ },
  talents:  { /* 见 §6 */ }
};
~~~

数值以策划案 §4.4 / §4.3 为准：镐子伤害 1、动力镐 2/0.45s、钻头 2/0.7s 纵向 3 格；煤晶耐久 1、掉落 1–2、售价 1；赤铜耐久 2、掉落 1–3、售价 10；富矿格掉落 3 倍。

### 4.2 BM.CORE（02-core.js，纯逻辑，禁止碰 DOM/canvas）

`"`BM.CORE.state` · `load()` · `save() -> boolean` · `resetSave()` · `fmt(bigint) -> "1,250"` · `abbr(bigint) -> "1.25K"/"2.4M"` · `canAfford(bigint)` · `addCoins(bigint)` · `spendCoins(bigint) -> boolean` · `upgradeLevel(id)` · `upgradeCost(id) -> bigint` · `buyUpgrade(id) -> boolean` · `talentState(id) -> 'owned'|'available'|'locked'` · `talentCost(id) -> bigint` · `buyTalent(id) -> boolean` · `resetTalents()` · `mods()` · `settleRound(stats) -> result` · `checkUnlocks() -> string[]` · `unlockTool(id)` · `hasTool(id)` · `nextObjective() -> {zoneId, ore, need, have, done}`"`

- load() 读 localStorage，失败或旧版则安全初始化，**绝不抛异常**；save() 失败返回 false 并 emit `ui:toast`。
- 金币内部 bigint，十进制字符串落盘，**禁止浮点累加**；upgradeCost = ceil(baseCost * 1.65^level)。
- mods() 每次现算，返回：
  ~~~
  { damage, roundSeconds, holdIntervalMul, drillPierce, magnetSpeedMul, magnetRadiusMul,
    dropFlat, dropMul, richMul, chainChance, frenzyDropMul, frenzySeconds }
  ~~~
- settleRound(stats) 入参 `{ zoneId, counts:{ore:number}, brokenBlocks, maxCombo, explosions, maxChain, timeLeft }`，返回：
  ~~~
  { zoneId, counts, lines:[{ore,name,count,price,subtotal:string}],
    coinsEarned:string, coinsTotal:string, coinsTotalAbbr:string,
    stats:{ brokenBlocks, maxCombo, explosions, maxChain },
    unlocked:[string], objective:{ ore, need, have, done },
    recommendUpgrade:{ id, name, cost:string } | null, nextZoneId:string|null }
  ~~~

### 4.3 BM.GRID（03-grid.js）

`"`init(ctx, rect?)` · `build(zoneCfg)` · `blocks (Block[][])` · `flat (Block[])` · `at(px,py) -> Block|null` · `damage(block,dmg,dir) -> {broke, overkill}` · `neighbors(block, pattern, n)` · `richCells(n)` · `update(dt)` · `draw(ctx)` · `clear()`"`

- 纹理必须**代码程序化生成**：16×16 逻辑像素噪声 + 斜切矿脉 + 边缘高光；每个 ore 预渲染 3–4 个 seed 变体到离屏 canvas，绘制时按 block.seed 取用；**不允许任何外部图片**。pattern 支持 'cross'|'square'|'column'|'row'。
- damage() 只算数值并派发 block:hit / block:break；掉落由 DROPS 订阅事件自行生成。
- 禁止在 draw 里 getImageData/createImageData（纹理只在 init 生成一次）。

### 4.4 BM.TOOLS（04-tools.js）

`"`init(ctx)` · `ready() -> boolean` · `attack(tool, px, py, opts) -> boolean` · `update(dt, now)` · `draw(ctx)` · `setZone(zoneCfg)` · `explosiveLeft` · `stats`

opts = `{ hold?:boolean, now:number }`

- attack() 自算命中格：single=1 格；column=目标格+下方 2 格（穿透 mods.drillPierce）；派发 tool:swing。
- 每命中格调用 BM.GRID.damage；本击破坏总数累积后派发一次 chain:tick。
- 订阅 block:break：按 mods.chainChance（赤铜 +0.05）掷骰，触发则递归伤害相邻格（最多 5 格、60ms 间隔）并派发 explosion（小半径）复用表现。
- 连续攻击维护 combo（每破坏 +1，1.2 秒无操作清零）并派发 combo:update；combo>=8 且本局狂人次 < frenzyMax 时派发 frenzy:start。
- stats 需含 `{ broken, maxCombo, maxChain, explosions }` 供结算用。

### 4.5 BM.DROPS（05-drops.js）

`"`init()` · `spawnForBlock(block)` · `update(dt)` · `draw(ctx)` · `counts` · `absorbAll()` · `reset()`"`

- 磁吸目标点 = `{ x: 195, y: 70 }`（HUD 资源栏）。
- 生命周期：出生抛物散开 0.35–0.6 秒 → 吸附（基速 900 × mods.magnetSpeedMul）→ 到达后 counts[ore] += amount 并派发 drop:absorb。
- 全场上限 240，超限合并同矿种到最近掉落，**绝不能丢数量**。absorbAll() 后所有在途掉落立刻入包。

### 4.6 BM.FX（06-fx.js）

`"`init()` · `update(dt)` · `draw(ctx)` · `timeScale` · `shake(ampPx,dur)` · `flash(alpha,dur)` · `setQuality('high'|'mid'|'low')` · `quality`"`

必须实现（全部由事件驱动）：命中压缩火花、破碎碎屑（多边形、旋转、重力）、冲击波双环、白闪、屏幕震动（衰减有上限）、**命中停顿**（timeScale 降到 ~0.06 再回 1）、`+N` 跳字（缩放弹出+上浮+淡出，同矿合并）、吸入拖尾、连击亮度上升、狂热金潮粒子、爆破多层碎片。
性能硬约束：对象池；draw 不分配新数组；超限丢最老的；低质量模式碎屑 ×0.35。粒子上限 high 900 / mid 400 / low 180。

### 4.7 BM.AUDIO（07-audio.js）

`"`init()` · `play(name, opts)` · `setMuted(bool)` · `muted`; opts={pitch,gain,pan}`"`

名字：hit / break / drill / explode / absorb / coin / buy / unlock / frenzy / ui / roundStart / roundEnd。
全部用 WebAudio 振荡器+噪声+滤波实时合成（**零音频文件**），带 compressor 与总音量；hit 音高随 combo 递进（上限 +7 半音）。

### 4.8 BM.UI（08-ui.js）

`"`init(root, handlers)` · `showScreen('camp'|'mine'|'result')` · `renderCamp()` · `renderResult(result)` · `updateHUD(tick)` · `toast(text)` · `setMuted(bool)`"`

handlers = `{ onStartRound(zoneId), onNextRound(), onBackToCamp(), onBuyUpgrade(id), onBuyTalent(id), onSelectTool(id), onResetTalents(), onResetSave(), onToggleMute() }`
UI 只做 DOM/CSS 与绑定，**不写游戏规则**；数值一律从 BM.CORE 与 CONFIG 读。

## 5. 主循环与回合（09-main.js，集成层，Dispatcher 编写）

状态机 `idle | running | settling | result`。
- 倒计时结束 → DROPS.absorbAll() → 等 ≤1 秒 → CORE.settleRound(stats) → 派发 round:end → UI.renderResult。
- 计时结束后的攻击输入丢弃；不重复发奖、不吞收益。
- 单 rAF 循环；dt 上限 50ms；棋盘/掉落/工具用 dt*FX.timeScale，HUD 计时用真实 dt。

## 6. 升级与天赋数据

普通升级（5 项，≤5 级，价格 ceil(base*1.65^level)）：
pickDamage 6 金币 +1 伤害；magnet 10 吸入速度 +20%；bag 12 普通格掉落 +1；workTime 20 每局 +1 秒；richBonus 15 富矿格额外 +20%。

天赋（约 20 节点，tier * zone.coinBase 金币，可全额重置）三条线：
- line:'time'：轻装出发 I/II/III（各 +2 秒）、勘探直觉（富矿率 +5pp）、地层扫描（开场高亮 2 富矿格）、备用氧罐（首次归零 +5 秒）
- line:'pick'：硬木柄（伤害 +1）、钨钢尖（伤害 +2）、连打训练（连击攻速 -15%，3 层）、余力回收（溢出伤害 50% 传邻格）、合金钻头（穿透 +1）、双刃镐（每第 4 击打左右邻格）
- line:'loot'：磁石手套（吸入 +25%）、强磁线圈（半径 ×1.5）、额外矿袋（掉落 +1）、富矿手感（富矿 +25%）、高纯采集（赤铜掉落 +1）、连锁拾荒（5 格以上连锁额外 +1 主矿）

## 7. 存档（localStorage，版本化）

~~~
{ "version":3, "coins":"0", "lifetimeCoins":"0",
  "upgrades":{"pickDamage":0,"magnet":0,"bag":0,"workTime":0,"richBonus":0},
  "talents":[], "unlockedTools":["pickaxe"], "selectedTool":"pickaxe",
  "currentZone":"surface", "lifetimeMined":{"coal":0,"copper":0},
  "roundsPlayed":0, "bestRound":{"zoneId":"surface","coins":"0"},
  "muted":false, "lastSavedAt":0 }
~~~

金币一律 bigint 内部、十进制字符串落盘；读档逐字段校验，非法则安全初始化（不白屏）。

## 8. 验收（集成时逐条检查）

1. 首屏到开始挖矿 ≤1 次点击；首局结束能买到 6 金币的镐子伤害。
2. 命中/破碎/吸入/跳字/连击/狂热/爆破都有可见可听反馈，没有"只有数字变大"的升级。
3. 中端手机设定下 60fps；粒子有上限；有低特效开关。
4. 时间结束不丢收益、不重复结算；刷新后回营地且金币正确。
5. 零外部请求：index.html 单独打开可玩。
6. 无任何 Minecraft 素材、名称、字体引用。

## 9. 濂戠害澧炶ˉ v1.1锛?2-core 钀藉湴鍚庣殑瀹為檯绛惧悕涓庤涔夛級

### 9.1 鏂板 API锛堥泦鎴愬眰鍙敤锛?- `BM.CORE.setTool(id) -> boolean`銆乣BM.CORE.zoneById(id|zoneCfg) -> zoneCfg`锛堟案涓嶈繑鍥?null锛夈€乣BM.CORE.currentZone() -> zoneCfg`
- `BM.CORE.setMuted(bool) -> bool`銆乣BM.CORE.getMuted() -> bool`銆乣BM.CORE.resolveRoundSeconds(zoneCfg?) -> number`锛?5 + workTime + 鏃堕棿澶╄祴锛屽す鍦?[5,45]锛?
### 9.2 mods() 鐨勫畬鏁村瓧娈典笌璇箟锛堥噸瑕侊級
- 浼ゅ锛氬疄闄呬激瀹?= `BM.CONFIG.tools[id].dmg + mods().damage`锛坉amage 鏄?*闄勫姞**鍊硷紝鍒濆 0锛?- 鍔犳硶閿紙鍩烘暟 1锛屽閲忕浉鍔狅級锛歚magnetSpeedMul`銆乣richMul`锛涗箻娉曢敭锛歚magnetRadiusMul`銆乣holdIntervalMul`
- 鏀诲嚮闂撮殧涓や釜涔樺尯涓嶅彲鍚堝苟锛歚tool.interval 脳 mods.holdIntervalMul`锛屽啀鍙犺繛鎵撳眰鏁?`脳(1 - comboHasteStep 脳 layers)`锛宭ayers 鈮?`comboHasteMax`
- 鏂板瀛楁锛歚comboHasteStep(0.15)/comboHasteMax(3)`銆乣overkillTransfer(0.5)`銆乣multiStrikeEvery(4)/multiStrikeMul(0.5)`銆乣copperDropPlus(1)`銆乣chainScavengeBonus(1)/chainScavengeMin(5)`銆乣richRateBonus(0.05)`銆乣richHighlight(2)`銆乣oxygenBonus(5)`銆乣echoEvery(10)/echoMul(0.5)`
- **鎺ョ嚎璐ｄ换**锛歚richRateBonus` 鐢?GRID 鐢熸垚瀵岀熆鏃跺彔鍔狅紱`richHighlight` 鐢?GRID/TOOLS 鍦ㄥ紑灞€楂樹寒锛沗oxygenBonus` 鐢?main 鍦ㄩ娆″綊闆舵椂 +N 绉掞紙姣忓眬涓€娆★級锛沗echoEvery/echoMul`銆乣overkillTransfer`銆乣multiStrikeEvery` 鐢?TOOLS 瀹炵幇
- mods() **澶嶇敤鍚屼竴瀵硅薄鍘熷湴鍒锋柊**锛氳皟鐢ㄦ柟鐢ㄥ畬鍗宠锛屼笉鑳介暱鏈熸寔鏈夊紩鐢ㄥ仛鍓嶅悗姣旇緝

### 9.3 缁撶畻璇箟
- 鎺夎惤绫诲姞鎴愬湪 DROPS/GRID 鐢熸垚鏁伴噺鏃跺凡璁″叆 counts锛岀粨绠?*涓嶅啀閲嶅涔?*锛氶粯璁?`tuning.settleMul = 1`锛宍危lines灏忚 == coinsEarned`
- 鏈€浣?1 閲戝竵 = 鏈夋敹鐩婃椂 `max(1, round(危))`锛?*绌哄眬 0 閲戝竵**锛屼笉鍙戠櫧閽?- `objective` 鏄垰鎵撻偅寮犲浘鐨勫畬鎴愬害锛涘湴鍥惧畬鎴愬悗 `state.currentZone` 浼氭帹杩涘埌 `nextZone`
- `resetTalents()` 杩斿洖杩旇繕鐨?bigint锛堜笉鍔?lifetimeCoins锛?- 鎵€鏈夐噾棰濇槸 bigint锛歎I 蹇呴』鍏?`CORE.fmt()/abbr()`锛沗lines[].price/count` 鏄?number

### 9.4 瀛樻。涓庡姞杞?- `load()` 鍦?02-core 鏈熬宸茶嚜鍔ㄦ墽琛屼竴娆★紱main 鍚姩鏃惰皟鐢ㄦ槸骞傜瓑鐨勶紝浣?*鍥炲悎杩涜涓笉瑕佽皟**锛堜細閲嶈鐩樿鐩栧唴瀛樻€侊級
- 瀛樻。 key 鍥哄畾 `blockminer.save.v3`锛沗version != 3` 涓€寰嬪畨鍏ㄥ垵濮嬪寲锛堜笉鍋氳縼绉伙級锛屾敼鐗堟湰鍙风瓑浜庢竻妗?
### 9.5 璧ら摐杩為攣
- `chainChance` 鍩虹鍊间笉鍦?mods 閲岋細TOOLS 鑷缁欒丹閾?+`tuning.chainCopperChance`(0.05)

## 10. 契约增补 v1.2（集成期确认的最终语义）

### 10.1 时间与停顿
- `BM.FX.update(dt)` / `BM.GRID.update(dt)` / `BM.DROPS.update(dt)` / `BM.TOOLS.update(dt, now)` 在 main 里统一收 **已乘 timeScale 的世界 dt**；`BM.FX.update` 收真实 dt。
- HUD 倒计时与回合状态机只用**真实 dt 累减**，绝不用 `performance.now()` 比较（切后台/掉帧会卡死不结算）。
- 命中停顿：FX 内部把 `timeScale` 压到 0.06，按 dt*12/帧 指数回 1；事件取 max 不累加。

### 10.2 震屏
- 震动只由 `BM.FX.offset() -> {x,y}` 输出，main 在绘制棋盘前 `ctx.translate` 施加；`FX.draw` 内部绝不再平移。

### 10.3 输入与工具
- 松手必须调 `BM.TOOLS.release()`（pointerup / pointercancel），否则按住连发停不下来。
- `attack()` 的 `hold` 标记会自行结束上一次按住；tap 工具一次点击只出一发。
- 命中测试统一用 `BM.GRID.at(px,py)`，不要用 block 矩形自行判断（缝隙会打空）。

### 10.4 掉落与结算
- 掉落由 `BM.DROPS.init()` 订阅 `block:break` 自动生成；main **不得**再调 `spawnForBlock`（会双倍）。
- 金币只以 `counts` 为准结算；`drop:absorb` 是表现事件，不可当加币信号。
- `CORE.settleRound` 不自带幂等保护：main 用回合状态机（running → settling → result）保证只结算一次。

### 10.5 画质与性能
- `BM.FX.setQuality('high'|'mid'|'low')` 由 main 调用：启动读 `CORE.state.quality`，运行中按帧率自适应降档（<46fps → mid，<32fps → low，每局最多降两档），并支持设置页手动循环。
- 实测：headless Chrome 软件光栅化 500×1000 下 **0.33 ms/帧**（含粒子与 48 格绘制）。

### 10.6 解锁文案
- `settleRound().unlocked` 返回的是 **id 数组**（如 `['powerPick']`）；展示文案由集成层 `formatUnlock()` 映射为「新工具：动力镐」这类中文。

### 10.7 调试入口（仅 hash 命中时生效）
- `#demo` 自动采矿、`#frames=N` 确定性快进、`#diag` 画布诊断层、`#zone=trench`、`#tocamp`。
