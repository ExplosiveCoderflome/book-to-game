import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqliteDatabase as Database } from '../src/platform/database.js';
import { WorldService, SqliteWorldRepository } from '../src/modules/worlds/index.js';
import { AdventureService, SqliteAdventureRepository } from '../src/modules/adventure-sessions/index.js';
import { clearNpcDialogCache, npcDialogAdventure } from '../src/modules/adventure-sessions/application/npc-dialog.js';
import {
  clearPlayAiCache, playAiCallCount, resetPlayAiBudgets, runPlayAi,
} from '../src/modules/play-ai/index.js';
import { source, content } from './helpers/open-fixture.js';
import { AppError } from '../src/shared/errors.js';
import { openDatabase } from '../src/platform/database.js';
import { createWorkbench } from '../src/app/workbench.js';
import { createCommands } from '../src/app/commands/index.js';
import { createModelSettings } from '../src/platform/create-model-settings.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { seedWorldRevision } from './helpers/runtime-revision-fixture.js';

test('play-ai: narration ok path caches per key, force bypasses, budget counts calls', async () => {
  clearPlayAiCache();
  resetPlayAiBudgets();
  let calls = 0;
  const model = {
    async narrate() {
      calls += 1;
      return {narration: `  雾气低垂 ${calls}  `};
    },
  };
  const context = {
    kind: 'narration' as const,
    sceneTitle: '渡口', sceneText: '雾起。', choices: [], variables: {},
    worldbookSnippets: [],
  };
  const first = await runPlayAi({kind: 'narration', model, context, cacheKey: 'k1', budget: {sessionId: 's1', maxCallsPerSession: 2}});
  assert.equal(first.status, 'ok');
  assert.equal(first.text, '雾气低垂 1');
  assert.equal(first.cached, false);

  const hit = await runPlayAi({kind: 'narration', model, context, cacheKey: 'k1', budget: {sessionId: 's1', maxCallsPerSession: 2}});
  assert.equal(hit.cached, true);
  assert.equal(hit.text, first.text);
  assert.equal(calls, 1);

  const forced = await runPlayAi({kind: 'narration', model, context, cacheKey: 'k1', force: true, budget: {sessionId: 's1', maxCallsPerSession: 2}});
  assert.equal(forced.cached, false);
  assert.equal(calls, 2);
  assert.equal(playAiCallCount('s1'), 2);

  const blocked = await runPlayAi({kind: 'narration', model, context, cacheKey: 'k2', budget: {sessionId: 's1', maxCallsPerSession: 2}});
  assert.equal(blocked.status, 'unavailable');
  assert.match(blocked.reason ?? '', /额度/);
  assert.equal(calls, 2);
});

test('play-ai: soft-fails on model errors and does not cache failures', async () => {
  clearPlayAiCache();
  const model = {async narrate() { throw new AppError('MODEL_HTTP_ERROR', '模型挂了', 502); }};
  const context = {
    kind: 'narration' as const,
    sceneTitle: 'x', sceneText: 'y', choices: [], variables: {}, worldbookSnippets: [],
  };
  const result = await runPlayAi({kind: 'narration', model, context, cacheKey: 'fail'});
  assert.equal(result.status, 'unavailable');
  assert.equal(result.text, null);
  assert.match(result.reason ?? '', /模型/);
});

test('play-ai: npc_dialog reports unavailable when the provider lacks that surface', async () => {
  const result = await runPlayAi({
    kind: 'npc_dialog',
    model: {async narrate() { return {narration: 'x'}; }},
    context: {
      kind: 'npc_dialog', npcName: '守门人', sceneTitle: '渡口', sceneText: '船影。',
      variables: {}, worldbookSnippets: [],
    },
  });
  assert.equal(result.status, 'unavailable');
  assert.match(result.reason ?? '', /NPC/);
});

function setupAdventure() {
  clearNpcDialogCache();
  clearPlayAiCache();
  resetPlayAiBudgets();
  const db = new Database(':memory:');
  const worlds = new WorldService(new SqliteWorldRepository(db), { get: () => structuredClone(source) });
  const adventures = new AdventureService(new SqliteAdventureRepository(db), worlds);
  const draft = worlds.create({ sourceId: source.id, content: content() });
  const revision = seedWorldRevision(db, draft);
  const view = adventures.start({ worldRevisionId: revision.id });
  return { db, worlds, adventures, view };
}

