import { CLOCK_TOWER, type Blueprint, type StageDef } from './blueprints.ts';
import type { PieceTypeId } from './pieces.ts';

export interface TowerProgress {
  readonly blueprintId: string;
  /** 0 = empty foundation, 6 = masterpiece */
  readonly completedStages: number;
  /** slots filled in the stage currently being built */
  readonly filledSlots: number;
}

export type DeliverResult = 'snapped' | 'stageComplete' | 'masterpiece' | 'wrongPiece' | 'alreadyComplete';

export function initialProgress(bp: Blueprint = CLOCK_TOWER): TowerProgress {
  return { blueprintId: bp.id, completedStages: 0, filledSlots: 0 };
}

export function reset(progress: TowerProgress): TowerProgress {
  return { blueprintId: progress.blueprintId, completedStages: 0, filledSlots: 0 };
}

export function isMasterpiece(progress: TowerProgress, bp: Blueprint = CLOCK_TOWER): boolean {
  return progress.completedStages >= bp.stages.length;
}

export function currentStage(progress: TowerProgress, bp: Blueprint = CLOCK_TOWER): StageDef | null {
  return bp.stages[progress.completedStages] ?? null;
}

export function neededPiece(progress: TowerProgress, bp: Blueprint = CLOCK_TOWER): PieceTypeId | null {
  return currentStage(progress, bp)?.pieceType ?? null;
}

export function starsOf(progress: TowerProgress, bp: Blueprint = CLOCK_TOWER): number {
  if (progress.completedStages <= 0) return 0;
  return bp.stages[progress.completedStages - 1]?.starsAfter ?? 0;
}

/** Pure transition: one delivery changes progress by at most one slot. */
export function deliver(
  progress: TowerProgress,
  pieceType: PieceTypeId,
  bp: Blueprint = CLOCK_TOWER,
): { progress: TowerProgress; result: DeliverResult } {
  const stage = currentStage(progress, bp);
  if (!stage) return { progress, result: 'alreadyComplete' };
  if (pieceType !== stage.pieceType) return { progress, result: 'wrongPiece' };
  const filled = progress.filledSlots + 1;
  if (filled < stage.slotCount) {
    return { progress: { ...progress, filledSlots: filled }, result: 'snapped' };
  }
  const completedStages = progress.completedStages + 1;
  const next: TowerProgress = { ...progress, completedStages, filledSlots: 0 };
  return { progress: next, result: completedStages >= bp.stages.length ? 'masterpiece' : 'stageComplete' };
}
