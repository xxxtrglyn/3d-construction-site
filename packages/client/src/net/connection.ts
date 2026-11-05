import { Client, type Room } from '@colyseus/sdk';
import { CLOCK_TOWER, blueprintById, decodeSnapshot, isBlueprintId, type ClientMessageType, type ClientMessages, type ServerEvents, type Snapshot, type TowerProgress } from '@hht/shared';
import { ServerClock } from './clock.ts';
import type { Matchmade } from './matchmake.ts';

/** Decoded schema state (reflection-decoded on the client; shapes mirror server/src/rooms/schema.ts). */
export interface PlayerView {
  netId: number;
  name: string;
  hatColor: string;
  heldType: string;
  crewPlot: number;
  crewRole: string;
  away: boolean;
  /** feature 003: MachineId operated, or -1 */
  machine: number;
}
export interface PlotView {
  state: string;
  blueprintId: string;
  completedStages: number;
  /** feature 004: filled slots per recipe item of the current stage */
  filledA: number;
  filledB: number;
  hostName: string;
  hostSession: string;
  joinMode: string;
  crewSize: number;
  bin: ArrayLike<string> & Iterable<string>;
  finishedAt: number;
  // feature 003
  groundDug: number;
  groundPoured: number;
  highFilled: number;
  mixerBags: number;
  mixerMixUntil: number;
  machineOps: ArrayLike<string> & Iterable<string>;
  hookType: string;
  palletTypes: ArrayLike<string> & Iterable<string>;
}

/** The plot's tower progress as the shared rules see it. */
export function progressOf(p: PlotView): TowerProgress {
  // feature 004: the plot's blueprint is its recipe version (legacy towers keep clock-tower-v1)
  const blueprintId = isBlueprintId(p.blueprintId) ? p.blueprintId : CLOCK_TOWER.id;
  const st = blueprintById(blueprintId).stages[p.completedStages];
  const ab = [p.filledA ?? 0, p.filledB ?? 0];
  return {
    blueprintId, completedStages: p.completedStages, filled: st ? st.recipe.map((_, i) => ab[i] ?? 0) : [],
    groundDug: p.groundDug ?? 0, groundPoured: p.groundPoured ?? 0, highFilled: p.highFilled ?? 0,
  };
}
export interface PieceView {
  type: string;
  state: string;
  x: number;
  y: number;
  z: number;
  ox: number;
  oy: number;
  oz: number;
  vx: number;
  vy: number;
  vz: number;
  t0: number;
  landAt: number;
}
interface MapLike<V> {
  get(key: string): V | undefined;
  forEach(cb: (v: V, k: string) => void): void;
  readonly size: number;
}
export interface WorldView {
  worldId: number;
  shift: { epoch: number; endsAt: number; towersCompleted: number; phase: string };
  players: MapLike<PlayerView>;
  plots: ArrayLike<PlotView> & Iterable<PlotView>;
  pieces: MapLike<PieceView>;
}

/** Live connection to one world: schema state, typed events, binary snapshots and clock sync. */
export class NetConnection {
  readonly events = new EventTarget();
  readonly clock = new ServerClock();
  readonly worldId: number;
  readonly redirected: boolean;
  room!: Room;
  welcome: ServerEvents['welcome'] | null = null;
  onSnapshot: (s: Snapshot) => void = () => undefined;
  bytesIn = 0;
  snapshots = 0;
  lastSnapshotAt = 0;
  closedCode: number | null = null;
  private pingTimer = 0;

  constructor(mm: Matchmade) {
    this.worldId = mm.worldId;
    this.redirected = mm.redirected;
  }

  get state(): WorldView {
    return this.room.state as unknown as WorldView;
  }

  /** Consumes the seat reservation on the same origin (`/ws`, proxied in dev — research R14). */
  async connect(mm: Matchmade, base = location.origin): Promise<ServerEvents['welcome']> {
    const client = new Client(`${base}/ws`);
    let resolveWelcome!: (w: ServerEvents['welcome']) => void;
    const welcomed = new Promise<ServerEvents['welcome']>((r) => (resolveWelcome = r));
    this.room = (await client.consumeSeatReservation(mm.reservation as never)) as Room;
    this.room.onMessage('*', (type: string | number, payload: unknown) => {
      const t = String(type);
      if (t === 'ws') {
        const u8 = payload as Uint8Array;
        this.bytesIn += u8.byteLength;
        this.snapshots++;
        this.lastSnapshotAt = performance.now();
        const s = decodeSnapshot(new DataView(u8.buffer, u8.byteOffset, u8.byteLength));
        if (s) this.onSnapshot(s);
        return;
      }
      if (t === 'welcome') {
        const w = payload as ServerEvents['welcome'];
        this.welcome = w;
        this.clock.fromWelcome(w.serverNow);
        resolveWelcome(w);
      } else if (t === 'pong') {
        const p = payload as ServerEvents['pong'];
        this.clock.addPong(p.c, p.s);
      }
      this.events.dispatchEvent(new CustomEvent(t, { detail: payload }));
    });
    this.room.onLeave((code: number) => {
      this.closedCode = code;
      clearInterval(this.pingTimer);
      this.events.dispatchEvent(new CustomEvent('closed', { detail: code }));
    });
    this.pingTimer = window.setInterval(() => this.send('ping', { c: Date.now() }), 2000);
    const w = await welcomed;
    this.send('ping', { c: Date.now() });
    return w;
  }

  send<K extends ClientMessageType>(type: K, payload: ClientMessages[K]): void {
    if (this.closedCode === null) this.room.send(type, payload);
  }

  sendInputs(bytes: Uint8Array): void {
    if (this.closedCode === null) this.room.sendBytes('in', bytes);
  }

  on<K extends keyof ServerEvents | 'closed'>(type: K, cb: (payload: K extends keyof ServerEvents ? ServerEvents[K] : number) => void): void {
    this.events.addEventListener(type, (e) => cb((e as CustomEvent).detail));
  }

  leave(): void {
    clearInterval(this.pingTimer);
    void this.room?.leave(true);
  }
}
