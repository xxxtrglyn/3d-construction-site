import * as THREE from 'three';
import { INTERACT, type PieceTypeId } from '@hht/shared';
import type { RackSpot } from '../world/layout.ts';
import type { Piece } from './pieceManager.ts';

export type Target = { kind: 'piece'; piece: Piece; point: THREE.Vector3 } | { kind: 'rack'; rack: RackSpot; point: THREE.Vector3 };

const RACK_REACH = 1.9;
const COS_HALF = Math.cos(THREE.MathUtils.degToRad(INTERACT.pickupConeDeg / 2));

/**
 * Nearest thing the worker can pick up: a loose piece within 1.2 m or a rack within reach,
 * inside the 120° cone in front of the worker. Loose pieces win ties (keeps the lot tidy).
 */
export function findTarget(
  from: THREE.Vector3,
  facing: number,
  loose: readonly Piece[],
  racks: readonly RackSpot[],
): Target | null {
  const fx = Math.sin(facing);
  const fz = Math.cos(facing);
  let best: Target | null = null;
  let bestScore = Infinity;
  const consider = (point: THREE.Vector3, reach: number, make: () => Target, bias: number): void => {
    const dx = point.x - from.x;
    const dz = point.z - from.z;
    const d = Math.hypot(dx, dz);
    if (d > reach || Math.abs(point.y - from.y) > 2.2) return;
    if (d > 0.35 && (dx * fx + dz * fz) / d < COS_HALF) return;
    const score = d + bias;
    if (score < bestScore) {
      bestScore = score;
      best = make();
    }
  };
  for (const p of loose) {
    if (p.fade > 0) continue;
    consider(p.position, INTERACT.pickupRadius, () => ({ kind: 'piece', piece: p, point: p.position.clone() }), 0);
  }
  for (const r of racks) {
    consider(r.top, RACK_REACH, () => ({ kind: 'rack', rack: r, point: r.top.clone() }), 0.4);
  }
  return best;
}

export function rackType(t: Target): PieceTypeId {
  return t.kind === 'piece' ? t.piece.type : t.rack.type;
}
