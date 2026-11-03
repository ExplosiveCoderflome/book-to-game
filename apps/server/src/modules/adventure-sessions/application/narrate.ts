import {narrateInputSchema, type AdventureView, type NarrateInput, type NarrateResult, type WorldRevision} from '@novel-game/contracts';
import {entriesForPlace, locationSpatial} from '@novel-game/rules';
import { AppError } from '../../../shared/errors.js';
import { clearPlayAiCache, runPlayAi, type PlayAiModel } from '../../play-ai/index.js';
import type { AdventureService } from './adventure-service.js';
import type { RevisionReader } from './ports.js';

/** Same provider surface as story narrate — location maps onto scene fields. */
export type AdventureNarrateModel = PlayAiModel;

/** Single-process soft cache only — not shared across workers/replicas; lost on restart.
 *  Delegated to the shared play-ai cache (one blob per adventure visit: adventure+location+turn). */
function visitKey(adventureId: string, locationId: string, turn: number, tiandaoCorrect: boolean): string {
  return `adv:${adventureId}:${locationId}:${turn}:td${tiandaoCorrect ? 1 : 0}`;
}

const CACHE_PREFIX = 'narration:adv:';

export function clearAdventureNarrateCache(): void {
  clearPlayAiCache(CACHE_PREFIX);
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
  const entries = entriesForPlace(revision.content.worldbook, view.location.id, 'location', {regionIds: locationSpatial(revision.content.map, view.location.id).regionIds});
  return entries.slice(0, 6).map(entry => ({
    title: entry.title.slice(0, 80),
    content: entry.content.slice(0, 240),
    kind: entry.kind,
  }));
}

/**
 * L1 adventure parity: optional play-time flavor narration.
 * Never mutates adventure state / actions / facts. Soft-fails on model errors
 * (shared play-ai helper). Reuses NarrateInput/NarrateResult; sceneId carries
 * the current location id.
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
  const tiandaoCorrect = !!input.tiandaoCorrect;
  const result = await runPlayAi({
    kind: 'narration',
    model,
    budget: {sessionId: adventureId},
    signal,
    force: !!input.force,
    cacheKey: visitKey(adventureId, view.location.id, view.turn, tiandaoCorrect),
    context: {
      kind: 'narration',
      sceneTitle: view.location.title,
      sceneText: view.location.text,
      choices: view.actions.map(a => ({ id: a.id, label: a.label })),
      variables: variablesFromView(view),
      worldbookSnippets: worldbookSnippetsFor(view, revisionReader),
      tiandaoCorrect,
    },
  });
  return {
    status: result.status,
    text: result.text,
    sceneId: view.location.id,
    turn: view.turn,
    reason: result.reason,
    cached: result.cached ?? false,
  };
}
