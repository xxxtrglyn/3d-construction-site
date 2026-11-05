# Feature Specification: Construction Machines

**Feature Branch**: `003-construction-machines`

**Created**: 2026-11-04

**Status**: Draft

**Input**: User description: "Construction machines for Hard Hat Town (Phase 3), building on the multiplayer world of feature 002. Add four operable machines: a tower crane, an excavator, a forklift/truck and a cement mixer. Machines are NEEDED for some building steps, not optional toys: for example, heavy or high pieces of the top tower stages must be lifted by the crane, a plot must be dug by the excavator before its foundation stage, the forklift/truck carries several pieces at once from the supply racks to a plot, and the cement mixer makes a concrete material that some stages need. Building by hand still works for every other step, and free play is never blocked. Each plot gets its own set of machines, and only that plot's Host and crew members can operate them (same permissions and anti-griefing rules as building in 002; non-crew players cannot use or block a crew's machines). Machines are server-authoritative kinematic rigs driven by parameters (constitution Principle III), not free rigid-body simulations; clients send only operate intents. Controls stay "move + action + toss (+ jump)" on keyboard, touch and gamepad: entering a machine re-maps move and action to the machine. Machines must fit the existing performance and network budgets (100 players visible, 30 KB/s per client, 20 Hz tick, 5 MB critical payload; machine assets stream in after play starts) and the approved toon art style (original Blender assets through the scripted pipeline, with owner review renders). The existing static crane and excavator scenery may be replaced by the operable ones. Solo mode (?solo=1) stays working. The milestone must pass the 100-bot load test with bots that also use machines."

**Owner decisions (2026-11-04)**: all four machines ship in this feature; machines are **needed for
some steps** (crews get a reason to cooperate, and every other step still works by hand); each plot
has its own machines, and **only that plot's Host and crew** may operate them; **solo mode gets all
four machines and Groundwork too**, so the game is the same online and offline.

## Overview

Today a crew builds the Clock Tower by carrying every piece by hand. This feature adds a
construction phase to each building where machines matter:

| Machine | What it does | Needed? |
|---|---|---|
| **Excavator** | Digs the foundation pit before the Frame stage | Yes: the pit must be dug |
| **Cement mixer** | Turns cement bags into buckets of concrete for the footing | Yes: the footing needs concrete |
| **Tower crane** | Lifts pieces into any slot, and is the only way to reach the high slots (the roof and the golden bell) | Yes: high slots cannot be filled by hand |
| **Forklift** | Carries a pallet of up to 4 same-type pieces from the racks to the plot | No: a big speed-up for long hand-carry stages |

The resulting building order for the Clock Tower in the multiplayer world is:

1. **Groundwork** (new, before stage 1): dig the pit with the excavator, then pour the footing with
   concrete from the mixer.
2. **Frame**, **Walls & Floors**: by hand (forklift optional).
3. **Roof & Windows**: windows by hand, the roof's high slots by crane.
4. **Paint**, **Decoration**: by hand (forklift optional).
5. **Masterpiece**: the golden bell goes to the top by crane.

## Clarifications

### Session 2026-11-04

- Q: Where should the camera look while a player operates the tower crane? → A: It starts with a raised camera that follows the hook (hook and slots below in view). The player can switch to the cab view with a button.
- Q: How close to a high slot must the crane hook be for a released piece to snap into it? → A: Within 1.5 m (horizontal distance), and the slot's ring lights up while the hook is in range.
- Q: Can the crane also fill ordinary slots that could be filled by hand, or only the high slots? → A: Any matching empty slot of the current stage, high or ordinary (including the footing during Groundwork).
- Q: How should a crew find out that a step needs a machine, and which one? → A: The plot sign names the machine, and the needed machine glows with a bouncing arrow above it (for the crew) until someone gets in.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Get in a machine and drive it (Priority: P1)

