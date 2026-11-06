import type { LedgerAssertion, WorldContent } from '@novel-game/contracts';

export type LedgerState = {facts?: Record<string, boolean>; knownFactIds?: string[]; resources?: Record<string, number>; performedActionIds?: string[];
  ledger?: {version: 1; heldFactIds: string[]; consumedFactIds: string[]; committedFactIds: string[]; sources?: {factId: string; operation: string}[]}};
export type LedgerIssue = {code: string; severity: 'error' | 'warning'; entityIds: string[]; message: string; path: string; witness?: {seed: number; actionIds: string[]}};

export function checkLedgerAssertion(world: WorldContent, state: LedgerState, assertion: LedgerAssertion, path: string): LedgerIssue | undefined {
  if (!world.facts.some(fact => fact.id === assertion.factId)) return {code: 'ledger.unknown-fact', severity: 'error', entityIds: [assertion.id, assertion.factId], message: `账本断言引用未知事实：${assertion.factId}`, path};
  const has = (state.knownFactIds ?? []).includes(assertion.factId);
  const truth = state.facts?.[assertion.factId] === true;
  const holds = state.ledger?.version === 1 && state.ledger.heldFactIds.includes(assertion.factId);
  const consumed = state.ledger?.version === 1 && state.ledger.consumedFactIds.includes(assertion.factId);
  const sources = state.ledger?.sources ?? [];
  const acquired = sources.some(source => source.factId === assertion.factId && source.operation === 'acquire');
  const consumedSource = sources.some(source => source.factId === assertion.factId && source.operation === 'consume');
  const committed = state.ledger?.version === 1 && state.ledger.committedFactIds.includes(assertion.factId) && sources.some(source => source.factId === assertion.factId && source.operation === 'commit');
  const actual = assertion.claim === 'world-true' ? truth : assertion.claim === 'world-false' ? !truth
    : assertion.claim === 'player-knows' ? has : assertion.claim === 'holds' ? holds && acquired : assertion.claim === 'consumed' ? consumed && consumedSource : committed;
  return actual ? undefined : {code: `ledger.assertion.${assertion.claim}`, severity: 'error', entityIds: [assertion.id, assertion.factId],
    message: `账本断言 ${assertion.id} 未成立：${assertion.claim}(${assertion.factId})`, path};
}

export function ledgerAssertionsFor(world: WorldContent, entity: {id: string; ledgerAssertions?: LedgerAssertion[]}): {assertion: LedgerAssertion; path: string}[] {
  return (entity.ledgerAssertions ?? []).map(assertion => ({assertion, path: `${entity.id}.ledgerAssertions.${assertion.id}`}));
}
