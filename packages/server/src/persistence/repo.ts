import type { BinEntry, CrewMember, JoinMode, PieceTypeId, PlotStateName, TowerProgress } from '@hht/shared';
import type { Db } from './db.ts';

/** Persisted world row (contracts/persistence.sql). */
export interface WorldRow {
  epoch: number;
  shiftStartedAt: number;
  shiftLengthMs: number;
  towersCompleted: number;
}

/** Persisted building snapshot (one row + crew + bin rows). */
export interface BuildingRow {
  plot: number;
  state: Exclude<PlotStateName, 'free'>;
  blueprintId: string;
  progress: TowerProgress;
  hostKeyHash: string | null;
  hostName: string;
  joinMode: JoinMode;
  emptySince: number | null;
  finishedAt: number | null;
  crew: CrewMember[];
  bin: BinEntry[];
  /** feature 003: cement bags in the plot's mixer (0..4) */
  mixerBags: number;
}

export interface ChatReportRow {
  id: number;
  worldId: number;
  epoch: number;
  reporterKeyHash: string;
  reportedKeyHash: string;
  reportedName: string;
  messages: Array<{ text: string; channel: string; at: number }>;
  createdAt: number;
}

/** Synchronous, transactional persistence for one world (research R6). */
export class WorldRepo {
  private readonly db: Db;
  readonly worldId: number;

  constructor(db: Db, worldId: number) {
    this.db = db;
    this.worldId = worldId;
  }

  loadWorld(): WorldRow | null {
    const r = this.db.sql.prepare('SELECT epoch, shift_started_at, shift_length_ms, towers_completed FROM world WHERE world_id = ?').get(this.worldId) as
      | { epoch: number; shift_started_at: number; shift_length_ms: number; towers_completed: number }
      | undefined;
    return r ? { epoch: r.epoch, shiftStartedAt: r.shift_started_at, shiftLengthMs: r.shift_length_ms, towersCompleted: r.towers_completed } : null;
  }

  saveWorld(w: WorldRow): void {
    this.db.tx(() => {
      this.db.sql
        .prepare(
          `INSERT INTO world (world_id, epoch, shift_started_at, shift_length_ms, towers_completed, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(world_id) DO UPDATE SET epoch = excluded.epoch, shift_started_at = excluded.shift_started_at,
             shift_length_ms = excluded.shift_length_ms, towers_completed = excluded.towers_completed, updated_at = excluded.updated_at`,
        )
        .run(this.worldId, w.epoch, w.shiftStartedAt, w.shiftLengthMs, w.towersCompleted, Date.now());
    });
  }

  /** Deletes rows from earlier shifts (stale epochs) and returns the buildings of `epoch`. */
  loadBuildings(epoch: number): BuildingRow[] {
    return this.db.tx(() => {
      for (const t of ['bin_entry', 'crew_member', 'building']) this.db.sql.prepare(`DELETE FROM ${t} WHERE world_id = ? AND epoch <> ?`).run(this.worldId, epoch);
      const rows = this.db.sql.prepare('SELECT * FROM building WHERE world_id = ? AND epoch = ? ORDER BY plot_index').all(this.worldId, epoch) as Array<Record<string, unknown>>;
      return rows.map((r) => {
        const plot = r.plot_index as number;
        const crew = (this.db.sql.prepare('SELECT key_hash, name, hat_color, role, joined_at FROM crew_member WHERE world_id = ? AND plot_index = ? ORDER BY joined_at').all(this.worldId, plot) as Array<Record<string, unknown>>).map(
          (c): CrewMember => ({ keyHash: c.key_hash as string, pid: null, name: c.name as string, hatColor: c.hat_color as string, joinedAt: c.joined_at as number, role: c.role as 'host' | 'member' }),
        );
        const bin = (this.db.sql.prepare('SELECT piece_type, donor_key_hash FROM bin_entry WHERE world_id = ? AND plot_index = ? ORDER BY slot').all(this.worldId, plot) as Array<Record<string, unknown>>).map(
          (b): BinEntry => ({ type: b.piece_type as PieceTypeId, donorKeyHash: b.donor_key_hash as string, donorPid: null }),
        );
        return {
          plot,
          state: r.state as BuildingRow['state'],
          blueprintId: r.blueprint_id as string,
          progress: {
            blueprintId: r.blueprint_id as string, completedStages: r.completed_stages as number, filledSlots: r.filled_slots as number,
            groundDug: r.ground_dug as number, groundPoured: r.ground_poured as number, highFilled: r.high_filled as number,
          },
          hostKeyHash: (r.host_key_hash as string | null) ?? null,
          hostName: r.host_name as string,
          joinMode: r.join_mode as JoinMode,
          emptySince: (r.empty_since as number | null) ?? null,
          finishedAt: (r.finished_at as number | null) ?? null,
          crew,
          bin,
          mixerBags: r.mixer_bags as number,
        };
      });
    });
  }

