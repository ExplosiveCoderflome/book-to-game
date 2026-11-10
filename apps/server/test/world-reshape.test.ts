import assert from 'node:assert/strict';
import {test} from 'node:test';
import {WorldService, SqliteWorldRepository} from '../src/modules/worlds/index.js';
import {openDatabase} from '../src/platform/database.js';
import {worldCommands} from '../src/app/commands/worlds.js';
import {createAgentChatTools} from '../src/app/agent-chat-tools.js';
import {AgentChatService, SqliteChatRepository} from '../src/modules/agent/index.js';
import {scriptedChat} from './helpers/agent-pi.js';
import {createWorkbench} from '../src/app/workbench.js';
import {createCommands} from '../src/app/commands/index.js';
import {createModelSettings} from '../src/platform/create-model-settings.js';
import {applyWorldComposition} from '../src/modules/worlds/index.js';
import {content, source} from './helpers/open-fixture.js';

function fixture() {
  const db = openDatabase(':memory:');
  const repository = new SqliteWorldRepository(db);
  const worlds = new WorldService(repository, {get: () => structuredClone(source)});
  const initial = content();
  const draft = worlds.create({sourceId: source.id, content: initial});
  const candidate = structuredClone(draft.content);
  candidate.actions.find(item => item.id === 'to_market')!.effects = [{kind: 'move', locationId: 'gate'}];
  const input = {worldId: draft.id, expectedVersion: draft.version, content: candidate};
  const commands = worldCommands({worlds} as never);
  const tools = createAgentChatTools(commands, {worlds} as never);
  return {db, repository, worlds, draft, candidate, input, commands, tools};
}
const code = (expected: string) => (error: unknown) => (error as {code?: string}).code === expected;

test('reshape: read-only proposal binds exact target/before/after, detailed loss summary; ordinary writes and command confirmation stay denied', async () => {
  const f = fixture();
  try {
    assert.equal(f.worlds.validate(f.draft.id).valid, true);
    const baseline = f.worlds.getPreservationBaseline(f.draft.id);
    const changes = f.db.prepare('SELECT total_changes() AS n').get();
    const proposal = f.worlds.proposeReshape(f.input);
    assert.deepEqual(f.db.prepare('SELECT total_changes() AS n').get(), changes);
    assert.match(proposal.summary, /market.*→.*gate/);
    assert.match(proposal.summary, /actions:to_market/);
    assert.ok(proposal.summary.includes(f.draft.id));
    assert.ok(proposal.summary.includes(proposal.diffHash));
    assert.throws(() => f.worlds.update(f.draft.id, {version: 1, content: f.candidate}), code('WORLD_PRESERVATION_REQUIRED'));
    assert.throws(() => f.worlds.applyContent(f.draft.id, {version: 1, content: f.candidate}), code('WORLD_PRESERVATION_REQUIRED'));
    assert.throws(() => f.commands.find(c => c.name === 'confirm_world_reshape')!.execute({...f.input, diffHash: proposal.diffHash}), code('RESHAPE_AUTHOR_CONFIRMATION_REQUIRED'));
    const tool = f.tools.find(t => t.name === 'confirm_world_reshape')!;
    assert.equal(tool.requiresConfirmation, true);
    for (const extra of [{confirm: true}, {allowDestructive: true}, {authorization: 'forged'}])
      assert.throws(() => tool.validate({...f.input, diffHash: proposal.diffHash, ...extra}));
    assert.deepEqual(f.worlds.get(f.draft.id), f.draft);
    assert.deepEqual(f.worlds.getPreservationBaseline(f.draft.id), baseline);
  } finally {f.db.close();}
});

