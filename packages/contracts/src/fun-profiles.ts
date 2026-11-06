import { z } from 'zod';

/** Catalog-only design goals. The simulator resolves these into ordinary PassCheck rows. */
export const funTagSchema = z.enum([
  'pressure-release', 'growth', 'warmth', 'healing-routine', 'grinding', 'collection', 'mystery',
]);
export type FunTag = z.infer<typeof funTagSchema>;

export const FUN_PROFILE_STRATEGY_IDS = ['random', 'greedy-growth', 'greedy-money', 'modao', 'merchant', 'lazy'] as const;
export const OPENING_ROLL_STRATEGY_IDS = ['rollRandom', 'rollWorst', 'rollBest'] as const;
export const funProfileStrategySchema = z.enum([...FUN_PROFILE_STRATEGY_IDS, ...OPENING_ROLL_STRATEGY_IDS]);
export type FunProfileStrategy = z.infer<typeof funProfileStrategySchema>;

export const catalogEntryIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);

/** 自定义策略复用经过审计的内置选择器，只维护目录身份与说明，不生成新的运行时代码。 */
export const simulationStrategySchema = z.object({
  id: catalogEntryIdSchema,
  version: z.number().int().positive(),
  label: z.string().min(1).max(80),
  description: z.string().min(1).max(1000),
  baseStrategy: funProfileStrategySchema,
});
export type SimulationStrategy = z.infer<typeof simulationStrategySchema>;

const STRATEGY_COPY: Record<(typeof FUN_PROFILE_STRATEGY_IDS)[number], {label: string; description: string}> = {
  random: {label: '随机', description: '在当前可执行选项中均匀随机选择，用于基线覆盖。'},
  'greedy-growth': {label: '成长优先', description: '优先选择单位时间成长收益更高的选项，保留少量探索。'},
  'greedy-money': {label: '金钱优先', description: '优先选择单位时间金钱收益更高的选项，保留少量探索。'},
  modao: {label: '压力资源优先', description: '优先提高世界推断出的压力或魔道资源。'},
  merchant: {label: '跑商', description: '沿结局门槛反向链接目标卡牌，同时积累金钱并控制风险。'},
  lazy: {label: '原地行动', description: '尽量不移动，优先原地成长，没有成长选项时等待。'},
};
export const SIMULATION_STRATEGIES: readonly SimulationStrategy[] = [
  ...FUN_PROFILE_STRATEGY_IDS.map(id =>
    simulationStrategySchema.parse({id, version: 1, ...STRATEGY_COPY[id], baseStrategy: id})),
  ...OPENING_ROLL_STRATEGY_IDS.map((baseStrategy, index) => simulationStrategySchema.parse({
    id: ['roll-random', 'roll-worst', 'roll-best'][index]!, version: 1,
    label: ['随机开局', '最低开局', '最高开局'][index],
    description: '仅在启用 K16 openingRoll 的世界中运行；选择器仍由模拟运行时托管。',
    baseStrategy,
  })),
];

export const FUN_METRIC_IDS = [
  'G1', 'G2', 'G4', 'G6', 'G8', 'opening-roll-worst', 'opening-roll-best',
  'pressure-bidirectional', 'growth-monotonic', 'collection-reachable', 'failure-free-ending-rate',
] as const;
export const funMetricIdSchema = z.enum(FUN_METRIC_IDS);
export type FunMetricId = z.infer<typeof funMetricIdSchema>;

/** Missing or false entries are not judged. At least one metric must be active. */
export const funMetricMatrixSchema = z.partialRecord(funMetricIdSchema, z.boolean())
  .refine(matrix => Object.values(matrix).some(enabled => enabled === true), 'at least one metric must be enabled');
export type FunMetricMatrix = z.infer<typeof funMetricMatrixSchema>;

export const funPacingLineSchema = z.object({
  decisions: z.number().int().positive(),
  uniqueChars: z.number().int().nonnegative(),
});
export type FunPacingLine = z.infer<typeof funPacingLineSchema>;

const rate = z.number().finite().min(0).max(1);
export const funProfileThresholdsSchema = z.object({
  /** G2: a strategy must reach each ending at least this often. */
  minEndingRate: rate.default(0.05),
  /** G2: no single ending may dominate random play above this rate. */
  maxRandomEndingRate: rate.default(0.6),
  /** Random runs ending at a non-failure authored ending. */
  minFailureFreeEndingRate: rate.default(0),
  /** Ordinary endings reached by either generic or goal-directed play. */
  minCollectionCompletionRate: rate.default(1),
});
export type FunProfileThresholds = z.infer<typeof funProfileThresholdsSchema>;

