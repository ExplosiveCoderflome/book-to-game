import { lintWorld } from '@novel-game/rules/preflight';
import { simulateWorld } from '@novel-game/play-runtime/sim';
import { productionPlanSchema, productionNarrativeSchema, type SourceDocument, type WorldContent } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import { assembleProduction, assertProductionNarrative, assertProductionPlan, productionUnits } from '../domain/production.js';
import { assertPlanMechanics } from './plan-check.js';
import type { GenerationProvider, JobRepository, ModelRepairFeedback, StoredJob } from '../domain/ports.js';

export type RepairStep = <T>(step: string, run: (feedback?: ModelRepairFeedback) => Promise<T>) => Promise<T>;

/** Returns null after saving a plan for author review, or after lease ownership is revoked. */
export async function produceWorld(job: StoredJob, owner: string, source: SourceDocument, repository: JobRepository,
  provider: GenerationProvider, signal: AbortSignal, repair: RepairStep): Promise<WorldContent | null> {
  const brief = job.productionBrief!;
  if (!provider.planProduction || !provider.writeProductionUnit) throw new AppError('PRODUCTION_UNAVAILABLE', '当前模型适配器不支持分阶段游戏制作', 422);
  if (job.productionState && !job.productionState.approved) {
    repository.saveProductionPlan(job.id, owner, job.productionState.plan);
    return null;
  }
  if (!job.productionState) {
    const plan = await repair('production:plan', async feedback => {
      const candidate = productionPlanSchema.parse(await provider.planProduction!(job.analysis!, brief, source.chapters.map(chapter => chapter.id), signal, feedback));
      assertProductionPlan(candidate, brief, source);
      assertPlanMechanics(candidate, {probe: false}); // S5: static rule errors go back to the model as repair feedback
      return candidate;
    });
    repository.saveProductionPlan(job.id, owner, plan);
    return null;
  }
  const state = job.productionState;
  const units = productionUnits(state.plan);
  for (const unit of units) {
    signal.throwIfAborted();
    if (state.texts[unit.key]) continue;
    const text = await repair(`production:${unit.key}`, async feedback => {
      const writingUnit = state.rewrite?.key === unit.key ? {...unit, direction: state.rewrite.direction, currentText: state.rewrite.previousText} : unit;
      const candidate = productionNarrativeSchema.parse(await provider.writeProductionUnit!(state.plan, writingUnit, Object.values(state.texts).slice(-2), signal, feedback));
      assertProductionNarrative(state.plan, unit, candidate);
      return candidate;
    });
    if (!repository.saveProductionText(job.id, owner, unit, text, units.length)) return null;
    state.texts[unit.key] = text;
  }
  const content = assembleProduction(state.plan, state.texts, brief);
  const lint = lintWorld(content);
  if (!repository.saveProductionLint(job.id, owner, lint)) return null;
  signal.throwIfAborted();
  const playtest = await simulateWorld({id: `production-${job.id}`, draftId: job.id, sourceId: job.sourceId,
    version: 1, content, createdAt: job.createdAt}, {seeds: 20, maxSteps: 300,
    // Route coverage: every planned route + goal runs only for endings the generic strategies miss (keeps the job fast).
    routes: state.plan.routes.map(r => ({id: r.id, name: r.name, endingIds: r.endingIds})), routeSeeds: 10, routeEndings: 'uncovered', guidance: {seeds: 40},
    yieldEvery: async () => { signal.throwIfAborted(); await new Promise<void>(resolve => setImmediate(resolve)); }});
  if (!repository.saveProductionLint(job.id, owner, lint, playtest)) return null;
  return content;
}
