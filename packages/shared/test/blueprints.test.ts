import { describe, expect, it } from 'vitest';
import {
  BLUEPRINTS, CLOCK_TOWER, CLOCK_TOWER_V1, TOTAL_DELIVERIES, blueprintById, deliveriesOf, isBlueprintId, validateBlueprint,
  type Blueprint, type RecipeItem, type StageDef,
} from '../src/index.ts';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const mutate = (fn: (stages: Mutable<StageDef>[]) => void, bp: Blueprint = CLOCK_TOWER): Blueprint => {
  const stages: Mutable<StageDef>[] = bp.stages.map((s) => ({ ...s, recipe: s.recipe.map((r) => ({ ...r })) }));
  fn(stages);
  return { ...bp, stages };
};
/** Replace a stage's recipe and keep the derived totals consistent (so only the rule under test fails). */
const withRecipe = (stageIdx: number, recipe: RecipeItem[]): Blueprint =>
  mutate((s) => {
    const st = s[stageIdx]!;
    st.recipe = recipe;
    st.slotCount = recipe.reduce((a, r) => a + r.count, 0);
    st.highSlots = recipe.reduce((a, r) => a + r.high, 0);
    if (recipe[0]) st.pieceType = recipe[0].type;
  });

describe('blueprints 004: recipes', () => {
  it('the Clock Tower has the owner-approved two-material recipes (31 deliveries)', () => {
    expect(CLOCK_TOWER.stages.map((s) => s.recipe.map((r) => [r.type, r.count, r.high]))).toEqual([
      [['beam', 4, 0], ['brick', 2, 0]],
      [['brick', 6, 0], ['beam', 2, 0]],
      [['panel', 4, 3], ['beam', 2, 0]],
      [['paint', 3, 0], ['panel', 1, 0]],
      [['decor', 3, 0], ['paint', 2, 0]],
      [['bell', 1, 1], ['decor', 1, 0]],
    ]);
    expect(TOTAL_DELIVERIES).toBe(31);
    expect(deliveriesOf(CLOCK_TOWER)).toBe(31);
    expect(CLOCK_TOWER.stages.map((s) => s.slotCount)).toEqual([6, 8, 6, 4, 5, 2]);
  });
  it('the legacy blueprint keeps the 001–003 one-material stages (30 deliveries)', () => {
    expect(CLOCK_TOWER_V1.stages.map((s) => s.recipe.map((r) => [r.type, r.count, r.high]))).toEqual([
      [['beam', 6, 0]], [['brick', 8, 0]], [['panel', 6, 3]], [['paint', 4, 0]], [['decor', 5, 0]], [['bell', 1, 1]],
    ]);
    expect(deliveriesOf(CLOCK_TOWER_V1)).toBe(30);
  });
  it('main material, totals and high slots are derived from the recipe', () => {
    for (const bp of [CLOCK_TOWER, CLOCK_TOWER_V1]) {
      for (const s of bp.stages) {
        expect(s.pieceType).toBe(s.recipe[0]!.type);
        expect(s.slotCount).toBe(s.recipe.reduce((a, r) => a + r.count, 0));
        expect(s.highSlots).toBe(s.recipe.reduce((a, r) => a + r.high, 0));
      }
      expect(bp.stages.map((s) => s.highSlots)).toEqual([0, 0, 3, 0, 0, 1]);
      expect(bp.stages.map((s) => s.pieceType)).toEqual(['beam', 'brick', 'panel', 'paint', 'decor', 'bell']);
      expect(bp.groundwork).toEqual({ scoops: 6, concrete: 4 });
    }
  });
  it('blueprintById looks up both versions and throws on unknown ids', () => {
    expect(blueprintById('clock-tower')).toBe(CLOCK_TOWER);
    expect(blueprintById('clock-tower-v1')).toBe(CLOCK_TOWER_V1);
    expect(() => blueprintById('pyramid')).toThrow();
    expect(isBlueprintId('clock-tower-v1')).toBe(true);
    expect(isBlueprintId('toString')).toBe(false);
    expect(Object.keys(BLUEPRINTS).sort()).toEqual(['clock-tower', 'clock-tower-v1']);
  });
});

describe('validateBlueprint', () => {
  it('accepts both Clock Towers', () => {
    expect(validateBlueprint(CLOCK_TOWER)).toEqual([]);
    expect(validateBlueprint(CLOCK_TOWER_V1)).toEqual([]);
  });
  it('rejects wrong stage count and bad numbering', () => {
    expect(validateBlueprint({ ...CLOCK_TOWER, stages: CLOCK_TOWER.stages.slice(0, 5) }).length).toBeGreaterThan(0);
    expect(validateBlueprint(mutate((s) => { s[2]!.number = 7; }))).toContainEqual(expect.stringContaining('numbered'));
  });
  it('rejects 0 or 3 materials and duplicate materials', () => {
    expect(validateBlueprint(withRecipe(0, []))).toContainEqual(expect.stringContaining('1 or 2 materials'));
    expect(validateBlueprint(withRecipe(0, [{ type: 'beam', count: 2, high: 0 }, { type: 'brick', count: 2, high: 0 }, { type: 'paint', count: 2, high: 0 }])))
      .toContainEqual(expect.stringContaining('1 or 2 materials'));
    expect(validateBlueprint(withRecipe(0, [{ type: 'beam', count: 3, high: 0 }, { type: 'beam', count: 3, high: 0 }]))).toContainEqual(expect.stringContaining('duplicate'));
  });
  it('rejects high slots on two materials, high > count, and a high total that does not match the site layout', () => {
    expect(validateBlueprint(withRecipe(2, [{ type: 'panel', count: 4, high: 2 }, { type: 'beam', count: 2, high: 1 }]))).toContainEqual(expect.stringContaining('at most one material'));
    expect(validateBlueprint(withRecipe(5, [{ type: 'bell', count: 1, high: 2 }]))).toContainEqual(expect.stringContaining('high must be between'));
    expect(validateBlueprint(withRecipe(0, [{ type: 'beam', count: 6, high: 1 }]))).toContainEqual(expect.stringContaining('high slots (site layout)'));
  });
  it('rejects zero counts, non-slot pieces and a pieceType that is not the main material', () => {
    expect(validateBlueprint(withRecipe(0, [{ type: 'beam', count: 0, high: 0 }]))).toContainEqual(expect.stringContaining('count must be'));
    expect(validateBlueprint(withRecipe(0, [{ type: 'cone', count: 6, high: 0 }]))).toContainEqual(expect.stringContaining('cannot fill'));
    expect(validateBlueprint(mutate((s) => { s[0]!.pieceType = 'brick'; }))).toContainEqual(expect.stringContaining('first recipe material'));
    expect(validateBlueprint(mutate((s) => { s[0]!.slotCount = 5; }))).toContainEqual(expect.stringContaining('recipe total'));
  });
  it('rejects decreasing or excessive stars', () => {
    expect(validateBlueprint(mutate((s) => { s[3]!.starsAfter = 1; }))).toContainEqual(expect.stringContaining('decrease'));
    expect(validateBlueprint(mutate((s) => { s[5]!.starsAfter = 6; }))).toContainEqual(expect.stringContaining('capped'));
  });
});
