import type { WorldRevision } from '@novel-game/contracts';
import { mergeFillSeedFacts, mergeFillSeedResources, projectFillActions } from '@novel-game/rules';
import { AppError } from '../errors.js';
import type { AdventureState } from './adventure-state.js';
import type { AdvanceAdventureOptions } from './advance-adventure.js';
import { settle } from './rules.js';
import { isS1World, newEffectContext, seedFromString } from './s1-core.js';
import { initS1State, locationText, refreshHand } from './storylets.js';
import { createOpeningRollSession } from './opening-roll.js';

/** Fresh open-world save pinned to a revision (pure; caller supplies id + clock + catalog snapshot). */
export function createAdventureState(
  revision: WorldRevision,
  id: string,
  now: string,
  catalogs: AdvanceAdventureOptions = {},
  /** S1 seed (server: crypto; package: crypto.getRandomValues). Absent → derived from the save id. */
  seed?: number,
): AdventureState {
  const world = revision.content;
  const fill = projectFillActions(world, {
    library: catalogs.buildingLibrary,
    catalog: catalogs.itemCatalog,
  });
  const resources = mergeFillSeedResources({ ...(world.resources ?? {}) }, fill.seedResources);
  const facts = mergeFillSeedFacts(
    Object.fromEntries(world.facts.map(fact => [fact.id, fact.initialValue])),
    fill.seedFacts,
  );
  const knownFactIds = world.facts.filter(fact => fact.playerKnown).map(fact => fact.id);
  // Seeded encounter/loot facts are playerKnown so HUD can show → 开 deltas.
  for (const factId of Object.keys(fill.seedFacts)) {
    if (!knownFactIds.includes(factId)) knownFactIds.push(factId);
  }
  const state: AdventureState = {
    schemaVersion: 1, id, worldRevisionId: revision.id,
    turn: 0, elapsed: 0, locationId: world.initialLocationId,
    facts,
    knownFactIds,
    ...(world.ledgerVersion === 1 ? {ledger: {version: 1 as const, heldFactIds: [], consumedFactIds: [], committedFactIds: [], sources: []}} : {}),
    resources,
    takenTags: [],
    npcs: Object.fromEntries(world.npcs.map(npc => [npc.id, { locationId: npc.initialLocationId, knownFactIds: [...npc.knownFactIds] }])),
    performedActionIds: [], triggeredEventIds: [], history: [], createdAt: now, updatedAt: now,
  };
  if (world.extensions?.length) state.rng = {seed: seed ?? seedFromString(id), cursor: 0};
  if (isS1World(world)) {
    initS1State(world, state, seed ?? seedFromString(id));
    if (world.openingRoll?.enabled) {
      state.openingRoll = createOpeningRollSession(world, state.rng!.seed, state.resources);
      state.history.push({turn: 0, elapsed: 0, text: locationText(world, state, state.locationId)});
      return state;
    }
    const ctx = newEffectContext();
    const publicEvents = settle(world, state, ctx, (kind, id, snapshot) => catalogs.observer?.({kind, id, state: snapshot}));
    if (!world.locations.some(item => item.id === state.locationId)) throw new AppError('INVALID_WORLD_STATE', '世界开局地点不存在', 500);
    refreshHand(world, state, false);
    state.history.push({ turn: 0, elapsed: 0, text: [locationText(world, state, state.locationId), ...publicEvents].join('\n') });
    return state;
  }
  if (world.openingRoll?.enabled) {
    state.rng ??= {seed: seed ?? seedFromString(id), cursor: 0};
    state.openingRoll = createOpeningRollSession(world, state.rng.seed, state.resources);
    const location = world.locations.find(item => item.id === state.locationId);
    if (!location) throw new AppError('INVALID_WORLD_STATE', '世界开局地点不存在', 500);
    state.history.push({turn: 0, elapsed: 0, text: location.text});
    return state;
  }
  const publicEvents = settle(world, state, undefined, (kind, id, snapshot) => catalogs.observer?.({kind, id, state: snapshot}));
  const location = world.locations.find(item => item.id === state.locationId);
  if (!location) throw new AppError('INVALID_WORLD_STATE', '世界开局地点不存在', 500);
  state.history.push({ turn: 0, elapsed: 0, text: [location.text, ...publicEvents].join('\n') });
  return state;
}
