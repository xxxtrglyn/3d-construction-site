import { NET, SITE, kindOfMachine, parkedState, plotOfMachine, tierFor, type MachinePhase, type MachineRecord, type SiteLayout, type Tier } from '@hht/shared';
import type { MachinePose } from './rig.ts';

/** An interpolated remote machine (contracts/debug-api.md → machines()). */
export interface MachineViewPose extends MachinePose {
  phase: MachinePhase;
  operator: boolean;
  loadCode: number;
}

interface Sample {
  t: number;
  r: MachineViewPose;
}

const TAU = Math.PI * 2;
/** shortest-arc unwrap of `b` next to `a` */
const unwrap = (a: number, b: number): number => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d;
};
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** Which rig parameters are angles (interpolated on the shortest arc) per kind. */
const ANGLE_P1 = { crane: true, excavator: true, forklift: false, mixer: true } as const;
const ANGLE_P2 = { crane: false, excavator: true, forklift: true, mixer: false } as const;

/**
 * Per-machine interpolation buffers fed by snapshot machine records (feature 003, research M3/M4).
 * Rendered `NET.interpDelayMs[tier]` behind the server clock, where the tier comes from the distance
 * to the viewer (records arrive at the tier rate, or every 2 s while unchanged). Angles are unwrapped
 * before interpolating. With no newer record the last pose holds (no extrapolation).
 */
export class MachineViews {
  private readonly bufs: Sample[][];
  private readonly site: SiteLayout;

  constructor(site: SiteLayout = SITE) {
    this.site = site;
    this.bufs = site.machines.flatMap(() => [[], [], [], []]);
  }

  get count(): number {
    return this.bufs.length;
  }

  push(t: number, rec: MachineRecord): void {
    const b = this.bufs[rec.id];
    if (!b) return;
    const last = b[b.length - 1];
    if (last && t <= last.t) return;
    const r: MachineViewPose = { id: rec.id, kind: kindOfMachine(rec.id), x: rec.x, z: rec.z, yaw: rec.yaw, p1: rec.p1, p2: rec.p2, p3: rec.p3, phase: rec.phase, operator: rec.operator, loadCode: rec.loadCode };
    // after a quiet spell (keyframes only) the motion starts now, not smeared over the gap
    if (last && t - last.t > 300) b.push({ t: t - 50, r: { ...last.r } });
    b.push({ t, r });
    while (b.length > 24) b.shift();
  }

  /** Pose at `serverNow` minus the tier delay for a viewer at (vx, vz). */
  sample(id: number, serverNow: number, vx: number, vz: number, out: MachineViewPose): MachineViewPose {
    const b = this.bufs[id];
    const plot = plotOfMachine(id);
    if (!b || !b.length) {
      const p = parkedState(id, this.site.machines[plot]!);
      Object.assign(out, { id, kind: p.kind, x: p.x, z: p.z, yaw: p.yaw, p1: p.p1, p2: p.p2, p3: p.p3, phase: 'idle', operator: false, loadCode: 0 });
      return out;
    }
    const first = b[0] as Sample;
    const tier = tierFor(Math.hypot(first.r.x - vx, first.r.z - vz)) as Tier;
    const rt = serverNow - (NET.interpDelayMs[tier - 1] ?? NET.interpDelayMs[0]);
    let a: Sample = first;
    let c: Sample = first;
    if (rt <= first.t) a = c = first;
    else {
      c = b[b.length - 1] as Sample;
      a = c;
      for (let i = b.length - 1; i > 0; i--) {
        const s0 = b[i - 1] as Sample;
        const s1 = b[i] as Sample;
        if (rt >= s0.t && rt <= s1.t) {
          a = s0;
          c = s1;
          break;
        }
      }
    }
    const k = a === c ? 1 : (rt - a.t) / Math.max(1e-6, c.t - a.t);
    const A = a.r;
    const C = c.r;
    out.id = id;
    out.kind = C.kind;
    out.x = lerp(A.x, C.x, k);
    out.z = lerp(A.z, C.z, k);
    out.yaw = lerp(A.yaw, unwrap(A.yaw, C.yaw), k);
    out.p1 = ANGLE_P1[C.kind] ? lerp(A.p1, unwrap(A.p1, C.p1), k) : lerp(A.p1, C.p1, k);
    out.p2 = ANGLE_P2[C.kind] ? lerp(A.p2, unwrap(A.p2, C.p2), k) : lerp(A.p2, C.p2, k);
    out.p3 = lerp(A.p3, C.p3, k);
    const near = k < 0.5 ? A : C;
    out.phase = near.phase;
    out.operator = C.operator;
    out.loadCode = C.loadCode;
    return out;
  }

  /** Drop buffered samples (reconnect, shift reset). */
  clear(): void {
    for (const b of this.bufs) b.length = 0;
  }
}
