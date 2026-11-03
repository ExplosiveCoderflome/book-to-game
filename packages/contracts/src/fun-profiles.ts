import { z } from 'zod';

/** Catalog-only design goals. The simulator resolves these into ordinary PassCheck rows. */
export const funTagSchema = z.enum([
  'pressure-release', 'growth', 'warmth', 'healing-routine', 'grinding', 'collection', 'mystery',
]);
export type FunTag = z.infer<typeof funTagSchema>;

export const FUN_PROFILE_STRATEGY_IDS = ['random', 'greedy-growth', 'greedy-money', 'modao', 'merchant', 'lazy'] as const;
export const funProfileStrategySchema = z.enum(FUN_PROFILE_STRATEGY_IDS);
export type FunProfileStrategy = z.infer<typeof funProfileStrategySchema>;

export const FUN_METRIC_IDS = [
  'G1', 'G2', 'G4', 'G6', 'G8',
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
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  version: z.number().int().positive(),
  funTags: z.array(funTagSchema).max(16),
  suggestedBlocks: z.array(z.string().min(1).max(80)).max(32),
  pacingLine: funPacingLineSchema,
  strategies: z.array(funProfileStrategySchema).min(1)
    .refine(ids => new Set(ids).size === ids.length, 'duplicate strategy id'),
  thresholds: funProfileThresholdsSchema,
  metricMatrix: funMetricMatrixSchema,
});
export type FunProfile = z.infer<typeof funProfileSchema>;

const ALL_STRATEGIES = [...FUN_PROFILE_STRATEGY_IDS];
const DEFAULT_THRESHOLDS = {
  minEndingRate: 0.05,
  maxRandomEndingRate: 0.6,
  minFailureFreeEndingRate: 0,
  minCollectionCompletionRate: 1,
};

const RAW_PROFILES: z.input<typeof funProfileSchema>[] = [
  {
    id: 'default', version: 1, funTags: [],
    suggestedBlocks: ['clock', 'storylet-pool', 'endings-recap', 'preflight-sim'],
    pacingLine: {decisions: 60, uniqueChars: 10000}, strategies: ALL_STRATEGIES,
    thresholds: DEFAULT_THRESHOLDS,
    metricMatrix: {G1: true, G2: true, G4: true, G6: true, G8: true},
  },
  {
    id: 'pressure', version: 1, funTags: ['pressure-release', 'warmth'],
    suggestedBlocks: ['clock', 'storylet-pool', 'stat-templates', 'preflight-sim'],
    pacingLine: {decisions: 60, uniqueChars: 10000}, strategies: ALL_STRATEGIES,
    thresholds: DEFAULT_THRESHOLDS,
    metricMatrix: {G1: true, G4: true, G6: true, G8: true, 'pressure-bidirectional': true},
  },
  {
    id: 'healing', version: 1, funTags: ['healing-routine', 'warmth', 'collection'],
    suggestedBlocks: [
      'clock', 'storylet-pool', 'stat-templates', 'endings-recap',
      'shop-cycle', 'customer-flow', 'ledger', 'item-catalog', 'building-library', 'preflight-sim',
    ],
    pacingLine: {decisions: 15, uniqueChars: 1000}, strategies: ALL_STRATEGIES,
    thresholds: {...DEFAULT_THRESHOLDS, minFailureFreeEndingRate: 0.8},
    metricMatrix: {G1: true, G4: true, G8: true, 'failure-free-ending-rate': true},
  },
  {
    id: 'grinding', version: 1, funTags: ['growth', 'grinding', 'collection'],
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
    id: 'collection', version: 1, funTags: ['collection', 'warmth'],
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
