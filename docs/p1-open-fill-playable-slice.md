# P1 · 开放世界填充可玩切片

> **状态：定稿 · docs-only · 2026-10-28**（用户确认；交 UI 做开放填充界面规划。默认不 git commit/push）  
> 落实：[`player-loop.md`](./player-loop.md) §8 **P1**（开放世界填充可玩切片）  
> 产品原则：[`playtest-rubric.md`](./playtest-rubric.md)（先合格可玩）  
> Catalog / 硬行：[`items-and-building-content.md`](./items-and-building-content.md)（形状 vs 世界绑定）  
> 地图确认与填充：[`world-map-editor.md`](./world-map-editor.md) §9 / §9.10 / §9.11  
> 五层纪律：[`extensibility.md`](./extensibility.md)（Substrate 真相 · Catalog compile-down · AI 不提交）  
> P0 边界（勿重复造轮）：`/workspace/btg-e2e/ui-plan-p0-player-loop-feedback.md` Out（商店/补给/任务互动属本期）

相关术语：**Fill Placement（填充放置）** · **Building kind（建筑种类）** · **compile-down** · **Perceive→Act→Feedback** · **HUD / delta** · **stub（桩）**。

---

## 1. 一句话目标与单局成功

### 1.1 一句话目标

> 在**已确认地图**上，玩家能对城镇填充建筑走出一圈 **Perceive → Decide → Act → Feedback**：在商店**买到东西**、在补给点**补到状态**、在任务点**接到任务旗**——且 **HUD / 代价 / delta / 锁定原因**沿用 P0 露脸，不另起经济或任务 runtime。

### 1.2 单局成功定义（本切片）

作者准备好一份「已确认 + 已放置 + 世界绑定」的演示世界后，试玩者能复述：

| # | 玩家能说出的话 | 系统可见证据 |
|---|---|---|
| 1 | 「我在这个地点看到了商店 / 补给 / 任务入口」 | Perceive：地点行动列表出现填充互动（非自由文本） |
| 2 | 「我花了资源买到了东西」 | Act 经 `adventure-sessions`；Feedback：resources **delta** + 持有 fact/旗或库存表达 |
| 3 | 「我补到了状态」 | supply recipe 改 variables / resources；HUD delta |
| 4 | 「我接到了任务」 | quest 接取写 fact / 任务旗；HUD 或已知事实露脸 |
| 5 | 「钱不够 / 没货 / 条件不够时点不了，且能看懂原因」 | 锁定行 + `blockedReason`（对照 rubric **D7**） |

**不要求**本切片内打通完整任务交付链、遭遇战斗或再玩多策略（属 P2 / 人工 D8）。交付闭环若世界数据已具备，可做**最小**「交任务 → 奖旗/资源」；否则接取桩合格即可。

口味对照：[`player-loop.md`](./player-loop.md) §1.5 **`explore`（探索经营）** 为 P1 主口味；不启用 `idle`；不加深 `combat`。

---

## 2. In / Out（硬边界）

### 2.1 In（本期必须）

| 项 | 说明 |
|---|---|
| **shop 购买桩** | 对已绑定真价的货架行：扣本世界 `resourceId` + 获得 item/fact（或等价 session 表达）；库存不足 / 钱不够 → 锁定可读 |
| **supply 恢复** | 对已绑定 `target` 的配方：改 variables / resources + 可选花费；次数用尽可锁 |
| **quest 接取桩** | 写本世界任务旗 / fact；列表空槽合法；条件不满足则锁 |
| **（可选最小）quest 交付** | 若放置已有交付条件 + 奖励行，允许一次交任务改旗/发奖；**不**要求任务图引擎 |
| **闭环露脸** | 走通 Perceive→Act→Feedback；复用 P0 HUD / 代价副行 / delta / 锁定 / 结局面板，不新开试玩壳 |
| **数据诚实** | 空货架 / 空配方 / 空任务槽合法（示「未开张」）；有入口但无硬行 → 不可伪造成可购 |
| **端口纪律** | 写操作只经 `adventure-sessions`（及既有封装）；AI / UI 不改 session |

