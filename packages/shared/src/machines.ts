/**
 * Construction machines (feature 003, data-model §1, research M1/M8): one pure, deterministic rig
 * stepper shared by the server (authority), the operating client (prediction + replay), solo mode
 * and the load-test bots. Machines are kinematic rigs driven by a few parameters — never physics.
 *
 * Determinism: the state path uses only + − × ÷, √, Math.round/abs and a polynomial sine (`dsin`),
 * never Math.sin/cos/atan2, so identical inputs give bit-identical states on every JS engine. No
 * randomness and no clock: time comes in only as `dt`.
 */
import type { Blueprint, StageDef } from './blueprints.ts';
import { MACHINE } from './constants.ts';
import { STEP_UP, WORKER_RADIUS, pushBox, pushCyl, type MoveInput, type Push } from './kinematics.ts';
import type { PieceTypeId } from './pieces.ts';
import { blueprintOf, currentStage, groundworkPart, highItem, openSlots, openSlotsOf, type TowerProgress } from './progression.ts';
import { dist2, inPlaza, inSquare, distToSquare, type MachineSpots, type ObstacleBox, type ObstacleCyl, type PlotDef, type SiteLayout } from './site.ts';

// ---------------------------------------------------------------- identity

export type MachineKind = 'crane' | 'excavator' | 'forklift' | 'mixer';
/** Kind index = position in this list (wire id = plot × 4 + index; schema `machineOps` order). */
export const MACHINE_KINDS: readonly MachineKind[] = ['crane', 'excavator', 'forklift', 'mixer'];
/** plot × 4 + kind index (0..47 in a world; solo uses plot 0) */
export type MachineId = number;
export const MACHINES_PER_PLOT = 4;

export const machineId = (plot: number, kind: MachineKind): MachineId => plot * MACHINES_PER_PLOT + MACHINE_KINDS.indexOf(kind);
export const plotOfMachine = (id: MachineId): number => Math.floor(id / MACHINES_PER_PLOT);
export const kindOfMachine = (id: MachineId): MachineKind => MACHINE_KINDS[id % MACHINES_PER_PLOT] as MachineKind;
export const kindIndex = (k: MachineKind): number => MACHINE_KINDS.indexOf(k);

// ---------------------------------------------------------------- state

export type MachinePhase = 'idle' | 'lowering' | 'raising' | 'working';
export const MACHINE_PHASES: readonly MachinePhase[] = ['idle', 'lowering', 'raising', 'working'];

export type MachineLoad =
  | { readonly kind: 'none' }
  | { readonly kind: 'hook'; readonly piece: PieceTypeId }
  | { readonly kind: 'pallet'; readonly pieces: readonly PieceTypeId[] }
  | { readonly kind: 'dirt' }
  | { readonly kind: 'bags'; readonly count: number };

export const NO_LOAD: MachineLoad = Object.freeze({ kind: 'none' });

/**
 * One machine. Body pose (x, z, yaw; fixed for the crane and the mixer) plus rig parameters:
 * - crane: p1 slew (world yaw of the jib), p2 trolley radius (m), p3 hook height (m)
 * - excavator: p1 boom angle, p2 bucket curl, p3 unused
 * - forklift: p1 fork height (m), p2 steer angle, p3 speed (m/s, signed)
 * - mixer: p1 drum angle
 */
export interface MachineState {
  readonly id: MachineId;
  readonly kind: MachineKind;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly p1: number;
  readonly p2: number;
  readonly p3: number;
  readonly phase: MachinePhase;
  /** seconds left in the current phase */
  readonly phaseT: number;
  readonly load: MachineLoad;
}

/** What a step asks the authority to do; the server (or SoloMachines) decides the effect. */
export type MachineAction = 'scoop' | 'dump' | 'hookDown' | 'hookUp' | 'loadPallet' | 'unloadPallet' | 'mix';

/** Everything the stepper needs to know about the world (identical on the client and the server). */
export interface MachineCtx {
  readonly site: SiteLayout;
  /** this machine's plot spots */
  readonly spots: MachineSpots;
  /** dynamic static blockers in plot order (tower footprints from stage 1) */
  readonly blockers: readonly ObstacleBox[];
  /** height of this plot's tower top (0 = no tower yet): the hook stops above it */
  readonly towerTop: number;
}

export interface MachineStep {
  readonly state: MachineState;
  readonly action: MachineAction | null;
}

// ---------------------------------------------------------------- rig geometry (shared with the renderer)

