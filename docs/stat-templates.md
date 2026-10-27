# 数值题材模板（Stat Templates）设计说明

> 源文档：题材数值骨架如何叠在**统一引擎基底**上，避免「开放文字游戏」塌成多选题。  
> 实现入口：`packages/contracts/src/stat-templates.ts`  
> 状态：v1 设计已定稿；改编桌 / 空图画布可选模板；**单局编辑面 = 通用数值编辑器（Stat Editor）**；玩时 HUD 已按 ChoiceScript 灵感升级（见 `docs/if-editor-patterns.md`）。

---

## 1. 问题

没有硬状态时，选项只是翻页：玩家看不到代价，也感受不到世界因自己的行动而变。  
若为每个题材写一套运行时（修仙战斗、推理检定、经营回合……），引擎会分叉，后期无法共用世界书 / 条件 / 效果，开放度反而塌缩。

**目标：**  
题材给出**特征数值骨架**（作者时），全部编译进同一套 `variables + conditions + effects (+ worldbook)`；玩时与生成时都不出现题材专属 if/else。

---

## 2. 统一基底（Substrate）——唯一运行时

引擎只认识这些形状（已有，不另起炉灶）：

| 层 | 形状 | 作用 |
|---|---|---|
| 状态 | `variables: Record<name, string\|number\|boolean>` | 存档真相 |
| 条件 | `variable.equals` / `variable.gte` | 选项是否可见 |
| 效果 | `variable.set` / `variable.increment` | 行动成功后改状态 |
| 世界书 | forbid / gate / cap / spend 等既有约束 | 硬规则上限与花费 |

**硬约束：** 模板、提示词、UI **不得**引入新的 effect/condition 种类或题材专属 runner。模板的输出必须是上表的子集。

---

## 3. 模板边界（Template）——作者时骨架

模板是**编目数据 + 提示片段**，不是通关条件表，也不是玩法 DLL。

每个模板包含：

- `id` + `version`：内容戳记，供迁移与 HUD 标签解析
- `label` / `blurb`：给人看的题材说明
- `variables[]`：`name / type / initial / displayLabel? / role`
- `promptHint`：告诉模型如何把这些变量花在选项上

模板**不做**的事：

- 不锁定图拓扑（几条边、几个结局）
- 不规定唯一胜利条件
- 不在运行时改写规则引擎
- 不替代世界书硬规则（若需要 cap/spend，仍走既有 worldbook 类型）

---

## 4. Role 词汇表（跨题材共用）

| Role | 含义 | 类型约定 | 例子 |
|---|---|---|---|
| `resource` | 可增减的存量 | number | `qi`, `coin` |
| `relationship` | 人际站位 | number | `sect_trust`, `affection` |
| `flag` | 开关 / 持有 | boolean | `has_token`, `has_alibi` |
| `progress` | 调查/节拍进度 | number | `clues`, `chapter_beat` |
| `pressure` | 威胁失败的压力 | number | `calamity`, `suspicion`, `risk`, `tension` |

**为何是这五个：**  
覆盖「能花的 / 对人的 / 有没有 / 走了多远 / 有多危险」五类开放文字游戏常见反馈；比「属性点 / 技能」更贴分支叙事，又不会膨胀成 RPG 模拟器。  
若未来要加 role，必须先改本文 + schema，并证明无法用现有五类表达。

---

## 5. 生命周期

```
作者选模板（或生成任务带 statTemplateId）
        ↓
生成骨架提示注入 preferredVariables + promptHint
        ↓
模型声明 variables，并在 choices 上写 effects/conditions
        ↓
内容戳记 statTemplateId + statTemplateVersion（元数据）
        ↓
发布 → 存档只持久化 variables 值
        ↓
玩时 HUD 可用戳记解析 displayLabel；无戳记则回退变量名
```

要点：

1. **作者时应用**：`applyStatTemplateVariables` 把初值并入草稿；已有键不被覆盖（作者定制优先）。
2. **生成挂钩**：`skeletonUserPayload(..., { statTemplateId })` → `statTemplatePromptPayload`；runner 在骨架/扩写后补戳记。图仍由模型与作者改边，模板不冻拓扑。
3. **玩时**：规则引擎只读 `variables`；HUD 标签是展示层。旧稿无 `statTemplateId` 仍可玩。

---

## 6. 作者可定制 vs 必须稳定

| 可改 | 宜稳定 |
|---|---|
| `displayLabel`、初值微调、增删个别变量 | `id` + `version` 语义 |
| 选项文案、边、结局文案 | role 含义（resource 不要忽然变 flag） |
| 在图上增 effects/conditions | 已发布存档依赖的变量名（改名需迁移） |
| 世界书条目（既有类型内） | 引擎 effect/condition 种类 |

世界书引用变量名时，改名等于破坏规则——模板 bump `version` 并文档化迁移，而不是静默改名。

---

## 7. 版本策略

- 目录内每个模板有整数 `version`（从 1 起）。
- `GameContent` / `BranchSkeleton` 可选字段：
  - `statTemplateId`
  - `statTemplateVersion`
