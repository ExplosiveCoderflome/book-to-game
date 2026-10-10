import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteDatabase as Database } from '../src/platform/database.js';
import type { Analysis, GameContent, SourceDocument } from '@novel-game/contracts';
import { JobService, GenerationRunner, SqliteJobRepository } from '../src/modules/generation/index.js';

const source: SourceDocument = {
  id: 'source-1', title: '夜渡', filename: 'night.txt', encoding: 'utf8', chapterCount: 2,
  charCount: 20000, createdAt: new Date().toISOString(),
  chapters: [0, 1].map(i => ({ id: `c${i}`, index: i, title: `第${i + 1}章`,
    paragraphs: [{ id: `p${i}`, index: 0, text: '渡船停靠。'.repeat(2000) }] })),
};
const analysis: Analysis = {summary: '渡口的抉择', characters: [], locations: [], worldRules: [], uncertainties: []};
const game = {title: '夜渡'} as GameContent;
function setup() {
  const db = new Database(':memory:');
  const repo = new SqliteJobRepository(db);
  const sources = {get: () => source};
  const service = new JobService(repo, sources, () => true);
  return {db, repo, service, sources};
}
test('job requests are idempotent; retry retains completed chunk checkpoints', async () => {
  const {db, repo, service, sources} = setup();
  try {
    const input = {sourceId: source.id, requestId: crypto.randomUUID(), direction: '渡口分歧'};
    const job = service.create(input);
    assert.equal(service.create(input).id, job.id);
    assert.throws(() => service.create({...input, direction: 'different'}), /重复|冲突/);
    let calls = 0;
    let fail = true;
    const provider = {
      async analyze() { calls++; if (fail && calls === 2) throw new Error('暂时不可用'); return analysis; },
      async generate() { return game; },
    };
    let draftCount = 0;
    const runner = new GenerationRunner(repo, sources, provider, () => ({id: `draft-${++draftCount}`}));
    await runner.runOnce();
    assert.equal(service.get(job.id).status, 'failed');
    assert.equal(service.get(job.id).completedChunks, 1);
    fail = false;
    service.retry(job.id);
    await runner.runOnce();
    assert.equal(service.get(job.id).status, 'succeeded');
    assert.equal(service.get(job.id).completedChunks, service.get(job.id).totalChunks);
    assert.equal(draftCount, 1);
    assert.equal(calls, service.get(job.id).totalChunks + 1);
    assert.deepEqual(service.get(job.id).analysis?.coverage.chapterIds, ['c0', 'c1']);
    await runner.runOnce();
    assert.equal(draftCount, 1);
  } finally {db.close();}
});
test('expired lease resumes, stale worker cannot checkpoint or commit; cancelled work does not commit', () => {
  const {db, repo, service} = setup();
  try {
    const job = service.create({sourceId: source.id, requestId: crypto.randomUUID(), direction: ''});
    assert.equal(repo.claim('old', 100, 10)?.id, job.id);
    assert.equal(repo.claim('new', 105, 10), null);
    assert.equal(repo.claim('new', 111, 10)?.id, job.id);
    assert.equal(repo.saveChunk(job.id, 'old', 0, analysis), false);
    let writes = 0;
    assert.equal(repo.completeWith(job.id, 'old', () => {writes++; return 'x';}), false);
    service.cancel(job.id);
    assert.equal(repo.completeWith(job.id, 'new', () => {writes++; return 'x';}), false);
    assert.equal(writes, 0);
    assert.equal(service.get(job.id).status, 'cancelled');
    assert.equal(service.retry(job.id).status, 'queued');
  } finally {db.close();}
});
test('draft creation and job completion roll back together on failure', () => {
  const {db, repo, service} = setup();
  try {
    db.exec('CREATE TABLE draft_test(id TEXT)');
    const job = service.create({sourceId: source.id, requestId: crypto.randomUUID(), direction: ''});
    repo.claim('worker', Date.now(), 10000);
    assert.throws(() => repo.completeWith(job.id, 'worker', () => {
      db.prepare('INSERT INTO draft_test VALUES (?)').run('draft'); throw new Error('validation failed');
    }), /validation failed/);
    assert.equal(db.prepare('SELECT * FROM draft_test').all().length, 0);
    assert.equal(service.get(job.id).draftId, null);
  } finally {db.close();}
});
test('unconfigured provider fails before creating a task', () => {
  const {db, repo, sources} = setup();
  try {
    const service = new JobService(repo, sources, () => false);
    assert.throws(() => service.create({sourceId: source.id, requestId: crypto.randomUUID(), direction: ''}), /模型/);
    assert.equal(service.list().length, 0);
  } finally {db.close();}
});
