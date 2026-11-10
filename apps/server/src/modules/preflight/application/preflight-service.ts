/**
 * Author-side preflight (§6.6 lint, §6.7 sim; C9). Reports are stored per draft id and carry `draftVersion`
 * so the UI can show "报告基于第 N 版，草稿已改". Nothing here goes into an export package.
 */
import type { FunProfile, LintReport, PassCheck, PlaytestReport, WorldContent, WorldDraft } from '@novel-game/contracts';
import { createHash } from 'node:crypto';
import { FUN_PROFILE_STRATEGY_IDS, getFunProfile } from '@novel-game/contracts';
import { lintStory, lintWorld } from '@novel-game/rules/preflight';
import { defaultStrategies, simulateWorld, type SimProfile } from '@novel-game/play-runtime/sim';
import { AppError } from '../../../shared/errors.js';
import type { PreflightCatalogReader, PreflightDraftReaders, PreflightRepository, StoredPreflight } from './ports.js';

export interface PlaytestInput {id: string; expectedVersion?: number; seeds?: number; strategies?: string[]; profileId?: string; evidenceRuns?: number; evidenceSeed?: number; maxSteps?: number}
export const PLAYTEST_MAX_SEEDS = 500;

export class PreflightService {
  private readonly running = new Map<string, Promise<PlaytestReport>>();
  constructor(private readonly repository: PreflightRepository, private readonly drafts: PreflightDraftReaders,
    private readonly yieldFn: () => Promise<void> = () => new Promise(resolve => setImmediate(resolve)),
    private readonly catalog?: PreflightCatalogReader) {}

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
    if (input.expectedVersion !== undefined && input.expectedVersion !== draft.version) throw new AppError('DRAFT_VERSION_CONFLICT', '草稿已更新，请基于最新版本重新试玩', 409);
    const seeds = input.seeds ?? 200;
    if (!Number.isInteger(seeds) || seeds < 1 || seeds > PLAYTEST_MAX_SEEDS) throw new AppError('INVALID_SEEDS', `seeds 需在 1–${PLAYTEST_MAX_SEEDS}`, 400);
    const evidence = {runs: input.evidenceRuns ?? Math.min(seeds, 3), seed: input.evidenceSeed ?? 1, maxSteps: input.maxSteps ?? 200};
    if (!Number.isInteger(evidence.runs) || evidence.runs < 1 || evidence.runs > 20 || !Number.isInteger(evidence.seed) || evidence.seed < 0 || evidence.seed > 0xffffffff || !Number.isInteger(evidence.maxSteps) || evidence.maxSteps < 1 || evidence.maxSteps > 300) throw new AppError('INVALID_EVIDENCE_BOUNDS', '试玩证据边界超出允许范围', 400);
    const profile = input.profileId === undefined ? undefined : this.catalog?.funProfile(input.profileId) ?? getFunProfile(input.profileId);
    if (input.profileId !== undefined && !profile) throw new AppError('INVALID_PROFILE', `未知画像：${input.profileId}`, 400);
    const strategies = input.strategies ? this.resolveStrategyIds(input.strategies) : undefined;
    const key = stableHash({id: input.id, version: draft.version, seeds, strategies: strategies ?? [], profile: profile ?? null, evidence});
    const pending = this.running.get(key);
    if (pending) return pending;
    const run = (async () => {
      const inspected = await this.inspectWorldDraft(draft, {seeds, strategies, guidance: true, profile,
        evidence});
      this.repository.savePlaytest(draft.id, inspected.playtest); return inspected.playtest;
    })().finally(() => this.running.delete(key));
    this.running.set(key, run);
    return run;
  }
  /** Preview a snapshot without persisting. Agent repair uses the same checks as author preflight. */
  async inspectWorldDraft(draft: Pick<WorldDraft, 'id' | 'sourceId' | 'version' | 'content'>,
     options: {seeds: number; strategies?: string[]; guidance: boolean; profile?: FunProfile; evidence?: {runs: number; seed: number; maxSteps: number}}): Promise<{lint: LintReport; playtest: PlaytestReport}> {
    if (!Number.isInteger(options.seeds) || options.seeds < 1 || options.seeds > PLAYTEST_MAX_SEEDS) throw new AppError('INVALID_SEEDS', `seeds 需在 1–${PLAYTEST_MAX_SEEDS}`, 400);
    if (options.evidence && (!Number.isInteger(options.evidence.runs) || options.evidence.runs < 1 || options.evidence.runs > 20
      || !Number.isInteger(options.evidence.seed) || options.evidence.seed < 0 || options.evidence.seed > 0xffffffff
      || !Number.isInteger(options.evidence.maxSteps) || options.evidence.maxSteps < 1 || options.evidence.maxSteps > 300)) {
      throw new AppError('INVALID_EVIDENCE_BOUNDS', '试玩证据边界超出允许范围', 400);
    }
    const profile = options.profile ? this.resolveProfile(options.profile) : undefined;
    // Catalog ids name strategy roles; the runtime exposes resource-specific execution ids.
    const strategies = options.strategies?.length
      ? defaultStrategies(draft.content, {...profile, strategyIds: options.strategies}).map(strategy => strategy.id)
      : undefined;
    if (strategies && !strategies.length) throw new AppError('INVALID_STRATEGY', '没有匹配的模拟策略', 400);
    const report = await simulateWorld({id: `preflight-${draft.id}`, draftId: draft.id, sourceId: draft.sourceId,
      version: draft.version, content: draft.content, createdAt: new Date().toISOString()},
    {seeds: options.seeds, ...(strategies ? {strategies} : {}),
      ...(profile ? {profile} : {}),
      draftId: draft.id, draftVersion: draft.version, yieldEvery: this.yieldFn, guidance: options.guidance,
      evidence: options.evidence ?? {runs: Math.min(options.seeds, 3), seed: 1, maxSteps: 200}});
    const lint = lintWorld(draft.content, {draftId: draft.id, draftVersion: draft.version});
    const contentHash = worldQualityContentHash(draft.content, options.profile ?? null);
    const specHash = stableHash({checkVersion: 'playtest-evidence-1', runs: options.evidence?.runs ?? Math.min(options.seeds, 3),
      seed: options.evidence?.seed ?? 1, maxSteps: options.evidence?.maxSteps ?? 200, strategies: report.strategies.map(s => s.id), qualityProfile: options.profile ?? null});
    const observedBodies = new Set(draft.content.actions.map(action => action.text.trim().replace(/\s+/g, ' ')).filter(Boolean));
    for (const ending of draft.content.endings) if (ending.text.trim()) observedBodies.add(ending.text.trim().replace(/\s+/g, ' '));
    const observed = !!report.evidence?.samples.some(sample => sample.actionIds.some(actionId => draft.content.actions.some(action => action.id === actionId && observedBodies.has(action.text.trim().replace(/\s+/g, ' '))))
      || sample.endingId && draft.content.endings.some(ending => ending.id === sample.endingId && observedBodies.has(ending.text.trim().replace(/\s+/g, ' '))));
    const evidence = report.evidence ? {...report.evidence, contentHash, specHash,
      status: observed ? 'observed' as const : 'unsupported' as const,
      ...(!observed ? {unsupportedReason: '正文未在实际动作或结局轨迹中观察到，证据不可判定'} : {})} : undefined;
    return {lint, playtest: {...report, ...(evidence ? {evidence} : {}), checks: mergeChecks(report.checks, lint.checks)}};
  }
  /** Called within the repair transaction, after the matching world version has been saved. */
  saveWorldInspection(id: string, reports: {lint: LintReport; playtest: PlaytestReport}): void {
    const draft = this.drafts.world(id);
    if ([reports.lint, reports.playtest].some(r => r.draftId !== id || r.draftVersion !== draft.version)) {
      throw new AppError('DRAFT_VERSION_CONFLICT', '草稿已更新，不能保存旧版本体检', 409);
    }
    this.repository.saveLint('world', id, reports.lint); this.repository.savePlaytest(id, reports.playtest);
  }
  private resolveProfile(profile: FunProfile): SimProfile {
    const strategyLabels: Record<string, string> = {};
    const strategies = profile.strategies.map(id => {
      const strategy = this.catalog?.simulationStrategy(id);
      if (!strategy) {
        if ((FUN_PROFILE_STRATEGY_IDS as readonly string[]).includes(id)) return id;
        throw new AppError('INVALID_STRATEGY', `画像 ${profile.id} 引用了未知模拟策略：${id}`, 400);
      }
      if (strategy.id !== strategy.baseStrategy) strategyLabels[strategy.baseStrategy] = strategy.label;
      return strategy.baseStrategy;
    });
    return {...profile, strategies: [...new Set(strategies)], strategyLabels};
  }

  private resolveStrategyIds(ids: readonly string[]): string[] {
    return [...new Set(ids.map(id => {
      const strategy = this.catalog?.simulationStrategy(id);
      if (strategy) return strategy.baseStrategy;
      if ((FUN_PROFILE_STRATEGY_IDS as readonly string[]).includes(id)) return id;
      throw new AppError('INVALID_STRATEGY', `未知模拟策略：${id}`, 400);
    }))];
  }

  getWorldPreflight(id: string): StoredPreflight & {draftVersion: number; stale: {lint: boolean; playtest: boolean}} {
    const draft = this.drafts.world(id); const stored = this.repository.get('world', id);
    return {...stored, draftVersion: draft.version, stale: {lint: !!stored.lint && stored.lint.draftVersion !== draft.version,
      playtest: !!stored.playtest && stored.playtest.draftVersion !== draft.version}};
  }
}
function stableHash(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])) : item;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function worldQualityContentHash(content: WorldContent, profile: FunProfile | null = null): string {
  return stableHash({rules: content, prose: collectAuthoredProse(content), blocks: content.blockSelections ?? [], qualityProfile: profile});
}
function collectAuthoredProse(content: WorldContent): string[] {
  return [content.title, ...content.locations.map(location => location.text), ...content.actions.map(action => action.text),
    ...(content.storylets ?? []).flatMap(card => [card.title, card.text, ...card.choices.map(choice => choice.text)]),
    ...content.endings.map(ending => ending.text)].filter((text): text is string => typeof text === 'string' && text.trim().length > 0);
}
function mergeChecks(sim: PassCheck[], lint: PassCheck[]): PassCheck[] {
  const simIds = new Set(sim.map(c => c.id));
  const fromLint = lint.filter(c => !simIds.has(c.id.replace(/-(count|structure)$/, '')) || /G3|G7/.test(c.id));
  return [...sim, ...fromLint].sort((a, b) => a.id.localeCompare(b.id, 'en', {numeric: true}));
}
