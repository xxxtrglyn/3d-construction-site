---
description: "Task list for 003-construction-machines"
---

# Tasks: Construction Machines

**Input**: design documents in `/specs/003-construction-machines/`.

**Prerequisites**: plan.md, spec.md, research.md (M1–M16), data-model.md, contracts/, quickstart.md.

**Tests**: included. Constitution Principle VI requires:
- unit tests for every shared rule, including a determinism replay test for `stepMachine`;
- server integration tests;
- the headless 100-bot load test;
- automated perf and budget checks.

Test tasks come before the implementation they cover.

**Organization**: tasks are grouped by user story (US1–US7 from spec.md), in priority order: P1 (US1,
US2, US3), then P2 (US4, US5, US7), then P3 (US6).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on unfinished tasks).
- **[Story]**: the user story the task belongs to.
- Paths are relative to the repository root. All commands run on Node 24 (`nvm use`).
- Tuning numbers come from research M8 and live in `MACHINE` (T003). Never hard-code them elsewhere.

---

## Phase 1: Setup

**Purpose**: owner gate, budgets, tuning constants and rate limits.

- [X] T001 Create `specs/003-construction-machines/gate.md` from the quickstart's "Phase validation gate" checklist. Record the owner's decision on the open 002 gate items in its first item: accepted, or risk accepted. **Do not start Phase 3 or later until that item is checked** (constitution workflow).
- [X] T002 [P] Extend `tools/assets/budgets.json` and `tools/assets/check-budgets.mjs`:
  - **`perAsset`**: `machine-crane` 220000, `machine-excavator` 200000, `machine-forklift` 150000, `machine-mixer` 120000, and each `machine-*-lod1` 30000.
  - **`render.machines`**: `high {drawCalls: 300, triangles: 700000}`, `low {drawCalls: 200, triangles: 340000}`.
  - Add a `$comment` that the 700 k high-tier ceiling awaits owner approval (plan Complexity Tracking).
  - The machine assets are `deferred`, so they never count toward the critical payload in either mode.
- [X] T003 [P] Add `MACHINE` to `packages/shared/src/constants.ts`, with exactly these values from research M8:
  - `enterRange: 1.5`, `idleExitS: 60`, `actPerSecond: 4`;
  - **excavator**: `speed: 2.8`, `turnRate: 1.6`, `scoopS: 0.9`, `dumpS: 0.7`, `pitReach: 1.2`, `spoilReach: 1.5`;
  - **forklift**: `speed: 6.5`, `steerMax: 0.6`, `rackReach: 1.0`, `palletMax: 4`;
  - **crane**: `slewRate: 0.9`, `trolleySpeed: 3.0`, `reachMin: 2.5`, `reachMax: 7.5`, `hookS: 1.0`, `grabRadius: 0.8`, `snapRadius: 1.5`;
  - **mixer**: `capacity: 4`, `mixS: 5`;
  - **groundwork**: `scoops: 6`, `concrete: 4`;
  - `keyframeS: 2`, `setDownRadius: 2`.
- [X] T004 [P] Add the rate bucket class `machine` (capacity 6, refill 2/s, the same strike rules as 002) in `packages/shared/src/rateLimit.ts`, with a test in `packages/shared/test/limits.test.ts`.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: the art, layout, shared types, rules, wire protocol v2, server state and client
rendering that every story needs.

**⚠️ CRITICAL**: no user-story work begins until this phase is complete. Machine models must be
approved by the owner (T006) before the client integrates them (T030). Placeholders are fine until
then.

### Art and layout (Blender pipeline)

- [X] T005 [P] Create `tools/blender/builders/machines.py`: four original, chunky toon machines in the approved palette, plus LOD1 versions.
  - **Rig nodes**: the names below are a contract with the client.
    - `Crane > Mast, Cab, Jib, Trolley, Hook`. The `Jib` pivot is on the slew axis; the `Hook` origin is at the hook tip.
    - `Excavator > Body, Boom, Arm, Bucket`. The pivots are at the joints.
    - `Forklift > Body, Mast, Forks`.
    - `Mixer > Body, Drum, Chute`.
  - **LOD1**: `<Kind>_LOD1`, merged, ≤ 600 triangles, no rig.
  - **Registration**: register `machine-crane`, `machine-excavator`, `machine-forklift`, `machine-mixer` and the four `-lod1` assets as `group='deferred'` in `tools/blender/export_assets.py`.
