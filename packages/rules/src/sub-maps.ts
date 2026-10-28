import type { WorldContent } from '@novel-game/contracts';
import { ROOT_MAP_ID, mapIdOf, worldMaps } from './map-session.js';
import { validateWorldMap, type WorldMapIssue } from './world-map.js';

export interface SubMapIssue { level: 'error' | 'warning'; code: string; message: string; mapId?: string; locationId?: string }

/** Child map owned by a location (first match). */
export function childMapOf(world: Pick<WorldContent, 'subMaps'>, locationId: string) {
  return world.subMaps?.find(m => m.parent?.locationId === locationId);
}
/** Breadcrumb path root → … → mapId (stops on cycles). */
export function mapPath(world: Pick<WorldContent, 'map' | 'subMaps'>, mapId: string): { mapId: string; name: string; viaLocationId?: string }[] {
  const byId = new Map(worldMaps(world).map(m => [mapIdOf(m), m]));
  const out: { mapId: string; name: string; viaLocationId?: string }[] = []; const seen = new Set<string>();
  let cur = byId.get(mapId);
  while (cur && !seen.has(mapIdOf(cur))) {
    const id = mapIdOf(cur); seen.add(id);
    out.unshift({ mapId: id, name: cur.name ?? (id === ROOT_MAP_ID ? '世界' : id), ...(cur.parent ? { viaLocationId: cur.parent.locationId } : {}) });
    cur = cur.parent ? byId.get(cur.parent.mapId) : undefined;
  }
  return out;
}

/** Sub-map + location hierarchy integrity: ids, orphan parents, cycles, ownership, per-map POI checks. */
export function validateSubMaps(world: Pick<WorldContent, 'map' | 'subMaps' | 'locations'>): SubMapIssue[] {
  const issues: SubMapIssue[] = []; const subs = world.subMaps ?? [];
  if (!subs.length && !world.locations.some(l => l.parentLocationId)) return issues;
  if (subs.length && !world.map) issues.push({ level: 'error', code: 'submap_without_root', message: '存在子地图但没有世界主地图' });
  const ids = new Set<string>([ROOT_MAP_ID]);
  const locIds = new Set(world.locations.map(l => l.id));
  const owners = new Map<string, string>();
  for (const m of subs) {
    if (!m.id) { issues.push({ level: 'error', code: 'submap_missing_id', message: '子地图缺少 id' }); continue; }
    if (ids.has(m.id)) issues.push({ level: 'error', code: 'submap_duplicate_id', mapId: m.id, message: `地图 id 重复：${m.id}` });
    ids.add(m.id);
  }
  const byId = new Map(worldMaps(world).map(m => [mapIdOf(m), m]));
  for (const m of subs) {
    if (!m.id) continue;
    if (!m.parent) { issues.push({ level: 'error', code: 'submap_orphan', mapId: m.id, message: `子地图 ${m.id} 没有父地点` }); continue; }
    const parent = byId.get(m.parent.mapId);
    if (!parent) issues.push({ level: 'error', code: 'submap_orphan', mapId: m.id, message: `子地图 ${m.id} 的父地图不存在：${m.parent.mapId}` });
    if (!locIds.has(m.parent.locationId)) issues.push({ level: 'error', code: 'submap_orphan', mapId: m.id, message: `子地图 ${m.id} 的父地点不存在：${m.parent.locationId}` });
    else if (parent && !parent.pois.some(p => p.locationId === m.parent!.locationId)) issues.push({ level: 'warning', code: 'submap_parent_unplaced', mapId: m.id, message: `子地图 ${m.id} 的父地点未放在父地图上：${m.parent.locationId}` });
    const prev = owners.get(m.parent.locationId);
    if (prev) issues.push({ level: 'error', code: 'submap_multi_owner', mapId: m.id, message: `地点 ${m.parent.locationId} 拥有多张子地图：${prev}, ${m.id}` });
    owners.set(m.parent.locationId, m.id);
    // cycle: walk parents
    const seen = new Set<string>(); let cur: typeof m | undefined = m;
    while (cur?.parent) { const cid = mapIdOf(cur); if (seen.has(cid)) { issues.push({ level: 'error', code: 'submap_cycle', mapId: m.id, message: `子地图父子关系成环：${m.id}` }); break; } seen.add(cid); cur = byId.get(cur.parent.mapId); }
    const relevant = world.locations.filter(l => m.pois.some(p => p.locationId === l.id)).map(l => l.id);
    for (const i of validateWorldMap(m, relevant) as WorldMapIssue[]) if (i.code !== 'location_unbound') issues.push({ level: i.level, code: i.code, mapId: m.id, message: `[${m.name ?? m.id}] ${i.message}`, ...(i.locationId ? { locationId: i.locationId } : {}) });
  }
  // location hierarchy
  const parentOf = new Map(world.locations.flatMap(l => l.parentLocationId ? [[l.id, l.parentLocationId] as const] : []));
  for (const [child, parent] of parentOf) {
    if (!locIds.has(parent)) issues.push({ level: 'error', code: 'location_orphan_parent', locationId: child, message: `地点 ${child} 的上级地点不存在：${parent}` });
    const seen = new Set<string>([child]); let cur: string | undefined = parent;
    while (cur) { if (seen.has(cur)) { issues.push({ level: 'error', code: 'location_cycle', locationId: child, message: `地点层级成环：${child}` }); break; } seen.add(cur); cur = parentOf.get(cur); }
  }
  return issues;
}