async function pending(f: ReturnType<typeof fixture>) {
  const proposal = f.worlds.proposeReshape(f.input);
  const args = {...f.input, diffHash: proposal.diffHash};
  const replies = [{text: '', calls: [{id: 'reshape-call', name: 'confirm_world_reshape', arguments: args}]}];
  const service = new AgentChatService({repository: new SqliteChatRepository(f.db), tools: () => f.tools,
    model: () => scriptedChat(async () => replies.shift() ?? {text: '完成', calls: []})});
  const conversation = service.create();
  const result = await service.send({id: conversation.id, requestId: 'reshape-request', text: '提议重塑'});
  assert.equal(result.actions[0]?.status, 'pending');
  assert.equal(f.worlds.get(f.draft.id).version, 1);
  return {service, result, args};
}

test('reshape: actual author pending action confirms atomically, preserves provenance, creates protected baseline and idempotent receipt', async () => {
  const f = fixture();
  try {
    const {service, result, args} = await pending(f);
    const done = await service.decide({id: result.id, actionId: result.actions[0]!.id, decision: 'confirm'});
    assert.equal(done.actions[0]!.status, 'succeeded', done.actions[0]!.result);
    const saved = f.worlds.get(f.draft.id);
    assert.equal(saved.version, 2);
    assert.deepEqual(saved.content, f.candidate);
    assert.equal(f.worlds.getPreservationBaseline(saved.id)!.version, 2);
    assert.deepEqual(f.worlds.confirmAuthorReshape(args), saved);
    await service.decide({id: result.id, actionId: result.actions[0]!.id, decision: 'confirm'});
    assert.equal(f.worlds.get(saved.id).version, 2);
    assert.throws(() => f.worlds.update(saved.id, {version: 2, content: f.draft.content}), code('WORLD_PRESERVATION_REQUIRED'));
    const changed = {...args, content: {...f.candidate, title: '另一候选'}};
    assert.throws(() => f.worlds.confirmAuthorReshape(changed), code('RESHAPE_AUTHORIZATION_STALE'));
    f.worlds.update(saved.id, {version: 2, content: {...saved.content, title: '新版本'}});
    assert.throws(() => f.worlds.confirmAuthorReshape(args), code('RESHAPE_AUTHORIZATION_STALE'));
  } finally {f.db.close();}
});

test('reshape: rejection and stale pending action perform no reshape; same-version target tampering changes guard', async () => {
  for (const mode of ['reject', 'version', 'content', 'baseline', 'candidate'] as const) {
    const f = fixture();
    try {
      const {service, result} = await pending(f);
      if (mode === 'candidate') {
        const repository = new SqliteChatRepository(f.db);
        const conversation = repository.get(result.id)!;
        (conversation.actions[0]!.arguments.content as {title: string}).title = '偷换候选';
        repository.save(conversation, conversation.version);
      }
      if (mode === 'version') f.worlds.update(f.draft.id, {version: 1, content: {...f.draft.content, title: '并发修改'}});
      if (mode === 'content') f.db.prepare('UPDATE world_drafts SET data=? WHERE id=?').run(JSON.stringify({...f.draft, content: {...f.draft.content, title: '同版本修改'}}), f.draft.id);
      if (mode === 'baseline') {
        const baseline = f.worlds.getPreservationBaseline(f.draft.id)!;
        f.db.prepare('UPDATE world_preservation_baselines SET data=? WHERE draft_id=?').run(JSON.stringify({...baseline, hash: 'changed'}), f.draft.id);
      }
      const before = f.worlds.get(f.draft.id), baseline = f.worlds.getPreservationBaseline(f.draft.id);
      const done = await service.decide({id: result.id, actionId: result.actions[0]!.id, decision: mode === 'reject' ? 'reject' : 'confirm'});
      assert.equal(done.actions[0]!.status, mode === 'reject' ? 'rejected' : 'failed', mode);
      assert.deepEqual(f.worlds.get(f.draft.id), before);
      assert.deepEqual(f.worlds.getPreservationBaseline(f.draft.id), baseline);
      assert.equal(f.repository.getReshapeReceipt(String(result.actions[0]!.arguments.diffHash)), undefined);
    } finally {f.db.close();}
  }
});

