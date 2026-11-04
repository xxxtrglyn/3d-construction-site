import * as THREE from 'three';
import {
  INTERACT, MACHINE, type MachineSpots, type ObstacleBox, type ObstacleCyl, type PieceTypeId, type PlotDef, type RackDef, type SiteLayout, type Vec3,
} from '@hht/shared';

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
  /** feature 003: the solo plot's machine spots (from the M_* empties in lot.glb) */
  machines: MachineSpots;
}

/** Solo machine yard radius (tools/blender/builders/lot.py: SOLO_YARD_RADIUS). */
export const SOLO_YARD_RADIUS = 6.5;

export const RACK_DISPLAY: Record<PieceTypeId, number> = { beam: 4, brick: 4, panel: 3, paint: 4, decor: 3, bell: 2, cone: 5, cement: 4, concrete: 0 };

export function readLayout(lot: THREE.Object3D): Layout {
  lot.updateMatrixWorld(true);
  const pos = (name: string, fallback: THREE.Vector3): THREE.Vector3 => {
    const o = lot.getObjectByName(name);
    return o ? o.getWorldPosition(new THREE.Vector3()) : fallback.clone();
  };
  const types: PieceTypeId[] = ['beam', 'brick', 'panel', 'paint', 'decor', 'bell', 'cone', 'cement'];
  const racks = types.map((type) => {
    const o = lot.getObjectByName(`Rack_${type}_Top`);
    const top = o ? o.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    const q = o ? o.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    const yaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
    return { type, top, yaw };
  });
  const plot = pos('TowerPlot', new THREE.Vector3(0, 0, -2.5));
  return { spawn: pos('Spawn', new THREE.Vector3(0, 0.05, 7.5)), plot, racks: racks.filter((r) => lot.getObjectByName(`Rack_${r.type}_Top`)), machines: readMachineSpots(lot, plot) };
}

/** MachineSpots for the solo plot from the M_* empties (position; rotation about Y = three.js yaw). */
function readMachineSpots(lot: THREE.Object3D, plot: THREE.Vector3): MachineSpots {
  const at = (name: string, fx: number, fz: number): { x: number; z: number; yaw: number; y: number } => {
    const o = lot.getObjectByName(name);
    if (!o) return { x: plot.x + fx, z: plot.z + fz, yaw: 0, y: 0 };
    const p = o.getWorldPosition(new THREE.Vector3());
    const q = o.getWorldQuaternion(new THREE.Quaternion());
    return { x: p.x, z: p.z, y: p.y, yaw: new THREE.Euler().setFromQuaternion(q, 'YXZ').y };
  };
  // fallbacks mirror lot.py SOLO_SPOTS (plot-local, three.js z = −Blender y)
  const spoil = at('M_Spoil', -3.5, -3.8);
  const pad = at('M_HookPad', 3.6, -3.1);
  const crane = at('M_Crane', 0, -4.0);
  const mixer = at('M_Mixer', -4.6, -6.3);
  const hopper = at('M_Mixer_Hopper', -5.2, -7.15);
  const chute = at('M_Mixer_Chute', -3.86, -5.29);
  const exc = at('M_Park_excavator', 4.2, 1.5);
  const fork = at('M_Park_forklift', 3.4, 7.1);
  const high: Vec3[][] = [[], [], [], [], [], []];
  for (let st = 1; st <= 6; st++) {
    for (let i = 0; i < 4; i++) {
      const o = lot.getObjectByName(`M_HighSlot_${st}_${i}`);
      if (!o) break;
      const p = o.getWorldPosition(new THREE.Vector3());
      (high[st - 1] as Vec3[]).push({ x: p.x, y: p.y, z: p.z });
    }
  }
  return {
    plot: 0, center: { x: plot.x, z: plot.z }, yardRadius: SOLO_YARD_RADIUS,
    pit: { x: plot.x, z: plot.z, half: TOWER_HALF, c: 1, s: 0 },
    spoil: { x: spoil.x, z: spoil.z, radius: 1.2 },
    hookPad: { x: pad.x, z: pad.z, half: 1.2, c: 1, s: 0 },
    crane: { x: crane.x, z: crane.z, yaw: crane.yaw, reachMin: MACHINE.crane.reachMin, reachMax: MACHINE.crane.reachMax, cabHeight: 14 },
    mixer: { x: mixer.x, z: mixer.z, yaw: mixer.yaw, hopper: { x: hopper.x, z: hopper.z }, chute: { x: chute.x, z: chute.z }, hopperRadius: 0.9 },
    parking: { excavator: { x: exc.x, z: exc.z, yaw: exc.yaw }, forklift: { x: fork.x, z: fork.z, yaw: fork.yaw } },
    highSlots: high,
  };
}

/**
 * The solo lot as a SiteLayout for the shared machine stepper (feature 003, FR-042): one plot, the lot's
 * static scenery and racks as colliders, and a square drivable region inside the fence (PLAY_HALF − 1).
 */
export function soloSite(layout: Layout): SiteLayout {
  const boxes: ObstacleBox[] = OBSTACLES.boxes.map((b) => ({ x: b.x, z: b.z, hx: b.hx, hz: b.hz, c: Math.cos(b.rotY), s: Math.sin(b.rotY), top: b.y + b.hy }));
  for (const r of layout.racks) {
    if (r.type === 'cone') continue;
    boxes.push({ x: r.top.x, z: r.top.z, hx: RACK_HALF.x, hz: RACK_HALF.z, c: Math.cos(r.yaw), s: Math.sin(r.yaw), top: RACK_HALF.y * 2 });
  }
  const cylinders: ObstacleCyl[] = OBSTACLES.cylinders.map((c) => ({ x: c.x, z: c.z, r: c.r, top: c.y + c.hh }));
  const p = layout.plot;
  const plot: PlotDef = {
    index: 0, x: p.x, z: p.z, yaw: 0, c: 1, s: 0, buildZoneRadius: BUILD_ZONE_RADIUS, towerHalf: TOWER_HALF, towerTop: 12,
    sign: { x: p.x + 1.25, z: p.z + 1.05 }, bin: { x: 1000, z: 1000, radius: 0 },
  };
  const racks: RackDef[] = layout.racks.map((r, index) => ({ index, type: r.type, yard: 0, x: r.top.x, z: r.top.z, yaw: r.yaw, top: r.top.y }));
  return {
    playRadius: 1000,
    plaza: { x: 0, z: 0, radius: 0 },
    spawn: { x: layout.spawn.x, y: 0, z: layout.spawn.z },
    foreman: { x: 1000, z: 1000, yaw: 0, talkRadius: 0 },
    plots: [plot],
    racks,
    obstacles: { boxes, cylinders },
    machines: [layout.machines],
    noDrive: { plazaRadius: 0, outerRadius: 1000, squareHalf: PLAY_HALF - 1 },
  };
}

/** Static scenery obstacles (three coords). */
export const OBSTACLES = {
  // feature 003: the static excavator and crane are gone (the operable machines never block workers)
  boxes: [
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
