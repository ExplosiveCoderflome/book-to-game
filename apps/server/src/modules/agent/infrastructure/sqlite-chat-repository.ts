import type { AgentChatConversation } from '@novel-game/contracts';
import type { ChatRepository } from '../application/chat-ports.js';
import type { SqliteDatabase } from '../../../platform/database.js';
import { AppError } from '../../../shared/errors.js';

export class SqliteChatRepository implements ChatRepository {
  constructor(private readonly db: SqliteDatabase) {
    db.exec('CREATE TABLE IF NOT EXISTS agent_chats (id TEXT PRIMARY KEY, version INTEGER NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL)');
  }
  insert(c: AgentChatConversation) {
    this.db.prepare('INSERT INTO agent_chats(id,version,updated_at,payload) VALUES(?,?,?,?)').run(c.id, c.version, c.updatedAt, JSON.stringify(c));
  }
  get(id: string): AgentChatConversation | undefined {
    const row = this.db.prepare('SELECT payload FROM agent_chats WHERE id=?').get(id) as {payload: string} | undefined;
    return row ? JSON.parse(row.payload) as AgentChatConversation : undefined;
  }
  list(): AgentChatConversation[] {
    return (this.db.prepare('SELECT payload FROM agent_chats ORDER BY updated_at DESC LIMIT 50').all() as {payload: string}[]).map(r => JSON.parse(r.payload) as AgentChatConversation);
  }
  save(c: AgentChatConversation, expectedVersion: number): AgentChatConversation {
    const next = {...c, version: expectedVersion + 1, updatedAt: new Date().toISOString()};
    const changed = this.db.prepare('UPDATE agent_chats SET version=?,updated_at=?,payload=? WHERE id=? AND version=?')
      .run(next.version, next.updatedAt, JSON.stringify(next), c.id, expectedVersion);
    if (changed.changes !== 1) throw new AppError('CHAT_BUSY', '会话状态已更新，请重新读取；不要重复提交操作', 409);
    return next;
  }
}