test('reshape: schema and complete validation always run; sticky provenance, forged diff, target and oversized reviews fail closed', () => {
  const f = fixture();
  try {
    const baseline = f.worlds.getPreservationBaseline(f.draft.id);
    const invalid = structuredClone(f.candidate); invalid.initialLocationId = 'missing';
    assert.throws(() => f.worlds.proposeReshape({...f.input, content: invalid}), code('INVALID_WORLD'));
    assert.throws(() => f.worlds.proposeReshape({...f.input, content: {...f.candidate, schemaVersion: 99} as never}));
    const proposal = f.worlds.proposeReshape(f.input);
    assert.throws(() => f.worlds.confirmAuthorReshape({...f.input, diffHash: '0'.repeat(64)}), code('RESHAPE_DIFF_MISMATCH'));
    const other = f.worlds.create({sourceId: source.id, content: f.draft.content});
    assert.throws(() => f.worlds.confirmAuthorReshape({...f.input, worldId: other.id, diffHash: proposal.diffHash}), code('RESHAPE_DIFF_MISMATCH'));
    const huge = structuredClone(f.candidate);
    huge.locations.forEach(item => {item.text = '大'.repeat(4000);});
    assert.throws(() => f.worlds.proposeReshape({...f.input, content: huge}), code('RESHAPE_REVIEW_TOO_LARGE'));
    assert.deepEqual(f.worlds.get(f.draft.id), f.draft);
    assert.deepEqual(f.worlds.getPreservationBaseline(f.draft.id), baseline);
    const mock = f.worlds.create({sourceId: source.id, content: {...content(), provenance: {generator: 'mock', source: 'runner'}}});
    const claimed = {...mock.content, title: '重塑后', provenance: undefined};
    const input = {worldId: mock.id, expectedVersion: 1, content: claimed};
    const p = f.worlds.proposeReshape(input);
    const saved = f.worlds.confirmAuthorReshape({...input, diffHash: p.diffHash});
    assert.deepEqual(saved.content.provenance, mock.content.provenance);
    assert.throws(() => f.worlds.publish(mock.id, {version: saved.version}), code('MOCK_DRAFT_UNPUBLISHABLE'));
  } finally {f.db.close();}
});

test('reshape: real registry retains 76 tools plus dedicated proposal/confirmation = 78, automatic 41 / confirmed 37', () => {
  const db = openDatabase(':memory:');
  try {
    const settings = createModelSettings(db, '/tmp/opencode', {baseUrl: 'http://localhost/v1', model: 'unused-local-test', apiKey: '', timeoutMs: 3000});
    const w = createWorkbench(db, settings, undefined, {dataDir: '/tmp/opencode'});
    const tools = createAgentChatTools(createCommands(w), w);
    assert.equal(tools.length, 78);
    assert.equal(new Set(tools.map(t => t.name)).size, 78);
    assert.equal(tools.filter(t => t.requiresConfirmation).length, 37);
    assert.equal(tools.filter(t => !t.requiresConfirmation).length, 41);
    assert.equal(tools.find(t => t.name === 'confirm_world_reshape')!.requiresConfirmation, true);
    assert.equal(tools.find(t => t.name === 'propose_world_reshape')!.requiresConfirmation, false);
  } finally {db.close();}
});