/** Footprint circles used for driving collisions. */
export const MACHINE_RADIUS: Readonly<Record<MachineKind, number>> = { crane: 0.6, excavator: 1.1, forklift: 0.9, mixer: 0.9 };
/** horizontal distance from the excavator body centre to the bucket tip */
export const EXCAVATOR_REACH = 2.3;
/** horizontal distance from the forklift body centre to the fork tip */
export const FORK_REACH = 1.35;
const FORK_WHEELBASE = 1.3;
const FORK_ACCEL = 6;
const FORK_BRAKE = 10;
const FORK_LOW = 0.12;
const FORK_HIGH = 0.55;
const FORK_LIFT_SPEED = 1.5;
/** below this speed (m/s) A/D also turns the forklift on the spot, fading out as it speeds up */
const FORK_PIVOT_FADE = 1.5;
const BOOM_RATE = 3;
const DRUM_IDLE = 0.6;
const DRUM_MIX = 6;
/** obstacles at most this tall can be driven over */
const DRIVE_OVER = 0.3;
/** the hook rests this far below the jib */
const HOOK_BELOW_JIB = 1.2;
/** hook height when lowered to the ground (a hooked piece then rests on the ground) */
export const HOOK_GROUND_Y = 0.9;
/** while the hook is within this distance of the tower centre it stops above the tower top */
const HOOK_TOWER_R = 1.9;
const PHASE_EPS = 1e-4;

/** Height of the tower top (m) after `completedStages` stages, for the hook (research M8, tower scale 1.6). */
export const TOWER_TOP_Y: readonly number[] = [0, 6.1, 7.0, 8.8, 8.8, 8.8, 9.5];

export const hookRestY = (spots: MachineSpots): number => spots.crane.cabHeight - HOOK_BELOW_JIB;

// ---------------------------------------------------------------- deterministic trig

const PI = 3.141592653589793;
const HALF_PI = PI / 2;
const TAU = 2 * PI;

/** Angle wrapped to [−π, π] with exact arithmetic. */
export function wrapAngle(a: number): number {
  return a - Math.round(a / TAU) * TAU;
}

/** Polynomial sine (|error| < 1e-9) that is bit-identical on every engine. */
export function dsin(a: number): number {
  let x = wrapAngle(a);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 / 6227020800))))));
}

export function dcos(a: number): number {
  return dsin(a + HALF_PI);
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const approach = (v: number, target: number, maxStep: number): number => (v < target ? Math.min(target, v + maxStep) : Math.max(target, v - maxStep));

// ---------------------------------------------------------------- context

/** Builds the stepper context for a plot (same inputs on every side → same results). */
export function machineCtx(site: SiteLayout, plot: number, blockers: readonly ObstacleBox[], completedStages: number): MachineCtx {
  const spots = site.machines[plot] as MachineSpots;
  return { site, spots, blockers, towerTop: TOWER_TOP_Y[Math.max(0, Math.min(6, completedStages))] ?? 0 };
}

/** A parked, empty machine at its spot (boot, shift reset). */
export function parkedState(id: MachineId, spots: MachineSpots): MachineState {
  const kind = kindOfMachine(id);
  const base = { id, kind, phase: 'idle' as const, phaseT: 0, load: NO_LOAD };
  switch (kind) {
    case 'crane': {
      const c = spots.crane;
      const d = Math.sqrt(dist2(c.x, c.z, spots.center.x, spots.center.z));
      return { ...base, x: c.x, z: c.z, yaw: c.yaw, p1: c.yaw, p2: clamp(d, c.reachMin, c.reachMax), p3: hookRestY(spots) };
    }
    case 'excavator': {
      const p = spots.parking.excavator;
      return { ...base, x: p.x, z: p.z, yaw: p.yaw, p1: 0, p2: 0, p3: 0 };
    }
    case 'forklift': {
      const p = spots.parking.forklift;
      return { ...base, x: p.x, z: p.z, yaw: p.yaw, p1: FORK_LOW, p2: 0, p3: 0 };
    }
    case 'mixer':
      return { ...base, x: spots.mixer.x, z: spots.mixer.z, yaw: spots.mixer.yaw, p1: 0, p2: 0, p3: 0, load: { kind: 'bags', count: 0 } };
  }
}

// ---------------------------------------------------------------- geometry helpers

/** World position of the crane hook (y = hook height). */
export function hookPos(s: MachineState, spots: MachineSpots): { x: number; y: number; z: number } {
  return { x: spots.crane.x + dsin(s.p1) * s.p2, y: s.p3, z: spots.crane.z + dcos(s.p1) * s.p2 };
}

/** Excavator bucket tip / forklift fork tip on the ground. */
export function toolTip(s: MachineState): { x: number; z: number } {
  const reach = s.kind === 'excavator' ? EXCAVATOR_REACH : s.kind === 'forklift' ? FORK_REACH : 0;
  return { x: s.x + dsin(s.yaw) * reach, z: s.z + dcos(s.yaw) * reach };
}

/** Excavator: the bucket tip is within `pitReach` of the pit outline (or over the pit). */
export function atPit(s: MachineState, spots: MachineSpots): boolean {
  const t = toolTip(s);
  return distToSquare(spots.pit, t.x, t.z) <= MACHINE.excavator.pitReach;
}

/** Excavator: the bucket tip is at this plot's spoil heap. */
export function atSpoil(s: MachineState, spots: MachineSpots): boolean {
  const t = toolTip(s);
  return dist2(t.x, t.z, spots.spoil.x, spots.spoil.z) <= MACHINE.excavator.spoilReach * MACHINE.excavator.spoilReach;
}

/** Forklift: index of the supply rack in front of the forks (cones excluded), or -1. */
export function rackAtForks(s: MachineState, site: SiteLayout): number {
  const t = toolTip(s);
  const reach = 0.85 + MACHINE.forklift.rackReach; // rack half width + reach
  let best = -1;
  let bd = reach * reach;
  for (const r of site.racks) {
    if (r.type === 'cone') continue;
    const d = dist2(t.x, t.z, r.x, r.z);
    if (d <= bd) {
      bd = d;
      best = r.index;
    }
  }
  return best;
}

function keepInside(p: Push, cx: number, cz: number, R: number): void {
  const dx = p.x - cx;
  const dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 <= R * R) return;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const nz = dz / d;
  p.x = cx + nx * R;
  p.z = cz + nz * R;
  const vn = p.vx * nx + p.vz * nz;
  if (vn > 0) {
    p.vx -= vn * nx;
    p.vz -= vn * nz;
  }
}

