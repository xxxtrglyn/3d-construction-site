import * as THREE from 'three';
import { LOOSE, PIECE_TYPES, type PieceTypeId } from '@hht/shared';
import { RAPIER, type Physics } from '../physics/physics.ts';

export type PieceState = 'held' | 'loose' | 'flying' | 'snapped';

export interface Piece {
  readonly id: number;
  readonly type: PieceTypeId;
  state: PieceState;
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  /** seconds (game clock) when last touched */
  lastTouchedAt: number;
  body: RAPIER.RigidBody | null;
  /** fade-out progress 0..1 when removing */
  fade: number;
  /** wrong piece bounced: ignore the build zone until it leaves */
  rejected: boolean;
  flight: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; spin: number } | null;
  slotIndex: number;
}

/** Physics-free bookkeeping is testable without Rapier: pass `physics = null`. */
export class PieceManager {
  readonly pieces = new Map<number, Piece>();
  private nextId = 1;
  clock = 0;

  constructor(private readonly physics: Physics | null) {}

  create(type: PieceTypeId, state: PieceState, at: THREE.Vector3): Piece {
    const p: Piece = {
      id: this.nextId++,
      type,
      state,
      position: at.clone(),
      quaternion: new THREE.Quaternion(),
      lastTouchedAt: this.clock,
      body: null,
      fade: 0,
      rejected: false,
      flight: null,
      slotIndex: -1,
    };
    this.pieces.set(p.id, p);
    return p;
  }

  held(): Piece | undefined {
    for (const p of this.pieces.values()) if (p.state === 'held') return p;
    return undefined;
  }

  loose(): Piece[] {
    return [...this.pieces.values()].filter((p) => p.state === 'loose');
  }

  /** Make a piece loose with a dynamic body and optional velocity. Enforces the 30-piece cap. */
  release(p: Piece, at: THREE.Vector3, rot: THREE.Quaternion, vel?: THREE.Vector3): void {
    p.state = 'loose';
    p.position.copy(at);
    p.quaternion.copy(rot);
    p.lastTouchedAt = this.clock;
    p.fade = 0;
    if (this.physics) {
      const def = PIECE_TYPES[p.type];
      const [sx, sy, sz] = def.collider.size;
      const bd = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(at.x, at.y, at.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
        .setLinearDamping(0.2)
        .setAngularDamping(0.8)
        .setCcdEnabled(true);
      if (vel) bd.setLinvel(vel.x, vel.y, vel.z);
      const body = this.physics.world.createRigidBody(bd);
      // Blender X/Y/Z sizes → three X/Z/Y
      const cd =
        def.collider.shape === 'box'
          ? RAPIER.ColliderDesc.cuboid(sx / 2, sz / 2, sy / 2)
          : RAPIER.ColliderDesc.cylinder(sz / 2, Math.max(sx, sy) / 2);
      cd.setMass(def.mass).setFriction(0.9).setRestitution(0.15);
      this.physics.world.createCollider(cd, body);
      p.body = body;
    }
    this.enforceCap();
  }

  /** Remove the physics body (pick-up, snapping). */
  detach(p: Piece): void {
    if (p.body && this.physics) this.physics.world.removeRigidBody(p.body);
    p.body = null;
  }

  pickUp(p: Piece): boolean {
    if (this.held()) return false;
    if (p.state !== 'loose') return false;
    this.detach(p);
    p.state = 'held';
    p.fade = 0;
    p.rejected = false;
    p.lastTouchedAt = this.clock;
    return true;
  }

  remove(p: Piece): void {
    this.detach(p);
    this.pieces.delete(p.id);
  }

  removeWhere(pred: (p: Piece) => boolean): void {
    for (const p of [...this.pieces.values()]) if (pred(p)) this.remove(p);
  }

  private enforceCap(): void {
    const loose = this.loose().filter((p) => p.fade === 0).sort((a, b) => a.lastTouchedAt - b.lastTouchedAt);
    const excess = loose.length - LOOSE.maxLoose;
    for (let i = 0; i < excess; i++) (loose[i] as Piece).fade = 0.0001;
  }

  /** Sync loose pieces from physics, fade old ones, drop fallen ones. */
  update(dt: number): void {
    this.clock += dt;
    for (const p of [...this.pieces.values()]) {
      if (p.state !== 'loose') continue;
      if (p.body) {
        const t = p.body.translation();
        const r = p.body.rotation();
        p.position.set(t.x, t.y, t.z);
        p.quaternion.set(r.x, r.y, r.z, r.w);
      }
      if (p.position.y < LOOSE.respawnBelowY) {
        this.remove(p);
        continue;
      }
      if (p.fade === 0 && this.clock - p.lastTouchedAt >= LOOSE.fadeAfterSeconds) p.fade = 0.0001;
      if (p.fade > 0) {
        p.fade += dt * 2;
        if (p.fade >= 1) this.remove(p);
      }
    }
  }
}
