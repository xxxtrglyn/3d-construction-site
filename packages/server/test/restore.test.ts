import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CLOSE, SITE, machineId, parkedState } from '@hht/shared';
import type { RunningServer } from '../src/server.ts';
import { boot, joinPlayer, newKey, sleep, until, worldOf } from './helpers.ts';
import { helpersFor } from './world-helpers.ts';
import { machineHelpersFor } from './machine-helpers.ts';

let server: RunningServer;
const { S, host, dropAt, plotState } = helpersFor(() => server);
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
    await dropAt(a, d.x, d.z, 'brick');
    await dropAt(o, d.bin.x, d.bin.z, 'paint');
    await until(() => plotState(plot).filledSlots === 1 && plotState(plot).bin.length === 1);
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
    expect(p.filledSlots).toBe(1);
    expect(p.joinMode).toBe('open');
    expect(p.crewSize).toBe(2);
    expect(Array.from(p.bin)).toEqual(['paint']);
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
