import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorkbench} from '../src/app/workbench.js';
import {openDatabase} from '../src/platform/database.js';
import {createModelSettings} from '../src/platform/create-model-settings.js';
import {worldContentSchema, type WorldContent} from '@novel-game/contracts';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {AppError} from '../src/shared/errors.js';
import {WorldService, SqliteWorldRepository} from '../src/modules/worlds/index.js';
import {createCommands} from '../src/app/commands/index.js';
import {checkWorldCausality} from '../src/modules/worlds/index.js';

const codeIs = (code: string) => (error: unknown) => error instanceof AppError && error.code === code;

function progressingWorld(sourceChapterId: string): WorldContent {
  return worldContentSchema.parse({schemaVersion: 1, mode: 'open', title: '五步渡河', premise: '找到渡河办法。', playerRole: '旅人', goal: '抵达对岸。',
    worldRules: ['每次调查都会留下线索。'], adaptationNotes: '', sourceChapterIds: [sourceChapterId], initialLocationId: 'dock', timeLimit: 12,
    timeoutEnding: '渡船离开。', locations: ['dock', 'bank', 'island'].map(id => ({id, title: id, text: `${id}的景象与来路不同。`, origin: 'adapted', evidence: []})),
    facts: Array.from({length: 5}, (_, index) => ({id: `clue-${index}`, label: `线索${index}`, description: `不同的证据与发现内容 ${index}`, kind: 'clue', initialValue: false, playerKnown: true, origin: 'adapted', evidence: []})),
    npcs: [], actions: [...Array.from({length: 5}, (_, index) => ({id: `inspect-${index}`, label: `调查${index}`, description: '仔细调查并记录一条线索', locationId: 'dock', availableWhen: [],
      requires: [], blockedReason: '暂不可用', risk: '耗费时间', timeCost: 1, once: true, effects: [{kind: 'set', factId: 'clue-0', value: true}], text: `你从第${index}处调查点核实了渡口消息，等待船工带回各段航道的独立调查结果。`, origin: 'adapted', evidence: []})),
      {id: 'finish', label: '登船', description: '乘船抵达对岸', locationId: 'dock', availableWhen: [], requires: [{kind: 'fact', factId: 'clue-0', value: true}, {kind: 'fact', factId: 'clue-1', value: true}, {kind: 'fact', factId: 'clue-2', value: true}, {kind: 'fact', factId: 'clue-3', value: true}, {kind: 'fact', factId: 'clue-4', value: true}], blockedReason: '暂不可用', risk: '结束旅程', timeCost: 1, once: false,
        effects: [{kind: 'ending', endingId: 'arrived'}], text: '船靠岸，你抵达岛上。', origin: 'adapted', evidence: []}],
    events: Array.from({length: 5}, (_, index) => ({id: `messenger-${index}`, label: `渡口传讯${index}`,
      when: [{kind: 'time', atLeast: index + 1}], effects: [{kind: 'set', factId: `clue-${index}`, value: true}],
      text: `第${index + 1}位船工抵达渡口，带来了航道第${index}段的独立调查结果。`, visibility: 'public'})),
    endings: [{id: 'arrived', title: '抵达', text: '船靠岸，你抵达岛上并完成渡河。',
      when: Array.from({length: 5}, (_, index) => ({kind: 'fact', factId: `clue-${index}`, value: true}))}]});
}

function setup(allowMockPublish = true) {
  const db = openDatabase(':memory:');
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-led-publish-'));
  const wb = createWorkbench(db, createModelSettings(db, dir, {baseUrl: 'https://unused.invalid', model: '', apiKey: '', timeoutMs: 1000}), undefined, {allowMockPublish, dataDir: dir});
  const source = wb.sources.importFile({title: 'fixture', filename: 'fixture.txt', bytes: Buffer.from('fixture source')});
  return {db, dir, wb, source, close() {db.close(); rmSync(dir, {recursive: true, force: true});}};
}