function keepOutside(p: Push, cx: number, cz: number, R: number): void {
  const dx = p.x - cx;
  const dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= R * R) return;
  let nx = 1;
  let nz = 0;
  let d = 0;
  if (d2 > 1e-12) {
    d = Math.sqrt(d2);
    nx = dx / d;
    nz = dz / d;
  }
  p.x = cx + nx * R;
  p.z = cz + nz * R;
  const vn = p.vx * nx + p.vz * nz;
  if (vn < 0) {
    p.vx -= vn * nx;
    p.vz -= vn * nz;
  }
}

function keepInSquare(p: Push, half: number): void {
  if (p.x > half) {
    p.x = half;
    if (p.vx > 0) p.vx = 0;
  } else if (p.x < -half) {
    p.x = -half;
    if (p.vx < 0) p.vx = 0;
  }
  if (p.z > half) {
    p.z = half;
    if (p.vz > 0) p.vz = 0;
  } else if (p.z < -half) {
    p.z = -half;
    if (p.vz < 0) p.vz = 0;
  }
}

/** Static scenery (and towers) against a driving footprint. Machines never collide with workers or machines. */
function collideStatic(p: Push, r: number, ctx: MachineCtx): void {
  const boxes = ctx.site.obstacles.boxes;
  const cyls = ctx.site.obstacles.cylinders;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i] as ObstacleBox;
    if (b.top > DRIVE_OVER) pushBox(p, b, r);
  }
  for (let i = 0; i < ctx.blockers.length; i++) pushBox(p, ctx.blockers[i] as ObstacleBox, r);
  for (let i = 0; i < cyls.length; i++) {
    const c = cyls[i] as ObstacleCyl;
    if (c.top > DRIVE_OVER) pushCyl(p, c, r);
  }
}

/** The forklift's drivable region (research M7): not the plaza (+1 m), the fence band or another plot's yard. */
function forkliftRegion(p: Push, r: number, ctx: MachineCtx): void {
  const nd = ctx.site.noDrive;
  if (nd.plazaRadius > 0) keepOutside(p, 0, 0, nd.plazaRadius + r);
  if (nd.squareHalf !== undefined) keepInSquare(p, nd.squareHalf - r);
  else keepInside(p, 0, 0, nd.outerRadius - r);
  const own = ctx.spots.plot;
  const ms = ctx.site.machines;
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i] as MachineSpots;
    if (m.plot !== own) keepOutside(p, m.center.x, m.center.z, m.yardRadius + r);
  }
}

// ---------------------------------------------------------------- the stepper

