import * as THREE from 'three';
import { SLOT_RING_RADIUS } from './layout.ts';

const MAX = 8;

/** Glowing cyan rings on the ground around the tower: one per open slot of the current stage. */
export class SlotMarkers {
  readonly group = new THREE.Group();
  private readonly rings: THREE.InstancedMesh;
  private readonly positions: THREE.Vector3[] = [];
  private center = new THREE.Vector3();
  private slotCount = 0;
  private filled = 0;
  private readonly tmp = new THREE.Object3D();
  private t = 0;

  constructor() {
    const geo = new THREE.TorusGeometry(0.34, 0.05, 6, 28);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.5, 0.9, 1.0, THREE.SRGBColorSpace).multiplyScalar(1.6), toneMapped: false });
    this.rings = new THREE.InstancedMesh(geo, mat, MAX);
    this.rings.frustumCulled = false;
    this.rings.count = 0;
    this.group.add(this.rings);
    this.group.name = 'SlotMarkers';
  }

  /** Slot positions spread over the front arc (+Z is the tower front). */
  layout(center: THREE.Vector3, slotCount: number): void {
    this.center.copy(center);
    this.slotCount = slotCount;
    this.positions.length = 0;
    const arc = Math.min(Math.PI * 1.25, 0.55 * Math.max(1, slotCount));
    for (let i = 0; i < slotCount; i++) {
      const a = slotCount === 1 ? 0 : -arc / 2 + (arc * i) / (slotCount - 1);
      this.positions.push(new THREE.Vector3(center.x + Math.sin(a) * SLOT_RING_RADIUS, center.y + 0.04, center.z + Math.cos(a) * SLOT_RING_RADIUS));
    }
  }

  slotPosition(i: number): THREE.Vector3 {
    return (this.positions[i] ?? this.center).clone();
  }

  setFilled(filled: number, visible: boolean): void {
    this.filled = filled;
    this.group.visible = visible;
  }

  update(dt: number): void {
    this.t += dt;
    let n = 0;
    for (let i = this.filled; i < this.slotCount && n < MAX; i++) {
      const p = this.positions[i];
      if (!p) continue;
      const s = 1 + 0.08 * Math.sin(this.t * 4 + i);
      this.tmp.position.copy(p);
      this.tmp.scale.setScalar(s);
      this.tmp.updateMatrix();
      this.rings.setMatrixAt(n++, this.tmp.matrix);
    }
    this.rings.count = n;
    this.rings.visible = n > 0;
    this.rings.instanceMatrix.needsUpdate = true;
  }
}
