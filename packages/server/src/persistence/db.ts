import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';

export const SCHEMA_VERSION = 1;

export interface Db {
  readonly sql: DatabaseSync;
  /** Runs `fn` in one synchronous transaction (rolls back on throw). */
  tx<T>(fn: () => T): T;
  /** Accumulated SQLite time since the last call (ms), for metrics. */
  takeTimeMs(): number;
  close(): void;
}

/** Opens (or creates) the database and applies migration v1 (contracts/persistence.sql). */
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const sql = new DatabaseSync(path);
  sql.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  sql.exec(readFileSync(resolve(import.meta.dirname, 'schema.sql'), 'utf8'));
  const row = sql.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
  if (!row) sql.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
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