/**
 * One fixed 60 Hz step. `input.dx`/`dz` are the raw stick axes ×127 while operating (dx = right,
 * dz = forward); `input.act` is the edge-triggered action press. Phases lock the rig: input is
 * ignored while the hook lowers or rises or the bucket works.
 */
export function stepMachine(s: MachineState, input: MoveInput, dt: number, ctx: MachineCtx): MachineStep {
  switch (s.kind) {
    case 'crane': return stepCrane(s, input, dt, ctx);
    case 'excavator': return stepExcavator(s, input, dt, ctx);
    case 'forklift': return stepForklift(s, input, dt, ctx);
    case 'mixer': return stepMixer(s, input, dt);
  }
}

const axis = (v: number): number => clamp(v / 127, -1, 1);

function stepCrane(s: MachineState, input: MoveInput, dt: number, ctx: MachineCtx): MachineStep {
  const spots = ctx.spots;
  const c = spots.crane;
  const rest = hookRestY(spots);
  let { p1, p2, p3, phase, phaseT } = s;
  let action: MachineAction | null = null;
  if (phase === 'lowering' || phase === 'raising') {
    phaseT -= dt;
    if (phase === 'lowering') {
      const hx = c.x + dsin(p1) * p2;
      const hz = c.z + dcos(p1) * p2;
      const overTower = ctx.towerTop > 0 && dist2(hx, hz, spots.center.x, spots.center.z) <= HOOK_TOWER_R * HOOK_TOWER_R;
      const bottom = overTower ? ctx.towerTop + 0.6 : HOOK_GROUND_Y;
      if (phaseT <= PHASE_EPS) {
        p3 = bottom;
        phase = 'raising';
        phaseT = MACHINE.crane.hookS;
        action = 'hookDown';
      } else p3 -= ((p3 - bottom) * dt) / (phaseT + dt);
    } else if (phaseT <= PHASE_EPS) {
      p3 = rest;
      phase = 'idle';
      phaseT = 0;
      action = 'hookUp';
    } else p3 += ((rest - p3) * dt) / (phaseT + dt);
    return { state: { ...s, p1, p2, p3, phase, phaseT }, action };
  }
  // idle: swing and trolley, the hook stays inside the plot's yard circle between the reach radii
  const ax = axis(input.dx);
  const az = axis(input.dz);
  const yard = spots.yardRadius;
  const bx = c.x - spots.center.x;
  const bz = c.z - spots.center.z;
  const maxR = (yaw: number): number => {
    // largest r with |B + r·d − C| ≤ yard (B − C = (bx, bz), d = (sin, cos))
    const dx = dsin(yaw);
    const dz = dcos(yaw);
    const b = dx * bx + dz * bz;
    const cc = bx * bx + bz * bz - yard * yard;
    const disc = b * b - cc;
    return disc < 0 ? -1 : -b + Math.sqrt(disc);
  };
  if (ax !== 0) {
    const n1 = wrapAngle(p1 - ax * MACHINE.crane.slewRate * dt);
    const lim = maxR(n1);
    if (lim >= c.reachMin) {
      p1 = n1;
      if (p2 > lim) p2 = lim;
    }
  }
  if (az !== 0) p2 = clamp(p2 + az * MACHINE.crane.trolleySpeed * dt, c.reachMin, Math.min(c.reachMax, maxR(p1)));
  p3 = approach(p3, rest, 4 * dt);
  if (input.act) {
    phase = 'lowering';
    phaseT = MACHINE.crane.hookS;
  }
  return { state: { ...s, p1, p2, p3, phase, phaseT }, action };
}

