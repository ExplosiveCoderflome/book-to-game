/**
 * Author-side preflight (§6.6 lint, §6.7 sim; C9). Reports are stored per draft id and carry `draftVersion`
 * so the UI can show "报告基于第 N 版，草稿已改". Nothing here goes into an export package.
 */
import type { LintReport, PassCheck, PlaytestReport, WorldDraft } from '@novel-game/contracts';
import { lintStory, lintWorld } from '@novel-game/rules/preflight';
import { simulateWorld } from '@novel-game/play-runtime/sim';
import { AppError } from '../../../shared/errors.js';
import type { PreflightDraftReaders, PreflightRepository, StoredPreflight } from './ports.js';

export interface PlaytestInput {id: string; seeds?: number; strategies?: string[]}
export const PLAYTEST_MAX_SEEDS = 500;

export class PreflightService {
  private readonly running = new Map<string, Promise<PlaytestReport>>();
  constructor(private readonly repository: PreflightRepository, private readonly drafts: PreflightDraftReaders,
    private readonly yieldFn: () => Promise<void> = () => new Promise(resolve => setImmediate(resolve))) {}

  lintWorldDraft(id: string): LintReport {
    const draft = this.drafts.world(id);
    const report = lintWorld(draft.content, {draftId: id, draftVersion: draft.version});
    this.repository.saveLint('world', id, report); return report;
  }
  lintStoryDraft(id: string): LintReport {
    const draft = this.drafts.story(id);
    const report = lintStory(draft.content, {draftId: id, draftVersion: draft.version});
    this.repository.saveLint('story', id, report); return report;
  }
  /** Runs strategies × seeds against the draft (as if published). Concurrent requests for the same draft version share one run. */
  async playtestWorldDraft(input: PlaytestInput): Promise<PlaytestReport> {
    const draft = this.drafts.world(input.id);
    const content = draft.content;
    if (!content.storylets?.length && !content.resourceDefs && !content.clock) {
      throw new AppError('PLAYTEST_UNSUPPORTED', '试玩模拟只支持使用新系统（资源上下限 / 时钟 / 卡池）的世界', 400);
    }
    const seeds = input.seeds ?? 200;
    if (!Number.isInteger(seeds) || seeds < 1 || seeds > PLAYTEST_MAX_SEEDS) throw new AppError('INVALID_SEEDS', `seeds 需在 1–${PLAYTEST_MAX_SEEDS}`, 400);
    const key = `${input.id}@${draft.version}#${seeds}#${(input.strategies ?? []).join(',')}`;
    const pending = this.running.get(key);
    if (pending) return pending;
    const run = (async () => {
      const inspected = await this.inspectWorldDraft(draft, {seeds, strategies: input.strategies, guidance: true});
      this.repository.savePlaytest(draft.id, inspected.playtest); return inspected.playtest;
    })().finally(() => this.running.delete(key));
    this.running.set(key, run);
    return run;
  }
  /** Preview a snapshot without persisting. Agent repair uses the same checks as author preflight. */
  async inspectWorldDraft(draft: Pick<WorldDraft, 'id' | 'sourceId' | 'version' | 'content'>,
    options: {seeds: number; strategies?: string[]; guidance: boolean}): Promise<{lint: LintReport; playtest: PlaytestReport}> {
    if (!Number.isInteger(options.seeds) || options.seeds < 1 || options.seeds > PLAYTEST_MAX_SEEDS) throw new AppError('INVALID_SEEDS', `seeds 需在 1–${PLAYTEST_MAX_SEEDS}`, 400);
    const report = await simulateWorld({id: `preflight-${draft.id}`, draftId: draft.id, sourceId: draft.sourceId,
      version: draft.version, content: draft.content, createdAt: new Date().toISOString()},
    {seeds: options.seeds, ...(options.strategies?.length ? {strategies: options.strategies} : {}),
      draftId: draft.id, draftVersion: draft.version, yieldEvery: this.yieldFn, guidance: options.guidance});
    const lint = lintWorld(draft.content, {draftId: draft.id, draftVersion: draft.version});
    return {lint, playtest: {...report, checks: mergeChecks(report.checks, lint.checks)}};
  }
  /** Called within the repair transaction, after the matching world version has been saved. */
  saveWorldInspection(id: string, reports: {lint: LintReport; playtest: PlaytestReport}): void {
    const draft = this.drafts.world(id);
    if ([reports.lint, reports.playtest].some(r => r.draftId !== id || r.draftVersion !== draft.version)) {
      throw new AppError('DRAFT_VERSION_CONFLICT', '草稿已更新，不能保存旧版本体检', 409);
    }
    this.repository.saveLint('world', id, reports.lint); this.repository.savePlaytest(id, reports.playtest);
  }
  getWorldPreflight(id: string): StoredPreflight & {draftVersion: number; stale: {lint: boolean; playtest: boolean}} {
    const draft = this.drafts.world(id); const stored = this.repository.get('world', id);
    return {...stored, draftVersion: draft.version, stale: {lint: !!stored.lint && stored.lint.draftVersion !== draft.version,
      playtest: !!stored.playtest && stored.playtest.draftVersion !== draft.version}};
  }
}
function mergeChecks(sim: PassCheck[], lint: PassCheck[]): PassCheck[] {
  const simIds = new Set(sim.map(c => c.id));
  const fromLint = lint.filter(c => !simIds.has(c.id.replace(/-(count|structure)$/, '')) || /G3|G7/.test(c.id));
  return [...sim, ...fromLint].sort((a, b) => a.id.localeCompare(b.id, 'en', {numeric: true}));
}