A crew member walks up to one of their plot's machines, presses the action button and climbs in.
Move and action now control the machine: the forklift and excavator drive, the crane swings its arm
and moves its hook. Jump climbs out. Everyone nearby sees the machine move smoothly.

**Why this priority**: this is the shared base of every other story. Without entering, driving and
leaving a machine, no machine step can work.

**Independent Test**: give a test crew a plot with a forklift, enter it, drive it around the yard
and get out again. Watch it from a second device.

**Acceptance Scenarios**:

1. **Given** a crew member standing next to their plot's free machine, **When** they press action,
   **Then** they get in within 1 second, their worker sits in the cab, and a short control hint for
   that machine appears.
2. **Given** a player in a machine, **When** they use move, **Then** the machine responds at once
   on their own screen, and other players within view see the same movement within 0.5 seconds,
   with no teleporting.
3. **Given** a player in a machine, **When** they press jump, **Then** they climb out and stand next
   to the machine, on a free spot outside its body.
4. **Given** a player who is not on that plot's crew, **When** they press action next to the
   machine, **Then** they do not get in and see the note "Crew only".
5. **Given** a machine that already has an operator, **When** another crew member presses action
   next to it, **Then** they do not get in and see "Someone is driving".

---

### User Story 2 - Dig the foundation and pour the footing (Priority: P1)

A new building now starts with Groundwork. A crew member drives the excavator to the pit outline,
scoops dirt with action and dumps it on the spoil heap. After 6 scoops the pit is dug. Then crew
members carry cement bags from the racks into the mixer. The operator starts the mixer, and each bag
becomes a bucket of concrete. Crew members carry 4 buckets of concrete into the pit, and the footing
is poured. The Frame stage unlocks.

**Why this priority**: every building passes through Groundwork, so it is the first machine step
every crew meets. It also teaches the "get in, do the job, get out" loop.

**Independent Test**: start a building, finish Groundwork with only the excavator, the mixer and
hand-carried bags and buckets, and check that the Frame stage unlocks.

**Acceptance Scenarios**:

1. **Given** a new building in Groundwork, **When** a crew member delivers a beam by hand, **Then**
   it is refused with the hint "Dig the foundation first", and the piece drops beside the plot.
2. **Given** the excavator operator at the pit outline, **When** they press action, **Then** the
   bucket fills with dirt. **When** they then press action at the spoil heap, **Then** the scoop
   counts (1 of 6) and the pit gets visibly deeper.
3. **Given** the excavator operator with a full bucket, **When** they press action anywhere other
   than the spoil heap, **Then** the dirt is dumped back where it came from and no scoop counts.
4. **Given** the pit is dug, **When** a crew member drops a cement bag into the mixer's hopper,
   **Then** the mixer holds it (up to 4 bags), and the mixer's sign shows the count.
5. **Given** the mixer holds at least 1 bag and has an operator, **When** the operator presses
   action, **Then** the drum turns for 5 seconds and one bucket of concrete comes out of the chute
   for each bag, ready to carry.
6. **Given** 4 buckets of concrete delivered into the pit, **When** the last one lands, **Then** the
   footing is poured, Groundwork completes with a short celebration, and the Frame stage unlocks.

---

### User Story 3 - Lift the roof and the bell with the crane (Priority: P1)

The top of the tower is out of reach. A crew member carries a roof panel or the golden bell to the
crane's hook pad. The crane operator swings the arm over the pad, lowers the hook, picks the piece
up, swings it over the glowing high slot and releases it. The piece snaps into place.

**Why this priority**: the crane is the iconic machine and the strongest reason for crew teamwork:
one person brings pieces, another lifts them. Without it, no tower can reach the Masterpiece.

**Independent Test**: with a crew of two, finish the Roof & Windows stage and the Masterpiece using
the crane for the high slots, and check that delivering a piece by hand to a high slot is refused.

**Acceptance Scenarios**:

