import { afterEach, describe, expect, it } from 'vitest';
import { FORK_REACH, MOVE, SITE, inNoDrive, MACHINE_RADIUS } from '@hht/shared';
import type { RunningServer } from '../src/server.ts';
import { boot, joinPlayer, sleep, until, type Player } from './helpers.ts';
import { machineHelpersFor } from './machine-helpers.ts';

let server: RunningServer;
const M = machineHelpersFor(() => server);
const { S, host, enter, steps, press, hold, rec, sys, plotState, dropAt } = M;
afterEach(async () => {
  await server?.close();
});

/** Put the forklift's fork tip at (x, z), facing away from `from`. */
const forksAt = (plot: number, x: number, z: number, from: { x: number; z: number }) => {
  const r = rec(plot, 'forklift');
  const yaw = Math.atan2(x - from.x, z - from.z);
  r.state = { ...r.state, x: x - Math.sin(yaw) * FORK_REACH, z: z - Math.cos(yaw) * FORK_REACH, yaw, p3: 0 };
};
const rackOf = (type: string) => SITE.racks.find((r) => r.type === type)!;
const toStage = async (p: Player, plot: number, stage: number) => {
  for (let st = plotState(plot).completedStages; st < stage - 1; st++) {
    await sleep(550);
    p.send('dev', { op: 'fillStage', plot });
    await until(() => plotState(plot).completedStages === st + 1);
  }
};

describe('forklift (US4)', () => {
  it('loads min(4, needed) of the needed type at a rack, never other types; 2 trips fill the 8 brick slots', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const plot = await host(a);
    await toStage(a, plot, 2);
    const def = SITE.plots[plot]!;
    expect(await enter(a, plot, 'forklift')).toBe('entered');
    // a beam rack is not needed: nothing loads
    const beam = rackOf('beam');
    forksAt(plot, beam.x, beam.z, { x: 0, z: 0 });
    await steps(a, press(16));
    expect(Array.from(plotState(plot).palletTypes)).toEqual([]);
    for (let trip = 1; trip <= 2; trip++) {
      const brick = rackOf('brick');
      forksAt(plot, brick.x, brick.z, { x: 0, z: 0 });
      await steps(a, press(16));
      await until(() => plotState(plot).palletTypes.length === 4);
      expect(Array.from(plotState(plot).palletTypes)).toEqual(['brick', 'brick', 'brick', 'brick']);
      expect(a.room.state.pieces.size).toBe(0); // pallet pieces are not in the schema
      forksAt(plot, def.x, def.z, { x: def.x + def.s * 4, z: def.z + def.c * 4 });
      await steps(a, press(16));
      await until(() => plotState(plot).palletTypes.length === 0);
      if (trip === 1) {
        await until(() => plotState(plot).filledSlots === 4);
        expect((await a.waitFor('snap', (e) => e.via === 'forklift')).pieceType).toBe('brick');
      }
    }
    await until(() => plotState(plot).completedStages === 2);
    expect(sys().pieces.size).toBe(0);
    expect(sys().machines.usage.forkliftSnaps).toBe(8);
    await a.leave();
  }, 30_000);

  it('cement during excavation goes into its own hopper; leftovers and pallets set down elsewhere become loose pieces', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const plot = await host(a, { groundwork: true });
    const b = sys().plots[plot]!;
    expect(b.progress.groundDug).toBe(0);
    b.mixerBags = 1;
    sys().syncPlot(plot);
    expect(await enter(a, plot, 'forklift')).toBe('entered');
    const cement = rackOf('cement');
    forksAt(plot, cement.x, cement.z, { x: 0, z: 0 });
    await steps(a, press(16));
    await until(() => plotState(plot).palletTypes.length === 3); // 4 needed − 1 bag already in
    const hop = SITE.machines[plot]!.mixer.hopper;
    forksAt(plot, hop.x, hop.z, SITE.machines[plot]!.center);
    await steps(a, press(16));
    await until(() => plotState(plot).mixerBags === 4);
    expect(sys().pieces.size).toBe(0);
    expect(b.progress.groundPoured).toBe(0);
    const loaded = await a.waitFor('machineAct', e => e.act === 'palletLoad');
    expect(loaded.by).toBe(a.room.sessionId);
    // a pallet set down in the lane becomes loose pieces
    forksAt(plot, cement.x, cement.z, { x: 0, z: 0 });
    b.mixerBags = 0;
    sys().syncPlot(plot);
    await steps(a, press(16));
    await until(() => plotState(plot).palletTypes.length === 4);
    const lane = { x: SITE.plots[plot]!.x * 0.6, z: SITE.plots[plot]!.z * 0.6 };
    forksAt(plot, lane.x, lane.z, { x: lane.x * 1.2, z: lane.z * 1.2 });
    await steps(a, press(16));
    await until(() => sys().pieces.size === 4);
    for (const p of sys().pieces.values()) {
      expect(p.state).toBe('loose');
      expect(p.type).toBe('cement');
    }
    await until(() => a.room.state.pieces.size === 4);
    expect(sys().machines.audit.heldPiecesLost).toBe(0);
    void dropAt;
    await a.leave();
  }, 20_000);

  it('stops at the plaza edge and is faster than running', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const plot = await host(a);
    expect(await enter(a, plot, 'forklift')).toBe('entered');
    let top = 0;
    for (let k = 0; k < 6; k++) {
      await steps(a, hold(60, { dz: 127 }));
      const st = rec(plot, 'forklift').state;
      top = Math.max(top, st.p3);
      expect(inNoDrive(SITE, st.x, st.z, plot, MACHINE_RADIUS.forklift - 1e-3)).toBe(false);
    }
    expect(top).toBeGreaterThan(MOVE.runSpeed);
    const st = rec(plot, 'forklift').state;
    expect(Math.hypot(st.x, st.z)).toBeLessThan(SITE.noDrive.plazaRadius + MACHINE_RADIUS.forklift + 0.3);
    void S;
    await a.leave();
  }, 20_000);
});

it('preserves all pallet material when another worker fills the hopper before unloading', async () => {
  server = await boot();
  const a = await joinPlayer(server);
  const plot = await host(a, { groundwork: true });
  expect(await enter(a, plot, 'forklift')).toBe('entered');
  const rack = rackOf('cement');
  forksAt(plot, rack.x, rack.z, { x: 0, z: 0 });
  await steps(a, press(16));
  await until(() => plotState(plot).palletTypes.length === 4);
  const b = sys().plots[plot]!;
  b.mixerBags = 4; // concurrent hand delivery fills the receiving hopper
  sys().syncPlot(plot);
  const hopper = SITE.machines[plot]!.mixer.hopper;
  forksAt(plot, hopper.x, hopper.z, SITE.machines[plot]!.center);
  await steps(a, press(16));
  await until(() => plotState(plot).palletTypes.length === 0);
  const materials = [...sys().pieces.values()];
  expect(materials).toHaveLength(4);
  expect(materials.every(p => p.type === 'cement' && p.state === 'loose')).toBe(true);
  expect(b.mixerBags).toBe(4);
  expect(b.progress.groundPoured).toBe(0);
  expect(sys().machines.audit.heldPiecesLost).toBe(0);
  await a.leave();
}, 20_000);
