import {
  NET, SIM_DT, encodeMoveInputs, quantizeDir, seqDiff, stateError, stepWorker,
  type MoveInput, type ObstacleBox, type SiteLayout, type WorkerState,
} from '@hht/shared';

interface Entry {
  seq: number;
  input: MoveInput;
  state: WorkerState;
}

/**
 * Client-side prediction with server reconciliation (research R2). The local worker runs the same
 * deterministic `stepWorker()` as the server at 60 Hz; inputs are sent in batches; when a snapshot's
 * state for `ackSeq` differs from our stored prediction by > 2 cm, we reset to it and replay the
 * unacknowledged inputs. Only the rendered offset is blended out (150 ms).
 */
export class Predictor {
  state: WorkerState;
  prev: WorkerState;
  private seq = 1;
  private acc = 0;
  private readonly history: Entry[] = [];
  private pending: MoveInput[] = [];
  private jumpQueued = false;
  readonly offset = { x: 0, y: 0, z: 0 };
  corrections = 0;
  /** acks for inputs we no longer have (e.g. right after a hard reset) */
  missingAcks = 0;
  private readonly site: SiteLayout;

  constructor(initial: WorkerState, site: SiteLayout) {
    this.state = initial;
    this.prev = initial;
    this.site = site;
  }

  requestJump(): void {
    this.jumpQueued = true;
  }

  /** Advance by real time `dt` (s) with a world-space wish direction (|v| ≤ 1). Returns steps taken. */
  update(dt: number, dirX: number, dirZ: number, run: boolean, blockers: readonly ObstacleBox[]): number {
    this.acc = Math.min(this.acc + dt, SIM_DT * 6);
    const q = quantizeDir(dirX, dirZ);
    let steps = 0;
    while (this.acc >= SIM_DT) {
      this.acc -= SIM_DT;
      const input: MoveInput = { seq: this.seq, dx: q.dx, dz: q.dz, run, jump: this.jumpQueued };
      this.jumpQueued = false;
      this.seq = (this.seq + 1) & 0xffff;
      this.prev = this.state;
      this.state = stepWorker(this.state, input, SIM_DT, this.site, blockers);
      this.history.push({ seq: input.seq, input, state: this.state });
      if (this.history.length > 120) this.history.shift();
      this.pending.push(input);
      steps++;
    }
    const decay = Math.exp((-dt * 1000) / (NET.correctionBlendMs / 4));
    this.offset.x *= decay;
    this.offset.y *= decay;
    this.offset.z *= decay;
    return steps;
  }

  /** Render interpolation factor between `prev` and `state`. */
  get alpha(): number {
    return this.acc / SIM_DT;
  }

  /** Encoded batches of pending inputs (≤ 12 each), cleared. */
  takeBatches(): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (let i = 0; i < this.pending.length; i += 12) out.push(encodeMoveInputs(this.pending.slice(i, i + 12)));
    this.pending = [];
    return out;
  }

  /** Reconcile with the authoritative state after input `ackSeq`. Returns true if a correction happened. */
  reconcile(ackSeq: number, server: WorkerState, blockers: readonly ObstacleBox[]): boolean {
    // the server's carry state is authoritative (it changes speed)
    let idx = -1;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if ((this.history[i] as Entry).seq === ackSeq) {
        idx = i;
        break;
      }
    }
    const predicted = idx >= 0 ? (this.history[idx] as Entry).state : null;
    const unacked = idx >= 0 ? this.history.slice(idx + 1) : this.history.filter((e) => seqDiff(e.seq, ackSeq) > 0);
    // keep the acked entry: ticks without new inputs re-ack the same seq
    if (idx > 0) this.history.splice(0, idx);
    const carryChanged = predicted !== null && predicted.carrying !== server.carrying;
    if (predicted && !carryChanged && stateError(predicted, server) <= NET.correctionEpsilon) return false;
    // replay from the authoritative state
    const before = this.state;
    let s: WorkerState = { ...server };
    for (const e of unacked) {
      s = stepWorker(s, e.input, SIM_DT, this.site, blockers);
      e.state = s;
    }
    this.state = s;
    this.prev = s;
    this.offset.x += before.x - s.x;
    this.offset.y += before.y - s.y;
    this.offset.z += before.z - s.z;
    if (!predicted) this.missingAcks++;
    else if (!carryChanged) this.corrections++;
    return true;
  }

  /** Hard reset without blending (respawn / cheating correction). */
  snapTo(server: WorkerState, ackSeq?: number): void {
    // replay inputs the server has not processed yet so a hard reset does not lose them
    const unacked = ackSeq === undefined ? [] : this.history.filter((e) => seqDiff(e.seq, ackSeq) > 0);
    let s: WorkerState = { ...server };
    this.history.length = 0;
    for (const e of unacked) {
      s = stepWorker(s, e.input, SIM_DT, this.site, []);
      this.history.push({ seq: e.seq, input: e.input, state: s });
    }
    this.state = s;
    this.prev = this.state;
    this.offset.x = this.offset.y = this.offset.z = 0;
  }
}
