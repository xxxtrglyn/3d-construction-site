import { blueprintById, type Blueprint, type RecipeItem, type StageDef } from './blueprints.ts';
import type { PieceTypeId } from './pieces.ts';

export interface TowerProgress {
  /** the blueprint (recipe version) this building was started with (feature 004, research R2) */
  readonly blueprintId: string;
  /** feature 003 Groundwork: scoops dug (0..blueprint.groundwork.scoops) */
  readonly groundDug: number;
  /** feature 003 Groundwork: concrete buckets poured into the footing (0..blueprint.groundwork.concrete) */
  readonly groundPoured: number;
  /** 0 = empty foundation, 6 = masterpiece */
  readonly completedStages: number;
  /**
   * feature 004: slots filled in the current stage, one count per recipe item (high fills included).
   * Length = the current stage's recipe length (0 after the Masterpiece).
   */
  readonly filled: readonly number[];
  /** feature 003: high slots filled in the current stage (only ever by the crane; all belong to the one high item) */
  readonly highFilled: number;
}

/** How a piece reached the tower (feature 003). Only the crane can fill high slots. */
export type Via = 'hand' | 'forklift' | 'crane';

export type DeliverResult =
  | 'snapped' | 'stageComplete' | 'masterpiece' | 'wrongPiece' | 'alreadyComplete'
  | 'groundworkFirst' | 'tooHigh'
  /** feature 004: the material is in the recipe but already complete */
  | 'surplus';

export type PourResult = 'poured' | 'groundworkDone' | 'notDug' | 'alreadyPoured';

/** feature 004: what a stage still needs of one material (data-model §4). */
export interface Need {
  readonly type: PieceTypeId;
  readonly total: number;
  readonly left: number;
  /** crane-only slots of this material still open */
  readonly highLeft: number;
  /** only crane slots remain for this material */
  readonly craneOnly: boolean;
  readonly done: boolean;
}

/** The blueprint a progress belongs to. */
export const blueprintOf = (p: TowerProgress): Blueprint => blueprintById(p.blueprintId);

/** Zeros for every recipe item of a stage (empty for no stage). */
export const emptyFilled = (st: StageDef | null | undefined): number[] => (st ? st.recipe.map(() => 0) : []);

export function initialProgress(bp: Blueprint = blueprintById('clock-tower')): TowerProgress {
  return { blueprintId: bp.id, groundDug: 0, groundPoured: 0, completedStages: 0, filled: emptyFilled(bp.stages[0]), highFilled: 0 };
}

export function reset(progress: TowerProgress): TowerProgress {
  return initialProgress(blueprintOf(progress));
}

export function isMasterpiece(progress: TowerProgress, bp: Blueprint = blueprintOf(progress)): boolean {
  return progress.completedStages >= bp.stages.length;
}

export function currentStage(progress: TowerProgress, bp: Blueprint = blueprintOf(progress)): StageDef | null {
  return bp.stages[progress.completedStages] ?? null;
}

/** Filled slots of the current stage, all materials together. */
export function filledTotal(p: TowerProgress): number {
  let n = 0;
  for (const f of p.filled) n += f;
  return n;
}

/** Index of the recipe item that owns the stage's high slots, or -1. */
export const highItem = (st: StageDef): number => st.recipe.findIndex((r) => r.high > 0);

/** Filled count of recipe item `i` (missing entries count as 0, e.g. a freshly restored row). */
const filledAt = (p: TowerProgress, i: number): number => p.filled[i] ?? 0;

/** Open ordinary and high slots of one recipe item. */
function openOf(p: TowerProgress, st: StageDef, i: number): { ordinary: number; high: number } {
  const r = st.recipe[i] as RecipeItem;
  const h = i === highItem(st) ? p.highFilled : 0;
  return { ordinary: r.count - r.high - (filledAt(p, i) - h), high: r.high - h };
}

/** Open ordinary/high slots of one material in the current stage (zeros when the stage does not use it). */
export function openSlotsOf(p: TowerProgress, type: PieceTypeId, bp: Blueprint = blueprintOf(p)): { ordinary: number; high: number } {
  const st = currentStage(p, bp);
  const i = st ? st.recipe.findIndex((r) => r.type === type) : -1;
  return st && i >= 0 ? openOf(p, st, i) : { ordinary: 0, high: 0 };
}

/** Empty hand (ordinary) slots and empty high slots of the current stage, all materials together. */
export function openSlots(p: TowerProgress, bp: Blueprint = blueprintOf(p)): { hand: number; high: number } {
  const st = currentStage(p, bp);
  if (!st) return { hand: 0, high: 0 };
  let hand = 0;
  let high = 0;
  st.recipe.forEach((_, i) => {
    const o = openOf(p, st, i);
    hand += o.ordinary;
    high += o.high;
  });
  return { hand, high };
}

/** feature 004: per-material needs of the current stage, recipe order; [] outside a stage (data-model §4). */
export function needsOf(p: TowerProgress, bp: Blueprint = blueprintOf(p)): Need[] {
  if (groundworkPart(p, bp)) return [];
  const st = currentStage(p, bp);
  if (!st) return [];
  return st.recipe.map((r, i) => {
    const o = openOf(p, st, i);
    const left = o.ordinary + o.high;
    return { type: r.type, total: r.count, left, highLeft: o.high, craneOnly: left > 0 && o.ordinary === 0, done: left === 0 };
  });
}

