import {
  BLOCKS, FUN_PROFILES, funProfileModelOutputSchema, getBlock, getFunProfile,
  proposeFunProfileProposalSchema, proposeFunProfileInputSchema,
  recommendBlocksForProfileResultSchema, type BlockSpec, type FunBlockRecommendation, type FunProfile,
  type ProposeFunProfileInput, type ProposeFunProfileProposal,
  type RecommendBlocksForProfileResult,
} from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { WorldService } from './world-service.js';

/** Read-only authoring snapshot. Never exposes the whole draft, sessions or services. */
export type FunProfileModelInput = {
  worldDraftId: string;
  sourceId?: string;
  title: string;
  premise: string;
  goal: string;
  worldRules: string[];
  storyletSummaries: {title: string; text?: string; kind?: string}[];
  clockUnit?: string;
  timeLimit?: number;
  resourceKeys: string[];
  summary?: string;
  intent?: string;
};

export interface FunProfileModel {
  proposeFunProfile(input: FunProfileModelInput, signal: AbortSignal): Promise<unknown>;
}

const PROFILE_KEYWORDS: Record<string, string[]> = {
  pressure: ['压力', '危机', '时限', '期限', '追捕', '复仇', '江湖', '战斗', '冲突', '经营', '客栈', '镇'],
  healing: ['治愈', '温暖', '日常', '食堂', '茶', '家', '灯', '陪伴', '平静', '渡口', '小镇', '深夜'],
  grinding: ['升级', '修行', '练功', '刷怪', '打怪', '经验', '成长', '突破', '修炼', '境界'],
  collection: ['收集', '图鉴', '宝物', '藏品', '材料', '物品', '珍稀', '集齐'],
};

const PROFILE_ORDER = ['pressure', 'healing', 'grinding', 'collection'];

/**
 * Deterministic test/mock adapter: scores a short draft snapshot against profile keywords.
 * No network, no draft mutation. Ties resolve in catalog order, then `default`.
 */
export const mockFunProfileModel: FunProfileModel = {
  async proposeFunProfile(input) {
    const text = [
      input.title, input.premise, input.goal, input.summary ?? '', input.intent ?? '',
      ...input.worldRules, ...input.storyletSummaries.flatMap(item => [item.title, item.text ?? '']),
      ...input.resourceKeys,
    ].join('\n');
    const scores = PROFILE_ORDER.map(id => ({
      id,
      score: (PROFILE_KEYWORDS[id] ?? []).reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0),
    })).sort((a, b) => b.score - a.score);
    const best = scores[0]!;
    const profile = best.score > 0 && getFunProfile(best.id) ? best : {id: 'default', score: 0};
    const rationale = profile.score > 0
      ? `草稿摘要出现「${PROFILE_KEYWORDS[profile.id]!.filter(word => text.includes(word)).slice(0, 3).join('、')}」等线索，建议按「${profile.id}」画像验收。`
      : '草稿未呈现明显爽感线索，建议先用默认画像（G1–G8 全量验收）。';
    const customHints = input.clockUnit === 'day'
      ? ['草稿使用日单位时钟，适合治愈/日常节拍，需补充温暖事件卡。']
      : [];
    return {profileId: profile.id, rationale, customHints};
  },
};

export interface FunProfileCatalogSnapshot {profiles?: readonly FunProfile[]; blocks?: readonly BlockSpec[]}

/** Cross-check catalog ids against the effective registry; unknown ids are reported, never invented. */
export function resolveProfileBlocks(profileId: string, catalog: FunProfileCatalogSnapshot = {}): RecommendBlocksForProfileResult {
  const profiles = catalog.profiles ?? FUN_PROFILES;
  const availableBlocks = catalog.blocks ?? BLOCKS;
  const profile = profiles.find(candidate => candidate.id === profileId);
  if (!profile) throw new AppError('INVALID_PROFILE', `未知画像：${profileId}`, 400);
  const known = new Set(availableBlocks.map(block => block.id));
  const warnings: string[] = [];
  const blocks: FunBlockRecommendation[] = [];
  for (const id of profile.suggestedBlocks) {
    const block = availableBlocks.find(candidate => candidate.id === id);
    if (!block || !known.has(id)) {
      warnings.push(`已过滤画像引用但未注册的积木：${id}`);
      continue;
    }
    blocks.push({id: block.id, label: block.label, blurb: block.blurb, funTags: block.funTags, shelves: block.shelves});
  }
  return recommendBlocksForProfileResultSchema.parse({profileId: profile.id, blocks, warnings});
}

export function recommendBlocksForProfile(profileId: string, catalog?: FunProfileCatalogSnapshot): RecommendBlocksForProfileResult {
  return resolveProfileBlocks(profileId, catalog);
}

const summarize = (content: {storylets?: {id: string; title: string; text?: string; kind?: string}[]}) =>
  (content.storylets ?? []).map(storylet => ({
    title: storylet.title,
    ...(storylet.text ? {text: storylet.text.slice(0, 300)} : {}),
    ...(storylet.kind ? {kind: storylet.kind} : {}),
  }));

/** Read-only proposal: picks one built-in profile and its registered blocks. Writes nothing. */
export async function proposeFunProfile(
  worlds: WorldService, id: string, input: ProposeFunProfileInput, model: FunProfileModel = mockFunProfileModel,
  signal: AbortSignal = AbortSignal.timeout(30_000), modelName?: string, catalog: FunProfileCatalogSnapshot = {},
): Promise<ProposeFunProfileProposal> {
  const parsed = proposeFunProfileInputSchema.parse(input);
  const draft = worlds.get(id);
  const raw = await model.proposeFunProfile({
    worldDraftId: id,
    sourceId: parsed.sourceId ?? draft.sourceId,
    title: draft.content.title,
    premise: draft.content.premise,
    goal: draft.content.goal,
    worldRules: [...draft.content.worldRules],
    storyletSummaries: summarize(draft.content),
    ...(draft.content.clock ? {clockUnit: draft.content.clock.unit, timeLimit: draft.content.timeLimit} : {timeLimit: draft.content.timeLimit}),
    resourceKeys: Object.keys(draft.content.resourceDefs ?? {}),
    ...(parsed.summary ? {summary: parsed.summary} : {}),
    ...(parsed.intent ? {intent: parsed.intent} : {}),
  }, signal);
  const output = funProfileModelOutputSchema.safeParse(raw);
  if (!output.success) {
    throw new AppError('MODEL_INVALID_RESPONSE', '模型返回的爽感画像提案无法解析', 502, {
      issues: output.error.issues.slice(0, 6).map(issue => ({path: issue.path.join('.'), message: issue.message})),
    });
  }
  const profiles = catalog.profiles ?? FUN_PROFILES;
  const profile = profiles.find(candidate => candidate.id === output.data.profileId);
  if (!profile) {
    throw new AppError('MODEL_INVALID_RESPONSE', '模型返回的爽感画像不存在', 502, {
      profiles: profiles.map(item => item.id),
    });
  }
  const recommendations = resolveProfileBlocks(profile.id, catalog);
  return proposeFunProfileProposalSchema.parse({
    worldDraftId: id, baseVersion: draft.version,
    suggestedProfileId: profile.id,
    rationale: output.data.rationale,
    customHints: output.data.customHints,
    recommendedBlocks: recommendations.blocks,
    warnings: recommendations.warnings,
    ...(modelName ? {model: modelName} : {}),
  });
}
