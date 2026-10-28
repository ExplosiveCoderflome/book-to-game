import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapDraftModelOutputSchema, worldContentSchema, type MapDraftModelOutput } from '@novel-game/contracts';
import { applyMapDraft, planMapDraft } from '@novel-game/rules';
import { SqliteDatabase as Database } from '../src/platform/database.js';
import { extractMapDraft, SqliteWorldRepository, WorldService, type MapDraftModel } from '../src/modules/worlds/index.js';
import { validateWorld } from '../src/modules/worlds/domain/validate-world.js';
import { content, source } from './helpers/open-fixture.js';

const OUTPUT: MapDraftModelOutput = mapDraftModelOutputSchema.parse({
  factions: [{ name: '青帮', description: '码头帮派' }, { name: '巡捕房' }],
  locations: [
    { name: '外滩', description: '江边繁华大道' },
    { name: '十六铺码头', relativeTo: '外滩', direction: 's', distance: 3, faction: '青帮' },
    { name: '巡捕房总部', relativeTo: '外滩', direction: 'w', distance: 2, faction: '巡捕房' },
    { name: '鬼市', relativeTo: '不存在的地方', direction: 'e' },
  ],
  npcs: [{ name: '杜老板', description: '青帮头目', location: '十六铺码头', faction: '青帮' }, { name: '幽灵', location: '月球' }],
  routes: [{ from: '外滩', to: '十六铺码头' }, { from: '十六铺码头', to: '外滩' }, { from: '外滩', to: '火星' }],
});

/** Mock provider: deterministic, records what it was asked. */
class MockMapModel implements MapDraftModel {
  calls: { text: string; existingLocations: string[] }[] = [];
  async extractMapDraft(input: { text: string; existingLocations: string[]; existingFactions: string[] }) { this.calls.push(input); return structuredClone(OUTPUT); }
}

test('plan is deterministic, placement follows relative directions, unknown refs become warnings', () => {
  const w = content(); delete w.map;
  const a = planMapDraft(w, OUTPUT), b = planMapDraft(w, OUTPUT);
  assert.deepEqual(a, b);
  const cell = (name: string) => a.items.find(i => i.kind === 'location' && i.label === name)!;
  const bund = cell('外滩'), dock = cell('十六铺码头'), police = cell('巡捕房总部');
  assert.ok(bund.kind === 'location' && dock.kind === 'location' && police.kind === 'location');
  const [bq, br] = bund.cell.split(',').map(Number), [dq, dr] = dock.cell.split(',').map(Number), [pq, pr] = police.cell.split(',').map(Number);
  assert.ok(dr > br, 'south = larger r'); assert.ok(pq < bq && pr === br, 'west = smaller q same row');
  assert.equal(new Set(a.items.filter(i => i.kind === 'location').map(i => (i as { cell: string }).cell)).size, 4, 'no shared cells');
  assert.ok(a.warnings.some(x => x.includes('不存在的地方'))); assert.ok(a.warnings.some(x => x.includes('月球'))); assert.ok(a.warnings.some(x => x.includes('火星')));
  assert.equal(a.items.filter(i => i.kind === 'route').length, 2);
});

test('apply only accepted items; rejecting a location drops dependent NPC/route; result is valid content', () => {
  const w = content(); delete w.map;
  const diff = planMapDraft(w, OUTPUT);
  const all = new Set(diff.items.map(i => i.id));
  const full = applyMapDraft(w, diff, all);
  assert.equal(full.skipped.length, 0);
  worldContentSchema.parse(full.content);
  assert.deepEqual(validateWorld(full.content, source).errors, []);
  assert.equal(w.locations.length, content().locations.length, 'input untouched');
  const dock = diff.items.find(i => i.label === '十六铺码头')!.id;
  const partial = applyMapDraft(w, diff, new Set([...all].filter(id => id !== dock)));
  assert.ok(!partial.content.locations.some(l => l.title === '十六铺码头'));
  assert.ok(!partial.content.npcs.some(n => n.name === '杜老板'));
  assert.ok(partial.skipped.some(s => s.startsWith('npc:')) && partial.skipped.some(s => s.startsWith('route:')));
  const npc = full.content.npcs.find(n => n.name === '杜老板')!; assert.ok(npc.factionId);
});

test('extractMapDraft (mock provider) is read-only and uses source chapters when no text given', async () => {
  const db = new Database(':memory:');
  try {
    const worlds = new WorldService(new SqliteWorldRepository(db), { get: () => structuredClone(source) });
    const draft = worlds.create({ sourceId: source.id, content: content() });
    const model = new MockMapModel();
    const diff = await extractMapDraft(worlds, () => structuredClone(source), draft.id, {}, model, AbortSignal.timeout(5000), 'mock');
    assert.equal(model.calls.length, 1); assert.ok(model.calls[0].text.length > 0);
    assert.ok(model.calls[0].existingLocations.length > 0);
    assert.ok(diff.items.length > 0); assert.equal(diff.model, 'mock');
    assert.equal(worlds.get(draft.id).version, 1, 'draft not modified');
    assert.deepEqual(worlds.get(draft.id).content, draft.content);
  } finally { db.close(); }
});

test('fuzzy name match: "旧仓库" reuses existing "北边的旧仓库" instead of duplicating', () => {
  const w = content(); delete w.map;
  w.locations[1] = { ...w.locations[1], title: '北边的旧仓库' };
  const diff = planMapDraft(w, mapDraftModelOutputSchema.parse({ locations: [{ name: '旧仓库' }], npcs: [{ name: '新人', location: '旧仓库' }] }));
  const loc = diff.items.find(i => i.kind === 'location');
  assert.ok(loc && loc.kind === 'location' && loc.existing && loc.location.id === w.locations[1].id);
  const npc = diff.items.find(i => i.kind === 'npc'); assert.ok(npc && npc.kind === 'npc' && npc.npc.locationId === w.locations[1].id);
});