/** The main material of the current stage (null at the Masterpiece). Groundwork is not a stage. */
export function neededPiece(progress: TowerProgress, bp: Blueprint = blueprintOf(progress)): PieceTypeId | null {
  return currentStage(progress, bp)?.pieceType ?? null;
}

export function starsOf(progress: TowerProgress, bp: Blueprint = blueprintOf(progress)): number {
  if (progress.completedStages <= 0) return 0;
  return bp.stages[progress.completedStages - 1]?.starsAfter ?? 0;
}

// ---------------------------------------------------------------- feature 003: Groundwork

export function groundworkDone(p: TowerProgress, bp: Blueprint = blueprintOf(p)): boolean {
  return p.groundDug >= bp.groundwork.scoops && p.groundPoured >= bp.groundwork.concrete;
}

/** The Groundwork part in progress, or null once it is done. */
export function groundworkPart(p: TowerProgress, bp: Blueprint = blueprintOf(p)): 'dig' | 'concrete' | null {
  if (p.groundDug < bp.groundwork.scoops) return 'dig';
  if (p.groundPoured < bp.groundwork.concrete) return 'concrete';
  return null;
}

/**
 * What supply runs should fetch (forklift loading, rack hints, bots): nothing while digging, cement
 * bags while pouring, then every material of the current stage that is still needed (recipe order).
 */
export function neededSupplies(p: TowerProgress, bp: Blueprint = blueprintOf(p)): PieceTypeId[] {
  const part = groundworkPart(p, bp);
  if (part === 'dig') return [];
  if (part === 'concrete') return ['cement'];
  return needsOf(p, bp).filter((n) => !n.done).map((n) => n.type);
}

/** The first needed supply (see `neededSupplies`), or null. */
export function neededSupply(p: TowerProgress, bp: Blueprint = blueprintOf(p)): PieceTypeId | null {
  return neededSupplies(p, bp)[0] ?? null;
}

/** One excavator scoop dumped at the spoil heap. Returns the same object when the pit is already dug. */
export function dig(p: TowerProgress, bp: Blueprint = blueprintOf(p)): TowerProgress {
  if (p.groundDug >= bp.groundwork.scoops) return p;
  return { ...p, groundDug: p.groundDug + 1 };
}

/** One concrete bucket into the dug pit. The last one completes Groundwork. */
export function pour(p: TowerProgress, bp: Blueprint = blueprintOf(p)): { progress: TowerProgress; result: PourResult } {
  if (p.groundDug < bp.groundwork.scoops) return { progress: p, result: 'notDug' };
  if (p.groundPoured >= bp.groundwork.concrete) return { progress: p, result: 'alreadyPoured' };
  const progress = { ...p, groundPoured: p.groundPoured + 1 };
  return { progress, result: progress.groundPoured >= bp.groundwork.concrete ? 'groundworkDone' : 'poured' };
}

/**
 * Pure transition: one delivery changes progress by at most one slot (data-model §5).
 * 1. Groundwork incomplete → `groundworkFirst` (concrete goes through `pour`, never here).
 * 2. No current stage → `alreadyComplete`.
 * 3. Material not in the recipe → `wrongPiece`.
 * 4. Material complete → `surplus`.
 * 5. A crane piece aimed at a high slot (or with no ordinary slot of its material left) takes a high slot.
 * 6. Otherwise it takes an ordinary slot of its material.
 * 7. A hand or forklift piece whose only open slots are high → `tooHigh`.
 * The stage completes when every recipe item is full.
 */
export function deliver(
  progress: TowerProgress,
  pieceType: PieceTypeId,
  via: Via = 'hand',
  slot?: { high: boolean },
  bp: Blueprint = blueprintOf(progress),
): { progress: TowerProgress; result: DeliverResult } {
  if (!groundworkDone(progress, bp)) return { progress, result: 'groundworkFirst' };
  const stage = currentStage(progress, bp);
  if (!stage) return { progress, result: 'alreadyComplete' };
  const i = stage.recipe.findIndex((r) => r.type === pieceType);
  if (i < 0) return { progress, result: 'wrongPiece' };
  const open = openOf(progress, stage, i);
  if (open.ordinary + open.high <= 0) return { progress, result: 'surplus' };
  let high = false;
  if (via === 'crane' && open.high > 0 && (!!slot?.high || open.ordinary <= 0)) high = true;
  else if (open.ordinary <= 0) return { progress, result: 'tooHigh' };
  const filled = stage.recipe.map((_, k) => filledAt(progress, k) + (k === i ? 1 : 0));
  const done = stage.recipe.every((r, k) => (filled[k] ?? 0) >= r.count);
  if (!done) {
    return { progress: { ...progress, filled, highFilled: progress.highFilled + (high ? 1 : 0) }, result: 'snapped' };
  }
  const completedStages = progress.completedStages + 1;
  const next: TowerProgress = { ...progress, completedStages, filled: emptyFilled(bp.stages[completedStages]), highFilled: 0 };
  return { progress: next, result: completedStages >= bp.stages.length ? 'masterpiece' : 'stageComplete' };
}