1. **Given** a high slot (one of the roof slots or the bell), **When** a crew member drops or tosses
   a matching piece at it by hand, **Then** it does not fill the slot. The piece drops at the foot of
   the tower with the hint "Too high: use the crane".
2. **Given** the crane operator moving the hook over a piece on the hook pad, **When** they press
   action, **Then** the hook lowers, picks up the piece and rises again.
3. **Given** a piece on the hook within 1.5 m of a matching, empty slot of the current stage, high
   or ordinary (its ring is lit), **When** the operator presses action, **Then** the piece lowers
   into the slot and snaps, exactly as a hand delivery would.
4. **Given** a piece on the hook that is not within range of a matching empty slot, **When** the
   operator presses action, **Then** the piece is set down gently on the ground below the hook,
   inside the crane's reach.
5. **Given** the crane, **When** the operator moves it, **Then** the hook stays within the crane's
   reach, which covers the plot, its hook pad and its supply bin, but never the spawn zone or another
   plot.
6. **Given** a crew whose Host is alone (Solo mode), **When** the Host carries the bell to the pad,
   gets in the crane and lifts it, **Then** they can finish the Masterpiece alone.

---

### User Story 4 - Haul a pallet with the forklift (Priority: P2)

A crew member drives the forklift to the supply racks, lifts a pallet with up to 4 pieces of the
type their stage needs, drives back and unloads them into the build zone. Each piece fills a slot
just like a hand delivery. A Walls & Floors stage of 8 bricks takes 2 forklift trips instead of 8
walks.

**Why this priority**: the forklift is not required, but it turns the longest hand-carry stages into
a quick, satisfying job. It is also the only machine that leaves the plot.

**Independent Test**: fill the Walls & Floors stage using only forklift trips, and count the trips.

**Acceptance Scenarios**:

1. **Given** the forklift operator at a supply rack, **When** they press action, **Then** the forks
   pick up a pallet of up to 4 pieces of the type the plot's current stage needs (or of the next
   needed type if the stage needs fewer).
2. **Given** a loaded forklift inside its own plot's build zone, **When** the operator presses
   action, **Then** the pieces are unloaded one per empty matching slot, and each fills its slot like
   a hand delivery. Extra pieces that have no free matching slot are put down beside the plot.
3. **Given** a loaded forklift anywhere else, **When** the operator presses action, **Then** the
   pallet is set down and its pieces become loose pieces anyone may pick up.
4. **Given** the forklift, **When** it is driven toward the spawn zone, another plot's yard or the
   site fence, **Then** it stops at the edge and cannot enter.
5. **Given** the forklift driving through a crowd, **When** it meets workers, **Then** it passes
   through them without pushing or stopping, so nobody can block it and it can never push anyone.

---

### User Story 5 - Machines belong to the crew and stay fair (Priority: P2)

Machines follow the same rules as building. Only the Host and crew of a plot can get in its
machines. When a member leaves the crew, disconnects or goes idle in a machine, they are put out of
it and the machine parks safely. Nobody outside the crew can use, block or damage a crew's machines,
and nothing a machine does can push, carry or hurt a worker.

**Why this priority**: 100 anonymous players share one site, so machines must be impossible to grief
before they are fun to share. These rules extend the 002 anti-griefing design.

**Independent Test**: with three devices (Host, member, outsider), check every permission and
release rule in the scenarios below.

**Acceptance Scenarios**:

1. **Given** a member operating a machine, **When** they leave the crew, are removed, or disconnect,
   **Then** they are put out of the machine within 2 seconds. Anything on the crane hook or the
   forklift forks is set down safely, and the machine stays where it stopped.
2. **Given** an operator who sends no input for 60 seconds, **When** the time passes, **Then** they
   are put out and the machine is free for the crew.
3. **Given** a building that becomes unattended and is adopted by a new Host (002 rules), **When**
   adoption happens, **Then** the machines belong to the new crew.
