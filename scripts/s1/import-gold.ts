// Convert docs/samples/shoudeng/shoudeng.<batch>.world.json → fixtures/s1/shoudeng.<batch>.content.json (WorldContent + S1).
// Usage: tsx scripts/s1/import-gold.ts [batch2|batch1]   (default batch2 — the main gold fixture; batch1 is kept for regression/saves)
import { readFileSync, writeFileSync } from 'node:fs';
import { worldContentSchema } from '@novel-game/contracts';
import { btgWorldFileToContent } from '@novel-game/rules/preflight';
const batch = process.argv[2] ?? 'batch2';
if (!/^batch\d+$/.test(batch)) { console.error('usage: import-gold.ts [batchN]'); process.exit(2); }
const file = JSON.parse(readFileSync(`docs/samples/shoudeng/shoudeng.${batch}.world.json`, 'utf8'));
const content = btgWorldFileToContent(file, {goal: '在灯灭之前，决定是修上去、查下去、借回来，还是回家去。', sourceChapterIds: ['shoudeng-c1']});
const parsed = worldContentSchema.safeParse(content);
if (!parsed.success) { console.error(JSON.stringify(parsed.error.issues.slice(0, 20), null, 2)); process.exit(1); }
writeFileSync(`fixtures/s1/shoudeng.${batch}.content.json`, JSON.stringify(parsed.data, null, 2) + '\n');
console.log('ok', batch, parsed.data.storylets?.length, 'storylets', parsed.data.actions.length, 'actions');
