import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createWorkbench } from '../src/app/workbench.js';
import { SqliteModelSettingsRepository, ModelSettingsService } from '../src/modules/model-settings/index.js';
import { openDatabase } from '../src/platform/database.js';
import { AppError } from '../src/shared/errors.js';
import { createCommands } from '../src/app/commands/index.js';
import { content } from './helpers/open-fixture.js';

async function setup() {
  const db = openDatabase(':memory:');
  const settings = new ModelSettingsService(new SqliteModelSettingsRepository(db), {encrypt: value => value, decrypt: value => value},
    {baseUrl: '', model: '', apiKey: '', timeoutMs: 1000, streamIdleTimeoutMs: 1000, streamTotalTimeoutMs: 1000});
  const dataDir = await mkdtemp(path.join(tmpdir(), 'idea-world-test-'));
  const workbench = createWorkbench(db, settings, undefined, {dataDir});
  return {db, workbench, dataDir};
}

test('idea creates a source-linked world draft without novel or production job and is idempotent', async () => {
  const {db, workbench, dataDir} = await setup();
  try {
    const command = createCommands(workbench).find(item => item.name === 'create_world_from_idea')!;
    const requestId = randomUUID();
    const input = {requestId, title: '山谷经营', idea: '经营一间山谷驿站，在季节变换前修复道路。', sourceIds: [], content: {...content(), title: '山谷经营'}};
    const first = command.execute(input) as {id: string; sourceId: string; version: number};
    const retry = command.execute(input) as typeof first;
    assert.equal(retry.id, first.id);
    assert.equal(retry.sourceId, first.sourceId);
    assert.equal(workbench.sources.list().length, 1);
    assert.equal(workbench.worlds.list().length, 1);
    assert.equal(workbench.jobs.list().length, 0);
    assert.match(workbench.sources.get(first.sourceId).chapters[0]!.paragraphs[0]!.text, /经营一间山谷驿站/);
    assert.throws(() => command.execute({...input, idea: '不同想法'}), (error: unknown) => error instanceof AppError && error.code === 'REQUEST_ID_CONFLICT');
    assert.equal(workbench.sources.list().length, 1);
    assert.equal(workbench.worlds.list().length, 1);
  } finally { db.close(); await rm(dataDir, {recursive: true, force: true}); }
});

test('failed idea creation rolls back source and request mapping', async () => {
  const {db, workbench, dataDir} = await setup();
  try {
    const command = createCommands(workbench).find(item => item.name === 'create_world_from_idea')!;
    const invalidContent = content();
    invalidContent.actions[0]!.effects = [{kind: 'move', locationId: 'missing_location'}];
    const input = {requestId: randomUUID(), title: '坏世界', idea: '无效引用', sourceIds: [], content: invalidContent};
    assert.throws(() => command.execute(input));
    assert.equal(workbench.sources.list().length, 0);
    assert.equal(workbench.worlds.list().length, 0);
    assert.equal(workbench.jobs.list().length, 0);
  } finally { db.close(); await rm(dataDir, {recursive: true, force: true}); }
});

test('idea creation preserves omitted optional block parameters through the shared validator', async () => {
  const {db, workbench, dataDir} = await setup();
  try {
    const library = workbench.blockLibrary;
    const original = library.get('block', 'clock');
    const optionalSpec = {...original.data, id: 'test-idea-optional', requires: [], params: [
      {key: 'optional_text', label: '可选文本', type: 'string' as const, required: false},
    ]};
    library.upsert('block', {id: optionalSpec.id, expectedVersion: 0, data: optionalSpec});
    const command = createCommands(workbench).find(item => item.name === 'create_world_from_idea')!;
    const ideaContent = {...content(), blockSelections: [{blockId: optionalSpec.id, version: 1, params: {}}]};
    const input = {requestId: randomUUID(), title: '可选参数', idea: '可选字段应允许省略。', sourceIds: [], content: ideaContent};
    const result = command.execute(input) as {content: {blockSelections: {params: Record<string, unknown>}[]}};
    assert.deepEqual(result.content.blockSelections[0]?.params, {});
  } finally { db.close(); await rm(dataDir, {recursive: true, force: true}); }
});
