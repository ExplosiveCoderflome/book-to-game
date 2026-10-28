import type { MapDraftDiff, MapDraftItem, MapDraftModelOutput, WorldContent, WorldMap } from '@novel-game/contracts';
import { cellKey, hexDistance, hexInBounds, listHexCells, offsetToAxial, parseCellKey, type Axial } from './world-map.js';
import { worldFactions } from './factions.js';

/**
 * AI map draft (P5): pure planning + applying. The model's output becomes a reviewable diff; placement is
 * deterministic (relative direction → axial vector → nearest free cell). Applying only touches accepted items
 * and returns new content — callers route it through their normal (undoable) edit path.
 */
const DIR: Record<string, Axial> = {
  e: { q: 1, r: 0 }, w: { q: -1, r: 0 }, ne: { q: 1, r: -1 }, nw: { q: 0, r: -1 }, se: { q: 0, r: 1 }, sw: { q: -1, r: 1 },
  n: { q: 1, r: -2 }, s: { q: -1, r: 2 }, near: { q: 1, r: 0 }, inside: { q: 0, r: 0 },
};
const PALETTE = ['#c0392b', '#2471a3', '#1e8449', '#b9770e', '#7d3c98', '#117a65', '#a04000', '#5d6d7e', '#cb4335', '#2e86c1', '#28b463', '#d68910'];
const DEFAULT_GEOMETRY = { kind: 'hex' as const, orientation: 'pointy' as const, cols: 16, rows: 12, size: 32 };

export function slugId(name: string, taken: Set<string>, prefix: string): string {
  let base = name.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase().slice(0, 40);
  if (!base) { let h = 0; for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0; base = `${prefix}_${h.toString(36)}`; }
  let id = base; let i = 2; while (taken.has(id)) id = `${base}_${i++}`;
  taken.add(id); return id;
}
const norm = (s: string) => s.trim().toLowerCase().replace(/[\s·・,，。]/g, '').replace(/^(那|这)?(个|座|间|片)?/, '');
/** Exact name, else a unique fuzzy hit (one name contains the other, ≥2 chars): "旧仓库" ↔ "北边的旧仓库". */
function lookup<V>(m: Map<string, V>, name: string): V | undefined {
  const k = norm(name); if (m.has(k)) return m.get(k); if (k.length < 2) return undefined;
  const hits = [...m.keys()].filter(x => x.length >= 2 && (x.includes(k) || k.includes(x)));
  return hits.length === 1 ? m.get(hits[0]) : undefined;
}

export function planMapDraft(world: WorldContent, out: MapDraftModelOutput): MapDraftDiff {
  const items: MapDraftItem[] = []; const warnings: string[] = [];
  const geometry = world.map?.geometry ?? DEFAULT_GEOMETRY;
  const ids = new Set<string>([...world.locations.map(l => l.id), ...world.npcs.map(n => n.id), ...worldFactions(world).map(f => f.id)]);
  // factions
  const factionByName = new Map(worldFactions(world).map(f => [norm(f.name), f.id]));
  const used = worldFactions(world).length;
  for (const f of out.factions) {
    if (lookup(factionByName, f.name)) continue;
    const id = slugId(f.name, ids, 'faction'); factionByName.set(norm(f.name), id);
    items.push({ id: `faction:${id}`, kind: 'faction', label: f.name, faction: { id, name: f.name, color: PALETTE[(used + items.length) % PALETTE.length], ...(f.description ? { description: f.description } : {}) } });
  }
  const factionOf = (n?: string) => { if (!n) return undefined; const id = lookup(factionByName, n); if (!id) warnings.push(`未知势力「${n}」已忽略`); return id; };
  // locations: existing by title, else new
  const locByName = new Map(world.locations.map(l => [norm(l.title), l.id]));
  const occupied = new Map<string, string>(); const cellOf = new Map<string, string>();
  for (const p of world.map?.pois ?? []) { occupied.set(p.anchor.cell, p.locationId); cellOf.set(p.locationId, p.anchor.cell); }
  const cells = listHexCells(geometry);
  const centre = offsetToAxial(geometry, Math.floor(geometry.cols / 2), Math.floor(geometry.rows / 2));
  const nearestFree = (target: Axial): string | undefined => {
    let best: Axial | undefined; let bd = Infinity;
    for (const c of cells) { if (occupied.has(cellKey(c))) continue; const d = hexDistance(c, target) * 1000 + c.r * 50 + c.q; if (d < bd) { bd = d; best = c; } }
    return best && cellKey(best);
  };
  // order: anchors first (topological by relativeTo), cycles fall back to centre
  const pending = [...out.locations]; const ordered: typeof pending = []; const known = new Set([...locByName.keys()]);
  for (let guard = 0; pending.length && guard < 50; guard++) {
    for (let i = 0; i < pending.length; i++) { const l = pending[i]; if (!l.relativeTo || known.has(norm(l.relativeTo)) || !pending.some(o => norm(o.name) === norm(l.relativeTo!))) { ordered.push(l); known.add(norm(l.name)); pending.splice(i--, 1); } }
    if (pending.length && ordered.length === 0) { ordered.push(pending.shift()!); }
  }
  ordered.push(...pending);
  let free = 0;
  for (const l of ordered) {
    const existingId = lookup(locByName, l.name);
    if (existingId && cellOf.has(existingId)) continue; // already placed: nothing to propose
    const anchorId = l.relativeTo ? lookup(locByName, l.relativeTo) : undefined;
    const anchorCell = anchorId ? parseCellKey(cellOf.get(anchorId) ?? '') : null;
    if (l.relativeTo && !anchorCell) warnings.push(`「${l.name}」的参照地点「${l.relativeTo}」未知，改为就近放置`);
    const v = DIR[l.direction ?? 'near']; const k = l.direction === 'inside' ? 0 : (l.distance ?? 2);
    const base = anchorCell ?? (() => { const step = free++; return { q: centre.q + (step % 3) * 2 - 2, r: centre.r + Math.floor(step / 3) * 2 - 2 }; })();
    let target = { q: base.q + v.q * k, r: base.r + v.r * k };
    if (!hexInBounds(geometry, target)) target = base;
    const cell = nearestFree(target);
    if (!cell) { warnings.push(`地图已满，未能放置「${l.name}」`); continue; }
    const id = existingId ?? slugId(l.name, ids, 'loc');
    occupied.set(cell, id); cellOf.set(id, cell); locByName.set(norm(l.name), id);
    const factionId = factionOf(l.faction);
    items.push({ id: `location:${id}`, kind: 'location', label: l.name, location: { id, title: l.name, text: l.description || l.name }, cell,
      existing: !!existingId, ...(factionId ? { factionId } : {}), ...(anchorId ? { anchor: anchorId } : {}) });
  }
  const npcByName = new Set(world.npcs.map(n => norm(n.name)));
  for (const n of out.npcs) {
    if (lookup(new Map([...npcByName].map(x => [x, true])), n.name)) continue;
    const locationId = lookup(locByName, n.location); if (!locationId) { warnings.push(`人物「${n.name}」所在地点「${n.location}」未知，已跳过`); continue; }
    const id = slugId(n.name, ids, 'npc'); npcByName.add(norm(n.name)); const factionId = factionOf(n.faction);
    items.push({ id: `npc:${id}`, kind: 'npc', label: n.name, npc: { id, name: n.name, description: n.description || n.name, locationId, ...(factionId ? { factionId } : {}) } });
  }
  const moves = new Set(world.actions.flatMap(a => a.effects.filter(e => e.kind === 'move').map(e => `${a.locationId}>${(e as { locationId: string }).locationId}`)));
  for (const r of out.routes) {
    const from = lookup(locByName, r.from), to = lookup(locByName, r.to);
    if (!from || !to || from === to) { warnings.push(`路线「${r.from} → ${r.to}」端点未知，已跳过`); continue; }
    if (moves.has(`${from}>${to}`)) continue; moves.add(`${from}>${to}`);
    items.push({ id: `route:${from}>${to}`, kind: 'route', label: `${r.from} → ${r.to}`, from, to });
  }
  return { items, warnings };
}

