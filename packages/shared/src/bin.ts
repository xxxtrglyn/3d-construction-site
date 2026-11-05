import { BIN } from './constants.ts';
import type { Blueprint } from './blueprints.ts';
import type { PieceTypeId } from './pieces.ts';
import { groundworkPart, needsOf, type TowerProgress } from './progression.ts';

/** A donated piece in a plot's supply bin. */
export interface BinEntry {
  type: PieceTypeId;
  donorKeyHash: string;
  donorPid: string | null;
}

/**
 * Bins accept building pieces the blueprint uses, and cement bags (feature 003). Never cones, and never
 * concrete buckets: those exist only as mixer output for the crew (FR-020).
 */
export function canBin(type: PieceTypeId, bp: Blueprint): boolean {
  if (type === 'concrete') return false;
  return type === 'cement' || bp.stages.some((s) => s.recipe.some((r) => r.type === type));
}

/** Why a bin refuses a donation (feature 004, data-model §7). */
export type BinRefusal = 'notBinnable' | 'notNeeded' | 'full';

/**
 * feature 004 (FR-018): a bin accepts a building piece only while the current stage (the Frame during
 * Groundwork) still needs that material beyond the matching pieces already binned, and has room.
 * Cement keeps the 003 rule.
 */
export function binAccepts(type: PieceTypeId, p: TowerProgress, bin: readonly BinEntry[], bp: Blueprint, capacity: number = BIN.capacity): BinRefusal | null {
  if (!canBin(type, bp)) return 'notBinnable';
  if (type !== 'cement') {
    // during Groundwork helpers may already stock the Frame's materials
    const q = groundworkPart(p, bp) ? { ...p, groundDug: bp.groundwork.scoops, groundPoured: bp.groundwork.concrete } : p;
    const left = needsOf(q, bp).find((n) => n.type === type)?.left ?? 0;
    const binned = bin.reduce((n, e) => n + (e.type === type ? 1 : 0), 0);
    if (left - binned <= 0) return 'notNeeded';
  }
  return bin.length >= capacity ? 'full' : null;
}

/** Adds `e` when there is room ("up to 10 pieces"). */
export function addToBin(bin: BinEntry[], e: BinEntry, capacity: number = BIN.capacity): boolean {
  if (bin.length >= capacity) return false;
  bin.push(e);
  return true;
}

/** Takes a piece, preferring the types in `prefer` (in that order: what the tower needs), else the most recent donation. */
export function takeFromBin(bin: BinEntry[], prefer: readonly PieceTypeId[]): BinEntry | undefined {
  let i = -1;
  for (const t of prefer) {
    i = bin.findIndex((e) => e.type === t);
    if (i >= 0) break;
  }
  if (i < 0) i = bin.length - 1;
  if (i < 0) return undefined;
  return bin.splice(i, 1)[0];
}
