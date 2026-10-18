import type { DB } from '../db.js';
import type { Bot, BotStatus, SandboxKind } from '../types.js';

interface Row {
  id: string; name: string; persona: string; status: BotStatus;
  sandbox_kind: SandboxKind | null; sandbox_ref: string | null;
  voice_enabled: number; voice_name: string | null; voice_rate: number;
  last_active_at: number | null; created_at: number; updated_at: number;
}

const toBot = (r: Row): Bot => ({
  id: r.id, name: r.name, persona: r.persona, status: r.status,
  sandboxKind: r.sandbox_kind, sandboxRef: r.sandbox_ref,
  voice: { enabled: !!r.voice_enabled, name: r.voice_name, rate: r.voice_rate },
  lastActiveAt: r.last_active_at, createdAt: r.created_at, updatedAt: r.updated_at,
});

export class BotRepository {
  constructor(private db: DB) {}

  insert(b: { id: string; name: string; persona: string; voice: Bot['voice'] }): Bot {
    const now = Date.now();
    this.db
      .prepare(`INSERT INTO bots (id,name,persona,status,voice_enabled,voice_name,voice_rate,created_at,updated_at)
                VALUES (?,?,?,'provisioning',?,?,?,?,?)`)
      .run(b.id, b.name, b.persona, b.voice.enabled ? 1 : 0, b.voice.name, b.voice.rate, now, now);
    return this.get(b.id)!;
  }

  get(id: string): Bot | undefined {
    const r = this.db.prepare('SELECT * FROM bots WHERE id = ?').get(id) as Row | undefined;
    return r && toBot(r);
  }

  list(): Bot[] {
    return (this.db.prepare('SELECT * FROM bots ORDER BY created_at ASC').all() as Row[]).map(toBot);
  }

  update(id: string, patch: Partial<{ name: string; persona: string; status: BotStatus; sandboxKind: SandboxKind | null; sandboxRef: string | null; voice: Bot['voice'] }>): Bot | undefined {
    const sets: string[] = [];
    const vals: unknown[] = [];
    const put = (col: string, v: unknown) => { sets.push(`${col} = ?`); vals.push(v); };
    if (patch.name !== undefined) put('name', patch.name);
    if (patch.persona !== undefined) put('persona', patch.persona);
    if (patch.status !== undefined) put('status', patch.status);
    if (patch.sandboxKind !== undefined) put('sandbox_kind', patch.sandboxKind);
    if (patch.sandboxRef !== undefined) put('sandbox_ref', patch.sandboxRef);
    if (patch.voice !== undefined) {
      put('voice_enabled', patch.voice.enabled ? 1 : 0);
      put('voice_name', patch.voice.name);
      put('voice_rate', patch.voice.rate);
    }
    if (sets.length) {
      put('updated_at', Date.now());
      this.db.prepare(`UPDATE bots SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    }
    return this.get(id);
  }

  touch(id: string) {
    this.db.prepare('UPDATE bots SET last_active_at = ? WHERE id = ?').run(Date.now(), id);
  }

  /** Cascades to messages, summaries and memories. */
  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM bots WHERE id = ?').run(id).changes > 0;
  }
}
