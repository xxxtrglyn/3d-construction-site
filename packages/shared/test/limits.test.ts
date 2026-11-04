import { describe, expect, it } from 'vitest';
import { addStrike, bucketFor, createBucket, isDue, take, tierFor, uniqueName, isValidGuestName, isEmoteId, isQuickMessageId, STRIKES } from '../src/index.ts';

describe('rate limits', () => {
  it('allows the burst, then refills at the configured rate', () => {
    const b = createBucket(2, 4, 0);
    for (let i = 0; i < 4; i++) expect(take(b, 0)).toBe(true);
    expect(take(b, 0)).toBe(false);
    expect(take(b, 400)).toBe(false); // 0.8 token
    expect(take(b, 500)).toBe(true); // 1 token after 0.5 s
    const move = bucketFor('move', 0);
    let ok = 0;
    for (let t = 0; t <= 1000; t += 50) for (let k = 0; k < 6; k++) if (take(move, t)) ok++;
    expect(ok).toBeLessThanOrEqual(60 + 12 + 1);
  });
  it('counts strikes within a 10 s window', () => {
    const w = { times: [] as number[] };
    for (let i = 0; i < 29; i++) addStrike(w, i * 100);
    expect(addStrike(w, 3000)).toBe(STRIKES.limit);
    expect(addStrike(w, 20_000)).toBe(1);
  });
});

describe('uniqueName', () => {
  it('returns the base when free and valid suffixed variants for duplicates', () => {
    expect(uniqueName('Sunny Bolt', new Set())).toBe('Sunny Bolt');
    const taken = new Set(['Sunny Bolt']);
    const n1 = uniqueName('Sunny Bolt', taken);
    expect(n1).not.toBe('Sunny Bolt');
    expect(isValidGuestName(n1)).toBe(true);
    taken.add(n1);
    const n2 = uniqueName('Sunny Bolt', taken);
    expect(n2).not.toBe(n1);
    expect(isValidGuestName(n2)).toBe(true);
    const long = 'Chipper Scaffold 42';
    const u = uniqueName(long, new Set([long]));
    expect(u.length).toBeLessThanOrEqual(20);
    expect(isValidGuestName(u)).toBe(true);
  });
});

describe('interest tiers', () => {
  it('uses 15/35 m radii with 2 m hysteresis', () => {
    expect(tierFor(10)).toBe(1);
    expect(tierFor(20)).toBe(2);
    expect(tierFor(50)).toBe(3);
    expect(tierFor(16, 1)).toBe(1); // inside hysteresis
    expect(tierFor(17.5, 1)).toBe(2);
    expect(tierFor(14, 2)).toBe(2);
    expect(tierFor(12.9, 2)).toBe(1);
    expect(tierFor(36, 2)).toBe(2);
    expect(tierFor(38, 2)).toBe(3);
    expect(tierFor(5, 3)).toBe(1);
  });
  it('does not flap around the boundary', () => {
    let t = tierFor(15);
    let changes = 0;
    for (let i = 0; i < 100; i++) {
      const n = tierFor(15 + Math.sin(i) * 1.5, t);
      if (n !== t) changes++;
      t = n;
    }
    expect(changes).toBe(0);
  });
  it('due cadence is 20/10/4 Hz', () => {
    const count = (tier: 1 | 2 | 3) => Array.from({ length: 20 }, (_, i) => isDue(tier, i, 3)).filter(Boolean).length;
    expect(count(1)).toBe(20);
    expect(count(2)).toBe(10);
    expect(count(3)).toBe(4);
  });
});

describe('social ids', () => {
  it('guards emote and quick message ids', () => {
    expect(isEmoteId('thumbsUp')).toBe(true);
    expect(isEmoteId('nope')).toBe(false);
    expect(isQuickMessageId('needBricks')).toBe(true);
    expect(isQuickMessageId(3)).toBe(false);
  });
});
