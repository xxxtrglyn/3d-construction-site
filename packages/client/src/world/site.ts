import * as THREE from 'three';
import { SITE, type RackDef } from '@hht/shared';

/** The multiplayer site scene (site.glb) plus rack anchors from the shared layout (site.gen.ts). */
export class SiteView {
  readonly root: THREE.Object3D;
  readonly racks: Array<{ def: RackDef; top: THREE.Vector3 }>;

  constructor(asset: THREE.Object3D) {
    this.root = asset;
    this.root.traverse((o) => {
      o.userData.castShadowHigh = o.castShadow;
    });
    this.racks = SITE.racks.map((def) => ({ def, top: new THREE.Vector3(def.x, def.top, def.z) }));
  }

  /** Low tier: scenery stops casting shadows. */
  setShadows(high: boolean): void {
    this.root.traverse((o) => {
      o.castShadow = high ? !!o.userData.castShadowHigh : false;
    });
  }
}
