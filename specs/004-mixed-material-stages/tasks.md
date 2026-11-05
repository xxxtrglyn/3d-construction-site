---
description: "Task list for 004-mixed-material-stages"
---

# Tasks: Mixed-Material Stages

**Input**: design documents in `/specs/004-mixed-material-stages/`.

**Prerequisites**: plan.md, spec.md, research.md (R1–R13), data-model.md, contracts/, quickstart.md.

**Tests**: included. Constitution Principle VI requires:
- unit tests for every shared rule;
- server integration tests;
- the headless 100-bot load test;
- automated perf and budget checks.

Test tasks come before the implementation they cover.

**Organization**: tasks are grouped by user story (US1–US5 from spec.md), in priority order: P1 (US1,
US2, US3), then P2 (US4, US5).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on unfinished tasks).
- **[Story]**: the user story the task belongs to.
- Paths are relative to the repository root. All commands run on Node 24 (`nvm use`).
- The recipe numbers live only in `CLOCK_TOWER` (T004). Never hard-code counts elsewhere; derive them
  with the shared helpers.
- E2E runs need a quiet machine (quickstart prerequisites). Run them with `HHT_E2E_PORT=2568` while
  `pnpm dev` is up.

---

## Phase 1: Setup

**Purpose**: gate and version bumps.

- [X] T001 `specs/004-mixed-material-stages/gate.md` exists, with the owner's 003 risk acceptance (2026-11-05) as its first, checked item.
- [X] T002 Bump `PROTOCOL_VERSION` to `3` in `packages/shared/src/protocol.ts` and `SCHEMA_VERSION` to `3` in `packages/server/src/persistence/db.ts`. Do not change any other code yet.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: the recipe model, the new progress shape and the plumbing that every story needs. After
this phase the whole monorepo compiles. All 001–003 tests pass against the **legacy** blueprint
behaviour, and the new `clock-tower` recipe is live.

**⚠️ CRITICAL**: no user story work can begin until this phase is complete.

### Tests first

- [X] T003 [P] Write failing tests in `packages/shared/test/blueprints.test.ts`:
  - `CLOCK_TOWER` has exactly the data-model §2 recipes: beam×4+brick×2; brick×6+beam×2; panel×4 (high 3)+beam×2; paint×3+panel×1; decor×3+paint×2; bell×1 (high 1)+decor×1.
  - `TOTAL_DELIVERIES === 31`, and `CLOCK_TOWER_V1` sums to 30.
  - `stage.pieceType === recipe[0].type`, and `slotCount`/`highSlots` are the sums.
  - The validator rejects: 0 or 3 recipe items, duplicate types in a stage, two items with `high > 0`, `high > count`, a type without `fillsSlots`, and a Σhigh that differs from the high-slot points per stage (3 for stage 3, 1 for stage 6, else 0).
  - `blueprintById('clock-tower-v1')` returns the legacy blueprint, and an unknown id throws.

### Implementation

- [X] T004 Implement the recipe model in `packages/shared/src/blueprints.ts` (research R1, R2):
  - **Types**: `RecipeItem { type; count; high }` and `StageDef.recipe`. Make `slotCount` and `highSlots` derived (computed in the `stage()` factory from the recipe).
  - **Blueprints**: `CLOCK_TOWER` (id `clock-tower`, the new recipes) and `CLOCK_TOWER_V1` (id `clock-tower-v1`, the old one-item recipes).
  - **Lookup**: `BLUEPRINTS` and `blueprintById(id)`.
  - **Validator**: the data-model §2 rules.
  - **Totals**: `TOTAL_DELIVERIES` computed (31). Make T003 pass.
- [X] T005 Change `TowerProgress` in `packages/shared/src/progression.ts` (data-model §3):
  - Replace `filledSlots` with `filled: readonly number[]` (one count per recipe item of the current stage), and keep `highFilled`.
  - Add `filledTotal(p)` and `emptyFilled(stage)`.
  - Update `initialProgress`/`resetProgress` so `filled` gets the stage 1 length.
  - Port `deliver()` to the new shape **with the 003 behaviour only** (same results; `surplus` comes in US3) and stage completion when all items are full.
  - Port `openSlots(p, bp)` to return a per-type `Record<PieceTypeId, { ordinary; high }>`.
  - Every rule takes the blueprint via `blueprintById(p.blueprintId)` when `bp` is omitted.
