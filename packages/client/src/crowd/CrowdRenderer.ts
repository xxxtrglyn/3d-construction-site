import * as THREE from 'three';
import { PIECE_TYPES, type PieceTypeId } from '@hht/shared';
import { ensureOutlineNormals, outlineMaterial } from '../render/outline.ts';
import { toonFromColor } from '../render/toonMaterial.ts';
import { animate, newAnimState, type AnimState, type CrowdPose, type PartPose } from './animation.ts';

const PARTS = ['Body', 'Hat', 'Arm_L', 'Arm_R', 'Leg_L', 'Leg_R'] as const;
type PartName = (typeof PARTS)[number];

interface SubMesh {
  part: PartName;
  /** mesh transform relative to its part node */
  local: THREE.Matrix4;
  mesh: THREE.InstancedMesh;
  outline: THREE.InstancedMesh | null;
}

interface PartRest {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/** One remote worker to draw this frame. */
export interface CrowdEntry {
  key: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pose: CrowdPose;
  speed: number;
  carry: PieceTypeId | null;
  hatColor: string;
  /** distance to the camera (outline culling) */
  distance: number;
}

/**
 * Draws every remote worker with one InstancedMesh per rigid part sub-mesh (+ instanced outline hulls
 * that are culled beyond the outline distance), so 100 workers cost ~12 draw calls (research R7).
 * The procedural animation is the same as the player's WorkerView.
 */
export class CrowdRenderer {
  readonly group = new THREE.Group();
  private readonly subs: SubMesh[] = [];
  private readonly rest = new Map<PartName, PartRest>();
  private readonly carryLocal = new THREE.Vector3();
  private readonly anims = new Map<number, AnimState>();
  private readonly pose: PartPose = { legL: 0, legR: 0, armL: [0, 0], armR: [0, 0], bob: 0, twist: 0, squash: 0 };
  private readonly colors = new Map<string, THREE.Color>();
  readonly capacity: number;
  /** entry keys in instance order from the last update (for picking) */
  readonly lastKeys: number[] = [];
  private outlineDistance: number;
  private readonly m = new THREE.Matrix4();
  private readonly root = new THREE.Matrix4();
  private readonly partM = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly carryOut = new THREE.Matrix4();

