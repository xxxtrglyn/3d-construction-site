---
description: "Task list for 001-single-player-prototype"
---

# Tasks: Single-Player Playable Prototype

**Input**: Design documents from `/specs/001-single-player-prototype/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. Constitution Principle VI requires unit tests for shared rules and automated
budget and perf checks.

**Organization**: Tasks are grouped by user story (US1–US5 from spec.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: The user story the task belongs to
- Paths are relative to the repository root: `packages/shared`, `packages/client`, `tools/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the monorepo skeleton and tooling.

- [X] T001 Create the pnpm workspace: root `package.json` (private; scripts `dev`, `build`, `assets`, `typecheck`, `test`, `e2e`, `perf`, `check:budgets`, `verify`; engines node ≥20.19), `pnpm-workspace.yaml` (`packages/*`), `.gitignore` (node_modules, dist, `assets/build/`, `test-results/`, `playwright-report/`), `.npmrc`
- [X] T002 Create `tsconfig.base.json` (strict, ES2022, moduleResolution bundler, noUncheckedIndexedAccess, exactOptionalPropertyTypes false, verbatimModuleSyntax) and per-package `tsconfig.json` in `packages/shared`, `packages/client`, `packages/server`
- [X] T003 [P] Scaffold `packages/shared/package.json` (name `@hht/shared`, type module, exports `./src/index.ts`, vitest dev dependency) and `packages/shared/src/index.ts`
- [X] T004 [P] Scaffold `packages/client` with Vite 8: `package.json` (deps three@0.187.0, @dimforge/rapier3d-compat@0.21.0, @hht/shared workspace:*; dev: @types/three@0.187.0, vite@8.3.5, vitest@5.1.0, @playwright/test@1.64.1), `vite.config.ts` (target es2022, manual chunk `debug`), `index.html` with an inline loading screen (CSS progress bar), canvas and `#hud` root
- [X] T005 [P] Create the placeholder `packages/server/package.json` and `packages/server/README.md` (phase 2: Colyseus authoritative rooms; not implemented)
- [X] T006 Install dependencies with `pnpm install` and verify that `pnpm typecheck` and `pnpm -r test` run (even with zero tests)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared rules, the asset pipeline and the rendering/physics core that every story needs.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Shared rules (pure TypeScript)

- [X] T007 [P] Implement piece types in `packages/shared/src/pieces.ts`: `PieceTypeId = 'beam' | 'brick' | 'panel' | 'paint' | 'decor' | 'bell' | 'cone'`; `PIECE_TYPES` with label, iconId, `fillsSlots` (false only for `cone`), mass, carryPose ('twoHands' | 'shoulder' | 'hug': beam = shoulder, bell = hug, others = twoHands) and collider
- [X] T008 [P] Implement `packages/shared/src/constants.ts`: walk 3.2 m/s, run 5.5 m/s, jump apex 1.1 m, carry slowdown 15 % (beam, bell), pickup radius 1.2 m within a 120° cone, build zone radius 2.2 m, loose fade 60 s, max loose 30, respawn y −5
- [X] T009 Implement the Clock Tower blueprint in `packages/shared/src/blueprints.ts`: stages Frame/beam/6, Walls & Floors/brick/8, Roof & Windows/panel/6, Paint/paint/4, Decoration/decor/5, Masterpiece/bell/1; starsAfter 1, 2, 3, 4, 5, 5; modelId `clock-tower-stage-<n>`; plus `validateBlueprint()` ("exactly 6 stages numbered 1..6", "slotCount ≥ 1 and total = 30", "pieceType must have fillsSlots = true", "starsAfter non-decreasing, capped at 5")
- [X] T010 Implement `packages/shared/src/progression.ts`: `initialProgress()`, `deliver(progress, pieceType) → { progress, result }` with results `'snapped' | 'stageComplete' | 'masterpiece' | 'wrongPiece' | 'alreadyComplete'`, `reset()`, `neededPiece()`, `starsOf()`, `isMasterpiece()`; invariant: one call changes the progress by at most one slot
- [X] T011 [P] Implement `packages/shared/src/guestName.ts`: `NAME_ADJECTIVES` and `NAME_NOUNS` (construction themed, original), `HAT_COLORS` (8 ids: yellow, orange, white, red, teal, pink, purple, lime, with hex values), `generateName(rng)` producing 3–20 chars with an optional 2-digit suffix, `randomHatColor(rng)`
- [X] T012 [P] Unit tests in `packages/shared/test/blueprints.test.ts` (validateBlueprint passes for CLOCK_TOWER and fails for each broken rule)
- [X] T013 [P] Unit tests in `packages/shared/test/progression.test.ts` (full 30-delivery run reaches masterpiece; wrong piece leaves progress unchanged; `alreadyComplete` after masterpiece; reset; stars per stage; one delivery never advances two slots)
- [X] T014 [P] Unit tests in `packages/shared/test/guestName.test.ts` (length 3–20, only list words, deterministic with a seeded rng, hat colors are valid ids)
- [X] T015 Export everything from `packages/shared/src/index.ts`

