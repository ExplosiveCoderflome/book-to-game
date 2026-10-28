import type { AdventureMapView, WorldContent } from '@novel-game/contracts';
import { applyTerritoryOverlay, locationMap, locationSpatial, mapIdOf, npcsOnMap, relationTable, worldFactions } from '@novel-game/rules';
import type { AdventureState } from './adventure-state.js';

type ActionView = { id: string; enabled: boolean };

/** Read-only spatial status for the play map. Derived from session + authored map; mutates nothing. */
export function projectAdventureMap(world: WorldContent, state: AdventureState, actions: ActionView[]): AdventureMapView | undefined {
  const authored = locationMap(world, state.locationId); if (!authored) return undefined;
  const overlay = state.territory?.[mapIdOf(authored)];
  const map = applyTerritoryOverlay(authored, overlay);
  const sp = locationSpatial(map, state.locationId); const layers = map.layers ?? {};
  const byId = new Map(world.actions.map(a => [a.id, a]));
  const reachable: AdventureMapView['reachable'] = [];
  for (const view of actions) {
    const move = byId.get(view.id)?.effects.find(e => e.kind === 'move');
    if (move && move.kind === 'move' && move.locationId !== state.locationId) reachable.push({ locationId: move.locationId, actionId: view.id, enabled: view.enabled });
  }
  const terrain = sp.terrainId ? layers.terrain?.palette.find(p => p.id === sp.terrainId) : undefined;
  const faction = sp.factionId ? layers.factions?.factions.find(f => f.id === sp.factionId) : undefined;
  const fog = map.fog === true; const mapId = mapIdOf(map);
  const seen = new Set(state.explored?.[mapId] ?? []);
  const npcs = npcsOnMap(world, map, Object.fromEntries(Object.entries(state.npcs).map(([id, n]) => [id, n.locationId]))).filter(n => !fog || seen.has(n.cell));
  return {
    mapId, ...(sp.cell ? { cell: sp.cell } : {}),
    ...(terrain ? { terrain: { id: terrain.id, label: terrain.label } } : {}),
    ...(faction ? { faction: { id: faction.id, name: faction.name } } : {}),
    regions: sp.regionIds.flatMap(id => { const r = layers.regions?.regions.find(x => x.id === id); return r ? [{ id, name: r.name }] : []; }),
    reachable, fog, ...(npcs.length ? { npcs } : {}),
    ...(overlay && Object.keys(overlay).length ? { territory: { ...overlay } } : {}),
    relations: relationTable(world, state.factionRelations, worldFactions(world).map(f => f.id)), ...(fog ? { explored: [...(state.explored?.[mapId] ?? [])] } : {}),
  };
}
