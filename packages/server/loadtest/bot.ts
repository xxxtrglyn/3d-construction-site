import { Client, type Room } from '@colyseus/sdk';
import {
  CHAT, CLOCK_TOWER, EMOTE_IDS, MACHINE, MACHINE_KINDS, PROTOCOL_VERSION, QUICK_MESSAGE_IDS, SITE, decodeSnapshot, encodeMoveInputs,
  blueprintById, entryPoint, generateName, groundworkPart, isBlueprintId, machineId, neededSupplies, needsOf, openSlots, palletSize, parkedState, quantizeDir, randomHatColor, seededRng,
  rackAtForks, toolTip,
  type MachineKind, type MoveInput, type OwnMachine, type PieceTypeId, type Rng, type TowerProgress, type WorkerState,
} from '@hht/shared';
import { carTo, craneGoal, excavatorReady, forkliftReturn, forkliftRoute, hookTo, rackApproach, tankTo, toState } from './machineBot.ts';

/** Counters a bot reports to the runner. */
export interface BotStats {
  bytesIn: number;
  bytesOut: number;
  behaviors: Record<string, number>;
  rtts: number[];
  chatOutsideChannel: number;
  /** Chats that looked out of channel on arrival but were fine once the next patch landed (ordering race). */
  chatRechecked: number;
  disconnects: number;
  connected: boolean;
  /** feature 003: outsider probes that were let into another crew's machine (must stay 0) */
  machineOutsiderOps: number;
}

interface PlotView {
  state: string;
  blueprintId: string;
  completedStages: number;
  filledA: number;
  filledB: number;
  joinMode: string;
  crewSize: number;
  hostSession: string;
  groundDug: number;
  groundPoured: number;
  highFilled: number;
  mixerBags: number;
  mixerMixUntil: number;
  machineOps: ArrayLike<string>;
  hookType: string;
}

type Mode = 'idle' | 'toForeman' | 'toSign' | 'fetch' | 'deliver' | 'donate' | 'wander' | 'toMachine' | 'pickUp';

interface MachineJob {
  id: number;
  kind: MachineKind;
  /** outsider permission probe (must be refused) */
  probe: boolean;
  sent: boolean;
  startedAt: number;
  step: number;
  lastActAt: number;
  idleSince: number;
  /** forklift: the rack yard used, and a stuck detector */
  yard?: number;
  lastPos?: { x: number; z: number; at: number };
  unstickUntil?: number;
}

/** The forks are at this rack (shared rule). */
const rackAtForksNear = (s: ReturnType<typeof toState>, rack: number): boolean => rackAtForks(s, SITE) === rack;

const progressOf = (p: PlotView): TowerProgress => {
  const blueprintId = isBlueprintId(p.blueprintId) ? p.blueprintId : CLOCK_TOWER.id;
  const st = blueprintById(blueprintId).stages[p.completedStages];
  const ab = [p.filledA ?? 0, p.filledB ?? 0];
  return {
    blueprintId, completedStages: p.completedStages, filled: st ? st.recipe.map((_, i) => ab[i] ?? 0) : [],
    groundDug: p.groundDug ?? 0, groundPoured: p.groundPoured ?? 0, highFilled: p.highFilled ?? 0,
  };
};

/** feature 004 (research R12): a needed material, weighted by how many are still left, so crews spread over both racks. */
const pickNeed = (progress: TowerProgress, rng: () => number): PieceTypeId | null => {
  const sup = neededSupplies(progress);
  if (sup[0] === 'cement' || sup.length <= 1) return sup[0] ?? null;
  const needs = needsOf(progress).filter((n) => !n.done);
  const total = needs.reduce((a, n) => a + n.left, 0);
  let r = rng() * total;
  for (const n of needs) {
    r -= n.left;
    if (r < 0) return n.type;
  }
  return needs[0]?.type ?? null;
};

/** feature 004: the material that fills the biggest forklift pallet right now. */
const forkliftNeed = (progress: TowerProgress, mixerBags: number): PieceTypeId | null => {
  let best: PieceTypeId | null = null;
  let bn = 0;
  for (const t of neededSupplies(progress)) {
    const n = palletSize(progress, t, mixerBags);
    if (n > bn) {
      bn = n;
      best = t;
    }
  }
  return best;
};

