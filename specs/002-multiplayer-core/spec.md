# Feature Specification: Multiplayer World with Host Crews

**Feature Branch**: `002-multiplayer-core`

**Created**: 2026-11-04

**Status**: Draft

**Input**: User description: "Multiplayer core for Hard Hat Town (Phase 2). Players open the same link with no login and join a shared world shard of up to ~100 players run by one authoritative Node.js + Colyseus room. Each player gets an auto-generated guest identity (name, colors, reconnect token stored on the device) and sees the other chibi workers move around the floating construction lot with smooth interpolation, while their own movement is predicted locally and server corrections are smoothed. Players pick up, carry, toss and snap building pieces [...]; the server validates every intent (movement limits, grab, place, snapping, stage progression) using the existing pure rules in packages/shared, and building is additive-only. Anti-griefing basics: a safe spawn zone where nothing can be built, per-player rate limits, and local mute/hide. No text chat: communication uses emotes and preset messages only. Tower state lives on the server, survives player disconnects and is saved in SQLite so it survives server restarts, but resets on a timed shift (hourly by default) with a short warning before the reset. [...] Interest management keeps each client under 30 KB/s average; the server ticks at 20 Hz. The milestone must pass a headless 100-bot load test (server tick time, bandwidth per client, memory) and keep the client performance budgets with 100 characters visible. The single-player mode from feature 001 keeps working (offline fallback / ?solo=1)." — **Scope update from the owner**: "I want all players to join 1 world; 1 world has many buildings of many Hosts with their teammates." Owner decisions: one world of up to 100 players (a second world opens only when the first is full); a player becomes Host by talking to the Foreman NPC and picking a blueprint; the Host sets the crew's join mode (Open / Ask / Solo, default Ask); players outside a crew can help only through a supply bin next to the plot. **Second scope update**: "We should have a chat feature" — owner decisions: text chat with a built-in moderation baseline (constitution amended to v1.1.0), scoped to nearby players plus a private crew channel.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open the link and play in a shared world (Priority: P1)

A visitor opens the game link. Within a few seconds, with no sign-up screen, they are controlling
their chibi worker in the plaza of a big floating construction site — and the site is full of other
players' workers walking, carrying pieces and building towers on plots all around. Every worker
shows its guest name and hard-hat color. The player's own worker responds instantly to input, even
on a mobile connection; the other workers move smoothly, never teleporting or jittering.

**Why this priority**: "Click a link and you're in the same world as everyone else" is the product.
Seeing others move smoothly is the minimum that makes the world feel shared.

**Independent Test**: Open the link in two or more browsers/devices at once (and with simulated
bots), confirm each player lands in the same world and sees the others with correct names and
colors, moving smoothly, while their own worker stays responsive under added network delay.

**Acceptance Scenarios**:

1. **Given** a first-time visitor and a world with room, **When** they open the link, **Then** they
   appear in the plaza of that same world as everyone else and can move without any login, account
   or install step.
2. **Given** two players in the world, **When** one walks, runs or jumps, **Then** the other sees that
   worker move smoothly in the same place, with the same name and hard-hat color.
3. **Given** a player on a connection with up to 150 ms round-trip delay, **When** they move,
   **Then** their own worker reacts immediately; if the server corrects its position, the correction
   is blended in smoothly rather than snapping.
4. **Given** a player whose connection drops for less than 60 seconds, **When** the connection comes
   back, **Then** they rejoin as the same worker, with the same name, color and crew role, without
   reloading the page.
5. **Given** the world already has 100 players, **When** a new player opens the link, **Then** they
   are placed in a second world without seeing an error.

---

### User Story 2 - Talk to the Foreman and start your own building (Priority: P1)

In the plaza stands the Foreman, a friendly chibi boss with a clipboard. A player walks up and
presses the action button to talk. The Foreman offers a few buttons: "Start a building", "Who's
hiring?" and "Bye". Choosing "Start a building" shows the blueprints (only the Clock Tower for now).
After picking it, the Foreman assigns a free plot, an arrow guides the player there, and the
player is now that building's **Host**: their name and crew flag appear on the plot's sign. They
can build the Clock Tower through all six stages exactly like in single-player, and the whole world
can watch the tower grow.

**Why this priority**: The Foreman → Host flow is how buildings start. Without it there are no
buildings for crews to join.

**Independent Test**: Talk to the Foreman, pick the Clock Tower, follow the arrow, build stages as
the Host, and confirm other players see the plot sign, the tower growing and the Host's name; try it
when every plot is taken and confirm the Foreman explains politely.

**Acceptance Scenarios**:

1. **Given** a player who is not in a crew, **When** they talk to the Foreman and pick the Clock
   Tower, **Then** they are assigned a free plot, become its Host, and an arrow guides them to it.
2. **Given** a Host at their plot, **When** they deliver matching pieces, **Then** the tower grows
   through the six stages with the effects from feature 001, and every player in the world sees the
   same tower state within half a second.
