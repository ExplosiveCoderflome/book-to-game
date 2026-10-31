import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lockMapStructure, validateMapFill } from '@novel-game/rules';
import type { MapFillProposalItem, WorldContent } from '@novel-game/contracts';
import { worldCommands } from '../src/app/commands/worlds.js';
import { createAgentChatTools, type AgentChatCommandState } from '../src/app/agent-chat-tools.js';
import type { Workbench } from '../src/app/workbench.js';
import { AgentChatService, SqliteChatRepository } from '../src/modules/agent/index.js';
import { acceptBuildingDrafts, BuildingLibraryService, SqliteBuildingLibraryRepository } from '../src/modules/building-library/index.js';
import { WorldService, SqliteWorldRepository, type MapFillModel } from '../src/modules/worlds/index.js';
import { openDatabase } from '../src/platform/database.js';
import { AppError } from '../src/shared/errors.js';
import { content, source } from './helpers/open-fixture.js';
import { playMap } from './helpers/map-fixture.js';

function setup(lock = true) {
  const db = openDatabase(':memory:');
  const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
  const buildingLibrary = new BuildingLibraryService(new SqliteBuildingLibraryRepository(db));
  const world: WorldContent = {...content(), map: playMap(false)};
  let draft = worlds.create({sourceId: source.id, content: world});
  if (lock) draft = worlds.update(draft.id, {version: draft.version, content: {...world, map: lockMapStructure(world.map!)}});
  const commands = worldCommands({worlds, buildingLibrary} as unknown as Workbench);
  const command = (name: string) => {
    const found = commands.find(item => item.name === name);
    assert.ok(found, `missing command ${name}`);
    return found;
  };
  return {db, worlds, buildingLibrary, draft, commands, command};
}

function errorCode(code: string) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

type ChatReply = {text: string; calls: Array<{id: string; name: string; arguments: Record<string, unknown>}>};
function agentService(ctx: ReturnType<typeof setup>, replies: ChatReply[]) {
  const state = {worlds: ctx.worlds} as unknown as AgentChatCommandState;
  return new AgentChatService({
    repository: new SqliteChatRepository(ctx.db),
    model: () => ({respond: async () => replies.shift() ?? {text: '完成', calls: []}}),
    tools: () => createAgentChatTools(ctx.commands, state),
  });
}

test('M-fill-3a command hard gate, multi-fill and override isolation', async () => {
  const unlocked = setup(false);
  try {
    const before = unlocked.worlds.get(unlocked.draft.id).version;
    await assert.rejects(async () => unlocked.command('place_map_fill').execute({
      id: unlocked.draft.id,
      version: unlocked.draft.version,
      placement: {id: 'early_shop', kind: 'shop', locationId: 'dock'},
    }), errorCode('MAP_STRUCTURE_NOT_LOCKED'));
    assert.equal(unlocked.worlds.get(unlocked.draft.id).version, before);
  } finally { unlocked.db.close(); }

  const ctx = setup();
  try {
    const asset = ctx.buildingLibrary.createAsset({kind: 'shop', label: '渡口杂货', color: '#112233', icon: '商'}, 0).asset;
    const original = structuredClone(asset);
    const first = await ctx.command('place_map_fill').execute({
      id: ctx.draft.id,
      version: ctx.draft.version,
      placement: {
        id: 'shop_dock', kind: 'shop', locationId: 'dock',
        buildingAssetId: asset.id, buildingAssetVersion: asset.version,
        localOverrides: {label: '本地杂货', color: '#abcdef'},
      },
    }) as {draft: {version: number}};
    const second = await ctx.command('place_map_fill').execute({
      id: ctx.draft.id,
      version: first.draft.version,
      placement: {id: 'quest_dock', kind: 'quest', locationId: 'dock', label: '渡口告示'},
    }) as {draft: {version: number}};
    let saved = ctx.worlds.get(ctx.draft.id);
    assert.equal(saved.content.map?.fill?.placements.length, 2);
    assert.equal(saved.content.map?.fill?.placements[0].localOverrides?.label, '本地杂货');
    assert.deepEqual(ctx.buildingLibrary.get().library.assets[0], original, 'placement overrides must not write the catalog');
    assert.deepEqual(validateMapFill(saved.content.map!, saved.content.locations.map(location => location.id), {
      buildingAssetIds: ctx.buildingLibrary.assetIds(), routeIds: saved.content.actions.map(action => action.id),
    }).filter(issue => issue.level === 'error'), []);

    await assert.rejects(async () => ctx.command('place_map_fill').execute({
      id: ctx.draft.id,
      version: second.draft.version,
      placement: {id: 'bad_location', kind: 'shop', locationId: 'not_on_map'},
    }), errorCode('MAP_FILL_LOCATION_UNBOUND'));

    const updated = await ctx.command('update_map_fill_placement').execute({
      id: ctx.draft.id,
      version: second.draft.version,
      placementId: 'shop_dock',
      patch: {localOverrides: {label: '只在渡口改名', icon: '店'}},
    }) as {draft: {version: number}};
    saved = ctx.worlds.get(ctx.draft.id);
    assert.equal(saved.content.map?.fill?.placements[0].localOverrides?.label, '只在渡口改名');
    assert.deepEqual(ctx.buildingLibrary.get().library.assets[0], original);
    assert.equal(updated.draft.version, second.draft.version + 1);
  } finally { ctx.db.close(); }
});