### 2.2 Out（明确不做）

| 项 | 归属 |
|---|---|
| 完整商店仿真（进货、物价波动、回购经济、拍卖、全局交易所） | 非目标（与 items §10 / world-map §9.10.8 一致） |
| 制作树 / 合成 / 装备槽 RPG | 非目标 |
| 完整任务图引擎（图节点、多线编排器） | P2+ / 另立项 |
| encounter / boss **完整战斗**与掉落仿真 | **P2**；本期若已有 `start_encounter` 触发桩，**仅保持不加深** |
| 自由文本行动主循环、parser IF | 全局非目标 |
| 放置 / 挂机 idle | 全局非目标（player-loop §1.5） |
| 按口味或题材分叉 runner / 试玩壳 | 禁止 |
| AI 玩时 mutate session；旁白当 delta | 禁止 |
| Catalog 库资产绑死某世界货币名 / 气血变量 / 任务旗 | 禁止（items §6） |
| 重复实现 P0：HUD 套娃修复、EndingPanel、选项开闭摘要 | 已交付；本期只**接**填充行动进同一壳 |

---

## 3. 玩法闭环（open · 本切片）

对齐 [`player-loop.md`](./player-loop.md) §4.1，把「可选地图填充互动」升为本期主路径之一：

```text
当前地点文案 + 迷雾 + HUD（resources / variables）     ← Perceive（P0 已有）
    → 建议行动 ∪ 移动 ∪ 【填充互动入口：买 / 补 / 接任务】
    → 玩家点一项（耗时 / 花费 / 锁定原因可见）           ← Decide
    → adventure-sessions：conditions → effects
         · shop：resource 扣价 + item/fact 获得 + 库存计数（桩）
         · supply：variable/resource 恢复 + 可选花费
         · quest：set fact / 任务旗（+ 可选最小交付）
    → Feedback：结果文案 + **delta** + 选项开闭（P0）
    → 可再行动或移动；未终局回到 Perceive
```

| 节拍 | 本切片具体要求 |
|---|---|
| **Perceive** | 当前地点若有 fill placement，行动列表露出互动（显示名来自库 ⊕ overrides）；迷雾外不剧透敏感图标（沿用 §9.10） |
| **Decide** | 代价副行：花费（真价 resource）· 可选耗时；钱不够 / 无货 / 条件不满足 → 灰锁 + 原因 |
| **Act** | 只打 adventures 端口；效果经 KindRegistry / rules；**禁止** UI 本地改库存当真值 |
| **Feedback** | resources / variables / facts delta 进 P0 `PlayStatsBar`；「新可选 / 已不可用」若行动集合变 |

**主干不变：** 地点 → 行动/移动 → 状态 → 目标。填充是**富化**，不是第二套游戏。

---

## 4. Catalog vs 世界绑定（不另起一套）

完整分层见 [`items-and-building-content.md`](./items-and-building-content.md) §6；本切片只钉玩法侧：

| 层 | 放什么 | 本切片用法 |
|---|---|---|
| **Item / Building Catalog** | 可复用形状：itemId、shelf 模板、recipe 语义键、quest 标签占位 | 作者先有库资产（M-item 工作区已具备硬字段） |
| **确认地图 + MapFillPlacement** | 库引用 + `localOverrides` / 世界绑定 | 真价、`resourceId`、recipe `target.name`、questId/marker、库存 |
| **Substrate 玩时** | `resources` / `variables` / `facts` + conditions/effects | 购买/补给/接任务 compile-down 到既有效果；**不**新建钱包/背包/任务 runtime |

```text
Catalog 模板（可空 shelf）
    → 放置实例（真价 + resourceId + stock…）
    → 发布进 WorldContent 行动/效果（或会话投影出的填充行动）
    → adventure-sessions 求值
```

**纪律句（与 extensibility 对齐）：**

> 状态真相在 Substrate；循环形状在 player-loop；货架/配方形状在 Catalog；真价与绑定在世界放置；智能只建议不提交。

---

