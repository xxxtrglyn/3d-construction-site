import type { CarryPose } from '@hht/shared';

/** Procedural worker animation state (ported from WorkerView so the crowd matches the player). */
export interface AnimState {
  phase: number;
  t: number;
  squash: number;
  flick: number;
}

export type CrowdPose = 'idle' | 'walk' | 'run' | 'air' | 'cheer' | 'wave' | 'dance' | 'point' | 'thumbsUp' | 'seated';

export interface PartPose {
  legL: number;
  legR: number;
  armL: [number, number];
  armR: [number, number];
  bob: number;
  /** extra body yaw (dance) */
  twist: number;
  /** vertical scale squash (jump landing) */
  squash: number;
}

export function newAnimState(seed = 0): AnimState {
  return { phase: seed * 1.7, t: seed * 0.37, squash: 0, flick: 0 };
}

/** Advances `a` and writes the part rotations for this frame into `out`. */
export function animate(a: AnimState, dt: number, pose: CrowdPose, speed: number, carry: CarryPose | null, out: PartPose): PartPose {
  a.t += dt;
  const moving = pose === 'walk' || pose === 'run';
  a.phase += dt * (moving ? 3.2 + speed * 1.6 : 0);
  const swing = moving ? Math.sin(a.phase) * (pose === 'run' ? 0.75 : 0.5) : 0;
  out.bob = moving ? Math.abs(Math.sin(a.phase)) * 0.05 : Math.sin(a.t * 2.2) * 0.012;
  a.squash = Math.max(0, a.squash - dt * 4);
  a.flick = Math.max(0, a.flick - dt * 5);
  out.squash = Math.sin(a.squash * Math.PI) * 0.12;
  out.legL = pose === 'air' ? -0.5 : swing;
  out.legR = pose === 'air' ? 0.3 : -swing;
  out.twist = 0;
  let al = -swing * 0.8;
  let ar = swing * 0.8;
  let zl = 0;
  let zr = 0;
  if (carry === 'twoHands' || carry === 'hug') {
    al = ar = -1.35;
    zl = carry === 'hug' ? 0.35 : 0.15;
    zr = -zl;
  } else if (carry === 'shoulder') {
    ar = -2.6;
    al = -swing * 0.5;
  }
  const w = Math.sin(a.t * 10) * 0.25;
  switch (pose) {
    case 'cheer':
      al = -2.9 + w;
      ar = -2.9 - w;
      zl = 0.25;
      zr = -0.25;
      break;
    case 'wave':
      ar = -2.7;
      zr = -0.35 + Math.sin(a.t * 12) * 0.45;
      break;
    case 'dance': {
      const d = Math.sin(a.t * 7);
      al = -1.6 + d * 0.8;
      ar = -1.6 - d * 0.8;
      zl = 0.5;
      zr = -0.5;
      out.legL = d * 0.4;
      out.legR = -d * 0.4;
      out.twist = d * 0.35;
      out.bob = Math.abs(d) * 0.08;
      break;
    }
    case 'point':
      ar = -1.55;
      zr = 0;
      break;
    case 'thumbsUp':
      ar = -1.9;
      zr = -0.2;
      al = -0.2;
      break;
    case 'seated':
      // feature 003: an operator in a cab — legs forward, hands on the controls
      out.legL = out.legR = -1.35;
      out.bob = 0;
      al = ar = -1.15 + Math.sin(a.t * 3) * 0.04;
      zl = 0.12;
      zr = -0.12;
      break;
    default:
      break;
  }
  if (a.flick > 0) ar = -2.2 * a.flick;
  out.armL = [al, zl];
  out.armR = [ar, zr];
  return out;
}
