import * as THREE from 'three';
import type { AssetStore } from '../assets/loader.ts';
import { makeGhost } from '../render/ghost.ts';
import { StarSign } from './starSign.ts';

const stageId = (n: number): string => `clock-tower-stage-${n}`;

/**
 * Shows the completed tower model for the current progress, the translucent ghost of the next stage,
 * and the star sign. Missing (still streaming) stage models are swapped in when they arrive.
 */
export class TowerView {
  readonly group = new THREE.Group();
  readonly sign = new StarSign();
  private shown = -1;
  private wanted = 0;
  private model: THREE.Object3D | null = null;
  private ghost: THREE.Object3D | null = null;
  private ghostFor = -1;
  private ghostVisible = true;
  private readonly unsub: () => void;
  /** world position of the sign stars anchor */
  readonly signAnchor = new THREE.Vector3();

  constructor(private readonly assets: AssetStore, readonly center: THREE.Vector3) {
    this.group.name = 'Tower';
    this.group.position.copy(center);
    this.group.add(this.sign.group);
    this.unsub = assets.onLoaded((id) => {
      if (id === stageId(this.wanted) || id === stageId(this.wanted + 1)) this.refresh();
    });
  }

  /** Show the tower with `completedStages` complete (0..6). Returns false if that model is still loading. */
  show(completedStages: number): boolean {
    this.wanted = completedStages;
    this.refresh();
    return this.shown === completedStages;
  }

  setGhostVisible(v: boolean): void {
    this.ghostVisible = v;
    if (this.ghost) this.ghost.visible = v;
  }

  private refresh(): void {
    const target = this.assets.get(stageId(this.wanted));
    if (target && this.shown !== this.wanted) {
      if (this.model) this.group.remove(this.model);
      this.model = target;
      this.model.position.set(0, 0, 0);
      this.group.add(this.model);
      this.shown = this.wanted;
      const anchor = this.model.getObjectByName('Sign_Stars');
      if (anchor) {
        this.group.updateMatrixWorld(true);
        anchor.getWorldPosition(this.signAnchor);
        const local = this.group.worldToLocal(this.signAnchor.clone());
        this.sign.placeAt(local.add(new THREE.Vector3(0, 0, 0.012)), 0);
      }
    }
    const next = this.wanted + 1;
    if (this.ghostFor !== next) {
      const src = next <= 6 ? this.assets.get(stageId(next)) : undefined;
      if (this.ghost) {
        this.group.remove(this.ghost);
        this.ghost = null;
      }
      if (src) {
        this.ghost = makeGhost(src);
        this.ghost.visible = this.ghostVisible;
        this.group.add(this.ghost);
        this.ghostFor = next;
      } else if (next > 6) {
        this.ghostFor = next;
      }
    }
  }

  /** Approximate tower height for camera/collider logic. */
  height(): number {
    return this.wanted <= 0 ? 0.2 : this.wanted === 1 ? 6.0 : 9.8;
  }

  dispose(): void {
    this.unsub();
  }
}
