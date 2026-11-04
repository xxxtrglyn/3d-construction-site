import {
  CHAT, CLOCK_TOWER, INTERACT, NET, PIECE_TYPE_IDS, SITE, SOCIAL,
  addToBin, arcPosition, assignPlot, becomesUnattended, canBin, currentStage, deliver, detectContact, dropPoint,
  hostOf, initialProgress, inPlaza, isMasterpiece, maskBlocked, neededPiece, nextHost, normalizeForMatch, plotAtBin, plotAtZone,
  removeMember, requestJoin, sanitize, setHost, shiftPhase, shouldHandOver, takeFromBin, tossArc, towerBlocker,
  type Arc, type BinEntry, type ClientMessageType, type ClientMessages, type CrewMember, type CrewRecord, type JoinMode,
  type MemberStatus, type PieceTypeId, type PlotStateName, type ShiftPhase, type TowerProgress,
} from '@hht/shared';
import { WorldRepo, type BuildingRow } from '../persistence/repo.ts';
import type { WorldRoom } from '../rooms/WorldRoom.ts';
import { PieceState } from '../rooms/schema.ts';
import { blocklistFor, type Blocklist } from '../systems/blocklist.ts';
import { strike } from '../systems/limits.ts';
import { teleport } from '../systems/movement.ts';
import type { Session } from './types.ts';

/** A tower being built on a plot (data-model.md → Building). */
export interface Building {
  plot: number;
  state: Exclude<PlotStateName, 'free'>;
  blueprintId: string;
  progress: TowerProgress;
  hostName: string;
  crew: CrewRecord;
  emptySince: number | null;
  finishedAt: number | null;
  bin: BinEntry[];
  celebrateUntil: number;
  /** crew dissolves at this time after the Masterpiece celebration */
  dissolveAt: number;
}

interface PieceRec {
  id: number;
  type: PieceTypeId;
  state: 'loose' | 'flying';
  x: number;
  y: number;
  z: number;
  arc: Arc | null;
  actorPid: string;
  touchedAt: number;
}

interface JoinRequestRec {
  requester: string;
  keyHash: string;
  name: string;
  plot: number;
  sentAt: number;
  expiresAt: number;
}

interface ShiftRec {
  epoch: number;
  startedAt: number;
  lengthMs: number;
  towersCompleted: number;
  phase: ShiftPhase;
}

const RACK_REACH = 2.2;
const LOOSE_REACH = INTERACT.pickupRadius + NET.grabSlack;
const HAND_HEIGHT = 0.8;
const PUSH_OUT = 1.5;

/**
 * Orchestrates the gameplay systems of one world (research R10: rules are pure functions in
 * @hht/shared; this class validates intents, mutates state, persists and sends events).
 */
export class WorldSystems {
  readonly room: WorldRoom;
  readonly plots: Array<Building | null> = Array.from({ length: SITE.plots.length }, () => null);
  readonly pieces = new Map<number, PieceRec>();
  readonly requests = new Map<string, JoinRequestRec>();
  /** `${keyHash}:${plot}` → time until which the player may not ask that crew again */
  readonly cooldowns = new Map<string, number>();
  /** keyHash → towers finished by crews this player was in (shift summary) */
  readonly crewTowers = new Map<string, number>();
  shift!: ShiftRec;
  repo!: WorldRepo;
  blocklist!: Blocklist;
  /** independent invariant checks read by the load test (must stay 0) */
  readonly audit = { nonCrewSnaps: 0, overfilledSlots: 0 };
  private nextPieceId = 1;
  private bootGraceUntil = 0;
  private lastPurge = 0;

  constructor(room: WorldRoom) {
    this.room = room;
  }

  private get cfg() {
    return this.room.ctx.cfg;
  }
  private get t() {
    return this.room.ctx.cfg.timers;
  }

  // ------------------------------------------------------------------ lifecycle

  init(): void {
    const now = this.room.now();
    this.repo = new WorldRepo(this.room.ctx.db, this.room.worldId);
    this.blocklist = blocklistFor(this.cfg.blocklistDir);
    const lengthMs = this.cfg.shiftMinutes * 60_000;
    const row = this.repo.loadWorld();
    if (row && now < row.shiftStartedAt + row.shiftLengthMs) {
      this.shift = { epoch: row.epoch, startedAt: row.shiftStartedAt, lengthMs: row.shiftLengthMs, towersCompleted: row.towersCompleted, phase: 'running' };
      for (const b of this.repo.loadBuildings(row.epoch)) this.restoreBuilding(b);
      this.bootGraceUntil = now + this.t.bootGraceS * 1000;
    } else {
      // first boot, or the shift ended while the server was down: start a fresh shift
      this.shift = { epoch: (row?.epoch ?? 0) + 1, startedAt: now, lengthMs, towersCompleted: 0, phase: 'running' };
      this.repo.clearBuildings();
      this.repo.saveWorld(this.worldRow());
    }
    this.syncShift();
    this.refreshBlockers();
    this.repo.purgeReports(now - CHAT.reportRetentionDays * 86_400_000);
    this.lastPurge = now;
  }

  private worldRow() {
    return { epoch: this.shift.epoch, shiftStartedAt: this.shift.startedAt, shiftLengthMs: this.shift.lengthMs, towersCompleted: this.shift.towersCompleted };
  }

