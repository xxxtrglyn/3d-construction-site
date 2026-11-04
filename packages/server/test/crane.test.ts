import { afterEach, describe, expect, it } from 'vitest';
import { SITE, hookPos, inYard, openSlotRefs } from '@hht/shared';
import type { RunningServer } from '../src/server.ts';
import { boot, joinPlayer, sleep, until, worldOf, type Player } from './helpers.ts';
import { machineHelpersFor } from './machine-helpers.ts';

let server: RunningServer;
const M = machineHelpersFor(() => server);
const { S, put, host, enter, steps, press, hold, rec, sys, plotState, dropAt } = M;
afterEach(async () => {
  await server?.close();
});

const dropOn = (p: Player, x: number, z: number, type: string) => dropAt(p, x, z - 0.6, type);
/** Swing the hook directly over (x, z) (the operator would steer there; tests set the rig). */
const aimHook = (plot: number, x: number, z: number) => {
  const c = SITE.machines[plot]!.crane;
  const r = rec(plot, 'crane');
  r.state = { ...r.state, p1: Math.atan2(x - c.x, z - c.z), p2: Math.hypot(x - c.x, z - c.z) };
};
/** Fill stages until `stage` (1-based) is current. */
const toStage = async (p: Player, plot: number, stage: number) => {
  for (let st = plotState(plot).completedStages; st < stage - 1; st++) {
    await sleep(550);
    p.send('dev', { op: 'fillStage', plot });
    await until(() => plotState(plot).completedStages === st + 1);
  }
};
const cycle = press(130); // lower 1 s, raise 1 s

