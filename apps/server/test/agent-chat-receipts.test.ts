import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {test} from 'node:test';
import {worldContentSchema, type WorldContent, type WorldDraft} from '@novel-game/contracts';
import {createAgentChatTools} from '../src/app/agent-chat-tools.js';
import {createCommands} from '../src/app/commands/index.js';
import {createWorkbench} from '../src/app/workbench.js';
import {AgentChatService, SqliteChatRepository} from '../src/modules/agent/index.js';
import {ModelSettingsService, SqliteModelSettingsRepository} from '../src/modules/model-settings/index.js';
import {openDatabase} from '../src/platform/database.js';
import {scriptedChat} from './helpers/agent-pi.js';

const options = {timeout: 180_000};
function largeWorld(): WorldContent {
  const origin = {origin: 'adapted' as const, evidence: []};
  return worldContentSchema.parse({schemaVersion: 1, mode: 'open', title: '六站修渠', premise: '依次修复六段水渠。',
    playerRole: '修渠人', goal: '让水流抵达田地', worldRules: ['每段完成后才能修下一段'], adaptationNotes: '', sourceChapterIds: ['idea'],
    initialLocationId: 'canal', timeLimit: 30, timeoutEnding: '期限已到。',
    locations: ['canal', 'field', 'spring'].map(id => ({id, title: id, text: '沿渠查看水位与石壁。'.repeat(180), ...origin})),
    map: {mapSchemaVersion: 1, geometry: {kind: 'hex', orientation: 'pointy', cols: 4, rows: 4, size: 28}, layers: {},
      pois: [{locationId: 'canal', anchor: {cell: '0,0'}}], structureLocked: true},
    facts: Array.from({length: 6}, (_, i) => ({id: `done_${i}`, label: `第${i + 1}段已修`, description: '', kind: 'event', initialValue: false, playerKnown: true, ...origin})),
    npcs: [], events: Array.from({length: 6}, (_, i) => ({id: `flow_${i}`, label: `水位${i}`,
      when: [{kind: 'time', atLeast: i + 1}], effects: [{kind: 'set', factId: `done_${i}`, value: true}],
      text: `水流到达第${i + 1}段。`, visibility: 'public'})),
    actions: Array.from({length: 6}, (_, i) => Array.from({length: 3}, (_, route) => ({id: `repair_${i}_${route}`, label: `修第${i + 1}段方案${route}`, description: '修渠', locationId: 'canal',
      availableWhen: [{kind: 'fact', factId: `done_${i}`, value: false}, ...(i ? [{kind: 'fact', factId: `done_${i - 1}`, value: true}] : [])],
      requires: [], blockedReason: '先修前段', risk: '', timeCost: 1, once: true,
      effects: [{kind: 'set', factId: `done_${i}`, value: true}], text: `第${i + 1}段方案${route}：${'清理淤泥、校准石槽，水流逐渐恢复。'.repeat(50)}`, ...origin}))).flat(),
    endings: [{id: 'water', title: '水到田间', text: '六段水渠接通了。', when: [{kind: 'fact', factId: 'done_5', value: true}]}],
  });
}
async function setup() {
  const dir = await mkdtemp('/tmp/opencode/compact-receipts-');
  const db = openDatabase(`${dir}/test.sqlite`);
  const settings = new ModelSettingsService(new SqliteModelSettingsRepository(db), {encrypt: v => v, decrypt: v => v},
    {baseUrl: '', model: '', apiKey: '', timeoutMs: 1000, streamIdleTimeoutMs: 1000, streamTotalTimeoutMs: 1000});
  const w = createWorkbench(db, settings, undefined, {dataDir: dir});
  const commands = createCommands(w), tools = createAgentChatTools(commands, w);
  const tool = (name: string) => {const found = tools.find(t => t.name === name); assert.ok(found, name); return found;};
  const run = async (name: string, args: Record<string, unknown>) => tool(name).execute(tool(name).validate(args));
  const input = {requestId: randomUUID(), title: '六站修渠', idea: '六次依序修渠完成引水。', sourceIds: [], content: largeWorld()};
  const create = async () => {await run('create_world_from_idea', input); return w.worlds.list()[0]!;};
  const serviceFor = (name: string, args: Record<string, unknown>) => {
    const replies = [{text: '', calls: [{id: randomUUID(), name, arguments: args}]}];
    return new AgentChatService({repository: new SqliteChatRepository(db), tools: () => tools,
      model: () => scriptedChat(async () => replies.shift() ?? {text: '完成', calls: []})});
  };
  return {db, w, commands, tools, tool, run, input, create, serviceFor, close: async () => {db.close(); await rm(dir, {recursive: true, force: true});}};
}
function receipt(value: unknown, saved: WorldDraft) {
  const r = value as Record<string, unknown>;
  assert.equal(r.id, saved.id); assert.equal(r.version, saved.version);
  assert.equal(r.sourceId, saved.sourceId); assert.equal(r.title, saved.content.title);
  assert.ok(JSON.stringify(r).length < 16000, `receipt size ${JSON.stringify(r).length}`);
  assert.equal(r.content, undefined); assert.equal(r.draft, undefined);
  assert.ok(JSON.stringify(saved).length > 16000);
}
test('receipts: real large create uses committed identity/version including idempotent replay after an edit', options, async t => {
  const f = await setup();
  try {
    assert.ok(JSON.stringify(f.input.content).length > 16000);
    const first = await f.run('create_world_from_idea', f.input), saved = f.w.worlds.list()[0]!;
    assert.equal(f.w.worlds.validate(saved.id).valid, true); receipt(first, saved);
    t.diagnostic(`world=${JSON.stringify(saved).length} chars; create receipt=${JSON.stringify(first).length} chars`);
    const edited = f.w.worlds.update(saved.id, {version: saved.version, content: {...saved.content, title: '修渠后记'}});
    receipt(await f.run('create_world_from_idea', f.input), edited);
    assert.equal(f.w.worlds.list().length, 1); assert.equal(f.w.sources.list().length, 1); assert.equal(f.w.jobs.list().length, 0);
    assert.deepEqual(edited.content.provenance, saved.content.provenance);
  } finally {await f.close();}
});
test('receipts: end-conditions returns actual committed identity/version and keeps reshape acknowledgement', options, async () => {
  const f = await setup();
  try {
    const saved = await f.create();
    await f.run('apply_world_composition', {worldId: saved.id, expectedVersion: saved.version,
      operations: [{entity: 'ending', op: 'add', value: {id: 'dry', title: '枯渠', kind: 'failure', text: '渠水干涸。', when: [{kind: 'time', atLeast: 29}]}}], blockSelections: []});
    const before = f.w.worlds.get(saved.id);
    const args = {worldDraftId: saved.id, version: before.version, selection: {kind: 'package', packageId: 'canal',
      win: [{id: 'flowing', label: '渠通', when: [{kind: 'fact', factId: 'done_5', value: true}]}],
      lose: [{id: 'drying', label: '枯水', when: [{kind: 'time', atLeast: 29}]}]}};
    const result = await f.run('apply_end_conditions', args) as Record<string, unknown>, committed = f.w.worlds.get(saved.id);
    assert.equal(result.id, committed.id); assert.equal(result.draftId, committed.id); assert.equal(result.version, committed.version);
    assert.equal(result.endConditions, undefined); assert.equal(result.severity, 'reshapes-game'); assert.ok(result.severityNote);
    assert.ok(JSON.stringify(result).length < 16000); assert.ok(committed.content.endConditions);
    assert.deepEqual(committed.content.provenance, saved.content.provenance);
    await assert.rejects(() => f.run('apply_end_conditions', {...args, version: committed.version}), (e: unknown) => (e as {code: string}).code === 'END_CONDITIONS_RESHAPE_UNCONFIRMED');
    assert.deepEqual(f.w.worlds.get(saved.id), committed);
  } finally {await f.close();}
});
test('receipts: direct and wrapped ordinary writes expose DB versions while preserving world and provenance', options, async () => {
  const f = await setup();
  try {
    let saved = await f.create();
    const cases: Array<[string, () => Record<string, unknown>]> = [
      ['edit_world_summary', () => ({id: saved.id, version: saved.version, title: '水渠档案'})],
      ['add_world_location', () => ({id: saved.id, version: saved.version, location: {id: 'barn', title: '谷仓', text: '流水灌田。', origin: 'adapted', evidence: []}})],
      ['apply_world_composition', () => ({worldId: saved.id, expectedVersion: saved.version, operations: [{entity: 'fact', op: 'add', value: {id: 'record', label: '记事', description: '', kind: 'event', initialValue: false, playerKnown: true, origin: 'adapted', evidence: []}}], blockSelections: []})],
      ['apply_world_patch', () => ({worldDraftId: saved.id, version: saved.version, changes: [{path: 'clock', op: 'add', after: {unit: 'day', unitsPerMonth: 30, limitMonths: 12, startYear: 1, startMonth: 1}}]})],
      ['place_map_fill', () => ({id: saved.id, version: saved.version, placement: {id: 'worksite', kind: 'quest', locationId: 'canal'}})],
      ['update_map_fill_placement', () => ({id: saved.id, version: saved.version, placementId: 'worksite', patch: {label: '修渠工地', localOverrides: {note: '现场记事'.repeat(5000)}}})],
      ['accept_map_fill', () => ({id: saved.id, version: saved.version, items: [{proposalId: 'supply', kind: 'quest', locationId: 'canal', label: '补给点'}]})],
    ];
    for (const [name, args] of cases) {
      const before = saved, result = await f.run(name, args()); saved = f.w.worlds.get(saved.id); receipt(result, saved);
      assert.ok(saved.version > before.version); assert.deepEqual(saved.content.provenance, before.content.provenance);
      assert.equal((result as {applied?: number}).applied, name === 'apply_world_patch' || name === 'apply_world_composition' ? 1 : undefined);
      assert.deepEqual(saved.content.actions, before.content.actions); assert.equal(f.w.worlds.validate(saved.id).valid, true);
    }
  } finally {await f.close();}
});
test('receipts: returned failures and uncertain envelopes are never promoted to committed receipts', options, async () => {
  const f = await setup();
  try {
    const saved = await f.create(), changes = f.db.prepare('SELECT total_changes() AS n').get();
    for (const name of ['create_world_from_idea', 'add_world_location', 'apply_world_patch', 'apply_end_conditions']) {
      const original = f.commands.find(c => c.name === name)!;
      for (const status of ['failed', 'uncertain']) {
        const result = {...saved, draft: saved, draftId: saved.id, status, error: 'not a committed success'};
        const tool = createAgentChatTools([{...original, execute: () => result}], f.w)[0]!;
        assert.deepEqual(await tool.execute({id: 'request-id', version: 999}), result);
      }
      const error = new Error('execution failed');
      const tool = createAgentChatTools([{...original, execute: () => {throw error;}}], f.w)[0]!;
      await assert.rejects(async () => tool.execute({}), (e: unknown) => e === error);
    }
    assert.deepEqual(f.db.prepare('SELECT total_changes() AS n').get(), changes);
    assert.deepEqual(f.w.worlds.get(saved.id), saved);
  } finally {await f.close();}
});
test('receipts: invalid create and stale/invalid writes reject without world/source/baseline changes', options, async () => {
  const f = await setup();
  try {
    const bad = largeWorld(); bad.initialLocationId = 'missing';
    await assert.rejects(() => f.run('create_world_from_idea', {...f.input, content: bad}));
    assert.equal(f.w.worlds.list().length, 0); assert.equal(f.w.sources.list().length, 0);
    const saved = await f.create(), baseline = f.w.worlds.getPreservationBaseline(saved.id);
    for (const args of [{id: saved.id, version: 99, title: 'stale'}, {id: saved.id, version: saved.version, location: {id: 'canal', title: '重复', text: '重复', origin: 'adapted', evidence: []}}]) {
      await assert.rejects(() => f.run('location' in args ? 'add_world_location' : 'edit_world_summary', args));
      assert.deepEqual(f.w.worlds.get(saved.id), saved); assert.deepEqual(f.w.worlds.getPreservationBaseline(saved.id), baseline);
    }
    assert.equal(f.w.sources.list().length, 1);
  } finally {await f.close();}
});
test('receipts: dedicated reshape still needs author confirmation, exact guard and single-commit replay', options, async () => {
  const f = await setup();
  try {
    const saved = await f.create(), candidate = structuredClone(saved.content); candidate.actions[0]!.label = '精修第一段';
    const proposalInput = {worldId: saved.id, expectedVersion: saved.version, content: candidate};
    const proposal = f.w.worlds.proposeReshape(proposalInput), args = {...proposalInput, diffHash: proposal.diffHash};
    assert.throws(() => f.commands.find(c => c.name === 'confirm_world_reshape')!.execute(args), /仅允许作者/);
    const service = f.serviceFor('confirm_world_reshape', args), conversation = service.create();
    const pending = await service.send({id: conversation.id, requestId: randomUUID(), text: '请提议重塑'});
    assert.equal(pending.actions[0]!.status, 'pending'); assert.equal(pending.actions[0]!.guard, `${saved.version}:${proposal.diffHash}`);
    assert.deepEqual(f.w.worlds.get(saved.id), saved);
    const done = await service.decide({id: conversation.id, actionId: pending.actions[0]!.id, decision: 'confirm'});
    assert.equal(done.actions[0]!.status, 'succeeded', done.actions[0]!.result);
    const committed = f.w.worlds.get(saved.id); receipt(JSON.parse(done.actions[0]!.result!), committed);
    assert.deepEqual(committed.content, candidate); assert.deepEqual(committed.content.provenance, saved.content.provenance);
    assert.equal(f.w.worlds.getPreservationBaseline(saved.id)!.version, committed.version);
    const changes = f.db.prepare('SELECT total_changes() AS n').get();
    receipt(await f.run('confirm_world_reshape', args), committed);
    assert.deepEqual(f.db.prepare('SELECT total_changes() AS n').get(), changes);
    await service.decide({id: conversation.id, actionId: pending.actions[0]!.id, decision: 'confirm'});
    assert.deepEqual(f.w.worlds.get(saved.id), committed);
  } finally {await f.close();}
});
test('receipts: dedicated reshape stale author guard fails without producing a success receipt', options, async () => {
  const f = await setup();
  try {
    const saved = await f.create(), candidate = {...saved.content, title: '重塑候选'};
    const input = {worldId: saved.id, expectedVersion: saved.version, content: candidate}, proposal = f.w.worlds.proposeReshape(input);
    const service = f.serviceFor('confirm_world_reshape', {...input, diffHash: proposal.diffHash}), chat = service.create();
    const pending = await service.send({id: chat.id, requestId: randomUUID(), text: '提议'});
    const concurrent = f.w.worlds.update(saved.id, {version: saved.version, content: {...saved.content, title: '作者并发编辑'}});
    const baseline = f.w.worlds.getPreservationBaseline(saved.id);
    const done = await service.decide({id: chat.id, actionId: pending.actions[0]!.id, decision: 'confirm'});
    assert.equal(done.actions[0]!.status, 'failed'); assert.match(done.actions[0]!.result!, /DRAFT_VERSION_CONFLICT|CHAT_ACTION_STALE/);
    assert.deepEqual(f.w.worlds.get(saved.id), concurrent); assert.deepEqual(f.w.worlds.getPreservationBaseline(saved.id), baseline);
    assert.deepEqual(f.db.prepare('SELECT COUNT(*) AS n FROM world_reshape_receipts').get(), {n: 0});
  } finally {await f.close();}
});
test('receipts: other large READ stays truncated, schema stays complete, registry and publish receipt stay stable', options, async () => {
  const f = await setup();
  try {
    const saved = await f.create();
    assert.equal(f.tools.length, 78); assert.equal(f.tools.filter(t => !t.requiresConfirmation).length, 41); assert.equal(f.tools.filter(t => t.requiresConfirmation).length, 37);
    for (const name of ['get_world_schema', 'validate_world_composition']) {
      const args = name === 'get_world_schema' ? {} : {worldId: saved.id, expectedVersion: saved.version, operations: [{entity: 'fact', op: 'add', value: {id: 'read_only', label: '只读', kind: 'event', description: '', initialValue: false, playerKnown: true, origin: 'adapted', evidence: []}}], blockSelections: []};
      const service = f.serviceFor(name, args), conversation = service.create();
      const result = await service.send({id: conversation.id, requestId: randomUUID(), text: '读取'});
      const message = result.messages.find(m => m.role === 'tool' && m.toolName === name); assert.ok(message, name);
      const parsed = JSON.parse(message.content);
      if (name === 'get_world_schema') {assert.equal(parsed.truncated, undefined); assert.ok(message.content.length > 16000); assert.deepEqual(parsed, await f.run(name, {}));}
      else {assert.equal(parsed.truncated, true); assert.equal(parsed.preview.length, 16000); assert.ok(parsed.notice);}
    }
    assert.deepEqual(f.w.worlds.get(saved.id), saved);
    const first = await f.run('publish_world_draft', {id: saved.id, version: saved.version});
    const revision = f.w.worlds.listRevisions()[0]!;
    assert.deepEqual(first, {id: revision.id, draftId: saved.id, version: saved.version, title: saved.content.title});
    assert.ok(JSON.stringify(first).length < 16000); assert.ok(JSON.stringify(revision).length > 16000);
    assert.deepEqual(await f.run('publish_world_draft', {id: saved.id, version: saved.version}), first);
    assert.equal(f.w.worlds.listRevisions().length, 1);
  } finally {await f.close();}
});
