# P2 · 遭遇可玩切片（触发 · 抉择 · 掉落反馈）

> **状态：定稿 · 已交 UI 规划 · 2026-10-28**（确认前不叫 Coder；默认不 git commit/push）  
> 落实：[`player-loop.md`](./player-loop.md) §8 **P2**（更深遭遇 / 任务）中的 **遭遇触发 + 掉落反馈** 一刀；§1.5 口味 `combat` 轻量加深  
> 产品原则：[`playtest-rubric.md`](./playtest-rubric.md)（先合格可玩；对照 D2/D6/D7；人工 D8 可感策略差）  
> Catalog / 硬行：[`items-and-building-content.md`](./items-and-building-content.md) §4.4（encounter loot / trigger）  
> 地图确认与填充：[`world-map-editor.md`](./world-map-editor.md) §9.10.5 / §9.10.8（桩 · 禁止完整战斗）  
> 五层纪律：[`extensibility.md`](./extensibility.md)（Substrate 真相 · Catalog compile-down · AI 不提交）  
> 前序边界：[`p1-open-fill-playable-slice.md`](./p1-open-fill-playable-slice.md) §5.4 Out（encounter 不加深）· `/workspace/btg-e2e/ui-plan-p1-open-fill.md`（诚实缺口 / encounter Out）

相关术语：**Encounter Placement（遭遇放置）** · **start_encounter（遭遇桩）** · **LootLine（掉落行）** · **Resolve choice（解决抉择）** · **compile-down** · **Perceive→Act→Feedback** · **HUD / delta** · **stub（桩）**。

---

## 0. 为何是这一刀（相对候选）

| 候选 | 一句话 | 本期态度 |
|---|---|---|
| **A · 遭遇触发 + 掉落反馈**（本文） | 补齐 fill kind 闭集里唯一未可玩的 `encounter`/`boss`；把现 no-op 的 `start_encounter` 变成可复述的风险→后果 | **默认推荐** |
| B · 任务交付 / 奖励加深 | P1 已「有数据才做」最小交付；再加深易滑向任务图引擎 | **次选**（可与遭遇并行的数据，但不另开大系统） |
| C · 作者地图填充放置 UX（G1 / M-fill-3） | 解作者生产阻塞，但**不是**玩法切片；用户本期要「新玩法」 | **后置**（作者工具，另立项） |

推荐原则对齐：立刻增强开放可玩感 · 依赖已落地 P0/P1 · 一期能做完 · 文档已标遭遇为自然下期。

---

## 1. 一句话目标与单局成功

### 1.1 一句话目标

> 在**已确认地图**上，玩家能对 `encounter` / `boss` 填充走出一圈 **Perceive → Decide → Act → Feedback**：看见遭遇入口 → **付得出风险/代价地抉择** → 结算写出旗 / 资源 / 掉落物，且 **HUD / delta / 锁定**沿用 P0+P1 壳——**不**另起战斗 runtime。

### 1.2 单局成功定义（本切片）

作者准备好一份「已确认 + 已放置遭遇 +（可选）loot 硬行」的演示世界后，试玩者能复述：

| # | 玩家能说出的话 | 系统可见证据 |
|---|---|---|
| 1 | 「这里有遭遇 / Boss 入口」 | Perceive：地点行动列表出现遭遇互动（投影自 fill；非自由文本） |
| 2 | 「我选了交锋 / 撤离，不是只有一个灰按钮」 | Decide：闭集两向；代价/风险可见或诚实无字段省略 |
| 3 | 「打赢了拿到东西 / 旗变了」或「跑掉了但付了代价」 | Act 经 `adventure-sessions`；Feedback：resources / variables / facts **delta** |
| 4 | 「空掉落点也能触发，不会假装掉了一堆货」 | 空 loot 合法；触发仍可写开战/解决旗；不伪造掉落 |
| 5 | 「条件不够时点不了，原因能看懂」 | 灰锁 + `blockedReason`（对照 **D7**） |

**不要求**回合制血条、装备槽、命中检定表、多波次战斗图，或完整任务图引擎。Boss 与 encounter **同一切片形状**；Boss 仅多「击败旗 / 更重后果」标签，不另开 UI 壳。

口味对照：[`player-loop.md`](./player-loop.md) §1.5 **`combat`（遭遇冲突）** 本期轻量加深；主循环仍是开放 fill，不启用 `idle`；不冒充完整战斗仿真已完成。

---

## 2. In / Out（硬边界）