const CHAT_LINES = ['need bricks over here', 'who has beams?', 'nice work crew', 'almost done!', 'stage up!', 'bringing paint', 'lets go', 'thanks!'];

/**
 * A headless player for the 100-bot load test (research R12): moves with real inputs at 60/s,
 * hosts (≈10 %), asks to join crews, fetches and delivers needed pieces, donates, emotes and chats.
 */
export class Bot {
  readonly id: number;
  private readonly rng: Rng;
  private room!: Room;
  private me = '';
  private own: WorkerState | null = null;
  private seq = 1;
  private mode: Mode = 'idle';
  private target = { x: 0, z: 0 };
  private targetPlot = -1;
  private wantType: PieceTypeId | null = null;
  private timers: NodeJS.Timeout[] = [];
  private nextSocial = 0;
  private nextChat = 0;
  private modeSince = 0;
  private readonly host: boolean;
  private readonly remote = new Map<string, { x: number; z: number }>();
  private netToPid = new Map<number, string>();
  readonly stats: BotStats = { bytesIn: 0, bytesOut: 0, behaviors: {}, rtts: [], chatOutsideChannel: 0, chatRechecked: 0, disconnects: 0, connected: false, machineOutsiderOps: 0 };
  // feature 003: machines
  private ownMachine: OwnMachine | null = null;
  private job: MachineJob | null = null;
  private axes = { dx: 0, dz: 0 };
  private pendingAct = false;
  private pendingExit = false;
  /** where the carried piece goes: the build zone, the hook pad, the hopper or the pit */
  private dropTo: 'zone' | 'pad' | 'hopper' = 'zone';
  private pickId = -1;
  private readonly prober: boolean;
  /** last machine records seen (machines move: walk to where they are, not where they parked) */
  private readonly seenMachines = new Map<number, { x: number; z: number; yaw: number; p1: number }>();
  private readonly base: string;

  constructor(id: number, base: string, seed: number) {
    this.id = id;
    this.base = base;
    this.rng = seededRng(seed);
    this.host = id % 10 === 0;
    this.prober = id % 20 === 7; // ≈ 5 % try other crews' machines
  }

  private count(b: string): void {
    this.stats.behaviors[b] = (this.stats.behaviors[b] ?? 0) + 1;
  }

  /** True if a received chat is outside what this bot's channel rules allow (SC-008). */
  private chatLooksOutside(p: Record<string, unknown>): boolean {
    if (p.channel === 'crew') {
      const mine = this.state.players.get(this.me);
      const from = this.state.players.get(p.from as string);
      return !mine || !from || mine.crewPlot < 0 || mine.crewPlot !== from.crewPlot;
    }
    if (!this.own || p.from === this.me) return false;
    const r = this.remote.get(p.from as string);
    return !!r && Math.hypot(r.x - this.own.x, r.z - this.own.z) > CHAT.nearbyM + 8;
  }

  private send(type: string, payload: unknown): void {
    this.room.send(type, payload);
    this.stats.bytesOut += JSON.stringify(payload).length + type.length + 4;
  }

