import { PIECE_TYPES, type PieceTypeId } from './pieces.ts';

export type StageName = 'Frame' | 'Walls & Floors' | 'Roof & Windows' | 'Paint' | 'Decoration' | 'Masterpiece';

/** feature 004: one material of a stage's recipe (research R1). */
export interface RecipeItem {
  readonly type: PieceTypeId;
  /** slots of this material in the stage */
  readonly count: number;
  /** how many of them only the crane can fill (feature 003 high slots) */
  readonly high: number;
}

export interface StageDef {
  readonly number: number;
  readonly name: StageName;
  /** the stage's main material (= recipe[0].type); it names the look and the stage model */
  readonly pieceType: PieceTypeId;
  /** feature 004: the materials this stage needs, main material first (1–2 items) */
  readonly recipe: readonly RecipeItem[];
  /** Σ recipe counts */
  readonly slotCount: number;
  readonly starsAfter: number;
  readonly modelId: string;
  /** feature 003: slots of this stage that only the crane can fill (Σ recipe high, counted inside `slotCount`) */
  readonly highSlots: number;
}

/** feature 003: the step before stage 1 — dig the pit, then pour the footing. */
export interface GroundworkDef {
  readonly scoops: number;
  readonly concrete: number;
}

export interface Blueprint {
  readonly id: string;
  readonly name: string;
  readonly stages: readonly StageDef[];
  readonly groundwork: GroundworkDef;
}

/** `[type, count, high?]` shorthand for a recipe item. */
type Item = readonly [PieceTypeId, number, number?];

const stage = (number: number, name: StageName, starsAfter: number, ...items: Item[]): StageDef => {
  const recipe = items.map(([type, count, high = 0]) => ({ type, count, high }));
  return {
    number,
    name,
    pieceType: recipe[0]?.type ?? 'beam',
    recipe,
    slotCount: recipe.reduce((s, r) => s + r.count, 0),
    starsAfter,
    modelId: `clock-tower-stage-${number}`,
    highSlots: recipe.reduce((s, r) => s + r.high, 0),
  };
};

/** feature 004: the current Clock Tower — two materials per stage, 31 deliveries (owner decision 2026-11-05). */
export const CLOCK_TOWER: Blueprint = {
  id: 'clock-tower',
  name: 'Clock Tower',
  stages: [
    stage(1, 'Frame', 1, ['beam', 4], ['brick', 2]),
    stage(2, 'Walls & Floors', 2, ['brick', 6], ['beam', 2]),
    stage(3, 'Roof & Windows', 3, ['panel', 4, 3], ['beam', 2]),
    stage(4, 'Paint', 4, ['paint', 3], ['panel', 1]),
    stage(5, 'Decoration', 5, ['decor', 3], ['paint', 2]),
    stage(6, 'Masterpiece', 5, ['bell', 1, 1], ['decor', 1]),
  ],
  groundwork: { scoops: 6, concrete: 4 },
};

/**
 * The one-material Clock Tower of features 001–003 (30 deliveries). Buildings stored before 004 keep
 * it until they finish or the shift resets (FR-004, research R2); new buildings never use it.
 */
export const CLOCK_TOWER_V1: Blueprint = {
  id: 'clock-tower-v1',
  name: 'Clock Tower',
  stages: [
    stage(1, 'Frame', 1, ['beam', 6]),
    stage(2, 'Walls & Floors', 2, ['brick', 8]),
    stage(3, 'Roof & Windows', 3, ['panel', 6, 3]),
    stage(4, 'Paint', 4, ['paint', 4]),
    stage(5, 'Decoration', 5, ['decor', 5]),
    stage(6, 'Masterpiece', 5, ['bell', 1, 1]),
  ],
  groundwork: { scoops: 6, concrete: 4 },
};

export const BLUEPRINTS: Readonly<Record<string, Blueprint>> = {
  [CLOCK_TOWER.id]: CLOCK_TOWER,
  [CLOCK_TOWER_V1.id]: CLOCK_TOWER_V1,
};

