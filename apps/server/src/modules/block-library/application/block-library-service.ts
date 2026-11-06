import {
  BLOCKS, FUN_PROFILES, GENRE_RECIPES, SIMULATION_STRATEGIES, STAT_TEMPLATES,
  blockSpecSchema, funProfileSchema, simulationStrategySchema, statTemplateSchema,
  type BlockLibraryView, type CatalogDataMap, type CatalogEntry, type CatalogKind,
} from '@novel-game/contracts';
import type { ZodType } from 'zod';
import { AppError } from '../../../shared/errors.js';
import { getBlockShelves } from '@novel-game/contracts';
import { lintCatalog, parseCatalogData, type CatalogSnapshot } from './catalog-lint.js';
import type { BlockCatalogRepository, CatalogReferenceSource, StoredCatalogOverride } from './ports.js';

const EMPTY_REFERENCES: CatalogReferenceSource = {
  listStories: () => [], listWorlds: () => [], listGenerationJobs: () => [],
};

export class BlockLibraryService {
  constructor(
    private readonly repository: BlockCatalogRepository,
    private readonly references: CatalogReferenceSource = EMPTY_REFERENCES,
  ) {}

  list<K extends CatalogKind>(kind: K): CatalogEntry<K>[] {
    const overrides = this.repository.list().filter((row): row is StoredCatalogOverride<K> => row.kind === kind);
    return mergeEntries(kind, builtIns(kind), overrides);
  }

  get<K extends CatalogKind>(kind: K, id: string): CatalogEntry<K> {
    const entry = this.list(kind).find(candidate => candidate.id === id);
    if (!entry) throw new AppError('CATALOG_NOT_FOUND', `目录条目不存在：${kind}/${id}`, 404, {kind, id});
    return entry;
  }

  getVersion(kind: CatalogKind, id: string): number {
    return this.list(kind).find(entry => entry.id === id)?.version ?? 0;
  }

  effective<K extends CatalogKind>(kind: K): CatalogDataMap[K][] {
    return this.list(kind).map(entry => entry.data);
  }

  block(id: string) { return this.effective('block').find(item => item.id === id); }
  funProfile(id: string) { return this.effective('fun-profile').find(item => item.id === id); }
  statTemplate(id: string) { return this.effective('stat-template').find(item => item.id === id); }
  simulationStrategy(id: string) { return this.effective('simulation-strategy').find(item => item.id === id); }

  view(): BlockLibraryView {
    return {
      blocks: this.list('block'), funProfiles: this.list('fun-profile'),
      statTemplates: this.list('stat-template'), simulationStrategies: this.list('simulation-strategy'),
      shelves: getBlockShelves(), issues: lintCatalog(this.snapshot()),
    };
  }

  upsert<K extends CatalogKind>(kind: K, input: {id: string; expectedVersion: number; data: unknown}): CatalogEntry<K> {
    const data = parseCatalogData(schemaFor(kind), input.data);
    if (data.id !== input.id) {
      throw new AppError('CATALOG_ID_IMMUTABLE', '路径 id 与内容 id 必须一致，禁止静默改名', 422, {kind, id: input.id});
    }
    const custom = this.repository.get(kind, input.id);
    const builtIn = builtIns(kind).find(item => item.id === input.id);
    const currentVersion = custom?.data.version ?? builtIn?.version ?? 0;
    if (input.expectedVersion !== currentVersion) {
      throw new AppError('CATALOG_CONFLICT', `目录条目已更新，请重新载入后再保存（当前版本 ${currentVersion}）`, 409, {
        kind, id: input.id, expectedVersion: input.expectedVersion, currentVersion,
      });
    }
    if (data.version < currentVersion) {
      throw new AppError('CATALOG_VERSION_INVALID', `version 不能从 ${currentVersion} 降为 ${data.version}`, 422);
    }
    const baseline = custom?.data ?? builtIn;
    if (baseline && isBreakingChange(kind, baseline, data) && data.version <= baseline.version) {
      throw new AppError('CATALOG_VERSION_BUMP_REQUIRED', `这次修改会改变结构或运行语义，请把 version 从 ${baseline.version} 递增后再保存`, 422, {
        kind, id: input.id, currentVersion: baseline.version,
      });
    }
    const candidate = this.snapshot();
    const index = candidate[kind].findIndex(item => item.id === input.id);
    if (index >= 0) candidate[kind][index] = data;
    else candidate[kind].push(data);
    const errors = lintCatalog(candidate).filter(item => item.severity === 'error');
    if (errors.length) {
      throw new AppError('CATALOG_LINT_FAILED', errors.map(item => item.message).join('；'), 422, {issues: errors});
    }
    this.repository.save(kind, data, custom?.data.version ?? null);
    return this.get(kind, input.id);
  }

