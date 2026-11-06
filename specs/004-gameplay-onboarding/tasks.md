# Tasks: First Five Minutes of Construction

**Input**: Design documents in `specs/004-gameplay-onboarding/`
**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/gameplay-guidance.md](contracts/gameplay-guidance.md), [quickstart.md](quickstart.md)
**Status**: All three story implementations are present; automated checks passed on 2026-11-06. Human/device/owner acceptance remains pending.
**Tests**: Included because the binding constitution requires shared-rule and server integration tests, and the feature plan/quickstart explicitly require behavioral regression checks. Write the story tests before the corresponding implementation and confirm the expected failure before making them pass.
**Organization**: Three story increments, ordered P1 → P2 → P3, with an explicit implementation entry gate. All paths are relative to the repository root; new file paths below are intentional.

## Format

`- [ ] Tnnn [P?] [USn?] Description with file path`

`[P]` indicates disjoint work that can run together after its stated prerequisites. It does not authorize concurrent edits to shared integration files. Setup, foundation, and final tasks have no story label. Human/device tasks require actual observations and must remain unchecked when evidence is unavailable.

## Phase 1: Setup

**Purpose**: Establish implementation eligibility and capture the existing gameplay baseline without changing game rules.

- [X] T001 Resolve the 003→004 entry gate by recording completed owner/device/playtest evidence or explicit owner risk acceptance in `specs/003-construction-machines/gate.md` and linking it from `specs/004-gameplay-onboarding/gate.md`; do not infer acceptance from this task-generation request or the older 002→003 acceptance.
- [ ] T002 Capture the pre-change five-newcomer/three-person-crew baseline using `specs/004-gameplay-onboarding/quickstart.md`; write anonymous device, first-action, first-machine-operation, refusal recovery, waiting, completion, and fun observations to `specs/004-gameplay-onboarding/baseline.md` and link the report in `specs/004-gameplay-onboarding/gate.md`.
- [ ] T003 Verify the existing Node 24/pnpm workspace using `.nvmrc` and `package.json`, run the unchanged baseline checks described in `specs/004-gameplay-onboarding/quickstart.md`, and record command outcomes and pre-existing failures in `specs/004-gameplay-onboarding/gate.md`; introduce no dependencies or budget changes.

**Checkpoint**: T001 must be satisfied before implementation; T002 establishes the comparison baseline. Planning/checklist generation does not satisfy these tasks.

## Phase 2: Foundational Contracts

**Purpose**: Establish the small common presentation boundary without implementing story behavior or creating new authoritative state.

- [X] T004 Define and export `GuidanceContext` and `GuidanceSuggestion` types in `packages/shared/src/guidance.ts` and `packages/shared/src/index.ts`, using the normalized input fields in `specs/004-gameplay-onboarding/data-model.md`; preserve “target discriminated as Foreman, machine, rack, hopper, spoil heap, pit, slot, bin, or none”, “One primary suggestion at a time”, and “Suggestions never reserve jobs or authorize an action.”
- [X] T005 [P] Define the normalized transient outcome and learning milestone types in new `packages/client/src/game/gameplayFeedback.ts` from `specs/004-gameplay-onboarding/data-model.md`: “Fields: source event, actor, plot/machine reference, outcome, target when available.” Preserve optional/unknown attribution and world-context identity so later adapters can reject stale context without retaining a second world model.

**Checkpoint**: T004 and T005 establish interfaces only. No new database schema, endpoint, binary snapshot field, or tutorial authority is introduced.

## Phase 3: User Story 1 — Know What to Do Next (Priority: P1) — MVP

**Goal**: A newcomer receives one useful next action and device-appropriate machine help until genuine success or dismissal.
**Independent test**: With a fresh profile, start/join through the Foreman in multiplayer (or start directly at the solo plot), perform useful work unaided, verify help survives movement/time, then hide/reopen it and change input device. This must work before US2 feedback changes and US3 forklift eligibility changes.

### Tests

