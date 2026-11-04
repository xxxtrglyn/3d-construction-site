import * as THREE from 'three';
import { dcos, dsin, type MachineKind, type MachineSpots } from '@hht/shared';

/**
 * Machine rigs on the client (feature 003, research M12). Pivots mirror the Blender builder
 * (tools/blender/builders/machines.py, Blender (x, y, z) = three (x, z, −y)); the part names are the
 * asset contract. `composeParts()` turns a machine pose into one world matrix per part.
 */
export const RIG_PARTS: Readonly<Record<MachineKind, readonly string[]>> = {
  crane: ['Mast', 'Cab', 'Jib', 'Trolley', 'Hook'],
  excavator: ['Body', 'Boom', 'Arm', 'Bucket'],
  forklift: ['Body', 'Mast', 'Forks'],
  mixer: ['Body', 'Drum', 'Chute'],
};
export const RIG_ROOT: Readonly<Record<MachineKind, string>> = { crane: 'Crane', excavator: 'Excavator', forklift: 'Forklift', mixer: 'Mixer' };

export const CRANE_SLEW_Y = 13.4;
export const CRANE_TROLLEY_Y = 13.22;
const EXC_BOOM_PIVOT = new THREE.Vector3(-0.15, 1.0, 0.55);
const EXC_BOOM_VEC = new THREE.Vector3(0, 0.8, 1.1);
const EXC_ARM_VEC = new THREE.Vector3(0, -1.1, 0.65);
const FORK_MAST_Z = 0.62;
const MIXER_DRUM = new THREE.Vector3(0, 1.2, -0.1);
const MIXER_CHUTE = new THREE.Vector3(0, 0.95, 0.95);
/** a hooked piece hangs this far below the hook tip */
export const HOOK_HANG = 0.45;

/** What a renderer needs to pose a machine (the predicted state, or an interpolated record). */
export interface MachinePose {
  id: number;
  kind: MachineKind;
  x: number;
  z: number;
  yaw: number;
  p1: number;
  p2: number;
  p3: number;
}

const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const q = new THREE.Quaternion();
const one = new THREE.Vector3(1, 1, 1);
const v = new THREE.Vector3();
const tmp = new THREE.Matrix4();

function trs(out: THREE.Matrix4, x: number, y: number, z: number, axis: THREE.Vector3 | null, angle: number): THREE.Matrix4 {
  q.setFromAxisAngle(axis ?? Y, axis ? angle : 0);
  return out.compose(v.set(x, y, z), q, one);
}

/** World position of the crane hook tip. */
export function craneHookWorld(p: MachinePose, spots: MachineSpots, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(spots.crane.x + dsin(p.p1) * p.p2, p.p3, spots.crane.z + dcos(p.p1) * p.p2);
}

/** Writes one world matrix per rig part (RIG_PARTS order) into `out`. */
export function composeParts(p: MachinePose, spots: MachineSpots, out: THREE.Matrix4[]): void {
  switch (p.kind) {
    case 'crane': {
      const c = spots.crane;
      trs(out[0]!, c.x, 0, c.z, Y, c.yaw);
      trs(out[1]!, c.x, 0, c.z, Y, p.p1).multiply(trs(tmp, 0, CRANE_SLEW_Y, 0, null, 0));
      out[2]!.copy(out[1]!);
      trs(out[3]!, c.x, 0, c.z, Y, p.p1).multiply(trs(tmp, 0, CRANE_TROLLEY_Y, p.p2, null, 0));
      const h = craneHookWorld(p, spots, v.clone());
      trs(out[4]!, h.x, h.y, h.z, Y, p.p1);
      return;
    }
    case 'excavator': {
      const body = trs(out[0]!, p.x, 0, p.z, Y, p.yaw);
      out[1]!.copy(body).multiply(trs(tmp, EXC_BOOM_PIVOT.x, EXC_BOOM_PIVOT.y, EXC_BOOM_PIVOT.z, X, -p.p1));
      out[2]!.copy(out[1]!).multiply(trs(tmp, EXC_BOOM_VEC.x, EXC_BOOM_VEC.y, EXC_BOOM_VEC.z, X, p.p1 * 0.8));
      out[3]!.copy(out[2]!).multiply(trs(tmp, EXC_ARM_VEC.x, EXC_ARM_VEC.y, EXC_ARM_VEC.z, X, -p.p2 * 0.9));
      return;
    }
    case 'forklift': {
      const body = trs(out[0]!, p.x, 0, p.z, Y, p.yaw);
      out[1]!.copy(body).multiply(trs(tmp, 0, 0, FORK_MAST_Z, null, 0));
      out[2]!.copy(body).multiply(trs(tmp, 0, p.p1, FORK_MAST_Z, null, 0));
      return;
    }
    case 'mixer': {
      const body = trs(out[0]!, p.x, 0, p.z, Y, p.yaw);
      out[1]!.copy(body).multiply(trs(tmp, MIXER_DRUM.x, MIXER_DRUM.y, MIXER_DRUM.z, Z, p.p1));
      out[2]!.copy(body).multiply(trs(tmp, MIXER_CHUTE.x, MIXER_CHUTE.y, MIXER_CHUTE.z, null, 0));
      return;
    }
  }
}

