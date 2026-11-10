import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BLOCKS, BLOCK_SHELVES, blockShelfIdSchema, blockSpecSchema, getBlock, getBlockCatalog, getBlockShelves, lintBlocks,
  type BlockSpec,
} from '@novel-game/contracts';
import { openDatabase } from '../src/platform/database.js';
import { createWorkbench } from '../src/app/workbench.js';
import { createCommands } from '../src/app/commands/index.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('V0b: 22 blocks parse, expose the closed catalog shape, and lint clean', () => {
  assert.equal(BLOCKS.length, 22);
  assert.deepEqual(BLOCKS.map(b => b.id), [
    'stat-templates', 'opening-roll', 'world-map', 'building-library', 'item-catalog', 'storylet-pool',
    'endings-recap', 'end-conditions', 'clock', 'encounters',
    'shop-cycle', 'customer-flow', 'ledger',
    'growth-curve', 'loot-table', 'combat-stake',
    'fact-evidence-ledger',
    'ai-narration', 'ai-npc-dialog', 'ai-slot-template',
    'preflight-sim', 'state-snapshot',
  ]);
  for (const block of BLOCKS) {
    assert.deepEqual(blockSpecSchema.parse(block), block);
    assert.ok(block.version >= 1);
    assert.ok(block.provides.length >= 1, `${block.id} must provide something`);
    assert.ok(block.shelves.length >= 1, `${block.id} must belong to a shelf`);
    for (const shelf of block.shelves) assert.ok(blockShelfIdSchema.safeParse(shelf).success);
  }
  assert.deepEqual(getBlockCatalog().map(b => b.id), BLOCKS.map(b => b.id));
  assert.deepEqual(getBlockCatalog().map(b => b.shelves), BLOCKS.map(b => b.shelves));
  assert.equal(getBlock('clock')?.id, 'clock');
  assert.equal(getBlock('missing'), undefined);
  assert.deepEqual(lintBlocks(), []);
});

test('V0b: 经营/成长货架积木以桩形式注册，compile-down 不新增运行时', () => {
  const shop = ['shop-cycle', 'customer-flow', 'ledger'];
  const growth = ['growth-curve', 'loot-table', 'combat-stake'];
  for (const id of [...shop, ...growth]) {
    const block = getBlock(id);
    assert.ok(block, `missing block ${id}`);
    assert.deepEqual(blockSpecSchema.parse(block), block);
    assert.ok(block.provides.length >= 1, `${id} must provide something`);
    assert.ok(block.label.length > 0 && block.blurb.length > 0);
  }
  assert.deepEqual(getBlock('shop-cycle')!.composesWith.dependsOn, ['clock', 'item-catalog', 'stat-templates']);
  assert.deepEqual(getBlock('growth-curve')!.composesWith.dependsOn, ['stat-templates']);
  assert.deepEqual(getBlock('loot-table')!.composesWith.dependsOn, ['encounters', 'item-catalog']);
  assert.deepEqual(getBlock('combat-stake')!.composesWith.dependsOn, ['encounters', 'stat-templates']);
  assert.ok(getBlock('combat-stake')!.provides.includes('facts'));
  assert.ok(getBlock('combat-stake')!.provides.includes('actions'));
  assert.match(getBlock('combat-stake')!.blurb, /桩|无独立战斗引擎/);
});

test('V0b: requires only reference known substrate contracts and composesWith resolves', () => {
  for (const block of BLOCKS) {
    for (const require of block.requires) {
      assert.ok((blockSpecSchema.shape.requires as any).element.options.includes(require), `${block.id} unknown require ${require}`);
    }
    for (const dep of block.composesWith.dependsOn) {
      assert.ok(BLOCKS.some(b => b.id === dep), `${block.id} dependsOn unknown ${dep}`);
    }
    for (const conflict of block.composesWith.conflictsWith) {
      assert.ok(BLOCKS.some(b => b.id === conflict), `${block.id} conflictsWith unknown ${conflict}`);
    }
  }
  // Cross references both directions: endings-recap ↔ storylet-pool, encounters/building-library/page.
  assert.deepEqual(getBlock('storylet-pool')!.composesWith.dependsOn, []);
  assert.ok(getBlock('endings-recap')!.composesWith.dependsOn.includes('storylet-pool'));
  assert.ok(getBlock('encounters')!.composesWith.dependsOn.includes('building-library'));
});

test('V0b: blockParams enforce select options and integer defaults', () => {
  const clock = getBlock('clock')!;
  const unit = clock.params.find(p => p.key === 'unit')!;
  assert.deepEqual(unit.options, ['day', 'week', 'month', 'year']);
  assert.equal(unit.default, 'month');
  assert.throws(() => blockSpecSchema.parse({...clock, params: [{...unit, options: undefined}]}));
  assert.throws(() => blockSpecSchema.parse({
    ...getBlock('preflight-sim')!,
    params: [{key: 'pacing_decisions', label: 'x', type: 'integer', default: 1.5}],
  }));
});

