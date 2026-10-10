import type { SqliteDatabase } from '../../../platform/database.js';
import type { AdventureActInput, AdventureView } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { AdventureRepository } from '../application/ports.js';
import type { AdventureState } from '../domain/adventure-state.js';
export class SqliteAdventureRepository implements AdventureRepository {
  constructor(private readonly db: SqliteDatabase) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS adventure_sessions (
        id TEXT PRIMARY KEY, world_revision_id TEXT NOT NULL REFERENCES world_revisions(id),
        turn INTEGER NOT NULL CHECK(turn >= 0), data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS adventure_events (
        session_id TEXT NOT NULL REFERENCES adventure_sessions(id), request_id TEXT NOT NULL, turn INTEGER NOT NULL,
        input TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(session_id, request_id), UNIQUE(session_id, turn)
      );
    `);
  }
  insert(state: AdventureState): void {
    this.db.prepare('INSERT INTO adventure_sessions(id,world_revision_id,turn,data,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(state.id, state.worldRevisionId, state.turn, JSON.stringify(state), state.createdAt, state.updatedAt);
  }
  get(id: string): AdventureState | undefined {
    return parse(this.db.prepare('SELECT data FROM adventure_sessions WHERE id=?').get(id));
  }
  list(): AdventureState[] {return this.db.prepare('SELECT data FROM adventure_sessions ORDER BY updated_at DESC, id').all().map(row => parse(row)!);}
  act(id: string, input: AdventureActInput, transition: (state: AdventureState) => {state: AdventureState; response: AdventureView}): AdventureView {
    // Reserve the SQLite writer before checking requests/turns, including across connections.
    return this.db.transaction(() => {
      const canonical = JSON.stringify({actionId: input.actionId, expectedTurn: input.expectedTurn});
      const replay = this.db.prepare('SELECT input,response FROM adventure_events WHERE session_id=? AND request_id=?')
        .get(id, input.requestId) as {input: string; response: string} | undefined;
      if (replay) {
        if (replay.input !== canonical) throw new AppError('REQUEST_ID_CONFLICT', '同一请求 ID 不能用于不同的行动', 409);
        return JSON.parse(replay.response) as AdventureView;
      }
      const current = this.get(id); if (!current) throw new AppError('SESSION_NOT_FOUND', '冒险存档不存在', 404);
      const {state, response} = transition(current);
      this.db.prepare('INSERT INTO adventure_events(session_id,request_id,turn,input,response,created_at) VALUES(?,?,?,?,?,?)')
        .run(id, input.requestId, state.turn, canonical, JSON.stringify(response), state.updatedAt);
      const saved = this.db.prepare('UPDATE adventure_sessions SET turn=?,data=?,updated_at=? WHERE id=? AND turn=?')
        .run(state.turn, JSON.stringify(state), state.updatedAt, id, input.expectedTurn);
      if (!saved.changes) throw new AppError('SESSION_TURN_CONFLICT', '存档已推进，请刷新后再行动', 409);
      return response;
    }).immediate();
  }
}
function parse(row: unknown): AdventureState | undefined {
  if (!row) return undefined;
  const state = JSON.parse((row as {data: string}).data) as AdventureState;
  if (state.schemaVersion !== 1) throw new AppError('UNSUPPORTED_ADVENTURE_STATE', '不支持的冒险存档版本', 500);
  return state;
}