## 5. 建筑 kind 玩法验收条

> 勾选以**已确认地图上的放置实例**为准；库内空模板不算本切片失败。

### 5.1 `shop`（购买桩）

- [ ] 地点 Perceive 出现商店互动入口（有可玩货架行或显式「未开张」态，不假装可买）
- [ ] 选择一货架行：花费提示可见（本世界 resource 显示名 + 数量）
- [ ] 钱足够且有库存：Act 成功 → resource **下降 delta** + 获得物（fact 旗或约定库存表达）可见
- [ ] 钱不够 → 不可点 + 可读原因（如「通货不足」）
- [ ] 库存为 0 / 未上架 → 不可点或入口提示无货；**不**静默扣款
- [ ] UI 不本地改库存；刷新/重读存档与端口一致

### 5.2 `supply`（补给恢复）

- [ ] 地点出现补给互动（有已绑定 target 的配方，或诚实空态）
- [ ] 执行配方后：目标 variable/resource **上升（或约定方向）delta** 在 HUD 可见
- [ ] 若有 cost：扣费 delta 与恢复同时露脸
- [ ] 次数用尽 / 缺少 requiresItem → 锁定 + 原因
- [ ] target 未世界绑定的配方不得表现为「已恢复成功」

### 5.3 `quest`（接取桩 · 可选最小交付）

- [ ] 地点出现任务点入口；空 slots 合法（提示暂无任务）
- [ ] 接取成功 → 任务旗 / fact 写入且 Perceive 可感（已知事实、HUD 旗、或行动开闭）
- [ ] 条件不满足 → 灰锁 + 原因（不伪造可接）
- [ ] （可选）交付条件满足时可交一次 → 清/改旗 + 奖励 resource/item 的 delta
- [ ] 不引入独立任务图编辑器或第二套任务 session

### 5.4 `encounter` / `boss`（本期边界）

| 态度 | 说明 |
|---|---|
| **不加深** | 不在本期补战斗回合、掉落表仿真、Boss 血条 |
| **已有触发桩** | 若内容已挂 `start_encounter`，保持「可触发、可写既有 flag」的文档口径即可；当前实现若仍为 no-op，**记缺口**交 P2，不堵 shop/supply/quest 验收 |
| **验收** | 本切片 **不**把遭遇可玩列入 P1 必过项 |

---

## 6. 数据契约摘要（给 UI / Coder）

### 6.1 UI 只消费的端口

| 消费 | 来源 | 禁止 |
|---|---|---|
| 地点文案、行动列表（含填充互动）、enabled / blockedReason | AdventureView（`adventure-sessions` 投影） | UI `eval` 条件；伪造锁定 |
| resources / variables / facts（已知） | 同上 | 本地改库存/持有当真值后回写 |
| 花费提示 / 耗时 / 风险 | 视图已有字段；无则只靠结算 delta（与 P0 一致） | 发明 Catalog 里没有的价 |
| delta | act 前后 snapshot diff（P0 路径） | 用旁白/天道冒充数值变化 |
| 空货架 / 空任务 | 合法；展示空态文案 | 「有 prompt 就算有货」 |

### 6.2 写路径

```text
玩家点「购买 / 补给 / 接任务」
  → POST/命令 adventures/.../actions（既有封装）
  → 服务端 conditions → effects（resource / set fact / variable…）
  → 返回新 AdventureView
  → UI 渲 HUD + delta
```

- **AI**（propose-act / 旁白 / 天道）：prompt-only，映射到已有行动；**不得**提交购买结果。  
- **作者时**放置真价 / 绑定：走地图填充 / 放置 overrides 命令（§9.10），不是试玩壳。

### 6.3 空态与合法「不可玩」

| 状态 | UI | 规则 |
|---|---|---|
| 库模板空 shelf，放置未补 | 可显示建筑但行动锁或「尚未开张」 | 不可购买成功 |
| 放置有行但缺 resourceId | 校验/试玩拒绝或锁 | Catalog warning ≠ 玩时真价 |
| 配方 target 未绑定 | 不得显示为可恢复成功 | world-bind-required |
| quest slots=[] | 「这里暂时没有任务」 | 非 error |

