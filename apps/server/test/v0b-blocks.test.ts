import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BLOCKS, blockSpecSchema, getBlock, getBlockCatalog, lintBlocks,
} from '@novel-game/contracts';
import { openDatabase } from '../src/platform/database.js';
import { createWorkbench } from '../src/app/workbench.js';
import { createCommands } from '../src/app/commands/index.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('V0b: nine blocks parse, expose the closed catalog shape, and lint clean', () => {
  assert.equal(BLOCKS.length, 9);
  assert.deepEqual(BLOCKS.map(b => b.id), [
    'stat-templates', 'world-map', 'building-library', 'item-catalog', 'storylet-pool',
    'endings-recap', 'clock', 'encounters', 'preflight-sim',
  ]);
  for (const block of BLOCKS) {
    assert.deepEqual(blockSpecSchema.parse(block), block);
    assert.ok(block.version >= 1);
    assert.ok(block.provides.length >= 1, `${block.id} must provide something`);
  }
  assert.deepEqual(getBlockCatalog().map(b => b.id), BLOCKS.map(b => b.id));
  assert.equal(getBlock('clock')?.id, 'clock');
  assert.equal(getBlock('missing'), undefined);
  assert.deepEqual(lintBlocks(), []);
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
    const result = command.execute({}) as {blocks: unknown[]; lint: unknown[]};
    assert.equal(result.blocks.length, 9);
    assert.deepEqual(result.lint, []);
    const first = result.blocks[0] as Record<string, unknown>;
    assert.ok('funTags' in first && 'requires' in first && 'params' in first && 'provides' in first && 'acceptance' in first);
  } finally {
    db.close();
    rmSync(dir, {recursive: true, force: true});
  }
});