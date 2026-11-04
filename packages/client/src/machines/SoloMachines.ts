import * as THREE from 'three';
import {
  CLOCK_TOWER, MACHINE, MACHINE_KINDS, SIM_DT, atPit, atSpoil, exitSpot, groundworkPart, hookPos, machineBusy, machineCtx, machineId,
  neededSupply, openSlotRefs, openSlots, parkedState, rackAtForks, seatPose, setDownSpot, snapTarget, stepMachine, toolTip,
  type MachineAction, type MachineCtx, type MachineKind, type MachineState, type MoveInput, type ObstacleBox, type PieceTypeId,
  type SiteLayout, type SlotRef,
} from '@hht/shared';
import type { Piece, PieceManager } from '../game/pieceManager.ts';
import type { TowerPlot } from '../game/towerPlot.ts';

export interface SoloMachineEvents {
  act(kind: MachineKind, act: 'scoop' | 'dump' | 'dumpBack' | 'hookGrab' | 'hookRelease' | 'palletLoad' | 'palletUnload' | 'mixStart' | 'mixDone' | 'bagIn' | 'mixerFull'): void;
}

const NEUTRAL: MoveInput = Object.freeze({ seq: 0, dx: 0, dz: 0, run: false, jump: false, act: false, alt: false });

/**
 * The four solo machines (feature 003, research M16): the same shared `stepMachine()` and the same
 * progression rules as the multiplayer server, applied to the solo Rapier pieces. Hooked and pallet
 * pieces leave the physics world while held and come back as dynamic bodies at `setDownSpot()`.
 * The player has every permission a Host has (FR-042).
 */
export class SoloMachines {
  readonly states: MachineState[];
  seated = -1;
  mixerBags = 0;
  mixerMixUntil = 0;
  private acc = 0;
  private actQueued = false;
  private readonly actTimes: number[] = [];
  /** previous state (render interpolation) */
  readonly prev: MachineState[];
  blockers: ObstacleBox[] = [];
  private readonly v = new THREE.Vector3();

  constructor(
    readonly site: SiteLayout,
    private readonly pieces: PieceManager,
    private readonly plot: TowerPlot,
    private readonly events: SoloMachineEvents,
  ) {
    const spots = site.machines[0]!;
    this.states = MACHINE_KINDS.map((k) => parkedState(machineId(0, k), spots));
    this.prev = [...this.states];
    this.syncMixerLoad();
  }

  get spots() {
    return this.site.machines[0]!;
  }

  ctx(): MachineCtx {
    return machineCtx(this.site, 0, this.blockers, this.plot.progress.completedStages);
  }

  kindAt(id: number): MachineKind {
    return this.states[id]!.kind;
  }

  /** Back to the parking spots, empty (Build again). */
  reset(): void {
    const spots = this.spots;
    for (let i = 0; i < this.states.length; i++) this.states[i] = parkedState(machineId(0, MACHINE_KINDS[i]!), spots);
    this.prev.splice(0, this.prev.length, ...this.states);
    this.mixerBags = 0;
    this.mixerMixUntil = 0;
    this.seated = -1;
    this.syncMixerLoad();
  }

  private syncMixerLoad(): void {
    const m = this.states[3]!;
    if (m.load.kind !== 'bags' || m.load.count !== this.mixerBags) this.states[3] = { ...m, load: { kind: 'bags', count: this.mixerBags } };
  }

  /** The nearest machine whose cab is within reach, or -1. */
  enter(id: number): void {
    this.seated = id;
    this.acc = 0;
    this.actTimes.length = 0;
  }

  /** Gets out (jump): the load is set down safely (FR-011); returns where the worker stands. */
  exit(): { x: number; z: number; yaw: number } | null {
    const id = this.seated;
    if (id < 0) return null;
    this.seated = -1;
    this.setDownLoad(id);
    return exitSpot(this.states[id]!, this.ctx());
  }

