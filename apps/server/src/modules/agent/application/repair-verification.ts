import type { AgentRepairVerification, LintIssue } from '@novel-game/contracts';
import type { RepairInspection } from './repair-ports.js';

export const REPAIR_SEEDS = 40;
const issueKey = (i: LintIssue) => JSON.stringify([i.ruleId, i.target?.kind, i.target?.id, i.message]);

export function compareRepair(before: RepairInspection, after: RepairInspection, endingId: string): AgentRepairVerification {
  const beforeRate = before.playtest.endingRates.random?.[endingId] ?? 0;
  const afterRate = after.playtest.endingRates.random?.[endingId] ?? 0;
  const blockers: string[] = [];
  if (afterRate <= beforeRate) blockers.push('目标结局的随机到达率未提高，请由作者调整方案');
  const errors = new Map<string, number>();
  for (const issue of before.lint.issues.filter(i => i.severity === 'error')) errors.set(issueKey(issue), (errors.get(issueKey(issue)) ?? 0) + 1);
  for (const issue of after.lint.issues.filter(i => i.severity === 'error')) {
    const key = issueKey(issue), count = errors.get(key) ?? 0;
    if (count) errors.set(key, count - 1);
    else blockers.push(`新增体检错误：${issue.message}`);
  }
  if (after.playtest.deadEnds > before.playtest.deadEnds) blockers.push('模拟死路数增加');
  for (const check of before.playtest.checks.filter(c => c.pass)) {
    if (!after.playtest.checks.some(c => c.id === check.id && c.pass)) blockers.push(`原先通过的 ${check.id} 检查未通过`);
  }
  return {seeds: REPAIR_SEEDS, beforeRate, afterRate, beforeErrors: before.lint.errors, afterErrors: after.lint.errors,
    beforeDeadEnds: before.playtest.deadEnds, afterDeadEnds: after.playtest.deadEnds, allowed: !blockers.length, blockers};
}
