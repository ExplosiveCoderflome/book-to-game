import { randomUUID } from 'node:crypto';
import { gameContentSchema, type Draft, type GameContent, type GameRevision, type ValidationResult } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import { validateGame } from '../domain/validate-game.js';
import type { GameRepository, SourceReader } from './ports.js';

export class GameService {
  constructor(private readonly repository: GameRepository, private readonly sourceReader: SourceReader) {}
  create(input: { sourceId: string; content: GameContent }): Draft {
    const content = gameContentSchema.parse(input.content);
    this.sourceReader.get(input.sourceId);
    const now = new Date().toISOString();
    const draft: Draft = { id: randomUUID(), sourceId: input.sourceId, content, version: 1, createdAt: now, updatedAt: now };
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
    const validation = validateGame(draft.content, this.sourceReader.get(draft.sourceId));
    if (!validation.valid) throw new AppError('INVALID_GAME', '草稿未通过发布校验', 400, validation);
    return this.repository.publish({ id: randomUUID(), draftId: id, sourceId: draft.sourceId, version: draft.version,
      content: draft.content, createdAt: new Date().toISOString() });
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
