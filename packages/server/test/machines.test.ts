import { afterEach, describe, expect, it } from 'vitest';
import {
  SIM_DT, SITE, exitSpot, machineCtx, machineId, parkedState, seatPose, stepMachine,
  type MachineState, type MoveInput,
} from '@hht/shared';
import type { RunningServer } from '../src/server.ts';
import { boot, joinPlayer, sleep, until, worldOf } from './helpers.ts';
import { machineHelpersFor } from './machine-helpers.ts';

let server: RunningServer;
const M = machineHelpersFor(() => server);
const { S, put, host, enter, steps, hold, press, rec, sys, plotState } = M;
afterEach(async () => {
  await server?.close();
});

const full = (i: Partial<MoveInput>): MoveInput => ({ seq: 0, dx: 0, dz: 0, run: false, jump: false, act: false, alt: false, ...i });

describe('getting in (US1)', () => {
  it('the enter matrix: entered, notCrew, busy, handsFull, tooFar, notBuilding', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const b = await joinPlayer(server);
    const o = await joinPlayer(server);
    const plot = await host(a);
    a.send('crew', { op: 'mode', mode: 'open' });
    await until(() => plotState(plot).joinMode === 'open');
    b.send('crew', { op: 'request', plot });
    await b.waitFor('requestResult', (r) => r.result === 'joined');
    expect(await enter(o, plot, 'forklift')).toBe('notCrew');
    expect(await enter(o, 5, 'forklift')).toBe('notBuilding');
    S(b).worker.carrying = 'brick';
    expect(await enter(b, plot, 'crane')).toBe('handsFull');
    S(b).worker.carrying = null;
    M.goTo(b, plot, 'excavator', 3);
    b.send('machine', { op: 'enter', id: machineId(plot, 'excavator') });
    expect((await b.waitFor('machineResult', (r) => r.result === 'tooFar')).result).toBe('tooFar');
    expect(await enter(a, plot, 'forklift')).toBe('entered');
    await sleep(600); // machine intents: burst 6, +2/s
    expect(await enter(b, plot, 'forklift')).toBe('busy');
    expect(S(a).machine).toBe(machineId(plot, 'forklift'));
    expect(worldOf(server).state.players.get(a.welcome.sessionId)!.machine).toBe(machineId(plot, 'forklift'));
    expect(Array.from(plotState(plot).machineOps)).toEqual(['', '', a.welcome.sessionId, '']);
    for (const p of [a, b, o]) await p.leave();
  });

  it('exactly one of two simultaneous enters wins', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const b = await joinPlayer(server);
    const plot = await host(a);
    a.send('crew', { op: 'mode', mode: 'open' });
    await until(() => plotState(plot).joinMode === 'open');
    b.send('crew', { op: 'request', plot });
    await b.waitFor('requestResult', (r) => r.result === 'joined');
    const id = machineId(plot, 'crane');
    M.goTo(a, plot, 'crane');
    M.goTo(b, plot, 'crane', -0.5);
    a.send('machine', { op: 'enter', id });
    b.send('machine', { op: 'enter', id });
    const ra = (await a.waitFor('machineResult')).result;
    const rb = (await b.waitFor('machineResult')).result;
    expect([ra, rb].sort()).toEqual(['busy', 'entered']);
    expect(rec(plot, 'crane').operator).toBe(ra === 'entered' ? a.welcome.sessionId : b.welcome.sessionId);
    await a.leave();
    await b.leave();
  });

  it('seated: the worker sits at seatPose; inputs drive the machine exactly like a local stepMachine replay', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const plot = await host(a);
    expect(await enter(a, plot, 'forklift')).toBe('entered');
    const start = rec(plot, 'forklift').state;
    const seat = seatPose(start, SITE.machines[plot]!);
    expect(S(a).worker.x).toBeCloseTo(seat.x, 9);
    expect(S(a).worker.y).toBeCloseTo(seat.y, 9);
    const inputs: Array<Partial<MoveInput>> = [...hold(48, { dz: 127 }), ...hold(30, { dz: 127, dx: 80 }), ...hold(24, { dz: -60 })];
    await steps(a, inputs);
    const ctx = machineCtx(SITE, plot, worldOf(server).blockers, 0);
    let local: MachineState = start;
    for (const i of inputs) local = stepMachine(local, full(i), SIM_DT, ctx).state;
    expect(rec(plot, 'forklift').state).toEqual(local);
    expect(Math.hypot(local.x - start.x, local.z - start.z)).toBeGreaterThan(3);
    const seat2 = seatPose(local, SITE.machines[plot]!);
    expect(S(a).worker.x).toBeCloseTo(seat2.x, 9);
    expect(S(a).worker.z).toBeCloseTo(seat2.z, 9);
    // the snapshot reports the seat and the own machine at f32 precision
    await until(() => a.lastSnap()?.ackSeq === S(a).lastSeq);
    expect(a.lastSnap().ownMachine!.x).toBeCloseTo(local.x, 4);
    await a.leave();
  });

  it('the jump flag gets out at that step; the machine {op: exit} fallback; the worker stands at exitSpot', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const plot = await host(a);
    expect(await enter(a, plot, 'excavator')).toBe('entered');
    await steps(a, [...hold(30, { dz: 127 }), { jump: true }, ...hold(12, { dz: 127 })]);
    expect((await a.waitFor('machineExit')).reason).toBe('jump');
    expect(S(a).machine).toBe(-1);
    expect(rec(plot, 'excavator').operator).toBe('');
    const ex = exitSpot(rec(plot, 'excavator').state, machineCtx(SITE, plot, worldOf(server).blockers, 0));
    // after the jump step the remaining inputs walk the worker forward from the exit spot
    expect(Math.hypot(S(a).worker.x - ex.x, S(a).worker.z - ex.z)).toBeGreaterThan(0.3);
    expect(Math.hypot(S(a).worker.x - ex.x, S(a).worker.z - ex.z)).toBeLessThan(1.5);
    expect(S(a).worker.y).toBe(0);
    await sleep(600);
    expect(await enter(a, plot, 'excavator')).toBe('entered');
    a.send('machine', { op: 'exit' });
    await until(() => S(a).machine === -1);
    a.send('machine', { op: 'exit' }); // idempotent
    await sleep(100);
    expect(S(a).machine).toBe(-1);
    await a.leave();
  });

  it('no contact: a worker standing in the forklift’s path is never moved', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const o = await joinPlayer(server);
    const plot = await host(a);
    expect(await enter(a, plot, 'forklift')).toBe('entered');
    const f = rec(plot, 'forklift').state;
    const ahead = { x: f.x + Math.sin(f.yaw) * 2.5, z: f.z + Math.cos(f.yaw) * 2.5 };
    put(o, ahead.x, ahead.z);
    await steps(a, hold(60, { dz: 127 }));
    expect(S(o).worker.x).toBe(ahead.x);
    expect(S(o).worker.z).toBe(ahead.z);
    const g = rec(plot, 'forklift').state;
    expect(Math.hypot(g.x - f.x, g.z - f.z)).toBeGreaterThan(2.5); // drove through
    expect(sys().machines.audit.workerMovedByMachine).toBe(0);
    await a.leave();
    await o.leave();
  });
});