- [X] T006 [P] [US1] Add selector tests in `packages/shared/test/guidance.test.ts` for priority ordering, no-crew/full-plot fallback, carried material, occupied/free machines, completed buildings, hidden/unknown/disconnected context, and solo direct access; only suggest actions currently permitted before US3 enables early forklift loading.
- [X] T007 [P] [US1] Extend `packages/client/test/guestProfile.test.ts` and add `packages/client/test/machineLearning.test.ts` for invalid/duplicate machine IDs, old seen-only profiles, inaccessible storage, dismiss/replay, absent actor, other-player actions, and success-only learning; movement, entry, timeout, dumpBack, hookRelease, and generic palletUnload must not complete learning.
- [X] T008 [P] [US1] Extend `packages/server/test/machines.test.ts` to verify authoritative machineAct actor attribution across immediate seat exit/handoff, null attribution for asynchronous mixDone, and unchanged crew authorization; assert existing attributed crane snap behavior using `packages/server/test/crane.test.ts`.

### Implementation

- [X] T009 [US1] Extend `ServerEvents.machineAct` in `packages/shared/src/protocol.ts` and emissions in `packages/server/src/systems/machines.ts` with `by: string | null`; retain id/plot/act, capture the direct initiating session before seat transitions, allow null on mixDone, and update affected event fixtures without changing client intents or binary protocol version.
- [X] T010 [P] [US1] Add optional `completedMachineHints: MachineKind[]` and `guidanceHidden: boolean` in `packages/client/src/profile/guestProfile.ts`; follow “Validate machine IDs, deduplicate, default to empty/false, and tolerate inaccessible storage with session memory.” Follow “Preserve existing guest identity and unrelated fields.” Never promote seenMachineHints to completion.
- [X] T011 [P] [US1] Implement `selectGuidance(context)` in `packages/shared/src/guidance.ts` using data-model priority ordering and exports in `packages/shared/src/index.ts`; enforce “Unknown or disconnected state produces no actionable target” and “A completed building produces no construction target.” Until US3, occupied-excavator alternatives may use existing hand cement preparation but must not suggest unsupported early forklift loading.
- [X] T012 [US1] Implement the learning reducer in `packages/client/src/game/gameplayFeedback.ts`: attributable dump, palletLoad, mixStart, and crane snap are milestones; absent by is unknown, delayed mixDone never completes learning, and “Reset stale pending action context on disconnect, crew change, or shift reset; completed learning persists on the device.” Explicit dismissal is session-only and manual replay works after completion.
- [X] T013 [US1] Replace timeout/input dismissal in `packages/client/src/ui/machineHints.ts` with compact success/dismiss/replay behavior; derive keyboard, touch, and gamepad labels from `packages/client/src/input/actions.ts`, wire visibility preferences, and adjust `packages/client/src/ui/hud.css` so help does not obstruct touch controls or rely on color alone.
- [X] T014 [US1] Integrate normalized guidance and confirmed learning events in `packages/client/src/game/NetPlay.ts`, `packages/client/src/ui/netHud.ts`, and `packages/client/src/world/machineCue.ts`; reuse existing target rendering, present Foreman/permitted-bin fallbacks, prevent competing primary arrows, and clear obsolete targets on crew changes, completion, disconnect/reconnect, and shift reset.
- [X] T015 [US1] Integrate equivalent local context and accepted-operation callbacks in `packages/client/src/game/Game.ts`, `packages/client/src/machines/SoloMachines.ts`, and `packages/client/src/ui/hud.ts`; skip multiplayer Foreman/crew prerequisites, keep unknown network attribution conservative, and remove old input-driven hint dismissal in both modes.
- [X] T016 [US1] Add and run `packages/client/e2e/gameplay-guidance.spec.ts` for the independent US1 journey, help retention/replay, active-device labels, old profiles, free play with hidden guidance, full plots, and reset/crew invalidation; run T006–T008 tests and record US1 outcomes in `specs/004-gameplay-onboarding/gate.md`.

**Checkpoint**: US1 is a demonstrable MVP. Its occupied-machine message must remain truthful with original forklift rules; US3 later adds the new parallel operation.

## Phase 4: User Story 2 — Understand Action Results (Priority: P2)

**Goal**: Show accurate crane destinations, confirmed success, and actionable refusal recovery.
**Independent test**: Attempt a wrong piece and hand placement into a crane-only slot, recover from each, then complete a crane placement; test a teammate winning the previewed slot and verify no false success. These scenarios require no early cement preparation.

### Tests

