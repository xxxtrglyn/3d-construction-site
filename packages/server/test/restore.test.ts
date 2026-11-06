import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { CLOCK_TOWER, CLOSE, SITE, machineId, needsOf, parkedState } from '@hht/shared';
import type { RunningServer } from '../src/server.ts';
import { boot, joinPlayer, newKey, sleep, until, worldOf } from './helpers.ts';
import { helpersFor } from './world-helpers.ts';
import { machineHelpersFor } from './machine-helpers.ts';

let server: RunningServer;
const { S, host, dropAt, plotState, filledOf, progressOf, deliverRecipe } = helpersFor(() => server);
const dbFile = join(tmpdir(), `hht-restore-${process.pid}-${Date.now()}.sqlite`);
afterEach(async () => {
  await server?.close();
  for (const s of ['', '-wal', '-shm']) rmSync(dbFile + s, { force: true });
});

describe('restart restore', () => {
  it('restores towers, Host, crew, join mode, bin and the shift timer; members resume by key', async () => {
    server = await boot({ db: dbFile, timers: { bootGraceS: 30 } });
    const keyA = newKey();
    const keyB = newKey();
    const a = await joinPlayer(server, { key: keyA, name: 'Sunny Bolt' });
    const b = await joinPlayer(server, { key: keyB, name: 'Jolly Rivet' });
    const o = await joinPlayer(server);
    const plot = await host(a);
    await sleep(550);
    a.send('crew', { op: 'mode', mode: 'open' });
    await until(() => plotState(plot).joinMode === 'open');
    b.send('crew', { op: 'request', plot });
    await b.waitFor('requestResult', (r) => r.result === 'joined');
    a.send('dev', { op: 'fillStage', plot });
    await until(() => plotState(plot).completedStages === 1);
    const d = SITE.plots[plot]!;
    // Walls & Floors (feature 004): a brick into the tower, a beam (also needed) donated to the bin
    await dropAt(a, d.x, d.z, 'brick');
    await dropAt(o, d.bin.x, d.bin.z, 'beam');
    await until(() => plotState(plot).filledA === 1 && plotState(plot).bin.length === 1);
    const endsAt = worldOf(server).state.shift.endsAt;
    const closing = a.waitFor('correction', undefined, 100).catch(() => null);
    void closing;
    await server.close();
    await until(() => a.closedWith !== null);
    expect(a.closedWith).toBe(CLOSE.shutdown);

    server = await boot({ db: dbFile, timers: { bootGraceS: 30 } });
    const p = plotState(plot);
    expect(p.state).toBe('building');
    expect(p.completedStages).toBe(1);
    expect(p).toMatchObject({ blueprintId: 'clock-tower', filledA: 1, filledB: 0 });
    expect(filledOf(plot)).toBe(1);
    expect(p.joinMode).toBe('open');
    expect(p.crewSize).toBe(2);
    expect(Array.from(p.bin)).toEqual(['beam']);
    expect(p.hostName).toBe('Sunny Bolt');
    expect(worldOf(server).state.shift.endsAt).toBe(endsAt);
    const a2 = await joinPlayer(server, { key: keyA, name: 'Sunny Bolt' });
    expect(S(a2).crewPlot).toBe(plot);
    expect(S(a2).crewRole).toBe('host');
    const b2 = await joinPlayer(server, { key: keyB, name: 'Jolly Rivet' });
    expect(S(b2).crewRole).toBe('member');
    await a2.leave();
    await b2.leave();
  }, 20_000);

  it('restored members who do not return within the boot grace leave the crew', async () => {
    server = await boot({ db: dbFile, timers: { bootGraceS: 1, unattendedAfterS: 600 } });
    const a = await joinPlayer(server);
    const plot = await host(a);
    await server.close();
    server = await boot({ db: dbFile, timers: { bootGraceS: 1, unattendedAfterS: 600 } });
    expect(plotState(plot).crewSize).toBe(1);
    await until(() => plotState(plot).crewSize === 0, 4000);
    expect(plotState(plot).state).toBe('building');
  });

  it('a shift that ended while the server was down resets at boot', async () => {
    server = await boot({ db: dbFile });
    const a = await joinPlayer(server);
    const plot = await host(a);
    const epoch = worldOf(server).state.shift.epoch;
    server.ctx.db.sql.prepare('UPDATE world SET shift_started_at = shift_started_at - 7200000 WHERE world_id = 1').run();
    await server.close();
    server = await boot({ db: dbFile });
    expect(worldOf(server).state.shift.epoch).toBe(epoch + 1);
    expect(plotState(plot).state).toBe('free');
  });
});

