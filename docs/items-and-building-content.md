# 物品目录与建筑分种类主要内容

> **状态：M-item-1 + M-item-2 + M-item-3 已在工作区落地（Item Catalog + shop/supply + quest/encounter/boss 硬模板 / 校验 / 建筑库表单）· 尚未 git commit · 2026-10-28**  
> M-item-4（AI propose-item/shelf 闭环）**工作区已落地（未 commit）**；**不**另起经济 runtime。放置真价/`resourceId` 绑定 UI 未做（仅 schema 扩展口）。  
> 约束来源：[`extensibility.md`](./extensibility.md)（五层 · Catalog compile-down）· [`world-map-editor.md`](./world-map-editor.md) §9 / §9.10（确认 → 填充 → 建筑库）· [`stat-templates.md`](./stat-templates.md)（`role: resource` 货币约定）。  
> 产品纪律：**不另起经济 / 物品运行时**；玩时真相仍是 Substrate 的 `resources` / `variables` / `facts` / conditions / effects。

相关术语（中英对照，下文混用）：**Item Catalog（物品目录）** · **BuildingAsset（建筑库资产）** · **KindRegistry（种类注册表）** · **compile-down（编译下行）**。

---

## 1. 问题与结论

### 1.1 问题

建筑库 v1（工作区）已有 `kind ∈ shop | supply | quest | encounter | boss`，但「主要内容」仍停在：

- `inventoryDraft` / `lootDraft`：仅有 **label**（可选空洞 `resourceId`），是**作者草稿标签**，不是可玩真值；
- 互动桩 `defaultInteract.effectDrafts`：自由结构，未按种类区分货架 / 恢复配方 / 任务槽 / 掉落表；
- AI `propose-building` 可吐出物资名词，却没有强制落成「目录物品 id + 建筑引用」。

作者在问的本质是：**不同建筑该维护什么——产物 prompt，还是具体物资？**

### 1.2 结论（已拍板）

| 议题 | 结论 |
|---|---|
| 不是只靠产物 prompt | **硬内容优先**：商店货架、补给配方、任务槽、遭遇掉落表必须是可校验的结构化行 |
| 也不是孤立物资表 | **「物品目录 + 建筑引用」**：目录是共享 Catalog 底座；建筑按 `kind` 维护引用行，禁止建筑自造自由文本物资当玩法真值 |
| Prompt / blurb / image | **软内容**：只辅助 AI 提议与展示；accept 后必须落成硬行 |
| 货币 | **普通 Substrate `resources`**（`role: resource`）；**不**独立「钱」类型。Catalog 只存相对/提示价；**真价与 `resourceId` 解析在世界绑定 / 放置**（见 §6） |
| 草稿字段 | `inventoryDraft` / `lootDraft` **过渡保留**作 AI 中转 → 分期迁入硬字段后 deprecate |
| 运行时 | **不**新建经济 / 背包 / 拍卖引擎；硬行 compile-down 到既有 effect / fact / resource 桩即可先通 |

一句话：

> **物品目录是编目真相；建筑主要内容是按种类引用目录的硬数据；prompt 只是生成器。**

### 1.3 可复用性与世界绑定边界（原则）

本项目是**通用开放文字游戏生成器**，不是单本小说专用工具。设计时必须分清：

| 放哪里 | 放什么 |
|---|---|
| **Catalog（物品目录 / 建筑库）** | 可跨世界、跨题材复用的**形状与偏好**：身份、kind、tags、呈现、软 prompt；货架/配方的**结构模板**与类别偏好；物品语义与 `defaultPriceHint`（仅提示） |
| **具体游戏世界 / 确认地图后的放置实例** | 本世界才成立的**数值与绑定**：货币 `resourceId`、补给 target 对齐数值模板、真价与库存、任务/遭遇真 id、世界书与地点绑定 |

**禁止**把某小说势力名、任务旗、数值模板变量名、世界专属 `resourceId` 写成库资产的**必填硬约束**。扩展靠 **contracts 闭集 + KindRegistry + 数据包**，禁止按题材 `if/else` 写死玩法。详见 **§6**。

---

## 2. 与现有 Substrate / Catalog 的关系

