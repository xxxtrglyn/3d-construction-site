/**
 * Wire protocol shared by client, server and load-test bots (contracts/network-protocol.md).
 * Every client payload is untrusted: validators return a typed value or null (→ strike on the server).
 */
import { isHatColorId, isValidGuestName, type HatColorId } from './guestName.ts';
import type { MoveInput, WorkerState } from './kinematics.ts';
import { PIECE_TYPE_IDS, type PieceTypeId } from './pieces.ts';
import { isEmoteId, isQuickMessageId, type EmoteId, type QuickMessageId } from './social.ts';

export const PROTOCOL_VERSION = 1;

export const CLOSE = {
  protocol: 4001,
  idle: 4002,
  strikes: 4003,
  worldClosing: 4004,
  shutdown: 4005,
} as const;

export type JoinMode = 'ask' | 'open' | 'solo';
export type ChatChannel = 'nearby' | 'crew';
export const JOIN_MODES: readonly JoinMode[] = ['ask', 'open', 'solo'];

// ---------------------------------------------------------------- join

export interface JoinOptions {
  protocol: number;
  playerKey: string;
  name: string;
  hatColor: HatColorId;
}

const KEY_RE = /^[0-9a-f]{32}$/;

export function validateJoinOptions(v: unknown): JoinOptions | null {
  if (!isObj(v)) return null;
  const { protocol, playerKey, name, hatColor } = v;
  if (protocol !== PROTOCOL_VERSION) return null;
  if (typeof playerKey !== 'string' || !KEY_RE.test(playerKey)) return null;
  if (!isValidGuestName(name) || !isHatColorId(hatColor)) return null;
  return { protocol, playerKey, name, hatColor };
}

// ---------------------------------------------------------------- client → server (JSON messages)

export type GrabTarget = { kind: 'rack'; rack: number } | { kind: 'piece'; id: number } | { kind: 'bin'; plot: number };

export type ForemanMsg = { op: 'start'; blueprint: 'clock-tower' } | { op: 'adopt'; plot: number };

export type CrewMsg =
  | { op: 'request'; plot: number }
  | { op: 'cancel' }
  | { op: 'answer'; requester: string; approve: boolean }
  | { op: 'mode'; mode: JoinMode }
  | { op: 'remove'; member: string }
  | { op: 'handover'; to: string }
  | { op: 'leave' };

export interface ClientMessages {
  grab: { target: GrabTarget };
  drop: Record<string, never>;
  toss: { charge: number };
  emote: { id: EmoteId };
  say: { id: QuickMessageId };
  foreman: ForemanMsg;
  crew: CrewMsg;
  hide: { who: string; hidden: boolean };
  shuffleName: { name: string };
  ping: { c: number };
  respawn: Record<string, never>;
  chat: { channel: ChatChannel; text: string };
  report: { who: string };
  dev: { op: string; [k: string]: unknown };
}

export type ClientMessageType = keyof ClientMessages;

const MAX_JSON = 256;
const MAX_CHAT_JSON = 400;
const SESSION_RE = /^[A-Za-z0-9_-]{1,32}$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const isFiniteIn = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isSession = (v: unknown): v is string => typeof v === 'string' && SESSION_RE.test(v);

function sizeOk(v: unknown, max: number): boolean {
  try {
    return JSON.stringify(v).length <= max;
  } catch {
    return false;
  }
}

type Validator<T> = (v: unknown) => T | null;

