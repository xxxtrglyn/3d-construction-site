import { describe, expect, it } from 'vitest';
import {
  decodeMoveInputs, decodeSnapshot, encodeMoveInputs, encodeSnapshot, initialWorker, seqDiff, seqNewer, snapshotBytes,
  validateJoinOptions, validateMessage, type Snapshot, PROTOCOL_VERSION, validators, type ClientMessageType, seededRng,
} from '../src/index.ts';

const own = { ...initialWorker({ x: 1.23456789, y: 0, z: -3.3 }), vx: 0.1, vy: -2, vz: 5.5, carrying: 'bell' as const, grounded: false, coyote: 0.05, jumpBuffer: 0.1 };

describe('snapshot codec', () => {
  it('round-trips header, exact own state and entity records at their limits', () => {
    const snap: Snapshot = {
      protocol: PROTOCOL_VERSION, tick: 4_000_000_000, serverTime: 1_762_000_000_123.5, ackSeq: 65535, own,
      entities: [
        { netId: 65535, x: 327.67, y: -327.68, z: 0.004, yaw: Math.PI * 2 - 0.001, anim: 5, carry: 'cone', emoting: true },
        { netId: 0, x: -12.345, y: 1.1, z: 33.33, yaw: -Math.PI / 2, anim: 0, carry: null, emoting: false },
      ],
    };
    const view = new DataView(new ArrayBuffer(snapshotBytes(2)));
    expect(encodeSnapshot(view, snap)).toBe(snapshotBytes(2));
    const d = decodeSnapshot(view)!;
    expect(d.tick).toBe(snap.tick);
    expect(d.serverTime).toBe(snap.serverTime);
    expect(d.ackSeq).toBe(65535);
    expect(d.own).toEqual(own); // f64: bit-exact
    expect(d.entities[0]).toMatchObject({ netId: 65535, x: 327.67, y: -327.68, z: 0, anim: 5, carry: 'cone', emoting: true });
    expect(d.entities[0]!.yaw).toBeCloseTo(0, 1); // wraps at 2π
    expect(Math.abs(d.entities[1]!.x - -12.345)).toBeLessThanOrEqual(0.0051);
    expect(d.entities[1]!.yaw).toBeCloseTo((Math.PI * 3) / 2, 1);
    expect(d.entities[1]!.carry).toBeNull();
  });

  it('rejects truncated or foreign buffers', () => {
    expect(decodeSnapshot(new DataView(new ArrayBuffer(10)))).toBeNull();
    const view = new DataView(new ArrayBuffer(snapshotBytes(0)));
    encodeSnapshot(view, { protocol: 1, tick: 1, serverTime: 1, ackSeq: 1, own, entities: [] });
    view.setUint8(0, 9);
    expect(decodeSnapshot(view)).toBeNull();
  });
});

describe('move input codec', () => {
  it('round-trips a batch with seq wrap', () => {
    const inputs = [65534, 65535, 0].map((seq, i) => ({ seq, dx: [127, -127, 90][i]!, dz: [0, 0, 90][i]!, run: i === 1, jump: i === 2 }));
    const d = decodeMoveInputs(encodeMoveInputs(inputs))!;
    expect(d).toEqual(inputs);
  });
  it('rejects bad lengths, counts and out-of-range directions', () => {
    expect(decodeMoveInputs(new Uint8Array([2, 0, 0, 0]))).toBeNull();
    const bytes = encodeMoveInputs([{ seq: 1, dx: 0, dz: 0, run: false, jump: false }]);
    expect(decodeMoveInputs(bytes.slice(0, bytes.length - 1))).toBeNull();
    const bad = bytes.slice();
    bad[6] = 9; // unknown button bits
    expect(decodeMoveInputs(bad)).toBeNull();
    const big = bytes.slice();
    big[4] = 0x80; // -128
    expect(decodeMoveInputs(big)).toBeNull();
  });
  it('serial-number comparison works across the wrap', () => {
    expect(seqNewer(0, 65535)).toBe(true);
    expect(seqNewer(65535, 0)).toBe(false);
    expect(seqDiff(2, 65534)).toBe(4);
    expect(seqDiff(65534, 2)).toBe(-4);
  });
});