test('new draft contract is server-owned; direct service and command share the runtime publish gate', async () => {
  const s = setup();
  try {
    const content = progressingWorld(s.source.chapters[0]!.id);
    const draft = s.wb.worlds.create({sourceId: s.source.id, content});
    assert.equal(draft.qualityContractVersion, 1);
    assert.throws(() => s.wb.worlds.publish(draft.id, {version: 1}), (error: unknown) => error instanceof AppError && error.code === 'PUBLISH_QUALITY_STALE');
    const cmd = createCommands(s.wb).find(command => command.name === 'publish_world_draft')!;
    const published = await cmd.execute({id: draft.id, version: 1}) as {version: number};
    assert.equal(published.version, 1);
    const report = s.wb.preflight.getWorldPreflight(draft.id).playtest!;
    assert.deepEqual(report.strategies.map(strategy => strategy.id), ['random', 'greedy-growth-', 'greedy-', 'merchant', 'lazy']);
    assert.ok(report.evidence!.distribution.effectiveSteps.minimum >= 5);
    assert.equal(report.evidence!.samples.length, 30);
    assert.ok(report.evidence!.samples.every(sample => sample.endingId === 'arrived' && sample.effectiveSteps >= 5));
    assert.deepEqual(s.wb.worlds.publish(draft.id, {version: 1}), published);
    const noGate = new WorldService(new SqliteWorldRepository(s.db), {get: () => structuredClone(s.source)});
    const other = noGate.create({sourceId: s.source.id, content});
    assert.throws(() => noGate.publish(other.id, {version: 1}), (error: unknown) => error instanceof AppError && error.code === 'PUBLISH_QUALITY_UNAVAILABLE');
    assert.equal(s.wb.worlds.listRevisions().some(revision => revision.draftId === other.id), false);
  } finally {s.close();}
});

test('create uses schema output, strips unknown fields, isolates input and owns the contract', () => {
  const s = setup();
  try {
    const content = Object.assign(progressingWorld(s.source.chapters[0]!.id), {qualityContractVersion: 0, unknown: 'discard'});
    content.causalClaims = {keyResourceIds: [], keyChoiceIds: [], commitments: []};
    // Simulate an untyped caller omitting schema-defaulted fields.
    Reflect.deleteProperty(content.causalClaims, 'commitments');
    Object.assign(content.locations[0]!, {unknown: 'discard nested'});
    const draft = s.wb.worlds.create({sourceId: s.source.id, content});
    assert.equal(draft.qualityContractVersion, 1);
    assert.equal(Object.hasOwn(draft.content, 'qualityContractVersion'), false);
    assert.equal(Object.hasOwn(draft.content, 'unknown'), false);
    assert.equal(Object.hasOwn(draft.content.locations[0]!, 'unknown'), false);
    assert.deepEqual(draft.content.causalClaims?.commitments, []);
    const original = draft.content.locations[0]!.text;
    content.locations[0]!.text = 'caller mutation';
    assert.equal(draft.content.locations[0]!.text, original);
    assert.equal(s.wb.worlds.get(draft.id).content.locations[0]!.text, original);
    const invalid = progressingWorld(s.source.chapters[0]!.id);
    invalid.endings[0]!.when = [];
    assert.throws(() => s.wb.worlds.create({sourceId: s.source.id, content: invalid}));
    assert.equal(s.wb.worlds.list().length, 1);
  } finally {s.close();}
});

test('publish checks source, mock provenance and lint before requesting runtime evidence', async () => {
  const s = setup(false);
  try {
    let calls = 0;
    const playtest = s.wb.preflight.playtestWorldDraft.bind(s.wb.preflight);
    s.wb.preflight.playtestWorldDraft = input => {calls++; return playtest(input);};
    const cmd = createCommands(s.wb).find(command => command.name === 'publish_world_draft')!;
    const invalid = progressingWorld('missing-chapter');
    const badSource = s.wb.worlds.create({sourceId: s.source.id, content: invalid});
    await assert.rejects(async () => cmd.execute({id: badSource.id, version: 1}), codeIs('INVALID_WORLD'));
    const content = progressingWorld(s.source.chapters[0]!.id);
    const mock = s.wb.worlds.create({sourceId: s.source.id, content: {...content, provenance: {generator: 'mock'}}});
    await assert.rejects(async () => cmd.execute({id: mock.id, version: 1}), codeIs('MOCK_DRAFT_UNPUBLISHABLE'));
    const lintContent = progressingWorld(s.source.chapters[0]!.id);
    lintContent.actions[0]!.text = '命运的齿轮开始转动。';
    const lint = s.wb.worlds.create({sourceId: s.source.id, content: lintContent});
    await assert.rejects(async () => cmd.execute({id: lint.id, version: 1}), codeIs('LINT_BLOCKED'));
    assert.equal(calls, 0);
    assert.equal(s.wb.worlds.listRevisions().length, 0);
  } finally {s.close();}
});

