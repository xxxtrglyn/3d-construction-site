import {
  NET, SIM_DT, encodeMoveInputs, loadCode, machineError, quantizeDir, seqDiff, stateError, stepMachine, stepWorker,
  type MachineCtx, type MachineState, type MoveInput, type ObstacleBox, type SiteLayout, type WorkerState,
} from '@hht/shared';

interface Entry<S> {
  seq: number;
  input: MoveInput;
  state: S;
}

/**
 * One seq'd input stream per session (feature 003): the worker and the machine predictors take turns
 * producing inputs, so sequence numbers stay continuous across getting in and out.
 */
export class InputStream {
  seq = 1;
  pending: MoveInput[] = [];

  next(): number {
    const s = this.seq;
    this.seq = (this.seq + 1) & 0xffff;
    return s;
  }

  /** Encoded batches of pending inputs (≤ 12 each), cleared. */
  takeBatches(): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (let i = 0; i < this.pending.length; i += 12) out.push(encodeMoveInputs(this.pending.slice(i, i + 12)));
    this.pending = [];
    return out;
  }
}

/**
 * Client-side prediction with server reconciliation (research R2, M3), generic over the simulated
 * state: the local state runs the same deterministic step as the server at 60 Hz; when a snapshot's
 * state for `ackSeq` differs from the stored prediction by more than 2 cm (or an authoritative field
 * such as the carried piece or a machine load changed), we reset to it and replay the unacknowledged
 * inputs. Only the rendered offset is blended out (150 ms).
 */
export class ReplayPredictor<S extends { x: number; z: number }> {
  state: S;
  prev: S;
  protected acc = 0;
  protected readonly history: Array<Entry<S>> = [];
  readonly offset = { x: 0, y: 0, z: 0 };
  corrections = 0;
  /** acks for inputs we no longer have (e.g. right after a hard reset or a mode switch) */
  missingAcks = 0;
  readonly stream: InputStream;
  private readonly step: (s: S, input: MoveInput) => S;
  private readonly error: (a: S, b: S) => number;
  private readonly yOf: (s: S) => number;

  constructor(initial: S, stream: InputStream, step: (s: S, input: MoveInput) => S, error: (a: S, b: S) => number, yOf: (s: S) => number = () => 0) {
    this.state = initial;
    this.prev = initial;
    this.stream = stream;
    this.step = step;
    this.error = error;
    this.yOf = yOf;
  }

  /** Advance by real time `dt` (s), building one input per 60 Hz step. Returns steps taken. */
  protected advance(dt: number, make: (seq: number, first: boolean) => MoveInput): number {
    this.acc = Math.min(this.acc + dt, SIM_DT * 6);
    let steps = 0;
    while (this.acc >= SIM_DT) {
      this.acc -= SIM_DT;
      const input = make(this.stream.next(), steps === 0);
      this.prev = this.state;
      this.state = this.step(this.state, input);
      this.history.push({ seq: input.seq, input, state: this.state });
      if (this.history.length > 120) this.history.shift();
      this.stream.pending.push(input);
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
    return this.stream.takeBatches();
  }

  /**
   * Reconcile with the authoritative state after input `ackSeq`. `authoritativeChanged(pred, server)`
   * flags fields the server decides (carried piece, machine load): those force a silent replay.
   */
  protected reconcileWith(ackSeq: number, server: S, authoritativeChanged: (pred: S, server: S) => boolean): boolean {
    let idx = -1;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if ((this.history[i] as Entry<S>).seq === ackSeq) {
        idx = i;
        break;
      }
    }
    const predicted = idx >= 0 ? (this.history[idx] as Entry<S>).state : null;
    const unacked = idx >= 0 ? this.history.slice(idx + 1) : this.history.filter((e) => seqDiff(e.seq, ackSeq) > 0);
    // keep the acked entry: ticks without new inputs re-ack the same seq
    if (idx > 0) this.history.splice(0, idx);
    const changed = predicted !== null && authoritativeChanged(predicted, server);
    if (predicted && !changed && this.error(predicted, server) <= NET.correctionEpsilon) return false;
    // replay from the authoritative state
    const before = this.state;
    let s: S = { ...server };
    for (const e of unacked) {
      s = this.step(s, e.input);
      e.state = s;
    }
    this.state = s;
    this.prev = s;
    this.offset.x += before.x - s.x;
    this.offset.y += this.yOf(before) - this.yOf(s);
    this.offset.z += before.z - s.z;
    if (!predicted) this.missingAcks++;
    else if (!changed) this.corrections++;
    return true;
  }

