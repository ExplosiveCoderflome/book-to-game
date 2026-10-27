import type { HexGeometry, WorldMap } from '@novel-game/contracts';
import { axialToOffset, hexCorners, hexToPixel, listHexCells, parseCellKey, cellKey, type Axial } from './world-map.js';

/**
 * Map render seam: pure, deterministic, no AI/IO.
 * - describeMapForImagePrompt: map data → structured text for an image-generation prompt.
 * - renderMapSchematicSvg: ground-truth schematic (what the AI image must respect).
 * Image-gen itself lives behind the MapImageProvider port (adapters), never here.
 */
export interface MapPlaceRef { id: string; title: string }
export interface MapDescribeWorld { title?: string; locations: readonly MapPlaceRef[] }

const REGION_V = ['north', 'central', 'south'] as const;
const REGION_H = ['west', 'central', 'east'] as const;

/** 3×3 region name for an offset position, e.g. "north-west", "center". */
export function regionOf(g: HexGeometry, a: Axial): string {
  const { col, row } = axialToOffset(g, a);
  const v = REGION_V[Math.min(2, Math.floor((row / g.rows) * 3))];
  const h = REGION_H[Math.min(2, Math.floor((col / g.cols) * 3))];
  if (v === 'central' && h === 'central') return 'center';
  if (v === 'central') return h;
  if (h === 'central') return v;
  return `${v}-${h}`;
}

function regionsSummary(g: HexGeometry, keys: string[]): string[] {
  const counts = new Map<string, number>();
  for (const k of keys) { const a = parseCellKey(k); if (a) { const r = regionOf(g, a); counts.set(r, (counts.get(r) ?? 0) + 1); } }
  const total = keys.length || 1;
  return [...counts.entries()].sort((x, y) => y[1] - x[1]).filter(([, n]) => n / total >= 0.12).slice(0, 3).map(([r]) => r);
}

export interface MapPromptOptions { style?: string; maxChars?: number }
export const DEFAULT_MAP_STYLE = 'Fantasy world map, hand-illustrated on aged parchment, ink linework, watercolor washes, top-down, no grid lines.';

export interface MapDescription {
  layout: string; terrain: { label: string; share: number; regions: string[] }[];
  factions: { name: string; color: string; regions: string[] }[];
  places: { name: string; region: string; terrain?: string; faction?: string }[];
}

export function describeMapStructured(map: WorldMap, world: MapDescribeWorld): MapDescription {
  const g = map.geometry as HexGeometry;
  const total = g.cols * g.rows;
  const terrain = map.layers?.terrain; const factions = map.layers?.factions;
  const tLabel = new Map(terrain?.palette.map(p => [p.id, p.label]) ?? []);
  const fName = new Map(factions?.factions.map(f => [f.id, f.name]) ?? []);
  const byTerrain = new Map<string, string[]>();
  for (const [k, t] of Object.entries(terrain?.cells ?? {})) byTerrain.set(t, [...(byTerrain.get(t) ?? []), k]);
  const titles = new Map(world.locations.map(l => [l.id, l.title]));
  return {
    layout: `${g.cols}x${g.rows} landscape map${world.title ? ` of "${world.title}"` : ''}`,
    terrain: [...byTerrain.entries()].sort((a, b) => b[1].length - a[1].length)
      .map(([id, ks]) => ({ label: tLabel.get(id) ?? id, share: ks.length / total, regions: regionsSummary(g, ks) })),
    factions: (factions?.factions ?? []).map(f => ({ name: f.name, color: f.color,
      regions: regionsSummary(g, Object.entries(factions!.cells).filter(([, v]) => v === f.id).map(([k]) => k)) })),
    places: map.pois.map(p => {
      const a = parseCellKey(p.anchor.cell);
      const t = terrain?.cells[p.anchor.cell]; const f = factions?.cells[p.anchor.cell];
      return { name: p.label ?? titles.get(p.locationId) ?? p.locationId, region: a ? regionOf(g, a) : 'unknown',
        terrain: t ? tLabel.get(t) : undefined, faction: f ? fName.get(f) : undefined };
    }),
  };
}

/** Text prompt for an image model. Deterministic; trims to maxChars (default 900). */
export function describeMapForImagePrompt(map: WorldMap, world: MapDescribeWorld, opts: MapPromptOptions = {}): string {
  const d = describeMapStructured(map, world);
  const parts: string[] = [opts.style ?? DEFAULT_MAP_STYLE, `Wide ${d.layout.replace(/^\d+x\d+ /, "")}.`];
  const terr = d.terrain.filter(t => t.share >= 0.02).map(t => `${t.label} ${t.regions.join('/')}`);
  if (terr.length) parts.push(`Geography: ${terr.join('; ')}.`);
  if (d.factions.length) parts.push(`Realms, tinted with dotted borders: ${d.factions.map(f => `${f.name} (${f.color}) ${f.regions.join('/')}`).join('; ')}.`);
  if (d.places.length) parts.push(`Labeled places: ${d.places.map(p => `${p.name} (${p.region}${p.terrain ? `, ${p.terrain}` : ''})`).join('; ')}.`);
  parts.push('Compass rose, decorative cartouche title, serif labels.');
  let out = parts.join(' ');
  const max = opts.maxChars ?? 900;
  if (out.length > max) out = out.slice(0, max - 1).replace(/[ ,;][^ ,;]*$/, '') + '…';
  return out;
}