  private restoreBuilding(r: BuildingRow): void {
    const b: Building = {
      plot: r.plot, state: r.state, blueprintId: r.blueprintId, progress: r.progress, hostName: r.hostName,
      crew: { members: r.crew, joinMode: r.joinMode }, emptySince: r.emptySince, finishedAt: r.finishedAt, bin: r.bin, celebrateUntil: 0, dissolveAt: 0,
    };
    this.plots[r.plot] = b;
    this.syncPlot(r.plot);
  }

  dispose(): void {}

  onWorldClosing(): void {
    this.repo.deleteWorld();
  }

  /** A restored crew member (after a restart) may resume with this key within the boot grace. */
  isRestoredMember(keyHash: string): boolean {
    if (this.room.now() > this.bootGraceUntil) return false;
    return this.plots.some((b) => b?.crew.members.some((m) => m.keyHash === keyHash && m.pid === null));
  }

  onJoin(s: Session): void {
    if (s.duplicate) return;
    // restored crew membership (server restart) — attach by key
    for (const b of this.plots) {
      const m = b?.crew.members.find((x) => x.keyHash === s.keyHash && x.pid === null);
      if (b && m) {
        m.pid = s.pid;
        this.setSessionCrew(s, b.plot, m.role);
        if (m.role === 'host') b.hostName = s.name;
        b.emptySince = null;
        this.syncPlot(b.plot);
        this.saveBuilding(b);
        return;
      }
    }
  }

  onResume(s: Session): void {
    const b = s.crewPlot >= 0 ? this.plots[s.crewPlot] : null;
    if (b) this.syncPlot(b.plot);
  }

  onAway(s: Session): void {
    // a held piece drops where the worker stood
    this.dropHeld(s);
  }

  onRemove(s: Session): void {
    this.dropHeld(s);
    const req = this.requests.get(s.pid);
    if (req) this.withdraw(req);
    if (s.crewPlot >= 0) this.leaveCrew(s, 'left');
  }

  onRename(s: Session): void {
    for (const b of this.plots) {
      const m = b?.crew.members.find((x) => x.pid === s.pid);
      if (b && m) {
        m.name = s.name;
        if (m.role === 'host') b.hostName = s.name;
        this.syncPlot(b.plot);
        this.saveBuilding(b);
      }
    }
  }

  // ------------------------------------------------------------------ routing

  handle<K extends ClientMessageType>(s: Session, type: K, msg: ClientMessages[K], now: number): void {
    switch (type) {
      case 'grab': return this.grab(s, (msg as ClientMessages['grab']).target, now);
      case 'drop': return this.drop(s, now);
      case 'toss': return this.toss(s, (msg as ClientMessages['toss']).charge, now);
      case 'foreman': return this.foreman(s, msg as ClientMessages['foreman'], now);
      case 'crew': return this.crewOp(s, msg as ClientMessages['crew'], now);
      case 'emote': return this.emote(s, (msg as ClientMessages['emote']).id, 'emote', now);
      case 'say': return this.emote(s, (msg as ClientMessages['say']).id, 'say', now);
      case 'hide': {
        const m = msg as ClientMessages['hide'];
        if (m.hidden) s.hidden.add(m.who);
        else s.hidden.delete(m.who);
        return;
      }
      case 'chat': return this.chat(s, msg as ClientMessages['chat'], now);
      case 'report': return this.report(s, (msg as ClientMessages['report']).who, now);
      case 'dev': return this.dev(s, msg as ClientMessages['dev'], now);
      default:
        return;
    }
  }

  private bad(s: Session, now: number): void {
    strike(this.room.io, s, now);
  }

  // ------------------------------------------------------------------ pieces

  private setHeld(s: Session, type: PieceTypeId | null): void {
    s.worker = { ...s.worker, carrying: type };
    const ps = this.room.state.players.get(s.pid);
    if (ps) ps.heldType = type ?? '';
  }

  private grab(s: Session, target: ClientMessages['grab']['target'], now: number): void {
    if (s.worker.carrying) return this.bad(s, now);
    const w = s.worker;
    if (target.kind === 'rack') {
      const r = SITE.racks[target.rack];
      if (!r || Math.hypot(r.x - w.x, r.z - w.z) > RACK_REACH) return this.bad(s, now);
      this.setHeld(s, r.type);
      return;
    }
    if (target.kind === 'piece') {
      const p = this.pieces.get(target.id);
      if (!p || p.state !== 'loose') return; // already taken by someone faster — not a strike
      if (Math.hypot(p.x - w.x, p.z - w.z) > LOOSE_REACH) return this.bad(s, now);
      this.removePiece(p.id);
      this.setHeld(s, p.type);
      return;
    }
    const b = this.plots[target.plot];
    const def = SITE.plots[target.plot];
    if (!b || !def || s.crewPlot !== target.plot || Math.hypot(def.bin.x - w.x, def.bin.z - w.z) > def.bin.radius + LOOSE_REACH) return this.bad(s, now);
    const e = takeFromBin(b.bin, neededPiece(b.progress));
    if (!e) return;
    this.setHeld(s, e.type);
    this.syncPlot(b.plot);
    this.saveBuilding(b);
    const donor = e.donorPid ? this.room.sessions.get(e.donorPid) : [...this.room.sessions.values()].find((x) => x.keyHash === e.donorKeyHash);
    if (donor && donor !== s) this.room.sendTo(donor, 'thanks', { plot: b.plot, by: s.pid });
  }

  private drop(s: Session, now: number): void {
    const type = s.worker.carrying;
    if (!type) return this.bad(s, now);
    this.setHeld(s, null);
    const d = dropPoint(s.worker.x, s.worker.z, s.worker.facing);
    this.resolve(s, type, d.x, d.z, now);
  }