- [X] T006 Add a `render_review()` step to `tools/blender/builders/machines.py`. It writes `assets/renders/machine-crane.png`, `machine-excavator.png`, `machine-forklift.png`, `machine-mixer.png`, and `machines-plot.png` (one plot with all 4 machines, pit, spoil heap and hook pad) in the reference toon look. Add an owner-approval checkbox for these renders to `specs/003-construction-machines/gate.md`.
- [X] T007 Extend `tools/blender/builders/site_layout.py` to generate `machines: MachineSpots[]` per plot (data-model §2):
  - **Spots**: `yardRadius` 6.0; `pit` = the tower footprint (half 1.36); `spoil` 4.5 m to the side (radius 1.2); `hookPad` (half 1.2) inside the crane reach; `crane` base behind the tower on the outer side (`reachMin` 2.5, `reachMax` 7.5, `cabHeight` 14); `mixer` with `hopper` and `chute` points; `parking` poses for the excavator and the forklift; `highSlots` ring positions at the tower top for stages 3 and 6.
  - **Racks**: add one `cement` rack per rack yard.
  - **`noDrive`**: plaza radius + 1, and `playRadius − 1.5`.
  - **Removals**: delete the `MACHINES` scenery tuple and its obstacle boxes.
  - **Assertions**: neighbouring yards do not overlap; every spot lies inside its own yard; every cement rack is reachable from every yard through the lane (circle-sweep check). Emit everything into `packages/shared/src/site.gen.ts`.
- [X] T008 Update `tools/blender/builders/site.py`: remove the static crane and excavator. Per plot, add a pit-outline decal, a spoil-heap base, hook-pad markings (yellow stripes) and parking marks.
- [X] T009 Update `tools/blender/builders/lot.py` (solo):
  - Remove the static crane and excavator, and add a `Rack_cement` with `Rack_cement_Top`.
  - Add empties `M_Pit`, `M_Spoil`, `M_HookPad`, `M_Crane`, `M_Mixer`, `M_Mixer_Hopper`, `M_Mixer_Chute`, `M_Park_excavator`, `M_Park_forklift` and `M_HighSlot_<stage>_<i>` around the single plot.
  - Assert that the spots fit inside `PLAY_HALF` (11.3) without blocking the racks or the spawn path.
- [X] T010 Run `pnpm assets`, commit the regenerated `packages/shared/src/site.gen.ts`, and check `pnpm check:budgets` (the new assets are within `perAsset`, and the critical payload is unchanged).

### Shared rules and types

- [X] T011 [P] Append `cement` and `concrete` to `packages/shared/src/pieces.ts`, **after** `cone`, so the existing carry codes stay 1–7:
  - `cement`: label "Cement bag", `fillsSlots: false`, mass 2, `twoHands`, box collider `[0.5, 0.3, 0.35]`.
  - `concrete`: label "Concrete bucket", `fillsSlots: true` (footing only), mass 2, `twoHands`, cylinder collider `[0.36, 0.38, 0.36]`.
  - In `packages/shared/src/bin.ts`, `canBin` accepts `cement` and rejects `concrete`.
  - Add `cement: 4` and `concrete: 0` to `RACK_DISPLAY` in `packages/client/src/world/layout.ts`.
- [X] T012 [P] In `packages/shared/src/blueprints.ts`, add `StageDef.highSlots` (Clock Tower `[0, 0, 3, 0, 0, 1]`) and `Blueprint.groundwork: { scoops: 6, concrete: 4 }`. `validateBlueprint` must reject `highSlots > slotCount`. Extend `packages/shared/test/blueprints.test.ts`.
- [X] T013 Write the tests first in `packages/shared/test/progression.test.ts` for data-model §3:
  - `dig` caps at 6;
  - `pour` needs `groundDug === 6` and caps at 4;
  - `groundworkDone`;
  - `deliver(p, type, via)` → `groundworkFirst` before Groundwork, `wrongPiece`, and `tooHigh` for `via` hand or forklift when only high slots remain;
  - a crane delivery to a high slot increments `highFilled`;
  - a crane delivery to a hand slot does not;
  - `highFilled` resets on stage complete;
  - the stars are unchanged.
- [X] T014 Implement progression v2 in `packages/shared/src/progression.ts`:
  - `TowerProgress` gains `groundDug` (0..6), `groundPoured` (0..4) and `highFilled`;
  - add `dig`, `pour`, `groundworkDone`, and `deliver(p, type, via, slot?: { high: boolean })`;
  - `DeliverResult` gains `groundworkFirst` and `tooHigh`;
  - `initialProgress` starts with Groundwork at 0.

  All callers keep compiling: the 001 solo code passes `via: 'hand'`.
- [X] T015 [P] In `packages/shared/src/site.ts`, add the types `MachineSpots`, `Pose`, `Vec2`, `Vec3` and `SiteLayout.machines`/`noDrive`, and the pure helpers `inNoDrive(site, x, z)` and `inYard(spots, x, z)`.
- [X] T016 Write the tests first in `packages/shared/test/machines.test.ts`:
  - **Determinism**: replaying a recorded input log (fixture in `packages/shared/test/fixtures/machine-inputs.json`) gives bit-identical `MachineState` sequences across two runs.
  - **Limits per kind**: the excavator stays in its yard; the forklift stops at `noDrive` and at static boxes; the crane hook stays between `reachMin` and `reachMax` and inside its yard; the mixer never moves.
  - **Phases**: the `act` edge starts `lowering` → `raising` for the crane, and input is ignored meanwhile.
  - **Function rules**:
    - `snapTarget`: within 1.5 m horizontal, picks the nearest of several, matching type only, empty only, high and hand slots both allowed;
    - `canEnter`: the full matrix;
    - `setDownSpot`: never in the pit or the bin, within 2 m;
    - `neededMachine`: excavator while digging, mixer while pouring, crane while the current stage has empty high slots, otherwise null;
    - `seatPose` and `exitSpot`.