4. **Given** an outsider standing on the hook pad, in the pit or in front of the forklift, **When**
   the crew operates their machines, **Then** the machines work normally. The outsider is never moved
   and never blocks a machine.
5. **Given** a player sending machine commands faster than a person could, **When** the server
   checks them, **Then** extra commands are dropped and the player sees the usual "slow down" cue
   (002 rate limits).

---

### User Story 6 - Shifts, restarts and solo mode (Priority: P3)

At a shift reset, all machines return to their parking spots and the site is cleared, like the
towers. After a server restart, every building keeps its Groundwork progress (scoops dug, bags in
the mixer, buckets poured), and machines are back in their parking spots with nobody inside. Solo
mode keeps working.

**Why this priority**: this is needed for a complete feature, but it reuses the 002 persistence and
reset rules.

**Independent Test**: dig 3 scoops, load 2 bags, restart the server, and check that the progress is
still there and the machines are parked. Then let a shift end and check that everything resets.

**Acceptance Scenarios**:

1. **Given** a shift that ends, **When** the reset happens, **Then** every operator is put out, every
   machine is back in its parking spot, and new buildings start at Groundwork again.
2. **Given** a server restart, **When** players reconnect, **Then** the Groundwork progress and the
   bags in each mixer are restored exactly, and machines are parked and empty.
3. **Given** `?solo=1` (or the offline fallback), **When** a player opens the game, **Then** solo
   mode starts on its own lot with all four machines, and the Clock Tower starts with Groundwork
   and has the same high slots as in the multiplayer world.
4. **Given** solo mode, **When** the player finishes the Clock Tower alone, **Then** every machine
   step works the same way as in the multiplayer world. The player is the operator of every machine
   and the one who brings pieces to the hook pad and the mixer.

---

### User Story 7 - Proof it scales: 100 bots with machines (Priority: P2)

The 100-bot load test is extended. Bots now also dig, mix, lift with the crane and haul with the
forklift on all 12 plots, and the world must still meet every 002 budget.

**Why this priority**: the constitution requires a 100-bot load test for every multiplayer
milestone, and machines add moving objects to every snapshot.

**Independent Test**: run the load test for 5 minutes and check the budgets and the machine
behavior counts in its report.

**Acceptance Scenarios**:

1. **Given** the load test with 100 bots, **When** it runs for 5 minutes, **Then** every machine
   type is used on several plots, and the report counts scoops, mixes, crane lifts and forklift
   trips.
2. **Given** the same run, **When** it finishes, **Then** the tick rate, tick time, bandwidth per
   player and memory are all within the 002 budgets, and the new consistency counters (outsider
   machine use, hand-filled high slots, pieces lost from a hook or pallet) are all 0.

---

### Edge Cases

- **Two crew members press action at the same free machine at once**: exactly one gets in; the
  other sees "Someone is driving".
- **The operator is put out while a piece hangs on the crane hook**: the piece is lowered straight
  down and set on the ground below the hook. If that spot is not walkable, it goes to the hook pad.
- **A pallet is set down over the bin or the pit**: pieces never fall into the pit or disappear. They
  are placed on the nearest free walkable spot.
- **A piece on the hook is the wrong type for the slot below**: it is set down on the ground, never
  snapped into the wrong slot.
- **All matching slots of the stage are filled while a matching piece still hangs on the hook**:
  releasing it sets it on the ground.
- **The mixer runs with fewer bags than the footing needs**: it makes only as many buckets as bags.
  Extra buckets beyond what the footing needs are ordinary pieces that the crew can carry, toss or
  leave.
- **Concrete buckets or cement bags are taken to another plot**: another plot's pit accepts them only
  if that crew delivers them (002 crew rules). Anyone may still donate them to a supply bin.
- **The pit is dug but nobody brings cement**: the building waits in Groundwork. The plot sign shows
  what is needed ("Concrete 0/4: use the mixer"), and the mixer glows for the crew.