```text
                    Catalog（作者时）
  ┌─────────────────────────────────────────────┐
  │ Item Catalog     Building Library            │
  │  items[]    ←──  shop.shelf / loot rows      │
  │  (id+cat)        (itemId refs)               │
  └──────────────────────┬──────────────────────┘
                         │ compile-down
                         ▼
                    Substrate（玩时）
  ┌─────────────────────────────────────────────┐
  │ resources: Record<id, number>  ← 货币与存量  │
  │ facts kind:'item' (boolean)    ← 关键/任务旗 │
  │ variables + conditions/effects ← 恢复/花费   │
  │ locations + fill placements    ← 放置实例    │
  │ KindRegistry stubs             ← 互动入口    │
  └─────────────────────────────────────────────┘
```

| 层 | 本设计落点 |
|---|---|
| **Substrate** | 货币与花费走 `resources` + `effect.kind: 'resource'`；关键物/任务旗可映射 `facts.kind: 'item'`（boolean）；补给改 `variables` / `resources`；遭遇仍 `start_encounter` 桩。**禁止**平行「钱包 / 背包 runtime」 |
| **Catalog** | **Item Catalog**（新）+ **Building Library**：跨世界可复用的形状 / 偏好 / 可选模板行；与数值模板、地图模板同层；workspace 范围 v1。**不**绑死某世界 `resourceId` / 任务旗 |
| **世界实例 / 放置** | 确认地图后的 `MapFillPlacement` + `localOverrides` + 本世界 resources / 数值模板 / 任务·遭遇编目——把 Catalog 模板**实例化**（见 §6） |
| **AI adapters** | `propose-item` / `propose-shelf` / `propose-loot` → 草稿；accept 写 Catalog；`propose-map-fill` 只实例化到放置，**不改库本体** |
| **Authoring UI** | 物品目录页 / 建筑检查器按 kind 切换硬表单；草稿标签可一键「升格为 Item」；世界内填充另有绑定 / overrides 表单 |
| **Transport** | 物品 CRUD、建筑硬内容保存、AI 提案审核、放置 overrides 进入共用命令表 |

**与现有字段的衔接（实现时）：**

- 今日 `BuildingStockLine = { label, resourceId?, qty? }` → 升级路径：`label` 仅草稿；硬行改为 `{ itemId, … }`。
- 今日 `resourceCosts` 可保留为建筑级「进店 / 互动总开销」提示，与货架单价正交。
- 今日 `facts.kind: 'item'` 是**布尔旗**（持有/触发），不是堆叠库存；堆叠数量若需要，v1 优先用 `resources` 或后续专用变量，**不**把 fact 改成数量容器。

---

## 3. 物品目录（Item Catalog）

### 3.1 范围与身份

- **范围 v1**：与 Building Library 相同——**当前工作区编目**；schema 预留 `packId` / export，不做跨项目市场。
- **身份**：每条 Item 有稳定 `id` + 正整数 `version`；破坏性变更 bump version；**禁止**静默改名已发布 id。
- **同名**：显示名冲突时用 `· 2` 后缀（与建筑库一致）；id 另行 uniquify。

### 3.2 字段表（提案）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string (id) | ✓ | 稳定键；玩法与建筑引用此值 |
| `version` | int ≥ 1 | ✓ | 内容戳记 |
| `label` | string ≤ 80 | ✓ | 显示名 |
| `category` | 闭集枚举 | ✓ | 见 §3.3 |
| `tags` | string[] ≤ 16 | | 检索 / AI 种子（铁匠、疗伤…） |
| `stack` | `{ max?: number; unique?: boolean }` | | 缺省：可堆叠、max 未设=实现默认；`unique: true` 表示关键/任务不堆叠 |
| `defaultPriceHint` | `{ resourceId?, amount, roleHint?: string }` | | **Catalog 软提示**：相对默认价；`resourceId` 可选且**不得**要求绑死某题材货币名（银两/信用点/灵石）；真价与本世界 `resourceId` 解析在**世界货架实例 / 放置**（§6） |
| `resourceValue` | `{ resourceId?, amount, roleHint?: string }[]` | | 可选：卖出/折算**提示**；世界绑定时才映射到本世界 resource effect |
| `blurb` | string ≤ 500 | | 软文案 |
| `generateHint` | string ≤ 2000 | | 软：给 AI 的产物 / 用途提示，**非**玩法真值 |
| `imageUrl` / `imagePath` | string | | 软：展示图 |
| `provenance` | object | | 来源（AI / 手动 / 升格自 draft label） |

### 3.3 类别闭集（v1 默认，可调）

