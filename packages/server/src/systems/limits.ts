import { addStrike, bucketFor, RATE, STRIKES, take, CLOSE, type RateClass, type Bucket } from '@hht/shared';
import type { Session } from '../world/types.ts';

export function newBuckets(now: number): Record<RateClass, Bucket> {
  const out = {} as Record<RateClass, Bucket>;
  for (const k of Object.keys(RATE) as RateClass[]) out[k] = bucketFor(k, now);
  return out;
}

export interface LimitsIo {
  slowDown(s: Session): void;
  kick(s: Session, code: number): void;
}

/** Takes a token from the session's bucket; over-limit → strike + "slow down" cue (≤ 1 per 2 s). */
export function guard(io: LimitsIo, s: Session, cls: RateClass, now: number): boolean {
  if (take(s.buckets[cls], now)) return true;
  strike(io, s, now);
  if (now - s.lastSlowDownAt >= 2000) {
    s.lastSlowDownAt = now;
    io.slowDown(s);
  }
  return false;
}

/** Records an invalid/over-limit action; "30 strikes in 10 s" disconnects with 4003. */
export function strike(io: LimitsIo, s: Session, now: number): void {
  if (addStrike(s.strikes, now) >= STRIKES.limit) io.kick(s, CLOSE.strikes);
}
