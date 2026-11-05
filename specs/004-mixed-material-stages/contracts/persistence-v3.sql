-- Hard Hat Town persistence: schema v2 -> v3 (feature 004, mixed-material stages)
-- Runs in one transaction at server start when meta.schema_version = 2 (db.ts).
-- SQLite >= 3.25 (RENAME COLUMN also rewrites the column's CHECK constraint).

BEGIN;

-- per-material progress of the current stage: filled_a = recipe item 0, filled_b = recipe item 1
ALTER TABLE building RENAME COLUMN filled_slots TO filled_a;
ALTER TABLE building ADD COLUMN filled_b INTEGER NOT NULL DEFAULT 0 CHECK (filled_b >= 0);

-- FR-004: every building stored before 004 keeps the old one-material recipe until it finishes or
-- the shift resets. The legacy blueprint uses one recipe item per stage, so filled_a keeps its old
-- meaning (the old filled_slots) and filled_b stays 0.
UPDATE building SET blueprint_id = 'clock-tower-v1';

UPDATE meta SET value = '3' WHERE key = 'schema_version';

COMMIT;

-- Resulting building progress columns (v3):
--   blueprint_id      TEXT     'clock-tower' (new) | 'clock-tower-v1' (legacy)
--   completed_stages  INTEGER  0..6
--   filled_a          INTEGER  >= 0   filled slots of recipe item 0 (incl. high)
--   filled_b          INTEGER  >= 0   filled slots of recipe item 1 (0 if the stage has one item)
--   high_filled       INTEGER  >= 0   high slots filled (003)
--   ground_dug, ground_poured, mixer_bags   unchanged (003)
