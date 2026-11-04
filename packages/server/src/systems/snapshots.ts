import {
  ANIM, MACHINE, MACHINE_RECORD_BYTES, MAX_ENTITIES, MAX_MACHINES, NET, PROTOCOL_VERSION, animOf, encodeSnapshot, isDue, loadCode,
  snapshotBytes, tierFor, writeMachineRecord,
  type EntityRecord, type MachineRecord, type OwnMachine, type Tier,
} from '@hht/shared';
import type { WorldMetrics } from '../metrics.ts';
import type { MachineRec, Session } from '../world/types.ts';

/** Room-wide pooled encode buffer (Colyseus copies on send, so one buffer is enough). */
const buf = new ArrayBuffer(snapshotBytes(MAX_ENTITIES, MAX_MACHINES, true));
const view = new DataView(buf);
const bytes = new Uint8Array(buf);
const records: EntityRecord[] = Array.from({ length: MAX_ENTITIES }, () => ({ netId: 0, x: 0, y: 0, z: 0, yaw: 0, anim: 0, carry: null, emoting: false }));
/** this tick's record and hash per machine (the same for every receiver: built once, research M4) */
const prepared: MachineRecord[] = Array.from({ length: MAX_MACHINES }, () => ({ id: 0, x: 0, z: 0, yaw: 0, p1: 0, p2: 0, p3: 0, operator: false, loadCode: 0, phase: 'idle' }));
const preparedHash = new Int32Array(MAX_MACHINES);
/** per receiver: references into `prepared` */
const machineRecs: MachineRecord[] = new Array(MAX_MACHINES);
const ownMachine: OwnMachine = { id: 0, x: 0, z: 0, yaw: 0, p1: 0, p2: 0, p3: 0, phaseT: 0, phase: 'idle', loadCode: 0 };
/** scratch for the change-suppression hash of one quantized record */
const hashBuf = new DataView(new ArrayBuffer(MACHINE_RECORD_BYTES));
const KEYFRAME_TICKS = Math.round((MACHINE.keyframeS * 1000) / NET.tickMs);

export interface SnapshotIo {
  send(s: Session, data: Uint8Array): void;
}

export interface MachineSource {
  readonly recs: readonly MachineRec[];
}

function fillRecord(r: MachineRecord, m: MachineRec): void {
  const s = m.state;
  r.id = s.id;
  r.x = s.x;
  r.z = s.z;
  r.yaw = s.yaw;
  r.p1 = s.p1;
  r.p2 = s.p2;
  r.p3 = s.p3;
  r.operator = m.operator !== '';
  r.loadCode = loadCode(s.load);
  r.phase = s.phase;
}

/** FNV-1a over the 12 quantized bytes: equal hashes = nothing visible changed. */
function recordHash(r: MachineRecord): number {
  writeMachineRecord(hashBuf, 0, r);
  let h = 0x811c9dc5;
  for (let i = 0; i < MACHINE_RECORD_BYTES; i++) h = Math.imul(h ^ hashBuf.getUint8(i), 0x01000193);
  return h | 0;
}

/**
 * Encodes and sends one snapshot per connected session (interest tiers with hysteresis). Machine
 * records (protocol v2) are sent when due under the receiver's tier for that machine AND changed
 * since the last record sent to that receiver, or when the 2 s keyframe is due. The receiver's own
 * machine goes only in `ownMachine`, at full precision.
 */
export function sendSnapshots(io: SnapshotIo, sessions: Iterable<Session>, tick: number, now: number, machines?: MachineSource, metrics?: WorldMetrics): number {
  const list: Session[] = [];
  for (const s of sessions) if (s.state === 'active') list.push(s);
  let total = 0;
  const mrecs = machines?.recs ?? [];
  const mcount = Math.min(MAX_MACHINES, mrecs.length);
  for (let i = 0; i < mcount; i++) {
    fillRecord(prepared[i] as MachineRecord, mrecs[i] as MachineRec);
    preparedHash[i] = recordHash(prepared[i] as MachineRecord);
  }
  for (const rx of list) {
    if (!rx.client) continue;
    let n = 0;
    for (const e of list) {
      if (e === rx || n >= MAX_ENTITIES) continue;
      const dx = e.worker.x - rx.worker.x;
      const dz = e.worker.z - rx.worker.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const tier: Tier = tierFor(d, rx.tiers[e.netId] as Tier | 0);
      rx.tiers[e.netId] = tier;
      if (!isDue(tier, tick, e.netId)) continue;
      const r = records[n++] as EntityRecord;
      r.netId = e.netId;
      r.x = e.worker.x;
      r.y = e.worker.y;
      r.z = e.worker.z;
      r.yaw = e.worker.facing;
      const emoting = e.emoteUntil > now;
      r.anim = e.machine >= 0 ? ANIM.seated : emoting ? ANIM.emote : animOf(e.worker);
      r.carry = e.worker.carrying;
      r.emoting = emoting && e.machine < 0;
    }
    let m = 0;
    let own: OwnMachine | null = null;
    for (let i = 0; i < mcount; i++) {
      const mr = mrecs[i] as MachineRec;
      const id = mr.state.id;
      if (id === rx.machine) {
        own = ownMachine;
        const s = mr.state;
        own.id = id;
        own.x = s.x;
        own.z = s.z;
        own.yaw = s.yaw;
        own.p1 = s.p1;
        own.p2 = s.p2;
        own.p3 = s.p3;
        own.phaseT = s.phaseT;
        own.phase = s.phase;
        own.loadCode = loadCode(s.load);
        continue;
      }
      const dx = mr.state.x - rx.worker.x;
      const dz = mr.state.z - rx.worker.z;
      const tier: Tier = tierFor(Math.sqrt(dx * dx + dz * dz), rx.machineTiers[id] as Tier | 0);
      rx.machineTiers[id] = tier;
      if (!isDue(tier, tick, 4096 + id)) continue;
      const h = preparedHash[i] as number;
      if (h === rx.machineHash[id] && tick - (rx.machineSentTick[id] as number) < KEYFRAME_TICKS) continue;
      rx.machineHash[id] = h;
      rx.machineSentTick[id] = tick;
      machineRecs[m++] = prepared[i] as MachineRecord;
    }
    const len = encodeSnapshot(view, { protocol: PROTOCOL_VERSION, tick, serverTime: now, ackSeq: rx.lastSeq, own: rx.worker, ownMachine: own, entities: records, machines: machineRecs }, n, m);
    io.send(rx, bytes.subarray(0, len));
    total += len;
    if (metrics) metrics.machineBytesAcc += m * MACHINE_RECORD_BYTES + (own ? 30 : 0);
  }
  return total;
}
