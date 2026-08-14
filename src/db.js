const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
for (const d of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'novel.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',          -- user | admin
  twofa_secret  TEXT,
  twofa_enabled INTEGER NOT NULL DEFAULT 0,
  recovery_codes TEXT DEFAULT '[]',                     -- JSON array of hashed codes
  status        TEXT NOT NULL DEFAULT 'active',         -- active | disabled
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS novels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  author      TEXT DEFAULT '',
  description TEXT DEFAULT '',
  tags        TEXT DEFAULT '[]',                        -- JSON array
  cover_path  TEXT,
  status      TEXT NOT NULL DEFAULT 'published',        -- draft | published
  words_count INTEGER NOT NULL DEFAULT 0,
  chapter_count INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chapters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id    INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  idx         INTEGER NOT NULL,                         -- 章节顺序
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  words_count INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chapters_novel ON chapters(novel_id, idx);

CREATE TABLE IF NOT EXISTS reading_progress (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  novel_id   INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  chapter_id INTEGER,
  progress   REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, novel_id)
);

CREATE TABLE IF NOT EXISTS bookshelf (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  novel_id  INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  added_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, novel_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  username   TEXT,
  action     TEXT NOT NULL,
  detail     TEXT DEFAULT '',
  ip         TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  sid    TEXT PRIMARY KEY,
  sess   TEXT NOT NULL,
  expire INTEGER NOT NULL
);
`);

// ---- settings helpers ----
function getSetting(key, def) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : def;
}
function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

// ---- audit ----
function audit(user, action, detail = '', ip = '') {
  try {
    db.prepare(
      'INSERT INTO audit_logs (user_id, username, action, detail, ip) VALUES (?, ?, ?, ?, ?)'
    ).run(user ? user.id : null, user ? user.username : null, action, String(detail).slice(0, 2000), ip || '');
  } catch (e) { /* audit must never crash */ }
}

module.exports = { db, DATA_DIR, UPLOAD_DIR, BACKUP_DIR, getSetting, setSetting, audit };
