import type {WorldContent, WorldEffect} from '@novel-game/contracts';

export interface CausalDependencyGraph {
  resourceThresholds: Map<string, number[]>;
  factIds: Set<string>;
  ledgerFactIds: Set<string>;
  locations: Set<string>;
  claims: {keyResourceIds: Set<string>; keyChoiceIds: Set<string>; commitments: Map<string, {actionId: string; factId: string}>};
}

export function causalDependencyGraph(world: WorldContent): CausalDependencyGraph {
  const graph: CausalDependencyGraph = {resourceThresholds: new Map(), factIds: new Set(), ledgerFactIds: new Set(), locations: new Set(),
    claims: {keyResourceIds: new Set(world.causalClaims?.keyResourceIds ?? []), keyChoiceIds: new Set(world.causalClaims?.keyChoiceIds ?? []),
      commitments: new Map((world.causalClaims?.commitments ?? []).map(item => [item.id, {actionId: item.actionId, factId: item.factId}]))}};
  const readConditions = (conditions: readonly import('@novel-game/contracts').WorldCondition[] | undefined): void => {
    for (const condition of conditions ?? []) {
      if (condition.kind === 'resource') {
        const thresholds = graph.resourceThresholds.get(condition.resourceId) ?? [];
        if (condition.atLeast !== undefined) thresholds.push(condition.atLeast);
        if (condition.atMost !== undefined) thresholds.push(condition.atMost);
        graph.resourceThresholds.set(condition.resourceId, thresholds);
      } else if (condition.kind === 'fact' || condition.kind === 'known' || condition.kind === 'npc_knows') graph.factIds.add(condition.factId);
      else if (condition.kind === 'anyOf') readConditions(condition.conditions);
    }
  };
  const effects = (items: readonly WorldEffect[]): void => {
    for (const effect of items) {
      if (effect.kind === 'roll') { effects(effect.success); effects(effect.failure); }
      if (effect.kind === 'move') graph.locations.add(effect.locationId);
      if (effect.kind === 'ledger') graph.ledgerFactIds.add(effect.factId);
    }
  };
  for (const action of world.actions) { readConditions([...action.requires, ...action.availableWhen]); effects(action.effects); }
  for (const event of world.events) readConditions(event.when);
  for (const condition of [...(world.endConditions?.win ?? []), ...(world.endConditions?.lose ?? [])]) readConditions(condition.when);
  for (const storylet of world.storylets ?? []) {
    readConditions(storylet.when);
    for (const mod of storylet.weight?.mods ?? []) {
      readConditions(mod.when);
      if (mod.resourceId) {
        const thresholds = graph.resourceThresholds.get(mod.resourceId) ?? [];
        if (mod.atLeast !== undefined) thresholds.push(mod.atLeast);
        if (mod.atMost !== undefined) thresholds.push(mod.atMost);
        graph.resourceThresholds.set(mod.resourceId, thresholds);
      }
    }
    for (const choice of storylet.choices) {
      readConditions([...(choice.availableWhen ?? []), ...(choice.requires ?? [])]); effects(choice.effects);
      for (const assertion of choice.ledgerAssertions ?? []) graph.ledgerFactIds.add(assertion.factId);
    }
    for (const body of storylet.textCases ?? []) readConditions(body.when);
  }
  for (const location of world.locations) for (const variant of location.textVariants ?? []) readConditions(variant.when);
  for (const ending of world.endings) {
    readConditions(ending.when);
    for (const variant of ending.textVariants ?? []) readConditions(variant.when);
    for (const passage of ending.passages ?? []) readConditions(passage.when);
    for (const assertion of ending.ledgerAssertions ?? []) graph.ledgerFactIds.add(assertion.factId);
  }
  for (const recap of world.recap ?? []) readConditions(recap.when);
  for (const event of world.events) for (const assertion of event.ledgerAssertions ?? []) graph.ledgerFactIds.add(assertion.factId);
  for (const action of world.actions) for (const assertion of action.ledgerAssertions ?? []) graph.ledgerFactIds.add(assertion.factId);
  for (const [id, def] of Object.entries(world.resourceDefs ?? {})) {
    for (const trigger of [def.onMin, def.onMax]) {
      if (trigger?.ending || trigger?.storylet) graph.resourceThresholds.set(id, [...(graph.resourceThresholds.get(id) ?? []), trigger === def.onMin ? def.min : def.max ?? def.min]);
      for (const effect of trigger?.effects ?? []) effects([effect]);
    }
  }
  for (const [id, thresholds] of graph.resourceThresholds) graph.resourceThresholds.set(id, [...new Set(thresholds)].sort((a, b) => a - b));
  return graph;
}

export function causalEffectFacts(effects: readonly WorldEffect[]): Set<string> {
  const facts = new Set<string>();
  const visit = (items: readonly WorldEffect[]): void => { for (const effect of items) {
    if (effect.kind === 'set' || effect.kind === 'reveal' || effect.kind === 'ledger') facts.add(effect.factId);
    if (effect.kind === 'roll') { visit(effect.success); visit(effect.failure); }
  }};
  visit(effects); return facts;
}
