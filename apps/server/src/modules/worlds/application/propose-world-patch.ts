import {
  clockSchema, proposeClockPatchInputSchema, proposeStoryletPatchInputSchema, storyletSchema,
  worldPatchModelOutputSchema,
  type ProposeClockPatchInput, type ProposeStoryletPatchInput, type WorldClock, type WorldPatchChange, type WorldPatchProposal,
} from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { WorldService } from './world-service.js';

export type WorldPatchKind = 'clock' | 'storylet';

export type WorldPatchStoryletSummary = {id: string; title: string; kind?: string; text?: string; locationIds?: string[]; choiceLabels: string[]};

/** Read-only authoring snapshot. No service, session or full WorldContent is exposed to the model. */
export type WorldPatchModelInput = {
  kind: WorldPatchKind;
  clock?: WorldClock;
  storylets: WorldPatchStoryletSummary[];
  input: ProposeClockPatchInput | ProposeStoryletPatchInput;
};

export interface WorldPatchModel {
  proposeWorldPatch(input: WorldPatchModelInput, signal: AbortSignal): Promise<unknown>;
}

const clockChanges = (existing: WorldClock | undefined, input: ProposeClockPatchInput) => {
  if (!existing) {
    return [{
      path: 'clock', op: 'add' as const,
      after: {
        unit: input.unit ?? 'month', startYear: 1, startMonth: 1,
        limitMonths: input.limitMonths ?? 24, display: '{year}年{month}月',
      },
      note: '新增时钟后 edited timeCost 以时钟刻度计',
    }];
  }
  const changes: WorldPatchChange[] = [];
  if (input.unit && input.unit !== existing.unit) {
    changes.push({path: 'clock.unit', op: 'replace' as const, before: existing.unit, after: input.unit});
  }
  if (input.limitMonths && input.limitMonths !== existing.limitMonths) {
    changes.push({path: 'clock.limitMonths', op: 'replace' as const, before: existing.limitMonths, after: input.limitMonths});
  }
  if (!changes.length && !input.unit && !input.limitMonths) {
    changes.push({
      path: 'clock.limitMonths', op: 'replace' as const,
      before: existing.limitMonths, after: Math.min(existing.limitMonths + 6, 2400),
      note: 'Mock 建议延长 6 个刻度供审阅',
    });
  }
  return changes;
};

const newStorylet = (input: ProposeStoryletPatchInput, existingIds: Set<string>) => {
  const title = input.title ?? '待审阅新卡';
  let base = title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'proposal';
  if (!/^[a-zA-Z0-9_-]/.test(base)) base = `card_${base}`;
  let storyletId = base;
  for (let index = 2; existingIds.has(storyletId); index++) storyletId = `${base}_${index}`;
  return storyletSchema.parse({
    id: storyletId, title, ...(input.kind ? {kind: input.kind} : {}),
    ...(input.locationIds?.length ? {locationIds: input.locationIds} : {}),
    text: input.text ?? input.intent ?? `为「${title}」补充一段可审阅的剧情正文。`,
    choices: [{
      id: 'choice', label: input.choiceLabel ?? '继续', timeCost: 1, effects: [],
      text: '你做出了选择。',
    }],
  });
};

const storyletChanges = (input: ProposeStoryletPatchInput, storylets: WorldPatchStoryletSummary[]) => {
  if (!input.storyletId) {
    return {changes: [{path: 'storylets', op: 'add', after: newStorylet(input, new Set(storylets.map(item => item.id)))}], warnings: []};
  }
  const existing = storylets.find(item => item.id === input.storyletId);
  if (!existing) return {changes: [], warnings: [`剧情卡不存在：${input.storyletId}`]};
  const changes: WorldPatchChange[] = [];
  if (input.title !== undefined && input.title !== existing.title) {
    changes.push({path: `storylets.${existing.id}.title`, op: 'replace' as const, before: existing.title, after: input.title});
  }
  if (input.text !== undefined && input.text !== existing.text) {
    changes.push({path: `storylets.${existing.id}.text`, op: 'replace' as const, before: existing.text, after: input.text});
  }
  if (input.kind !== undefined && input.kind !== existing.kind) {
    changes.push({path: `storylets.${existing.id}.kind`, op: 'replace' as const, before: existing.kind, after: input.kind});
  }
  if (input.locationIds !== undefined && JSON.stringify(input.locationIds) !== JSON.stringify(existing.locationIds ?? [])) {
    changes.push({path: `storylets.${existing.id}.locationIds`, op: 'replace' as const, before: existing.locationIds ?? [], after: input.locationIds, note: '地点范围'});
  }
  if (input.choiceLabel !== undefined && !existing.choiceLabels.includes(input.choiceLabel)) {
    changes.push({path: `storylets.${existing.id}.choices`, op: 'replace' as const, before: existing.choiceLabels, after: [input.choiceLabel], note: '选项名称提案，需作者补齐效果'});
  }
  return {changes, warnings: changes.length ? [] : ['没有可审阅的字段变化']};
};

