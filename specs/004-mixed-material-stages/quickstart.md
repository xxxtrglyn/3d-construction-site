# Quickstart & Validation: Mixed-Material Stages (004)

How to prove 004 works end to end. Rules: [data-model.md](./data-model.md); wire:
[contracts/network-protocol-v3.md](./contracts/network-protocol-v3.md); texts:
[contracts/needs-display.md](./contracts/needs-display.md).

## Prerequisites

- Node 24 (`nvm use`), `pnpm install`.
- `pnpm assets` after the stage-art change (R11), then `pnpm check:budgets`.
- Ports 2567 (server) and 4173 (e2e preview) free, or `HHT_E2E_PORT=2568` for e2e while `pnpm dev` runs.
- E2E needs a quiet machine: software-rendered browsers time out under heavy load (seen on 2026-11-05
  at load ≥ 10 on 8 cores). Close other heavy apps before `pnpm e2e`.

## Automated checks

| Command | Proves |
|---|---|
| `pnpm test` | recipes, `deliver()` (every edge case of the spec), `needsOf`, `binAccepts`, pallet sizing, slot layout, v2→v3 migration, protocol v3 codecs, server integration (surplus, simultaneous last piece, restore of a legacy tower) |
| `pnpm e2e` | `mp-recipes.spec.ts` (US1–US4) plus the updated 001–003 specs, Chromium/Firefox/WebKit |
| `pnpm perf` | ghost slots within draw-call and frame budgets (`?perf=crowd`) |
| `pnpm check:budgets` | stage models with second-material details within `budgets.json`; critical payload ≤ 5 MB |
| `pnpm loadtest --duration 300` | 100 bots, `stalledTowers == 0`, towers/shift ≥ 003 baseline, ≤ 30 KB/s per client, tick budget |
| `pnpm verify` | all of the above in order |

## Manual scenarios

1. **Mixed Frame (US1)**: `pnpm dev`, open `http://localhost:5173/?debug=1`, become Host at the
   Foreman, finish Groundwork (`__hht.net.dev.fillGround(plot)`), then deliver brick, beam, beam,
   brick, beam, beam by hand. Expect: each piece snaps into a ghost of its own type; the stage
   completes after the 6th.
2. **Needs agree (US2)**: during Walls & Floors compare the sign, the HUD and the Foreman line after
   each delivery; they must match `__hht.net.needs()`.
3. **Kind refusal (US3)**: in the Frame, drop a paint bucket, then a third brick. Expect both set down
   beside the plot with the templated hints; counts unchanged.
4. **Forklift and bin (US4)**: in Walls & Floors load at the beam rack ("Load 2 beams"), unload; as a
   second (non-crew) player, drop a beam (accepted) and a paint bucket (refused, "This plot has
   enough…").
5. **Legacy tower (US5)**: on `develop` (v2) start a tower and fill part of Walls; switch to this
   branch, restart the server (migration v2→v3). Expect the same tower, old one-material needs on
   the sign; after `__hht.net.dev.endShiftIn(0)` a new tower uses the new recipe.
6. **Solo (FR-020)**: `?solo=1`, build the whole tower; same chips, ghosts and hints.
7. **Art (FR-024)**: `?shot=closeup` per stage vs `assets/renders/clock-tower-stages-004.png`.

## Phase validation gate (record results in `gate.md`)

- [x] Before starting implementation: 003 gate open items accepted, or the risk accepted by the owner
      (constitution workflow) — **risk accepted by the owner 2026-11-05** (see gate.md)
- [ ] `pnpm verify` green, including WebKit e2e and the quick load test
- [ ] Load test: `stalledTowers == 0`, towers per shift ≥ 003 baseline, per-client bandwidth and tick
      within budget (SC-005, SC-006)
- [ ] No piece silently consumed in e2e and load tests (SC-007)
- [ ] Owner approves the stage renders with second-material details (FR-024)
- [ ] Solo tower time with machines ≤ 110 % of the 003 time (SC-004)
- [ ] Playtest (5 people): ≥ 4 read their plot's needs within 5 s (SC-001); < 10 % refused deliveries
      after stage 2 (SC-002); 4-person crew: ≥ 3 of 6 stages with parallel work on different
      materials (SC-003)
