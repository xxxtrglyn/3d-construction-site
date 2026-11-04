import * as THREE from 'three';
import { MACHINE_KINDS, type MachineKind, type MachineSpots, type PieceTypeId } from '@hht/shared';
import type { AssetStore } from '../assets/loader.ts';
import { addOutline } from '../render/outline.ts';
import { toonVcolMaterial } from '../render/toonMaterial.ts';
import {
  CRANE_TROLLEY_Y, HOOK_HANG, PALLET_BOARD, PLACEHOLDERS, RIG_PARTS, RIG_ROOT, composeParts, craneHookWorld, lodMatrix, palletSlot,
  placeholderGeometry, type MachinePose,
} from './rig.ts';

/** One machine to draw this frame. */
export interface MachineDraw {
  pose: MachinePose;
  spots: MachineSpots;
  /** piece on the crane hook */
  hook: PieceTypeId | null;
  /** pieces on the forklift pallet */
  pallet: readonly PieceTypeId[];
}

interface PartMesh {
  mesh: THREE.InstancedMesh;
  outline: THREE.InstancedMesh | null;
  /** mesh transform relative to its rig part */
  local: THREE.Matrix4;
  part: number;
}

interface KindSet {
  meshes: PartMesh[];
  lod: Array<{ mesh: THREE.InstancedMesh; local: THREE.Matrix4 }>;
  model: boolean;
  near: number;
  far: number;
}

const CAPACITY = 12;

/**
 * Draws every machine of the world with one InstancedMesh per rig part per kind (research M12):
 * 12 instances each, inverted-hull outlines for the near ones, a merged LOD1 beyond `nearDist`, and
 * flat-colour placeholders until the deferred machine models have streamed in (FR-038). Hooked and
 * pallet pieces are handed to the piece renderer.
 */
export class MachineRenderer {
  readonly group = new THREE.Group();
  private readonly sets = new Map<MachineKind, KindSet>();
  private readonly parts: THREE.Matrix4[] = Array.from({ length: 5 }, () => new THREE.Matrix4());
  private readonly tmp = new THREE.Matrix4();
  private readonly tmp2 = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly cables: THREE.InstancedMesh;
  private readonly boards: THREE.InstancedMesh;
  private readonly outlines: boolean;
  private readonly shadows: boolean;
  /** LOD0 radius: research M12 said 30 m; 20 m keeps the 100-worker + 48-machine scene inside render.machines */
  nearDist = 20;
  /** how many machines used LOD0 / LOD1 in the last frame (debug) */
  lastNear = 0;
  lastFar = 0;

