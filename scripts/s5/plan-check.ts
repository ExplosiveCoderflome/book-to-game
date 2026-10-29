// CLI (S5): rule-level check of a ProductionPlan before prose — no model calls.
//   tsx scripts/s5/plan-check.ts <plan.json> [--json] [--no-probe]
// <plan.json>: a full ProductionPlan, {plan: ProductionPlan}, or {world, routes}. Exit code 1 when the plan would be blocked.
import { readFileSync } from 'node:fs';
import { worldContentSchema } from '@novel-game/contracts';
import { checkPlanWorld } from '@novel-game/play-runtime/sim';
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('usage: plan-check.ts <plan.json> [--json] [--no-probe]'); process.exit(2); }
const raw = JSON.parse(readFileSync(file, 'utf8'));
const plan = raw.plan ?? raw;
const world = worldContentSchema.parse(plan.world);
const routes = (plan.routes ?? []).map((r: {id: string; name: string; endingIds: string[]}) => ({id: r.id, name: r.name, endingIds: r.endingIds}));
const report = checkPlanWorld(world, routes, {probe: !args.includes('--no-probe')});
if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`${report.blocking ? 'BLOCKED' : 'ok'} · errors ${report.errors} · warnings ${report.warnings} · shortest ordinary ending ≥ ${report.shortestOrdinary ?? '—'} decisions (static)`);
  for (const r of report.routes) console.log(`  route ${r.id} 「${r.name}」 probe hit ${(r.hitRate * 100).toFixed(0)}%`);
  for (const i of report.issues) console.log(`  ${i.severity} ${i.ruleId} ${i.message}\n    → ${i.suggestion}`);
}
process.exit(report.blocking ? 1 : 0);
