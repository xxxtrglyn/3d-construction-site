import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, openDb } from '../src/persistence/db.ts';

const file = join(tmpdir(), `hht-migrate-${process.pid}-${Date.now()}.sqlite`);
afterEach(() => {
  for (const s of ['', '-wal', '-shm']) rmSync(file + s, { force: true });
});

/** A database exactly as feature 002 left it (schema_version 1), with one building in progress and its bin. */
function makeV1(): void {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(new URL('./fixtures/schema-v1.sql', import.meta.url), 'utf8'));
  db.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', '1')").run();
  db.prepare('INSERT INTO world VALUES (1, 3, 1000, 3600000, 0, 1000)').run();
  db.prepare("INSERT INTO building (world_id, plot_index, epoch, state, blueprint_id, completed_stages, filled_slots, host_key_hash, host_name, join_mode, empty_since, finished_at, updated_at) VALUES (1, 2, 3, 'building', 'clock-tower', 2, 1, 'k', 'Sunny Bolt', 'ask', NULL, NULL, 1000)").run();
  db.prepare("INSERT INTO bin_entry VALUES (1, 2, 0, 'brick', 'd', 3)").run();
  db.prepare("INSERT INTO bin_entry VALUES (1, 2, 1, 'paint', 'd', 3)").run();
  expect(() => db.prepare("INSERT INTO bin_entry VALUES (1, 2, 2, 'cement', 'd', 3)").run()).toThrow(); // v1 has no cement
  db.close();
}

describe('persistence migration v1 → v2', () => {
  it('adds the Groundwork columns, counts buildings in progress as dug and poured, and lets bins hold cement', () => {
    makeV1();
    const db = openDb(file);
    expect(SCHEMA_VERSION).toBe(2);
    expect((db.sql.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string }).value).toBe('2');
    const cols = (db.sql.prepare('PRAGMA table_info(building)').all() as Array<{ name: string }>).map((c) => c.name);
    for (const c of ['ground_dug', 'ground_poured', 'high_filled', 'mixer_bags']) expect(cols).toContain(c);
    const row = db.sql.prepare('SELECT completed_stages, filled_slots, ground_dug, ground_poured, high_filled, mixer_bags FROM building WHERE plot_index = 2').get();
    expect(row).toEqual({ completed_stages: 2, filled_slots: 1, ground_dug: 6, ground_poured: 4, high_filled: 0, mixer_bags: 0 });
    // bin rows survive the table rebuild; cement is accepted, concrete still refused
    expect((db.sql.prepare('SELECT piece_type FROM bin_entry ORDER BY slot').all() as Array<{ piece_type: string }>).map((r) => r.piece_type)).toEqual(['brick', 'paint']);
    db.sql.prepare("INSERT INTO bin_entry VALUES (1, 2, 2, 'cement', 'd', 3)").run();
    expect(() => db.sql.prepare("INSERT INTO bin_entry VALUES (1, 2, 3, 'concrete', 'd', 3)").run()).toThrow();
    // CASCADE still works on the rebuilt table
    db.sql.prepare('DELETE FROM building WHERE plot_index = 2').run();
    expect((db.sql.prepare('SELECT COUNT(*) AS n FROM bin_entry').get() as { n: number }).n).toBe(0);
    db.close();
    // reopening a v2 database is a no-op
    const again = openDb(file);
    expect((again.sql.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string }).value).toBe('2');
    again.close();
  });
  it('a fresh database starts at v2 with new buildings at Groundwork 0', () => {
    const db = openDb(':memory:');
    expect((db.sql.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string }).value).toBe('2');
    db.sql.prepare('INSERT INTO world VALUES (1, 1, 0, 1, 0, 0)').run();
    db.sql.prepare("INSERT INTO building (world_id, plot_index, epoch, state, blueprint_id, completed_stages, filled_slots, host_key_hash, host_name, join_mode, empty_since, finished_at, updated_at) VALUES (1, 0, 1, 'building', 'clock-tower', 0, 0, NULL, 'x', 'ask', NULL, NULL, 0)").run();
    expect(db.sql.prepare('SELECT ground_dug, ground_poured, high_filled, mixer_bags FROM building').get()).toEqual({ ground_dug: 0, ground_poured: 0, high_filled: 0, mixer_bags: 0 });
    expect(() => db.sql.prepare('UPDATE building SET ground_dug = 7').run()).toThrow();
    expect(() => db.sql.prepare('UPDATE building SET mixer_bags = 5').run()).toThrow();
    db.close();
  });
});
