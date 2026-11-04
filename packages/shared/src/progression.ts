import { CLOCK_TOWER, type Blueprint, type StageDef } from './blueprints.ts';
import type { PieceTypeId } from './pieces.ts';

export interface TowerProgress {
  readonly blueprintId: string;
  /** feature 003 Groundwork: scoops dug (0..blueprint.groundwork.scoops) */
  readonly groundDug: number;
  /** feature 003 Groundwork: concrete buckets poured into the footing (0..blueprint.groundwork.concrete) */
  readonly groundPoured: number;
  /** 0 = empty foundation, 6 = masterpiece */
  readonly completedStages: number;
  /** slots filled in the stage currently being built (hand and high slots together) */
  readonly filledSlots: number;
  /** feature 003: high slots filled in the current stage (only ever by the crane) */
  readonly highFilled: number;
}

/** How a piece reached the tower (feature 003). Only the crane can fill high slots. */
export type Via = 'hand' | 'forklift' | 'crane';

export type DeliverResult =
  | 'snapped' | 'stageComplete' | 'masterpiece' | 'wrongPiece' | 'alreadyComplete'
  | 'groundworkFirst' | 'tooHigh';

export type PourResult = 'poured' | 'groundworkDone' | 'notDug' | 'alreadyPoured';

export function initialProgress(bp: Blueprint = CLOCK_TOWER): TowerProgress {
  return { blueprintId: bp.id, groundDug: 0, groundPoured: 0, completedStages: 0, filledSlots: 0, highFilled: 0 };
}

export function reset(progress: TowerProgress): TowerProgress {
  return { blueprintId: progress.blueprintId, groundDug: 0, groundPoured: 0, completedStages: 0, filledSlots: 0, highFilled: 0 };
}

export function isMasterpiece(progress: TowerProgress, bp: Blueprint = CLOCK_TOWER): boolean {
  return progress.completedStages >= bp.stages.length;
}

export function currentStage(progress: TowerProgress, bp: Blueprint = CLOCK_TOWER): StageDef | null {
  return bp.stages[progress.completedStages] ?? null;
}

/** The piece type of the current stage (null at the Masterpiece). Groundwork is not a stage. */
export function neededPiece(progress: TowerProgress, bp: Blueprint = CLOCK_TOWER): PieceTypeId | null {
  return currentStage(progress, bp)?.pieceType ?? null;
}

export function starsOf(progress: TowerProgress, bp: Blueprint = CLOCK_TOWER): number {
  if (progress.completedStages <= 0) return 0;
  return bp.stages[progress.completedStages - 1]?.starsAfter ?? 0;
}

// ---------------------------------------------------------------- feature 003: Groundwork

export function groundworkDone(p: TowerProgress, bp: Blueprint = CLOCK_TOWER): boolean {
  return p.groundDug >= bp.groundwork.scoops && p.groundPoured >= bp.groundwork.concrete;
}

/** The Groundwork part in progress, or null once it is done. */
export function groundworkPart(p: TowerProgress, bp: Blueprint = CLOCK_TOWER): 'dig' | 'concrete' | null {
  if (p.groundDug < bp.groundwork.scoops) return 'dig';
  if (p.groundPoured < bp.groundwork.concrete) return 'concrete';
  return null;
}

/**
 * What a supply run should fetch (forklift loading, rack hints): nothing while digging, cement bags
 * while pouring, then the current stage's piece type.
 */
export function neededSupply(p: TowerProgress, bp: Blueprint = CLOCK_TOWER): PieceTypeId | null {
  const part = groundworkPart(p, bp);
  if (part === 'dig') return null;
  if (part === 'concrete') return 'cement';
  return neededPiece(p, bp);
}

/** One excavator scoop dumped at the spoil heap. Returns the same object when the pit is already dug. */
export function dig(p: TowerProgress, bp: Blueprint = CLOCK_TOWER): TowerProgress {
  if (p.groundDug >= bp.groundwork.scoops) return p;
  return { ...p, groundDug: p.groundDug + 1 };
}

/** One concrete bucket into the dug pit. The last one completes Groundwork. */
export function pour(p: TowerProgress, bp: Blueprint = CLOCK_TOWER): { progress: TowerProgress; result: PourResult } {
  if (p.groundDug < bp.groundwork.scoops) return { progress: p, result: 'notDug' };
  if (p.groundPoured >= bp.groundwork.concrete) return { progress: p, result: 'alreadyPoured' };
  const progress = { ...p, groundPoured: p.groundPoured + 1 };
  return { progress, result: progress.groundPoured >= bp.groundwork.concrete ? 'groundworkDone' : 'poured' };
}

/** Empty hand slots and empty high slots of the current stage (counter model, research M6). */
export function openSlots(p: TowerProgress, bp: Blueprint = CLOCK_TOWER): { hand: number; high: number } {
  const st = currentStage(p, bp);
  if (!st) return { hand: 0, high: 0 };
  return { hand: st.slotCount - st.highSlots - (p.filledSlots - p.highFilled), high: st.highSlots - p.highFilled };
}

/**
 * Pure transition: one delivery changes progress by at most one slot.
 * - Groundwork incomplete → `groundworkFirst` (concrete goes through `pour`, never here).
 * - Wrong type → `wrongPiece`.
 * - A hand or forklift piece, or a crane piece aimed at a hand slot, takes the next hand slot; when
 *   only high slots remain it is `tooHigh`.
 * - A crane piece aimed at a high slot (`slot.high`) takes the next high slot (or a hand slot if every
 *   high slot is already full).
 */
export function deliver(
  progress: TowerProgress,
  pieceType: PieceTypeId,
  via: Via = 'hand',
  slot?: { high: boolean },
  bp: Blueprint = CLOCK_TOWER,
): { progress: TowerProgress; result: DeliverResult } {
  if (!groundworkDone(progress, bp)) return { progress, result: 'groundworkFirst' };
  const stage = currentStage(progress, bp);
  if (!stage) return { progress, result: 'alreadyComplete' };
  if (pieceType !== stage.pieceType) return { progress, result: 'wrongPiece' };
  const open = openSlots(progress, bp);
  let high = via === 'crane' && !!slot?.high && open.high > 0;
  if (!high && open.hand <= 0) {
    if (via !== 'crane' || open.high <= 0) return { progress, result: 'tooHigh' };
    high = true; // a crane piece always has a slot to go to while high slots are open
  }
  const filled = progress.filledSlots + 1;
  if (filled < stage.slotCount) {
    return { progress: { ...progress, filledSlots: filled, highFilled: progress.highFilled + (high ? 1 : 0) }, result: 'snapped' };
  }
  const completedStages = progress.completedStages + 1;
  const next: TowerProgress = { ...progress, completedStages, filledSlots: 0, highFilled: 0 };
  return { progress: next, result: completedStages >= bp.stages.length ? 'masterpiece' : 'stageComplete' };
}
