import { afterEach, describe, expect, it } from 'vitest';
import { SITE, machineId, parkedState } from '@hht/shared';
import type { RunningServer } from '../src/server.ts';
import { boot, joinPlayer, sleep, until, worldOf } from './helpers.ts';
import { helpersFor } from './world-helpers.ts';
import { machineHelpersFor } from './machine-helpers.ts';

let server: RunningServer;
const { S, put, host, dropAt, plotState, filledOf } = helpersFor(() => server);
const { enter, steps, hold, rec, sys } = machineHelpersFor(() => server);
afterEach(async () => {
  await server?.close();
});

describe('shifts', () => {
  it('warning → countdown → reset: plots, crews, bins and pieces cleared; players stay connected and get summaries', async () => {
    server = await boot({ timers: { warnS: 3, countdownS: 2 } });
    const a = await joinPlayer(server);
    const o = await joinPlayer(server);
    const plot = await host(a);
    const d = SITE.plots[plot]!;
    await dropAt(a, d.x, d.z, 'beam');
    await dropAt(o, d.bin.x, d.bin.z, 'brick');
    await dropAt(o, 6, 12, 'cone');
    await until(() => filledOf(plot) === 1 && plotState(plot).bin.length === 1);
    const epoch = worldOf(server).state.shift.epoch;
    await sleep(550);
    a.send('dev', { op: 'endShiftIn', seconds: 4 });
    expect((await o.waitFor('shift', (s) => s.phase === 'warning', 3000)).phase).toBe('warning');
    await o.waitFor('shift', (s) => s.phase === 'countdown', 4000);
    const sumA = await a.waitFor('summary', undefined, 6000);
    const sumO = await o.waitFor('summary', undefined, 6000);
    expect(sumA).toMatchObject({ epoch, worldTowers: 0, myCrewTowers: 0, delivered: 1, donated: 0 });
    expect(sumO).toMatchObject({ epoch, delivered: 0, donated: 1 });
    expect(plotState(plot).state).toBe('free');
    expect(S(a).crewPlot).toBe(-1);
    expect(worldOf(server).systems.pieces.size).toBe(0);
    expect(worldOf(server).state.shift.epoch).toBe(epoch + 1);
    expect(S(a).worker.x).toBe(SITE.spawn.x);
    expect(a.closedWith).toBeNull();
    const rows = server.ctx.db.sql.prepare('SELECT COUNT(*) AS n FROM crew_member').get() as { n: number };
    expect(rows.n).toBe(0);
    await a.leave();
    await o.leave();
  }, 20_000);

  it('a Masterpiece celebration delays the reset until it ends', async () => {
    server = await boot({ timers: { warnS: 2, countdownS: 1, celebrateS: 3 } });
    const a = await joinPlayer(server);
    const plot = await host(a);
    for (let st = 0; st < 5; st++) {
      await sleep(550);
      a.send('dev', { op: 'fillStage', plot });
      await until(() => plotState(plot).completedStages === st + 1);
    }
    await sleep(550);
    a.send('dev', { op: 'endShiftIn', seconds: 1 });
    // the bell is a high slot (feature 003): the dev cheat fills it through the crane path
    await sleep(550);
    a.send('dev', { op: 'fillStage', plot });
    const cel = await a.waitFor('celebrate');
    const sum = await a.waitFor('summary', undefined, 8000);
    expect(Date.now()).toBeGreaterThanOrEqual(cel.until - 50);
    expect(sum.worldTowers).toBe(1);
    expect(sum.myCrewTowers).toBe(1);
    await a.leave();
  }, 20_000);

  it('a shift reset puts operators out with shiftReset and parks every machine', async () => {
    server = await boot({ timers: { warnS: 1, countdownS: 1 } });
    const a = await joinPlayer(server);
    const plot = await host(a);
    expect(await enter(a, plot, 'forklift')).toBe('entered');
    await steps(a, hold(30, { dz: 127 }));
    expect(rec(plot, 'forklift').state).not.toEqual(parkedState(machineId(plot, 'forklift'), SITE.machines[plot]!));
    await sleep(550);
    a.send('machine', { op: 'exit' });
    await until(() => S(a).machine === -1);
    await sleep(550);
    expect(await enter(a, plot, 'forklift')).toBe('entered');
    a.send('dev', { op: 'endShiftIn', seconds: 1 });
    expect((await a.waitFor('machineExit', (e) => e.reason === 'shiftReset', 6000)).reason).toBe('shiftReset');
    await a.waitFor('summary', undefined, 6000);
    for (const r of sys().machines.recs) {
      expect(r.operator).toBe('');
      expect(r.state).toEqual(parkedState(r.state.id, SITE.machines[Math.floor(r.state.id / 4)]!));
    }
    // a new building starts at Groundwork
    const p2 = await host(a, { groundwork: true });
    expect(plotState(p2)).toMatchObject({ groundDug: 0, groundPoured: 0 });
    await a.leave();
  }, 20_000);
});
