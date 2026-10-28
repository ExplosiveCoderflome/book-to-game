import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorldContent } from '@novel-game/contracts';
import { createEmptyMap, createSubMap, linkSubMapLocations, withMapById } from '../src/lib/world-map';

const base = (): WorldContent => ({ schemaVersion: 1, mode: 'open', title: 't', premise: 'p', playerRole: 'r', goal: 'g', worldRules: ['x'], adaptationNotes: '', sourceChapterIds: ['c'],
  initialLocationId: 'city', timeLimit: 10, timeoutEnding: 'e',
  locations: ['city', 'inn', 'well'].map(id => ({ id, title: id, text: id, origin: 'adapted' as const, evidence: [] })),
  facts: [], npcs: [], actions: [], events: [], endings: [{ id: 'e', title: 'e', text: 'e', when: [{ kind: 'time', atLeast: 1 }] }],
  map: { ...createEmptyMap(8, 6), pois: [{ locationId: 'city', anchor: { cell: '1,1' } }] } });

test('createSubMap → link hierarchy with ordinary move actions → remove cascades', () => {
  const r = createSubMap(base(), 'root', 'city');
  assert.equal(r.mapId, 'city_map');
  const sub = r.content.subMaps![0]; assert.deepEqual(sub.parent, { mapId: 'root', locationId: 'city' });
  const placed = withMapById(r.content, 'city_map', { ...sub, pois: [{ locationId: 'inn', anchor: { cell: '0,0' } }, { locationId: 'well', anchor: { cell: '2,1' } }] });
  const l = linkSubMapLocations(placed, 'city_map');
  assert.equal(l.added, 3); // city→inn, inn→city, well→city
  assert.ok(l.content.actions.every(a => a.effects[0].kind === 'move'));
  assert.equal(l.content.locations.find(x => x.id === 'inn')!.parentLocationId, 'city');
  assert.equal(linkSubMapLocations(l.content, 'city_map').added, 0, 'idempotent');
  const nested = createSubMap(l.content, 'city_map', 'inn');
  const removed = withMapById(nested.content, 'city_map', undefined);
  assert.equal(removed.subMaps, undefined, 'descendants dropped with parent');
});