- **破坏性变更**（删变量、改 role、改名）：`version++`，旧存档继续用旧变量名跑；HUD 仅在 id+version 匹配时用该版标签，否则回退到「按现网目录名匹配」或裸名。
- 不做自动改写已发布 revision 的 variables（防污染存档）。

---

## 8. 已发布预设（v1）

| id | 标签 | 特征变量（role） |
|---|---|---|
| `xianxia_pressure` | 江湖 / 修仙压迫 | `qi` resource · `sect_trust` relationship · `calamity` pressure · `has_token` flag |
| `mystery_deduction` | 悬疑推理 | `clues` progress · `suspicion` pressure · `ally_trust` relationship · `has_alibi` flag |
| `trade_venture` | 商途 / 资源经营 | `coin` resource · `reputation` relationship · `risk` pressure · `has_cargo` flag |
| `relationship_drama` | 关系向 / 互动 | `affection` relationship · `tension` pressure · `promise_kept` flag · `chapter_beat` progress |

生成挑选：v1 由任务输入 `statTemplateId`（可选）；未选则行为与旧版相同（模型自拟变量）。后续可加「根据分析题材启发式自动选」，但不得偷偷改已有草稿。

---

## 9. Schema / API 面（稳定）

`packages/contracts/src/stat-templates.ts`：

- `statRoleSchema` / `StatRole`
- `statTemplateVariableSchema` / `StatTemplateVariable`
- `statTemplateSchema` / `StatTemplate`（含 `version`）
- `statTemplateRefSchema` / `StatTemplateRef`
- `STAT_TEMPLATES` / `statTemplateIdSchema`
- `getStatTemplate` / `getStatTemplateRef`
- `templateInitialVariables` / `applyStatTemplateVariables`
- `displayLabelForVariable`
- `statTemplatePromptPayload`

内容戳记字段（可选，不破坏旧 JSON）：`statTemplateId`, `statTemplateVersion`。  
任务输入（可选）：`GenerationInput.statTemplateId`。

---

## 10. 非目标（v1）

- 完整 RPG / 战斗回合 / 骰子检定
- 题材专属运行时或新 effect 类型
- 天道检测管线
- 强制所有故事必须选模板
- 玩时 HUD 发明状态（展示不得成为状态真相源；HUD 已接 displayLabel / role 排序 / meter，见 if-editor-patterns）

---

## 11. 失败模式（刻意避免）

1. **选择题回潮**：大量选项无 effects → 数值条永不变化。  
2. **模板当通关表**：所有好结局锁同一变量，坏结局不可达。  
3. **运行时分叉**：`if (template === 'xianxia') specialCombat()`。  
4. **静默改名**：模板升级改掉已发布变量名，污染存档。  
5. **HUD 发明状态**：UI 显示未在 `variables` 中的数。  
6. **为凑数加变量**：role 齐全但选项从不消费 → 假开放。

---

## 12. 扩展规则

1. 新题材：只加目录条目 + 文档表；跑 `statTemplateSchema.parse`。  
2. 新 role：先改本文论证，再改 enum 与校验。  
3. 生成 UI：改编桌 / 空图画布已有下拉；单局编辑走变量编辑器「套用数值模板」。用户自定义全局模板目录仍非 v1 目标。  
4. HUD：用 `displayLabelForVariable(name, content.statTemplateId, content.statTemplateVersion)`；缺省回退裸名。

---

## 13. 挂钩点（已接 / 待接）

| 点 | 状态 |
|---|---|
| 目录 + zod + 编译为 variables | 已接 |
| `skeletonUserPayload` 注入 | 已接（可选） |
| runner 戳记 id/version | 已接 |
| 改编桌下拉选择模板 | 已接（`GenerationPanel` · `statTemplateId` 进任务，含 pending 重试） |
| 空图画布扫描模板 | 已接（`DraftPanel` empty-scan） |
| 通用数值编辑器（Stat Editor） | 已接（`StatEditor` / `StoryVariablesEditor` 别名；属性列表 UI + 套用模板） |
| 玩时状态条 / delta | 已接（`PlayStatsBar` 常驻表 + meter + displayLabel delta；节奏：正文→状态→选项） |

---

## 13b. 与传统 IF 编辑器用法对齐

数值模板只解决「题材骨架」；**怎么露出给作者/玩家**见 [`docs/if-editor-patterns.md`](./if-editor-patterns.md)：Twine 的画布主舞台、ChoiceScript 的常驻属性表与 set→if、Ink 的状态筛选项、Inform 的规则拥有状态。Opposed-pair 不进运行时。

## 14. 下一步 / 已完成（UI）

| 项 | 状态 |
|---|---|
| 改编桌「数值模板」下拉 → `GenerationInput.statTemplateId` | 已完成 |
| 空图画布扫描同款下拉 | 已完成 |
| 变量编辑器「套用数值模板」（灌初值 + 戳记，不覆盖已有键） | 已完成 |
| 单局增删改变量 | 已有通用数值编辑器 `StatEditor`（检视器「变量」页） |
| 选项条件/效果 | 已有场景/`ChoiceRulesEditor` |
| 用户自建全局模板目录 / CRUD | **非目标（v1）** |
| 题材自动推断 | 非目标（v1） |
| 模板版本自动迁移工具 | 非目标（v1） |