### 2.1 In（本期必须）

| 项 | 说明 |
|---|---|
| **遭遇入口投影** | 已放置的 `encounter` / `boss` fill → AdventureView 行动（扁平行或入口+子面板，沿用 P1 混用纪律） |
| **解决抉择（≥2）** | 闭集锁定为 **交锋 / 撤离** 两向（Q1=A）；后果可感不同（旗 / 资源 / 是否掉落） |
| **`start_encounter` 不再纯 no-op** | 触发或解决时须写入可审计 session 变化（开战旗 / 解决旗 / 变量压力等）；禁止「点了等于没点」 |
| **掉落反馈桩** | 对已绑定 loot 行：在「成功解决」路径 compile-down 发 item fact / resource；chance 用**确定性 stub**（Q2=A，见 §6.4） |
| **空态诚实** | `loot=[]` 合法：可触发遭遇，Feedback 不假装掉落；无投影则不伪造遭遇入口（对齐 P1 G4） |
| **闭环露脸** | Perceive→Act→Feedback；复用 P0 HUD / 代价副行 / delta / 锁定 / Ending；复用 P1 行动行 / 可选 Sheet |
| **端口纪律** | 写操作只经 `adventure-sessions`；AI / UI 不改 session |
| **演示世界** | ≥1 encounter（可触发 + ≥1 成功路径有可见后果）；建议另备 1 boss 或同点 boss 标签演示击败旗 |

### 2.2 Out（明确不做）

| 项 | 归属 |
|---|---|
| 回合制战斗 / 行动点 / 命中闪避表 / 敌我血条 UI | 非目标（world-map §9.10.8 · items §10） |
| 完整掉落仿真（加权随机引擎、保底、稀有度色） | 非目标；本期确定性 stub 即可 |
| 装备槽 / 技能树 / 制作树 RPG | 全局非目标 |
| 完整任务图引擎；把「任务交付加深」扩成主 In | 次选另文；本期最多消费已有交付投影 |
| 作者地图填充放置 UX / 真价绑定表单（G1/G2） | 作者工具后置；玩时靠夹具或已有放置 |
| 自由文本行动主循环、parser IF | 全局非目标 |
| 放置 / 挂机 idle | 全局非目标 |
| 按口味分叉 runner / 新开「战斗页」路由 | 禁止 |
| AI 玩时 mutate session；旁白当 delta | 禁止 |
| 重复实现 P0/P1：HUD、商店/补给/接任务 | 已交付；本期只**接**遭遇行动进同一壳 |
| 冒充「完整战斗已完成」的文案或 UI | 禁止（标签须标明桩 / 遭遇） |

---

## 3. 玩法闭环（open · 本切片）

对齐 [`player-loop.md`](./player-loop.md) §4.1，把「遭遇」从「可选不加深」升为本期主路径：

```text
当前地点文案 + 迷雾 + HUD（resources / variables / facts）   ← Perceive（P0/P1）
    → 建议行动 ∪ 移动 ∪ 【遭遇入口：交锋 / 撤离】
    → 玩家点一项（耗时 / 风险 / 花费若有则可见）             ← Decide
    → adventure-sessions：conditions → effects
         · 触发：写开战旗 / 进入「解决」行动组（或同拍解决）
         · 交锋成功：写击败/解决旗 + 掉落 compile-down
         · 撤离：写逃离旗 + 可选代价（resource/variable）
    → Feedback：结果文案 + **delta** + 选项开闭（P0）
    → 可再行动或移动；未终局回到 Perceive
```

| 节拍 | 本切片具体要求 |
|---|---|
| **Perceive** | 有 fill 则露遭遇入口（displayLabel 来自库 ⊕ overrides）；迷雾外不剧透 Boss（沿用 §9.10）；无投影不画假入口 |
| **Decide** | 闭集交锋 / 撤离；风险/耗时有字段才显；条件不满足 → 灰锁 + 原因 |
| **Act** | 只打 adventures 端口；效果经 KindRegistry / rules；**禁止** UI 本地发掉落当真值 |
| **Feedback** | resources / variables / facts delta 进 P0 `PlayStatsBar`；掉落获得用 displayLabel；行动开闭（已击败不可再刷——若 `once`） |

**主干不变：** 地点 → 行动/移动 → 状态 → 目标。遭遇是**风险富化**，不是第二套战斗游戏。

---

## 4. Catalog vs 世界绑定（不另起一套）

