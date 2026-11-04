import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOVE, SIM_DT, SITE, initialWorker, stepWorker, type MoveInput } from '@hht/shared';
import type { RunningServer } from '../src/server.ts';
import { boot, joinPlayer, sleep, until, worldOf } from './helpers.ts';

let server: RunningServer;
beforeEach(async () => {
  server = await boot();
});
afterEach(async () => {
  await server.close();
});

describe('server-authoritative movement', () => {
  it('matches a local replay of the same inputs bit for bit, and acks the last seq', async () => {
    const p = await joinPlayer(server);
    const inputs: Array<Partial<MoveInput>> = [];
    for (let i = 0; i < 90; i++) inputs.push({ dx: i < 60 ? 120 : 0, dz: i % 3 === 0 ? 40 : -20, run: i > 30, jump: i === 45 });
    for (let k = 0; k < inputs.length; k += 6) {
      p.move(inputs.slice(k, k + 6));
      await sleep(110); // stay inside the 60/s budget
    }
    await until(() => p.lastSnap()?.ackSeq === 90);
    let local = initialWorker(SITE.spawn);
    for (let i = 0; i < 90; i++) local = stepWorker(local, { seq: i + 1, dx: 0, dz: 0, run: false, jump: false, act: false, alt: false, ...inputs[i] }, SIM_DT, SITE);
    const own = p.lastSnap().own;
    expect({ ...own, facing: 0 }).toEqual({ ...local, facing: 0 });
    await p.leave();
  });

  it('drops inputs beyond the 60/s budget (+12 burst) so nobody can run faster than 5.5 m/s', async () => {
    const p = await joinPlayer(server);
    const s = [...worldOf(server).sessions.values()][0]!;
    const start = { ...s.worker };
    const t0 = Date.now();
    for (let k = 0; k < 20; k++) p.move(Array.from({ length: 12 }, () => ({ dx: 127, run: true }))); // 240 inputs at once
    await sleep(400);
    const dt = (Date.now() - t0) / 1000;
    const dist = Math.hypot(s.worker.x - start.x, s.worker.z - start.z);
    expect(dist).toBeLessThanOrEqual(MOVE.runSpeed * (dt + 12 / 60) + 0.05);
    expect(s.strikes.times.length).toBeGreaterThan(0);
    await p.leave();
  });

  it('respawn teleports to the spawn and sends a correction', async () => {
    const p = await joinPlayer(server);
    const s = [...worldOf(server).sessions.values()][0]!;
    s.worker = { ...s.worker, x: 10, z: 10 };
    p.send('respawn', {});
    const c = await p.waitFor('correction');
    expect(c.reason).toBe('respawn');
    expect(s.worker.x).toBe(SITE.spawn.x);
    expect(s.worker.z).toBe(SITE.spawn.z);
    await p.leave();
  });
});