3. **Given** every plot is taken, **When** a player asks to start a building, **Then** the Foreman
   says so kindly and offers "Who's hiring?" instead.
4. **Given** a player is already a Host or crew member, **When** they talk to the Foreman, **Then**
   "Start a building" is not available until they leave their crew or their tower is finished.
5. **Given** a crew completes its tower, **When** the Masterpiece celebration plays, **Then** everyone
   nearby sees and hears it, the finished tower stays standing as part of the world, and the crew
   members are free to start or join another building.

---

### User Story 3 - Join a crew and build together (Priority: P1)

A player who wants to help someone else's building walks to that plot's sign (or asks the Foreman
"Who's hiring?" and follows the arrow) and presses action to ask to join. The Host sees a small
request card with the player's name and two buttons: approve or deny. If approved, the player joins
the crew: they get the crew's flag above their head and can now snap pieces into that tower. The
Host chooses how the crew accepts people: **Ask** (default, the Host approves each request), **Open**
(anyone who asks joins at once) or **Solo** (nobody can join). The Host can also remove a crew
member. Two crew members racing for the same piece or the last slot never cause duplicates.

**Why this priority**: Crews are the heart of the 100-player sandbox: small groups building
together inside a big shared world.

**Independent Test**: With a Host and several other players (real or bots), test each join mode,
approve, deny and let a request expire, remove a member, and have several crew members deliver at
once; confirm everyone sees the same crew and tower state and nothing is duplicated.

**Acceptance Scenarios**:

1. **Given** a Host in Ask mode, **When** a player asks to join, **Then** the Host sees a request card
   with Approve and Deny; approving adds the player to the crew and both see the crew flag.
2. **Given** a pending request, **When** the Host does not answer within 30 seconds, **Then** the
   request expires and the asking player sees a friendly "The Host is busy — try again later".
3. **Given** a player was denied, **When** they try to ask the same Host again within 60 seconds,
   **Then** the request is not sent and they see when they can try again.
4. **Given** a Host in Open mode, **When** a player asks to join, **Then** they join immediately;
   **given** Solo mode, the plot sign shows the crew is closed and no request can be made.
5. **Given** a crew is full (8 members including the Host), **When** someone asks to join, **Then**
   the request is not sent and they see that the crew is full.
6. **Given** two crew members try to pick up the same loose piece, or deliver the last slot of a
   stage at nearly the same moment, **When** the world resolves it, **Then** exactly one succeeds
   first, the other is treated as coming after, and no piece is duplicated or double-counted.
7. **Given** the Host removes a crew member, **When** it takes effect, **Then** that player loses the
   crew flag and can no longer snap into the tower; already snapped pieces stay.

---

### User Story 4 - The building survives its Host (Priority: P2)

The Host is a role, not the owner of the data. If the Host disconnects, idles or leaves the crew, the
Host role passes automatically to the crew member who has been in the crew the longest. If nobody
is left in the crew, the half-built tower stays standing; after a while, the Foreman offers it to
new players as an "unfinished building" they can adopt, keeping all its progress.

**Why this priority**: Constitution Principle II: a tower's state must survive its Host
disconnecting. Without handover, one player closing a tab would stall a whole crew.

**Independent Test**: Make the Host disconnect, idle and leave in turn and confirm the role passes
to the longest-serving member; empty the crew and confirm the tower stays, then becomes adoptable
through the Foreman with its progress intact.

**Acceptance Scenarios**:

1. **Given** a crew with a Host and members, **When** the Host disconnects and does not come back
   within 60 seconds, **Then** the longest-serving member becomes Host and every crew member sees a
   short notice.
2. **Given** a Host chooses "Leave crew" or "Hand over", **When** it takes effect, **Then** the role
   passes immediately (to the chosen member for hand-over, otherwise the longest-serving member).
3. **Given** a Host is idle for 5 minutes while other crew members are active, **When** the idle
   limit is reached, **Then** the role passes to the longest-serving active member.
4. **Given** a building has no crew members left, **When** 3 minutes pass with nobody returning,
   **Then** the Foreman lists it as an unfinished building; a player who adopts it becomes its Host
   and continues from the same stage and slots.
5. **Given** the original Host returns within 60 seconds of disconnecting, **When** they reconnect,
   **Then** they are still Host (or, if the role already passed, a regular member of the crew).

---

### User Story 5 - Be kind by default: supply bins, emotes, mute and hide (Priority: P2)

Players who are not in a crew can still help: every plot has a supply bin, and anyone can drop
pieces into it. Crew members take pieces out of the bin and the giver gets a little "thanks" sparkle.
Only crew members can snap pieces into a tower, so outsiders can never interfere with it. Everyone
can also communicate without typing: a single "talk" button opens a small wheel of emotes (wave, cheer,
dance, point, thumbs-up) and preset quick messages ("Need bricks!", "Over here!", "Thanks!", "Nice!",
"Let's build!", "Can I join?"). Any player can mute or hide another player, for themselves only.
Workers pass through each other so nobody can body-block a plot, nothing can be dropped in the plaza,
and spamming actions, emotes or join requests simply stops working for a moment.

