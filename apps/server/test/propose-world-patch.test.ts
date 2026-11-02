import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorldContent } from '@novel-game/contracts';
import { worldCommands } from '../src/app/commands/worlds.js';
import { agentChatCommandMetadata, createAgentChatTools, type AgentChatCommandState } from '../src/app/agent-chat-tools.js';
import type { Workbench } from '../src/app/workbench.js';
import { WorldService, SqliteWorldRepository } from '../src/modules/worlds/index.js';
import { openDatabase } from '../src/platform/database.js';
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
  return {db, worlds, draft, commands, command};
}

test('V1 propose clock patch: small reviewable diff, read-only metadata, no draft drift', async () => {
  const ctx = setup();
  try {
    const before = ctx.worlds.get(ctx.draft.id);
    const proposal = await ctx.command('propose_clock_patch').execute({
      worldDraftId: ctx.draft.id, unit: 'day', limitMonths: 30, intent: '改成日单位',
    }) as {kind: string; baseVersion: number; changes: {path: string; before?: unknown; after?: unknown}[];
      warnings: string[]; model: string; worldDraftId: string};
    assert.equal(proposal.kind, 'clock');
    assert.equal(proposal.worldDraftId, ctx.draft.id);
    assert.equal(proposal.baseVersion, before.version);
    assert.equal(proposal.model, 'mock-clock-patch');
    assert.deepEqual(proposal.changes.map(change => change.path), ['clock.unit', 'clock.limitMonths']);
    assert.equal(proposal.changes[0]!.before, 'month');
    assert.equal(proposal.changes[0]!.after, 'day');
    assert.equal(proposal.changes[1]!.after, 30);
    assert.ok(JSON.stringify(proposal).length < 1200, 'proposal must stay small');
    assert.deepEqual(ctx.worlds.get(ctx.draft.id).content, before.content, 'proposal writes nothing');

    const command = ctx.command('propose_clock_patch');
    assert.equal(command.readOnly, true);
    assert.equal(command.confirmation, 'auto');
    assert.equal(command.risk, 'read');
  } finally { ctx.db.close(); }
});

test('V1 propose storylet patch: field diff for existing card and add proposal for a new one', async () => {
  const ctx = setup();
  try {
    const before = ctx.worlds.get(ctx.draft.id);
    const updated = await ctx.command('propose_storylet_patch').execute({
      worldDraftId: ctx.draft.id, storyletId: 'rain', title: '大雨夜', text: '雨更大了。',
    }) as {changes: {path: string; before?: unknown; after?: unknown}[]; warnings: string[]};
    assert.deepEqual(updated.changes.map(change => change.path), ['storylets.rain.title', 'storylets.rain.text']);
    assert.equal(updated.changes[0]!.before, '雨夜');
    assert.equal(updated.changes[0]!.after, '大雨夜');
    assert.deepEqual(updated.warnings, []);

    const added = await ctx.command('propose_storylet_patch').execute({
      worldDraftId: ctx.draft.id, title: '晨雾', intent: '清晨的渡口事件', locationIds: ['dock'],
    }) as {changes: {path: string; after?: {id: string; title: string; choices: unknown[]}}[]};
    assert.equal(added.changes[0]!.path, 'storylets');
    assert.equal(added.changes[0]!.after?.title, '晨雾');
    assert.equal(added.changes[0]!.after?.choices.length, 1);
    assert.ok(JSON.stringify(added).length < 1800, 'new-card proposal must stay small');
    assert.deepEqual(ctx.worlds.get(ctx.draft.id).content, before.content, 'proposal writes nothing');
  } finally { ctx.db.close(); }
});

test('V1 Command metadata derives confirmation for commands with no bypass entry', () => {
  const ctx = setup();
  try {
    const state = {worlds: ctx.worlds} as unknown as AgentChatCommandState;
    const tools = createAgentChatTools(ctx.commands, state);
    const write = tools.find(tool => tool.name === 'add_world_location')!;
    const read = tools.find(tool => tool.name === 'validate_world_draft')!;
    assert.equal(Object.hasOwn(agentChatCommandMetadata.add_world_location, 'confirmation'), false);
    assert.equal(write.requiresConfirmation, true, 'write Command defaults to confirm');
    assert.equal(read.requiresConfirmation, false, 'read-only Command defaults to auto');
    assert.equal(ctx.command('add_world_location').risk, 'write');
    assert.equal(ctx.command('validate_world_draft').risk, 'read');
  } finally { ctx.db.close(); }
});

test('V1 propose patches are automatic chat tools with no confirmation override', () => {
  const ctx = setup();
  try {
    const state = {worlds: ctx.worlds} as unknown as AgentChatCommandState;
    const tools = createAgentChatTools(ctx.commands, state);
    for (const name of ['propose_clock_patch', 'propose_storylet_patch']) {
      const tool = tools.find(candidate => candidate.name === name);
      assert.ok(tool, `missing agent tool ${name}`);
      assert.equal(tool.requiresConfirmation, false, `${name} must derive auto confirmation from Command metadata`);
      assert.equal(Object.hasOwn(agentChatCommandMetadata[name as keyof typeof agentChatCommandMetadata], 'confirmation'), false, `${name} needs no bypass entry`);
      assert.deepEqual(tool.prepare(name === 'propose_clock_patch'
        ? {worldDraftId: ctx.draft.id, unit: 'day'}
        : {worldDraftId: ctx.draft.id, storyletId: 'rain'}), {
        summary: `${name === 'propose_clock_patch' ? '生成 Mock 时钟补丁提案（只读）' : '生成 Mock 剧情卡补丁提案（只读）'}：${
          JSON.stringify(name === 'propose_clock_patch' ? {worldDraftId: ctx.draft.id, unit: 'day'} : {worldDraftId: ctx.draft.id, storyletId: 'rain'})}`,
      });
    }
  } finally { ctx.db.close(); }
});
