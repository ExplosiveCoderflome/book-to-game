import {
  entriesForPlace,
  narrateInputSchema,
  type AdventureView,
  type NarrateInput,
  type NarrateResult,
  type WorldRevision,
} from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { AdventureService } from './adventure-service.js';
import type { RevisionReader } from './ports.js';

/** Same provider surface as story narrate — location maps onto scene fields. */
export interface AdventureNarrateModel {
  narrate(input: {
    sceneTitle: string;
    sceneText: string;
    choices: { id: string; label: string }[];
    variables: Record<string, string | number | boolean>;
    worldbookSnippets: { title: string; content: string; kind: string }[];
  }, signal: AbortSignal): Promise<{ narration: string }>;
}

/** In-memory cache: one narrate blob per adventure visit (adventure+location+turn). */
const visitCache = new Map<string, NarrateResult>();

function visitKey(adventureId: string, locationId: string, turn: number): string {
  return `adv:${adventureId}:${locationId}:${turn}`;
}

export function clearAdventureNarrateCache(): void {
  visitCache.clear();
}

function variablesFromView(view: AdventureView): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const fact of view.facts) out[fact.id] = fact.value;
  if (view.resources) {
    for (const [key, value] of Object.entries(view.resources)) out[key] = value;
  }
  return out;
}

function worldbookSnippetsFor(view: AdventureView, revisionReader: RevisionReader): { title: string; content: string; kind: string }[] {
  let revision: WorldRevision;
  try { revision = revisionReader.getRevision(view.worldRevisionId); }
  catch { return []; }
  const entries = entriesForPlace(revision.content.worldbook, view.location.id, 'location');
  return entries.slice(0, 6).map(entry => ({
    title: entry.title.slice(0, 80),
    content: entry.content.slice(0, 240),
    kind: entry.kind,
  }));
}

/**
 * L1 adventure parity: optional play-time flavor narration.
 * Never mutates adventure state / actions / facts. Soft-fails on model errors.
 * Reuses NarrateInput/NarrateResult; sceneId carries the current location id.
 */
export async function narrateAdventure(
  adventures: AdventureService,
  revisionReader: RevisionReader,
  adventureId: string,
  raw: NarrateInput,
  model: AdventureNarrateModel,
  signal: AbortSignal = AbortSignal.timeout(60_000),
): Promise<NarrateResult> {
  const input = narrateInputSchema.parse(raw);
  const view = adventures.get(adventureId);
  if (input.expectedTurn !== undefined && view.turn !== input.expectedTurn) {
    throw new AppError('STALE_TURN', '回合已变化，请刷新后再请求旁白。', 409, { expectedTurn: view.turn });
  }
  const key = visitKey(adventureId, view.location.id, view.turn);
  if (!input.force) {
    const hit = visitCache.get(key);
    if (hit) return { ...hit, cached: true };
  }
  try {
    const modelOut = await model.narrate({
      sceneTitle: view.location.title,
      sceneText: view.location.text,
      choices: view.actions.map(a => ({ id: a.id, label: a.label })),
      variables: variablesFromView(view),
      worldbookSnippets: worldbookSnippetsFor(view, revisionReader),
    }, signal);
    const text = modelOut.narration.trim().slice(0, 800);
    const result: NarrateResult = {
      status: 'ok',
      text,
      sceneId: view.location.id,
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
    return {
      status: 'unavailable',
      text: null,
      sceneId: view.location.id,
      turn: view.turn,
      reason,
      cached: false,
    };
  }
}
