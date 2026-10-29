import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { worldContentSchema, type PlaytestReport, type WorldDraft } from '@novel-game/contracts';
import { applyGuidance, simulateWorld } from '@novel-game/play-runtime/sim';
import { lintWorld } from '@novel-game/rules/preflight';
import * as agent from '../src/modules/agent/index.js';
import { WorldService, SqliteWorldRepository } from '../src/modules/worlds/index.js';
import { openDatabase } from '../src/platform/database.js';

const world = worldContentSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/s1/route-coverage.engine.json', import.meta.url), 'utf8')));
const revision = {id: 'rev', draftId: 'draft', sourceId: 'source', version: 1, content: world, createdAt: '2026-10-29T00:00:00Z'};
const before = await simulateWorld(revision, {seeds: 40, guidance: true});
const hint = before.routeCoverage!.guidance!.find(h => h.endingId === 'coop')!;
const edits = hint.edits.filter(e => e.kind !== 'nudge-card');
const patched = applyGuidance(world, edits);
const after = await simulateWorld({...revision, content: patched}, {seeds: 40});

function setup() {
  assert.equal(typeof agent.AgentRepairService, 'function', 'public AgentRepairService must implement the author-confirmed repair flow');
  const db = openDatabase(':memory:');
  const source = {id: 'source', chapters: [], title: '修复测试'};
  const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => source as never});
  const draft = worlds.create({sourceId: source.id, content: structuredClone(world)});
  let report: PlaytestReport | undefined = structuredClone({...before, draftId: draft.id, draftVersion: 1});
  let failSave = false;
  let newLintError = false;
  let hook: (() => void) | undefined;
  let override: ((r: PlaytestReport, d: WorldDraft) => void) | undefined;
  const inspections: number[] = [];
  const repository = new agent.SqliteRepairRepository(db);
  const preflight = {
    getWorldPreflight: () => ({playtest: report}),
    inspectWorldDraft: async (d: WorldDraft) => {
      inspections.push(d.version);
      const changed = d.content.actions.find(a => a.id === 'sell_out')!.requires.length > world.actions.find(a => a.id === 'sell_out')!.requires.length;
      const playtest = structuredClone({...changed ? after : before, draftId: d.id, draftVersion: d.version});
      override?.(playtest, d);
      hook?.(); hook = undefined;
      const lint = lintWorld(d.content, {draftId: d.id, draftVersion: d.version});
      if (newLintError && changed) {
        lint.errors++; lint.issues.push({severity: 'error', category: 'structure', ruleId: 'test.new-error', message: '新增结构错误'});
      }
      return {lint, playtest};
    },
    saveWorldInspection: () => {if (failSave) throw new Error('report write failed');},
  };
  const deps = {worlds, preflight, repository, atomic: <T>(operation: () => T) => db.transaction(operation).immediate()};
  const service = new agent.AgentRepairService(deps);
  const create = () => service.create({draftId: draft.id, version: 1, endingId: 'coop'});
  return {db, worlds, draft, repository, service, deps, inspections, create,
    report: (r: typeof report) => {report = r;}, getReport: () => report!,
    newLintError: () => {newLintError = true;},
    failSave: () => {failSave = true;}, hook: (h: () => void) => {hook = h;},
    override: (h: NonNullable<typeof override>) => {override = h;}};
}

test('agent repair: creates a measured rule-only candidate without editing the draft; repeated creation is stable', async () => {
  const s = setup(); try {
    const c = await s.create();
    assert.equal(c.status, 'pending'); assert.equal(c.baseVersion, 1);
    assert.ok(c.changes.length); assert.ok(c.edits.every(e => e.kind !== 'nudge-card'));
    assert.ok(c.preview.afterRate > c.preview.beforeRate);
    assert.equal(c.preview.seeds, 40); assert.equal(c.preview.allowed, true);
    assert.equal(s.worlds.get(s.draft.id).version, 1);
    assert.deepEqual(s.worlds.get(s.draft.id).content, world);
    assert.equal((await s.create()).id, c.id);
    assert.equal(s.service.list(s.draft.id).length, 1);
  } finally {s.db.close();}
});

test('agent repair: missing and stale reports cannot generate a candidate', async () => {
  const s = setup(); try {
    s.report({...s.getReport(), draftVersion: 2});
    await assert.rejects(s.create(), {code: 'AGENT_REPAIR_REPORT_STALE'});
    s.report(undefined); await assert.rejects(s.create(), {code: 'AGENT_REPAIR_REPORT_STALE'});
    assert.equal(s.service.list(s.draft.id).length, 0);
  } finally {s.db.close();}
});

