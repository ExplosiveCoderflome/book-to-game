import {
  proposeAdventureActInputSchema,
  type ProposeAdventureActInput,
  type ProposeAdventureActResult,
} from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import { candidatesFromAdventure, finalizeAdventurePropose } from '../domain/propose-act.js';
import type { AdventureService } from './adventure-service.js';

export interface AdventureProposeModel {
  proposeAdventureAct(input: {
    text: string;
    locationTitle: string;
    locationText: string;
    candidates: { id: string; label: string }[];
    tiandaoCorrect?: boolean;
  }, signal: AbortSignal): Promise<{ actionId: string | 'none'; rationale?: string }>;
}

export async function proposeActAdventure(
  adventures: AdventureService,
  adventureId: string,
  raw: ProposeAdventureActInput,
  model: AdventureProposeModel,
  signal: AbortSignal = AbortSignal.timeout(60_000),
): Promise<ProposeAdventureActResult> {
  const input = proposeAdventureActInputSchema.parse(raw);
  const view = adventures.get(adventureId);
  if (view.ended) {
    return {
      status: 'none',
      actionId: null,
      label: null,
      reason: '冒险已结束，无法继续映射行动。',
      candidates: [],
    };
  }
  if (view.turn !== input.expectedTurn) {
    throw new AppError('STALE_TURN', '回合已变化，请刷新后再试自由输入。', 409, { expectedTurn: view.turn });
  }
  const candidates = candidatesFromAdventure(view);
  if (candidates.length === 0) {
    return {
      status: 'none',
      actionId: null,
      label: null,
      reason: '当前没有可用行动。',
      candidates: [],
    };
  }
  const modelOut = await model.proposeAdventureAct({
    text: input.text,
    locationTitle: view.location.title,
    locationText: view.location.text,
    candidates,
    tiandaoCorrect: !!input.tiandaoCorrect,
  }, signal);
  const draft = finalizeAdventurePropose({
    proposed: modelOut.actionId,
    candidates,
    autoAct: false,
  });
  if (draft.status !== 'mapped' || !draft.actionId) return draft;
  if (!input.autoAct) return draft;
  const adventure = adventures.act(adventureId, {
    actionId: draft.actionId,
    expectedTurn: input.expectedTurn,
    requestId: input.requestId,
  });
  return finalizeAdventurePropose({
    proposed: draft.actionId,
    candidates,
    autoAct: true,
    adventure,
  });
}
