import type { ServerConfig } from './config.ts';
import type { Metrics } from './metrics.ts';
import type { Db } from './persistence/db.ts';
import type { WorldRoom } from './rooms/WorldRoom.ts';

/** Process-wide server context (one game server per process). */
export interface ServerContext {
  cfg: ServerConfig;
  db: Db;
  metrics: Metrics;
  /** live worlds by worldId */
  worlds: Map<number, WorldRoom>;
  /** true while worlds are being restored at boot (matchmake answers 503) */
  restoring: boolean;
  /** set while closing: disconnects must not change persisted crews/buildings */
  shuttingDown: boolean;
}

let current: ServerContext | null = null;

export function setContext(ctx: ServerContext | null): void {
  current = ctx;
}

export function getContext(): ServerContext {
  if (!current) throw new Error('server context not initialized');
  return current;
}
