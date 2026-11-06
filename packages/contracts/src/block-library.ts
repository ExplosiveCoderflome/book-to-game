import { z } from 'zod';
import { blockSpecSchema, getBlockShelves, type BlockShelf, type BlockSpec } from './blocks.js';
import {
  catalogEntryIdSchema, funProfileSchema, simulationStrategySchema,
  type FunProfile, type SimulationStrategy,
} from './fun-profiles.js';
import { statTemplateSchema, type StatTemplate } from './stat-templates.js';

/** 四类可维护目录共用一个 SQLite 存储与版本纪律；kind 是持久化稳定标识。 */
export const CATALOG_KINDS = ['block', 'fun-profile', 'stat-template', 'simulation-strategy'] as const;
export const catalogKindSchema = z.enum(CATALOG_KINDS);
export type CatalogKind = z.infer<typeof catalogKindSchema>;

export interface CatalogDataMap {
  block: BlockSpec;
  'fun-profile': FunProfile;
  'stat-template': StatTemplate;
  'simulation-strategy': SimulationStrategy;
}

export interface CatalogEntry<K extends CatalogKind = CatalogKind> {
  kind: K;
  id: string;
  version: number;
  origin: 'builtin' | 'custom';
  data: CatalogDataMap[K];
  /** 自定义覆盖同 id 内置条目时保留其内置版本，便于审计与恢复。 */
  builtInVersion?: number;
  updatedAt?: string;
}

export interface CatalogLintIssue {
  severity: 'error' | 'warning';
  ruleId: string;
  message: string;
  kind?: CatalogKind;
  id?: string;
}

export interface BlockLibraryView {
  blocks: CatalogEntry<'block'>[];
  funProfiles: CatalogEntry<'fun-profile'>[];
  statTemplates: CatalogEntry<'stat-template'>[];
  simulationStrategies: CatalogEntry<'simulation-strategy'>[];
  shelves: BlockShelf[];
  issues: CatalogLintIssue[];
}

export function emptyBlockLibraryView(): BlockLibraryView {
  return {
    blocks: [], funProfiles: [], statTemplates: [], simulationStrategies: [],
    shelves: getBlockShelves(), issues: [],
  };
}

const upsertShape = {id: catalogEntryIdSchema, expectedVersion: z.number().int().nonnegative()};
const idMatches = (id: string, data: {id: string}) => id === data.id;
const idMessage = {message: '路径 id 与内容 id 必须一致，禁止静默改名', path: ['data', 'id']};

export const upsertBlockOverrideInputSchema = z.object({...upsertShape, data: blockSpecSchema})
  .refine(input => idMatches(input.id, input.data), idMessage);
export const upsertFunProfileOverrideInputSchema = z.object({...upsertShape, data: funProfileSchema})
  .refine(input => idMatches(input.id, input.data), idMessage);
export const upsertStatTemplateOverrideInputSchema = z.object({...upsertShape, data: statTemplateSchema})
  .refine(input => idMatches(input.id, input.data), idMessage);
export const upsertSimulationStrategyOverrideInputSchema = z.object({...upsertShape, data: simulationStrategySchema})
  .refine(input => idMatches(input.id, input.data), idMessage);
export const deleteCatalogEntryInputSchema = z.object(upsertShape);

export type UpsertBlockOverrideInput = z.infer<typeof upsertBlockOverrideInputSchema>;
export type UpsertFunProfileOverrideInput = z.infer<typeof upsertFunProfileOverrideInputSchema>;
export type UpsertStatTemplateOverrideInput = z.infer<typeof upsertStatTemplateOverrideInputSchema>;
export type UpsertSimulationStrategyOverrideInput = z.infer<typeof upsertSimulationStrategyOverrideInputSchema>;
export type DeleteCatalogEntryInput = z.infer<typeof deleteCatalogEntryInputSchema>;

export const CATALOG_KIND_LABELS: Record<CatalogKind, string> = {
  block: '积木',
  'fun-profile': '爽感画像',
  'stat-template': '数值模板',
  'simulation-strategy': '模拟策略',
};
