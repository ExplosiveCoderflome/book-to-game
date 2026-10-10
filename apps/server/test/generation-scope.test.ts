import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteDatabase as Database } from '../src/platform/database.js';
import type { Analysis, SourceDocument, WorldContent } from '@novel-game/contracts';
import { JobService, GenerationRunner, SqliteJobRepository } from '../src/modules/generation/index.js';

const source: SourceDocument = {id: 'book', title: '河上', filename: 'river.txt', encoding: 'utf8', chapterCount: 3,
  charCount: 30, createdAt: '2026-10-10', chapters: ['c1', 'c2', 'c3'].map((id, index) => ({id, index, title: id,
    paragraphs: [{id: `p${index}`, index: 0, text: `正文-${id}`}]}))};
const analysis: Analysis = {summary: '渡口', characters: [], locations: [], worldRules: [], uncertainties: []};
function fixture() {
  const db = new Database(':memory:'); const repo = new SqliteJobRepository(db); const sources = {get: () => source};
  return {db, repo, sources, jobs: new JobService(repo, sources, () => true)};
}
test('selected chapters alone reach analysis in source order; open jobs create world drafts with plan snapshot', async () => {
  const f = fixture();
  try {
    const job = f.jobs.create({sourceId: source.id, requestId: crypto.randomUUID(), direction: '救证人', mode: 'open',
      chapterIds: ['c3', 'c2'], playerRole: '摆渡人', canonPolicy: 'divergent'});
    const seen: string[] = []; let options: any; let worldDrafts = 0;
    const runner = new GenerationRunner(f.repo, f.sources, {
      async analyze(chunk) {seen.push(...chunk.paragraphs.map(p => p.text)); return analysis;},
      async generate() {throw new Error('story generator must not execute');},
      async generateWorld(_analysis, input) {options = input; return {mode: 'open', sourceChapterIds: ['c2', 'c3']} as WorldContent;},
    }, () => {throw new Error('story writer must not execute');}, () => ({id: `world-${++worldDrafts}`}));
    await runner.runOnce();
    assert.equal(f.jobs.get(job.id).status, 'succeeded'); assert.equal(f.jobs.get(job.id).draftId, 'world-1');
    assert.deepEqual(seen, ['正文-c2', '正文-c3']); assert.deepEqual(options.chapterIds, ['c2', 'c3']);
    assert.equal(options.playerRole, '摆渡人'); assert.equal(options.canonPolicy, 'divergent');
    assert.deepEqual(f.jobs.get(job.id).analysis?.coverage.chapterIds, ['c2', 'c3']);
    assert.equal(f.jobs.get(job.id).analysis?.coverage.totalChapters, 2);
    assert.equal(f.jobs.get(job.id).direction, '救证人');
  } finally {f.db.close();}
});
test('unknown or duplicate chapters reject before job creation; request fingerprint includes adaptation options', () => {
  const f = fixture();
  try {
    const input = {sourceId: source.id, requestId: crypto.randomUUID(), direction: '方向', mode: 'open' as const, chapterIds: ['c1']};
    assert.throws(() => f.jobs.create({...input, chapterIds: ['missing']}), /章节/);
    assert.throws(() => f.jobs.create({...input, chapterIds: ['c1', 'c1']}), /章节/);
    assert.equal(f.jobs.list().length, 0);
    const first = f.jobs.create(input); assert.equal(f.jobs.create(input).id, first.id);
    for (const change of [{chapterIds: ['c2']}, {mode: 'story' as const}, {playerRole: '商人'}, {canonPolicy: 'divergent' as const}]) {
      assert.throws(() => f.jobs.create({...input, ...change}), /重复|冲突/);
    }
  } finally {f.db.close();}
});
test('open output cannot silently claim unselected chapters; retry reuses completed analysis', async () => {
  const f = fixture();
  try {
    const job = f.jobs.create({sourceId: source.id, requestId: crypto.randomUUID(), direction: '', mode: 'open', chapterIds: ['c2']});
    let wrongScope = true; let analyses = 0; let drafts = 0;
    const runner = new GenerationRunner(f.repo, f.sources, {
      async analyze() {analyses++; return analysis;}, async generate() {throw new Error('unused');},
      async generateWorld() {return {mode: 'open', sourceChapterIds: [wrongScope ? 'c1' : 'c2']} as WorldContent;},
    }, () => ({id: 'unused'}), () => {drafts++; return {id: 'world'};});
    await runner.runOnce(); assert.equal(f.jobs.get(job.id).status, 'failed'); assert.equal(drafts, 0);
    wrongScope = false; f.jobs.retry(job.id); await runner.runOnce();
    assert.equal(f.jobs.get(job.id).status, 'succeeded'); assert.equal(analyses, 1); assert.equal(drafts, 1);
  } finally {f.db.close();}
});
