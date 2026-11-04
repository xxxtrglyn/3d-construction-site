import {
  CLOCK_TOWER, MACHINE, MACHINES_PER_PLOT, MACHINE_KINDS, NET, SIM_DT, SITE,
  atSpoil, canEnter, dig, distToSquare, exitSpot, groundworkPart, hookPos, initialWorker, kindIndex, kindOfMachine, machineBusy,
  machineCtx, neededSupply, openSlotRefs, openSlots, parkedState, plotOfMachine, pour, rackAtForks, seatPose, setDownSpot, snapTarget,
  stepMachine, toolTip,
  type MachineAction, type MachineActKind, type MachineCtx, type MachineExitReason, type MachineId, type MachineState, type MoveInput,
  type PieceTypeId,
} from '@hht/shared';
import type { WorldSystems } from '../world/systems.ts';
import type { MachineRec, Session } from '../world/types.ts';
import { simulate } from './movement.ts';

const NEUTRAL: MoveInput = Object.freeze({ seq: 0, dx: 0, dz: 0, run: false, jump: false, act: false, alt: false });
const ACT_RADIUS = 35;
/** act edges per this many 60 Hz steps (= 1 s) */
const ACT_WINDOW_STEPS = 60;
/** an operator who lost crew membership is put out within this long (FR-011: ≤ 2 s) */
const OUTSIDER_GRACE_MS = 2000;

/**
 * All 48 machines of a world (feature 003, research M1–M10). The shared `stepMachine()` moves them
 * from the operator's seq'd inputs; this system decides who may get in, what each action does
 * (scoop, dump, hook grab/release, pallets, mixing), puts operators out and keeps held pieces safe.
 */
export class MachineSystem {
  readonly recs: MachineRec[];
  /** independent invariant checks read by the load test (must stay 0) */
  readonly audit = { machineOutsiderOps: 0, highFilledByHand: 0, workerMovedByMachine: 0, heldPiecesLost: 0 };
  /** usage counters for the load-test report */
  readonly usage = { groundworkDone: 0, craneSnaps: 0, forkliftSnaps: 0, maxMachinesMoving: 0 };
  private readonly w: WorldSystems;
  private stepNo = 0;
  private readonly outsiderSince = new Map<MachineId, number>();

  constructor(w: WorldSystems) {
    this.w = w;
    this.recs = SITE.machines.flatMap((spots) => MACHINE_KINDS.map((k) => ({ state: parkedState(spots.plot * MACHINES_PER_PLOT + kindIndex(k), spots), operator: '' })));
  }

  private get room() {
    return this.w.room;
  }

  ctxFor(plot: number): MachineCtx {
    return machineCtx(SITE, plot, this.room.blockers, this.w.plots[plot]?.progress.completedStages ?? 0);
  }

  rec(id: MachineId): MachineRec | undefined {
    return this.recs[id];
  }

  /** Every machine parked and empty (boot, shift reset). Mixers keep their plot's bag count. */
  reset(): void {
    for (const r of this.recs) {
      const plot = plotOfMachine(r.state.id);
      r.state = parkedState(r.state.id, SITE.machines[plot]!);
      r.operator = '';
    }
    for (let p = 0; p < SITE.plots.length; p++) {
      this.syncMixerLoad(p);
      this.syncPlot(p);
    }
  }

  // ------------------------------------------------------------------ schema mirror

  syncPlot(plot: number): void {
    const ps = this.room.state.plots[plot];
    if (!ps) return;
    for (let k = 0; k < MACHINES_PER_PLOT; k++) {
      const op = this.recs[plot * MACHINES_PER_PLOT + k]?.operator ?? '';
      if (ps.machineOps.length <= k) ps.machineOps.push(op);
      else if (ps.machineOps[k] !== op) ps.machineOps[k] = op;
    }
    const crane = this.recs[plot * MACHINES_PER_PLOT]!.state.load;
    const hook = crane.kind === 'hook' ? crane.piece : '';
    if (ps.hookType !== hook) ps.hookType = hook;
    const fork = this.recs[plot * MACHINES_PER_PLOT + 2]!.state.load;
    const pallet = fork.kind === 'pallet' ? fork.pieces : [];
    if (ps.palletTypes.length !== pallet.length || pallet.some((t, i) => ps.palletTypes[i] !== t)) {
      ps.palletTypes.clear();
      for (const t of pallet) ps.palletTypes.push(t);
    }
  }

