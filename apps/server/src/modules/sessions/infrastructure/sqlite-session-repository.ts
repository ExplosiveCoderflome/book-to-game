import type { SqliteDatabase } from '../../../platform/database.js';
import type { ActInput, SessionView } from '@novel-game/contracts';
import { AppError } from '../../../shared/errors.js';
import type { SessionRepository } from '../application/ports.js';
import type { SessionState } from '../domain/session-state.js';

export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly db: SqliteDatabase) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, game_revision_id TEXT NOT NULL REFERENCES game_revisions(id),
        turn INTEGER NOT NULL CHECK(turn >= 0), data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_events (
        session_id TEXT NOT NULL REFERENCES sessions(id), request_id TEXT NOT NULL, turn INTEGER NOT NULL,
        input TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(session_id, request_id), UNIQUE(session_id, turn)
      );
    `);
  }
  insert(state: SessionState): void {
    this.db.prepare('INSERT INTO sessions(id,game_revision_id,turn,data,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(state.id, state.gameRevisionId, state.turn, JSON.stringify(state), state.createdAt, state.updatedAt);
  }
  get(id: string): SessionState | undefined {
    const row = this.db.prepare('SELECT data FROM sessions WHERE id=?').get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as SessionState : undefined;
  }
  list(): SessionState[] {
    return (this.db.prepare('SELECT data FROM sessions ORDER BY updated_at DESC, id').all() as { data: string }[])
      .map(row => JSON.parse(row.data) as SessionState);
  }
  act(id: string, input: ActInput, transition: (current: SessionState) => { state: SessionState; response: SessionView }): SessionView {
    // Acquire the write reservation before reading the turn or replay record.
    return this.db.transaction(() => {
      const canonical = JSON.stringify({ choiceId: input.choiceId, expectedTurn: input.expectedTurn });
      const replay = this.db.prepare('SELECT input,response FROM session_events WHERE session_id=? AND request_id=?')
        .get(id, input.requestId) as { input: string; response: string } | undefined;
      if (replay) {
        if (replay.input !== canonical) throw new AppError('REQUEST_ID_CONFLICT', '同一请求 ID 不能用于不同的行动', 409);
        return JSON.parse(replay.response) as SessionView;
      }
      const current = this.get(id);
      if (!current) throw new AppError('SESSION_NOT_FOUND', '存档不存在', 404);
      const { state, response } = transition(current);
      this.db.prepare('INSERT INTO session_events(session_id,request_id,turn,input,response,created_at) VALUES(?,?,?,?,?,?)')
        .run(id, input.requestId, state.turn, canonical, JSON.stringify(response), state.updatedAt);
      const saved = this.db.prepare('UPDATE sessions SET turn=?,data=?,updated_at=? WHERE id=? AND turn=?')
        .run(state.turn, JSON.stringify(state), state.updatedAt, id, input.expectedTurn);
      if (!saved.changes) throw new AppError('SESSION_TURN_CONFLICT', '存档已推进，请刷新后再行动', 409);
      return response;
    }).immediate();
  }
}
