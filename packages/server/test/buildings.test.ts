import { afterEach, describe, expect, it } from 'vitest';
import { SITE, CLOCK_TOWER } from '@hht/shared';
import type { RunningServer } from '../src/server.ts';
import { boot, joinPlayer, sleep, until, worldOf, type Player } from './helpers.ts';

let server: RunningServer;
afterEach(async () => {
  await server?.close();
});

const S = (p: Player) => worldOf(server).sessions.get(p.welcome.sessionId)!;
const put = (p: Player, x: number, z: number, facing = 0) => {
  const s = S(p);
  s.worker = { ...s.worker, x, z, facing };
};
const atForeman = (p: Player) => put(p, SITE.foreman.x, SITE.foreman.z + 1);
/** Stand in the plot's build zone and drop `type` there. */
const deliverTo = async (p: Player, plot: number, type: string) => {
  const d = SITE.plots[plot]!;
  put(p, d.x, d.z, 0);
  S(p).worker.carrying = type as never;
  p.send('drop', {});
  await sleep(60);
};

describe('Foreman and buildings', () => {
  it('Foreman in range assigns the lowest free plot and makes the player Host', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    put(a, 20, 20);
    a.send('foreman', { op: 'start', blueprint: 'clock-tower' });
    await sleep(100);
    expect(S(a).crewPlot).toBe(-1); // out of range: no effect
    atForeman(a);
    a.send('foreman', { op: 'start', blueprint: 'clock-tower' });
    const r = await a.waitFor('foreman');
    expect(r).toEqual({ result: 'assigned', plot: 0 });
    expect(S(a).crewRole).toBe('host');
    await until(() => worldOf(server).state.plots[0]!.state === 'building');
    expect(worldOf(server).state.plots[0]!.hostName).toBe(S(a).name);
    a.send('foreman', { op: 'start', blueprint: 'clock-tower' });
    expect(await a.waitFor('foreman', (x) => x.result === 'notAvailable')).toBeTruthy();
    await a.leave();
  });

  it('the Host builds through all stages to the Masterpiece; everyone gets snap events; the crew dissolves after the celebration', async () => {
    server = await boot({ timers: { celebrateS: 1 } });
    const a = await joinPlayer(server);
    const b = await joinPlayer(server);
    atForeman(a);
    a.send('foreman', { op: 'start', blueprint: 'clock-tower' });
    await a.waitFor('foreman');
    // stages 1–5 through the dev cheat (the action rate limit is 5/s), the bell delivered for real
    for (let st = 0; st < 5; st++) {
      await sleep(550); // admin rate limit: 2/s
      a.send('dev', { op: 'fillStage', plot: 0 });
      await until(() => worldOf(server).state.plots[0]!.completedStages === st + 1);
    }
    await deliverTo(a, 0, CLOCK_TOWER.stages[5]!.pieceType);
    await b.waitFor('snap', (e) => e.result === 'masterpiece');
    const cel = await b.waitFor('celebrate');
    expect(cel.plot).toBe(0);
    const plot = worldOf(server).state.plots[0]!;
    expect(plot.state).toBe('finished');
    expect(plot.completedStages).toBe(6);
    expect(worldOf(server).state.shift.towersCompleted).toBe(1);
    await until(() => S(a).crewPlot === -1, 3000);
    expect(worldOf(server).state.plots[0]!.state).toBe('finished'); // stays standing
    const snaps = b.events.filter((e) => e.type === 'snap');
    expect(snaps.length).toBe(30);
    await a.leave();
    await b.leave();
  });

  it('a wrong piece gives a hint to the actor only and is pushed out of the zone', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const b = await joinPlayer(server);
    atForeman(a);
    a.send('foreman', { op: 'start', blueprint: 'clock-tower' });
    await a.waitFor('foreman');
    await deliverTo(a, 0, 'bell');
    const h = await a.waitFor('hint');
    expect(h).toEqual({ kind: 'wrongPiece', needed: 'beam' });
    await sleep(100);
    expect(b.events.some((e) => e.type === 'hint')).toBe(false);
    const pc = [...worldOf(server).systems.pieces.values()][0]!;
    const d = SITE.plots[0]!;
    expect(Math.hypot(pc.x - d.x, pc.z - d.z)).toBeCloseTo(d.buildZoneRadius + 1.5, 3);
    expect(worldOf(server).state.plots[0]!.filledSlots).toBe(0);
    await a.leave();
    await b.leave();
  });

  it('simultaneous last-slot deliveries fill exactly one slot each, in order', async () => {
    server = await boot({ timers: { celebrateS: 30 } });
    const a = await joinPlayer(server);
    atForeman(a);
    a.send('foreman', { op: 'start', blueprint: 'clock-tower' });
    await a.waitFor('foreman');
    for (let i = 0; i < 5; i++) {
      await deliverTo(a, 0, 'beam');
      await sleep(150);
    }
    // two beams for one remaining frame slot: the first completes the stage, the second is a wrong piece (needs bricks)
    await deliverTo(a, 0, 'beam');
    await deliverTo(a, 0, 'beam');
    await sleep(100);
    const plot = worldOf(server).state.plots[0]!;
    expect(plot.completedStages).toBe(1);
    expect(plot.filledSlots).toBe(0);
    expect(a.events.filter((e) => e.type === 'hint')).toHaveLength(1);
    await a.leave();
  });

  it('a non-crew player cannot snap into a tower', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const b = await joinPlayer(server);
    atForeman(a);
    a.send('foreman', { op: 'start', blueprint: 'clock-tower' });
    await a.waitFor('foreman');
    await deliverTo(b, 0, 'beam');
    await sleep(100);
    expect(worldOf(server).state.plots[0]!.filledSlots).toBe(0);
    await a.leave();
    await b.leave();
  });

  it('persists building changes to SQLite in the same tick', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    atForeman(a);
    a.send('foreman', { op: 'start', blueprint: 'clock-tower' });
    await a.waitFor('foreman');
    await deliverTo(a, 0, 'beam');
    await until(() => worldOf(server).state.plots[0]!.filledSlots === 1);
    const row = server.ctx.db.sql.prepare('SELECT filled_slots, state, join_mode FROM building WHERE world_id = 1 AND plot_index = 0').get() as Record<string, unknown>;
    expect(row).toEqual({ filled_slots: 1, state: 'building', join_mode: 'ask' });
    const crew = server.ctx.db.sql.prepare('SELECT role FROM crew_member WHERE world_id = 1').all();
    expect(crew).toEqual([{ role: 'host' }]);
    await a.leave();
  });
});