test('changed prose invalidates evidence; command reruns it while stale versions fail CAS', async () => {
  const s = setup();
  try {
    const draft = s.wb.worlds.create({sourceId: s.source.id, content: progressingWorld(s.source.chapters[0]!.id)});
    const old = await s.wb.preflight.playtestWorldDraft({id: draft.id, seeds: 1, strategies: ['random'], evidenceRuns: 1});
    const content = {...draft.content, title: '渡河调查记录'};
    const updated = s.wb.worlds.update(draft.id, {version: 1, content});
    assert.throws(() => s.wb.worlds.publish(draft.id, {version: 2}), codeIs('PUBLISH_QUALITY_STALE'));
    const cmd = createCommands(s.wb).find(command => command.name === 'publish_world_draft')!;
    await assert.rejects(async () => cmd.execute({id: draft.id, version: 1}), codeIs('DRAFT_VERSION_CONFLICT'));
    const revision = await cmd.execute({id: draft.id, version: updated.version}) as {version: number};
    assert.equal(revision.version, 2);
    const fresh = s.wb.preflight.getWorldPreflight(draft.id).playtest!;
    assert.equal(fresh.draftVersion, 2);
    assert.notEqual(fresh.evidence!.contentHash, old.evidence!.contentHash);
  } finally {s.close();}
});

test('catalog strategy roles execute resource-specific runtime strategies without losing coverage', async () => {
  const s = setup();
  try {
    const content = progressingWorld(s.source.chapters[0]!.id);
    content.resourceDefs = {trust: {label: '信任', min: 0, max: 10}, coin: {label: '铜钱', min: 0, max: 10}};
    const draft = s.wb.worlds.create({sourceId: s.source.id, content});
    const report = await s.wb.preflight.playtestWorldDraft({id: draft.id, seeds: 1, evidenceRuns: 1,
      strategies: ['random', 'greedy-growth', 'greedy-money', 'merchant', 'lazy']});
    assert.deepEqual(report.strategies.map(strategy => strategy.id), ['random', 'greedy-trust', 'greedy-coin', 'merchant', 'lazy']);
    await assert.rejects(() => s.wb.preflight.playtestWorldDraft({id: draft.id, seeds: 1, strategies: ['unsupported']}), codeIs('INVALID_STRATEGY'));
    await assert.rejects(() => s.wb.preflight.inspectWorldDraft(draft, {seeds: 1, strategies: ['unsupported'], guidance: false}), codeIs('INVALID_STRATEGY'));
  } finally {s.close();}
});

test('direct synchronous publish runs the real gate after server playtest without the command adapter', async () => {
  const s = setup();
  try {
    const draft = s.wb.worlds.create({sourceId: s.source.id, content: progressingWorld(s.source.chapters[0]!.id)});
    await s.wb.preflight.playtestWorldDraft({id: draft.id, expectedVersion: 1, seeds: 6,
      strategies: ['random', 'greedy-growth', 'greedy-money', 'merchant', 'lazy'], evidenceRuns: 6, maxSteps: 300});
    const revision = s.wb.worlds.publish(draft.id, {version: 1});
    assert.equal(revision instanceof Promise, false);
    assert.equal(revision.version, 1);
    assert.deepEqual(revision.content, draft.content);
  } finally {s.close();}
});

test('legacy report without runtime evidence is stale and never accepted as a new-contract pass', async () => {
  const s = setup();
  try {
    const draft = s.wb.worlds.create({sourceId: s.source.id, content: progressingWorld(s.source.chapters[0]!.id)});
    const report = await s.wb.preflight.playtestWorldDraft({id: draft.id, seeds: 1, strategies: ['random']});
    const {evidence: _evidence, ...legacyReport} = report;
    s.db.prepare("UPDATE preflight_reports SET data=? WHERE kind='world' AND draft_id=? AND report_type='playtest'").run(JSON.stringify(legacyReport), draft.id);
    assert.throws(() => s.wb.worlds.publish(draft.id, {version: 1}), codeIs('PUBLISH_QUALITY_STALE'));
    const cmd = createCommands(s.wb).find(command => command.name === 'publish_world_draft')!;
    await cmd.execute({id: draft.id, version: 1});
    assert.equal(s.wb.preflight.getWorldPreflight(draft.id).playtest?.evidence?.status, 'observed');
  } finally {s.close();}
});

for (const legacy of [false, true]) test(`unsupported commitment declarations cannot pass the shared publish gate; legacy=${legacy}`, async () => {
  const s = setup();
  try {
    const content = progressingWorld(s.source.chapters[0]!.id);
    content.causalClaims = {keyResourceIds: [], keyChoiceIds: [], commitments: [{id: 'promise', actionId: 'inspect-0', factId: 'clue-0'}]};
    const draft = s.wb.worlds.create({sourceId: s.source.id, content});
    if (legacy) {const {qualityContractVersion: _contract, ...persisted} = draft;
      s.db.prepare('UPDATE world_drafts SET data=? WHERE id=?').run(JSON.stringify(persisted), draft.id);}
    const checked = checkWorldCausality(s.wb.worlds, {worldId: draft.id, expectedVersion: 1, maxStates: 1000});
    assert.notEqual(checked.status, 'pass');
    assert.ok(checked.findings.some(finding => finding.code === 'causality.commitment-unsupported'));
    const cmd = createCommands(s.wb).find(command => command.name === 'publish_world_draft')!;
    await assert.rejects(async () => cmd.execute({id: draft.id, version: 1}), codeIs('CAUSALITY_BLOCKED'));
    assert.throws(() => s.wb.worlds.publish(draft.id, {version: 1}), codeIs('CAUSALITY_BLOCKED'));
    assert.equal(s.wb.worlds.listRevisions().length, 0);
  } finally {s.close();}
});

