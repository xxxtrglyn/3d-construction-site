# Feature Specification: Single-Player Playable Prototype

**Feature Branch**: `001-single-player-prototype`

**Created**: 2026-11-04

**Status**: Draft

**Input**: User description: "Single-player playable prototype of Hard Hat Town (Phase 0 setup + Phase 1 feel prototype), playable in the browser from a link with no login. A player controls the approved chibi worker on a small floating construction lot in the approved toon style, picks up/carries/tosses building pieces, snaps them into the Clock Tower blueprint, and watches the tower grow through 6 stages to a celebrated Masterpiece. Includes a reproducible asset export pipeline and automated payload/performance budget checks. Multiplayer, Foreman NPC, Host/join, vehicles, cranes, other blueprints, cross-device persistence and shift reset are out of scope."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open the link and move around (Priority: P1)

A first-time visitor opens the game link on a laptop or phone. Within a few seconds, with no sign-up
screen, they are controlling a cute chibi construction worker on a small floating construction lot.
The worker has an automatically assigned friendly name (shown above the head) and a hard-hat color.
The player walks, runs and jumps around the lot while the camera follows smoothly. The scene looks
like the approved reference art: soft two-tone toon shading, cool shadows, ink outlines and bright
toy colors.

**Why this priority**: This is the core promise of the game: click a link and you're playing. If
loading, controls or the look fail, nothing else matters.

**Independent Test**: Open the link in a fresh browser on desktop and on a phone, measure the time
until the worker can be moved, walk to every corner of the lot, jump, and compare a screenshot to
the reference renders.

**Acceptance Scenarios**:

1. **Given** a first-time visitor with no stored data, **When** they open the game link, **Then**
   the worker appears and responds to input without any login, account or install step.
2. **Given** the worker is on screen, **When** the player uses the movement controls (keyboard and
   mouse on desktop, on-screen joystick and buttons on touch devices), **Then** the worker walks,
   runs and jumps, and the camera follows without clipping through the ground.
3. **Given** a visitor who played before on the same device and browser, **When** they open the link
   again, **Then** they get the same guest name and hard-hat color as last time.
4. **Given** the worker walks to the edge of the floating lot, **When** they try to walk off,
   **Then** they are stopped at the edge (or, if they fall, they reappear safely at the spawn point
   within 2 seconds).

---

### User Story 2 - Pick up, carry, toss and snap pieces (Priority: P1)

Around the lot are supply racks and piles that never run out: steel beams, bricks, roof-and-window
panels, paint buckets, decoration crates, plus loose traffic cones. The player walks up to a piece,
presses the single action button to pick it up, carries it (the worker visibly holds it), and
presses the button again to drop it or holds/flicks to toss it. Near the tower plot, glowing blue
ghost outlines show what the tower needs next. When the player drops or tosses a matching piece
into the plot's build zone, the piece flies into the next highlighted ghost slot and locks in with a
satisfying puff, sound and little bounce.

**Why this priority**: Carry → snap is the core interaction of the whole game. It must feel good on
its own before anything is built on top.

**Independent Test**: Pick up each piece type, carry it around, toss it, and snap matching pieces
into the plot; check that wrong pieces are politely refused and that the interaction feels
responsive.

**Acceptance Scenarios**:

1. **Given** the worker is next to a supply rack and not holding anything, **When** the player
   presses the action button, **Then** the worker picks up one piece and the rack still shows pieces
   available.
2. **Given** the worker is holding a piece, **When** the player presses the action button away from
   the build zone, **Then** the piece is placed on the ground in front of the worker and can be
   picked up again.
3. **Given** the worker is holding a piece, **When** the player uses the toss action, **Then** the
   piece is thrown forward in an arc, lands, and can be picked up again.
4. **Given** the worker carries a piece that matches the currently highlighted ghost slot, **When**
   the piece is dropped or tossed into the build zone, **Then** it snaps into the slot with a visual
   puff and sound, and the slot stops glowing.
5. **Given** the worker carries a piece that the current stage does not need, **When** it is dropped
   into the build zone, **Then** it does not snap, a friendly hint shows which piece type is needed,
   and the piece bounces back out of the zone.
6. **Given** a piece is lying loose on the ground, **When** it has not been touched for 60 seconds,
   **Then** it fades away so the lot never gets cluttered.

---

### User Story 3 - Grow the Clock Tower through six stages (Priority: P1)

