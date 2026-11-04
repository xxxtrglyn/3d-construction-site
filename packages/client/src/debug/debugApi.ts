import * as THREE from 'three';
import { MACHINE_KINDS, PIECE_TYPE_IDS, type DeliverResult, type MachineKind, type PieceTypeId } from '@hht/shared';
import type { Game, GameEvent } from '../game/Game.ts';
import { QUALITY } from '../render/quality.ts';
import { setupPerfScene } from './perfScene.ts';
import { applyShot } from './shots.ts';

/** window.__hht — contracts/debug-api.md */
export interface HhtDebugApi {
  mode: 'solo';
  ready: Promise<void>;
  state(): {
    worker: { position: [number, number, number]; grounded: boolean; holding: PieceTypeId | null };
    tower: { completedStages: number; filledSlots: number; stars: number; isMasterpiece: boolean };
    loosePieces: number;
    /** feature 003 */
    plot: { groundwork: { dug: number; poured: number; done: boolean }; highFilled: number; mixerBags: number };
    profile: { name: string; hatColor: string; muted: boolean };
  };
  render(): { drawCalls: number; triangles: number; textures: number; geometries: number; frameMsMedian: number };
  // feature 003 (contracts/debug-api.md, solo)
  machines(): Array<{ id: number; kind: MachineKind; plot: number; x: number; z: number; yaw: number; p1: number; p2: number; p3: number; phase: string; operator: string; load: unknown }>;
  myMachine(): number;
  cue(): { plot: number; machine: MachineKind | null };
  snapRing(): { slot: number; high: boolean } | null;
  camera(): 'follow' | 'hook' | 'cab' | 'mixer';
  /** the solo plot's machine spots (tests) */
  machineSpots(): unknown;
  /** loose pieces (tests) */
  loosePieces(): Array<{ type: PieceTypeId; x: number; y: number; z: number; rejected: boolean; fade: number }>;
  debug: {
    give(type: PieceTypeId): void;
    teleport(x: number, y: number, z: number): void;
    deliver(type: PieceTypeId): DeliverResult;
    completeStage(): void;
    completeAll(): void;
    reset(): void;
    setQuality(tier: 'high' | 'low'): void;
    /** feature 003: finish Groundwork (the 001 specs start at stage 1) */
    completeGroundwork(): void;
    /** feature 003: get in a machine wherever the worker stands (tests) */
    enterMachine(kind: MachineKind): void;
    /** feature 003: teleport/pose a machine (tests only) */
    machinePose(kind: MachineKind, pose: { x?: number; z?: number; yaw?: number; p1?: number; p2?: number; p3?: number }): void;
  };
  events: EventTarget;
}

const EVENTS: GameEvent[] = ['snapped', 'stageComplete', 'masterpiece', 'wrongPiece', 'pickup', 'drop', 'toss'];

export function installDebugApi(game: Game, ready: Promise<void>, params: URLSearchParams): HhtDebugApi {
  const assertType = (t: PieceTypeId): void => {
    if (!PIECE_TYPE_IDS.includes(t)) throw new Error(`unknown piece type ${t}`);
  };
  const api: HhtDebugApi = {
    mode: 'solo',
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
        plot: {
          groundwork: { dug: game.plot.progress.groundDug, poured: game.plot.progress.groundPoured, done: !game.plot.inGroundwork },
          highFilled: game.plot.progress.highFilled,
          mixerBags: game.machines.mixerBags,
        },
      };
    },
    machines: () => game.machines.states.map((m, i) => ({ id: m.id, kind: m.kind, plot: 0, x: m.x, z: m.z, yaw: m.yaw, p1: m.p1, p2: m.p2, p3: m.p3, phase: m.phase, operator: game.machines.seated === i ? 'me' : '', load: m.load })),
    myMachine: () => game.machines.seated,
    cue: () => game.cue.current,
    snapRing: () => game.highSlots.litSlot,
    camera: () => (game.machineCams.active ? game.machineCams.mode : 'follow'),
    machineSpots: () => game.layout.machines,
    loosePieces: () => game.pieces.loose().map((p) => ({ type: p.type, x: p.position.x, y: p.position.y, z: p.position.z, rejected: p.rejected, fade: p.fade })),
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
      completeGroundwork: () => game.plot.completeGroundwork(),
      enterMachine: (kind) => game.enterMachine(MACHINE_KINDS.indexOf(kind)),
      machinePose: (kind, pose) => {
        const i = MACHINE_KINDS.indexOf(kind);
        const s = game.machines.states[i];
        if (s) game.machines.states[i] = { ...s, ...Object.fromEntries(Object.entries(pose).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) };
      },
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
