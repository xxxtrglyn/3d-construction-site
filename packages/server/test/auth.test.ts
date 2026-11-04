import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLOSE, PROTOCOL_VERSION } from '@hht/shared';
import type { RunningServer } from '../src/server.ts';
import { boot, joinPlayer, matchmakeRaw, newKey, until, worldOf } from './helpers.ts';

let server: RunningServer;
beforeEach(async () => {
  server = await boot();
});
afterEach(async () => {
  await server.close();
});

describe('auth and welcome', () => {
  it('rejects a protocol mismatch with 426', async () => {
    const r = await matchmakeRaw(server.port, { protocol: PROTOCOL_VERSION + 1, playerKey: newKey(), name: 'Sunny Bolt', hatColor: 'teal' });
    expect(r.status).toBe(426);
    expect(r.body).toEqual({ error: 'protocol', server: PROTOCOL_VERSION });
  });

  it('rejects invalid names, colors and keys with 400', async () => {
    for (const body of [
      { name: 'Evil Person', hatColor: 'teal', playerKey: newKey() },
      { name: 'Sunny Bolt', hatColor: 'chartreuse', playerKey: newKey() },
      { name: 'Sunny Bolt', hatColor: 'teal', playerKey: 'nope' },
    ]) {
      const r = await matchmakeRaw(server.port, { protocol: PROTOCOL_VERSION, ...body });
      expect(r.status).toBe(400);
    }
  });

  it('sends welcome with the session, netId, world and server time', async () => {
    const t0 = Date.now();
    const p = await joinPlayer(server, { name: 'Jolly Rivet' });
    expect(p.welcome.worldId).toBe(1);
    expect(p.welcome.netId).toBeGreaterThan(0);
    expect(p.welcome.name).toBe('Jolly Rivet');
    expect(p.welcome.resumed).toBe(false);
    expect(Math.abs(p.welcome.serverNow - t0)).toBeLessThan(5000);
    await p.leave();
  });

  it('answers ping with pong', async () => {
    const p = await joinPlayer(server);
    p.send('ping', { c: 123 });
    const pong = await p.waitFor('pong');
    expect(pong.c).toBe(123);
    expect(pong.s).toBeGreaterThan(0);
    await p.leave();
  });

  it('counts invalid messages as strikes and disconnects with 4003 after 30 in 10 s', async () => {
    const p = await joinPlayer(server);
    const s = [...worldOf(server).sessions.values()][0]!;
    p.send('toss', { charge: 'lots' });
    await until(() => s.strikes.times.length === 1);
    for (let i = 0; i < 30; i++) p.send('emote', { id: 'rude' });
    await until(() => p.closedWith !== null);
    expect(p.closedWith).toBe(CLOSE.strikes);
  });

  it('streams binary snapshots to joined players', async () => {
    const p = await joinPlayer(server);
    await until(() => p.snaps.length >= 5);
    expect(p.lastSnap().own.y).toBe(0);
    await p.leave();
  });
});

describe('matchmake rate limit', () => {
  it('answers 429 after the per-IP limit', async () => {
    const s2 = await boot({ matchmakePerMin: 2 });
    try {
      const body = { protocol: PROTOCOL_VERSION, playerKey: newKey(), name: 'Sunny Bolt', hatColor: 'teal' };
      expect((await matchmakeRaw(s2.port, body)).status).toBe(200);
      expect((await matchmakeRaw(s2.port, body)).status).toBe(200);
      expect((await matchmakeRaw(s2.port, body)).status).toBe(429);
    } finally {
      await s2.close();
    }
  });
});
