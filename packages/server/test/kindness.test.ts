import { afterEach, describe, expect, it } from 'vitest';
import { SITE, neededSupplies } from '@hht/shared';
import type { RunningServer } from '../src/server.ts';
import { boot, joinPlayer, sleep, until, worldOf } from './helpers.ts';
import { helpersFor } from './world-helpers.ts';

let server: RunningServer;
const { S, put, host, dropAt, plotState, filledOf, progressOf } = helpersFor(() => server);
afterEach(async () => {
  await server?.close();
});

describe('supply bins, emotes and anti-griefing', () => {
  it('a non-crew delivery goes to the bin; a crew member takes it and the donor gets thanks', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const outsider = await joinPlayer(server);
    const plot = await host(a);
    const d = SITE.plots[plot]!;
    await dropAt(outsider, d.x, d.z, 'brick');
    await outsider.waitFor('binned');
    expect(Array.from(plotState(plot).bin)).toEqual(['brick']);
    expect(filledOf(plot)).toBe(0);
    put(a, d.bin.x, d.bin.z);
    a.send('grab', { target: { kind: 'bin', plot } });
    await until(() => S(a).worker.carrying === 'brick');
    const th = await outsider.waitFor('thanks');
    expect(th).toEqual({ plot, by: a.welcome.sessionId });
    // an outsider grabbing from the bin is a strike, not a piece
    await dropAt(outsider, d.bin.x, d.bin.z, 'beam');
    await outsider.waitFor('binned', () => true);
    put(outsider, d.bin.x, d.bin.z);
    outsider.send('grab', { target: { kind: 'bin', plot } });
    await sleep(200);
    expect(S(outsider).worker.carrying).toBeNull();
    expect(S(outsider).strikes.times.length).toBeGreaterThan(0);
    await a.leave();
    await outsider.leave();
  });

  it('a full bin pushes the piece out with a hint; cones never go into bins', async () => {
    server = await boot({ binCapacity: 1 });
    const a = await joinPlayer(server);
    const o = await joinPlayer(server);
    const plot = await host(a);
    const d = SITE.plots[plot]!;
    await dropAt(o, d.bin.x, d.bin.z, 'brick');
    await o.waitFor('binned');
    await dropAt(o, d.bin.x, d.bin.z, 'brick');
    expect((await o.waitFor('hint', (h) => h.kind === 'binFull')).kind).toBe('binFull');
    await dropAt(o, d.x, d.z, 'cone');
    expect((await o.waitFor('hint', (h) => h.kind === 'notCrew')).kind).toBe('notCrew');
    expect(plotState(plot).bin.length).toBe(1);
    await a.leave();
    await o.leave();
  });

  it('a bin takes only what the stage still needs: a 3rd brick for the Frame (2 bricks binned) is binNotNeeded and set down', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const o = await joinPlayer(server);
    const plot = await host(a);
    const d = SITE.plots[plot]!;
    // Frame (feature 004): beam×4 + brick×2
    for (let i = 1; i <= 2; i++) {
      await dropAt(o, d.bin.x, d.bin.z, 'brick');
      await until(() => plotState(plot).bin.length === i);
    }
    await dropAt(o, d.bin.x, d.bin.z, 'brick');
    expect(await o.waitFor('hint', (h) => h.kind === 'binNotNeeded')).toEqual({ kind: 'binNotNeeded', type: 'brick', needed: ['beam', 'brick'] });
    expect(Array.from(plotState(plot).bin)).toEqual(['brick', 'brick']);
    // the refused brick is not consumed: it lies loose on the ground outside the build zone
    const pcs = [...worldOf(server).systems.pieces.values()];
    expect(pcs).toHaveLength(1);
    expect(pcs[0]).toMatchObject({ type: 'brick', state: 'loose' });
    expect(Math.hypot(pcs[0]!.x - d.x, pcs[0]!.z - d.z)).toBeGreaterThan(d.buildZoneRadius);
    // a beam is still welcome
    await dropAt(o, d.bin.x, d.bin.z, 'beam');
    await until(() => plotState(plot).bin.length === 3);
    expect(o.events.filter((e) => e.type === 'hint')).toHaveLength(1);
    expect(filledOf(plot)).toBe(0);
    await a.leave();
    await o.leave();
  });

  it('bin pieces survive stage changes, and a crew pickup prefers a material the stage still needs', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const o = await joinPlayer(server);
    const plot = await host(a);
    const d = SITE.plots[plot]!;
    // donated during the Frame: a beam, then a brick (the most recent)
    await dropAt(o, d.bin.x, d.bin.z, 'beam');
    await dropAt(o, d.bin.x, d.bin.z, 'brick');
    await until(() => plotState(plot).bin.length === 2);
    // Frame → Walls & Floors → Roof & Windows (panel + beam): the brick is no longer needed
    for (let st = 1; st <= 2; st++) {
      await sleep(550);
      a.send('dev', { op: 'fillStage', plot });
      await until(() => plotState(plot).completedStages === st);
    }
    expect(Array.from(plotState(plot).bin)).toEqual(['beam', 'brick']);
    expect(neededSupplies(progressOf(plot))).toEqual(['panel', 'beam']);
    put(a, d.bin.x, d.bin.z);
    a.send('grab', { target: { kind: 'bin', plot } });
    await until(() => S(a).worker.carrying !== null);
    expect(S(a).worker.carrying).toBe('beam');
    expect(Array.from(plotState(plot).bin)).toEqual(['brick']);
    await a.leave();
    await o.leave();
  });

  it('emotes reach players within 35 m only; spamming gets slowDown', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const near = await joinPlayer(server);
    const far = await joinPlayer(server);
    put(a, -10, 0);
    put(near, -5, 0);
    put(far, 30, 0);
    a.send('emote', { id: 'wave' });
    const e = await near.waitFor('emote');
    expect(e).toEqual({ who: a.welcome.sessionId, id: 'wave', kind: 'emote' });
    a.send('say', { id: 'needBricks' });
    await near.waitFor('emote', (x) => x.kind === 'say');
    await sleep(200);
    expect(far.events.some((x) => x.type === 'emote')).toBe(false);
    for (let i = 0; i < 6; i++) a.send('emote', { id: 'cheer' });
    await a.waitFor('slowDown');
    for (const p of [a, near, far]) await p.leave();
  });

  it('a Host who hid a player answers that player as busy', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const b = await joinPlayer(server);
    const plot = await host(a);
    a.send('hide', { who: b.welcome.sessionId, hidden: true });
    await sleep(100);
    b.send('crew', { op: 'request', plot });
    expect((await b.waitFor('requestResult')).result).toBe('busy');
    await sleep(100);
    expect(a.events.some((e) => e.type === 'request')).toBe(false);
    await a.leave();
    await b.leave();
  });

  it('workers can stand on the same spot (no worker–worker collision)', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const b = await joinPlayer(server);
    put(a, 5, 12);
    put(b, 5, 12);
    a.move(Array.from({ length: 6 }, () => ({ dx: 0, dz: 0 })));
    b.move(Array.from({ length: 6 }, () => ({ dx: 0, dz: 0 })));
    await sleep(200);
    expect(Math.hypot(S(a).worker.x - S(b).worker.x, S(a).worker.z - S(b).worker.z)).toBeLessThan(1e-9);
    await a.leave();
    await b.leave();
  });
});
