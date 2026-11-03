import {npcDialogInputSchema, type AdventureView, type NpcDialogInput, type NpcDialogResult, type WorldRevision} from '@novel-game/contracts';
import {entriesForPlace, locationSpatial} from '@novel-game/rules';
import { AppError } from '../../../shared/errors.js';
import { clearPlayAiCache, runPlayAi } from '../../play-ai/index.js';
import type { AdventureService } from './adventure-service.js';
import type { AdventureNarrateModel } from './narrate.js';
import type { RevisionReader } from './ports.js';

/** Same model surface as narrate; `npcDialog` is optional and soft-fails when absent. */
export type AdventureNpcDialogModel = AdventureNarrateModel;

const CACHE_PREFIX = 'npc_dialog:adv:';

function dialogKey(adventureId: string, npcId: string, turn: number, tiandaoCorrect: boolean): string {
  return `adv:${adventureId}:${npcId}:${turn}:td${tiandaoCorrect ? 1 : 0}`;
}

export function clearNpcDialogCache(): void {
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
 * ai-npc-dialog thin wiring: one in-character bubble for a currently visible NPC.
 *
 * - Only ids from the current AdventureView.npcs are accepted; anything else is 404
 *   (no invented characters, no hidden NPCs revealed).
 * - Never mutates facts/actions/state; soft-fails through the shared play-ai helper.
 *
 * TODO(next slice): story mode has no NPC surface yet. When it gains visible NPCs,
 * add a parallel `npcDialogSession` that reuses `runPlayAi({kind:'npc_dialog'})` and
 * the same prompt — do not fork the helper or invent a second HTTP client.
 */
export async function npcDialogAdventure(
  adventures: AdventureService,
  revisionReader: RevisionReader,
  adventureId: string,
  raw: NpcDialogInput,
  model: AdventureNpcDialogModel,
  signal: AbortSignal = AbortSignal.timeout(60_000),
): Promise<NpcDialogResult> {
  const input = npcDialogInputSchema.parse(raw);
  const view = adventures.get(adventureId);
  if (input.expectedTurn !== undefined && view.turn !== input.expectedTurn) {
    throw new AppError('STALE_TURN', '回合已变化，请刷新后再请求对话。', 409, { expectedTurn: view.turn });
  }
  const npc = view.npcs.find(candidate => candidate.id === input.npcId);
  if (!npc) throw new AppError('NPC_NOT_VISIBLE', '当前地点没有这位人物。', 404, { npcId: input.npcId });
  const tiandaoCorrect = !!input.tiandaoCorrect;
  const result = await runPlayAi({
    kind: 'npc_dialog',
    model,
    budget: {sessionId: adventureId},
    signal,
    force: !!input.force,
    cacheKey: dialogKey(adventureId, npc.id, view.turn, tiandaoCorrect),
    context: {
      kind: 'npc_dialog',
      npcName: npc.name,
      npcHint: npc.description,
      sceneTitle: view.location.title,
      sceneText: view.location.text,
      variables: variablesFromView(view),
      facts: Object.fromEntries(view.facts.filter(fact => fact.value).map(fact => [fact.id, true])),
      worldbookSnippets: worldbookSnippetsFor(view, revisionReader),
      tiandaoCorrect,
    },
  });
  return {
    status: result.status,
    text: result.text,
    npcId: npc.id,
    sceneId: view.location.id,
    turn: view.turn,
    reason: result.reason,
    cached: result.cached ?? false,
  };
}