  delete(kind: CatalogKind, input: {id: string; expectedVersion: number}): BlockLibraryView {
    const custom = this.repository.get(kind, input.id);
    if (!custom) {
      if (builtIns(kind).some(item => item.id === input.id)) {
        throw new AppError('CATALOG_BUILTIN_READONLY', '内置条目只读，不能直接删除；可复制为自定义条目后维护', 409, {kind, id: input.id});
      }
      throw new AppError('CATALOG_NOT_FOUND', `自定义目录条目不存在：${kind}/${input.id}`, 404);
    }
    if (custom.data.version !== input.expectedVersion) {
      throw new AppError('CATALOG_CONFLICT', `目录条目已更新，请重新载入后再删除（当前版本 ${custom.data.version}）`, 409);
    }
    const referencedBy = this.referencedBy(kind, input.id);
    if (referencedBy.length) {
      throw new AppError('CATALOG_REFERENCED', `条目仍被引用，不能删除：${referencedBy.join('；')}`, 409, {kind, id: input.id, referencedBy});
    }
    this.repository.delete(kind, input.id, input.expectedVersion);
    return this.view();
  }

  private snapshot(): CatalogSnapshot {
    return {
      block: this.effective('block'), 'fun-profile': this.effective('fun-profile'),
      'stat-template': this.effective('stat-template'), 'simulation-strategy': this.effective('simulation-strategy'),
    };
  }

  private referencedBy(kind: CatalogKind, id: string): string[] {
    const snapshot = this.snapshot();
    const refs: string[] = [];
    if (kind === 'block') {
      for (const block of snapshot.block) {
        if ([...block.composesWith.dependsOn, ...block.composesWith.conflictsWith].includes(id)) refs.push(`积木 ${block.id}`);
      }
      for (const profile of snapshot['fun-profile']) if (profile.suggestedBlocks.includes(id)) refs.push(`画像 ${profile.id}`);
      for (const recipe of GENRE_RECIPES) {
        if ([...recipe.requiredBlocks, ...recipe.recommendedBlocks, ...recipe.optionalBlocks].includes(id)) refs.push(`品类配方 ${recipe.id}`);
      }
    }
    if (kind === 'fun-profile') {
      for (const recipe of GENRE_RECIPES) if (recipe.relatedFunProfiles.includes(id)) refs.push(`品类配方 ${recipe.id}`);
    }
    if (kind === 'simulation-strategy') {
      for (const profile of snapshot['fun-profile']) if (profile.strategies.includes(id)) refs.push(`画像 ${profile.id}`);
    }
    if (kind === 'stat-template') {
      for (const block of snapshot.block) {
        for (const param of block.params) {
          if (!/stat_?template/i.test(param.key)) continue;
          if (param.default === id || param.options?.includes(id)) refs.push(`积木 ${block.id} 的参数 ${param.key}`);
        }
      }
      for (const story of this.references.listStories()) if ((story.content as {statTemplateId?: string}).statTemplateId === id) refs.push(`分支草稿 ${story.id}`);
      for (const world of this.references.listWorlds()) if ((world.content as {statTemplateId?: string}).statTemplateId === id) refs.push(`世界草稿 ${world.id}`);
      for (const job of this.references.listGenerationJobs()) if (job.statTemplateId === id) refs.push(`生成任务 ${job.id}`);
    }
    return [...new Set(refs)];
  }
}

function builtIns<K extends CatalogKind>(kind: K): readonly CatalogDataMap[K][] {
  return ({block: BLOCKS, 'fun-profile': FUN_PROFILES, 'stat-template': STAT_TEMPLATES, 'simulation-strategy': SIMULATION_STRATEGIES} as CatalogSnapshot)[kind];
}

function schemaFor<K extends CatalogKind>(kind: K): ZodType<CatalogDataMap[K]> {
  return ({block: blockSpecSchema, 'fun-profile': funProfileSchema, 'stat-template': statTemplateSchema, 'simulation-strategy': simulationStrategySchema} as {
    [P in CatalogKind]: ZodType<CatalogDataMap[P]>;
  })[kind];
}

function mergeEntries<K extends CatalogKind>(kind: K, builtins: readonly CatalogDataMap[K][], overrides: StoredCatalogOverride<K>[]): CatalogEntry<K>[] {
  const custom = new Map(overrides.map(row => [row.id, row]));
  const merged: CatalogEntry<K>[] = builtins.map(data => {
    const override = custom.get(data.id);
    if (!override) return {kind, id: data.id, version: data.version, origin: 'builtin', data};
    custom.delete(data.id);
    return {kind, id: data.id, version: override.data.version, origin: 'custom', data: override.data, builtInVersion: data.version, updatedAt: override.updatedAt};
  });
  for (const override of custom.values()) {
    merged.push({kind, id: override.id, version: override.data.version, origin: 'custom', data: override.data, updatedAt: override.updatedAt});
  }
  return merged;
}

const BREAKING_FIELDS: Record<CatalogKind, readonly string[]> = {
  block: ['requires', 'composesWith', 'params', 'provides', 'acceptance'],
  'fun-profile': ['suggestedBlocks', 'pacingLine', 'strategies', 'thresholds', 'metricMatrix'],
  'stat-template': ['variables', 'promptHint'],
  'simulation-strategy': ['baseStrategy'],
};

function isBreakingChange<K extends CatalogKind>(kind: K, before: CatalogDataMap[K], after: CatalogDataMap[K]): boolean {
  return BREAKING_FIELDS[kind].some(field => JSON.stringify(before[field as keyof typeof before]) !== JSON.stringify(after[field as keyof typeof after]));
}
