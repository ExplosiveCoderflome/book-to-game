import { z } from 'zod';
import { funTagSchema, funMetricIdSchema } from './fun-profiles.js';

/**
 * V0b BlockSpec registry.
 *
 * A BlockSpec is validated Catalog data (same layer as stat-templates.ts / fun-profiles.ts).
 * It describes one reusable "积木" of the engine and how it compiles down to Substrate:
 *
 * - `requires`: Substrate fragments the block depends on when it compiles (e.g. clock needs `world.clock`).
 * - `composesWith`: which blocks this one depends on / is mutually exclusive with.
 * - `params`: tunable parameters with defaults (e.g. clock `limitMonths`, pool `handSize`).
 * - `provides`: which WorldContent fragments it emits when compiled — never a parallel state machine.
 * - `acceptance`: references into the FunProfile metric matrix (§3).
 * - `shelves`: 积木商店的浏览分区（可多选）。货架只影响作者浏览，不改变 requires/provides 拼装约束。
 */

const blockId = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);

/**
 * 积木商店货架：面向作者的浏览分区。
 *
 * 货架不是玩法绑定，也不会生成本品类配方；同一块积木可以挂在多条货架上（例如
 * item-catalog 同时服务世界内容、经营与打怪成长）。真正的拼装约束仍是
 * `requires` / `composesWith.dependsOn` / `conflictsWith`。
 */
const BLOCK_SHELF_IDS = ['foundation', 'world-content', 'commerce', 'combat-growth', 'ops', 'ai-live'] as const;
export const blockShelfIdSchema = z.enum(BLOCK_SHELF_IDS);
export type BlockShelfId = z.infer<typeof blockShelfIdSchema>;

export interface BlockShelf {
  id: BlockShelfId;
  label: string;
  blurb?: string;
  /** Sort order for the shop UI; smaller comes first. */
  order: number;
}

export const BLOCK_SHELVES: readonly BlockShelf[] = [
  {id: 'foundation', label: '基础底座', blurb: '数值、地图、时钟与验收等可复用的底座积木。', order: 10},
  {id: 'world-content', label: '世界内容', blurb: '建筑、物品、剧情卡池与结局回顾等世界内容资产。', order: 20},
  {id: 'commerce', label: '经营向', blurb: '营业日、客流与账本等经营骨架；仍编译到同一 WorldContent。', order: 30},
  {id: 'combat-growth', label: '打怪成长向', blurb: '遭遇、成长曲线、掉落与胜负代价等成长骨架。', order: 40},
  {id: 'ops', label: '验收/运维', blurb: '体检、模拟与验收口径，帮助作者检查非退化。', order: 50},
  {id: 'ai-live', label: '临场 AI', blurb: '玩时可选 AI 文案层：旁白、NPC 气泡与按配方展开的万能槽位；只写回文案，不改存档状态，默认关。', order: 60},
];

/** Closed set of Substrate contract fragments a block may `require`. */
export const SUBSTRATE_CONTRACTS = [
  'game.variables',
  'world.locations', 'world.map', 'world.clock', 'world.storylets', 'world.endings', 'world.endConditions',
  'world.resourceDefs', 'world.facts', 'world.npcs', 'world.actions',
  'building.library', 'item.catalog',
] as const;
export const substrateContractSchema = z.enum(SUBSTRATE_CONTRACTS);
export type SubstrateContract = z.infer<typeof substrateContractSchema>;

/**
 * Closed set of WorldContent fragments a block may `provide` on compile-down.
 *
 * `actions` / `facts` were added for compile-down stubs (e.g. `combat-stake`) that express
 * encounter stakes as ordinary WorldContent actions and facts instead of a parallel combat
 * state machine. The substrate already models both, only the provide vocabulary was missing.
 *
 * `ai-overlay` is the临场 AI 覆盖层: ephemeral play-time text (narration / NPC bubble /
 * suggestion) produced by the shared play-ai helper. It is not WorldContent and never
 * persists into a revision or save; it exists so AI blocks can declare what they emit
 * without pretending to add a parallel state machine.
 */
