# Phase Validation Gate: 001-single-player-prototype

**Date**: 2026-11-04 · **Build**: local `pnpm verify` (Chromium + Firefox headless)

## Automated checks (`pnpm verify`): PASS

| Check | Result |
|---|---|
| `pnpm typecheck` (TS 7 strict, all packages) | ✅ pass |
| Unit tests: shared (18) + client (12) | ✅ 30/30 |
| Production build | ✅ |
| `check:budgets`: critical payload | ✅ **2.2 MB** of 5 MB (assets 409 KB + code 1.8 MB gzip) |
| `check:budgets`: per asset | ✅ all within budget (largest: stage 6 at 460 KB of 600 KB) |
| e2e: Chromium + Firefox (6 specs each) | ✅ 12/12 |
| e2e: WebKit | ⚠️ not run: the WebKit browser fails to start on this Linux host (missing `libicudata.so.70`; needs `sudo npx playwright install-deps`). Run `pnpm --filter @hht/client e2e:webkit` after installing the deps, or test Safari manually. |
| Perf, high tier (Masterpiece + celebration) | ✅ 221 draw calls (≤ 250), 304 k triangles (≤ 400 k) |
| Perf, low tier | ✅ 131 draw calls (≤ 150), 185 k triangles (≤ 200 k) |

The frame rate in a real desktop Chrome (GPU) on the perf scene was a steady 60 fps (16.7 ms median).

## Art fidelity (SC-007): pending owner review

In-game screenshots to compare with the approved renders:

- `assets/renders/ingame/closeup.png` vs `assets/renders/art-test-closeup.png`
- `assets/renders/ingame/masterpiece.png` vs `assets/renders/clock-tower-masterpiece.png`

- [ ] Owner approves the side-by-side comparison

## Playtest gate (SC-004/005/006): pending, needs real people

- [ ] 5 first-time playtesters: ≥ 4 of 5 snap their first piece within 60 s without help
- [ ] Median solo completion time 8–15 min
- [ ] ≥ 4 of 5 say it was fun and that the stage changes were clear

## Device fps (SC-003): pending, needs real devices

- [ ] Pixel 6a-class Android, Chrome: ≥ 30 fps on `?perf=1&q=low`
- [ ] iPhone 12+ Safari: ≥ 30 fps on `?perf=1&q=low`
- [x] Desktop Chrome (GPU): 60 fps on `?perf=1`

## Known follow-ups

1. Switch `@dimforge/rapier3d-compat` to the non-compat build and serve the `.wasm` file
   separately (saves about 0.45 MB gzip; research R10).
2. Hide the name tag when the worker is behind the tower.
3. WebKit e2e on a host that has the Playwright system dependencies installed.
