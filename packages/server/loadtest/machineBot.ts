/**
 * Machine skills for load-test bots (feature 003, research M14). A bot operates a machine only with
 * real inputs (stick axes + `act` edges + jump), exactly like a player: these helpers turn a goal into
 * axes using the shared rules (`atPit`, `atSpoil`, `rackAtForks`, `hookPos`, `snapTarget`).
 */
import {
  CLOCK_TOWER, FORK_REACH, SITE, atPit, atSpoil, carryFromCode, dcos, dsin, hookPos, kindOfMachine, openSlotRefs, plotOfMachine,
  rackAtForks, snapTarget, toolTip, wrapAngle,
  type MachineKind, type MachineState, type OwnMachine, type PieceTypeId, type TowerProgress,
} from '@hht/shared';

export interface Axes {
  dx: number;
  dz: number;
  act: boolean;
  exit: boolean;
}

const clamp = (v: number, lo = -1, hi = 1): number => (v < lo ? lo : v > hi ? hi : v);
const ax = (v: number): number => Math.round(clamp(v) * 127);

/** Own machine block → a shared MachineState (pallet contents/bags are not needed by the bot rules). */
export function toState(om: OwnMachine): MachineState {
  const kind = kindOfMachine(om.id);
  const piece = om.loadCode >= 1 && om.loadCode <= 9 ? carryFromCode(om.loadCode) : null;
  const load: MachineState['load'] = om.loadCode === 10 ? { kind: 'dirt' } : om.loadCode === 11 ? { kind: 'pallet', pieces: ['brick'] } : piece ? { kind: 'hook', piece } : { kind: 'none' };
  return { id: om.id, kind, x: om.x, z: om.z, yaw: om.yaw, p1: om.p1, p2: om.p2, p3: om.p3, phase: om.phase, phaseT: om.phaseT, load };
}

/** Tank drive (excavator): face `t`, then drive until the tool tip reaches it. */
export function tankTo(s: MachineState, tx: number, tz: number, reach: number): { dx: number; dz: number; there: boolean } {
  const dx = tx - s.x;
  const dz = tz - s.z;
  const d = Math.hypot(dx, dz);
  const want = Math.atan2(dx, dz);
  const e = wrapAngle(want - s.yaw);
  // yaw decreases with +dx (turning right)
  const turn = ax(-e * 2.5);
  const there = Math.abs(d - reach) < 0.35 && Math.abs(e) < 0.2;
  let fwd = 0;
  if (Math.abs(e) < 0.6) fwd = d > reach + 0.2 ? 1 : d < reach - 0.3 ? -0.6 : 0;
  return { dx: turn, dz: ax(fwd * (Math.abs(e) < 0.25 ? 1 : 0.5)), there };
}

/** Car drive (forklift): steer toward `t`; slows down for sharp turns so it never orbits a waypoint. */
export function carTo(s: MachineState, tx: number, tz: number, stopAt: number): { dx: number; dz: number; there: boolean } {
  const t = toolTip(s);
  const d = Math.hypot(tx - t.x, tz - t.z);
  const want = Math.atan2(tx - s.x, tz - s.z);
  const e = wrapAngle(want - s.yaw);
  if (d < stopAt) return { dx: 0, dz: ax(-s.p3 / 6), there: true };
  // the target is behind: back up while turning
  if (Math.abs(e) > 2.0) return { dx: ax(e > 0 ? 1 : -1), dz: ax(-0.6), there: false };
  const ae = Math.abs(e);
  const throttle = ae < 0.35 ? (d > 4 ? 1 : 0.5) : ae < 1.0 ? 0.4 : 0.2;
  // steer = −dx·steerMax; yaw += speed·steer/wheelbase → +e needs −dx
  return { dx: ax(-e * 2.5), dz: ax(throttle), there: false };
}

/** Crane: swing and trolley so the hook is over (tx, tz). */
export function hookTo(s: MachineState, plot: number, tx: number, tz: number): { dx: number; dz: number; there: boolean } {
  const c = SITE.machines[plot]!.crane;
  const want = Math.atan2(tx - c.x, tz - c.z);
  const r = Math.hypot(tx - c.x, tz - c.z);
  const e = wrapAngle(want - s.p1);
  const er = r - s.p2;
  const h = hookPos(s, SITE.machines[plot]!);
  const there = Math.hypot(h.x - tx, h.z - tz) < 0.35;
  // p1 −= ax·rate·dt → +e needs −ax
  return { dx: ax(-e * 3), dz: ax(er * 1.5), there };
}

export type CraneGoal = { kind: 'grab'; x: number; z: number } | { kind: 'release'; x: number; z: number; snap: boolean } | null;

