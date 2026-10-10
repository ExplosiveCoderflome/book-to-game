import type { Draft, GameRevision, SourceDocument } from '@novel-game/contracts';

export interface SourceReader { get(id: string): SourceDocument }
export interface GameRepository {
  insertDraft(draft: Draft): void;
  getDraft(id: string): Draft | undefined;
  listDrafts(): Draft[];
  updateDraft(draft: Draft, expectedVersion: number): void;
  getRevision(id: string): GameRevision | undefined;
  findRevision(draftId: string, version: number): GameRevision | undefined;
  listRevisions(): GameRevision[];
  publish(revision: GameRevision): GameRevision;
}
