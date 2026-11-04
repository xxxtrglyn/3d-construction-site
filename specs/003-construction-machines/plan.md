# Implementation Plan: Construction Machines

**Branch**: `003-construction-machines` | **Date**: 2026-11-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-construction-machines/spec.md`

## Summary

Add four operable machines to every plot, and to the solo lot, and make three of them necessary for
building:

- **Excavator**: digs the foundation pit (6 scoops).
- **Cement mixer**: turns cement bags into 4 concrete buckets for the footing.
- **Tower crane**: the only way to fill the 4 high slots (3 roof slots and the bell). It can also
  fill any other matching slot.
- **Forklift**: optional; carries pallets of up to 4 pieces.

Only a plot's Host and crew can operate its machines. Machines never push or block workers. Solo
mode gets the same machines and rules.

Technical approach:

- **Simulation**: one pure, deterministic `stepMachine()` in `shared` (60 Hz, parameter rigs, no
  physics engine). The server (authority), the operating client (prediction and replay), solo mode
  and the bots all use it (research M1, M3).
- **Inputs**: they ride the existing seq'd move-input stream, with two new flag bits (`act`, `alt`),
  so actions apply at the exact step the operator pressed them (M2). Enter and exit are JSON
  intents.
- **Wire**: protocol **v2**. A 12-byte machine record goes in the per-client binary snapshot, with
  the 002 interest tiers and change suppression. The carry code grows to 4 bits. Discrete state
  (operators, Groundwork, mixer bags, loads) goes in the Colyseus schema (M4, M5).
- **Rules**: `TowerProgress` gains Groundwork and high-slot counters, with pure transitions (`dig`,
  `pour`, and `deliver` with `via`). Stars and the 6 stages are unchanged (M6).
- **Layout**: `site_layout.py` and `lot.py` generate the machine spots, the cement racks and the
  drivable regions, and remove the static scenery machines (M7).
- **Client**: instanced, per-part machine rigs (about 26 draw calls for 48 machines), plus LOD1
  models, streamed after play starts. There are crane cameras (hook and cab), crew-only cues and
  snap-ring feedback (M12, M13).
- **Persistence**: schema v2 adds 4 building columns. Machine poses are not stored (M11).
- **Bots**: the load test gains machine behaviours and 4 new consistency counters (M14).

Details are in [research.md](./research.md) (M1–M16).

## Technical Context

**Language/Version**: TypeScript 7.0.2 `strict` (the server uses `erasableSyntaxOnly`) on Node.js
24 LTS (24.18.0). The asset builders use Python 3 in Blender 5.2.

**Primary Dependencies**: unchanged from 002, and no new dependency:
- server: Colyseus 0.18 (`@colyseus/core` 0.18.23), `@colyseus/schema` 5.0.43;
- client: three 0.187, `@colyseus/sdk` 0.18.9, and Rapier 0.21 (solo only, unchanged: it runs the
  solo worker and pieces, **not** the machines);
- tools: Vite 8, Vitest 5, Playwright 1.64, gltf-transform 4.5.

**Storage**: SQLite (`node:sqlite`, WAL) at `data/hht.sqlite`, migrated v1 → v2
([contracts/persistence-v2.sql](./contracts/persistence-v2.sql)). The client profile
`hht.profile.v2` gains `seenMachineHints`.

**Testing**:
- **Vitest**: the shared machine kinematics (determinism by recorded-input replay), the progression
  transitions and the v2 codecs.
- **Vitest + `@colyseus/testing`**: server integration (permissions, put-out, piece conservation,
  the mixer, restore, migration).
- **Playwright**: multiplayer and solo machine flows, on Chromium, Firefox and WebKit.
- **`pnpm perf`**: the `?perf=machines` scene.
- **`pnpm loadtest`**: bots with machine behaviours.

**Target Platform**: as in 002. The client runs in current Chrome, Firefox and Safari on desktop,
Chrome on Android and Safari on iOS 16+, with WebGL 2. The server runs on Node 24 (local and dev
only).

**Project Type**: web application. It consists of the static client game, the authoritative
realtime server, the shared rules package and the asset pipeline.

**Performance Goals**:
- **Server**: unchanged 002 budgets with machines active on all 12 plots: 20 ticks/s, tick average
  ≤ 10 ms and p99 ≤ 25 ms, ≤ 256 MB.
- **Stepping cost**: 48 machine steps × 3 sub-steps per tick, at < 2 µs each, is < 0.3 ms per tick.
- **Network**: ≤ 30 KB/s per client. The machine records add an estimated ≤ 2.4 KB/s in the worst
  case.
- **Client**: 60 fps desktop and ≥ 30 fps mid-range phone, with 100 workers, 12 towers and 48
  machines visible.

**Constraints**:
- **Critical payload**: unchanged (≤ 5 MB; multiplayer is about 1 MB today). The machine assets are
  deferred, with placeholders until they load (FR-038).
- **Controls**: stay move + action + toss (+ jump) (Principle V).
- **Building**: additive-only. Machines never move or harm workers.
- **Protocol**: the v2 bump forces old clients to reload (close code 4001).

**Scale/Scope**:

| Item | Amount |
|---|---|
| Machines | 48 in a world (12 plots × 4) and 4 in solo |
| Machine kinds | 4 |
| New piece types | 2 (cement, concrete) |
| New racks | 4 cement racks in multiplayer, 1 in solo |
| New assets | 4 machines + 4 LOD1 |
| New wire records | 1 (the 12 B machine record) |
| Message types | 1 new client message (`machine`), 4 new or extended server events |
| Schema fields | 8 `PlotState` fields + 1 `PlayerState` field |
| Database | 4 new building columns |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this plan complies | Status |
|---|---|---|
| I. Instant Play | No new login or step. The critical payload is unchanged because the machine assets are deferred, with placeholders. A v2 client still joins from the link; stale v1 tabs get the existing "new version, reload" prompt. Works in all browsers in the e2e matrix, WebKit included | ✅ |
| II. Server Authority | The server simulates every machine with the shared `stepMachine()` from the operator's seq'd inputs, and decides entering, permissions, scoops, mixing, pallets, hook grabs and releases, and snaps. Clients send only inputs (move, `act`) and intents (`machine enter/exit`). The operator predicts with replay and smoothed corrections; others interpolate. Interest tiers plus change suppression keep traffic ≤ 30 KB/s. Machines belong to the plot, so the 002 handover and adoption carry them | ✅ |
| III. Performance Budgets | Machines are **kinematic rigs driven by parameters** (slew, trolley, hook height, boom, forks), exactly as the principle says. There are no rigid bodies, and Rapier is not used for machines at all. New numeric budgets: `render.machines`, `perAsset` for 8 machine assets, and the load-test pass rule with machines. All are enforced by `pnpm perf`, `check:budgets` and `pnpm loadtest`. The triangle ceiling of the new scene (700 k) is a recorded decision for owner approval (Complexity Tracking) | ✅ (with an owner approval item) |
| IV. Art Fidelity & Original IP | Four original machines come from scripted Blender builders through gltf-transform, with the toon material and outlines. There are owner review renders for each machine plus the plot layout before integration, and `?shot=machines` for the in-game comparison | ✅ |
| V. Simple & Kind Sandbox | Controls are re-mapped, not added: move, action, jump = exit, toss = crane camera. No forced goals: the machine steps are part of the optional tower goal, and free play is never blocked. Building stays additive-only, because machines cannot remove or move snapped pieces. Anti-griefing: crew-only operation, no collision with workers (nobody can be pushed or block a crew), put-out on leave, disconnect or idle, and rate limits and strikes on machine intents | ✅ |
| VI. Test & Measure | All machine rules and the kinematics are pure functions in `shared`, with unit tests that include a determinism replay test. The server has integration tests. The 100-bot load test exercises every machine and asserts 4 new consistency counters. The phase gate is in quickstart → gate.md | ✅ |
| VII. Simplicity | No new dependency or framework. It reuses the input stream, prediction, interest tiers, schema and SQLite from 002. The solo worker stays on Rapier (no refactor), and only machines use the shared stepper there | ✅ |

**Workflow gate**: the constitution says a phase does not start until the previous gate passes or
the owner accepts the risk. The 002 gate still has owner, device and playtest items open (see
`specs/002-multiplayer-core/gate.md`). **Implementation of 003 needs that acceptance**, so it is
listed as the first item of the 003 gate. Planning may proceed.

**Result**: PASS, with two owner approval items: the 002 gate acceptance and the `render.machines`
triangle budget.

**Post-design re-check (after Phase 1)**: PASS.
- **Contracts**: every new client message is an input or intent, with validators in `shared`
  ([network-protocol-v2.md](./contracts/network-protocol-v2.md)).
- **Data model**: the rules are pure, and piece conservation and permissions are invariants with
  tests ([data-model.md](./data-model.md) §7).
- **Controls**: the [controls contract](./contracts/controls.md) adds no button.
- **Persistence**: the migration is additive.
- **Budgets**: every new budget is numeric and automated.

## Project Structure

### Documentation (this feature)

```text
specs/003-construction-machines/
├── plan.md              # This file
├── research.md          # Phase 0 decisions M1–M16
├── data-model.md        # Machines, spots, progress, pieces, records, invariants
├── quickstart.md        # Run/verify guide + phase gate
├── contracts/
│   ├── network-protocol-v2.md
│   ├── persistence-v2.sql
│   ├── controls.md
│   ├── debug-api.md
│   └── loadtest-report-v2.md
├── checklists/requirements.md
└── tasks.md             # Created by /speckit-tasks
```

### Source Code (repository root)

```text
tools/assets/budgets.json        # + perAsset machine-* (+ -lod1), render.machines
tools/blender/builders/
├── machines.py                  # NEW: crane, excavator, forklift, mixer (rig nodes) + LOD1 + review renders
├── site_layout.py               # + MachineSpots per plot, cement racks, noDrive; asserts no overlap
├── site.py                      # − static crane/excavator; + pit outline, spoil heap, hook pad markings
└── lot.py                       # solo: same spots around the single plot; − static machines; + cement rack

