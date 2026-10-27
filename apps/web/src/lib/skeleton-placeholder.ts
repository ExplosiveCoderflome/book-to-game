import type { BranchSkeleton, GameContent } from '@novel-game/contracts';

/** Coerce a locked BranchSkeleton into GameContent for read-only canvas placeholder rendering. */
export function skeletonToCanvasContent(skeleton: BranchSkeleton): GameContent {
  return {
    title: skeleton.title,
    mode: 'story',
    premise: skeleton.premise,
    adaptationNotes: skeleton.adaptationNotes,
    variables: skeleton.variables,
    canvasLayout: skeleton.canvasLayout,
    startSceneId: skeleton.startSceneId,
    scenes: skeleton.scenes.map(scene => ({
      ...scene,
      text: (scene.text && scene.text.trim()) || '（骨架占位，正文生成中）',
      evidence: scene.evidence ?? [],
      choices: scene.choices ?? [],
    })),
  };
}

/** Active story job with a locked skeleton but no draft yet → show mid-job placeholder. */
export function shouldShowSkeletonPlaceholder(
  job: { status: string; draftId?: string | null; skeleton?: unknown } | null | undefined,
  opts: { dirty?: boolean; jsonMode?: boolean; canvasMode?: string } = {},
): boolean {
  if (!job?.skeleton) return false;
  if (job.draftId) return false;
  if (job.status !== 'running' && job.status !== 'queued') return false;
  if (opts.dirty || opts.jsonMode) return false;
  if (opts.canvasMode && opts.canvasMode !== 'edit') return false;
  return true;
}
