import { randomUUID } from 'node:crypto';
import { gameContentSchema, type Draft, type DraftProvenance, type GameContent, type GameRevision, type ValidationResult } from '@novel-game/contracts';
import { lintStory } from '@novel-game/rules/preflight';
import { AppError } from '../../../shared/errors.js';
import { canonicalJson } from '../../../shared/canonical-json.js';
import { validateGame } from '../domain/validate-game.js';
import type { GameRepository, ProvenancePolicy, SourceReader } from './ports.js';

export class GameService {
  constructor(private readonly repository: GameRepository, private readonly sourceReader: SourceReader,
    private readonly policy: ProvenancePolicy = {}) {}
  /** `provenance` is set only by the generation runner (HTTP/MCP create never passes it). */
  create(input: { sourceId: string; content: GameContent; provenance?: Draft['provenance'] }): Draft {
    const content = gameContentSchema.parse(input.content);
    this.sourceReader.get(input.sourceId);
    const now = new Date().toISOString();
    // S1 ⑦ (c): a byte-identical copy of a mock draft inherits the mock mark (copy/duplicate cannot launder it).
    const provenance = input.provenance ?? this.mockTwin(content);
    const draft: Draft = { id: randomUUID(), sourceId: input.sourceId, content, version: 1, createdAt: now, updatedAt: now,
      ...(provenance ? { provenance } : {}) };
    this.repository.insertDraft(draft); return draft;
  }
  update(id: string, input: { version: number; content: GameContent }): Draft {
    assertVersion(input.version);
    const content = gameContentSchema.parse(input.content);
    const previous = this.get(id);
    const draft: Draft = { ...previous, content, version: input.version + 1, updatedAt: new Date().toISOString() };
    this.repository.updateDraft(draft, input.version); return draft;
  }
  get(id: string): Draft {
    const draft = this.repository.getDraft(id);
    if (!draft) throw new AppError('DRAFT_NOT_FOUND', '草稿不存在', 404);
    return draft;
  }
  list(): Draft[] { return this.repository.listDrafts(); }
  validate(id: string): ValidationResult {
    const draft = this.get(id);
    return validateGame(draft.content, this.sourceReader.get(draft.sourceId));
  }
  publish(id: string, input: { version: number }): GameRevision {
    assertVersion(input.version);
    const existing = this.repository.findRevision(id, input.version);
    if (existing) return existing;
    const draft = this.get(id);
    if (draft.version !== input.version) throw new AppError('DRAFT_VERSION_CONFLICT', '草稿已更新，请刷新后发布', 409);
    if (!this.policy.allowMockPublish) this.assertNotMock(draft);
    const validation = validateGame(draft.content, this.sourceReader.get(draft.sourceId));
    if (!validation.valid) throw new AppError('INVALID_GAME', '草稿未通过发布校验', 400, validation);
    return this.repository.publish({ id: randomUUID(), draftId: id, sourceId: draft.sourceId, version: draft.version,
      content: draft.content, createdAt: new Date().toISOString() });
  }
  /** Stamp (backfill) or trace (lazy) — the provenance publishing is judged by. */
  effectiveProvenance(draft: Draft): DraftProvenance | undefined {
    return draft.provenance ?? this.policy.traceProvenance?.(draft.id) ?? this.mockTwin(draft.content, draft.id);
  }
  /** S1 ⑦ (a) backfill: write a traced/copied mock mark onto an unmarked draft. Non-mock drafts are never touched. Idempotent. */
  backfillMockProvenance(): {id: string; provenance: DraftProvenance}[] {
    const marked: {id: string; provenance: DraftProvenance}[] = [];
    for (const draft of this.repository.listDrafts()) {
      if (draft.provenance) continue;
      const traced = this.policy.traceProvenance?.(draft.id);
      if (traced?.generator === 'mock' && this.repository.setProvenanceIfMissing(draft.id, traced)) marked.push({id: draft.id, provenance: traced});
    }
    for (const draft of this.repository.listDrafts()) {
      if (draft.provenance) continue;
      const twin = this.mockTwin(draft.content, draft.id);
      if (twin && this.repository.setProvenanceIfMissing(draft.id, twin)) marked.push({id: draft.id, provenance: twin});
    }
    return marked;
  }
  private assertNotMock(draft: Draft): void {
    const provenance = this.effectiveProvenance(draft);
    if (provenance?.generator === 'mock') {
      throw new AppError('MOCK_DRAFT_UNPUBLISHABLE', '这份草稿由测试用模拟模型生成，不能发布。请用真实模型重新生成，或手工编写内容。', 403, {provenance});
    }
    if (provenance) return;
    // S1 ⑦ (b): provenance cannot be traced → fall back to the preflight text lint. Template / banned sentences block.
    const issues = lintStory(draft.content, {draftId: draft.id, draftVersion: draft.version}).issues.filter(i => i.severity === 'error' && i.ruleId === 'text.banned-phrase');
    if (issues.length) {
      throw new AppError('LINT_BLOCKED', `来源无法追溯，且正文有 ${issues.length} 处模板句 / 禁用句，改写后才能发布`, 400,
        {reason: 'UNTRACED_TEMPLATE_TEXT', lint: {errors: issues.length, issues: issues.slice(0, 20)}});
    }
  }
  private mockTwin(content: GameContent, excludeId?: string): DraftProvenance | undefined {
    const key = canonicalJson(content);
    for (const other of this.repository.listDrafts()) {
      if (other.id === excludeId) continue;
      const p = other.provenance ?? this.policy.traceProvenance?.(other.id);
      if (p?.generator === 'mock' && canonicalJson(other.content) === key) {
        return {generator: 'mock', ...(p.model ? {model: p.model} : {}), source: 'copy', copiedFrom: p.copiedFrom ?? other.id};
      }
    }
    return undefined;
  }
  listRevisions(): GameRevision[] { return this.repository.listRevisions(); }
  getRevision(id: string): GameRevision {
    const revision = this.repository.getRevision(id);
    if (!revision) throw new AppError('GAME_REVISION_NOT_FOUND', '已发布游戏版本不存在', 404);
    return revision;
  }
}
function assertVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) throw new AppError('INVALID_VERSION', '草稿版本必须为正整数', 400);
}
