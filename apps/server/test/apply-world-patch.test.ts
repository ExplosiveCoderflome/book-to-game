import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZodError } from 'zod';
import type { WorldContent } from '@novel-game/contracts';
import { worldCommands } from '../src/app/commands/worlds.js';
import type { Workbench } from '../src/app/workbench.js';
import { WorldService, SqliteWorldRepository } from '../src/modules/worlds/index.js';
import { openDatabase } from '../src/platform/database.js';
import { AppError } from '../src/shared/errors.js';
import { content, source } from './helpers/open-fixture.js';

function setup() {
  const db = openDatabase(':memory:');
  const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
  const world: WorldContent = {...content(),
    clock: {unit: 'month', startYear: 1, startMonth: 1, limitMonths: 12},
    storylets: [{id: 'rain', title: '雨夜', text: '雨声敲窗。', locationIds: ['dock'],
      choices: [{id: 'wait', label: '等待', timeCost: 1, effects: [], text: '你等着。'}]}],
  };
  const draft = worlds.create({sourceId: source.id, content: world});
  const commands = worldCommands({worlds} as unknown as Workbench);
  const command = (name: string) => {
    const found = commands.find(item => item.name === name);
    assert.ok(found, `missing command ${name}`);
    return found;
  };
  return {db, worlds, draft, command};
}

type Proposal = {baseVersion: number; changes: {path: string; op: string; before?: unknown; after?: unknown}[]};

test('V1 apply clock patch: propose then apply writes fields once and bumps version', async () => {
  const ctx = setup();
  try {
    const before = ctx.worlds.get(ctx.draft.id);
    const proposal = await ctx.command('propose_clock_patch').execute({
      worldDraftId: ctx.draft.id, unit: 'day', limitMonths: 30, intent: '改成日单位',
    }) as Proposal;
    const result = ctx.command('apply_world_patch').execute({
      worldDraftId: ctx.draft.id, version: proposal.baseVersion, changes: proposal.changes,
    }) as {draft: {version: number; content: WorldContent}; applied: number};

    assert.equal(result.applied, 2);
    assert.equal(result.draft.version, before.version + 1);
    assert.equal(result.draft.content.clock?.unit, 'day');
    assert.equal(result.draft.content.clock?.limitMonths, 30);
    const stored = ctx.worlds.get(ctx.draft.id);
    assert.equal(stored.version, before.version + 1);
    assert.equal(stored.content.clock?.unit, 'day');
    assert.equal(stored.content.storylets?.[0]?.title, '雨夜', 'unrelated content is preserved');
    assert.equal(ctx.command('apply_world_patch').readOnly, false);
    assert.equal(ctx.command('apply_world_patch').confirmation, 'confirm');
    assert.equal(ctx.command('apply_world_patch').risk, 'write');
  } finally { ctx.db.close(); }
});

test('V1 apply storylet patch: field replace and new card add land in one write', async () => {
  const ctx = setup();
  try {
    const updated = await ctx.command('propose_storylet_patch').execute({
      worldDraftId: ctx.draft.id, storyletId: 'rain', title: '大雨夜', text: '雨更大了。',
    }) as Proposal;
    const afterUpdate = ctx.command('apply_world_patch').execute({
      worldDraftId: ctx.draft.id, version: updated.baseVersion, changes: updated.changes,
    }) as {draft: {version: number; content: WorldContent}};
    assert.equal(afterUpdate.draft.content.storylets?.[0]?.title, '大雨夜');
    assert.equal(afterUpdate.draft.content.storylets?.[0]?.text, '雨更大了。');

    const added = await ctx.command('propose_storylet_patch').execute({
      worldDraftId: ctx.draft.id, title: '晨雾', intent: '清晨的渡口事件', locationIds: ['dock'],
    }) as Proposal;
    const afterAdd = ctx.command('apply_world_patch').execute({
      worldDraftId: ctx.draft.id, version: added.baseVersion, changes: added.changes,
    }) as {draft: {version: number; content: WorldContent}};
    assert.equal(afterAdd.draft.content.storylets?.length, 2);
    assert.equal(afterAdd.draft.content.storylets?.[1]?.title, '晨雾');
    assert.equal(ctx.worlds.get(ctx.draft.id).version, afterUpdate.draft.version + 1);
  } finally { ctx.db.close(); }
});

test('V1 apply world patch rejects a stale version without writing', () => {
  const ctx = setup();
  try {
    const before = ctx.worlds.get(ctx.draft.id);
    assert.throws(() => ctx.command('apply_world_patch').execute({
      worldDraftId: ctx.draft.id, version: before.version + 5,
      changes: [{path: 'clock.unit', op: 'replace', after: 'day'}],
    }), (error: unknown) => error instanceof AppError && error.code === 'DRAFT_VERSION_CONFLICT' && error.status === 409);
    assert.deepEqual(ctx.worlds.get(ctx.draft.id).content, before.content);
    assert.equal(ctx.worlds.get(ctx.draft.id).version, before.version);
  } finally { ctx.db.close(); }
});

test('V1 apply world patch rejects bad paths, whole replacements and oversized after', () => {
  const ctx = setup();
  try {
    const before = ctx.worlds.get(ctx.draft.id);
    const apply = (changes: unknown[]) => ctx.command('apply_world_patch').execute({
      worldDraftId: ctx.draft.id, version: before.version, changes,
    });
    const invalid = (error: unknown) => error instanceof AppError && error.code === 'WORLD_PATCH_INVALID' && error.status === 422;

    assert.throws(() => apply([{path: 'title', op: 'replace', after: '改名'}]), invalid);
    assert.throws(() => apply([{path: '.clock', op: 'replace', after: {}}]), invalid);
    assert.throws(() => apply([{path: 'storylets', op: 'replace', after: []}]), invalid);
    assert.throws(() => apply([{path: 'storylets.missing.title', op: 'replace', after: 'x'}]), invalid);
    assert.throws(() => apply([{path: 'clock.unit', op: 'replace', after: 'x'.repeat(4001)}]),
      (error: unknown) => error instanceof ZodError || invalid(error));
    assert.deepEqual(ctx.worlds.get(ctx.draft.id).content, before.content, 'invalid patches write nothing');
    assert.equal(ctx.worlds.get(ctx.draft.id).version, before.version);
  } finally { ctx.db.close(); }
});