packages/shared/src/
├── machines.ts                  # NEW: MachineState, stepMachine, seatPose, exitSpot, hookPos, canEnter,
│                                #      snapTarget, setDownSpot, neededMachine, drivable regions
├── progression.ts               # + groundwork (dig, pour), highFilled, deliver(via) → tooHigh/groundworkFirst
├── blueprints.ts                # + StageDef.highSlots, Blueprint.groundwork
├── pieces.ts                    # + cement, concrete (appended: old carry codes unchanged)
├── site.ts / site.gen.ts        # + MachineSpots, noDrive (generated)
├── protocol.ts                  # PROTOCOL_VERSION 2; input flag bits; machine msg/events; snapshot v2 codec
├── rateLimit.ts                 # + 'machine' bucket class
└── constants.ts                 # + MACHINE tuning (speeds, timings, ranges, idle 60 s)
packages/shared/test/            # machines (determinism replay, limits, regions), progression v2, codecs v2

packages/server/src/
├── systems/machines.ts          # NEW: enter/exit, put-out rules, stepping from inputs, actions → effects
├── systems/snapshots.ts         # + machine block (tiers + change suppression), ownMachine
├── systems/movement.ts          # route inputs to the machine while seated; seated worker pose
├── world/systems.ts             # deliver(via), dig/pour hooks, hooked/pallet piece states, mixer output
├── rooms/schema.ts              # PlotState/PlayerState additions
├── persistence/                 # schema.sql v2 + migration; repo writes for the new columns
└── (loadtest/) bot.ts, run.ts   # machine behaviours, outsider probes, new counters, report v2
packages/server/test/            # machines.test.ts, groundwork.test.ts, crane.test.ts, forklift.test.ts, migration.test.ts

