import * as THREE from 'three';
import { currentStage, type MachineSpots, type SlotRef, type TowerProgress } from '@hht/shared';

/**
 * High-slot rings (FR-023/FR-027a): a ring at the tower top for every open high slot of the current
 * stage on every plot, and one lit ring on the slot a crane release would fill right now.
 */
export class HighSlotRings {
  readonly group = new THREE.Group();
  private readonly rings: THREE.InstancedMesh;
  private readonly lit: THREE.Mesh;
  private readonly m = new THREE.Object3D();
  private t = 0;
  /** the slot the lit ring marks (debug `snapRing()`) */
  litSlot: { slot: number; high: boolean } | null = null;

  constructor(capacity = 48) {
    this.group.name = 'HighSlots';
    const geo = new THREE.TorusGeometry(0.42, 0.05, 6, 28);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.5, 0.9, 1.0, THREE.SRGBColorSpace).multiplyScalar(1.4), toneMapped: false });
    this.rings = new THREE.InstancedMesh(geo, mat, capacity);
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    const litGeo = new THREE.TorusGeometry(0.62, 0.09, 8, 32);
    litGeo.rotateX(Math.PI / 2);
    this.lit = new THREE.Mesh(litGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.9, 0.5), toneMapped: false }));
    this.lit.visible = false;
    this.group.add(this.rings, this.lit);
  }

  /** `plots`: progress per plot with a building (null = none); `lit`: the crane's snap target, if any. */
  update(dt: number, plots: ReadonlyArray<{ progress: TowerProgress | null; spots: MachineSpots }>, lit: SlotRef | null): void {
    this.t += dt;
    let n = 0;
    for (const { progress, spots } of plots) {
      if (!progress) continue;
      const st = currentStage(progress);
      if (!st || st.highSlots <= progress.highFilled) continue;
      const pts = spots.highSlots[st.number - 1] ?? [];
      for (let i = progress.highFilled; i < st.highSlots; i++) {
        const q = pts[i];
        if (!q) continue;
        this.m.position.set(q.x, q.y, q.z);
        this.m.scale.setScalar(1 + 0.08 * Math.sin(this.t * 4 + i));
        this.m.updateMatrix();
        if (n < this.rings.instanceMatrix.count) this.rings.setMatrixAt(n++, this.m.matrix);
      }
    }
    this.rings.count = n;
    this.rings.visible = n > 0;
    this.rings.instanceMatrix.needsUpdate = true;
    this.litSlot = lit ? { slot: lit.index, high: lit.high } : null;
    this.lit.visible = !!lit;
    if (lit) {
      this.lit.position.set(lit.x, lit.y + 0.05, lit.z);
      this.lit.scale.setScalar(1 + 0.12 * Math.sin(this.t * 10));
    }
  }
}