test('M-fill-4a mock proposal only uses bound locations + existing assets and is read-only', async () => {
  const ctx = setup();
  try {
    const asset = ctx.buildingLibrary.createAsset({kind: 'shop', label: '库内商店'}, 0).asset;
    const worldVersion = ctx.worlds.get(ctx.draft.id).version;
    const libraryRevision = ctx.buildingLibrary.get().revision;
    const proposal = await ctx.command('propose_map_fill').execute({
      id: ctx.draft.id, prompt: '补两间店', kinds: ['shop'], count: 2,
    }) as {items: MapFillProposalItem[]; model?: string};
    assert.equal(proposal.model, 'mock-map-fill');
    assert.equal(proposal.items.length, 2);
    assert.ok(proposal.items.every(item => item.buildingAssetId === asset.id));
    assert.ok(proposal.items.every(item => ctx.worlds.get(ctx.draft.id).content.map?.pois.some(poi => poi.locationId === item.locationId)));
    assert.equal(ctx.worlds.get(ctx.draft.id).version, worldVersion);
    assert.equal(ctx.buildingLibrary.get().revision, libraryRevision);
    assert.equal(ctx.worlds.get(ctx.draft.id).content.map?.fill, undefined, 'review alone has zero residue');

    const accepted = await ctx.command('accept_map_fill').execute({
      id: ctx.draft.id, version: worldVersion, items: [proposal.items[0]],
    }) as {placements: {id: string}[]};
    assert.equal(accepted.placements.length, 1);
    assert.equal(ctx.worlds.get(ctx.draft.id).content.map?.fill?.placements.length, 1);
  } finally { ctx.db.close(); }
});

test('M-fill-4 filters invented locations/assets and refuses proposal before structure lock', async () => {
  const unlocked = setup(false);
  try {
    await assert.rejects(async () => unlocked.command('propose_map_fill').execute({id: unlocked.draft.id}), errorCode('MAP_STRUCTURE_NOT_LOCKED'));
  } finally { unlocked.db.close(); }

  const ctx = setup();
  try {
    const model: MapFillModel = {
      async proposeMapFill() {
        return {placements: [
          {proposalId: 'ghost_location', kind: 'shop', locationId: 'invented', buildingAssetId: 'also_missing'},
          {proposalId: 'ghost_asset', kind: 'shop', locationId: 'dock', buildingAssetId: 'missing'},
        ]};
      },
    };
    const {proposeMapFill} = await import('../src/modules/worlds/index.js');
    const proposal = await proposeMapFill(ctx.worlds, ctx.buildingLibrary, ctx.draft.id, {}, model, undefined, 'mock-invalid');
    assert.equal(proposal.items.length, 0);
    assert.equal(proposal.warnings.length >= 2, true);
    assert.equal(ctx.worlds.get(ctx.draft.id).content.map?.fill, undefined);
  } finally { ctx.db.close(); }
});

test('M-fill-4b new asset is separately reviewed, gets unique label, then can be placed', async () => {
  const ctx = setup();
  try {
    const proposal = await ctx.command('propose_map_fill').execute({
      id: ctx.draft.id, kinds: ['supply'], count: 1, allowNewAssets: true,
    }) as {items: MapFillProposalItem[]};
    const item = proposal.items[0];
    assert.ok(item.assetDraft);
    await assert.rejects(async () => ctx.command('accept_map_fill').execute({
      id: ctx.draft.id, version: ctx.draft.version, items: [item],
    }), errorCode('MAP_FILL_ASSET_REVIEW_REQUIRED'));

    // A same-name asset proves accept_building_drafts keeps its · N behavior.
    ctx.buildingLibrary.createAsset({kind: 'supply', label: item.assetDraft!.label}, 0);
    const imported = acceptBuildingDrafts(ctx.buildingLibrary, {
      expectedRevision: ctx.buildingLibrary.get().revision,
      drafts: [item.assetDraft!],
    });
    assert.match(imported.assets[0].label, / · 2$/);
    assert.equal(imported.assets[0].provenance?.source, 'ai-propose');
    const reviewed: MapFillProposalItem = {
      ...item,
      buildingAssetId: imported.assets[0].id,
      buildingAssetVersion: imported.assets[0].version,
      assetDraft: undefined,
    };
    const accepted = await ctx.command('accept_map_fill').execute({
      id: ctx.draft.id, version: ctx.draft.version, items: [reviewed],
    }) as {placements: {buildingAssetId?: string}[]};
    assert.equal(accepted.placements[0].buildingAssetId, imported.assets[0].id);
  } finally { ctx.db.close(); }
});