function stepExcavator(s: MachineState, input: MoveInput, dt: number, ctx: MachineCtx): MachineStep {
  let { x, z, yaw, p1, p2, phase, phaseT } = s;
  let action: MachineAction | null = null;
  if (phase !== 'idle') {
    phaseT -= dt;
    // lowering = scoop (boom down, bucket curls), raising = dump (boom up, bucket opens)
    const scoop = phase === 'lowering';
    p1 = approach(p1, scoop ? -0.5 : 0.45, BOOM_RATE * dt);
    p2 = approach(p2, scoop ? 1.1 : -0.7, BOOM_RATE * dt);
    if (phaseT <= PHASE_EPS) {
      phase = 'idle';
      phaseT = 0;
    }
    return { state: { ...s, p1, p2, phase, phaseT }, action };
  }
  const full = s.load.kind === 'dirt';
  p1 = approach(p1, full ? 0.25 : 0, BOOM_RATE * dt);
  p2 = approach(p2, full ? 1.0 : 0, BOOM_RATE * dt);
  // tank drive
  const v = axis(input.dz) * MACHINE.excavator.speed;
  yaw = wrapAngle(yaw - axis(input.dx) * MACHINE.excavator.turnRate * dt);
  const fx = dsin(yaw);
  const fz = dcos(yaw);
  const r = MACHINE_RADIUS.excavator;
  const p: Push = { x: x + fx * v * dt, z: z + fz * v * dt, vx: fx * v, vz: fz * v };
  const sp = ctx.spots;
  for (let iter = 0; iter < 3; iter++) {
    collideStatic(p, r, ctx);
    keepInside(p, sp.center.x, sp.center.z, sp.yardRadius - r);
  }
  x = p.x;
  z = p.z;
  if (input.act) {
    const st = { ...s, x, z, yaw };
    if (full) {
      phase = 'raising';
      phaseT = MACHINE.excavator.dumpS;
      action = 'dump';
    } else if (atPit(st, sp)) {
      phase = 'lowering';
      phaseT = MACHINE.excavator.scoopS;
      action = 'scoop';
    }
  }
  return { state: { ...s, x, z, yaw, p1, p2, phase, phaseT }, action };
}

function stepForklift(s: MachineState, input: MoveInput, dt: number, ctx: MachineCtx): MachineStep {
  let { x, z, yaw, p1, p2, p3 } = s;
  let action: MachineAction | null = null;
  const F = MACHINE.forklift;
  const want = axis(input.dz) * F.speed;
  const braking = (p3 > 0 && want < p3) || (p3 < 0 && want > p3);
  p3 = approach(p3, want, (braking ? FORK_BRAKE : FORK_ACCEL) * dt);
  p2 = -axis(input.dx) * F.steerMax;
  // car steering while rolling; A/D alone (no throttle) also turns it on the spot when slow or stopped.
  // With W/S held it is a pure car again, so reversing out of a spot keeps car steering.
  const pivot = input.dz === 0 ? -axis(input.dx) * F.pivotRate * Math.max(0, 1 - Math.abs(p3) / FORK_PIVOT_FADE) : 0;
  yaw = wrapAngle(yaw + ((p3 * p2) / FORK_WHEELBASE + pivot) * dt);
  const fx = dsin(yaw);
  const fz = dcos(yaw);
  const r = MACHINE_RADIUS.forklift;
  const p: Push = { x: x + fx * p3 * dt, z: z + fz * p3 * dt, vx: fx * p3, vz: fz * p3 };
  for (let iter = 0; iter < 3; iter++) {
    collideStatic(p, r, ctx);
    forkliftRegion(p, r, ctx);
  }
  x = p.x;
  z = p.z;
  // sliding along an edge keeps only the speed along the heading
  p3 = p.vx * fx + p.vz * fz;
  const loaded = s.load.kind === 'pallet';
  p1 = approach(p1, loaded ? FORK_HIGH : FORK_LOW, FORK_LIFT_SPEED * dt);
  if (input.act) {
    if (loaded) action = 'unloadPallet';
    else if (rackAtForks({ ...s, x, z, yaw }, ctx.site) >= 0) action = 'loadPallet';
  }
  return { state: { ...s, x, z, yaw, p1, p2, p3 }, action };
}

function stepMixer(s: MachineState, input: MoveInput, dt: number): MachineStep {
  let { p1, phase, phaseT } = s;
  let action: MachineAction | null = null;
  if (phase === 'working') {
    phaseT -= dt;
    if (phaseT <= PHASE_EPS) {
      phase = 'idle';
      phaseT = 0;
    }
  } else if (input.act && s.load.kind === 'bags' && s.load.count > 0) {
    phase = 'working';
    phaseT = MACHINE.mixer.mixS;
    action = 'mix';
  }
  p1 = wrapAngle(p1 + (phase === 'working' ? DRUM_MIX : DRUM_IDLE) * dt);
  return { state: { ...s, p1, phase, phaseT }, action };
}

/** Reconciliation distance between a predicted and an authoritative state (loads are authoritative). */
export function machineError(a: MachineState, b: MachineState): number {
  if (a.phase !== b.phase) return 1;
  return Math.max(
    Math.abs(a.x - b.x), Math.abs(a.z - b.z), Math.abs(wrapAngle(a.yaw - b.yaw)),
    Math.abs(wrapAngle(a.p1 - b.p1)) * (a.kind === 'mixer' ? 0 : 1), Math.abs(a.p2 - b.p2), Math.abs(a.p3 - b.p3) * 0.5,
    Math.abs(a.phaseT - b.phaseT),
  );
}

