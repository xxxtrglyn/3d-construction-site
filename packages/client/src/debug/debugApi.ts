import * as THREE from 'three';
import { PIECE_TYPE_IDS, type DeliverResult, type PieceTypeId } from '@hht/shared';
import type { Game, GameEvent } from '../game/Game.ts';
import { QUALITY } from '../render/quality.ts';
import { setupPerfScene } from './perfScene.ts';
import { applyShot } from './shots.ts';

/** window.__hht — contracts/debug-api.md */
export interface HhtDebugApi {
  ready: Promise<void>;
  state(): {
    worker: { position: [number, number, number]; grounded: boolean; holding: PieceTypeId | null };
    tower: { completedStages: number; filledSlots: number; stars: number; isMasterpiece: boolean };
    loosePieces: number;
    profile: { name: string; hatColor: string; muted: boolean };
  };
  render(): { drawCalls: number; triangles: number; textures: number; geometries: number; frameMsMedian: number };
  debug: {
    give(type: PieceTypeId): void;
    teleport(x: number, y: number, z: number): void;
    deliver(type: PieceTypeId): DeliverResult;
    completeStage(): void;
    completeAll(): void;
    reset(): void;
    setQuality(tier: 'high' | 'low'): void;
  };
  events: EventTarget;
}

const EVENTS: GameEvent[] = ['snapped', 'stageComplete', 'masterpiece', 'wrongPiece', 'pickup', 'drop', 'toss'];

export function installDebugApi(game: Game, ready: Promise<void>, params: URLSearchParams): HhtDebugApi {
  const assertType = (t: PieceTypeId): void => {
    if (!PIECE_TYPE_IDS.includes(t)) throw new Error(`unknown piece type ${t}`);
  };
  const api: HhtDebugApi = {
    ready,
    state: () => {
      const p = game.controller.position;
      const prof = game.profile.get();
      return {
        worker: { position: [p.x, p.y, p.z], grounded: game.controller.grounded, holding: game.pieces.held()?.type ?? null },
        tower: {
          completedStages: game.plot.progress.completedStages,
          filledSlots: game.plot.progress.filledSlots,
          stars: game.plot.stars,
          isMasterpiece: game.plot.masterpiece,
        },
        loosePieces: game.pieces.loose().length,
        profile: { name: prof.name, hatColor: prof.hatColor, muted: prof.muted },
      };
    },
    render: () => {
      const i = game.ctx.renderer.info;
      return {
        drawCalls: i.render.calls,
        triangles: i.render.triangles,
        textures: i.memory.textures,
        geometries: i.memory.geometries,
        frameMsMedian: game.medianFrameMs(),
      };
    },
    debug: {
      give: (t) => {
        assertType(t);
        game.giveHeld(t);
      },
      teleport: (x, y, z) => game.controller.teleport(new THREE.Vector3(x, y, z)),
      deliver: (t) => {
        assertType(t);
        const held = game.pieces.held();
        if (held) game.pieces.remove(held);
        game.touch?.setHolding(false);
        return game.plot.deliverPiece(t, null);
      },
      completeStage: () => {
        game.plot.completeStage();
      },
      completeAll: () => {
        let guard = 10;
        while (!game.plot.masterpiece && guard-- > 0) game.plot.completeStage();
      },
      reset: () => game.buildAgain(),
      setQuality: (tier) => game.setQuality(QUALITY[tier]),
    },
    events: new EventTarget(),
  };
  for (const e of EVENTS) {
    game.events.addEventListener(e, (ev) => api.events.dispatchEvent(new CustomEvent(e, { detail: (ev as CustomEvent).detail })));
  }
  (window as unknown as { __hht: HhtDebugApi }).__hht = api;
  game.showFps = params.has('debug') || params.has('perf');
  if (params.has('perf')) setupPerfScene(game);
  const shot = params.get('shot');
  if (shot) applyShot(game, shot);
  return api;
}
