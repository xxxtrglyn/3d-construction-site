# Feature Specification: Mixed-Material Stages

**Feature Branch**: `004-mixed-material-stages`

**Created**: 2026-11-05

**Status**: Draft

**Input**: User description: "Mixed-material stages for Hard Hat Town (feature 004), building on 001-003. Today each Clock Tower stage needs ONE piece type only; the owner wants each stage to need a MIX of two materials so building is less repetitive and crews get natural roles (one fetches bricks, one drives the forklift for beams, one runs the crane). Recipe (owner-approved, 31 deliveries, was 30): Frame 4 beam + 2 brick; Walls & Floors 6 brick + 2 beam; Roof & Windows 4 panel + 2 beam (3 of the panels are high slots, crane only, as in 003); Paint 3 paint + 1 panel; Decoration 3 decor + 2 paint; Masterpiece 1 bell (high slot, crane only) + 1 decor. Groundwork (6 excavator scoops + 4 concrete) is unchanged. Rules: every slot on the tower is typed and shows a ghost of its material; a matching piece delivered by hand or forklift anywhere in the crew's build zone snaps into the next free ordinary slot of its type, in any order within the stage (no aiming at exact spots); crane deliveries keep 003's spatial targeting (lit ring within 1.5 m) and may fill any matching slot. A piece type the stage does not need (or no longer needs because its quota is full) is refused gently with a hint naming what is still needed, never silently consumed. The plot sign, the HUD and the Foreman show the remaining needs per material with icons (e.g. bricks x3, beams x1, "crane" next to high slots), with checkmarks for completed materials; the crew cue/arrow logic from 003 adapts. The forklift still carries single-type pallets (up to 4, capped at the remaining need of that type); mixed pallets are out of scope. The supply bin for non-crew helpers accepts only materials the current stage still needs (capped by remaining demand minus matching pieces already binned). Towers in progress in SQLite when 004 ships keep their old one-type recipe until they finish or the hourly shift reset (recipe versioned per building), never reinterpreted. Solo mode (?solo=1) uses the same recipes. Load-test bots must fetch the right mix and still finish towers; network budget (30 KB/s per client), 100 players, 20 Hz tick and the 5 MB critical payload must hold. Controls stay move + action + toss (+ jump). Out of scope: new materials, mixed pallets, a forced order within a stage, assigned jobs/roles, random recipes, other blueprints."

**Owner decisions (2026-11-05)**: every stage needs **two materials**; the recipe below (31
deliveries) was picked by the owner from three candidates (design input from codex and agy); the
crane keeps its 003 job (the 3 high roof slots and the bell).

## Overview

Since feature 001 each Clock Tower stage takes one material: 6 beams, then 8 bricks, then 6 panels,
and so on. A crew walks to the same rack again and again, and there is little reason to split up.
This feature gives every stage a **recipe of two materials**:

| Stage | Main material | Second material | Total | Needs the crane |
|---|---|---|---:|---|
| Groundwork | 6 scoops (excavator) | 4 concrete (mixer) | — | unchanged from 003 |
| 1. Frame | 4 beams | 2 bricks | 6 | — |
| 2. Walls & Floors | 6 bricks | 2 beams | 8 | — |
| 3. Roof & Windows | 4 panels | 2 beams | 6 | 3 of the panels (high slots) |
| 4. Paint | 3 paint buckets | 1 panel | 4 | — |
| 5. Decoration | 3 decor crates | 2 paint buckets | 5 | — |
| 6. Masterpiece | 1 golden bell | 1 decor crate | 2 | the bell (high slot) |
| **Total** | | | **31** (was 30) | 4 crane lifts (as in 003) |

The main material still defines each stage's look (steel frame, brick walls, roof, paint, decoration,
bell). The second material adds visible details (brick footings, beam lintels, beam ridge, a panel
trim, paint touches, a decor weathervane) so the tower still reads clearly from across the site.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build a stage from two materials (Priority: P1)

A crew member looks at their plot: ghost pieces on the tower show four beams and two bricks. They
bring a beam and drop it anywhere in the build zone: it snaps into a free beam slot. A teammate
brings a brick at the same time: it snaps into a brick slot. When all six slots are filled, in any
order, the Frame is complete and the tower moves to Walls & Floors as before.

**Why this priority**: this is the feature. Without mixed recipes nothing else here matters.

**Independent Test**: on a fresh plot after Groundwork, deliver the Frame recipe by hand in a mixed
order (brick, beam, beam, brick, beam, beam) and check that every piece snaps and the stage
completes after the sixth piece; repeat for every stage up to the Masterpiece.

**Acceptance Scenarios**:

