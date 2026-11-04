import { afterEach, describe, expect, it } from 'vitest';
import { CLOSE } from '@hht/shared';
import type { RunningServer } from '../src/server.ts';
import { boot, joinPlayer, newKey, sleep, until, worldOf } from './helpers.ts';

let server: RunningServer;
afterEach(async () => {
  await server?.close();
});

describe('reconnect, resume and idle', () => {
  it('a new join with the same key within the grace period resumes the same worker', async () => {
    server = await boot({ timers: { reconnectGraceS: 5 } });
    const key = newKey();
    const a = await joinPlayer(server, { key, name: 'Sunny Bolt' });
    const first = a.welcome;
    await a.leave(false); // drop without consent (like closing a laptop / reloading)
    await until(() => [...worldOf(server).sessions.values()][0]?.state === 'away');
    const again = await joinPlayer(server, { key, name: 'Sunny Bolt' });
    expect(again.welcome.resumed).toBe(true);
    expect(again.welcome.sessionId).toBe(first.sessionId);
    expect(again.welcome.netId).toBe(first.netId);
    expect(worldOf(server).sessions.size).toBe(1);
    await again.leave();
  });

  it('after the grace period the player is removed and rejoins as a new arrival', async () => {
    server = await boot({ timers: { reconnectGraceS: 1 } });
    const key = newKey();
    const a = await joinPlayer(server, { key });
    await a.leave(false);
    await until(() => worldOf(server).sessions.size === 0, 5000);
    const b = await joinPlayer(server, { key });
    expect(b.welcome.resumed).toBe(false);
    expect(b.welcome.netId).not.toBe(a.welcome.netId);
    await b.leave();
  });

  it('a second tab with the same key is a separate worker with a suffixed name', async () => {
    server = await boot();
    const key = newKey();
    const a = await joinPlayer(server, { key, name: 'Sunny Bolt' });
    const b = await joinPlayer(server, { key, name: 'Sunny Bolt' });
    expect(b.welcome.sessionId).not.toBe(a.welcome.sessionId);
    expect(b.welcome.name).not.toBe(a.welcome.name);
    await a.leave();
    await b.leave();
  });

  it('idle players are removed with close code 4002', async () => {
    server = await boot({ timers: { idleKickS: 1 } });
    const a = await joinPlayer(server);
    await sleep(2600);
    await until(() => a.closedWith !== null, 3000);
    expect(a.closedWith).toBe(CLOSE.idle);
  });
});