- [X] T017 [P] [US2] Add `packages/client/test/gameplayFeedback.test.ts` covering accepted versus predicted/rejected work, one rendering dispatch per outcome, unknown refusal fallback, reset cleanup, actor-local refusal messages, and muted/reduced-motion result preservation.
- [X] T018 [P] [US2] Add `packages/client/e2e/gameplay-feedback.spec.ts` covering wrong piece, groundworkFirst, tooHigh, occupied machine, full bin/mixer, access denial, valid crane preview, and a concurrent teammate filling the target; assert no false progress or success effect.

### Implementation

- [X] T019 [US2] Add normalized recovery/result selection in `packages/client/src/game/gameplayFeedback.ts`, using the exact refusal-to-recovery mapping in `specs/004-gameplay-onboarding/contracts/gameplay-guidance.md`; preserve “A refusal has a recovery message and no success effect.” Unknown context produces neutral retry/help text rather than an invented destination.
- [X] T020 [US2] Route server-confirmed outcomes through one feedback path in `packages/client/src/game/NetPlay.ts` and accepted local outcomes through the same presentation model in `packages/client/src/game/Game.ts`; reuse existing puff/audio/progress hooks, avoid duplicate effects from overlapping callbacks, and scope refusal guidance to the acting player.
- [X] T021 [US2] Update `packages/client/src/world/highSlots.ts` and its adapters in `packages/client/src/game/NetPlay.ts` and `packages/client/src/machines/SoloMachines.ts` to clear stale/no-longer-eligible crane previews using existing shared snapTarget rules; retain ordinary slot markers and let authoritative concurrent placement results win.
- [X] T022 [US2] Apply bounded and reduced-motion feedback in `packages/client/src/fx/puff.ts`, `packages/client/src/fx/celebration.ts`, `packages/client/src/world/machineCue.ts`, `packages/client/src/world/highSlots.ts`, and `packages/client/src/ui/hud.css`; respect system motion preference and existing audio mute, preserve static/text confirmation, and enforce “bounded effects expire and are discarded when their world context resets.”
- [ ] T023 [US2] Run T017–T018 plus relevant machine/crane regressions, manually exercise muted audio and reduced motion, and record US2 acceptance evidence/screenshots in `specs/004-gameplay-onboarding/gate.md` using `specs/004-gameplay-onboarding/quickstart.md`.

**Checkpoint**: Refusal recovery and placement feedback work with current construction pacing and no US3 dependency.

## Phase 5: User Story 3 — Help While the Excavator Is Occupied (Priority: P3)

**Goal**: Enable safe early forklift cement preparation and make its load/destination clear in both modes.
**Independent test**: One crew member excavates while another loads and delivers cement; premature pour remains refused, overflow remains safe, and solo can perform the same preparation sequence.

### Tests

- [X] T024 [P] [US3] Extend `packages/shared/test/machines.test.ts` and `packages/shared/test/guidance.test.ts` for early cement, per-load quantity boundaries, completed/mismatched work, current-stage hand/high-slot quantities, occupied-machine preparation, and honest no-useful-work fallback.
- [X] T025 [P] [US3] Extend `packages/server/test/forklift.test.ts` and `packages/server/test/groundwork.test.ts` for cement loading during excavation, outsider/range/ownership refusals, premature pour, concurrent hopper filling, overflow conservation, and repeated loads without duplicate held-piece ownership.

### Implementation

- [X] T026 [US3] Implement/export `forkliftLoadCount(progress, pieceType, mixerBags, blueprint)` in `packages/shared/src/machines.ts` and `packages/shared/src/index.ts`; enforce “Output: nonnegative integer no greater than pallet capacity”, “count = min(capacity, max(0, required concrete - poured - mixer bags))”, and “Nonmatching/completed work returns zero.” Preserve post-groundwork material/hand/high-slot semantics; do not globally change neededSupply or add global stock reservations.
- [X] T027 [P] [US3] Replace server palletCount duplication in `packages/server/src/systems/machines.ts` with the shared helper; retain crew/range/live-load checks, safe hopper overflow, piece limits, dig-before-pour, and event actor attribution from US1.
- [X] T028 [P] [US3] Replace solo loading and prompt quantity duplication in `packages/client/src/machines/SoloMachines.ts` with the shared helper; preserve existing local overflow and accepted-result semantics and expose actual load/destination information for the HUD.
- [X] T029 [US3] Update `packages/client/src/game/NetPlay.ts` prompts and `packages/shared/src/guidance.ts` preparation suggestions to use the same helper after T027–T028; prefer useful cement preparation when excavation is occupied, otherwise show permitted work or an honest busy/free-play message without claiming exact global shortages.
- [X] T030 [US3] Display actual pallet count/capacity and hopper/construction/ground-unload destination in `packages/client/src/ui/hud.ts`, `packages/client/src/ui/netHud.ts`, `packages/client/src/game/Game.ts`, and `packages/client/src/game/NetPlay.ts`; show expected overflow before unloading and refresh when another worker changes receiving capacity.
- [X] T031 [US3] Extend and run `packages/client/e2e/mp-machines.spec.ts` and `packages/client/e2e/solo-machines.spec.ts` for early preparation, quantity parity, full-hopper recovery, occupied-machine alternatives, and no premature construction progress; run T024–T025 and record US3 results in `specs/004-gameplay-onboarding/gate.md`.