- **A worker is standing inside the pit or on the pad when a machine acts**: the worker is never
  moved, buried or lifted; the machine still completes its action.
- **A machine is driven into static scenery** (a tree, a rack, the fence): it stops at the obstacle.
  Machines never go through scenery.
- **An operator's connection is slow**: their own view of the machine is predicted and corrected
  smoothly. Other players see smooth, slightly delayed movement.
- **A player tries to enter a machine while carrying a piece**: they must put it down first ("Hands
  full").
- **A building finishes**: its machines stay at the plot until the shift reset, and the crew can
  still drive them for fun.

## Requirements *(mandatory)*

### Functional Requirements

**Machines on the site**

- **FR-001**: Each of the 12 plots MUST have its own tower crane, excavator, cement mixer and
  forklift, each with a fixed parking spot at that plot.
- **FR-002**: A plot's machines MUST be visible to all players at all times, but operable only while
  the plot has a building (not while it is free).
- **FR-003**: The tower crane and the cement mixer MUST be stationary. The excavator MUST move only
  inside its plot's yard (the plot, its pit, its spoil heap and its parking area). The forklift MUST
  be able to drive within its plot's yard, the shared lanes and the supply-rack area, and MUST NOT
  enter the spawn zone, another plot's yard or the area beyond the site fence.
- **FR-004**: Machines MUST collide with static scenery (fences, racks, trees, signs, towers) and
  MUST NOT collide with workers or with other machines. A machine MUST never move, carry, lift or
  harm a worker.
- **FR-005**: The existing static crane and excavator scenery MUST be removed or replaced so the site
  shows no non-working copies of operable machines.

**Operating a machine**

- **FR-006**: A player MUST be able to enter a free machine by pressing action within 1.5 m of its
  cab, only if they are the Host or a crew member of that machine's plot and their hands are empty.
- **FR-007**: A machine MUST have at most one operator at a time. Operators MUST NOT carry pieces by
  hand while operating.
- **FR-008**: While a player is in a machine, the controls MUST be:
  - **move**: drive and steer (excavator, forklift), or swing the arm and move the hook in and out
    (crane);
  - **action**: the machine's job (scoop or dump, pick up or set down a pallet, pick up or release
    with the hook, start the mixer);
  - **jump**: get out;
  - **toss**: switch the camera view: hook camera ↔ cab camera in the crane, follow ↔ driver camera
    in the excavator and forklift, mixer view ↔ free camera at the mixer (amended 2026-11-05).
  This MUST hold on keyboard, touch and gamepad.
