import type { WorldContent, WorldMap } from '@novel-game/contracts';
import { worldFactions } from './factions.js';
import { findMap, mapIdOf, worldMaps } from './map-session.js';

/**
 * World layer (P4): NPC placement, strongholds and eras. Pure read-side helpers; nothing here mutates content or session.
 */
export interface WorldLayerIssue { level: 'error' | 'warning'; code: string; message: string }

/** Map as it looked in an era: the era's territory snapshot replaces the faction cells (maps without a snapshot are unchanged). */
export function eraMap(world: Pick<WorldContent, 'eras'>, map: WorldMap, eraId: string | undefined): WorldMap {
  const snap = eraId ? world.eras?.find(e => e.id === eraId)?.territory[mapIdOf(map)] : undefined;
  if (!snap || !map.layers?.factions) return map;
  const cells = Object.fromEntries(Object.entries(snap).filter(([, f]) => f));
  return { ...map, layers: { ...map.layers, factions: { ...map.layers.factions, cells } } };
}

/** NPCs whose (session) location has a POI on the given map. */
export function npcsOnMap(world: Pick<WorldContent, 'npcs'>, map: WorldMap, npcLocations: Record<string, string>):
  { id: string; name: string; locationId: string; cell: string; factionId?: string }[] {
  const cellOf = new Map(map.pois.map(p => [p.locationId, p.anchor.cell]));
  return world.npcs.flatMap(n => {
    const loc = npcLocations[n.id] ?? n.initialLocationId; const cell = cellOf.get(loc);
    return cell ? [{ id: n.id, name: n.name, locationId: loc, cell, ...(n.factionId ? { factionId: n.factionId } : {}) }] : [];
  });
}

/** Strongholds across all maps. */
export function strongholds(world: Pick<WorldContent, 'map' | 'subMaps'>) {
  return worldMaps(world).flatMap(m => m.pois.filter(p => p.feature === 'stronghold').map(p => ({ mapId: mapIdOf(m), ...p })));
}

export function validateWorldLayer(world: Pick<WorldContent, 'map' | 'subMaps' | 'npcs' | 'locations' | 'eras'>): WorldLayerIssue[] {
  const issues: WorldLayerIssue[] = [];
  const factions = new Set(worldFactions(world).map(f => f.id)); const locs = new Set(world.locations.map(l => l.id));
  for (const n of world.npcs) {
    if (n.factionId && !factions.has(n.factionId)) issues.push({ level: 'error', code: 'npc_faction', message: `人物 ${n.name} 的势力 ${n.factionId} 不存在` });
    if (n.homeLocationId && !locs.has(n.homeLocationId)) issues.push({ level: 'error', code: 'npc_home', message: `人物 ${n.name} 的据点地点 ${n.homeLocationId} 不存在` });
  }
  for (const s of strongholds(world)) {
    if (!s.factionId) issues.push({ level: 'warning', code: 'stronghold_unowned', message: `据点 ${s.label ?? s.locationId} 未指定势力` });
    else if (!factions.has(s.factionId)) issues.push({ level: 'error', code: 'stronghold_faction', message: `据点 ${s.label ?? s.locationId} 的势力 ${s.factionId} 不存在` });
  }
  const eraIds = new Set<string>();
  for (const e of world.eras ?? []) {
    if (eraIds.has(e.id)) issues.push({ level: 'error', code: 'era_dup', message: `时代 id 重复：${e.id}` }); eraIds.add(e.id);
    for (const [mapId, cells] of Object.entries(e.territory)) {
      if (!findMap(world, mapId)) { issues.push({ level: 'error', code: 'era_map', message: `时代 ${e.name} 引用了不存在的地图 ${mapId}` }); continue; }
      for (const f of new Set(Object.values(cells))) if (f && !factions.has(f)) issues.push({ level: 'error', code: 'era_faction', message: `时代 ${e.name} 引用了不存在的势力 ${f}` });
    }
  }
  return issues;
}