**Checkpoint**: All three stories are functional. Construction counts, site distances, machine movement, permissions, and additive-only building remain unchanged.

## Phase 6: Polish and Cross-Cutting Validation

**Purpose**: Verify the complete increment against the feature's measured acceptance gate.

- [X] T032 Extend `packages/server/loadtest/machineBot.ts` and `packages/server/loadtest/report.ts` to exercise and report actual cement preparation before excavation finishes while preserving existing operation/consistency coverage; update `packages/server/loadtest/run.ts` only as needed to fail missing scenario coverage rather than treating idle bots as a pass.
- [X] T033 Run `pnpm verify`, `pnpm --filter @hht/client e2e:webkit`, and `pnpm loadtest --duration 300` after T032; record commands, machine scenario counts, tick/bandwidth/memory metrics, and failures in `specs/004-gameplay-onboarding/gate.md`; verify existing budgets in `tools/assets/budgets.json` without increasing them.
- [ ] T034 Measure real desktop/Android/iPhone performance and Chrome/Firefox/Safari compatibility, touch and gamepad usability, critical payload, and representative 4G first-play time following `specs/004-gameplay-onboarding/quickstart.md`; record hardware/browser details and SC-007 results in `specs/004-gameplay-onboarding/gate.md`, never substituting software-renderer fps for hardware evidence.
- [ ] T035 Run the post-change five-fresh-newcomer/three-person-crew and solo full-build sessions from `specs/004-gameplay-onboarding/quickstart.md`; write anonymous measurements to `specs/004-gameplay-onboarding/playtest.md`, compare against `specs/004-gameplay-onboarding/baseline.md`, and record each SC-001–SC-006 result in `specs/004-gameplay-onboarding/gate.md` without coaching before timed milestones.
- [ ] T036 Capture changed guidance/effects against `assets/renders/` references and record the visual review outcome in `specs/004-gameplay-onboarding/gate.md`; leave owner review pending until actual review occurs and do not replace approved references without owner approval.
- [X] T037 Reconcile final behavior, runnable validation steps, and evidence in `specs/004-gameplay-onboarding/quickstart.md`, `specs/004-gameplay-onboarding/contracts/gameplay-guidance.md`, `specs/004-gameplay-onboarding/gate.md`, and `CLAUDE.md`; mark only evidenced tasks complete, and document any count/distance/scope retuning as a spec/plan revision before implementing it.

## Dependencies and Execution Order

```text
Setup T001–T003 → Foundation T004–T005
  → US1 T006–T016 (MVP)
  → US2 T017–T023
  → US3 T024–T031
  → Load coverage T032 → Automated gate T033
  → Device/human/art checks T034–T036 → Final documentation T037
```

The three stories have independent acceptance scenarios, but delivery is intentionally sequential because Game.ts, NetPlay.ts, SoloMachines.ts, and shared guidance/feedback code are touched across increments. US2 reuses the US1 adapters; US3 reuses the US1 guidance pipeline and integrates with US2 feedback. Neither US1 nor US2 requires the later early-loading behavior to pass its own acceptance test.

Within each phase, unmarked tasks follow listed order. Additional dependency details:

- T004 and T005 can proceed independently after Setup. T006–T008 begin only after Foundation and can be written together.
- T009 follows the attribution tests. T010 and T011 use separate modules and can run together after T006–T008/T009; T012 follows both and T009. T013 → T014 → T015 → T016 completes US1.
- T017 and T018 can be written together after US1. T019 → T020 → T021 → T022 → T023 completes US2.
- T024 and T025 can be written together after US2. T026 must land before parallel T027/T028; T029 follows both, then T030 → T031.
- T034–T036 require a tested candidate and available people/devices. Record evidence separately and consolidate gate.md sequentially to avoid edit conflicts.
- Fix relevant failures and rerun affected checks before advancing; do not mark a human or device criterion passed from an automated surrogate.