  constructor(workerAsset: THREE.Object3D, capacity = 128, outlineDistance = 28) {
    this.group.name = 'Crowd';
    this.capacity = capacity;
    this.outlineDistance = outlineDistance;
    workerAsset.updateMatrixWorld(true);
    const rootNode = workerAsset.getObjectByName('Worker') ?? workerAsset;
    const rootInv = rootNode.matrixWorld.clone().invert();
    const hatMat = toonFromColor(new THREE.Color(1, 1, 1), 'T_hat_crowd');
    for (const name of PARTS) {
      const node = workerAsset.getObjectByName(name);
      if (!node) continue;
      const partWorld = rootInv.clone().multiply(node.matrixWorld);
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      partWorld.decompose(p, q, new THREE.Vector3());
      this.rest.set(name, { position: p, quaternion: q });
      const partInv = node.matrixWorld.clone().invert();
      node.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || mesh.userData.isOutline) return;
        const local = partInv.clone().multiply(mesh.matrixWorld);
        const inst = new THREE.InstancedMesh(mesh.geometry, name === 'Hat' ? hatMat : mesh.material, capacity);
        inst.name = `crowd:${name}:${mesh.name}`;
        inst.count = 0;
        inst.castShadow = true;
        inst.receiveShadow = true;
        inst.frustumCulled = false;
        inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        if (name === 'Hat') inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
        let outline: THREE.InstancedMesh | null = null;
        if (mesh.children.some((c) => c.userData.isOutline)) {
          // own instance buffer so hulls are culled by distance (filled near-first)
          ensureOutlineNormals(mesh.geometry);
          const hull = new THREE.InstancedMesh(mesh.geometry, outlineMaterial, capacity);
          hull.name = `${inst.name}__outline`;
          hull.userData.isOutline = true;
          hull.castShadow = false;
          hull.receiveShadow = false;
          hull.frustumCulled = false;
          hull.count = 0;
          hull.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          hull.raycast = () => {};
          outline = hull;
          this.group.add(hull);
        }
        this.group.add(inst);
        this.subs.push({ part: name, local, mesh: inst, outline });
      });
    }
    const carry = workerAsset.getObjectByName('Carry');
    if (carry) this.carryLocal.setFromMatrixPosition(rootInv.clone().multiply(carry.matrixWorld));
  }

  setOutlineDistance(d: number): void {
    this.outlineDistance = d;
  }

  private color(hex: string): THREE.Color {
    let c = this.colors.get(hex);
    if (!c) {
      c = new THREE.Color(hex);
      this.colors.set(hex, c);
    }
    return c;
  }

  /** Notify that a worker jumped/tossed (squash/flick accents). */
  accent(key: number, kind: 'jump' | 'toss'): void {
    const a = this.anims.get(key);
    if (!a) return;
    if (kind === 'jump') a.squash = 1;
    else a.flick = 1;
  }

  /**
   * Draw `entries` (sorted near-first by the caller is not required). `onCarry` receives the world matrix
   * of each carried piece so the piece renderer can draw it.
   */
  update(dt: number, entries: readonly CrowdEntry[], onCarry: (type: PieceTypeId, m: THREE.Matrix4) => void): number {
    const n = Math.min(entries.length, this.capacity);
    const order = entries.slice(0, n).sort((a, b) => a.distance - b.distance);
    let outlined = 0;
    const live = new Set<number>();
    this.lastKeys.length = 0;
    for (let i = 0; i < n; i++) {
      const e = order[i] as CrowdEntry;
      live.add(e.key);
      this.lastKeys.push(e.key);
      let a = this.anims.get(e.key);
      if (!a) {
        a = newAnimState(e.key);
        this.anims.set(e.key, a);
      }
      const carryPose = e.carry ? PIECE_TYPES[e.carry].carryPose : null;
      const p = animate(a, dt, e.pose, e.speed, carryPose, this.pose);
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, e.yaw + p.twist);
      this.s.set(1 + p.squash * 0.6, 1 - p.squash, 1 + p.squash * 0.6);
      this.root.compose(this.v.set(e.x, e.y, e.z), this.q, this.s);
      const outline = e.distance <= this.outlineDistance;
      if (outline) outlined++;
      for (const sub of this.subs) {
        const rest = this.rest.get(sub.part) as PartRest;
        this.e.set(0, 0, 0);
        let bob = 0;
        switch (sub.part) {
          case 'Leg_L': this.e.x = p.legL; break;
          case 'Leg_R': this.e.x = p.legR; break;
          case 'Arm_L': this.e.set(p.armL[0], 0, p.armL[1]); break;
          case 'Arm_R': this.e.set(p.armR[0], 0, p.armR[1]); break;
          default: bob = p.bob;
        }
        this.q.copy(rest.quaternion).multiply(this.q2.setFromEuler(this.e));
        this.partM.compose(this.v.copy(rest.position).setY(rest.position.y + bob), this.q, this.s.set(1, 1, 1));
        this.m.multiplyMatrices(this.root, this.partM).multiply(sub.local);
        sub.mesh.setMatrixAt(i, this.m);
        if (sub.part === 'Hat' && sub.mesh.instanceColor) sub.mesh.setColorAt(i, this.color(e.hatColor));
        if (sub.outline && outline) sub.outline.setMatrixAt(outlined - 1, this.m);
      }
      if (e.carry) onCarry(e.carry, this.carryMatrix(e.carry, this.root));
    }
    for (const sub of this.subs) {
      sub.mesh.count = n;
      sub.mesh.instanceMatrix.needsUpdate = true;
      if (sub.mesh.instanceColor) sub.mesh.instanceColor.needsUpdate = true;
      if (sub.outline) {
        sub.outline.count = outlined;
        sub.outline.instanceMatrix.needsUpdate = true;
      }
    }
    if (this.anims.size > n * 2 + 32) for (const k of this.anims.keys()) if (!live.has(k)) this.anims.delete(k);
    return n;
  }

  setOutlinesVisible(v: boolean): void {
    for (const sub of this.subs) if (sub.outline) sub.outline.visible = v;
  }

  /** Same carry offsets as the solo game (Game.heldMatrix). */
  private carryMatrix(type: PieceTypeId, root: THREE.Matrix4): THREE.Matrix4 {
    return carryMatrixFor(type, root, this.carryOut);
  }
}

const HALF_HEIGHT: Partial<Record<PieceTypeId, number>> = {};

export function setCarryHalfHeights(map: ReadonlyMap<PieceTypeId, number>): void {
  for (const [k, v] of map) HALF_HEIGHT[k] = v;
}

const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

/** World matrix of a carried piece for a worker root matrix (carry poses from 001). */
export function carryMatrixFor(type: PieceTypeId, root: THREE.Matrix4, out: THREE.Matrix4): THREE.Matrix4 {
  const pose = PIECE_TYPES[type].carryPose;
  const hh = HALF_HEIGHT[type] ?? 0.15;
  tmpE.set(0, 0, 0);
  if (pose === 'shoulder') {
    tmpV.set(-0.3, 0.84, 0.05);
    tmpE.set(0, Math.PI / 2, 0);
  } else if (pose === 'hug') tmpV.set(0, 0.42 + hh * 0.5, 0.4);
  else tmpV.set(0, 0.36 + hh, 0.42);
  tmpQ.setFromEuler(tmpE);
  out.compose(tmpV, tmpQ, ONE);
  return out.premultiply(root);
}