**Why this priority**: 100 anonymous strangers stay fun only if kindness is the easy default
(constitution Principle V). It must ship before real players arrive. Typed chat is covered
separately in User Story 9.

**Independent Test**: As an outsider, drop pieces into a plot's bin and confirm crew members can use
them while the outsider cannot snap; use every emote and message on another client; mute and hide a
player; try to spam, block a plot and drop pieces in the plaza, and confirm none of it works.

**Acceptance Scenarios**:

1. **Given** a player who is not in a plot's crew, **When** they drop a building piece the tower can
   use into that plot's build zone or bin, **Then** it goes into the supply bin (up to 10 pieces) and
   is never snapped into the tower by them.
2. **Given** a supply bin has pieces, **When** a crew member presses action at the bin, **Then** they
   pick up a piece from it and the player who donated it sees a "thanks" sparkle.
3. **Given** two players near each other, **When** one picks an emote or quick message, **Then** the
   other sees it on that worker within half a second and it disappears after about 3 seconds.
4. **Given** a player mutes or hides another player, **When** that player emotes, messages or moves,
   **Then** only the muting/hiding player stops seeing it; a hidden player's join requests to them
   are also not shown.
5. **Given** a player sends actions, emotes or join requests faster than allowed, **When** the limit
   is exceeded, **Then** the extra ones are ignored and the player sees a gentle "slow down" cue.
6. **Given** a player stands in front of a plot, **When** others walk into them, **Then** they walk
   through without being blocked or pushed.
7. **Given** a player drops or tosses a piece into the plaza, **When** it lands, **Then** it fades
   away immediately.

---

### User Story 6 - Shifts and restarts (Priority: P2)

Every hour the shift ends: players get a warning a few minutes before, see a countdown in the last
seconds, and then a whistle blows. All plots are cleared, crews are dissolved, and a fresh shift
starts. A shift summary shows how many towers the world finished, how many the player's crews
finished, and how many pieces the player delivered or donated. If the server restarts in the middle
of a shift, every building, crew and the shift timer come back exactly as they were.

**Why this priority**: Shift resets keep the world fresh and always leave free plots for
newcomers; surviving restarts is required by the constitution.

**Independent Test**: Build several towers with crews, restart the server and confirm buildings,
Hosts, crews and timer are restored; shorten the shift and confirm warning, countdown, reset and
summary.

**Acceptance Scenarios**:

1. **Given** buildings and crews in progress, **When** the server restarts, **Then** after it comes
   back every tower, Host, crew, join mode and the remaining shift time are restored, and connected
   players are reconnected automatically.
2. **Given** a shift is about to end, **When** 5 minutes remain, **Then** every player sees a friendly
   warning; in the last 30 seconds a visible countdown is shown.
3. **Given** the shift ends, **When** the reset happens, **Then** every player stays connected and
   returns to the plaza, all plots are empty, crews and bins are cleared, and each player sees their
   shift summary.

---

### User Story 7 - Proof it scales: 100-bot load test (Priority: P2)

The developer runs one command that starts a world and connects 100 headless bot players that talk
to the Foreman, become Hosts, request and approve crew joins, carry, toss, snap, donate and emote like
real players for several minutes. The command reports update timing, bandwidth per player and
memory use, and fails if any budget is exceeded. A matching client check confirms the game still
meets its frame-rate budget with 100 workers and a full set of towers on screen.

**Why this priority**: Constitution Principle VI makes the 100-bot load test the gate for every
multiplayer milestone. Players do not see it directly.

**Independent Test**: Run the load-test command and check the report; deliberately add an expensive
operation to the world update and confirm the test fails.

**Acceptance Scenarios**:

1. **Given** a running world, **When** the load test connects 100 bots for at least 5 minutes,
   **Then** it reports update timing, bandwidth per player and memory, and passes only if all are
   within the budgets in SC-004 to SC-006.
2. **Given** the world update becomes slower than its budget, **When** the load test runs, **Then**
   it fails with a message naming the exceeded budget.
3. **Given** the client performance check runs with 100 workers and every plot built, **When** it
   completes, **Then** it reports frame time and draw calls and fails if they exceed the budgets.

---

### User Story 8 - Solo mode still works (Priority: P3)

If the game server cannot be reached, the player is not left staring at a spinner: after a few
seconds the single-player game from feature 001 starts with a "Playing solo" banner, and a "Join
others" button appears when the server is reachable again. Adding `?solo=1` to the link always
starts the single-player game.

**Why this priority**: It protects the "click and play" promise during outages and keeps the
feature 001 prototype available for testing.

**Independent Test**: Open the link with the server stopped and confirm solo mode starts; start the
server and confirm "Join others" appears; open `?solo=1` with the server running and confirm solo
mode.

**Acceptance Scenarios**:

