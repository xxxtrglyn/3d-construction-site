import { Client, type Room } from '@colyseus/sdk';
import {
  CLOCK_TOWER, EMOTE_IDS, PROTOCOL_VERSION, QUICK_MESSAGE_IDS, SITE, currentStage, decodeSnapshot, encodeMoveInputs,
  generateName, quantizeDir, randomHatColor, seededRng, type MoveInput, type PieceTypeId, type Rng, type WorkerState,
} from '@hht/shared';

/** Counters a bot reports to the runner. */
export interface BotStats {
  bytesIn: number;
  bytesOut: number;
  behaviors: Record<string, number>;
  rtts: number[];
  chatOutsideChannel: number;
  disconnects: number;
  connected: boolean;
}

interface PlotView {
  state: string;
  completedStages: number;
  filledSlots: number;
  joinMode: string;
  crewSize: number;
  hostSession: string;
}

type Mode = 'idle' | 'toForeman' | 'toSign' | 'fetch' | 'deliver' | 'donate' | 'wander';

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
  readonly stats: BotStats = { bytesIn: 0, bytesOut: 0, behaviors: {}, rtts: [], chatOutsideChannel: 0, disconnects: 0, connected: false };
  private readonly base: string;

  constructor(id: number, base: string, seed: number) {
    this.id = id;
    this.base = base;
    this.rng = seededRng(seed);
    this.host = id % 10 === 0;
  }

  private count(b: string): void {
    this.stats.behaviors[b] = (this.stats.behaviors[b] ?? 0) + 1;
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

  private get state(): { players: Map<string, { netId: number; crewPlot: number; crewRole: string }>; plots: PlotView[] } {
    return this.room.state as never;
  }

  private onMessage(type: string, payload: unknown): void {
    if (type === 'ws') {
      const u8 = payload as Uint8Array;
      const s = decodeSnapshot(new DataView(u8.buffer, u8.byteOffset, u8.byteLength));
      if (!s) return;
      this.own = s.own;
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
        const mine = this.state.players.get(this.me);
        const from = this.state.players.get(p.from as string);
        if (p.channel === 'crew') {
          if (!mine || !from || mine.crewPlot < 0 || mine.crewPlot !== from.crewPlot) this.stats.chatOutsideChannel++;
        } else if (this.own && p.from !== this.me) {
          const r = this.remote.get(p.from as string);
          if (r && Math.hypot(r.x - this.own.x, r.z - this.own.z) > 20 + 8) this.stats.chatOutsideChannel++;
        }
        break;
      }
      case 'summary':
        this.setMode('idle');
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

  /** Steering: one 50 ms batch = 3 inputs (60/s). */
  private tickInputs(): void {
    if (!this.own) return;
    const dx = this.target.x - this.own.x;
    const dz = this.target.z - this.own.z;
    const d = Math.hypot(dx, dz);
    const q = d > 0.6 ? quantizeDir(dx / d, dz / d) : { dx: 0, dz: 0 };
    const run = d > 6;
    const inputs: MoveInput[] = [];
    for (let i = 0; i < 3; i++) {
      inputs.push({ seq: this.seq, dx: q.dx, dz: q.dz, run, jump: this.rng() < 0.002 });
      this.seq = (this.seq + 1) & 0xffff;
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
    if (this.mode !== 'idle' && now - this.modeSince > 45_000) this.setMode('idle');
    switch (this.mode) {
      case 'idle':
        if (mine >= 0) return this.setMode('fetch');
        if (this.host) {
          this.target = { x: SITE.foreman.x, z: SITE.foreman.z + 1.2 };
          return this.setMode('toForeman');
        }
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
      case 'fetch':
      case 'donate': {
        const plot = this.mode === 'fetch' ? mine : this.targetPlot >= 0 ? this.targetPlot : Math.floor(this.rng() * 12);
        if (this.mode === 'fetch' && plot < 0) return this.setMode('idle');
        this.targetPlot = plot;
        const p = plots[plot];
        const stage = p ? currentStage({ blueprintId: CLOCK_TOWER.id, completedStages: p.completedStages, filledSlots: p.filledSlots }) : null;
        const type = this.wantType ?? stage?.pieceType ?? 'brick';
        this.wantType = type;
        if (this.own.carrying) return this.setModeKeep(this.mode === 'fetch' ? 'deliver' : 'deliver');
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
        const into = mine === plot ? { x: d.x + Math.sin(d.yaw) * 2.2, z: d.z + Math.cos(d.yaw) * 2.2 } : { x: d.bin.x, z: d.bin.z };
        this.target = into;
        if (this.near(into.x, into.z, mine === plot ? 4 : 1.6)) {
          if (mine === plot && this.rng() < 0.3) {
            this.send('toss', { charge: 0.2 });
            this.count('toss');
          } else {
            this.send('drop', {});
            this.count(mine === plot ? 'deliver' : 'donate');
          }
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

  /** Bot's schema view of the plots (for the divergence check). */
  plotView(): Array<{ completedStages: number; filledSlots: number; crewSize: number; state: string }> {
    return this.state.plots.map((p) => ({ completedStages: p.completedStages, filledSlots: p.filledSlots, crewSize: p.crewSize, state: p.state }));
  }
}
