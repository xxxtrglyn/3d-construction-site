-- Test fixture: the SQLite schema exactly as feature 003 left it (schema_version 2), used to test the
-- v2 -> v3 migration of feature 004 (specs/004-mixed-material-stages/contracts/persistence-v3.sql).
-- Copied from packages/server/src/persistence/schema.sql at schema_version 2; do not edit.

-- Contract: SQLite schema for world persistence (feature 002, schema_version 1; feature 003, schema_version 2:
-- specs/003-construction-machines/contracts/persistence-v2.sql — v1 databases are migrated in db.ts)
-- Engine: node:sqlite (DatabaseSync). PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;
-- Every mutation of a building/crew/bin runs in one transaction in the same server tick (research R6).
-- Rows whose epoch != world.epoch are stale (from an earlier shift) and are deleted at boot.
-- No raw player keys are stored; key_hash = hex(SHA-256(playerKey)). All crew rows are deleted at shift reset.

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- INSERT INTO meta(key, value) VALUES ('schema_version', '2');

CREATE TABLE IF NOT EXISTS world (
  world_id          INTEGER PRIMARY KEY,           -- 1, 2, ...
  epoch             INTEGER NOT NULL,              -- shift counter
  shift_started_at  INTEGER NOT NULL,              -- epoch ms
  shift_length_ms   INTEGER NOT NULL,
  towers_completed  INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS building (
  world_id          INTEGER NOT NULL REFERENCES world(world_id) ON DELETE CASCADE,
  plot_index        INTEGER NOT NULL CHECK (plot_index BETWEEN 0 AND 11),
  epoch             INTEGER NOT NULL,
  state             TEXT    NOT NULL CHECK (state IN ('building', 'unattended', 'finished')),  -- 'free' = no row
  blueprint_id      TEXT    NOT NULL,
  completed_stages  INTEGER NOT NULL CHECK (completed_stages BETWEEN 0 AND 6),
  filled_slots      INTEGER NOT NULL CHECK (filled_slots >= 0),
  host_key_hash     TEXT,                          -- NULL when unattended/finished
  host_name         TEXT    NOT NULL,              -- shown on the sign ("Built by ...")
  join_mode         TEXT    NOT NULL CHECK (join_mode IN ('ask', 'open', 'solo')),
  empty_since       INTEGER,                       -- epoch ms or NULL
  finished_at       INTEGER,                       -- epoch ms or NULL
  updated_at        INTEGER NOT NULL,
  -- feature 003 (v2): Groundwork, high slots of the current stage, cement bags in the mixer
  ground_dug        INTEGER NOT NULL DEFAULT 0 CHECK (ground_dug BETWEEN 0 AND 6),
  ground_poured     INTEGER NOT NULL DEFAULT 0 CHECK (ground_poured BETWEEN 0 AND 4),
  high_filled       INTEGER NOT NULL DEFAULT 0 CHECK (high_filled >= 0),
  mixer_bags        INTEGER NOT NULL DEFAULT 0 CHECK (mixer_bags BETWEEN 0 AND 4),
  PRIMARY KEY (world_id, plot_index)
);

CREATE TABLE IF NOT EXISTS crew_member (
  world_id    INTEGER NOT NULL,
  plot_index  INTEGER NOT NULL,
  key_hash    TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  hat_color   TEXT    NOT NULL,
  role        TEXT    NOT NULL CHECK (role IN ('host', 'member')),
  joined_at   INTEGER NOT NULL,                    -- handover order (oldest first)
  epoch       INTEGER NOT NULL,
  PRIMARY KEY (world_id, key_hash),                -- one crew per player per world
  FOREIGN KEY (world_id, plot_index) REFERENCES building(world_id, plot_index) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS crew_by_plot ON crew_member(world_id, plot_index);

CREATE TABLE IF NOT EXISTS bin_entry (
  world_id        INTEGER NOT NULL,
  plot_index      INTEGER NOT NULL,
  slot            INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 9),
  piece_type      TEXT    NOT NULL CHECK (piece_type IN ('beam', 'brick', 'panel', 'paint', 'decor', 'bell', 'cement')),
  donor_key_hash  TEXT    NOT NULL,
  epoch           INTEGER NOT NULL,
  PRIMARY KEY (world_id, plot_index, slot),
  FOREIGN KEY (world_id, plot_index) REFERENCES building(world_id, plot_index) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_report (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  world_id            INTEGER NOT NULL,
  epoch               INTEGER NOT NULL,
  reporter_key_hash   TEXT    NOT NULL,
  reported_key_hash   TEXT    NOT NULL,
  reported_name       TEXT    NOT NULL,
  messages_json       TEXT    NOT NULL,            -- up to 5 {text, channel, at}; sanitized, unmasked
  created_at          INTEGER NOT NULL,            -- epoch ms; rows older than 30 days are purged (boot + every 24 h)
  UNIQUE (world_id, epoch, reporter_key_hash, reported_key_hash)   -- one report per target per shift
);
CREATE INDEX IF NOT EXISTS chat_report_by_target ON chat_report(world_id, reported_key_hash, created_at);
CREATE INDEX IF NOT EXISTS chat_report_by_time   ON chat_report(created_at);

CREATE TABLE IF NOT EXISTS chat_pause (
  world_id    INTEGER NOT NULL,
  key_hash    TEXT    NOT NULL,
  epoch       INTEGER NOT NULL,                    -- applies only while epoch = world.epoch
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (world_id, key_hash, epoch)
);
-- chat_report rows are NOT deleted by shift reset or overflow-world disposal (owner review, 30-day retention).

-- Overflow worlds (world_id > 1) are deleted (CASCADE) when disposed after 5 minutes empty.
-- Not persisted by design (003): machine poses, operators and loads on hooks or pallets (FR-034).
-- Not persisted by design: loose/flying/held pieces, worker positions, pending join requests, rate limits,
-- chat messages (except the copies inside chat_report).