  /** The mixer's load mirrors the building's bag count (the stepper needs it to allow mixing). */
  syncMixerLoad(plot: number): void {
    const r = this.recs[plot * MACHINES_PER_PLOT + 3]!;
    const count = this.w.plots[plot]?.mixerBags ?? 0;
    if (r.state.load.kind !== 'bags' || r.state.load.count !== count) r.state = { ...r.state, load: { kind: 'bags', count } };
  }

  // ------------------------------------------------------------------ entering and leaving

  enter(s: Session, id: MachineId, now: number): void {
    const r = this.recs[id];
    if (!r) return;
    if (s.machine >= 0) {
      this.room.sendTo(s, 'machineResult', { id, result: 'busy' });
      return;
    }
    // inputs that arrived before this message were walking inputs: apply them first
    simulate(s, this.room.blockers);
    const plot = plotOfMachine(id);
    const b = this.w.plots[plot];
    const result = canEnter(r, { hasBuilding: !!b }, { crewPlot: s.crewPlot, carrying: s.worker.carrying, x: s.worker.x, z: s.worker.z }, SITE.machines[plot]!, NET.grabSlack);
    this.room.sendTo(s, 'machineResult', { id, result });
    if (result !== 'entered') return;
    if (s.crewPlot !== plot) this.audit.machineOutsiderOps++; // canEnter guarantees this never happens
    r.operator = s.pid;
    s.machine = id;
    s.lastMachineInputAt = now;
    s.actTimes.length = 0;
    const ps = this.room.state.players.get(s.pid);
    if (ps) ps.machine = id;
    this.seat(s, r);
    this.syncPlot(plot);
  }

  private seat(s: Session, r: MachineRec): void {
    const p = seatPose(r.state, SITE.machines[plotOfMachine(r.state.id)]!);
    s.worker = { ...s.worker, x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, facing: p.yaw, grounded: true, coyote: 0.1, jumpBuffer: 0 };
  }

  /**
   * Puts the operator out (FR-011): anything on the hook or the forks is set down safely, the machine
   * stays where it stopped, and the worker stands at the exit spot.
   */
  exit(s: Session, reason: MachineExitReason): void {
    const id = s.machine;
    const r = id >= 0 ? this.recs[id] : undefined;
    s.machine = -1;
    const ps = this.room.state.players.get(s.pid);
    if (ps) ps.machine = -1;
    if (!r) return;
    const plot = plotOfMachine(id);
    if (r.operator === s.pid) r.operator = '';
    this.setDownLoad(r, null);
    const ctx = this.ctxFor(plot);
    const e = exitSpot(r.state, ctx);
    s.worker = { ...initialWorker({ x: e.x, y: 0, z: e.z }, e.yaw), carrying: null };
    this.room.sendTo(s, 'machineExit', { id, reason });
    this.syncPlot(plot);
  }

  /** Puts out every operator of a plot's machines (crew dissolved, plot cleared). */
  putOutPlot(plot: number, reason: MachineExitReason): void {
    for (let k = 0; k < MACHINES_PER_PLOT; k++) {
      const r = this.recs[plot * MACHINES_PER_PLOT + k]!;
      const s = r.operator ? this.room.sessions.get(r.operator) : undefined;
      if (s && s.machine === r.state.id) this.exit(s, reason);
      else {
        r.operator = '';
        this.setDownLoad(r, null);
      }
    }
    this.syncPlot(plot);
  }

  // ------------------------------------------------------------------ stepping