  saveBuilding(epoch: number, b: BuildingRow): void {
    this.db.tx(() => {
      const s = this.db.sql;
      s.prepare(
        `INSERT INTO building (world_id, plot_index, epoch, state, blueprint_id, completed_stages, filled_slots, host_key_hash, host_name, join_mode, empty_since, finished_at, updated_at,
           ground_dug, ground_poured, high_filled, mixer_bags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(world_id, plot_index) DO UPDATE SET epoch = excluded.epoch, state = excluded.state, blueprint_id = excluded.blueprint_id,
           completed_stages = excluded.completed_stages, filled_slots = excluded.filled_slots, host_key_hash = excluded.host_key_hash,
           host_name = excluded.host_name, join_mode = excluded.join_mode, empty_since = excluded.empty_since, finished_at = excluded.finished_at,
           updated_at = excluded.updated_at, ground_dug = excluded.ground_dug, ground_poured = excluded.ground_poured,
           high_filled = excluded.high_filled, mixer_bags = excluded.mixer_bags`,
      ).run(this.worldId, b.plot, epoch, b.state, b.blueprintId, b.progress.completedStages, b.progress.filledSlots, b.hostKeyHash, b.hostName, b.joinMode, b.emptySince, b.finishedAt, Date.now(),
        b.progress.groundDug, b.progress.groundPoured, b.progress.highFilled, b.mixerBags);
      s.prepare('DELETE FROM crew_member WHERE world_id = ? AND plot_index = ?').run(this.worldId, b.plot);
      const insC = s.prepare('INSERT OR REPLACE INTO crew_member (world_id, plot_index, key_hash, name, hat_color, role, joined_at, epoch) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const m of b.crew) insC.run(this.worldId, b.plot, m.keyHash, m.name, m.hatColor, m.role, m.joinedAt, epoch);
      s.prepare('DELETE FROM bin_entry WHERE world_id = ? AND plot_index = ?').run(this.worldId, b.plot);
      const insB = s.prepare('INSERT INTO bin_entry (world_id, plot_index, slot, piece_type, donor_key_hash, epoch) VALUES (?, ?, ?, ?, ?, ?)');
      b.bin.forEach((e, i) => insB.run(this.worldId, b.plot, i, e.type, e.donorKeyHash, epoch));
    });
  }

  deleteBuilding(plot: number): void {
    this.db.tx(() => {
      this.db.sql.prepare('DELETE FROM building WHERE world_id = ? AND plot_index = ?').run(this.worldId, plot);
    });
  }

  /** Shift reset: drop all buildings (CASCADE removes crew and bin rows). */
  clearBuildings(): void {
    this.db.tx(() => {
      this.db.sql.prepare('DELETE FROM building WHERE world_id = ?').run(this.worldId);
    });
  }

  /** Overflow world disposal: delete everything except chat reports (kept 30 days for review). */
  deleteWorld(): void {
    this.db.tx(() => {
      this.db.sql.prepare('DELETE FROM chat_pause WHERE world_id = ?').run(this.worldId);
      this.db.sql.prepare('DELETE FROM world WHERE world_id = ?').run(this.worldId);
    });
  }

  // ---------------------------------------------------------------- chat moderation

  insertReport(epoch: number, reporterKeyHash: string, reportedKeyHash: string, reportedName: string, messages: ChatReportRow['messages'], now: number): boolean {
    return this.db.tx(() => {
      const r = this.db.sql
        .prepare('INSERT OR IGNORE INTO chat_report (world_id, epoch, reporter_key_hash, reported_key_hash, reported_name, messages_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(this.worldId, epoch, reporterKeyHash, reportedKeyHash, reportedName, JSON.stringify(messages), now);
      return Number(r.changes) > 0;
    });
  }

  /** Distinct reporters of `reportedKeyHash` since `since` (auto-pause rule). */
  distinctReporters(reportedKeyHash: string, since: number): number {
    const r = this.db.sql.prepare('SELECT COUNT(DISTINCT reporter_key_hash) AS n FROM chat_report WHERE world_id = ? AND reported_key_hash = ? AND created_at >= ?').get(this.worldId, reportedKeyHash, since) as { n: number };
    return r.n;
  }

  addPause(keyHash: string, epoch: number, now: number): void {
    this.db.tx(() => {
      this.db.sql.prepare('INSERT OR IGNORE INTO chat_pause (world_id, key_hash, epoch, created_at) VALUES (?, ?, ?, ?)').run(this.worldId, keyHash, epoch, now);
    });
  }

  isPaused(keyHash: string, epoch: number): boolean {
    return !!this.db.sql.prepare('SELECT 1 FROM chat_pause WHERE world_id = ? AND key_hash = ? AND epoch = ?').get(this.worldId, keyHash, epoch);
  }

  purgeReports(olderThan: number): number {
    return this.db.tx(() => Number(this.db.sql.prepare('DELETE FROM chat_report WHERE created_at < ?').run(olderThan).changes));
  }
}

/** Reads reports for the owner review command (any world). */
export function listReports(db: Db, since: number, worldId?: number): ChatReportRow[] {
  const rows = (worldId === undefined
    ? db.sql.prepare('SELECT * FROM chat_report WHERE created_at >= ? ORDER BY created_at DESC').all(since)
    : db.sql.prepare('SELECT * FROM chat_report WHERE created_at >= ? AND world_id = ? ORDER BY created_at DESC').all(since, worldId)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number,
    worldId: r.world_id as number,
    epoch: r.epoch as number,
    reporterKeyHash: r.reporter_key_hash as string,
    reportedKeyHash: r.reported_key_hash as string,
    reportedName: r.reported_name as string,
    messages: JSON.parse(r.messages_json as string) as ChatReportRow['messages'],
    createdAt: r.created_at as number,
  }));
}
