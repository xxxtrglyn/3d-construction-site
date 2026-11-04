import * as THREE from 'three';
import { INTERACT, type PieceTypeId } from '@hht/shared';

/**
 * Lot layout in three.js coordinates (Y up, front = +Z). Positions of spawn, tower plot and rack tops
 * come from empties exported in lot.glb (single source of truth: tools/blender/builders/lot.py).
 * Static obstacle colliders mirror the scenery in lot.py (Blender (x, y, z) -> three (x, z, -y)).
 */
export const LOT_HALF = 12;
export const PLAY_HALF = 11.3;
export const TOWER_SCALE = 1.6;
/** half footprint of the tower walls at the ground floor (1.7 m × 1.6 scale / 2) */
export const TOWER_HALF = 1.36;
export const BUILD_ZONE_RADIUS = INTERACT.buildZoneRadius;
export const SLOT_RING_RADIUS = 2.35;

export type RackType = Exclude<PieceTypeId, never>;

export interface RackSpot {
  type: PieceTypeId;
  top: THREE.Vector3;
  yaw: number;
}

export interface Layout {
  spawn: THREE.Vector3;
  plot: THREE.Vector3;
  racks: RackSpot[];
}

export const RACK_DISPLAY: Record<PieceTypeId, number> = { beam: 4, brick: 4, panel: 3, paint: 4, decor: 3, bell: 2, cone: 5 };

export function readLayout(lot: THREE.Object3D): Layout {
  lot.updateMatrixWorld(true);
  const pos = (name: string, fallback: THREE.Vector3): THREE.Vector3 => {
    const o = lot.getObjectByName(name);
    return o ? o.getWorldPosition(new THREE.Vector3()) : fallback.clone();
  };
  const types: PieceTypeId[] = ['beam', 'brick', 'panel', 'paint', 'decor', 'bell', 'cone'];
  const racks = types.map((type) => {
    const o = lot.getObjectByName(`Rack_${type}_Top`);
    const top = o ? o.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    const q = o ? o.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    const yaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
    return { type, top, yaw };
  });
  return { spawn: pos('Spawn', new THREE.Vector3(0, 0.05, 7.5)), plot: pos('TowerPlot', new THREE.Vector3(0, 0, -2.5)), racks };
}

/** Static scenery obstacles (three coords). */
export const OBSTACLES = {
  boxes: [
    // excavator (Blender 9.6, 5.0, scaled 1.4)
    { x: 9.6, y: 1.0, z: -5.0, hx: 1.3, hy: 1.0, hz: 1.2, rotY: 0 },
    // crane mast + footing (Blender -9.0, 8.6)
    { x: -9.0, y: 2.4, z: -8.6, hx: 0.45, hy: 2.4, hz: 0.45, rotY: 0 },
    // spawn sign post
    { x: 1.6, y: 0.7, z: 7.5, hx: 0.08, hy: 0.7, hz: 0.08, rotY: 0 },
  ],
  cylinders: [
    // dirt mound (Blender 7.6, 6.4)
    { x: 7.6, y: 0.3, z: -6.4, hh: 0.3, r: 1.25 },
    // trees (Blender coords negated on z)
    { x: -10.6, y: 1, z: -10.4, hh: 1, r: 0.3 },
    { x: 10.5, y: 1, z: -10.6, hh: 1, r: 0.3 },
    { x: -10.7, y: 1, z: 6.0, hh: 1, r: 0.3 },
    { x: 10.6, y: 1, z: 10.5, hh: 1, r: 0.3 },
    { x: -3.0, y: 1, z: -10.9, hh: 1, r: 0.3 },
    { x: 6.0, y: 1, z: -10.8, hh: 1, r: 0.3 },
    { x: 10.8, y: 1, z: -2.0, hh: 1, r: 0.3 },
  ],
} as const;

export const RACK_HALF = { x: 0.85, y: 0.62, z: 0.55 } as const;
