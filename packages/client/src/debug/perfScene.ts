import * as THREE from 'three';
import type { Game } from '../game/Game.ts';

/**
 * `?perf=1` reference scene: tower at Masterpiece, celebration looping, fixed hero camera.
 * Waits for all stage models so the worst case is measured.
 */
export function setupPerfScene(game: Game): void {
  const go = (): void => {
    let guard = 10;
    while (!game.plot.masterpiece && guard-- > 0) game.plot.completeStage();
    game.frozen = true;
    game.camera.frozen = true;
    const c = game.layout.plot;
    game.ctx.camera.position.set(c.x + 9, 7.5, c.z + 13);
    game.ctx.camera.lookAt(new THREE.Vector3(c.x, 4.2, c.z));
    const loop = (): void => {
      if (!game.celebration.playing) game.celebration.start(c, 30);
      window.setTimeout(loop, 1000);
    };
    loop();
    (window as unknown as { __hhtPerfReady?: boolean }).__hhtPerfReady = true;
  };
  const waitFor = ['clock-tower-stage-6', 'fx'];
  const missing = (): string[] => waitFor.filter((id) => !game.assets.get(id));
  if (missing().length === 0) go();
  else {
    const off = game.assets.onLoaded(() => {
      if (missing().length === 0) {
        off();
        go();
      }
    });
  }
}
