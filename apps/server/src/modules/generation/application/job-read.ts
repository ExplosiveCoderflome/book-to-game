import type { GenerationJob } from '@novel-game/contracts';
import { productionUnits } from '../domain/production.js';

export function jobSummary(job: GenerationJob) {
  const state = job.productionState;
  return {id: job.id, sourceId: job.sourceId, title: job.productionBrief?.title, status: job.status,
    stage: job.stage, progress: job.progress, completedChunks: job.completedChunks, totalChunks: job.totalChunks,
    draftId: job.draftId, error: job.error, failure: job.failure ? {code: job.failure.code, path: job.failure.path} : job.failure,
    createdAt: job.createdAt, updatedAt: job.updatedAt,
    ...(job.productionBrief ? {brief: {playerRole: job.productionBrief.playerRole, goal: job.productionBrief.goal, tier: job.productionBrief.tier}} : {}),
    ...(state ? {production: {approved: state.approved, unitCount: productionUnits(state.plan).length, writtenCount: Object.keys(state.texts).length,
      routes: state.plan.routes.map(r => ({id: r.id, name: r.name, endingIds: r.endingIds})), rewrite: state.rewrite?.key}} : {}),
    readableFields: Object.keys(job)};
}
