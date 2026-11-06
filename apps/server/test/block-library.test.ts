import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getBlock, getFunProfile, getStatTemplate, upsertBlockOverrideInputSchema } from '@novel-game/contracts';
import { errorResponse } from '../src/adapters/errors.js';
import { openDatabase } from '../src/platform/database.js';
import {
  BlockLibraryService, SqliteBlockCatalogRepository, type CatalogReferenceSource,
} from '../src/modules/block-library/index.js';
import { PreflightService, SqlitePreflightRepository } from '../src/modules/preflight/index.js';
import { content as openContent } from './helpers/open-fixture.js';
import { createWorkbench } from '../src/app/workbench.js';
import { createCommands } from '../src/app/commands/index.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';

const noReferences: CatalogReferenceSource = {listStories: () => [], listWorlds: () => [], listGenerationJobs: () => []};
const service = (db: ReturnType<typeof openDatabase>, refs = noReferences) => new BlockLibraryService(new SqliteBlockCatalogRepository(db), refs);

function fails(code: string, run: () => unknown, message?: RegExp) {
  assert.throws(run, (error: unknown) => {
    assert.equal((error as {code?: string}).code, code);
    if (message) assert.match((error as Error).message, message);
    return true;
  });
}

test('block library: built-ins stay read-only and migration is idempotent', () => {
  const db = openDatabase(':memory:');
  try {
    const catalog = service(db);
    new SqliteBlockCatalogRepository(db);
    assert.equal(catalog.list('block').length, 20);
    assert.equal(catalog.list('fun-profile').length, 5);
    assert.equal(catalog.list('stat-template').length, 4);
    assert.equal(catalog.list('simulation-strategy').length, 9);
    assert.ok(catalog.view().issues.every(issue => issue.severity !== 'error'));
    assert.ok(catalog.view().blocks.every(entry => entry.origin === 'builtin'));
    fails('CATALOG_BUILTIN_READONLY', () => catalog.delete('block', {id: 'clock', expectedVersion: 1}), /内置条目只读/);
    assert.equal(getBlock('clock')?.version, 1);
  } finally { db.close(); }
});

test('block library: commands expose read-only reads and confirmed versioned writes', () => {
  const db = openDatabase(':memory:');
  const dir = mkdtempSync(path.join(tmpdir(), 'block-library-commands-'));
  try {
    const workbench = createWorkbench(db, createModelSettings(db, dir, {baseUrl: 'https://api.example.test/v1', model: '', apiKey: '', timeoutMs: 90000}));
    const commands = createCommands(workbench);
    for (const name of ['get_block_library', 'get_block', 'list_blocks', 'list_fun_profiles']) {
      const command = commands.find(candidate => candidate.name === name)!;
      assert.equal(command.readOnly, true, name);
      assert.equal(command.confirmation, 'auto', name);
    }
    const writes = commands.filter(command => /^(upsert|delete)_(block|fun_profile|stat_template|simulation_strategy)/.test(command.name));
    assert.equal(writes.length, 8);
    for (const command of writes) {
      assert.equal(command.readOnly, false, command.name);
      assert.equal(command.confirmation, 'confirm', command.name);
      assert.ok('expectedVersion' in command.inputSchema.shape, command.name);
    }
    const upsert = commands.find(command => command.name === 'upsert_simulation_strategy_override')!;
    const saved = upsert.execute({id: 'author_random', expectedVersion: 0,
      data: {id: 'author_random', version: 1, label: '作者随机', description: '作者维护的随机基线。', baseStrategy: 'random'}}) as {origin: string};
    assert.equal(saved.origin, 'custom');
    const view = commands.find(command => command.name === 'get_block_library')!.execute({}) as {simulationStrategies: {id: string}[]};
    assert.ok(view.simulationStrategies.some(entry => entry.id === 'author_random'));
  } finally { db.close(); rmSync(dir, {recursive: true, force: true}); }
});

test('block library: custom entries persist in SQLite and can be deleted when unreferenced', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'block-library-'));
  const file = path.join(dir, 'workbench.sqlite');
  const custom = {...getBlock('clock')!, id: 'clock_custom', label: '作者时钟'};
  try {
    let db = openDatabase(file);
    let catalog = service(db);
    const saved = catalog.upsert('block', {id: custom.id, expectedVersion: 0, data: custom});
    assert.equal(saved.origin, 'custom');
    assert.equal(saved.version, 1);
    db.close();
    db = openDatabase(file);
    catalog = service(db);
    assert.equal(catalog.get('block', custom.id).data.label, '作者时钟');
    assert.equal(catalog.list('block').length, 21);
    catalog.delete('block', {id: custom.id, expectedVersion: 1});
    assert.equal(catalog.list('block').length, 20);
    db.close();
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('block library: zod and cross-catalog lint return Chinese diagnostics without saving', () => {
  const db = openDatabase(':memory:');
  try {
    const catalog = service(db);
    fails('CATALOG_INVALID', () => catalog.upsert('block', {
      id: 'broken', expectedVersion: 0, data: {...getBlock('clock')!, id: 'broken', label: ''},
    }), /目录内容未通过校验/);
    assert.equal(catalog.getVersion('block', 'broken'), 0);
    fails('CATALOG_LINT_FAILED', () => catalog.upsert('block', {
      id: 'broken', expectedVersion: 0,
      data: {...getBlock('clock')!, id: 'broken', composesWith: {dependsOn: ['missing'], conflictsWith: []}},
    }), /不存在的积木/);
    assert.equal(catalog.getVersion('block', 'broken'), 0);
  } finally { db.close(); }
});

test('block library: HTTP zod errors include Chinese field diagnostics', () => {
  const parsed = upsertBlockOverrideInputSchema.safeParse({id: 'broken', expectedVersion: 0, data: {...getBlock('clock')!, id: 'broken', label: ''}});
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  const response = errorResponse(parsed.error);
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /输入不符合接口结构/);
  assert.match(response.body.error.message, /小于允许的最小值/);
});

