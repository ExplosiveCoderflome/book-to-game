# 引擎愿景规划：AI 驱动的文字游戏开发引擎

> 输入：`/workspace/dsh-runs/agent-survey.md`（Agent 与可复用模块现状梳理，覆盖 `ccc563c..2f2e43c`）、`docs/next-work-2026-10-29.md`、`docs/progress-2026-10-28.md`、`docs/architecture.md`、`docs/extensibility.md`。本文只做规划，不替代任何既有切片验收标准。

## 1. 目标与非目标

**目标**

1. **两层 AI 驱动**：制作端由 agent 先判定作品的爽感来源，再从可复用积木库挑选、组合、配置出游戏；运行时产出的游戏本身可由 AI 驱动（即兴叙事、NPC 对话、按状态生成事件），但被规则与数值严格约束。
2. **用「积木 + 爽感画像」取代单一流水线**，避免 ProductionPlan 一条管线导致所有作品模板化。
3. **守住现有纪律**（`extensibility.md` §2/§8）：状态真相在 Substrate；题材与提示在 Catalog；智能在 Adapter；编辑器只编辑与展示；传输只转发命令。积木与画像全部是 Catalog 层数据，编译下行到 Substrate。
4. **不退化的硬承诺**：确定性模拟验收、离线单文件 HTML / Windows exe、存档重放一致性、发布 revision 不可变。

**非目标**

- 不做题材分支运行时（`if (genre === 'xianxia')` 是 `extensibility.md` §4 明令禁止的反模式）。
- 不让 LLM 直接写状态；提交只经 sessions / adventures / games 端口。
- 不合并 story 与 open 双运行时（刻意分模块，`extensibility.md` §5）。
- 本计划不含完整战斗 / 经济运行时；encounter 仍按现有桩范围（`docs/p2-encounter-playable-slice.md` 非目标）演进。
- 不改已发布 revision；不动 `docs/samples/shoudeng/*`。

## 2. 积木（Block）规范：统一接口与现有模块映射

### 2.1 统一接口

积木属于 Catalog 层，一个 BlockSpec 是可校验的数据（放入 `packages/contracts/src/blocks.ts`，与 `stat-templates.ts` 同级的编目形状）：

| 字段 | 说明 |
|---|---|
| `id` / `version` | 破坏性变更 bump version，禁止静默改名（同 `statTemplateSchema` 纪律） |
| `funTags` | 该积木**提供的体验标签**：`pressure-release`（压力解除）、`growth`（积累成长）、`warmth`（人情温度）、`healing-routine`（日常经营治愈）、`grinding`（升级刷怪）、`collection`（收集）、`mystery` 等，闭集起步 |
| `requires` | **所需数据契约**：该积木编译下行所依赖的 Substrate 片段（如时钟积木要求 `world.clock`；建筑积木要求 `locations[]` 存在） |
| `composesWith` | **可组合关系**：依赖哪些积木（剧情卡池→结局与回顾）、与哪些互斥（按月时钟 vs 无时钟 timeLimit 期限） |
| `params` | **参数 + 默认值**：如时钟的 `limitMonths`、卡池的 `handSize/refreshOn`、遭遇的掉落概率带 |
| `provides` | 编译产物：WorldContent 的哪个片段（locations / actions / storylets / endings / clock / map.fill …），**compile-down，禁止自建并行状态机** |
| `acceptance` | **验收指标引用**：指向 §3 画像指标矩阵的条目，按画像解析成具体阈值 |

### 2.2 现有模块逐个映射

