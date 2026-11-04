import RAPIER from '@dimforge/rapier3d-compat';

export type Rapier = typeof RAPIER;
export { RAPIER };

export const FIXED_DT = 1 / 60;

let ready: Promise<void> | null = null;
export function initRapier(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

export class Physics {
  readonly world: RAPIER.World;
  private acc = 0;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -18, z: 0 });
    this.world.timestep = FIXED_DT;
  }

  /** Advance with a fixed step; `beforeStep` runs once per substep (character controller, etc). */
  step(dt: number, beforeStep: (h: number) => void): number {
    this.acc = Math.min(this.acc + dt, FIXED_DT * 5);
    let steps = 0;
    while (this.acc >= FIXED_DT) {
      beforeStep(FIXED_DT);
      this.world.step();
      this.acc -= FIXED_DT;
      steps++;
    }
    return steps;
  }

  /** alpha for render interpolation */
  get alpha(): number {
    return this.acc / FIXED_DT;
  }

  fixedBox(x: number, y: number, z: number, hx: number, hy: number, hz: number, rotY = 0): RAPIER.Collider {
    const q = { x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) };
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation(q);
    return this.world.createCollider(desc);
  }

  fixedCylinder(x: number, y: number, z: number, halfHeight: number, radius: number): RAPIER.Collider {
    return this.world.createCollider(RAPIER.ColliderDesc.cylinder(halfHeight, radius).setTranslation(x, y, z));
  }

  removeCollider(c: RAPIER.Collider): void {
    this.world.removeCollider(c, false);
  }
}
