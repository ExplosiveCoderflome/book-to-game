import { randomUUID } from 'node:crypto';
import { lintWorld } from '@novel-game/rules/preflight';
import { authorReadSchema, worldContentSchema, type AuthorReadInput, type DraftProvenance, type PlaytestReport, type ResourceDef, type Storylet, type StoryletChoice, type WorldCondition, type WorldContent, type WorldDraft, type WorldEffect, type WorldRevision, type ValidationResult } from '@novel-game/contracts';
import { canonicalJson } from '../../../shared/canonical-json.js';
import { AppError } from '../../../shared/errors.js';
import { validateWorld } from '../domain/validate-world.js';
import type { SourceReader, WorldRepository } from './ports.js';
import { readAuthorValue } from '../../../shared/author-read.js';
import {assertWorldPreservation, extendPreservationBaseline, makePreservationBaseline, type PreservationBaseline} from './check-world-preservation.js';
export class WorldService {
  constructor(
    private readonly repository: WorldRepository,
    private readonly sourceReader: SourceReader,
    /** Optional workspace building-library ids for fill placement validation. */
    private readonly buildingAssetIds: () => ReadonlySet<string> | readonly string[] | undefined = () => undefined,
    /** S1 ⑦: mock-generated drafts are publishable only in test environments. */
    private readonly policy: {allowMockPublish?: boolean; traceProvenance?: (draftId: string) => DraftProvenance | undefined; playtest?: (draftId: string) => PlaytestReport | undefined;
      publishQualityGate?: (draft: WorldDraft) => void; upgradeQualityContract?: (draft: WorldDraft) => void} = {},
  ) {}
  /** `trusted` = the generation runner. Other callers may mark a draft mock, but cannot claim a non-mock provenance. */
  create(input: {sourceId: string; content: WorldContent}, opts: {trusted?: boolean} = {}): WorldDraft {
    const parsed = worldContentSchema.parse(input.content); this.sourceReader.get(input.sourceId);
    const {provenance: claimed, ...rest} = parsed;
    const provenance = (claimed && (opts.trusted || claimed.generator === 'mock') ? claimed : undefined) ?? this.mockTwin(rest);
    const content: WorldContent = provenance ? {...rest, provenance} : rest;
    const now = new Date().toISOString();
    const draft: WorldDraft = {id: randomUUID(), sourceId: input.sourceId, content, version: 1, createdAt: now, updatedAt: now, qualityContractVersion: 1};
    this.repository.insertDraft(draft);
    this.repository.capturePreservationBaseline(draft.id, makePreservationBaseline(draft.id, draft.version, draft.content));
    return draft;
  }
  update(id: string, input: {version: number; content: WorldContent}): WorldDraft {
    assertVersion(input.version); const previous = this.get(id);
    if (previous.version !== input.version) throw new AppError('DRAFT_VERSION_CONFLICT', '草稿已更新，请刷新后编辑', 409);
    const parsed = worldContentSchema.parse(input.content);
    // Provenance is sticky: an edit cannot launder a mock draft by dropping or rewriting the stamp.
    const content = previous.content.provenance ? {...parsed, provenance: previous.content.provenance} : parsed;
    const baseline = this.getOrCapturePreservationBaseline(previous);
    assertWorldPreservation(baseline, content);
    const upgraded = previous.qualityContractVersion === undefined && usesQualityComposition(content) ? 1 : previous.qualityContractVersion;
    const draft: WorldDraft = {...previous, content, ...(upgraded === undefined ? {} : {qualityContractVersion: upgraded}), version: input.version + 1, updatedAt: new Date().toISOString()};
    this.repository.updateDraft(draft, input.version, extendPreservationBaseline(baseline, makePreservationBaseline(draft.id, draft.version, content)));
    return this.get(id);
  }
  addLocation(id: string, input: {version: number; location: WorldContent['locations'][number]}): WorldDraft {
    return this.editWithRules(id, input.version, content => {
      if (content.locations.some(location => location.id === input.location.id)) {
        throw new AppError('LOCATION_EXISTS', `地点已存在：${input.location.id}`, 409);
      }
      return {...content, locations: [...content.locations, input.location]};
    });
  }
  updateLocation(id: string, input: {version: number; location: WorldContent['locations'][number]}): WorldDraft {
    return this.editWithRules(id, input.version, content => {
      const index = content.locations.findIndex(location => location.id === input.location.id);
      if (index < 0) throw new AppError('LOCATION_NOT_FOUND', `地点不存在：${input.location.id}`, 404);
      const locations = [...content.locations]; locations[index] = input.location;
      return {...content, locations};
    });
  }
  addStorylet(id: string, input: {version: number; storylet: Storylet}): WorldDraft {
    return this.editWithRules(id, input.version, content => {
      if ((content.storylets ?? []).some(storylet => storylet.id === input.storylet.id)) {
        throw new AppError('STORYLET_EXISTS', `剧情卡已存在：${input.storylet.id}`, 409);
      }
      return {...content, storylets: [...content.storylets ?? [], input.storylet]};
    });
  }
  updateStorylet(id: string, input: {version: number; storylet: Storylet}): WorldDraft {
    return this.editStorylet(id, input.version, input.storylet.id, () => input.storylet);
  }
  addStoryletCondition(id: string, input: StoryletConditionEdit & {condition: WorldCondition}): WorldDraft {
    return this.editStoryletCondition(id, input, conditions => [...conditions, input.condition]);
  }
  removeStoryletCondition(id: string, input: StoryletConditionEdit & {conditionIndex: number}): WorldDraft {
    return this.editStoryletCondition(id, input, conditions => removeAt(conditions, input.conditionIndex, '条件'));
  }
  addStoryletEffect(id: string, input: {version: number; storyletId: string; choiceId: string; effect: WorldEffect}): WorldDraft {
    return this.editStoryletChoice(id, input, choice => ({...choice, effects: [...choice.effects, input.effect]}));
  }
  removeStoryletEffect(id: string, input: {version: number; storyletId: string; choiceId: string; effectIndex: number}): WorldDraft {
    return this.editStoryletChoice(id, input, choice => ({...choice, effects: removeAt(choice.effects, input.effectIndex, '效果')}));
  }
  addResourceDef(id: string, input: {version: number; resourceId: string; definition: ResourceDef}): WorldDraft {
    return this.editWithRules(id, input.version, content => {
      if (Object.hasOwn(content.resourceDefs ?? {}, input.resourceId)) {
        throw new AppError('RESOURCE_DEF_EXISTS', `资源定义已存在：${input.resourceId}`, 409);
      }
      return {...content, resourceDefs: {...content.resourceDefs, [input.resourceId]: input.definition}};
    });
  }
  updateResourceDef(id: string, input: {version: number; resourceId: string; definition: ResourceDef}): WorldDraft {
    return this.editWithRules(id, input.version, content => {
      if (!Object.hasOwn(content.resourceDefs ?? {}, input.resourceId)) {
        throw new AppError('RESOURCE_DEF_NOT_FOUND', `资源定义不存在：${input.resourceId}`, 404);
      }
      return {...content, resourceDefs: {...content.resourceDefs, [input.resourceId]: input.definition}};
    });
  }
  applyContent(id: string, input: {version: number; content: WorldContent}): WorldDraft {
    return this.editWithRules(id, input.version, () => input.content);
  }
  validateContent(id: string, content: WorldContent): ValidationResult {
    const draft = this.get(id);
    return validateWorld(worldContentSchema.parse(content), this.sourceReader.get(draft.sourceId), {buildingAssetIds: this.buildingAssetIds()});
  }
  private editWithRules(id: string, version: number, change: (content: WorldContent) => WorldContent): WorldDraft {
    assertVersion(version);
    const previous = this.get(id);
    if (previous.version !== version) throw new AppError('DRAFT_VERSION_CONFLICT', '草稿已更新，请刷新后编辑', 409);
    const content = worldContentSchema.parse(change(previous.content));
    const validation = validateWorld(content, this.sourceReader.get(previous.sourceId), {buildingAssetIds: this.buildingAssetIds()});
    if (!validation.valid) throw new AppError('INVALID_WORLD', '细粒度编辑未通过世界规则校验', 400, validation);
    // Reuse the existing sticky-provenance handling and repository compare-and-swap.
    return this.update(id, {version, content});
  }
  private editStorylet(id: string, version: number, storyletId: string, change: (storylet: Storylet) => Storylet): WorldDraft {
    return this.editWithRules(id, version, content => {
      const storylets = [...content.storylets ?? []];
      const index = storylets.findIndex(storylet => storylet.id === storyletId);
      if (index < 0) throw new AppError('STORYLET_NOT_FOUND', `剧情卡不存在：${storyletId}`, 404);
      storylets[index] = change(storylets[index]!);
      return {...content, storylets};
    });
  }
  private editStoryletCondition(id: string, input: StoryletConditionEdit, change: (conditions: WorldCondition[]) => WorldCondition[]): WorldDraft {
    return this.editStorylet(id, input.version, input.storyletId, storylet => {
      const target = input.target ?? 'when';
      if (target === 'when') {
        if (input.choiceId) throw new AppError('INVALID_CONDITION_TARGET', '剧情卡出现条件不能指定选项', 400);
        return {...storylet, when: change(storylet.when ?? [])};
      }
      if (!input.choiceId) throw new AppError('INVALID_CONDITION_TARGET', '选项条件必须指定 choiceId', 400);
      const choices = [...storylet.choices];
      const index = choices.findIndex(choice => choice.id === input.choiceId);
      if (index < 0) throw new AppError('STORYLET_CHOICE_NOT_FOUND', `剧情卡选项不存在：${input.choiceId}`, 404);
      const choice = choices[index]!;
      choices[index] = {...choice, [target]: change(choice[target] ?? [])};
      return {...storylet, choices};
    });
  }
  private editStoryletChoice(id: string, input: {version: number; storyletId: string; choiceId: string}, change: (choice: StoryletChoice) => StoryletChoice): WorldDraft {
    return this.editStorylet(id, input.version, input.storyletId, storylet => {
      const choices = [...storylet.choices];
      const index = choices.findIndex(choice => choice.id === input.choiceId);
      if (index < 0) throw new AppError('STORYLET_CHOICE_NOT_FOUND', `剧情卡选项不存在：${input.choiceId}`, 404);
      choices[index] = change(choices[index]!);
      return {...storylet, choices};
    });
  }
  get(id: string): WorldDraft {
    const draft = this.repository.getDraft(id); if (!draft) throw new AppError('DRAFT_NOT_FOUND', '世界草稿不存在', 404); return draft;
  }
  getPreservationBaseline(id: string): PreservationBaseline | undefined {return this.repository.getPreservationBaseline(id);}
  private getOrCapturePreservationBaseline(draft: WorldDraft): PreservationBaseline {
    return this.repository.capturePreservationBaseline(draft.id, makePreservationBaseline(draft.id, draft.version, draft.content));
  }
  list(): WorldDraft[] {return this.repository.listDrafts();}
  read(id: string, input: Partial<AuthorReadInput> = {}) {
    const draft = this.get(id), options = authorReadSchema.parse(input);
    const {content} = draft;
    return options.path ? {id, version: draft.version, updatedAt: draft.updatedAt, data: readAuthorValue(content, options)}
      : {id, sourceId: draft.sourceId, version: draft.version, updatedAt: draft.updatedAt,
        title: content.title, playerRole: content.playerRole, premise: content.premise, goal: content.goal,
        counts: {locations: content.locations.length, facts: content.facts.length, npcs: content.npcs.length,
          actions: content.actions.length, storylets: content.storylets?.length ?? 0, endings: content.endings.length}, readableFields: Object.keys(content)};
  }
  /** Soft-archive a draft (hidden from list, still readable by id; revisions untouched). */
  archive(id: string): {id: string; archived: true} {this.get(id); this.repository.archiveDraft(id); return {id, archived: true};}
  validate(id: string): ValidationResult {
    const draft = this.get(id); return validateWorld(draft.content, this.sourceReader.get(draft.sourceId), { buildingAssetIds: this.buildingAssetIds() });
  }
  publish(id: string, input: {version: number}): WorldRevision {
    assertVersion(input.version); const existing = this.repository.findRevision(id, input.version); if (existing) return existing;
    const draft = this.get(id);
    if (draft.version !== input.version) throw new AppError('DRAFT_VERSION_CONFLICT', '草稿已更新，请刷新后发布', 409);
    this.assertPublishFloor(draft);
    this.assertMinimumPlaytest(draft);
    if (draft.qualityContractVersion === 1) {
      if (!this.policy.publishQualityGate) throw new AppError('PUBLISH_QUALITY_UNAVAILABLE', '新质量合同的服务端发布检查不可用，已拒绝发布', 503);
      this.policy.publishQualityGate(draft);
    }
    return this.publishRevision(draft);
  }
  private assertPublishFloor(draft: WorldDraft): void {
    const validation = validateWorld(draft.content, this.sourceReader.get(draft.sourceId), {buildingAssetIds: this.buildingAssetIds()});
    if (!validation.valid) throw new AppError('INVALID_WORLD', '世界草稿未通过发布校验', 400, validation);
    if (!this.policy.allowMockPublish) this.assertNotMock(draft);
    const lint = lintWorld(draft.content, {draftId: draft.id, draftVersion: draft.version});
    if (lint.blocking && lint.errors > 0) throw new AppError('LINT_BLOCKED', `体检有 ${lint.errors} 项错误，修好后才能发布`, 400,
      {lint: {errors: lint.errors, warnings: lint.warnings, issues: lint.issues.filter(issue => issue.severity === 'error').slice(0, 20)}});
  }
  private assertMinimumPlaytest(draft: WorldDraft): void {
    const playtest = this.policy.playtest?.(draft.id);
    const tooShort = playtest?.checks.find(check => check.id === 'minimum-run-length' && !check.pass);
    if (playtest?.draftVersion === draft.version && tooShort)
      throw new AppError('PLAYTEST_BLOCKED', `快速试玩未通过最低局长门禁：${tooShort.measured}`, 422, {playtest});
  }
  private publishRevision(draft: WorldDraft): WorldRevision {
    return this.repository.publish({id: randomUUID(), draftId: draft.id, sourceId: draft.sourceId, version: draft.version, content: draft.content, createdAt: new Date().toISOString()});
  }
  effectiveProvenance(draft: WorldDraft): DraftProvenance | undefined {
    return draft.content.provenance ?? this.policy.traceProvenance?.(draft.id) ?? this.mockTwin(draft.content, draft.id);
  }
  /** S1 ⑦ (a) backfill (see GameService.backfillMockProvenance). */
  backfillMockProvenance(): {id: string; provenance: DraftProvenance}[] {
    const marked: {id: string; provenance: DraftProvenance}[] = [];
    for (const draft of this.repository.listDrafts()) {
      if (draft.content.provenance) continue;
      const traced = this.policy.traceProvenance?.(draft.id);
      if (traced?.generator === 'mock' && this.repository.setProvenanceIfMissing(draft.id, traced)) marked.push({id: draft.id, provenance: traced});
    }
    for (const draft of this.repository.listDrafts()) {
      if (draft.content.provenance) continue;
      const twin = this.mockTwin(draft.content, draft.id);
      if (twin && this.repository.setProvenanceIfMissing(draft.id, twin)) marked.push({id: draft.id, provenance: twin});
    }
    return marked;
  }
  private assertNotMock(draft: WorldDraft): void {
    const provenance = this.effectiveProvenance(draft);
    if (provenance?.generator === 'mock') {
      throw new AppError('MOCK_DRAFT_UNPUBLISHABLE', '这份草稿由测试用模拟模型生成，不能发布。请用真实模型重新生成，或手工编写内容。', 403, {provenance});
    }
    if (provenance) return;
    const issues = lintWorld(draft.content, {draftId: draft.id, draftVersion: draft.version}).issues.filter(i => i.severity === 'error' && i.ruleId === 'text.banned-phrase');
    if (issues.length) {
      throw new AppError('LINT_BLOCKED', `来源无法追溯，且正文有 ${issues.length} 处模板句 / 禁用句，改写后才能发布`, 400,
        {reason: 'UNTRACED_TEMPLATE_TEXT', lint: {errors: issues.length, issues: issues.slice(0, 20)}});
    }
  }
  private mockTwin(content: WorldContent, excludeId?: string): DraftProvenance | undefined {
    const strip = (c: WorldContent) => { const {provenance: _p, ...rest} = c; return canonicalJson(rest); };
    const key = strip(content);
    for (const other of this.repository.listDrafts()) {
      if (other.id === excludeId) continue;
      const p = other.content.provenance ?? this.policy.traceProvenance?.(other.id);
      if (p?.generator === 'mock' && strip(other.content) === key) {
        return {generator: 'mock', ...(p.model ? {model: p.model} : {}), source: 'copy', copiedFrom: p.copiedFrom ?? other.id};
      }
    }
    return undefined;
  }
  listRevisions(): WorldRevision[] {return this.repository.listRevisions();}
  getRevision(id: string): WorldRevision {
    const revision = this.repository.getRevision(id);
    if (!revision) throw new AppError('WORLD_REVISION_NOT_FOUND', '已发布世界版本不存在', 404); return revision;
  }
}
function usesQualityComposition(content: WorldContent): boolean {
  return !!(content.blockSelections?.length || content.ledgerVersion || content.causalClaims || content.actions.some(item => item.ledgerAssertions?.length)
    || content.events.some(item => item.ledgerAssertions?.length) || content.endings.some(item => item.ledgerAssertions?.length));
}
type StoryletConditionEdit = {
  version: number;
  storyletId: string;
  choiceId?: string;
  target?: 'when' | 'availableWhen' | 'requires';
};
function removeAt<T>(items: readonly T[], index: number, label: string): T[] {
  if (!Number.isSafeInteger(index) || index < 0 || index >= items.length) {
    throw new AppError('INVALID_INDEX', `${label}索引不存在：${index}`, 400);
  }
  return [...items.slice(0, index), ...items.slice(index + 1)];
}
function assertVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) throw new AppError('INVALID_VERSION', '草稿版本必须为正整数', 400);
}
