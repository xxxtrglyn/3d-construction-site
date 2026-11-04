import { describe, expect, it } from 'vitest';
import {
  ANIM, PIECE_TYPE_IDS, carryCode, carryFromCode, decodeMoveInputs, decodeSnapshot, encodeMoveInputs, encodeSnapshot, initialWorker,
  loadCode, seqDiff, seqNewer, snapshotBytes, validateJoinOptions, validateMessage, type Snapshot, PROTOCOL_VERSION, validators,
  type ClientMessageType, seededRng, MACHINE_RECORD_BYTES, OWN_MACHINE_BYTES, SNAPSHOT_HEADER_BYTES, ENTITY_BYTES, type MachineRecord,
} from '../src/index.ts';

const mi = (o: Partial<{ seq: number; dx: number; dz: number; run: boolean; jump: boolean; act: boolean; alt: boolean }>) => ({ seq: 0, dx: 0, dz: 0, run: false, jump: false, act: false, alt: false, ...o });
const own = { ...initialWorker({ x: 1.23456789, y: 0, z: -3.3 }), vx: 0.1, vy: -2, vz: 5.5, carrying: 'bell' as const, grounded: false, coyote: 0.05, jumpBuffer: 0.1 };

describe('snapshot codec', () => {
  it('round-trips header, exact own state and entity records at their limits', () => {
    const snap: Snapshot = {
      protocol: PROTOCOL_VERSION, tick: 4_000_000_000, serverTime: 1_762_000_000_123.5, ackSeq: 65535, own,
      entities: [
        { netId: 65535, x: 327.67, y: -327.68, z: 0.004, yaw: Math.PI * 2 - 0.001, anim: 5, carry: 'cone', emoting: true },
        { netId: 0, x: -12.345, y: 1.1, z: 33.33, yaw: -Math.PI / 2, anim: 0, carry: null, emoting: false },
      ],
      ownMachine: null, machines: [],
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
    encodeSnapshot(view, { protocol: PROTOCOL_VERSION, tick: 1, serverTime: 1, ackSeq: 1, own, entities: [], ownMachine: null, machines: [] });
    view.setUint8(0, 9);
    expect(decodeSnapshot(view)).toBeNull();
  });
});

describe('snapshot codec v2 (feature 003)', () => {
  it('is protocol 2', () => {
    expect(PROTOCOL_VERSION).toBe(2);
  });
  it('round-trips the 4-bit carry code of all 9 piece types, in the own block and in worker records', () => {
    expect(PIECE_TYPE_IDS).toHaveLength(9);
    expect(PIECE_TYPE_IDS.slice(0, 7)).toEqual(['beam', 'brick', 'panel', 'paint', 'decor', 'bell', 'cone']);
    for (const t of [null, ...PIECE_TYPE_IDS]) {
      expect(carryFromCode(carryCode(t))).toBe(t);
      const snap: Snapshot = {
        protocol: PROTOCOL_VERSION, tick: 9, serverTime: 1, ackSeq: 2, own: { ...own, carrying: t },
        entities: [{ netId: 7, x: 1, y: 2, z: 3, yaw: 1, anim: ANIM.seated, carry: t, emoting: true }], ownMachine: null, machines: [],
      };
      const view = new DataView(new ArrayBuffer(snapshotBytes(1)));
      encodeSnapshot(view, snap);
      const d = decodeSnapshot(view)!;
      expect(d.own.carrying).toBe(t);
      expect(d.entities[0]).toMatchObject({ anim: 6, carry: t, emoting: true });
    }
    expect(carryCode('concrete')).toBe(9);
    expect(ANIM.seated).toBe(6);
  });
  it('machine records are 12 B and round-trip every field at its limits; ownMachine present and absent', () => {
    expect(MACHINE_RECORD_BYTES).toBe(12);
    const machines: MachineRecord[] = [
      { id: 47, x: 327.67, z: -327.68, yaw: Math.PI, p1: 32.767, p2: -32.767, p3: 25.5, operator: true, loadCode: 15, phase: 'working' },
      { id: 0, x: -12.34, z: 5.67, yaw: 0, p1: -3.1416, p2: 7.5, p3: 0, operator: false, loadCode: 0, phase: 'idle' },
      { id: 5, x: 0, z: 0, yaw: 6.2, p1: 0.001, p2: 0.0004, p3: 13.04, operator: false, loadCode: 11, phase: 'lowering' },
      { id: 6, x: 0, z: 0, yaw: 1, p1: 0, p2: 0, p3: 99, operator: true, loadCode: 10, phase: 'raising' },
    ];
    const ownMachine = { id: 33, x: 1.25, z: -7.5, yaw: 2.5, p1: -1, p2: 6.25, p3: 12.75, phaseT: 0.5, phase: 'lowering' as const, loadCode: 3 };
    for (const om of [null, ownMachine]) {
      const snap: Snapshot = { protocol: PROTOCOL_VERSION, tick: 77, serverTime: 5, ackSeq: 9, own, entities: [{ netId: 3, x: 0, y: 0, z: 0, yaw: 0, anim: 1, carry: null, emoting: false }], ownMachine: om, machines };
      const len = snapshotBytes(1, machines.length, om !== null);
      expect(len).toBe(SNAPSHOT_HEADER_BYTES + ENTITY_BYTES + 4 * MACHINE_RECORD_BYTES + (om ? OWN_MACHINE_BYTES : 0));
      const view = new DataView(new ArrayBuffer(len));
      expect(encodeSnapshot(view, snap)).toBe(len);
      const d = decodeSnapshot(view)!;
      expect(d.own).toEqual(own);
      expect(d.entities).toHaveLength(1);
      if (om) expect(d.ownMachine).toEqual(om); // f32-exact values
      else expect(d.ownMachine).toBeNull();
      expect(d.machines).toHaveLength(4);
      expect(d.machines[0]).toMatchObject({ id: 47, x: 327.67, z: -327.68, p1: 32.767, p2: -32.767, p3: 25.5, operator: true, loadCode: 15, phase: 'working' });
      expect(d.machines[0]!.yaw).toBeCloseTo(Math.PI, 1);
      expect(d.machines[1]).toMatchObject({ id: 0, x: -12.34, z: 5.67, p1: -3.142, p2: 7.5, p3: 0, operator: false, loadCode: 0, phase: 'idle' });
      expect(d.machines[2]).toMatchObject({ p1: 0.001, p2: 0, p3: 13, loadCode: 11, phase: 'lowering' });
      expect(d.machines[3]).toMatchObject({ p3: 25.5, loadCode: 10, phase: 'raising', operator: true }); // p3 clamps at 25.5 m
    }
  });
  it('load codes: none 0, hooked piece 1–9, dirt 10, pallet 11, mixer bags 0 (in the schema)', () => {
    expect(loadCode({ kind: 'none' })).toBe(0);
    expect(loadCode({ kind: 'hook', piece: 'bell' })).toBe(6);
    expect(loadCode({ kind: 'hook', piece: 'concrete' })).toBe(9);
    expect(loadCode({ kind: 'dirt' })).toBe(10);
    expect(loadCode({ kind: 'pallet', pieces: ['brick', 'brick'] })).toBe(11);
    expect(loadCode({ kind: 'bags', count: 3 })).toBe(0);
  });
});

describe('move input codec', () => {
  it('round-trips the act (bit 2) and alt (bit 3) flags', () => {
    const inputs = [mi({ seq: 1, act: true }), mi({ seq: 2, alt: true }), mi({ seq: 3, act: true, alt: true, jump: true, run: true })];
    expect(decodeMoveInputs(encodeMoveInputs(inputs))).toEqual(inputs);
    const bytes = encodeMoveInputs([mi({ seq: 1 })]);
    expect(bytes[6]).toBe(0);
    bytes[6] = 15;
    expect(decodeMoveInputs(bytes)).not.toBeNull();
    bytes[6] = 16; // flags > 15 are rejected
    expect(decodeMoveInputs(bytes)).toBeNull();
  });
  it('round-trips a batch with seq wrap', () => {
    const inputs = [65534, 65535, 0].map((seq, i) => mi({ seq, dx: [127, -127, 90][i]!, dz: [0, 0, 90][i]!, run: i === 1, jump: i === 2 }));
    const d = decodeMoveInputs(encodeMoveInputs(inputs))!;
    expect(d).toEqual(inputs);
  });
  it('rejects bad lengths, counts and out-of-range directions', () => {
    expect(decodeMoveInputs(new Uint8Array([2, 0, 0, 0]))).toBeNull();
    const bytes = encodeMoveInputs([mi({ seq: 1 })]);
    expect(decodeMoveInputs(bytes.slice(0, bytes.length - 1))).toBeNull();
    const bad = bytes.slice();
    bad[6] = 32; // unknown button bits
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
    expect(validateMessage('machine', { op: 'enter', id: 0 })).toEqual({ op: 'enter', id: 0 });
    expect(validateMessage('machine', { op: 'enter', id: 47 })).toEqual({ op: 'enter', id: 47 });
    expect(validateMessage('machine', { op: 'exit' })).toEqual({ op: 'exit' });
  });
  it('rejects malformed payloads', () => {
    expect(validateJoinOptions({ protocol: 99, playerKey: 'a'.repeat(32), name: 'Sunny Bolt', hatColor: 'teal' })).toBeNull();
    expect(validateJoinOptions({ protocol: 1, playerKey: 'a'.repeat(32), name: 'Sunny Bolt', hatColor: 'teal' })).toBeNull(); // v1 clients are refused
    expect(validateJoinOptions({ protocol: PROTOCOL_VERSION, playerKey: 'xyz', name: 'Sunny Bolt', hatColor: 'teal' })).toBeNull();
    expect(validateJoinOptions({ protocol: PROTOCOL_VERSION, playerKey: 'a'.repeat(32), name: 'Evil Name', hatColor: 'teal' })).toBeNull();
    expect(validateMessage('toss', { charge: Number.NaN })).toBeNull();
    expect(validateMessage('toss', { charge: 2 })).toBeNull();
    expect(validateMessage('grab', { target: { kind: 'bin', plot: 12 } })).toBeNull();
    expect(validateMessage('emote', { id: 'rude' })).toBeNull();
    expect(validateMessage('crew', { op: 'answer', requester: '<script>', approve: true })).toBeNull();
    expect(validateMessage('foreman', { op: 'start', blueprint: 'mega' })).toBeNull();
    expect(validateMessage('chat', { channel: 'world', text: 'hi' })).toBeNull();
    expect(validateMessage('chat', { channel: 'nearby', text: 'x'.repeat(500) })).toBeNull();
    expect(validateMessage('grab', { target: { kind: 'rack', rack: 1 }, pad: 'x'.repeat(300) })).toBeNull();
    expect(validateMessage('machine', { op: 'enter', id: 48 })).toBeNull();
    expect(validateMessage('machine', { op: 'enter', id: -1 })).toBeNull();
    expect(validateMessage('machine', { op: 'enter', id: 1.5 })).toBeNull();
    expect(validateMessage('machine', { op: 'enter' })).toBeNull();
    expect(validateMessage('machine', { op: 'drive', id: 1 })).toBeNull();
    expect(validateMessage('machine', 'enter')).toBeNull();
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
