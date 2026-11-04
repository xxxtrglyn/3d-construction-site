import { SIM_DT, SITE, decodeMoveInputs, seqNewer, stepWorker, take, type ObstacleBox } from '@hht/shared';
import type { Session } from '../world/types.ts';
import { strike, type LimitsIo } from './limits.ts';

const MAX_QUEUE = 24;

/** Queues a binary input batch after validation and the move budget (60/s, burst 12). */
export function queueInputs(io: LimitsIo, s: Session, bytes: Uint8Array, now: number): void {
  const batch = decodeMoveInputs(bytes);
  if (!batch) {
    strike(io, s, now);
    return;
  }
  let dropped = false;
  for (const inp of batch) {
    const last = s.inputs.length ? (s.inputs[s.inputs.length - 1] as { seq: number }).seq : s.lastSeq;
    if ((s.hasSeq || s.inputs.length) && !seqNewer(inp.seq, last)) continue; // duplicate / rewind
    if (!take(s.buckets.move, now) || s.inputs.length >= MAX_QUEUE) {
      dropped = true;
      continue;
    }
    s.inputs.push(inp);
    if (inp.dx !== 0 || inp.dz !== 0 || inp.jump) s.lastActiveAt = now;
  }
  if (dropped) strike(io, s, now);
}

/** Drains the queue through the shared kinematics (one input = one 1/60 s step). */
export function simulate(s: Session, blockers: readonly ObstacleBox[]): void {
  for (const inp of s.inputs) {
    s.worker = stepWorker(s.worker, inp, SIM_DT, SITE, blockers);
    s.lastSeq = inp.seq;
    s.hasSeq = true;
  }
  s.inputs.length = 0;
}

export function teleport(s: Session, x: number, y: number, z: number): void {
  s.worker = { ...s.worker, x, y, z, vx: 0, vy: 0, vz: 0, grounded: true, coyote: 0.1, jumpBuffer: 0 };
  s.inputs.length = 0;
}
