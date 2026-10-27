import {
  entriesForScene,
  narrateInputSchema,
  type NarrateInput,
  type NarrateResult,
  type SessionView,
} from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { RevisionReader } from './ports.js';
import type { SessionService } from './session-service.js';

export interface StoryNarrateModel {
  narrate(input: {
    sceneTitle: string;
    sceneText: string;
    choices: { id: string; label: string }[];
    variables: Record<string, string | number | boolean>;
    worldbookSnippets: { title: string; content: string; kind: string }[];
  }, signal: AbortSignal): Promise<{ narration: string }>;
}

/** In-memory cache: one narrate blob per session visit (session+scene+turn). */
const visitCache = new Map<string, NarrateResult>();

function visitKey(sessionId: string, sceneId: string, turn: number): string {
  return `${sessionId}:${sceneId}:${turn}`;
}

export function clearNarrateCache(): void {
  visitCache.clear();
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
 * Soft-fails to status=unavailable when the model errors.
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
  const key = visitKey(sessionId, view.scene.id, view.turn);
  if (!input.force) {
    const hit = visitCache.get(key);
    if (hit) return { ...hit, cached: true };
  }
  try {
    const modelOut = await model.narrate({
      sceneTitle: view.scene.title,
      sceneText: view.scene.text,
      choices: view.scene.choices.map(c => ({ id: c.id, label: c.label })),
      variables: { ...(view.variables ?? {}) },
      worldbookSnippets: worldbookSnippetsFor(view, revisionReader),
    }, signal);
    const text = modelOut.narration.trim().slice(0, 800);
    const result: NarrateResult = {
      status: 'ok',
      text,
      sceneId: view.scene.id,
      turn: view.turn,
      reason: null,
      cached: false,
    };
    visitCache.set(key, { ...result, cached: false });
    return result;
  } catch (error) {
    if (error instanceof AppError && error.code === 'STALE_TURN') throw error;
    const reason = error instanceof AppError
      ? error.message
      : (error instanceof Error ? error.message : '旁白生成失败');
    const result: NarrateResult = {
      status: 'unavailable',
      text: null,
      sceneId: view.scene.id,
      turn: view.turn,
      reason,
      cached: false,
    };
    // Do not cache hard failures so a refresh can retry.
    return result;
  }
}