### 6.4 compile-down 期望（实现提案 · 非强制 API 名）

| 玩家动作 | 效果形状（示意） | Session 载体 |
|---|---|---|
| 购买 | `resource` 负 delta + `set`/`reveal` item 旗（或后续堆叠约定）+ 可选库存计数 | `resources` · `facts` |
| 补给 | `variable`/`resource` 正 delta + 可选花费 | `variables` · `resources` |
| 接任务 | `set` 任务旗 fact | `facts` |
| 交任务（可选） | 改旗 + 奖励 resource/item | 同上 |

**禁止**平行 `Wallet` / `InventoryRuntime` / `QuestEngine` 模块冒充 Substrate。

---

## 7. 关键状态露脸（沿用并扩展 P0）

| 事件 | HUD / delta | 代价 / 锁定 | 文案 |
|---|---|---|---|
| 购买成功 | 通货 −N；持有物开/数量 + | Decide 侧预告花费 | 「购得…」或行动结果句 |
| 购买失败（钱/货） | 无假 delta | 灰锁：钱不够 / 无货 | 原因一行 rust/muted |
| 补给成功 | 目标维 +N；花费 −M（若有） | 配方花费提示 | 恢复结果句 |
| 补给次数尽 | — | 锁定原因 | — |
| 接任务 | 任务旗 → 开；可选「新可选」 | 条件锁 | 接取确认句 |
| 交任务（若做） | 奖资源/物 delta；旗变化 | — | 交付句 |
| 空建筑 | 空态，不假装循环在转 | — | 「尚未开张 / 暂无任务」 |

视觉：继续 P0 仪器感——增益/减益/压力 tonality；**禁止**奶油条回潮、彩虹 chip、card-in-card。中文 `t()`；主显 displayLabel，裸 id 仅 tooltip。

---

## 8. 分期内实现建议顺序（玩法向 · 非强制排期）

| 序 | 步骤 | 产出 | 依赖提醒 |
|---|---|---|---|
| **0** | 策划确认本文 In/Out 与验收条 | 本文标「已确认」 | — |
| **1** | **内容 / 契约缺口** | 放置真价与 `resourceId` 绑定可保存；填充行动能投影进 AdventureView；购买/补给/接任务 effects 经 rules（KindRegistry 补桩若缺） | §9.10 放置 UX（M-fill-3）若未齐，P1 可先「手造放置实例 + 契约」但仍须 `structureLocked` |
| **2** | **演示世界数据** | 一镇至少：1 shop（≥1 真价行）+ 1 supply（已绑 target）+ 1 quest（可接旗）；起始资源够买一次也够演示锁 | 禁止写死修仙/都市专名进 contracts |
| **3** | **UI 七件套规划** | 密化开放试玩壳：填充行动行、空态、锁定文案；**不**新开商店仿真页（对话框/子面板可，须仪器感） | 读本文 + P0 规划 Out |
| **4** | **策划确认 UI 规划** | 批注通过 | 确认前不叫 Coder 做 UI |
| **5** | **Coder** | 契约/规则 → 投影 → UI 接 P0 HUD/delta → 截图验收 | 默认不 commit/push |
| **6** | **策划验收** | 对照 §5 勾选 + rubric D1/D2/D6/D7 体感 | 通过后再谈 P2 遭遇/交付加深 |

建议截图目录（落地时）：`/workspace/btg-e2e/screenshots/p1-open-shop-*.png`、`p1-open-supply-*.png`、`p1-open-quest-*.png`（含锁定态各一）。

---

## 9. 给 UI / Coder 的阅读指引

与 [`player-loop.md`](./player-loop.md) §9 同构：