| 现有模块 | 契约位置 | 积木化成熟度 | 主要题材写死点（待解耦） |
|---|---|---|---|
| 数值体系模板 | `packages/contracts/src/stat-templates.ts` | 中：role 词汇（resource/relationship/flag/progress/pressure）跨题材，已 compile-down | `statTemplateIdSchema` 闭集写死 4 个 id 且含 `xianxia_pressure`（stat-templates.ts:133）；**open 模式不消费**——`runner.ts:62-80` 走 `generateWorld`，`statTemplateId` 只在 story 分支（runner.ts:99）生效，开放世界只剩 `resourceDefs`，无模板目录 |
| 世界与地图 | `packages/contracts/src/world-map.ts`、`map-templates.ts` | 中高：编辑/校验成熟 | `map-templates.ts:64` 的 `fantasy_xianxia` 只是数据，但作为默认模板把新世界带偏；几何仅 hex；agent 只能读（`read_world_draft`），写只能整稿 |
| 建筑库 | `packages/contracts/src/building-library.ts` | 中高：Catalog 与世界实例已分离 | `kind` 闭集 shop/supply/quest/encounter/boss 是 RPG 词汇；放置/真价绑定无 agent 工具（M-fill-3/4/5 未实现） |
| 物品库 | `packages/contracts/src/item-catalog.ts` | 中高：价格/掉落是软提示 | `ITEM_CATEGORIES` 闭集；货币绑定靠 `resourceDefs`，尚无「经济画像」参数 |
| 剧情卡池 | `packages/contracts/src/world.ts`（storyletSchema/textCases） | 高：引擎成熟，S4 已支持按状态文案 | 生成管线不写 `textCases`（prompt 明确「先不要加」） |
| 结局与回顾 | world.ts（endings/recap/EndingSnapshot） | 中：运行时成熟 | `production-prompts.ts:13` 明确「本阶段不要添加地点/结局 textVariants、passages 或 recap」——全靠作者手补 |
| 时钟 | world.ts:98 `clockSchema` | 中 | **`unit: z.literal('month')` 写死月单位**，无日/周/年；治愈经营的「一天营业」表达不了 |
| 遭遇 | world.ts（start_encounter）、`packages/rules/src/fill-actions.ts` | 低：仅桩（engage 旗 + 确定性掉落） | `boss` 标签 RPG 语义；无战斗运行时 |
| 体检与模拟策略 | `packages/play-runtime/src/sim/*`、`packages/rules/src/preflight/*` | 高：agent 直连最好 | `simulate.ts:250-251` 的 `PACING_LINE={60,10000}` 与 `STRATEGY_IDS` 写死；`simulate.ts:164-175` 默认策略偏好 `lingshi/xiuwei/xinmo` 资源名，标签「魔道优先/跑商/只修炼」偏仙侠样例 |
| ProductionPlan | `packages/contracts/src/production.ts` | 高：端到端、审批清晰 | `production-prompts.ts:10/14` 提示词含「修仙/日常客栈」示例并禁止产 map/passages/recap；体量档仅 S/M；是「单一管线模板化」的直接来源 |

**通用展示层耦合**：`packages/rules/src/resource-labels.ts:7-10` 的 `COMMON` 默认 `qi:'修为'` 等，非仙侠世界若不显式覆盖 `resourceDefs` 就显示修仙词。**以上全部是默认值/闭集/提示词偏置，代码中没有题材分支（`extensibility.md` §6 已扫描确认）**，解耦方向是「抽成可配置 profile」，不是改运行时。

## 3. 爽感画像（Fun Profile）与设计目标契约

FunProfile 是 Catalog 数据（新契约 `packages/contracts/src/fun-profiles.ts`）：`{ id, version, funTags[], suggestedBlocks[], pacingLine{decisions,uniqueChars}, strategies[], thresholds, metricMatrix }`。画像决定**验收指标的形状与阈值**，替代把通用 G1–G10 一刀切给所有作品。

| 画像 | 底线（全画像保留） | 画像专属指标（替代通用 G1/G2） |
|---|---|---|
| 压力型经营（武林外传式） | G4 卡池、G8 无死路 | 保留 G1 时长 60/10000 与 G6 时限结局可达；压力资源有升有降（`resourceBands` 双向）；routeCoverage 保留 |
| 治愈型经营（深夜食堂式） | G4、G8 | **不看失败结局占比**；pacing 下调（如 ≥30 决策即可）；新增：温度节拍（每 N 个回合 ≥1 个温暖事件卡）、重复卡变体充足（复用 `pool.few-variants` lint）、死路 0、压力结局占比 ≤ 阈值或可一键关闭 |
| 升级刷怪 | G4、G8 | **看成长曲线**：主资源中位数逐段单调上升（新增曲线检查，输入现有 `medians/resourceBands`）、遭遇与掉落多样性、early-ending 检查保留（`pacing.early-ending`） |
| 收集 / 人情温度 | G4、G8 | 收集完整度可达（复用 goal-strategy 反推）、关系资源有明确上下文节拍 |