  /** Press action (queued to the next 60 Hz step; ≤ 4 per second like the server). */
  pressAct(now: number): void {
    while (this.actTimes.length && (this.actTimes[0] as number) < now - 1000) this.actTimes.shift();
    if (this.actTimes.length >= MACHINE.actPerSecond) return;
    this.actTimes.push(now);
    this.actQueued = true;
  }

  /** Advance the machines by `dt` with the seated stick axes (`ax` right, `az` forward). */
  update(dt: number, ax: number, az: number, now: number): void {
    this.acc = Math.min(this.acc + dt, SIM_DT * 6);
    const ctx = this.ctx();
    for (let i = 0; i < this.states.length; i++) this.prev[i] = this.states[i]!;
    while (this.acc >= SIM_DT) {
      this.acc -= SIM_DT;
      for (let i = 0; i < this.states.length; i++) {
        const s = this.states[i]!;
        const seated = i === this.seated;
        if (!seated && !machineBusy(s)) continue;
        const input: MoveInput = seated
          ? { ...NEUTRAL, dx: Math.round(Math.max(-1, Math.min(1, ax)) * 127), dz: Math.round(Math.max(-1, Math.min(1, az)) * 127), act: this.actQueued }
          : NEUTRAL;
        if (seated) this.actQueued = false;
        const r = stepMachine(s, input, SIM_DT, ctx);
        this.states[i] = r.state;
        if (r.action && seated) this.onAction(i, r.action, now);
      }
    }
    this.tickHopper();
    this.tickMixer(now);
  }

  /** Where the seated worker sits. */
  seat(): { x: number; y: number; z: number; yaw: number } | null {
    return this.seated >= 0 ? seatPose(this.states[this.seated]!, this.spots) : null;
  }

  // ---------------------------------------------------------------- actions (same rules as the server's MachineSystem)

  private setLoad(i: number, load: MachineState['load']): void {
    this.states[i] = { ...this.states[i]!, load };
  }

  private onAction(i: number, action: MachineAction, now: number): void {
    const s = this.states[i]!;
    const spots = this.spots;
    switch (action) {
      case 'scoop':
        if (groundworkPart(this.plot.progress) === 'dig') {
          this.setLoad(i, { kind: 'dirt' });
          this.events.act('excavator', 'scoop');
        }
        return;
      case 'dump':
        this.setLoad(i, { kind: 'none' });
        if (atSpoil(s, spots) && groundworkPart(this.plot.progress) === 'dig') {
          this.plot.dig();
          this.events.act('excavator', 'dump');
        } else this.events.act('excavator', 'dumpBack');
        return;
      case 'hookDown':
        if (s.load.kind === 'hook') this.release(i);
        else this.grab(i);
        return;
      case 'loadPallet':
        this.loadPallet(i);
        return;
      case 'unloadPallet':
        this.unloadPallet(i);
        return;
      case 'mix':
        if (this.mixerBags > 0 && this.mixerMixUntil === 0) {
          this.mixerMixUntil = now + MACHINE.mixer.mixS * 1000;
          this.events.act('mixer', 'mixStart');
        }
        return;
      default:
        return;
    }
  }

