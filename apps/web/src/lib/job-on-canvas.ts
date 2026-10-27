import type { GenerationJob } from '@novel-game/contracts';

export type JobStageChip = {
  id: string;
  label: string;
  state: 'done' | 'active' | 'pending';
};

const STAGE_ORDER = ['queued', 'analyze', 'design', 'draft'] as const;

/** Map job.stage / status into coarse chips for the canvas strip. */
export function jobStageChips(job: Pick<GenerationJob, 'status' | 'stage' | 'progress' | 'mode'>): JobStageChip[] {
  const stage = job.stage || '';
  let current: (typeof STAGE_ORDER)[number] =
    job.status === 'queued' ? 'queued'
      : job.status === 'succeeded' ? 'draft'
        : /分析/.test(stage) ? 'analyze'
          : /设计|分支|开放|世界|冒险/.test(stage) ? 'design'
            : /草稿|完成/.test(stage) ? 'draft'
              : job.progress >= 0.85 ? 'design'
                : job.progress > 0 ? 'analyze'
                  : 'queued';
  if (job.status === 'failed' || job.status === 'cancelled') {
    // keep estimated current for context
  }
  const labels: Record<(typeof STAGE_ORDER)[number], string> = {
    queued: '排队',
    analyze: '分析原文',
    design: job.mode === 'open' ? '设计世界' : '设计分支',
    draft: '写入草稿',
  };
  const idx = STAGE_ORDER.indexOf(current);
  return STAGE_ORDER.map((id, i) => ({
    id,
    label: labels[id],
    state: job.status === 'succeeded' ? 'done'
      : i < idx ? 'done'
        : i === idx ? (job.status === 'failed' || job.status === 'cancelled' ? 'active' : 'active')
          : 'pending',
  }));
}

/** Prefer active story job for this source; else latest succeeded with draftId; else latest related. */
export function relevantStoryJob(
  jobs: GenerationJob[],
  opts: { sourceId?: string | null; draftId?: string | null },
): GenerationJob | null {
  const story = jobs.filter(j => (j.mode ?? 'story') !== 'open');
  const forSource = opts.sourceId ? story.filter(j => j.sourceId === opts.sourceId) : story;
  const forDraft = opts.draftId ? story.filter(j => j.draftId === opts.draftId) : [];
  const active = [...forDraft, ...forSource].find(j => j.status === 'queued' || j.status === 'running');
  if (active) return active;
  const succeeded = [...forDraft, ...forSource]
    .filter(j => j.status === 'succeeded' && j.draftId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (succeeded[0]) return succeeded[0];
  const recent = [...forDraft, ...forSource].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return recent[0] ?? null;
}

export function jobProgressLabel(job: GenerationJob): string {
  if (job.stage.startsWith('分析小说 ')) {
    return `${job.completedChunks}/${job.totalChunks}`;
  }
  return `${Math.round(Math.min(1, Math.max(0, job.progress)) * 100)}%`;
}