## Parallel Examples by Story

### US1

After Foundation, write T006 selector tests, T007 profile/learning tests, and T008 server attribution tests concurrently in their disjoint test files. After contract work, T010 profile implementation and T011 selector implementation can proceed together. Integrate adapters serially.

### US2

After US1, T017 feedback unit tests and T018 browser scenarios can be authored concurrently. Implementation T019–T022 is sequential because callbacks, renderers, and lifecycle cleanup overlap.

### US3

After US2, T024 shared-rule tests and T025 server integration tests can be authored concurrently. After T026 defines the shared helper, T027 server wiring and T028 solo wiring can proceed together; integrate prompts and HUD only after both complete.

## Requirement Coverage

| Requirement | Primary tasks |
| --- | --- |
| FR-001 one primary action/target | T004, T006, T011, T014–T015 |
| FR-002 newcomer/permitted fallback | T006, T014, T016 |
| FR-003 success-based help | T007–T010, T012–T016 |
| FR-004 hide/reopen/device controls | T010, T013–T016 |
| FR-005 crane preview | T018, T021, T023 |
| FR-006 confirmed bounded feedback | T017, T019–T023 |
| FR-007 refusal recovery | T018–T020, T023 |
| FR-008 early cement and authority | T024–T028, T031 |
| FR-009 pallet capacity/destination | T028–T031 |
| FR-010 useful occupied-machine alternatives | T024, T029–T031 |
| FR-011 parity and lifecycle resets | T006–T008, T012, T014–T018, T021, T031 |
| FR-012 optional/kind/simple behavior | T014–T016, T025, T027, T031, T034 |
| FR-013 mute and reduced motion | T017, T020, T022–T023, T034 |
| SC-001–SC-006 human outcomes | T002, T035 |
| SC-007 performance/compatibility | T003, T032–T034 |

## Implementation Strategy

**MVP**: Complete Setup, Foundation, and US1, then demonstrate and validate guidance and learning with the existing loading rules. The MVP is not full 004 acceptance: all final gates remain required for the complete feature.

**Incremental delivery**: Validate US1 before US2; validate US2 before US3. Reuse current assets, machines, and event channels throughout. Keep six scoops, four buckets, 30 deliveries, and current distances until measured results justify a reviewed scope revision.

**Completion**: T037 reconciles actual evidence. If playtest targets fail, retain the failed result and identify the cause before changing pacing. No new blueprints, task boards, inventory reservations, accounts, production telemetry, or persistent progression are included.

Execution note (2026-11-05): owner explicitly accepted T001 risks and deferred T002 baseline. T002 remains unchecked, but no longer blocks authorized implementation.

Implementation notes (2026-11-05): guidance UI is shared in `packages/client/src/ui/gameplayGuide.ts` rather than duplicated in the two HUD classes. Normalized feedback is a stateless confirmed-event adapter; existing handlers already render each accepted event once, so no extra event store was introduced. Early-preparation scenario coverage is emitted by authoritative machine counters through the existing report writer; bot behavior is in `packages/server/loadtest/bot.ts`, not the geometry helpers in machineBot.ts. Rule tests for the shared loading helper live in `packages/shared/test/forkliftPreparation.test.ts`. These are equivalent repository-local implementations of the planned task boundaries.

Validation boundaries (2026-11-06): pre-change T003 ran unit/integration tests only, so its original full-baseline wording remains partial. Full-plot fallback is checked by the pure selector tests; overflow conservation is checked by authoritative server integration tests and shared prompt tests. Browser refusal-message cases inject server events at the UI boundary; the crane race uses a second client to inject an accepted stage update through the existing dev fixture, then normal grab/release inputs. These fixtures are not human playtest evidence. T023's manual interaction review, T034–T036's external acceptance, and the deferred baseline remain pending until observed.

Story verification: T016 and T031 are satisfied across the browser, pure-rule, and authoritative integration layers described above; full-plot and full-hopper cases are intentionally verified at the rule/server boundary rather than duplicated as browser fixture setups. T018 includes real solo refusals, server-event UI contract checks, existing crane journeys, and the accepted-update race regression.