- [X] T017 Implement `packages/shared/src/machines.ts` (data-model §1): `MachineKind`, `MachineId` (plot × 4 + kind), `MachineState`, `MachineLoad`, `MachineAction`, `stepMachine(s, input, dt, ctx)` for all four kinds at `SIM_DT`, `seatPose`, `exitSpot`, `hookPos`, `canEnter`, `snapTarget`, `setDownSpot`, `neededMachine` and `parkedState(id, spots)`.
  - **Collision**: footprint circles against `ObstacleBox`/`ObstacleCyl` with slide, reusing the box and cylinder helpers from `kinematics.ts`, which are exported for this.
  - **No randomness and no `Date`**. Export everything from `packages/shared/src/index.ts`.
- [X] T018 Write the tests first in `packages/shared/test/protocol.test.ts` for protocol v2:
  - round trips of the carry code for all 9 types (4 bits);
  - anim `seated = 6`;
  - machine records (12 B), every field at its limits;
  - `ownMachine` present and absent;
  - move-input flags `act` (bit 2) and `alt` (bit 3);
  - flags > 15 are rejected;
  - the `machine` intent validator (`enter` with id 0..47 only, `exit`).
- [X] T019 Implement protocol v2 in `packages/shared/src/protocol.ts` (contracts/network-protocol-v2.md):
  - `PROTOCOL_VERSION = 2`; `MoveInput.act` and `MoveInput.alt`;
  - `ClientMessages.machine`; the `ServerEvents` additions `machineResult`, `machineExit`, `machineAct` and `ground`, plus `snap.via` and the new `hint` kinds;
  - `MachineRecord`; the snapshot v2 encoder and decoder (the own block carry is 4 bits, `ownMachine`, and the machine block after the entities).

### Server state

- [X] T020 [P] Extend `packages/server/src/rooms/schema.ts`:
  - `PlayerState.machine: int8` (default −1);
  - `PlotState`: `groundDug`, `groundPoured`, `highFilled` and `mixerBags` (uint8), `mixerMixUntil` (float64), `machineOps` (array of 4 strings), `hookType` (string) and `palletTypes` (array of strings).
- [X] T021 [P] Extend `packages/server/src/world/types.ts`:
  - `Session.machine: number` (−1) and `lastMachineInputAt`;
  - `PieceRec.state` adds `'hooked' | 'pallet'`, plus `heldBy`;
  - new `MachineRec { state, operator, lastSent: Map<string, {tick, hash}> }`.
- [X] T022 Write the test first `packages/server/test/migration.test.ts`. A v1 database file with a building and bin rows migrates to v2: the 4 new columns exist; in-progress rows get `ground_dug = 6` and `ground_poured = 4`; `bin_entry` accepts `cement` and still rejects `concrete`; `schema_version = '2'`.
- [X] T023 Apply `contracts/persistence-v2.sql` in `packages/server/src/persistence/schema.sql` (fresh databases) and `packages/server/src/persistence/db.ts` (the v1 → v2 migration in one transaction). In `packages/server/src/persistence/repo.ts`, write and read `ground_dug`, `ground_poured`, `high_filled` and `mixer_bags` with the building rows.
- [X] T024 Create `packages/server/src/systems/machines.ts`, with `MachineSystem` holding 48 `MachineRec`s built with `parkedState` from `SITE.machines`. Wire it into `packages/server/src/world/systems.ts`: create it, step it, reset it to parked on shift reset, and expose `machineAt(id)`. There is no gameplay yet. Mirror `machineOps`, `hookType` and `palletTypes` into `PlotState`.
- [X] T025 Write the test first: extend `packages/server/test/snapshots.test.ts` so that machine records are sent by interest tier; an unchanged idle machine is sent only at its 2 s keyframe; a moving machine is sent at its tier rate; the receiver's own machine goes only in `ownMachine`.
- [X] T026 Extend `packages/server/src/systems/snapshots.ts` to encode the v2 machine block with per-receiver change suppression (hash of the quantized record) and keyframes (`MACHINE.keyframeS`), using a pooled buffer sized for `MAX_ENTITIES` + 48 machines. Fill `ownMachine` for seated sessions.

### Client foundation

- [X] T027 Write the test first: extend `packages/client/test/prediction.test.ts` so the predictor replays `MachineState` with `stepMachine` and reconciles it, alongside the existing worker cases.
- [X] T028 Make `packages/client/src/net/prediction.ts` generic: `Predictor<S>` with a step function and an error function (worker: `stepWorker`/`stateError`; machine: `stepMachine`/`machineError`). The worker behaviour stays unchanged.
- [X] T029 [P] Create `packages/client/src/machines/machineViews.ts`: per-machine interpolation buffers fed by snapshot machine records, using the per-tier delays (`NET.interpDelayMs`). Angles are unwrapped before interpolation.
- [X] T030 Create `packages/client/src/machines/MachineRenderer.ts`:
  - one `InstancedMesh` per rig part per kind (12 instances), plus inverted-hull outlines within 30 m;
  - LOD1 instances beyond 30 m;
  - flat-colour box placeholders until the deferred assets load;
  - `setPose(id, MachineState)` composes the part matrices (slew → jib → trolley → hook; boom → arm → bucket; mast → forks; drum spin);
  - hooked and pallet pieces are drawn from the load code.
  - Target: about 26 draw calls for 48 machines.
