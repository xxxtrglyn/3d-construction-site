# Research: First Five Minutes of Construction

Research source: repository inspection and a read-only research agent on 2026-11-05. These findings establish implementation feasibility, not evidence of player enjoyment.

## R1 — Consolidate guidance

**Decision**: Add one pure guidance selector with normalized inputs; reuse existing machine arrows, slot rings, HUD, and supply destinations. Solo and multiplayer provide adapters.

**Rationale**: `client/src/world/machineCue.ts` already highlights needed machines, `world/highSlots.ts` previews eligible crane targets, and `game/NetPlay.ts` and `machines/SoloMachines.ts` derive prompts independently. Competing cues would make onboarding harder.

**Alternatives considered**: A scripted forced tutorial would interrupt free play; a second independent cue system risks contradictory instructions.

## R2 — Learn through success

**Decision**: Introduce optional local `completedMachineHints` and a guidance visibility preference in `profile/guestProfile.ts`. Do not migrate `seenMachineHints` to completion. Display compact help until dismissal or confirmed success, with existing help replay.

**Rationale**: `ui/machineHints.ts` currently records seen on entry and hides on a six-second timeout or input. `input/actions.ts` supplies the active device for correct labels.

**Alternatives considered**: Extending the timeout still fails slow readers and does not establish learning; server persistence adds no value for local help.

## R3 — Attribute productive actions explicitly

**Decision**: Extend low-frequency `machineAct` JSON events with `by`, the initiating worker session ID, for reliable learning attribution. Existing `snap.by` and `via` confirm crane placement. Solo emits normalized local equivalents. Use successful dump, pallet load, and mix start as machine learning milestones; crane completion requires a successful snap.

**Rationale**: `shared/protocol.ts` and `server/src/systems/machines.ts` already expose confirmed actions. Current `machineAct` lacks an actor; matching seat occupancy has handoff/order races. Release or unload alone does not establish useful placement.

**Alternatives considered**: Client input is not authoritative success. A new binary protocol or dedicated analytics channel is unnecessary. Delayed mixDone is feedback only, so tutorial completion does not depend on a later occupant.

## R4 — Allow bounded cement preparation

**Decision**: Extract shared `forkliftLoadCount` rules and allow cement while digging; do not globally alter `neededSupply`. Reuse this helper on server, solo, and prompts. Preserve existing count semantics: cement count is the minimum of pallet capacity and the positive difference between footing requirement, poured buckets, and hopper bags. No new global inventory accounting.

**Rationale**: `shared/progression.ts` returns no needed supply while digging. Server `systems/machines.ts:palletCount`, solo load handling, and multiplayer prompts consequently refuse early forklift loading. Hand supply, bins, and mixing already allow preparation. `pour` already prevents premature footing progression.

**Alternatives considered**: Broad future-stage stockpiles expand scope. Counting all loose/in-flight material requires substantially more state and can penalize misplaced materials. Extra cement remains possible, with safe unloading and existing piece limits; guidance must not promise an exact global shortage count.

## R5 — Reuse feedback and retain pacing constants

**Decision**: Improve existing puff, celebration, audio, and target rendering with bounded reuse; use reduced-motion presentation. Keep current construction counts and travel distances until observed playtest results justify a revision.

**Rationale**: Existing effects already communicate many actions; new assets are unnecessary. `shared/blueprints.ts` fixes 30 deliveries, six scoops, and four concrete buckets and validates those assumptions.

**Alternatives considered**: Guessing faster counts might conceal poor guidance. New effects/assets increase budgets before the cause of friction is known.

## R6 — Measure with observation

**Decision**: Record anonymous baseline and post-change playtest notes, including timing, confusion, waiting, and fun ratings. No production telemetry service.

**Rationale**: Five newcomers and a three-person crew suffice for this milestone's explicit acceptance gate, though results are directional rather than statistical proof.

**Alternatives considered**: A telemetry backend adds infrastructure and does not explain why players are confused.

## R7 — Keep prior gate explicit

**Decision**: Deliver this requested design as a draft. Do not begin implementation until 003 gate completion or explicit owner risk acceptance is recorded.

**Rationale**: The constitution requires prior phase validation. The earlier acceptance applied to 002 before 003; it does not cover this transition.

**Alternatives considered**: Treating a planning request as acceptance of device/playtest risks would be unsupported.