export const BLOCK_PROVIDES = [
  'variables', 'resource-defs', 'locations', 'map.fill', 'building-library',
  'item-catalog', 'storylets', 'endings', 'recap', 'clock', 'encounters', 'preflight-sim',
  'actions', 'facts', 'ai-overlay',
] as const;
export const blockProvideSchema = z.enum(BLOCK_PROVIDES);
export type BlockProvide = z.infer<typeof blockProvideSchema>;

export const blockParamSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  type: z.enum(['number', 'integer', 'string', 'boolean', 'array', 'select']),
  /** Default value when the author does not override. Kept loose; typed params are validated superRefine-side. */
  default: z.union([z.string().max(500), z.number().finite(), z.boolean(), z.array(z.union([z.string().max(80), z.number().finite()]))]).optional(),
  /** Required for `select`: allowed values (first is default when no explicit default). */
  options: z.array(z.string().min(1).max(80)).optional(),
});
export type BlockParam = z.infer<typeof blockParamSchema>;

export const blockComposesWithSchema = z.object({
  /** Blocks this one needs to be meaningful (references must resolve). */
  dependsOn: z.array(blockId).max(32),
  /** Blocks this one is mutually exclusive with (references must resolve). */
  conflictsWith: z.array(blockId).max(32),
});
export type BlockComposesWith = z.infer<typeof blockComposesWithSchema>;

export const blockSpecSchema = z.object({
  id: blockId,
  /** Bump on breaking changes; never silently rename (same discipline as statTemplateSchema). */
  version: z.number().int().positive(),
  label: z.string().min(1).max(80),
  blurb: z.string().min(1).max(400),
  /** Experience tags this block provides (closed set started in fun-profiles). */
  funTags: z.array(funTagSchema).max(16),
  /** Substrate fragments this block depends on when compiling down. */
  requires: z.array(substrateContractSchema).max(32),
  composesWith: blockComposesWithSchema,
  params: z.array(blockParamSchema).max(32),
  /** WorldContent fragments this block emits on compile-down. */
  provides: z.array(blockProvideSchema).min(1).max(16),
  /** Acceptance metric references into the FunProfile metric matrix (§3). */
  acceptance: z.array(funMetricIdSchema).max(16),
  /** 积木商店货架归属（浏览分区，可多选）；至少一条，不绑死玩法。 */
  shelves: z.array(blockShelfIdSchema).min(1).max(BLOCK_SHELF_IDS.length),
}).superRefine((block, ctx) => {
  const names = new Set<string>();
  for (const [index, param] of block.params.entries()) {
    if (names.has(param.key)) ctx.addIssue({code: 'custom', message: `duplicate param key: ${param.key}`, path: ['params', index, 'key']});
    names.add(param.key);
    if (param.type === 'select' && !param.options?.length) {
      ctx.addIssue({code: 'custom', message: `select param ${param.key} requires options`, path: ['params', index, 'options']});
    }
    if (param.type === 'integer' && param.default !== undefined && !Number.isInteger(param.default)) {
      ctx.addIssue({code: 'custom', message: `integer param ${param.key} requires integer default`, path: ['params', index, 'default']});
    }
  }
  for (const dep of block.composesWith.dependsOn) {
    if (dep === block.id) ctx.addIssue({code: 'custom', message: `block cannot depend on itself: ${dep}`, path: ['composesWith', 'dependsOn']});
  }
  for (const conflict of block.composesWith.conflictsWith) {
    if (conflict === block.id) ctx.addIssue({code: 'custom', message: `block cannot conflict with itself: ${conflict}`, path: ['composesWith', 'conflictsWith']});
  }
});
export type BlockSpec = z.infer<typeof blockSpecSchema>;

