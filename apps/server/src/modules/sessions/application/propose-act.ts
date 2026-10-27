import {
  proposeActInputSchema,
  type ProposeActInput,
  type ProposeActResult,
  type SessionView,
} from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import { candidatesFromSession, finalizeStoryPropose } from '../domain/propose-act.js';
import type { SessionService } from './session-service.js';

export interface StoryProposeModel {
  proposeAct(input: {
    text: string;
    sceneTitle: string;
    sceneText: string;
    candidates: { id: string; label: string }[];
    tiandaoCorrect?: boolean;
  }, signal: AbortSignal): Promise<{ choiceId: string | 'none'; rationale?: string }>;
}

export async function proposeActSession(
  sessions: SessionService,
  sessionId: string,
  raw: ProposeActInput,
  model: StoryProposeModel,
  signal: AbortSignal = AbortSignal.timeout(60_000),
): Promise<ProposeActResult> {
  const input = proposeActInputSchema.parse(raw);
  const view = sessions.get(sessionId);
  if (view.ended) {
    return {
      status: 'none',
      choiceId: null,
      label: null,
      reason: '故事已结束，无法继续映射行动。',
      candidates: [],
    };
  }
  if (view.turn !== input.expectedTurn) {
    throw new AppError('STALE_TURN', '回合已变化，请刷新后再试自由输入。', 409, { expectedTurn: view.turn });
  }
  const candidates = candidatesFromSession(view);
  if (candidates.length === 0) {
    return {
      status: 'none',
      choiceId: null,
      label: null,
      reason: '当前没有可见选项（可能均被世界书或条件锁定）。',
      candidates: [],
    };
  }
  const modelOut = await model.proposeAct({
    text: input.text,
    sceneTitle: view.scene.title,
    sceneText: view.scene.text,
    candidates,
    tiandaoCorrect: !!input.tiandaoCorrect,
  }, signal);
  const draft = finalizeStoryPropose({
    proposed: modelOut.choiceId,
    candidates,
    autoAct: false,
  });
  if (draft.status !== 'mapped' || !draft.choiceId) return draft;
  if (!input.autoAct) return draft;
  const session = sessions.act(sessionId, {
    choiceId: draft.choiceId,
    expectedTurn: input.expectedTurn,
    requestId: input.requestId,
  });
  return finalizeStoryPropose({
    proposed: draft.choiceId,
    candidates,
    autoAct: true,
    session,
  });
}

export type { SessionView };