test('reshape: atomic CAS catches content or baseline races after confirmation-time preparation', async t => {
  for (const mode of ['version', 'content', 'baseline', 'delete-baseline', 'insert-baseline'] as const) {
    await t.test(mode, () => {
      const f = fixture();
      try {
        // A real baseline may be captured in the same millisecond as draft creation.
        // Construct that legal initial state before proposal, without mocking business logic.
        const sameTimeBaseline = {...f.worlds.getPreservationBaseline(f.draft.id)!, capturedAt: f.draft.updatedAt};
        if (mode === 'delete-baseline' || mode === 'insert-baseline') {
          f.db.prepare('UPDATE world_preservation_baselines SET data=? WHERE draft_id=?').run(JSON.stringify(sameTimeBaseline), f.draft.id);
          assert.equal(f.worlds.getPreservationBaseline(f.draft.id)!.capturedAt, f.draft.updatedAt);
          if (mode === 'insert-baseline') f.db.prepare('DELETE FROM world_preservation_baselines WHERE draft_id=?').run(f.draft.id);
        }
        const p = f.worlds.proposeReshape(f.input), args = {...f.input, diffHash: p.diffHash};
        assert.equal(p.baselinePresent, mode !== 'insert-baseline');
        const original = f.repository.reshapeDraft.bind(f.repository);
        let racedDraft = f.draft, racedBaseline = f.worlds.getPreservationBaseline(f.draft.id);
        f.repository.reshapeDraft = (...params) => {
          if (mode === 'version') f.worlds.update(f.draft.id, {version: 1, content: {...f.draft.content, title: '并发'}});
          if (mode === 'content') f.db.prepare('UPDATE world_drafts SET data=? WHERE id=?').run(JSON.stringify({...f.draft, content: {...f.draft.content, title: '同版本竞态'}}), f.draft.id);
          if (mode === 'baseline') f.db.prepare('UPDATE world_preservation_baselines SET data=? WHERE draft_id=?').run(JSON.stringify({...racedBaseline, hash: 'race'}), f.draft.id);
          if (mode === 'delete-baseline') f.db.prepare('DELETE FROM world_preservation_baselines WHERE draft_id=?').run(f.draft.id);
          if (mode === 'insert-baseline') f.repository.capturePreservationBaseline(f.draft.id, sameTimeBaseline);
          racedDraft = f.worlds.get(f.draft.id); racedBaseline = f.worlds.getPreservationBaseline(f.draft.id);
          return original(...params);
        };
        assert.throws(() => f.worlds.confirmAuthorReshape(args), code('DRAFT_VERSION_CONFLICT'), mode);
        assert.deepEqual(f.worlds.get(f.draft.id), racedDraft);
        assert.deepEqual(f.worlds.getPreservationBaseline(f.draft.id), racedBaseline);
        assert.equal(f.repository.getReshapeReceipt(p.diffHash), undefined);
      } finally {f.db.close();}
    });
  }
});

test('reshape: same-time baseline existence changes authorization even when effective baseline hashes match', () => {
  for (const mode of ['delete-baseline', 'insert-baseline'] as const) {
    const f = fixture();
    try {
      const sameTimeBaseline = {...f.worlds.getPreservationBaseline(f.draft.id)!, capturedAt: f.draft.updatedAt};
      f.db.prepare('UPDATE world_preservation_baselines SET data=? WHERE draft_id=?').run(JSON.stringify(sameTimeBaseline), f.draft.id);
      if (mode === 'insert-baseline') f.db.prepare('DELETE FROM world_preservation_baselines WHERE draft_id=?').run(f.draft.id);
      const proposal = f.worlds.proposeReshape(f.input);
      assert.equal(proposal.baselinePresent, mode === 'delete-baseline');
      if (mode === 'delete-baseline') f.db.prepare('DELETE FROM world_preservation_baselines WHERE draft_id=?').run(f.draft.id);
      else f.repository.capturePreservationBaseline(f.draft.id, sameTimeBaseline);
      const changes = f.db.prepare('SELECT total_changes() AS n').get();
      const current = f.worlds.proposeReshape(f.input);
      assert.equal(current.baselineHash, proposal.baselineHash);
      assert.equal(current.beforeHash, proposal.beforeHash);
      assert.equal(current.afterHash, proposal.afterHash);
      assert.deepEqual(current.changes, proposal.changes);
      assert.equal(current.baselinePresent, !proposal.baselinePresent);
      assert.notEqual(current.diffHash, proposal.diffHash);
      const baseline = f.worlds.getPreservationBaseline(f.draft.id);
      assert.throws(() => f.worlds.confirmAuthorReshape({...f.input, diffHash: proposal.diffHash}), code('RESHAPE_DIFF_MISMATCH'), mode);
      assert.deepEqual(f.db.prepare('SELECT total_changes() AS n').get(), changes);
      assert.deepEqual(f.worlds.get(f.draft.id), f.draft);
      assert.deepEqual(f.worlds.getPreservationBaseline(f.draft.id), baseline);
      assert.equal(f.repository.getReshapeReceipt(proposal.diffHash), undefined);
    } finally {f.db.close();}
  }
});

