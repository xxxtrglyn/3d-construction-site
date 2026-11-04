import { NET } from './constants.ts';

export type Tier = 1 | 2 | 3;

const [T1, T2] = NET.tiers;
const H = NET.hysteresisM;
const RADII = [T1, T2] as const;

/** Interest tier by distance with hysteresis (moving outward needs d > r + h, inward d ≤ r − h). */
export function tierFor(d: number, prev: Tier | 0 = 0): Tier {
  if (prev === 0) return d <= T1 ? 1 : d <= T2 ? 2 : 3;
  let t: number = prev;
  while (t < 3 && d > (RADII[t - 1] as number) + H) t++;
  while (t > 1 && d <= (RADII[t - 2] as number) - H) t--;
  return t as Tier;
}

/** Tier 1 every tick (20 Hz), tier 2 every 2nd (10 Hz), tier 3 every 5th (4 Hz); `phase` spreads entities. */
export function isDue(tier: Tier, tick: number, phase = 0): boolean {
  if (tier === 1) return true;
  const n = tier === 2 ? 2 : 5;
  return (tick + phase) % n === 0;
}