/** What the crane should do next: release over a matching open slot, or grab the loose piece nearest the pad. */
export function craneGoal(s: MachineState, plot: number, progress: TowerProgress, loose: Array<{ type: string; x: number; z: number }>): CraneGoal {
  const spots = SITE.machines[plot]!;
  if (s.load.kind === 'hook') {
    const slots = openSlotRefs(SITE.plots[plot]!, spots, progress, CLOCK_TOWER).filter((x) => x.type === (s.load as { piece: PieceTypeId }).piece);
    const best = slots.sort((a, b) => Number(b.high) - Number(a.high))[0];
    if (best) {
      const h = hookPos(s, spots);
      const t = snapTarget(h, best.type, slots);
      return { kind: 'release', x: best.x, z: best.z, snap: !!t };
    }
    return { kind: 'release', x: spots.hookPad.x, z: spots.hookPad.z, snap: false };
  }
  const R2 = 3.2 * 3.2;
  const near = loose
    .filter((p) => (p.x - spots.hookPad.x) ** 2 + (p.z - spots.hookPad.z) ** 2 < R2)
    .sort((a, b) => (a.x - spots.hookPad.x) ** 2 + (a.z - spots.hookPad.z) ** 2 - ((b.x - spots.hookPad.x) ** 2 + (b.z - spots.hookPad.z) ** 2))[0];
  return near ? { kind: 'grab', x: near.x, z: near.z } : null;
}

/** The drive-through opening of a rack yard on the side nearest (tx, tz) (racks stand on two arcs, open tangentially). */
export function yardOpening(yard: number, tx: number, tz: number): { x: number; z: number } {
  const c = SITE.racks.find((r) => r.yard === yard && r.type === 'cone')!;
  const d = Math.hypot(c.x, c.z) || 1;
  const tx0 = -c.z / d;
  const tz0 = c.x / d;
  const R = 5.4;
  const a = { x: c.x + tx0 * R, z: c.z + tz0 * R };
  const b = { x: c.x - tx0 * R, z: c.z - tz0 * R };
  return Math.hypot(a.x - tx, a.z - tz) < Math.hypot(b.x - tx, b.z - tz) ? a : b;
}

const lanePoint = (r: number, x: number, z: number) => {
  const d = Math.hypot(x, z) || 1;
  return { x: (x / d) * r, z: (z / d) * r };
};

/** Waypoints for a forklift from its plot to a rack: the lane, the yard's opening, the yard centre. */
export function forkliftRoute(plot: number, rackIndex: number): Array<{ x: number; z: number }> {
  const p = SITE.plots[plot]!;
  const rack = SITE.racks[rackIndex]!;
  const yard = SITE.racks.find((r) => r.yard === rack.yard && r.type === 'cone')!;
  const lane = lanePoint(17.2, p.x, p.z);
  return [lane, yardOpening(rack.yard, lane.x, lane.z), { x: yard.x, z: yard.z }];
}

/** Waypoints back from a rack yard to the plot (or its mixer hopper). */
export function forkliftReturn(plot: number, yard: number, dest: { x: number; z: number }): Array<{ x: number; z: number }> {
  const p = SITE.plots[plot]!;
  const c = SITE.racks.find((r) => r.yard === yard && r.type === 'cone')!;
  const lane = lanePoint(17.2, p.x, p.z);
  return [{ x: c.x, z: c.z }, yardOpening(yard, lane.x, lane.z), lane, dest];
}

/** Point the forks at the rack from the yard centre. */
export function forksAtRack(s: MachineState, rackIndex: number): boolean {
  return rackAtForks(s, SITE) === rackIndex;
}

export function rackApproach(rackIndex: number): { x: number; z: number } {
  const rack = SITE.racks[rackIndex]!;
  const yard = SITE.racks.find((r) => r.yard === rack.yard && r.type === 'cone')!;
  const dx = rack.x - yard.x;
  const dz = rack.z - yard.z;
  const d = Math.hypot(dx, dz) || 1;
  // the fork tip just inside the rack front (fronts face the yard centre)
  return { x: rack.x - (dx / d) * (0.55 + FORK_REACH * 0.2), z: rack.z - (dz / d) * (0.55 + FORK_REACH * 0.2) };
}

export const excavatorReady = (s: MachineState, plot: number): { pit: boolean; spoil: boolean } => ({ pit: atPit(s, SITE.machines[plot]!), spoil: atSpoil(s, SITE.machines[plot]!) });

export const kindOf = (id: number): MachineKind => kindOfMachine(id);
export const plotOf = (id: number): number => plotOfMachine(id);
export { dcos, dsin };
