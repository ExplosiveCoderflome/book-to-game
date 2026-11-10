import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { worldContentSchema, type WorldContent, type WorldDraft, type WorldRevision } from '@novel-game/contracts';
import { SqliteDatabase } from '../../src/platform/database.js';
import { WorldService, SqliteWorldRepository } from '../../src/modules/worlds/index.js';
import { AdventureService, SqliteAdventureRepository, type AdventureCatalogReaders } from '../../src/modules/adventure-sessions/index.js';
import { source } from './open-fixture.js';

/**
 * Runtime tests consume an already-authored revision, not the publishing workflow.
 * Keep schema, draft/version identity and real SQLite immutability constraints;
 * do not manufacture quality reports or claim these fixtures passed publish gates.
 * Runtime edge cases (e.g. a stranded player) need not meet authoring density gates.
 */
export function seedWorldRevision(db: SqliteDatabase, draft: WorldDraft): WorldRevision {
  const content = worldContentSchema.parse(structuredClone(draft.content));
  const repository = new SqliteWorldRepository(db);
  assert.deepEqual(repository.getDraft(draft.id), draft, 'revision fixture must match its persisted draft');
  assert.equal(repository.findRevision(draft.id, draft.version), undefined, 'seed a fresh immutable revision');
  const revision = repository.publish({
    id: randomUUID(), draftId: draft.id, sourceId: draft.sourceId,
    version: draft.version, content, createdAt: draft.updatedAt,
  });
  const persisted = repository.getRevision(revision.id);
  assert.deepEqual(persisted, revision, 'runtime fixture must round-trip through SQLite');
  assert.ok(persisted);
  return persisted;
}

/** Dedicated runtime setup; leave the shared map-fixture publishing setup intact. */
export function startRuntimeWorld(world: WorldContent, catalogs: AdventureCatalogReaders = {}) {
  const db = new SqliteDatabase(':memory:');
  try {
    const worlds = new WorldService(new SqliteWorldRepository(db), {get: () => structuredClone(source)});
    const adventures = new AdventureService(new SqliteAdventureRepository(db), worlds, catalogs);
    const draft = worlds.create({sourceId: source.id, content: world});
    const revision = seedWorldRevision(db, draft);
    return {db, worlds, adventures, revision, view: adventures.start({worldRevisionId: revision.id})};
  } catch (error) {
    db.close();
    throw error;
  }
}