- [X] T031 Wire the machines into multiplayer. In `packages/client/src/game/netWorld.ts`, decode the snapshot v2 machine block into `machineViews`, render all 48 machines through `MachineRenderer`, and listen to the new `PlotState` fields. Bump the client protocol handling, so a v1 server gives a clear "update" error.

**Checkpoint**: v2 builds; all 48 machines are parked and visible in a world (placeholders or
models). Shared, server and client tests pass.

---

## Phase 3: User Story 1 - Get in a machine and drive it (Priority: P1) 🎯 MVP

**Goal**: crew members enter their plot's free machine, drive or operate it with predicted,
server-authoritative movement, and get out with jump. Others see it move smoothly, and outsiders are
refused.

**Independent test**: give a test crew a plot with a forklift. Enter, drive around the yard and exit;
watch from a second device. An outsider sees "Crew only".

- [X] T032 [US1] Write the test first `packages/server/test/machines.test.ts`:
  - **`enter` matrix**: the `machineResult` values `entered`, `notCrew`, `busy`, `handsFull`, `tooFar` and `notBuilding`;
  - exactly one of two simultaneous enters wins;
  - **seating**: `PlayerState.machine` is set, and the worker pose follows `seatPose`;
  - **driving**: inputs move the machine identically to a local `stepMachine` replay;
  - **exiting**: jump flag → exit at that step, the `machine {op:'exit'}` fallback, and the worker placed at `exitSpot`;
  - **no contact**: a worker standing in the machine's path is never moved.
- [X] T033 [US1] Implement enter and exit in `packages/server/src/systems/machines.ts`, and route the `machine` message with the `machine` rate bucket in `packages/server/src/rooms/WorldRoom.ts`. Entry uses `canEnter` (crew, empty hands, free seat, ≤ `MACHINE.enterRange` + `NET.grabSlack`). Send `machineResult` and `machineExit {reason:'jump'}`.
- [X] T034 [US1] In `packages/server/src/systems/movement.ts`, route a seated session's inputs to `stepMachine`, and derive the worker pose from `seatPose` (anim `seated`, not simulated). Ignore `alt`. Cap `act` edges at `MACHINE.actPerSecond` (ignored, not struck). A jump edge exits.
- [X] T035 [US1] In `packages/client/src/game/NetPlay.ts`:
  - add the "Get in" action priority (contracts/controls.md: before "pick up"), with greyed "Crew only" and "Someone is driving" prompts;
  - send `machine enter`; handle `machineResult` and `machineExit`;
  - while seated, encode the `act` and `alt` bits and predict with `Predictor<MachineState>`, reconciling on `ownMachine`.
- [X] T036 [P] [US1] Add a `seated` pose (anim id 6) to `packages/client/src/player/workerView.ts` and the crowd animator in `packages/client/src/crowd/animation.ts`.
- [X] T037 [P] [US1] Create `packages/client/src/player/machineCameras.ts`:
  - the follow camera at 1.4× distance for the excavator and forklift;
  - the crane **hook camera** (raised, behind the hook along the jib) and **cab camera**, with toss toggling between them and every enter resetting to the hook camera (FR-008a);
  - a fixed mixer camera.

  Use it from `NetPlay.ts`.
- [X] T038 [P] [US1] Re-map the button labels while seated, in `packages/client/src/ui/hud.ts` and `packages/client/src/input/touch.ts`: action shows the next machine action ("Scoop", "Load 4 bricks", "Grab", "Release", "Mix (3 bags)", or greyed with a reason); jump shows "Exit"; toss shows "Camera" in the crane and is hidden otherwise.
- [X] T039 [P] [US1] Add first-time control hint cards per machine kind (6 s, or until the first input; also shown again from the "?" menu) in `packages/client/src/ui/machineHints.ts`, stored as `seenMachineHints` in `packages/client/src/profile/guestProfile.ts` (profile v2 field, migration-safe).
- [X] T040 [P] [US1] Add `machines()`, `myMachine()`, `camera()` and `dev.machinePose(id, pose)` to `packages/client/src/debug/netDebugApi.ts` (contracts/debug-api.md).
- [X] T041 [US1] Write the e2e test `packages/client/e2e/mp-machines.spec.ts` (part 1): the Host enters the forklift, drives 5 m, and the second page sees the machine move within 0.5 s; exit with Space; an outsider gets "Crew only"; a crew member gets "Someone is driving".

**Checkpoint**: US1 works on its own. This is the MVP: machines are enterable and driveable in the
world.

---

## Phase 4: User Story 2 - Dig the foundation and pour the footing (Priority: P1)

**Goal**: every new building starts with Groundwork: 6 excavator scoops, then 4 concrete buckets made
by the mixer from cement bags. After that, Frame unlocks.

