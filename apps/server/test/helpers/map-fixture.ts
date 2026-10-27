import { SqliteDatabase as Database } from '../../src/platform/database.js';
import { WorldService, SqliteWorldRepository } from '../../src/modules/worlds/index.js';
import { AdventureService, SqliteAdventureRepository } from '../../src/modules/adventure-sessions/index.js';
import { source } from './open-fixture.js';
import type { WorldContent, WorldMap } from '@novel-game/contracts';

export const playMap = (fog = true): WorldMap => ({
  mapSchemaVersion: 1, fog,
  geometry: { kind: 'hex', orientation: 'pointy', cols: 8, rows: 6, size: 28 },
  layers: {
    terrain: { palette: [{ id: 'coast', label: '海岸', color: '#88aacc' }, { id: 'plain', label: '平原', color: '#aacc88' }], cells: { '1,1': 'coast', '4,2': 'plain' } },
    factions: { factions: [{ id: 'crown', name: '王冠', color: '#3355aa' }, { id: 'pact', name: '盟约', color: '#33aa55' }], cells: { '1,1': 'crown', '4,2': 'pact' } },
    regions: { regions: [{ id: 'west', name: '西岸', color: '#224466' }], cells: { '1,1': 'west' } },
  },
  pois: [{ locationId: 'dock', anchor: { cell: '1,1' } }, { locationId: 'market', anchor: { cell: '4,2' } }, { locationId: 'gate', anchor: { cell: '2,4' } }],
});
export function startWith(world: WorldContent) {
  const db = new Database(':memory:');
  const worlds = new WorldService(new SqliteWorldRepository(db), { get: () => structuredClone(source) });
  const adventures = new AdventureService(new SqliteAdventureRepository(db), worlds);
  const draft = worlds.create({ sourceId: source.id, content: world });
  const revision = worlds.publish(draft.id, { version: 1 });
  return { db, worlds, adventures, revision, view: adventures.start({ worldRevisionId: revision.id }) };
}