test('reshape: legacy proposal does not capture baseline; reconstructed services retain exact receipt and new protections', () => {
  const f = fixture();
  try {
    f.db.prepare('DELETE FROM world_preservation_baselines WHERE draft_id=?').run(f.draft.id);
    const changes = f.db.prepare('SELECT total_changes() AS n').get();
    const p = f.worlds.proposeReshape(f.input);
    assert.equal(p.baselinePresent, false);
    assert.equal(f.worlds.proposeReshape(f.input).diffHash, p.diffHash);
    assert.deepEqual(f.db.prepare('SELECT total_changes() AS n').get(), changes);
    const args = {...f.input, diffHash: p.diffHash};
    const saved = f.worlds.confirmAuthorReshape(args);
    const restarted = new WorldService(new SqliteWorldRepository(f.db), {get: () => structuredClone(source)});
    assert.deepEqual(restarted.confirmAuthorReshape(args), saved);
    assert.equal(restarted.getPreservationBaseline(saved.id)!.version, 2);
    assert.throws(() => restarted.update(saved.id, {version: 2, content: f.draft.content}), code('WORLD_PRESERVATION_REQUIRED'));
  } finally {f.db.close();}
});

test('reshape: ordinary composition cannot reuse proposal hash or pretend author confirmation', () => {
  const f = fixture();
  try {
    const p = f.worlds.proposeReshape(f.input);
    const action = f.candidate.actions.find(a => a.id === 'to_market')!;
    assert.throws(() => applyWorldComposition(f.worlds, {getBlockCatalog: () => []} as never, {
      worldId: f.draft.id, expectedVersion: 1, operations: [{entity: 'action', op: 'replace', id: action.id, value: action}],
      blockSelections: [], diffHash: p.diffHash, confirm: true,
    } as never), code('WORLD_PRESERVATION_REQUIRED'));
    assert.equal(f.worlds.get(f.draft.id).version, 1);
  } finally {f.db.close();}
});

test('reshape: SQL failure rolls back content, baseline and receipt; exact retry succeeds once', () => {
  const f = fixture();
  try {
    const proposal = f.worlds.proposeReshape(f.input), args = {...f.input, diffHash: proposal.diffHash};
    const baseline = f.worlds.getPreservationBaseline(f.draft.id);
    f.db.exec("CREATE TRIGGER fail_reshape_receipt BEFORE INSERT ON world_reshape_receipts BEGIN SELECT RAISE(ABORT, 'injected'); END");
    assert.throws(() => f.worlds.confirmAuthorReshape(args), /injected/);
    assert.deepEqual(f.worlds.get(f.draft.id), f.draft);
    assert.deepEqual(f.worlds.getPreservationBaseline(f.draft.id), baseline);
    assert.equal(f.repository.getReshapeReceipt(proposal.diffHash), undefined);
    f.db.exec('DROP TRIGGER fail_reshape_receipt');
    assert.equal(f.worlds.confirmAuthorReshape(args).version, 2);
    assert.equal(f.worlds.confirmAuthorReshape(args).version, 2);
  } finally {f.db.close();}
});

test('reshape: unsupported preservation baseline cannot be silently discarded by a dedicated proposal', () => {
  const f = fixture();
  try {
    const baseline = {...f.worlds.getPreservationBaseline(f.draft.id), gameplay: {broken: 'not-json'}};
    f.db.prepare('UPDATE world_preservation_baselines SET data=? WHERE draft_id=?').run(JSON.stringify(baseline), f.draft.id);
    assert.throws(() => f.worlds.proposeReshape(f.input), code('WORLD_PRESERVATION_REQUIRED'));
    assert.deepEqual(f.worlds.get(f.draft.id), f.draft);
    assert.deepEqual(f.worlds.getPreservationBaseline(f.draft.id), baseline);
  } finally {f.db.close();}
});
