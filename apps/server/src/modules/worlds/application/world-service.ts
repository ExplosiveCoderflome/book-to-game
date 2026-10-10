import { randomUUID } from 'node:crypto';
import { worldContentSchema, type WorldContent, type WorldDraft, type WorldRevision, type ValidationResult } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import { validateWorld } from '../domain/validate-world.js';
import type { SourceReader, WorldRepository } from './ports.js';
export class WorldService {
  constructor(private readonly repository: WorldRepository, private readonly sourceReader: SourceReader) {}
  create(input: {sourceId: string; content: WorldContent}): WorldDraft {
    const content = worldContentSchema.parse(input.content); this.sourceReader.get(input.sourceId);
    const now = new Date().toISOString();
    const draft: WorldDraft = {id: randomUUID(), sourceId: input.sourceId, content, version: 1, createdAt: now, updatedAt: now};
    this.repository.insertDraft(draft); return draft;
  }
  update(id: string, input: {version: number; content: WorldContent}): WorldDraft {
    assertVersion(input.version); const content = worldContentSchema.parse(input.content); const previous = this.get(id);
    const draft: WorldDraft = {...previous, content, version: input.version + 1, updatedAt: new Date().toISOString()};
    this.repository.updateDraft(draft, input.version); return draft;
  }
  get(id: string): WorldDraft {
    const draft = this.repository.getDraft(id); if (!draft) throw new AppError('DRAFT_NOT_FOUND', '世界草稿不存在', 404); return draft;
  }
  list(): WorldDraft[] {return this.repository.listDrafts();}
  validate(id: string): ValidationResult {
    const draft = this.get(id); return validateWorld(draft.content, this.sourceReader.get(draft.sourceId));
  }
  publish(id: string, input: {version: number}): WorldRevision {
    assertVersion(input.version); const existing = this.repository.findRevision(id, input.version); if (existing) return existing;
    const draft = this.get(id);
    if (draft.version !== input.version) throw new AppError('DRAFT_VERSION_CONFLICT', '草稿已更新，请刷新后发布', 409);
    const validation = validateWorld(draft.content, this.sourceReader.get(draft.sourceId));
    if (!validation.valid) throw new AppError('INVALID_WORLD', '世界草稿未通过发布校验', 400, validation);
    return this.repository.publish({id: randomUUID(), draftId: id, sourceId: draft.sourceId, version: draft.version, content: draft.content, createdAt: new Date().toISOString()});
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