**Independent test**: start a building and finish Groundwork with only the excavator, the mixer, and
hand-carried bags and buckets. Frame unlocks.

- [X] T042 [US2] Write the test first `packages/server/test/groundwork.test.ts`:
  - **Blocked**: a beam during Groundwork is refused with `hint groundworkFirst (part 'dig')`.
  - **Digging**: scoop at the pit then dump at the spoil heap → `groundDug + 1` and a `ground` event; dumping elsewhere → `dumpBack`, no count.
  - **The mixer's hopper**:
    - a crew cement bag dropped or tossed in → `mixerBags + 1` (max 4, then `hint mixerFull`);
    - an outsider's bag bounces with `hint crewOnlyMachine`.
  - **Mixing**: mix with 3 bags → after 5 s, 3 concrete pieces at the chute and `mixerBags = 0`.
  - **Pouring**: 4 concrete delivered into the pit → `groundworkDone`, a celebration, and Frame unlocks. Concrete before the pit is dug → refused.
  - **Persistence**: the database row is updated on every step.
- [X] T043 [US2] Implement the excavator actions in `packages/server/src/systems/machines.ts`:
  - `scoop` near the pit (bucket tip ≤ `MACHINE.pitReach` from the pit edge) → load `dirt`;
  - `dump` at its spoil heap → `progression.dig` → persist, mirror `groundDug`, emit `ground` and broadcast `machineAct`;
  - elsewhere → `dumpBack`.
- [X] T044 [US2] Implement the mixer:
  - **Hopper**: in `packages/server/src/world/systems.ts`, drops and toss landings within the hopper radius of a crew member's own plot mixer add to `mixerBags` (cap `MACHINE.capacity`). Outsiders get a bounce and a hint.
  - **Mix**: in `packages/server/src/systems/machines.ts`, the action sets `mixerMixUntil`; after `MACHINE.mixS`, one loose `concrete` piece spawns at the chute per bag, then `mixerBags = 0` (persisted).
- [X] T045 [US2] Gate deliveries in `packages/server/src/world/systems.ts`:
  - a hand delivery calls `deliver(…, 'hand')` and shows `groundworkFirst` with the current part;
  - `concrete` delivered into the dug pit by a crew member → `pour()` (persist, `ground` event, `groundworkDone` → celebrate);
  - add the cement racks to the rack grab rules.
- [X] T046 [P] [US2] Create `packages/client/src/world/groundworkView.ts`:
  - pit depth by `groundDug`, with at least 3 visible steps;
  - the spoil heap growing;
  - the footing filling by `groundPoured`;
  - the mixer drum spinning while `mixerMixUntil > now`, and a bag counter on the mixer.

  Use it from `packages/client/src/game/netWorld.ts`.
- [X] T047 [P] [US2] In `packages/client/src/game/netWorld.ts`, the plot sign texts become "Dig 3/6: use the excavator" and "Concrete 1/4: use the mixer" during Groundwork (FR-022). In `packages/client/src/game/NetPlay.ts`, show the hints "Dig the foundation first" and "Pour the footing first", "Mixer is full" and "Crew only".
- [X] T048 [US2] Add the machine cue (FR-022a) in `packages/client/src/world/machineCue.ts`. `neededMachine(progress)` decides which machine glows with a bouncing arrow. The cue is shown only to members of that plot's crew, hidden while that machine's `machineOps` slot is taken, and never shown for the forklift. Add `cue()` to `packages/client/src/debug/netDebugApi.ts`.
- [X] T049 [P] [US2] Add sounds to `packages/client/src/audio/sfx.ts`: original procedural engine, hydraulics and mixer-drum sounds, triggered by `machineAct` and machine motion, quieter with distance and muted by the existing toggle (FR-041).
- [X] T050 [US2] Write the e2e test `packages/client/e2e/mp-machines.spec.ts` (part 2): Groundwork end to end on one page: 6 scoops, 4 bags in, mix, 4 buckets poured, Frame unlocks. The cue points at the excavator and then at the mixer.

**Checkpoint**: US1 and US2 work; every new building passes through Groundwork.

---

## Phase 5: User Story 3 - Lift the roof and the bell with the crane (Priority: P1)

**Goal**: high slots (3 roof slots and the bell) can be filled only by the crane. The crane can fill
any matching slot within 1.5 m, and the ring lights up when it is in range. The hook auto-lowers and
auto-raises. A solo Host can do both jobs alone.

**Independent test**: a crew of two finishes Roof & Windows and the Masterpiece using the crane for
the high slots. A hand delivery to a high slot is refused.

- [X] T051 [US3] Write the test first `packages/server/test/crane.test.ts`:
  - **Refused**: a hand delivery when only high slots remain gives `tooHigh`, and the piece is set down at the foot of the tower.
  - **Grab**: the hook grabs the nearest loose piece within 0.8 m below it; the piece leaves the schema `pieces` and `hookType` is set.
  - **Release**:
    - within 1.5 m of a matching empty high slot → `snap {via:'crane'}` and `highFilled + 1`;
    - over a hand slot → snaps as a hand slot;
    - far from any slot → set down at `setDownSpot`, loose again;
    - wrong type → set down.
  - **Reach**: the hook never leaves its yard or its reach.
  - **Solo Host**: one player carries the bell to the pad, enters and lifts it → Masterpiece.
