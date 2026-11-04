import { PROTOCOL_VERSION } from '@hht/shared';
import type { GuestProfile } from '../profile/guestProfile.ts';

export type MatchmakeError = 'protocol' | 'unreachable' | 'full' | 'starting';

export interface Matchmade {
  reservation: unknown;
  worldId: number;
  redirected: boolean;
}

export class MatchmakeFailure extends Error {
  readonly kind: MatchmakeError;
  constructor(kind: MatchmakeError) {
    super(`matchmake failed: ${kind}`);
    this.kind = kind;
  }
}

/** POST /api/matchmake (contracts/http-api.md) with an overall timeout (FR-050: 6 s → solo fallback). */
export async function matchmake(profile: Readonly<GuestProfile>, world: number | null, timeoutMs = 6000, base = ''): Promise<Matchmade> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) throw new MatchmakeFailure('unreachable');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), left);
    let res: Response;
    try {
      res = await fetch(`${base}/api/matchmake`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ protocol: PROTOCOL_VERSION, playerKey: profile.playerKey, name: profile.name, hatColor: profile.hatColor, world: world ?? undefined }),
        signal: ctl.signal,
      });
    } catch {
      throw new MatchmakeFailure('unreachable');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 200) return (await res.json()) as Matchmade;
    if (res.status === 426) throw new MatchmakeFailure('protocol');
    if (res.status === 503 || res.status === 429) {
      // restoring after a restart / rate limited: retry until the deadline
      await new Promise((r) => setTimeout(r, Math.min(1000, Math.max(0, deadline - Date.now()))));
      continue;
    }
    throw new MatchmakeFailure('unreachable');
  }
}

/** GET /api/health with a 2 s timeout (solo fallback poll). */
export async function serverHealthy(base = ''): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2000);
  try {
    const res = await fetch(`${base}/api/health`, { signal: ctl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