| 读者 | 先看 | 产出预期 |
|---|---|---|
| **策划** | §1–§2、§5 验收条、§8 | 拍板 In/Out；确认是否含最小交付 |
| **UI** | §3 闭环、§7 露脸、§6.3 空态；P0 规划（复用壳） | 七件套：页面/改点、线框、状态表、中文文案、DESIGN 增量、Coder 清单；**确认前不叫 Coder** |
| **Coder** | §4 绑定、§6 契约、§5 勾选、§2 Out | 只经 Substrate；Catalog compile-down；不新平行 runtime；接 P0 组件 |

**默认流程：** 策划确认本文 → UI 出界面规划 → 确认后再交 Coder。**默认不 git commit/push。**

---

## 10. 文档索引与已知缺口

### 10.1 索引

| 文档 | 关系 |
|---|---|
| [`player-loop.md`](./player-loop.md) §4 / §8 P1 | 本切片母规范 |
| [`items-and-building-content.md`](./items-and-building-content.md) | 货架/配方/任务槽硬行与世界绑定 |
| [`world-map-editor.md`](./world-map-editor.md) §9.10 | 放置 UX / 互动桩 / 非目标 |
| [`playtest-rubric.md`](./playtest-rubric.md) | D1/D2/D6/D7 验收伴侣 |
| [`extensibility.md`](./extensibility.md) | 五层；禁止题材分叉 runner |
| P0 UI 规划（btg-e2e） | 已交付反馈壳；本期只扩展填充行动 |

### 10.2 与现有实现 / 文档的冲突或缺口（策划知悉）

| # | 缺口 / 漂移 | 影响 | 建议 |
|---|---|---|---|
| G1 | **§9.10 建筑填充系统仍为 docs-only**（M-fill-3 放置 UX 未实现）；仅有 M-fill-1/2 骨架 + 库 | 没有「摆到确认地图」的完整作者路径，试玩难自然出现填充行动 | P1 契约步须含：锁定后放置可保存，或临时用测试夹具写入 placement；产品路径仍以 §9.10 为准 |
| G2 | **放置真价 / `resourceId` / recipe target 绑定 UI 未做**（items 文首与 M-item-2 备注） | 仅有 Catalog 模板或 hint 价 → **不能**算可购可补 | 本期内容缺口优先于华丽商店 UI |
| G3 | **adventure-sessions** 已有 `resource` / `set` fact / `start_encounter`；后者目前 **no-op**；**无**现成 buy_shelf / supply_recipe 专用 effect 名 | 购买/补给须 compile-down 到既有 kind 或经闭集扩展 + KindRegistry | 优先复用 `resource`+`set`；新 kind 须改 contracts，禁止 UI 旁路 |
| G4 | 填充 placement **是否已投影为地点行动** — 玩时路径若未接，Perceive 看不到店 | 闭环断在第一步 | Coder 先打通「放置 → 可点行动」再妆 UI |
| G5 | world-map-editor §9.2 示意曾写 `quest_board` / `encounter_entrance`；contracts 闭集为 `shop\|supply\|quest\|encounter\|boss` | 文档用语漂移 | 以 **contracts `MAP_FILL_KINDS`** 为准；改 §9.2 示意属文档卫生，不挡 P1 |
| G6 | items 称 M-item-4 工作区已落地；world-map §9.11 曾写 M-item-4 未做 | 文档互斥 | 以 items 修订记录为准做卫生同步；与玩时购买桩无关 |
| G7 | P0 验收记下：open 演示世界缺 resource effect、势力资源 label 重复 | 演示买东西时 delta 可能仍空 | 演示世界补齐 resource 与 displayLabel；属数据/软缺口 |

以上 **G1–G4** 为 P1 开工前优先澄清项；**不**在本文把完整战斗或商店仿真扩进 In。

---

## 11. 修订记录

| 日期 | 说明 |
|---|---|
| 2026-10-28 | **定稿**：用户确认；交 UI 做开放填充（shop/supply/quest）界面规划 |
| 2026-10-28 | 初稿（规划 · docs-only）：落实 player-loop §8 P1；In/Out、闭环、Catalog/绑定、三种桩验收条、契约摘要、露脸、分期顺序、UI/Coder 指引；记录与 §9.10 / 放置绑定 / adventure 投影的缺口；待用户确认后交 UI |
