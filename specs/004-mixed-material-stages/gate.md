# Phase Validation Gate: Mixed-Material Stages (004)

Checklist from [quickstart.md](./quickstart.md) → "Phase validation gate". Results are filled in by
the implementation.

- [x] Before starting implementation: 003 gate open items accepted, or the risk accepted by the owner
      (constitution workflow)
  - **2026-11-05: risk accepted by the owner.** Implementation of 004 proceeds while these items stay
    open: from 003, the `render.machines` budget approval and phone fps, the owner review of the
    machine and plot renders, and the 003 playtest; from 002, its owner/device/playtest items. They
    are re-checked at the 004 gate.
- [ ] `pnpm verify` green, including WebKit e2e and the quick load test
- [ ] Load test: `stalledTowers == 0`, towers per shift ≥ 003 baseline, per-client bandwidth and tick
      within budget (SC-005, SC-006)
- [x] No piece silently consumed in e2e and load tests (SC-007): `recipes.test.ts` piece conservation,
      `mp-recipes.spec.ts` refusals on the ground, load-test `duplicatePieces`/`heldPiecesLost` 0
- [x] Owner approves the stage renders with second-material details (FR-024)
  - **2026-11-05: approved by the owner** (`assets/renders/clock-tower-stages-004.png`: brick footings,
    steel lintels, steel roof collar, teal shutters, purple paint band, pink weathervane).
- [ ] Solo tower time with machines ≤ 110 % of the 003 time (SC-004)
- [ ] Playtest (5 people): ≥ 4 read their plot's needs within 5 s (SC-001); < 10 % refused deliveries
      after stage 2 (SC-002); 4-person crew: ≥ 3 of 6 stages with parallel work on different
      materials (SC-003)

## Results (2026-11-05)

| Check | Result |
|---|---|
| Unit + integration | ✅ shared 126, client 36, server 92 (incl. `recipes.test.ts`, v2→v3 migration, legacy restore) |
| E2E, Chromium | ✅ 28/28 (new `mp-recipes.spec.ts` US1–US4; 001–003 specs updated to the recipes) |
| Perf (`?perf=1`, `?perf=crowd` with ghosts, `?perf=machines`) | ✅ high and low tiers within budget |
| Asset budgets | ✅ all pass; critical payload ≈ 1 MB. LOD1 towers leave out lintels and shutters (invisible at that distance) to stay ≤ 39 KB |
| Load test, 300 s, 100 bots | ✅ budgets: 20 ticks/s, tick avg 3.6 ms, p99 6.6 ms, 14.7 KB/s per bot (p95 17.2), heap ≤ 59 MB; machines: groundworkDone 10, craneSnaps 78–92, forkliftSnaps 20–32, palletUnload 17–21; all old consistency counters 0 |
| Load test `stalledTowers` | ✅ fixed (`995f272`): caught with `HHT_DEBUG_STALL=1` — every crew bot of the stalled Roof was walking from the brick rack straight to the beam rack and pressing against the brick rack box (bots have no pathfinding; with two materials per stage they now walk rack → rack). Bots now sidestep when stuck. 3 runs after the fix: 0, 0, 0 stalled; pallet unloads 13/18/21. |
| Load test timing after the fix | ⚠️ re-run needed on a quiet machine: those 3 runs shared the CPU with Docker containers and an open game tab (load ≈ 7–8) and showed tick avg 18–19 ms, p99 58–64 ms (and 12 divergent views in one run). The server code is unchanged since the passing runs (3.6 ms / 6.6 ms). |
| Solo time (SC-004), WebKit/Firefox e2e, `pnpm verify`, playtest | open |

### Fixes found by the load test
1. **Forklift pivot vs. car reversing.** The 2026-11-05 turn-in-place fought the bots' car-style
   reversing (0 pallet unloads). Now A/D turns it on the spot only without W/S; with throttle it is
   a car (contracts/controls.md updated).
2. **Bot crane loop on leftovers.** With two materials a leftover brick on the hook pad was grabbed,
   could not snap, and was set back on the pad forever. Bots now grab only pieces the stage has a
   slot for and drop useless ones off the pad. (A human operator sees the brick; no game change.)
