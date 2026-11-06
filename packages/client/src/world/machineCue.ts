import { reducedMotion } from '../game/gameplayFeedback.ts';
import * as THREE from 'three';
import { neededMachine, type MachineKind, type TowerProgress } from '@hht/shared';

/**
 * The crew cue (FR-022a): the machine the current step needs glows with a bouncing arrow — for that
 * plot's crew only, hidden while someone operates it, never for the forklift.
 */
export class MachineCue {
  readonly group = new THREE.Group();
  private readonly arrow: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private t = 0;
  /** what the cue currently points at (debug `cue()`) */
  current: { plot: number; machine: MachineKind | null } = { plot: -1, machine: null };

  constructor() {
    this.group.name = 'MachineCue';
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.25, 1.0, 0.28), toneMapped: false });
    const cone = new THREE.ConeGeometry(0.45, 0.9, 4);
    cone.rotateX(Math.PI); // points down
    this.arrow = new THREE.Mesh(cone, glow);
    const ringGeo = new THREE.TorusGeometry(1.6, 0.045, 6, 40);
    ringGeo.rotateX(Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, glow);
    this.group.add(this.arrow, this.ring);
    this.group.visible = false;
  }

  /**
   * `myPlot` / `progress`: the viewer's crew plot; `operated(kind)`: someone is in it; `where(kind)`: the
   * machine's ground position and top height.
   */
  update(dt: number, myPlot: number, progress: TowerProgress | null, operated: (k: MachineKind) => boolean, where: (k: MachineKind) => { x: number; z: number; top: number }, override?: MachineKind | null): void {
    this.t = reducedMotion() ? 0 : this.t + dt;
    const kind = override !== undefined ? override : myPlot >= 0 && progress ? neededMachine(progress) : null;
    const show = kind !== null && !operated(kind);
    this.current = { plot: myPlot, machine: show ? kind : null };
    this.group.visible = show;
    if (!show || !kind) return;
    const w = where(kind);
    const bounce = Math.abs(Math.sin(this.t * 3.2)) * 0.6;
    this.arrow.position.set(w.x, w.top + 0.9 + bounce, w.z);
    this.arrow.rotation.y = this.t * 1.5;
    this.ring.position.set(w.x, 0.06, w.z);
    this.ring.scale.setScalar(1 + Math.sin(this.t * 4) * 0.06);
  }
}
