import type { DraftProvenance, SourceDocument, WorldDraft, WorldRevision } from '@novel-game/contracts';
export interface SourceReader {get(id: string): SourceDocument}
export interface WorldRepository {
  insertDraft(draft: WorldDraft): void;
  getDraft(id: string): WorldDraft | undefined;
  listDrafts(): WorldDraft[];
  /** Soft-archive: hidden from listDrafts; published revisions (immutable) are kept. */
  archiveDraft(id: string): boolean;
  updateDraft(draft: WorldDraft, expectedVersion: number): void;
  /** S1 ⑦ backfill: set content.provenance on a draft that has none (no version bump). */
  setProvenanceIfMissing(id: string, provenance: DraftProvenance): boolean;
  getRevision(id: string): WorldRevision | undefined;
  findRevision(draftId: string, version: number): WorldRevision | undefined;
  listRevisions(): WorldRevision[];
  publish(revision: WorldRevision): WorldRevision;
}