完整分层见 [`items-and-building-content.md`](./items-and-building-content.md) §4.4 / §6；本切片只钉玩法侧：

| 层 | 放什么 | 本切片用法 |
|---|---|---|
| **Building Catalog** | `encounter.loot[]` 模板、`trigger` 偏好、`packId` 占位、`boss?` | 库内空 loot 合法 |
| **确认地图 + MapFillPlacement** | 库引用 + overrides：真 loot 行、地点触发、击败旗名、资源掉落 `resourceId` | 可玩实例 |
| **Substrate 玩时** | `resources` / `variables` / `facts` + conditions/effects | 触发/解决/掉落 compile-down；**不**新建 CombatRuntime / LootEngine |

```text
Catalog encounter 模板（可空 loot）
    → 放置实例（loot 行 + 可选击败旗 / resourceDrops 绑定）
    → 投影为地点行动组（入口 + 解决抉择）
    → adventure-sessions 求值
```

**纪律句：**

> 状态真相在 Substrate；循环形状在 player-loop；遭遇形状在 Catalog；触发与掉落绑定在世界放置；智能只建议不提交。

---

## 5. 玩法验收条

> 勾选以**已确认地图上的放置实例**为准；库内空模板不算本切片失败。

### 5.1 入口与诚实空态

- [ ] 地点 Perceive 出现遭遇 / Boss 互动入口（有投影才显）
- [ ] 无投影时**不**伪造遭遇招牌（对齐 P1 G4）
- [ ] `loot=[]`：仍可触发/解决；Feedback **无**假掉落 delta
- [ ] 迷雾未探索：不剧透 Boss 敏感入口（沿用既有迷雾纪律；夹具世界可在已探索点演示）

### 5.2 解决抉择（Decide）

- [ ] 同一遭遇暴露闭集两向 **交锋 / 撤离**（扁平行或入口后 Sheet 内两行）
- [ ] 两向后果可感不同（旗不同 / 资源方向不同 / 是否发掉落）——对照人工 **D8** 最低条
- [ ] 条件不满足 → 灰锁 + 可读原因（D7）
- [ ] 不出现「只有继续」假分支

### 5.3 触发与状态（Act）

- [ ] 点遭遇相关行动后 session **有**可审计变化（开战旗 / 解决旗 / 变量等）；`start_encounter` 不得再整段 no-op
- [ ] 写操作只经 adventures 端口；重读存档与端口一致
- [ ] `once`（若配置）：解决后入口锁或消失，原因可读

### 5.4 掉落反馈（Feedback）

- [ ] 成功路径 + 有 loot 硬行：获得物（fact 旗或约定表达）与/或 resource **delta** 在 HUD 可见
- [ ] 掉落主显 **displayLabel**；裸 id 仅 tooltip
- [ ] 未绑定 / 未知 itemId 不得表现为「已掉落成功」（对齐 G2 精神）
- [ ] 旁白 / 天道不得冒充掉落 delta

### 5.5 Boss（同形状加标签）

- [ ] `kind=boss` 或 `encounter.boss`：可用击败旗（本世界 fact）；击败后可感（旗 / 开闭 / 文案）
- [ ] **无**独立 Boss 血条页、阶段条、多形态战斗 UI

### 5.6 与 P0/P1 壳

- [ ] 不新开战斗路由；结算进既有 HUD + delta
- [ ] 中文 `t()`；仪器感：无彩虹 kind chip、无奶油战斗海报

---

## 6. 数据契约摘要（给 UI / Coder）

### 6.1 UI 只消费的端口

| 消费 | 来源 | 禁止 |
|---|---|---|
| 地点行动（含遭遇入口/解决行）、enabled / blockedReason | AdventureView | UI `eval`；无行动时伪造遭遇 |
| resources / variables / facts | 同上 | 本地发掉落当真值回写 |
| 风险 / 耗时 / 花费提示 | 视图已有字段；无则省略 | 发明 Catalog 没有的伤害数字 |
| delta | act 前后 snapshot diff（P0 路径） | 用旁白冒充数值/掉落 |
| 空 loot | 合法 | 「有 prompt 就算有掉落」 |

### 6.2 写路径

```text
玩家点「进入遭遇 / 交锋 / 撤离」
  → POST adventures/.../actions（既有封装）
  → 服务端 conditions → effects
       （start_encounter 语义落地 + resource/set/variable/reveal…）
  → 返回新 AdventureView
  → UI 渲 HUD + delta（Sheet 若打开：沿用 P1 已拍板「保持打开刷新」）
```