1. **Given** the server is unreachable, **When** a player opens the link, **Then** solo mode starts
   within 6 seconds with a "Playing solo" banner.
2. **Given** a player is in solo mode because the server was down, **When** the server becomes
   reachable, **Then** a "Join others" button appears; pressing it joins the world (solo progress is
   not carried over).
3. **Given** the link contains `?solo=1`, **When** it is opened, **Then** the single-player game
   starts and no server connection is attempted.

---

---

### User Story 9 - Chat with nearby players and your crew (Priority: P2)

A player presses Enter (or taps the chat button) and types a short message of up to 80 characters.
They choose a channel:

- **Nearby**: players within about 20 m see the message as a speech bubble over the sender's
  worker and as a line in their chat log.
- **Crew**: every member of the player's crew sees it in the log, wherever they are on the site.

Chat is safe by default:

- Bad words are masked.
- Links, email addresses and phone numbers are refused.
- New arrivals can chat after their first minute in the world.
- Sending too fast or repeating the same message is refused.

Any player can mute or hide someone, or turn off all chat for themselves. Anyone can also report a
player from the player card. A report stores that player's recent messages for the owner to review.
When three different players report the same person, that person's chat is paused for the rest of
the shift.

**Why this priority**: The owner wants players to be able to talk. With 100 anonymous players,
chat is also the biggest abuse risk, so it ships only with its moderation baseline (constitution
v1.1.0, Principle V). Building works without it, so it ranks with the other P2 social stories.

**Independent Test**: Send nearby and crew messages between three clients at different distances.
Then try:

- a blocked word, a link, an email address and a phone number;
- spamming and repeating a message;
- chatting before the first minute is up;
- muting, hiding and "hide all chat";
- three reports from different players.

Confirm each behaves as described.

**Acceptance Scenarios**:

1. **Given** two players within 20 m, **When** one sends a nearby message, **Then** the other sees a
   speech bubble over the sender's worker and a line in the chat log within half a second; a player
   40 m away sees nothing.
2. **Given** a crew of three spread across the site, **When** one sends a crew message, **Then** all
   crew members see it in the log (marked with the crew flag), and nobody outside the crew sees it.
3. **Given** a message containing a blocked word, **When** it is sent, **Then** others see the word
   masked (for example "♥♥♥♥"), and the rest of the message is delivered.
4. **Given** a message containing a link, an email address or a phone number, **When** the player
   tries to send it, **Then** it is not delivered and the sender sees "Links and contact info aren't
   allowed".
5. **Given** a player who joined less than 60 seconds ago, **When** they open chat, **Then** the box
   explains that chat unlocks shortly. Quick messages and emotes still work.
6. **Given** a player sends messages faster than allowed, or repeats the same message within 30
   seconds, **When** the limit is hit, **Then** the extra message is refused with a gentle "slow
   down".
7. **Given** a player has muted or hidden another player, or turned on "hide all chat", **When**
   messages arrive, **Then** they are not shown to that player.
8. **Given** three different players report the same player within 10 minutes, **When** the third
   report arrives, **Then** that player's typed chat is paused until the shift ends. They see a short
   notice, and their emotes and quick messages still work.
9. **Given** a player is typing, **When** they press keys, **Then** their worker does not move or act
   until the chat box is closed.

### Edge Cases

- **Player disconnects while holding a piece**: the piece is dropped where the worker stood and
  follows the normal loose-piece rules.
- **Player comes back after more than 60 seconds**: they rejoin as a new arrival in the plaza (same
  guest name and color from the device), no longer in their old crew.
- **Host disconnects with a pending join request**: the request moves to the new Host if the role
  passes, otherwise it expires.
- **Host and the only member both leave**: the building becomes unattended (US4 rule) and keeps its
  progress.
- **Player asks to join several crews at once**: only one pending request per player is allowed; a
  new request replaces the old one.
- **Crew member walks away with a crew piece**: allowed; building is additive-only and nobody can
  take snapped pieces back.
- **All plots occupied by finished towers**: when a new Host needs a plot, the finished tower that
  has been on display the longest (at least 10 minutes) is retired with a farewell sparkle to free
  its plot; if none qualifies, the Foreman says all plots are busy.
- **Same device opens two tabs**: each tab is a separate worker; the second tab's name gets a small
  number added.
- **Two players with the same generated name**: the world adds a small number to the later name.
- **Idle player**: no input for 10 minutes removes the player from the world (and hands over Host if
  needed) and shows "Tap to rejoin".
- **Tab hidden or phone locked**: the worker stays in the world (idle) and resyncs when visible again.
- **Very bad connection**: the player sees a "Connection is shaky" indicator; others see that worker
  stand still rather than jump around.
- **Client and server versions differ**: the player sees "A new version is ready — tap to reload".
- **Masterpiece completed seconds before the shift ends**: the celebration plays in full before the
  reset starts.
- **Server restarts**: buildings, crews, Hosts, join modes, bins and the shift timer are restored;
  loose and held pieces are not; players reconnect and appear in the plaza.