test('npc-dialog: only visible NPCs get a bubble, and state is untouched', async () => {
  const { db, adventures, worlds, view } = setupAdventure();
  try {
    const before = structuredClone(adventures.get(view.id));
    let called = 0;
    const result = await npcDialogAdventure(adventures, worlds, view.id, { npcId: 'keeper', expectedTurn: 0 }, {
      async narrate() { throw new Error('should not be used'); },
      async npcDialog(input) {
        called += 1;
        assert.equal(input.npcName, '守门人');
        assert.equal(input.sceneTitle, 'dock');
        return {dialog: '雾大，早些过河吧。'};
      },
    });
    assert.equal(result.status, 'ok');
    assert.equal(result.npcId, 'keeper');
    assert.equal(result.sceneId, 'dock');
    assert.match(result.text ?? '', /雾大/);
    assert.equal(called, 1);
    assert.deepEqual(adventures.get(view.id), before);

    const cached = await npcDialogAdventure(adventures, worlds, view.id, { npcId: 'keeper', expectedTurn: 0 }, {
      async narrate() { throw new Error('should not be used'); },
      async npcDialog() { called += 1; return {dialog: '不应再次调用'}; },
    });
    assert.equal(cached.cached, true);
    assert.equal(called, 1);

    await assert.rejects(
      () => npcDialogAdventure(adventures, worlds, view.id, { npcId: 'ghost' }, {
        async narrate() { return {narration: 'x'}; },
      }),
      (error: unknown) => error instanceof AppError && error.code === 'NPC_NOT_VISIBLE',
    );
  } finally { db.close(); clearNpcDialogCache(); clearPlayAiCache(); resetPlayAiBudgets(); }
});

test('npc-dialog: soft-fails when the model throws', async () => {
  const { db, adventures, worlds, view } = setupAdventure();
  try {
    const before = structuredClone(adventures.get(view.id));
    const result = await npcDialogAdventure(adventures, worlds, view.id, { npcId: 'keeper' }, {
      async narrate() { return {narration: 'x'}; },
      async npcDialog() { throw new AppError('MODEL_HTTP_ERROR', '模型挂了', 502); },
    });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.text, null);
    assert.match(result.reason ?? '', /模型/);
    assert.deepEqual(adventures.get(view.id), before);
  } finally { db.close(); clearNpcDialogCache(); clearPlayAiCache(); }
});

test('npc-dialog: respects stale turn', async () => {
  const { db, adventures, worlds, view } = setupAdventure();
  try {
    await assert.rejects(
      () => npcDialogAdventure(adventures, worlds, view.id, { npcId: 'keeper', expectedTurn: 9 }, {
        async narrate() { return {narration: 'x'}; },
      }),
      (error: unknown) => error instanceof AppError && error.code === 'STALE_TURN',
    );
  } finally { db.close(); clearNpcDialogCache(); clearPlayAiCache(); }
});

function setupWorkbench() {
  const db = openDatabase(':memory:');
  const dir = mkdtempSync(path.join(tmpdir(), 'play-ai-'));
  const workbench = createWorkbench(db, createModelSettings(db, dir, {baseUrl: 'https://api.example.test/v1', model: '', apiKey: '', timeoutMs: 90000}));
  return {db, dir, workbench};
}

test('npc_dialog_adventure command is registered and soft-fails without a provider', async () => {
  const {db, dir, workbench} = setupWorkbench();
  try {
    const commands = createCommands(workbench);
    const command = commands.find(candidate => candidate.name === 'npc_dialog_adventure');
    assert.ok(command, 'npc_dialog_adventure command registered');
    assert.equal(command.readOnly, false);

    const worlds = workbench.worlds;
    const imported = workbench.sources.importFile({title: '渡口', filename: 'story.txt', bytes: Buffer.from('第一章\n渡口有船。\n\n第二章\n秘密。')});
    const worldContent = {...content(), sourceChapterIds: imported.chapters.map(chapter => chapter.id)};
    const draft = worlds.create({sourceId: imported.id, content: worldContent});
    const revision = seedWorldRevision(db, draft);
    const view = workbench.adventures.start({worldRevisionId: revision.id});
    const result = await command.execute({id: view.id, npcId: 'keeper'}) as {status: string; text: string | null; reason: string | null};
    assert.equal(result.status, 'unavailable');
    assert.equal(result.text, null);
    assert.match(result.reason ?? '', /模型/);
  } finally {
    db.close();
    rmSync(dir, {recursive: true, force: true});
  }
});
