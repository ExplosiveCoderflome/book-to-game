import {
  resolveProposedId,
  type ProposeActResult,
  type ProposeCandidate,
  type SessionView,
} from '@novel-game/contracts';

export function candidatesFromSession(view: SessionView): ProposeCandidate[] {
  if (view.ended) return [];
  return view.scene.choices.map(choice => ({ id: choice.id, label: choice.label }));
}

export function finalizeStoryPropose(args: {
  proposed: string | 'none';
  candidates: ProposeCandidate[];
  session?: SessionView;
  autoAct: boolean;
}): ProposeActResult {
  const resolved = resolveProposedId(args.proposed, args.candidates);
  if (resolved.status !== 'mapped') {
    return {
      status: resolved.status,
      choiceId: null,
      label: null,
      reason: resolved.reason,
      candidates: args.candidates,
    };
  }
  if (args.autoAct && args.session) {
    return {
      status: 'acted',
      choiceId: resolved.id,
      label: resolved.label,
      reason: null,
      candidates: args.candidates,
      session: args.session,
    };
  }
  return {
    status: 'mapped',
    choiceId: resolved.id,
    label: resolved.label,
    reason: null,
    candidates: args.candidates,
  };
}
