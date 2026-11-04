import { NET, type EntityRecord, type PieceTypeId } from '@hht/shared';

/** A remote worker pose at one server time. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: number;
  carry: PieceTypeId | null;
  emoting: boolean;
}

interface Sample {
  t: number;
  pose: Pose;
}

const TAU = Math.PI * 2;
const lerpAngle = (a: number, b: number, k: number): number => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * k;
};

/** Interpolation delay for the observed update interval: tier 1/2/3 → 100/180/320 ms (research R4). */
export function delayForInterval(intervalMs: number): number {
  const [d1, d2, d3] = NET.interpDelayMs;
  return intervalMs <= 75 ? d1 : intervalMs <= 150 ? d2 : d3;
}

/**
 * Per-entity snapshot ring. Rendered `delay` ms behind the server clock; the delay follows the
 * entity's update rate (tier) and eases between tiers so a tier change never jumps. Extrapolates
 * up to 200 ms when samples run out, then holds still.
 */
export class EntityBuffer {
  private readonly samples: Sample[] = [];
  private interval = 50;
  delay: number = NET.interpDelayMs[0];
  lastSampleAt = 0;

  push(t: number, rec: EntityRecord | Pose): void {
    const last = this.samples[this.samples.length - 1];
    if (last && t <= last.t) return;
    if (last) this.interval = this.interval * 0.7 + (t - last.t) * 0.3;
    this.samples.push({ t, pose: { x: rec.x, y: rec.y, z: rec.z, yaw: rec.yaw, anim: rec.anim, carry: rec.carry, emoting: rec.emoting } });
    if (this.samples.length > 32) this.samples.shift();
    this.lastSampleAt = t;
  }

  /** Ease the delay toward the tier target (call once per frame). */
  updateDelay(dtMs: number): void {
    const target = delayForInterval(this.interval);
    const k = Math.min(1, dtMs / 400);
    this.delay += (target - this.delay) * k;
  }

  get size(): number {
    return this.samples.length;
  }

  /** Writes the pose at `serverNow − delay` into `out`; false when there is nothing to show. */
  sample(serverNow: number, out: Pose): boolean {
    const s = this.samples;
    if (!s.length) return false;
    const rt = serverNow - this.delay;
    const first = s[0] as Sample;
    if (rt <= first.t) {
      Object.assign(out, first.pose);
      return true;
    }
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1] as Sample;
      const b = s[i] as Sample;
      if (rt >= a.t && rt <= b.t) {
        const k = (rt - a.t) / Math.max(1e-6, b.t - a.t);
        out.x = a.pose.x + (b.pose.x - a.pose.x) * k;
        out.y = a.pose.y + (b.pose.y - a.pose.y) * k;
        out.z = a.pose.z + (b.pose.z - a.pose.z) * k;
        out.yaw = lerpAngle(a.pose.yaw, b.pose.yaw, k);
        const near = k < 0.5 ? a.pose : b.pose;
        out.anim = near.anim;
        out.carry = b.pose.carry;
        out.emoting = near.emoting;
        return true;
      }
    }
    // past the newest sample: bounded extrapolation, then hold
    const b = s[s.length - 1] as Sample;
    const a = s.length > 1 ? (s[s.length - 2] as Sample) : b;
    const ahead = Math.min(rt - b.t, NET.extrapolateMaxMs);
    const span = Math.max(1, b.t - a.t);
    const k = a === b ? 0 : ahead / span;
    out.x = b.pose.x + (b.pose.x - a.pose.x) * k;
    out.y = b.pose.y + (b.pose.y - a.pose.y) * k;
    out.z = b.pose.z + (b.pose.z - a.pose.z) * k;
    out.yaw = b.pose.yaw;
    out.anim = b.pose.anim;
    out.carry = b.pose.carry;
    out.emoting = b.pose.emoting;
    return true;
  }
}