- **FR-008a**: While operating the crane, the camera MUST start as the **hook camera**: a raised
  view above and behind the hook that keeps the hook, the piece it carries and the slots below it in
  view. The toss button MUST switch to the **cab camera** (the operator's view from the cab) and
  back. The choice MUST reset to the hook camera every time the player gets in. For the other
  machines, the normal follow camera stays on the machine.
- **FR-009**: The crane hook MUST lower and raise automatically when the operator picks up or
  releases. The operator never controls the hook height directly.
- **FR-010**: Entering a machine MUST show a short control hint for that machine, at most once per
  machine type per device unless the player asks for help.
- **FR-011**: An operator MUST be put out of the machine when they press jump, leave or are removed
  from the crew, disconnect, change world, or send no input for 60 seconds. Anything held by the
  machine MUST then be set down safely (see Edge Cases).
- **FR-012**: The server MUST decide all machine movement and every machine action from the
  operator's inputs. The operator's own screen MUST respond immediately and be corrected smoothly.
  Other players MUST see machines move smoothly, without teleporting, within 0.5 seconds on
  connections with up to 150 ms round-trip delay.
- **FR-013**: Machine inputs MUST be rate-limited like other player inputs, with the same "slow
  down" feedback and strike rules as feature 002.

**Groundwork: excavator and cement mixer**

- **FR-014**: Every new building in the multiplayer world MUST start with a Groundwork step before
  stage 1 (Frame). Groundwork has two parts, done in order: dig the pit (6 scoops), then pour the
  footing (4 buckets of concrete).
- **FR-015**: No piece MUST fill a stage-1 slot until Groundwork is complete. A hand delivery during
  Groundwork MUST be refused with a hint naming the current Groundwork part.
- **FR-016**: The excavator MUST fill its bucket with action at the pit outline and count one scoop
  when it dumps at its plot's spoil heap. Dumping anywhere else MUST return the dirt and count
  nothing.
- **FR-017**: The pit and the spoil heap MUST visibly change as scoops are counted (at least 3
  visible depth steps).
- **FR-018**: The supply racks MUST offer a new piece type, the **cement bag**. A cement bag MUST be
  carried and tossed like other pieces and can be donated to supply bins.
- **FR-019**: The mixer MUST accept cement bags dropped or tossed into its hopper, up to 4 at a time,
  from crew members only. Outsiders' bags MUST bounce off with the hint "Crew only". Outsiders can
  donate bags through the supply bin.
- **FR-020**: With an operator and at least one bag inside, action MUST start a 5-second mix that
  turns every bag inside into one **concrete bucket** each, delivered at the chute. Concrete buckets
  MUST exist only as mixer output, never at the racks.
- **FR-021**: The footing MUST accept concrete buckets delivered into the pit by crew members, once
  the pit is dug. Each fills one of the 4 footing slots.
- **FR-022**: The plot sign MUST show Groundwork progress together with the machine to use ("Dig 3/6:
  use the excavator", "Concrete 1/4: use the mixer"), and during stages with empty high slots it MUST
  name the crane ("Roof 1/3: use the crane").
- **FR-022a**: While a step needs a machine (digging: the excavator; concrete: the mixer; empty high
  slots in the current stage: the crane), that machine MUST glow and show a bouncing arrow above it
  for the plot's crew members, and nobody else. The cue MUST hide while someone operates that
  machine, and MUST return when the machine is free again and the step still needs it. The forklift,
  which is never required, gets no cue.

**High slots: tower crane**

- **FR-023**: The 3 roof slots of the Roof & Windows stage and the golden-bell slot of the
  Masterpiece stage MUST be **high slots**. The other 3 Roof & Windows slots stay hand slots.
- **FR-024**: A high slot MUST be fillable only by a matching piece released from the plot's crane
  hook. A hand delivery to a high slot MUST be refused with the hint "Too high: use the crane", and
  the piece set down at the foot of the tower.
- **FR-025**: The crane hook MUST be able to pick up any loose piece within its reach. Reach covers
  the plot, its hook pad and its supply bin area, and never the spawn zone or another plot.
- **FR-026**: Each plot MUST have a marked hook pad within the crane's reach, where crew members can
  put pieces for the crane.
- **FR-027**: Releasing a hooked piece when the hook is within **1.5 m** (horizontal distance) of a
  matching empty slot of the current stage MUST snap it into that slot exactly like a hand delivery
  (same stage progress, celebration and stars). This applies to high slots and ordinary slots alike,
  and to the footing during Groundwork. If two slots are in range, the nearest one is used. Releasing
  it anywhere else MUST set it down on the ground below.
- **FR-027a**: While the hook carries a piece and is within 1.5 m of a matching empty slot of the
  current stage, that slot's ring MUST light up for the operator, so they can see that releasing now
  will snap.
- **FR-028**: Pieces on the hook MUST be visible to all players and carried smoothly.

**Forklift**

- **FR-029**: The forklift MUST pick up, with action at a supply rack, a pallet of up to 4 pieces of
  one type: the type the plot's current stage or Groundwork part needs. It MUST NOT pick up types
  the plot does not need, nor concrete buckets.
- **FR-030**: Unloading a pallet inside its own plot's build zone MUST fill one empty matching slot
  per piece (hand slots only, never high slots). Unloading cement bags at its own plot's mixer MUST
  put them into the hopper, up to its free capacity. Remaining pieces MUST be placed beside the plot
  as loose pieces. Unloading anywhere else MUST set the pallet's pieces down as loose pieces.
- **FR-031**: The forklift MUST be faster than a running worker so that a pallet trip saves time
  compared with carrying pieces one by one.

**Rules, persistence and reset**

- **FR-032**: Every machine rule (permissions, Groundwork progress, high slots, hook and pallet
  contents, the mixer's bags) MUST be decided on the server. Clients MUST send only inputs and
  intents.
- **FR-033**: Building is still additive-only: no machine action may remove, move or damage a placed
  piece or another plot's building.
- **FR-034**: Groundwork progress and the bags in each mixer MUST be saved with the building and
  restored exactly after a server restart. Machine positions and operators MUST NOT be restored:
  after a restart every machine is parked and empty, and pieces that were on hooks or pallets are
  placed on the ground at the machine.
- **FR-035**: At a shift reset, every operator MUST be put out and every machine MUST return to its
  parking spot, along with the 002 reset of buildings and pieces.
- **FR-036**: Load test bots MUST also use every machine type (dig, mix, crane lift, forklift trip),
  and the load test MUST report machine usage and the new consistency counters.

**Look, payload and performance**

- **FR-037**: All four machines MUST be original models in the approved toon style (two-band
  shading with the shadow tint and outlines), built by the scripted asset pipeline. A review render
  of each machine and of a plot with its machines MUST be approved by the owner before the
  in-game integration.
- **FR-038**: Machine models MUST NOT add to the critical payload needed to start playing. They MUST
  stream in after the player is already playing. Until a machine's model has loaded, a simple
  placeholder MUST stand in its place.
- **FR-039**: With all 12 plots' machines on the site, the game MUST keep the 002 performance budgets
  (frame rate, draw calls, triangles) with 100 workers visible. Machine detail MUST reduce with
  distance.
- **FR-040**: Machine movement MUST keep each player's received data within the 30 KB/s average
  budget, with distant machines updated less often than nearby ones.
- **FR-041**: Machines MUST make simple, original sounds (engine, hydraulics, mixer drum), quieter
  with distance and muted by the existing sound toggle.

**Solo mode**

- **FR-042**: Solo mode MUST have all four machines on its lot, Groundwork, and the same high
  slots. Machine rules and machine movement in solo MUST be the same rules as in the multiplayer
  world (one shared definition, not a separate solo version), so a machine behaves identically in
  both modes. In solo the single player has every permission a Host has.
- **FR-043**: Solo mode MUST keep working with no server connection, and the solo lot layout MUST
  make room for the pit, the spoil heap, the hook pad and the machine parking without blocking the
  existing racks and paths.

### Key Entities

- **Machine**: one operable machine of a plot: type (crane, excavator, mixer, forklift), plot, parking
  spot, current position and pose (arm angle, hook position, bucket or fork state), operator (if
  any), and what it holds (a hooked piece, a pallet of pieces, dirt in the bucket, bags in the mixer).
- **Groundwork**: the step before stage 1 of a building: scoops dug (0–6), concrete poured (0–4),
  done or not.
- **High Slot**: a slot of the tower that only the crane can fill (3 roof slots and the bell slot of
  the Clock Tower).
- **Hook Pad**: a marked spot at each plot, within the crane's reach, where pieces wait for the crane.
- **Pallet**: up to 4 pieces of one type carried together on the forklift's forks.
- **New piece types**: the **cement bag** (from the racks, goes into the mixer) and the **concrete
  bucket** (from the mixer, goes into the footing).
- **Plot** and **Building** (from 002): extended with the plot's machines, its pit, spoil heap and
  hook pad, and the building's Groundwork progress.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In playtests, at least **4 of 5** first-time players who try a machine get in, finish
  its job once (one scoop, one mix, one crane lift or one pallet trip) and get out within **90
  seconds**, without being told how.
- **SC-002**: A crew of **3** players who know the game finishes Groundwork in **5 minutes or less**,
  and finishes a full Clock Tower, including the machine steps, in **25 minutes or less**.
- **SC-003**: In a playtest with at least **5 people** in one world, at least **4 of 5** say the
  machines were fun and that the crane step needed teamwork or was satisfying to do alone.
- **SC-004**: Other players see every machine move and act within **0.5 seconds** on connections
  with up to 150 ms round-trip delay, and are never seen teleporting during normal operation.
- **SC-005**: In the 100-bot load test, with machines in use on all 12 plots, the world keeps its
  **20 updates per second** with an average update time of **at most 10 ms** and 99% within
  **25 ms**. Each player receives **at most 30 KB/s** on average, and one world uses **at most 256
  MB** of memory, with no growth over a 30-minute run.
- **SC-006**: Across the load test and the integration tests, **zero** machine operations by
  non-crew players, high slots filled by hand, workers moved by a machine, or pieces lost from a hook,
  pallet or mixer are observed.
- **SC-007**: With 100 workers, all 12 plots built and all 48 machines visible, the game runs at **60
  fps** on a typical desktop or laptop and **30 fps or more** on a mid-range phone. The download
  needed before playing stays at **5 MB or less**, and machine models finish loading within **10
  seconds** of starting to play on a 4G connection.
- **SC-008**: After a server restart, every building's Groundwork progress and every mixer's bags are
  restored exactly, and all machines are parked and empty, within the 15-second reconnect window of
  feature 002.
- **SC-009**: In solo mode, a player who knows the game finishes a full Clock Tower alone, including
  every machine step, in **30 minutes or less**, and the solo perf scene stays within the 001 budgets
  (60 fps desktop, ≥ 30 fps mid-range phone).

## Assumptions

- This feature changes the Clock Tower in both the multiplayer world and solo mode: Groundwork is
  added before stage 1, and 4 slots become high slots. The 6 stages, their piece counts and their stars stay as in 002, so
  existing progress screens keep working. Other blueprints and the Mega-Tower stay out of scope.
- The numbers (6 scoops, 4 concrete buckets, 4 bags in the mixer, a 5-second mix, a pallet of 4, a
  60-second idle limit, 1.5 m entry range, 1.5 m crane snap range) are starting values to tune in playtests, like the 002
  timers.
- The forklift is a speed-up, not a requirement. The owner's "needed for some steps" applies to the
  excavator, the mixer and the crane.
- Machines are per plot (48 machines in total). They stand at every plot but can be operated only
  while the plot has a building.
- Machines never collide with workers or with each other, so that nobody can block or trap a crew,
  and two crews' forklifts cannot jam the lanes. They do collide with static scenery.
- Any crew member can operate any machine of their plot. There is no Host-assigned operator role in
  this feature.
- Non-crew players help with machines only as in 002: by donating pieces (including cement bags) to
  the supply bin.
- Machines carry no passengers, and players cannot ride on hooks, pallets or buckets.
- The existing site layout has room for the pit, spoil heap, hook pad and machine parking at each
  plot. If not, the layout is adjusted by the asset pipeline, and the change is part of the owner's
  layout review.
- Buildings already in progress when this feature goes live (saved by 002) count as having finished
  Groundwork, and their remaining high slots need the crane. The next shift reset starts every plot
  fresh anyway.
- Machines are moving rigs controlled by a few parameters (arm angle, hook position, bucket and fork
  state, drive position and heading), not free physics, as the constitution requires.
- This feature starts after the owner accepts the open items of the 002 validation gate (phone fps,
  art review and playtest), or explicitly accepts the risk, as the constitution's workflow requires.