| `category` | 中文 | 典型 compile-down | 备注 |
|---|---|---|---|
| `consumable` | 消耗品 | 用则 `resource`/`variable` 变化；可扣库存 | 丹药、干粮 |
| `equipment` | 装备 | v1 可仅 fact 旗或变量加成桩 | 完整装备槽非目标 |
| `material` | 材料 | 多为库存数量；制作图非目标 | 矿石、药材 |
| `info` | 情报 / 文书 | 常映射 `facts.kind: 'item'` 或 clue | 可读软文 |
| `key` | 钥匙 / 信物 | 通常 `unique` + fact 旗 | 门控条件 |
| `quest` | 任务物品 | 任务槽奖励 / 交付条件 | 与任务系统挂钩 |
| `misc` | 杂项 | 兜底 | 尽量少用；AI 提案时警告 |

> 类别表为**文档默认**；实现前若要增删，须改本文 + contracts 闭集，禁止 UI 自由字符串。

### 3.4 货币约定（Catalog 软 · 世界硬）

- **货币语义** = 普通 Substrate `resources`（数值模板 `role: 'resource'`）。**不**引入 `currency` 专用类型。
- **Catalog 侧**：Item / 库内模板货架可用 `defaultPriceHint` / 相对价；`resourceId` **可选**；可用 `roleHint`（如 `primary_coin`）表达「主货币」而不写死「银两」。
- **世界绑定 / 放置侧**：真价必须带**本世界** `resourceId`（银两 vs 信用点 vs 灵石由**本世界数值模板**决定）；多货币允许，各货架行各自解析。
- **校验分层**：纯 Catalog 保存 → 未知/缺失 `resourceId` 最多 **warning**；已绑世界或放置实例 → 本世界 resources 中不存在则 **error**。

### 3.5 校验（Catalog 保存时）

1. `id` 唯一；`category` ∈ 闭集。  
2. `defaultPriceHint` / `resourceValue`：有 `resourceId` 则格式合法；**Catalog 未绑世界时未知资源只 warning**（允许跨世界复用的提示价）；世界实例校验见 §6。  
3. `unique: true` 时禁止 `stack.max > 1`。  
4. 被 BuildingAsset 硬行引用的 Item：**删除前**必须解除引用或级联警告（禁止静默悬空）。  
5. AI 提案不得直接写入「无 Item 的货架」——见 §8。  
6. **禁止**校验要求库内 Item 必填某世界专属 `resourceId` / 势力名 / 数值变量名。

---

## 4. 建筑库分种类主要内容（硬数据）

BuildingAsset **共用**身份 / 呈现 / 软 prompt / provenance（§5）；**按 `kind` 维护可复用的结构模板**（§6：库=形状与偏好；世界放置=实例数值）。  
库内硬字段允许「空模板」（仅 kind + filters）——**可复用骨架**；**可玩真值**在世界绑定 / 放置后补齐或经 `localOverrides` 落地。

### 4.0 共用硬字段（所有 kind）

| 字段 | 说明 |
|---|---|
| `id` · `version` · `label` · `kind` · `tags?` | 已有 |
| `defaultInteract?` | 入口文案 + 效果草稿；种类专用表是主要内容，interact 只做「进店 / 对话」外壳 |
| `resourceCosts?` | 可选：进入或使用建筑的总费用（与货架单价正交） |

### 4.1 `shop` — 货架（库=可选模板 · 世界=可玩实例）

| 字段 | 形状 | 说明 |
|---|---|---|
| `shop.shelf` | `ShelfLine[]` | **可选模板行**：库内可为空数组（仅 kind=shop + filters 的骨架合法）；世界放置后须有可玩行 **或** 显式 stub |
| `shop.categoryFilters?` | `ItemCategory[]` | **偏好**：UI / AI 提议时过滤目录（跨世界可复用） |
| `shop.buyback?` | boolean | v1 可选桩；默认 false |

**ShelfLine（库模板 vs 世界实例）**

| 字段 | 类型 | Catalog 库模板 | 世界绑定 / 放置实例 |
|---|---|---|---|
| `itemId` | id | ✓ 指向通用 Item Catalog | 引用不变；可经 overrides 裁剪上架行 |
| `price` | `{ resourceId?, amount, roleHint?: string }` | 可选；可只写 `amount` + `roleHint`（相对 hint） | **必填真价**；`resourceId` 解析到本世界 resources |
| `stockMax?` | number | 可选默认上限 hint | 本店库存 / 是否上架（`localOverrides`） |
| `restock?` | `{ mode: 'none' \| 'on_visit' \| 'daily_stub'; amount?: number }` | 可选偏好 | 本店补货规则 |
| `labelOverride?` | string | 仅展示 | 仅展示，不改 Item |

