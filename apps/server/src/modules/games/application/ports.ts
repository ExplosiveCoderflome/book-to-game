import type { Draft, DraftProvenance, GameRevision, SourceDocument } from '@novel-game/contracts';

export interface SourceReader { get(id: string): SourceDocument }
export interface GameRepository {
  insertDraft(draft: Draft): void;
  getDraft(id: string): Draft | undefined;
  listDrafts(): Draft[];
  updateDraft(draft: Draft, expectedVersion: number): void;
  /** S1 ⑦ backfill: set provenance on a draft that has none (no version bump). Returns false if it already had one. */
  setProvenanceIfMissing(id: string, provenance: DraftProvenance): boolean;
  getRevision(id: string): GameRevision | undefined;
  findRevision(draftId: string, version: number): GameRevision | undefined;
  listRevisions(): GameRevision[];
  publish(revision: GameRevision): GameRevision;
}
/** S1 ⑦ publish policy. `traceProvenance` resolves legacy drafts without a stamp (generation run record / logs). */
export interface ProvenancePolicy {
  allowMockPublish?: boolean;
  traceProvenance?: (draftId: string) => DraftProvenance | undefined;
}
