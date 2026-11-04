import * as THREE from 'three';
import type { CarryPose } from '@hht/shared';
import { toonFromColor } from '../render/toonMaterial.ts';
import { animate, newAnimState, type CrowdPose, type PartPose } from '../crowd/animation.ts';

export type WorkerPose = CrowdPose;

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
  private readonly anim = newAnimState();
  private readonly pose: PartPose = { legL: 0, legR: 0, armL: [0, 0], armR: [0, 0], bob: 0, twist: 0, squash: 0 };
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
    this.anim.squash = 1;
  }

  tossed(): void {
    this.anim.flick = 1;
  }

  /** Same procedural animation as the crowd (crowd/animation.ts), incl. emotes. */
  update(dt: number, pose: WorkerPose, speed: number, carry: CarryPose | null): void {
    const p = animate(this.anim, dt, pose, speed, carry, this.pose);
    this.legL.rotation.x = p.legL;
    this.legR.rotation.x = p.legR;
    this.body.position.y = this.bodyBaseY + p.bob;
    this.hat.position.y = this.hatBaseY + p.bob;
    this.body.rotation.y = p.twist;
    this.root.scale.set(1 + p.squash * 0.6, 1 - p.squash, 1 + p.squash * 0.6);
    this.armL.rotation.set(p.armL[0], 0, p.armL[1]);
    this.armR.rotation.set(p.armR[0], 0, p.armR[1]);
  }
}
