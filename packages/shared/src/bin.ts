import { BIN } from './constants.ts';
import type { Blueprint } from './blueprints.ts';
import type { PieceTypeId } from './pieces.ts';

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
  return type === 'cement' || bp.stages.some((s) => s.pieceType === type);
}

/** Adds `e` when there is room ("up to 10 pieces"). */
export function addToBin(bin: BinEntry[], e: BinEntry, capacity: number = BIN.capacity): boolean {
  if (bin.length >= capacity) return false;
  bin.push(e);
  return true;
}

/** Takes a piece, preferring `prefer` (the type the tower needs), else the most recent donation. */
export function takeFromBin(bin: BinEntry[], prefer: PieceTypeId | null): BinEntry | undefined {
  let i = prefer ? bin.findIndex((e) => e.type === prefer) : -1;
  if (i < 0) i = bin.length - 1;
  if (i < 0) return undefined;
  return bin.splice(i, 1)[0];
}