实现方式：`simulateWorld` 的 opts 增加 `profile`（默认值等于现状，向后兼容）；G 检查从 `metricMatrix` 解析生成，`PACING_LINE`、`STRATEGY_IDS` 变成 profile 字段；`PlaytestReport` 附 `profileId`。**现有 G1–G10 等价于 default profile，全部既有验收不动**。

## 4. 制作 Agent 流程：画像 → 积木 → 配置 → 生成 → 体检 → 修复 → 审批

| 步骤 | 落点（现有） | 需新增 |
|---|---|---|
| 1. 判定爽感画像 | `read_source` / `read_world_draft`（自动） | `propose_fun_profile`：模型按原文摘要提议画像（含理由），**确认后**才落草稿元数据 |
| 2. 选积木 | `list_world_drafts` 等 | `list_blocks`（只读，含 funTags/requires/参数）；agent 按画像推荐组合，人审 |
| 3. 配置积木 | —（现状只能整稿 `update_world_draft`，对话不开放） | **块级提议**：`propose_storylet_patch` / `propose_map_fill` / `propose_clock_patch` 等，统一返回可审 diff；确认后走现有整稿更新事务（不动 WorldContent 单体契约，先拿 diff 绕开） |
| 4. 生成 | `create_production_job` → `check_job_plan` → `approve_saved_production_plan`（确认） | productionUnits 扩展（§6 V3） |
| 5. 体检/模拟 | `lint_world_draft` / `playtest_world_draft` / `get_world_preflight`（自动） | 指标按 profile 解析 |
| 6. 修复建议 | `create_agent_repair`（自动）→ 候选 → `apply_agent_repair`（确认，40 种子前后复验） | 候选类型扩展需谨慎，保持 `compareRepair` 红线（新增 lint error / 检查退步即拒绝） |
| 7. 作者审批 | chat 确认卡 + `guard` 二次校验 + 发布服务端门禁（lint error 阻断、mock 来源拦截） | 无 |

**与现有监督/审批/修复工作区的衔接**：沿用 `modules/agent/application/supervisor.ts`（失败分流、规划机制检查、逐单元质检）、`chat-service.ts` 的 pending/confirm/guard/uncertain 机制、`repair-service.ts` 的候选-复验-确认链。新增工具必须补命令元数据（`risk: read|write|paid`、`confirmation`、`guard`），让聊天白名单、HTTP、MCP 从同一元数据生成行为，而不是继续在 `agent-chat-tools.ts` 的 Set + `workbench.ts` 的 if/else 里加第 4 处硬编码。注意 MCP 直连无确认卡（token 即权限），保持现状并在 `docs/mcp.md` 标注。

## 5. 运行时 AI：边界、接入方式与推荐

**规则锁死（AI 不可触碰）**：图拓扑与状态提交、资源结算、结局判定（`resolveEnding`）、时钟推进、掉落确定性（`fill-actions.ts` 的字符串哈希）、手牌抽取（存档内 seeded RNG）、`propose-act` 只能映射到当前可见/世界书过滤后的边。这些保证确定性模拟验收、离线包与存档重放成立。

**可临场生成（软层）**：旁白文风、NPC 对话文案、事件皮肤、结局回顾润色——soft-fail、可关、**输出永不入存档**（存档只存确定性产物，读档重放才一致）。现有 L1 narrate / L2 propose-act / 天道修正已是这个形状（`modules/sessions|adventure-sessions/application/narrate.ts`、`propose-act.ts`）。

| 接入方式 | 离线 HTML/exe | 存档重放 | 备注 |
|---|---|---|---|
| A. 玩家自带 key（BYOK） | HTML 可输入 key；exe 预编译壳不可更新，**不可行** | 需记录模型版本否则不可复现；AI 产物不入存档则可 | 密钥安全、提示注入风险归玩家 |
| B. 在线服务（作者托管） | 离线包完全无 AI | 同上 | 需要 API 服务、计量、计费、鉴权，成本高 |
| C. **确定性底 + AI 润色层（推荐）** | 离线包默认 `ai.mode:'none'`，完整可玩 | AI 只装饰文字不入存档，重放天然一致 | 引擎零改动；在线版可开润色 |

