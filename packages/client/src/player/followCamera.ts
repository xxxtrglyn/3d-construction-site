import * as THREE from 'three';

/** Third-person orbit camera behind/above the worker that avoids the ground and the tower. */
export class FollowCamera {
  yaw = 0;
  pitch = 0.42;
  distance = 8.5;
  private readonly target = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly ray = new THREE.Ray();
  private readonly hit = new THREE.Vector3();
  private initialized = false;
  /** obstacle boxes the camera must not pass through (e.g. the tower) */
  obstacles: THREE.Box3[] = [];
  /** set by debug shots to freeze the camera */
  frozen = false;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  orbit(dx: number, dy: number): void {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy, 0.08, 1.25);
  }

  zoom(dir: number): void {
    this.distance = THREE.MathUtils.clamp(this.distance + dir * 0.8, 4.5, 14);
  }

  /** Camera-relative forward and right on the ground plane. */
  basis(forward: THREE.Vector3, right: THREE.Vector3): void {
    forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    right.set(-forward.z, 0, forward.x);
  }

  update(dt: number, focus: THREE.Vector3): void {
    if (this.frozen) return;
    const goal = this.desired.set(focus.x, focus.y + 1.2, focus.z);
    if (!this.initialized) {
      this.target.copy(goal);
      this.initialized = true;
    }
    this.target.lerp(goal, 1 - Math.exp(-dt * 10));
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    let dist = this.distance;
    this.ray.set(this.target, offset);
    for (const b of this.obstacles) {
      if (b.containsPoint(this.target)) continue;
      const p = this.ray.intersectBox(b, this.hit);
      if (p) dist = Math.min(dist, Math.max(1.5, p.distanceTo(this.target) - 0.4));
    }
    const pos = offset.multiplyScalar(dist).add(this.target);
    pos.y = Math.max(pos.y, 0.6);
    this.camera.position.lerp(pos, 1 - Math.exp(-dt * 12));
    this.camera.lookAt(this.target);
  }

  snap(focus: THREE.Vector3): void {
    this.initialized = false;
    this.update(1, focus);
    const offset = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    this.camera.position.copy(offset.multiplyScalar(this.distance).add(this.target));
    this.camera.lookAt(this.target);
  }
}
