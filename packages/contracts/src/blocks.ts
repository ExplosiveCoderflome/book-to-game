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
 */

const blockId = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);

/** Closed set of Substrate contract fragments a block may `require`. */
export const SUBSTRATE_CONTRACTS = [
  'game.variables',
  'world.locations', 'world.map', 'world.clock', 'world.storylets', 'world.endings',
  'world.resourceDefs', 'world.facts', 'world.npcs', 'world.actions',
  'building.library', 'item.catalog',
] as const;
export const substrateContractSchema = z.enum(SUBSTRATE_CONTRACTS);
export type SubstrateContract = z.infer<typeof substrateContractSchema>;

/** Closed set of WorldContent fragments a block may `provide` on compile-down. */
export const BLOCK_PROVIDES = [
  'variables', 'resource-defs', 'locations', 'map.fill', 'building-library',
  'item-catalog', 'storylets', 'endings', 'recap', 'clock', 'encounters', 'preflight-sim',
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
    provides: ['variables'], acceptance: ['G1', 'G2'],
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
    provides: ['locations', 'map.fill'], acceptance: ['G1', 'G6'],
  },
  {
    id: 'building-library', version: 1,
    label: '建筑库', blurb: '可复用建筑资产（商店/补给/任务/遭遇/Boss），放置到地图已绑定地点，本地覆盖不写回库。',
    funTags: ['collection'], requires: ['world.locations'],
    composesWith: {dependsOn: ['world-map'], conflictsWith: []},
    params: [{key: 'shelf_rows', label: '货架行来源', type: 'array', description: '引用物品库货架。', default: []}],
    provides: ['building-library', 'map.fill'], acceptance: ['G4'],
  },
  {
    id: 'item-catalog', version: 1,
    label: '物品库', blurb: '跨世界可复用物品资产；价格/掉落是软提示，货币绑定走 world.resourceDefs。',
    funTags: ['collection'], requires: [],
    composesWith: {dependsOn: ['building-library'], conflictsWith: []},
    params: [{key: 'default_price_hint', label: '默认价格提示', type: 'number', default: 0}],
    provides: ['item-catalog'], acceptance: ['G4'],
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
    provides: ['storylets'], acceptance: ['G4'],
  },
  {
    id: 'endings-recap', version: 1,
    label: '结局与回顾', blurb: '结局、条件结局正文与「这一生」回顾；运行时成熟，passages/recap 需作者补全。',
    funTags: ['warmth', 'pressure-release'], requires: ['world.endings'],
    composesWith: {dependsOn: ['storylet-pool'], conflictsWith: []},
    params: [],
    provides: ['endings', 'recap'], acceptance: ['G2', 'G6', 'G8'],
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
    provides: ['clock'], acceptance: ['G6'],
  },
  {
    id: 'encounters', version: 1,
    label: '遭遇', blurb: '遭遇桩：engage 旗 + 确定性掉落；无战斗运行时，掉落概率带由参数约束。',
    funTags: ['grinding', 'pressure-release'], requires: ['world.facts'],
    composesWith: {dependsOn: ['building-library'], conflictsWith: []},
    params: [{key: 'drop_rate_band', label: '掉落概率带', type: 'array', description: '确定性掉落概率带。', default: [0.1, 0.9]}],
    provides: ['encounters'], acceptance: ['growth-monotonic'],
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
    provides: ['preflight-sim'], acceptance: ['G1', 'G2', 'G4', 'G6', 'G8'],
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
  ruleId: 'blocks.duplicate-id' | 'blocks.unknown-require' | 'blocks.unknown-composes' | 'blocks.duplicate-provides';
  message: string;
}

/**
 * Registry-level lint. Validates cross-block consistency:
 *  - unique ids (+ duplicate id implies a broken version bump),
 *  - every `requires` target is a known substrate contract (already guaranteed by schema),
 *  - every `composesWith.dependsOn` / `conflictsWith` id resolves to a registered block,
 *  - no duplicate `provides` within a single block.
 */
export function lintBlocks(): BlockLintIssue[] {
  const issues: BlockLintIssue[] = [];
  const byId = new Map<string, BlockSpec>();
  for (const block of BLOCKS) {
    if (byId.has(block.id)) {
      issues.push({severity: 'error', blockId: block.id, ruleId: 'blocks.duplicate-id',
        message: `duplicate block id: ${block.id}`});
    }
    byId.set(block.id, block);
  }
  for (const block of BLOCKS) {
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
  }
  return issues;
}

/** Read-only catalog projection for `list_blocks`: funTags / requires / params / composesWith. */
export function getBlockCatalog(): BlockSpec[] {
  return [...BLOCKS];
}