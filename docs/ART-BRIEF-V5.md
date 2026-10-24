# 《方块矿工》美术扩充任务书 v5 · 七关 / 七工具 / 岩层分级

> 这份文档写给「绘画 / 像素美术 Agent」，也是主控与美术之间的对齐清单。
> 项目链接（本机路径，直接打开即可看游戏）：
>  - 游戏单文件：`C:\Users\Administrator\Documents\deepseek-harness\default-workspace\blockminer\index.html⟧
>  - 项目根目录：`C:\Users\Administrator\Documents\deepseek-harness\default-workspace\blockminer⟧
>  - 美术管线：`art/⟧（生成器在 `art/_src/⟧，清单在 `art/manifest.json⟧）
>  - 现有风格圣经：`docs/ART-SPEC.md⟧（色板、像素规范、命名纪律，v5 继续沿用）
>  - 本轮玩法设计：`docs/ZONES-V5.md⟧（7 关 / 7 工具 / 岩层带 / 42 天赋）

---

## 0. 一句话交接

游戏现在是 **7 关、7 把工具、42 个天赋**，美术资源还是 **3 关时代的 69 个 key**（一套矿洞背景 7 关共用、6 把工具图标、4 个岩层带）。
请按 §3 补齐**增量素材**，并同步更新 `art/manifest.json⟧ 与 `art/_src/verify.mjs⟧；做完后 `node art/_src/verify.mjs⟧ 与 `node build.mjs⟧ 必须都是绿的。
**没有素材游戏也能玩**（缺 key 自动回落到程序化绘制），所以可以分批交付，但每批都要过校验。

---

## 1. 现状：美术是怎么进游戏的（先读这段，省你半天）

| 事实 | 说明 |
|---|---|
| 没有一张「手放进去」的图 | 全部由 `art/_src/*.mjs⟧ 用自带的 `Canvas⟧ 像素类**代码生成** PNG；`node art/_src/gen.mjs⟧ 重生成全部 + 重写 `manifest.json⟧ + 拼 `contact-sheet.png⟧ |
| 只有 manifest 里登记过的图才会被内联 | `build.mjs⟧ 把 `manifest.json⟧ 里每个 key 转 base64 塞进 `index.html⟧；**零外链**，一旦出现 http 引用构建直接报错退出 |
| 当前规模 | 69 个 key / 约 300KB PNG；`index.html⟧ 约 520KB；上限 2.5MB（`verify.mjs⟧ 会拦） |
| 缺图行为 | `BM.ART.one(key)⟧ 解码失败 / 键不存在 → `null⟧ → 调用方回退程序化绘制（`03-grid.js⟧ 的 `paintTexture⟧、`06-fx.js⟧ 的几何粒子、`08-ui.js⟧ 的纯色块） |
| 自动接入的键 | 工具图标 = `'icons.tool_' + tool.id⟧；矿石图标 = `'icons.ore_' + ore⟧；掉落 = `drops.<ore>⟧；方块 = `tiles.ore.<ore>.<normal|rich>⟧（4 变体数组） |
| 校验器硬规则 | 文件名必须匹配 `^art/[a-z]+/[a-z0-9_]+\.png$⟧（**全小写**）；每图 ≤32 色；尺寸必须在 `verify.mjs⟧ 的 `SIZE⟧ 表里查得到；方块图四边必须 `#2a2a2a⟧、左上 `#a0a0a0⟧、右下 `#4a4a4a⟧；背景必须无缝（首尾行列差不大于图内最大相邻差）；24×24 的 `ui/*⟧ 必须有可重复的中间 8px 带 |

> ⚠️ 两个「改素材必须一起改」的点：
> 1. `verify.mjs⟧ 的 `SIZE⟧ 表只认 `bg/(cave_|dust_)⟧ 这类固定前缀；新增 `bg/zone_*⟧、`bg/cover_*⟧ 时**必须同时在 SIZE 表里加一条**，否则校验器会 TypeError。
> 2. 文件名全小写 → 关 id 的驼峰要压平：`copperRidge → copperridge⟧、`coreHeart → coreheart⟧（见 §3 对照表）。

---

## 2. v5 带来的视觉缺口（为什么现在画面「不够丰富」）

| v5 变化 | 现在画面上的问题 |
|---|---|
| 3 关 → **7 关** | 7 关共用同一套 `bg/cave_*⟧，从采石场打到地心核心**四周环境一模一样**；营地 / 结算也没有关卡封面，只有文字 |
| 6 工具 → **7 把** | 新工具「深核钻机 coreDrill」没有图标（`icons.tool_coreDrill⟧ 缺失 → 卡片只剩文字）；它的 9×9 冲击波也只有几何圆环 |
| 4 岩层带被 14 层打穿 | ZONES-V5 §1 只定义了 4 带（0–2 / 3–5 / 6–8 / 9–11），但第 5–7 关层数是 10–14；当前 `03-grid.js⟧ 把 `depth ≥ 9⟧ 一律归赤层 → **最深 5 层没有任何视觉区分** |
| 天赋 36 → **42 节点（7 关 × 6）** | 天赋抽屉是 7 个关卡分区，但分区标题只有文字；末端节点与普通节点同款 |
| 强化价目表按关缩放 | 5 条强化线仍然只有文字 + 一个通用图标 |

---

## 3. 增量素材清单（按优先级，照抄即可）

关 id → 文件名用的扁平写法：
`quarry⟧ 采石场 · `copperridge⟧ 铜谷坑道 · `blueiron⟧ 蓝铁矿层 · `lavaedge⟧ 熔岩边缘 · `starcave⟧ 星辉晶洞 · `moonrift⟧ 月银断层 · `coreheart⟧ 地心核心

### P0 · 让 7 关「一眼是 7 个地方」

| # | 文件 | 尺寸 / 数量 | manifest key | 用途 |
|---|---|---|---|---|
| 1 | `art/bg/zone_<z>_far.png⟧ | 256×256 无缝 ×7 | `bg.zone.<z>.far⟧ | 关卡远景（视差 0.15） |
| 2 | `art/bg/zone_<z>_mid.png⟧ | 256×256 无缝 ×7 | `bg.zone.<z>.mid⟧ | 关卡中景（0.4） |
| 3 | `art/bg/zone_<z>_near.png⟧ | 256×256 无缝 ×7 | `bg.zone.<z>.near⟧ | 关卡近景框景（0.8） |
| 4 | `art/bg/cover_<z>.png⟧ | 512×160 ×7 | `bg.cover.<z>⟧ | 营地关卡卡 / 结算「新矿区」抬头图 |
| 5 | `art/bg/thumb_<z>.png⟧ | 128×128 ×7 | `bg.thumb.<z>⟧ | 7 关选择缩略图 |

**7 关各自的色身份（严格按这条线，别自创）**

| 关 | 主色 | 副色 | 环境要素 |
|---|---|---|---|
| 1 采石场 quarry | 灰石 `#7d7d7d⟧ | 木梁 `#4a3a2c⟧ | 露天浅坑、支架木、微弱天光 |
| 2 铜谷坑道 copperridge | 铜绿 `#3fa08a⟧ | 锈橙 `#b8703a⟧ | 窄坑道、矿车轨、滴水 |
| 3 蓝铁矿层 blueiron | 冷蓝 `#4d7cff⟧ | 铁米褐 `#d8b98a⟧ | 蓝色岩层带、铁脉条纹 |
| 4 熔岩边缘 lavaedge | 熔岩 `#ff5a46⟧ | 暗红 `#3a1418⟧ | 岩缝红光、浮灰、热浪 |
| 5 星辉晶洞 starcave | 紫青 `#6fd8e0⟧ | 星紫 `#a05cff⟧ | 晶簇自发光、悬浮光点 |
| 6 月银断层 moonrift | 月白 `#cfd8e3⟧ | 冷银 `#7f8fa6⟧ | 断层镜面、银灰尘、冷雾 |
| 7 地心核心 coreheart | 核心金 `#ffc857⟧ | 深紫黑 `#1a1024⟧ | 熔核脉动、热流上升、金纹 |

### P0 · 第 7 把工具

| # | 文件 | 尺寸 | manifest key | 说明 |
|---|---|---|---|---|
| 6 | `art/icons/tool_coredrill.png⟧ | 24×24 | `icons.tool_coreDrill⟧ | **UI 自动接入**（key = `'icons.tool_' + tool.id⟧，工具 id 是 `coreDrill⟧；manifest key 保留大写 D，文件名必须全小写） |
| 7 | `art/fx/deep_ring.png⟧ | 128×128 | `fx.deep_ring⟧ | 深核钻机 9×9 冲击波：中心亮 → 第 1 圈 55% → 第 2 圈 30% → 第 3 圈 15%（与 ZONES-V5 §4 的四圈衰减同口径）。**需 fx owner 加一行取图**，未接前继续用几何圆环 |

### P1 · 岩层分级（把 14 层做出「越挖越深」）

| # | 文件 | 尺寸 | manifest key | 说明 |
|---|---|---|---|---|
| 8 | `art/tiles/band_tint_1..4.png⟧ | 32×32 可平铺 | `tiles.band.tint.1..4⟧ | 蓝 / 紫 / 赤罩色纹理：低对比、带细碎晶粒，覆盖在方块贴图之上、裂纹之下。代码现在用纯色 + `globalAlpha⟧ 叠加，接入后换成这张图 → 立刻「有质地」 |
| 9 | `art/tiles/band_edge_1..4.png⟧ | 32×32 | `tiles.band.edge.1..4⟧ | 方块内侧 2px 岩层描边纹理（含断续磨损），替换纯色描边 |
| 10 | （可选）`art/tiles/band_tint_5.png⟧ / `band_edge_5.png⟧ | 32×32 ×2 | `tiles.band.tint.5⟧ / `tiles.band.edge.5⟧ | **第 5 岩层带（12–14 层）**：现在 `03-grid.js⟧ 的 `BAND_MAX=3⟧ 把 depth≥9 全压成赤层。要让最深处有独立视觉，需 grid owner 把 `BAND_MAX⟧ 提到 4 并补一组常量；素材可以**先出图、等代码放开** |

> 第 5 带建议色：`#ffc857⟧ 罩 12% + `#a67c28⟧ 描边（与地心核心金纹呼应）。

### P1 · 7 关的「岩底盘」（填充矿底色）

| # | 文件 | 尺寸 / 数量 | manifest key | 说明 |
|---|---|---|---|---|
| 11 | `art/tiles/rock_<z>_0..3.png⟧ | 32×32 ×4 变体 ×7 = 28 | `tiles.rock.<z>⟧ | 每关的**填充矿 / 岩底**贴图（第 1 关就是石头；第 2 关煤底；3–4 关铁底；5–7 关铁是 12–25% 的填充矿）。现在填充矿共用 4 套矿物贴图，所以「蓝铁矿层」和「月银断层」的岩底长得一样。**需 grid owner 让 `paintTexture⟧ 优先取 `tiles.rock.<zone>⟧**，未接前照旧 |

### P2 · UI 与表现层（画面丰富度加成）

| # | 文件 | 尺寸 | manifest key | 说明 |
|---|---|---|---|---|
| 12 | `art/ui/band_header.png⟧ | 24×24 九宫格 | `ui.band_header⟧ | 天赋抽屉 7 个关卡分区标题条（现在只有文字 + 底线） |
| 13 | `art/ui/node_capstone.png⟧ | 24×24 | `ui.node_capstone⟧ | 每关每枝的第二个节点（14 个尾节点）用金框，和普通节点区分 |
| 14 | `art/icons/upgrade_pickdamage.png⟧ `_magnet.png⟧ `_bag.png⟧ `_worktime.png⟧ `_richbonus.png⟧ | 24×24 ×5 | `icons.upgrade_<id>⟧ | 5 条强化线图标（id 压平全小写） |
| 15 | `art/fx/spark_gold.png⟧ | 8×8 | `fx.spark_gold⟧ | 富矿 / 幸运 TNT 的金色火花（现有 `fx.spark⟧ 是白蓝） |
| 16 | （可选）`art/fx/zone_flash_<z>.png⟧ | 256×256 ×7 | `fx.zone_flash.<z>⟧ | 过关闪屏：中心透明 + 该关主色边缘扩散 |

---

## 4. 风格硬约束（沿用 ART-SPEC.md，只列会被自动校验的）

1. **零外链**：不许 CDN 字体 / http 图片；所有图由 `art/manifest.json⟧ 内联（`build.mjs⟧ 检测到 http 引用直接失败）。
2. **PNG-24 + alpha**，不要 JPG / WebP；每图 **≤32 色**。
3. **像素对齐**：32 网格上作画，禁止抗锯齿、羽化、外发光、渐变条带、3D 高光。
4. **无文字 / 水印 / 签名**（`logo/title.png⟧ 除外）。
5. **光照统一**：单一光源来自屏幕上方偏左；方块左上亮边、右下暗边。
6. **背景必须无缝**：四边首尾接得上，并给 `art/_preview/*_2x2.png⟧ 这类 2×2 预览证明。
7. **不许出现任何 Minecraft 原版贴图 / 图标 / 字体**；整个仓库连 "Minecraft" 这个词都不许出现。
8. 总内联体积 ≤ 2.5MB（当前约 300KB，余量很宽）。

---

## 5. 交付流程（美术 Agent 照这个顺序做）

```bash
cd C:\Users\Administrator\Documents\deepseek-harness\default-workspace\blockminer

# 1. 改生成器（art/_src/tiles.mjs / bg.mjs / ui.mjs / icons.mjs / sprites.mjs）或在 art/ 下直接放 PNG
# 2. 重生成 + 重写 manifest + contact sheet
node art/_src/gen.mjs
# 3. 自检（尺寸 / 命名 / 32 色 / 无缝 / 九宫格 / 变体亮度 / 总体积）
node art/_src/verify.mjs
# 4. 单文件构建（把 manifest 里的图 base64 内联进 index.html）
node build.mjs
```

> 新增了 §3 里没有的目录 / 尺寸，记得同步改 `verify.mjs⟧ 的 `SIZE⟧ 表与 `gen.mjs⟧ 的 SECTIONS。
> **别改 `src/*.js⟧**：那些文件有别的 Agent 在并行改玩法逻辑，美术只碰 `art/⟧ 与本文档。

---

## 6. 验收清单（我拿到图会逐条看）

- [ ] 7 关背景三层齐全（21 张），四边无缝，`art/_preview/zone_<z>_*.png⟧ 2×2 预览在
- [ ] 7 关放在一起能**不看文字**认出是哪一关（主色 + 环境要素对上 §3 的表）
- [ ] `icons.tool_coreDrill⟧ 出现，营地工具卡第 7 张有图（和 `tool_quake⟧ 并排不违和）
- [ ] 岩层带纹理叠上去后，方块**仍能一眼分出 4 种矿**（对比度不能盖过矿斑）
- [ ] 7 关岩底盘（#11）接上后，第 5–7 关不再「同一块灰石头」
- [ ] `node art/_src/verify.mjs⟧ 输出 `ALL CHECKS PASSED⟧
- [ ] `node build.mjs⟧ 成功，`index.html⟧ ≤ 2.5MB 且无任何 `http⟧ 引用
- [ ] `art/contact-sheet.png⟧ 更新，文件名与 §3 完全一致（全小写、下划线、序号从 0）

---

## 7. 直接复制给绘画 Agent 的提示词

```text
你是这个项目的像素美术 Agent。项目是一个纯前端单文件游戏《方块矿工》。
项目链接（本机绝对路径）：
  C:\Users\Administrator\Documents\deepseek-harness\default-workspace\blockminer
游戏单文件：index.html（双击即可玩，零外部请求）
美术管线：art/（生成器 art/_src/*.mjs，清单 art/manifest.json，自检 art/_src/verify.mjs）
必读：docs/ART-SPEC.md（风格与像素规范）、docs/ZONES-V5.md（本轮玩法：7 关 / 7 工具 / 岩层分级）、docs/ART-BRIEF-V5.md（本次任务书）

【任务】把画面从「3 关时代」扩到「7 关 + 7 工具 + 5 个岩层带」，让玩家一眼看出自己在哪个矿区、挖到多深。
优先级严格按 docs/ART-BRIEF-V5.md §3：
 P0：7 关 × 三层矿区背景（256×256 无缝，bg.zone.<z>.far/mid/near）、7 张关卡封面（512×160）、7 张缩略图（128×128）、
     第 7 把工具图标 icons.tool_coreDrill（24×24）、深核钻机 9×9 冲击波 fx.deep_ring（128×128，四圈 1 / 0.55 / 0.3 / 0.15）
 P1：岩层带罩色 / 描边纹理 tiles.band.tint.1..4、tiles.band.edge.1..4（第 5 带可选先出）、
     7 关各一套岩底盘 tiles.rock.<z>（32×32 ×4 变体）
 P2：天赋面板分区标题条、尾节点金框、5 条强化线图标、金色火花

【风格】像素 RPG 矿洞：深色底（#0b0e13 / #141b24）、描边 #2a2a2a、主色橙 #ff8a3d、金 #ffc857；
单一光源来自上方偏左；方块左上亮边 #a0a0a0、右下暗边 #4a4a4a；每图 ≤32 色。
7 关色身份：quarry 灰石 + 木梁；copperridge 铜绿 #3fa08a + 锈橙 #b8703a；blueiron 冷蓝 #4d7cff + 铁米褐 #d8b98a；
lavaedge 熔岩 #ff5a46 + 暗红 #3a1418；starcave 紫青 #6fd8e0 + 星紫 #a05cff；moonrift 月白 #cfd8e3 + 冷银 #7f8fa6；
coreheart 核心金 #ffc857 + 深紫黑 #1a1024。

【硬约束】
1) 只改 art/ 与 docs/，绝对不要改 src/*.js（别的 Agent 正在并行改玩法逻辑）。
2) 图必须是 PNG-24 + alpha，像素对齐，无抗锯齿 / 羽化 / 外发光 / 渐变 / 3D 高光；无文字与水印。
3) 文件名必须全小写：^art/[a-z]+/[a-z0-9_]+\.png$；关 id 压平（copperRidge → copperridge）。
4) 背景四边必须无缝，并输出 art/_preview/ 下的 2×2 预览证明。
5) 禁止任何 Minecraft 原版素材 / 字体，仓库里不许出现 "Minecraft" 字样。
6) 总内联体积 ≤ 2.5MB；新增目录或尺寸必须同步更新 art/_src/verify.mjs 的 SIZE 表。
7) 不许引入任何外部资源（CDN 字体、http 图片）；构建脚本会因外链直接失败。

【流程与验收】
 node art/_src/gen.mjs && node art/_src/verify.mjs && node build.mjs 三条全绿；
 verify 输出 ALL CHECKS PASSED，index.html < 2.5MB 且无 http 引用；
 更新 art/contact-sheet.png；
 最后回报：新增 / 修改的文件清单、每个 key 的尺寸与用途、verify 与 build 的真实输出、以及哪些 key 还需要 src 侧（grid / fx / ui）接一行取图代码。

你可以按自己的判断调整清单与风格细节，但必须把改动写回 docs/ART-BRIEF-V5.md 的清单里（我们靠它对齐）。
```

---

## 8. 需要「代码侧」配合的点（美术做不完的部分）

| 素材 | 谁接 | 接的时候改哪里 |
|---|---|---|
| `bg.zone.<z>.*⟧ / `bg.cover.<z>⟧ / `bg.thumb.<z>⟧ | grid / UI owner | `09-main.js⟧ 取背景处按 `state.currentZone⟧ 选 key，回落 `bg.far/mid/near⟧ |
| `tiles.band.tint/edge.*⟧ | grid owner | `03-grid.js⟧ 的 `BAND_TINT/BAND_EDGE⟧ 从常量改成「有图用图、没图用色」；第 5 带需 `BAND_MAX⟧ 3 → 4 |
| `tiles.rock.<z>⟧ | grid owner | `03-grid.js⟧ 的 `paintTexture⟧ 里，填充矿优先查 `tiles.rock.<zone>⟧ |
| `fx.deep_ring⟧ | fx owner | `06-fx.js⟧ 的 `quake:blast⟧ 分支，`shape === 'square9'⟧ 时优先取图 |
| `ui.band_header⟧ / `ui.node_capstone⟧ / `icons.upgrade_*⟧ | UI owner | `08-ui.js⟧ 天赋 drawer 的分区头、`iconSlot⟧ 调用 |

---

## 9. v5 交付记录（美术 Agent 回写，以此为准）

P0 / P1 / P2（除可选 #16 `fx.zone_flash.<z>`）全部交付；manifest 69 → 131 键，PNG 合计 492.6KB，`index.html` 1008KB。

### 9.1 与 §3 的约定差异（接线时请按这里）

| 项 | §3 原写法 | 实际 | 理由 |
|---|---|---|---|
| 关卡 key 段 | `bg.zone.<扁平 id>.*` | **key 用原始关 id（驼峰）**：`bg.zone.copperRidge.far`、`bg.cover.coreHeart`、`tiles.rock.blueIron`；**文件名仍全小写扁平** | 与 `icons.tool_coreDrill` 同规则：代码直接 `'bg.zone.' + zone.id + '.far'`，无需小写转换 |
| 强化图标 key | `icons.upgrade_<扁平 id>` | `icons.upgrade_pickDamage / magnet / bag / workTime / richBonus`；文件 `upgrade_pickdamage.png` 等 | 同上，key = `'icons.upgrade_' + upgrade.id` |
| 岩层带序号 | 1..4 + 可选 5 | **后缀 = `bandOf(depth) + 1`**：1 表层（极淡中性颗粒 + `#2a2a2a` 描边）/ 2 蓝 / 3 紫 / 4 赤 / 5 金（第 5 带，12–14 层） | 4 带 + 第 5 带共 5 组，1-based 与 §3 一致；接线 `'tiles.band.tint.' + (band + 1)` |
| 岩底盘内容 | 每关岩底 | 每关 = 该关**填充矿**（采石场石 / 铜谷煤 / 3–7 关铁）画在该关色身份岩基上 + 8 个关卡色斑点 | 填充矿仍一眼能认出矿种，同时 7 关岩底互不相同 |

### 9.2 文件 / 尺寸 / 用途

| key | 文件 | 尺寸 | 用途 |
|---|---|---|---|
| `bg.zone.<Z>.far/mid/near` ×21 | `bg/zone_<z>_far|mid|near.png` | 256×256 无缝 | 关卡三层视差（0.15 / 0.4 / 0.8）；mid/near 透明 |
| `bg.cover.<Z>` ×7 | `bg/cover_<z>.png` | 512×160 不透明 | 营地关卡卡 / 结算抬头；2px 关卡主色框 |
| `bg.thumb.<Z>` ×7 | `bg/thumb_<z>.png` | 128×128 不透明 | 关卡选择缩略图 |
| `tiles.rock.<Z>` ×7（各 4 变体） | `tiles/rock_<z>_0..3.png` | 32×32 | 填充矿底盘；外框 / 斜角与矿石贴图同规范，4 变体亮度差 ≤1.6 |
| `tiles.band.tint.1..5` | `tiles/band_tint_<n>.png` | 32×32 半透明 | 罩色纹理（alpha 与 ZONES-V5 §1 同量级），直接 `drawImage` 替代 `fillRect` |
| `tiles.band.edge.1..5` | `tiles/band_edge_<n>.png` | 32×32，中心透明 | 2px 内描边 + 断续磨损，左上亮右下暗 |
| `icons.tool_coreDrill` | `icons/tool_coredrill.png` | 24×24 | 第 7 把工具卡图标（UI 自动接入） |
| `icons.upgrade_<id>` ×5 | `icons/upgrade_<id小写>.png` | 24×24 | 强化抽屉 5 行图标 |
| `fx.deep_ring` | `fx/deep_ring.png` | 128×128 | 9×9 冲击波，14px 一格，中心 3×3 = 1，外三圈 0.55 / 0.3 / 0.15（alpha） |
| `fx.spark_gold` | `fx/spark_gold.png` | 8×8 | 富矿 / 幸运 TNT 金火花 |
| `ui.band_header` | `ui/band_header.png` | 24×24 九宫格 | 天赋分区标题条（左橙标签 + 底线） |
| `ui.node_capstone` | `ui/node_capstone.png` | 24×24 九宫格 | 尾节点金框 |

预览：`art/_preview/zone_<z>_{far,mid,near,stack}_2x2.png`（无缝证明）、`art/_preview/zones_lineup.png`（7 张缩略图并排，供「不看文字认关」验收）。
生成器：`art/_src/zones.mjs`（背景 / 封面 / 缩略图）、`art/_src/extras.mjs`（其余）；`verify.mjs` 的 SIZE 表已加 `bg/zone_`、`bg/cover_`、`bg/thumb_`、`fx/deep_ring`，无缝检查覆盖 `bg/zone_*`，外框 + 变体亮度检查覆盖 `tiles/rock_*`。