### Asset pipeline (Blender → glTF → compressed)

- [X] T016 Port the shared Blender helpers from the mockup scripts into `tools/blender/builders/common.py` (palette, toon/glow material helpers, new_obj, beam, squircle_slab, star, safe for `--background`, no operator context assumptions) and `tools/blender/builders/palette.py` (sRGB palette shared with the client)
- [X] T017 [P] Worker builder in `tools/blender/builders/worker.py` exporting the hierarchy `Worker > Body, Hat, Arm_L, Arm_R, Leg_L, Leg_R, Hand_R` with limb pivots at the joints (contracts/asset-naming.md)
- [X] T018 [P] Pieces and racks builders in `tools/blender/builders/pieces.py` (`Piece_beam`, `Piece_brick`, `Piece_panel`, `Piece_paint`, `Piece_decor`, `Piece_bell`, `Piece_cone`) and `tools/blender/builders/racks.py` (`Rack_<type>`)
- [X] T019 [P] Lot builder in `tools/blender/builders/lot.py` (floating ground tile about 24 × 24 m, grass rim, dirt yard, trees, rocks, grass tufts, spawn pad, boundary fence)
- [X] T020 [P] Clock Tower stage builder in `tools/blender/builders/clock_tower.py`, ported from the approved mockup script (stages 0–6, workers and fireworks removed from the stage geometry, `Sign_Stars` and `BuildZone` empties), plus `tools/blender/builders/fx.py` (firework burst, confetti, sparkle star, puff)
- [X] T021 Export entry point `tools/blender/export_assets.py`: for each asset build a clean scene, remove Solidify outline modifiers, apply the bevels, convert toon materials to Principled `T_<name>` (base = lit color) and glow materials to emissive `G_<name>`, join meshes per material within each node group, then export a glb to `assets/build/raw/<id>.glb` (Y-up)
- [X] T022 Compression and manifest in `tools/assets/compress.mjs` (gltf-transform: dedup, prune, weld, quantize, meshopt → `packages/client/public/assets/<id>.<hash8>.glb`; write `manifest.json` per `contracts/asset-manifest.schema.json` with group critical/deferred and the required `nodes`); root script `pnpm assets` = Blender export + compress
- [X] T023 Budget config and checker: `tools/assets/budgets.json` (critical total ≤ 5 MB, JS ≤ 1.6 MB gzip, per-asset limits from contracts/asset-naming.md) and `tools/assets/check-budgets.mjs` (reads the manifest + `packages/client/dist`, prints a table, exits 1 naming the offending asset)
- [X] T024 Run `pnpm assets` and commit the generated `manifest.json` and assets; verify that the required node names exist

### Client core

