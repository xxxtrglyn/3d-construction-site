import { Client, type Room } from '@colyseus/sdk';
import { PROTOCOL_VERSION, decodeSnapshot, encodeMoveInputs, type MoveInput, type ServerEvents, type Snapshot } from '@hht/shared';
import { randomBytes } from 'node:crypto';
import { loadConfig, type ServerConfig, type Timers } from '../src/config.ts';
import { startServer, type RunningServer } from '../src/server.ts';

export type Overrides = Partial<Omit<ServerConfig, 'timers'>> & { timers?: Partial<Timers> };

export async function boot(overrides: Overrides = {}): Promise<RunningServer> {
  return startServer(loadConfig({ HHT_DB: ':memory:', HHT_DEV_CHEATS: '1', HHT_METRICS: '1', HHT_MM_PER_MIN: '100000' }, { port: 0, ...overrides }));
}

export const newKey = (): string => randomBytes(16).toString('hex');

export interface Player {
  room: Room;
  key: string;
  worldId: number;
  redirected: boolean;
  welcome: ServerEvents['welcome'];
  events: Array<{ type: string; payload: unknown }>;
  snaps: Snapshot[];
  bytesIn: number;
  closedWith: number | null;
  /** next input seq */
  seq: number;
  send(type: string, payload?: unknown): void;
  move(inputs: Array<Partial<MoveInput>>): void;
  waitFor<K extends keyof ServerEvents>(type: K, pred?: (p: ServerEvents[K]) => boolean, timeoutMs?: number): Promise<ServerEvents[K]>;
  lastSnap(): Snapshot;
  leave(consented?: boolean): Promise<void>;
}

export interface JoinOpts {
  key?: string;
  name?: string;
  hatColor?: string;
  world?: number;
}

export async function matchmakeRaw(port: number, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/matchmake`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

export async function joinPlayer(server: RunningServer, opts: JoinOpts = {}): Promise<Player> {
  const key = opts.key ?? newKey();
  const mm = await matchmakeRaw(server.port, { protocol: PROTOCOL_VERSION, playerKey: key, name: opts.name ?? 'Sunny Bolt', hatColor: opts.hatColor ?? 'teal', world: opts.world });
  if (mm.status !== 200) throw new Error(`matchmake ${mm.status} ${JSON.stringify(mm.body)}`);
  const client = new Client(`http://127.0.0.1:${server.port}/ws`);
  const events: Player['events'] = [];
  const snaps: Snapshot[] = [];
  const waiters: Array<{ type: string; pred: (p: unknown) => boolean; resolve: (p: unknown) => void }> = [];
  let welcomeResolve!: (w: ServerEvents['welcome']) => void;
  const welcomeP = new Promise<ServerEvents['welcome']>((r) => (welcomeResolve = r));
  const room = (await client.consumeSeatReservation(mm.body.reservation as never)) as Room;
  const p: Player = {
    room, key, worldId: mm.body.worldId as number, redirected: mm.body.redirected as boolean, welcome: undefined as never,
    events, snaps, bytesIn: 0, closedWith: null, seq: 1,
    send: (type, payload = {}) => room.send(type, payload),
    move(inputs) {
      const full = inputs.map((i) => ({ seq: p.seq++ & 0xffff, dx: 0, dz: 0, run: false, jump: false, act: false, alt: false, ...i }));
      for (let k = 0; k < full.length; k += 12) room.sendBytes('in', encodeMoveInputs(full.slice(k, k + 12)));
    },
    waitFor(type, pred = () => true, timeoutMs = 5000) {
      const found = events.find((e) => e.type === type && pred(e.payload as never));
      if (found) return Promise.resolve(found.payload as never);
      return new Promise((resolve, reject) => {
        const w = { type, pred: pred as (p: unknown) => boolean, resolve: resolve as (p: unknown) => void };
        waiters.push(w);
        setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) {
            waiters.splice(i, 1);
            reject(new Error(`timeout waiting for ${type}`));
          }
        }, timeoutMs);
      });
    },
    lastSnap: () => snaps[snaps.length - 1] as Snapshot,
    async leave(consented = true) {
      await room.leave(consented).catch(() => undefined);
    },
  };
  room.onMessage('*', (type, payload) => {
    if (type === 'ws') {
      const u8 = payload as Uint8Array;
      p.bytesIn += u8.byteLength;
      const s = decodeSnapshot(new DataView(u8.buffer, u8.byteOffset, u8.byteLength));
      if (s) {
        snaps.push(s);
        if (snaps.length > 400) snaps.shift();
      }
      return;
    }
    events.push({ type: String(type), payload });
    if (type === 'welcome') welcomeResolve(payload as ServerEvents['welcome']);
    for (const w of [...waiters]) {
      if (w.type === type && w.pred(payload)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(payload);
      }
    }
  });
  room.onLeave((code: number) => {
    p.closedWith = code;
  });
  p.welcome = await welcomeP;
  return p;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function until(fn: () => boolean | Promise<boolean>, timeoutMs = 5000, stepMs = 25): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return;
    await sleep(stepMs);
  }
  throw new Error('condition not met in time');
}

export function worldOf(server: RunningServer, worldId = 1) {
  const w = server.ctx.worlds.get(worldId);
  if (!w) throw new Error(`no world ${worldId}`);
  return w;
}
