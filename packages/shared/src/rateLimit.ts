/** Pure token buckets and a strike window (data-model.md → RateLimiter). Times are in milliseconds. */

export interface Bucket {
  tokens: number;
  last: number;
  readonly refillPerS: number;
  readonly burst: number;
}

export const RATE = {
  move: { refillPerS: 60, burst: 12 },
  action: { refillPerS: 5, burst: 8 },
  emote: { refillPerS: 1 / 1.5, burst: 3 },
  request: { refillPerS: 1 / 5, burst: 2 },
  admin: { refillPerS: 2, burst: 4 },
  chat: { refillPerS: 1 / 2, burst: 3 },
  report: { refillPerS: 1 / 10, burst: 2 },
  name: { refillPerS: 1 / 2, burst: 1 },
  respawn: { refillPerS: 1 / 2, burst: 1 },
  ping: { refillPerS: 1, burst: 3 },
  /** feature 003: `machine` enter/exit intents (capacity 6, +2/s; same strike rules) */
  machine: { refillPerS: 2, burst: 6 },
} as const;

export type RateClass = keyof typeof RATE;

/** "30 strikes in 10 s" disconnects the client (close code 4003). */
export const STRIKES = { limit: 30, windowMs: 10_000 } as const;

export function createBucket(refillPerS: number, burst: number, now = 0): Bucket {
  return { tokens: burst, last: now, refillPerS, burst };
}

export function bucketFor(cls: RateClass, now = 0): Bucket {
  return createBucket(RATE[cls].refillPerS, RATE[cls].burst, now);
}

/** Refill, then take `n` tokens if available. */
export function take(b: Bucket, now: number, n = 1): boolean {
  if (now > b.last) {
    b.tokens = Math.min(b.burst, b.tokens + ((now - b.last) / 1000) * b.refillPerS);
    b.last = now;
  }
  if (b.tokens >= n) {
    b.tokens -= n;
    return true;
  }
  return false;
}

export interface StrikeWindow {
  times: number[];
}

/** Records a strike and returns how many strikes fall within the window. */
export function addStrike(w: StrikeWindow, now: number): number {
  w.times.push(now);
  const from = now - STRIKES.windowMs;
  while (w.times.length && (w.times[0] as number) < from) w.times.shift();
  return w.times.length;
}