describe('crane and high slots (US3)', () => {
  it('a hand delivery when only high slots remain is tooHigh and lands at the foot of the tower', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const plot = await host(a);
    await toStage(a, plot, 3);
    const d = SITE.plots[plot]!;
    for (let i = 1; i <= 3; i++) {
      await dropAt(a, d.x, d.z, 'panel');
      await until(() => plotState(plot).filledSlots === i);
    }
    for (const id of [...sys().pieces.keys()]) sys().pieces.delete(id);
    await dropAt(a, d.x, d.z, 'panel');
    expect(await a.waitFor('hint', (h) => h.kind === 'tooHigh')).toEqual({ kind: 'tooHigh' });
    expect(plotState(plot)).toMatchObject({ filledSlots: 3, highFilled: 0 });
    const pc = [...sys().pieces.values()][0]!;
    const dist = Math.hypot(pc.x - d.x, pc.z - d.z);
    expect(dist).toBeGreaterThan(d.towerHalf);
    expect(dist).toBeLessThan(d.buildZoneRadius);
    expect(sys().machines.audit.highFilledByHand).toBe(0);
    await a.leave();
  });

  it('grab → release over a high slot snaps via the crane; over a hand slot it fills that; far away it is set down; a wrong type is set down', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const o = await joinPlayer(server);
    const plot = await host(a);
    await toStage(a, plot, 3);
    const pad = SITE.machines[plot]!.hookPad;
    const def = SITE.plots[plot]!;
    const spots = SITE.machines[plot]!;
    const lift = async (type: string, target: { x: number; z: number }) => {
      for (const id of [...sys().pieces.keys()]) sys().pieces.delete(id);
      worldOf(server).state.pieces.clear();
      await dropOn(a, pad.x, pad.z, type);
      await until(() => sys().pieces.size === 1);
      if (S(a).machine < 0) expect(await enter(a, plot, 'crane')).toBe('entered');
      const pc = [...sys().pieces.values()][0]!;
      aimHook(plot, pc.x + 0.3, pc.z); // within 0.8 m
      await steps(a, cycle);
      await until(() => plotState(plot).hookType === type);
      expect(sys().pieces.get(pc.id)!.state).toBe('hooked');
      await until(() => o.room.state.pieces.size === 0);
      aimHook(plot, target.x, target.z);
      await steps(a, cycle);
      await until(() => plotState(plot).hookType === '');
    };
    const exitCrane = async () => {
      a.send('machine', { op: 'exit' });
      await until(() => S(a).machine === -1);
      await sleep(600);
    };
    // high slot (1.2 m off: the ring is in range)
    const high = openSlotRefs(def, spots, sys().plots[plot]!.progress).find((s) => s.high)!;
    await lift('panel', { x: high.x + 1.2, z: high.z });
    const snap = await o.waitFor('snap', (e) => e.via === 'crane');
    expect(snap).toMatchObject({ plot, result: 'snapped', via: 'crane', pieceType: 'panel' });
    expect(plotState(plot)).toMatchObject({ filledSlots: 1, highFilled: 1 });
    expect(sys().pieces.size).toBe(0);
    // a hand slot through the crane
    await exitCrane();
    const hand = openSlotRefs(def, spots, sys().plots[plot]!.progress).find((s) => !s.high)!;
    await lift('panel', hand);
    await until(() => plotState(plot).filledSlots === 2);
    expect(plotState(plot).highFilled).toBe(1);
    // far from any slot: set down, loose again
    await exitCrane();
    const far = { x: spots.spoil.x, z: spots.spoil.z };
    await lift('panel', far);
    await until(() => sys().pieces.size === 1);
    const down = [...sys().pieces.values()][0]!;
    expect(down.state).toBe('loose');
    expect(Math.hypot(down.x - far.x, down.z - far.z)).toBeLessThanOrEqual(2.01);
    expect(plotState(plot).filledSlots).toBe(2);
    // the wrong type over a high slot: set down
    await exitCrane();
    await lift('paint', high);
    await until(() => sys().pieces.size === 1 && [...sys().pieces.values()][0]!.type === 'paint');
    expect(plotState(plot).filledSlots).toBe(2);
    expect(sys().machines.audit.heldPiecesLost).toBe(0);
    await a.leave();
    await o.leave();
  }, 40_000);

  it('the hook stays inside its yard and reach whatever the operator does', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const plot = await host(a);
    expect(await enter(a, plot, 'crane')).toBe('entered');
    await steps(a, [...hold(120, { dz: 127 }), ...hold(240, { dx: 127, dz: 127 }), ...hold(120, { dx: -127, dz: -127 })]);
    const r = rec(plot, 'crane');
    const h = hookPos(r.state, SITE.machines[plot]!);
    expect(inYard(SITE.machines[plot]!, h.x, h.z)).toBe(true);
    expect(r.state.p2).toBeGreaterThanOrEqual(2.5);
    expect(r.state.p2).toBeLessThanOrEqual(7.5);
    await a.leave();
  });

  it('a solo Host carries the bell to the pad, lifts it and finishes the Masterpiece alone', async () => {
    server = await boot({ timers: { celebrateS: 2 } });
    const a = await joinPlayer(server);
    const plot = await host(a);
    a.send('crew', { op: 'mode', mode: 'solo' });
    await toStage(a, plot, 6);
    const pad = SITE.machines[plot]!.hookPad;
    for (const id of [...sys().pieces.keys()]) sys().pieces.delete(id);
    await dropOn(a, pad.x, pad.z, 'bell');
    await until(() => sys().pieces.size === 1);
    expect(await enter(a, plot, 'crane')).toBe('entered');
    const pc = [...sys().pieces.values()][0]!;
    aimHook(plot, pc.x, pc.z);
    await steps(a, cycle);
    await until(() => plotState(plot).hookType === 'bell');
    const bellSlot = SITE.machines[plot]!.highSlots[5]![0]!;
    aimHook(plot, bellSlot.x, bellSlot.z);
    await steps(a, cycle);
    expect((await a.waitFor('snap', (e) => e.result === 'masterpiece')).via).toBe('crane');
    await a.waitFor('celebrate');
    expect(plotState(plot).state).toBe('finished');
    void put;
    await a.leave();
  }, 30_000);
});