test('agent repair: new lint errors and interrupted verification leave the candidate pending', async () => {
  const s = setup(); try {
    const c = await s.create(); s.newLintError();
    await assert.rejects(s.service.apply(c.id), {code: 'AGENT_REPAIR_BLOCKED'});
    s.override(() => {throw new Error('verification interrupted');});
    await assert.rejects(s.service.apply(c.id), /verification interrupted/);
    assert.equal(s.worlds.get(s.draft.id).version, 1);
    assert.equal(s.service.list(s.draft.id)[0]!.status, 'pending');
  } finally {s.db.close();}
});

test('agent repair: parallel create/apply calls produce one candidate and one new version', async () => {
  const s = setup(); try {
    const [a, b] = await Promise.all([s.create(), s.create()]);
    assert.equal(a.id, b.id); assert.equal(s.service.list(s.draft.id).length, 1);
    await Promise.all([s.service.apply(a.id), s.service.apply(b.id)]);
    assert.equal(s.worlds.get(s.draft.id).version, 2);
  } finally {s.db.close();}
});

test('agent repair: placeholder-card-only hints require manual work', async () => {
  const s = setup(); try {
    await assert.rejects(s.service.create({draftId: s.draft.id, version: 1, endingId: 'duel'}), {code: 'AGENT_REPAIR_UNSUPPORTED'});
  } finally {s.db.close();}
});

test('agent repair: rejection is persistent and never writes the world', async () => {
  const s = setup(); try {
    const c = await s.create(); s.service.reject(c.id); s.service.reject(c.id);
    assert.equal(new agent.AgentRepairService(s.deps).list(s.draft.id)[0]!.status, 'rejected');
    await assert.rejects(s.service.apply(c.id), {code: 'AGENT_REPAIR_STATE_CONFLICT'});
    assert.equal(s.worlds.get(s.draft.id).version, 1);
  } finally {s.db.close();}
});

test('agent repair: author confirmation rechecks, atomically saves, and is idempotent across service restart', async () => {
  const s = setup(); try {
    const c = await s.create(); const count = s.inspections.length;
    const result = await s.service.apply(c.id);
    assert.ok(s.inspections.length > count, 'apply performs fresh inspection');
    assert.equal(result.candidate.status, 'applied'); assert.equal(result.candidate.appliedVersion, 2);
    assert.deepEqual(result.draft.content, patched);
    const restarted = new agent.AgentRepairService(s.deps);
    assert.equal((await restarted.apply(c.id)).draft.version, 2);
    assert.equal(s.worlds.listRevisions().length, 0, 'confirmation never publishes');
    assert.throws(() => s.service.reject(c.id), {code: 'AGENT_REPAIR_STATE_CONFLICT'});
  } finally {s.db.close();}
});

test('agent repair: an author edit makes the old candidate inapplicable', async () => {
  const s = setup(); try {
    const c = await s.create();
    s.worlds.update(s.draft.id, {version: 1, content: {...world, title: '作者的新标题'}});
    await assert.rejects(s.service.apply(c.id), {code: 'DRAFT_VERSION_CONFLICT'});
    assert.equal(s.worlds.get(s.draft.id).content.title, '作者的新标题');
  } finally {s.db.close();}
});

test('agent repair: edits made during asynchronous verification are protected', async () => {
  const s = setup(); try {
    const c = await s.create();
    s.hook(() => s.worlds.update(s.draft.id, {version: 1, content: {...world, title: '验证时的作者编辑'}}));
    await assert.rejects(s.service.apply(c.id), {code: 'DRAFT_VERSION_CONFLICT'});
    assert.equal(s.worlds.get(s.draft.id).content.title, '验证时的作者编辑');
    assert.equal(s.service.list(s.draft.id)[0]!.status, 'pending');
  } finally {s.db.close();}
});

test('agent repair: a failed report save rolls back world version and candidate status', async () => {
  const s = setup(); try {
    const c = await s.create(); s.failSave();
    await assert.rejects(s.service.apply(c.id), /report write failed/);
    assert.equal(s.worlds.get(s.draft.id).version, 1);
    assert.equal(s.service.list(s.draft.id)[0]!.status, 'pending');
  } finally {s.db.close();}
});

for (const failure of ['no-improvement', 'dead-end', 'check-regression'] as const) {
  test(`agent repair: ${failure} blocks application without writes`, async () => {
    const s = setup(); try {
      const c = await s.create();
      s.override((report, draft) => {
        if (draft.version !== 2) return;
        if (failure === 'no-improvement') report.endingRates.random!.coop = 0;
        if (failure === 'dead-end') report.deadEnds = before.deadEnds + 1;
        if (failure === 'check-regression') report.checks = [{id: 'G4', label: '', line: '', measured: '', pass: false}];
      });
      await assert.rejects(s.service.apply(c.id), {code: 'AGENT_REPAIR_BLOCKED'});
      assert.equal(s.worlds.get(s.draft.id).version, 1);
    } finally {s.db.close();}
  });
}
