# Implementation Plan: First Five Minutes of Construction

**Branch**: `develop` (unchanged) | **Date**: 2026-11-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-gameplay-onboarding/spec.md`

**Status**: All three stories implemented; validation evidence is tracked in gate.md. Owner accepted entry risks on 2026-11-05. Spec Kit resolves feature identifier `004-gameplay-onboarding` from `.specify/feature.json`; this is not a newly created Git branch.

## Summary

Improve the existing Clock Tower loop with contextual next-action guidance, success-based machine help, clearer confirmed feedback, and forklift cement preparation during digging. Reuse existing cues, effects, event channels, and control bindings. Keep building counts and site geometry unchanged until a measured playtest supports retuning.

Deliver three independently verifiable slices in order: US1 guidance, US2 feedback, US3 parallel preparation. Later crew boards, blueprints, customization, and scrapbook features remain separate roadmap work.

## Technical Context

**Language/Version**: TypeScript strict; repository Node 24 baseline.
**Primary Dependencies**: Existing Vite, Three.js, Colyseus 0.18, shared deterministic rules. No new runtime dependency.
**Storage**: Existing guest profile for local learning/preferences; existing SQLite unchanged.
**Testing**: Existing shared/client/server tests, Playwright browser tests, performance scripts, load tests, and observed human sessions.
**Target Platform**: Desktop Chrome/Firefox/Safari and mobile including iOS Safari; keyboard, touch, gamepad; multiplayer and offline solo.
**Project Type**: Browser 3D multiplayer game in the existing three-package monorepo.
**Performance Goals**: 60 fps desktop, ≥30 fps mid-range phone with 100 visible workers; average client bandwidth ≤30 KB/s; time-to-play ≤4 s on 4G.
**Constraints**: Critical payload ≤5 MB compressed; existing numeric asset/render budgets; additive-only construction; optional objectives; existing controls. No new asset downloads required.
**Scale/Scope**: One blueprint, four machine kinds, existing 12 plots and ~100-player worlds. No new economy or services.

## Constitution Check

| Principle | Design assessment |
| --- | --- |
| I Instant Play | Pass: no login, preload, forced tutorial, or new critical assets. |
| II Server Authority | Pass: guidance is advisory; shared loading rule and existing server validation control outcomes. Actor attribution comes from server. |
| III Performance Budgets | Pass by design: bounded existing effects/cues; actual frame and load checks remain required. |
| IV Art Fidelity | Pass by design: reuse approved assets and visual language; capture changed cue/effect screenshots for review. |
| V Simple & Kind | Pass: optional guidance, no extra required control, permissions and chat baseline unchanged. |
| VI Test & Measure | Pass by design: rule/integration/browser/load tests and explicit human/device gate specified below. |
| VII Simplicity | Pass: no framework, service, inventory redesign, or database migration. |

Pre-research and post-design review find no principle-level design exception. **Original planning gate**: `specs/003-construction-machines/gate.md` has owner art/budget approval, device performance, and human playtest items outstanding. This requested draft is not authorization to start implementation or a claim that the prior phase passed. Before implementation, record completion or explicit owner risk acceptance in that gate. Do not infer it from the 002→003 acceptance.

## Project Structure

### Documentation (this feature)

```text
specs/004-gameplay-onboarding/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── gate.md
├── checklists/requirements.md
└── contracts/gameplay-guidance.md
```

`tasks.md` records implementation and remaining validation work.

### Source Code (repository root)

```text
packages/shared/src/guidance.ts                  # proposed pure selection rules
packages/shared/src/machines.ts                  # shared loading quantity rule
packages/shared/src/protocol.ts                  # attributed machineAct event
packages/client/src/ui/machineHints.ts           # success-based, device-aware help
packages/client/src/ui/hud.ts                    # solo guidance/feedback
packages/client/src/ui/netHud.ts                 # multiplayer integration as needed
packages/client/src/profile/guestProfile.ts      # compatible local learning fields
packages/client/src/game/Game.ts                 # solo adapter
packages/client/src/game/NetPlay.ts              # multiplayer adapter and prompts
packages/client/src/machines/SoloMachines.ts      # loading parity and confirmed outcomes
packages/client/src/world/machineCue.ts          # reuse target rendering
packages/client/src/world/highSlots.ts           # preserve shared snap target preview
packages/server/src/systems/machines.ts          # loading rule + event attribution
packages/shared/test/                           # pure rules
packages/server/test/                           # authoritative operations
packages/client/e2e/                            # cross-mode interaction scenarios
```

**Structure Decision**: Extend existing packages; normalize presentation inputs instead of copying game state. Use existing test placement conventions when adding client unit tests.

## Delivery Sequence

### 0. Baseline and entry gate

Record unresolved 003 items and complete them or obtain explicit risk acceptance before implementation. Observe five newcomers and a three-person crew using the current game. Keep timing/qualitative notes anonymous. Separate lack of understanding from travel, machine animation, and network delays. Do not preemptively change counts.

### 1. US1 — Guidance and learning

Add pure suggestion selection and tests for occupied/free machines, carried supplies, crew permissions, completion, and unknown state. Add compatible profile fields and device-aware compact help. Wire both modes to existing cues. Extend machineAct actor attribution to support correct learning; map solo callbacks to the same milestones. Validate this slice before adding new feedback.

### 2. US2 — Confirmed feedback and recovery

Reuse current crane snap target and server outcomes. Connect recovery messages to the same context as guidance. Ensure rejected/predicted actions cannot show success, attribution is safe across seat changes, and effects remain bounded. Verify muted audio, reduced motion, mobile layout, and stale targets.

### 3. US3 — Parallel preparation

Extract shared forklift loading/count logic. Permit cement pickup while digging in server, solo, and prompt prediction. Retain existing mixer, piece conservation, overflow, crew, range, and pour rules. Show actual load/capacity and destination, and select cement preparation when excavation is occupied. Do not promise a global shortage count because loose/in-flight stock is not globally accounted here.

### 4. Validation and iteration

Run the checks in quickstart, repeat the human session with five fresh newcomers, and compare baseline. If completion targets fail, identify whether the cause is guidance or pacing. Any changes to counts, distances, or scope require a documented spec/plan revision and targeted regression checks. Record results in gate.md; never mark human/device checks passed from bot results.

## Risks and Mitigations

- **Stale or conflicting cues**: one selector and shared target calculation; invalidate on crew/shift/progress changes.
- **Incorrect tutorial completion**: server actor field and confirmed operation whitelist; unknown attribution cannot complete help.
- **Extra staged cement**: retain bounded per-load counts, existing capacity/piece limits and safe unload; do not add inventory reservations.
- **Solo divergence**: shared selector/loading helper and matching end-to-end scenarios.
- **No measured fun improvement**: preserve baseline and require human ratings and observable participation.

## Complexity Tracking

No design violations or additional stack components proposed. The prior workflow gate is an explicit prerequisite, not an exception granted by this plan.