**空货架约定：** `kind=shop` 且 `shelf=[]` 在库内 **OK**（模板-only）；填充验收 / 试玩可购要求：放置合并后有可玩行，或作者显式标记 stub（「未开张」）。  

Compile-down（桩）：购买 → 本世界 `resource` 扣价 +（可选）fact/变量表示获得；库存用放置级 overrides 或 session 临时计数（完整商店仿真非目标）。

### 4.2 `supply` — 恢复配方（语义模板 · 世界绑 target）

| 字段 | 形状 | 说明 |
|---|---|---|
| `supply.recipes` | `SupplyRecipe[]` | **可选模板**；库内可空，世界放置后补齐或 overrides |

**SupplyRecipe**

| 字段 | 类型 | Catalog 库模板 | 世界绑定 / 放置 |
|---|---|---|---|
| `id` | string | 行 id | 同 |
| `label` | string | 「打尖」「疗伤」等展示 | 可本地改文案 |
| `role` / 语义键 | string（建议） | **优先**：`heal_light` / `heal_full` / `rest` / `sanity_light` 等**跨题材语义**，不写死 `qi` | 解析到本世界变量 |
| `target` | `{ kind: 'variable' \| 'resource'; name?: string; roleHint?: string }` | 若直接写 `name`，标为 **world-bind-required**（入库 warning：未绑定前不可试玩） | **必填**：`name` 对齐本世界数值模板（气血/理智/电量…） |
| `amount` | number | 可选默认量 hint | 本店真值 |
| `cost?` | `{ resourceId?, amount, roleHint?: string }` | 相对费用 hint | 本世界 `resourceId` + 真价 |
| `uses?` | `{ perVisit?: number; perDayStub?: number }` | 可选偏好 | 本店次数 |
| `requiresItemId?` | id | 可选通用 Item | 同 |

**禁止**在可复用库资产中把 `target.name = 'qi'`（或任一题材专属变量）标成**必填且无绑定步骤**。  

Compile-down：世界绑定后 `variable.increment` / `resource` delta + 可选花费；不新建「旅店 runtime」。

### 4.3 `quest` — 任务槽（库=占位/标签 · 世界=真 id）

| 字段 | 形状 | 说明 |
|---|---|---|
| `quest.slots` | `QuestSlot[]` | **可选模板**；库内可仅标签占位 |

**QuestSlot**

| 字段 | 类型 | Catalog 库模板 | 世界绑定 / 放置 |
|---|---|---|---|
| `questId?` | id | 可选占位；**不**要求填某小说任务编目真 id | **本世界**任务编目真 id |
| `marker` / `markerTag?` | string | 可选**语义标签**（如 `tag:side_hunt`）；避免强制 `quest_wolf_started` 这类本世界旗名 | 解析/生成本世界 `facts` 旗名 |
| `label` | string | 展示模板 | 可本地化 |
| `conditions?` | 条件草稿[] | 仅通用条件草稿；禁止必填本世界势力名 | 对齐本世界 facts / 世界书 |
| `rewards?` | `{ items?: …; resources?: …; flags?: … }` | items 可引通用 Item；resources/flags 多为 hint | 本世界 resourceId / 旗 |
| `giveItems?` | `{ itemId, qty }[]` | 可引通用任务物 Item | 同 |

Compile-down：写本世界 `facts` / `variables`；完整任务图引擎非本阶段目标。

### 4.4 `encounter` / `boss` — 遭遇包 + 掉落

| 字段 | 形状 | 说明 |
|---|---|---|
| `encounter.packId?` | id / tag | 库内：**可选占位或语义标签**；本世界遭遇编目真 id 在放置时绑定 |
| `encounter.trigger?` | 条件草稿 / 「进入地点」 | 库内通用触发偏好；地点/迷雾实例在放置 |
| `encounter.effectRefs?` | 效果草稿[] | 含 `start_encounter` 桩 |
| `encounter.loot` | `LootLine[]` | **可选模板掉落**；可空，世界侧补齐 |
| `encounter.boss?` | boolean | `kind===boss` 时隐含 true；也可显式 |
| Boss 唯一击败旗 | — | **禁止**库内必填；属本世界 facts（放置 / 世界生成时规定） |

**LootLine**

| 字段 | 类型 | Catalog | 世界实例 |
|---|---|---|---|
| `itemId` | id | ✓ 通用目录 | 同 |
| `qty` | number \| `{ min, max }` | 模板 | 可 overrides |
| `chance` | number 0..1 | 模板 | 可 overrides |
| `resourceDrops?` | `{ resourceId?, amount, roleHint?: string }[]` | hint | 本世界 resourceId |

