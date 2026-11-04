import * as THREE from 'three';
import type { Game } from '../game/Game.ts';

/** Camera presets for side-by-side comparison with the approved reference renders (SC-007). */
export function applyShot(game: Game, shot: string): void {
  const c = game.layout.plot;
  const cam = game.ctx.camera;
  const freeze = (pos: THREE.Vector3, look: THREE.Vector3): void => {
    game.camera.frozen = true;
    cam.position.copy(pos);
    cam.lookAt(look);
  };
  if (shot === 'closeup') {
    const p = game.controller.position;
    game.controller.facing = 0.6;
    freeze(new THREE.Vector3(p.x + 2.2, p.y + 1.6, p.z + 3.4), new THREE.Vector3(p.x, p.y + 0.95, p.z));
  } else if (shot === 'stages' || shot === 'masterpiece') {
    const waitFor = 'clock-tower-stage-6';
    const go = (): void => {
      let guard = 10;
      while (!game.plot.masterpiece && guard-- > 0) game.plot.completeStage();
      freeze(new THREE.Vector3(c.x + 4, 7, c.z + 16), new THREE.Vector3(c.x, 4.5, c.z));
    };
    if (game.assets.get(waitFor)) go();
    else {
      const off = game.assets.onLoaded((id) => {
        if (id === waitFor) {
          off();
          go();
        }
      });
    }
  } else if (shot === 'overview') {
    freeze(new THREE.Vector3(14, 16, 18), new THREE.Vector3(0, 0, -1));
  }
}