describe('restart restore (feature 003)', () => {
  it('Groundwork progress and mixer bags are restored exactly; machines come back parked and empty; held loads are not restored', async () => {
    const { enter, steps, press, rec } = machineHelpersFor(() => server);
    server = await boot({ db: dbFile, timers: { bootGraceS: 30 } });
    const a = await joinPlayer(server);
    const plot = await host(a, { groundwork: true });
    const sys = worldOf(server).systems;
    const b = sys.plots[plot]!;
    // dig 3 (through the shared rule, persisted like a real dump) and 2 bags in the mixer
    for (let i = 0; i < 3; i++) b.progress = { ...b.progress, groundDug: b.progress.groundDug + 1 };
    sys.saveBuilding(b);
    sys.syncPlot(plot);
    const h = SITE.machines[plot]!.mixer.hopper;
    for (let i = 1; i <= 2; i++) {
      await dropAt(a, h.x, h.z - 0.6, 'cement');
      await until(() => plotState(plot).mixerBags === i);
    }
    // the crane holds a piece and the forklift has moved when the server stops
    const pad = SITE.machines[plot]!.hookPad;
    await dropAt(a, pad.x, pad.z - 0.6, 'beam');
    await until(() => sys.pieces.size === 1);
    expect(await enter(a, plot, 'crane')).toBe('entered');
    const pc = [...sys.pieces.values()][0]!;
    const c = SITE.machines[plot]!.crane;
    const r = rec(plot, 'crane');
    r.state = { ...r.state, p1: Math.atan2(pc.x - c.x, pc.z - c.z), p2: Math.hypot(pc.x - c.x, pc.z - c.z) };
    await steps(a, press(130));
    await until(() => plotState(plot).hookType === 'beam');
    await server.close();

    server = await boot({ db: dbFile, timers: { bootGraceS: 30 } });
    expect(plotState(plot)).toMatchObject({ groundDug: 3, groundPoured: 0, mixerBags: 2, hookType: '' });
    expect(Array.from(plotState(plot).machineOps)).toEqual(['', '', '', '']);
    const w = worldOf(server).systems;
    for (const m of w.machines.recs) {
      const spots = SITE.machines[Math.floor(m.state.id / 4)]!;
      const parked = parkedState(m.state.id, spots);
      expect(m.operator).toBe('');
      expect({ ...m.state, load: null }).toEqual({ ...parked, load: null });
    }
    expect(w.machines.recs[machineId(plot, 'mixer')]!.state.load).toEqual({ kind: 'bags', count: 2 });
    expect(w.pieces.size).toBe(0); // the hooked beam is not restored
    const a2 = await joinPlayer(server, { key: a.key });
    expect(S(a2).crewPlot).toBe(plot);
    await a2.leave();
  }, 30_000);
});

describe('restart restore (feature 004)', () => {
  it('a restored legacy clock-tower-v1 building in Walls (filled_a = 5) needs 3 bricks only and completes Walls; after a shift reset the plot builds clock-tower', async () => {
    const opts = { db: dbFile, timers: { bootGraceS: 30, warnS: 1, countdownS: 1 } };
    server = await boot(opts);
    const key = newKey();
    const a = await joinPlayer(server, { key });
    const plot = await host(a);
    await server.close();
    // a building stored before 004: the v2 → v3 migration marks it clock-tower-v1 with filled_a = the old filled_slots
    const raw = new DatabaseSync(dbFile);
    raw.prepare("UPDATE building SET blueprint_id = 'clock-tower-v1', completed_stages = 1, filled_a = 5, filled_b = 0, high_filled = 0 WHERE world_id = 1 AND plot_index = ?").run(plot);
    raw.close();

    server = await boot(opts);
    expect(plotState(plot)).toMatchObject({ state: 'building', blueprintId: 'clock-tower-v1', completedStages: 1, filledA: 5, filledB: 0 });
    expect(progressOf(plot)).toMatchObject({ blueprintId: 'clock-tower-v1', filled: [5] });
    expect(needsOf(progressOf(plot))).toEqual([{ type: 'brick', total: 8, left: 3, highLeft: 0, craneOnly: false, done: false }]);
    const a2 = await joinPlayer(server, { key });
    expect(S(a2).crewPlot).toBe(plot);
    const d = SITE.plots[plot]!;
    // a beam (part of the new Walls recipe) is a wrong piece for the legacy recipe
    await dropAt(a2, d.x, d.z, 'beam');
    expect(await a2.waitFor('hint')).toEqual({ kind: 'wrongPiece', needed: ['brick'] });
    expect(worldOf(server).systems.pieces.size).toBe(1);
    expect(plotState(plot).filledA).toBe(5);
    // 3 bricks complete Walls & Floors; the legacy recipe goes on (Roof: panel×6)
    expect(await deliverRecipe(a2, plot, 3)).toEqual(['brick', 'brick', 'brick']);
    await until(() => plotState(plot).completedStages === 2);
    expect(plotState(plot)).toMatchObject({ blueprintId: 'clock-tower-v1', filledA: 0, filledB: 0 });
    expect(needsOf(progressOf(plot)).map((n) => [n.type, n.total])).toEqual([['panel', 6]]);
    const row = server.ctx.db.sql.prepare('SELECT blueprint_id, completed_stages, filled_a, filled_b FROM building WHERE world_id = 1 AND plot_index = ?').get(plot);
    expect(row).toEqual({ blueprint_id: 'clock-tower-v1', completed_stages: 2, filled_a: 0, filled_b: 0 });
    // shift reset: the legacy building goes; a new building on that plot uses the current recipe
    await sleep(550);
    a2.send('dev', { op: 'endShiftIn', seconds: 1 });
    await until(() => plotState(plot).state === 'free', 8000);
    await a2.waitFor('summary');
    expect(await host(a2)).toBe(plot);
    expect(plotState(plot)).toMatchObject({ state: 'building', blueprintId: 'clock-tower', completedStages: 0, filledA: 0, filledB: 0 });
    expect(progressOf(plot).blueprintId).toBe('clock-tower');
    expect(needsOf(progressOf(plot)).map((n) => [n.type, n.total])).toEqual(CLOCK_TOWER.stages[0]!.recipe.map((r) => [r.type, r.count]));
    await a2.leave();
  }, 30_000);
});
