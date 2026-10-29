import { randomUUID } from 'node:crypto';
import { lintWorld } from '@novel-game/rules/preflight';
import { authorReadSchema, worldContentSchema, type AuthorReadInput, type DraftProvenance, type WorldContent, type WorldDraft, type WorldRevision, type ValidationResult } from '@novel-game/contracts';
import { canonicalJson } from '../../../shared/canonical-json.js';
import { AppError } from '../../../shared/errors.js';
import { validateWorld } from '../domain/validate-world.js';
import type { SourceReader, WorldRepository } from './ports.js';
import { readAuthorValue } from '../../../shared/author-read.js';
export class WorldService {
  constructor(
    private readonly repository: WorldRepository,
    private readonly sourceReader: SourceReader,
    /** Optional workspace building-library ids for fill placement validation. */
    private readonly buildingAssetIds: () => ReadonlySet<string> | readonly string[] | undefined = () => undefined,
    /** S1 ⑦: mock-generated drafts are publishable only in test environments. */
    private readonly policy: {allowMockPublish?: boolean; traceProvenance?: (draftId: string) => DraftProvenance | undefined} = {},
  ) {}
  /** `trusted` = the generation runner. Other callers may mark a draft mock, but cannot claim a non-mock provenance. */
  create(input: {sourceId: string; content: WorldContent}, opts: {trusted?: boolean} = {}): WorldDraft {
    const parsed = worldContentSchema.parse(input.content); this.sourceReader.get(input.sourceId);
    const {provenance: claimed, ...rest} = parsed;
    const provenance = (claimed && (opts.trusted || claimed.generator === 'mock') ? claimed : undefined) ?? this.mockTwin(rest);
    const content: WorldContent = provenance ? {...rest, provenance} : rest;
    const now = new Date().toISOString();
    const draft: WorldDraft = {id: randomUUID(), sourceId: input.sourceId, content, version: 1, createdAt: now, updatedAt: now};
    this.repository.insertDraft(draft); return draft;
  }
  update(id: string, input: {version: number; content: WorldContent}): WorldDraft {
    assertVersion(input.version); const parsed = worldContentSchema.parse(input.content); const previous = this.get(id);
    // Provenance is sticky: an edit cannot launder a mock draft by dropping or rewriting the stamp.
    const content = previous.content.provenance ? {...parsed, provenance: previous.content.provenance} : parsed;
    const draft: WorldDraft = {...previous, content, version: input.version + 1, updatedAt: new Date().toISOString()};
    this.repository.updateDraft(draft, input.version); return draft;
  }
  get(id: string): WorldDraft {
    const draft = this.repository.getDraft(id); if (!draft) throw new AppError('DRAFT_NOT_FOUND', '世界草稿不存在', 404); return draft;
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
    const validation = validateWorld(draft.content, this.sourceReader.get(draft.sourceId), { buildingAssetIds: this.buildingAssetIds() });
    if (!validation.valid) throw new AppError('INVALID_WORLD', '世界草稿未通过发布校验', 400, validation);
    if (!this.policy.allowMockPublish) this.assertNotMock(draft);
    // D7: lint errors block publishing only for worlds using the S1 systems; legacy worlds are reported, not blocked.
    const lint = lintWorld(draft.content, {draftId: id, draftVersion: draft.version});
    if (lint.blocking && lint.errors > 0) {
      throw new AppError('LINT_BLOCKED', `体检有 ${lint.errors} 项错误，修好后才能发布`, 400, {
        lint: {errors: lint.errors, warnings: lint.warnings, issues: lint.issues.filter(i => i.severity === 'error').slice(0, 20)},
      });
    }
    return this.repository.publish({id: randomUUID(), draftId: id, sourceId: draft.sourceId, version: draft.version, content: draft.content, createdAt: new Date().toISOString()});
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
function assertVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) throw new AppError('INVALID_VERSION', '草稿版本必须为正整数', 400);
}