The lot has one tower plot with the Clock Tower blueprint. As the player delivers pieces, the tower
grows through six stages, each with a big change you can see from across the lot: (1) red steel
frame, (2) brick walls and floors with scaffolding, (3) roof, windows and clock faces, (4) paint in
cream, teal and gold, (5) decoration with banners, striped awnings, fence, hedges and garlands, and
(6) Masterpiece with gold trim, bell dome, glowing clock faces and windows, and fairy lights. A
wooden sign on the plot shows the star rating (1–5 stars), and the remaining slots of the next stage
glow as blue ghost outlines.

**Why this priority**: "Every piece makes the tower more beautiful" is the hook the owner approved;
this story proves the progression is visible and motivating.

**Independent Test**: Deliver all pieces for the tower solo and confirm each stage transition shows
the expected big change, the star sign updates, and the ghost preview always shows what is next.

**Acceptance Scenarios**:

1. **Given** an empty plot, **When** the game starts, **Then** the plot shows the foundation, a
   ghost outline of the stage-1 frame and a sign with 0 lit stars.
2. **Given** a stage has all its slots filled, **When** the last piece of the stage snaps in,
   **Then** the tower transforms into the next stage within 1 second with a short celebration
   (puff and sparkle) and the sign gains a star (up to 5).
3. **Given** the tower is at any stage, **When** the player looks at it from anywhere on the lot,
   **Then** the current stage is recognizable from its silhouette and colors alone.
4. **Given** the player is unsure what to bring, **When** they look at the plot, **Then** the next
   needed piece type is shown by the glowing ghost slots and a small icon above the plot.

---

### User Story 4 - Masterpiece celebration and rebuild (Priority: P2)

When the final stage is completed, the Clock Tower becomes a Masterpiece: fireworks burst above
it, confetti and sparkles fall, windows and clock faces glow, the bell rings, and the worker
cheers. A clear "Build again" button lets the player reset the plot and start over.

**Why this priority**: The payoff makes the loop satisfying and is the moment players will want to
share, but the core loop can be validated without it.

**Independent Test**: Complete the tower (or use a debug shortcut that fills all slots) and confirm
the celebration plays, then reset and confirm the plot returns to its empty state.

**Acceptance Scenarios**:

1. **Given** the tower is in stage 5 with one slot left, **When** the final piece snaps in, **Then**
   the Masterpiece celebration plays for at least 5 seconds and the sign shows 5 gold stars.
2. **Given** the Masterpiece is complete, **When** the player chooses "Build again", **Then** the
   plot returns to the empty foundation with the stage-1 ghost outline, and loose pieces are cleared.
3. **Given** the celebration is playing, **When** the player keeps moving, **Then** controls stay
   responsive and the frame rate stays within budget.

---

### User Story 5 - Reproducible art pipeline and budget checks (Priority: P2)

The project owner (or an agent) runs a single command that exports every in-game model (worker,
pieces, supply racks, props, the six tower stages, effects) from the Blender source files, compresses
them, and reports their sizes against the budgets. A second check verifies the initial download size
and runs an automated performance scene, failing loudly if a budget is exceeded.

**Why this priority**: The constitution requires reproducible assets and enforced budgets; without
them, quality will drift as more content is added. Players do not see this directly, so it ranks
below the playable stories.

**Independent Test**: Delete the exported game assets, run the export command, confirm all assets
are regenerated identically, then deliberately add an oversized asset and confirm the budget check
fails.

**Acceptance Scenarios**:

1. **Given** the Blender source files, **When** the export command runs, **Then** all game assets
   are regenerated, compressed and listed with their sizes, with no manual steps.
2. **Given** an asset or the initial download exceeds its budget, **When** the budget check runs,
   **Then** it fails with a message naming the offending asset and the limit.
3. **Given** the performance check runs on the reference scene, **When** it completes, **Then** it
   reports frame time and draw calls and fails if they exceed the budgets.

---

### Edge Cases

- **Slow connection**: if loading takes longer than 4 seconds, a cheerful loading screen with
  progress is shown; the worker becomes playable as soon as the starting area is loaded, and the rest
  (decorations, later tower stages, celebration effects) streams in afterwards.
- **Unsupported or failing graphics**: if the device cannot run 3D graphics, a friendly message
  explains the problem and suggests another browser or device instead of a blank screen.
- **Storage unavailable** (private browsing, blocked storage): a new guest name and color are
  generated each visit; the game still works.
