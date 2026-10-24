# v15 决策记录（供所有代理与后续维护者）

## 1. 设计真值（用户最新口径，覆盖之前的「决定 A」）

- **第一关要有点苦**：`quarry.coinMul = 3`（原 8）。
- **第一关没有 TNT**：`mods.luckyTNTChance` 基数 **0**（原 0.5）。
- **第一关的爽点 = 连锁**：`chain` 每环 **+0.12**（原 0.06）、首环 baseCost 300；`chainRange` 每环 **+0.06**、baseCost 700。
- **第二关起 TNT 暴增**：`tntDrop` 每环 **+0.12**（8 环 → 0.96，clamp 0.95）、首环 baseCost 450。
- **可放置 TNT 彻底删除**（按钮 / 投放 / beginTNT / tntArmed 全删）；只保留挖矿白掉。
- **新增 `deepLayer`**：999 级、每级 `extraLayers +1`、线性价 `300 × 等级`、挂中心。

## 2. 999 级长尾节点与节奏判据的关系（决定：选项 1）

`deepLayer` 是**无尽长尾**，它的价格永远比有限树剩下的节点便宜，所以任何「预算全部花光」的贪心买家都会把它买到 guard 上限，从而让
`progression` 的「单局购买 ≤8」「40–90 局」与 `balance` 的「本关买满收益 ≥1.05」失效 —— 这是**判据作用域**问题，不是数值 bug。

**决定：选选项 1（测试侧处理）**

- 数据保持真值：`CONFIG.talents` = 76 项（含 deepLayer），core.test / ui.smoke 口径不动。
- `test/progression.mjs` 与 `test/balance.mjs` 的贪心买家**显式跳过 `maxLevel >= 50` 的长尾节点**，并在注释写明「有限树节奏判据只量一次性节点」。
- 四条判据数值一个字不改（40–90 局 / 15–35 分钟 / 单局 ≤8 / 空窗 ≤12）。
- `progression` 另加一段**独立长尾验收**：末期钱包买 20 级 → `mods.extraLayers = 20`、价格序列 300…6000。

## 3. 冲突裁决

`scripts/v15-feel.mjs`、`scripts/sync-core-v15*.mjs` 这批改动**是我（调度方）执行的**，属于本节 §1 的设计真值，**保留，不回滚**。
任何代理若发现 `coinMul 3` / `luckyTNTChance 基数 0` / `chain 0.12` / `tntDrop 0.12`，那是预期值。