- [X] T052 [US3] Implement the crane in `packages/server/src/systems/machines.ts`:
  - `hookDown` → grab, which moves the piece to `state:'hooked'`, `heldBy`, removes it from the schema and mirrors `hookType`;
  - release → `snapTarget` → `deliver(…, 'crane', slot)` (persist, `snap` event), or `setDownSpot` → loose;
  - broadcast `machineAct`.
- [X] T053 [US3] In `packages/server/src/world/systems.ts`, refuse hand and forklift deliveries with `tooHigh` when only high slots of the current stage remain, setting the piece down at the foot of the tower. Persist `high_filled`, and reset it on stage completion.
- [X] T054 [P] [US3] In `packages/client/src/world/highSlots.ts`, render the high-slot rings at the tower top for stages with empty high slots, and the lit ring for `snapTarget` while the hook carries a piece (FR-027a). Add `snapRing()` to `packages/client/src/debug/netDebugApi.ts`.
- [X] T055 [P] [US3] Update the texts. On the plot sign in `packages/client/src/game/netWorld.ts`: "Roof 1/3: use the crane", "Bell: use the crane". In `packages/client/src/game/NetPlay.ts`, the hint "Too high: use the crane". Extend the machine cue (T048) to the crane while high slots are empty.
- [X] T056 [US3] Write the e2e test `packages/client/e2e/mp-machines.spec.ts` (part 3). With `dev.fillStage` up to Roof & Windows:
  - a hand panel at a high slot is refused;
  - a panel on the pad → crane grab → the ring lights up → release → it snaps;
  - the toss key toggles the hook and cab cameras (`camera()`), and re-entering resets to the hook camera;
  - the bell via the crane gives the Masterpiece.

**Checkpoint**: all P1 stories are done, and a tower can be finished only with the machines.

---

## Phase 6: User Story 4 - Haul a pallet with the forklift (Priority: P2)

**Goal**: the forklift loads up to 4 pieces of the needed type at a rack, drives (faster than
running) and unloads into hand slots or the mixer hopper. It stays out of `noDrive`.

**Independent test**: fill the Walls & Floors stage using only forklift trips, and count the trips.

- [X] T057 [US4] Write the test first `packages/server/test/forklift.test.ts`:
  - **Loading**: at a rack, a pallet of `min(4, needed)` of the stage's or Groundwork part's type (cement while pouring); it never picks unneeded types, `concrete` or cones.
  - **Unloading**:
    - in its own build zone → one hand slot per piece (`snap {via:'forklift'}`), never high slots, and the rest set down beside the plot;
    - cement at its own mixer → into the hopper, up to capacity;
    - anywhere else → loose pieces.
  - **Regions**: it stops at the plaza, other yards and the fence.
  - **Speed**: its top speed is above `MOVE.runSpeed`.
- [X] T058 [US4] Implement `loadPallet` and `unloadPallet` in `packages/server/src/systems/machines.ts`. Piece states are `'pallet'` with `heldBy`, removed from the schema; mirror `palletTypes`.
- [X] T059 [P] [US4] Render the pallet and its pieces on the forks in `packages/client/src/machines/MachineRenderer.ts`, using `palletTypes` and the load code. Use the label "Load 4 bricks" and similar from the rack's needed type.
- [X] T060 [US4] Write the e2e test `packages/client/e2e/mp-machines.spec.ts` (part 4): 2 forklift trips fill the 8 brick slots; driving into the plaza stops at its edge; a worker in the path is not pushed.

---

## Phase 7: User Story 5 - Machines belong to the crew and stay fair (Priority: P2)

**Goal**: operators are put out when they leave or are removed from the crew, disconnect or idle for
60 s, and loads are set down safely. Adoption transfers the machines. Outsiders never move or block a
machine, and machine intents are rate-limited.

**Independent test**: with three devices (Host, member, outsider), check every permission and release
rule.

- [X] T061 [US5] Write the test first, extending `packages/server/test/machines.test.ts`:
  - **Put-out** within 2 s on `leftCrew`/`removed`, `disconnect` and `idle` (60 s with no input), with any hooked or pallet load set down at `setDownSpot`;
  - **Adoption**: an unattended building is adopted → the new crew can enter and the old operator cannot;
  - **No blocking**: an outsider standing on the pad or in the pit does not block an action;
  - **Rate limits**: a flood of `machine` intents → `slowDown` and strikes;
  - **Piece conservation** across every put-out path.
- [X] T062 [US5] Implement the put-out rules in `packages/server/src/systems/machines.ts`, hooked into the crew leave/remove, session leave/away and adoption paths in `packages/server/src/world/systems.ts`, and an idle check in the tick (`lastMachineInputAt`, `MACHINE.idleExitS`). Send `machineExit` with its reason and set loads down.
- [X] T063 [P] [US5] Add the audit counters to `packages/server/src/systems/machines.ts`, exposed through the systems `audit` object: `machineOutsiderOps`, `highFilledByHand`, `workerMovedByMachine` (a pose-change check for non-input steps) and `heldPiecesLost` (piece conservation).
- [X] T064 [US5] Write the e2e test `packages/client/e2e/mp-machines.spec.ts` (part 5): a member in the crane holding a piece is removed by the Host → put out within 2 s and the piece is on the ground.

