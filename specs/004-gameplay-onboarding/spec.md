# Feature Specification: First Five Minutes of Construction

**Feature Branch**: `develop` (planning only; no feature branch created)

**Created**: 2026-11-05

**Status**: Draft — specified for design; implementation depends on the prior validation gate

**Input**: User description: “give me plan to improve the gameplay” followed by “plan to make with speckit”. Scope follows the proposed first milestone: guidance, feedback, and pacing for the existing Clock Tower.

## User Scenarios & Testing

### User Story 1 - Know what to do next (Priority: P1)

A newcomer sees one useful next action, its destination, and controls appropriate to their device without a forced tutorial.

**Why this priority**: Existing machinery only becomes enjoyable when a newcomer understands how to contribute.

**Independent Test**: Start with a fresh guest, reach a plot, and complete one useful action without verbal instruction.

**Acceptance Scenarios**:

1. **Given** a newcomer without a crew, **When** play begins, **Then** guidance points to the Foreman and explains starting or joining a building; if plots are unavailable, it offers an existing permitted helping route.
2. **Given** a crew member on an unfinished plot, **When** progress or carried material changes, **Then** one next-action message and matching target update to a currently useful action.
3. **Given** first entry into any machine, **When** the player moves or waits, **Then** concise controls remain available until a successful operation or explicit dismissal; moving alone never marks the machine learned.
4. **Given** touch, keyboard, or gamepad input, **When** the active device changes, **Then** displayed controls match it without adding required buttons.
5. **Given** a player who wants free play, **When** guidance is hidden, **Then** all existing activities remain available and help can be reopened.

### User Story 2 - Understand action results (Priority: P2)

A builder can see where a load will go, recognize successful work, and understand how to recover from a rejected action.

**Why this priority**: Clear feedback makes practice rewarding and prevents repeated unexplained failures.

**Independent Test**: Attempt a wrong piece, a hand placement into a crane-only slot, and a valid crane placement; identify the result and next action each time.

**Acceptance Scenarios**:

1. **Given** a crane carrying a piece, **When** it approaches a valid slot, **Then** the destination preview identifies that slot; moving away removes the valid indication.
2. **Given** an accepted delivery or productive machine operation, **When** its result arrives, **Then** a brief visual response confirms it and relevant progress updates; audio obeys the existing mute setting.
3. **Given** a wrong piece, unfinished groundwork, occupied machine, full mixer/bin, or crane-only target, **When** an action cannot proceed, **Then** the player sees the reason and a specific recovery action, without a false success effect.
4. **Given** another worker fills a previewed slot first, **When** the local action resolves, **Then** the preview refreshes and authoritative progress wins.

### User Story 3 - Help while the excavator is occupied (Priority: P3)

A second crew member prepares cement while excavation continues, making early construction cooperative.

**Why this priority**: Parallel useful work reduces waiting without adding another machine or new controls.

**Independent Test**: Two crew members excavate and deliver cement concurrently, then complete the existing footing sequence.

**Acceptance Scenarios**:

1. **Given** unfinished excavation and an empty forklift, **When** a crew member visits the cement rack, **Then** they can load cement for the upcoming footing and unload at their mixer.
2. **Given** excavation is unfinished, **When** cement is staged, **Then** it does not advance construction or bypass the requirement to finish digging before pouring.
3. **Given** the required machine is occupied, **When** another crew member asks for guidance, **Then** it suggests preparing needed cement or another currently permitted useful action; when none exists, it honestly says the crew is working and allows free play.
4. **Given** a loaded forklift, **When** the player approaches its destination, **Then** the load quantity, capacity, and unload destination are visible; a full destination explains where the remaining load will go.
5. **Given** solo play, **When** the same sequence is performed, **Then** help, feedback, and cement preparation behave consistently without requiring teammates.

### Edge Cases

- Crew changes, disconnect/reconnect, and shift reset clear obsolete targets and pending local tutorial actions.
- Existing guests who previously saw machine help are not assumed to have successfully learned it.
- Completed buildings have no remaining construction target; joining or helping remains optional.
- Two workers racing for a slot or mixer space cannot duplicate progress or lose materials.
- Muted audio and reduced motion retain readable success and failure feedback.
- Touch prompts do not cover movement or action controls; targets use text or shape in addition to color.
- An early cement load can become excess if another worker supplies the mixer; overflow follows existing safe unload behavior.

