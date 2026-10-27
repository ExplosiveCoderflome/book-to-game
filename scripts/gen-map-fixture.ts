/**
 * Generates the standalone world-map test fixture (fixtures/world-map/ember-reach.world.json)
 * and, with --out <dir>, the image prompt + schematic SVG next to it. Deterministic.
 * Usage: tsx scripts/gen-map-fixture.ts [--out /workspace/btg-e2e/map-test]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { worldContentSchema, type WorldContent, type WorldMap } from '@novel-game/contracts';
import { cellKey, describeMapForImagePrompt, offsetToAxial, renderMapSchematicSvg } from '@novel-game/rules';

const COLS = 24, ROWS = 16;
const geometry = { kind: 'hex' as const, orientation: 'pointy' as const, cols: COLS, rows: ROWS, size: 32 };
const noise = (c: number, r: number) => ((Math.sin(c * 12.9898 + r * 78.233) * 43758.5453) % 1 + 1) % 1;
const key = (c: number, r: number) => cellKey(offsetToAxial(geometry, c, r));

// River: polyline from Ironspine (15,4) down to the western sea (2,11).
const river = new Set<string>();
for (const [c, r] of [[14,5],[14,6],[13,6],[12,7],[11,8],[10,8],[9,9],[8,9],[7,10],[6,10],[5,10],[4,11],[3,11]]) river.add(`${c},${r}`);

function terrainAt(c: number, r: number): string {
  const n = noise(c, r);
  const seaEdge = 2 + (r > 9 && r < 15 ? 2 : 0) + (n > 0.6 ? 1 : 0) - (r < 3 ? 1 : 0);
  if (c < seaEdge || r === ROWS - 1 && c < 7) return 'sea';
  if (c <= seaEdge) return 'coast';
  if (river.has(`${c},${r}`)) return 'river';
  if (Math.abs(c - (16 - r * 0.25)) <= 1.2 && r <= 9) return 'mountains';
  if (c >= 17 && r >= 8) return n > 0.85 ? 'plains' : 'desert';
  if (c >= 7 && c <= 12 && r >= 12) return 'marsh';
  if (r <= 5 && c >= 4 && c <= 12) return n > 0.8 ? 'plains' : 'forest';
  if (c >= 19 && r < 8) return n > 0.5 ? 'forest' : 'plains';
  return n > 0.88 ? 'forest' : 'plains';
}
function factionAt(c: number, r: number, t: string): string | undefined {
  if (t === 'sea') return undefined;
  if (r <= 5 && c <= 13) return 'verdant_pact';
  if (c <= 11 && r >= 6 && r <= 12) return 'azure_crown';
  if (c >= 16 && r >= 8) return 'ashen_sultanate';
  return undefined;
}
const tCells: Record<string, string> = {}, fCells: Record<string, string> = {};
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const t = terrainAt(c, r); tCells[key(c, r)] = t;
  const f = factionAt(c, r, t); if (f) fCells[key(c, r)] = f;
}

const places: [string, string, number, number, string][] = [
  ['watch_cape', 'Watchtower Cape', 3, 1, 'A lonely lighthouse on the northern cliffs.'],
  ['elderwood', 'Elderwood Hollow', 8, 2, 'A druid circle deep in the old forest.'],
  ['ironspine', 'Ironspine Pass', 15, 4, 'The only road over the mountains.'],
  ['saltmere', 'Port Saltmere', 4, 8, 'A busy harbour where the river meets the sea.'],
  ['highcrown', 'Highcrown', 8, 7, 'Royal citadel of the Azure Crown.'],
  ['riverford', 'Riverford', 11, 8, 'A toll bridge town on the river.'],
  ['mirefen', 'Mirefen', 9, 13, 'Stilt village in the southern marsh.'],
  ['sunscar', 'Sunscar Oasis', 20, 12, 'Palm-ringed capital of the Ashen Sultanate.'],
];
const ev = [{ chapterId: 'fixture', paragraphId: 'p1' }];
const map: WorldMap = {
  mapSchemaVersion: 1, geometry,
  layers: {
    terrain: { palette: [
      { id: 'sea', label: 'Sea', color: '#6f9fc4', tags: ['water'] },
      { id: 'coast', label: 'Coast', color: '#e4d6a0' },
      { id: 'plains', label: 'Plains', color: '#b9cf86' },
      { id: 'forest', label: 'Forest', color: '#4f8a4a' },
      { id: 'mountains', label: 'Mountains', color: '#8c8178', tags: ['impassable'] },
      { id: 'river', label: 'River', color: '#5c9fd6', tags: ['water'] },
      { id: 'desert', label: 'Desert', color: '#e2bf72' },
      { id: 'marsh', label: 'Marsh', color: '#7d9b78' },
    ], cells: tCells },
    factions: { factions: [
      { id: 'azure_crown', name: 'Azure Crown', color: '#2f5fbf', description: 'Coastal kingdom.' },
      { id: 'verdant_pact', name: 'Verdant Pact', color: '#2e8b3e', description: 'Forest druid league.' },
      { id: 'ashen_sultanate', name: 'Ashen Sultanate', color: '#c0392b', description: 'Desert empire.' },
    ], cells: fCells },
  },
  pois: places.map(([id, , c, r]) => ({ locationId: id, anchor: { cell: key(c, r) } })),
};
const routes: [string, string][] = [['saltmere','highcrown'],['highcrown','riverford'],['riverford','ironspine'],['highcrown','elderwood'],['elderwood','watch_cape'],['highcrown','mirefen'],['ironspine','sunscar']];
const title = (id: string) => places.find(p => p[0] === id)![1];
const world: WorldContent = worldContentSchema.parse({
  schemaVersion: 1, mode: 'open', title: 'The Ember Reach', premise: 'Three realms share a fractured land between the western sea and the eastern desert.',
  playerRole: 'A wandering cartographer', goal: 'Chart the realm and reach Sunscar Oasis.', worldRules: ['Mountains can only be crossed at Ironspine Pass.'],
  adaptationNotes: 'Test fixture for the world map layer (terrain + factions + POIs).', sourceChapterIds: ['fixture'],
  initialLocationId: 'saltmere', timeLimit: 30, timeoutEnding: 'The season ends before your map is complete.',
  locations: places.map(([id, t, , , text]) => ({ id, title: t, text, origin: 'adapted', evidence: ev })),
  facts: [], npcs: [],
  actions: routes.flatMap(([a, b]) => [[a, b], [b, a]]).map(([from, to]) => ({
    id: `go_${from}_${to}`, label: `Travel to ${title(to)}`, description: '', locationId: from, availableWhen: [], requires: [],
    blockedReason: 'The road is closed.', risk: '', timeCost: 1, once: false, effects: [{ kind: 'move', locationId: to }],
    text: `You travel to ${title(to)}.`, origin: 'adapted', evidence: ev })),
  events: [], endings: [{ id: 'arrive', title: 'Map complete', text: 'You reach Sunscar with a finished map.', when: [{ kind: 'time', atLeast: 1 }] }],
  map,
});

const fixturePath = 'fixtures/world-map/ember-reach.world.json';
writeFileSync(fixturePath, JSON.stringify(world, null, 2) + '\n');
const outIdx = process.argv.indexOf('--out');
if (outIdx > 0) {
  const dir = process.argv[outIdx + 1]; mkdirSync(dir, { recursive: true });
  const refs = world.locations.map(l => ({ id: l.id, title: l.title }));
  writeFileSync(path.join(dir, 'map.json'), JSON.stringify(world, null, 2) + '\n');
  writeFileSync(path.join(dir, 'prompt.txt'), describeMapForImagePrompt(world.map!, { title: world.title, locations: refs }) + '\n');
  writeFileSync(path.join(dir, 'schematic.svg'), renderMapSchematicSvg(world.map!, { title: world.title, places: refs }));
}
console.log(`wrote ${fixturePath}`);