**推荐 C**：`packages/play-runtime` 保持零 AI、零网络；导出 manifest 的 `ai.mode` 从 `'none'` 增加 `'polish'`（默认仍 `'none'`，离线包继续 stub 掉 AI 组件，见 `vite.player.config.ts` 现状）。BYOK 作为后续实验项，需用户拍板（§7）。

## 6. 分阶段路线图（小切片，先做不付费的解耦）

| 切片 | 内容 | 改动范围 | 验收 | 付费调用 | 状态（2026-11-03） |
|---|---|---|---|---|---|
| **V0a 题材解耦** | resource-labels 默认表、sim 默认策略名/标签、`PACING_LINE`、`STRATEGY_IDS` 抽成可传入 profile（默认值=现状）；时钟 unit 放开为 day/week/month/year（schemaVersion 迁移） | `resource-labels.ts`、`simulate.ts`、`world.ts:98`、双运行时包装、迁移文档 | 现有 verify + m1b 导出回归零退化；新增非仙侠合成夹具全绿；旧世界行为不变 | 无 | **部分 / 待拍板**：题材解耦与默认值回退已落地（`apps/server/test/v0a-theme-decoupling.test.ts`、`fixtures/v0a/diner.world.json`）；`clock.unit` 已放开 day/week/month/year（`packages/contracts/src/world.ts`），但无 `schemaVersion` 迁移（`WorldContent` 仍 literal 1），时钟单位正式放开口径待 §7 拍板 |
| **V0b BlockSpec 注册表** | §2.1 契约 + 9 模块注册 + lint（requires/composesWith 校验） | contracts 新文件、catalog | 注册完整可 lint；`list_blocks` 只读命令 | 无 | **已落地** `1afb457`（9 积木注册 + `list_blocks`）；FunProfile `suggestedBlocks` 对齐真实积木见 `5f0bf47`。缺口：无 |
| **V0c FunProfile 契约 + 画像化验收** | §3 契约 + `simulateWorld({profile})` + 指标矩阵 + 两个新合成夹具（治愈经营、刷怪成长） | `fun-profiles.ts`、sim、preflight 面板文案 | 治愈夹具不被 60 步卡住、刷怪夹具曲线单调；default profile 下 G1–G10 逐条不变 | 无 | **已完成**：`packages/contracts/src/fun-profiles.ts`、`simulateWorld({profile})`（`packages/play-runtime/src/sim/simulate.ts`）、`fixtures/v0c/{healing,grinding}.world.json`、`apps/server/test/v0c-fun-profile-acceptance.test.ts` |
| **V1 块级 agent 提议 + 命令元数据** | `propose_*_patch` diff 工具（mock 模型）+ `Command` 元数据（risk/confirmation/guard） | commands、`agent-chat-tools.ts`、workbench | 每个新工具一处注册即得确认卡/guard；16k 回执不被整稿 JSON 撑爆 | 无（mock） | **已落地** `bcdb949`（confirmation/risk 元数据）、`b793731`（`propose_clock_patch` / `propose_storylet_patch`）、`faeb14c`（`apply_world_patch`）。缺口：提议仍为 mock 模型 |
| **V2 制作 agent 画像流程** | `propose_fun_profile` + 选积木推荐 + 按 profile 体检解读 | prompts、chat 工具 | 真实小说夹具端到端（mock 模型下先过行为测试） | 需（chat 模型） | **部分（thin）** `9039d99`（`propose_fun_profile` mock + `recommend_blocks_for_profile`）。缺口：画像确认落库、真实 chat 模型、按 profile 体检解读文案 |
| **V3 生成管线后置装配** | productionUnits 扩展 map/fill/passages/recap；`production-prompts.ts:13/14` 限制解除（按画像启用） | production prompts、runner | 守灯人/武林夹具：生成后不再需要手工补 recap；S/M 档提示不再含题材偏置示例 | 需（生成模型） | **未做** |
| **V4 运行时润色层在线化** | `ai.mode:'polish'`；在线版 narrate/NPC 对话按状态生成 | manifest、导出、播放器（仅在线路径） | 离线包字节级回归不变；存档重放一致（AI 产物不入存档）；开关默认关 | 按需 | **未做** |