1. **Given** a plot in the Frame stage with no slots filled, **When** a crew member drops a brick in
   the build zone, **Then** it snaps into one of the 2 brick slots, the brick count drops from 2 to 1,
   and the beam count stays at 4.
2. **Given** a stage with all slots but one filled, **When** the last matching piece is delivered,
   **Then** the stage completes with the usual celebration, and the next stage's ghosts appear.
3. **Given** two crew members delivering a beam and a brick within the same moment, **When** both
   arrive, **Then** both snap (each into a slot of its own type) and neither is lost.
4. **Given** the Masterpiece stage, **When** the decor crate is delivered by hand and the bell by crane
   (in either order), **Then** the Masterpiece completes only after both are in.

---

### User Story 2 - Always know what is still needed (Priority: P1)

Anyone glancing at a plot can tell what it still needs: the plot sign shows each material of the
current stage with an icon and a count ("🪵 4 · 🧱 2"), crossed off with a check mark when that
material is done, and a crane mark beside materials that need the crane. A crew member also sees the
same list on their HUD. The Foreman, when asked, says what the crew still needs in one short line.

**Why this priority**: two materials per stage are only fun if nobody has to guess. Without clear
needs, crews bring the wrong pieces and get frustrated (constitution Principle V: simple and kind).

**Independent Test**: during each stage, compare the sign, the HUD and the Foreman line with the
pieces delivered so far; they must always agree and update within a second of each snap.

**Acceptance Scenarios**:

1. **Given** a Frame stage with 3 beams and 1 brick delivered, **When** a player looks at the sign,
   **Then** it shows "beams 1 left" and "bricks 1 left" with icons.
2. **Given** all bricks of the Frame delivered but one beam missing, **When** a player looks at the
   sign, **Then** bricks show a check mark and beams show "1 left".
3. **Given** the Roof stage with its ordinary panel slot and both beams filled, **When** a crew member
   looks at the HUD, **Then** it shows "panels 3 left" with a crane mark, and the crane is cued (as in
   003) because only crane slots remain.
4. **Given** a crew member asking the Foreman for help, **When** the stage still needs bricks and
   beams, **Then** the Foreman names both (for example "Bring 2 bricks and 1 beam!").

---

### User Story 3 - Wrong or surplus pieces are refused kindly (Priority: P1)

A player brings a paint bucket to a Frame, or a third brick when the Frame needs only two. The piece
does not disappear: it is set down just outside the build zone and the player gets a short hint
naming what is still needed ("The Frame needs beams now").

**Why this priority**: with two materials in play, surplus deliveries become common. Silently eating
pieces would feel unfair, and letting surplus pile up would clutter the plot.

**Independent Test**: deliver a type not in the current recipe and a type whose quota is already
full; both must come back to the ground beside the plot with a hint, and the stage counts must not
change.

**Acceptance Scenarios**:

1. **Given** a Frame stage, **When** a crew member drops a paint bucket in the build zone, **Then** the
   bucket is set down outside the zone and the hint names the materials still needed.
2. **Given** a Frame stage with both brick slots filled, **When** another brick is delivered, **Then**
   it is refused the same way, with a hint like "Enough bricks, the Frame needs beams now".
3. **Given** the Roof stage with only crane slots left for panels, **When** a panel is delivered by
   hand, **Then** it is set down at the foot of the tower with the 003 hint "Too high: use the
   crane", unchanged.

---

### User Story 4 - Machines and helpers follow the recipe (Priority: P2)

The forklift driver loads a pallet at a rack: the pallet takes as many pieces of that rack's material
as the stage still needs (up to 4) and unloads them into matching slots. Players outside the crew
drop useful pieces into the supply bin; the bin accepts only what the current stage still needs, so
it never fills with pieces nobody can use. The crane can lift any material into a matching slot.

**Why this priority**: machines and the bin already exist (002, 003); they must not break or become
pointless with mixed recipes. It is P2 because a crew can finish every stage by hand plus crane.

**Independent Test**: during Walls & Floors, load bricks with the forklift (pallet size = bricks
still needed, max 4), unload, then load beams (pallet of 2) and unload; as an outsider, drop a beam
and a paint bucket into the bin and check only the beam is accepted.

**Acceptance Scenarios**:

1. **Given** a Walls & Floors stage that needs 6 bricks and 2 beams, **When** the forklift loads at the
   beam rack, **Then** the pallet holds 2 beams, and the action label says "Load 2 beams".
2. **Given** a forklift pallet of 4 bricks and a stage needing only 3 more bricks, **When** it unloads
   at the plot, **Then** 3 bricks snap and the fourth is set down beside the plot (not consumed).
3. **Given** a rack whose material the current stage no longer needs, **When** the forklift is at it,
   **Then** the action is greyed with "Bricks: not needed".