  private toss(s: Session, charge: number, now: number): void {
    const type = s.worker.carrying;
    if (!type) return this.bad(s, now);
    this.setHeld(s, null);
    const w = s.worker;
    const arc = tossArc({ x: w.x, y: w.y + HAND_HEIGHT, z: w.z }, w.facing, type, charge, now, { vx: w.vx, vz: w.vz });
    this.addPiece(type, arc.lx, 0, arc.lz, now, s.pid, arc);
  }

  /** Held pieces are dropped where the worker stood (disconnect, away). */
  dropHeld(s: Session): void {
    const type = s.worker.carrying;
    if (!type) return;
    this.setHeld(s, null);
    this.resolve(s, type, s.worker.x, s.worker.z, this.room.now());
  }

  private addPiece(type: PieceTypeId, x: number, y: number, z: number, now: number, actorPid: string, arc: Arc | null): void {
    const looseCount = [...this.pieces.values()].length;
    if (looseCount >= this.cfg.maxLoose) {
      // the oldest untouched loose piece fades first
      let oldest: PieceRec | null = null;
      for (const p of this.pieces.values()) if (p.state === 'loose' && (!oldest || p.touchedAt < oldest.touchedAt)) oldest = p;
      if (oldest) this.removePiece(oldest.id);
    }
    const id = this.nextPieceId++;
    const rec: PieceRec = { id, type, state: arc ? 'flying' : 'loose', x, y, z, arc, actorPid, touchedAt: now };
    this.pieces.set(id, rec);
    const ps = new PieceState();
    ps.type = type;
    ps.state = rec.state;
    ps.x = x;
    ps.y = y;
    ps.z = z;
    if (arc) {
      ps.ox = arc.ox;
      ps.oy = arc.oy;
      ps.oz = arc.oz;
      ps.vx = arc.vx;
      ps.vy = arc.vy;
      ps.vz = arc.vz;
      ps.t0 = arc.t0;
      ps.landAt = arc.landAt;
    }
    this.room.state.pieces.set(String(id), ps);
  }

  private removePiece(id: number): void {
    this.pieces.delete(id);
    this.room.state.pieces.delete(String(id));
  }

  /**
   * Resolve a piece at a ground point, in order: off the island / plaza → fade; crew build zone →
   * deliver(); non-crew zone or any bin → bin (if usable and room) or push out; else loose.
   */
  private resolve(actor: Session | null, type: PieceTypeId, x: number, z: number, now: number): void {
    if (x * x + z * z > SITE.playRadius * SITE.playRadius || inPlaza(SITE, x, z)) return;
    let zone = plotAtZone(SITE, x, z);
    const binPlot = plotAtBin(SITE, x, z);
    const zb = zone >= 0 ? this.plots[zone] : null;
    if (zone >= 0 && !zb) zone = -1; // a free plot pad is just ground
    const isCrew = actor !== null && zone >= 0 && actor.crewPlot === zone;
    if (zone >= 0 && zb && isCrew && zb.state === 'building' && type !== 'cone') {
      return this.deliverPiece(actor as Session, zb, type, x, z, now);
    }
    if (zone >= 0 && zb && isCrew) {
      // wrong piece (or the tower is finished): bounce out with a hint for the actor only
      const needed = neededPiece(zb.progress);
      if (actor && needed) this.room.sendTo(actor, 'hint', { kind: 'wrongPiece', needed });
      return this.pushOut(zb.plot, type, x, z, now, actor);
    }
    const target = binPlot >= 0 && this.plots[binPlot] ? binPlot : zone;
    const tb = target >= 0 ? this.plots[target] : null;
    if (tb) {
      if (canBin(type, CLOCK_TOWER) && tb.state !== 'finished' && addToBin(tb.bin, { type, donorKeyHash: actor?.keyHash ?? '', donorPid: actor?.pid ?? null }, this.cfg.binCapacity)) {
        if (actor) actor.donated++;
        this.syncPlot(tb.plot);
        this.saveBuilding(tb);
        this.room.broadcastEvent('binned', { plot: tb.plot, by: actor?.pid ?? '' });
        return;
      }
      if (actor) this.room.sendTo(actor, 'hint', canBin(type, CLOCK_TOWER) && tb.state !== 'finished' ? { kind: 'binFull' } : { kind: 'notCrew' });
      return this.pushOut(tb.plot, type, x, z, now, actor);
    }
    this.addPiece(type, x, 0, z, now, actor?.pid ?? '', null);
  }

