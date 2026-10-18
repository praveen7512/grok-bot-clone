import type { DB } from '../db.js';
import type { ContentBlock, StoredMessage } from '../types.js';

interface Row { id: number; bot_id: string; role: 'user' | 'assistant'; content_json: string; summarized: number; created_at: number }

const toMsg = (r: Row): StoredMessage => ({
  id: r.id, botId: r.bot_id, role: r.role, content: JSON.parse(r.content_json) as ContentBlock[],
  summarized: !!r.summarized, createdAt: r.created_at,
});

/** Context store. Every method requires a botId: there is no cross-bot query. */
export class MessageRepository {
  constructor(private db: DB) {}

  append(botId: string, role: 'user' | 'assistant', content: ContentBlock[]): StoredMessage {
    const info = this.db
      .prepare('INSERT INTO messages (bot_id, role, content_json, created_at) VALUES (?,?,?,?)')
      .run(botId, role, JSON.stringify(content), Date.now());
    return this.byId(botId, Number(info.lastInsertRowid))!;
  }

  byId(botId: string, id: number): StoredMessage | undefined {
    const r = this.db.prepare('SELECT * FROM messages WHERE bot_id = ? AND id = ?').get(botId, id) as Row | undefined;
    return r && toMsg(r);
  }

  listAll(botId: string, limit = 500): StoredMessage[] {
    return (this.db
      .prepare('SELECT * FROM (SELECT * FROM messages WHERE bot_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC')
      .all(botId, limit) as Row[]).map(toMsg);
  }

  listActive(botId: string): StoredMessage[] {
    return (this.db
      .prepare('SELECT * FROM messages WHERE bot_id = ? AND summarized = 0 ORDER BY id ASC')
      .all(botId) as Row[]).map(toMsg);
  }

  markSummarized(botId: string, uptoIdInclusive: number) {
    this.db.prepare('UPDATE messages SET summarized = 1 WHERE bot_id = ? AND id <= ?').run(botId, uptoIdInclusive);
  }

  getSummary(botId: string): string | null {
    const r = this.db.prepare('SELECT summary FROM summaries WHERE bot_id = ?').get(botId) as { summary: string } | undefined;
    return r?.summary ?? null;
  }

  setSummary(botId: string, summary: string) {
    this.db
      .prepare(`INSERT INTO summaries (bot_id, summary, updated_at) VALUES (?,?,?)
                ON CONFLICT(bot_id) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at`)
      .run(botId, summary, Date.now());
  }

  clear(botId: string) {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE bot_id = ?').run(botId);
      this.db.prepare('DELETE FROM summaries WHERE bot_id = ?').run(botId);
    })();
  }
}