---

## Phase 8: User Story 7 - Proof it scales: 100 bots with machines (Priority: P2)

**Goal**: the 100-bot load test uses every machine on all 12 plots and still meets every 002 budget,
with the new counters at 0.

**Independent test**: `pnpm loadtest` for 5 minutes. The budgets pass and the machine counts appear
in the report.

- [X] T065 [US7] Add machine behaviours to `packages/server/loadtest/bot.ts`:
  - **Groundwork**: the excavator loops pit ↔ spoil; bots fetch cement and drop it in the hopper; one bot enters the mixer and mixes; bots carry concrete to the pit.
  - **Crane stages**: one bot carries pieces to the pad while the crew bot in the crane grabs, swings to the `snapTarget` and releases.
  - **Forklift**: about 30 % of hand-stage fetches use it.
  - **Permission probes** (`outsiderEnterTry`): about 5 % of bots try to enter other plots' machines.
  - Encode the `act` bit in the input stream, and track `machineOutsiderOps` (any probe accepted).
- [X] T066 [US7] Extend `packages/server/loadtest/run.ts` and `packages/server/loadtest/report.ts` to report version 2 (contracts/loadtest-report-v2.md): the `machines` section, behaviour counts, the 4 new consistency rows, `machineBytesPerClientPerS`, and the pass rule for a full run (`groundworkDone ≥ 4`, `craneSnaps ≥ 8`, `palletUnload ≥ 10`). Keep `--selftest` working.
- [X] T067 [US7] Run `pnpm loadtest --duration 300` and fix any budget breach. Typical suspects: machine record suppression (hashing), the stepping cost, and held pieces churning the schema. Record the report path for the gate.

---

## Phase 9: User Story 6 - Shifts, restarts and solo mode (Priority: P3)

**Goal**: the shift reset parks every machine; a restart restores Groundwork progress and mixer bags
exactly, with machines parked and empty. Solo has all four machines, Groundwork and high slots, with
the same shared rules.

**Independent test**: dig 3 and load 2 bags, then restart; the progress is kept and the machines are
parked. A shift end resets everything. `?solo=1`: finish a tower alone with every machine.

- [X] T068 [US6] Write the test first: extend `packages/server/test/restore.test.ts` (dig 3 and 2 bags with a file database; restart → `groundDug = 3`, `mixerBags = 2`, every machine parked with no operator, and the held loads are not restored) and `packages/server/test/shift.test.ts` (reset → operators put out with reason `shiftReset`, machines parked, new buildings start at Groundwork).
- [X] T069 [US6] Implement the restore and reset paths in `packages/server/src/systems/machines.ts` and `packages/server/src/persistence/repo.ts`: load the 4 columns at boot; on boot and on shift reset all machines are `parkedState` with `machineOps` cleared.
- [X] T070 [US6] In `packages/client/src/world/layout.ts`, `readLayout()` also returns `MachineSpots` for plot 0 from the `M_*` empties (T009) and the cement rack. Drop the crane and excavator boxes from `OBSTACLES`, and add a `SOLO_SITE` adapter (`noDrive` = outside `PLAY_HALF − 1`) for `stepMachine`.
- [X] T071 [US6] Create `packages/client/src/machines/SoloMachines.ts`:
  - steps the 4 solo machines with the shared `stepMachine` at 60 Hz from `Actions` (move, action → `act`, jump → exit, toss → camera);
  - applies the same `progression.ts` transitions: dig, pour, deliver with `via`, and `tooHigh`;
  - removes hooked and pallet pieces from the Rapier world while held, and re-adds them as dynamic bodies at `setDownSpot`;
  - turns cement bags into mixer bags and spawns concrete at the chute.
- [X] T072 [US6] Wire solo mode in `packages/client/src/game/Game.ts`:
  - "Get in" prompts; while seated, disable the Rapier character collider and drive its pose from `seatPose`, and restore it at `exitSpot` on exit;
  - Groundwork gating and hints; high-slot rings and the cue (reusing `highSlots.ts`, `machineCue.ts`, `groundworkView.ts`, `machineCameras.ts` and `MachineRenderer` with 4 instances);
  - `packages/client/src/game/towerPlot.ts` passes `via` and handles `groundworkFirst` and `tooHigh`.