export const validators: { [K in ClientMessageType]: Validator<ClientMessages[K]> } = {
  grab(v) {
    if (!isObj(v) || !isObj(v.target)) return null;
    const t = v.target;
    if (t.kind === 'rack' && isInt(t.rack, 0, 255)) return { target: { kind: 'rack', rack: t.rack } };
    if (t.kind === 'piece' && isInt(t.id, 0, 2 ** 31)) return { target: { kind: 'piece', id: t.id } };
    if (t.kind === 'bin' && isInt(t.plot, 0, 11)) return { target: { kind: 'bin', plot: t.plot } };
    return null;
  },
  drop: (v) => (v === undefined || v === null || isObj(v) ? {} : null),
  toss(v) {
    if (!isObj(v) || !isFiniteIn(v.charge, 0, 1)) return null;
    return { charge: v.charge };
  },
  emote: (v) => (isObj(v) && isEmoteId(v.id) ? { id: v.id } : null),
  say: (v) => (isObj(v) && isQuickMessageId(v.id) ? { id: v.id } : null),
  foreman(v) {
    if (!isObj(v)) return null;
    if (v.op === 'start' && v.blueprint === 'clock-tower') return { op: 'start', blueprint: 'clock-tower' };
    if (v.op === 'adopt' && isInt(v.plot, 0, 11)) return { op: 'adopt', plot: v.plot };
    return null;
  },
  crew(v) {
    if (!isObj(v)) return null;
    switch (v.op) {
      case 'request':
        return isInt(v.plot, 0, 11) ? { op: 'request', plot: v.plot } : null;
      case 'cancel':
        return { op: 'cancel' };
      case 'answer':
        return isSession(v.requester) && typeof v.approve === 'boolean' ? { op: 'answer', requester: v.requester, approve: v.approve } : null;
      case 'mode':
        return typeof v.mode === 'string' && (JOIN_MODES as readonly string[]).includes(v.mode) ? { op: 'mode', mode: v.mode as JoinMode } : null;
      case 'remove':
        return isSession(v.member) ? { op: 'remove', member: v.member } : null;
      case 'handover':
        return isSession(v.to) ? { op: 'handover', to: v.to } : null;
      case 'leave':
        return { op: 'leave' };
      default:
        return null;
    }
  },
  hide: (v) => (isObj(v) && isSession(v.who) && typeof v.hidden === 'boolean' ? { who: v.who, hidden: v.hidden } : null),
  shuffleName: (v) => (isObj(v) && isValidGuestName(v.name) ? { name: v.name } : null),
  ping: (v) => (isObj(v) && isFiniteIn(v.c, 0, Number.MAX_SAFE_INTEGER) ? { c: v.c } : null),
  respawn: (v) => (v === undefined || v === null || isObj(v) ? {} : null),
  chat(v) {
    if (!isObj(v) || !sizeOk(v, MAX_CHAT_JSON)) return null;
    if (v.channel !== 'nearby' && v.channel !== 'crew') return null;
    if (typeof v.text !== 'string') return null;
    return { channel: v.channel, text: v.text };
  },
  report: (v) => (isObj(v) && isSession(v.who) ? { who: v.who } : null),
  dev: (v) => (isObj(v) && typeof v.op === 'string' && v.op.length <= 32 ? (v as ClientMessages['dev']) : null),
};

export function validateMessage<K extends ClientMessageType>(type: K, payload: unknown): ClientMessages[K] | null {
  const fn = validators[type] as Validator<ClientMessages[K]> | undefined;
  if (!fn) return null;
  if (type !== 'chat' && payload !== undefined && !sizeOk(payload, MAX_JSON)) return null;
  return fn(payload);
}

// ---------------------------------------------------------------- server → client events

export type DeliverEventResult = 'snapped' | 'stageComplete' | 'masterpiece';
export type RequestResult = 'joined' | 'pending' | 'denied' | 'expired' | 'full' | 'closed' | 'cooldown' | 'busy' | 'alreadyInCrew';
export type ChatRefusal = 'locked' | 'paused' | 'rate' | 'tooLong' | 'empty' | 'contact' | 'duplicate' | 'noCrew';

export interface ServerEvents {
  welcome: { sessionId: string; netId: number; worldId: number; serverNow: number; tick: number; name: string; resumed: boolean };
  pong: { c: number; s: number };
  snap: { plot: number; result: DeliverEventResult; by: string; pieceType: PieceTypeId };
  hint: { kind: 'wrongPiece'; needed: PieceTypeId } | { kind: 'notCrew' } | { kind: 'binFull' };
  binned: { plot: number; by: string };
  thanks: { plot: number; by: string };
  celebrate: { plot: number; until: number };
  emote: { who: string; id: EmoteId | QuickMessageId; kind: 'emote' | 'say' };
  foreman: { result: 'assigned'; plot: number } | { result: 'allPlotsBusy' } | { result: 'adopted'; plot: number } | { result: 'notAvailable' };
  request: { op: 'incoming'; requester: string; name: string; expiresAt: number } | { op: 'withdrawn'; requester: string };
  requestResult: { plot: number; result: RequestResult; retryAt?: number };
  crewNotice: { plot: number; kind: 'newHost' | 'removed' | 'joined' | 'left'; who: string };
  slowDown: Record<string, never>;
  correction: { reason: 'respawn' | 'outOfBounds' };
  shift: { phase: 'warning' | 'countdown'; endsAt: number };
  summary: { epoch: number; worldTowers: number; myCrewTowers: number; delivered: number; donated: number };
  chat: { from: string; channel: ChatChannel; text: string; at: number };
  chatRefused: { reason: ChatRefusal; unlockAt?: number };
  chatPaused: { untilShiftEnd: true };
  reportResult: { result: 'ok' | 'already' | 'invalid' };
}

