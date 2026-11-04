import type { AddressInfo } from 'node:net';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { CLOSE } from '@hht/shared';
import { loadConfig, type ServerConfig } from './config.ts';
import { setContext, type ServerContext } from './context.ts';
import { mountRoutes } from './http/routes.ts';
import { ensureWorld, resetMatchmakeLimits } from './http/matchmake.ts';
import { Metrics } from './metrics.ts';
import { openDb } from './persistence/db.ts';
import { WorldRoom } from './rooms/WorldRoom.ts';
import { closeBlocklist } from './systems/blocklist.ts';

export interface RunningServer {
  port: number;
  ctx: ServerContext;
  close(): Promise<void>;
}

/** Boots the game server: db → Colyseus + HTTP routes → world 1 (restored from SQLite). */
export async function startServer(cfg: ServerConfig = loadConfig()): Promise<RunningServer> {
  const db = openDb(cfg.db);
  const metrics = new Metrics();
  const ctx: ServerContext = { cfg, db, metrics, worlds: new Map(), restoring: true, shuttingDown: false };
  setContext(ctx);
  resetMatchmakeLimits();
  const transport = new WebSocketTransport({ pingInterval: 5000, pingMaxRetries: 3 });
  const gameServer = new Server({ transport, greet: false, gracefullyShutdown: false, express: (app) => mountRoutes(app, ctx) });
  gameServer.define('world', WorldRoom);
  await gameServer.listen(cfg.port);
  const port = (transport.server?.address() as AddressInfo | null)?.port ?? cfg.port;
  await ensureWorld(ctx, 1);
  ctx.restoring = false;
  let closed = false;
  return {
    port,
    ctx,
    async close() {
      if (closed) return;
      closed = true;
      ctx.shuttingDown = true;
      for (const w of ctx.worlds.values()) for (const c of w.clients) c.leave(CLOSE.shutdown);
      await new Promise((r) => setTimeout(r, 50));
      await matchMaker.gracefullyShutdown().catch(() => undefined);
      transport.shutdown();
      metrics.close();
      closeBlocklist();
      db.close();
      setContext(null);
    },
  };
}