  /** One operator input (called by movement.simulate for a seated session). A jump edge gets out. */
  stepOperator(s: Session, inp: MoveInput, now: number): void {
    const r = this.recs[s.machine];
    if (!r || r.operator !== s.pid) {
      s.machine = -1;
      return;
    }
    if (inp.jump) {
      this.exit(s, 'jump');
      return;
    }
    this.stepNo++;
    let input = inp;
    if (inp.act) {
      const a = s.actTimes;
      while (a.length && (a[0] as number) <= this.stepNo - ACT_WINDOW_STEPS) a.shift();
      if (a.length >= MACHINE.actPerSecond) input = { ...inp, act: false }; // button mashing: ignored, not struck
      else a.push(this.stepNo);
    }
    if (inp.dx !== 0 || inp.dz !== 0 || inp.act) s.lastMachineInputAt = now;
    const plot = plotOfMachine(r.state.id);
    const res = stepMachine(r.state, input, SIM_DT, this.ctxFor(plot));
    r.state = res.state;
    this.seat(s, r);
    if (res.action) this.onAction(r, res.action, s, now);
  }

  /** Unoperated machines that are still busy (hook mid-lowering, forklift coasting, mixer drum) step on their own. */
  tick(now: number): void {
    let moving = 0;
    for (const r of this.recs) {
      const busy = machineBusy(r.state);
      if (busy || r.operator) moving++;
      if (r.operator || !busy) continue;
      const ctx = this.ctxFor(plotOfMachine(r.state.id));
      for (let i = 0; i < 3; i++) {
        const res = stepMachine(r.state, NEUTRAL, SIM_DT, ctx);
        r.state = res.state;
        // no operator: actions have no effect (a lowering hook does not grab on its own)
      }
    }
    if (moving > this.usage.maxMachinesMoving) this.usage.maxMachinesMoving = moving;
    this.tickMixers(now);
  }

  /** Once a second: idle put-out (60 s), operators who lost crew membership, piece conservation. */
  second(now: number): void {
    for (const r of this.recs) {
      if (!r.operator) {
        this.outsiderSince.delete(r.state.id);
        continue;
      }
      const s = this.room.sessions.get(r.operator);
      if (!s || s.machine !== r.state.id) {
        r.operator = '';
        this.syncPlot(plotOfMachine(r.state.id));
        continue;
      }
      if (s.state !== 'active') {
        this.exit(s, 'disconnect');
        continue;
      }
      if (s.crewPlot !== plotOfMachine(r.state.id)) {
        const since = this.outsiderSince.get(r.state.id) ?? now;
        this.outsiderSince.set(r.state.id, since);
        if (now - since > OUTSIDER_GRACE_MS) this.audit.machineOutsiderOps++;
        this.exit(s, 'leftCrew');
        continue;
      }
      this.outsiderSince.delete(r.state.id);
      if (now - s.lastMachineInputAt > this.w.machineIdleExitS() * 1000) this.exit(s, 'idle');
    }
    this.checkConservation();
  }

  /** heldPiecesLost: every hooked/pallet piece is held by exactly the machine whose load lists it. */
  private checkConservation(): void {
    const held = new Map<MachineId, PieceTypeId[]>();
    for (const p of this.w.pieces.values()) {
      if (p.state !== 'hooked' && p.state !== 'pallet') continue;
      const list = held.get(p.heldBy) ?? [];
      list.push(p.type);
      held.set(p.heldBy, list);
    }
    for (const r of this.recs) {
      const l = r.state.load;
      const want = l.kind === 'hook' ? [l.piece] : l.kind === 'pallet' ? [...l.pieces] : [];
      const got = held.get(r.state.id) ?? [];
      held.delete(r.state.id);
      if (want.length !== got.length || want.some((t, i) => got[i] !== t)) {
        this.audit.heldPiecesLost++;
        console.warn('[machines] held pieces out of sync', r.state.id, want, got);
      }
    }
    for (const [id, list] of held) {
      this.audit.heldPiecesLost += list.length;
      console.warn('[machines] orphan held pieces', id, list);
    }
  }

  // ------------------------------------------------------------------ actions

