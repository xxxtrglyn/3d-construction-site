# Implementation Plan: Mixed-Material Stages

**Branch**: `004-mixed-material-stages` | **Date**: 2026-11-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-mixed-material-stages/spec.md`

## Summary

Every Clock Tower stage needs two materials (31 deliveries, owner-picked recipe). Players deliver
in any order. Each piece snaps into a free slot of its own material, shown as a ghost on the tower.
Wrong or surplus pieces are set down with a hint, never eaten. The sign, the HUD and the Foreman all
show the same per-material needs. The forklift, the crane, the supply bin, solo mode and the
load-test bots follow the recipe. Towers in progress when 004 ships keep the old recipe.

Technical approach:

- **Rules** (`shared`):
  - `StageDef` gains a `recipe` (type, count, high) and keeps `pieceType` as the main material.
  - `TowerProgress.filledSlots` becomes `filled[]` (one count per material).
  - `deliver()` adds a `surplus` result.
  - New pure helpers: `needsOf`, `neededSupplies`, `binAccepts`, typed `openSlotRefs`.
  - (research R1, R3, R5–R8)
- **Recipe versioning by blueprint id**: the legacy one-material blueprint stays as `clock-tower-v1`,
  and the migration tags every stored building with it. No new column or field (R2).
- **Wire**: protocol v3 replaces `PlotState.filledSlots` with `filledA` and `filledB`, and the hints
  carry need lists (R10, [contracts/network-protocol-v3.md](./contracts/network-protocol-v3.md)).
- **Persistence**: schema v3 renames `filled_slots` to `filled_a`, adds `filled_b`, and tags old rows
  as legacy (R9, [contracts/persistence-v3.sql](./contracts/persistence-v3.sql)).
- **Client**:
  - Instanced ghost pieces per open slot, grouped by material.
  - Need chips on the sign and HUD, plus templated Foreman lines and hints
    ([contracts/needs-display.md](./contracts/needs-display.md)).
  - Solo uses the same rules.
- **Art**: each stage model gains second-material details through the Blender builder, with owner
  review renders (R11).
- **Bots**: bots fetch by remaining need, and the load test reports `stalledTowers` (R12).

## Technical Context

**Language/Version**: TypeScript 7.0.2 `strict` (the server uses `erasableSyntaxOnly`) on Node.js
24 LTS. The asset builders use Python 3 in Blender 5.2.

**Primary Dependencies**: unchanged from 003, with no new dependency:
- **server**: Colyseus 0.18, `@colyseus/schema` 5;
- **client**: three 0.187, `@colyseus/sdk` 0.18, Rapier (solo worker only);
- **tools**: Vite 8, Vitest 5, Playwright 1.64, gltf-transform 4.5.

**Storage**: SQLite (`node:sqlite`, WAL) at `data/hht.sqlite`, migrated v2 → v3. Fresh databases get
the v3 `schema.sql`, and migrations chain v1 → v2 → v3 (`db.ts`).

**Testing**:
- **Vitest** (shared): recipes, `deliver()`, `needsOf`, bin and pallet rules, slot layout, codecs.
- **Vitest + `@colyseus/testing`** (server): surplus, simultaneous last piece, legacy restore,
  migration.
- **Playwright**: the new `mp-recipes.spec.ts` plus updated 001–003 specs.
- **Measurement runs**: `pnpm perf`, `pnpm check:budgets` and `pnpm loadtest`.

**Target Platform**: as in 003: current Chrome, Firefox and Safari (iOS 16+) with WebGL 2, and a
Node 24 server.

**Project Type**: web application (static client, authoritative realtime server, shared rules
package, asset pipeline).

**Performance Goals**:
- Server and network budgets are unchanged: 20 Hz, tick average ≤ 10 ms and p99 ≤ 25 ms, ≤ 30 KB/s
  per client.
- Rule cost: `deliver()` and `needsOf()` are O(2) per call.
- Client: 60 fps desktop and ≥ 30 fps mid-range phone. Ghosts add ≤ 6 draw calls (one instanced mesh
  per piece type) and ≤ 12 k triangles (up to 12 near plots × 8 ghosts, using LOD1 pieces beyond
  12 m).

**Constraints**:
- Critical payload ≤ 5 MB is unchanged. Stage models stay within the `budgets.json` caps.
- Controls stay move + action + toss (+ jump).
- Building stays additive-only. Every refused piece stays in the world (SC-007).
- The protocol v3 bump forces old tabs to reload (code 4001).

**Scale/Scope**:

| Item | Amount |
|---|---|
| Blueprints | 2 (`clock-tower` new, `clock-tower-v1` legacy) |
| Recipe items | 12 (6 stages × 2 materials) |
| New shared helpers | 5 (`needsOf`, `neededSupplies`, `binAccepts`, `filledTotal`, `blueprintById`) |
| Schema fields | `PlotState` −1 / +2 |
| Database | 1 column renamed, 1 added |
| Hint kinds | 1 changed, 2 new (`surplus`, `binNotNeeded`) |
| Art | 6 stage models get details; 1 review render sheet |
| New e2e spec | 1 (`mp-recipes.spec.ts`) |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this plan complies | Status |
|---|---|---|
| I. Instant Play | No new step or download. The critical payload is unchanged: ghosts reuse the already-loaded piece meshes, and the stage-model details stay within each model's budget. Stale v2 tabs get the existing reload prompt | ✅ |
| II. Server Authority | The server decides every snap, refusal, surplus, pallet size and bin acceptance with the shared pure rules. Clients send no new messages; they derive needs from replicated counters. Deliveries are serialized in the room, so simultaneous last pieces cannot overfill (FR-009) | ✅ |
| III. Performance Budgets | No per-tick traffic is added. Ghost rendering has numeric caps (≤ 6 draw calls, ≤ 12 k triangles), enforced in `pnpm perf` (`?perf=crowd`). Stage models are checked by `check:budgets`. The load test re-measures bandwidth and tick time | ✅ |
| IV. Art Fidelity & Original IP | Second-material details come from the scripted Blender builder with the toon material and outlines. Owner review renders are required before integration (FR-024). Ghosts use a toon ghost material | ✅ (owner render approval item) |
| V. Simple & Kind Sandbox | No new controls. Refused pieces are never eaten, and hints say what is needed. All new text comes from fixed templates (needs-display contract). The bin stops accepting useless pieces, which keeps helping kind and useful. Roles stay voluntary | ✅ |
| VI. Test & Measure | All recipe rules are pure functions in `shared` with unit tests for every spec edge case. Server integration covers surplus, races, legacy restore and migration. The load test gains `stalledTowers`. The gate is in [quickstart.md](./quickstart.md) | ✅ |
| VII. Simplicity | No new dependency, column or schema type beyond two `uint8` fields. Recipe versioning reuses `blueprintId`. The counter model is kept (no per-slot bitmask) | ✅ |

**Workflow gate**: the 003 gate still has owner, device and playtest items open
(`specs/003-construction-machines/gate.md`). Implementation of 004 needed the owner to accept that
risk: **accepted by the owner on 2026-11-05** (first item of [gate.md](./gate.md)).

**Result**: PASS. The 003 gate risk is accepted (2026-11-05); one owner item stays open: the stage-render approval.

**Post-design re-check (after Phase 1)**: PASS.
- **Contracts**: protocol v3 adds no client message, and hints are validated in `shared`.
- **Data model**: the invariants (data-model §3) are pure and tested.
- **Persistence**: the migration only adds and renames, and legacy meaning is preserved.
- **Display**: the display contract uses fixed templates only.
- **Budgets**: every new cost has a numeric cap.

## Project Structure

### Documentation (this feature)

```text
specs/004-mixed-material-stages/
├── plan.md              # This file
├── research.md          # Phase 0 decisions R1–R13
├── data-model.md        # Recipes, progress, needs, deliver transition, slots, bin, schema, rows
├── quickstart.md        # Run/verify guide + phase gate
├── contracts/
│   ├── network-protocol-v3.md
│   ├── persistence-v3.sql
│   └── needs-display.md
├── checklists/requirements.md
└── tasks.md             # Created by /speckit-tasks
```

### Source Code (repository root)

```text
tools/blender/builders/clock_tower.py   # + second-material details per stage (R11), review render sheet
tools/assets/budgets.json               # unchanged caps; re-checked

