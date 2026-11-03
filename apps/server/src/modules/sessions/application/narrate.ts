import {narrateInputSchema, type NarrateInput, type NarrateResult, type SessionView} from '@novel-game/contracts';
import {entriesForScene} from '@novel-game/rules';
import { AppError } from '../../../shared/errors.js';
import { clearPlayAiCache, runPlayAi, type PlayAiModel } from '../../play-ai/index.js';
import type { RevisionReader } from './ports.js';
import type { SessionService } from './session-service.js';

/** Kept as the module-facing name: same provider surface as `runPlayAi`. */
export type StoryNarrateModel = PlayAiModel;

/** Single-process soft cache only — not shared across workers/replicas; lost on restart.
 *  Delegated to the shared play-ai cache (one blob per session visit: session+scene+turn). */
function visitKey(sessionId: string, sceneId: string, turn: number, tiandaoCorrect: boolean): string {
  return `story:${sessionId}:${sceneId}:${turn}:td${tiandaoCorrect ? 1 : 0}`;
}

const CACHE_PREFIX = 'narration:story:';

export function clearNarrateCache(): void {
  clearPlayAiCache(CACHE_PREFIX);
}

function worldbookSnippetsFor(view: SessionView, revisionReader: RevisionReader): { title: string; content: string; kind: string }[] {
  const revision = revisionReader.getRevision(view.gameRevisionId);
  const entries = entriesForScene(revision.content.worldbook, view.scene.id);
  return entries.slice(0, 6).map(entry => ({
    title: entry.title.slice(0, 80),
    content: entry.content.slice(0, 240),
    kind: entry.kind,
  }));
}

/**
 * L1: optional play-time flavor narration. Never mutates session/graph/variables.
 * Soft-fails to status=unavailable when the model errors (shared play-ai helper).
 */
export async function narrateSession(
  sessions: SessionService,
  revisionReader: RevisionReader,
  sessionId: string,
  raw: NarrateInput,
  model: StoryNarrateModel,
  signal: AbortSignal = AbortSignal.timeout(60_000),
): Promise<NarrateResult> {
  const input = narrateInputSchema.parse(raw);
  const view = sessions.get(sessionId);
  if (input.expectedTurn !== undefined && view.turn !== input.expectedTurn) {
    throw new AppError('STALE_TURN', '回合已变化，请刷新后再请求旁白。', 409, { expectedTurn: view.turn });
  }
  const tiandaoCorrect = !!input.tiandaoCorrect;
  const result = await runPlayAi({
    kind: 'narration',
    model,
    budget: {sessionId},
    signal,
    force: !!input.force,
    cacheKey: visitKey(sessionId, view.scene.id, view.turn, tiandaoCorrect),
    context: {
      kind: 'narration',
      sceneTitle: view.scene.title,
      sceneText: view.scene.text,
      choices: view.scene.choices.map(c => ({ id: c.id, label: c.label })),
      variables: { ...(view.variables ?? {}) },
      worldbookSnippets: worldbookSnippetsFor(view, revisionReader),
      tiandaoCorrect,
    },
  });
  return {
    status: result.status,
    text: result.text,
    sceneId: view.scene.id,
    turn: view.turn,
    reason: result.reason,
    cached: result.cached ?? false,
  };
}