/** True when the machine is doing something (not parked still). */
export function machineBusy(s: MachineState): boolean {
  return s.phase !== 'idle' || (s.kind === 'forklift' && s.p3 !== 0);
}

// ---------------------------------------------------------------- seats, entering and leaving

/** Where the operator's worker sits (or stands, at the mixer controls). */
export function seatPose(s: MachineState, spots: MachineSpots): { x: number; y: number; z: number; yaw: number } {
  const fx = dsin(s.yaw);
  const fz = dcos(s.yaw);
  // local +x (the machine's left) in world: (cos yaw, −sin yaw)
  const lx = fz;
  const lz = -fx;
  switch (s.kind) {
    case 'crane': {
      const jx = dsin(s.p1);
      const jz = dcos(s.p1);
      // the cab hangs behind the slew ring, below the jib (tools/blender/builders/machines.py: CRANE_CAB)
      return { x: spots.crane.x - jx * 0.8, y: spots.crane.cabHeight - 1.55, z: spots.crane.z - jz * 0.8, yaw: s.p1 };
    }
    case 'excavator':
      return { x: s.x + lx * 0.3 - fx * 0.15, y: 1.05, z: s.z + lz * 0.3 - fz * 0.15, yaw: s.yaw };
    case 'forklift':
      return { x: s.x - fx * 0.25, y: 0.75, z: s.z - fz * 0.25, yaw: s.yaw };
    case 'mixer':
      return { x: s.x + lx * 1.15, y: 0, z: s.z + lz * 1.15, yaw: s.yaw };
  }
}

/** Where a player must stand to get in: the cab (crane: the mast base; mixer: the controls). */
export function entryPoint(s: MachineState, spots: MachineSpots): { x: number; z: number } {
  if (s.kind === 'crane') return { x: spots.crane.x, z: spots.crane.z };
  const p = seatPose(s, spots);
  return { x: p.x, z: p.z };
}

function workerBlocked(ctx: MachineCtx, x: number, z: number): boolean {
  const r = WORKER_RADIUS + 0.05;
  if (ctx.site.noDrive.squareHalf !== undefined) {
    const h = ctx.site.noDrive.squareHalf + 0.5;
    if (Math.abs(x) > h || Math.abs(z) > h) return true;
  } else if (dist2(x, z, 0, 0) > (ctx.site.playRadius - r) * (ctx.site.playRadius - r)) return true;
  const inBox = (b: ObstacleBox): boolean => {
    const dx = x - b.x;
    const dz = z - b.z;
    const lx = Math.abs(b.c * dx - b.s * dz) - b.hx;
    const lz = Math.abs(b.s * dx + b.c * dz) - b.hz;
    const ox = lx > 0 ? lx : 0;
    const oz = lz > 0 ? lz : 0;
    return ox * ox + oz * oz < r * r;
  };
  for (const b of ctx.site.obstacles.boxes) if (b.top > STEP_UP && inBox(b)) return true;
  for (const b of ctx.blockers) if (inBox(b)) return true;
  for (const c of ctx.site.obstacles.cylinders) if (c.top > STEP_UP && dist2(x, z, c.x, c.z) < (c.r + r) * (c.r + r)) return true;
  return false;
}

// 4 candidate directions around the cab, in the machine's frame: left, right, back, front
const EXIT_DIRS: ReadonlyArray<readonly [number, number, number]> = [[1, 0, 1.6], [-1, 0, 1.6], [0, -1, 2.0], [0, 1, 2.2]];

/** Where the worker stands after getting out: the first free spot around the cab, else the parking spot. */
export function exitSpot(s: MachineState, ctx: MachineCtx): { x: number; z: number; yaw: number } {
  const spots = ctx.spots;
  const bx = s.kind === 'crane' ? spots.crane.x : s.x;
  const bz = s.kind === 'crane' ? spots.crane.z : s.z;
  const yaw = s.kind === 'crane' ? spots.crane.yaw : s.yaw;
  const fx = dsin(yaw);
  const fz = dcos(yaw);
  for (const [l, f, d] of EXIT_DIRS) {
    const x = bx + (fz * l + fx * f) * d;
    const z = bz + (-fx * l + fz * f) * d;
    if (!workerBlocked(ctx, x, z) && !inSquare(spots.pit, x, z, 0.2)) return { x, z, yaw };
  }
  const park = s.kind === 'forklift' ? spots.parking.forklift : spots.parking.excavator;
  return { x: park.x + dcos(park.yaw) * 1.6, z: park.z - dsin(park.yaw) * 1.6, yaw: park.yaw };
}