export type ServerEventType = keyof ServerEvents;

// ---------------------------------------------------------------- binary codecs

export const BIN_KIND = { snapshot: 1, moveInputs: 2 } as const;

/** carry type ↔ 3-bit code (0 = none, 1..7 = PIECE_TYPE_IDS order) */
export function carryCode(t: PieceTypeId | null): number {
  return t === null ? 0 : PIECE_TYPE_IDS.indexOf(t) + 1;
}
export function carryFromCode(c: number): PieceTypeId | null {
  return c <= 0 ? null : (PIECE_TYPE_IDS[c - 1] ?? null);
}

export interface EntityRecord {
  netId: number;
  x: number;
  y: number;
  z: number;
  /** radians 0..2π (quantized to 256 steps) */
  yaw: number;
  anim: number;
  carry: PieceTypeId | null;
  emoting: boolean;
}

export interface Snapshot {
  protocol: number;
  tick: number;
  serverTime: number;
  ackSeq: number;
  own: WorkerState;
  entities: EntityRecord[];
}

/** header 1+1+4+8+2, own state 9×f64 + u8 flags, u8 count */
export const SNAPSHOT_HEADER_BYTES = 1 + 1 + 4 + 8 + 2 + 9 * 8 + 1 + 1;
export const ENTITY_BYTES = 10;
export const MAX_ENTITIES = 255;

export function snapshotBytes(count: number): number {
  return SNAPSHOT_HEADER_BYTES + count * ENTITY_BYTES;
}

const TAU = Math.PI * 2;
const cm = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v * 100)));
const yawByte = (r: number): number => (Math.round((((r % TAU) + TAU) % TAU) / TAU * 256) & 255);

/** Encodes into `view` (caller-pooled buffer, ≥ snapshotBytes(n)); returns the byte length written. */
export function encodeSnapshot(view: DataView, s: Snapshot, count = s.entities.length): number {
  let o = 0;
  view.setUint8(o, BIN_KIND.snapshot); o += 1;
  view.setUint8(o, s.protocol); o += 1;
  view.setUint32(o, s.tick >>> 0, true); o += 4;
  view.setFloat64(o, s.serverTime, true); o += 8;
  view.setUint16(o, s.ackSeq & 0xffff, true); o += 2;
  const w = s.own;
  for (const v of [w.x, w.y, w.z, w.vx, w.vy, w.vz, w.facing, w.coyote, w.jumpBuffer]) {
    view.setFloat64(o, v, true); o += 8;
  }
  view.setUint8(o, (w.grounded ? 1 : 0) | (carryCode(w.carrying) << 1)); o += 1;
  const n = Math.min(MAX_ENTITIES, count, s.entities.length);
  view.setUint8(o, n); o += 1;
  for (let i = 0; i < n; i++) {
    const e = s.entities[i] as EntityRecord;
    view.setUint16(o, e.netId & 0xffff, true);
    view.setInt16(o + 2, cm(e.x), true);
    view.setInt16(o + 4, cm(e.y), true);
    view.setInt16(o + 6, cm(e.z), true);
    view.setUint8(o + 8, yawByte(e.yaw));
    view.setUint8(o + 9, (e.anim & 7) | ((carryCode(e.carry) & 7) << 3) | (e.emoting ? 64 : 0));
    o += ENTITY_BYTES;
  }
  return o;
}