4. **Given** a Frame stage needing 2 bricks and a bin already holding 2 bricks, **When** an outsider
   drops a third brick, **Then** the bin refuses it with the 002 "not needed" style hint.
5. **Given** the crane carrying a beam, **When** it releases over a free beam slot of the Roof stage,
   **Then** the beam snaps into it.

---

### User Story 5 - Same game everywhere, old towers safe (Priority: P2)

Solo mode uses the same recipes and the same needs display. When the update ships, towers that are
already in progress keep their old one-material recipe until they finish or the shift resets, so no
crew loses progress or sees counts change under them. Load-test bots build towers with the new
recipes and still finish them.

**Why this priority**: consistency and safety for a live world; it does not change what players do.

**Independent Test**: start a tower on the old version, restart the server with this feature, and
continue: the tower keeps its old recipe until the shift resets; new towers use the new recipe. Run
the 100-bot load test and check that bots complete towers.

**Acceptance Scenarios**:

1. **Given** a tower halfway through Walls & Floors under the old recipe, **When** the server restarts
   with this feature, **Then** the tower still needs only the old remaining bricks, and the sign shows
   that old recipe.
2. **Given** the shift reset after the update, **When** a Host starts a new tower, **Then** it uses the
   new two-material recipe.
3. **Given** `?solo=1`, **When** the player builds the tower, **Then** every stage uses the new recipe,
   with the same sign and HUD needs display.

### Edge Cases

- **Two crew members deliver the last brick of a stage at the same instant**: exactly one snaps; the
  other is refused as surplus and set down beside the plot with a hint (no double counting).
- **The crane releases over a slot whose material is already complete**: the 003 rule applies; the
  ring only lights for open slots matching the hooked piece, so nothing snaps and the piece is set
  down under the hook.
- **A crane piece aimed at an ordinary slot**: it may fill it (003 clarification), counting toward that
  material's total like a hand delivery.
- **Bin holds pieces of a material that the stage no longer needs** (the crew finished it by hand):
  they stay in the bin (they are not deleted), crew members can still take them out, and the bin
  prefers to hand out pieces the stage still needs.
- **Forklift pallet loaded for one stage, stage completes before unloading**: leftover pieces that the
  new stage does not need are set down beside the plot, as in 003.
- **A tower on the old recipe when the shift ends**: it is cleared with everything else, and the next
  tower uses the new recipe.
- **Hand delivery of a panel in the Roof stage while the ordinary panel slot is free**: it fills the
  ordinary slot (the 3 high panel slots are crane-only, as in 003).
- **Masterpiece**: if the decor crate arrives first, the stage waits for the bell; if the bell arrives
  first, the stage waits for the decor crate. The Masterpiece celebration plays once, after both.

## Requirements *(mandatory)*

### Functional Requirements

**Recipes**

- **FR-001**: Each Clock Tower stage MUST require exactly the materials and counts in the Overview
  table (31 deliveries in total). Groundwork MUST stay as in feature 003.
- **FR-002**: Each stage MUST name one main material that keeps defining the stage's look; the second
  material's slots MUST be visible as distinct details on the tower.
- **FR-003**: The high slots MUST stay as in 003: 3 of the Roof stage's 4 panel slots and the
  Masterpiece bell slot, fillable only by the crane.
- **FR-004**: Each building MUST record which recipe version it was started with. Buildings started
  before this feature MUST keep the old one-material recipe until they finish or the shift resets;
  their progress MUST never be reinterpreted under the new recipe.

**Delivering**

- **FR-005**: A piece delivered by hand or forklift anywhere in the crew's build zone MUST snap into a
  free ordinary slot of the same material in the current stage, in any order across materials.
- **FR-006**: A delivered piece whose material is not in the current recipe, or whose material is
  already complete, MUST NOT be consumed: it MUST be set down just outside the build zone and the
  deliverer MUST get a hint naming what the stage still needs.
- **FR-007**: A hand or forklift piece whose only open slots of its material are high slots MUST be
  refused with the 003 "Too high: use the crane" behavior.
- **FR-008**: A crane release MUST keep the 003 targeting (nearest matching open slot within 1.5 m,
  lit ring) and MUST work for any material of the current recipe, high or ordinary slots.
- **FR-009**: Simultaneous deliveries MUST never fill more slots of a material than its count; each
  extra piece MUST be handled as surplus (FR-006).
- **FR-010**: A stage MUST complete only when every slot of every material in its recipe is filled.
  Stage completion, stars and celebrations MUST otherwise behave as in features 001-003.

**Showing what is needed**

- **FR-011**: Every tower slot MUST show a ghost of its material while open, so the two materials of
  a stage are visibly distinct on the tower.
- **FR-012**: The plot sign MUST list each material of the current stage with an icon and the number
  still needed, a check mark once that material is complete, and a crane mark when its remaining
  slots are crane-only. It MUST update within 1 second of each snap.
