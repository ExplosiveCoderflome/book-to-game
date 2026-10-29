import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqliteDatabase } from '../src/platform/database.js';
import { JobService, SqliteJobRepository } from '../src/modules/generation/index.js';
import type { SourceDocument } from '@novel-game/contracts';
import { testProductionBrief as brief, testProductionPlan } from './helpers/production-plan.js';

function setup() {
  const db = new SqliteDatabase(':memory:');
  const source: SourceDocument = {id: 's', title: '测试资料', filename: 'test.txt', encoding: 'utf8', chapterCount: 1, charCount: 3,
    createdAt: '', chapters: [{id: 'shoudeng-c1', index: 0, title: '一', paragraphs: [{id: 'p', index: 0, text: '灯亮了。'}]}]};
  const repository = new SqliteJobRepository(db), jobs = new JobService(repository, {get: () => source}, () => true);
  const job = jobs.create({sourceId: source.id, requestId: crypto.randomUUID(), direction: brief.goal, mode: 'open', playerRole: brief.playerRole, productionBrief: brief});
  repository.claim('review-test', Date.now(), 120000);
  const plan = testProductionPlan(['shoudeng-c1']);
  repository.saveProductionPlan(job.id, 'review-test', plan);
  return {db, repository, jobs, id: job.id, plan};
}

test('agent production: a saved plan can be inspected and checked without returning the complete job or changing it', () => {
  const s = setup(); try {
    const before = s.jobs.get(s.id);
    const summary = s.jobs.read(s.id);
    assert.ok('status' in summary);
    assert.equal(summary.status, 'awaiting_review'); assert.equal(summary.production!.approved, false);
    assert.equal('productionState' in summary, false); assert.equal('checkpoints' in summary, false);
    const bible = s.jobs.read(s.id, {path: ['productionState', 'plan', 'bible']});
    assert.ok('data' in bible);
    assert.deepEqual(bible.data!.value, s.plan.bible); assert.equal(bible.updatedAt, before.updatedAt);
    const checked = s.jobs.checkSavedProduction(s.id);
    assert.equal(checked.report.blocking, false); assert.equal(checked.updatedAt, before.updatedAt);
    assert.deepEqual(s.jobs.get(s.id), before);
    assert.throws(() => s.jobs.read(s.id, {path: ['checkpoints']}), {code: 'READ_PATH_NOT_FOUND'});
  } finally {s.db.close();}
});

test('agent production: approval uses the exact saved plan and rejects outdated or repeated decisions', () => {
  const s = setup(); try {
    const before = s.jobs.get(s.id);
    assert.throws(() => s.jobs.approveSavedProduction(s.id, 'old-review-time'), {code: 'JOB_STATE_CONFLICT'});
    assert.deepEqual(s.jobs.get(s.id), before);
    const queued = s.jobs.approveSavedProduction(s.id, before.updatedAt);
    assert.equal(queued.status, 'queued'); assert.equal(queued.productionState!.approved, true);
    assert.deepEqual(queued.productionState!.plan, before.productionState!.plan);
    assert.equal(queued.draftId, null, 'approval queues prose; it does not fabricate a finished game');
    assert.throws(() => s.jobs.approveSavedProduction(s.id, before.updatedAt), {code: 'JOB_STATE_CONFLICT'});
  } finally {s.db.close();}
});

test('agent production: final repository transaction checks the reviewed version, including after another actor changed the plan', async () => {
  const s = setup(); try {
    const before = s.jobs.get(s.id);
    // Model validation may take time: an external actor can cancel, resume and replace the pending plan.
    await new Promise(resolve => setTimeout(resolve, 5));
    s.jobs.cancel(s.id); s.jobs.retry(s.id); s.repository.claim('other-worker', Date.now(), 120000);
    const changed = structuredClone(s.plan); changed.world.title += '修订';
    s.repository.saveProductionPlan(s.id, 'other-worker', changed);
    assert.throws(() => s.repository.approveProduction(s.id, before.productionState!.plan, before.updatedAt), {code: 'JOB_STATE_CONFLICT'});
    assert.equal(s.jobs.get(s.id).productionState!.plan.world.title, changed.world.title);
    assert.equal(s.jobs.get(s.id).status, 'awaiting_review');
  } finally {s.db.close();}
});

test('agent production: stored plans with broken rules stay in review without starting prose', () => {
  const s = setup(); try {
    s.jobs.cancel(s.id); s.jobs.retry(s.id); s.repository.claim('bad-plan', Date.now(), 120000);
    const broken = structuredClone(s.plan);
    type Effect = {kind: string; factId?: string; value?: unknown; success?: Effect[]; failure?: Effect[]};
    const unset = (effects: Effect[] = []) => {for (const effect of effects) {
      if (effect.kind === 'set' && effect.factId === 'wenren_exposed') effect.value = false;
      unset(effect.success); unset(effect.failure);
    }};
    for (const action of broken.world.actions) unset(action.effects);
    for (const choice of broken.world.storylets!.flatMap(card => card.choices)) unset(choice.effects);
    for (const event of broken.world.events) unset(event.effects);
    s.repository.saveProductionPlan(s.id, 'bad-plan', broken);
    assert.equal(s.jobs.checkSavedProduction(s.id).report.blocking, true);
    assert.throws(() => s.jobs.approveSavedProduction(s.id, s.jobs.get(s.id).updatedAt), {code: 'PLAN_CHECK_BLOCKED'});
    assert.equal(s.jobs.get(s.id).status, 'awaiting_review'); assert.equal(s.jobs.get(s.id).productionState!.approved, false);
  } finally {s.db.close();}
});
