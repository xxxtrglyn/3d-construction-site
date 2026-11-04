import { createHash } from 'node:crypto';
import { Room, ServerError, type Client } from '@colyseus/core';
import {
  CLOSE, NET, PLOTS, PROTOCOL_VERSION, SITE, initialWorker, uniqueName, validateJoinOptions, validateMessage,
  type ClientMessageType, type ClientMessages, type JoinOptions, type ObstacleBox, type RateClass, type ServerEventType, type ServerEvents,
} from '@hht/shared';
import { getContext, type ServerContext } from '../context.ts';
import type { WorldMetrics } from '../metrics.ts';
import { guard, newBuckets, strike, type LimitsIo } from '../systems/limits.ts';
import { queueInputs, simulate, teleport } from '../systems/movement.ts';
import { sendSnapshots } from '../systems/snapshots.ts';
import type { Session } from '../world/types.ts';
import { PlayerState, PlotState, ShiftState, WorldState } from './schema.ts';
import { WorldSystems } from '../world/systems.ts';

export interface WorldCreateOptions {
  worldId: number;
  secret: string;
}

interface AuthResult {
  keyHash: string;
  opts: JoinOptions;
}

/** Rate class per client message type. */
const RATE_OF: { [K in ClientMessageType]: RateClass | ((m: ClientMessages[K]) => RateClass) } = {
  grab: 'action',
  drop: 'action',
  toss: 'action',
  emote: 'emote',
  say: 'emote',
  foreman: 'admin',
  crew: (m) => (m.op === 'request' ? 'request' : 'admin'),
  hide: 'admin',
  shuffleName: 'name',
  ping: 'ping',
  respawn: 'respawn',
  chat: 'chat',
  report: 'report',
  dev: 'admin',
};

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/**
 * One authoritative world of ≤ 100 players (constitution II). The room is glue: it owns sessions,
 * routes validated intents to the systems in `world/systems.ts`, ticks at 20 Hz and sends snapshots.
 */
export class WorldRoom extends Room<{ state: WorldState }> {
  ctx!: ServerContext;
  worldId = 0;
  readonly sessions = new Map<string, Session>();
  /** Colyseus client.sessionId → pid */
  readonly byClient = new Map<string, string>();
  nextNetId = 1;
  tickNo = 0;
  /** seats promised by the matchmaker but not yet joined */
  pendingSeats = 0;
  blockers: ObstacleBox[] = [];
  metricsRef!: WorldMetrics;
  emptySince = 0;
  systems!: WorldSystems;
  /** dev cheat: shifts server time forward (ms) */
  timeOffset = 0;
  private secondAcc = 0;
  private bytesAcc = 0;
  private ticksThisSecond = 0;

  readonly io: LimitsIo = {
    slowDown: (s) => this.sendTo(s, 'slowDown', {}),
    kick: (s, code) => this.kick(s, code),
  };

  now(): number {
    return Date.now() + this.timeOffset;
  }

  override onCreate(options: WorldCreateOptions): void {
    this.ctx = getContext();
    if (!options || options.secret !== this.ctx.cfg.internalSecret || !Number.isInteger(options.worldId) || options.worldId < 1) {
      throw new ServerError(403, 'worlds are created by the matchmaker only');
    }
    this.worldId = options.worldId;
    this.maxClients = this.ctx.cfg.maxPlayers + 8; // our own cap lives in canAdmit(); slack allows resumes
    this.autoDispose = false;
    this.patchRate = NET.patchMs;
    this.seatReservationTimeout = 15;
    const state = new WorldState();
    state.worldId = this.worldId;
    state.shift = new ShiftState();
    for (let i = 0; i < PLOTS.count; i++) state.plots.push(new PlotState());
    this.setState(state);
    this.metricsRef = this.ctx.metrics.world(this.worldId, () => this.sessions.size);
    this.systems = new WorldSystems(this);
    this.systems.init();
    this.ctx.worlds.set(this.worldId, this);
    this.emptySince = this.now();
    this.setSimulationInterval(() => this.tick(), NET.tickMs);
    this.onMessage('*', (client, type, payload) => this.route(client, String(type), payload));
    this.onMessageBytes('in', (client, bytes: Uint8Array) => {
      const s = this.sessionOf(client);
      if (s) queueInputs(this.io, s, bytes, this.now());
    });
  }

  override onAuth(_client: Client, options: Record<string, unknown>): AuthResult {
    if (!options || options._mm !== this.ctx.cfg.internalSecret) throw new ServerError(403, 'join through /api/matchmake');
    if (options.protocol !== PROTOCOL_VERSION) throw new ServerError(CLOSE.protocol, 'protocol mismatch');
    const opts = validateJoinOptions(options);
    if (!opts) throw new ServerError(400, 'invalid join options');
    return { keyHash: sha256(opts.playerKey), opts };
  }

  /** Matchmaker admission: resume an away session of this key, take a fresh seat, or refuse. */
  canAdmit(keyHash: string): 'resume' | 'seat' | 'full' {
    if (this.findAway(keyHash) || this.systems.isRestoredMember(keyHash)) return 'resume';
    return this.sessions.size + this.pendingSeats < this.ctx.cfg.maxPlayers ? 'seat' : 'full';
  }

