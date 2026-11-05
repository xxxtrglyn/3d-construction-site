import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { needsOf } from '@hht/shared';
import { SCHEMA_VERSION, openDb } from '../src/persistence/db.ts';
import { WorldRepo } from '../src/persistence/repo.ts';

const file = join(tmpdir(), `hht-migrate-${process.pid}-${Date.now()}.sqlite`);
afterEach(() => {
  for (const s of ['', '-wal', '-shm']) rmSync(file + s, { force: true });
});

const versionOf = (sql: DatabaseSync): string => (sql.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string }).value;

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

/**
 * A database exactly as feature 003 left it (schema_version 2): one building in Walls & Floors
 * (completed_stages = 1) with 5 of the old 8 brick slots filled, a crew member and a bin.
 */
function makeV2(): void {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(new URL('./fixtures/schema-v2.sql', import.meta.url), 'utf8'));
  db.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', '2')").run();
  db.prepare('INSERT INTO world VALUES (1, 3, 1000, 3600000, 0, 1000)').run();
  db.prepare(
    `INSERT INTO building (world_id, plot_index, epoch, state, blueprint_id, completed_stages, filled_slots, host_key_hash, host_name, join_mode, empty_since, finished_at, updated_at,
       ground_dug, ground_poured, high_filled, mixer_bags)
     VALUES (1, 4, 3, 'building', 'clock-tower', 1, 5, 'k', 'Sunny Bolt', 'open', NULL, NULL, 1000, 6, 4, 0, 0)`,
  ).run();
  db.prepare("INSERT INTO crew_member VALUES (1, 4, 'k', 'Sunny Bolt', 'teal', 'host', 1000, 3)").run();
  db.prepare("INSERT INTO bin_entry VALUES (1, 4, 0, 'brick', 'd', 3)").run();
  db.prepare("INSERT INTO bin_entry VALUES (1, 4, 1, 'cement', 'd', 3)").run();
  db.close();
}

describe('persistence migration v1 → v2 → v3', () => {
  it('adds the Groundwork columns, counts buildings in progress as dug and poured, and lets bins hold cement; ends at v3 as a legacy tower', () => {
    makeV1();
    const db = openDb(file);
    expect(SCHEMA_VERSION).toBe(3);
    expect(versionOf(db.sql)).toBe('3');
    const cols = (db.sql.prepare('PRAGMA table_info(building)').all() as Array<{ name: string }>).map((c) => c.name);
    for (const c of ['ground_dug', 'ground_poured', 'high_filled', 'mixer_bags', 'filled_a', 'filled_b']) expect(cols).toContain(c);
    expect(cols).not.toContain('filled_slots');
    const row = db.sql.prepare('SELECT blueprint_id, completed_stages, filled_a, filled_b, ground_dug, ground_poured, high_filled, mixer_bags FROM building WHERE plot_index = 2').get();
    expect(row).toEqual({ blueprint_id: 'clock-tower-v1', completed_stages: 2, filled_a: 1, filled_b: 0, ground_dug: 6, ground_poured: 4, high_filled: 0, mixer_bags: 0 });
    // bin rows survive the table rebuild; cement is accepted, concrete still refused
    expect((db.sql.prepare('SELECT piece_type FROM bin_entry ORDER BY slot').all() as Array<{ piece_type: string }>).map((r) => r.piece_type)).toEqual(['brick', 'paint']);
    db.sql.prepare("INSERT INTO bin_entry VALUES (1, 2, 2, 'cement', 'd', 3)").run();
    expect(() => db.sql.prepare("INSERT INTO bin_entry VALUES (1, 2, 3, 'concrete', 'd', 3)").run()).toThrow();
    // CASCADE still works on the rebuilt table
    db.sql.prepare('DELETE FROM building WHERE plot_index = 2').run();
    expect((db.sql.prepare('SELECT COUNT(*) AS n FROM bin_entry').get() as { n: number }).n).toBe(0);
    db.close();
    // reopening a v3 database is a no-op
    const again = openDb(file);
    expect(versionOf(again.sql)).toBe('3');
    again.close();
  });

  it('v2 → v3: filled_slots becomes filled_a, filled_b = 0, and every stored building keeps the legacy clock-tower-v1 recipe', () => {
    makeV2();
    const db = openDb(file);
    expect(versionOf(db.sql)).toBe('3');
    const row = db.sql.prepare('SELECT blueprint_id, completed_stages, filled_a, filled_b, ground_dug, ground_poured, high_filled, mixer_bags, join_mode FROM building WHERE plot_index = 4').get();
    expect(row).toEqual({ blueprint_id: 'clock-tower-v1', completed_stages: 1, filled_a: 5, filled_b: 0, ground_dug: 6, ground_poured: 4, high_filled: 0, mixer_bags: 0, join_mode: 'open' });
    // crew and bin rows are untouched
    expect(db.sql.prepare('SELECT key_hash, role FROM crew_member').all()).toEqual([{ key_hash: 'k', role: 'host' }]);
    expect((db.sql.prepare('SELECT piece_type FROM bin_entry ORDER BY slot').all() as Array<{ piece_type: string }>).map((r) => r.piece_type)).toEqual(['brick', 'cement']);
    // the renamed column keeps its CHECK, the new one has its own
    expect(() => db.sql.prepare('UPDATE building SET filled_a = -1').run()).toThrow();
    expect(() => db.sql.prepare('UPDATE building SET filled_b = -1').run()).toThrow();
    // the repo loads it as a one-material Walls stage: 3 bricks left
    const [b] = new WorldRepo(db, 1).loadBuildings(3);
    expect(b!.blueprintId).toBe('clock-tower-v1');
    expect(b!.progress).toMatchObject({ blueprintId: 'clock-tower-v1', completedStages: 1, filled: [5], highFilled: 0 });
    expect(needsOf(b!.progress)).toEqual([{ type: 'brick', total: 8, left: 3, highLeft: 0, craneOnly: false, done: false }]);
    db.close();
    const again = openDb(file);
    expect(versionOf(again.sql)).toBe('3');
    expect((again.sql.prepare('SELECT blueprint_id FROM building').get() as { blueprint_id: string }).blueprint_id).toBe('clock-tower-v1');
    again.close();
  });

  it('a fresh database starts at v3 with new buildings at Groundwork 0 and filled_b defaulting to 0', () => {
    const db = openDb(':memory:');
    expect(versionOf(db.sql)).toBe('3');
    db.sql.prepare('INSERT INTO world VALUES (1, 1, 0, 1, 0, 0)').run();
    db.sql.prepare("INSERT INTO building (world_id, plot_index, epoch, state, blueprint_id, completed_stages, filled_a, host_key_hash, host_name, join_mode, empty_since, finished_at, updated_at) VALUES (1, 0, 1, 'building', 'clock-tower', 0, 0, NULL, 'x', 'ask', NULL, NULL, 0)").run();
    expect(db.sql.prepare('SELECT blueprint_id, filled_a, filled_b, ground_dug, ground_poured, high_filled, mixer_bags FROM building').get()).toEqual({ blueprint_id: 'clock-tower', filled_a: 0, filled_b: 0, ground_dug: 0, ground_poured: 0, high_filled: 0, mixer_bags: 0 });
    expect(() => db.sql.prepare('UPDATE building SET ground_dug = 7').run()).toThrow();
    expect(() => db.sql.prepare('UPDATE building SET mixer_bags = 5').run()).toThrow();
    expect(() => db.sql.prepare('UPDATE building SET filled_b = -1').run()).toThrow();
    db.close();
  });
});
