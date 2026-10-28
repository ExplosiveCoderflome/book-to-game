import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { content } from './helpers/open-fixture.js';
import type { WorldContent, WorldMap } from '@novel-game/contracts';
import { locationMap, mapPath, validateSubMaps } from '@novel-game/rules';
import { playMap, startWith } from './helpers/map-fixture.js';

const city = (over: Partial<WorldMap> = {}): WorldMap => ({ mapSchemaVersion: 1, id: 'market_map', name: '集市街区', parent: { mapId: 'root', locationId: 'market' },
  geometry: { kind: 'hex', orientation: 'pointy', cols: 6, rows: 4, size: 28 }, fog: true, layers: {}, pois: [{ locationId: 'stall', anchor: { cell: '1,1' } }], ...over });
function world(): WorldContent {
  const w = content(); w.map = playMap(false);
  w.locations.push({ id: 'stall', title: '摊位', text: '卖鱼的摊位', parentLocationId: 'market', origin: 'adapted', evidence: [] });
  w.subMaps = [city()];
  w.actions.push({ id: 'enter_stall', label: '进入摊位', description: '', locationId: 'market', availableWhen: [], requires: [], blockedReason: 'x', risk: '', timeCost: 1, once: false, effects: [{ kind: 'move', locationId: 'stall' }], text: '进入。', origin: 'adapted', evidence: [] });
  w.actions.push({ id: 'exit_stall', label: '返回集市', description: '', locationId: 'stall', availableWhen: [], requires: [], blockedReason: 'x', risk: '', timeCost: 1, once: false, effects: [{ kind: 'move', locationId: 'market' }], text: '回。', origin: 'adapted', evidence: [] });
  return w;
}
const input = (actionId: string, expectedTurn: number) => ({ actionId, expectedTurn, requestId: randomUUID() });

test('sub-map validation: clean world ok; orphan, cycle, multi-owner, location cycle flagged', () => {
  assert.deepEqual(validateSubMaps(world()).filter(i => i.level === 'error'), []);
  const codes = (w: WorldContent) => validateSubMaps(w).map(i => i.code);
  assert.ok(codes({ ...world(), subMaps: [city({ parent: { mapId: 'nope', locationId: 'market' } })] }).includes('submap_orphan'));
  assert.ok(codes({ ...world(), subMaps: [city({ parent: undefined })] }).includes('submap_orphan'));
  assert.ok(codes({ ...world(), subMaps: [city({ id: 'a', parent: { mapId: 'b', locationId: 'market' } }), city({ id: 'b', parent: { mapId: 'a', locationId: 'stall' } })] }).includes('submap_cycle'));
  assert.ok(codes({ ...world(), subMaps: [city(), city({ id: 'x2' })] }).includes('submap_multi_owner'));
  const w = world(); w.locations.find(l => l.id === 'market')!.parentLocationId = 'stall';
  assert.ok(codes(w).includes('location_cycle'));
  const o = world(); o.locations.find(l => l.id === 'stall')!.parentLocationId = 'ghost';
  assert.ok(codes(o).includes('location_orphan_parent'));
});

test('breadcrumb path + locationMap resolves sub-map', () => {
  const w = world();
  assert.deepEqual(mapPath(w, 'market_map').map(p => p.mapId), ['root', 'market_map']);
  assert.equal(locationMap(w, 'stall')?.id, 'market_map');
  assert.equal(locationMap(w, 'dock')?.id, undefined);
});

test('play view switches to the current location map (and its own fog)', () => {
  const { db, adventures, view } = startWith(world());
  try {
    assert.equal(view.map?.mapId, 'root');
    const a = adventures.act(view.id, input('to_market', 0));
    const b = adventures.act(view.id, input('enter_stall', a.turn));
    assert.equal(b.map?.mapId, 'market_map'); assert.equal(b.map?.cell, '1,1'); assert.equal(b.map?.fog, true);
    assert.ok(b.map?.explored?.includes('1,1'));
    const c = adventures.act(view.id, input('exit_stall', b.turn));
    assert.equal(c.map?.mapId, 'root');
  } finally { db.close(); }
});