- **AI**（propose-act / 旁白 / 天道）：prompt-only；**不得**提交遭遇结果。  
- **作者时**放置 loot / 击败旗：走地图填充 / overrides（§9.10），不是试玩壳。

### 6.3 空态与合法「不可玩」

| 状态 | UI | 规则 |
|---|---|---|
| 无遭遇投影 | 不显示遭遇入口 | 不伪造 |
| 有入口、loot=[] | 可触发；结果句不宣称获物 | 可写解决旗 |
| loot 行缺 itemId / 未绑定 resource | 锁或拒投影为成功掉落 | Catalog warning ≠ 玩时真掉落 |
| 已 `once` 解决 | 入口锁/消失 + 原因 | 不静默可刷 |

### 6.4 compile-down 期望（实现提案 · 非强制 API 名）

| 玩家动作 | 效果形状（示意） | Session 载体 |
|---|---|---|
| 进入 / 开战 | `start_encounter` **落地为** set 开战旗（+ 可选压力 variable） | `facts` · `variables` |
| 交锋成功 | set 解决/击败旗 + 对 loot 行 `set`/`reveal` item 旗 + 可选 `resource` 正 delta | `facts` · `resources` |
| 撤离 | set 逃离旗 + 可选 resource/variable 负代价 | 同上 |

> **闭集锁定（Q1=A）：** 本期仅上表三行语义对应的玩家向「交锋 / 撤离」（开战可为入口或并入交锋）。**交涉** 不进本期 In，作后续扩展。

**chance stub（已锁定 Q2=A）：** v1 用确定性规则（例如 `chance >= 1` 必掉；`chance <= 0` 不掉；中间档按 placementId+itemId 哈希稳定判定），**禁止**引入独立 RNG 服务冒充战斗引擎。文档与 UI 不宣称「真实掉率仿真」。

**禁止**平行 `CombatRuntime` / `LootEngine` / `EnemyStatBlock` 模块冒充 Substrate。

### 6.5 与现有实现缺口（策划知悉）

| # | 现状 | 本期期望 |
|---|---|---|
| E1 | `start_encounter` 在 KindRegistry 注册，求值侧仍为 **no-op**（描述写明不改 session） | 必须产生可审计 session 变化（至少旗） |
| E2 | `fill-actions` 对 encounter/boss **显式跳过**加深 | 投影入口 + 解决行动组（对称 shop/supply/quest） |
| E3 | Catalog `encounter.loot` 已有；放置绑定 UI 仍弱（G1/G2） | 演示世界夹具写入可玩 loot；作者 UX Out |
| E4 | P1 软缺口：HUD「银两」vs 花费「通货」 | 遭遇文案继续 displayLabel；不强制本期修文案漂移 |

---

## 7. 关键状态露脸（沿用并扩展 P0/P1）

| 事件 | HUD / delta | 代价 / 锁定 | 文案 |
|---|---|---|---|
| 开战 / 进入 | 开战旗 → 开；可选压力 + | 风险副行（有则显） | 「遭遇开始…」 |
| 交锋成功 + 有掉落 | 获物旗 → 开；resource +N | — | 「取得…」 |
| 交锋成功 + 空 loot | 仅解决/击败旗 | — | 诚实结果句，不提获物 |
| 撤离 | 逃离旗；可选资源 − | 撤离代价提示 | 「脱身…」 |
| 条件锁 | — | 灰锁 + 原因 | — |
| 已解决 once | — | 锁「已经了结」 | — |
| 无投影 | 不画入口 | — | — |

视觉：继续 P0/P1 仪器感——增益/减益/压力 tonality；**禁止**战斗海报英雄区、血条炫光、彩虹稀有度。中文 `t()`；主显 displayLabel。

---

## 8. 分期内实现建议顺序（玩法向 · 非强制排期）

