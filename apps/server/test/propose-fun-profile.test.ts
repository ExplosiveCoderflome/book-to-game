import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOCKS, FUN_PROFILES, getFunProfile, type WorldContent } from '@novel-game/contracts';
import { funProfileCommands } from '../src/app/commands/fun-profiles.js';
import { agentChatCommandMetadata, createAgentChatTools, type AgentChatCommandState } from '../src/app/agent-chat-tools.js';
import type { Workbench } from '../src/app/workbench.js';
import { WorldService, SqliteWorldRepository } from '../src/modules/worlds/index.js';
import { openDatabase } from '../src/platform/database.js';
import { content, source } from './helpers/open-fixture.js';

function setup(overrides: Partial<WorldContent> = {}) {
  const db = openDatabase(':memory:');
  const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
  const draft = worlds.create({sourceId: source.id, content: {...content(), ...overrides}});
  const commands = funProfileCommands({worlds} as unknown as Workbench);
  const command = (name: string) => {
    const found = commands.find(item => item.name === name);
    assert.ok(found, `missing command ${name}`);
    return found;
  };
  return {db, worlds, draft, commands, command};
}

test('V2 propose_fun_profile: healing draft yields a built-in profile, Chinese rationale and registered blocks, no writes', async () => {
  const ctx = setup({
    title: '深夜食堂', premise: '小镇食堂里温暖的日常', goal: '陪伴客人吃一碗热汤',
    storylets: [{id: 'soup', title: '热汤', text: '深夜的灯还亮着。', choices: [{id: 'c', label: '喝汤', timeCost: 1, effects: [], text: '很暖。'}]}],
  });
  try {
    const before = ctx.worlds.get(ctx.draft.id);
    const proposal = await ctx.command('propose_fun_profile').execute({worldDraftId: ctx.draft.id}) as {
      suggestedProfileId: string; rationale: string; customHints: string[]; recommendedBlocks: {id: string; label: string}[];
      warnings: string[]; baseVersion: number; worldDraftId: string; model: string};
    assert.equal(proposal.worldDraftId, ctx.draft.id);
    assert.equal(proposal.baseVersion, before.version);
    assert.equal(proposal.suggestedProfileId, 'healing');
    assert.ok(proposal.rationale.length > 0, 'rationale is non-empty');
    assert.equal(proposal.model, 'mock-fun-profile');
    const profile = getFunProfile(proposal.suggestedProfileId);
    assert.ok(profile, 'profile exists in FUN_PROFILES');
    const blockIds = new Set(BLOCKS.map(block => block.id));
    assert.deepEqual(proposal.recommendedBlocks.map(block => block.id), profile!.suggestedBlocks);
    for (const block of proposal.recommendedBlocks) {
      assert.ok(blockIds.has(block.id), `${block.id} must be a registered block`);
      assert.ok(block.label.length > 0);
    }
    assert.deepEqual(proposal.warnings, []);
    assert.deepEqual(ctx.worlds.get(ctx.draft.id).content, before.content, 'proposal writes nothing');

    const command = ctx.command('propose_fun_profile');
    assert.equal(command.readOnly, true);
    assert.equal(command.confirmation, 'auto');
    assert.equal(command.risk, 'read');
  } finally { ctx.db.close(); }
});

test('V2 propose_fun_profile: every shipped profile id and the mock fallback stay in the catalog', async () => {
  const ctx = setup();
  try {
    const proposal = await ctx.command('propose_fun_profile').execute({worldDraftId: ctx.draft.id}) as {suggestedProfileId: string};
    assert.ok(FUN_PROFILES.some(profile => profile.id === proposal.suggestedProfileId));
  } finally { ctx.db.close(); }
});

test('V2 recommend_blocks_for_profile: built-in profiles return only registered blocks; unknown profile fails', async () => {
  const ctx = setup();
  try {
    for (const profile of FUN_PROFILES) {
      const result = ctx.command('recommend_blocks_for_profile').execute({profileId: profile.id}) as {
        profileId: string; blocks: {id: string; label: string; blurb: string}[]; warnings: string[]};
      assert.equal(result.profileId, profile.id);
      const blockIds = new Set(BLOCKS.map(block => block.id));
      for (const block of result.blocks) {
        assert.ok(blockIds.has(block.id), `${profile.id} recommends unregistered block ${block.id}`);
        assert.ok(block.label.length > 0 && block.blurb.length > 0);
      }
      assert.deepEqual(result.blocks.map(block => block.id), profile.suggestedBlocks);
      assert.deepEqual(result.warnings, []);
    }
    assert.throws(() => ctx.command('recommend_blocks_for_profile').execute({profileId: 'nope'}), /未知画像：nope/);
    const command = ctx.command('recommend_blocks_for_profile');
    assert.equal(command.readOnly, true);
  } finally { ctx.db.close(); }
});

test('V2 propose_fun_profile / recommend_blocks_for_profile are automatic chat tools', () => {
  const ctx = setup();
  try {
    const state = {worlds: ctx.worlds} as unknown as AgentChatCommandState;
    const tools = createAgentChatTools(ctx.commands, state);
    for (const name of ['propose_fun_profile', 'recommend_blocks_for_profile']) {
      const tool = tools.find(candidate => candidate.name === name);
      assert.ok(tool, `missing agent tool ${name}`);
      assert.equal(tool.requiresConfirmation, false, `${name} is read-only`);
      assert.equal(Object.hasOwn(agentChatCommandMetadata[name as keyof typeof agentChatCommandMetadata], 'confirmation'), false);
    }
    assert.deepEqual(tools.find(tool => tool.name === 'recommend_blocks_for_profile')!.prepare({profileId: 'healing'}), {
      summary: '推荐画像积木（只读）：{"profileId":"healing"}',
    });
  } finally { ctx.db.close(); }
});
