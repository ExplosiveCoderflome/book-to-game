import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GenerationJob } from '@novel-game/contracts';
import { jobProgressLabel, jobStageChips, relevantStoryJob } from '../src/lib/job-on-canvas.ts';

function job(partial: Partial<GenerationJob> & Pick<GenerationJob, 'id' | 'status' | 'stage'>): GenerationJob {
  return {
    sourceId: 'src', progress: 0, completedChunks: 0, totalChunks: 4,
    error: null, draftId: null, analysis: null, createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z', mode: 'story',
    ...partial,
  };
}

test('jobStageChips tracks analyze → design → draft', () => {
  const chips = jobStageChips(job({ id: '1', status: 'running', stage: '分析小说 2/4', progress: 0.4 }));
  assert.equal(chips.find(c => c.id === 'analyze')?.state, 'active');
  assert.equal(chips.find(c => c.id === 'design')?.state, 'pending');
  const done = jobStageChips(job({ id: '1', status: 'succeeded', stage: '草稿已生成', progress: 1, draftId: 'd1' }));
  assert.ok(done.every(c => c.state === 'done'));
});

test('relevantStoryJob prefers active job for the source', () => {
  const jobs = [
    job({ id: 'old', status: 'succeeded', stage: '草稿已生成', draftId: 'd1', updatedAt: '2026-01-01T01:00:00Z' }),
    job({ id: 'run', status: 'running', stage: '设计分支冒险', progress: 0.9, updatedAt: '2026-01-01T02:00:00Z' }),
  ];
  assert.equal(relevantStoryJob(jobs, { sourceId: 'src' })?.id, 'run');
  assert.equal(jobProgressLabel(jobs[1]!), '90%');
});
