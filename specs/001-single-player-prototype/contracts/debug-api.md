# Contract: Debug & Test API (`window.__hht`)

The debug and test API is available when the URL has `?debug=1`, `?perf=1` or `?e2e=1`, or in dev
builds. It is tree-shaken out of production builds unless one of those flags is present; it is
loaded as a separate dynamic chunk, so it never counts toward the critical payload.

```ts
interface HhtDebugApi {
  ready: Promise<void>;                       // resolves when the worker is playable
  state(): {
    worker: { position: [number, number, number]; grounded: boolean; holding: PieceTypeId | null };
    tower: { completedStages: number; filledSlots: number; stars: number; isMasterpiece: boolean };
    loosePieces: number;
    profile: { name: string; hatColor: string; muted: boolean };
  };
  render(): { drawCalls: number; triangles: number; textures: number; geometries: number; frameMsMedian: number };
  debug: {
    give(type: PieceTypeId): void;            // put a piece in the worker's hands
    teleport(x: number, y: number, z: number): void;
    deliver(type: PieceTypeId): DeliverResult; // as if the held piece were dropped in the build zone
    completeStage(): void;                    // fill the remaining slots of the current stage
    completeAll(): void;                      // jump to Masterpiece (perf reference scene)
    reset(): void;                            // same as "Build again"
    setQuality(tier: 'high' | 'low'): void;
  };
  events: EventTarget;                        // 'snapped' | 'stageComplete' | 'masterpiece' | 'wrongPiece' | 'pickup' | 'drop' | 'toss'
}
```

- `?perf=1` loads the reference scene: tower at Masterpiece, celebration looping, camera fixed at
  the hero angle, and an FPS overlay.
- Playwright tests use only this API plus real keyboard input; they never reach into internal
  modules.