/** The whole-machine matrix used by the LOD1 model (the crane turns with its jib). */
export function lodMatrix(p: MachinePose, spots: MachineSpots, out: THREE.Matrix4): THREE.Matrix4 {
  if (p.kind === 'crane') return trs(out, spots.crane.x, 0, spots.crane.z, Y, p.p1);
  return trs(out, p.x, 0, p.z, Y, p.yaw);
}

/** Pallet slots on the forks (in the Forks part frame): up to 4 pieces, 2 × 2. */
export const PALLET_BOARD = new THREE.Vector3(0, 0.1, 0.45);
export function palletSlot(i: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(i % 2 === 0 ? -0.22 : 0.22, 0.17, 0.25 + Math.floor(i / 2) * 0.42);
}

// ---------------------------------------------------------------- flat-colour placeholders (until the models stream in)

export interface PlaceholderBox {
  size: readonly [number, number, number];
  at: readonly [number, number, number];
  color: number;
  /** optional: a beam from `at` to `to` instead of an axis-aligned box */
  to?: readonly [number, number, number];
}

const YEL = 0xffcc33;
const DARK = 0x34343f;
const GREY = 0xc8c6c0;
const STEEL = 0x9ea6b0;
const ORANGE = 0xff7a1f;

export const PLACEHOLDERS: Readonly<Record<MachineKind, readonly (readonly PlaceholderBox[])[]>> = {
  crane: [
    [{ size: [1.5, 0.36, 1.5], at: [0, 0.18, 0], color: GREY }, { size: [0.72, 13.0, 0.72], at: [0, 6.85, 0], color: YEL }],
    [{ size: [1.0, 1.1, 0.95], at: [0, -0.55, -0.8], color: YEL }],
    [{ size: [0.55, 0.45, 11], at: [0, 0.2, 2.7], color: YEL }, { size: [0.95, 0.7, 0.8], at: [0, -0.25, -2.45], color: GREY }],
    [{ size: [0.62, 0.18, 0.55], at: [0, 0, 0], color: DARK }],
    [{ size: [0.34, 0.4, 0.26], at: [0, 0.42, 0], color: YEL }],
  ],
  excavator: [
    [{ size: [1.68, 0.48, 2.1], at: [0, 0.24, 0], color: DARK }, { size: [1.35, 0.55, 1.4], at: [-0.05, 0.85, -0.15], color: YEL }, { size: [0.62, 0.7, 0.7], at: [0.3, 1.45, 0.05], color: YEL }],
    [{ size: [0.24, 0.24, 0], at: [0, 0, 0], to: [0, 0.8, 1.1], color: YEL }],
    [{ size: [0.18, 0.18, 0], at: [0, 0, 0], to: [0, -1.1, 0.65], color: YEL }],
    [{ size: [0.55, 0.32, 0.36], at: [0, -0.12, 0.16], color: DARK }],
  ],
  forklift: [
    [{ size: [1.05, 0.5, 1.55], at: [0, 0.45, -0.15], color: YEL }, { size: [1.05, 0.62, 0.32], at: [0, 0.5, -0.85], color: DARK }, { size: [1.0, 0.06, 1.05], at: [0, 1.97, -0.1], color: DARK }],
    [{ size: [0.7, 2.1, 0.1], at: [0, 1.1, 0], color: STEEL }],
    [{ size: [0.7, 0.55, 0.06], at: [0, 0.32, 0.07], color: DARK }, { size: [0.54, 0.05, 0.8], at: [0, 0.04, 0.47], color: STEEL }],
  ],
  mixer: [
    [{ size: [0.9, 0.16, 1.9], at: [0, 0.42, -0.1], color: DARK }, { size: [0.7, 0.5, 0.45], at: [0, 0.75, -0.85], color: YEL }, { size: [0.6, 0.4, 0.6], at: [0, 1.5, -1.05], color: YEL }],
    [{ size: [1.2, 1.2, 1.5], at: [0, 0, 0], color: ORANGE }],
    [{ size: [0.18, 0.18, 0], at: [0, 0, 0], to: [0, -0.4, 0.55], color: STEEL }],
  ],
};

/** One merged, vertex-coloured BufferGeometry per placeholder part. */
export function placeholderGeometry(boxes: readonly PlaceholderBox[]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  for (const b of boxes) {
    let g: THREE.BufferGeometry;
    if (b.to) {
      const a = new THREE.Vector3(...b.at);
      const t = new THREE.Vector3(...b.to);
      const len = a.distanceTo(t);
      g = new THREE.BoxGeometry(b.size[0], b.size[1], len);
      const mid = a.clone().add(t).multiplyScalar(0.5);
      const look = new THREE.Matrix4().lookAt(a, t, new THREE.Vector3(0, 1, 0));
      m.copy(look).setPosition(mid);
      // lookAt points −Z at the target; flip so +Z runs from a to t (symmetric box: either works)
    } else {
      g = new THREE.BoxGeometry(...b.size);
      m.makeTranslation(...b.at);
    }
    g.applyMatrix4(m);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    col.setHex(b.color, THREE.SRGBColorSpace);
    for (let i = 0; i < n; i++) colors.set([col.r, col.g, col.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  // merge (positions, normals, colors)
  const total = parts.reduce((s, g) => s + g.getAttribute('position').count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const colr = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    const c = g.getAttribute('position').count;
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, o * 3);
    colr.set(g.getAttribute('color').array as Float32Array, o * 3);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  out.computeBoundingSphere();
  return out;
}
