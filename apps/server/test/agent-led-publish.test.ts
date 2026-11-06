import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorkbench} from '../src/app/workbench.js';
import {openDatabase} from '../src/platform/database.js';
import {createModelSettings} from '../src/platform/create-model-settings.js';
import {worldContentSchema, type WorldContent} from '@novel-game/contracts';
import {readFileSync} from 'node:fs';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {AppError} from '../src/shared/errors.js';
import {WorldService, SqliteWorldRepository} from '../src/modules/worlds/index.js';
import {source} from './helpers/open-fixture.js';
import {createCommands} from '../src/app/commands/index.js';

const sample = worldContentSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/s1/shoudeng.batch2.content.json', import.meta.url), 'utf8')));

function progressingWorld(sourceChapterId: string): WorldContent {
  return worldContentSchema.parse({schemaVersion: 1, mode: 'open', title: '五步渡河', premise: '找到渡河办法。', playerRole: '旅人', goal: '抵达对岸。',
    worldRules: ['每次调查都会留下线索。'], adaptationNotes: '', sourceChapterIds: [sourceChapterId], initialLocationId: 'dock', timeLimit: 12,
    timeoutEnding: '渡船离开。', locations: ['dock', 'bank', 'island'].map(id => ({id, title: id, text: `${id}的景象与来路不同。`, origin: 'adapted', evidence: []})),
    facts: Array.from({length: 5}, (_, index) => ({id: `clue-${index}`, label: `线索${index}`, description: `不同的证据与发现内容 ${index}`, kind: 'clue', initialValue: false, playerKnown: true, origin: 'adapted', evidence: []})),
    npcs: [], actions: [...Array.from({length: 5}, (_, index) => ({id: `inspect-${index}`, label: `调查${index}`, description: '仔细调查并记录一条线索', locationId: 'dock', availableWhen: [],
      requires: [], blockedReason: '暂不可用', risk: '耗费时间', timeCost: 1, once: true, effects: [{kind: 'set', factId: `clue-${index}`, value: true}], text: `你发现了第${index}条独立线索，记录着不同地点和人物的具体细节。`, origin: 'adapted', evidence: []})),
      {id: 'finish', label: '登船', description: '乘船抵达对岸', locationId: 'dock', availableWhen: [], requires: [], blockedReason: '暂不可用', risk: '结束旅程', timeCost: 1, once: false,
        effects: [{kind: 'ending', endingId: 'arrived'}], text: '船靠岸，你抵达岛上。', origin: 'adapted', evidence: []}], events: [],
    endings: [{id: 'arrived', title: '抵达', text: '船靠岸，你抵达岛上并完成渡河。', when: [{kind: 'time', atLeast: 6}]}]});
}

function setup() {
  const db = openDatabase(':memory:');
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-led-publish-'));
  const wb = createWorkbench(db, createModelSettings(db, dir, {baseUrl: 'https://unused.invalid', model: '', apiKey: '', timeoutMs: 1000}), undefined, {allowMockPublish: true, dataDir: dir});
  const source = wb.sources.importFile({title: 'fixture', filename: 'fixture.txt', bytes: Buffer.from('fixture source')});
  return {db, dir, wb, source, close() {db.close(); rmSync(dir, {recursive: true, force: true});}};
}

test('new draft contract is server-owned; direct service and command share the runtime publish gate', async () => {
  const s = setup();
  try {
    const content = progressingWorld(s.source.chapters[0]!.id);
    const draft = s.wb.worlds.create({sourceId: s.source.id, content});
    assert.equal(draft.qualityContractVersion, 1);
    await s.wb.preflight.playtestWorldDraft({id: draft.id, expectedVersion: 1, seeds: 6, strategies: ['random', 'greedy-growth', 'greedy-money', 'merchant', 'lazy'], evidenceRuns: 6, maxSteps: 300});
    const cmd = createCommands(s.wb).find(command => command.name === 'publish_world_draft')!;
    const published = await cmd.execute({id: draft.id, version: 1}) as {version: number};
    assert.equal(published.version, 1);
    const noGate = new WorldService(new SqliteWorldRepository(s.db), {get: () => structuredClone(s.source)});
    const other = noGate.create({sourceId: s.source.id, content});
    assert.throws(() => noGate.publish(other.id, {version: 1}), (error: unknown) => error instanceof AppError && error.code === 'PUBLISH_QUALITY_UNAVAILABLE');
    assert.equal(s.wb.worlds.listRevisions().some(revision => revision.draftId === other.id), false);
  } finally {s.close();}
});

test('missing gate fails closed; injected stale passing report cannot approve changed content', async () => {
  const s = setup();
  try {
    const draft = s.wb.worlds.create({sourceId: s.source.id, content: progressingWorld(s.source.chapters[0]!.id)});
    (s.wb.preflight as unknown as {repository: {savePlaytest(id: string, report: import('@novel-game/contracts').PlaytestReport): void}}).repository.savePlaytest(draft.id, {draftId: draft.id, draftVersion: draft.version, createdAt: new Date().toISOString(), seeds: 1, maxSteps: 1,
      evidence: {schemaVersion: 1, checkVersion: 'fake', reportId: 'fake', contentHash: '0'.repeat(64), runs: 1, seed: 1, maxSteps: 1, strategies: [], status: 'observed', endingReachability: [], witnesses: [], samples: [],
        distribution: {runs: 1, rawSteps: {minimum: 1, average: 1, maximum: 1}, effectiveSteps: {minimum: 1, average: 1, maximum: 1}}, deadEnds: [], cappedRuns: 0, cappedWitnesses: [], repeatedStates: 0, noProgressRuns: 0, prose: {observed: true, repeatedBodies: []}},
      strategies: [], endingRates: {}, endings: [], medians: {}, resourceBands: {}, cards: {neverDrawn: [], drawRate: {}, consecutiveRepeatRate: 0}, deadEnds: 0, lockedRatio: 0, pinnedRatio: {}, gatesNeverMet: [], durationMs: 0});
    assert.throws(() => s.wb.worlds.publish(draft.id, {version: 1}), (error: unknown) => error instanceof AppError && ['PUBLISH_QUALITY_STALE', 'PLAYTEST_BLOCKED'].includes(error.code));
  } finally {s.close();}
});
