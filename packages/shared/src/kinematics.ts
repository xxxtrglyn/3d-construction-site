import { MOVE } from './constants.ts';
import type { PieceTypeId } from './pieces.ts';
import type { ObstacleBox, ObstacleCyl, SiteLayout } from './site.ts';

/**
 * Deterministic worker controller shared by the client (prediction + replay) and the server
 * (authority) — research R2. Runs at a fixed 60 Hz. The position/velocity path uses only
 * + − × ÷ and √ (IEEE-exact), so identical inputs give bit-identical states on every engine.
 * `facing` uses trig but never feeds back into position, and is excluded from reconciliation.
 *
 * Feel is ported from the 001 Rapier controller (packages/client/src/player/controller.ts):
 * acceleration 40 (ground) / 12 (air), coyote 0.1 s, jump buffer 0.15 s, gravity 22, apex 1.1 m.
 */

export const SIM_DT = 1 / 60;
export const WORKER_RADIUS = 0.32;
/** obstacles with a top this far above the feet can be stepped onto while grounded */
export const STEP_UP = 0.35;
/** walking off a ledge this high keeps the worker grounded (snap to ground) */
export const SNAP_DOWN = 0.3;
const JUMP_SPEED = Math.sqrt(2 * MOVE.gravity * MOVE.jumpApex);
const COYOTE = 0.1;
const JUMP_BUFFER = 0.15;
const ACCEL_GROUND = 40;
const ACCEL_AIR = 12;

export interface WorkerState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  facing: number;
  grounded: boolean;
  coyote: number;
  jumpBuffer: number;
  carrying: PieceTypeId | null;
}

export interface MoveInput {
  /** u16, +1 per 1/60 s step (wraps) */
  seq: number;
  /** world-space wish direction ×127 (i8) */
  dx: number;
  dz: number;
  run: boolean;
  /** jump pressed this step */
  jump: boolean;
}

export type AnimId = 0 | 1 | 2 | 3 | 4 | 5; // idle, walk, run, air, cheer, emote
export const ANIM = { idle: 0, walk: 1, run: 2, air: 3, cheer: 4, emote: 5 } as const;

export function initialWorker(spawn: { x: number; y: number; z: number }, facing = Math.PI): WorkerState {
  return { x: spawn.x, y: spawn.y, z: spawn.z, vx: 0, vy: 0, vz: 0, facing, grounded: true, coyote: COYOTE, jumpBuffer: 0, carrying: null };
}

export function isHeavy(t: PieceTypeId | null): boolean {
  return t === 'beam' || t === 'bell';
}

/** Quantize a world-space direction (|v| ≤ 1) to the i8 wire format. */
export function quantizeDir(x: number, z: number): { dx: number; dz: number } {
  const m = Math.hypot(x, z);
  const k = m > 1 ? 1 / m : 1;
  return { dx: Math.round(x * k * 127), dz: Math.round(z * k * 127) };
}

export function animOf(s: WorkerState): AnimId {
  if (!s.grounded) return ANIM.air;
  const hs = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
  return hs > 4.2 ? ANIM.run : hs > 0.3 ? ANIM.walk : ANIM.idle;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

interface Push {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/** Push a circle out of a rotated box; also removes the velocity component into the surface. */
function pushBox(p: Push, b: ObstacleBox, r: number): void {
  const dx = p.x - b.x;
  const dz = p.z - b.z;
  const lx = b.c * dx - b.s * dz;
  const lz = b.s * dx + b.c * dz;
  const cx = clamp(lx, -b.hx, b.hx);
  const cz = clamp(lz, -b.hz, b.hz);
  let ox = lx - cx;
  let oz = lz - cz;
  const d2 = ox * ox + oz * oz;
  if (d2 >= r * r) return;
  let nlx: number;
  let nlz: number;
  let depth: number;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    nlx = ox / d;
    nlz = oz / d;
    depth = r - d;
  } else {
    // center inside the box: leave through the nearest face
    const px = b.hx - Math.abs(lx);
    const pz = b.hz - Math.abs(lz);
    if (px < pz) {
      nlx = lx >= 0 ? 1 : -1;
      nlz = 0;
      depth = px + r;
    } else {
      nlx = 0;
      nlz = lz >= 0 ? 1 : -1;
      depth = pz + r;
    }
    ox = 0;
    oz = 0;
  }
  // local → world (inverse rotation)
  const nx = b.c * nlx + b.s * nlz;
  const nz = -b.s * nlx + b.c * nlz;
  p.x += nx * depth;
  p.z += nz * depth;
  const vn = p.vx * nx + p.vz * nz;
  if (vn < 0) {
    p.vx -= vn * nx;
    p.vz -= vn * nz;
  }
}

function pushCyl(p: Push, c: ObstacleCyl, r: number): void {
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  const R = c.r + r;
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
  const depth = R - d;
  p.x += nx * depth;
  p.z += nz * depth;
  const vn = p.vx * nx + p.vz * nz;
  if (vn < 0) {
    p.vx -= vn * nx;
    p.vz -= vn * nz;
  }
}

/** Invisible fence at the edge of the island. */
function fence(p: Push, maxR: number): void {
  const d2 = p.x * p.x + p.z * p.z;
  if (d2 <= maxR * maxR) return;
  const d = Math.sqrt(d2);
  const nx = p.x / d;
  const nz = p.z / d;
  p.x = nx * maxR;
  p.z = nz * maxR;
  const vn = p.vx * nx + p.vz * nz;
  if (vn > 0) {
    p.vx -= vn * nx;
    p.vz -= vn * nz;
  }
}

function insideBox(x: number, z: number, b: ObstacleBox, margin: number): boolean {
  const dx = x - b.x;
  const dz = z - b.z;
  const lx = b.c * dx - b.s * dz;
  const lz = b.s * dx + b.c * dz;
  return lx >= -b.hx - margin && lx <= b.hx + margin && lz >= -b.hz - margin && lz <= b.hz + margin;
}

/** Highest standable surface under (x, z) that is not above `ref` (0 = ground). */
function supportHeight(site: SiteLayout, blockers: readonly ObstacleBox[], x: number, z: number, ref: number): number {
  const margin = WORKER_RADIUS * 0.5;
  let best = 0;
  const boxes = site.obstacles.boxes;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i] as ObstacleBox;
    if (b.top > best && b.top <= ref && insideBox(x, z, b, margin)) best = b.top;
  }
  for (let i = 0; i < blockers.length; i++) {
    const b = blockers[i] as ObstacleBox;
    if (b.top > best && b.top <= ref && insideBox(x, z, b, margin)) best = b.top;
  }
  const cyls = site.obstacles.cylinders;
  for (let i = 0; i < cyls.length; i++) {
    const c = cyls[i] as ObstacleCyl;
    if (c.top > best && c.top <= ref) {
      const dx = x - c.x;
      const dz = z - c.z;
      const R = c.r + margin;
      if (dx * dx + dz * dz <= R * R) best = c.top;
    }
  }
  return best;
}