Compile-down：触发桩写**本世界** flag；掉落在「胜利」桩上发 fact/resource。**完整战斗仿真非目标**（与 world-map-editor §9.10.8 一致）。

### 4.5 种类 → 硬字段速查

| kind | 库内主要内容（可空模板） | 世界放置须补齐 | 过渡草稿 |
|---|---|---|---|
| `shop` | `shop.shelf` 模板 + filters | 真价 / 库存 / 上架裁剪 | `inventoryDraft` → 升格 |
| `supply` | `supply.recipes` 语义模板 | target / cost 绑本世界 | 旧 label 行迁 |
| `quest` | `quest.slots` 标签占位 | questId / marker 真值 | — |
| `encounter` | loot 模板 + trigger 偏好 | pack 真 id + 地点触发 | `lootDraft` → 升格 |
| `boss` | 同 encounter | 击败旗 + 本世界绑定 | `lootDraft` → 升格 |

---

## 5. 软内容边界（prompt / blurb / image）

| 软字段 | 允许 | 禁止 |
|---|---|---|
| `blurb` | 展示、旁白种子 | 当作库存 / 价格真值 |
| `generateHint` / `imagePrompt` | AI 提议货架、文案、出图 | 玩时求值；校验「有 prompt 即算有货」 |
| `inventoryDraft` / `lootDraft` | AI 中转、人工对照 | **世界填充验收不得仅有草稿**；库可保留模板+draft，可玩性以放置实例为准 |
| `BuildingImage` / Item 图 | 展示 | 规则 / 经济校验真值（同 world-map-editor §9.10.8） |

**产品句：** 库检查器允许「空模板 + prompt」并提示「模板-only，需在世界放置时绑定」；**世界 / 放置检查器**若只有 prompt / draft、无实例硬行，警告「尚未绑定——试玩不可购买 / 掉落」。

---

## 6. 可复用性 · 可扩展性 · 世界绑定

> **产品纪律：** 通用开放文字游戏生成器 → Catalog 资产必须可跨世界 / 跨题材复用；避免把「某一方向」（某小说、某数值模板、某货币名）写死进库。

### 6.1 Catalog 只放「形状与偏好」

**物品目录 / 建筑库**允许且鼓励：

- **身份与分类**：`id` / `version` / `label` / `kind` / `category` / `tags`
- **呈现与软内容**：`blurb` / `generateHint` / `image*` / provenance
- **结构模板**：货架槽位形状、`categoryFilters`、可选默认货架**草案**（`itemId` 引用目录内**通用**物品）
- **物品语义**：`category`、stack 规则、用途语义；`defaultPriceHint` **仅提示**（不绑死题材货币名）
- **扩展口**：`kind` / `category` 经 **contracts 闭集**扩展；内容靠**数据 + KindRegistry**，禁止按题材 `if/else` 写死玩法

**Catalog 禁止写成库资产必填硬约束的：**

- 某本小说的势力名、地名、人物名
- 具体任务旗 / Boss 唯一击败旗（本世界 facts）
- 具体数值模板变量名（如强制 `qi` / `san`）
- 某世界专属 `resourceId`（银两 / 信用点 / 灵石）作为**必填**字段

### 6.2 进入具体游戏世界（或放置到已确认地图）才规定 / 生成

- 货币与 `resourceId` **绑定到本世界** `resources` / 数值模板
- 补给 recipe 的 **target** 对齐本世界 stat template（气血 / 理智 / 电量…）
- 具体标价、库存上限、补货、本地货架裁剪（`localOverrides`）
- 任务槽 `marker` / `questId`、世界书条目 id、遭遇包 id、Boss 击败旗 —— **本世界图 / 事实**
- 与本小说相关的世界书标签解析、地点绑定、迷雾下的实例
- AI `propose-map-fill` / 世界内生成：从库模板 **实例化**到 placement，**不是**改库本体

### 6.3 分层对照表