  /** Hard reset without blending (respawn, getting in or out), replaying inputs the server has not processed. */
  snapTo(server: S, ackSeq?: number): void {
    const unacked = ackSeq === undefined ? [] : this.history.filter((e) => seqDiff(e.seq, ackSeq) > 0);
    let s: S = { ...server };
    this.history.length = 0;
    for (const e of unacked) {
      s = this.step(s, e.input);
      this.history.push({ seq: e.seq, input: e.input, state: s });
    }
    this.state = s;
    this.prev = this.state;
    this.offset.x = this.offset.y = this.offset.z = 0;
  }

  /** Forget the history (the other predictor owns the stream for a while). */
  clearHistory(): void {
    this.history.length = 0;
    this.acc = 0;
  }
}

/** The local worker (research R2): `stepWorker()` with world-space wish directions. */
export class Predictor extends ReplayPredictor<WorkerState> {
  private jumpQueued = false;
  private blockers: readonly ObstacleBox[] = [];

  constructor(initial: WorkerState, site: SiteLayout, stream: InputStream = new InputStream()) {
    super(initial, stream, (s, i) => stepWorker(s, i, SIM_DT, site, this.blockers), stateError, (s) => s.y);
  }

  requestJump(): void {
    this.jumpQueued = true;
  }

  /** Advance by real time `dt` (s) with a world-space wish direction (|v| ≤ 1). Returns steps taken. */
  update(dt: number, dirX: number, dirZ: number, run: boolean, blockers: readonly ObstacleBox[]): number {
    this.blockers = blockers;
    const q = quantizeDir(dirX, dirZ);
    return this.advance(dt, (seq) => {
      const input: MoveInput = { seq, dx: q.dx, dz: q.dz, run, jump: this.jumpQueued, act: false, alt: false };
      this.jumpQueued = false;
      return input;
    });
  }

  /** Reconcile with the authoritative state after input `ackSeq` (the server's carry state is authoritative). */
  reconcile(ackSeq: number, server: WorkerState, blockers: readonly ObstacleBox[]): boolean {
    this.blockers = blockers;
    return this.reconcileWith(ackSeq, server, (p, s) => p.carrying !== s.carrying);
  }
}

/**
 * The operated machine (feature 003, research M3): `stepMachine()` with raw stick axes; the pose is
 * predicted, discrete outcomes (loads, snaps) come from the server and are adopted silently.
 */
export class MachinePredictor extends ReplayPredictor<MachineState> {
  private actQueued = false;
  private altQueued = false;
  private readonly ctx: () => MachineCtx;

  constructor(initial: MachineState, stream: InputStream, ctx: () => MachineCtx) {
    super(initial, stream, (s, i) => stepMachine(s, i, SIM_DT, ctx()).state, machineError);
    this.ctx = ctx;
  }

  /**
   * `ax` = stick right (+1) / left, `az` = forward (+1) / back; `act`/`alt` are presses this frame
   * (queued to the next 60 Hz step if no step runs this frame). Jump (get out) is sent with `exitInput`.
   */
  update(dt: number, ax: number, az: number, act: boolean, alt: boolean): number {
    if (act) this.actQueued = true;
    if (alt) this.altQueued = true;
    const dx = Math.max(-127, Math.min(127, Math.round(ax * 127)));
    const dz = Math.max(-127, Math.min(127, Math.round(az * 127)));
    return this.advance(dt, (seq) => {
      const input: MoveInput = { seq, dx, dz, run: false, jump: false, act: this.actQueued, alt: this.altQueued };
      this.actQueued = false;
      this.altQueued = false;
      return input;
    });
  }

  /** The get-out step: a jump input the server applies at this exact seq. Returns its seq. */
  exitInput(): number {
    const input: MoveInput = { seq: this.stream.next(), dx: 0, dz: 0, run: false, jump: true, act: false, alt: false };
    this.stream.pending.push(input);
    this.clearHistory();
    return input.seq;
  }

  reconcile(ackSeq: number, server: MachineState): boolean {
    const sameLoad = (a: MachineState, b: MachineState): boolean => {
      if (loadCode(a.load) !== loadCode(b.load)) return false;
      if (a.load.kind === 'bags' && b.load.kind === 'bags') return a.load.count === b.load.count;
      if (a.load.kind === 'pallet' && b.load.kind === 'pallet') return a.load.pieces.length === b.load.pieces.length;
      return true;
    };
    return this.reconcileWith(ackSeq, server, (p, s) => !sameLoad(p, s));
  }

  get context(): MachineCtx {
    return this.ctx();
  }
}