export function decodeSnapshot(view: DataView): Snapshot | null {
  if (view.byteLength < SNAPSHOT_HEADER_BYTES || view.getUint8(0) !== BIN_KIND.snapshot) return null;
  let o = 1;
  const protocol = view.getUint8(o); o += 1;
  const tick = view.getUint32(o, true); o += 4;
  const serverTime = view.getFloat64(o, true); o += 8;
  const ackSeq = view.getUint16(o, true); o += 2;
  const f: number[] = [];
  for (let i = 0; i < 9; i++) {
    f.push(view.getFloat64(o, true)); o += 8;
  }
  const flags = view.getUint8(o); o += 1;
  const n = view.getUint8(o); o += 1;
  if (view.byteLength < o + n * ENTITY_BYTES) return null;
  const own: WorkerState = {
    x: f[0] as number, y: f[1] as number, z: f[2] as number, vx: f[3] as number, vy: f[4] as number, vz: f[5] as number,
    facing: f[6] as number, coyote: f[7] as number, jumpBuffer: f[8] as number,
    grounded: (flags & 1) === 1, carrying: carryFromCode((flags >> 1) & 7),
  };
  const entities: EntityRecord[] = [];
  for (let i = 0; i < n; i++) {
    const fl = view.getUint8(o + 9);
    entities.push({
      netId: view.getUint16(o, true),
      x: view.getInt16(o + 2, true) / 100,
      y: view.getInt16(o + 4, true) / 100,
      z: view.getInt16(o + 6, true) / 100,
      yaw: (view.getUint8(o + 8) / 256) * TAU,
      anim: fl & 7,
      carry: carryFromCode((fl >> 3) & 7),
      emoting: (fl & 64) !== 0,
    });
    o += ENTITY_BYTES;
  }
  return { protocol, tick, serverTime, ackSeq, own, entities };
}

export const MAX_INPUTS_PER_BATCH = 12;

export function moveInputsBytes(n: number): number {
  return 1 + 2 + 1 + n * 3;
}

/** Encodes consecutive inputs (seq of the first; the rest follow +1 each). */
export function encodeMoveInputs(inputs: readonly MoveInput[]): Uint8Array {
  const n = Math.min(MAX_INPUTS_PER_BATCH, inputs.length);
  const buf = new Uint8Array(moveInputsBytes(n));
  const view = new DataView(buf.buffer);
  view.setUint8(0, BIN_KIND.moveInputs);
  view.setUint16(1, (inputs[0]?.seq ?? 0) & 0xffff, true);
  view.setUint8(3, n);
  for (let i = 0; i < n; i++) {
    const inp = inputs[i] as MoveInput;
    view.setInt8(4 + i * 3, Math.max(-127, Math.min(127, Math.round(inp.dx))));
    view.setInt8(5 + i * 3, Math.max(-127, Math.min(127, Math.round(inp.dz))));
    view.setUint8(6 + i * 3, (inp.run ? 1 : 0) | (inp.jump ? 2 : 0));
  }
  return buf;
}

export function decodeMoveInputs(bytes: Uint8Array): MoveInput[] | null {
  if (bytes.byteLength < 4) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== BIN_KIND.moveInputs) return null;
  const first = view.getUint16(1, true);
  const n = view.getUint8(3);
  if (n < 1 || n > MAX_INPUTS_PER_BATCH || bytes.byteLength !== moveInputsBytes(n)) return null;
  const out: MoveInput[] = [];
  for (let i = 0; i < n; i++) {
    const dx = view.getInt8(4 + i * 3);
    const dz = view.getInt8(5 + i * 3);
    const b = view.getUint8(6 + i * 3);
    if (dx === -128 || dz === -128 || dx * dx + dz * dz > 127 * 127 + 254 || b > 3) return null;
    out.push({ seq: (first + i) & 0xffff, dx, dz, run: (b & 1) === 1, jump: (b & 2) === 2 });
  }
  return out;
}

/** Serial-number arithmetic for u16 sequence numbers: true when a is newer than b. */
export function seqNewer(a: number, b: number): boolean {
  const d = (a - b) & 0xffff;
  return d !== 0 && d < 0x8000;
}

export function seqDiff(a: number, b: number): number {
  const d = (a - b) & 0xffff;
  return d < 0x8000 ? d : d - 0x10000;
}
