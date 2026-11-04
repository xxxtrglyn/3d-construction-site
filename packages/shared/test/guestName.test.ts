import { describe, expect, it } from 'vitest';
import { HAT_COLOR_IDS, generateName, isValidGuestName, randomHatColor, seededRng } from '../src/index.ts';

describe('guest names', () => {
  it('are 3–20 chars from the word lists', () => {
    const rng = seededRng(1);
    for (let i = 0; i < 500; i++) {
      const n = generateName(rng);
      expect(n.length).toBeGreaterThanOrEqual(3);
      expect(n.length).toBeLessThanOrEqual(20);
      expect(isValidGuestName(n)).toBe(true);
    }
  });
  it('are deterministic with a seeded rng', () => {
    expect(generateName(seededRng(42))).toBe(generateName(seededRng(42)));
  });
  it('reject free text', () => {
    expect(isValidGuestName('hello world')).toBe(false);
    expect(isValidGuestName('Sunny Bolt 7')).toBe(false);
    expect(isValidGuestName('Sunny Bolt 42')).toBe(true);
  });
  it('hat colors are valid ids', () => {
    const rng = seededRng(3);
    for (let i = 0; i < 100; i++) expect(HAT_COLOR_IDS).toContain(randomHatColor(rng));
  });
});
