import type { AgentRepairCandidate, LintReport, PlaytestReport, WorldContent, WorldDraft } from '@novel-game/contracts';

export interface RepairInspection {lint: LintReport; playtest: PlaytestReport}
export interface RepairRepository {
  get(id: string): AgentRepairCandidate | undefined;
  find(draftId: string, version: number, endingId: string): AgentRepairCandidate | undefined;
  list(draftId: string): AgentRepairCandidate[];
  insert(candidate: AgentRepairCandidate): AgentRepairCandidate;
  update(candidate: AgentRepairCandidate): void;
}
export interface RepairDeps {
  worlds: {get(id: string): WorldDraft; update(id: string, input: {version: number; content: WorldContent}): WorldDraft};
  preflight: {
    getWorldPreflight(id: string): {playtest?: PlaytestReport};
    inspectWorldDraft(draft: WorldDraft, options: {seeds: number; guidance: boolean}): Promise<RepairInspection>;
    saveWorldInspection(id: string, reports: RepairInspection): void;
  };
  repository: RepairRepository;
  /** Composition root supplies one transaction across world, reports and candidate. */
  atomic<T>(operation: () => T): T;
}
