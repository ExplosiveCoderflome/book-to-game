import type { MapFillKind, MapFillPlacement, WorldMap } from '@novel-game/contracts';
import { lockMapStructure, unlockMapStructure } from '@novel-game/rules';

export { lockMapStructure, unlockMapStructure };

const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'fill';

/** Add a fill placement on a location. Ids are unique within the map fill layer. Does not touch structure. */
export function addFillPlacement(
  map: WorldMap,
  input: { kind: MapFillKind; locationId: string; label?: string },
): WorldMap {
  const taken = new Set((map.fill?.placements ?? []).map(p => p.id));
  for (const m of map.fill?.cellMarkers ?? []) taken.add(m.id);
  let id = `${safeId(input.kind)}_${safeId(input.locationId)}`;
  for (let i = 2; taken.has(id); i++) id = `${safeId(input.kind)}_${safeId(input.locationId)}_${i}`;
  const placement: MapFillPlacement = { id, kind: input.kind, locationId: input.locationId };
  if (input.label?.trim()) placement.label = input.label.trim().slice(0, 80);
  return { ...map, fill: { placements: [...(map.fill?.placements ?? []), placement], ...(map.fill?.cellMarkers ? { cellMarkers: map.fill.cellMarkers } : {}) } };
}

export function updateFillPlacement(map: WorldMap, id: string, patch: Partial<Pick<MapFillPlacement, 'kind' | 'locationId' | 'label'>>): WorldMap {
  const placements = (map.fill?.placements ?? []).map(p => {
    if (p.id !== id) return p;
    const next = { ...p, ...patch };
    if (patch.label !== undefined) {
      if (patch.label.trim()) next.label = patch.label.trim().slice(0, 80);
      else delete next.label;
    }
    return next;
  });
  return { ...map, fill: { placements, ...(map.fill?.cellMarkers ? { cellMarkers: map.fill.cellMarkers } : {}) } };
}

export function removeFillPlacement(map: WorldMap, id: string): WorldMap {
  const placements = (map.fill?.placements ?? []).filter(p => p.id !== id);
  if (placements.length === (map.fill?.placements ?? []).length) return map;
  if (!placements.length && !(map.fill?.cellMarkers?.length)) {
    const next = { ...map }; delete next.fill; return next;
  }
  return { ...map, fill: { placements, ...(map.fill?.cellMarkers ? { cellMarkers: map.fill.cellMarkers } : {}) } };
}
