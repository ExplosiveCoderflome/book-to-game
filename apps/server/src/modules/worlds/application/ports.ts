import type { SourceDocument, WorldDraft, WorldRevision } from '@novel-game/contracts';
export interface SourceReader {get(id: string): SourceDocument}
export interface WorldRepository {
  insertDraft(draft: WorldDraft): void;
  getDraft(id: string): WorldDraft | undefined;
  listDrafts(): WorldDraft[];
  updateDraft(draft: WorldDraft, expectedVersion: number): void;
  getRevision(id: string): WorldRevision | undefined;
  findRevision(draftId: string, version: number): WorldRevision | undefined;
  listRevisions(): WorldRevision[];
  publish(revision: WorldRevision): WorldRevision;
}