export interface SchematicOptions { width?: number; height?: number; title?: string; places?: readonly MapPlaceRef[] }
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Deterministic schematic SVG: terrain fill, faction borders, POI markers + labels. */
export function renderMapSchematicSvg(map: WorldMap, opts: SchematicOptions = {}): string {
  const g = map.geometry as HexGeometry;
  const W = opts.width ?? 1920, H = opts.height ?? 1080;
  const cells = listHexCells(g);
  const pts = cells.flatMap(c => hexCorners(g, hexToPixel(g, c)));
  const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
  const pad = 60, top = opts.title ? 70 : 0;
  const k = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2 - top) / (maxY - minY));
  const ox = (W - (maxX - minX) * k) / 2 - minX * k, oy = top + (H - top - (maxY - minY) * k) / 2 - minY * k;
  const P = (p: { x: number; y: number }) => `${(p.x * k + ox).toFixed(1)},${(p.y * k + oy).toFixed(1)}`;
  const tColor = new Map(map.layers?.terrain?.palette.map(p => [p.id, p.color]) ?? []);
  const fColor = new Map(map.layers?.factions?.factions.map(f => [f.id, f.color]) ?? []);
  const tCells = map.layers?.terrain?.cells ?? {}; const fCells = map.layers?.factions?.cells ?? {};
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#f3ead6"/>`];
  if (opts.title) out.push(`<text x="${W / 2}" y="50" text-anchor="middle" font-family="serif" font-size="34" fill="#3b2f1e">${esc(opts.title)}</text>`);
  for (const c of cells) {
    const key = cellKey(c); const poly = hexCorners(g, hexToPixel(g, c)).map(P).join(' ');
    out.push(`<polygon points="${poly}" fill="${tColor.get(tCells[key] ?? '') ?? '#e8e0cc'}" stroke="#00000018" stroke-width="1"/>`);
    const f = fCells[key];
    if (f) out.push(`<polygon points="${poly}" fill="${fColor.get(f) ?? '#000'}" fill-opacity="0.22"/>`);
  }
  // Faction borders: draw hex edges where neighbour faction differs.
  const dirs: Axial[] = [{ q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 }];
  for (const c of cells) {
    const f = fCells[cellKey(c)]; if (!f) continue;
    const center = hexToPixel(g, c); const corners = hexCorners(g, center);
    for (const d of dirs) {
      const n = { q: c.q + d.q, r: c.r + d.r };
      if (fCells[cellKey(n)] === f) continue;
      const nc = hexToPixel(g, n); const mid = { x: (center.x + nc.x) / 2, y: (center.y + nc.y) / 2 };
      const edge = [...corners].sort((a, b) => Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y)).slice(0, 2);
      out.push(`<line x1="${P(edge[0]).split(',')[0]}" y1="${P(edge[0]).split(',')[1]}" x2="${P(edge[1]).split(',')[0]}" y2="${P(edge[1]).split(',')[1]}" stroke="${fColor.get(f)}" stroke-width="4" stroke-linecap="round"/>`);
    }
  }
  const titles = new Map((opts.places ?? []).map(p => [p.id, p.title]));
  for (const poi of map.pois) {
    const a = parseCellKey(poi.anchor.cell); if (!a) continue;
    const [x, y] = P(hexToPixel(g, a)).split(',').map(Number);
    const name = poi.label ?? titles.get(poi.locationId) ?? poi.locationId;
    out.push(`<circle cx="${x}" cy="${y}" r="9" fill="#2b1d0e" stroke="#fff" stroke-width="3"/>`,
      `<text x="${x}" y="${y - 16}" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="600" fill="#1d140a" stroke="#f3ead6" stroke-width="4" paint-order="stroke">${esc(name)}</text>`);
  }
  // Legend
  let ly = H - 30 - ((map.layers?.terrain?.palette.length ?? 0) + (map.layers?.factions?.factions.length ?? 0)) * 26;
  for (const p of map.layers?.terrain?.palette ?? []) { out.push(`<rect x="24" y="${ly - 14}" width="18" height="18" fill="${p.color}"/><text x="50" y="${ly}" font-family="sans-serif" font-size="16">${esc(p.label)}</text>`); ly += 26; }
  for (const f of map.layers?.factions?.factions ?? []) { out.push(`<rect x="24" y="${ly - 14}" width="18" height="18" fill="none" stroke="${f.color}" stroke-width="4"/><text x="50" y="${ly}" font-family="sans-serif" font-size="16">${esc(f.name)}</text>`); ly += 26; }
  out.push('</svg>');
  return out.join('\n');
}
