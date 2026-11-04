import * as THREE from 'three';
import { dcos, dsin, type MachineKind, type MachineSpots } from '@hht/shared';
import { craneHookWorld, type MachinePose } from '../machines/rig.ts';
import type { FollowCamera } from './followCamera.ts';

export type CameraMode = 'follow' | 'hook' | 'cab' | 'mixer';

/**
 * Cameras while operating a machine (FR-008a, research M13):
 * - excavator and forklift: the follow camera on the machine at 1.4× distance, easing behind it;
 * - crane: the raised **hook camera** above and behind the hook (along the jib), or the **cab camera**
 *   (toss toggles; every enter resets to the hook camera);
 * - mixer: a fixed view of the hopper and the chute.
 */
export class MachineCameras {
  mode: CameraMode = 'follow';
  private kind: MachineKind | null = null;
  private savedDistance = 0;
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly wantPos = new THREE.Vector3();
  private readonly wantLook = new THREE.Vector3();
  private readonly focus = new THREE.Vector3();
  private snapped = false;

  constructor(private readonly follow: FollowCamera) {}

  /** Getting in: crane → hook camera (always), mixer → fixed, others → follow at 1.4×. */
  enter(kind: MachineKind): void {
    this.kind = kind;
    this.mode = kind === 'crane' ? 'hook' : kind === 'mixer' ? 'mixer' : 'follow';
    this.savedDistance = this.follow.distance;
    if (this.mode === 'follow') this.follow.distance = Math.min(14 * 1.4, this.savedDistance * 1.4);
    this.snapped = false;
  }

  exit(): void {
    if (this.kind && this.savedDistance) this.follow.distance = this.savedDistance;
    this.kind = null;
    this.mode = 'follow';
  }

  /** Toss in the crane: hook camera ↔ cab camera. */
  toggle(): void {
    if (this.kind !== 'crane') return;
    this.mode = this.mode === 'hook' ? 'cab' : 'hook';
  }

  get active(): boolean {
    return this.kind !== null;
  }

  update(dt: number, camera: THREE.PerspectiveCamera, p: MachinePose, spots: MachineSpots, input: { x: number; y: number }): void {
    if (this.mode === 'follow') {
      // ease the orbit behind a machine that is driving (the stick steers the machine, not the camera)
      const behind = p.yaw + Math.PI;
      if (Math.abs(input.y) > 0.1) {
        let d = behind - this.follow.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.follow.yaw += d * Math.min(1, dt * 2.2);
      }
      this.follow.update(dt, this.focus.set(p.x, 0.4, p.z));
      return;
    }
    if (this.mode === 'hook' || this.mode === 'cab') {
      const h = craneHookWorld(p, spots, this.focus);
      const jx = dsin(p.p1);
      const jz = dcos(p.p1);
      if (this.mode === 'hook') {
        this.wantPos.set(h.x - jx * 6, Math.max(h.y, 1) + 6, h.z - jz * 6);
        this.wantLook.set(h.x + jx * 0.5, Math.max(0, h.y - 3.5), h.z + jz * 0.5);
      } else {
        this.wantPos.set(spots.crane.x - jx * 0.8, spots.crane.cabHeight - 0.4, spots.crane.z - jz * 0.8);
        this.wantLook.set(h.x, Math.max(0, h.y - 1.5), h.z);
      }
    } else {
      // mixer: from the operator's side, framing the hopper (back) and the chute (front)
      const lx = dcos(p.yaw);
      const lz = -dsin(p.yaw);
      this.wantPos.set(p.x + lx * 4.2 - dsin(p.yaw) * 0.6, 3.2, p.z + lz * 4.2 - dcos(p.yaw) * 0.6);
      this.wantLook.set(p.x, 0.9, p.z);
    }
    const k = this.snapped ? 1 - Math.exp(-dt * 8) : 1;
    this.snapped = true;
    this.pos.lerp(this.wantPos, k);
    this.look.lerp(this.wantLook, k);
    if (k === 1) {
      this.pos.copy(this.wantPos);
      this.look.copy(this.wantLook);
    }
    camera.position.copy(this.pos);
    camera.lookAt(this.look);
  }
}
