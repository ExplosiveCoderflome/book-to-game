import {
  GENRE_RECIPES, lintBlocks,
  type CatalogDataMap, type CatalogKind, type CatalogLintIssue,
} from '@novel-game/contracts';
import type { ZodError, ZodType } from 'zod';
import { AppError } from '../../../shared/errors.js';

export type CatalogSnapshot = {[K in CatalogKind]: CatalogDataMap[K][]};

const issue = (severity: 'error' | 'warning', ruleId: string, message: string, kind?: CatalogKind, id?: string): CatalogLintIssue =>
  ({severity, ruleId, message, ...(kind ? {kind} : {}), ...(id ? {id} : {})});

/** zod 负责字段结构；这里负责跨条目的引用、组合与配方约束。所有作者诊断均为中文。 */
export function lintCatalog(snapshot: CatalogSnapshot): CatalogLintIssue[] {
  const issues: CatalogLintIssue[] = [];
  const blockIds = new Set(snapshot.block.map(block => block.id));
  const strategyIds = new Set(snapshot['simulation-strategy'].flatMap(strategy => [strategy.id, strategy.baseStrategy]));
  const strategyById = new Map(snapshot['simulation-strategy'].flatMap(strategy => [[strategy.id, strategy], [strategy.baseStrategy, strategy]]));

  for (const raw of lintBlocks(snapshot.block)) {
    const messages: Record<string, string> = {
      'blocks.duplicate-id': `积木 id 重复：${raw.blockId ?? '未知'}`,
      'blocks.unknown-require': `积木 ${raw.blockId ?? ''} 的 requires 包含未知底座片段`,
      'blocks.unknown-composes': `积木 ${raw.blockId ?? ''} 的 dependsOn/conflictsWith 引用了不存在的积木`,
      'blocks.duplicate-provides': `积木 ${raw.blockId ?? ''} 的 provides 有重复项`,
      'blocks.unknown-shelf': `积木 ${raw.blockId ?? ''} 引用了不存在的货架`,
      'blocks.empty-shelf': `货架 ${raw.shelfId ?? ''} 暂无积木`,
      'blocks.duplicate-shelf': `积木 ${raw.blockId ?? ''} 的货架有重复项`,
      'blocks.ai-overlay-without-shelf': `积木 ${raw.blockId ?? ''} 提供 ai-overlay，必须归入 ai-live 货架`,
      'blocks.ai-shelf-writes-world': `临场 AI 积木 ${raw.blockId ?? ''} 只能提供 ai-overlay，不能改写 WorldContent`,
    };
    issues.push(issue(raw.severity, raw.ruleId, messages[raw.ruleId] ?? '积木目录组合校验失败', 'block', raw.blockId));
  }
  for (const block of snapshot.block) {
    for (const dependency of [...block.composesWith.dependsOn, ...block.composesWith.conflictsWith]) {
      if (!blockIds.has(dependency)) {
        issues.push(issue('error', 'catalog.unknown-block-reference', `积木「${block.id}」引用了不存在的积木：${dependency}`, 'block', block.id));
      }
    }
  }
  for (const profile of snapshot['fun-profile']) {
    for (const id of profile.suggestedBlocks) {
      if (!blockIds.has(id)) issues.push(issue('error', 'catalog.profile-unknown-block', `画像「${profile.id}」的 suggestedBlocks 引用了不存在的积木：${id}`, 'fun-profile', profile.id));
    }
    const baseStrategies = new Set<string>();
    for (const id of profile.strategies) {
      const strategy = strategyById.get(id);
      if (!strategy || !strategyIds.has(id)) {
        issues.push(issue('error', 'catalog.profile-unknown-strategy', `画像「${profile.id}」的 strategies 引用了不存在的模拟策略：${id}`, 'fun-profile', profile.id));
      } else if (baseStrategies.has(strategy.baseStrategy)) {
        issues.push(issue('error', 'catalog.profile-duplicate-base-strategy', `画像「${profile.id}」有多个策略复用同一选择器：${strategy.baseStrategy}，请只保留一个`, 'fun-profile', profile.id));
      } else baseStrategies.add(strategy.baseStrategy);
    }
  }
  for (const recipe of GENRE_RECIPES) {
    for (const id of [...recipe.requiredBlocks, ...recipe.recommendedBlocks, ...recipe.optionalBlocks]) {
      if (!blockIds.has(id)) issues.push(issue('error', 'catalog.recipe-unknown-block', `品类配方「${recipe.id}」引用了不存在的积木：${id}`, 'block', id));
    }
    const profileIds = new Set(snapshot['fun-profile'].map(profile => profile.id));
    for (const id of recipe.relatedFunProfiles) {
      if (!profileIds.has(id)) issues.push(issue('error', 'catalog.recipe-unknown-profile', `品类配方「${recipe.id}」引用了不存在的画像：${id}`, 'fun-profile', id));
    }
  }
  return dedupeIssues(issues);
}

function dedupeIssues(issues: CatalogLintIssue[]): CatalogLintIssue[] {
  const seen = new Set<string>();
  return issues.filter(item => {
    const key = `${item.severity}|${item.ruleId}|${item.kind ?? ''}|${item.id ?? ''}|${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function parseCatalogData<K extends CatalogKind>(schema: ZodType<CatalogDataMap[K]>, data: unknown): CatalogDataMap[K] {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  throwCatalogValidation(parsed.error);
}

function throwCatalogValidation(error: ZodError): never {
  const details = error.issues.slice(0, 12).map(item => ({
    path: item.path.join('.'),
    message: chineseZodIssue(item.code),
  }));
  throw new AppError('CATALOG_INVALID', `目录内容未通过校验：${details.map(item => `${item.path || '根字段'} ${item.message}`).join('；')}`, 422, {issues: details});
}

function chineseZodIssue(code: string): string {
  const messages: Record<string, string> = {
    invalid_type: '类型不正确或缺少必填字段',
    too_small: '小于允许的最小值、长度或数量',
    too_big: '超过允许的最大值、长度或数量',
    invalid_format: '格式不正确',
    invalid_enum_value: '不在允许的选项中',
    invalid_union: '不符合任何允许的结构',
    unrecognized_keys: '包含未允许的字段',
    custom: '未通过字段约束',
  };
  return messages[code] ?? '字段值不合法';
}
