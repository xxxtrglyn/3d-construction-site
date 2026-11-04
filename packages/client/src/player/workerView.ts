import * as THREE from 'three';
import type { CarryPose } from '@hht/shared';
import { toonFromColor } from '../render/toonMaterial.ts';

export type WorkerPose = 'idle' | 'walk' | 'run' | 'air' | 'cheer';

/**
 * The approved chibi worker with procedural animation on its node hierarchy
 * (Body, Hat, Arm_L, Arm_R, Leg_L, Leg_R). Faces +Z.
 */
export class WorkerView {
  readonly root: THREE.Object3D;
  private readonly body: THREE.Object3D;
  private readonly hat: THREE.Object3D;
  private readonly armL: THREE.Object3D;
  private readonly armR: THREE.Object3D;
  private readonly legL: THREE.Object3D;
  private readonly legR: THREE.Object3D;
  readonly carryAnchor: THREE.Object3D;
  private phase = 0;
  private t = 0;
  private squash = 0;
  private flick = 0;
  private readonly bodyBaseY: number;
  private readonly hatBaseY: number;

  constructor(asset: THREE.Object3D, hatColor: string) {
    this.root = asset.clone(true);
    this.root.name = 'Player';
    const get = (n: string): THREE.Object3D => this.root.getObjectByName(n) ?? new THREE.Object3D();
    this.body = get('Body');
    this.hat = get('Hat');
    this.armL = get('Arm_L');
    this.armR = get('Arm_R');
    this.legL = get('Leg_L');
    this.legR = get('Leg_R');
    this.carryAnchor = get('Carry');
    this.bodyBaseY = this.body.position.y;
    this.hatBaseY = this.hat.position.y;
    this.setHatColor(hatColor);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.userData.isOutline) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
  }

  setHatColor(hex: string): void {
    const mat = toonFromColor(new THREE.Color(hex), 'T_hat_runtime');
    this.hat.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.userData.isOutline) m.material = mat;
    });
  }

  jumped(): void {
    this.squash = 1;
  }

  tossed(): void {
    this.flick = 1;
  }

  update(dt: number, pose: WorkerPose, speed: number, carry: CarryPose | null): void {
    this.t += dt;
    const moving = pose === 'walk' || pose === 'run';
    this.phase += dt * (moving ? 3.2 + speed * 1.6 : 0);
    const swing = moving ? Math.sin(this.phase) * (pose === 'run' ? 0.75 : 0.5) : 0;
    const bob = moving ? Math.abs(Math.sin(this.phase)) * 0.05 : Math.sin(this.t * 2.2) * 0.012;
    this.squash = Math.max(0, this.squash - dt * 4);
    this.flick = Math.max(0, this.flick - dt * 5);

    this.legL.rotation.x = pose === 'air' ? -0.5 : swing;
    this.legR.rotation.x = pose === 'air' ? 0.3 : -swing;
    this.body.position.y = this.bodyBaseY + bob;
    this.hat.position.y = this.hatBaseY + bob;
    const sq = Math.sin(this.squash * Math.PI) * 0.12;
    this.root.scale.set(1 + sq * 0.6, 1 - sq, 1 + sq * 0.6);

    // arms: positive x rotation swings the hand forward (+Z) for a +Z-facing worker
    let al = -swing * 0.8;
    let ar = swing * 0.8;
    let zl = 0;
    let zr = 0;
    if (carry === 'twoHands' || carry === 'hug') {
      al = ar = -1.35;
      zl = carry === 'hug' ? 0.35 : 0.15;
      zr = -zl;
    } else if (carry === 'shoulder') {
      ar = -2.6;
      al = -swing * 0.5;
    }
    if (pose === 'cheer') {
      const w = Math.sin(this.t * 10) * 0.25;
      al = -2.9 + w;
      ar = -2.9 - w;
      zl = 0.25;
      zr = -0.25;
      this.root.position.y += Math.abs(Math.sin(this.t * 6)) * 0.0;
    }
    if (this.flick > 0) ar = -2.2 * this.flick;
    this.armL.rotation.set(al, 0, zl);
    this.armR.rotation.set(ar, 0, zr);
  }
}