- [X] T073 [P] [US6] Add `machines()`, `myMachine()`, `cue()`, `snapRing()`, `camera()` and `plot.groundwork` to the solo `packages/client/src/debug/debugApi.ts`.
- [X] T074 [US6] Write the e2e test `packages/client/e2e/solo-machines.spec.ts` (`?solo=1`): Groundwork with the excavator and mixer, the crane lifts a roof panel and the bell (with `__hht` shortcuts for the hand stages), and no request goes to `/api` or `/ws`. Update the 001 solo specs (`carry-snap`, `stages`, `masterpiece`) so they finish Groundwork first through a debug shortcut.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T075 [P] Create `packages/client/src/debug/machinesScene.ts` for `?perf=machines` (`?perf=crowd` plus 48 machines posed mid-action; sets `__hhtPerfReady`) and `?shot=machines` in `packages/client/src/debug/shots.ts`. Extend `packages/client/e2e/perf.spec.ts` with `@perf` machine tests on the high and low tiers against `render.machines`.
- [X] T076 [P] Update the docs:
  - `CLAUDE.md`: the debug URLs `?perf=machines` and `?shot=machines`, protocol v2, and the machine rule of thumb (already added);
  - `packages/server/README.md`: the machine system, the v2 migration and the load-test counters;
  - the root `README.md`: the machine controls table.
- [X] T077 Capture the in-game art comparisons with `?shot=machines` into `assets/renders/ingame/machines-plot.png`, for the owner's review against `assets/renders/machines-plot.png`.
- [X] T078 Run `pnpm verify` (including the quick load test) and `pnpm --filter @hht/client e2e:webkit`. Fix any failures.
- [X] T079 Run the full load test (`pnpm loadtest`) and the soak (`pnpm loadtest --soak 1800`), and link both reports.
- [X] T080 Fill in `specs/003-construction-machines/gate.md`: the automated results, the load-test and soak numbers, restart restore, the desktop GPU fps on `?perf=machines`, and the open items (owner approval of renders and the `render.machines` budget, phones, the playtest for SC-001/002/003/009).

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → user stories.
- **The owner gate (T001)** must be checked before Phase 3 starts.
- **The art approval (T006)** must happen before the real models replace the placeholders in T030.
  Gameplay work can proceed on placeholders.
- **US1 (Phase 3)** is the MVP and is required by every other story, since they all enter and
  operate machines.
- **US2** depends on US1.
- **US3** depends on US1. It needs US2 only for end-to-end runs; tests can use `dev.fillGround`.
- **US4** depends on US1. Its mixer-hopper unload needs US2 (T044).
- **US5** depends on US1. Its put-out of hook and pallet loads needs US3 (T052) and US4 (T058).
- **US7** depends on US2, US3 and US4 (the bots use every machine) and on US5 (T063, the counters).
- **US6**:
  - the restore and reset part (T068–T069) depends on US2 and US3;
  - the solo part (T070–T074) depends only on Foundational and reuses the US2 and US3 client views.
- **Polish** comes after all stories.

### Within each story

Tests are written first and must fail before implementation. Then shared rules, server systems,
client wiring and e2e follow. A story is complete at its checkpoint.

### Parallel opportunities

- **Phase 1**: T002, T003 and T004.
- **Phase 2**:
  - the art and layout track (T005–T010) runs in parallel with the shared rules track (T011–T019);
  - within shared rules, T011, T012 and T015 can run in parallel;
  - the server state tasks T020 and T021 can run in parallel;
  - the client tasks T029 and T030 can run in parallel once T019 is done.
- **US1**: T036, T037, T038, T039 and T040 (different client files) after T035 starts.
- **US2**: T046, T047 and T049.
- **US3**: T054 and T055.
- **US6**: the solo track (T070–T074) can run alongside US4, US5 and US7 once US2 and US3 client views exist.

## Parallel example: User Story 1

```text
After T033–T035 (server enter/exit + client routing):
  T036 seated pose (workerView.ts, animation.ts)
  T037 machineCameras.ts
  T038 hud.ts / touch.ts labels
  T039 machineHints.ts + guestProfile.ts
  T040 netDebugApi.ts
```

## Parallel example: Foundational

```text
Track A (art/layout): T005 → T006, T007 → T008, T009 → T010
Track B (shared):     T011, T012, T015 → T013 → T014 → T016 → T017 → T018 → T019
Track C (server):     T020, T021 → T022 → T023 → T024 → T025 → T026   (after T019)
Track D (client):     T027 → T028; T029, T030 → T031                   (after T019)
```

## Implementation Strategy

### MVP first (User Story 1)

1. Phase 1 plus the owner gate (T001).
2. Phase 2 (Foundational). Machines appear parked in the world; placeholders are fine.
3. Phase 3 (US1): enter, drive and exit with prediction. **Stop and validate**: two devices, smooth
   remote view, crew-only entry.

### Incremental delivery

1. **US2 (Groundwork)**: the first machine-required step, with the cue. Demo it.
2. **US3 (crane)**: towers now need machines from start to finish. All P1 is done; run a playtest.
3. **US4 (forklift)**, then **US5 (fairness)**, then **US7 (load test)**: the scale proof for the
   milestone.
4. **US6**: restart, shift and solo.
5. **Polish** and the gate.

### Notes

- **Protocol v2** forces a reload for old tabs. Merge it only with the client and server together.
- **Commits**: commit after each task or logical group, and run `pnpm test` before each commit.
- **Tuning**: never tune numbers outside `MACHINE` (T003). Playtest changes go there and into the
  spec's assumption list.
