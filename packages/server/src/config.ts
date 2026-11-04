import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { BIN, CHAT, CREW, LOOSE_MP, MACHINE, NET, PLOTS, SHIFT } from '@hht/shared';

/** All tunable timers in seconds (tests shorten them; defaults come from shared constants). */
export interface Timers {
  reconnectGraceS: number;
  bootGraceS: number;
  idleKickS: number;
  requestExpireS: number;
  denyCooldownS: number;
  hostAwayS: number;
  hostIdleS: number;
  unattendedAfterS: number;
  celebrateS: number;
  retireAfterFinishedS: number;
  overflowDisposeS: number;
  chatUnlockS: number;
  chatDuplicateS: number;
  chatPauseWindowS: number;
  warnS: number;
  countdownS: number;
  looseFadeS: number;
  /** feature 003: an operator with no input for this long is put out */
  machineIdleS: number;
}

export interface ServerConfig {
  port: number;
  db: string;
  shiftMinutes: number;
  maxPlayers: number;
  /** /api/matchmake requests allowed per IP per minute (tests and load tests raise it) */
  matchmakePerMin: number;
  maxLoose: number;
  binCapacity: number;
  metrics: boolean;
  devCheats: boolean;
  blocklistDir: string;
  /** shared secret that only our matchmaker passes to room creation (blocks direct room creation) */
  internalSecret: string;
  timers: Timers;
  /** artificial busy-wait per tick (ms) — load-test self-test only */
  injectTickMs: number;
}

const num = (v: string | undefined, d: number): number => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v: string | undefined): boolean => v === '1' || v === 'true';

export const DEFAULT_TIMERS: Timers = {
  reconnectGraceS: NET.reconnectGraceS,
  bootGraceS: NET.bootGraceS,
  idleKickS: NET.idleKickS,
  requestExpireS: CREW.requestExpireS,
  denyCooldownS: CREW.denyCooldownS,
  hostAwayS: CREW.hostAwayS,
  hostIdleS: CREW.hostIdleS,
  unattendedAfterS: CREW.unattendedAfterS,
  celebrateS: PLOTS.celebrateS,
  retireAfterFinishedS: PLOTS.retireAfterFinishedS,
  overflowDisposeS: 300,
  chatUnlockS: CHAT.unlockAfterS,
  chatDuplicateS: CHAT.duplicateWindowS,
  chatPauseWindowS: CHAT.pauseWindowS,
  warnS: SHIFT.warnS,
  countdownS: SHIFT.countdownS,
  looseFadeS: LOOSE_MP.fadeAfterSeconds,
  machineIdleS: MACHINE.idleExitS,
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Omit<ServerConfig, 'timers'>> & { timers?: Partial<Timers> } = {}): ServerConfig {
  const root = resolve(import.meta.dirname, '..');
  const { timers, ...rest } = overrides;
  return Object.freeze({
    port: num(env.HHT_PORT, 2567),
    db: env.HHT_DB ?? resolve(root, '..', '..', 'data', 'hht.sqlite'),
    shiftMinutes: num(env.HHT_SHIFT_MINUTES, SHIFT.defaultMinutes),
    maxPlayers: num(env.HHT_MAX_PLAYERS, 100),
    matchmakePerMin: num(env.HHT_MM_PER_MIN, 10),
    maxLoose: LOOSE_MP.maxLoose,
    binCapacity: BIN.capacity,
    metrics: bool(env.HHT_METRICS),
    devCheats: bool(env.HHT_DEV_CHEATS),
    blocklistDir: env.HHT_BLOCKLIST_DIR ?? resolve(root, 'data', 'chat-blocklist'),
    internalSecret: randomBytes(16).toString('hex'),
    injectTickMs: num(env.HHT_INJECT_TICK_MS, 0),
    ...rest,
    timers: Object.freeze({ ...DEFAULT_TIMERS, ...timers }),
  });
}