export const funProfileSchema = z.object({
  id: catalogEntryIdSchema,
  version: z.number().int().positive(),
  label: z.string().min(1).max(80).optional(),
  description: z.string().min(1).max(1000).optional(),
  funTags: z.array(funTagSchema).max(16),
  suggestedBlocks: z.array(catalogEntryIdSchema).max(32),
  pacingLine: funPacingLineSchema,
  strategies: z.array(z.union([catalogEntryIdSchema, z.enum(OPENING_ROLL_STRATEGY_IDS)])).min(1)
    .refine(ids => new Set(ids).size === ids.length, '模拟策略 id 不得重复'),
  thresholds: funProfileThresholdsSchema,
  metricMatrix: funMetricMatrixSchema,
});
export type FunProfile = z.infer<typeof funProfileSchema>;

const ALL_STRATEGIES = [...FUN_PROFILE_STRATEGY_IDS, ...OPENING_ROLL_STRATEGY_IDS];
const DEFAULT_THRESHOLDS = {
  minEndingRate: 0.05,
  maxRandomEndingRate: 0.6,
  minFailureFreeEndingRate: 0,
  minCollectionCompletionRate: 1,
};

const RAW_PROFILES: z.input<typeof funProfileSchema>[] = [
  {
    id: 'default', version: 1, label: '通用基线', description: '沿用通用 G1–G8 指标与全部内置模拟策略。', funTags: [],
    suggestedBlocks: ['clock', 'storylet-pool', 'endings-recap', 'preflight-sim'],
    pacingLine: {decisions: 60, uniqueChars: 10000}, strategies: ALL_STRATEGIES,
    thresholds: DEFAULT_THRESHOLDS,
    metricMatrix: {G1: true, G2: true, G4: true, G6: true, G8: true},
  },
  {
    id: 'pressure', version: 1, label: '压力释放', description: '检查压力资源是否能双向变化，同时保留通用可达性指标。', funTags: ['pressure-release', 'warmth'],
    suggestedBlocks: ['clock', 'storylet-pool', 'stat-templates', 'preflight-sim'],
    pacingLine: {decisions: 60, uniqueChars: 10000}, strategies: ALL_STRATEGIES,
    thresholds: DEFAULT_THRESHOLDS,
    metricMatrix: {G1: true, G4: true, G6: true, G8: true, 'pressure-bidirectional': true},
  },
  {
    id: 'healing', version: 1, label: '治愈日常', description: '采用较短节奏线，并验收随机游玩的零失败结局率。', funTags: ['healing-routine', 'warmth', 'collection'],
    suggestedBlocks: [
      'clock', 'storylet-pool', 'stat-templates', 'endings-recap',
      'shop-cycle', 'customer-flow', 'ledger', 'item-catalog', 'building-library', 'preflight-sim',
    ],
    pacingLine: {decisions: 15, uniqueChars: 1000}, strategies: ALL_STRATEGIES,
    thresholds: {...DEFAULT_THRESHOLDS, minFailureFreeEndingRate: 0.8},
    metricMatrix: {G1: true, G4: true, G8: true, 'failure-free-ending-rate': true},
  },
  {
    id: 'grinding', version: 1, label: '刷怪成长', description: '关注成长资源的单调增长、卡池与重复游玩覆盖。', funTags: ['growth', 'grinding', 'collection'],
    suggestedBlocks: [
      'stat-templates', 'encounters', 'item-catalog', 'storylet-pool',
      'growth-curve', 'loot-table', 'combat-stake', 'building-library', 'preflight-sim',
    ],
    pacingLine: {decisions: 30, uniqueChars: 3000},
    strategies: ['random', 'greedy-growth', 'greedy-money', 'modao', 'lazy'],
    thresholds: DEFAULT_THRESHOLDS,
    metricMatrix: {G4: true, G8: true, 'growth-monotonic': true},
  },
  {
    id: 'collection', version: 1, label: '结局收集', description: '强调普通结局的收集可达性与路线覆盖。', funTags: ['collection', 'warmth'],
    suggestedBlocks: ['stat-templates', 'item-catalog', 'storylet-pool', 'endings-recap'],
    pacingLine: {decisions: 30, uniqueChars: 3000}, strategies: ALL_STRATEGIES,
    thresholds: DEFAULT_THRESHOLDS,
    metricMatrix: {G4: true, G8: true, 'collection-reachable': true},
  },
];

/** Shipped profiles are validated at module load so catalog drift fails fast. */
export const FUN_PROFILES: readonly FunProfile[] = RAW_PROFILES.map(profile => funProfileSchema.parse(profile));

export function getFunProfile(id: string | undefined | null): FunProfile | undefined {
  return FUN_PROFILES.find(profile => profile.id === id);
}

/** Read-only catalog projection for `list_fun_profiles`. */
export function getFunProfileCatalog(): readonly FunProfile[] {
  return FUN_PROFILES;
}

export const DEFAULT_FUN_PROFILE = getFunProfile('default')!;
export const PRESSURE_FUN_PROFILE = getFunProfile('pressure')!;
export const HEALING_FUN_PROFILE = getFunProfile('healing')!;
export const GRINDING_FUN_PROFILE = getFunProfile('grinding')!;
export const COLLECTION_FUN_PROFILE = getFunProfile('collection')!;
