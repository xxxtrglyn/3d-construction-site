import * as THREE from 'three';
import { PIECE_TYPE_IDS, type PieceTypeId } from '@hht/shared';
import { addOutline } from '../render/outline.ts';

const CAPACITY = 64;

interface SubMesh {
  mesh: THREE.InstancedMesh;
  outline: THREE.InstancedMesh | null;
  local: THREE.Matrix4;
}

/**
 * Renders every piece in the world (rack displays, loose, held, flying, delivered piles) with one
 * InstancedMesh per sub-mesh per piece type. Each frame: begin() → add(type, matrix)… → end().
 */
export class PieceRenderer {
  readonly group = new THREE.Group();
  private readonly subs = new Map<PieceTypeId, SubMesh[]>();
  private readonly counts = new Map<PieceTypeId, number>();
  private readonly tmp = new THREE.Matrix4();
  /** half height of each piece's bounds (for resting on the ground) */
  readonly halfHeight = new Map<PieceTypeId, number>();
  readonly bounds = new Map<PieceTypeId, THREE.Box3>();

  readonly capacity: number;

  constructor(piecesAsset: THREE.Object3D, capacity = CAPACITY) {
    this.capacity = capacity;
    this.group.name = 'Pieces';
    piecesAsset.updateMatrixWorld(true);
    for (const type of PIECE_TYPE_IDS) {
      const node = piecesAsset.getObjectByName(`Piece_${type}`);
      if (!node) continue;
      const nodeInv = node.matrixWorld.clone().invert();
      const list: SubMesh[] = [];
      const box = new THREE.Box3();
      node.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m.userData.isOutline) return;
        const local = nodeInv.clone().multiply(m.matrixWorld);
        const inst = new THREE.InstancedMesh(m.geometry, m.material, capacity);
        inst.name = `${type}:${m.name}`;
        inst.count = 0;
        inst.castShadow = true;
        inst.receiveShadow = true;
        inst.frustumCulled = false;
        inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        const outlineChild = m.children.find((c) => c.userData.isOutline);
        const outline = outlineChild ? (addOutline(inst) as THREE.InstancedMesh) : null;
        m.geometry.computeBoundingBox();
        box.union((m.geometry.boundingBox as THREE.Box3).clone().applyMatrix4(local));
        list.push({ mesh: inst, outline, local });
        this.group.add(inst);
      });
      this.subs.set(type, list);
      this.bounds.set(type, box);
      this.halfHeight.set(type, (box.max.y - box.min.y) / 2);
    }
  }

  begin(): void {
    for (const t of PIECE_TYPE_IDS) this.counts.set(t, 0);
  }

  add(type: PieceTypeId, world: THREE.Matrix4): void {
    const i = this.counts.get(type) ?? 0;
    if (i >= this.capacity) return;
    for (const s of this.subs.get(type) ?? []) {
      this.tmp.multiplyMatrices(world, s.local);
      s.mesh.setMatrixAt(i, this.tmp);
    }
    this.counts.set(type, i + 1);
  }

  end(): void {
    for (const [type, list] of this.subs) {
      const n = this.counts.get(type) ?? 0;
      for (const s of list) {
        s.mesh.count = n;
        s.mesh.visible = n > 0;
        s.mesh.instanceMatrix.needsUpdate = true;
        if (s.outline) s.outline.count = n;
      }
    }
  }
}