  private act(r: MachineRec, act: MachineActKind): void {
    const plot = plotOfMachine(r.state.id);
    const R2 = ACT_RADIUS * ACT_RADIUS;
    for (const o of this.room.sessions.values()) {
      const dx = o.worker.x - r.state.x;
      const dz = o.worker.z - r.state.z;
      if (dx * dx + dz * dz <= R2) this.room.sendTo(o, 'machineAct', { id: r.state.id, act, plot });
    }
  }

  private setLoad(r: MachineRec, load: MachineState['load']): void {
    r.state = { ...r.state, load };
    this.syncPlot(plotOfMachine(r.state.id));
  }

  onAction(r: MachineRec, action: MachineAction, s: Session, now: number): void {
    const plot = plotOfMachine(r.state.id);
    const b = this.w.plots[plot];
    const spots = SITE.machines[plot]!;
    switch (action) {
      case 'scoop':
        if (b && groundworkPart(b.progress) === 'dig') {
          this.setLoad(r, { kind: 'dirt' });
          this.act(r, 'scoop');
        }
        return;
      case 'dump': {
        if (r.state.load.kind !== 'dirt') return;
        this.setLoad(r, { kind: 'none' });
        if (b && atSpoil(r.state, spots) && groundworkPart(b.progress) === 'dig') {
          b.progress = dig(b.progress);
          this.w.saveBuilding(b);
          this.w.syncPlot(plot);
          this.w.emitGround(b);
          this.act(r, 'dump');
        } else this.act(r, 'dumpBack');
        return;
      }
      case 'hookDown':
        if (r.state.load.kind === 'hook') this.release(r, s, now);
        else this.grab(r);
        return;
      case 'loadPallet':
        this.loadPallet(r);
        return;
      case 'unloadPallet':
        this.unloadPallet(r, s, now);
        return;
      case 'mix':
        if (!b || b.mixerBags <= 0 || b.mixerMixUntil > 0) return;
        b.mixerMixUntil = now + MACHINE.mixer.mixS * 1000;
        this.w.syncPlot(plot);
        this.act(r, 'mixStart');
        return;
      default:
        return;
    }
  }

  /** The hook grabs the nearest loose piece within 0.8 m below it (FR-025). */
  private grab(r: MachineRec): void {
    const spots = SITE.machines[plotOfMachine(r.state.id)]!;
    const h = hookPos(r.state, spots);
    const R = MACHINE.crane.grabRadius;
    let best: { id: number; d: number } | null = null;
    for (const p of this.w.pieces.values()) {
      if (p.state !== 'loose') continue;
      const d = (p.x - h.x) * (p.x - h.x) + (p.z - h.z) * (p.z - h.z);
      if (d <= R * R && (!best || d < best.d)) best = { id: p.id, d };
    }
    if (!best) return;
    const p = this.w.pieces.get(best.id)!;
    this.w.holdPiece(p.id, r.state.id, 'hooked');
    this.setLoad(r, { kind: 'hook', piece: p.type });
    this.act(r, 'hookGrab');
  }

  /** Release: snap into the slot in range (FR-027), else set the piece down below the hook. */
  private release(r: MachineRec, s: Session, now: number): void {
    const load = r.state.load;
    if (load.kind !== 'hook') return;
    const plot = plotOfMachine(r.state.id);
    const spots = SITE.machines[plot]!;
    const def = SITE.plots[plot]!;
    const b = this.w.plots[plot];
    const h = hookPos(r.state, spots);
    const piece = this.w.heldPieces(r.state.id)[0];
    this.setLoad(r, { kind: 'none' });
    this.act(r, 'hookRelease');
    if (!piece) return;
    const slot = b && b.state === 'building' ? snapTarget(h, load.piece, openSlotRefs(def, spots, b.progress)) : null;
    if (b && slot) {
      this.w.consumeHeld(piece.id);
      if (slot.type === 'concrete') this.w.pourConcrete(s, b, now);
      else if (this.w.deliverPiece(s, b, load.piece, slot.x, slot.z, now, 'crane', { high: slot.high })) this.usage.craneSnaps++;
      return;
    }
    const at = setDownSpot(h.x, h.z, this.ctxFor(plot));
    this.w.releasePiece(piece.id, at.x, at.z, now, s.pid);
  }