  private pushOut(plot: number, type: PieceTypeId, x: number, z: number, now: number, actor: Session | null): void {
    const def = SITE.plots[plot];
    if (!def) return;
    let dx = x - def.x;
    let dz = z - def.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d < 1e-3) {
      dx = def.x;
      dz = def.z;
    }
    const r = def.buildZoneRadius + PUSH_OUT;
    const n = Math.hypot(dx, dz) || 1;
    const px = def.x + (dx / n) * r;
    const pz = def.z + (dz / n) * r;
    if (inPlaza(SITE, px, pz)) return;
    this.addPiece(type, px, 0, pz, now, actor?.pid ?? '', null);
  }

  private deliverPiece(s: Session, b: Building, type: PieceTypeId, _x: number, _z: number, now: number): void {
    if (s.crewPlot !== b.plot) this.audit.nonCrewSnaps++;
    const { progress, result } = deliver(b.progress, type, CLOCK_TOWER);
    if (result === 'wrongPiece' || result === 'alreadyComplete') {
      const needed = neededPiece(b.progress);
      if (needed) this.room.sendTo(s, 'hint', { kind: 'wrongPiece', needed });
      return this.pushOut(b.plot, type, _x, _z, now, s);
    }
    b.progress = progress;
    const st = currentStage(progress, CLOCK_TOWER);
    if (st && progress.filledSlots >= st.slotCount) this.audit.overfilledSlots++;
    s.delivered++;
    if (result === 'masterpiece') {
      b.state = 'finished';
      b.finishedAt = now;
      b.celebrateUntil = now + this.t.celebrateS * 1000;
      b.dissolveAt = b.celebrateUntil;
      this.shift.towersCompleted++;
      for (const m of b.crew.members) this.crewTowers.set(m.keyHash, (this.crewTowers.get(m.keyHash) ?? 0) + 1);
      this.repo.saveWorld(this.worldRow());
      this.syncShift();
    }
    this.syncPlot(b.plot);
    this.saveBuilding(b);
    this.refreshBlockers();
    this.room.broadcastEvent('snap', { plot: b.plot, result, by: s.pid, pieceType: type });
    if (result === 'masterpiece') this.room.broadcastEvent('celebrate', { plot: b.plot, until: b.celebrateUntil });
  }

  private tickPieces(now: number): void {
    const fadeMs = this.t.looseFadeS * 1000;
    for (const p of [...this.pieces.values()]) {
      if (p.state === 'flying' && p.arc && now >= p.arc.landAt) {
        const actor = this.room.sessions.get(p.actorPid) ?? null;
        this.removePiece(p.id);
        this.resolve(actor, p.type, p.arc.lx, p.arc.lz, now);
      } else if (p.state === 'loose' && now - p.touchedAt > fadeMs) {
        this.removePiece(p.id);
      }
    }
  }

  // ------------------------------------------------------------------ buildings & Foreman

  refreshBlockers(): void {
    const blockers = [];
    for (const def of SITE.plots) {
      const b = this.plots[def.index];
      if (b && b.progress.completedStages >= 1) blockers.push(towerBlocker(def));
    }
    this.room.blockers = blockers;
  }

  private foreman(s: Session, m: ClientMessages['foreman'], now: number): void {
    const f = SITE.foreman;
    if (Math.hypot(s.worker.x - f.x, s.worker.z - f.z) > f.talkRadius + 0.8) return this.bad(s, now);
    if (s.crewPlot >= 0) {
      this.room.sendTo(s, 'foreman', { result: 'notAvailable' });
      return;
    }
    if (m.op === 'adopt') {
      const b = this.plots[m.plot];
      if (!b || b.state !== 'unattended') {
        this.room.sendTo(s, 'foreman', { result: 'notAvailable' });
        return;
      }
      b.state = 'building';
      b.emptySince = null;
      b.crew.members = [{ keyHash: s.keyHash, pid: s.pid, name: s.name, hatColor: s.hatColor, joinedAt: now, role: 'host' }];
      b.hostName = s.name;
      this.setSessionCrew(s, b.plot, 'host');
      this.syncPlot(b.plot);
      this.saveBuilding(b);
      this.room.sendTo(s, 'foreman', { result: 'adopted', plot: b.plot });
      return;
    }
    const records = this.plots.map((b) => ({ state: (b?.state ?? 'free') as PlotStateName, finishedAt: b?.finishedAt ?? null, emptySince: b?.emptySince ?? null }));
    const a = assignPlot(records, now, this.t.retireAfterFinishedS * 1000);
    if (a === 'allPlotsBusy') {
      this.room.sendTo(s, 'foreman', { result: 'allPlotsBusy' });
      return;
    }
    if (a.retire) this.clearPlot(a.index);
    const b: Building = {
      plot: a.index, state: 'building', blueprintId: CLOCK_TOWER.id, progress: initialProgress(CLOCK_TOWER), hostName: s.name,
      crew: { joinMode: 'ask', members: [{ keyHash: s.keyHash, pid: s.pid, name: s.name, hatColor: s.hatColor, joinedAt: now, role: 'host' }] },
      emptySince: null, finishedAt: null, bin: [], celebrateUntil: 0, dissolveAt: 0,
    };
    this.plots[a.index] = b;
    this.setSessionCrew(s, a.index, 'host');
    this.syncPlot(a.index);
    this.saveBuilding(b);
    this.refreshBlockers();
    this.room.sendTo(s, 'foreman', { result: 'assigned', plot: a.index });
  }

  private clearPlot(plot: number): void {
    const b = this.plots[plot];
    if (!b) return;
    for (const m of b.crew.members) {
      const ms = m.pid ? this.room.sessions.get(m.pid) : undefined;
      if (ms) this.setSessionCrew(ms, -1, '');
    }
    for (const [pid, r] of [...this.requests]) if (r.plot === plot) this.requests.delete(pid);
    this.plots[plot] = null;
    this.syncPlot(plot);
    this.repo.deleteBuilding(plot);
    this.refreshBlockers();
  }

  private saveBuilding(b: Building): void {
    const host = hostOf(b.crew);
    this.repo.saveBuilding(this.shift.epoch, {
      plot: b.plot, state: b.state, blueprintId: b.blueprintId, progress: b.progress, hostKeyHash: host?.keyHash ?? null,
      hostName: b.hostName, joinMode: b.crew.joinMode, emptySince: b.emptySince, finishedAt: b.finishedAt, crew: b.crew.members, bin: b.bin,
    });
  }

  syncPlot(plot: number): void {
    const ps = this.room.state.plots[plot];
    if (!ps) return;
    const b = this.plots[plot];
    if (!b) {
      ps.state = 'free';
      ps.blueprintId = '';
      ps.completedStages = 0;
      ps.filledSlots = 0;
      ps.hostName = '';
      ps.hostSession = '';
      ps.joinMode = 'ask';
      ps.crewSize = 0;
      ps.bin.clear();
      ps.finishedAt = 0;
      return;
    }
    const host = hostOf(b.crew);
    ps.state = b.state;
    ps.blueprintId = b.blueprintId;
    ps.completedStages = b.progress.completedStages;
    ps.filledSlots = b.progress.filledSlots;
    ps.hostName = b.hostName;
    ps.hostSession = host?.pid ?? '';
    ps.joinMode = b.crew.joinMode;
    ps.crewSize = b.crew.members.length;
    const types = b.bin.map((e) => e.type);
    if (ps.bin.length !== types.length || types.some((t, i) => ps.bin[i] !== t)) {
      ps.bin.clear();
      for (const t of types) ps.bin.push(t);
    }
    ps.finishedAt = b.finishedAt ?? 0;
  }

  // ------------------------------------------------------------------ crews

  private setSessionCrew(s: Session, plot: number, role: '' | 'host' | 'member'): void {
    s.crewPlot = plot;
    s.crewRole = role;
    const ps = this.room.state.players.get(s.pid);
    if (ps) {
      ps.crewPlot = plot;
      ps.crewRole = role;
    }
  }

  private notifyCrew(b: Building, kind: 'newHost' | 'removed' | 'joined' | 'left', who: string, extra?: Session): void {
    for (const m of b.crew.members) {
      const ms = m.pid ? this.room.sessions.get(m.pid) : undefined;
      if (ms) this.room.sendTo(ms, 'crewNotice', { plot: b.plot, kind, who });
    }
    if (extra) this.room.sendTo(extra, 'crewNotice', { plot: b.plot, kind, who });
  }

  private memberStatus(m: CrewMember, now: number): MemberStatus {
    const ms = m.pid ? this.room.sessions.get(m.pid) : undefined;
    if (!ms || ms.state === 'away') return 'away';
    return now - ms.lastActiveAt > this.t.hostIdleS * 1000 ? 'idle' : 'active';
  }

  private addMember(b: Building, s: Session, now: number): void {
    const role = b.crew.members.length === 0 ? 'host' : 'member';
    b.crew.members.push({ keyHash: s.keyHash, pid: s.pid, name: s.name, hatColor: s.hatColor, joinedAt: now, role });
    if (role === 'host') b.hostName = s.name;
    b.emptySince = null;
    this.setSessionCrew(s, b.plot, role);
    const r = this.requests.get(s.pid);
    if (r) this.withdraw(r);
    this.syncPlot(b.plot);
    this.saveBuilding(b);
    this.notifyCrew(b, 'joined', s.pid);
    this.room.sendTo(s, 'requestResult', { plot: b.plot, result: 'joined' });
    if (b.crew.members.length >= 8) this.expireRequestsFor(b.plot, 'full');
  }

  private hostSession(b: Building): Session | undefined {
    const h = hostOf(b.crew);
    return h?.pid ? this.room.sessions.get(h.pid) : undefined;
  }

  private crewOp(s: Session, m: ClientMessages['crew'], now: number): void {
    switch (m.op) {
      case 'request': {
        const b = this.plots[m.plot];
        if (!b || b.state === 'finished') {
          this.room.sendTo(s, 'requestResult', { plot: m.plot, result: 'closed' });
          return;
        }
        const host = this.hostSession(b);
        const cooldownUntil = this.cooldowns.get(`${s.keyHash}:${b.plot}`) ?? 0;
        const res = requestJoin(b.crew, { alreadyInCrew: s.crewPlot >= 0, cooldownUntil, hiddenByHost: !!host?.hidden.has(s.pid), now });
        if (res === 'joined') return this.addMember(b, s, now);
        if (res === 'pending' && b.crew.members.length === 0) {
          this.room.sendTo(s, 'requestResult', { plot: b.plot, result: 'busy' });
          return;
        }
        if (res !== 'pending') {
          this.room.sendTo(s, 'requestResult', res === 'cooldown' ? { plot: b.plot, result: res, retryAt: cooldownUntil } : { plot: b.plot, result: res });
          return;
        }
        const old = this.requests.get(s.pid);
        if (old) this.withdraw(old);
        const req: JoinRequestRec = { requester: s.pid, keyHash: s.keyHash, name: s.name, plot: b.plot, sentAt: now, expiresAt: now + this.t.requestExpireS * 1000 };
        this.requests.set(s.pid, req);
        if (host) this.room.sendTo(host, 'request', { op: 'incoming', requester: s.pid, name: s.name, expiresAt: req.expiresAt });
        this.room.sendTo(s, 'requestResult', { plot: b.plot, result: 'pending' });
        return;
      }
      case 'cancel': {
        const r = this.requests.get(s.pid);
        if (r) this.withdraw(r);
        return;
      }
      case 'answer': {
        const b = s.crewPlot >= 0 ? this.plots[s.crewPlot] : null;
        if (!b || s.crewRole !== 'host') return this.bad(s, now);
        const r = this.requests.get(m.requester);
        if (!r || r.plot !== b.plot) return;
        const rs = this.room.sessions.get(r.requester);
        this.requests.delete(r.requester);
        if (!rs || rs.state !== 'active') return;
        if (!m.approve) {
          this.cooldowns.set(`${rs.keyHash}:${b.plot}`, now + this.t.denyCooldownS * 1000);
          this.room.sendTo(rs, 'requestResult', { plot: b.plot, result: 'denied', retryAt: now + this.t.denyCooldownS * 1000 });
          return;
        }
        const res = requestJoin({ ...b.crew, joinMode: b.crew.joinMode === 'solo' ? 'solo' : 'open' }, { alreadyInCrew: rs.crewPlot >= 0, cooldownUntil: 0, hiddenByHost: false, now });
        if (res === 'joined') this.addMember(b, rs, now);
        else this.room.sendTo(rs, 'requestResult', { plot: b.plot, result: res });
        return;
      }
      case 'mode': {
        const b = s.crewPlot >= 0 ? this.plots[s.crewPlot] : null;
        if (!b || s.crewRole !== 'host') return this.bad(s, now);
        b.crew.joinMode = m.mode as JoinMode;
        if (m.mode === 'solo') this.expireRequestsFor(b.plot, 'expired');
        this.syncPlot(b.plot);
        this.saveBuilding(b);
        return;
      }
      case 'remove': {
        const b = s.crewPlot >= 0 ? this.plots[s.crewPlot] : null;
        if (!b || s.crewRole !== 'host') return this.bad(s, now);
        const target = b.crew.members.find((x) => x.pid === m.member);
        if (!target || target.role === 'host') return;
        const ts = this.room.sessions.get(m.member);
        removeMember(b.crew, target);
        this.cooldowns.set(`${target.keyHash}:${b.plot}`, now + this.t.denyCooldownS * 1000);
        if (ts) this.setSessionCrew(ts, -1, '');
        this.syncPlot(b.plot);
        this.saveBuilding(b);
        this.notifyCrew(b, 'removed', m.member, ts);
        return;
      }
      case 'handover': {
        const b = s.crewPlot >= 0 ? this.plots[s.crewPlot] : null;
        if (!b || s.crewRole !== 'host') return this.bad(s, now);
        const target = b.crew.members.find((x) => x.pid === m.to);
        if (!target || target.pid === s.pid) return;
        this.makeHost(b, target);
        return;
      }
      case 'leave':
        if (s.crewPlot >= 0) this.leaveCrew(s, 'left');
        return;
    }
  }

  private makeHost(b: Building, to: CrewMember): void {
    setHost(b.crew, to);
    b.hostName = to.name;
    for (const m of b.crew.members) {
      const ms = m.pid ? this.room.sessions.get(m.pid) : undefined;
      if (ms) this.setSessionCrew(ms, b.plot, m.role);
    }
    this.syncPlot(b.plot);
    this.saveBuilding(b);
    this.notifyCrew(b, 'newHost', to.pid ?? '');
    // pending requests now go to the new Host (same expiry)
    const host = this.hostSession(b);
    if (host) for (const r of this.requests.values()) if (r.plot === b.plot) this.room.sendTo(host, 'request', { op: 'incoming', requester: r.requester, name: r.name, expiresAt: r.expiresAt });
  }

  private leaveCrew(s: Session, kind: 'left' | 'removed'): void {
    const b = this.plots[s.crewPlot];
    this.setSessionCrew(s, -1, '');
    if (!b) return;
    const m = b.crew.members.find((x) => x.pid === s.pid || (x.keyHash === s.keyHash && x.pid === null));
    if (!m) return;
    const wasHost = m.role === 'host';
    removeMember(b.crew, m);
    const now = this.room.now();
    if (wasHost && b.crew.members.length) {
      const next = nextHost(b.crew, (x) => this.memberStatus(x, now));
      if (next) this.makeHost(b, next);
    }
    if (!b.crew.members.length && b.state === 'building') {
      b.emptySince = now;
      this.expireRequestsFor(b.plot, 'expired');
    }
    this.syncPlot(b.plot);
    this.saveBuilding(b);
    this.notifyCrew(b, kind, s.pid);
  }

  private withdraw(r: JoinRequestRec): void {
    this.requests.delete(r.requester);
    const b = this.plots[r.plot];
    const host = b ? this.hostSession(b) : undefined;
    if (host) this.room.sendTo(host, 'request', { op: 'withdrawn', requester: r.requester });
  }

  private expireRequestsFor(plot: number, result: 'expired' | 'full'): void {
    for (const r of [...this.requests.values()]) {
      if (r.plot !== plot) continue;
      this.withdraw(r);
      const rs = this.room.sessions.get(r.requester);
      if (rs) this.room.sendTo(rs, 'requestResult', { plot, result });
    }
  }

  private secondCrews(now: number): void {
    for (const r of [...this.requests.values()]) {
      if (now < r.expiresAt) continue;
      this.withdraw(r);
      const rs = this.room.sessions.get(r.requester);
      if (rs) this.room.sendTo(rs, 'requestResult', { plot: r.plot, result: 'expired' });
    }
    for (const b of this.plots) {
      if (!b) continue;
      // restored members who never came back within the boot grace leave the crew
      if (now > this.bootGraceUntil) {
        const gone = b.crew.members.filter((m) => m.pid === null);
        if (gone.length) {
          for (const m of gone) removeMember(b.crew, m);
          if (!hostOf(b.crew) && b.crew.members.length) {
            const next = nextHost(b.crew, (x) => this.memberStatus(x, now));
            if (next) this.makeHost(b, next);
          }
          if (!b.crew.members.length && b.state === 'building' && b.emptySince === null) b.emptySince = now;
          this.syncPlot(b.plot);
          this.saveBuilding(b);
        }
      }
      if (b.state === 'finished' && b.dissolveAt && now >= b.dissolveAt) {
        // the Masterpiece stays standing; the crew is free to start or join another building
        for (const m of b.crew.members) {
          const ms = m.pid ? this.room.sessions.get(m.pid) : undefined;
          if (ms) this.setSessionCrew(ms, -1, '');
        }
        b.crew.members = [];
        b.dissolveAt = 0;
        this.expireRequestsFor(b.plot, 'expired');
        this.syncPlot(b.plot);
        this.saveBuilding(b);
        continue;
      }
      if (b.state !== 'building') continue;
      const host = hostOf(b.crew);
      if (host) {
        const hs = host.pid ? this.room.sessions.get(host.pid) : undefined;
        const awayTooLong = !!hs && hs.state === 'away' && now - hs.awaySince > this.t.hostAwayS * 1000;
        if (shouldHandOver(b.crew, (x) => this.memberStatus(x, now), awayTooLong)) {
          const next = nextHost(b.crew, (x) => this.memberStatus(x, now), host);
          if (next && this.memberStatus(next, now) !== 'away') this.makeHost(b, next);
        }
      }
      const rec = { state: b.state as PlotStateName, finishedAt: b.finishedAt, emptySince: b.emptySince };
      if (becomesUnattended(rec, now, this.t.unattendedAfterS * 1000)) {
        b.state = 'unattended';
        this.syncPlot(b.plot);
        this.saveBuilding(b);
      }
    }
  }

  // ------------------------------------------------------------------ social & chat

  private emote(s: Session, id: string, kind: 'emote' | 'say', now: number): void {
    if (kind === 'emote') s.emoteUntil = now + SOCIAL.showS * 1000;
    const r2 = SOCIAL.emoteRadiusM * SOCIAL.emoteRadiusM;
    for (const o of this.room.sessions.values()) {
      const dx = o.worker.x - s.worker.x;
      const dz = o.worker.z - s.worker.z;
      if (dx * dx + dz * dz <= r2) this.room.sendTo(o, 'emote', { who: s.pid, id: id as never, kind });
    }
  }

  private chat(s: Session, m: ClientMessages['chat'], now: number): void {
    if (now - s.joinedAt < this.t.chatUnlockS * 1000) {
      this.room.sendTo(s, 'chatRefused', { reason: 'locked', unlockAt: s.joinedAt + this.t.chatUnlockS * 1000 });
      return;
    }
    if (this.repo.isPaused(s.keyHash, this.shift.epoch)) {
      this.room.sendTo(s, 'chatRefused', { reason: 'paused' });
      return;
    }
    const clean = sanitize(m.text);
    if (!clean.ok) {
      this.room.sendTo(s, 'chatRefused', { reason: clean.reason });
      return;
    }
    if (detectContact(clean.text)) {
      this.room.sendTo(s, 'chatRefused', { reason: 'contact' });
      return;
    }
    const norm = normalizeForMatch(clean.text);
    const last = s.lastChatNorm.get(norm);
    if (last !== undefined && now - last < this.t.chatDuplicateS * 1000) {
      this.room.sendTo(s, 'chatRefused', { reason: 'duplicate' });
      return;
    }
    if (m.channel === 'crew' && s.crewPlot < 0) {
      this.room.sendTo(s, 'chatRefused', { reason: 'noCrew' });
      return;
    }
    s.lastChatNorm.set(norm, now);
    if (s.lastChatNorm.size > 20) for (const [k, t] of s.lastChatNorm) if (now - t > this.t.chatDuplicateS * 1000) s.lastChatNorm.delete(k);
    s.recentChat.push({ text: clean.text, channel: m.channel, at: now });
    if (s.recentChat.length > CHAT.ringSize) s.recentChat.shift();
    const text = maskBlocked(clean.text, this.blocklist.list).text;
    const payload = { from: s.pid, channel: m.channel, text, at: now };
    if (m.channel === 'crew') {
      for (const o of this.room.sessions.values()) if (o.crewPlot === s.crewPlot) this.room.sendTo(o, 'chat', payload);
      return;
    }
    const r2 = CHAT.nearbyM * CHAT.nearbyM;
    for (const o of this.room.sessions.values()) {
      const dx = o.worker.x - s.worker.x;
      const dz = o.worker.z - s.worker.z;
      if (dx * dx + dz * dz <= r2) this.room.sendTo(o, 'chat', payload);
    }
  }

  private report(s: Session, who: string, now: number): void {
    const target = this.room.sessions.get(who);
    if (!target || target === s || target.keyHash === s.keyHash) {
      this.room.sendTo(s, 'reportResult', { result: 'invalid' });
      return;
    }
    if (s.reportedThisShift.has(target.keyHash)) {
      this.room.sendTo(s, 'reportResult', { result: 'already' });
      return;
    }
    s.reportedThisShift.add(target.keyHash);
    const ok = this.repo.insertReport(this.shift.epoch, s.keyHash, target.keyHash, target.name, target.recentChat, now);
    this.room.sendTo(s, 'reportResult', { result: ok ? 'ok' : 'already' });
    if (ok && this.repo.distinctReporters(target.keyHash, now - this.t.chatPauseWindowS * 1000) >= CHAT.pauseReporters && !this.repo.isPaused(target.keyHash, this.shift.epoch)) {
      this.repo.addPause(target.keyHash, this.shift.epoch, now);
      this.room.sendTo(target, 'chatPaused', { untilShiftEnd: true });
    }
  }

  // ------------------------------------------------------------------ shift

  private syncShift(): void {
    const st = this.room.state.shift;
    st.epoch = this.shift.epoch;
    st.endsAt = this.shift.startedAt + this.shift.lengthMs;
    st.towersCompleted = this.shift.towersCompleted;
    st.phase = this.shift.phase;
  }

  private celebrating(now: number): boolean {
    return this.plots.some((b) => !!b && b.celebrateUntil > now);
  }

  private secondShift(now: number): void {
    const endsAt = this.shift.startedAt + this.shift.lengthMs;
    const phase = shiftPhase(now, endsAt, this.celebrating(now), this.t.warnS * 1000, this.t.countdownS * 1000);
    if (phase === this.shift.phase) return;
    const prev = this.shift.phase;
    this.shift.phase = phase;
    this.syncShift();
    if (phase === 'warning' && prev === 'running') this.room.broadcastEvent('shift', { phase: 'warning', endsAt });
    if (phase === 'countdown' && prev !== 'countdown') this.room.broadcastEvent('shift', { phase: 'countdown', endsAt });
    if (phase === 'resetting') this.resetShift(now);
  }

  /** End of shift (FR-048): clear plots, crews, bins and pieces; players back to the plaza; summaries. */
  resetShift(now: number): void {
    const epoch = this.shift.epoch;
    const worldTowers = this.shift.towersCompleted;
    for (let i = 0; i < this.plots.length; i++) if (this.plots[i]) this.clearPlot(i);
    for (const id of [...this.pieces.keys()]) this.removePiece(id);
    this.requests.clear();
    this.cooldowns.clear();
    for (const s of this.room.sessions.values()) {
      if (s.worker.carrying) this.setHeld(s, null);
      this.setSessionCrew(s, -1, '');
      if (s.state === 'active') {
        this.room.sendTo(s, 'summary', { epoch, worldTowers, myCrewTowers: this.crewTowers.get(s.keyHash) ?? 0, delivered: s.delivered, donated: s.donated });
        teleport(s, SITE.spawn.x, SITE.spawn.y, SITE.spawn.z);
        this.room.sendTo(s, 'correction', { reason: 'respawn' });
      }
      s.delivered = 0;
      s.donated = 0;
      s.reportedThisShift.clear();
    }
    this.crewTowers.clear();
    this.shift = { epoch: epoch + 1, startedAt: now, lengthMs: this.cfg.shiftMinutes * 60_000, towersCompleted: 0, phase: 'running' };
    this.repo.clearBuildings();
    this.repo.saveWorld(this.worldRow());
    this.syncShift();
    this.refreshBlockers();
  }

  // ------------------------------------------------------------------ dev cheats (HHT_DEV_CHEATS=1 only)

  private dev(s: Session, m: ClientMessages['dev'], now: number): void {
    if (!this.cfg.devCheats) return this.bad(s, now);
    switch (m.op) {
      case 'give': {
        const type = m.type as PieceTypeId;
        if (PIECE_TYPE_IDS.includes(type)) this.setHeld(s, type);
        return;
      }
      case 'teleport': {
        const { x, y, z } = m as unknown as { x: number; y: number; z: number };
        if ([x, y, z].every((v) => typeof v === 'number' && Number.isFinite(v))) {
          teleport(s, x, y, z);
          this.room.sendTo(s, 'correction', { reason: 'respawn' });
        }
        return;
      }
      case 'fillStage': {
        const b = this.plots[Number(m.plot)];
        if (!b || b.state !== 'building') return;
        const stage = currentStage(b.progress, CLOCK_TOWER);
        if (!stage) return;
        const n = stage.slotCount - b.progress.filledSlots;
        for (let i = 0; i < n && !isMasterpiece(b.progress); i++) this.deliverPiece(s, b, stage.pieceType, SITE.plots[b.plot]!.x, SITE.plots[b.plot]!.z, now);
        return;
      }
      case 'endShiftIn': {
        const sec = Number(m.seconds);
        if (Number.isFinite(sec) && sec >= 0) {
          this.shift.lengthMs = now + sec * 1000 - this.shift.startedAt;
          this.shift.phase = 'running';
          this.repo.saveWorld(this.worldRow());
          this.syncShift();
        }
        return;
      }
      case 'unlockChat':
        s.joinedAt = 0;
        return;
      default:
        return;
    }
  }

  // ------------------------------------------------------------------ ticking

  tick(now: number): void {
    this.tickPieces(now);
  }

  second(now: number): void {
    this.secondCrews(now);
    this.secondShift(now);
    if (now - this.lastPurge > 86_400_000) {
      this.lastPurge = now;
      this.repo.purgeReports(now - CHAT.reportRetentionDays * 86_400_000);
    }
  }

  /** Piece position for clients mid-flight (exposed for tests). */
  piecePosition(id: number, t: number): { x: number; y: number; z: number } | null {
    const p = this.pieces.get(id);
    if (!p) return null;
    return p.arc ? arcPosition(p.arc, t) : { x: p.x, y: p.y, z: p.z };
  }
}