export function isBlueprintId(id: unknown): id is string {
  return typeof id === 'string' && Object.hasOwn(BLUEPRINTS, id);
}

/** The blueprint (recipe version) a building was started with. Unknown ids are a load error. */
export function blueprintById(id: string): Blueprint {
  const bp = BLUEPRINTS[id];
  if (!bp) throw new Error(`unknown blueprint '${id}'`);
  return bp;
}

export const STAGE_COUNT = 6;
export const MAX_STARS = 5;
/** Σ slots of a blueprint. */
export const deliveriesOf = (bp: Blueprint): number => bp.stages.reduce((s, x) => s + x.slotCount, 0);
/** Deliveries of the current Clock Tower (31; the legacy one has 30). */
export const TOTAL_DELIVERIES = deliveriesOf(CLOCK_TOWER);
/** feature 003: crane-only slot points per stage number, as laid out in site.gen.ts / the solo lot (3 roof, 1 bell). */
export const HIGH_SLOT_POINTS: Readonly<Record<number, number>> = { 3: 3, 6: 1 };

/** Returns a list of rule violations; empty means valid (data-model §2). */
export function validateBlueprint(bp: Blueprint): string[] {
  const errors: string[] = [];
  if (bp.stages.length !== STAGE_COUNT) errors.push(`exactly ${STAGE_COUNT} stages required, got ${bp.stages.length}`);
  let prevStars = 0;
  bp.stages.forEach((s, i) => {
    if (s.number !== i + 1) errors.push(`stage ${i} must be numbered ${i + 1}, got ${s.number}`);
    const r = s.recipe;
    if (r.length < 1 || r.length > 2) errors.push(`stage ${s.number}: recipe needs 1 or 2 materials, got ${r.length}`);
    if (r[0] && r[0].type !== s.pieceType) errors.push(`stage ${s.number}: pieceType must be the first recipe material`);
    if (new Set(r.map((x) => x.type)).size !== r.length) errors.push(`stage ${s.number}: duplicate material in recipe`);
    if (r.filter((x) => x.high > 0).length > 1) errors.push(`stage ${s.number}: at most one material may have high slots`);
    for (const x of r) {
      if (!PIECE_TYPES[x.type]?.fillsSlots) errors.push(`stage ${s.number}: piece type '${x.type}' cannot fill slots`);
      if (!Number.isInteger(x.count) || x.count < 1) errors.push(`stage ${s.number}: '${x.type}' count must be ≥ 1`);
      if (!Number.isInteger(x.high) || x.high < 0 || x.high > x.count) errors.push(`stage ${s.number}: '${x.type}' high must be between 0 and count`);
    }
    if (s.slotCount !== r.reduce((a, x) => a + x.count, 0)) errors.push(`stage ${s.number}: slotCount must equal the recipe total`);
    if (s.highSlots !== r.reduce((a, x) => a + x.high, 0)) errors.push(`stage ${s.number}: highSlots must equal the recipe high total`);
    if (s.highSlots !== (HIGH_SLOT_POINTS[s.number] ?? 0)) errors.push(`stage ${s.number}: needs ${HIGH_SLOT_POINTS[s.number] ?? 0} high slots (site layout), got ${s.highSlots}`);
    if (s.starsAfter < prevStars) errors.push(`stage ${s.number}: starsAfter must not decrease`);
    if (s.starsAfter > MAX_STARS) errors.push(`stage ${s.number}: starsAfter capped at ${MAX_STARS}`);
    prevStars = s.starsAfter;
  });
  const g = bp.groundwork;
  if (!g || !Number.isInteger(g.scoops) || g.scoops < 1 || !Number.isInteger(g.concrete) || g.concrete < 1) errors.push('groundwork needs ≥ 1 scoop and ≥ 1 concrete');
  return errors;
}
