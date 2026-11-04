import { afterEach, describe, expect, it } from 'vitest';
import { EXCAVATOR_REACH, MACHINE, SITE, machineId } from '@hht/shared';
import type { RunningServer } from '../src/server.ts';
import { boot, joinPlayer, sleep, until, worldOf, type Player } from './helpers.ts';
import { machineHelpersFor } from './machine-helpers.ts';

let server: RunningServer;
const M = machineHelpersFor(() => server);
const { S, host, enter, steps, press, rec, sys, plotState, dropAt } = M;
afterEach(async () => {
  await server?.close();
});

/** Drop exactly at (x, z): the drop point is 0.6 m in front of a worker facing +Z. */
const dropOn = (p: Player, x: number, z: number, type: string) => dropAt(p, x, z - 0.6, type);
/** Point the excavator's bucket tip at (x, z) from `back` metres away. */
const aimExcavator = (plot: number, x: number, z: number) => {
  const r = rec(plot, 'excavator');
  const c = SITE.machines[plot]!.center;
  // approach from the plot centre side so the body stays inside the yard
  const a = Math.atan2(x - c.x, z - c.z) + Math.PI;
  const bx = x + Math.sin(a) * EXCAVATOR_REACH;
  const bz = z + Math.cos(a) * EXCAVATOR_REACH;
  r.state = { ...r.state, x: bx, z: bz, yaw: Math.atan2(x - bx, z - bz) };
};
const row = (plot: number) => server.ctx.db.sql.prepare('SELECT ground_dug, ground_poured, mixer_bags FROM building WHERE world_id = 1 AND plot_index = ?').get(plot) as Record<string, number>;

