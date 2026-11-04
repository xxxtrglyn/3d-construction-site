import type { PieceTypeId } from './pieces.ts';

/** Multiplayer site layout types (three.js coordinates, meters). Data: `site.gen.ts` (generated). */
export interface ObstacleBox {
  readonly x: number;
  readonly z: number;
  readonly hx: number;
  readonly hz: number;
  /** cos/sin of the rotation about Y (precomputed so the simulation needs no trig) */
  readonly c: number;
  readonly s: number;
  /** height of the top surface; ≤ 0.35 m can be stepped onto */
  readonly top: number;
}

export interface ObstacleCyl {
  readonly x: number;
  readonly z: number;
  readonly r: number;
  readonly top: number;
}

export interface PlotDef {
  readonly index: number;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly c: number;
  readonly s: number;
  readonly buildZoneRadius: number;
  readonly towerHalf: number;
  readonly towerTop: number;
  readonly sign: { readonly x: number; readonly z: number };
  readonly bin: { readonly x: number; readonly z: number; readonly radius: number };
}

export interface RackDef {
  readonly index: number;
  readonly type: PieceTypeId;
  readonly yard: number;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly top: number;
}

export interface SiteLayout {
  readonly playRadius: number;
  readonly plaza: { readonly x: number; readonly z: number; readonly radius: number };
  readonly spawn: { readonly x: number; readonly y: number; readonly z: number };
  readonly foreman: { readonly x: number; readonly z: number; readonly yaw: number; readonly talkRadius: number };
  readonly plots: readonly PlotDef[];
  readonly racks: readonly RackDef[];
  readonly obstacles: { readonly boxes: readonly ObstacleBox[]; readonly cylinders: readonly ObstacleCyl[] };
}

/** The tower footprint of a plot as a blocking box (only once the tower has stage ≥ 1). */
export function towerBlocker(p: PlotDef): ObstacleBox {
  return { x: p.x, z: p.z, hx: p.towerHalf, hz: p.towerHalf, c: p.c, s: p.s, top: p.towerTop };
}

export const dist2 = (ax: number, az: number, bx: number, bz: number): number => {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
};

export function inPlaza(site: SiteLayout, x: number, z: number): boolean {
  return dist2(x, z, site.plaza.x, site.plaza.z) <= site.plaza.radius * site.plaza.radius;
}

/** Index of the plot whose build zone contains (x, z), or -1. */
export function plotAtZone(site: SiteLayout, x: number, z: number): number {
  for (const p of site.plots) if (dist2(x, z, p.x, p.z) <= p.buildZoneRadius * p.buildZoneRadius) return p.index;
  return -1;
}

/** Index of the plot whose supply bin contains (x, z), or -1. */
export function plotAtBin(site: SiteLayout, x: number, z: number): number {
  for (const p of site.plots) if (dist2(x, z, p.bin.x, p.bin.z) <= p.bin.radius * p.bin.radius) return p.index;
  return -1;
}
