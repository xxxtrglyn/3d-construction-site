import { afterEach, describe, expect, it } from 'vitest';
import { ANIM, ENTITY_BYTES, MACHINE_RECORD_BYTES, SITE, SNAPSHOT_HEADER_BYTES, machineId } from '@hht/shared';
import type { RunningServer } from '../src/server.ts';
import { boot, joinPlayer, sleep, until, worldOf } from './helpers.ts';
import { machineHelpersFor } from './machine-helpers.ts';

let server: RunningServer;
const mh = () => machineHelpersFor(() => server);
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

describe('machine records (protocol v2)', () => {
  it('an idle machine is sent only at its 2 s keyframe; a moving one at its tier rate; far machines less often', async () => {
    server = await boot();
    const rx = await joinPlayer(server);
    const w = worldOf(server);
    const s = w.sessions.get(rx.welcome.sessionId)!;
    const near = SITE.machines[0]!;
    s.worker = { ...s.worker, x: near.parking.forklift.x + 2, z: near.parking.forklift.z };
    const fork = machineId(0, 'forklift');
    const farMoving = machineId(6, 'forklift'); // opposite side of the island: tier 3
    const t0 = setInterval(() => {
      for (const id of [fork, farMoving]) {
        const r = w.systems.machines.recs[id]!;
        r.state = { ...r.state, yaw: r.state.yaw + 0.2 };
      }
    }, 50);
    await sleep(500);
    const from = rx.snaps.length;
    await sleep(4000);
    clearInterval(t0);
    const snaps = rx.snaps.slice(from);
    const count = (id: number) => snaps.filter((x) => x.machines.some((m) => m.id === id)).length;
    const n = snaps.length;
    expect(count(fork) / n).toBeGreaterThan(0.9); // moving, tier 1: every snapshot
    expect(count(farMoving) / n).toBeGreaterThan(0.12); // moving, tier 3: ~4 Hz
    expect(count(farMoving) / n).toBeLessThan(0.3);
    const idle = machineId(0, 'crane');
    expect(count(idle)).toBeGreaterThanOrEqual(1);
    expect(count(idle)).toBeLessThanOrEqual(3); // keyframes only (2 s)
    // records decode to the server state (cm / mrad quantization)
    const last = snaps.at(-1)!.machines.find((m) => m.id === idle) ?? snaps.flatMap((x) => x.machines).find((m) => m.id === idle)!;
    const st = w.systems.machines.recs[idle]!.state;
    expect(Math.abs(last.x - st.x)).toBeLessThan(0.006);
    expect(Math.abs(last.p2 - st.p2)).toBeLessThan(0.001);
    expect(last.operator).toBe(false);
    // 48 parked machines cost almost nothing: well under 1 KB/s of machine records
    const machineBytes = snaps.reduce((sum, x) => sum + x.machines.length * MACHINE_RECORD_BYTES, 0) / 4;
    expect(machineBytes).toBeLessThan(1500);
    await rx.leave();
  });

  it("the receiver's own machine goes only in ownMachine, others see it in the machine block", async () => {
    server = await boot();
    const a = await joinPlayer(server);
    const b = await joinPlayer(server);
    const { host, enter } = mh();
    const plot = await host(a);
    expect(await enter(a, plot, 'forklift')).toBe('entered');
    const id = machineId(plot, 'forklift');
    const w = worldOf(server);
    const sb = w.sessions.get(b.welcome.sessionId)!;
    sb.worker = { ...sb.worker, x: SITE.machines[plot]!.center.x, z: SITE.machines[plot]!.center.z };
    await until(() => a.lastSnap()?.ownMachine?.id === id);
    const from = a.snaps.length;
    await sleep(600);
    expect(a.snaps.slice(from).every((x) => x.ownMachine?.id === id && !x.machines.some((m) => m.id === id))).toBe(true);
    const om = a.lastSnap().ownMachine!;
    const st = w.systems.machines.recs[id]!.state;
    expect(om.x).toBeCloseTo(st.x, 4);
    expect(om.phase).toBe('idle');
    await until(() => b.snaps.some((x) => x.machines.some((m) => m.id === id && m.operator)), 3000);
    expect(b.lastSnap().ownMachine).toBeNull();
    // the seated worker is drawn with the seated anim
    await until(() => b.lastSnap().entities.some((e) => e.netId === a.welcome.netId && e.anim === ANIM.seated), 3000);
    await a.leave();
    await b.leave();
  });
});