export type EnterResult = 'entered' | 'notCrew' | 'busy' | 'handsFull' | 'tooFar' | 'notBuilding';

/**
 * Permission and range check for getting in (FR-006). Order: the plot must have a building, the actor
 * must be its Host or a member, the seat must be free, hands empty, and the actor within range.
 */
export function canEnter(
  machine: { readonly state: MachineState; readonly operator: string },
  plot: { readonly hasBuilding: boolean },
  actor: { readonly crewPlot: number; readonly carrying: PieceTypeId | null; readonly x: number; readonly z: number },
  spots: MachineSpots,
  slack = 0,
): EnterResult {
  if (!plot.hasBuilding) return 'notBuilding';
  if (actor.crewPlot !== plotOfMachine(machine.state.id)) return 'notCrew';
  if (machine.operator !== '') return 'busy';
  if (actor.carrying !== null) return 'handsFull';
  const e = entryPoint(machine.state, spots);
  const R = MACHINE.enterRange + slack;
  if (dist2(actor.x, actor.z, e.x, e.z) > R * R) return 'tooFar';
  return 'entered';
}

// ---------------------------------------------------------------- slots, snapping and setting down

/** An open slot of the current step, with its ring position (hand slots on the ground, high slots up top). */
export interface SlotRef {
  readonly index: number;
  readonly high: boolean;
  readonly type: PieceTypeId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const SLOT_RING_RADIUS = 2.35;
/** footing slots (Groundwork concrete) in plot-local coords */
const FOOTING: ReadonlyArray<readonly [number, number]> = [[-0.65, -0.65], [0.65, -0.65], [-0.65, 0.65], [0.65, 0.65]];

/** Ring positions of a stage's hand slots, spread over the plot's front arc (matches the solo SlotMarkers). */
export function handSlotPositions(plot: PlotDef, count: number): Array<{ x: number; y: number; z: number }> {
  // the plot front (toward the plaza; solo: toward the spawn) in three.js = (s, c)
  const fx = plot.s;
  const fz = plot.c;
  const out: Array<{ x: number; y: number; z: number }> = [];
  const arc = Math.min(PI * 1.25, 0.55 * Math.max(1, count));
  for (let i = 0; i < count; i++) {
    const a = count === 1 ? 0 : -arc / 2 + (arc * i) / (count - 1);
    const sa = dsin(a);
    const ca = dcos(a);
    // rotate the front vector by a about +Y
    const dx = fx * ca + fz * sa;
    const dz = -fx * sa + fz * ca;
    out.push({ x: plot.x + dx * SLOT_RING_RADIUS, y: 0.04, z: plot.z + dz * SLOT_RING_RADIUS });
  }
  return out;
}

/**
 * The ordinary (hand) slots of a stage, typed: `handSlotPositions(plot, Σordinary)` assigned to the
 * recipe materials in order, main material first (feature 004, research R4). `index` is per material.
 */
export function stageHandSlots(plot: PlotDef, st: StageDef): Array<{ index: number; type: PieceTypeId; x: number; y: number; z: number }> {
  const total = st.recipe.reduce((a, r) => a + r.count - r.high, 0);
  const pos = handSlotPositions(plot, total);
  const out: Array<{ index: number; type: PieceTypeId; x: number; y: number; z: number }> = [];
  let k = 0;
  for (const r of st.recipe) {
    for (let i = 0; i < r.count - r.high; i++) {
      const q = pos[k++] as { x: number; y: number; z: number };
      out.push({ index: i, type: r.type, x: q.x, y: q.y, z: q.z });
    }
  }
  return out;
}

/** The open slots of a plot's current step (Groundwork footing, or the stage's typed hand and high slots). */
export function openSlotRefs(plot: PlotDef, spots: MachineSpots, p: TowerProgress, bp: Blueprint = blueprintOf(p)): SlotRef[] {
  const out: SlotRef[] = [];
  const part = groundworkPart(p, bp);
  if (part === 'dig') return out;
  if (part === 'concrete') {
    for (let i = p.groundPoured; i < Math.min(FOOTING.length, bp.groundwork.concrete); i++) {
      const [lx, lz] = FOOTING[i] as readonly [number, number];
      out.push({ index: i, high: false, type: 'concrete', x: plot.x + plot.c * lx + plot.s * lz, y: 0.1, z: plot.z - plot.s * lx + plot.c * lz });
    }
    return out;
  }
  const st = currentStage(p, bp);
  if (!st) return out;
  const h = highItem(st);
  // ordinary fills of each material take that material's slots in order
  const used = st.recipe.map((_, i) => (p.filled[i] ?? 0) - (i === h ? p.highFilled : 0));
  for (const s of stageHandSlots(plot, st)) {
    const i = st.recipe.findIndex((r) => r.type === s.type);
    if (s.index >= (used[i] ?? 0)) out.push({ index: s.index, high: false, type: s.type, x: s.x, y: s.y, z: s.z });
  }
  const highs = spots.highSlots[st.number - 1] ?? [];
  const hType = h >= 0 ? (st.recipe[h] as { type: PieceTypeId }).type : st.pieceType;
  for (let i = p.highFilled; i < st.highSlots; i++) {
    const q = highs[i];
    if (q) out.push({ index: i, high: true, type: hType, x: q.x, y: q.y, z: q.z });
  }
  return out;
}

/** The slot a crane release at `hook` would fill: nearest open slot of the piece's type within 1.5 m (FR-027). */
export function snapTarget(hook: { readonly x: number; readonly z: number }, piece: PieceTypeId, slots: readonly SlotRef[]): SlotRef | null {
  const R = MACHINE.crane.snapRadius;
  let best: SlotRef | null = null;
  let bd = R * R;
  for (const s of slots) {
    if (s.type !== piece) continue;
    const d = dist2(hook.x, hook.z, s.x, s.z);
    if (d <= bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

// candidate offsets for setDownSpot: rings of 0.5 m steps, 8 directions each
const DIRS8: ReadonlyArray<readonly [number, number]> = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];

/** True when a released piece may rest at (x, z): walkable, not in a pit, a supply bin or the plaza. */
export function canSetDown(ctx: MachineCtx, x: number, z: number): boolean {
  if (workerBlocked(ctx, x, z)) return false;
  if (inPlaza(ctx.site, x, z) && ctx.site.plaza.radius > 0) return false;
  for (const m of ctx.site.machines) if (inSquare(m.pit, x, z, 0.35)) return false;
  for (const pl of ctx.site.plots) {
    const R = pl.bin.radius + 0.3;
    if (dist2(x, z, pl.bin.x, pl.bin.z) < R * R) return false;
  }
  return true;
}

/** Nearest valid spot within 2 m of (x, z) for a released piece; falls back to the hook pad (Edge Cases). */
export function setDownSpot(x: number, z: number, ctx: MachineCtx): { x: number; z: number } {
  if (canSetDown(ctx, x, z)) return { x, z };
  const steps = Math.round(MACHINE.setDownRadius / 0.5);
  for (let k = 1; k <= steps; k++) {
    const r = k * 0.5;
    for (const [dx, dz] of DIRS8) {
      const px = x + dx * r;
      const pz = z + dz * r;
      if (canSetDown(ctx, px, pz)) return { x: px, z: pz };
    }
  }
  return { x: ctx.spots.hookPad.x, z: ctx.spots.hookPad.z };
}

/**
 * feature 004 (FR-016): how many pieces of `type` a forklift pallet takes at a rack — the remaining
 * need of that material (ordinary slots first, then its high slots for the crane), at most a full pallet;
 * cement during the concrete part of Groundwork (bags still to pour minus bags already in the mixer).
 */
export function palletSize(p: TowerProgress, type: PieceTypeId, mixerBags = 0, bp: Blueprint = blueprintOf(p)): number {
  const max = MACHINE.forklift.palletMax;
  const part = groundworkPart(p, bp);
  if (part === 'dig') return 0;
  if (part === 'concrete') return type === 'cement' ? Math.max(0, Math.min(max, bp.groundwork.concrete - p.groundPoured - mixerBags)) : 0;
  const o = openSlotsOf(p, type, bp);
  return Math.min(max, o.ordinary > 0 ? o.ordinary : o.high);
}

/**
 * Which machine the crew cue points at (003 FR-022a, 004 FR-015): excavator while digging, mixer while
 * pouring, crane once every slot still open in the stage is a high (crane-only) slot.
 */
export function neededMachine(p: TowerProgress, bp: Blueprint = blueprintOf(p)): MachineKind | null {
  const part = groundworkPart(p, bp);
  if (part === 'dig') return 'excavator';
  if (part === 'concrete') return 'mixer';
  const open = openSlots(p, bp);
  if (open.high > 0 && open.hand === 0) return 'crane';
  return null;
}
