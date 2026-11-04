-- Contract: SQLite migration for feature 003 (schema_version 1 -> 2). Base schema:
-- specs/002-multiplayer-core/contracts/persistence.sql. Runs in one transaction at boot when meta.schema_version = '1'.
-- Machine poses, operators and held loads (hook, pallet) are NOT persisted (FR-034): after a restart every
-- machine is parked and empty, and held pieces are not restored (like 002 loose pieces).

BEGIN;

ALTER TABLE building ADD COLUMN ground_dug    INTEGER NOT NULL DEFAULT 0 CHECK (ground_dug BETWEEN 0 AND 6);
ALTER TABLE building ADD COLUMN ground_poured INTEGER NOT NULL DEFAULT 0 CHECK (ground_poured BETWEEN 0 AND 4);
ALTER TABLE building ADD COLUMN high_filled   INTEGER NOT NULL DEFAULT 0 CHECK (high_filled >= 0);
ALTER TABLE building ADD COLUMN mixer_bags    INTEGER NOT NULL DEFAULT 0 CHECK (mixer_bags BETWEEN 0 AND 4);

-- Buildings already in progress when 003 goes live count as having finished Groundwork (spec Assumptions).
UPDATE building SET ground_dug = 6, ground_poured = 4;

-- bin_entry.piece_type gains 'cement' (concrete buckets cannot be binned). SQLite cannot alter a CHECK,
-- so the table is rebuilt.
CREATE TABLE bin_entry_v2 (
  world_id        INTEGER NOT NULL,
  plot_index      INTEGER NOT NULL,
  slot            INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 9),
  piece_type      TEXT    NOT NULL CHECK (piece_type IN ('beam', 'brick', 'panel', 'paint', 'decor', 'bell', 'cement')),
  donor_key_hash  TEXT    NOT NULL,
  epoch           INTEGER NOT NULL,
  PRIMARY KEY (world_id, plot_index, slot),
  FOREIGN KEY (world_id, plot_index) REFERENCES building(world_id, plot_index) ON DELETE CASCADE
);
INSERT INTO bin_entry_v2 SELECT * FROM bin_entry;
DROP TABLE bin_entry;
ALTER TABLE bin_entry_v2 RENAME TO bin_entry;

UPDATE meta SET value = '2' WHERE key = 'schema_version';

COMMIT;

-- Write rules (same per-tick transaction as 002 building writes):
--   dig/pour      -> UPDATE building SET ground_dug/ground_poured
--   deliver       -> UPDATE building SET completed_stages, filled_slots, high_filled
--   mixer change  -> UPDATE building SET mixer_bags   (bag added, mix started -> 0)
-- A new building (Foreman start / adoption of an empty plot) inserts with all four columns = 0.
-- Shift reset deletes buildings as in 002, so Groundwork and mixer bags reset with them.