| 序 | 步骤 | 产出 | 依赖提醒 |
|---|---|---|---|
| **0** | 用户确认本文 In/Out 与验收条 | **已完成**（定稿 · Q1=A · Q2=A） | 已交 UI 规划；确认 UI 前不叫 Coder |
| **1** | **契约 / 规则** | `start_encounter` 落地；encounter/boss 投影进 AdventureView；解决抉择 compile-down；loot → fact/resource | 优先复用 `resource`+`set`；新 kind 须改 contracts |
| **2** | **演示世界数据** | 1 encounter（交锋/撤离 + ≥1 loot 行）+ 建议 1 boss 击败旗；另备空 loot 点 | 禁止写死题材专名进 contracts |
| **3** | **UI 规划** | 密化开放壳：遭遇行 / 可选 Sheet；复用 P1 混用；**不**新开战斗页 | 读本文 + P1 UI 规划 |
| **4** | **策划确认 UI 规划** | 批注通过 | 确认前不叫 Coder 做 UI |
| **5** | **Coder** | 规则 → 投影 → UI 接 HUD/delta → 截图 | 默认不 commit/push |
| **6** | **策划验收** | 对照 §5 + D2/D6/D7；人工 D8 一句 | 通过后再谈任务图 / 真战斗另立项 |

建议截图目录（落地时）：`/workspace/btg-e2e/screenshots/p2-encounter-*.png`（入口、双抉择、成功掉落 delta、空 loot、锁定、Boss 击败、inspector）。

---

## 9. 给 UI / Coder 的阅读指引

与 [`player-loop.md`](./player-loop.md) §9 / P1 §9 同构：

| 读者 | 先看 | 产出预期 |
|---|---|---|
| **策划** | §0–§2、§5 验收条、§8、§11 已锁定 | In/Out 与 Q1/Q2 已定稿；等 UI 规划后批注 |
| **UI** | §3 闭环、§7 露脸、§6.3 空态；P1 规划（复用壳） | 七件套：改点、线框、状态表、中文文案、DESIGN 增量、Coder 清单；**确认前不叫 Coder** |
| **Coder** | §4 绑定、§6 契约、§5 勾选、§2 Out、§6.5 缺口 | 只经 Substrate；Loot compile-down；不新平行 CombatRuntime；接 P0/P1 组件 |

**默认流程：** ~~用户确认本文~~（已完成） → **UI 出界面规划** → 策划确认 → 再交 Coder。**默认不 git commit/push。确认 UI 前不叫 Coder。**

---

## 10. 文档索引与已知缺口

### 10.1 索引

| 文档 | 关系 |
|---|---|
| [`player-loop.md`](./player-loop.md) §4 / §1.5 / §8 P2 | 本切片母规范 |
| [`p1-open-fill-playable-slice.md`](./p1-open-fill-playable-slice.md) | 前序；§5.4 把遭遇划给本期 |
| [`items-and-building-content.md`](./items-and-building-content.md) §4.4 | loot / trigger 硬行 |
| [`world-map-editor.md`](./world-map-editor.md) §9.10 | 互动桩与非目标 |
| [`playtest-rubric.md`](./playtest-rubric.md) | D2/D6/D7；人工 D8 |
| P1 UI 规划（btg-e2e） | 复用壳与 Sheet 纪律 |

### 10.2 诚实后置（本期不堵验收）

| # | 项 | 说明 |
|---|---|---|
| G1 | 作者放置 UX | 仍 Out；夹具写入 placement |
| G2 | 真价/绑定表单 | 遭遇侧同理；夹具补齐 loot 绑定 |
| Q+ | 任务交付加深 / 任务图 | 次选；不进本 In |
| Soft | 「银两」vs「通货」文案 | 不强制本期修 |

---

## 11. 已锁定（原开放问题 · 用户拍板 2026-10-28）

| # | 问题 | 拍板 | 落实 |
|---|---|---|---|
| **Q1** | 解决抉择闭集 | **A** 仅「交锋 / 撤离」两向 | §2.1 / §3 / §5.2 / §6.4；交涉后置 |
| **Q2** | 掉落 chance | **A** 确定性 stub（哈希/阈值） | §6.4；无独立 RNG；不宣称真实掉率仿真 |

其余沿用 P1 已拍板：交互混用、Sheet 成功后保持刷新、kind 纯文字 muted——遭遇同类适用，不另开票。

---

## 12. 修订记录

| 日期 | 说明 |
|---|---|
| 2026-10-28 | **定稿 · 交 UI**：用户确认 Q1=A（交锋/撤离闭集）、Q2=A（确定性 chance stub）；状态改为定稿并交 UI 规划；确认前不叫 Coder；未 commit/push |
| 2026-10-28 | **初稿（待用户确认）**：落实 player-loop §8 P2 遭遇一刀；In/Out、闭环、Catalog/绑定、验收条、契约、露脸、分期、UI/Coder 指引；记录 start_encounter no-op / fill-actions 跳过等缺口；开放问题 Q1/Q2；未交 UI/Coder；未 commit/push |