- **Tab hidden or phone locked**: the game pauses and resumes cleanly; no pieces are lost or
  duplicated.
- **Screen rotation/resize** on mobile: the view and on-screen controls adapt without a reload.
- **Player gets stuck** (inside a supply rack, under the tower, or on the tower's scaffolding):
  a "back to spawn" option returns the worker to the spawn point.
- **Piece tossed off the lot** or lost: it disappears and the supply rack is unaffected (supply is
  unlimited).
- **Rapid button presses**: picking up and dropping repeatedly never duplicates pieces or fills two
  slots with one piece.
- **Both mouse/keyboard and touch** on the same device (e.g., touchscreen laptop): either input
  works; on-screen controls appear only after touch is used.

## Requirements *(mandatory)*

### Functional Requirements

**Access & identity**

- **FR-001**: The game MUST start from a single link with no login, account, registration or install
  step.
- **FR-002**: On first visit, the game MUST assign a random friendly guest name (e.g., "Sunny Bolt")
  and a hard-hat color from a fixed cheerful palette, and remember both on the device for later
  visits.
- **FR-003**: The guest name MUST be shown above the worker's head; the player MAY change it to
  another generated name with a "shuffle" button (no free-text input in this feature).

**Movement & camera**

- **FR-004**: The player MUST be able to walk, run and jump using keyboard + mouse on desktop and an
  on-screen joystick + buttons on touch devices; a gamepad SHOULD also work.
- **FR-005**: The camera MUST follow the worker from behind and above, let the player rotate it around
  the worker, and never pass through the ground or the tower.
- **FR-006**: The worker MUST NOT be able to leave the lot's playable area; if the worker ends up out
  of bounds or stuck, it MUST return to the spawn point (automatically after a fall, or via a
  "back to spawn" option).

**Pieces & building**

- **FR-007**: The lot MUST contain supply racks/piles for each building piece type (steel beam,
  brick, roof-and-window panel, paint bucket, decoration crate, golden bell) that never run out,
  plus loose traffic cones that can be carried and tossed for fun.
- **FR-008**: The worker MUST be able to pick up one piece at a time with a single action button,
  visibly carry it, drop it with the same button, and toss it forward with the toss action.
- **FR-009**: The tower plot MUST show the next needed slots as glowing ghost outlines and display an
  icon of the piece type it needs next.
- **FR-010**: A piece of the needed type dropped or tossed into the plot's build zone MUST snap into
  the next open slot with a visual puff, sound and bounce; one piece MUST fill exactly one slot.
- **FR-011**: A piece of the wrong type dropped into the build zone MUST NOT snap; the game MUST show
  a friendly hint naming the needed piece type, and the piece MUST be pushed back out of the zone.
- **FR-012**: Loose pieces left untouched for 60 seconds MUST fade away; at most 30 loose pieces MAY
  exist at once (the oldest fades first).

**Tower progression**

- **FR-013**: The Clock Tower MUST progress through exactly six stages in order: Frame, Walls &
  Floors, Roof & Windows, Paint, Decoration, Masterpiece, each with a big, recognizable visual change
  matching the approved stage mockup (`assets/renders/clock-tower-stages.png`).
- **FR-014**: Each stage MUST require a fixed set of pieces of one main type, so that completing the
  whole tower solo takes about 10 minutes: Frame 6 steel beams, Walls & Floors 8 bricks, Roof &
  Windows 6 roof-and-window panels, Paint 4 paint buckets, Decoration 5 decoration crates,
  Masterpiece 1 golden bell (30 deliveries total).
- **FR-015**: When a stage's last slot is filled, the tower MUST transform to the next stage within
  1 second, with a short sparkle effect.
- **FR-016**: The plot's sign MUST show the star rating: 0 stars at start, +1 star per completed
  stage up to 5 stars, and gold glowing stars at Masterpiece.
- **FR-017**: Completing the Masterpiece MUST trigger a celebration of at least 5 seconds: fireworks,
  confetti, sparkles, glowing windows and clock faces, a bell sound and the worker cheering.
- **FR-018**: After the Masterpiece, a "Build again" option MUST reset the plot to the empty foundation
  and clear loose pieces. Progress within a session MAY be lost on page reload in this feature.

**Look & feel**

- **FR-019**: All visuals MUST match the approved art direction: soft two-tone toon shading with
  cool-tinted shadows, ink outlines, chunky rounded chibi proportions and the bright toy palette of
  the reference renders in `assets/renders/`.
- **FR-020**: All game models MUST be original and derived from the project's Blender source files.
- **FR-021**: The game MUST give audio feedback for pick up, drop, toss, snap, wrong piece, stage
  complete and Masterpiece; a mute toggle MUST be available.
- **FR-022**: First-time players MUST be guided without a tutorial screen: a bouncing arrow over the
  nearest supply rack until the first pick-up, then over the plot until the first snap, then hints
  disappear.

**Pipeline & budgets**

- **FR-023**: A single command MUST export all game models from the Blender source files, compress
  them and write them to the game's asset folder, with no manual steps.
- **FR-024**: An automated check MUST fail if the initial download needed to start playing exceeds
  5 MB compressed, or if any single asset exceeds its per-asset budget.
- **FR-025**: An automated performance check MUST render a reference scene (full tower at Masterpiece
  plus celebration effects) and fail if the draw-call budget or the frame-time budget is exceeded.
- **FR-026**: Assets not needed to start playing (later tower stages, celebration effects, sounds)
  MUST load in the background after the worker is playable.

### Key Entities

- **Guest Profile**: the player's local identity — generated name, hard-hat color, mute preference,
  first-time-hint status. Stored only on the device.
- **Piece Type**: a kind of carryable object (steel beam, brick, roof-and-window panel, paint bucket,
  decoration crate, golden bell, traffic cone) — its look, carry pose and whether it can fill tower
  slots.
- **Piece**: one carryable instance in the world — its type, position, state (on rack, held, loose,
  snapped) and time since last touched.
- **Supply Rack**: an unlimited source of one piece type at a fixed spot on the lot.
- **Blueprint**: the definition of a tower (Clock Tower in this feature) — its ordered stages, the
  slots per stage and the piece type each slot accepts.
- **Stage**: one step of a blueprint — name, required piece type and count, star value, and its
  visual appearance.
- **Tower Plot**: a place on the lot where a blueprint is built — current stage, filled slots, star
  rating and build zone.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time visitor can move the worker within **4 seconds** of opening the link on a
  typical 4G phone connection, and within **2 seconds** on desktop broadband.
- **SC-002**: The download needed before the worker is playable is **5 MB or less**.
- **SC-003**: Gameplay runs at **60 fps** on a typical desktop/laptop and at **30 fps or more** on a
  mid-range phone (about 3 years old), including during the Masterpiece celebration.
- **SC-004**: In playtests with at least **5 first-time players**, at least **4 of 5** pick up and
  snap their first piece within **60 seconds** without being told how.
- **SC-005**: A first-time player completes the Clock Tower solo in **8–15 minutes**.
- **SC-006**: At least **4 of 5** playtesters describe the experience as fun or satisfying and say
  each stage change was clearly noticeable.
- **SC-007**: Side-by-side screenshots of the in-game tower stages and the approved Blender reference
  renders are judged by the owner to match the art direction.
- **SC-008**: Regenerating all game assets from the Blender sources takes **one command** and
  produces assets that pass all budget checks.
- **SC-009**: The game works in current Chrome, Firefox and Safari on desktop, and in Chrome on
  Android and Safari on iOS.

## Assumptions

- This feature is single-player and runs entirely in the browser; no game server is involved. The
  architecture should not prevent the later multiplayer phase, but no networking is built now.
- The Clock Tower stage visuals reuse the approved Blender mockup (`assets/blender/clock-tower-stages.blend`);
  stage geometry may be simplified to meet performance budgets as long as each stage stays
  recognizable.
- "Snapping" fills the next open slot of the needed type automatically; players do not aim at
  individual slots (keeps controls to move + 1–2 buttons, per the constitution).
- Golden bell is the single Masterpiece piece; pieces for later stages (paint buckets, decoration
  crates) are abstract "kits" that unlock the stage's visual change rather than being placed one by
  one in exact positions.
- Traffic cones are fun props only and never fill tower slots.
- "Mid-range phone" means roughly a 3-year-old Android phone or iPhone; the exact reference devices
  are chosen during planning.
- Session progress is not saved across reloads in this feature; only the guest profile is remembered.
- Text chat, other players, the Foreman NPC, the Host/join system, vehicles, cranes, other
  blueprints, cross-device persistence and the hourly shift reset are out of scope.
