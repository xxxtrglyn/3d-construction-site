import { afterEach, describe, expect, it } from 'vitest';
import { SITE } from '@hht/shared';
import type { RunningServer } from '../src/server.ts';
import { boot, joinPlayer, sleep, until } from './helpers.ts';
import { helpersFor } from './world-helpers.ts';

let server: RunningServer;
const { S, put, host, dropAt, plotState } = helpersFor(() => server);
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
    expect(plotState(plot).filledSlots).toBe(0);
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
