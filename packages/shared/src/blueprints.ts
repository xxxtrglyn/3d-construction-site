import { PIECE_TYPES, type PieceTypeId } from './pieces.ts';

export type StageName = 'Frame' | 'Walls & Floors' | 'Roof & Windows' | 'Paint' | 'Decoration' | 'Masterpiece';

export interface StageDef {
  readonly number: number;
  readonly name: StageName;
  readonly pieceType: PieceTypeId;
  readonly slotCount: number;
  readonly starsAfter: number;
  readonly modelId: string;
  /** feature 003: slots of this stage that only the crane can fill (counted inside `slotCount`) */
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

const stage = (number: number, name: StageName, pieceType: PieceTypeId, slotCount: number, starsAfter: number, highSlots = 0): StageDef => ({
  number, name, pieceType, slotCount, starsAfter, modelId: `clock-tower-stage-${number}`, highSlots,
});

export const CLOCK_TOWER: Blueprint = {
  id: 'clock-tower',
  name: 'Clock Tower',
  stages: [
    stage(1, 'Frame', 'beam', 6, 1),
    stage(2, 'Walls & Floors', 'brick', 8, 2),
    stage(3, 'Roof & Windows', 'panel', 6, 3, 3),
    stage(4, 'Paint', 'paint', 4, 4),
    stage(5, 'Decoration', 'decor', 5, 5),
    stage(6, 'Masterpiece', 'bell', 1, 5, 1),
  ],
  groundwork: { scoops: 6, concrete: 4 },
};

export const STAGE_COUNT = 6;
export const TOTAL_DELIVERIES = 30;
export const MAX_STARS = 5;

/** Returns a list of rule violations; empty means valid. */
export function validateBlueprint(bp: Blueprint): string[] {
  const errors: string[] = [];
  if (bp.stages.length !== STAGE_COUNT) errors.push(`exactly ${STAGE_COUNT} stages required, got ${bp.stages.length}`);
  let total = 0;
  let prevStars = 0;
  bp.stages.forEach((s, i) => {
    if (s.number !== i + 1) errors.push(`stage ${i} must be numbered ${i + 1}, got ${s.number}`);
    if (!Number.isInteger(s.slotCount) || s.slotCount < 1) errors.push(`stage ${s.number}: slotCount must be ≥ 1`);
    total += s.slotCount;
    if (!PIECE_TYPES[s.pieceType]?.fillsSlots) errors.push(`stage ${s.number}: piece type '${s.pieceType}' cannot fill slots`);
    if (s.starsAfter < prevStars) errors.push(`stage ${s.number}: starsAfter must not decrease`);
    if (s.starsAfter > MAX_STARS) errors.push(`stage ${s.number}: starsAfter capped at ${MAX_STARS}`);
    if (!Number.isInteger(s.highSlots) || s.highSlots < 0 || s.highSlots > s.slotCount) errors.push(`stage ${s.number}: highSlots must be between 0 and slotCount`);
    prevStars = s.starsAfter;
  });
  if (total !== TOTAL_DELIVERIES) errors.push(`total slots must be ${TOTAL_DELIVERIES}, got ${total}`);
  const g = bp.groundwork;
  if (!g || !Number.isInteger(g.scoops) || g.scoops < 1 || !Number.isInteger(g.concrete) || g.concrete < 1) errors.push('groundwork needs ≥ 1 scoop and ≥ 1 concrete');
  return errors;
}
