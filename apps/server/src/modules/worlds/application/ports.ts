import type { DraftProvenance, SourceDocument, WorldDraft, WorldRevision } from '@novel-game/contracts';
import type { PreservationBaseline } from './check-world-preservation.js';
export interface SourceReader {get(id: string): SourceDocument}
export interface WorldRepository {
  insertDraft(draft: WorldDraft): void;
  getDraft(id: string): WorldDraft | undefined;
  listDrafts(): WorldDraft[];
  /** Soft-archive: hidden from listDrafts; published revisions (immutable) are kept. */
  archiveDraft(id: string): boolean;
  updateDraft(draft: WorldDraft, expectedVersion: number, baseline: PreservationBaseline): void;
  /** Dedicated author-dispatch only: binding CAS, baseline reset and receipt share one transaction. */
  reshapeDraft(draft: WorldDraft, expectedVersion: number, baseline: PreservationBaseline, binding: {diffHash: string; beforeHash: string; baselineHash: string; baselinePresent: boolean}): WorldDraft;
  getReshapeReceipt(diffHash: string): WorldDraft | undefined;
  getPreservationBaseline(id: string): PreservationBaseline | undefined;
  capturePreservationBaseline(id: string, baseline: PreservationBaseline): PreservationBaseline;
  updateQualityContract(id: string, version: number): void;
  /** S1 ⑦ backfill: set content.provenance on a draft that has none (no version bump). */
  setProvenanceIfMissing(id: string, provenance: DraftProvenance): boolean;
  getRevision(id: string): WorldRevision | undefined;
  findRevision(draftId: string, version: number): WorldRevision | undefined;
  listRevisions(): WorldRevision[];
  publish(revision: WorldRevision): WorldRevision;
}
export interface PublishQualityGate {assertPublishable(draft: WorldDraft): void}