packages/client/src/
├── machines/                    # NEW: MachineRenderer (instanced parts + LOD1 + placeholders),
│                                #      machineViews (interpolation), SoloMachines (solo stepping + effects)
├── net/prediction.ts            # generic over state type (worker | machine)
├── game/NetGame.ts / NetPlay.ts # enter/exit, input routing while seated, events → FX/sounds
├── game/Game.ts                 # solo: wires SoloMachines, seated Rapier worker, groundwork + high slots
├── player/                      # + craneCamera (hook/cab), machine follow camera
├── world/                       # + pit/spoil visuals by groundDug, high-slot rings, hook pad, cues
├── ui/                          # + machine prompts/labels, control hint cards, plot sign texts
└── debug/                       # + machines API, ?perf=machines, ?shot=machines
packages/client/e2e/             # mp-machines.spec.ts, solo-machines.spec.ts, perf machines
```

**Structure Decision**: keep the constitution's three-package monorepo.
- **Rules and kinematics**: all new machine rules and kinematics go in `packages/shared`, so the
  server, the multiplayer client, solo mode and the bots share one definition (FR-042).
- **Server**: gets one new system module, and the large `world/systems.ts` only gains hooks for
  `via`, Groundwork and the held-piece states.
- **Client**: gets a `machines/` folder for rendering and solo stepping.
- **Art**: machine art is one new Blender builder.

## Complexity Tracking

> These are not principle violations. They record choices that are more involved than the obvious
> path, and one budget change that needs the owner's approval.

| Choice | Why needed | Simpler alternative rejected because |
|---|---|---|
| A custom shared machine stepper instead of physics-engine machines | Server authority with deterministic prediction (Principle II), and one rule set for solo and multiplayer (FR-042, owner decision B). Principle III asks for parameter rigs | **Rapier kinematic bodies**: solo-only and not deterministic across builds. **Server-only simulation**: 100–250 ms of input lag makes the crane unusable (SC-001) |
| Protocol v2 (carry code 4 bits + a machine block) | 9 piece types do not fit the 3-bit carry code. Machine poses need per-receiver tiers to fit 30 KB/s | **Machines in the schema**: no per-receiver rates, and about 4× the bytes. **Keeping v1 with a side channel**: two snapshot formats to keep in sync |
| `render.machines` budget: 700 k triangles on the high tier (`render.crowd` stays 600 k) | The crowd scene already uses 578 k. 12 near cranes add about 60 k even with LOD1 beyond 30 m. Device fps (SC-007) stays the binding gate | **Squeezing machines into 600 k**: would need the machines (or crowd detail) at LOD1 everywhere, which breaks art fidelity at close range. **Needs owner approval** (Principle III: budgets are recorded decisions) |
| Solo uses Rapier for the worker and shared kinematics for the machines | One definition of the machine rules (FR-042) without refactoring the 001 solo worker | **Moving the solo worker to `stepWorker()`**: a large, risky refactor outside this feature (Principle VII); noted as a follow-up |