describe('fair machines (US5)', () => {
  it('put out within 2 s when removed from the crew, with the hooked piece set down; conservation holds', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const b = await joinPlayer(server);
    const plot = await host(a);
    a.send('crew', { op: 'mode', mode: 'open' });
    await until(() => plotState(plot).joinMode === 'open');
    b.send('crew', { op: 'request', plot });
    await b.waitFor('requestResult', (r) => r.result === 'joined');
    // a panel lies on the hook pad; b lifts it
    const pad = SITE.machines[plot]!.hookPad;
    S(a).worker.carrying = 'panel';
    put(a, pad.x, pad.z - 0.6);
    a.send('toss', { charge: 0 });
    await until(() => sys().pieces.size === 1, 3000);
    expect(await enter(b, plot, 'crane')).toBe('entered');
    // swing the hook over the piece: aim directly
    const piece = [...sys().pieces.values()][0]!;
    const c = SITE.machines[plot]!.crane;
    const r = rec(plot, 'crane');
    r.state = { ...r.state, p1: Math.atan2(piece.x - c.x, piece.z - c.z), p2: Math.hypot(piece.x - c.x, piece.z - c.z) };
    await steps(b, press(130));
    await until(() => plotState(plot).hookType === 'panel');
    expect(worldOf(server).state.pieces.size).toBe(0); // hooked pieces leave the schema
    const t0 = Date.now();
    a.send('crew', { op: 'remove', member: b.welcome.sessionId });
    expect((await b.waitFor('machineExit')).reason).toBe('leftCrew');
    expect(Date.now() - t0).toBeLessThan(2000);
    await until(() => worldOf(server).state.pieces.size === 1);
    expect(plotState(plot).hookType).toBe('');
    expect([...sys().pieces.values()][0]!.state).toBe('loose');
    expect(sys().machines.audit.heldPiecesLost).toBe(0);
    await sleep(1100);
    expect(sys().machines.audit.heldPiecesLost).toBe(0);
    expect(sys().machines.audit.machineOutsiderOps).toBe(0);
    await a.leave();
    await b.leave();
  }, 20_000);

  it('put out on disconnect and after the idle limit', async () => {
    server = await boot({ timers: { machineIdleS: 2, reconnectGraceS: 5 } });
    const a = await joinPlayer(server);
    const plot = await host(a);
    expect(await enter(a, plot, 'mixer')).toBe('entered');
    await steps(a, hold(6, { dx: 0 }));
    expect((await a.waitFor('machineExit', undefined, 5000)).reason).toBe('idle');
    await sleep(600);
    expect(await enter(a, plot, 'mixer')).toBe('entered');
    const pid = a.welcome.sessionId;
    await a.leave(false);
    await until(() => rec(plot, 'mixer').operator === '', 2000);
    expect(worldOf(server).sessions.get(pid)?.machine ?? -1).toBe(-1);
  }, 15_000);

  it('adoption: the new crew may get in, the old Host may not', async () => {
    server = await boot({ timers: { unattendedAfterS: 1 } });
    const a = await joinPlayer(server);
    const n = await joinPlayer(server);
    const plot = await host(a);
    a.send('crew', { op: 'leave' });
    await until(() => plotState(plot).state === 'unattended', 4000);
    put(n, SITE.foreman.x, SITE.foreman.z + 1);
    n.send('foreman', { op: 'adopt', plot });
    await n.waitFor('foreman', (r) => r.result === 'adopted');
    expect(await enter(n, plot, 'excavator')).toBe('entered');
    expect(await enter(a, plot, 'forklift')).toBe('notCrew');
    await a.leave();
    await n.leave();
  });

  it('an outsider on the pad does not block the hook; machine intent floods get slowDown and strikes', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const o = await joinPlayer(server);
    const plot = await host(a);
    const pad = SITE.machines[plot]!.hookPad;
    S(a).worker.carrying = 'brick';
    put(a, pad.x, pad.z - 0.6);
    a.send('toss', { charge: 0 });
    await until(() => sys().pieces.size === 1, 3000);
    const piece = [...sys().pieces.values()][0]!;
    put(o, piece.x, piece.z); // standing right on it
    expect(await enter(a, plot, 'crane')).toBe('entered');
    const c = SITE.machines[plot]!.crane;
    const r = rec(plot, 'crane');
    r.state = { ...r.state, p1: Math.atan2(piece.x - c.x, piece.z - c.z), p2: Math.hypot(piece.x - c.x, piece.z - c.z) };
    await steps(a, press(70));
    await until(() => plotState(plot).hookType === 'brick');
    expect(S(o).worker.x).toBe(piece.x);
    // flood
    for (let i = 0; i < 20; i++) o.send('machine', { op: 'enter', id: machineId(plot, 'mixer') });
    await o.waitFor('slowDown');
    expect(S(o).strikes.times.length).toBeGreaterThan(5);
    await a.leave();
    await o.leave();
  });

});

it('attributes immediate mix start to its actor and never credits a later seat occupant for mixDone', async () => {
  server = await boot();
  const a = await joinPlayer(server), b = await joinPlayer(server);
  const plot = await host(a, { groundwork: true });
  a.send('crew', { op: 'mode', mode: 'open' });
  await until(() => plotState(plot).joinMode === 'open');
  b.send('crew', { op: 'request', plot });
  await b.waitFor('requestResult', r => r.result === 'joined');
  sys().plots[plot]!.mixerBags = 1;
  sys().machines.syncMixerLoad(plot);
  sys().syncPlot(plot);
  expect(await enter(a, plot, 'mixer')).toBe('entered');
  await steps(a, press(6));
  const started = await a.waitFor('machineAct', e => e.act === 'mixStart');
  a.send('machine', { op: 'exit' });
  await until(() => S(a).machine === -1);
  expect(await enter(b, plot, 'mixer')).toBe('entered');
  expect(started.by).toBe(a.welcome.sessionId);
  expect((await b.waitFor('machineAct', e => e.act === 'mixDone', 8000)).by).toBeNull();
  await a.leave(); await b.leave();
}, 15_000);
