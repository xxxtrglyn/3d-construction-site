import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PIECE_TYPE_IDS, type PieceTypeId } from '@hht/shared';
import { PIECE_DOT } from '../ui/needsText.ts';

/** One open ordinary slot to show: its material and ground position. */
export interface GhostSlot {
  readonly type: PieceTypeId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Ghost caps (plan Performance Goals): ≤ 6 draw calls (one per building material) and a bounded instance count. */
const CAPACITY = 12 * 8;
const GHOST_OPACITY = 0.35;

/**
 * Feature 004 (FR-011, research R4): a translucent ghost of each open ordinary slot's material, so the
 * two materials of a stage are visibly distinct around the tower. One InstancedMesh per piece type
 * (sub-meshes merged, position + normal only), a flat toon-tinted ghost material, no outline, no
 * shadows, no depth writes. Used by solo (one plot) and multiplayer (near plots + the own plot).
 */
export class SlotGhosts {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<PieceTypeId, THREE.InstancedMesh>();
  private readonly lift = new Map<PieceTypeId, number>();
  private slots: readonly GhostSlot[] = [];
  private readonly m = new THREE.Object3D();
  private t = 0;
  /** open ghosts per type after the last `set()` (debug API, e2e) */
  readonly counts = new Map<PieceTypeId, number>();

  constructor(piecesAsset: THREE.Object3D) {
    this.group.name = 'SlotGhosts';
    piecesAsset.updateMatrixWorld(true);
    for (const type of PIECE_TYPE_IDS) {
      const node = piecesAsset.getObjectByName(`Piece_${type}`);
      if (!node) continue;
      const inv = node.matrixWorld.clone().invert();
      const parts: THREE.BufferGeometry[] = [];
      node.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || mesh.userData.isOutline) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', mesh.geometry.getAttribute('position').clone());
        const nrm = mesh.geometry.getAttribute('normal');
        if (nrm) g.setAttribute('normal', nrm.clone());
        if (mesh.geometry.index) g.setIndex(mesh.geometry.index.clone());
        g.applyMatrix4(inv.clone().multiply(mesh.matrixWorld));
        parts.push(g.index ? g.toNonIndexed() : g);
      });
      const geo = parts.length > 1 ? mergeGeometries(parts, false) : parts[0];
      if (!geo) continue;
      geo.computeBoundingBox();
      const box = geo.boundingBox as THREE.Box3;
      this.lift.set(type, -box.min.y + 0.06);
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PIECE_DOT[type]), transparent: true, opacity: GHOST_OPACITY, depthWrite: false });
      const inst = new THREE.InstancedMesh(geo, mat, CAPACITY);
      inst.name = `ghost:${type}`;
      inst.count = 0;
      inst.frustumCulled = false;
      inst.renderOrder = 2;
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes.set(type, inst);
      this.group.add(inst);
    }
  }

  /** Replace the shown slots (call only when progress or the near set changes). */
  set(slots: readonly GhostSlot[]): void {
    this.slots = slots;
    this.counts.clear();
    for (const s of slots) this.counts.set(s.type, (this.counts.get(s.type) ?? 0) + 1);
    this.write();
  }

  /** Gentle bob so the ghosts read as "waiting for a piece". */
  update(dt: number): void {
    if (!this.slots.length) return;
    this.t += dt;
    this.write();
  }

  private write(): void {
    const n = new Map<PieceTypeId, number>();
    this.slots.forEach((s, k) => {
      const inst = this.meshes.get(s.type);
      const i = n.get(s.type) ?? 0;
      if (!inst || i >= CAPACITY) return;
      this.m.position.set(s.x, s.y + (this.lift.get(s.type) ?? 0.2) + 0.06 * Math.sin(this.t * 2.2 + k), s.z);
      this.m.rotation.set(0, this.t * 0.4 + k, 0);
      this.m.updateMatrix();
      inst.setMatrixAt(i, this.m.matrix);
      n.set(s.type, i + 1);
    });
    for (const [type, inst] of this.meshes) {
      inst.count = n.get(type) ?? 0;
      inst.visible = inst.count > 0;
      inst.instanceMatrix.needsUpdate = true;
    }
  }
}