V0a 的未完成部分（时钟 `schemaVersion` 迁移与放开口径）仍排在 `next-work-2026-10-29.md` 未完成项之前（S6 等策划、S7 等用户 Windows 机、S10 等产品决策，V0a 无外部依赖）；S1–S5 已完成的路线覆盖/引导/节奏/规划检查直接被画像化指标复用。V0b / V0c / V1 / V2 thin 已不依赖 V0a 收口先落地。

> 2026-11-02/03 通宵切片：V0b、V0c 的 FunProfile/`simulateWorld({profile})`、V1 的 confirmation/risk + propose/apply、V2 thin 已按上表落地；提交仅在本地 `feat/novel-game-foundation`，未 push。V0a 的题材解耦与时钟单位放开已有代码/测试，但 schemaVersion 迁移与放开口径仍待拍板。

**三个示范题材样例**（各自成为 V0c/V3 的验收载体）：

1. **压力型经营（武林外传）**：画像=pressure-release+warmth；积木=按月时钟+卡池+结局回顾+建筑(客栈 venueType)+资源压力线；验收=G1 60/10000、G6 时限结局、压力资源双向。已有真实测试（`docs/wulin-waizhuan-real-test-2026-10-29.md`）作为基线；主要缺口=结局前置靠手修（S5 已缓解）与重复场景叙事（S4 已缓解）。
2. **治愈型经营（深夜食堂式）**：画像=healing-routine+warmth+collection；积木=**日单位时钟**（依赖 V0a）+高变体重复卡+人情资源+弱失败结局+回顾；验收=温度节拍、变体充足、不看失败占比。缺口=时钟日单位、温度节拍指标、 ProductionPlan 档位（S/M 不适配小品）。
3. **升级刷怪**：画像=growth+grinding+collection；积木=成长资源模板（open 模式需先接 resourceDefs 模板化，runner.ts:62 的缺口）+遭遇（需从桩增强：敌我数值与回合收束，属产品决策）+掉落多样性+结局带 boss 前置；验收=成长曲线单调、遭遇多样性、early-ending。

## 7. 风险与需用户拍板的决策点

**需用户拍板（只列真正需要决定的）**

1. **治愈画像的验收口径**：是否允许零失败结局、压力结局是否必须可一键关闭（影响 G 检查矩阵与发布门禁）。
2. **时钟单位放开是 breaking 变更**（`clockSchema` 的 `schemaVersion` bump）：选 V0a 一起做，还是等旧世界消化完再上。
3. **statTemplateId 闭集放开方式**：改注册表式编目会动 `statTemplateIdSchema` 与 import 校验，需确认放开范围。
4. **离线包 AI 政策**：推荐永久 `ai.mode:'none'` + exe 永不带 AI；BYOK 是否值得作为实验项。
5. **encounter 从桩到完整战斗的优先级**（升级刷怪样例的成败依赖此项）。
6. **在线润色服务的托管与计费**（V4 之后，谁出 key、谁付费）。

**风险**

- `WorldContent` 单体契约（`packages/contracts/src/world.ts`，357 行 schemaVersion:1）限制块级独立演进：V1 用 diff 提议绕开，长期需要块级版本策略（存量 SQLite 整稿 JSON 同样受影响）。
- chat 工具面 4 处硬编码（Set + if/else + presenter + tests）：V1 不做命令元数据则每加一个块级工具成本递增。
- 聊天把作者视图（世界书秘密、NPC 私有目标）发给模型；redact 只替换已知 API key；提示注入无分类器——块级写工具上线前需按 risk 元数据收紧。
- 成本计量缺失（无 token/费用统计）：V2 起每片真实调用前必须先落预算与逐请求账单（对应 next-work S10 的既定决策点）。
- 16k 回执 / 8k 输入上限：块级工具设计必须以 diff 为单位，禁止整稿往返。