packages/shared/src/
├── blueprints.ts        # RecipeItem, StageDef.recipe (+ derived slotCount/highSlots), CLOCK_TOWER (new),
│                        #   CLOCK_TOWER_V1 (legacy), blueprintById, validator, TOTAL_DELIVERIES 31
├── progression.ts       # TowerProgress.filled[], deliver() + surplus, needsOf, neededSupplies, openSlots per type
├── machines.ts          # typed openSlotRefs/hand-slot layout by recipe, snapTarget per type, neededMachine
├── bin.ts               # binAccepts, takeFromBin(prefer[])
└── protocol.ts          # PROTOCOL_VERSION 3, HintEvent changes, validators
packages/shared/test/    # progression (recipes, surplus, races), blueprints, machines (slots), rules (bin), codecs v3

packages/server/src/
├── world/systems.ts     # deliver results → surplus/wrongPiece hints with need lists; bin acceptance; syncPlot filledA/B;
│                        #   fillStage/fillMaterial cheats
├── systems/machines.ts  # pallet sizing per material; crane release over typed slots
├── rooms/schema.ts      # PlotState filledA/filledB (− filledSlots)
├── persistence/         # schema.sql v3, db.ts migrateV2toV3, repo.ts filled_a/filled_b + blueprintById on load
└── loadtest/            # bot.ts fetch by need, machineBot.ts typed slots, run.ts stalledTowers + per-material overfill
packages/server/test/    # recipes/surplus/race tests; restore legacy tower; migration v2→v3 fixture

