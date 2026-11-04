import {
  ANIM, PROTOCOL_VERSION, animOf, encodeSnapshot, isDue, snapshotBytes, tierFor, MAX_ENTITIES,
  type EntityRecord, type Tier,
} from '@hht/shared';
import type { Session } from '../world/types.ts';

/** Room-wide pooled encode buffer (Colyseus copies on send, so one buffer is enough). */
const buf = new ArrayBuffer(snapshotBytes(MAX_ENTITIES));
const view = new DataView(buf);
const bytes = new Uint8Array(buf);
const records: EntityRecord[] = Array.from({ length: MAX_ENTITIES }, () => ({ netId: 0, x: 0, y: 0, z: 0, yaw: 0, anim: 0, carry: null, emoting: false }));

export interface SnapshotIo {
  send(s: Session, data: Uint8Array): void;
}

/** Encodes and sends one snapshot per connected session (interest tiers with hysteresis). */
export function sendSnapshots(io: SnapshotIo, sessions: Iterable<Session>, tick: number, now: number): number {
  const list: Session[] = [];
  for (const s of sessions) if (s.state === 'active') list.push(s);
  let total = 0;
  for (const rx of list) {
    if (!rx.client) continue;
    let n = 0;
    for (const e of list) {
      if (e === rx || n >= MAX_ENTITIES) continue;
      const dx = e.worker.x - rx.worker.x;
      const dz = e.worker.z - rx.worker.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const tier: Tier = tierFor(d, rx.tiers.get(e.netId) ?? 0);
      rx.tiers.set(e.netId, tier);
      if (!isDue(tier, tick, e.netId)) continue;
      const r = records[n++] as EntityRecord;
      r.netId = e.netId;
      r.x = e.worker.x;
      r.y = e.worker.y;
      r.z = e.worker.z;
      r.yaw = e.worker.facing;
      const emoting = e.emoteUntil > now;
      r.anim = emoting ? ANIM.emote : animOf(e.worker);
      r.carry = e.worker.carrying;
      r.emoting = emoting;
    }
    const len = encodeSnapshot(view, { protocol: PROTOCOL_VERSION, tick, serverTime: now, ackSeq: rx.lastSeq, own: rx.worker, entities: records }, n);
    io.send(rx, bytes.subarray(0, len));
    total += len;
  }
  return total;
}