/** One fixed step. Pure: returns a new state. */
export function stepWorker(s: WorkerState, input: MoveInput, dt: number, site: SiteLayout, blockers: readonly ObstacleBox[] = []): WorkerState {
  let { vx, vy, vz, facing, grounded, coyote, jumpBuffer } = s;

  // wish velocity
  let wx = input.dx / 127;
  let wz = input.dz / 127;
  const m2 = wx * wx + wz * wz;
  if (m2 > 1) {
    const m = Math.sqrt(m2);
    wx /= m;
    wz /= m;
  }
  const speed = (input.run ? MOVE.runSpeed : MOVE.walkSpeed) * (isHeavy(s.carrying) ? 1 - MOVE.carrySlowdown : 1);
  wx *= speed;
  wz *= speed;

  if (input.jump) jumpBuffer = JUMP_BUFFER;
  const a = (grounded ? ACCEL_GROUND : ACCEL_AIR) * dt;
  vx += clamp(wx - vx, -a, a);
  vz += clamp(wz - vz, -a, a);
  coyote = grounded ? COYOTE : Math.max(0, coyote - dt);
  jumpBuffer = Math.max(0, jumpBuffer - dt);
  let jumped = false;
  if (jumpBuffer > 0 && coyote > 0) {
    vy = JUMP_SPEED;
    jumpBuffer = 0;
    coyote = 0;
    jumped = true;
  } else if (grounded && vy < 0) {
    vy = -1;
  }
  vy -= MOVE.gravity * dt;

  // horizontal move + collision (obstacles whose top is above the reachable height block)
  const r = WORKER_RADIUS;
  const reach = s.y + (grounded ? STEP_UP : 0.02);
  const p: Push = { x: s.x + vx * dt, z: s.z + vz * dt, vx, vz };
  const boxes = site.obstacles.boxes;
  const cyls = site.obstacles.cylinders;
  for (let iter = 0; iter < 3; iter++) {
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i] as ObstacleBox;
      if (b.top > reach) pushBox(p, b, r);
    }
    for (let i = 0; i < blockers.length; i++) {
      const b = blockers[i] as ObstacleBox;
      if (b.top > reach) pushBox(p, b, r);
    }
    for (let i = 0; i < cyls.length; i++) {
      const c = cyls[i] as ObstacleCyl;
      if (c.top > reach) pushCyl(p, c, r);
    }
    fence(p, site.playRadius - r);
  }

  // vertical
  let y = s.y + vy * dt;
  const support = supportHeight(site, blockers, p.x, p.z, reach);
  if (y <= support) {
    y = support;
    if (vy < 0) vy = 0;
    grounded = true;
  } else if (grounded && !jumped && vy <= 0 && y - support <= SNAP_DOWN) {
    y = support;
    vy = 0;
    grounded = true;
  } else {
    grounded = false;
  }

  // facing (visual only)
  if (wx * wx + wz * wz > 0.01) {
    const target = Math.atan2(wx, wz);
    let d = target - facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    facing += d * Math.min(1, dt * 14);
  }

  return { x: p.x, y, z: p.z, vx: p.vx, vy, vz: p.vz, facing, grounded, coyote, jumpBuffer, carrying: s.carrying };
}

/** Largest position/velocity difference between two states (reconciliation check). */
export function stateError(a: WorkerState, b: WorkerState): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z), Math.abs(a.vx - b.vx) * 0.05, Math.abs(a.vy - b.vy) * 0.05, Math.abs(a.vz - b.vz) * 0.05);
}
