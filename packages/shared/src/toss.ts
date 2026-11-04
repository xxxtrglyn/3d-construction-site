import { PIECE_TYPES, type PieceTypeId } from './pieces.ts';

/** Piece gravity (same as the 001 Rapier world: −18 m/s²). */
export const PIECE_GRAVITY = 18;

/** A server-computed ballistic arc (research R5). Times are server epoch ms. */
export interface Arc {
  ox: number;
  oy: number;
  oz: number;
  vx: number;
  vy: number;
  vz: number;
  t0: number;
  landAt: number;
  /** ground hit point */
  lx: number;
  lz: number;
}

const MAX_CARRIER = 3;

/**
 * Toss arc from the worker's hands. Speed scales with 1/√mass (like 001), `charge` 0..1 (hold time),
 * plus half the carrier's horizontal velocity (clamped). The ground hit is solved in closed form.
 */
export function tossArc(
  origin: { x: number; y: number; z: number },
  facing: number,
  type: PieceTypeId,
  charge: number,
  t0: number,
  carrier: { vx: number; vz: number } = { vx: 0, vz: 0 },
): Arc {
  const k = 1 / Math.sqrt(PIECE_TYPES[type].mass);
  const c = Math.max(0, Math.min(1, charge));
  const h = (9 * k + 2) * (0.6 + 0.4 * c);
  const cvx = Math.max(-MAX_CARRIER, Math.min(MAX_CARRIER, carrier.vx)) * 0.5;
  const cvz = Math.max(-MAX_CARRIER, Math.min(MAX_CARRIER, carrier.vz)) * 0.5;
  const vx = Math.sin(facing) * h + cvx;
  const vz = Math.cos(facing) * h + cvz;
  const vy = 4.2;
  const oy = Math.max(0, origin.y);
  const t = (vy + Math.sqrt(vy * vy + 2 * PIECE_GRAVITY * oy)) / PIECE_GRAVITY;
  return { ox: origin.x, oy, oz: origin.z, vx, vy, vz, t0, landAt: t0 + t * 1000, lx: origin.x + vx * t, lz: origin.z + vz * t };
}

/** Position along the arc at server time `t` (clamped to the landing point). */
export function arcPosition(a: Arc, t: number): { x: number; y: number; z: number } {
  const s = Math.max(0, Math.min(t, a.landAt) - a.t0) / 1000;
  return { x: a.ox + a.vx * s, y: Math.max(0, a.oy + a.vy * s - 0.5 * PIECE_GRAVITY * s * s), z: a.oz + a.vz * s };
}

/** Drop point: 0.6 m in front of the worker, on the ground. */
export function dropPoint(x: number, z: number, facing: number): { x: number; z: number } {
  return { x: x + Math.sin(facing) * 0.6, z: z + Math.cos(facing) * 0.6 };
}

/** True when the segment p→q passes within r of c (used to catch fast arcs ending in a zone). */
export function segmentHitsCircle(px: number, pz: number, qx: number, qz: number, cx: number, cz: number, r: number): boolean {
  const dx = qx - px;
  const dz = qz - pz;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((cx - px) * dx + (cz - pz) * dz) / l2)) : 0;
  const ex = px + dx * t - cx;
  const ez = pz + dz * t - cz;
  return ex * ex + ez * ez <= r * r;
}