const RAW_BLOCKS = [
  {
    id: 'stat-templates', version: 1,
    label: '数值体系模板', blurb: '资源/关系/旗标/进度/压力五类角色词汇，编译为 GameContent.variables 的命名与初值骨架。',
    funTags: ['growth', 'pressure-release'], requires: ['game.variables'],
    composesWith: {dependsOn: [], conflictsWith: []},
    params: [{key: 'stat_template_id', label: '模板', type: 'select', description: '题材化数值骨架。',
      options: ['xianxia_pressure', 'mystery_deduction', 'trade_venture', 'relationship_drama']}],
    provides: ['variables'], acceptance: ['G1', 'G2'], shelves: ['foundation'],
  },
  {
    id: 'world-map', version: 1,
    label: '世界与地图', blurb: '地点拓扑与六边形地图层；编辑/校验成熟，compile-down 为 locations 与 map.fill。',
    funTags: ['mystery'], requires: ['world.locations'],
    composesWith: {dependsOn: [], conflictsWith: []},
    params: [
      {key: 'geometry', label: '几何', type: 'select', options: ['hex']},
      {key: 'size_preset', label: '尺寸档', type: 'select', options: ['small', 'medium', 'large']},
    ],
    provides: ['locations', 'map.fill'], acceptance: ['G1', 'G6'], shelves: ['foundation', 'world-content'],
  },
  {
    id: 'building-library', version: 1,
    label: '建筑库', blurb: '积木商店货架：可复用建筑资产（商店/补给/任务/遭遇/Boss），放置到地图已绑定地点，本地覆盖不写回库。',
    funTags: ['collection'], requires: ['world.locations'],
    composesWith: {dependsOn: ['world-map'], conflictsWith: []},
    params: [{key: 'shelf_rows', label: '货架行来源', type: 'array', description: '引用物品库货架。', default: []}],
    provides: ['building-library', 'map.fill'], acceptance: ['G4'], shelves: ['world-content'],
  },
  {
    id: 'item-catalog', version: 1,
    label: '物品库', blurb: '跨世界可复用物品资产；价格/掉落是软提示，货币绑定走 world.resourceDefs。',
    funTags: ['collection'], requires: [],
    composesWith: {dependsOn: ['building-library'], conflictsWith: []},
    params: [{key: 'default_price_hint', label: '默认价格提示', type: 'number', default: 0}],
    provides: ['item-catalog'], acceptance: ['G4'], shelves: ['world-content', 'commerce', 'combat-growth'],
  },
  {
    id: 'storylet-pool', version: 1,
    label: '剧情卡池', blurb: '手牌抽取 + 出现条件 + 状态化文案；引擎成熟，S4 支持按状态正文。',
    funTags: ['mystery', 'pressure-release', 'healing-routine'], requires: ['world.storylets'],
    composesWith: {dependsOn: [], conflictsWith: []},
    params: [
      {key: 'hand_size', label: '手牌数', type: 'integer', default: 3},
      {key: 'refresh_on', label: '刷新时机', type: 'array', options: ['move', 'clock'], default: ['move']},
    ],
    provides: ['storylets'], acceptance: ['G4'], shelves: ['world-content'],
  },
  {
    id: 'endings-recap', version: 1,
    label: '结局与回顾', blurb: '结局、条件结局正文与「这一生」回顾；运行时成熟，passages/recap 需作者补全。',
    funTags: ['warmth', 'pressure-release'], requires: ['world.endings'],
    composesWith: {dependsOn: ['storylet-pool'], conflictsWith: []},
    params: [],
    provides: ['endings', 'recap'], acceptance: ['G2', 'G6', 'G8'], shelves: ['world-content'],
  },
  {
    id: 'end-conditions', version: 1,
    label: '终局条件', blurb: '一整局的胜负判定骨架：赢/输条件各自绑定到一个结局，用现有 WorldCondition 谓词判定变量与事实，命中后触发对应终局。积木只给判定槽位与运行时路径，具体胜负谓词由 Agent 从内容提议、作者挑选或自定义后按局填入；改条件会重塑整局。',
    funTags: ['pressure-release', 'growth', 'healing-routine'], requires: ['world.endConditions', 'world.endings'],
    composesWith: {dependsOn: ['endings-recap', 'stat-templates'], conflictsWith: []},
    params: [
      {key: 'win_slots', label: '胜利条件槽位', type: 'array', description: '结构化胜利条件描述（label + WorldCondition 列表 + 目标结局）；默认至少 1 条，按局填写。', default: []},
      {key: 'lose_slots', label: '失败条件槽位', type: 'array', description: '结构化失败条件描述（label + WorldCondition 列表 + 目标失败结局）；默认至少 1 条，按局填写。', default: []},
      {key: 'condition_grammar', label: '条件语法', type: 'select', options: ['world-condition', 'free-text-parsed'], default: 'world-condition',
        description: 'world-condition = 直接写 WorldCondition；free-text-parsed = 作者自然语言经 Agent 解析为同一结构。'},
      {key: 'min_win', label: '最少胜利条件', type: 'integer', default: 1},
      {key: 'min_lose', label: '最少失败条件', type: 'integer', default: 1},
      {key: 'severity_on_edit', label: '编辑严重度提示', type: 'select', options: ['strong-warning'], default: 'strong-warning',
        description: '固定为强提示：改动胜负条件会重塑整局体验。'},
    ],
    provides: ['endings'], acceptance: ['G2', 'G8', 'pressure-bidirectional'], shelves: ['foundation', 'world-content'],
  },
  {
    id: 'clock', version: 1,
    label: '时钟', blurb: '推进时间与期限；unit 放开为日/周/月/年，治愈经营的「一天营业」可表达。',
    funTags: ['pressure-release', 'healing-routine'], requires: ['world.clock'],
    // §2.1 互斥：启用 clock（limitMonths）即取代无时钟的 timeLimit 期限；`timeLimit` 是 WorldContent 字段而非积木，
    // 故此处不用 conflictsWith 表达（lintBlocks 要求 conflictsWith 解析到已注册积木），改以注释说明。
    composesWith: {dependsOn: [], conflictsWith: []},
    params: [
      {key: 'unit', label: '时间单位', type: 'select', options: ['day', 'week', 'month', 'year'], default: 'month'},
      {key: 'limit', label: '期限刻度', type: 'integer', default: 24},
      {key: 'countdown_resource', label: '倒计时资源', type: 'string', description: '可选资源倒计时。'},
    ],
    provides: ['clock'], acceptance: ['G6'], shelves: ['foundation'],
  },
  {
    id: 'encounters', version: 1,
    label: '遭遇', blurb: '遭遇桩：engage 旗 + 确定性掉落；无战斗运行时，掉落概率带由参数约束。',
    funTags: ['grinding', 'pressure-release'], requires: ['world.facts'],
    composesWith: {dependsOn: ['building-library'], conflictsWith: []},
    params: [{key: 'drop_rate_band', label: '掉落概率带', type: 'array', description: '确定性掉落概率带。', default: [0.1, 0.9]}],
    provides: ['encounters'], acceptance: ['growth-monotonic'], shelves: ['combat-growth'],
  },
  {
    id: 'shop-cycle', version: 1,
    label: '营业日循环', blurb: '积木商店货架上的经营骨架：进货 → 定价 → 营业日推进，编译为时钟 + 剧情卡（每日事件卡）与资源增减；日结/排队/客流仍是作者用行动与卡池补的，本积木不自建营业引擎。',
    funTags: ['healing-routine', 'collection', 'warmth'], requires: ['world.clock', 'world.storylets', 'item.catalog', 'game.variables'],
    composesWith: {dependsOn: ['clock', 'item-catalog', 'stat-templates'], conflictsWith: []},
    params: [
      {key: 'day_unit', label: '营业日单位', type: 'select', options: ['day', 'week', 'month'], default: 'day'},
      {key: 'restock_cost_hint', label: '进货成本提示', type: 'number', description: '单次进货的建议成本，编译为资源减量提示，不强制结算。', default: 1},
      {key: 'open_days', label: '一个周期营业天数', type: 'integer', default: 6},
    ],
    provides: ['clock', 'storylets'], acceptance: ['G1', 'G6', 'failure-free-ending-rate'], shelves: ['commerce'],
  },
  {
    id: 'customer-flow', version: 1,
    label: '客人需求流', blurb: '积木商店的客流侧：客人带着需求来、按满意度留下人情与回头客。编译为事实旗标 + 剧情卡 + 关系资源，满意度只做软提示；真正的排队/翻台规则由作者在行动里写。',
    funTags: ['warmth', 'collection', 'healing-routine'], requires: ['world.npcs', 'world.facts', 'world.storylets', 'world.resourceDefs'],
    composesWith: {dependsOn: ['shop-cycle', 'stat-templates'], conflictsWith: []},
    params: [
      {key: 'customer_pool_size', label: '常客规模', type: 'integer', default: 8},
      {key: 'satisfaction_metric', label: '满意度资源', type: 'string', description: '绑定到 resourceDefs 的关系/声望资源名。', default: 'reputation'},
      {key: 'return_visit_flag', label: '回头客事实键', type: 'string', description: '事实层记录回头客，不另建状态机。', default: 'returning_guest'},
    ],
    provides: ['storylets', 'facts'], acceptance: ['G4', 'G8', 'collection-reachable'], shelves: ['commerce'],
  },
  {
    id: 'ledger', version: 1,
    label: '账本流水', blurb: '积木商店的账本：把进货、售价与库存变动写成资源增减与账目卡，方便作者核对收支。只提供流水提示与货币绑定参数，不做自动日结或财务报表。',
    funTags: ['collection', 'pressure-release'], requires: ['item.catalog', 'game.variables', 'world.storylets'],
    composesWith: {dependsOn: ['item-catalog', 'stat-templates'], conflictsWith: []},
    params: [
      {key: 'money_resource', label: '货币资源', type: 'string', description: '绑定 world.resourceDefs 中的货币键。', default: 'coin'},
      {key: 'opening_balance', label: '开账余额', type: 'number', default: 10},
      {key: 'ledger_granularity', label: '流水粒度', type: 'select', options: ['per_day', 'per_transaction'], default: 'per_day'},
    ],
    provides: ['variables', 'storylets'], acceptance: ['G4', 'collection-reachable'], shelves: ['commerce'],
  },
  {
    id: 'growth-curve', version: 1,
    label: '成长曲线', blurb: '等级/经验/属性成长骨架：编译为 GameContent.variables 的进度与资源命名，配经验曲线预设供作者填数值。本积木只给骨架与验收口径，不自动结算升级。',
    funTags: ['growth', 'grinding'], requires: ['game.variables'],
    composesWith: {dependsOn: ['stat-templates'], conflictsWith: []},
    params: [
      {key: 'xp_curve', label: '经验曲线', type: 'select', options: ['linear', 'quadratic', 'milestone'], default: 'quadratic'},
      {key: 'level_cap', label: '等级上限', type: 'integer', default: 20},
      {key: 'xp_resource', label: '经验资源', type: 'string', default: 'xp'},
      {key: 'attribute_keys', label: '属性键', type: 'array', description: '从属属性名，绑定 variables。', default: []},
    ],
    provides: ['variables'], acceptance: ['growth-monotonic', 'G4'], shelves: ['combat-growth'],
  },
  {
    id: 'loot-table', version: 1,
    label: '掉落表', blurb: '积木商店的战斗掉落约定：把物品库条目按掉落概率带绑定到遭遇，收紧掉落分档。只产出表与事实提示，实际发放仍走现有遭遇/行动效果。',
    funTags: ['collection', 'grinding'], requires: ['item.catalog', 'world.facts'],
    composesWith: {dependsOn: ['encounters', 'item-catalog'], conflictsWith: []},
    params: [
      {key: 'drop_bands', label: '掉落分档', type: 'select', options: ['common_rare', 'tiered'], default: 'tiered'},
      {key: 'guaranteed_drop', label: '必掉保底', type: 'boolean', default: false},
      {key: 'drop_rate_band', label: '掉落概率带', type: 'array', description: '与 encounters 的概率带保持一致。', default: [0.1, 0.9]},
    ],
    provides: ['item-catalog', 'facts'], acceptance: ['collection-reachable', 'growth-monotonic'], shelves: ['combat-growth'],
  },
  {
    id: 'combat-stake', version: 1,
    label: '遭遇代价', blurb: '桩：把遭遇的胜负代价编译为事实旗标 + 资源增减的行动/剧情卡，仍无独立战斗引擎与回合结算。作者或 AI 负责写具体行动文案与数值，本积木只约定代价口径。',
    funTags: ['pressure-release', 'grinding'], requires: ['world.facts', 'world.actions', 'game.variables'],
    composesWith: {dependsOn: ['encounters', 'stat-templates'], conflictsWith: []},
    params: [
      {key: 'win_fact', label: '胜利事实键', type: 'string', default: 'won_encounter'},
      {key: 'lose_fact', label: '失败事实键', type: 'string', default: 'lost_encounter'},
      {key: 'hp_resource', label: '生命/损耗资源', type: 'string', default: 'hp'},
      {key: 'defeat_penalty', label: '失败代价提示', type: 'number', description: '失败时的建议资源减量，编译进行动效果提示。', default: 1},
    ],
    provides: ['facts', 'actions'], acceptance: ['G8', 'pressure-bidirectional'], shelves: ['combat-growth'],
  },
  {
    id: 'ai-narration', version: 1,
    label: 'AI 临场旁白', blurb: '积木商店的玩时旁白层：包装现有 narrate_session / narrate_adventure，由共享 play-ai 助手统一调用、限额与 soft-fail。默认关；只写旁白文案，不改图、不改变量/事实、不发明选项。',
    funTags: ['warmth', 'mystery'], requires: [],
    composesWith: {dependsOn: [], conflictsWith: []},
    params: [
      {key: 'enabled_default', label: '默认开启', type: 'boolean', description: '玩时旁白默认关闭，由客户端开关决定。', default: false},
      {key: 'max_calls_per_session', label: '每存档调用上限', type: 'integer', description: '内存计数，非持久；重启后重置。', default: 20},
      {key: 'max_chars', label: '旁白字数上限', type: 'integer', default: 800},
      {key: 'model_profile', label: '模型档位', type: 'string', description: '复用模型设置/玩时 provider 的档位名，留空即用默认。', default: 'play'},
    ],
    provides: ['ai-overlay'], acceptance: [], shelves: ['ai-live', 'world-content'],
  },
  {
    id: 'ai-npc-dialog', version: 1,
    label: 'AI NPC 临场对话', blurb: '积木商店的 NPC 气泡层：在玩家点选已有 NPC 时生成 1–2 句临场台词。开放冒险已接线（POST /api/adventures/:id/npc-dialog）；故事模式旁白已通、NPC 对话留待下一刀。运行时仅用当前地点已公开的 NPC 与世界书，写回对话气泡；不新增行动、不改事实/变量，失败 soft-fail。',
    funTags: ['warmth'], requires: ['world.npcs', 'world.facts'],
    composesWith: {dependsOn: [], conflictsWith: []},
    params: [
      {key: 'enabled_default', label: '默认开启', type: 'boolean', default: false},
      {key: 'target_npc_hint', label: '默认对话对象提示', type: 'string', description: '作者提示，运行时仍以当前可见 NPC 为准。'},
      {key: 'max_turns_hint', label: '连续对话轮数提示', type: 'integer', description: '软提示，不构成新对话状态机。', default: 3},
      {key: 'max_calls_per_session', label: '每存档调用上限', type: 'integer', default: 12},
      {key: 'max_chars', label: '台词字数上限', type: 'integer', default: 400},
      {key: 'model_profile', label: '模型档位', type: 'string', default: 'play'},
    ],
    provides: ['ai-overlay'], acceptance: [], shelves: ['ai-live', 'world-content'],
  },
  {
    id: 'ai-slot-template', version: 1,
    label: '万能 AI 积木模板', blurb: '按品类配方展开的声明式 AI 槽位模板：选择触发时机、上下文包与写回表面（旁白/建议/对话），再由配方决定实际积木。本阶段只做 catalog + lint，不执行 codegen；不绑死某一本小说，也不新增平行引擎。',
    funTags: [], requires: [],
    composesWith: {dependsOn: [], conflictsWith: []},
    params: [
      {key: 'trigger', label: '触发时机', type: 'select', options: ['after-act', 'on-enter', 'on-demand'], default: 'on-demand'},
      {key: 'context_pack', label: '上下文包', type: 'select', options: ['scene', 'worldbook', 'facts', 'npc', 'storylets'], default: 'scene'},
      {key: 'writeback', label: '写回表面', type: 'select', options: ['narration', 'suggestion', 'dialog'], default: 'narration'},
      {key: 'recipe_hint', label: '配方提示', type: 'string', description: '可选：指示该槽位随哪条品类配方展开。'},
      {key: 'max_calls_per_session', label: '每存档调用上限', type: 'integer', default: 20},
      {key: 'max_chars', label: '文案字数上限', type: 'integer', default: 600},
      {key: 'model_profile', label: '模型档位', type: 'string', default: 'play'},
    ],
    provides: ['ai-overlay'], acceptance: [], shelves: ['ai-live'],
  },
  {
    id: 'preflight-sim', version: 1,
    label: '体检与模拟策略', blurb: '确定性 lint/sim 验收；pacingLine 与策略集合按画像解析，是「非退化」硬承诺的执行者。',
    funTags: [], requires: [],
    composesWith: {dependsOn: [], conflictsWith: []},
    params: [
      {key: 'pacing_decisions', label: '节奏·决策数', type: 'integer', default: 60},
      {key: 'pacing_chars', label: '节奏·不重复字数', type: 'integer', default: 10000},
    ],
    provides: ['preflight-sim'], acceptance: ['G1', 'G2', 'G4', 'G6', 'G8'], shelves: ['foundation', 'ops'],
  },
] as const;

