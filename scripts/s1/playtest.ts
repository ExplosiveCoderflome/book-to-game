// CLI: headless playtest (§6.7).  tsx scripts/s1/playtest.ts <file.json> [--seeds 200] [--json]
import { readFileSync } from 'node:fs';
import { worldContentSchema } from '@novel-game/contracts';
import { btgWorldFileToContent, isBtgWorldFile } from '@novel-game/rules/preflight';
import { simulateWorld } from '@novel-game/play-runtime/sim';
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a));
if (!file) { console.error('usage: playtest.ts <file.json> [--seeds N] [--json]'); process.exit(2); }
const si = args.indexOf('--seeds'); const seeds = si >= 0 ? Number(args[si + 1]) : 200;
let raw = JSON.parse(readFileSync(file, 'utf8'));
if (isBtgWorldFile(raw)) raw = btgWorldFileToContent(raw);
const content = worldContentSchema.parse(raw);
const report = await simulateWorld({id: 'cli', draftId: 'cli', sourceId: 'cli', content, version: 1, createdAt: new Date().toISOString()}, {seeds});
if (args.includes('--json')) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }
console.log(`${report.strategies.length} strategies × ${report.seeds} seeds · ${report.durationMs} ms · dead ends ${report.deadEnds} · locked ${(report.lockedRatio * 100).toFixed(1)}%`);
for (const s of report.strategies) console.log(`  ${s.label.padEnd(6)} median ${JSON.stringify(report.medians[s.id])} endings ${JSON.stringify(report.endingRates[s.id])}`);
console.log('  never drawn:', report.cards.neverDrawn.join(',') || '—', '· consecutive repeat', report.cards.consecutiveRepeatRate.toFixed(3));
console.log('  pinned:', JSON.stringify(report.pinnedRatio)); console.log('  gates never met:', report.gatesNeverMet.join(',') || '—');
for (const c of report.checks) console.log(`  ${c.pass ? '✓' : '✗'} ${c.id} ${c.label}：线 ${c.line} · 实测 ${c.measured}`);