| 内容 | 物品 / 建筑库（Catalog） | 世界绑定 / 放置实例 |
|---|---|---|
| 物品类别与语义 | ✓ | 引用 |
| 默认价 hint | 可选提示（可无 resourceId） | 真价与 `resourceId` 解析 |
| 商店货架结构 | 可选模板行（可只含 `itemId` + 相对 hint）；**允许空 shelf** | 本店价 / 库存 / 是否上架 |
| 补给配方结构 | 可选模板（语义键如 `heal_light`） | `target` 绑到本世界变量 |
| 任务 / 遭遇 id | 仅可选占位或标签 | 本世界 quest / encounter **真 id** |
| Boss 击败旗 / 任务旗 | ✗ 不写死 | 本世界 facts |
| 题材专属数值 | ✗ 不写死 | 数值模板 + 世界生成 |
| 世界书 / 地点 / 迷雾 | 可选通用 tag | 本世界条目与放置 |

### 6.4 扩展性要点

- **新题材**：Catalog 数据包 + 数值 / 地图模板 + 提示种子，**不** fork 运行时、不按题材分叉 rules
- **新建筑 kind**：`contracts` 闭集扩展 + `KindRegistry` 桩；UI / AI 跟注册表走
- **新物品 category**：改本文 + contracts 闭集；禁止 UI 自由字符串当类别真值
- **AI adapters**：只出草稿；accept 写 Catalog 或写**放置实例**；玩时不直写库
- **compile-down 不变**：库与放置合并后仍下行到既有 `resources` / `variables` / `facts` / effects；**不**新建平行经济 runtime

### 6.5 与实现分期的关系

M-item-1…4（§9）落地时必须遵守本节边界：目录 CRUD 不强制世界 `resourceId`；shop/supply 表单区分「库模板」与「放置绑定」；世界填充验收看**实例**可玩性，不把「库内空模板」误判为产品错误。

---

## 7. 放置与本地覆盖

沿用 [`world-map-editor.md`](./world-map-editor.md) §9.2 / §9.10.4；并服从 **§6**（此处是**世界实例化**主战场）：

```text
MapFillPlacement = {
  buildingAssetId,   // 库引用（可复用模板）
  localOverrides?,   // 本世界：真价/resourceId、库存、recipe target、loot chance、展示…
  worldBindings?,    // 可选显式：货币映射、语义 role→变量名、questId/packId 解析
}
```

| 可本地覆盖 / 世界绑定（建议） | 不可本地覆盖（须升格变体） |
|---|---|
| 货架行真价 + 本世界 `resourceId` / `stockMax` | 改 `kind` |
| 补给 `target.name` 绑到本世界数值模板 | 把本世界旗名写回库当必填 |
| 禁用某一 shelf / recipe 行 | 换一套完全不同的物品集合且希望入库复用 |
| `questId` / `encounter.packId` / 击败旗 | 静默改库内 Item 定义 |
| 展示 `label` / `color` / `icon` | |

合并规则：UI 永远显示 **库模板 ⊕ 世界绑定 / overrides**；回写库只能「升格新变体」；**map-fill / 世界生成不得改库本体**。

---

## 8. AI 生成流水线

目标：消灭「AI 发明未入库物资名词」。

```text
① propose-item（可选批量）
     → Item 草稿（label/category/priceHint/blurb）
     → 作者 accept → 写入 Item Catalog

② propose-building / propose-shelf / propose-loot
     → 只能引用 ① 中已有 itemId
     → 若模型吐出新名词：先生成 Item 草稿挂起，不得直接写入 shelf

③ accept building 硬行
     → shop.shelf / supply.recipes / quest.slots / encounter.loot 落库

④（可选）propose-map-fill / 世界内生成
     → 只引用已有 buildingAssetId + locationId（见 world-map-editor §9.10）
     → **实例化**到 MapFillPlacement（价/库存/target 绑定本世界）；**不改**库本体
```

**升格捷径（作者 UX）：** 选中 `inventoryDraft` 某 label →「创建并绑定 Item」→ 生成 Item + 替换为 `itemId` 模板行。

纪律：AI **不**写 session、**不**改地图结构、**不**绕过 Catalog 审核、**不**把本世界专属 id 写回通用库必填字段。

---

## 9. 实现分期（M-item-*）与验收