/** Shipped blocks — validated at module load so catalog drift fails fast. */
export const BLOCKS: readonly BlockSpec[] = RAW_BLOCKS.map(block => blockSpecSchema.parse(block));

export function getBlock(id: string | undefined | null): BlockSpec | undefined {
  if (!id) return undefined;
  return BLOCKS.find(block => block.id === id);
}

export interface BlockLintIssue {
  severity: 'error' | 'warning';
  blockId?: string;
  shelfId?: BlockShelfId;
  ruleId: 'blocks.duplicate-id' | 'blocks.unknown-require' | 'blocks.unknown-composes' | 'blocks.duplicate-provides'
    | 'blocks.unknown-shelf' | 'blocks.empty-shelf' | 'blocks.duplicate-shelf'
    | 'blocks.ai-overlay-without-shelf' | 'blocks.ai-shelf-writes-world';
  message: string;
}

/**
 * Registry-level lint. Validates cross-block consistency:
 *  - unique ids (+ duplicate id implies a broken version bump),
 *  - every `requires` target is a known substrate contract (already guaranteed by schema),
 *  - every `composesWith.dependsOn` / `conflictsWith` id resolves to a registered block,
 *  - no duplicate `provides` within a single block,
 *  - every `shelves` entry resolves to a known shop shelf and is not repeated,
 *  - AI blocks stay overlay-only: `ai-overlay` providers must sit on the `ai-live` shelf, and
 *    `ai-live` blocks may not also claim world-content provides (AI only writes ephemeral text),
 *  - warn when a declared shelf has no blocks (an empty shelf is legal but suspicious).
 */