  async start(): Promise<void> {
    const key = Array.from({ length: 16 }, () => Math.floor(this.rng() * 256).toString(16).padStart(2, '0')).join('');
    const res = await fetch(`${this.base}/api/matchmake`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocol: PROTOCOL_VERSION, playerKey: key, name: generateName(this.rng), hatColor: randomHatColor(this.rng) }),
    });
    if (!res.ok) throw new Error(`matchmake ${res.status}`);
    const mm = (await res.json()) as { reservation: unknown };
    const client = new Client(`${this.base}/ws`);
    this.room = (await client.consumeSeatReservation(mm.reservation as never)) as Room;
    this.stats.connected = true;
    const ws = (this.room as unknown as { connection: { transport: { ws: { addEventListener?: (t: string, f: (e: { data: unknown }) => void) => void; on?: (t: string, f: (d: unknown) => void) => void } } } }).connection.transport.ws;
    const onData = (d: unknown): void => {
      const len = d instanceof ArrayBuffer ? d.byteLength : ArrayBuffer.isView(d) ? d.byteLength : typeof d === 'string' ? d.length : Array.isArray(d) ? d.reduce((s: number, x: { length: number }) => s + x.length, 0) : 0;
      this.stats.bytesIn += len + 4; // + websocket frame header
    };
    if (ws.on) ws.on('message', onData);
    else ws.addEventListener?.('message', (e) => onData(e.data));
    this.room.onMessage('*', (type: string | number, payload: unknown) => this.onMessage(String(type), payload));
    this.room.onLeave(() => {
      this.stats.connected = false;
      this.stats.disconnects++;
      this.stop();
    });
    const now = Date.now();
    this.nextSocial = now + 5000 + this.rng() * 20000;
    this.nextChat = now + 62_000 + this.rng() * 20_000;
    this.timers.push(setInterval(() => this.tickInputs(), 50));
    this.timers.push(setInterval(() => this.think(), 250));
    this.timers.push(setInterval(() => this.send('ping', { c: Date.now() }), 2000));
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  async leave(): Promise<void> {
    this.stop();
    await this.room?.leave(true).catch(() => undefined);
  }

  private get state(): { players: Map<string, { netId: number; crewPlot: number; crewRole: string }>; plots: PlotView[]; pieces: Map<string, { type: string; state: string; x: number; z: number }> } {
    return this.room.state as never;
  }

  private onMessage(type: string, payload: unknown): void {
    if (type === 'ws') {
      const u8 = payload as Uint8Array;
      const s = decodeSnapshot(new DataView(u8.buffer, u8.byteOffset, u8.byteLength));
      if (!s) return;
      this.own = s.own;
      this.ownMachine = s.ownMachine;
      for (const m of s.machines) this.seenMachines.set(m.id, { x: m.x, z: m.z, yaw: m.yaw, p1: m.p1 });
      if (this.netToPid.size !== this.state.players.size) {
        this.netToPid = new Map();
        this.state.players.forEach((p, pid) => this.netToPid.set(p.netId, pid));
      }
      for (const e of s.entities) {
        const pid = this.netToPid.get(e.netId);
        if (pid) this.remote.set(pid, { x: e.x, z: e.z });
      }
      return;
    }
    const p = payload as Record<string, unknown>;
    switch (type) {
      case 'welcome':
        this.me = p.sessionId as string;
        break;
      case 'pong':
        this.stats.rtts.push(Date.now() - (p.c as number));
        if (this.stats.rtts.length > 50) this.stats.rtts.shift();
        break;
      case 'request':
        if (p.op === 'incoming') this.send('crew', { op: 'answer', requester: p.requester, approve: this.rng() < 0.8 });
        break;
      case 'requestResult':
        if (p.result === 'joined') this.setMode('fetch');
        else if (p.result !== 'pending') this.setMode(this.rng() < 0.5 ? 'donate' : 'wander');
        break;
      case 'foreman':
        if (p.result === 'assigned' || p.result === 'adopted') this.setMode('fetch');
        else this.setMode('wander');
        break;
      case 'chat': {
        // Messages are sent at once but state patches and snapshots land on the next tick, so a chat
        // right after a crew join or from someone just entering interest range can look wrong on
        // arrival. Count it only if it still looks wrong once a few patches have landed.
        if (this.chatLooksOutside(p)) {
          setTimeout(() => {
            if (this.chatLooksOutside(p)) this.stats.chatOutsideChannel++;
            else this.stats.chatRechecked++;
          }, 300);
        }
        break;
      }
      case 'summary':
        this.setMode('idle');
        this.job = null;
        break;
      case 'machineResult':
        if (p.result === 'entered') {
          this.count('machineEnter');
          if (this.job?.probe) {
            this.stats.machineOutsiderOps++;
            this.pendingExit = true;
          }
          if (this.job) this.job.startedAt = Date.now();
        } else {
          this.job = null;
          this.setMode(this.myPlot() >= 0 ? 'fetch' : 'wander');
        }
        break;
      case 'machineExit':
        this.job = null;
        this.axes = { dx: 0, dz: 0 };
        this.setMode(this.myPlot() >= 0 ? 'fetch' : 'idle');
        break;
      default:
        break;
    }
  }

  private setMode(m: Mode): void {
    this.mode = m;
    this.modeSince = Date.now();
    this.wantType = null;
  }

  private myPlot(): number {
    return this.state.players.get(this.me)?.crewPlot ?? -1;
  }

  /** Steering: one 50 ms batch = 3 inputs (60/s). Seated: machine stick axes, `act` edges and jump = get out. */
  private tickInputs(): void {
    if (!this.own) return;
    const inputs: MoveInput[] = [];
    if (this.ownMachine) {
      for (let i = 0; i < 3; i++) {
        const act = i === 0 && this.pendingAct;
        const jump = i === 0 && this.pendingExit;
        inputs.push({ seq: this.seq, dx: this.axes.dx, dz: this.axes.dz, run: false, jump, act, alt: false });
        this.seq = (this.seq + 1) & 0xffff;
      }
      this.pendingAct = false;
      if (this.pendingExit) {
        this.pendingExit = false;
        this.ownMachine = null;
      }
    } else {
      const dx = this.target.x - this.own.x;
      const dz = this.target.z - this.own.z;
      const d = Math.hypot(dx, dz);
      const q = d > 0.6 ? quantizeDir(dx / d, dz / d) : { dx: 0, dz: 0 };
      const run = d > 6;
      const still = this.mode === 'toMachine' && !!this.job?.sent;
      for (let i = 0; i < 3; i++) {
        inputs.push({ seq: this.seq, dx: still ? 0 : q.dx, dz: still ? 0 : q.dz, run, jump: !still && this.rng() < 0.002, act: false, alt: false });
        this.seq = (this.seq + 1) & 0xffff;
      }
    }
    const bytes = encodeMoveInputs(inputs);
    this.room.sendBytes('in', bytes);
    this.stats.bytesOut += bytes.byteLength + 6;
  }

  private near(x: number, z: number, r: number): boolean {
    return !!this.own && Math.hypot(this.own.x - x, this.own.z - z) <= r;
  }

  private think(): void {
    if (!this.own || !this.me) return;
    const now = Date.now();
    if (now > this.nextSocial) {
      this.nextSocial = now + 20_000 + this.rng() * 20_000;
      if (this.rng() < 0.5) {
        this.send('emote', { id: EMOTE_IDS[Math.floor(this.rng() * EMOTE_IDS.length)] });
        this.count('emote');
      } else {
        this.send('say', { id: QUICK_MESSAGE_IDS[Math.floor(this.rng() * QUICK_MESSAGE_IDS.length)] });
        this.count('say');
      }
    }
    if (now > this.nextChat) {
      this.nextChat = now + 20_000 + this.rng() * 20_000;
      const crew = this.myPlot() >= 0 && this.rng() < 0.5;
      this.send('chat', { channel: crew ? 'crew' : 'nearby', text: `${CHAT_LINES[Math.floor(this.rng() * CHAT_LINES.length)]} ${this.id}-${Math.floor(now / 1000) % 1000}` });
      this.count('chat');
    }
    const plots = this.state.plots;
    const mine = this.myPlot();
    if (this.ownMachine) return this.operate(now);
    if (this.mode !== 'idle' && now - this.modeSince > 45_000) {
      this.job = null;
      this.setMode('idle');
    }
    switch (this.mode) {
      case 'idle':
        if (mine >= 0) return this.setMode('fetch');
        if (this.host) {
          this.target = { x: SITE.foreman.x, z: SITE.foreman.z + 1.2 };
          return this.setMode('toForeman');
        }
        if (this.prober && this.rng() < 0.5 && this.startProbe()) return;
        if (this.rng() < 0.5) {
          const open = plots.map((p, i) => ({ p, i })).filter(({ p }) => p.state === 'building' && p.joinMode !== 'solo' && p.crewSize > 0 && p.crewSize < 8);
          const pick = open[Math.floor(this.rng() * open.length)];
          if (pick) {
            this.targetPlot = pick.i;
            const d = SITE.plots[pick.i]!;
            this.target = { x: d.sign.x, z: d.sign.z };
            return this.setMode('toSign');
          }
        }
        return this.setMode(this.rng() < 0.4 ? 'donate' : 'wander');
      case 'toForeman':
        this.target = { x: SITE.foreman.x, z: SITE.foreman.z + 1.2 };
        if (this.near(this.target.x, this.target.z, 1.2)) {
          this.send('foreman', { op: 'start', blueprint: 'clock-tower' });
          this.count('foremanStart');
          this.modeSince = now - 40_000; // fall back to idle in 5 s if no answer
        }
        return;
      case 'toSign':
        if (this.near(this.target.x, this.target.z, 1.2)) {
          this.send('crew', { op: 'request', plot: this.targetPlot });
          this.count('request');
          this.modeSince = now - 10_000;
        }
        return;
      case 'toMachine': {
        const job = this.job;
        if (!job) return this.setMode(mine >= 0 ? 'fetch' : 'idle');
        if (now - job.startedAt > 20_000) {
          this.job = null;
          return this.setMode(mine >= 0 ? 'fetch' : 'idle');
        }
        const e = this.entryOf(job.id);
        this.target = e;
        if (!job.sent && this.near(e.x, e.z, 0.9) && !this.own.carrying) {
          job.sent = true;
          this.send('machine', { op: 'enter', id: job.id });
          if (job.probe) this.count('outsiderEnterTry');
        }
        return;
      }
      case 'pickUp': {
        const pc = this.state.pieces.get(String(this.pickId));
        if (!pc || pc.state !== 'loose' || this.own.carrying) {
          this.pickId = -1;
          return this.setModeKeep(this.own.carrying ? 'deliver' : 'fetch');
        }
        this.target = { x: pc.x, z: pc.z };
        if (this.near(pc.x, pc.z, 1.1)) this.send('grab', { target: { kind: 'piece', id: this.pickId } });
        return;
      }
      case 'fetch':
      case 'donate': {
        const plot = this.mode === 'fetch' ? mine : this.targetPlot >= 0 ? this.targetPlot : Math.floor(this.rng() * 12);
        if (this.mode === 'fetch' && plot < 0) return this.setMode('idle');
        this.targetPlot = plot;
        const p = plots[plot];
        if (this.own.carrying) return this.setModeKeep('deliver');
        if (this.mode === 'fetch' && p && p.state === 'building' && !this.wantType && this.planFetch(plot, p)) return;
        const progress = p ? progressOf(p) : null;
        const type = this.wantType ?? (progress ? pickNeed(progress, this.rng) ?? 'brick' : 'brick');
        this.wantType = type;
        let best = -1;
        let bd = Infinity;
        for (const r of SITE.racks) {
          if (r.type !== type) continue;
          const d = Math.hypot(r.x - this.own.x, r.z - this.own.z);
          if (d < bd) {
            bd = d;
            best = r.index;
          }
        }
        const r = SITE.racks[best];
        if (!r) return;
        this.target = { x: r.x, z: r.z };
        if (bd < 1.8) {
          this.send('grab', { target: { kind: 'rack', rack: r.index } });
          this.count('grab');
        }
        return;
      }
      case 'deliver': {
        if (!this.own.carrying) return this.setModeKeep(mine >= 0 ? 'fetch' : 'idle');
        const plot = this.targetPlot;
        const d = SITE.plots[plot];
        if (!d) return this.setMode('idle');
        const spots = SITE.machines[plot]!;
        const carrying = this.own.carrying;
        let into = mine === plot ? { x: d.x + Math.sin(d.yaw) * 2.2, z: d.z + Math.cos(d.yaw) * 2.2 } : { x: d.bin.x, z: d.bin.z };
        let reach = mine === plot ? 4 : 1.6;
        if (mine === plot && carrying === 'cement') {
          into = { x: spots.mixer.hopper.x, z: spots.mixer.hopper.z - 0.6 };
          reach = 0.5;
        } else if (mine === plot && this.dropTo === 'pad') {
          into = { x: spots.hookPad.x, z: spots.hookPad.z };
          reach = 0.6;
        } else if (mine === plot && carrying === 'concrete') {
          into = { x: d.x + Math.sin(d.yaw) * 1.6, z: d.z + Math.cos(d.yaw) * 1.6 };
          reach = 0.8;
        }
        this.target = into;
        if (this.near(into.x, into.z, reach)) {
          if (mine === plot && this.dropTo === 'zone' && carrying !== 'cement' && carrying !== 'concrete' && this.rng() < 0.3) {
            this.send('toss', { charge: 0.2 });
            this.count('toss');
          } else {
            this.send('drop', {});
            this.count(mine === plot ? (carrying === 'cement' ? 'bagIn' : carrying === 'concrete' ? 'pour' : this.dropTo === 'pad' ? 'toPad' : 'deliver') : 'donate');
          }
          this.dropTo = 'zone';
        }
        return;
      }
      case 'wander':
        if (this.near(this.target.x, this.target.z, 1.5) || this.rng() < 0.02) {
          const a = this.rng() * Math.PI * 2;
          const rr = 9 + this.rng() * 22;
          this.target = { x: Math.cos(a) * rr, z: Math.sin(a) * rr };
          if (this.rng() < 0.15) this.setMode('idle');
        }
        return;
    }
  }

  private setModeKeep(m: Mode): void {
    const t = this.targetPlot;
    const w = this.wantType;
    this.setMode(m);
    this.targetPlot = t;
    this.wantType = m === 'deliver' ? w : null;
  }

  // ---------------------------------------------------------------- machines (feature 003, research M14)

  private entryOf(id: number): { x: number; z: number } {
    const plot = Math.floor(id / 4);
    const parked = parkedState(id, SITE.machines[plot]!);
    const seen = this.seenMachines.get(id);
    return entryPoint(seen ? { ...parked, ...seen } : parked, SITE.machines[plot]!);
  }

  private opOf(p: PlotView, kind: MachineKind): string {
    return Array.from(p.machineOps ?? [])[MACHINE_KINDS.indexOf(kind)] ?? '';
  }

  private startJob(plot: number, kind: MachineKind, probe = false): boolean {
    const id = machineId(plot, kind);
    // the excavator and the forklift move: go to where they were parked at the start (they drive back on their own)
    this.job = { id, kind, probe, sent: false, startedAt: Date.now(), step: 0, lastActAt: 0, idleSince: Date.now() };
    this.setMode('toMachine');
    this.target = this.entryOf(id);
    return true;
  }

  private startProbe(): boolean {
    const others = this.state.plots.map((p, i) => ({ p, i })).filter(({ p, i }) => p.state === 'building' && i !== this.myPlot());
    const pick = others[Math.floor(this.rng() * others.length)];
    if (!pick) return false;
    return this.startJob(pick.i, (['crane', 'mixer'] as MachineKind[])[Math.floor(this.rng() * 2)]!, true);
  }

  private looseNear(x: number, z: number, r: number, type?: string): Array<{ id: number; type: string; x: number; z: number }> {
    const out: Array<{ id: number; type: string; x: number; z: number }> = [];
    this.state.pieces.forEach((v, k) => {
      if (v.state !== 'loose' || (type && v.type !== type)) return;
      if ((v.x - x) ** 2 + (v.z - z) ** 2 <= r * r) out.push({ id: Number(k), type: v.type, x: v.x, z: v.z });
    });
    return out;
  }

  /** A crew bot decides what its plot needs next (Groundwork, the crane, the forklift). True when it started something. */
  private planFetch(plot: number, p: PlotView): boolean {
    const progress = progressOf(p);
    const part = groundworkPart(progress);
    const spots = SITE.machines[plot]!;
    if (part === 'dig') {
      if (!this.opOf(p, 'excavator')) return this.startJob(plot, 'excavator');
      this.target = { x: spots.hookPad.x, z: spots.hookPad.z }; // wait near the plot
      return true;
    }
    if (part === 'concrete') {
      const buckets = this.looseNear(spots.center.x, spots.center.z, 9, 'concrete');
      if (buckets.length) {
        this.pickId = buckets[Math.floor(this.rng() * buckets.length)]!.id;
        this.setModeKeep('pickUp');
        return true;
      }
      const mixing = (p.mixerMixUntil ?? 0) > 0;
      if (p.mixerBags > 0 && !mixing && !this.opOf(p, 'mixer') && (p.mixerBags + progress.groundPoured >= CLOCK_TOWER.groundwork.concrete || this.rng() < 0.3)) {
        return this.startJob(plot, 'mixer');
      }
      if (mixing || p.mixerBags + progress.groundPoured >= CLOCK_TOWER.groundwork.concrete) {
        this.target = { x: spots.mixer.chute.x, z: spots.mixer.chute.z };
        return true;
      }
      if (!this.opOf(p, 'forklift') && this.rng() < 0.15) return this.startJob(plot, 'forklift');
      this.wantType = 'cement';
      return false;
    }
    const open = openSlots(progress);
    const crane = this.opOf(p, 'crane');
    const padPieces = this.looseNear(spots.hookPad.x, spots.hookPad.z, 3.2);
    if (!crane && (open.hand === 0 && open.high > 0 ? padPieces.length > 0 || this.rng() < 0.4 : padPieces.length > 0 && this.rng() < 0.5)) return this.startJob(plot, 'crane');
    if (open.hand === 0 && open.high > 0) this.dropTo = 'pad';
    else if (crane && this.rng() < 0.4) this.dropTo = 'pad';
    else if (!this.opOf(p, 'forklift') && open.hand >= 2 && this.rng() < 0.3) return this.startJob(plot, 'forklift');
    else if (this.rng() < 0.12) this.dropTo = 'pad'; // feed the crane: someone will lift it
    return false;
  }

  /** One think step in a machine: steer toward the goal and press action when the shared rules say it works. */
  private operate(now: number): void {
    const om = this.ownMachine!;
    const s = toState(om);
    const plot = Math.floor(s.id / 4);
    const p = this.state.plots[plot];
    const job = this.job ?? { id: s.id, kind: s.kind, probe: false, sent: true, startedAt: now, step: 0, lastActAt: 0, idleSince: now };
    this.job = job;
    const quit = (): void => {
      this.axes = { dx: 0, dz: 0 };
      this.pendingExit = true;
    };
    if (job.probe || !p || p.state !== 'building' || now - job.startedAt > 75_000) return quit();
    const act = (name: string): void => {
      if (now - job.lastActAt < 600) return;
      job.lastActAt = now;
      this.pendingAct = true;
      this.count(name);
    };
    const progress = progressOf(p);
    const spots = SITE.machines[plot]!;
    if (s.phase !== 'idle' && s.kind !== 'forklift') {
      this.axes = { dx: 0, dz: 0 };
      return;
    }
    switch (s.kind) {
      case 'excavator': {
        if (groundworkPart(progress) !== 'dig' && s.load.kind !== 'dirt') return quit();
        const ready = excavatorReady(s, plot);
        if (s.load.kind === 'dirt') {
          const m = tankTo(s, spots.spoil.x, spots.spoil.z, 2.3);
          this.axes = { dx: m.dx, dz: m.dz };
          if (ready.spoil) {
            this.axes = { dx: 0, dz: 0 };
            act('dump');
          }
        } else {
          const m = tankTo(s, spots.center.x, spots.center.z, 2.6);
          this.axes = { dx: m.dx, dz: m.dz };
          if (ready.pit && (m.there || Math.abs(m.dx) < 30)) {
            this.axes = { dx: 0, dz: 0 };
            act('scoop');
          }
        }
        return;
      }
      case 'mixer': {
        this.axes = { dx: 0, dz: 0 };
        if ((p.mixerMixUntil ?? 0) > 0) return;
        if (p.mixerBags > 0 && now - job.lastActAt > 1500) return act('mix');
        if (now - job.lastActAt > 2500) return quit();
        return;
      }
      case 'crane': {
        const loose = this.looseNear(spots.hookPad.x, spots.hookPad.z, 3.2);
        const goal = craneGoal(s, plot, progress, loose);
        if (!goal) {
          this.axes = { dx: 0, dz: 0 };
          if (now - job.idleSince > 8000) quit();
          return;
        }
        job.idleSince = now;
        const m = hookTo(s, plot, goal.x, goal.z);
        this.axes = { dx: m.dx, dz: m.dz };
        if (m.there) {
          this.axes = { dx: 0, dz: 0 };
          act(goal.kind === 'grab' ? 'craneGrab' : 'craneRelease');
          if (goal.kind === 'release' && !goal.snap && now - job.startedAt > 40_000) quit();
        }
        return;
      }
      case 'forklift':
        return this.driveForklift(s, plot, p, progress, job, now, act, quit);
    }
  }

  private driveForklift(s: ReturnType<typeof toState>, plot: number, p: PlotView, progress: TowerProgress, job: MachineJob, now: number, act: (n: string) => void, quit: () => void): void {
    const need = forkliftNeed(progress, p.mixerBags ?? 0);
    if (process.env.HHT_DEBUG_FORK && now % 2000 < 260) console.log(`[fork ${this.id}] plot=${plot} step=${job.step} load=${s.load.kind} need=${need} pos=${s.x.toFixed(1)},${s.z.toFixed(1)} v=${s.p3.toFixed(2)} t=${((now - job.startedAt) / 1000).toFixed(0)}`);
    const loaded = s.load.kind === 'pallet';
    const def = SITE.plots[plot]!;
    // stuck against scenery: back up with the wheel turned the other way for a moment
    if (!job.lastPos || Math.hypot(s.x - job.lastPos.x, s.z - job.lastPos.z) > 0.4) job.lastPos = { x: s.x, z: s.z, at: now };
    else if (now - job.lastPos.at > 1800 && (job.unstickUntil ?? 0) < now) {
      job.unstickUntil = now + 1100;
      job.lastPos.at = now;
    }
    if ((job.unstickUntil ?? 0) > now) {
      this.axes = { dx: this.axes.dx > 0 ? -127 : 127, dz: -110 };
      return;
    }
    if (!loaded) {
      if (job.step >= 100) return quit(); // unloaded: trip done
      if (!need || need === 'concrete') return quit();
      const rack = SITE.racks.filter((r) => r.type === need).sort((a, b) => Math.hypot(a.x - def.x, a.z - def.z) - Math.hypot(b.x - def.x, b.z - def.z))[0];
      if (!rack) return quit();
      job.yard = rack.yard;
      const route = forkliftRoute(plot, rack.index);
      if (job.step < route.length) {
        const wp = route[job.step]!;
        const m = carTo(s, wp.x, wp.z, 2.5);
        this.axes = { dx: m.dx, dz: m.dz };
        if (m.there) job.step++;
        return;
      }
      const at = rackApproach(rack.index);
      const m = carTo(s, at.x, at.z, 0.6);
      this.axes = { dx: m.dx, dz: m.dz };
      if (m.there || rackAtForksNear(s, rack.index)) {
        this.axes = { dx: 0, dz: 0 };
        act('palletLoad');
      }
      if (now - job.startedAt > 60_000) quit();
      return;
    }
    if (job.step < 100) job.step = 100;
    const spots = SITE.machines[plot]!;
    const dest = need === 'cement' ? spots.mixer.hopper : { x: def.x, z: def.z };
    const route = forkliftReturn(plot, job.yard ?? 0, dest);
    const i = job.step - 100;
    if (i < route.length - 1) {
      const wp = route[i]!;
      const m = carTo(s, wp.x, wp.z, 2.5);
      this.axes = { dx: m.dx, dz: m.dz };
      if (m.there) job.step++;
      return;
    }
    const tip = toolTip(s);
    const inZone = Math.hypot(tip.x - def.x, tip.z - def.z) <= def.buildZoneRadius - 0.4;
    const atHopper = Math.hypot(tip.x - spots.mixer.hopper.x, tip.z - spots.mixer.hopper.z) <= spots.mixer.hopperRadius + MACHINE.forklift.rackReach;
    const m = carTo(s, dest.x, dest.z, need === 'cement' ? 0.8 : 1.2);
    this.axes = { dx: m.dx, dz: m.dz };
    if (inZone || atHopper || m.there || now - job.startedAt > 90_000) {
      this.axes = { dx: 0, dz: 0 };
      act('palletUnload');
    }
  }

  /** Bot's schema view of the plots (for the divergence check). */
  plotView(): Array<{ completedStages: number; filledA: number; filledB: number; crewSize: number; state: string }> {
    return this.state.plots.map((p) => ({ completedStages: p.completedStages, filledA: p.filledA, filledB: p.filledB, crewSize: p.crewSize, state: p.state }));
  }
}