describe('Groundwork (US2)', () => {
  it('a beam during Groundwork is refused with groundworkFirst (dig) and dropped beside the plot', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const plot = await host(a, { groundwork: true });
    const d = SITE.plots[plot]!;
    await dropAt(a, d.x, d.z, 'beam');
    expect(await a.waitFor('hint')).toEqual({ kind: 'groundworkFirst', part: 'dig' });
    expect(plotState(plot).filledSlots).toBe(0);
    const pc = [...sys().pieces.values()][0]!;
    expect(Math.hypot(pc.x - d.x, pc.z - d.z)).toBeGreaterThan(d.buildZoneRadius);
    await a.leave();
  });

  it('6 scoops dumped at the spoil heap dig the pit; dumping elsewhere counts nothing; every step is persisted', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const o = await joinPlayer(server);
    const plot = await host(a, { groundwork: true });
    const sp = SITE.machines[plot]!;
    expect(await enter(a, plot, 'excavator')).toBe('entered');
    // a dump away from the heap returns the dirt
    aimExcavator(plot, sp.center.x, sp.center.z);
    await steps(a, press(60));
    expect(rec(plot, 'excavator').state.load).toEqual({ kind: 'dirt' });
    const away = { x: sp.center.x + (sp.hookPad.x - sp.center.x) * 0.9, z: sp.center.z + (sp.hookPad.z - sp.center.z) * 0.9 };
    aimExcavator(plot, away.x, away.z);
    await steps(a, press(45));
    expect(rec(plot, 'excavator').state.load).toEqual({ kind: 'none' });
    expect((await a.waitFor('machineAct', (e) => e.act === 'dumpBack')).plot).toBe(plot);
    expect(plotState(plot).groundDug).toBe(0);
    for (let i = 1; i <= 6; i++) {
      aimExcavator(plot, sp.center.x, sp.center.z);
      await steps(a, press(60));
      aimExcavator(plot, sp.spoil.x, sp.spoil.z);
      await steps(a, press(45));
      await until(() => plotState(plot).groundDug === i);
      expect(row(plot).ground_dug).toBe(i);
    }
    const g = await o.waitFor('ground', (e) => e.dug === 6);
    expect(g).toEqual({ plot, dug: 6, poured: 0, done: false });
    // a 7th scoop does nothing
    aimExcavator(plot, sp.center.x, sp.center.z);
    await steps(a, press(60));
    expect(rec(plot, 'excavator').state.load).toEqual({ kind: 'none' });
    await a.leave();
    await o.leave();
  }, 30_000);

  it('the hopper takes crew cement bags (max 4, then mixerFull); an outsider’s bag bounces with crewOnlyMachine', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const o = await joinPlayer(server);
    const plot = await host(a, { groundwork: true });
    const h = SITE.machines[plot]!.mixer.hopper;
    await dropOn(o, h.x, h.z, 'cement');
    expect(await o.waitFor('hint')).toEqual({ kind: 'crewOnlyMachine' });
    expect(plotState(plot).mixerBags).toBe(0);
    expect(sys().pieces.size).toBe(1); // bounced next to the mixer
    for (let i = 1; i <= 4; i++) {
      await dropOn(a, h.x, h.z, 'cement');
      await until(() => plotState(plot).mixerBags === i);
    }
    expect(row(plot).mixer_bags).toBe(4);
    await dropOn(a, h.x, h.z, 'cement');
    expect(await a.waitFor('hint', (x) => x.kind === 'mixerFull')).toEqual({ kind: 'mixerFull' });
    expect(plotState(plot).mixerBags).toBe(4);
    await a.leave();
    await o.leave();
  });

  it('mixing 3 bags makes 3 concrete buckets at the chute after 5 s; 4 poured into the dug pit finish Groundwork', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const plot = await host(a, { groundwork: true });
    const sp = SITE.machines[plot]!;
    const d = SITE.plots[plot]!;
    // concrete before the pit is dug is refused
    await dropAt(a, d.x, d.z, 'concrete');
    expect(await a.waitFor('hint')).toEqual({ kind: 'groundworkFirst', part: 'dig' });
    const b = sys().plots[plot]!;
    b.progress = { ...b.progress, groundDug: 6 };
    sys().syncPlot(plot);
    for (let i = 1; i <= 3; i++) {
      await dropOn(a, sp.mixer.hopper.x, sp.mixer.hopper.z, 'cement');
      await until(() => plotState(plot).mixerBags === i);
    }
    for (const id of [...sys().pieces.keys()]) sys().pieces.delete(id);
    worldOf(server).state.pieces.clear();
    expect(await enter(a, plot, 'mixer')).toBe('entered');
    const t0 = Date.now();
    await steps(a, press(6));
    await until(() => plotState(plot).mixerMixUntil > 0);
    await a.waitFor('machineAct', (e) => e.act === 'mixDone', 8000);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(MACHINE.mixer.mixS * 1000 - 200);
    expect(plotState(plot).mixerBags).toBe(0);
    expect(row(plot).mixer_bags).toBe(0);
    const buckets = [...sys().pieces.values()].filter((p) => p.type === 'concrete');
    expect(buckets).toHaveLength(3);
    for (const p of buckets) expect(Math.hypot(p.x - sp.mixer.chute.x, p.z - sp.mixer.chute.z)).toBeLessThan(2.5);
    a.send('machine', { op: 'exit' });
    await until(() => S(a).machine === -1);
    for (let i = 1; i <= 4; i++) {
      await dropAt(a, d.x, d.z, 'concrete');
      await until(() => plotState(plot).groundPoured === i);
      expect(row(plot).ground_poured).toBe(i);
    }
    const cel = await a.waitFor('celebrate');
    expect(cel.plot).toBe(plot);
    expect((await a.waitFor('ground', (e) => e.done)).poured).toBe(4);
    // Frame unlocks
    await dropAt(a, d.x, d.z, 'beam');
    await until(() => plotState(plot).filledSlots === 1);
    expect((await a.waitFor('snap')).via).toBe('hand');
    expect(sys().machines.usage.groundworkDone).toBe(1);
    void machineId;
    await sleep(10);
    await a.leave();
  }, 20_000);
});