  findAway(keyHash: string): Session | undefined {
    for (const s of this.sessions.values()) if (s.keyHash === keyHash && s.state === 'away' && !s.duplicate) return s;
    return undefined;
  }

  override onJoin(client: Client, _options: unknown, auth: AuthResult): void {
    if (this.pendingSeats > 0) this.pendingSeats--;
    const now = this.now();
    const away = this.findAway(auth.keyHash);
    if (away) {
      // page reload / rejoin within the grace period: take over the old identity
      const old = away.reconnect;
      away.reconnect = null;
      if (away.client) this.byClient.delete(away.client.sessionId);
      away.client = client;
      away.state = 'active';
      away.lastActiveAt = now;
      this.byClient.set(client.sessionId, away.pid);
      const ps = this.state.players.get(away.pid);
      if (ps) ps.away = false;
      old?.reject(new Error('resumed by a new connection'));
      this.welcome(away, true);
      this.systems.onResume(away);
      return;
    }
    const taken = new Set([...this.sessions.values()].map((s) => s.name));
    const duplicate = [...this.sessions.values()].some((s) => s.keyHash === auth.keyHash);
    const s: Session = {
      pid: client.sessionId,
      netId: this.nextNetId++,
      keyHash: auth.keyHash,
      name: uniqueName(auth.opts.name, taken),
      hatColor: auth.opts.hatColor,
      client,
      state: 'active',
      reconnect: null,
      awaySince: 0,
      duplicate,
      worker: initialWorker(SITE.spawn),
      inputs: [],
      lastSeq: 0,
      hasSeq: false,
      heldPieceId: null,
      crewPlot: -1,
      crewRole: '',
      delivered: 0,
      donated: 0,
      joinedAt: now,
      lastActiveAt: now,
      buckets: newBuckets(now),
      strikes: { times: [] },
      lastSlowDownAt: 0,
      tiers: new Map(),
      hidden: new Set(),
      emoteUntil: 0,
      bytesSent: 0,
      slowSince: 0,
      recentChat: [],
      lastChatNorm: new Map(),
      reportedThisShift: new Set(),
    };
    if (this.nextNetId > 0xffff) this.nextNetId = 1;
    this.sessions.set(s.pid, s);
    this.byClient.set(client.sessionId, s.pid);
    const ps = new PlayerState();
    ps.netId = s.netId;
    ps.name = s.name;
    ps.hatColor = s.hatColor;
    this.state.players.set(s.pid, ps);
    this.welcome(s, false);
    this.systems.onJoin(s);
  }

  private welcome(s: Session, resumed: boolean): void {
    this.sendTo(s, 'welcome', { sessionId: s.pid, netId: s.netId, worldId: this.worldId, serverNow: this.now(), tick: this.tickNo, name: s.name, resumed });
  }

  override async onDrop(client: Client): Promise<void> {
    const s = this.sessionOf(client);
    if (!s || this.ctx.shuttingDown) return;
    s.state = 'away';
    s.awaySince = this.now();
    s.inputs.length = 0;
    const ps = this.state.players.get(s.pid);
    if (ps) ps.away = true;
    this.systems.onAway(s);
    const deferred = this.allowReconnection(client, this.ctx.cfg.timers.reconnectGraceS);
    s.reconnect = deferred;
    try {
      await deferred;
    } catch {
      /* timed out or resumed by a new connection: onLeave decides */
    }
  }

  override onReconnect(client: Client): void {
    const s = this.sessionOf(client);
    if (!s) return;
    s.reconnect = null;
    s.client = client;
    s.state = 'active';
    s.lastActiveAt = this.now();
    const ps = this.state.players.get(s.pid);
    if (ps) ps.away = false;
    this.systems.onResume(s);
  }

  override onLeave(client: Client): void {
    const pid = this.byClient.get(client.sessionId);
    this.byClient.delete(client.sessionId);
    if (!pid) return;
    const s = this.sessions.get(pid);
    if (!s || s.client !== client) return; // taken over by a newer connection
    this.removeSession(s);
  }

  removeSession(s: Session): void {
    if (!this.ctx.shuttingDown) this.systems.onRemove(s);
    this.sessions.delete(s.pid);
    this.state.players.delete(s.pid);
    for (const other of this.sessions.values()) other.tiers.delete(s.netId);
    if (this.sessions.size === 0) this.emptySince = this.now();
  }

  override onDispose(): void {
    this.systems.dispose();
    if (this.ctx.worlds.get(this.worldId) === this) this.ctx.worlds.delete(this.worldId);
    this.ctx.metrics.dropWorld(this.worldId);
  }

  // ------------------------------------------------------------------ messaging

  sessionOf(client: Client): Session | undefined {
    const pid = this.byClient.get(client.sessionId);
    return pid ? this.sessions.get(pid) : undefined;
  }