  private grab(i: number): void {
    const h = hookPos(this.states[i]!, this.spots);
    const R = MACHINE.crane.grabRadius;
    let best: Piece | null = null;
    let bd = R * R;
    for (const p of this.pieces.loose()) {
      if (p.fade > 0) continue;
      const d = (p.position.x - h.x) ** 2 + (p.position.z - h.z) ** 2;
      if (d <= bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) return;
    this.pieces.remove(best);
    this.setLoad(i, { kind: 'hook', piece: best.type });
    this.events.act('crane', 'hookGrab');
  }

  /** The slot a release would fill right now (also the lit ring). */
  snapSlot(): SlotRef | null {
    const s = this.states[0]!;
    if (s.load.kind !== 'hook') return null;
    const def = this.site.plots[0]!;
    return snapTarget(hookPos(s, this.spots), s.load.piece, openSlotRefs(def, this.spots, this.plot.progress, CLOCK_TOWER));
  }

  private release(i: number): void {
    const s = this.states[i]!;
    if (s.load.kind !== 'hook') return;
    const type = s.load.piece;
    const slot = this.snapSlot();
    this.setLoad(i, { kind: 'none' });
    this.events.act('crane', 'hookRelease');
    if (slot) {
      if (slot.type === 'concrete') this.plot.pourConcrete(null);
      else this.plot.deliverPiece(type, null, 'crane', { high: slot.high });
      return;
    }
    const h = hookPos(s, this.spots);
    this.drop(type, setDownSpot(h.x, h.z, this.ctx()));
  }

  private drop(type: PieceTypeId, at: { x: number; z: number }): void {
    const p = this.pieces.create(type, 'held', this.v.set(at.x, 0.4, at.z));
    this.pieces.release(p, this.v.set(at.x, 0.4, at.z), new THREE.Quaternion());
  }

  private loadPallet(i: number): void {
    const s = this.states[i]!;
    if (s.load.kind !== 'none') return;
    const rack = this.site.racks[rackAtForks(s, this.site)];
    if (!rack) return;
    const pr = this.plot.progress;
    if (neededSupply(pr) !== rack.type || rack.type === 'concrete' || rack.type === 'cone') return;
    const open = openSlots(pr);
    const n = rack.type === 'cement'
      ? Math.min(MACHINE.forklift.palletMax, Math.max(0, CLOCK_TOWER.groundwork.concrete - pr.groundPoured - this.mixerBags))
      : Math.min(MACHINE.forklift.palletMax, open.hand > 0 ? open.hand : open.high);
    if (n <= 0) return;
    this.setLoad(i, { kind: 'pallet', pieces: Array.from({ length: n }, () => rack.type) });
    this.events.act('forklift', 'palletLoad');
  }

  private unloadPallet(i: number): void {
    const s = this.states[i]!;
    if (s.load.kind !== 'pallet') return;
    const tip = toolTip(s);
    const def = this.site.plots[0]!;
    const spots = this.spots;
    const inZone = Math.hypot(tip.x - def.x, tip.z - def.z) <= def.buildZoneRadius;
    const atHopper = Math.hypot(tip.x - spots.mixer.hopper.x, tip.z - spots.mixer.hopper.z) <= spots.mixer.hopperRadius + MACHINE.forklift.rackReach + 0.5;
    const ctx = this.ctx();
    let k = 0;
    for (const type of s.load.pieces) {
      if (inZone && type !== 'cement') {
        const r = this.plot.deliverPiece(type, null, 'forklift');
        if (r === 'snapped' || r === 'stageComplete' || r === 'masterpiece') continue;
      }
      if (atHopper && type === 'cement' && this.mixerBags < MACHINE.mixer.capacity && this.mixerMixUntil === 0) {
        this.mixerBags++;
        this.syncMixerLoad();
        continue;
      }
      const o = 0.5 * k++;
      this.drop(type, setDownSpot(tip.x + (k % 2 ? o : -o), tip.z + (inZone ? 0 : 0), ctx));
    }
    this.setLoad(i, { kind: 'none' });
    this.events.act('forklift', 'palletUnload');
  }

  /** Sets down whatever a machine holds (getting out, Build again). */
  private setDownLoad(i: number): void {
    const s = this.states[i]!;
    const load = s.load;
    if (load.kind === 'dirt') this.setLoad(i, { kind: 'none' });
    if (load.kind !== 'hook' && load.kind !== 'pallet') return;
    const at = load.kind === 'hook' ? hookPos(s, this.spots) : toolTip(s);
    const types = load.kind === 'hook' ? [load.piece] : load.pieces;
    const ctx = this.ctx();
    types.forEach((t, k) => this.drop(t, setDownSpot(at.x + (k % 2 ? 0.5 : -0.5) * k, at.z, ctx)));
    this.setLoad(i, { kind: 'none' });
  }

  /** Cement bags dropped or tossed into the hopper become mixer bags (FR-019); a full mixer bounces them. */
  private tickHopper(): void {
    const h = this.spots.mixer.hopper;
    const R = this.spots.mixer.hopperRadius;
    for (const p of this.pieces.loose()) {
      if (p.type !== 'cement' || p.rejected || p.fade > 0) continue;
      if ((p.position.x - h.x) ** 2 + (p.position.z - h.z) ** 2 > R * R) continue;
      if (this.mixerBags >= MACHINE.mixer.capacity || this.mixerMixUntil > 0) {
        p.rejected = true;
        p.body?.setLinvel({ x: p.position.x - this.spots.mixer.x, y: 3, z: p.position.z - this.spots.mixer.z }, true);
        this.events.act('mixer', 'mixerFull');
        continue;
      }
      this.pieces.remove(p);
      this.mixerBags++;
      this.syncMixerLoad();
      this.events.act('mixer', 'bagIn');
    }
    for (const p of this.pieces.loose()) if (p.rejected && p.type === 'cement' && (p.position.x - h.x) ** 2 + (p.position.z - h.z) ** 2 > (R + 0.5) ** 2) p.rejected = false;
  }

  /** A mix ends: one concrete bucket per bag at the chute. */
  private tickMixer(now: number): void {
    if (this.mixerMixUntil === 0 || now < this.mixerMixUntil) return;
    const sp = this.spots;
    const n = this.mixerBags;
    const ctx = this.ctx();
    for (let k = 0; k < n; k++) {
      const o = (k - (n - 1) / 2) * 0.55;
      const dx = sp.mixer.chute.x - sp.mixer.x;
      const dz = sp.mixer.chute.z - sp.mixer.z;
      const l = Math.hypot(dx, dz) || 1;
      this.drop('concrete', setDownSpot(sp.mixer.chute.x + (-dz / l) * o + (dx / l) * 0.3, sp.mixer.chute.z + (dx / l) * o + (dz / l) * 0.3, ctx));
    }
    this.mixerBags = 0;
    this.mixerMixUntil = 0;
    this.syncMixerLoad();
    this.events.act('mixer', 'mixDone');
  }

  /** The next machine action, named on the prompt (contracts/controls.md). */
  label(): { text: string; disabled: boolean } {
    const i = this.seated;
    if (i < 0) return { text: '', disabled: true };
    const s = this.states[i]!;
    const spots = this.spots;
    const pr = this.plot.progress;
    switch (s.kind) {
      case 'excavator':
        if (s.phase !== 'idle') return { text: s.phase === 'lowering' ? 'Scooping…' : 'Dumping…', disabled: true };
        if (s.load.kind === 'dirt') return { text: atSpoil(s, spots) ? 'Dump' : 'Dump (not the heap)', disabled: false };
        if (groundworkPart(pr) !== 'dig') return { text: 'The pit is dug', disabled: true };
        return atPit(s, spots) ? { text: 'Scoop', disabled: false } : { text: 'Move closer to the pit', disabled: true };
      case 'forklift': {
        if (s.load.kind === 'pallet') return { text: `Unload ${s.load.pieces.length}`, disabled: false };
        const rack = this.site.racks[rackAtForks(s, this.site)];
        if (!rack) return { text: 'Drive to a rack', disabled: true };
        if (neededSupply(pr) !== rack.type) return { text: 'Not needed', disabled: true };
        return { text: `Load ${rack.type}`, disabled: false };
      }
      case 'crane':
        if (s.phase !== 'idle') return { text: s.phase === 'lowering' ? 'Lowering…' : 'Raising…', disabled: true };
        return s.load.kind === 'hook' ? { text: this.snapSlot() ? 'Release · it snaps!' : 'Release', disabled: false } : { text: 'Grab', disabled: false };
      case 'mixer':
        if (this.mixerMixUntil > 0) return { text: 'Mixing…', disabled: true };
        return this.mixerBags > 0 ? { text: `Mix (${this.mixerBags} bag${this.mixerBags === 1 ? '' : 's'})`, disabled: false } : { text: 'Add cement bags', disabled: true };
    }
  }
}
