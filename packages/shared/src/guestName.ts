export const NAME_ADJECTIVES = [
  'Sunny', 'Bouncy', 'Cozy', 'Plucky', 'Zippy', 'Jolly', 'Snappy', 'Breezy', 'Chipper', 'Merry',
  'Peppy', 'Sparky', 'Tidy', 'Lucky', 'Brave', 'Comfy', 'Dizzy', 'Fizzy', 'Giggly', 'Happy',
] as const;

export const NAME_NOUNS = [
  'Bolt', 'Brick', 'Beam', 'Rivet', 'Wrench', 'Crane', 'Cone', 'Girder', 'Hammer', 'Ladder',
  'Shovel', 'Trowel', 'Pulley', 'Scaffold', 'Digger', 'Mixer', 'Plank', 'Nut', 'Spanner', 'Bucket',
] as const;

export type HatColorId = 'yellow' | 'orange' | 'white' | 'red' | 'teal' | 'pink' | 'purple' | 'lime';

export const HAT_COLORS: Readonly<Record<HatColorId, string>> = {
  yellow: '#ffcc2e', orange: '#ff7a1f', white: '#f7f7f7', red: '#eb4747',
  teal: '#38a8b3', pink: '#ff8cb8', purple: '#9e73e6', lime: '#8ce04d',
};

export const HAT_COLOR_IDS = Object.keys(HAT_COLORS) as HatColorId[];

export type Rng = () => number;

const pick = <T>(list: readonly T[], rng: Rng): T => list[Math.floor(rng() * list.length) % list.length] as T;

/** "Sunny Bolt" or "Sunny Bolt 42"; always 3–20 chars, only list words. */
export function generateName(rng: Rng = Math.random): string {
  const base = `${pick(NAME_ADJECTIVES, rng)} ${pick(NAME_NOUNS, rng)}`;
  const withSuffix = rng() < 0.5 ? `${base} ${10 + Math.floor(rng() * 90)}` : base;
  return withSuffix.length <= 20 ? withSuffix : base;
}

export function randomHatColor(rng: Rng = Math.random): HatColorId {
  return pick(HAT_COLOR_IDS, rng);
}

export function isHatColorId(v: unknown): v is HatColorId {
  return typeof v === 'string' && v in HAT_COLORS;
}

/** Validates that a name could have been produced by generateName. */
export function isValidGuestName(name: unknown): name is string {
  if (typeof name !== 'string' || name.length < 3 || name.length > 20) return false;
  const parts = name.split(' ');
  if (parts.length < 2 || parts.length > 3) return false;
  const [adj, noun, suffix] = parts;
  if (!(NAME_ADJECTIVES as readonly string[]).includes(adj ?? '')) return false;
  if (!(NAME_NOUNS as readonly string[]).includes(noun ?? '')) return false;
  return suffix === undefined || /^[1-9][0-9]$/.test(suffix);
}

/** Small deterministic PRNG (mulberry32) for tests and seeded generation. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