  sendTo<K extends ServerEventType>(s: Session, type: K, payload: ServerEvents[K]): void {
    if (s.client && s.state === 'active') s.client.send(type, payload);
  }

  broadcastEvent<K extends ServerEventType>(type: K, payload: ServerEvents[K]): void {
    for (const s of this.sessions.values()) this.sendTo(s, type, payload);
  }

  kick(s: Session, code: number): void {
    if (s.client) s.client.leave(code);
    else this.removeSession(s);
  }

  private route(client: Client, type: string, payload: unknown): void {
    const s = this.sessionOf(client);
    if (!s || s.state !== 'active') return;
    const now = this.now();
    if (!(type in RATE_OF)) {
      strike(this.io, s, now);
      return;
    }
    const t = type as ClientMessageType;
    const msg = validateMessage(t, payload);
    if (!msg) {
      strike(this.io, s, now);
      return;
    }
    const rate = RATE_OF[t];
    const cls = typeof rate === 'function' ? (rate as (m: unknown) => RateClass)(msg) : rate;
    if (!guard(this.io, s, cls, now)) return;
    if (t !== 'ping') s.lastActiveAt = now;
    switch (t) {
      case 'ping':
        this.sendTo(s, 'pong', { c: (msg as ClientMessages['ping']).c, s: now });
        return;
      case 'respawn':
        this.respawn(s, 'respawn');
        return;
      case 'shuffleName': {
        const taken = new Set([...this.sessions.values()].filter((o) => o !== s).map((o) => o.name));
        s.name = uniqueName((msg as ClientMessages['shuffleName']).name, taken);
        const ps = this.state.players.get(s.pid);
        if (ps) ps.name = s.name;
        this.systems.onRename(s);
        return;
      }
      default:
        this.systems.handle(s, t, msg as ClientMessages[typeof t], now);
    }
  }

  respawn(s: Session, reason: 'respawn' | 'outOfBounds'): void {
    teleport(s, SITE.spawn.x, SITE.spawn.y, SITE.spawn.z);
    this.sendTo(s, 'correction', { reason });
  }

  // ------------------------------------------------------------------ simulation

  private tick(): void {
    const t0 = performance.now();
    const now = this.now();
    this.tickNo++;
    for (const s of this.sessions.values()) {
      if (s.state !== 'active') continue;
      simulate(s, this.blockers);
      if (s.worker.y < -5) this.respawn(s, 'outOfBounds');
    }
    this.systems.tick(now);
    this.secondAcc += NET.tickMs;
    if (this.secondAcc >= 1000) {
      this.secondAcc -= 1000;
      this.everySecond(now);
    }
    const e0 = performance.now();
    this.bytesAcc += sendSnapshots(
      { send: (s, data) => this.sendSnapshot(s, data, now) },
      this.sessions.values(),
      this.tickNo,
      now,
    );
    this.metricsRef.encodeMs.push(performance.now() - e0);
    if (this.ctx.cfg.injectTickMs > 0) {
      const until = performance.now() + this.ctx.cfg.injectTickMs;
      while (performance.now() < until) { /* load-test self-test: burn CPU */ }
    }
    this.metricsRef.sqliteMs.push(this.ctx.db.takeTimeMs());
    this.metricsRef.tickMs.push(performance.now() - t0);
    this.ticksThisSecond++;
  }

  /** Backpressure (research R11): skip snapshots while > 256 KB is queued; drop clients stuck > 1 MB for 10 s. */
  private sendSnapshot(s: Session, data: Uint8Array, now: number): void {
    const c = s.client;
    if (!c) return;
    const queued = (c as unknown as { ref?: { bufferedAmount?: number } }).ref?.bufferedAmount ?? 0;
    if (queued > 1_048_576) {
      if (!s.slowSince) s.slowSince = now;
      else if (now - s.slowSince > 10_000) this.kick(s, CLOSE.strikes);
      return;
    }
    s.slowSince = 0;
    if (queued > 262_144 && this.tickNo % 5 !== 0) return;
    c.sendBytes('ws', data);
    s.bytesSent += data.byteLength;
  }

  private everySecond(now: number): void {
    const active = [...this.sessions.values()].filter((s) => s.state === 'active').length;
    this.metricsRef.bytesPerClientPerS.push(active ? this.bytesAcc / active : 0);
    this.metricsRef.ticks.push(this.ticksThisSecond);
    this.bytesAcc = 0;
    this.ticksThisSecond = 0;
    const idleMs = this.ctx.cfg.timers.idleKickS * 1000;
    for (const s of [...this.sessions.values()]) {
      if (s.state === 'active' && now - s.lastActiveAt > idleMs) this.kick(s, CLOSE.idle);
    }
    this.systems.second(now);
    // overflow worlds close after 5 minutes empty (world 1 always stays)
    if (this.worldId > 1 && this.sessions.size === 0 && this.pendingSeats === 0 && now - this.emptySince > this.ctx.cfg.timers.overflowDisposeS * 1000) {
      this.systems.onWorldClosing();
      void this.disconnect(CLOSE.worldClosing);
    }
  }
}
