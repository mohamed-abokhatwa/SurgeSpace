-- SurgeSpace licence server (Cloudflare D1). Separate from the Engineering Workspace database.
CREATE TABLE IF NOT EXISTS licences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,            -- SSL-XXXX-XXXX-XXXX, given to the customer
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL CHECK (plan IN ('personal', 'company')),
  seats INTEGER NOT NULL DEFAULT 1,
  paid_until TEXT,                      -- YYYY-MM-DD; NULL = perpetual
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS machines (
  licence_id INTEGER NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  machine TEXT NOT NULL,                -- SS-XXXX-XXXX-XXXX-XXXX
  hostname TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  first_seen TEXT NOT NULL,
  last_checkin TEXT NOT NULL,
  PRIMARY KEY (licence_id, machine)
);
CREATE INDEX IF NOT EXISTS machines_machine ON machines (machine);
CREATE TABLE IF NOT EXISTS trials (
  hash TEXT PRIMARY KEY,                -- one-way code of the computer, never its Machine ID or name
  platform TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  first_seen TEXT NOT NULL,
  ends TEXT NOT NULL,
  extra_days INTEGER NOT NULL DEFAULT 0,
  auto_extended INTEGER NOT NULL DEFAULT 0,
  asked_at TEXT NOT NULL DEFAULT '',
  asked_note TEXT NOT NULL DEFAULT '',
  asked_reply_to TEXT NOT NULL DEFAULT '',
  last_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, company TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', machine TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '', mail TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
  reply_to TEXT NOT NULL DEFAULT '', build TEXT NOT NULL DEFAULT '', place TEXT NOT NULL DEFAULT ''
);
