import type { CellKey, FactionRelation, FactionStance, WorldContent, WorldEffect, WorldMap } from '@novel-game/contracts';

/**
 * Dynamic territory + faction relations. Pure functions over (authored content, session overlay).
 * Authored maps/relations are immutable; sessions keep sparse overrides that are folded in at read time.
 */
export type TerritoryOverlay = Record<CellKey, string>; // '' = unclaimed
export type RelationOverlay = Record<string, { stance: FactionStance; standing: number }>;

export function relationKey(a: string, b: string): string { return a < b ? `${a}|${b}` : `${b}|${a}`; }

/** Fold a territory overlay over a map (returns a new map; input untouched). */
export function applyTerritoryOverlay(map: WorldMap, overlay: TerritoryOverlay | undefined): WorldMap {
  if (!overlay || !Object.keys(overlay).length || !map.layers?.factions) return map;
  const cells = { ...map.layers.factions.cells };
  for (const [c, f] of Object.entries(overlay)) { if (f) cells[c] = f; else delete cells[c]; }
  return { ...map, layers: { ...map.layers, factions: { ...map.layers.factions, cells } } };
}

/** Cells targeted by a set_territory effect on the given map. */
export function territoryTargetCells(map: WorldMap, effect: Extract<WorldEffect, { kind: 'set_territory' }>): CellKey[] {
  const out = new Set<CellKey>(effect.cells ?? []);
  if (effect.regionId) for (const [c, r] of Object.entries(map.layers?.regions?.cells ?? {})) if (r === effect.regionId) out.add(c);
  return [...out];
}

/** Next overlay after a set_territory effect. */
export function applySetTerritory(overlay: TerritoryOverlay | undefined, map: WorldMap, effect: Extract<WorldEffect, { kind: 'set_territory' }>): TerritoryOverlay {
  const next = { ...(overlay ?? {}) };
  for (const c of territoryTargetCells(map, effect)) next[c] = effect.factionId ?? '';
  return next;
}

export function authoredRelation(world: Pick<WorldContent, 'factionRelations'>, a: string, b: string): FactionRelation | undefined {
  const k = relationKey(a, b); return world.factionRelations?.find(r => relationKey(r.a, r.b) === k);
}
/** Effective relation: session override ?? authored ?? neutral/0. Same faction → ally/100. */
export function effectiveRelation(world: Pick<WorldContent, 'factionRelations'>, overlay: RelationOverlay | undefined, a: string, b: string): { stance: FactionStance; standing: number } {
  if (a === b) return { stance: 'ally', standing: 100 };
  const o = overlay?.[relationKey(a, b)]; if (o) return o;
  const r = authoredRelation(world, a, b); return r ? { stance: r.stance, standing: r.standing } : { stance: 'neutral', standing: 0 };
}
export function applySetFactionRelation(world: Pick<WorldContent, 'factionRelations'>, overlay: RelationOverlay | undefined, effect: Extract<WorldEffect, { kind: 'set_faction_relation' }>): RelationOverlay {
  const cur = effectiveRelation(world, overlay, effect.a, effect.b);
  let standing = effect.standing ?? cur.standing; if (effect.standingDelta) standing += effect.standingDelta;
  standing = Math.max(-100, Math.min(100, Math.round(standing)));
  return { ...(overlay ?? {}), [relationKey(effect.a, effect.b)]: { stance: effect.stance ?? cur.stance, standing } };
}
/** Fully resolved relation table (authored + overlay) for UI/projection. */
export function relationTable(world: Pick<WorldContent, 'factionRelations'>, overlay: RelationOverlay | undefined, factionIds: string[]): (FactionRelation)[] {
  const out: FactionRelation[] = [];
  for (let i = 0; i < factionIds.length; i++) for (let j = i + 1; j < factionIds.length; j++) {
    const a = factionIds[i], b = factionIds[j]; out.push({ a, b, ...effectiveRelation(world, overlay, a, b) });
  }
  return out;
}
/** All factions across a world's maps (dedup by id, first wins). */
export function worldFactions(world: Pick<WorldContent, 'map' | 'subMaps'>): { id: string; name: string; color: string; stats?: { label: string; resourceId: string }[] }[] {
  const seen = new Map<string, { id: string; name: string; color: string; stats?: { label: string; resourceId: string }[] }>();
  for (const m of [...(world.map ? [world.map] : []), ...(world.subMaps ?? [])]) for (const f of m.layers?.factions?.factions ?? []) if (!seen.has(f.id)) seen.set(f.id, f);
  return [...seen.values()];
}
export const STANCE_LABEL: Record<FactionStance, string> = { ally: '同盟', neutral: '中立', hostile: '敌对' };
