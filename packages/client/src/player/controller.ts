import * as THREE from 'three';
import { MOVE } from '@hht/shared';
import { RAPIER, type Physics } from '../physics/physics.ts';

const RADIUS = 0.32;
const HALF_HEIGHT = 0.32;

/** Kinematic character controller (Rapier) for the worker. Position = feet. */
export class CharacterController {
  readonly position = new THREE.Vector3();
  readonly prevPosition = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  facing = 0;
  grounded = false;
  justJumped = false;
  private readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly kcc: RAPIER.KinematicCharacterController;
  private readonly jumpSpeed = Math.sqrt(2 * MOVE.gravity * MOVE.jumpApex);
  private coyote = 0;
  private jumpBuffer = 0;

  constructor(private readonly physics: Physics, spawn: THREE.Vector3) {
    const w = physics.world;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + RADIUS + HALF_HEIGHT, spawn.z));
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS), this.body);
    this.kcc = w.createCharacterController(0.02);
    this.kcc.enableAutostep(0.35, 0.2, true);
    this.kcc.enableSnapToGround(0.3);
    this.kcc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.position.copy(spawn);
    this.prevPosition.copy(spawn);
  }

  teleport(p: THREE.Vector3, facing = this.facing): void {
    this.body.setTranslation({ x: p.x, y: p.y + RADIUS + HALF_HEIGHT, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + RADIUS + HALF_HEIGHT, z: p.z });
    this.position.copy(p);
    this.prevPosition.copy(p);
    this.velocity.set(0, 0, 0);
    this.facing = facing;
  }

  requestJump(): void {
    this.jumpBuffer = 0.15;
  }

  /** One fixed step. `wish` is the desired horizontal velocity in world space (m/s). */
  step(h: number, wish: THREE.Vector3): void {
    this.prevPosition.copy(this.position);
    this.justJumped = false;
    const accel = this.grounded ? 40 : 12;
    this.velocity.x += THREE.MathUtils.clamp(wish.x - this.velocity.x, -accel * h, accel * h);
    this.velocity.z += THREE.MathUtils.clamp(wish.z - this.velocity.z, -accel * h, accel * h);
    this.coyote = this.grounded ? 0.1 : Math.max(0, this.coyote - h);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - h);
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.velocity.y = this.jumpSpeed;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.justJumped = true;
    } else if (this.grounded && this.velocity.y < 0) {
      this.velocity.y = -1;
    }
    this.velocity.y -= MOVE.gravity * h;
    const desired = { x: this.velocity.x * h, y: this.velocity.y * h, z: this.velocity.z * h };
    this.kcc.computeColliderMovement(this.collider, desired);
    const m = this.kcc.computedMovement();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    const wasGrounded = this.grounded;
    this.grounded = this.kcc.computedGrounded();
    if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;
    if (!wasGrounded && this.grounded) this.velocity.y = 0;
    // head bump
    if (this.velocity.y > 0 && m.y < desired.y * 0.5) this.velocity.y = 0;
    this.position.set(t.x + m.x, t.y + m.y - RADIUS - HALF_HEIGHT, t.z + m.z);
    const hs = Math.hypot(wish.x, wish.z);
    if (hs > 0.1) {
      const target = Math.atan2(wish.x, wish.z);
      let d = target - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, h * 14);
    }
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }
}