test('cmdreg agent map-fill: read-only mock proposal executes without confirmation or draft writes', async () => {
  const ctx = setup();
  try {
    ctx.buildingLibrary.createAsset({kind: 'shop', label: '库内商店'}, 0);
    const replies: ChatReply[] = [
      {text: '', calls: [{id: 'propose-1', name: 'propose_map_fill', arguments: {id: ctx.draft.id, kinds: ['shop'], count: 1}}]},
      {text: '提案已生成', calls: []},
    ];
    const service = agentService(ctx, replies);
    const conversation = service.create();
    const before = ctx.worlds.get(ctx.draft.id).version;
    const result = await service.send({id: conversation.id, requestId: 'propose-request', text: '生成填充提案'});

    assert.equal(result.actions.length, 0);
    assert.ok(result.messages.some(message => message.role === 'tool' && message.content.includes('mock-map-fill')));
    assert.equal(ctx.worlds.get(ctx.draft.id).version, before);
    assert.equal(ctx.worlds.get(ctx.draft.id).content.map?.fill, undefined);
  } finally { ctx.db.close(); }
});

test('cmdreg agent map-fill: all three writes wait for confirmation and then execute normally', async () => {
  const ctx = setup();
  try {
    const asset = ctx.buildingLibrary.createAsset({kind: 'shop', label: '库内商店'}, 0).asset;
    const replies: ChatReply[] = [];
    const service = agentService(ctx, replies);
    const confirm = async (name: string, args: Record<string, unknown>, requestId: string) => {
      const before = ctx.worlds.get(ctx.draft.id).version;
      replies.push(
        {text: '', calls: [{id: `${requestId}-call`, name, arguments: args}]},
        {text: '已执行', calls: []},
      );
      const conversation = service.create();
      const pending = await service.send({id: conversation.id, requestId, text: `执行 ${name}`});
      assert.equal(pending.actions.length, 1, name);
      assert.equal(pending.actions[0]!.toolName, name);
      assert.equal(pending.actions[0]!.status, 'pending', name);
      assert.equal(pending.actions[0]!.guard, String(before), name);
      assert.equal(ctx.worlds.get(ctx.draft.id).version, before, `${name} wrote before confirmation`);
      const confirmed = await service.decide({id: conversation.id, actionId: pending.actions[0]!.id, decision: 'confirm'});
      assert.equal(confirmed.actions[0]!.status, 'succeeded', name);
      assert.equal(ctx.worlds.get(ctx.draft.id).version, before + 1, name);
    };

    await confirm('place_map_fill', {
      id: ctx.draft.id, version: ctx.draft.version,
      placement: {id: 'shop_dock', kind: 'shop', locationId: 'dock', buildingAssetId: asset.id, buildingAssetVersion: asset.version},
    }, 'place-request');
    assert.equal(ctx.worlds.get(ctx.draft.id).content.map?.fill?.placements[0]?.id, 'shop_dock');

    await confirm('update_map_fill_placement', {
      id: ctx.draft.id, version: ctx.worlds.get(ctx.draft.id).version,
      placementId: 'shop_dock', patch: {label: '确认后的商店'},
    }, 'update-request');
    assert.equal(ctx.worlds.get(ctx.draft.id).content.map?.fill?.placements[0]?.label, '确认后的商店');

    await confirm('accept_map_fill', {
      id: ctx.draft.id, version: ctx.worlds.get(ctx.draft.id).version,
      items: [{proposalId: 'quest_market', kind: 'quest', locationId: 'market', label: '集市告示'}],
    }, 'accept-request');
    const placements = ctx.worlds.get(ctx.draft.id).content.map?.fill?.placements;
    assert.equal(placements?.length, 2);
    assert.equal(placements?.[1]?.id, 'quest_market');
  } finally { ctx.db.close(); }
});

test('cmdreg agent map-fill: invalid arguments are rejected before execution', () => {
  const ctx = setup();
  try {
    const state = {worlds: ctx.worlds} as unknown as AgentChatCommandState;
    const tools = createAgentChatTools(ctx.commands, state);
    const before = ctx.worlds.get(ctx.draft.id).version;
    const invalidCases: Array<[string, Record<string, unknown>]> = [
      ['place_map_fill', {id: ctx.draft.id, version: before, placement: {id: 'bad', kind: 'invalid', locationId: 'dock'}}],
      ['update_map_fill_placement', {id: ctx.draft.id, version: before, placementId: 'shop_dock', patch: {label: ''}}],
      ['propose_map_fill', {id: ctx.draft.id, count: 0}],
      ['accept_map_fill', {id: ctx.draft.id, version: before, items: []}],
    ];
    for (const [name, args] of invalidCases) {
      const tool = tools.find(candidate => candidate.name === name);
      assert.ok(tool, `missing agent tool ${name}`);
      assert.throws(() => tool.validate(args), name);
    }
    assert.equal(ctx.worlds.get(ctx.draft.id).version, before);
    assert.equal(ctx.worlds.get(ctx.draft.id).content.map?.fill, undefined);
  } finally { ctx.db.close(); }
});
