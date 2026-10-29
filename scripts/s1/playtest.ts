// CLI: headless playtest (§6.7).  tsx scripts/s1/playtest.ts <file.json> [--seeds 200] [--route-seeds N] [--plan production-plan.json] [--no-routes]
//   [--guidance] [--apply-guidance out.json] [--json]
// --apply-guidance writes a PATCHED COPY (input untouched) for the author to review and import; nothing is published.
import { readFileSync, writeFileSync } from 'node:fs';
import { worldContentSchema } from '@novel-game/contracts';
import { btgWorldFileToContent, isBtgWorldFile } from '@novel-game/rules/preflight';
import { applyGuidance, simulateWorld } from '@novel-game/play-runtime/sim';
const args = process.argv.slice(2);
const valueOf = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && !/^\d+$/.test(a) && !['--plan', '--seeds', '--route-seeds', '--apply-guidance'].includes(args[i - 1] ?? ''));
if (!file) { console.error('usage: playtest.ts <file.json> [--seeds N] [--json]'); process.exit(2); }
const si = args.indexOf('--seeds'); const seeds = si >= 0 ? Number(args[si + 1]) : 200;
let raw = JSON.parse(readFileSync(file, 'utf8'));
if (isBtgWorldFile(raw)) raw = btgWorldFileToContent(raw);
const content = worldContentSchema.parse(raw);
// Planned routes: a ProductionPlan JSON (or {plan}) with routes[]; otherwise one goal strategy per ending.
const planFile = valueOf('--plan');
const plan = planFile ? JSON.parse(readFileSync(planFile, 'utf8')) : undefined;
const routes = args.includes('--no-routes') ? false as const
  : (plan?.routes ?? plan?.plan?.routes)?.map((r: {id: string; name: string; endingIds: string[]}) => ({id: r.id, name: r.name, endingIds: r.endingIds})) ?? 'auto' as const;
const routeSeeds = valueOf('--route-seeds') ? Number(valueOf('--route-seeds')) : undefined;
const report = await simulateWorld({id: 'cli', draftId: 'cli', sourceId: 'cli', content, version: 1, createdAt: new Date().toISOString()},
  {seeds, routes, ...(routeSeeds ? {routeSeeds} : {}), guidance: args.includes('--guidance') || !!valueOf('--apply-guidance')});
const applyOut = valueOf('--apply-guidance');
if (applyOut) {
  const edits = report.routeCoverage?.guidance?.flatMap(h => h.edits) ?? [];
  const patched = worldContentSchema.parse(applyGuidance(content, edits));
  writeFileSync(applyOut, JSON.stringify(patched, null, 1));
  console.error(`wrote ${edits.length} guidance edit(s) to ${applyOut} (copy for review; input unchanged)`);
}
if (args.includes('--json')) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }
console.log(`${report.strategies.length} strategies × ${report.seeds} seeds · ${report.durationMs} ms · dead ends ${report.deadEnds} · locked ${(report.lockedRatio * 100).toFixed(1)}%`);
for (const s of report.strategies) console.log(`  ${s.label.padEnd(6)} median ${JSON.stringify(report.medians[s.id])} endings ${JSON.stringify(report.endingRates[s.id])}`);
console.log('  never drawn:', report.cards.neverDrawn.join(',') || '—', '· consecutive repeat', report.cards.consecutiveRepeatRate.toFixed(3));
console.log('  pinned:', JSON.stringify(report.pinnedRatio)); console.log('  gates never met:', report.gatesNeverMet.join(',') || '—');
for (const c of report.checks) console.log(`  ${c.pass ? '✓' : '✗'} ${c.id} ${c.label}：线 ${c.line} · 实测 ${c.measured}`);
const rc = report.routeCoverage;
if (rc) {
  console.log(`  route coverage (${rc.seeds} seeds/route, pacing line ${rc.pacing.decisions} decisions / ${rc.pacing.uniqueChars} chars):`);
  for (const e of rc.endings) console.log(`    ${e.status.padEnd(10)} ${e.id} 「${e.title}」 generic ${(e.bestGeneric * 100).toFixed(0)}% · goal ${e.goalRate === undefined ? '—' : `${(e.goalRate * 100).toFixed(0)}%`}`);
  for (const r of rc.routes.filter(r => r.source === 'plan')) console.log(`    route ${r.id} 「${r.name}」 hit ${(r.hitRate * 100).toFixed(0)}% median ${JSON.stringify(r.medians)}`);
  for (const i of rc.issues) console.log(`    ${i.severity} ${i.ruleId} ${i.message}`);
}
const pc = report.pacing;
if (pc) {
  console.log(`  pacing: ${pc.belowLine ? 'BELOW line' : 'ok'} · authored ${pc.estimate.authoredChars} chars · shortest ordinary ending ≥ ${pc.estimate.shortestOrdinary ?? '—'} decisions (static)`);
  for (const r of pc.estimate.rows) console.log(`    ${r.endingId.padEnd(12)} est ≥${r.estimateMin} · sim min ${r.simulatedMin ?? '—'} · random ${(r.randomShare * 100).toFixed(0)}%${r.randomMedian !== undefined ? ` @${r.randomMedian}` : ''}`);
  for (const c of pc.causes) console.log(`    ${c.ruleId} ${c.message}\n      → ${c.suggestion}`);
}