/** Item ids an item depends on (accepting it requires those to exist or be accepted too). */
export function mapDraftDependencies(item: MapDraftItem): string[] {
  const f = (id?: string) => (id ? [`faction:${id}`] : []);
  switch (item.kind) {
    case 'location': return f(item.factionId);
    case 'npc': return [`location:${item.npc.locationId}`, ...f(item.npc.factionId)];
    case 'route': return [`location:${item.from}`, `location:${item.to}`];
    default: return [];
  }
}

/** Apply accepted items. Items whose draft dependencies were rejected are dropped (dependencies on existing content are fine). */
export function applyMapDraft(world: WorldContent, diff: MapDraftDiff, accepted: ReadonlySet<string>): { content: WorldContent; applied: string[]; skipped: string[] } {
  const inDiff = new Set(diff.items.map(i => i.id)); const applied: string[] = []; const skipped: string[] = [];
  const ok = (i: MapDraftItem) => accepted.has(i.id) && mapDraftDependencies(i).every(d => !inDiff.has(d) || accepted.has(d));
  let map: WorldMap = world.map ?? { mapSchemaVersion: 1, geometry: DEFAULT_GEOMETRY, layers: {}, pois: [] };
  const locations = [...world.locations]; const npcs = [...world.npcs]; const actions = [...world.actions];
  const evidence: never[] = [];
  for (const item of diff.items) {
    if (!accepted.has(item.id)) continue;
    if (!ok(item)) { skipped.push(item.id); continue; }
    applied.push(item.id);
    if (item.kind === 'faction') {
      const layer = map.layers?.factions ?? { factions: [], cells: {} };
      map = { ...map, layers: { ...map.layers, factions: { ...layer, factions: [...layer.factions, { ...item.faction }] } } };
    } else if (item.kind === 'location') {
      if (!item.existing) locations.push({ id: item.location.id, title: item.location.title, text: item.location.text, origin: 'adapted', evidence });
      map = { ...map, pois: [...map.pois.filter(p => p.locationId !== item.location.id), { locationId: item.location.id, anchor: { cell: item.cell } }] };
      if (item.factionId && map.layers?.factions) map = { ...map, layers: { ...map.layers, factions: { ...map.layers.factions, cells: { ...map.layers.factions.cells, [item.cell]: item.factionId } } } };
    } else if (item.kind === 'npc') {
      npcs.push({ id: item.npc.id, name: item.npc.name, description: item.npc.description, goal: '（待作者补充）', initialLocationId: item.npc.locationId, knownFactIds: [],
        ...(item.npc.factionId ? { factionId: item.npc.factionId } : {}), origin: 'adapted', evidence });
    } else {
      const title = (id: string) => locations.find(l => l.id === id)?.title ?? id;
      let aid = `go_${item.from}_${item.to}`.slice(0, 80); while (actions.some(a => a.id === aid)) aid = `${aid.slice(0, 78)}_x`;
      actions.push({ id: aid, label: `前往${title(item.to)}`, description: '', locationId: item.from, availableWhen: [], requires: [], blockedReason: '暂时无法前往',
        risk: '', timeCost: 1, once: false, effects: [{ kind: 'move', locationId: item.to }], text: `你前往${title(item.to)}。`, origin: 'adapted', evidence });
    }
  }
  return { content: { ...world, map, locations, npcs, actions }, applied, skipped };
}