test('block library: expectedVersion guards writes and structural edits require a version bump', () => {
  const db = openDatabase(':memory:');
  try {
    const catalog = service(db);
    const original = {...getBlock('clock')!, id: 'clock_custom'};
    catalog.upsert('block', {id: original.id, expectedVersion: 0, data: original});
    catalog.upsert('block', {id: original.id, expectedVersion: 1, data: {...original, label: '只改文案'}});
    fails('CATALOG_VERSION_BUMP_REQUIRED', () => catalog.upsert('block', {
      id: original.id, expectedVersion: 1, data: {...original, requires: ['world.locations']},
    }), /递增/);
    catalog.upsert('block', {id: original.id, expectedVersion: 1, data: {...original, version: 2, requires: ['world.locations']}});
    fails('CATALOG_CONFLICT', () => catalog.upsert('block', {
      id: original.id, expectedVersion: 1, data: {...original, version: 3},
    }), /当前版本 2/);
  } finally { db.close(); }
});

test('block library: copying a built-in creates an override without mutating the shipped registry', () => {
  const db = openDatabase(':memory:');
  try {
    const catalog = service(db);
    const saved = catalog.upsert('block', {id: 'clock', expectedVersion: 1, data: {...getBlock('clock')!, label: '自定义时钟'}});
    assert.equal(saved.origin, 'custom');
    assert.equal(saved.builtInVersion, 1);
    assert.equal(catalog.block('clock')?.label, '自定义时钟');
    assert.equal(getBlock('clock')?.label, '时钟');
    fails('CATALOG_REFERENCED', () => catalog.delete('block', {id: 'clock', expectedVersion: 1}), /仍被引用/);
  } finally { db.close(); }
});

test('block library: profiles and strategies resolve references and referenced deletes are blocked', () => {
  const db = openDatabase(':memory:');
  try {
    const catalog = service(db);
    const strategy = {id: 'random_custom', version: 1, label: '作者随机', description: '作者维护的随机基线。', baseStrategy: 'random' as const};
    catalog.upsert('simulation-strategy', {id: strategy.id, expectedVersion: 0, data: strategy});
    const block = {...getBlock('clock')!, id: 'author_block'};
    catalog.upsert('block', {id: block.id, expectedVersion: 0, data: block});
    const profile = {...getFunProfile('default')!, id: 'author_profile', strategies: ['random_custom'], suggestedBlocks: ['author_block']};
    catalog.upsert('fun-profile', {id: profile.id, expectedVersion: 0, data: profile});
    assert.deepEqual(catalog.funProfile(profile.id)?.strategies, ['random_custom']);
    fails('CATALOG_REFERENCED', () => catalog.delete('simulation-strategy', {id: strategy.id, expectedVersion: 1}), /画像 author_profile/);
    fails('CATALOG_REFERENCED', () => catalog.delete('block', {id: block.id, expectedVersion: 1}), /画像 author_profile/);
    catalog.delete('fun-profile', {id: profile.id, expectedVersion: 1});
    catalog.delete('simulation-strategy', {id: strategy.id, expectedVersion: 1});
    catalog.delete('block', {id: block.id, expectedVersion: 1});
  } finally { db.close(); }
});

test('block library: custom profile and strategy are usable by the existing simulator', async () => {
  const db = openDatabase(':memory:');
  try {
    const catalog = service(db);
    catalog.upsert('simulation-strategy', {id: 'random_custom', expectedVersion: 0,
      data: {id: 'random_custom', version: 1, label: '作者随机', description: '作者维护的随机基线。', baseStrategy: 'random'}});
    const profile = {...getFunProfile('default')!, id: 'author_profile', strategies: ['random_custom'], suggestedBlocks: ['clock']};
    catalog.upsert('fun-profile', {id: profile.id, expectedVersion: 0, data: profile});
    const preflight = new PreflightService(new SqlitePreflightRepository(db), {
      world: () => {throw new Error('not used');}, story: () => {throw new Error('not used');},
    }, undefined, catalog);
    const result = await preflight.inspectWorldDraft({id: 'world-1', sourceId: 'source', version: 1, content: openContent()},
      {seeds: 1, guidance: false, profile});
    assert.equal(result.playtest.profileId, 'author_profile');
    assert.deepEqual(result.playtest.strategies.map(strategy => strategy.id), ['random']);
    assert.equal(result.playtest.strategies[0]?.label, '作者随机');
  } finally { db.close(); }
});

test('block library: stat templates referenced by drafts or jobs cannot be deleted', () => {
  const db = openDatabase(':memory:');
  try {
    const template = {...getStatTemplate('trade_venture')!, id: 'author_stats'};
    const refs: CatalogReferenceSource = {
      listStories: () => [{id: 'story-1', content: {statTemplateId: 'author_stats'}}], listWorlds: () => [],
      listGenerationJobs: () => [{id: 'job-1', statTemplateId: 'author_stats'}],
    };
    const catalog = service(db, refs);
    catalog.upsert('stat-template', {id: template.id, expectedVersion: 0, data: template});
    fails('CATALOG_REFERENCED', () => catalog.delete('stat-template', {id: template.id, expectedVersion: 1}), /分支草稿 story-1/);
    assert.equal(catalog.statTemplate(template.id)?.label, template.label);
  } finally { db.close(); }
});
