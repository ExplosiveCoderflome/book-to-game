import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { content } from './helpers/open-fixture.js';
import type { WorldContent } from '@novel-game/contracts';
import { eraMap, strongholds, validateWorldLayer } from '@novel-game/rules';
import { playMap, startWith } from './helpers/map-fixture.js';

function world(fog = false): WorldContent {
  const w = content(); w.map = playMap(fog);
  w.map.layers = { ...w.map.layers, factions: { factions: [{ id: 'guild', name: '商会', color: '#aa3300' }, { id: 'navy', name: '水师', color: '#0033aa' }], cells: { '0,0': 'guild' } } };
  w.map.pois = w.map.pois.map(p => p.locationId === 'market' ? { ...p, feature: 'stronghold' as const, factionId: 'guild' } : p);
  w.npcs = w.npcs.map((n, i) => i === 0 ? { ...n, factionId: 'guild', homeLocationId: 'market', tags: ['商人'], bio: '老掌柜' } : n);
  w.eras = [{ id: 'old', name: '旧朝', territory: { root: { '0,0': 'navy', '1,0': 'navy' } } }];
  return w;
}

test('world layer validation: clean ok; bad faction/home/era flagged', () => {
  assert.deepEqual(validateWorldLayer(world()).filter(i => i.level === 'error'), []);
  const w = world(); w.npcs[0].factionId = 'ghost'; w.npcs[0].homeLocationId = 'nowhere';
  w.eras = [{ id: 'x', name: 'x', territory: { nomap: {} } }, { id: 'y', name: 'y', territory: { root: { '0,0': 'ghost' } } }];
  const codes = validateWorldLayer(w).map(i => i.code).sort();
  assert.deepEqual(codes, ['era_faction', 'era_map', 'npc_faction', 'npc_home']);
  assert.equal(strongholds(world()).length, 1);
});

test('era snapshot replaces faction cells for preview, authored map untouched', () => {
  const w = world(); const m = eraMap(w, w.map!, 'old');
  assert.deepEqual(m.layers.factions!.cells, { '0,0': 'navy', '1,0': 'navy' });
  assert.deepEqual(w.map!.layers.factions!.cells, { '0,0': 'guild' });
  assert.equal(eraMap(w, w.map!, undefined), w.map);
});

test('play view carries NPCs on the current map, with faction, and npc_at_location gates actions', () => {
  const w = world(); const npc = w.npcs[0];
  w.actions.push({ id: 'meet', label: '会面', description: '', locationId: w.initialLocationId, availableWhen: [{ kind: 'npc_at_location', npcId: npc.id, locationId: npc.initialLocationId }], requires: [], blockedReason: 'x', risk: '', timeCost: 1, once: false, effects: [{ kind: 'move', locationId: w.initialLocationId }], text: '见面', origin: 'adapted', evidence: [] });
  const { db, view } = startWith(w);
  try {
    const on = view.map?.npcs?.find(n => n.id === npc.id);
    assert.ok(w.map!.pois.some(p => p.locationId === npc.initialLocationId), 'fixture npc is placed'); assert.equal(on?.factionId, 'guild');
    assert.ok(view.actions.some(a => a.id === 'meet'));
  } finally { db.close(); }
});