- **FR-013**: A crew member's HUD MUST show the same needs list for their own plot.
- **FR-014**: The Foreman MUST, when asked by a crew member, state the remaining needs of their tower
  in one short line naming every material still needed.
- **FR-015**: The 003 machine cue (glow and arrow on the needed machine) MUST still point at the crane
  only when the remaining slots of the stage are all crane-only, and MUST otherwise stay as in 003.

**Machines and the supply bin**

- **FR-016**: The forklift MUST keep single-material pallets. A pallet loaded at a rack MUST hold the
  smaller of 4 and the number of that material the current stage still needs (ordinary slots first,
  then high slots for the crane, as in 003). Loading MUST be refused with "<Material>: not needed"
  when the stage does not need that rack's material.
- **FR-017**: Unloading a pallet MUST snap as many pieces as there are open matching ordinary slots
  and set down the rest beside the plot, as in 003.
- **FR-018**: The supply bin MUST accept a donated piece only if the current stage still needs that
  material beyond the matching pieces already in the bin (and the bin has room, 10 pieces as in
  002); otherwise the donation MUST be refused with a hint and the piece set down beside the bin.
  Pieces already in a bin MUST NOT be deleted when the stage changes.
- **FR-019**: Taking a piece from the bin MUST prefer a material the current stage still needs.

**Everywhere**

- **FR-020**: Solo mode (`?solo=1`) MUST use the same recipes, needs display and refusal rules.
- **FR-021**: Load-test bots MUST fetch the materials the current stage needs (both materials of each
  stage) and MUST still complete towers in the 100-bot load test, including crane lifts.
- **FR-022**: Controls MUST stay "move + action + toss (+ jump)". No new buttons, menus or inventory.
- **FR-023**: The per-client network budget (30 KB/s average), 100 players per world, the 20 Hz
  server tick and the 5 MB critical payload MUST hold with this feature.
- **FR-024**: Any new or changed tower art (second-material details per stage) MUST follow the approved
  toon style through the scripted asset pipeline, with owner review renders, as in 001-003.

**Out of scope**: new materials, mixed pallets, a forced order within a stage, assigned jobs or
roles, random or per-tower recipes, other blueprints.

### Key Entities

- **Recipe**: for one stage of a blueprint, the list of materials with a count each, and which of
  those slots are high (crane-only). Versioned: the old one-material recipe and the new two-material
  recipe both exist.
- **Stage progress**: for the current stage of a building, how many slots of each material are
  filled, split into ordinary and high slots. Replaces the single "slots filled" counter.
- **Building**: as in 002-003, plus the recipe version it was started with.
- **Typed slot**: one place on the tower for one material, ordinary or high, with a fixed position
  and a ghost while open.
- **Needs summary**: per material of the current stage: remaining count, done flag, and whether the
  remaining slots are crane-only. Shown on the sign, the HUD and by the Foreman.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a playtest of 5 people who did not see the old version, at least 4 can say what
  their plot needs next within 5 seconds of looking at it, at every stage.
- **SC-002**: In the same playtest, fewer than 1 in 10 deliveries is refused as wrong or surplus
  after the first two stages.
- **SC-003**: In a 4-person crew playtest, at least 3 of the 6 stages see two or more players working
  on different materials at the same time.
- **SC-004**: A solo player finishes the whole tower (Groundwork to Masterpiece, with machines) in at
  most 10% more time than with the 003 recipes.
- **SC-005**: The 100-bot load test completes at least as many towers per shift as the 003 baseline,
  with no stalled tower (a tower whose needs no bot can fill for 2 minutes).
- **SC-006**: Per-client bandwidth, server tick time, client frame time and the critical payload stay
  within the existing budgets, measured by the project's existing performance, load and payload
  checks.
- **SC-007**: No piece is ever silently consumed: every refused or surplus delivery in the e2e and
  load tests ends as a piece on the ground or in a bin.

## Assumptions

- The owner-approved recipe in the Overview is final for this feature; balancing tweaks later change
  only counts, not the rules.
- Existing materials, racks, rack positions and piece models are reused; only the tower stage art
  gains visible second-material details (FR-024).
- Hand delivery stays "drop anywhere in the build zone" (no aiming at a slot); only the crane aims,
  as in 003.
- Surplus pieces are set down just outside the build zone, the same spot used today for wrong pieces.
- The Foreman's needs line is plain text from a small fixed set of phrasings (no free text), in line
  with the constitution's generated-text rule.
- Shift reset stays hourly, so towers on the old recipe disappear within an hour of the update; no
  data migration of old progress is needed beyond tagging them as the old recipe.
- Star ratings per stage (1-5) stay as in 001.