export function lintBlocks(blocks: readonly BlockSpec[] = BLOCKS): BlockLintIssue[] {
  const issues: BlockLintIssue[] = [];
  const byId = new Map<string, BlockSpec>();
  const shelfIds = new Set<BlockShelfId>(BLOCK_SHELVES.map(shelf => shelf.id));
  const usedShelves = new Set<BlockShelfId>();
  for (const block of blocks) {
    if (byId.has(block.id)) {
      issues.push({severity: 'error', blockId: block.id, ruleId: 'blocks.duplicate-id',
        message: `duplicate block id: ${block.id}`});
    }
    byId.set(block.id, block);
  }
  for (const block of blocks) {
    for (const require of block.requires) {
      if (!SUBSTRATE_CONTRACTS.includes(require)) {
        issues.push({severity: 'error', blockId: block.id, ruleId: 'blocks.unknown-require',
          message: `unknown substrate contract: ${require}`});
      }
    }
    for (const dep of block.composesWith.dependsOn) {
      if (!byId.has(dep)) {
        issues.push({severity: 'error', blockId: block.id, ruleId: 'blocks.unknown-composes',
          message: `composesWith.dependsOn references unknown block: ${dep}`});
      }
    }
    for (const conflict of block.composesWith.conflictsWith) {
      if (!byId.has(conflict)) {
        issues.push({severity: 'error', blockId: block.id, ruleId: 'blocks.unknown-composes',
          message: `composesWith.conflictsWith references unknown block: ${conflict}`});
      }
    }
    const provides = new Set(block.provides);
    if (provides.size !== block.provides.length) {
      issues.push({severity: 'warning', blockId: block.id, ruleId: 'blocks.duplicate-provides',
        message: `block ${block.id} lists duplicate provides`});
    }
    const isAiBlock = block.shelves.includes('ai-live');
    if (provides.has('ai-overlay') && !isAiBlock) {
      issues.push({severity: 'error', blockId: block.id, ruleId: 'blocks.ai-overlay-without-shelf',
        message: `block ${block.id} provides ai-overlay but is not on the ai-live shelf`});
    }
    if (isAiBlock && [...provides].some(provide => provide !== 'ai-overlay')) {
      issues.push({severity: 'error', blockId: block.id, ruleId: 'blocks.ai-shelf-writes-world',
        message: `block ${block.id} is on ai-live but provides WorldContent; AI blocks may only emit ai-overlay`});
    }
    const shelves = new Set<BlockShelfId>();
    for (const shelf of block.shelves) {
      if (!shelfIds.has(shelf)) {
        issues.push({severity: 'error', blockId: block.id, shelfId: shelf, ruleId: 'blocks.unknown-shelf',
          message: `unknown shop shelf: ${shelf}`});
        continue;
      }
      usedShelves.add(shelf);
      if (shelves.has(shelf)) {
        issues.push({severity: 'warning', blockId: block.id, shelfId: shelf, ruleId: 'blocks.duplicate-shelf',
          message: `block ${block.id} lists duplicate shelf: ${shelf}`});
      }
      shelves.add(shelf);
    }
  }
  for (const shelf of BLOCK_SHELVES) {
    if (!usedShelves.has(shelf.id)) {
      issues.push({severity: 'warning', shelfId: shelf.id, ruleId: 'blocks.empty-shelf',
        message: `shop shelf ${shelf.id} has no blocks`});
    }
  }
  return issues;
}

/** Shelf metadata for shop browsing, ordered by `order`. Catalog blocks carry their `shelves`. */
export function getBlockShelves(): BlockShelf[] {
  return [...BLOCK_SHELVES].sort((a, b) => a.order - b.order);
}

/** Read-only catalog projection for `list_blocks`: id / label / blurb / funTags / requires / params / provides / composesWith / shelves. */
export function getBlockCatalog(): BlockSpec[] {
  return [...BLOCKS];
}