- **Many loose pieces**: the world keeps at most 150 loose pieces; the oldest fades first; untouched
  pieces fade after 60 seconds.
- **Piece tossed at another worker**: it never pushes, stuns or knocks back the other worker.
- **Chat box open on a phone**: the on-screen keyboard must not cover the input; the game view
  shrinks or the chat box moves above the keyboard, and closing it restores the controls.
- **Chat abuse via reports**: a single player cannot get someone paused alone; only reports from 3
  different players within 10 minutes pause chat, and the pause ends with the shift.
- **Sender leaves while a bubble shows**: the bubble disappears with the worker; log lines stay.
- **Crew message after being removed from the crew**: crew membership is checked when the message is
  sent; the removed player can no longer send to or receive from that crew.
- **Tampered client** sending impossible positions, actions on other crews' towers, or fake approvals:
  the world ignores invalid actions, keeps workers within movement limits, and disconnects clients
  that keep sending them.

## Requirements *(mandatory)*

### Functional Requirements

**Joining & identity**

- **FR-001**: The game MUST join the shared world from a single link with no login, account,
  registration or install step.
- **FR-002**: The guest identity from feature 001 (generated name and hard-hat color, stored on the
  device) MUST be used in multiplayer, plus a device-stored reconnect token; no personal data may be
  requested.
- **FR-003**: All players MUST be placed in the same world while it has room. A world holds at most
  100 players; only when it is full is another world opened, and new players go to the oldest world
  with room.
- **FR-004**: A player MUST be able to copy an invite link to their current world; opening it MUST
  place the friend in that world if it has room, otherwise in another world with a short note.
- **FR-005**: A player who loses connection MUST be able to resume as the same worker, with the same
  crew role, for 60 seconds without reloading; after that they rejoin as a new arrival.
- **FR-006**: Within one world, guest names MUST be distinguishable; a duplicate name MUST get a small
  number added.
- **FR-007**: A player idle for 10 minutes MUST be removed from the world and offered a one-tap
  rejoin.
- **FR-008**: The name "shuffle" from feature 001 MUST work in multiplayer and update the name for all
  players.

**Presence & movement**

- **FR-009**: Every player MUST see the other workers with their names, hard-hat colors and crew
  flags, walking, running, jumping and carrying pieces, moving smoothly without visible jumps or
  jitter under normal connections.
- **FR-010**: A player's own worker MUST respond to input immediately; corrections from the world
  MUST be blended in smoothly, except for resets such as respawns or cheating corrections.
- **FR-011**: The world MUST enforce movement limits (speed, jump height, playable area) for every
  worker; a worker reported outside these limits MUST be put back within them.
- **FR-012**: Workers MUST NOT collide with or push each other.
- **FR-013**: Each player's game MUST receive no more than 30 KB/s of world updates on average;
  nearby workers and plots MUST update more often than distant ones.

**World layout**

- **FR-014**: The world MUST be one larger floating site with a central plaza (spawn point, Foreman)
  and 12 building plots around it, each with a sign, a build zone, a supply bin and nearby unlimited
  supply racks.
- **FR-015**: The plaza MUST be a safe zone: no building is possible there, and pieces dropped or
  tossed into it fade immediately.

**Foreman & Host**

- **FR-016**: The Foreman MUST be a talkable character in the plaza with preset dialogue buttons only
  (no free text): "Start a building", "Who's hiring?", "Unfinished buildings" (when any exist) and
  "Bye".
- **FR-017**: "Start a building" MUST show the available blueprints (only the Clock Tower in this
  feature); picking one MUST assign a free plot, make the player its Host and guide them there with
  an arrow.
- **FR-018**: A player MUST be in at most one crew at a time; a Host or crew member cannot start
  another building until they leave the crew or the tower reaches Masterpiece.
- **FR-019**: "Who's hiring?" MUST list buildings whose crews are in Open or Ask mode and not full,
  with their stage and crew size, and guide the player to the chosen plot.
- **FR-020**: The plot sign MUST show the Host's name, the crew flag, the join mode, the crew size,
  the star rating and the next needed piece.

**Crews & joining**

- **FR-021**: The Host MUST be able to set the crew's join mode at any time: Ask (default), Open or
  Solo.
- **FR-022**: A player MUST be able to ask to join a crew by pressing action at its plot sign (or
  from "Who's hiring?"). In Ask mode the Host MUST see a request card with the player's name and
  Approve / Deny buttons; in Open mode the player MUST join immediately; in Solo mode no request can
  be made.
- **FR-023**: A request MUST expire after 30 seconds without an answer; a denied player MUST NOT be
  able to ask the same Host again for 60 seconds; a player MUST have at most one pending request.
- **FR-024**: A crew MUST hold at most 8 members including the Host.
- **FR-025**: Crew members MUST share a crew flag (shown above their heads and on the plot sign).
- **FR-026**: The Host MUST be able to remove a crew member and to hand the Host role to a chosen
  member; any member (including the Host) MUST be able to leave the crew.
