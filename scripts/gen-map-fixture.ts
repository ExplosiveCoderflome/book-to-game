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
  if (c <= seaEdge + 1) return 'coast';
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
/** Named regions/districts (city-map step 1). Sea is left unassigned. */
function regionAt(c: number, r: number, t: string): string | undefined {
  if (t === 'sea') return undefined;
  if (r <= 5 && c <= 13) return 'north_woods';
  if (c >= 16 && r >= 8) return 'southeast_waste';
  if (r >= 12 && c <= 15) return 'southern_marsh';
  if (r >= 6 && (t === 'coast' || c <= 5)) return 'west_harbor';
  if (r >= 6 && c <= 15) return 'crown_heartland';
  return undefined;
}
const tCells: Record<string, string> = {}, fCells: Record<string, string> = {}, rCells: Record<string, string> = {};
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const t = terrainAt(c, r); tCells[key(c, r)] = t;
  const f = factionAt(c, r, t); if (f) fCells[key(c, r)] = f;
  const g = regionAt(c, r, t); if (g) rCells[key(c, r)] = g;
}

/** First coast cell scanning eastward on a row (ports / capes must sit on the shoreline). */
function coastCol(r: number): number {
  for (let c = 0; c < COLS; c++) if (tCells[key(c, r)] === 'coast') return c;
  throw new Error(`no coast on row ${r}`);
}
const places: [string, string, number, number, string][] = [
  ['watch_cape', '望塔岬', coastCol(1), 1, '北方悬崖上孤零零的灯塔。'],
  ['elderwood', '古木幽谷', 8, 2, '古老森林深处的德鲁伊石环。'],
  ['ironspine', '铁脊隘口', 15, 4, '翻越山脉的唯一道路。'],
  ['saltmere', '盐沼港', coastCol(8), 8, '河流入海处繁忙的港口。'],
  ['highcrown', '高冠城', 8, 7, '蔚蓝王冠的王城。'],
  ['riverford', '河渡镇', 11, 8, '河上收过桥费的小镇。'],
  ['mirefen', '泥沼村', 9, 13, '南部沼泽中的高脚屋村落。'],
  ['sunscar', '日痕绿洲', 20, 12, '灰烬苏丹国的棕榈都城。'],
];
const ev = [{ chapterId: 'fixture', paragraphId: 'p1' }];
const map: WorldMap = {
  mapSchemaVersion: 1, geometry,
  layers: {
    terrain: { palette: [
      { id: 'sea', label: '海洋', color: '#6f9fc4', tags: ['water'] },
      { id: 'coast', label: '海岸', color: '#e4d6a0' },
      { id: 'plains', label: '平原', color: '#b9cf86' },
      { id: 'forest', label: '森林', color: '#4f8a4a' },
      { id: 'mountains', label: '山脉', color: '#8c8178', tags: ['impassable'] },
      { id: 'river', label: '河流', color: '#5c9fd6', tags: ['water'] },
      { id: 'desert', label: '沙漠', color: '#e2bf72' },
      { id: 'marsh', label: '沼泽', color: '#7d9b78' },
    ], cells: tCells },
    factions: { factions: [
      { id: 'azure_crown', name: '蔚蓝王冠', color: '#2f5fbf', description: '沿海王国。' },
      { id: 'verdant_pact', name: '翠绿盟约', color: '#2e8b3e', description: '森林德鲁伊联盟。' },
      { id: 'ashen_sultanate', name: '灰烬苏丹国', color: '#c0392b', description: '沙漠帝国。' },
    ], cells: fCells },
    regions: { regions: [
      { id: 'north_woods', name: '北境林地', color: '#3d6b35', tags: ['wild'] },
      { id: 'crown_heartland', name: '中央王畿', color: '#2f4f9f', tags: ['civilized'] },
      { id: 'west_harbor', name: '西岸港区', color: '#1f7a8c', tags: ['port'] },
      { id: 'southern_marsh', name: '南部沼泽', color: '#5b6b2e', tags: ['wild', 'miasma'] },
      { id: 'southeast_waste', name: '东南荒漠', color: '#b5651d', tags: ['wild'] },
    ], cells: rCells },
  },
  pois: places.map(([id, , c, r]) => ({ locationId: id, anchor: { cell: key(c, r) } })),
};
const routes: [string, string][] = [['saltmere','highcrown'],['highcrown','riverford'],['riverford','ironspine'],['highcrown','elderwood'],['elderwood','watch_cape'],['highcrown','mirefen'],['saltmere','watch_cape'],['saltmere','mirefen'],['ironspine','sunscar']];
const title = (id: string) => places.find(p => p[0] === id)![1];
const world: WorldContent = worldContentSchema.parse({
  schemaVersion: 1, mode: 'open', title: '余烬之地', premise: '三个国度瓜分着西海与东方沙漠之间这片破碎的土地。',
  playerRole: '游历四方的制图师', goal: '绘完全境地图并抵达日痕绿洲。', worldRules: ['山脉只能经铁脊隘口翻越。'],
  adaptationNotes: '世界地图图层测试数据（地形 + 势力 + 地点标记）。', sourceChapterIds: ['fixture'],
  initialLocationId: 'saltmere', timeLimit: 30, timeoutEnding: '季节已尽，你的地图仍未完成。',
  locations: places.map(([id, t, , , text]) => ({ id, title: t, text, origin: 'adapted', evidence: ev })),
  facts: [
    { id: 'harbor_rumor', label: '港口传闻', description: '水手口中关于东方绿洲的消息。', kind: 'clue', initialValue: false, playerKnown: false, origin: 'adapted', evidence: ev },
    { id: 'crown_pass', label: '王冠通行令', description: '蔚蓝王冠签发的通行文书。', kind: 'item', initialValue: false, playerKnown: false, origin: 'adapted', evidence: ev },
    { id: 'miasma_herb', label: '瘴草', description: '南部沼泽特有的发光草药。', kind: 'item', initialValue: false, playerKnown: false, origin: 'adapted', evidence: ev },
    { id: 'campfire', label: '篝火', description: '你生起的火堆。', kind: 'event', initialValue: false, playerKnown: false, origin: 'adapted', evidence: ev },
    { id: 'charted', label: '全图绘成', description: '在绿洲完成了地图。', kind: 'event', initialValue: false, playerKnown: false, origin: 'adapted', evidence: ev },
  ], npcs: [],
  actions: [
    { id: 'ask_harbor', label: '在码头打听消息', description: '只有身处海岸时才能和水手搭话。', locationId: 'saltmere', availableWhen: [{ kind: 'at_terrain', terrainIds: ['coast'] }], requires: [],
      blockedReason: '这里没有水手。', risk: '', timeCost: 1, once: true, effects: [{ kind: 'set', factId: 'harbor_rumor', value: true }, { kind: 'reveal', factId: 'harbor_rumor' }],
      text: '水手们说，东方的日痕绿洲在等一位制图师。', origin: 'adapted', evidence: ev },
    { id: 'crown_permit', label: '向王冠驿站申领通行令', description: '须身处蔚蓝王冠领土。', locationId: 'highcrown', availableWhen: [], requires: [{ kind: 'in_faction_territory', factionIds: ['azure_crown'] }],
      blockedReason: '此地不归蔚蓝王冠管辖。', risk: '', timeCost: 1, once: true, effects: [{ kind: 'set', factId: 'crown_pass', value: true }, { kind: 'reveal', factId: 'crown_pass' }],
      text: '驿丞在通行令上盖下蓝色火漆。', origin: 'adapted', evidence: ev },
    { id: 'finish_map', label: '在绿洲完成地图', description: '', locationId: 'sunscar', availableWhen: [], requires: [{ kind: 'in_faction_territory', factionIds: ['ashen_sultanate'] }],
      blockedReason: '还未抵达苏丹国领土。', risk: '', timeCost: 1, once: true, effects: [{ kind: 'set', factId: 'charted', value: true }],
      text: '你在棕榈树下画完最后一笔。', origin: 'adapted', evidence: ev },
    { id: 'gather_herb', label: '采集瘴草', description: '只有身处南部沼泽才能找到瘴草。', locationId: 'mirefen', availableWhen: [{ kind: 'in_region', regionIds: ['southern_marsh'] }], requires: [],
      blockedReason: '这里不长瘴草。', risk: '', timeCost: 1, once: true, effects: [{ kind: 'set', factId: 'miasma_herb', value: true }, { kind: 'reveal', factId: 'miasma_herb' }], tags: ['gather'],
      text: '你在泥水里拔出一把发着微光的瘴草。', origin: 'adapted', evidence: ev },
    { id: 'make_fire', label: '生火取暖', description: '', locationId: 'mirefen', availableWhen: [], requires: [],
      blockedReason: '此处不能生火。', risk: '', timeCost: 1, once: false, effects: [{ kind: 'set', factId: 'campfire', value: true }], tags: ['fire'],
      text: '火光跳动起来。', origin: 'adapted', evidence: ev },
    ...routes.flatMap(([a, b]) => [[a, b], [b, a]]).map(([from, to]) => ({
    id: `go_${from}_${to}`, label: `前往${title(to)}`, description: '', locationId: from, availableWhen: [], requires: [],
    blockedReason: '道路不通。', risk: '', timeCost: 1, once: false, effects: [{ kind: 'move', locationId: to }],
    text: `你动身前往${title(to)}。`, origin: 'adapted', evidence: ev }))],
  events: [], endings: [{ id: 'arrive', title: '地图完成', text: '你带着完成的地图抵达日痕绿洲。', when: [{ kind: 'fact', factId: 'charted', value: true }] }],
  worldbook: { entries: [
    { id: 'wb_marsh_miasma', title: '沼泽瘴气', keys: ['瘴气', '沼泽'], kind: 'rule',
      content: '南部沼泽终年弥漫可燃瘴气，当地人从不生明火，夜里只靠萤苔照明。',
      scope: { type: 'regions', regionIds: ['southern_marsh'] },
      constraints: [{ type: 'forbid_choice_tags', tags: ['fire'], message: '瘴气易燃，沼泽里不能生火。' }] },
  ] },
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