describe('validators', () => {
  it('accepts well-formed payloads', () => {
    expect(validateJoinOptions({ protocol: PROTOCOL_VERSION, playerKey: 'a'.repeat(32), name: 'Sunny Bolt', hatColor: 'teal' })).not.toBeNull();
    expect(validateMessage('grab', { target: { kind: 'rack', rack: 3 } })).toEqual({ target: { kind: 'rack', rack: 3 } });
    expect(validateMessage('toss', { charge: 0.5 })).toEqual({ charge: 0.5 });
    expect(validateMessage('crew', { op: 'answer', requester: 'abc_DEF-1', approve: true })).not.toBeNull();
    expect(validateMessage('crew', { op: 'mode', mode: 'open' })).not.toBeNull();
    expect(validateMessage('emote', { id: 'wave' })).not.toBeNull();
    expect(validateMessage('say', { id: 'canIJoin' })).not.toBeNull();
    expect(validateMessage('chat', { channel: 'crew', text: 'hi' })).not.toBeNull();
    expect(validateMessage('drop', undefined)).toEqual({});
  });
  it('rejects malformed payloads', () => {
    expect(validateJoinOptions({ protocol: 99, playerKey: 'a'.repeat(32), name: 'Sunny Bolt', hatColor: 'teal' })).toBeNull();
    expect(validateJoinOptions({ protocol: 1, playerKey: 'xyz', name: 'Sunny Bolt', hatColor: 'teal' })).toBeNull();
    expect(validateJoinOptions({ protocol: 1, playerKey: 'a'.repeat(32), name: 'Evil Name', hatColor: 'teal' })).toBeNull();
    expect(validateMessage('toss', { charge: Number.NaN })).toBeNull();
    expect(validateMessage('toss', { charge: 2 })).toBeNull();
    expect(validateMessage('grab', { target: { kind: 'bin', plot: 12 } })).toBeNull();
    expect(validateMessage('emote', { id: 'rude' })).toBeNull();
    expect(validateMessage('crew', { op: 'answer', requester: '<script>', approve: true })).toBeNull();
    expect(validateMessage('foreman', { op: 'start', blueprint: 'mega' })).toBeNull();
    expect(validateMessage('chat', { channel: 'world', text: 'hi' })).toBeNull();
    expect(validateMessage('chat', { channel: 'nearby', text: 'x'.repeat(500) })).toBeNull();
    expect(validateMessage('grab', { target: { kind: 'rack', rack: 1 }, pad: 'x'.repeat(300) })).toBeNull();
  });
  it('fuzz: random payloads never throw', () => {
    const rng = seededRng(7);
    const types = Object.keys(validators) as ClientMessageType[];
    const randVal = (depth: number): unknown => {
      const r = rng();
      if (depth > 2 || r < 0.2) return [null, undefined, true, 1.5, -1, 'x', Number.NaN, Infinity][Math.floor(rng() * 8)];
      if (r < 0.6) return Object.fromEntries(Array.from({ length: 3 }, (_, i) => [['op', 'kind', 'target', 'id', 'text', 'channel'][Math.floor(rng() * 6)]! + (i ? '' : ''), randVal(depth + 1)]));
      return [randVal(depth + 1)];
    };
    for (let i = 0; i < 10_000; i++) {
      const t = types[Math.floor(rng() * types.length)]!;
      expect(() => validateMessage(t, randVal(0))).not.toThrow();
      const bytes = new Uint8Array(Math.floor(rng() * 60)).map(() => Math.floor(rng() * 256));
      expect(() => decodeMoveInputs(bytes)).not.toThrow();
      expect(() => decodeSnapshot(new DataView(bytes.buffer))).not.toThrow();
    }
  });
});