- **FR-027**: If the Host disconnects for more than 60 seconds, leaves, or is idle for 5 minutes
  while other members are active, the Host role MUST pass automatically to the longest-serving
  member, and all crew members MUST be notified.
- **FR-028**: A building with no crew members for 3 minutes MUST become an unfinished building that
  any player outside a crew can adopt through the Foreman, becoming its Host and keeping all progress.

**Building**

- **FR-029**: Each building MUST use the same Clock Tower blueprint, stages, piece counts and snap
  rules as feature 001 (Frame 6 steel beams, Walls & Floors 8 bricks, Roof & Windows 6 panels, Paint 4
  paint buckets, Decoration 5 decoration crates, Masterpiece 1 golden bell).
- **FR-030**: The world MUST be the single source of truth for every grab, drop, toss, snap, donation,
  stage change, Masterpiece, join, approval and Host change: a player's game only asks; the world
  checks the rules and decides.
- **FR-031**: Only members of a building's crew MUST be able to snap pieces into its tower.
- **FR-032**: When two players try to grab the same piece or fill the same slot, the world MUST accept
  the first request it receives and treat the second as coming after; no piece may be duplicated and
  one piece MUST fill exactly one slot.
- **FR-033**: Building MUST be additive-only: no player, including the Host, can remove, move or damage
  snapped pieces.
- **FR-034**: Every player MUST see the same state for every building (stage, filled slots, star
  rating, Host, crew); a snap MUST appear for all nearby players within half a second.
- **FR-035**: The wrong-piece hint MUST be shown only to the player who delivered it; stage-complete
  effects and the Masterpiece celebration MUST play for every player near the building.
- **FR-036**: A finished Masterpiece MUST stay standing until the shift ends, unless its plot is needed
  for a new building after it has been on display for at least 10 minutes (oldest first).
- **FR-037**: The world MUST keep at most 150 loose pieces at once; untouched loose pieces MUST fade
  after 60 seconds, the oldest first when the limit is reached.
- **FR-038**: The solo "Build again" button MUST NOT exist in multiplayer.

**Supply bins & kindness**

- **FR-039**: Each plot MUST have a supply bin holding up to 10 pieces. Anyone MUST be able to drop a
  piece the tower can use into it (a non-crew player's piece delivered to the build zone goes into the
  bin); crew members MUST be able to take pieces out; the donor MUST see a "thanks" effect when their
  piece is used.
- **FR-040**: Players MUST be able to send emotes (wave, cheer, dance, point, thumbs-up) and preset
  quick messages ("Need bricks!", "Over here!", "Thanks!", "Nice!", "Let's build!", "Can I join?")
  from a single "talk" button. Guest names stay generated; typed chat (FR-060 to FR-069) is the only
  free-text input.
- **FR-041**: Emotes and quick messages MUST appear on the sender's worker for nearby players within
  half a second and disappear after about 3 seconds.
- **FR-042**: A player MUST be able to mute or hide any other player, for themselves only, until they
  leave the world; hiding a player also hides that player's join requests from them.
- **FR-043**: The world MUST limit each player's rate of grabs, drops, tosses, donations, emotes,
  messages and join requests; actions over the limit MUST be ignored with a gentle "slow down" cue. A
  client that keeps sending invalid or over-limit actions MUST be disconnected.
- **FR-044**: Tossed pieces MUST NOT push, stun or knock back other workers.

**Persistence & shifts**

- **FR-045**: Building state MUST belong to the world, not to any player, and MUST stay unchanged when
  any or all of its crew disconnect.
- **FR-046**: Every building (stage, slots, Host, crew, join mode, bin contents), towers completed
  this shift and the shift's remaining time MUST be saved so that they are restored after a server
  restart; loose pieces, held pieces and worker positions are not restored.
- **FR-047**: Each world MUST run timed shifts, 60 minutes by default (configurable). Players MUST get
  a warning 5 minutes before the end and a visible countdown in the last 30 seconds.
- **FR-048**: At the end of a shift, the world MUST clear every plot, dissolve every crew, empty bins
  and loose pieces, return players to the plaza while keeping them connected, and show each player a
  shift summary (towers finished in the world, towers finished by their crews, pieces they delivered
  and donated).
- **FR-049**: A Masterpiece celebration in progress MUST finish before a shift reset starts.

**Robustness & fallback**

- **FR-050**: If no world can be reached within 6 seconds of opening the link, the single-player game
  from feature 001 MUST start with a "Playing solo" banner, and a "Join others" button MUST appear
  when a world becomes reachable.
- **FR-051**: The link option `?solo=1` MUST always start the single-player game without connecting.
- **FR-052**: After a server restart, connected players MUST be reconnected automatically without
  reloading the page.
- **FR-053**: If the player's game and the world run different versions, the player MUST see a
  friendly prompt to reload instead of a broken game.