/** Deterministic test/mock adapter: emits a small field-level diff, never the whole world draft. */
export const mockWorldPatchModel: WorldPatchModel = {
  async proposeWorldPatch(input) {
    if (input.kind === 'clock') {
      const parsed = proposeClockPatchInputSchema.parse(input.input);
      return {summary: parsed.intent ?? '时钟配置提案', changes: clockChanges(input.clock, parsed), warnings: []};
    }
    const parsed = proposeStoryletPatchInputSchema.parse(input.input);
    const result = storyletChanges(parsed, input.storylets);
    return {summary: parsed.intent ?? '剧情卡提案', changes: result.changes, warnings: result.warnings};
  },
};

const summarize = (content: {clock?: WorldClock; storylets?: {id: string; title: string; kind?: string; text?: string; locationIds?: string[]; choices: {label: string}[]}[]}) =>
  (content.storylets ?? []).map(storylet => ({
    id: storylet.id, title: storylet.title, ...(storylet.kind ? {kind: storylet.kind} : {}),
    ...(storylet.text ? {text: storylet.text.slice(0, 500)} : {}),
    ...(storylet.locationIds?.length ? {locationIds: [...storylet.locationIds]} : {}),
    choiceLabels: storylet.choices.map(choice => choice.label),
  }));

async function propose(
  worlds: WorldService, kind: WorldPatchKind, id: string, input: ProposeClockPatchInput | ProposeStoryletPatchInput,
  model: WorldPatchModel, signal: AbortSignal, modelName?: string,
): Promise<WorldPatchProposal> {
  const draft = worlds.get(id);
  const raw = await model.proposeWorldPatch({
    kind, ...(draft.content.clock ? {clock: structuredClone(draft.content.clock)} : {}),
    storylets: summarize(draft.content), input: structuredClone(input),
  }, signal);
  const output = worldPatchModelOutputSchema.safeParse(raw);
  if (!output.success) {
    throw new AppError('MODEL_INVALID_RESPONSE', '模型返回的块级补丁无法解析', 502, {
      issues: output.error.issues.slice(0, 6).map(issue => ({path: issue.path.join('.'), message: issue.message})),
    });
  }
  const clock = kind === 'clock'
    ? clockSchema.safeParse(draft.content.clock ?? output.data.changes.find(change => change.path === 'clock')?.after)
    : undefined;
  const warnings = [...output.data.warnings];
  if (kind === 'clock' && !clock?.success) warnings.push('时钟补丁缺少可校验的 clock 结构，仅作审阅参考');
  return {
    worldDraftId: id, baseVersion: draft.version, kind, summary: output.data.summary,
    changes: output.data.changes, warnings: warnings.slice(0, 12),
    ...(modelName ? {model: modelName} : {}),
  };
}

export function proposeClockPatch(
  worlds: WorldService, id: string, input: ProposeClockPatchInput, model: WorldPatchModel = mockWorldPatchModel,
  signal: AbortSignal = AbortSignal.timeout(30_000), modelName?: string,
): Promise<WorldPatchProposal> {
  return propose(worlds, 'clock', id, proposeClockPatchInputSchema.parse(input), model, signal, modelName);
}

export function proposeStoryletPatch(
  worlds: WorldService, id: string, input: ProposeStoryletPatchInput, model: WorldPatchModel = mockWorldPatchModel,
  signal: AbortSignal = AbortSignal.timeout(30_000), modelName?: string,
): Promise<WorldPatchProposal> {
  return propose(worlds, 'storylet', id, proposeStoryletPatchInputSchema.parse(input), model, signal, modelName);
}