| 切片 | 内容 | 验收 |
|---|---|---|
| **M-item-1** Item Catalog | 工作区 CRUD；类别闭集；字段校验；独立或嵌在建筑库旁的目录页 | 增删改查；同名 `· N`；无静默覆盖；删除被引用 Item 有警告 |
| **M-item-2** shop / supply 硬内容 | BuildingAsset 增 `shop` / `supply`；检查器表单；放置 overrides 单价/库存 | **工作区已落地（未 commit）**：空 shelf 合法；未知 itemId 拒存；roleHint-only target OK；inventoryDraft 保留。放置真价绑定 UI / 购买桩经 rules / draft 升格捷径 → 后续 |
| **M-item-3** quest / encounter / boss | `quest.slots`、`encounter.loot`+trigger；loot 引用目录 | **工作区已落地（未 commit）**：空 slots/loot 合法；未知 loot/giveItems itemId 拒存；Boss 无击败旗必填；lootDraft 保留。完整任务/战斗 runtime → 非目标 |
| **M-item-4** AI 提议闭环 | propose-item → accept catalog → propose shelf/loot → accept building | **工作区已落地（未 commit）**：propose/accept Item Catalog；shelf/loot 仅引用已有 itemId，新名词挂起为物品草案；丢弃清客户端零残留；provenance=`ai-propose`。完整战斗/经济 runtime、放置真价 UI → 非目标 |

与地图填充分期关系：M-fill-3/4 可与 M-item-2 并行，但**商店试玩可购**以「世界放置实例有真价硬行」为准；仅有 draft labels 或**仅有库内空模板**不算该世界填充完成。  

实现必须尊重 **§6**：M-item 表单区分库模板 vs 世界绑定；禁止在 Catalog CRUD 强制题材专属 `resourceId` / 变量名。

---

## 10. 非目标与风险

### 10.1 非目标（本设计明确不做）

- 完整战斗 / 回合制 / 掉落仿真  
- 拍卖行、全局交易所、跨项目物品市场  
- 复杂制作图 / 合成树  
- 独立背包 UI 引擎（可后续用 resources/facts 堆叠表达）  
- 用 prompt 代替货架硬数据  
- 建筑内自由文本「物资表」当作存档真相  

### 10.2 风险

| 风险 | 缓解 |
|---|---|
| **双真相**（draft label vs itemId） | 检查器双栏；验收以硬行为准；文档与 UI 标明 draft=过渡 |
| **AI 发明未绑定物品** | 流水线强制先 Item 草稿；schema 拒收无 itemId 的 shelf/loot |
| **建筑只持有 prompt** | 警告态 + 试玩禁用购买/掉落；M-item-2 起保存可配置为 error |
| **平行经济引擎诱惑** | 章程：价格只引 `resourceId`；数量优先 resources/facts；新增 kind 走 KindRegistry |
| **悬空引用** | 删 Item / 升 version 时列出引用建筑；放置校验 error |
| **与 §9.10 非目标冲突** | 本文硬行是**编目 / 实例数据**；完整经济仿真仍非目标——桩即可 |
| **库资产题材写死**（银两/气血/某任务旗必填） | §6 分层；Catalog 校验不强制世界 id；扩展走闭集 + 数据包 |
| **把放置实例回写成库必填** | 升格变体显式；map-fill 只写 placement |

---

## 11. 数据形状 TypeScript 示意（提案，非实现）

> 下列类型供设计对齐。**M-item-1/2/3 已写入** `packages/contracts`（`item-catalog.ts` / `building-library.ts` 的 `shop`/`supply`/`quest`/`encounter`）。Catalog 侧 `resourceDrops` / rewards.resources 用软 hint（amount + optional resourceId + roleHint），与 §4.4 / §6 一致；世界放置再落成真 `ResourceAmount`。

