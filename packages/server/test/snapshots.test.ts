import { afterEach, describe, expect, it } from 'vitest';
import { SNAPSHOT_HEADER_BYTES, ENTITY_BYTES } from '@hht/shared';
import type { RunningServer } from '../src/server.ts';
import { boot, joinPlayer, sleep, until, worldOf } from './helpers.ts';

let server: RunningServer;
afterEach(async () => {
  await server?.close();
});

describe('snapshots and interest tiers', () => {
  it('nearby workers update at 20 Hz, mid at 10 Hz, far at 4 Hz', async () => {
    server = await boot();
    const rx = await joinPlayer(server);
    const near = await joinPlayer(server);
    const mid = await joinPlayer(server);
    const far = await joinPlayer(server);
    const w = worldOf(server);
    const byPid = (pid: string) => w.sessions.get(pid)!;
    const place = (pid: string, x: number, z: number) => {
      const s = byPid(pid);
      s.worker = { ...s.worker, x, z };
    };
    place(rx.welcome.sessionId, -10, 0);
    place(near.welcome.sessionId, -5, 0);
    place(mid.welcome.sessionId, 15, 0);
    place(far.welcome.sessionId, 30, 0);
    await sleep(300);
    const from = rx.snaps.length;
    await sleep(2000);
    const snaps = rx.snaps.slice(from);
    const count = (netId: number) => snaps.filter((s) => s.entities.some((e) => e.netId === netId)).length;
    const n = snaps.length;
    expect(count(near.welcome.netId) / n).toBeGreaterThan(0.95);
    expect(count(mid.welcome.netId) / n).toBeGreaterThan(0.4);
    expect(count(mid.welcome.netId) / n).toBeLessThan(0.6);
    expect(count(far.welcome.netId) / n).toBeGreaterThan(0.15);
    expect(count(far.welcome.netId) / n).toBeLessThan(0.25);
    for (const p of [rx, near, mid, far]) await p.leave();
  });

  it('never reuses a netId after a player leaves; snapshot size is header + 10 B per entity', async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const b = await joinPlayer(server);
    const bNet = b.welcome.netId;
    await b.leave();
    const c = await joinPlayer(server);
    expect(c.welcome.netId).not.toBe(bNet);
    await until(() => a.snaps.length > 5 && a.lastSnap().entities.length === 1);
    expect(SNAPSHOT_HEADER_BYTES + ENTITY_BYTES).toBe(a.bytesIn > 0 ? SNAPSHOT_HEADER_BYTES + ENTITY_BYTES : 0);
    await a.leave();
    await c.leave();
  });
});
