import {
  applyEndConditionsInputSchema,
  applyEndConditionsResultSchema,
  buildWorldEndConditions,
  endConditionsModelOutputSchema,
  proposeEndConditionsInputSchema,
  proposeEndConditionsProposalSchema,
  type ApplyEndConditionsInput,
  type ApplyEndConditionsResult,
  type EndConditionDraft,
  type EndConditionSelection,
  type ProposeEndConditionsInput,
  type ProposeEndConditionsProposal,
  type WorldCondition,
  type WorldContent,
} from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { WorldService } from './world-service.js';

export const END_CONDITIONS_SEVERITY_NOTE = '终局条件决定整局成败：改动会重塑整局节奏与结局覆盖，请确认后再写入。';

const SEVERITY = 'reshapes-game' as const;

/** Read-only authoring snapshot. Never exposes the whole draft or source text. */
export type EndConditionsModelInput = {
  worldDraftId: string;
  title: string;
  premise: string;
  goal: string;
  worldRules: string[];
  resources: {id: string; label: string; min: number; max?: number; initial?: number}[];
  facts: {id: string; label: string; initialValue: boolean}[];
  storyletTitles: string[];
  existing?: {win: number; lose: number};
  intent?: string;
  summary?: string;
};

export interface EndConditionsModel {
  proposeEndConditions(input: EndConditionsModelInput, signal: AbortSignal): Promise<unknown>;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type Resource = EndConditionsModelInput['resources'][number];

/**
 * Deterministic test/mock adapter.
 *
 * It derives three complete win/lose packages from the draft's declared resources and facts:
 * a standard one, a gentle one (lower win bar, fewer early failures) and a harsh one (higher win bar,
 * failures for stalling). No network, no draft mutation, no novel-specific strings.
 */
export const mockEndConditionsModel: EndConditionsModel = {
  async proposeEndConditions(input) {
    const progress = input.resources.find(resource => resource.max !== undefined) ?? input.resources[0];
    const pressure = input.resources.find(resource => resource.id !== progress?.id) ?? progress;
    const unfinishedFact = input.facts.find(fact => !fact.initialValue);
    const packages = [];

    const winFromProgress = (share: number, draftId: string, label: string, note: string): EndConditionDraft => {
      if (!progress) return {id: draftId, label, when: [{kind: 'storylet_seen', storyletId: input.storyletTitles[0] ?? draftId, atLeast: 1}], note};
      const value = progress.max !== undefined
        ? clamp(Math.round(progress.min + (progress.max - progress.min) * share), progress.min, progress.max)
        : progress.min + Math.round(share * 10);
      const when: WorldCondition[] = [{kind: 'resource', resourceId: progress.id, atLeast: value}];
      if (unfinishedFact && share >= 0.9) when.push({kind: 'fact', factId: unfinishedFact.id, value: true});
      return {id: draftId, label, when, note};
    };
    const loseFromPressure = (draftId: string, label: string, note: string): EndConditionDraft => {
      if (!pressure) return {id: draftId, label, when: [{kind: 'time', atLeast: 6}], note};
      return {id: draftId, label, when: [{kind: 'resource', resourceId: pressure.id, atMost: pressure.min}], note};
    };

    packages.push({
      id: 'standard', label: '标准胜负', tone: 'standard' as const,
      summary: progress
        ? `把「${progress.label}」推满作为胜利，把「${pressure?.label ?? progress.label}」耗尽作为失败。`
        : '以一次完整通关为胜利，以时间耗尽为失败。',
      win: [winFromProgress(1, 'win_progress', progress ? `${progress.label}达到上限` : '完成主线', '默认胜利线：推满主要进度资源。')],
      lose: [loseFromPressure('lose_pressure', pressure ? `${pressure.label}见底` : '期限耗尽', '默认失败线：主要压力资源耗尽。')],
    });

    packages.push({
      id: 'gentle', label: '温和收束', tone: 'gentle' as const,
      summary: progress
        ? `降低「${progress.label}」门槛，只保留硬性资源见底为失败，适合治愈向体验。`
        : '降低胜利门槛，只保留硬性期限为失败。',
      win: [winFromProgress(0.7, 'win_progress_mid', progress ? `${progress.label}达到七成` : '完成主要目标', '温和胜利线：达到七成即可收官。')],
      lose: [loseFromPressure('lose_pressure', pressure ? `${pressure.label}见底` : '期限耗尽', '失败线保持硬性：资源见底才算输。')],
    });

    packages.push({
      id: 'harsh', label: '高压终局', tone: 'harsh' as const,
      summary: progress
        ? `「${progress.label}」必须推满，且进度停滞或压力见底都会立即失败。`
        : '必须完成全部目标，任何停滞都判失败。',
      win: [winFromProgress(1, 'win_progress_full', progress ? `${progress.label}推满` : '完成全部目标', '高压胜利线：必须推满。')],
      lose: [
        loseFromPressure('lose_pressure', pressure ? `${pressure.label}见底` : '期限耗尽', '压力资源见底立即失败。'),
        ...(progress ? [{id: 'lose_stall', label: `${progress.label}停滞`, when: [{kind: 'resource', resourceId: progress.id, atMost: progress.min}] as WorldCondition[], note: '进度见底也判失败，抬高失败压力。'}] : []),
      ],
    });

    return {
      packages,
      warnings: input.existing ? ['草稿已有终局条件，本次提议仅作对比；应用会覆盖现有胜负线。'] : [],
    };
  },
};

const summarize = (content: WorldContent): Pick<EndConditionsModelInput, 'resources' | 'facts' | 'storyletTitles'> => ({
  resources: Object.entries(content.resourceDefs ?? {}).map(([id, def]) => ({
    id, label: def.label, min: def.min, ...(def.max !== undefined ? {max: def.max} : {}), ...(def.initial !== undefined ? {initial: def.initial} : {}),
  })),
  facts: content.facts.map(fact => ({id: fact.id, label: fact.label, initialValue: fact.initialValue})),
  storyletTitles: (content.storylets ?? []).map(storylet => storylet.title),
});

/** Read-only proposal: 2–4 win/lose packages derived from the draft. Writes nothing. */
export async function proposeEndConditions(
  worlds: WorldService, id: string, input: ProposeEndConditionsInput, model: EndConditionsModel = mockEndConditionsModel,
  signal: AbortSignal = AbortSignal.timeout(30_000), modelName?: string,
): Promise<ProposeEndConditionsProposal> {
  const parsed = proposeEndConditionsInputSchema.parse(input);
  const draft = worlds.get(id);
  const raw = await model.proposeEndConditions({
    worldDraftId: id,
    title: draft.content.title,
    premise: draft.content.premise,
    goal: draft.content.goal,
    worldRules: [...draft.content.worldRules],
    ...summarize(draft.content),
    ...(draft.content.endConditions ? {existing: {win: draft.content.endConditions.win.length, lose: draft.content.endConditions.lose.length}} : {}),
    ...(parsed.intent ? {intent: parsed.intent} : {}),
    ...(parsed.summary ? {summary: parsed.summary} : {}),
  }, signal);
  const output = endConditionsModelOutputSchema.safeParse(raw);
  if (!output.success) {
    throw new AppError('MODEL_INVALID_RESPONSE', '模型返回的终局条件提案无法解析', 502, {
      issues: output.error.issues.slice(0, 6).map(issue => ({path: issue.path.join('.'), message: issue.message})),
    });
  }
  return proposeEndConditionsProposalSchema.parse({
    worldDraftId: id,
    baseVersion: draft.version,
    packages: output.data.packages,
    warnings: output.data.warnings,
    severity: SEVERITY,
    severityNote: END_CONDITIONS_SEVERITY_NOTE,
    ...(modelName ? {model: modelName} : {}),
  });
}

/** First compatible authored ending for a win/lose condition; never invents an ending. */
function resolveEnding(content: WorldContent, kind: 'win' | 'lose', index: number): string {
  const candidates = content.endings.filter(ending => kind === 'win'
    ? (ending.kind ?? 'ending') === 'ending'
    : ending.kind === 'failure');
  const ending = candidates[index % Math.max(1, candidates.length)];
  if (!ending) {
    throw new AppError('END_CONDITIONS_NO_ENDING', kind === 'win'
      ? '当前世界没有可用的普通结局，请先补齐结局再写胜利条件。'
      : '当前世界没有失败结局，请先补齐失败结局再写失败条件。', 422);
  }
  return ending.id;
}

/** Deterministic free-text parse: each line is `胜利/失败：描述（含资源或事实名，可选数字）`. */
export function parseEndConditionsText(content: WorldContent, text: string): {win: EndConditionDraft[]; lose: EndConditionDraft[]} {
  const resources = Object.entries(content.resourceDefs ?? {}).map(([id, def]) => ({id, label: def.label, def}));
  const matchResource = (line: string) => resources.find(({id, label}) => line.includes(id) || line.includes(label));
  const matchFact = (line: string) => content.facts.find(fact => line.includes(fact.id) || line.includes(fact.label));
  const win: EndConditionDraft[] = []; const lose: EndConditionDraft[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const kind: 'win' | 'lose' | undefined = /^(胜利|赢|win)\s*[:：]?/i.test(line) ? 'win'
      : /^(失败|输|lose)\s*[:：]?/i.test(line) ? 'lose' : undefined;
    if (!kind) throw new AppError('END_CONDITIONS_PARSE_FAILED', `无法判断这一行的胜负归属：${line}（请用「胜利：… / 失败：…」开头）`, 422);
    const body = line.replace(/^(胜利|赢|win|失败|输|lose)\s*[:：]\s*/i, '').trim();
    if (!body) throw new AppError('END_CONDITIONS_PARSE_FAILED', `这一行缺少条件描述：${line}`, 422);
    const number = Number((body.match(/-?\d+(?:\.\d+)?/) ?? [])[0]);
    const resource = matchResource(body);
    const fact = matchFact(body);
    let when: WorldCondition[] | undefined;
    if (resource) {
      const {id, def} = resource;
      const fallback = kind === 'win' ? (def.max ?? def.min + 10) : def.min;
      const value = Number.isFinite(number) ? number : fallback;
      when = [{kind: 'resource', resourceId: id, ...(kind === 'win' ? {atLeast: value} : {atMost: value})}];
    } else if (fact) {
      when = [{kind: 'fact', factId: fact.id, value: true}];
    }
    if (!when) {
      throw new AppError('END_CONDITIONS_PARSE_FAILED', `无法把「${body}」对应到现有资源或事实，请提及草稿里的资源名/事实名。`, 422);
    }
    const draftIndex = kind === 'win' ? win.length + 1 : lose.length + 1;
    (kind === 'win' ? win : lose).push({id: `${kind}_custom_${draftIndex}`, label: body.slice(0, 200), when});
  }
  if (!win.length || !lose.length) {
    throw new AppError('END_CONDITIONS_INCOMPLETE', '自定义终局条件必须同时包含至少一条「胜利」和一条「失败」。', 422);
  }
  return {win: win.slice(0, 6), lose: lose.slice(0, 6)};
}

const selectionDrafts = (content: WorldContent, selection: EndConditionSelection): {win: EndConditionDraft[]; lose: EndConditionDraft[]; source: 'agent-proposed' | 'author-custom'; packageId?: string; packageLabel?: string} => {
  if (selection.kind === 'custom') {
    return {...parseEndConditionsText(content, selection.text), source: 'author-custom'};
  }
  return {
    win: selection.win,
    lose: selection.lose,
    source: 'agent-proposed',
    packageId: selection.packageId,
    packageLabel: selection.packageLabel ?? selection.packageId,
  };
};

/**
 * Apply an author-confirmed win/lose set. Editing an existing set requires `acknowledgeReshape`.
 * Writes only `world.endConditions`; endings themselves stay authored content.
 */
export function applyEndConditions(worlds: WorldService, input: ApplyEndConditionsInput): ApplyEndConditionsResult {
  const parsed = applyEndConditionsInputSchema.parse(input);
  const draft = worlds.get(parsed.worldDraftId);
  if (draft.version !== parsed.version) {
    throw new AppError('DRAFT_VERSION_CONFLICT', '草稿已更新，请重新生成或审阅终局条件提案', 409);
  }
  if (draft.content.endConditions && !parsed.acknowledgeReshape) {
    throw new AppError('END_CONDITIONS_RESHAPE_UNCONFIRMED', END_CONDITIONS_SEVERITY_NOTE, 409, {
      severity: SEVERITY,
      existing: draft.content.endConditions,
    });
  }
  const drafts = selectionDrafts(draft.content, parsed.selection);
  const winEndings = draft.content.endings.filter(ending => (ending.kind ?? 'ending') === 'ending');
  const loseEndings = draft.content.endings.filter(ending => ending.kind === 'failure');
  if (!winEndings.length) throw new AppError('END_CONDITIONS_NO_ENDING', '当前世界没有可用的普通结局，请先补齐结局再写胜利条件。', 422);
  if (!loseEndings.length) throw new AppError('END_CONDITIONS_NO_ENDING', '当前世界没有失败结局，请先补齐失败结局再写失败条件。', 422);
  const endConditions = buildWorldEndConditions({
    // 作者在已有条件上再确认应用，一律记为事后编辑（宁可保守，也不把改稿说成首次提议）。
    source: draft.content.endConditions ? 'author-edited' : drafts.source,
    win: drafts.win,
    lose: drafts.lose,
    ...(drafts.packageId ? {packageId: drafts.packageId} : {}),
    ...(drafts.packageLabel ? {packageLabel: drafts.packageLabel} : {}),
    endingFor: (kind, _condition, index) => resolveEnding(draft.content, kind, index),
  });
  // applyContent 走完整世界规则校验（引用、来源、开局密度），不只是 schema。
  const updated = worlds.applyContent(draft.id, {version: parsed.version, content: {...draft.content, endConditions}});
  return applyEndConditionsResultSchema.parse({
    draftId: updated.id,
    version: updated.version,
    endConditions: updated.content.endConditions,
    severity: SEVERITY,
    severityNote: END_CONDITIONS_SEVERITY_NOTE,
  });
}