- [X] T025 Renderer setup in `packages/client/src/render/renderer.ts` (WebGL2, sRGB output, no tone mapping, pixel ratio capped at 2 (1.5 on low tier), PCFSoft shadows, resize handling, graceful "3D not supported" message)
- [X] T026 [P] Toon material in `packages/client/src/render/toonMaterial.ts` (MeshToonMaterial + onBeforeCompile: 2-band eased ramp 0.28 → 0.48, `shadowTint` (0.50, 0.52, 0.66)), procedural brick variant for `T_brickwall`, unlit glow material for `G_*`
- [X] T027 [P] Inverted-hull outlines in `packages/client/src/render/outline.ts` (BackSide clone; vertex extrusion along normals with screen-constant width; color #2a1a1a; enabled within 25 m; disabled on the low tier)
- [X] T028 [P] Quality tiers in `packages/client/src/render/quality.ts` (high/low detection from device memory, touch and GPU hints; overridable with `?q=`)
- [X] T029 Asset loader in `packages/client/src/assets/loader.ts` (reads `manifest.json`; GLTFLoader + MeshoptDecoder; loads critical then deferred assets; reports progress to the loading screen; remaps `T_*`/`G_*` materials to toon/glow; attaches outlines)
- [X] T030 [P] Physics bootstrap in `packages/client/src/physics/physics.ts` (Rapier compat init, fixed 60 Hz step with accumulator, collider helpers for boxes and cylinders)
- [X] T031 Scene, lighting and loop in `packages/client/src/game/Game.ts` and `packages/client/src/main.ts` (sky color, sun at the same angle as the renders, low hemisphere light, requestAnimationFrame loop with fixed-step update + render, pause when the tab is hidden)
- [X] T032 [P] Input action layer in `packages/client/src/input/actions.ts` per contracts/controls.md (move, run, look, jump, action, toss, respawn, menu)

**Checkpoint**: Shared rules tested, assets exported, renderer showing a toon-shaded test asset.

---

## Phase 3: User Story 1 - Open the link and move around (Priority: P1) 🎯 MVP

**Goal**: Open the link, become a named chibi worker on the lot, and walk, run and jump with a
follow camera, in the approved look.

**Independent Test**: Fresh browser → worker moves within 4 s (Fast 4G throttle); walk the lot
edges; reload keeps the name and color; screenshot matches the art direction.

### Tests for User Story 1

- [X] T033 [P] [US1] Unit test for the profile store in `packages/client/test/guestProfile.test.ts` (generate on first run, persist under `hht.profile.v1`, regenerate on corrupt data, memory fallback when storage throws)
- [X] T034 [P] [US1] Playwright smoke test in `packages/client/e2e/smoke.spec.ts` (loads `/?e2e=1`, `__hht.ready` resolves, holding W changes the worker position, reload keeps the name)

### Implementation for User Story 1

- [X] T035 [P] [US1] Guest profile store in `packages/client/src/profile/guestProfile.ts` (fields from data-model.md: version 1, name, hatColor, muted, hintsDone, createdAt; every read and write wrapped in try/catch)
- [X] T036 [P] [US1] Keyboard/mouse and gamepad sources in `packages/client/src/input/keyboardMouse.ts` and `packages/client/src/input/gamepad.ts`
- [X] T037 [P] [US1] Touch joystick and buttons in `packages/client/src/input/touch.ts` + `packages/client/src/ui/touchControls.css` (dynamic left joystick, right-half drag orbit, [JUMP] [GRAB/DROP] [TOSS], shown after the first touchstart)
- [X] T038 [US1] Lot world in `packages/client/src/world/lot.ts` + `packages/client/src/world/layout.ts` (place the lot, static colliders, invisible boundary walls, spawn point)
- [X] T039 [US1] Character controller in `packages/client/src/player/controller.ts` (Rapier KinematicCharacterController capsule, walk/run/jump speeds from shared constants, camera-relative movement, respawn when below y −5 or on the `respawn` action)
- [X] T040 [US1] Worker view and procedural animation in `packages/client/src/player/workerView.ts` (idle breathing, walk/run leg and arm swing, jump squash, hat tinted with the profile color, name label above the head)
- [X] T041 [US1] Follow camera in `packages/client/src/player/followCamera.ts` (behind/above, orbit via the `look` action, ground/tower collision pull-in, smooth damping)
- [X] T042 [US1] Loading screen progress and "ready" handoff in `packages/client/src/ui/loading.ts` (hide the loader when the critical assets and physics are ready; resolve `__hht.ready`)
- [X] T043 [US1] Debug API core in `packages/client/src/debug/debugApi.ts` (dynamic import when `?debug`/`?e2e`/`?perf`; `ready`, `state()`, `render()`, `debug.teleport`) and the FPS overlay

**Checkpoint**: US1 is playable and testable on its own (the MVP).

---

## Phase 4: User Story 2 - Pick up, carry, toss and snap pieces (Priority: P1)

**Goal**: Unlimited supply racks; one-button pick-up/drop, toss; matching pieces snap into the
plot's next slot with a puff; wrong pieces are refused with a hint.

**Independent Test**: Pick up each type, drop and toss, snap a beam during stage 1, and get the
"Needs: Steel beam" hint when bringing a brick.

### Tests for User Story 2

- [X] T044 [P] [US2] Unit tests in `packages/client/test/pieceManager.test.ts` (one held piece max, loose cap 30 with oldest fading first, 60 s fade, rapid action presses never duplicate pieces)
- [X] T045 [P] [US2] Playwright test in `packages/client/e2e/carry-snap.spec.ts` (`debug.give('beam')` + drop in the build zone → `snapped` event; `give('brick')` → `wrongPiece` event and an unchanged tower state)

### Implementation for User Story 2

- [X] T046 [P] [US2] Supply racks in `packages/client/src/world/racks.ts` (one per slot-filling type plus a cone pile, instanced display pieces, pickup radius 1.2 m)
- [X] T047 [US2] Piece manager in `packages/client/src/game/pieceManager.ts` (states `held | loose | flying | snapped`, dynamic bodies only while loose, 60 s fade, max 30 loose, removal when fallen)
- [X] T048 [US2] Interaction system in `packages/client/src/game/interaction.ts` (nearest-target selection in a 120° cone with a rim highlight, pick-up/drop on `action`, toss on `toss` or a long press, carry poses + 15 % slowdown, debug `give`)
- [X] T049 [US2] Build zone and snapping in `packages/client/src/game/towerPlot.ts` (detect pieces entering the 2.2 m zone, call shared `deliver()`, flying arc to the next slot marker, bounce-out + hint on `wrongPiece`, emit events)
- [X] T050 [P] [US2] Slot markers and the needed-piece icon in `packages/client/src/world/slotMarkers.ts` and `packages/client/src/ui/neededIcon.ts`
- [X] T051 [P] [US2] Puff and sparkle effects in `packages/client/src/fx/puff.ts` (instanced, pooled)
- [X] T052 [P] [US2] Procedural sound effects in `packages/client/src/audio/sfx.ts` (pick-up pop, drop thud, toss whoosh, snap chime, wrong buzz; unlock on first gesture; respect `muted`)
- [X] T053 [US2] Hint toasts and first-time guidance arrows in `packages/client/src/ui/hints.ts` (arrow over the nearest rack until the first pick-up, then over the plot until the first snap; persist `hintsDone`)

**Checkpoint**: Carry → snap feels good; US1 + US2 work together.

---

## Phase 5: User Story 3 - Grow the Clock Tower through six stages (Priority: P1)

**Goal**: Stage models swap as stages complete; the ghost of the next stage; the star sign.

**Independent Test**: Deliver all 30 pieces (or use `debug.completeStage()` repeatedly): each stage
shows a big visual change and the sign gains stars.

### Tests for User Story 3

- [X] T054 [P] [US3] Playwright test in `packages/client/e2e/stages.spec.ts` (`completeStage()` 5× → `completedStages` 5, stars 5; the deferred stage assets load; no console errors)

### Implementation for User Story 3

- [X] T055 [US3] Tower view in `packages/client/src/world/towerView.ts` (shows the completed model for stage N−1, swaps within 1 s with a sparkle + puff on stage complete, removes the delivery pile)
- [X] T056 [P] [US3] Ghost material and ghost of the next stage in `packages/client/src/render/ghost.ts` (Fresnel rim, 25 % alpha, cyan, no shadows; built from the next stage's meshes)
- [X] T057 [P] [US3] Star sign in `packages/client/src/world/starSign.ts` (0–5 stars at the `Sign_Stars` empty; gold glowing stars at Masterpiece)
- [X] T058 [US3] Deferred loading of stages 2–6 in `packages/client/src/assets/loader.ts` (background after spawn; if the player completes a stage before its model is ready, show the puff and swap when the model arrives)
- [X] T059 [US3] Stage-complete sound and arpeggio in `packages/client/src/audio/sfx.ts`, plus debug `completeStage()` in `packages/client/src/debug/debugApi.ts`

**Checkpoint**: The full 6-stage progression is visible; SC-005 can be playtested.

---

## Phase 6: User Story 4 - Masterpiece celebration and rebuild (Priority: P2)

**Goal**: The final bell triggers a celebration of at least 5 s; "Build again" resets the plot.

**Independent Test**: `debug.completeAll()` → celebration plays; `reset()` → empty foundation, loose
pieces cleared.

### Tests for User Story 4

- [X] T060 [P] [US4] Playwright test in `packages/client/e2e/masterpiece.spec.ts` (`completeAll()` → `masterpiece` event, stars 5, `isMasterpiece` true; `reset()` → completedStages 0, loosePieces 0)

### Implementation for User Story 4

- [X] T061 [P] [US4] Fireworks, confetti and sparkles in `packages/client/src/fx/celebration.ts` (instanced particles from `fx.glb` meshes; particle counts reduced on the low tier; lasts ≥ 5 s)
- [X] T062 [P] [US4] Bloom for glow materials on the high tier in `packages/client/src/render/bloom.ts` (threshold so only `G_*` emissive parts bloom; disabled on the low tier)
- [X] T063 [US4] Masterpiece sequence in `packages/client/src/game/masterpiece.ts` (glowing windows and clock faces, bell sound + firework crackles, worker cheer pose, "Build again" button)
- [X] T064 [US4] Menu in `packages/client/src/ui/menu.ts` (mute, shuffle name, back to spawn, build again) wired to the profile and the game reset

**Checkpoint**: Full loop: start → build → Masterpiece → build again.

---

## Phase 7: User Story 5 - Reproducible art pipeline and budget checks (Priority: P2)

**Goal**: A one-command regeneration of assets; budget and perf checks fail loudly.

**Independent Test**: Delete the generated assets → `pnpm assets` restores them; lower a budget →
`pnpm check:budgets` fails naming the asset; `pnpm perf` reports and enforces draw calls.

- [X] T065 [P] [US5] Manifest schema validation in `tools/assets/check-budgets.mjs` (validate `manifest.json` against `specs/001-single-player-prototype/contracts/asset-manifest.schema.json`; required `nodes` present)
- [X] T066 [US5] Perf reference scene in `packages/client/src/debug/perfScene.ts` (`?perf=1`: Masterpiece + looping celebration, fixed hero camera, collects median frame time over 300 frames)
- [X] T067 [US5] Perf check in `packages/client/e2e/perf.spec.ts` + root script `pnpm perf` (fail if draw calls > 250 or triangles > 400 k on high, > 150 / 200 k with `?q=low`; print the frame time)
- [X] T068 [US5] Art comparison camera presets in `packages/client/src/debug/shots.ts` (`?shot=stages`, `?shot=closeup` matching the reference render angles)
- [X] T069 [US5] `pnpm verify` in the root `package.json` (typecheck → test → build → check:budgets → e2e → perf)

**Checkpoint**: All five stories complete and enforced by `pnpm verify`.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T070 [P] Edge cases: unsupported-WebGL message, tab-hidden pause/resume, orientation/resize, touch + mouse on one device (`packages/client/src/main.ts`, `packages/client/src/render/renderer.ts`, `packages/client/src/input/*`)
- [X] T071 [P] Accessibility and UX: readable HUD on small screens, large touch targets (≥ 48 px), reduced-motion option that skips camera shake and confetti (`packages/client/src/ui/*`)
- [X] T072 Run the quickstart validation (all `pnpm` checks), record the results in `specs/001-single-player-prototype/gate.md`, and capture comparison screenshots into `assets/renders/ingame/`
- [X] T073 [P] Update `CLAUDE.md` and add a `README.md` with how to run, controls, and the pipeline

---

## Dependencies & Execution Order

### Phase dependencies

- Setup (Phase 1) → Foundational (Phase 2) → user stories.
- US1 (Phase 3) is the MVP and is required by US2–US4 (they need the worker and the lot).
- US2 depends on US1. US3 depends on US2 (delivery triggers stage progress). US4 depends on US3.
- US5 depends only on Foundational for the pipeline and budgets, and on US4 for the perf scene (it
  can start after Phase 2 for T065).
- Polish comes after all stories.

### Within each story

- Tests are written first and fail, then the implementation follows.
- Shared rules → client systems → UI/FX → debug hooks.

### Parallel opportunities

- Phase 1: T003, T004 and T005 in parallel.
- Phase 2: T007, T008 and T011 in parallel; tests T012–T014 in parallel; Blender builders
  T017–T020 in parallel; T026–T028, T030 and T032 in parallel.
- US1: T033–T037 in parallel, then T038 → T039 → T040/T041.
- US2: T044–T046, T050–T052 in parallel.
- US3: T056 and T057 in parallel.
- US4: T061 and T062 in parallel.

## Parallel Example: User Story 2

```text
Task: "T046 [US2] Supply racks in packages/client/src/world/racks.ts"
Task: "T050 [US2] Slot markers in packages/client/src/world/slotMarkers.ts"
Task: "T051 [US2] Puff fx in packages/client/src/fx/puff.ts"
Task: "T052 [US2] Procedural sfx in packages/client/src/audio/sfx.ts"
```

## Implementation Strategy

### MVP first

1. Phases 1–2 (setup + foundation).
2. Phase 3 (US1). **Stop and validate**: the link → move flow on desktop and phone, and the look
   compared with the renders.

### Incremental delivery

3. US2 → validate carry/snap feel.
4. US3 → validate the 6-stage progression (playtest SC-004/005/006).
5. US4 → celebration and rebuild.
6. US5 → enforcement in `pnpm verify`.
7. Polish → phase gate in `gate.md`.
