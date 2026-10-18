import type { DB } from '../db.js';
import type { Memory } from '../types.js';

interface Row { key: string; value: string; created_at: number; updated_at: number }
const toMem = (r: Row): Memory => ({ key: r.key, value: r.value, createdAt: r.created_at, updatedAt: r.updated_at });

/** Memory store, namespaced by bot_id. */
export class MemoryRepository {
  constructor(private db: DB) {}

  upsert(botId: string, key: string, value: string): Memory {
    const now = Date.now();
    this.db
      .prepare(`INSERT INTO memories (bot_id, key, value, created_at, updated_at) VALUES (?,?,?,?,?)
                ON CONFLICT(bot_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(botId, key, value, now, now);
    return this.get(botId, key)!;
  }

  get(botId: string, key: string): Memory | undefined {
    const r = this.db.prepare('SELECT key,value,created_at,updated_at FROM memories WHERE bot_id = ? AND key = ?').get(botId, key) as Row | undefined;
    return r && toMem(r);
  }

  list(botId: string, limit = 1000): Memory[] {
    return (this.db
      .prepare('SELECT key,value,created_at,updated_at FROM memories WHERE bot_id = ? ORDER BY updated_at DESC LIMIT ?')
      .all(botId, limit) as Row[]).map(toMem);
  }

  search(botId: string, query: string, limit = 50): Memory[] {
    const q = `%${query.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    return (this.db
      .prepare(`SELECT key,value,created_at,updated_at FROM memories
                WHERE bot_id = ? AND (key LIKE ? ESCAPE '\\' OR value LIKE ? ESCAPE '\\')
                ORDER BY updated_at DESC LIMIT ?`)
      .all(botId, q, q, limit) as Row[]).map(toMem);
  }

  delete(botId: string, key: string): boolean {
    return this.db.prepare('DELETE FROM memories WHERE bot_id = ? AND key = ?').run(botId, key).changes > 0;
  }
}
