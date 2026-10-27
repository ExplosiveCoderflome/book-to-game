import type { GenerationJob } from '@novel-game/contracts';

export type JobStageChip = {
  id: string;
  label: string;
  state: 'done' | 'active' | 'pending';
};

const STAGE_ORDER = ['queued', 'analyze', 'skeleton', 'expand', 'draft'] as const;

/** Map job.stage / status into coarse chips for the canvas strip. */
export function jobStageChips(job: Pick<GenerationJob, 'status' | 'stage' | 'progress' | 'mode' | 'skeleton'>): JobStageChip[] {
  const stage = job.stage || '';
  let current: (typeof STAGE_ORDER)[number] =
    job.status === 'queued' ? 'queued'
      : job.status === 'succeeded' ? 'draft'
        : /分析/.test(stage) ? 'analyze'
          : /扩展|写正文|正文/.test(stage) || (/骨架已锁定/.test(stage)) ? 'expand'
            : /骨架|设计分支|设计冒险/.test(stage) || (job.skeleton && /设计/.test(stage)) ? 'skeleton'
              : /设计|开放|世界|冒险/.test(stage) ? (job.mode === 'open' ? 'skeleton' : 'skeleton')
                : /草稿|完成/.test(stage) ? 'draft'
                  : job.skeleton ? 'expand'
                    : job.progress >= 0.9 ? 'expand'
                      : job.progress >= 0.85 ? 'skeleton'
                        : job.progress > 0 ? 'analyze'
                          : 'queued';
  if (job.status === 'failed' || job.status === 'cancelled') {
    // keep estimated current for context
  }
  const labels: Record<(typeof STAGE_ORDER)[number], string> = {
    queued: '排队',
    analyze: '分析原文',
    skeleton: job.mode === 'open' ? '设计世界' : '锁定骨架',
    expand: '写正文',
    draft: '写入草稿',
  };
  const idx = STAGE_ORDER.indexOf(current);
  return STAGE_ORDER.filter(id => job.mode === 'open' ? id !== 'expand' : true).map((id) => {
    const order = STAGE_ORDER.indexOf(id);
    return {
      id,
      label: labels[id],
      state: job.status === 'succeeded' ? 'done'
        : order < idx ? 'done'
          : order === idx ? 'active'
            : 'pending',
    };
  });
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
