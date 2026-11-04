import { matchMaker } from '@colyseus/core';
import { PROTOCOL_VERSION, validateJoinOptions } from '@hht/shared';
import type { ServerContext } from '../context.ts';
import { sha256, type WorldRoom } from '../rooms/WorldRoom.ts';

export interface MatchmakeResult {
  status: number;
  body: Record<string, unknown>;
}

const perIp = new Map<string, number[]>();
const IP_WINDOW_MS = 60_000;

function ipAllowed(ip: string, now: number, limit: number): boolean {
  const arr = (perIp.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
  if (arr.length >= limit) {
    perIp.set(ip, arr);
    return false;
  }
  arr.push(now);
  perIp.set(ip, arr);
  return true;
}

export function resetMatchmakeLimits(): void {
  perIp.clear();
}

/** Creates world `worldId` through the matchmaker (rooms refuse creation without the internal secret). */
export async function ensureWorld(ctx: ServerContext, worldId: number): Promise<WorldRoom> {
  const live = ctx.worlds.get(worldId);
  if (live) return live;
  await matchMaker.createRoom('world', { worldId, secret: ctx.cfg.internalSecret });
  const room = ctx.worlds.get(worldId);
  if (!room) throw new Error(`world ${worldId} failed to start`);
  return room;
}

/**
 * POST /api/matchmake {protocol, playerKey, name, hatColor, world?} (contracts/http-api.md):
 * requested world if it has a seat → lowest worldId with a seat (resumable counts) → create next.
 */
export async function matchmake(ctx: ServerContext, body: unknown, ip: string): Promise<MatchmakeResult> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (b.protocol !== PROTOCOL_VERSION) return { status: 426, body: { error: 'protocol', server: PROTOCOL_VERSION } };
  const opts = validateJoinOptions(b);
  const requested = b.world === undefined || b.world === null ? null : Number(b.world);
  if (!opts || (requested !== null && (!Number.isInteger(requested) || requested < 1 || requested > 9999))) return { status: 400, body: { error: 'invalid' } };
  if (!ipAllowed(ip, Date.now(), ctx.cfg.matchmakePerMin)) return { status: 429, body: { error: 'rate' } };
  if (ctx.restoring) return { status: 503, body: { error: 'starting' } };
  const keyHash = sha256(opts.playerKey);

  const ordered = (): WorldRoom[] => [...ctx.worlds.values()].sort((a, b2) => a.worldId - b2.worldId);
  let target: WorldRoom | undefined;
  const req = requested !== null ? ctx.worlds.get(requested) : undefined;
  if (req && req.canAdmit(keyHash) !== 'full') target = req;
  if (!target) target = ordered().find((w) => w.canAdmit(keyHash) === 'resume');
  if (!target) target = ordered().find((w) => w.canAdmit(keyHash) === 'seat');
  if (!target) {
    let next = 1;
    while (ctx.worlds.has(next)) next++;
    target = await ensureWorld(ctx, next);
  }
  const redirected = requested !== null && target.worldId !== requested;
  target.pendingSeats++;
  setTimeout(() => {
    if (target.pendingSeats > 0) target.pendingSeats--;
  }, 15_000).unref();
  const cache = await matchMaker.getRoomById(target.roomId);
  const reservation = await matchMaker.reserveSeatFor(cache, { ...opts, _mm: ctx.cfg.internalSecret });
  return { status: 200, body: { reservation, worldId: target.worldId, redirected } };
}
