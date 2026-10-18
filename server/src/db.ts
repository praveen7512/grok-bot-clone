import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE bots (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    persona       TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'provisioning', -- provisioning | ready | stopped | error
    sandbox_kind  TEXT,                                  -- docker | subprocess
    sandbox_ref   TEXT,                                  -- container id or dir
    voice_enabled INTEGER NOT NULL DEFAULT 0,
    voice_name    TEXT,
    voice_rate    REAL NOT NULL DEFAULT 1.0,
    last_active_at INTEGER,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );
  CREATE TABLE messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id       TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    role         TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content_json TEXT NOT NULL,
    summarized   INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX idx_messages_bot ON messages(bot_id, id);
  CREATE TABLE summaries (
    bot_id     TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
    summary    TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE memories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id     TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (bot_id, key)
  );
  CREATE INDEX idx_memories_bot ON memories(bot_id);
  `,
];

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db: DB) {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
