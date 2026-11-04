import { describe, expect, it } from 'vitest';
import { CLOCK_TOWER, validateBlueprint, type Blueprint, type StageDef } from '../src/index.ts';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const mutate = (fn: (stages: Mutable<StageDef>[]) => void): Blueprint => {
  const stages: Mutable<StageDef>[] = CLOCK_TOWER.stages.map((s) => ({ ...s }));
  fn(stages);
  return { ...CLOCK_TOWER, stages };
};

describe('validateBlueprint', () => {
  it('accepts the Clock Tower', () => {
    expect(validateBlueprint(CLOCK_TOWER)).toEqual([]);
  });
  it('has the agreed slot counts (30 deliveries)', () => {
    expect(CLOCK_TOWER.stages.map((s) => s.slotCount)).toEqual([6, 8, 6, 4, 5, 1]);
    expect(CLOCK_TOWER.stages.map((s) => s.pieceType)).toEqual(['beam', 'brick', 'panel', 'paint', 'decor', 'bell']);
  });
  it('rejects wrong stage count', () => {
    expect(validateBlueprint({ ...CLOCK_TOWER, stages: CLOCK_TOWER.stages.slice(0, 5) }).length).toBeGreaterThan(0);
  });
  it('rejects bad numbering', () => {
    expect(validateBlueprint(mutate((s) => { s[2]!.number = 7; }))).toContainEqual(expect.stringContaining('numbered'));
  });
  it('rejects zero slots and wrong total', () => {
    const errs = validateBlueprint(mutate((s) => { s[0]!.slotCount = 0; }));
    expect(errs.some((e) => e.includes('slotCount'))).toBe(true);
    expect(errs.some((e) => e.includes('total'))).toBe(true);
  });
  it('rejects cones as slot pieces', () => {
    expect(validateBlueprint(mutate((s) => { s[0]!.pieceType = 'cone'; }))).toContainEqual(expect.stringContaining('cannot fill'));
  });
  it('rejects decreasing or excessive stars', () => {
    expect(validateBlueprint(mutate((s) => { s[3]!.starsAfter = 1; }))).toContainEqual(expect.stringContaining('decrease'));
    expect(validateBlueprint(mutate((s) => { s[5]!.starsAfter = 6; }))).toContainEqual(expect.stringContaining('capped'));
  });
});
