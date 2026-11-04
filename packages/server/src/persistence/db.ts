import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';

export const SCHEMA_VERSION = 2;

export interface Db {
  readonly sql: DatabaseSync;
  /** Runs `fn` in one synchronous transaction (rolls back on throw). */
  tx<T>(fn: () => T): T;
  /** Accumulated SQLite time since the last call (ms), for metrics. */
  takeTimeMs(): number;
  close(): void;
}

/**
 * v1 → v2 (feature 003, specs/003-construction-machines/contracts/persistence-v2.sql): Groundwork
 * columns; buildings already in progress count as dug and poured; bins may hold cement bags.
 */
function migrateV1toV2(sql: DatabaseSync): void {
  sql.exec('BEGIN');
  try {
    sql.exec(`
      ALTER TABLE building ADD COLUMN ground_dug    INTEGER NOT NULL DEFAULT 0 CHECK (ground_dug BETWEEN 0 AND 6);
      ALTER TABLE building ADD COLUMN ground_poured INTEGER NOT NULL DEFAULT 0 CHECK (ground_poured BETWEEN 0 AND 4);
      ALTER TABLE building ADD COLUMN high_filled   INTEGER NOT NULL DEFAULT 0 CHECK (high_filled >= 0);
      ALTER TABLE building ADD COLUMN mixer_bags    INTEGER NOT NULL DEFAULT 0 CHECK (mixer_bags BETWEEN 0 AND 4);
      UPDATE building SET ground_dug = 6, ground_poured = 4;
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
    `);
    sql.exec('COMMIT');
  } catch (e) {
    sql.exec('ROLLBACK');
    throw e;
  }
}

/** Opens (or creates) the database and applies the schema (contracts/persistence.sql), migrating v1 → v2. */
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const sql = new DatabaseSync(path);
  sql.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  sql.exec(readFileSync(resolve(import.meta.dirname, 'schema.sql'), 'utf8'));
  const row = sql.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
  if (!row) sql.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
  else if (Number(row.value) === 1) migrateV1toV2(sql);
  else if (Number(row.value) !== SCHEMA_VERSION) throw new Error(`database schema_version ${row.value} != ${SCHEMA_VERSION}`);
  let spent = 0;
  let depth = 0;
  return {
    sql,
    tx<T>(fn: () => T): T {
      const t0 = performance.now();
      if (depth > 0) return fn();
      depth++;
      sql.exec('BEGIN');
      try {
        const r = fn();
        sql.exec('COMMIT');
        return r;
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
        spent += performance.now() - t0;
      }
    },
    takeTimeMs() {
      const s = spent;
      spent = 0;
      return s;
    },
    close() {
      if (sql.isOpen) sql.close();
    },
  };
}
