import * as THREE from 'three';
import {
  CLOCK_TOWER,
  currentStage,
  deliver,
  initialProgress,
  isMasterpiece,
  neededPiece,
  reset as resetProgress,
  starsOf,
  type DeliverResult,
  type PieceTypeId,
  type TowerProgress,
} from '@hht/shared';
import { BUILD_ZONE_RADIUS, TOWER_HALF } from '../world/layout.ts';
import type { Piece, PieceManager } from './pieceManager.ts';

export interface PlotEvents {
  onSnap(piece: Piece | null, result: DeliverResult, progress: TowerProgress): void;
  onWrong(piece: Piece | null, needed: PieceTypeId | null): void;
  /** fired after the last piece of a stage lands */
  onStageComplete(progress: TowerProgress): void;
  onMasterpiece(progress: TowerProgress): void;
}

const FLIGHT = 0.55;

/** Build-zone detection, delivery via the shared rules, flying pieces into slot markers. */
export class TowerPlot {
  progress: TowerProgress = initialProgress(CLOCK_TOWER);
  private pendingCompletion: TowerProgress | null = null;
  private pendingTimer = 0;

  constructor(
    readonly center: THREE.Vector3,
    private readonly pieces: PieceManager,
    private readonly slotPos: (i: number) => THREE.Vector3,
    private readonly events: PlotEvents,
  ) {}

  get stars(): number {
    return starsOf(this.progress);
  }
  get masterpiece(): boolean {
    return isMasterpiece(this.progress);
  }
  get needed(): PieceTypeId | null {
    return neededPiece(this.progress);
  }
  get stage() {
    return currentStage(this.progress);
  }

  inZone(p: THREE.Vector3): boolean {
    const dx = p.x - this.center.x;
    const dz = p.z - this.center.z;
    return Math.hypot(dx, dz) <= BUILD_ZONE_RADIUS && p.y < 3.5;
  }

  /** Apply a delivery (from a real piece in the zone, or the debug API with `piece = null`). */
  deliverPiece(type: PieceTypeId, piece: Piece | null): DeliverResult {
    if (this.pendingCompletion) {
      // a stage transition is mid-flight; finish it first so slots line up
      this.finishPending();
    }
    const slotIndex = this.progress.filledSlots;
    const { progress, result } = deliver(this.progress, type);
    if (result === 'wrongPiece' || result === 'alreadyComplete') {
      if (piece) this.bounce(piece);
      this.events.onWrong(piece, this.needed);
      return result;
    }
    this.progress = progress;
    if (piece) {
      this.pieces.detach(piece);
      piece.state = 'flying';
      piece.slotIndex = slotIndex;
      const to = this.slotPos(slotIndex);
      to.y += 0.25;
      piece.flight = { from: piece.position.clone(), to, t: 0, dur: FLIGHT, spin: (Math.random() - 0.5) * 6 };
    }
    this.events.onSnap(piece, result, progress);
    if (result === 'stageComplete' || result === 'masterpiece') {
      this.pendingCompletion = progress;
      this.pendingTimer = piece ? FLIGHT + 0.15 : 0;
      if (!piece) this.finishPending();
    }
    return result;
  }

  private finishPending(): void {
    const p = this.pendingCompletion;
    if (!p) return;
    this.pendingCompletion = null;
    // the delivery pile merges into the new stage model
    this.pieces.removeWhere((x) => x.state === 'snapped' || x.state === 'flying');
    if (isMasterpiece(p)) this.events.onMasterpiece(p);
    else this.events.onStageComplete(p);
  }

  private bounce(piece: Piece): void {
    piece.rejected = true;
    if (piece.body) {
      const dx = piece.position.x - this.center.x;
      const dz = piece.position.z - this.center.z;
      const l = Math.hypot(dx, dz) || 1;
      piece.body.setLinvel({ x: (dx / l) * 4.5, y: 4, z: (dz / l) * 4.5 }, true);
    }
  }

  update(dt: number): void {
    for (const piece of this.pieces.pieces.values()) {
      if (piece.state === 'loose') {
        const inside = this.inZone(piece.position);
        if (piece.rejected) {
          if (!inside) piece.rejected = false;
          continue;
        }
        if (inside && piece.fade === 0) this.deliverPiece(piece.type, piece);
      } else if (piece.state === 'flying' && piece.flight) {
        const f = piece.flight;
        f.t += dt;
        const k = Math.min(1, f.t / f.dur);
        const e = k * k * (3 - 2 * k);
        piece.position.lerpVectors(f.from, f.to, e);
        piece.position.y += Math.sin(Math.PI * k) * 1.6;
        piece.quaternion.setFromEuler(new THREE.Euler(0, f.spin * k, 0));
        if (k >= 1) {
          piece.state = 'snapped';
          piece.flight = null;
          piece.position.copy(f.to);
        }
      }
    }
    if (this.pendingCompletion) {
      this.pendingTimer -= dt;
      if (this.pendingTimer <= 0) this.finishPending();
    }
  }

  /** debug: fill the remaining slots of the current stage */
  completeStage(): DeliverResult | null {
    const need = this.needed;
    if (!need) return null;
    let r: DeliverResult = 'snapped';
    const start = this.progress.completedStages;
    while (this.progress.completedStages === start && !this.masterpiece) r = this.deliverPiece(need, null);
    return r;
  }

  reset(): void {
    this.pendingCompletion = null;
    this.progress = resetProgress(this.progress);
    this.pieces.removeWhere(() => true);
  }

  /** Tower collision footprint for the camera and character. */
  footprint(): THREE.Box3 {
    const h = this.progress.completedStages === 0 ? 0.2 : 9.5;
    return new THREE.Box3(
      new THREE.Vector3(this.center.x - TOWER_HALF, 0, this.center.z - TOWER_HALF),
      new THREE.Vector3(this.center.x + TOWER_HALF, h, this.center.z + TOWER_HALF),
    );
  }
}
