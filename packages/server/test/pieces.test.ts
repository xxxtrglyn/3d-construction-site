import { afterEach, describe, expect, it } from 'vitest';
import { SITE } from '@hht/shared';
import type { RunningServer } from '../src/server.ts';
import { boot, joinPlayer, sleep, until, worldOf } from './helpers.ts';

let server: RunningServer;
afterEach(async () => {
  await server?.close();
});

const sessionOf = (server: RunningServer, pid: string) => worldOf(server).sessions.get(pid)!;
const put = (server: RunningServer, pid: string, x: number, z: number, facing = 0) => {
  const s = sessionOf(server, pid);
  s.worker = { ...s.worker, x, z, facing };
};
const rack = SITE.racks.find((r) => r.type === 'brick')!;

describe('pieces', () => {
  it('grabs from a rack in range; out of range does nothing (strike)', async () => {
    server = await boot();
    const p = await joinPlayer(server);
    put(server, p.welcome.sessionId, rack.x + 30, rack.z);
    p.send('grab', { target: { kind: 'rack', rack: rack.index } });
    await sleep(150);
    expect(sessionOf(server, p.welcome.sessionId).worker.carrying).toBeNull();
    expect(sessionOf(server, p.welcome.sessionId).strikes.times.length).toBe(1);
    put(server, p.welcome.sessionId, rack.x + 1, rack.z);
    p.send('grab', { target: { kind: 'rack', rack: rack.index } });
    await until(() => sessionOf(server, p.welcome.sessionId).worker.carrying === 'brick');
    await until(() => p.lastSnap()?.own.carrying === 'brick');
    await p.leave();
  });

  it('two simultaneous grabs of one loose piece: exactly one holds it', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const b = await joinPlayer(server);
    const w = worldOf(server);
    put(server, a.welcome.sessionId, 5, 12, 0);
    sessionOf(server, a.welcome.sessionId).worker.carrying = 'brick';
    a.send('drop', {});
    await until(() => w.systems.pieces.size === 1);
    const id = [...w.systems.pieces.keys()][0]!;
    const pc = w.systems.pieces.get(id)!;
    put(server, a.welcome.sessionId, pc.x + 0.3, pc.z);
    put(server, b.welcome.sessionId, pc.x - 0.3, pc.z);
    a.send('grab', { target: { kind: 'piece', id } });
    b.send('grab', { target: { kind: 'piece', id } });
    await sleep(200);
    const holders = [a, b].filter((p) => sessionOf(server, p.welcome.sessionId).worker.carrying === 'brick');
    expect(holders).toHaveLength(1);
    expect(w.systems.pieces.size).toBe(0);
    await a.leave();
    await b.leave();
  });

  it('flying pieces cannot be grabbed; a toss lands and becomes loose', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const w = worldOf(server);
    put(server, a.welcome.sessionId, 5, 12, 0);
    sessionOf(server, a.welcome.sessionId).worker.carrying = 'paint';
    a.send('toss', { charge: 1 });
    await until(() => w.systems.pieces.size === 1);
    const pc = [...w.systems.pieces.values()][0]!;
    expect(pc.state).toBe('flying');
    a.send('grab', { target: { kind: 'piece', id: pc.id } });
    await sleep(100);
    expect(sessionOf(server, a.welcome.sessionId).worker.carrying).toBeNull();
    await until(() => [...w.systems.pieces.values()][0]?.state === 'loose', 3000);
    await a.leave();
  });

  it('pieces dropped into the plaza fade at once', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    put(server, a.welcome.sessionId, 0, 0, 0);
    sessionOf(server, a.welcome.sessionId).worker.carrying = 'brick';
    a.send('drop', {});
    await sleep(150);
    expect(worldOf(server).systems.pieces.size).toBe(0);
    await a.leave();
  });

  it('keeps at most maxLoose pieces (oldest first) and fades untouched pieces', async () => {
    server = await boot({ maxLoose: 3, timers: { looseFadeS: 1 } });
    const a = await joinPlayer(server);
    const w = worldOf(server);
    for (let i = 0; i < 5; i++) {
      put(server, a.welcome.sessionId, 5 + i, 12, 0);
      sessionOf(server, a.welcome.sessionId).worker.carrying = 'brick';
      a.send('drop', {});
      await sleep(120);
    }
    expect(w.systems.pieces.size).toBe(3);
    await until(() => w.systems.pieces.size === 0, 3000);
    await a.leave();
  });

  it('a held piece drops where the worker stood when the player disconnects', async () => {
    server = await boot({ timers: { reconnectGraceS: 1 } });
    const a = await joinPlayer(server);
    put(server, a.welcome.sessionId, 6, 13, 0);
    sessionOf(server, a.welcome.sessionId).worker.carrying = 'beam';
    await a.leave(false);
    await until(() => worldOf(server).systems.pieces.size === 1);
    const pc = [...worldOf(server).systems.pieces.values()][0]!;
    expect(pc.type).toBe('beam');
    expect(Math.hypot(pc.x - 6, pc.z - 13)).toBeLessThan(0.01);
  });
});
