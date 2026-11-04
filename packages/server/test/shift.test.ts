import { afterEach, describe, expect, it } from 'vitest';
import { SITE } from '@hht/shared';
import type { RunningServer } from '../src/server.ts';
import { boot, joinPlayer, sleep, until, worldOf } from './helpers.ts';
import { helpersFor } from './world-helpers.ts';

let server: RunningServer;
const { S, put, host, dropAt, plotState } = helpersFor(() => server);
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
    await until(() => plotState(plot).filledSlots === 1 && plotState(plot).bin.length === 1);
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
    const d = SITE.plots[plot]!;
    await dropAt(a, d.x, d.z, 'bell');
    const cel = await a.waitFor('celebrate');
    const sum = await a.waitFor('summary', undefined, 8000);
    expect(Date.now()).toBeGreaterThanOrEqual(cel.until - 50);
    expect(sum.worldTowers).toBe(1);
    expect(sum.myCrewTowers).toBe(1);
    await a.leave();
  }, 20_000);
});