- **FR-054**: The game MUST show a "Connection is shaky" indicator when the connection is degraded.

**Art**

- **FR-055**: The Foreman, plaza, plot signs, crew flags, supply bins, talk wheel, request cards and
  shift banners MUST be original and match the approved art direction; 3D items MUST come from the
  scripted Blender pipeline and stay within the asset budgets (critical payload ≤ 5 MB).

**Chat & moderation**

- **FR-060**: Players MUST be able to send typed messages of at most 80 characters, after removing
  control and invisible characters and collapsing whitespace. They are sent on one of two channels:
  - **Nearby**: delivered to players within 20 m of the sender when sent, shown as a speech bubble
    for about 5 seconds and as a chat log line.
  - **Crew**: delivered to all members of the sender's crew, shown as chat log lines marked with
    the crew flag.

  There MUST be no world-wide channel.
- **FR-061**: The chat log MUST keep the last 50 lines on the device for the current session, with
  Nearby and Crew tabs. Messages MUST NOT be stored on the server, except as part of a report.
- **FR-062**: The server MUST filter every message before delivery. The filter has two outcomes:
  - **Masked**: words on the blocklist are masked, including common letter substitutions and
    spacing tricks.
  - **Refused**: messages containing links, email addresses or phone numbers are refused with a
    hint.

  The blocklist MUST be editable without code changes.
- **FR-063**: The server MUST limit chat to 1 message per 2 seconds (burst of 3) per player, refuse
  the same message repeated within 30 seconds, and refuse chat from players who joined the world
  less than 60 seconds ago.
- **FR-064**: Muting or hiding a player MUST also hide their chat. A "hide all chat" option MUST hide
  every typed message (bubbles and log) and is remembered on the device.
- **FR-065**: Any player MUST be able to report another player from the player card. A report MUST
  store the reported player's last 5 messages with timestamps, plus the reporter and the reported
  player (both as hashed device keys), for owner review. Reports MUST be kept for 30 days, then
  deleted.
- **FR-066**: When 3 different players report the same player within 10 minutes, that player's
  typed chat MUST be paused until the end of the shift. Their emotes and quick messages still work,
  and they MUST see a short notice.
- **FR-067**: The owner MUST be able to list recent reports and their stored messages with one local
  command.
- **FR-068**: While the chat box is open, gameplay input MUST be suspended. Gamepad-only players can
  read chat and use quick messages but are not required to type.
- **FR-069**: The 100-bot load test MUST include chat traffic, and chat MUST stay within the
  per-client bandwidth budget.

**Measurement & developer workflow**

- **FR-056**: A single command MUST run a 100-bot load test for a configurable duration (at least 5
  minutes by default) with bots that use the Foreman, host, join and approve crews, move, carry, toss,
  snap, donate and emote, and MUST report world update timing, bandwidth per player and memory,
  failing if any budget is exceeded.
- **FR-057**: The automated client performance check MUST include a scene with 100 workers and all 12
  plots built (mixed stages including Masterpieces) and fail if the draw-call or frame-time budget is
  exceeded.
- **FR-058**: A single documented command MUST start the world server and the game together for local
  development, testable from a phone on the same network.
- **FR-059**: Every rule the world enforces (movement limits, grab range, snapping, stage progression,
  crew permissions, join modes, request expiry and cooldown, Host handover, unattended adoption, rate
  limits, safe zone, shift timing) MUST have automated tests, and the world's handling of joins,
  leaves, reconnects, contested actions, Host changes, restarts and shift resets MUST have automated
  integration tests.

### Key Entities

- **World**: one shared site with up to 100 players — identifier (used in invite links), player list,
  12 plots, loose pieces, the Foreman and the current shift.
- **Player Session**: one connected worker — guest name (unique in the world), hard-hat color,
  reconnect token, position and movement state, held piece, crew membership and role, pending join
  request, pieces delivered and donated this shift, last activity time. Mute/hide choices are kept
  only on the player's own device.
- **Guest Profile**: the device-stored identity from feature 001, extended with a reconnect token.
- **Plot**: a fixed building spot — state (free, building, unattended, finished), its building, sign,
  build zone and supply bin.
- **Building**: a blueprint being built on a plot — blueprint, current stage, filled slots, star
  rating, Host, crew, join mode, time finished; saved so it survives restarts.
- **Crew**: the Host plus up to 7 members of one building — member list with join times (for
  handover order), flag, join mode.
- **Join Request**: a player's request to join a crew — requester, crew, time sent, status (pending,
  approved, denied, expired), cooldown after denial.
- **Supply Bin**: a plot's donation store of up to 10 pieces, with each piece's donor.
- **Piece**: one carryable instance — type, position, state (held, loose, in bin, snapped) and time
  since last touched; decided by the world.
- **Shift**: a timed period of play in a world — start time, length, towers completed; saved so it
  survives restarts.