```ts
// ——— 提案，非实现 ———

type ItemCategory =
  | 'consumable' | 'equipment' | 'material'
  | 'info' | 'key' | 'quest' | 'misc';

type ResourceAmount = { resourceId: string; amount: number }; // 世界实例真价

/** Catalog 软提示：resourceId 可选；roleHint 如 primary_coin，避免绑死银两/灵石 */
type PriceHint = {
  amount: number;
  resourceId?: string;
  roleHint?: string;
};

type ItemAsset = {
  id: string;
  version: number;
  label: string;
  category: ItemCategory;
  tags?: string[];
  stack?: { max?: number; unique?: boolean };
  defaultPriceHint?: PriceHint;       // Catalog 软；真价在世界实例
  resourceValue?: PriceHint[];
  blurb?: string;
  generateHint?: string;          // 软
  imageUrl?: string;              // 软
  provenance?: { source?: string; createdAt?: string; fromDraftLabel?: string };
};

type ItemCatalog = {
  schemaVersion: 1;
  items: ItemAsset[];
  packId?: string;                // 预留
};

type ShelfLine = {
  itemId: string;
  /** 库模板可用 PriceHint；世界放置实例应落成 ResourceAmount */
  price: PriceHint | ResourceAmount;
  stockMax?: number;
  restock?: { mode: 'none' | 'on_visit' | 'daily_stub'; amount?: number };
  labelOverride?: string;
};

type SupplyRecipe = {
  id: string;
  label: string;
  /** 跨题材语义键，优先于写死变量名 */
  role?: string; // e.g. heal_light | rest | sanity_light
  /** 库模板：name 可空 + roleHint；世界绑定后 name 必填 */
  target: {
    kind: 'variable' | 'resource';
    name?: string;           // world-bind-required for playable
    roleHint?: string;
  };
  amount: number;
  cost?: PriceHint | ResourceAmount;
  uses?: { perVisit?: number; perDayStub?: number };
  requiresItemId?: string;
};

type QuestSlot = {
  questId?: string;            // 世界真 id；库内仅可选占位
  marker?: string;             // 世界旗名；库内可空
  markerTag?: string;          // 库内语义标签，世界绑定再解析
  label: string;
  conditions?: Record<string, unknown>[];  // 条件草稿 → 日后 contracts
  rewards?: {
    items?: { itemId: string; qty: number }[];
    resources?: PriceHint[]; // Catalog soft；世界绑定 resourceId
    flags?: string[];
  };
  giveItems?: { itemId: string; qty: number }[];
};

type LootLine = {
  itemId: string;
  qty: number | { min: number; max: number };
  chance: number; // 0..1
  /** Catalog soft hint；世界实例落成 ResourceAmount */
  resourceDrops?: PriceHint[];
};

// 库内 shelf/recipes/slots/loot 均可为空数组（模板-only）
type BuildingKindContent =
  | { kind: 'shop'; shop: { shelf: ShelfLine[]; categoryFilters?: ItemCategory[]; buyback?: boolean } }
  | { kind: 'supply'; supply: { recipes: SupplyRecipe[] } }
  | { kind: 'quest'; quest: { slots: QuestSlot[] } }
  | {
      kind: 'encounter' | 'boss';
      encounter: {
        packId?: string;
        trigger?: Record<string, unknown>;
        effectRefs?: Record<string, unknown>[];
        loot: LootLine[];
        boss?: boolean;
      };
    };

// BuildingAsset 在现有字段上扩展：
// - 保留 inventoryDraft / lootDraft 为过渡软字段
// - 增加与 kind 对齐的硬内容（上表）
// Placement.localOverrides 可覆盖 shelf 行价/库存、recipe.cost、loot.chance 等
```

---

## 12. 文档索引

| 文档 | 关系 |
|---|---|
| [`extensibility.md`](./extensibility.md) | Catalog 层增加 Item Catalog；**Catalog 可复用 vs Substrate 世界实例** |
| [`world-map-editor.md`](./world-map-editor.md) §9 / §9.10 / §9.11 | 建筑库字段表指向本文；填充 = 世界实例化 |
| [`stat-templates.md`](./stat-templates.md) | 货币 / 变量 = 本世界数值模板；库侧只用 roleHint / 语义键 |
| 本文 §6 | 可复用性 · 可扩展性 · 世界绑定分层表 |
| 实现（未来） | `packages/contracts` Item schema · BuildingAsset 模板字段 · 放置 worldBindings · KindRegistry 桩 |

---

## 13. 修订记录

| 日期 | 说明 |
|---|---|
| 2026-10-28 | 初稿：物品目录 + 分种类硬内容 + M-item-*；与 Coder / 策划对齐结论入库 |
| 2026-10-28 | **M-item-1** 工作区落地（contracts + API + 物品目录页）；未 commit/push |
| 2026-10-28 | 增补 §1.3 / **§6 可复用性·可扩展性·世界绑定**：Catalog 只放形状与偏好；真价/target/任务旗等在世界放置实例化；修订 §3–§4 与 TS 示意；章节顺延 |
| 2026-10-28 | **M-item-2** 工作区落地：BuildingAsset `shop`/`supply`、校验（未知 itemId error）、建筑库检查器货架/配方表单；未 commit/push；放置绑定 UI 与 M-item-3/4 未做 |
| 2026-10-28 | **M-item-4** 工作区落地：`propose-item`/`accept`、shelf/loot propose（仅已有 itemId；未知挂起）、建筑库检查器 AI 条；未 commit/push；放置真价 UI / 完整 runtime 未做 |
| 2026-10-28 | **M-item-3** 工作区落地：`quest.slots` / `encounter.loot`+trigger/pack 占位、Boss 无击败旗必填、校验与建筑库检查器表单；未 commit/push；M-item-4 / 放置真价 UI / 完整任务·战斗 runtime 未做 |
