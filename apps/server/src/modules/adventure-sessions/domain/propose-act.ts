import {
  resolveProposedId,
  type AdventureView,
  type ProposeAdventureActResult,
  type ProposeCandidate,
} from '@novel-game/contracts';

export function candidatesFromAdventure(view: AdventureView): ProposeCandidate[] {
  if (view.ended) return [];
  return view.actions
    .filter(action => action.enabled !== false)
    .map(action => ({ id: action.id, label: action.label }));
}

export function finalizeAdventurePropose(args: {
  proposed: string | 'none';
  candidates: ProposeCandidate[];
  adventure?: AdventureView;
  autoAct: boolean;
}): ProposeAdventureActResult {
  const resolved = resolveProposedId(args.proposed, args.candidates);
  if (resolved.status !== 'mapped') {
    return {
      status: resolved.status,
      actionId: null,
      label: null,
      reason: resolved.reason,
      candidates: args.candidates,
    };
  }
  if (args.autoAct && args.adventure) {
    return {
      status: 'acted',
      actionId: resolved.id,
      label: resolved.label,
      reason: null,
      candidates: args.candidates,
      adventure: args.adventure,
    };
  }
  return {
    status: 'mapped',
    actionId: resolved.id,
    label: resolved.label,
    reason: null,
    candidates: args.candidates,
  };
}