## Requirements

### Functional Requirements

- **FR-001**: Show at most one primary next-action message and one corresponding guidance target, derived from crew access, progress, carried load, and machine availability (US1).
- **FR-002**: Provide a Foreman entry route and a permitted fallback for newcomers when no plot is available (US1).
- **FR-003**: Keep first-use machine help available until explicit dismissal or a confirmed productive operation. Remember successful learning per machine on the device; never infer learning from movement or timeout (US1).
- **FR-004**: Support hiding and reopening guidance, device-appropriate control labels, and readable touch layouts (US1).
- **FR-005**: Preview the currently eligible crane destination and invalidate stale previews when eligibility changes (US2).
- **FR-006**: Provide bounded visual feedback for accepted work and progress, with optional sound; rejected or merely predicted work MUST NOT produce success feedback (US2).
- **FR-007**: Explain each refusal listed in US2 with an actionable recovery instruction, scoped to the acting player (US2).
- **FR-008**: Permit crew forklift cement preparation during excavation; keep mixer capacity, crew permissions, and dig-before-pour rules intact (US3).
- **FR-009**: Show forklift load/capacity and the relevant destination; explain overflow before unloading and retain existing safe material handling (US3).
- **FR-010**: When the primary machine is occupied, suggest useful permitted parallel work if available; otherwise show an honest busy state rather than an impossible objective (US3).
- **FR-011**: Apply the same gameplay and guidance rules in solo and multiplayer; clear stale guidance on crew changes, completion, and shift reset (US1–US3).
- **FR-012**: Keep objectives optional, building additive-only, existing controls sufficient, and existing chat/access protections intact (US1–US3).
- **FR-013**: Preserve existing muted-audio behavior and provide reduced-motion feedback without losing result information (US2).

### Key Entities

- **Guidance suggestion**: A useful action, target, short reason, and optional required material for the current player.
- **Machine learning record**: Which machine operations the local player has successfully completed, plus guidance visibility preference.
- **Action feedback**: Confirmed outcome, affected plot or machine, and short success or recovery message.
- **Supply preparation opportunity**: Required upcoming cement, remaining receiving capacity, and crew eligibility; no separate inventory or reward system.

## Success Criteria

### Measurable Outcomes

- **SC-001**: At least 4 of 5 new players perform a useful action within 60 seconds of gaining movement control, unaided. Useful means accepted delivery/donation, productive excavation, cement staging, or a successful crane placement; walking and entering a seat do not count.
- **SC-002**: At least 4 of 5 new players complete a productive machine operation within 90 seconds of gaining movement control, unaided.
- **SC-003**: At least 4 of 5 participants recover unaided within 15 seconds from each scripted wrong-piece and crane-only-placement refusal.
- **SC-004**: A crew of three completes groundwork within 5 minutes and the tower within 25 minutes from plot assignment; a solo player completes it within 30 minutes.
- **SC-005**: During the first five minutes, each member of the three-person crew spends no more than 60 cumulative seconds waiting or searching because they cannot identify useful work, measured by observation.
- **SC-006**: At least 4 of 5 participants rate machine play as fun and can name their contribution after the session.
- **SC-007**: Existing instant-play, desktop/mobile performance, browser compatibility, and 100-player capacity targets remain satisfied.

## Assumptions

- This feature covers priorities 1–3 of the proposed roadmap. Crew task boards/roles, new blueprints, cosmetic choices, postcards, and scrapbook progression are later features.
- Existing cues, slot rings, effects, supply bins, and safe unload behavior will be improved rather than replaced.
- Six excavation scoops, four concrete buckets, 30 building deliveries, and current site distances remain the baseline. Retuning them is a separate evidence-backed scope revision after playtesting.
- New parallel work is limited to cement preparation during digging; arbitrary future-stage forklift stockpiling is excluded.
- Local learning records need no account and no server persistence. Playtest measurements use anonymous observer notes, not production analytics.
- The 003 machine gate has outstanding owner, device, and human-playtest items. This request authorizes planning; implementation must wait for that gate to pass or explicit owner risk acceptance. No acceptance is inferred here.