  /** How many pieces of `type` a pallet should take for the plot right now (FR-029). */
  private palletCount(plot: number, type: PieceTypeId): number {
    const b = this.w.plots[plot];
    if (!b || b.state !== 'building' || type === 'concrete' || type === 'cone') return 0;
    if (neededSupply(b.progress) !== type) return 0;
    if (type === 'cement') return Math.min(MACHINE.forklift.palletMax, Math.max(0, CLOCK_TOWER.groundwork.concrete - b.progress.groundPoured - b.mixerBags));
    const open = openSlots(b.progress);
    return Math.min(MACHINE.forklift.palletMax, open.hand > 0 ? open.hand : open.high);
  }

  private loadPallet(r: MachineRec): void {
    if (r.state.load.kind !== 'none') return;
    const plot = plotOfMachine(r.state.id);
    const rack = SITE.racks[rackAtForks(r.state, SITE)];
    if (!rack) return;
    const n = this.palletCount(plot, rack.type);
    if (n <= 0) return;
    const pieces: PieceTypeId[] = [];
    for (let i = 0; i < n; i++) {
      this.w.spawnHeld(rack.type, r.state.id, 'pallet');
      pieces.push(rack.type);
    }
    this.setLoad(r, { kind: 'pallet', pieces });
    this.act(r, 'palletLoad');
  }

  private unloadPallet(r: MachineRec, s: Session, now: number): void {
    const load = r.state.load;
    if (load.kind !== 'pallet') return;
    const plot = plotOfMachine(r.state.id);
    const def = SITE.plots[plot]!;
    const spots = SITE.machines[plot]!;
    const b = this.w.plots[plot];
    const tip = toolTip(r.state);
    const held = this.w.heldPieces(r.state.id);
    this.setLoad(r, { kind: 'none' });
    this.act(r, 'palletUnload');
    const inZone = Math.hypot(tip.x - def.x, tip.z - def.z) <= def.buildZoneRadius;
    const atHopper = Math.hypot(tip.x - spots.mixer.hopper.x, tip.z - spots.mixer.hopper.z) <= spots.mixer.hopperRadius + MACHINE.forklift.rackReach + 0.5;
    const ctx = this.ctxFor(plot);
    let k = 0;
    for (const p of held) {
      if (b && b.state === 'building' && inZone && p.type !== 'cement') {
        // one hand slot per piece, never high slots (FR-030)
        this.w.consumeHeld(p.id);
        if (this.w.deliverPiece(s, b, p.type, tip.x, tip.z, now, 'forklift', undefined, true)) {
          this.usage.forkliftSnaps++;
          continue;
        }
        // no free matching slot: put it down beside the plot
        const d = this.besidePlot(plot, k++);
        this.w.addLoose(p.type, d.x, d.z, now, s.pid);
        continue;
      }
      if (b && atHopper && p.type === 'cement' && b.mixerBags < MACHINE.mixer.capacity && b.mixerMixUntil === 0) {
        this.w.consumeHeld(p.id);
        this.w.addMixerBag(b);
        continue;
      }
      // anywhere else: the pallet's pieces become loose pieces around the forks
      const o = 0.5 * k++;
      const at = setDownSpot(tip.x + (k % 2 ? o : -o), tip.z, ctx);
      this.w.releasePiece(p.id, at.x, at.z, now, s.pid);
    }
  }

  /** A walkable spot just outside the plot's build zone, spaced per piece. */
  besidePlot(plot: number, k: number): { x: number; z: number } {
    const def = SITE.plots[plot]!;
    const r = def.buildZoneRadius + 0.6;
    const a = (k - 1.5) * 0.35;
    // the plot front (toward the plaza) in three.js = (s, c), rotated by a
    const fx = def.s * Math.cos(a) + def.c * Math.sin(a);
    const fz = -def.s * Math.sin(a) + def.c * Math.cos(a);
    return setDownSpot(def.x + fx * r, def.z + fz * r, this.ctxFor(plot));
  }

