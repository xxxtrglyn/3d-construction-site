import { describe, expect, it } from 'vitest';
import { NET, SITE, machineId, parkedState, type MachineRecord } from '@hht/shared';
import { MachineViews, type MachineViewPose } from '../src/machines/machineViews.ts';

const rec = (id: number, o: Partial<MachineRecord>): MachineRecord => ({ id, x: 0, z: 0, yaw: 0, p1: 0, p2: 0, p3: 0, operator: false, loadCode: 0, phase: 'idle', ...o });
const out = (): MachineViewPose => ({ id: 0, kind: 'crane', x: 0, z: 0, yaw: 0, p1: 0, p2: 0, p3: 0, phase: 'idle', operator: false, loadCode: 0 });

describe('MachineViews', () => {
  it('shows the parked pose before any record arrives', () => {
    const v = new MachineViews();
    const id = machineId(4, 'forklift');
    const p = parkedState(id, SITE.machines[4]!);
    const o = v.sample(id, 1000, 0, 0, out());
    expect(o).toMatchObject({ kind: 'forklift', x: p.x, z: p.z, operator: false });
  });
  it('interpolates behind the server clock and unwraps angles across ±π', () => {
    const v = new MachineViews();
    const id = machineId(0, 'crane');
    const c = SITE.machines[0]!.crane;
    v.push(1000, rec(id, { x: c.x, z: c.z, p1: 3.1 }));
    v.push(1050, rec(id, { x: c.x, z: c.z, p1: -3.1 }));
    const delay = NET.interpDelayMs[0]!;
    const o = v.sample(id, 1025 + delay, c.x, c.z, out());
    // halfway along the short arc through π, not through 0
    expect(Math.abs(Math.abs(o.p1) - Math.PI)).toBeLessThan(0.01);
  });
  it('holds the newest pose (no extrapolation) and does not smear motion over a keyframe gap', () => {
    const v = new MachineViews();
    const id = machineId(0, 'excavator');
    v.push(1000, rec(id, { x: 10 }));
    v.push(3000, rec(id, { x: 12 })); // first record after 2 s of keyframes
    const delay = NET.interpDelayMs[0]!;
    expect(v.sample(id, 2500 + delay, 10, 0, out()).x).toBe(10);
    expect(v.sample(id, 9000, 10, 0, out()).x).toBe(12);
  });
});
