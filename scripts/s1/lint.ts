// CLI: lint v2 over a WorldContent / btg.world / story JSON file.  tsx scripts/s1/lint.ts <file.json> [--tier S|M|L] [--json]
import { readFileSync } from 'node:fs';
import { btgWorldFileToContent, isBtgWorldFile, lintStory, lintWorld } from '@novel-game/rules/preflight';
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('usage: lint.ts <file.json> [--tier S|M|L] [--json]'); process.exit(2); }
const tierIdx = args.indexOf('--tier'); const tier = tierIdx >= 0 ? args[tierIdx + 1] as 'S' | 'M' | 'L' : undefined;
let content = JSON.parse(readFileSync(file, 'utf8'));
if (content.content && (content.content.scenes || content.content.locations)) content = content.content;
if (isBtgWorldFile(content)) content = btgWorldFileToContent(content);
const report = content.mode === 'story' ? lintStory(content, {tier}) : lintWorld(content, {tier});
if (args.includes('--json')) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }
console.log(`${report.contentKind} · tier ${report.tier} · ${report.errors} error · ${report.warnings} warning · blocking=${report.blocking} · ${JSON.stringify(report.stats)}`);
for (const i of report.issues) console.log(`  ${i.severity === 'error' ? 'E' : 'W'} [${i.category}/${i.ruleId}] ${i.message}`);
for (const c of report.checks) console.log(`  ${c.pass ? '✓' : '✗'} ${c.id} ${c.label}：线 ${c.line} · 实测 ${c.measured}`);
