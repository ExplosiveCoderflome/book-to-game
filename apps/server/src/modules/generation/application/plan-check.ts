import type { PlanCheckReport, ProductionPlan } from '@novel-game/contracts';
import { checkPlanWorld } from '@novel-game/play-runtime/sim';
import { AppError } from '../../../shared/errors.js';

/** S5: rule-level check of a ProductionPlan before any prose is written (no model calls). */
export function checkProductionPlan(plan: ProductionPlan, opts: {probe?: boolean} = {}): PlanCheckReport {
  return checkPlanWorld(plan.world, plan.routes.map(r => ({id: r.id, name: r.name, endingIds: r.endingIds})), {probe: opts.probe ?? true});
}

/** Throws when the plan's rules cannot work (unsettable key facts, thresholds that cannot add up, every planned route dead). */
export function assertPlanMechanics(plan: ProductionPlan, opts: {probe?: boolean} = {}): PlanCheckReport {
  const report = checkProductionPlan(plan, opts);
  if (report.blocking) {
    const errors = report.issues.filter(i => i.severity === 'error');
    throw new AppError('PLAN_CHECK_BLOCKED', `玩法规划有 ${report.errors} 处规则问题，写正文前需要修好：${errors.slice(0, 4).map(i => `${i.message}（${i.suggestion}）`).join('；')}`, 422,
      {planCheck: report, issues: errors.map(i => ({path: i.target ? `world.${i.target}` : 'world', message: `${i.message}；建议：${i.suggestion}`}))});
  }
  return report;
}