test('legacy stays compatible until quality composition upgrades it; destructive edits remain refused', () => {
  const s = setup();
  try {
    const draft = s.wb.worlds.create({sourceId: s.source.id, content: progressingWorld(s.source.chapters[0]!.id)});
    const {qualityContractVersion: _contract, ...legacy} = draft;
    s.db.prepare('UPDATE world_drafts SET data=? WHERE id=?').run(JSON.stringify(legacy), draft.id);
    const revision = s.wb.worlds.publish(draft.id, {version: 1});
    assert.equal(revision instanceof Promise, false);
    const upgraded = s.wb.worlds.update(draft.id, {version: 1, content: {...draft.content, ledgerVersion: 1}});
    assert.equal(upgraded.qualityContractVersion, 1);
    assert.throws(() => s.wb.worlds.publish(draft.id, {version: 2}), codeIs('PUBLISH_QUALITY_STALE'));
    const reduced = {...upgraded.content, actions: upgraded.content.actions.slice(1)};
    assert.throws(() => s.wb.worlds.update(draft.id, {version: 2, content: reduced}), codeIs('WORLD_PRESERVATION_REQUIRED'));
    assert.equal(s.wb.worlds.get(draft.id).version, 2);
    assert.deepEqual(s.wb.worlds.publish(draft.id, {version: 1}), revision);
  } finally {s.close();}
});

test('missing gate fails closed; injected stale passing report cannot approve changed content', async () => {
  const s = setup();
  try {
    const draft = s.wb.worlds.create({sourceId: s.source.id, content: progressingWorld(s.source.chapters[0]!.id)});
    (s.wb.preflight as unknown as {repository: {savePlaytest(id: string, report: import('@novel-game/contracts').PlaytestReport): void}}).repository.savePlaytest(draft.id, {draftId: draft.id, draftVersion: draft.version, createdAt: new Date().toISOString(), seeds: 1, maxSteps: 1,
      evidence: {schemaVersion: 1, checkVersion: 'fake', reportId: 'fake', contentHash: '0'.repeat(64), runs: 1, seed: 1, maxSteps: 1, strategies: [], status: 'observed', endingReachability: [], witnesses: [], samples: [],
        distribution: {runs: 1, rawSteps: {minimum: 1, average: 1, maximum: 1}, effectiveSteps: {minimum: 1, average: 1, maximum: 1}}, deadEnds: [], cappedRuns: 0, cappedWitnesses: [], repeatedStates: 0, noProgressRuns: 0, prose: {observed: true, repeatedBodies: []}},
      strategies: [], checks: [], endingRates: {}, endings: [], medians: {}, resourceBands: {}, cards: {neverDrawn: [], drawRate: {}, consecutiveRepeatRate: 0}, deadEnds: 0, lockedRatio: 0, pinnedRatio: {}, gatesNeverMet: [], durationMs: 0});
    assert.throws(() => s.wb.worlds.publish(draft.id, {version: 1}), (error: unknown) => error instanceof AppError && ['PUBLISH_QUALITY_STALE', 'PLAYTEST_BLOCKED'].includes(error.code));
  } finally {s.close();}
});


for (const declared of ['ledger', 'causality'] as const) for (const legacy of [false, true]) test(`declared empty ${declared} scope is unsupported, never silently skipped at publish; legacy=${legacy}`, async () => {
  const s = setup();
  try {
    const content = progressingWorld(s.source.chapters[0]!.id);
    if (declared === 'ledger') content.ledgerVersion = 1;
    else content.causalClaims = {keyResourceIds: [], keyChoiceIds: [], commitments: []};
    const draft = s.wb.worlds.create({sourceId: s.source.id, content});
    if (legacy) {const {qualityContractVersion: _contract, ...persisted} = draft;
      s.db.prepare('UPDATE world_drafts SET data=? WHERE id=?').run(JSON.stringify(persisted), draft.id);}
    const command = createCommands(s.wb).find(c => c.name === 'publish_world_draft')!;
    await assert.rejects(command.execute({id: draft.id, version: 1}) as Promise<unknown>, codeIs(declared === 'ledger' ? 'LEDGER_BLOCKED' : 'CAUSALITY_BLOCKED'));
    assert.deepEqual(s.wb.worlds.listRevisions(), []);
  } finally {s.close();}
});