packages/client/src/
├── net/connection.ts    # PlotView filledA/filledB → progressOf
├── world/               # slotGhosts.ts (NEW: instanced typed ghosts, MP + solo; replaces slotMarkers rings),
│                        #   highSlots.ts tint by material, machineCue.ts via neededMachine
├── game/                # netWorld.plotNeedText → chips; NetPlay hints/rack label; towerPlot.ts + Game.ts (solo) recipe rules
├── machines/SoloMachines.ts  # pallet sizing / labels per material
├── ui/                  # hud.setNeeds (chips), foremanDialog needs line + 31 deliveries, hint templates
└── debug/               # needs() in __hht, crowdScene progress literal
packages/client/e2e/     # mp-recipes.spec.ts (NEW) + updates to carry-snap, stages, masterpiece, mp-crew,
                         #   mp-foreman, mp-machines, solo-machines
```

**Structure Decision**: keep the three-package monorepo.
- **Rules**: every recipe rule goes in `packages/shared`, so the server, the multiplayer client, solo
  mode and the bots share one definition (FR-020, FR-021).
- **Server**: only orchestrates (refusal placement, hints, bin, pallets).
- **Client**: gains one new world module (`slotGhosts.ts`). The rest are edits to existing displays.

## Complexity Tracking

> No principle violations. One choice is recorded because it is less obvious than the default.

| Choice | Why needed | Simpler alternative rejected because |
|---|---|---|
| Recipe version expressed as a second blueprint (`clock-tower-v1`) instead of a version column | FR-004 needs old towers to keep their recipe. `blueprintId` is already stored, replicated and looked up | **A `recipe_version` column + schema field**: duplicates `blueprintId` across DB, schema and rules. **Reinterpreting old progress**: forbidden by FR-004. **Wiping towers on deploy**: loses players' progress |
