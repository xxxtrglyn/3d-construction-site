import { afterEach, describe, expect, it } from 'vitest';
import type { RunningServer } from '../src/server.ts';
import { boot, joinPlayer, until, worldOf } from './helpers.ts';

let server: RunningServer;
afterEach(async () => {
  await server?.close();
});

describe('joining worlds', () => {
  it('two players land in world 1 and see each other; duplicate names get a suffix', async () => {
    server = await boot();
    const a = await joinPlayer(server, { name: 'Sunny Bolt' });
    const b = await joinPlayer(server, { name: 'Sunny Bolt' });
    expect(a.worldId).toBe(1);
    expect(b.worldId).toBe(1);
    expect(b.welcome.name).not.toBe('Sunny Bolt');
    await until(() => (a.room.state as { players: Map<string, unknown> }).players.size === 2 && (b.room.state as { players: Map<string, unknown> }).players.size === 2);
    await a.leave();
    await b.leave();
  });

  it('the 3rd player goes to world 2 when the cap is 2; invites to a full world are redirected', async () => {
    server = await boot({ maxPlayers: 2 });
    const a = await joinPlayer(server);
    const b = await joinPlayer(server);
    const c = await joinPlayer(server);
    expect([a.worldId, b.worldId, c.worldId]).toEqual([1, 1, 2]);
    const d = await joinPlayer(server, { world: 1 });
    expect(d.worldId).toBe(2);
    expect(d.redirected).toBe(true);
    const e = await joinPlayer(server, { world: 2 });
    expect(e.redirected).toBe(true); // world 2 is full too → world 3
    expect(e.worldId).toBe(3);
    for (const p of [a, b, c, d, e]) await p.leave();
  });

  it('an empty overflow world closes after the dispose timeout', async () => {
    server = await boot({ maxPlayers: 1, timers: { overflowDisposeS: 1 } });
    const a = await joinPlayer(server);
    const b = await joinPlayer(server);
    expect(b.worldId).toBe(2);
    await b.leave();
    await until(() => !server.ctx.worlds.has(2), 6000);
    expect(server.ctx.worlds.has(1)).toBe(true);
    await a.leave();
  });

  it('shuffleName updates the name for everyone', async () => {
    server = await boot();
    const a = await joinPlayer(server, { name: 'Sunny Bolt' });
    a.send('shuffleName', { name: 'Jolly Rivet' });
    await until(() => [...worldOf(server).sessions.values()][0]!.name === 'Jolly Rivet');
    await a.leave();
  });
});
