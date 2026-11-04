import { describe, expect, it } from 'vitest';
import { SIM_DT, SITE, decodeMoveInputs, initialWorker, machineCtx, machineId, parkedState, stepMachine, stepWorker, type MachineState, type WorkerState } from '@hht/shared';
import { InputStream, MachinePredictor, Predictor } from '../src/net/prediction.ts';

/** A fake server that applies decoded inputs exactly like WorldRoom does. */
class FakeServer {
  state: WorkerState;
  lastSeq = 0;
  constructor(s: WorkerState) {
    this.state = s;
  }
  apply(batches: Uint8Array[]): void {
    for (const b of batches) for (const i of decodeMoveInputs(b)!) {
      this.state = stepWorker(this.state, i, SIM_DT, SITE);
      this.lastSeq = i.seq;
    }
  }
}

describe('Predictor', () => {
  it('matches the server exactly with no corrections when nothing diverges', () => {
    const start = initialWorker({ x: 0, y: 0, z: 10 });
    const p = new Predictor(start, SITE);
    const srv = new FakeServer(start);
    for (let f = 0; f < 120; f++) {
      p.update(1 / 60, Math.sin(f / 20), -1, f % 40 < 20, []);
      if (f % 3 === 0) {
        srv.apply(p.takeBatches());
        expect(p.reconcile(srv.lastSeq, srv.state, [])).toBe(false);
      }
    }
    expect(p.corrections).toBe(0);
    // the server re-acks the same seq on ticks without new inputs: still no correction
    expect(p.reconcile(srv.lastSeq, srv.state, [])).toBe(false);
    expect(p.reconcile(srv.lastSeq, srv.state, [])).toBe(false);
  });

  it('resets to the server state and replays unacknowledged inputs after a divergence', () => {
    const start = initialWorker({ x: 0, y: 0, z: 10 });
    const p = new Predictor(start, SITE);
    const srv = new FakeServer(start);
    for (let f = 0; f < 30; f++) p.update(1 / 60, 1, 0, true, []);
    const batches = p.takeBatches();
    srv.apply(batches.slice(0, 1)); // server has processed only the first 12 inputs
    srv.state = { ...srv.state, x: srv.state.x - 0.5 }; // and pushed us back half a meter
    const before = { ...p.state };
    expect(p.reconcile(srv.lastSeq, srv.state, [])).toBe(true);
    // replaying the remaining inputs from the server state reproduces the server's future exactly
    srv.apply(batches.slice(1));
    expect(p.state).toEqual(srv.state);
    // the visual offset starts at the jump and decays to ~0 within 150 ms
    expect(p.offset.x).toBeCloseTo(before.x - p.state.x, 9);
    for (let i = 0; i < 9; i++) p.update(1 / 60, 0, 0, false, []);
    expect(Math.abs(p.offset.x)).toBeLessThan(0.02);
  });

  it('a correction smaller than 2 cm is ignored', () => {
    const start = initialWorker({ x: 0, y: 0, z: 10 });
    const p = new Predictor(start, SITE);
    const srv = new FakeServer(start);
    for (let f = 0; f < 12; f++) p.update(1 / 60, 1, 0, false, []);
    srv.apply(p.takeBatches());
    expect(p.reconcile(srv.lastSeq, { ...srv.state, x: srv.state.x + 0.01 }, [])).toBe(false);
  });
});

// ---------------------------------------------------------------- feature 003: machines replay through the same predictor


class FakeMachineServer {
  state: MachineState;
  lastSeq = 0;
  constructor(s: MachineState) {
    this.state = s;
  }
  apply(batches: Uint8Array[]): void {
    const ctx = machineCtx(SITE, 0, [], 0);
    for (const b of batches) for (const i of decodeMoveInputs(b)!) {
      this.state = stepMachine(this.state, i, SIM_DT, ctx).state;
      this.lastSeq = i.seq;
    }
  }
}

describe('MachinePredictor', () => {
  const ctx = () => machineCtx(SITE, 0, [], 0);
  it('replays MachineState with stepMachine and stays in lock-step with the server (no corrections)', () => {
    const start = parkedState(machineId(0, 'forklift'), SITE.machines[0]!);
    const stream = new InputStream();
    const p = new MachinePredictor(start, stream, ctx);
    const srv = new FakeMachineServer(start);
    for (let f = 0; f < 150; f++) {
      p.update(1 / 60, f < 90 ? 0.4 : -0.6, 1, f === 40, false);
      if (f % 3 === 0) {
        srv.apply(stream.takeBatches());
        expect(p.reconcile(srv.lastSeq, srv.state)).toBe(false);
      }
    }
    expect(p.corrections).toBe(0);
    expect(p.state.x).not.toBe(start.x);
  });

  it('resets to the authoritative machine state and replays the unacknowledged inputs', () => {
    const start = parkedState(machineId(0, 'crane'), SITE.machines[0]!);
    const stream = new InputStream();
    const p = new MachinePredictor(start, stream, ctx);
    const srv = new FakeMachineServer(start);
    for (let f = 0; f < 30; f++) p.update(1 / 60, 1, 0.5, false, false);
    const batches = stream.takeBatches();
    srv.apply(batches.slice(0, 1));
    srv.state = { ...srv.state, p1: srv.state.p1 + 0.2 };
    expect(p.reconcile(srv.lastSeq, srv.state)).toBe(true);
    srv.apply(batches.slice(1));
    expect(p.state).toEqual(srv.state);
    expect(p.corrections).toBe(1);
  });

  it('adopts the authoritative load (a scoop the server granted) without counting a correction', () => {
    const start = parkedState(machineId(0, 'excavator'), SITE.machines[0]!);
    const stream = new InputStream();
    const p = new MachinePredictor(start, stream, ctx);
    const srv = new FakeMachineServer(start);
    for (let f = 0; f < 6; f++) p.update(1 / 60, 0, 0, false, false);
    srv.apply(stream.takeBatches());
    expect(p.reconcile(srv.lastSeq, { ...srv.state, load: { kind: 'dirt' } })).toBe(true);
    expect(p.state.load).toEqual({ kind: 'dirt' });
    expect(p.corrections).toBe(0);
  });

  it('shares the input sequence with the worker predictor (one seq stream per session)', () => {
    const stream = new InputStream();
    const w = new Predictor(initialWorker({ x: 0, y: 0, z: 10 }), SITE, stream);
    const m = new MachinePredictor(parkedState(machineId(0, 'mixer'), SITE.machines[0]!), stream, ctx);
    w.update(1 / 60 * 3, 0, 0, false, []);
    m.update(1 / 60 * 2, 0, 0, true, false);
    const seqs = stream.takeBatches().flatMap((b) => decodeMoveInputs(b)!.map((i) => [i.seq, i.act]));
    expect(seqs).toEqual([[1, false], [2, false], [3, false], [4, true], [5, false]]);
  });
});
