import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BLOCKS, FUN_PROFILES, getFunProfileCatalog,
} from '@novel-game/contracts';
import { openDatabase } from '../src/platform/database.js';
import { createWorkbench } from '../src/app/workbench.js';
import { createCommands } from '../src/app/commands/index.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('B: Catalog 对齐：每个画像 suggestedBlocks 都指向真实 Block id', () => {
  const blockIds = new Set(BLOCKS.map(b => b.id));
  for (const profile of FUN_PROFILES) {
    for (const blockId of profile.suggestedBlocks) {
      assert.ok(blockIds.has(blockId), `${profile.id} suggestedBlocks 引用未知积木 ${blockId}`);
    }
  }
  assert.deepEqual(getFunProfileCatalog().map(p => p.id), FUN_PROFILES.map(p => p.id));
});

test('B: list_fun_profiles 是只读命令，返回画像目录并携带 suggestedBlocks', () => {
  const db = openDatabase(':memory:');
  const dir = mkdtempSync(path.join(tmpdir(), 'v0b-fun-profiles-'));
  const workbench = createWorkbench(db, createModelSettings(db, dir, {baseUrl: 'https://api.example.test/v1', model: '', apiKey: '', timeoutMs: 90000}));
  try {
    const commands = createCommands(workbench);
    const command = commands.find(c => c.name === 'list_fun_profiles')!;
    assert.ok(command, 'list_fun_profiles command registered');
    assert.equal(command.readOnly, true);
    const result = command.execute({}) as {profiles: unknown[]};
    assert.equal(result.profiles.length, 5);
    const first = result.profiles[0] as Record<string, unknown>;
    assert.ok('funTags' in first && 'suggestedBlocks' in first && 'pacingLine' in first
      && 'strategies' in first && 'thresholds' in first && 'metricMatrix' in first);
    const ids = result.profiles.map(p => (p as {id: string}).id);
    assert.deepEqual(ids, ['default', 'pressure', 'healing', 'grinding', 'collection']);
  } finally {
    db.close();
    rmSync(dir, {recursive: true, force: true});
  }
});