test('V0b: list_blocks is a read-only command providing funTags/requires/params', () => {
  const db = openDatabase(':memory:');
  const dir = mkdtempSync(path.join(tmpdir(), 'v0b-blocks-'));
  const workbench = createWorkbench(db, createModelSettings(db, dir, {baseUrl: 'https://api.example.test/v1', model: '', apiKey: '', timeoutMs: 90000}));
  try {
    const commands = createCommands(workbench);
    const command = commands.find(c => c.name === 'list_blocks')!;
    assert.ok(command, 'list_blocks command registered');
    assert.equal(command.readOnly, true);
    const result = command.execute({}) as {blocks: unknown[]; shelves: {id: string; label: string}[]; lint: unknown[]};
    assert.equal(result.blocks.length, 22);
    assert.deepEqual(result.shelves.map(shelf => shelf.id), ['foundation', 'world-content', 'commerce', 'combat-growth', 'ops', 'ai-live']);
    assert.ok(result.shelves.every(shelf => shelf.label.length > 0));
    assert.deepEqual(result.lint, []);
    const first = result.blocks[0] as Record<string, unknown>;
    assert.ok('funTags' in first && 'requires' in first && 'params' in first && 'provides' in first && 'acceptance' in first && 'shelves' in first);
    assert.ok(Array.isArray(first.shelves) && (first.shelves as string[]).length >= 1);
  } finally {
    db.close();
    rmSync(dir, {recursive: true, force: true});
  }
});
test('V0b: shop shelves group every block; schema rejects empty/unknown shelves', () => {
  assert.deepEqual(BLOCK_SHELVES.map(shelf => shelf.id), ['foundation', 'world-content', 'commerce', 'combat-growth', 'ops', 'ai-live']);
  assert.deepEqual(getBlockShelves().map(shelf => shelf.id), ['foundation', 'world-content', 'commerce', 'combat-growth', 'ops', 'ai-live']);
  for (const shelf of BLOCK_SHELVES) assert.ok(shelf.label.length > 0, `${shelf.id} needs a Chinese label`);

  const groups = new Map<string, string[]>();
  for (const block of getBlockCatalog()) {
    for (const shelf of block.shelves) groups.set(shelf, [...(groups.get(shelf) ?? []), block.id]);
  }
  for (const shelf of BLOCK_SHELVES) {
    assert.ok((groups.get(shelf.id) ?? []).length > 0, `shelf ${shelf.id} is empty`);
  }
  assert.ok(groups.get('commerce')!.includes('shop-cycle'));
  assert.ok(groups.get('combat-growth')!.includes('encounters'));
  assert.ok(groups.get('world-content')!.includes('building-library'));
  assert.ok(groups.get('foundation')!.includes('stat-templates'));

  const clock = getBlock('clock')!;
  assert.throws(() => blockSpecSchema.parse({...clock, shelves: []}));
  assert.throws(() => blockSpecSchema.parse({...clock, shelves: ['not-a-shelf']}));

  assert.deepEqual(lintBlocks(), []);
  const shelfIds = new Set<string>(BLOCK_SHELVES.map(shelf => shelf.id));
  for (const block of BLOCKS) for (const shelf of block.shelves) assert.ok(shelfIds.has(shelf));
});

test('V0b: AI live shelf exposes narration, npc dialog and the universal slot template', () => {
  const narration = getBlock('ai-narration')!;
  assert.ok(narration.shelves.includes('ai-live'));
  assert.deepEqual(narration.provides, ['ai-overlay']);
  assert.equal(narration.params.find(param => param.key === 'enabled_default')?.default, false);
  assert.ok(narration.params.some(param => param.key === 'max_calls_per_session'));
  assert.ok(narration.params.some(param => param.key === 'max_chars'));
  assert.match(narration.blurb, /默认关|soft-fail|不改/);

  const npc = getBlock('ai-npc-dialog')!;
  assert.ok(npc.shelves.includes('ai-live'));
  assert.deepEqual(npc.requires, ['world.npcs', 'world.facts']);
  assert.ok(npc.params.some(param => param.key === 'target_npc_hint'));
  assert.ok(npc.params.some(param => param.key === 'max_turns_hint'));
  assert.deepEqual(npc.provides, ['ai-overlay']);

  const template = getBlock('ai-slot-template')!;
  assert.deepEqual(template.shelves, ['ai-live']);
  const trigger = template.params.find(param => param.key === 'trigger')!;
  assert.deepEqual(trigger.options, ['after-act', 'on-enter', 'on-demand']);
  const writeback = template.params.find(param => param.key === 'writeback')!;
  assert.deepEqual(writeback.options, ['narration', 'suggestion', 'dialog']);
  assert.ok(template.params.some(param => param.key === 'context_pack' && param.type === 'select'));
  assert.ok(template.params.some(param => param.key === 'recipe_hint'));
  assert.match(template.blurb, /配方/);

  const shelf = getBlockShelves().find(candidate => candidate.id === 'ai-live')!;
  assert.ok(shelf.label.length > 0);
  assert.ok(getBlockCatalog().filter(block => block.shelves.includes('ai-live')).length >= 3);
});

test('V0b: lintBlocks keeps AI blocks overlay-only and off the WorldContent path', () => {
  // No shipped block violates the AI overlay discipline.
  assert.deepEqual(lintBlocks(), []);
  const narration = getBlock('ai-narration')!;
  // A fabricated AI block that claims WorldContent provides is rejected by lint.
  const offending = {...narration, provides: ['ai-overlay', 'storylets'] as BlockSpec['provides']};
  assert.ok(lintBlocks([offending]).some(issue => issue.ruleId === 'blocks.ai-shelf-writes-world' && issue.severity === 'error'));
  // Conversely, an ai-overlay provider off the ai-live shelf is rejected.
  const overlayOffShelf = {...narration, shelves: ['world-content'] as BlockSpec['shelves']};
  assert.ok(lintBlocks([overlayOffShelf]).some(issue => issue.ruleId === 'blocks.ai-overlay-without-shelf'));
  for (const block of getBlockCatalog().filter(candidate => candidate.shelves.includes('ai-live'))) {
    assert.deepEqual(block.provides, ['ai-overlay'], `${block.id} must only emit ai-overlay`);
  }
});
