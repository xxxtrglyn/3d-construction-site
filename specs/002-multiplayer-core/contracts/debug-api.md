# Contract: Debug & Test API (multiplayer additions)

This contract extends `specs/001-single-player-prototype/contracts/debug-api.md`. The gating is the
same: `?debug=1`, `?perf=…` or `?e2e=1`, or dev builds. The API is a dynamic chunk outside the
critical payload. In solo mode the 001 API is unchanged. In multiplayer, the `debug.*` cheats that
change the world (`give`, `deliver`, `completeStage`, `completeAll`, `reset`) are disabled, because
the server is authoritative. `net.dev.*` is used instead, and works only against a server started
with `HHT_DEV_CHEATS=1`.

```ts
interface HhtDebugApi /* 001 fields … */ {
  mode: 'solo' | 'net';
  net?: {
    connected(): boolean;
    worldId(): number;
    me(): { sessionId: string; netId: number; name: string; crew: { plot: number; role: 'host' | 'member' } | null; holding: PieceTypeId | null };
    players(): Array<{ sessionId: string; name: string; hatColor: string; crewPlot: number; crewRole: string; drawn: boolean /* false when hidden or culled */ }>;
    plots(): Array<{ index: number; state: string; completedStages: number; filledSlots: number; hostName: string; joinMode: string; crewSize: number; bin: string[] }>;
    shift(): { epoch: number; endsAt: number; phase: string; msLeft: number };
    chatLog(): Array<{ from: string; channel: 'nearby' | 'crew'; text: string; at: number; shown: boolean /* false if muted/hidden/hide-all */ }>;
    stats(): { rttMs: number; clockOffsetMs: number; bytesInPerS: number; snapshotsPerS: number; corrections: number; interpDelayMs: [number, number, number] };
    events: EventTarget;   // every server event type from network-protocol.md §3, dispatched as CustomEvent(detail = payload)
    send(type: string, payload: unknown): void;   // raw intent (e2e only), still validated by the server
    dev: {                 // require server HHT_DEV_CHEATS=1; the server rejects them otherwise
      give(type: PieceTypeId): void;
      teleport(x: number, y: number, z: number): void;
      fillStage(plot: number): void;
      endShiftIn(seconds: number): void;
      spawnBots(n: number): void;   // server-side lightweight bots for visual crowd tests
    };
  };
}
```

## Perf scenes

| URL | Scene | Budget source |
|---|---|---|
| `?perf=1` | 001 Masterpiece reference (solo) | `budgets.json → render.high/low` |
| `?perf=crowd` | Offline synthetic crowd: 100 animated workers with mixed carries, emotes and nameplates; 12 towers at mixed stages incl. 4 Masterpieces; 1 celebration; camera at the plaza hero angle | `budgets.json → render.crowd.high/low` (≤ 300 / ≤ 200 draw calls; ≤ 600 k / ≤ 300 k triangles) |

`?perf=crowd` needs no server; it feeds recorded synthetic snapshots through the real `net/`
interpolation and `crowd/` renderers.
