import type { GameContent, LintReport, PlaytestReport, WorldContent } from '@novel-game/contracts';
export type PreflightKind = 'world' | 'story';
export interface StoredPreflight {lint?: LintReport; playtest?: PlaytestReport}
export interface PreflightRepository {
  get(kind: PreflightKind, draftId: string): StoredPreflight;
  saveLint(kind: PreflightKind, draftId: string, report: LintReport): void;
  savePlaytest(draftId: string, report: PlaytestReport): void;
}
/** Read-only views of the drafts (injected by the composition root; no module coupling). */
export interface PreflightDraftReaders {
  world(id: string): {id: string; sourceId: string; version: number; content: WorldContent};
  story(id: string): {id: string; version: number; content: GameContent};
}
