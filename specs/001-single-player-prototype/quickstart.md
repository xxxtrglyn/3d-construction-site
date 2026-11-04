# Quickstart & Validation Guide: Single-Player Playable Prototype

## Prerequisites

- Node.js ≥ 20.19 and pnpm ≥ 10
- Blender 5.2 available as `blender` on PATH (only needed to regenerate assets)
- Playwright browsers: `pnpm exec playwright install chromium firefox webkit`

## Setup and run

```bash
pnpm install
pnpm assets          # Blender (headless) → glTF → gltf-transform → packages/client/public/assets + manifest.json
pnpm dev             # http://localhost:5173 (dev server; add ?debug=1 for FPS overlay + debug API)
```

To test on a phone on the same Wi-Fi, run `pnpm dev --host` and open the printed network URL.

## Automated checks

```bash
pnpm typecheck       # TypeScript strict, all packages
pnpm test            # Vitest: shared rules + client logic
pnpm build           # production build of packages/client
pnpm check:budgets   # fails if critical payload > 5 MB, JS > 1.6 MB gzip, or any asset over budget
pnpm e2e             # Playwright smoke + build-flow tests (Chromium, Firefox, WebKit)
pnpm perf            # Playwright perf scene (?perf=1): fails on draw calls > 250 / triangles > 400k
pnpm verify          # all of the above in order
```

Expected: all commands exit 0. `check:budgets` prints a table of each asset, its group, size and
limit. `perf` prints draw calls, triangles and the median frame time (frame time is informational).

## Manual validation scenarios

These map to the user stories and success criteria in [spec.md](./spec.md).

1. **Instant play (US1, SC-001/002/009)**: in a fresh private window, open the deployed or preview
   URL (`pnpm build && pnpm preview`). With DevTools throttled to "Fast 4G", the worker must move
   within 4 s. Repeat on iPhone Safari and on Android Chrome. Reload: the same name and hat color
   remain.
2. **Carry and snap (US2)**: pick up a beam (E / GRAB), drop it, pick it up, toss it (Q / TOSS).
   Carry a brick into the build zone while stage 1 is active: it bounces out and the hint says
   "Needs: Steel beam". Carry a beam in: it snaps with a puff and sound, and one slot marker turns
   off.
3. **Six stages (US3)**: deliver every piece. After each stage the tower visibly changes and the
   sign gains a star. Compare with `assets/renders/clock-tower-stages.png`.
4. **Masterpiece (US4)**: the last bell triggers fireworks, confetti, glowing windows, the bell
   sound and a cheer for at least 5 s. "Build again" returns the plot to the empty foundation.
5. **Pipeline (US5, SC-008)**: delete `packages/client/public/assets/*` and run `pnpm assets`; all
   files and `manifest.json` come back. Temporarily lower a budget in `tools/assets/budgets.json`:
   `pnpm check:budgets` fails and names the asset.
6. **Art fidelity (SC-007)**: open `/?debug=1&shot=stages` (camera preset matching the stage
   mockup) and compare side by side with `assets/renders/clock-tower-stages.png`; then
   `/?debug=1&shot=closeup` against `assets/renders/art-test-closeup.png`.

## Reference devices for fps (SC-003)

| Tier | Device | Browser | Target |
|---|---|---|---|
| high | Any 2023+ laptop (integrated GPU) | Chrome, Firefox, Safari | ≥ 60 fps in `?perf=1` |
| low | Pixel 6a-class Android | Chrome | ≥ 30 fps in `?perf=1` |
| low | iPhone 12 or newer | Safari | ≥ 30 fps in `?perf=1` |

## Phase validation gate (record results in `specs/001-single-player-prototype/gate.md`)

- [ ] 5 first-time playtesters: ≥ 4 of 5 snap their first piece within 60 s without help (SC-004)
- [ ] Median solo completion time 8–15 min (SC-005)
- [ ] ≥ 4 of 5 say it was fun and that the stage changes were clear (SC-006)
- [ ] Owner approves the side-by-side art comparison (SC-007)
- [ ] `pnpm verify` green; fps targets met on the reference devices (SC-002/003/008)