  /** Sets down whatever the machine holds (put-out, plot cleared). `actorPid` = null: nobody's piece. */
  setDownLoad(r: MachineRec, actorPid: string | null): void {
    const load = r.state.load;
    if (load.kind === 'dirt') {
      this.setLoad(r, { kind: 'none' }); // dumped back where it came from
      return;
    }
    if (load.kind !== 'hook' && load.kind !== 'pallet') return;
    const plot = plotOfMachine(r.state.id);
    const ctx = this.ctxFor(plot);
    const spots = SITE.machines[plot]!;
    const at = load.kind === 'hook' ? hookPos(r.state, spots) : toolTip(r.state);
    const now = this.room.now();
    let k = 0;
    for (const p of this.w.heldPieces(r.state.id)) {
      const o = 0.5 * k++;
      const d = setDownSpot(at.x + (k % 2 ? o : -o), at.z, ctx);
      this.w.releasePiece(p.id, d.x, d.z, now, actorPid ?? '');
    }
    this.setLoad(r, { kind: 'none' });
  }

  // ------------------------------------------------------------------ mixer

  /** A mix finishes: one loose concrete bucket per bag at the chute, then the drum is empty. */
  private tickMixers(now: number): void {
    for (const b of this.w.plots) {
      if (!b || b.mixerMixUntil === 0 || now < b.mixerMixUntil) continue;
      const spots = SITE.machines[b.plot]!;
      const ctx = this.ctxFor(b.plot);
      const n = b.mixerBags;
      for (let i = 0; i < n; i++) {
        const o = (i - (n - 1) / 2) * 0.55;
        const dx = spots.mixer.chute.x - spots.mixer.x;
        const dz = spots.mixer.chute.z - spots.mixer.z;
        const l = Math.hypot(dx, dz) || 1;
        const at = setDownSpot(spots.mixer.chute.x + (-dz / l) * o + (dx / l) * 0.3, spots.mixer.chute.z + (dx / l) * o + (dz / l) * 0.3, ctx);
        this.w.addLoose('concrete', at.x, at.z, now, '');
      }
      b.mixerBags = 0;
      b.mixerMixUntil = 0;
      this.w.saveBuilding(b);
      this.w.syncPlot(b.plot);
      const r = this.recs[b.plot * MACHINES_PER_PLOT + 3]!;
      this.act(r, 'mixDone');
    }
  }

  /** Is (x, z) at a plot's mixer hopper? Returns the plot, or -1. */
  hopperAt(x: number, z: number): number {
    for (const m of SITE.machines) {
      const dx = x - m.mixer.hopper.x;
      const dz = z - m.mixer.hopper.z;
      if (dx * dx + dz * dz <= m.mixer.hopperRadius * m.mixer.hopperRadius) return m.plot;
    }
    return -1;
  }

  // ------------------------------------------------------------------ dev cheats

  devPose(id: MachineId, pose: { x?: number; z?: number; yaw?: number; p1?: number; p2?: number; p3?: number }): void {
    const r = this.recs[id];
    if (!r) return;
    const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    r.state = { ...r.state, x: num(pose.x, r.state.x), z: num(pose.z, r.state.z), yaw: num(pose.yaw, r.state.yaw), p1: num(pose.p1, r.state.p1), p2: num(pose.p2, r.state.p2), p3: num(pose.p3, r.state.p3) };
    const s = r.operator ? this.room.sessions.get(r.operator) : undefined;
    if (s) {
      this.seat(s, r);
      this.room.sendTo(s, 'correction', { reason: 'respawn' });
    }
  }

  /** For tests and the debug API. */
  kindOf(id: MachineId) {
    return kindOfMachine(id);
  }

  /** Distance helper for tests: is the excavator bucket over the pit? */
  pitDistance(id: MachineId): number {
    const r = this.recs[id]!;
    const t = toolTip(r.state);
    return distToSquare(SITE.machines[plotOfMachine(id)]!.pit, t.x, t.z);
  }
}
