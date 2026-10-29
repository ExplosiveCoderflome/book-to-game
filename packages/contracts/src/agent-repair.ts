import type { GuidanceEdit } from './preflight.js';

export interface AgentRepairChange {target: string; label: string; before: string; after: string}
/** Finite, deterministic samples; these are not a proof of playability or balance. */
export interface AgentRepairVerification {
  seeds: number; beforeRate: number; afterRate: number;
  beforeErrors: number; afterErrors: number; beforeDeadEnds: number; afterDeadEnds: number;
  allowed: boolean; blockers: string[];
}
export interface AgentRepairCandidate {
  id: string; draftId: string; baseVersion: number; endingId: string; endingTitle: string;
  sourceReportAt: string; status: 'pending' | 'applied' | 'rejected';
  edits: GuidanceEdit[]; changes: AgentRepairChange[];
  preview: AgentRepairVerification; verification?: AgentRepairVerification;
  appliedVersion?: number; createdAt: string; updatedAt: string;
}
