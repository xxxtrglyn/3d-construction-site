import { kindOfMachine, plotOfMachine, type PieceTypeId } from '@hht/shared';
import type { NetGame } from '../game/NetGame.ts';
import type { NetPlay } from '../game/NetPlay.ts';
import { QUALITY } from '../render/quality.ts';

/** window.__hht in multiplayer mode (contracts/debug-api.md, multiplayer additions). */
export function installNetDebugApi(game: NetGame, ready: Promise<void>, params: URLSearchParams): void {
  const net = {
    connected: () => game.conn.closedCode === null,
    worldId: () => game.conn.worldId,
    me: () => {
      const st = game.conn.state;
      const pl = st.players.get(game.me);
      return {
        sessionId: game.me, netId: game.myNetId, name: pl?.name ?? '',
        crew: pl && pl.crewPlot >= 0 ? { plot: pl.crewPlot, role: pl.crewRole as 'host' | 'member' } : null,
        holding: (game.predictor.state.carrying ?? null) as PieceTypeId | null,
        position: [game.predictor.state.x, game.predictor.state.y, game.predictor.state.z] as [number, number, number],
      };
    },
    players: () => {
      const out: Array<Record<string, unknown>> = [];
      game.conn.state.players.forEach((p, sessionId) => {
        out.push({ sessionId, name: p.name, hatColor: p.hatColor, crewPlot: p.crewPlot, crewRole: p.crewRole, away: p.away, drawn: sessionId !== game.me && !p.away && !game.hidden.has(sessionId) && (game.remotes.get(p.netId)?.size ?? 0) > 0, netId: p.netId });
      });
      return out;
    },
    remotePosition: (sessionId: string): [number, number, number] | null => {
      const p = game.conn.state.players.get(sessionId);
      const b = p ? game.remotes.get(p.netId) : undefined;
      if (!b) return null;
      const pose = { x: 0, y: 0, z: 0, yaw: 0, anim: 0, carry: null, emoting: false };
      return b.sample(game.conn.clock.serverNow(), pose) ? [pose.x, pose.y, pose.z] : null;
    },
    plots: () => Array.from(game.conn.state.plots, (p, index) => ({
      index, state: p.state, completedStages: p.completedStages, filledSlots: p.filledSlots, hostName: p.hostName, joinMode: p.joinMode, crewSize: p.crewSize, bin: Array.from(p.bin),
      groundDug: p.groundDug, groundPoured: p.groundPoured, highFilled: p.highFilled, mixerBags: p.mixerBags, hookType: p.hookType, palletTypes: Array.from(p.palletTypes),
      machineOps: Array.from(p.machineOps),
    })),
    // feature 003 (contracts/debug-api.md)
    machines: () => game.machinePoses.map((m) => {
      const pv = game.conn.state.plots[plotOfMachine(m.id)];
      const op = pv ? (Array.from(pv.machineOps)[m.id % 4] ?? '') : '';
      const load = m.id === game.seatedId && game.machinePred ? game.machinePred.state.load : null;
      return { id: m.id, kind: kindOfMachine(m.id), plot: plotOfMachine(m.id), x: m.x, z: m.z, yaw: m.yaw, p1: m.p1, p2: m.p2, p3: m.p3, phase: m.phase, operator: op, load: load ?? { code: m.loadCode } };
    }),
    myMachine: () => game.seatedId,
    cue: () => (game as unknown as NetPlay).world?.cue.current ?? { plot: -1, machine: null },
    snapRing: () => (game as unknown as NetPlay).world?.highSlots.litSlot ?? null,
    camera: () => (game.machineCams.active ? game.machineCams.mode : 'follow'),
    machineLabel: () => (game as unknown as NetPlay).machineLabel?.() ?? null,
    machineModels: () => ({ crane: game.machines.hasModel('crane'), excavator: game.machines.hasModel('excavator'), forklift: game.machines.hasModel('forklift'), mixer: game.machines.hasModel('mixer') }),
    audio: () => ({ samples: game.sfx.hasSample('engine-diesel'), music: game.sfx.musicPlaying }),
    shift: () => {
      const s = game.conn.state.shift;
      return { epoch: s.epoch, endsAt: s.endsAt, phase: s.phase, msLeft: s.endsAt - game.conn.clock.serverNow() };
    },
    chatLog: () => (game as unknown as { chatLog?: () => unknown[] }).chatLog?.() ?? [],
    stats: () => ({
      rttMs: game.conn.clock.rtt, clockOffsetMs: game.conn.clock.offset, bytesIn: game.conn.bytesIn, snapshots: game.conn.snapshots,
      corrections: game.predictor.corrections,
      missingAcks: game.predictor.missingAcks,
    }),
    events: game.conn.events,
    send: (type: string, payload: unknown) => game.conn.room.send(type, payload),
    dev: {
      give: (type: PieceTypeId) => game.conn.room.send('dev', { op: 'give', type }),
      teleport: (x: number, y: number, z: number) => game.conn.room.send('dev', { op: 'teleport', x, y, z }),
      fillStage: (plot: number) => game.conn.room.send('dev', { op: 'fillStage', plot }),
      endShiftIn: (seconds: number) => game.conn.room.send('dev', { op: 'endShiftIn', seconds }),
      unlockChat: () => game.conn.room.send('dev', { op: 'unlockChat' }),
      spawnBots: (n: number) => game.conn.room.send('dev', { op: 'spawnBots', n }),
      fillGround: (plot: number) => game.conn.room.send('dev', { op: 'fillGround', plot }),
      machinePose: (id: number, pose: { x?: number; z?: number; yaw?: number; p1?: number; p2?: number; p3?: number }) => game.conn.room.send('dev', { op: 'machinePose', id, pose }),
    },
  };
  const api = {
    mode: 'net' as const,
    ready,
    net,
    game,
    render: () => {
      const i = game.ctx.renderer.info;
      return { drawCalls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures, geometries: i.memory.geometries, frameMsMedian: game.medianFrameMs() };
    },
    debug: {
      setQuality: (tier: 'high' | 'low') => console.warn('[debug] setQuality is solo-only; reload with ?q=', tier, QUALITY[tier].tier),
    },
  };
  (window as unknown as { __hht: typeof api }).__hht = api;
  if (params.has('debug')) game.showFps = true;
}