  constructor(private readonly assets: AssetStore | null, opts: { outlines: boolean; shadows: boolean; nearDist?: number }) {
    this.outlines = opts.outlines;
    this.shadows = opts.shadows;
    if (opts.nearDist) this.nearDist = opts.nearDist;
    this.group.name = 'Machines';
    for (const kind of MACHINE_KINDS) {
      this.sets.set(kind, { meshes: [], lod: [], model: false, near: 0, far: 0 });
      this.usePlaceholders(kind);
    }
    const cableGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 5);
    cableGeo.translate(0, -0.5, 0); // hangs down from its origin
    this.cables = this.instanced(cableGeo, new THREE.MeshBasicMaterial({ color: 0x2a2a33 }), CAPACITY);
    const boardGeo = new THREE.BoxGeometry(0.95, 0.12, 0.95);
    const wood = new THREE.Color().setRGB(0.8, 0.6, 0.36, THREE.SRGBColorSpace);
    const col = new Float32Array(boardGeo.getAttribute('position').count * 3);
    for (let i = 0; i < col.length; i += 3) col.set([wood.r, wood.g, wood.b], i);
    boardGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.boards = this.instanced(boardGeo, toonVcolMaterial(), CAPACITY);
    this.boards.castShadow = this.shadows;
    if (assets) {
      assets.onLoaded((id) => {
        const kind = MACHINE_KINDS.find((k) => id === `machine-${k}` || id === `machine-${k}-lod1`);
        if (kind) this.useModel(kind);
      });
      for (const kind of MACHINE_KINDS) {
        if (assets.get(`machine-${kind}`)) this.useModel(kind);
      }
    }
  }

  /** Streams the machine models after play starts (deferred group). */
  loadModels(): void {
    if (!this.assets) return;
    for (const kind of MACHINE_KINDS) {
      void this.assets.load(`machine-${kind}`).catch(() => undefined);
      void this.assets.load(`machine-${kind}-lod1`).catch(() => undefined);
    }
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, n: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.count = 0;
    m.visible = false;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(m);
    return m;
  }

  private clear(set: KindSet): void {
    for (const p of set.meshes) {
      this.group.remove(p.mesh);
      p.mesh.dispose();
    }
    for (const l of set.lod) {
      this.group.remove(l.mesh);
      l.mesh.dispose();
    }
    set.meshes = [];
    set.lod = [];
  }

  private usePlaceholders(kind: MachineKind): void {
    const set = this.sets.get(kind)!;
    this.clear(set);
    PLACEHOLDERS[kind].forEach((boxes, part) => {
      const mesh = this.instanced(placeholderGeometry(boxes), toonVcolMaterial(), CAPACITY);
      mesh.name = `${kind}:${RIG_PARTS[kind][part]}:placeholder`;
      mesh.castShadow = this.shadows;
      mesh.receiveShadow = true;
      set.meshes.push({ mesh, outline: null, local: new THREE.Matrix4(), part });
    });
    set.model = false;
  }

  private useModel(kind: MachineKind): void {
    const src = this.assets?.get(`machine-${kind}`);
    if (!src) return;
    const set = this.sets.get(kind)!;
    this.clear(set);
    src.updateMatrixWorld(true);
    RIG_PARTS[kind].forEach((name, part) => {
      const node = src.getObjectByName(name);
      if (!node) return;
      const inv = node.matrixWorld.clone().invert();
      node.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m.userData.isOutline) return;
        const mesh = this.instanced(m.geometry, m.material as THREE.Material, CAPACITY);
        mesh.name = `${kind}:${name}`;
        // thin lattice struts (crane mast and jib) get no inverted hull and cast no shadow: both double
        // their triangles (render.machines budget) and read as noise; the solid parts keep both
        const lattice = kind === 'crane' && (name === 'Mast' || name === 'Jib');
        mesh.castShadow = this.shadows && !lattice;
        mesh.receiveShadow = true;
        const hasOutline = this.outlines && !lattice && m.children.some((c) => c.userData.isOutline);
        const outline = hasOutline ? (addOutline(mesh) as THREE.InstancedMesh) : null;
        if (outline) outline.count = 0;
        set.meshes.push({ mesh, outline, local: inv.clone().multiply(m.matrixWorld), part });
      });
    });
    const lodSrc = this.assets?.get(`machine-${kind}-lod1`);
    if (lodSrc) {
      lodSrc.updateMatrixWorld(true);
      const rootInv = lodSrc.matrixWorld.clone().invert();
      lodSrc.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m.userData.isOutline) return;
        const mesh = this.instanced(m.geometry, m.material as THREE.Material, CAPACITY);
        mesh.name = `${kind}:LOD1`;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        set.lod.push({ mesh, local: rootInv.clone().multiply(m.matrixWorld) });
      });
    }
    set.model = true;
    void RIG_ROOT;
  }

  /** True once the real model of `kind` replaced its placeholder. */
  hasModel(kind: MachineKind): boolean {
    return this.sets.get(kind)?.model ?? false;
  }

  /**
   * Draws all machines. `addPiece` receives world matrices of hooked and pallet pieces (piece
   * renderer batch). Machines beyond `nearDist` from `eye` use LOD1 (when loaded) without outlines.
   */
  draw(list: readonly MachineDraw[], eye: THREE.Vector3, addPiece: (type: PieceTypeId, m: THREE.Matrix4) => void, halfHeight: (t: PieceTypeId) => number): void {
    for (const set of this.sets.values()) {
      set.near = 0;
      set.far = 0;
    }
    let cables = 0;
    let boards = 0;
    this.lastNear = 0;
    this.lastFar = 0;
    for (const d of list) {
      const p = d.pose;
      const set = this.sets.get(p.kind)!;
      const ax = p.kind === 'crane' ? d.spots.crane.x : p.x;
      const az = p.kind === 'crane' ? d.spots.crane.z : p.z;
      const dist = Math.hypot(ax - eye.x, az - eye.z);
      const far = dist > this.nearDist && set.lod.length > 0;
      if (far) {
        lodMatrix(p, d.spots, this.tmp);
        for (const l of set.lod) l.mesh.setMatrixAt(set.far, this.tmp2.multiplyMatrices(this.tmp, l.local));
        set.far++;
        this.lastFar++;
      } else {
        composeParts(p, d.spots, this.parts);
        for (const pm of set.meshes) {
          this.tmp2.multiplyMatrices(this.parts[pm.part]!, pm.local);
          pm.mesh.setMatrixAt(set.near, this.tmp2);
          pm.outline?.setMatrixAt(set.near, this.tmp2);
        }
        set.near++;
        this.lastNear++;
      }
      if (p.kind === 'crane') {
        // cable from the trolley to the hook
        const h = craneHookWorld(p, d.spots, this.v);
        const top = CRANE_TROLLEY_Y - 0.1;
        const len = Math.max(0.05, top - (h.y + 0.62));
        this.tmp.makeScale(1, len, 1).setPosition(h.x, top, h.z);
        this.cables.setMatrixAt(cables++, this.tmp);
        if (d.hook) {
          const hh = halfHeight(d.hook);
          this.tmp.makeRotationY(p.p1).setPosition(h.x, h.y - HOOK_HANG - hh * 0.3, h.z);
          addPiece(d.hook, this.tmp);
        }
      } else if (p.kind === 'forklift' && d.pallet.length && !far) {
        // pallet contents only on near forklifts (the triangle budget; far ones are LOD1 anyway)
        composeParts(p, d.spots, this.parts);
        const forks = this.parts[2]!;
        this.tmp.makeTranslation(PALLET_BOARD.x, PALLET_BOARD.y, PALLET_BOARD.z);
        this.boards.setMatrixAt(boards++, this.tmp2.multiplyMatrices(forks, this.tmp));
        d.pallet.forEach((t, i) => {
          palletSlot(i, this.v);
          this.tmp.makeTranslation(this.v.x, this.v.y + halfHeight(t), this.v.z);
          addPiece(t, this.tmp2.multiplyMatrices(forks, this.tmp));
        });
      }
    }
    for (const set of this.sets.values()) {
      for (const pm of set.meshes) {
        pm.mesh.count = set.near;
        pm.mesh.visible = set.near > 0;
        pm.mesh.instanceMatrix.needsUpdate = true;
        if (pm.outline) {
          pm.outline.count = set.near;
          pm.outline.visible = set.near > 0;
          pm.outline.instanceMatrix.needsUpdate = true;
        }
      }
      for (const l of set.lod) {
        l.mesh.count = set.far;
        l.mesh.visible = set.far > 0;
        l.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this.cables.count = cables;
    this.cables.visible = cables > 0;
    this.cables.instanceMatrix.needsUpdate = true;
    this.boards.count = boards;
    this.boards.visible = boards > 0;
    this.boards.instanceMatrix.needsUpdate = true;
  }
}