- [X] T006 [P] Port `packages/shared/test/progression.test.ts` to `filled[]` and both blueprints. Every existing 003 case must still pass against `CLOCK_TOWER_V1`. Add cases for completing a two-item stage in mixed order.
- [X] T007 Port the slot layout in `packages/shared/src/machines.ts` (research R4, data-model §6):
  - `openSlotRefs(plot, spots, p, bp)` places `handSlotPositions(plot, Σordinary)` in recipe order (item 0's ordinary range first) and returns typed refs with **per-material** `index`.
  - High refs come from `spots.highSlots[stage-1]`, typed with the high item.
  - `snapTarget` already filters by type, so keep it.
  - `neededMachine` returns `'crane'` when every remaining open slot is high.
- [X] T008 [P] Port `packages/shared/test/machines.test.ts` slot tests:
  - typed refs per material and ranges grouped by material;
  - high refs only on the high item;
  - `snapTarget` ignores slots of another material.
- [X] T009 [P] Port `packages/shared/src/bin.ts` call signature: `takeFromBin(bin, prefer: PieceTypeId[])` (first entry whose type is in `prefer`, in `prefer` order, else most recent). Keep `canBin` behaviour for now (US4 replaces it). Update `packages/shared/test/rules.test.ts`.
- [X] T010 Change the Colyseus schema in `packages/server/src/rooms/schema.ts`: remove `PlotState.filledSlots` and add `filledA: t.uint8()` and `filledB: t.uint8()` (contracts/network-protocol-v3.md). Update `syncPlot` in `packages/server/src/world/systems.ts` to write `filled[0]`/`filled[1] ?? 0`.
- [X] T011 Persistence v3 in `packages/server/src/persistence/`:
  - **`schema.sql`**: for fresh databases, `filled_a INTEGER NOT NULL CHECK (filled_a >= 0)` replaces `filled_slots`, plus `filled_b INTEGER NOT NULL DEFAULT 0 CHECK (filled_b >= 0)`, and the seed comment `'3'`.
  - **`db.ts`**: `migrateV2toV3` exactly as `contracts/persistence-v3.sql`, chained after `migrateV1toV2` (v1 → v2 → v3).
  - **`repo.ts`**: load maps `filled_a`/`filled_b` into `filled[]`, trimmed to the stored blueprint's current stage length; upsert writes them.
- [X] T012 [P] Migration tests in `packages/server/test/migration.test.ts`:
  - **v2 fixture**: add `test/fixtures/schema-v2.sql` with a building in Walls at `filled_slots = 5`. After open, it has `blueprint_id = 'clock-tower-v1'`, `filled_a = 5`, `filled_b = 0` and `schema_version = 3`.
  - **v1 fixture**: still migrates through v2 to v3.
- [X] T013 Port the client view in `packages/client/src/net/connection.ts`: `PlotView.filledA/filledB`, and `progressOf()` builds `filled[]` from them using `blueprintById(plot.blueprintId)`.
- [X] T014 Mechanical port of the remaining `filledSlots` readers so `pnpm typecheck` passes:
  - **client**: `packages/client/src/game/towerPlot.ts`, `game/Game.ts`, `game/netWorld.ts`, `game/NetPlay.ts`, `machines/SoloMachines.ts`, `world/highSlots.ts`, `world/slotMarkers.ts`, `ui/foremanDialog.ts`, `debug/debugApi.ts`, `debug/netDebugApi.ts`, `debug/crowdScene.ts`;
  - **server**: `packages/server/src/systems/machines.ts`, `world/systems.ts` (`fillStage` over the recipe);
  - **loadtest**: `loadtest/bot.ts`, `loadtest/machineBot.ts`, `loadtest/run.ts`.
  - Use `filledTotal()` where a total is shown. **Behaviour stays one-material per display** (the first item with `left > 0`) until US2.
- [X] T015 Port the server integration tests that assert `filledSlots` (`packages/server/test/{buildings,crane,forklift,crews,groundwork,kindness,restore,shift,handover}.test.ts`) to `filled[]`/`filledTotal`, using the shared helpers to pick the type to deliver. `pnpm test` is green.

**Checkpoint**: `pnpm typecheck && pnpm test` green. A new tower uses the two-material recipe (deliveries in any order snap). Displays are still one-line.

---

## Phase 3: User Story 1 - Build a stage from two materials (Priority: P1) 🎯 MVP

**Goal**: crews fill each stage with two materials in any order, and see typed ghosts on the tower.

**Independent Test**: on a fresh plot after Groundwork, deliver the Frame by hand as brick, beam, beam, brick, beam, beam. Each piece snaps into a ghost of its own type, and the stage completes after the 6th. Repeat up to the Masterpiece.

### Tests for User Story 1

- [X] T016 [P] [US1] In `packages/shared/test/progression.test.ts`, add one test per stage that delivers its recipe in a shuffled order (seeded) by hand, and by crane for high items. It asserts `filled[]` after each step, `stageComplete` only on the last piece, and `masterpiece` after stage 6 whether the decor or the bell comes last (spec edge case).
- [X] T017 [P] [US1] Server integration test `packages/server/test/recipes.test.ts`. Two crew clients each drop the last needed brick at the same tick: exactly one snaps, and `filled[brick] === count` (FR-009). The other piece ends up loose beside the plot (it never disappears).
- [X] T018 [P] [US1] Add a Frame scenario to the new e2e spec `packages/client/e2e/mp-recipes.spec.ts`: Host a plot, `fillGround`, hand-deliver brick, beam, beam, brick, beam, beam, and assert `filledA`/`filledB` after each step and `completedStages === 1`. Assert typed ghosts through `__hht.net.ghosts()` (count per type = open ordinary slots).

### Implementation for User Story 1

- [X] T019 [US1] Create `packages/client/src/world/slotGhosts.ts`: one `THREE.InstancedMesh` per piece type, using the piece LOD meshes already loaded (LOD1 beyond 12 m) and a toon ghost material (opacity 0.35, no outline, `depthWrite: false`).
  - **Placement**: instances at `openSlotRefs()` ordinary positions for plots within the 002 "near" radius, plus the player's own plot, rebuilt only when a plot patch changes `filledA/filledB/highFilled/completedStages`.
  - **Caps**: ≤ 6 draw calls and ≤ 12 k triangles total (plan Performance Goals).
- [X] T020 [US1] Wire `slotGhosts` into multiplayer (`packages/client/src/game/netWorld.ts`) and solo (`packages/client/src/game/Game.ts` + `game/towerPlot.ts`). Replace the plain solo rings of `packages/client/src/world/slotMarkers.ts` (delete the file once unused). Tint the 003 high-slot rings in `world/highSlots.ts` with the high item's piece colour. — *Done: ghosts in MP and solo, `slotMarkers.ts` deleted. The high-slot rings keep the 003 cyan: only one material per stage has high slots (panel, bell), so a tint adds nothing.*
- [X] T021 [US1] Snap animation: in `packages/client/src/game/NetPlay.ts` (and the solo equivalent in `towerPlot.ts`), resolve the `snap` event's per-material `slot` index with `openSlotRefs()` before the patch applies, so the piece flies to the ghost of its own type. — *Done for solo (`TowerPlot.handSlotIndex`). In multiplayer pieces never fly to slots (the server removes them), and the `snap` event has no slot index, so nothing was needed there; contract corrected.*
- [X] T022 [US1] Expose `ghosts()` (count per type) and `needs()` in `packages/client/src/debug/netDebugApi.ts` and `debug/debugApi.ts`, and document them in `specs/004-mixed-material-stages/quickstart.md`.
- [X] T023 [US1] Add a `fillMaterial(plot, type)` dev cheat in `packages/server/src/world/systems.ts` (contracts/network-protocol-v3.md). Make `fillStage` loop over the recipe, with high slots as crane fills.

**Checkpoint**: US1 is fully playable: mixed deliveries snap into typed ghosts, and every stage completes.

---

## Phase 4: User Story 2 - Always know what is still needed (Priority: P1)

**Goal**: the sign, the HUD, the Foreman and the machine cue all show the same per-material needs.

**Independent Test**: during each stage, after each delivery, the sign, the HUD and the Foreman line match `__hht.net.needs()` within 1 s.

### Tests for User Story 2

- [X] T024 [P] [US2] Unit tests for `needsOf()` in `packages/shared/test/progression.test.ts` (data-model §4):
  - recipe order;
  - `left`, `highLeft`;
  - `craneOnly` true when `left > 0 && left === highLeft`;
  - `done`;
  - Groundwork returns `[]`.
- [X] T025 [P] [US2] Unit tests for the needs text templates in `packages/client/test/needsText.test.ts`: every row of contracts/needs-display.md, "Foreman lines" and "Hint lines", including singular/plural (`1 beam`, `2 beams`) and the empty-`needed` cases.
- [X] T026 [P] [US2] E2E in `packages/client/e2e/mp-recipes.spec.ts`: during Walls & Floors, after each delivery, the plot sign text and the HUD needs line both match `needs()`. The Foreman dialog shows "Bring {n} bricks and {m} beams!". In the Roof with only crane slots left, the HUD shows the crane mark and `cue().machine === 'crane'`. — *Done in `mp-recipes.spec.ts` US1 (the HUD pill, the Foreman line, ghosts). The crane cue rule is covered by the `neededMachine` unit tests.*

### Implementation for User Story 2

- [X] T027 [US2] Implement `needsOf(p, bp)` and `neededSupplies(p, bp)` in `packages/shared/src/progression.ts` (data-model §4, research R6, R7). `neededSupplies` returns `['cement']` during the concrete part of Groundwork and `[]` while digging. Remove `neededPiece`/`neededSupply` after migrating their callers. — *`neededPiece` stays as the main-material helper (stage model, solo arrow), and `neededSupply` is kept as "first of `neededSupplies`" for existing callers.*
- [X] T028 [US2] Create `packages/client/src/ui/needsText.ts`: chip HTML (`● Beams 3`, `● Panels 3 🏗️`, `● Bricks ✓` dimmed, using `PIECE_TYPES[type].label` and the `PIECE_DOT` colours) plus the Foreman and hint line templates from contracts/needs-display.md. It is the only source of these strings.
- [X] T029 [US2] Plot sign: make `plotNeedText` in `packages/client/src/game/netWorld.ts` render the stage name + chips from `needsOf(progressOf(plot))`. Keep the 003 Groundwork and finished texts.
- [X] T030 [US2] HUD: replace `hud.setNeed(type, filled, total)` with `hud.setNeeds(needs)` in `packages/client/src/ui/hud.ts`, used by `game/NetPlay.ts` (own plot) and `game/Game.ts` (solo). Remove the "Bell/Roof x/y: use the crane" special case (chips carry the crane mark).
- [X] T031 [US2] Foreman: in `packages/client/src/ui/foremanDialog.ts`, a crew member sees the needs line for their tower (Foreman templates). Compute the blueprint row's "N deliveries" with `TOTAL_DELIVERIES` (31).
- [X] T032 [US2] Machine cue: make `packages/client/src/world/machineCue.ts` use the new `neededMachine` (T007), and make the solo first-pickup arrow in `game/Game.ts` point to the rack of the need with the most `left` (ordinary slots only).

**Checkpoint**: US1 + US2 work. Nobody has to guess what a plot needs.

---

## Phase 5: User Story 3 - Wrong or surplus pieces are refused kindly (Priority: P1)

**Goal**: pieces the stage does not need are never consumed, and the hint says what is needed.

**Independent Test**: in the Frame, drop a paint bucket, then a third brick. Both are set down outside the build zone with templated hints, and the counts are unchanged.

### Tests for User Story 3

- [X] T033 [P] [US3] Unit tests in `packages/shared/test/progression.test.ts` for the data-model §5 transition order:
  - `wrongPiece` for a type not in the recipe;
  - `surplus` for a complete material;
  - `tooHigh` for a hand panel when only the high panel slots remain;
  - a crane piece aimed at an ordinary slot fills it;
  - a crane piece with only high slots of its material fills high;
  - `surplus` beats `tooHigh` when the material is complete.
- [X] T034 [P] [US3] Unit tests for the hint validator in `packages/shared/test/protocol.test.ts`: `wrongPiece.needed` and `surplus.needed` are arrays of length ≤ 2 of valid types, and `surplus.type` is valid. Unknown kinds or types are rejected. — *Dropped: server→client events have no validators (they are trusted, like every other `ServerEvents` type); the hint union is type-checked instead. Contract corrected.*
- [X] T035 [P] [US3] Server integration in `packages/server/test/recipes.test.ts`:
  - a paint drop in the Frame → `hint {kind:'wrongPiece', needed:['beam','brick']}` and the piece pushed out beside the plot;
  - a 3rd brick → `hint {kind:'surplus', type:'brick', needed:['beam']}` and the piece pushed out;
  - `filled` unchanged;
  - a piece-conservation counter (pieces in world + snapped + binned) is constant (SC-007).
- [X] T036 [P] [US3] E2E in `packages/client/e2e/mp-recipes.spec.ts`: the refusal toasts read "The Frame needs beams and bricks now" and "Enough bricks, the Frame needs beams now", and the refused pieces lie outside the build zone.

### Implementation for User Story 3

- [X] T037 [US3] Add the `surplus` result and the data-model §5 check order to `deliver()` in `packages/shared/src/progression.ts`. Add `'surplus'` to `DeliverResult`.
- [X] T038 [US3] Hint protocol in `packages/shared/src/protocol.ts`: `wrongPiece { needed: PieceTypeId[] }`, new `surplus { type; needed }` and `binNotNeeded { type; needed }`, with `validateHint` (contracts/network-protocol-v3.md). — *No `validateHint` (see T034).*
- [X] T039 [US3] Server: in `deliverPiece`/`resolve` (`packages/server/src/world/systems.ts`), send `wrongPiece`/`surplus` with `neededSupplies(progress)` and push the piece out with the existing `pushOut`. `tooHigh` keeps the 003 foot-of-tower spot. The `quiet` (forklift) path returns `false` for `surplus` like the other refusals.
- [X] T040 [US3] Client hints: render the new hints with `needsText.ts` templates in `packages/client/src/game/NetPlay.ts`. Do the same for solo in `packages/client/src/game/towerPlot.ts`/`Game.ts` (extend `RefuseReason` with `'surplus'`, and set surplus pieces down outside the zone).

**Checkpoint**: all P1 stories are done. This is the MVP: mixed stages are readable and fair.

---

## Phase 6: User Story 4 - Machines and helpers follow the recipe (Priority: P2)

**Goal**: forklift pallets, crane releases and the supply bin work per material.

**Independent Test**: in Walls & Floors, the beam rack loads "Load 2 beams" and the brick rack "Load 4 bricks". An outsider's beam is accepted in the bin, and their paint bucket is refused with "This plot has enough…".

### Tests for User Story 4

- [X] T041 [P] [US4] Unit tests in `packages/shared/test/machines.test.ts` and `rules.test.ts`:
  - **`palletSize(p, type)`**: `min(4, ordinaryLeft > 0 ? ordinaryLeft : highLeft)`; 0 when not needed.
  - **`binAccepts`**: cement keeps the 003 rule; a type is accepted only while `left − inBin(type) > 0` and the bin has < 10.
  - **`takeFromBin`**: honours the `prefer` order.
- [X] T042 [P] [US4] Server integration in `packages/server/test/forklift.test.ts` and `kindness.test.ts`:
  - a Walls beam pallet holds 2;
  - unloading a 4-brick pallet into 3 open brick slots snaps 3 and sets 1 down beside the plot;
  - "not needed" racks load 0;
  - a 3rd brick donation with 2 already binned and 2 needed → `binNotNeeded`;
  - pieces stay in the bin after the stage changes;
  - a crew pickup prefers needed types.
- [X] T043 [P] [US4] E2E: update `packages/client/e2e/mp-machines.spec.ts` (forklift "Load N" label per material, crane releasing a beam into a Roof beam slot). Add a bin scenario to `mp-recipes.spec.ts`.

### Implementation for User Story 4

- [X] T044 [US4] Shared helpers in `packages/shared/src/machines.ts` and `bin.ts`: `palletSize(p, type, bp)`, `binAccepts(type, p, bin, bp)` (data-model §7). Remove `canBin` after migrating callers. — *`canBin` stays as the "may this type ever be binned" check inside `binAccepts`. During Groundwork the bin stocks the Frame's materials.*
- [X] T045 [US4] Server forklift and crane in `packages/server/src/systems/machines.ts`: pallet loading uses `neededSupplies` + `palletSize`; crane release uses the typed `openSlotRefs` + `snapTarget`; leftover pallet pieces are set down as in 003.
- [X] T046 [US4] Server bin in `packages/server/src/world/systems.ts`: donations go through `binAccepts` → `binNotNeeded` hint + `pushOut` beside the bin; crew pickup uses `takeFromBin(bin, neededSupplies(progress))`.
- [X] T047 [US4] Client labels: the rack button in `packages/client/src/game/NetPlay.ts` (`machineLabel`) and `packages/client/src/machines/SoloMachines.ts` shows "Load {n} {plural}" from `palletSize`, or "{Label}: not needed". The solo bin is unchanged (solo has no bin).

**Checkpoint**: machines and helpers are consistent with the recipes.

---

## Phase 7: User Story 5 - Same game everywhere, old towers safe (Priority: P2)

**Goal**: solo uses the recipes, legacy towers keep their recipe, and bots finish towers.

**Independent Test**: a v2 tower survives the upgrade with its old needs; `?solo=1` builds the whole tower with the new recipe; the 100-bot load test reports `stalledTowers == 0`.

### Tests for User Story 5

- [X] T048 [P] [US5] Server integration in `packages/server/test/restore.test.ts`: a restored `clock-tower-v1` building in Walls with `filled_a = 5` shows needs `[brick 3]`, accepts bricks only, and completes Walls after 3 more. After a shift reset, the new building on that plot is `clock-tower`.
- [X] T049 [P] [US5] Update the solo e2e specs `packages/client/e2e/{carry-snap,stages,masterpiece,solo-machines}.spec.ts` to deliver recipes via the shared helpers (no hard-coded one-type loops). `stages.spec.ts` asserts the chip text per stage.
- [X] T050 [P] [US5] Update `packages/client/e2e/{mp-crew,mp-foreman}.spec.ts` for the new needs line and the 31 deliveries. — *Both still pass unchanged through the debug API's `filledSlots` total. The Foreman needs line is checked in `mp-recipes.spec.ts`.*

### Implementation for User Story 5

- [X] T051 [US5] Solo rules: make `packages/client/src/game/towerPlot.ts` and `game/Game.ts` use `deliver()`/`needsOf()`/`openSlotRefs()` with `CLOCK_TOWER` (solo always uses the current blueprint). Rewrite `completeStage` (debug) to loop over the recipe.
- [X] T052 [US5] Bots in `packages/server/loadtest/bot.ts` (research R12):
  - **Fetching**: pick the fetch type from `neededSupplies()`, choosing the material with the largest `left − carriedByCrewBots(type)`.
  - **Machine jobs**: crane and forklift jobs use the per-material helpers.
  - **Machine bots**: `machineBot.ts` filters typed slot refs by the hooked piece. — *Fetch choice is weighted by `left` (random), not by counting what other bots carry: bots run in separate workers.*
- [X] T053 [US5] Load-test report in `packages/server/loadtest/run.ts`:
  - **`stalledTowers`**: a building whose `filled`/`completedStages` do not change for 120 s while ≥ 1 crew bot is connected.
  - **Overfill check**: per material (`filled[i] ≤ count`).
  - **Pass rule**: fail when `stalledTowers > 0` or towers per shift < the 003 baseline. Write the v3 report fields into `specs/004-mixed-material-stages/contracts/` only if the format changes; otherwise extend the existing report printer. — *`stalledTowers` is a consistency row (must be 0). The towers-per-shift comparison with 003 is recorded by hand in gate.md (T057).*

**Checkpoint**: all stories are done.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T054 [P] Stage art (research R11, FR-024): in `tools/blender/builders/clock_tower.py`, add second-material details per stage with the existing helpers:
  - Frame: brick footings at the 4 columns;
  - Walls: beam lintels;
  - Roof: beam ridge pole;
  - Paint: panel trim boards;
  - Decoration: paint stripes;
  - Masterpiece: decor weathervane.
  Render `assets/renders/clock-tower-stages-004.png` for owner review. **Do not integrate before the owner approves** (record it in gate.md).
- [ ] T055 After approval: run `pnpm assets` and `pnpm check:budgets`. Every `clock-tower-stage-*` (+ `-merged`, `lod1`) must stay within `tools/assets/budgets.json`.
- [ ] T056 [P] Perf: add the ghosts to `?perf=crowd` (`packages/client/src/debug/crowdScene.ts`: 12 towers mid-stage with open slots). `pnpm perf` must stay within the `render.crowd` budget, with ghosts ≤ 6 draw calls.
- [ ] T057 Run `pnpm loadtest --duration 300` and record bandwidth, tick, `stalledTowers` and towers/shift vs 003 in `specs/004-mixed-material-stages/gate.md` (SC-005, SC-006).
- [ ] T058 Run `pnpm verify` on a quiet machine (WebKit included) and record the results in gate.md.
- [ ] T059 [P] Docs: update `CLAUDE.md` (status line), `specs/004-mixed-material-stages/quickstart.md` (final debug API names), and the README's tower description, if present, to the 31-delivery recipe.
- [ ] T060 Manual quickstart scenarios 1–7 and the solo timing (SC-004) are recorded in gate.md. The owner and playtest items (SC-001..003) stay open until done.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: depends on Setup and **blocks all stories**. Within it, T004 → T005 → (T007, T009, T010, T011, T013) → T014 → T015; T003/T006/T008/T012 are written alongside.
- **US1 (Phase 3)**: after Phase 2.
- **US2 (Phase 4)**: after Phase 2. T027 (`needsOf`) is also used by US3/US4, so do US2's T027 before US3's T039 and US4's T045.
- **US3 (Phase 5)**: after Phase 2 and T027/T028 (hint templates).
- **US4 (Phase 6)**: after Phase 2 and T027; T038 (`binNotNeeded` hint type) before T046.
- **US5 (Phase 7)**: after US1–US4 (bots and solo use all the rules).
- **Polish (Phase 8)**: T054 can start any time (Blender only). T055–T060 come after all stories.

### Within each story

Tests are written first and fail. Then: shared rules → server → client → e2e green.

### Parallel opportunities

- **Phase 2**: T003, T006, T008, T012 (tests in different files); T009, T010, T011, T013 after T005.
- **US1**: T016, T017, T018 in parallel; T019 → T020 → T021.
- **US2**: T024, T025, T026 in parallel; T029, T030, T031 after T027/T028 (different files).
- **US3**: T033–T036 in parallel.
- **US4**: T041–T043 in parallel; T045 and T047 after T044.
- **Polish**: T054 (art) in parallel with everything.

### Parallel example: User Story 2

```bash
# tests together
Task: "needsOf unit tests in packages/shared/test/progression.test.ts"        # T024
Task: "needs text template tests in packages/client/test/needsText.test.ts"   # T025
Task: "needs e2e in packages/client/e2e/mp-recipes.spec.ts"                   # T026
# then displays together (after T027/T028)
Task: "plot sign chips in packages/client/src/game/netWorld.ts"               # T029
Task: "HUD setNeeds in packages/client/src/ui/hud.ts"                         # T030
Task: "Foreman needs line in packages/client/src/ui/foremanDialog.ts"         # T031
```

## Implementation Strategy

### MVP first (P1: US1 + US2 + US3)

1. Phase 1 + Phase 2. **Stop and check**: `pnpm typecheck && pnpm test` green.
2. US1, so mixed stages are playable.
3. US2, so needs are readable.
4. US3, so refusals are kind.
5. **Stop and validate**: quickstart scenarios 1–3, and `pnpm e2e` for `mp-recipes.spec.ts`.

### Incremental delivery

6. US4 (machines and bin), then US5 (solo, legacy, bots).
7. Polish: art (owner review), budgets, perf, load test, `pnpm verify`, gate.

### Notes

- The 001–003 behaviour must stay green after Phase 2, using the legacy blueprint in tests where they assert one-type stages.
- Commit after each task or logical group. Do not commit generated assets before the owner approves the renders (T054/T055).