- **Emote / Quick Message**: a preset communication item from a fixed list.
- **Chat Message**: a typed message in flight: sender, channel (nearby or crew), filtered text, time.
  It is not stored on the server, except inside a report.
- **Chat Report**: a report about a player: reporter and reported (hashed keys), the reported player's
  last 5 messages, time; kept 30 days.
- **Chat Pause**: a per-shift chat pause on a player, triggered by 3 distinct reporters within 10 minutes.
- **Load Test Report**: result of a 100-bot run — update timing, bandwidth per player, memory,
  pass/fail per budget.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time visitor is moving their worker in the shared world within **4 seconds** of
  opening the link on a typical 4G phone connection, and within **2 seconds** on desktop broadband.
- **SC-002**: A snap, stage change, crew change or emote made by one player is visible to nearby
  players within **0.5 seconds** on connections with up to 150 ms round-trip delay.
- **SC-003**: With 150 ms round-trip delay and 2% packet loss, players report that their own worker
  feels as responsive as in solo mode, and other workers are never seen teleporting during normal
  movement.
- **SC-004**: In the 100-bot load test, the world keeps its **20 updates per second**, with an average
  update time of **at most 10 ms** and 99% of updates within **25 ms**.
- **SC-005**: In the 100-bot load test, each player receives **at most 30 KB/s** on average.
- **SC-006**: In the 100-bot load test, one world uses **at most 256 MB** of memory and memory does not
  keep growing over a 30-minute run.
- **SC-007**: With 100 workers and all 12 plots built visible, the game runs at **60 fps** on a typical
  desktop/laptop and **30 fps or more** on a mid-range phone, and the download needed before playing
  stays at **5 MB or less**.
- **SC-008**: Across the load test and integration tests, **zero** duplicated pieces, double-filled
  slots, snaps by non-crew players, or diverging building/crew states between players are observed.
- **SC-009**: After a server restart, every building, crew and the shift timer are restored exactly,
  and connected players are back in the world within **15 seconds** without reloading.
- **SC-010**: In playtests, at least **4 of 5** first-time players start a building with the Foreman
  or join a crew within **2 minutes** without being told how.
- **SC-011**: In a playtest with at least **5 people** in one world, at least **4 of 5** say building
  with a crew was fun and that they could tell who was in their crew and what others were building.
- **SC-012**: Multiplayer works in current Chrome, Firefox and Safari on desktop, and in Chrome on
  Android and Safari on iOS.
- **SC-013**: In automated tests, **100%** of a test set of messages with links, email addresses and
  phone numbers is refused. **100%** of blocklist words, including common letter-substitution and
  spacing variants, are masked. A nearby or crew message reaches its recipients within **0.5
  seconds**, and never reaches anyone outside its channel.

## Assumptions

- The technology follows the constitution: one authoritative room per world on a Node.js + Colyseus
  server, SQLite persistence, a 20 Hz world update; the existing pure rules in the shared package are
  reused and extended (crew permissions, join modes, handover) as pure, unit-tested functions.
- At launch player counts, one world of up to 100 players means effectively everyone is together; a
  second world exists only as overflow, as required by the constitution's ~100-player shard limit.
- The world needs a new, larger site layout (plaza + 12 plots) and new original assets (Foreman
  character, plot signs, supply bins, crew flags, emote poses), built in the existing Blender pipeline
  in the approved style. Plot count (12), crew size (8) and timers are starting values to tune in
  playtests.
- Only the Clock Tower blueprint exists; the Foreman's blueprint picker is built so more blueprints can
  be added later, but no other blueprint is made in this feature.
- Crew flags are chosen automatically from a fixed palette of distinguishable colors/symbols, so no
  text input is needed.
- Join requests and Host notices use buttons and icons only; Host has no other powers (no deleting
  pieces, no banning from the world).
- Reconnect grace (60 s), Host handover idle limit (5 min), unattended adoption (3 min), request expiry
  (30 s), denial cooldown (60 s), idle timeout (10 min), bin size (10), loose-piece limit (150) and rate
  limits are starting values to tune in playtests.
- "Mid-range phone" uses the same reference devices as feature 001 (Pixel 6a-class Android, iPhone
  12+). Rendering 12 towers plus 100 workers on a phone is expected to need lower-detail versions of
  distant towers and workers; the exact approach is decided in planning.
- Deployment is local/dev only: a documented setup runs server and client on one machine (reachable
  from a phone on the same network). Production hosting is a later feature.
- No player data leaves the device except the generated name, color, reconnect token, gameplay
  actions and chat messages. Nothing is stored about players beyond the current shift, except chat
  reports (hashed keys and the reported messages), which are kept for 30 days.
- The chat blocklist starts with English and Vietnamese word lists stored in an editable server
  data file. Owner review of reports is a local command, not a web dashboard.
- Out of scope: other blueprints, the Mega-Tower, vehicles, cranes, galleries, accounts, a world-wide
  chat channel, private messages, moderation dashboards and moderator roles, world-wide bans, a
  single world with no player limit, and production deployment.
