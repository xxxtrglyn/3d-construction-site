<!--
Sync Impact Report
- Version change: 1.0.0 → 1.1.0 (MINOR: materially expanded guidance in Principle V)
- Modified principles:
  - V. Simple & Kind Sandbox: "Text chat is not allowed until moderation exists" → text chat is
    allowed only together with a defined chat moderation baseline (filter, limits, scoped channels,
    mute/hide, report + auto-mute); player names stay generated (chat is the only free-text input)
- Reason: owner request (2026-11-04) to add chat in feature 002-multiplayer-core; the original
  clause already anticipated chat once moderation exists, and this amendment defines that bar.
- Added/removed sections: none
- Templates reviewed: plan/spec/tasks templates need no change ✅
- Follow-up: CLAUDE.md rule of thumb "no free-text input" updated to match; spec/plan of
  002-multiplayer-core updated.
- Previous report (1.0.0): initial ratification from template; principles I–VII, Technology
  Constraints and Development Workflow added.
-->

# Hard Hat Town Constitution

Hard Hat Town (working title) is a browser-based 3D chibi construction-site sandbox where about 100
players share one world, build towers together and play freely.

## Core Principles

### I. Instant Play

- Players MUST be able to join a world straight from a link: no login, no account, no download and
  no install step.
- The first playable payload (code + assets needed to move around) MUST stay within **5 MB
  compressed**. Everything else MUST stream in after the player is already playing.
- Time-to-play MUST target **≤ 4 s on a 4G connection** for a first visit.
- The game MUST run in current Chrome, Firefox and Safari (including iOS Safari) on desktop and
  mobile. A feature that breaks any of these browsers is a defect.
- Guest identity (name, colors, reconnect token) MUST be generated automatically and stored on the
  device; asking for personal data is forbidden.

*Rationale:* the core promise is "click a link and you're playing". Every second of loading and
every extra step loses players.

### II. Server Authority

- Each world shard (~100 players) MUST run as exactly one authoritative Node.js + Colyseus room.
- Clients MUST send only inputs and intents (move, grab, place, request to join). The server MUST
  validate and decide movement limits, building placement, permissions and tower state.
- Clients MUST predict their own movement and interpolate everyone else; corrections from the
  server MUST be smoothed, never snapped visibly except to resolve cheating or desync.
- The server MUST apply interest management so each client receives at most **30 KB/s** on average.
  Nearby entities update often, distant ones rarely.
- A tower's state MUST survive its Host disconnecting; the Host is a role, the server owns the data.

*Rationale:* with anonymous players, anything decided on a client can be abused. The server is the
single source of truth.

### III. Performance Budgets Are Requirements

- Frame rate targets: **60 fps** on desktop, **≥ 30 fps** on a mid-range phone with **100
  characters visible**.
- Draw calls, texture memory, triangle counts and asset sizes MUST have numeric budgets. Automated
  checks MUST fail the build when a budget is exceeded.
- Physics MUST stay simple: Rapier is used only for characters, held/thrown items and machines.
  Snapped building pieces become static. Cranes and excavators are kinematic rigs driven by
  parameters, not free rigid-body simulations.
- Performance regressions MUST be treated as bugs and fixed before the feature is considered done.

*Rationale:* a crowd of 100 on a phone is the hardest technical constraint; budgets that are not
measured are not kept.

### IV. Art Fidelity & Original IP

- The approved art direction is binding: soft two-tone toon shading with cool-tinted shadows, ink
  outlines, chunky rounded chibi proportions and a bright toy palette. In-browser visuals MUST match
  the Blender reference renders in `assets/renders/`.
- All 3D assets MUST be authored in Blender and exported to glTF through a scripted, reproducible
  pipeline (no hand-exported files committed without the script that produced them).
- Exported assets MUST be compressed (gltf-transform: meshopt/Draco + KTX2 where textures exist).
- Only original content is allowed. Assets, characters, names, music or levels copied from other
  games are forbidden; "in the spirit of" is fine, imitation is not.

*Rationale:* the cozy look is the product's identity and was approved deliberately; a reproducible
pipeline keeps it consistent as the asset count grows.

### V. Simple & Kind Sandbox

- Controls MUST be "move + one or two buttons" on every platform (keyboard/mouse, gamepad, touch).
- There are no forced objectives. Optional goals (tower blueprints, Mega-Tower) MUST never block
  free play.
- Building is additive-only: no player can delete, move or damage another player's build.
- Anti-griefing MUST be designed in, not bolted on: a safe spawn zone where nothing can be built,
  per-player rate limits, Host approval (Open / Ask / Solo) for tower crews, and local mute/hide.
- Text chat is allowed only together with the **chat moderation baseline**, which MUST ship in the
  same feature as the chat:
  - a server-side filter (blocked words masked; links, emails and phone numbers rejected);
  - a length limit of ≤ 80 characters, plus per-player rate and duplicate limits;
  - scoped channels only (nearby players and own crew), with no world-wide broadcast;
  - local mute/hide and a "hide all chat" option;
  - a report flow stored for owner review, with automatic chat-muting after reports from several
    different players.
- Player names stay generated from word lists; chat is the only free-text input.
  Emotes and preset messages remain available to everyone.

*Rationale:* 100 anonymous strangers only stay fun when the rules make kindness the easy default.

### VI. Test & Measure

- TypeScript `strict` mode is mandatory in every package. Client and server MUST share message,
  state and rule types from a single `shared` package.
- Shared game rules (snapping, stage progression, permissions, rate limits) MUST have unit tests.
- Server room logic MUST have integration tests.
- Multiplayer milestones MUST pass a **headless 100-bot load test** (server tick time,
  bandwidth per client, memory) before they are considered complete.
- Every phase MUST define an explicit validation gate (fun, performance or scale) and record whether
  it passed.

*Rationale:* a small team plus AI agents can move fast only if correctness and performance are
checked automatically.

### VII. Simplicity (YAGNI)

- Use the smallest stack that works: TypeScript + Vite + Three.js client, Node.js + Colyseus server,
  SQLite persistence, Hetzner + Cloudflare hosting.
- No accounts, no database beyond SQLite, no microservices, no new frameworks without a written
  justification in the plan's Complexity Tracking table.
- Build the minimum for the current phase; future features are not pre-built "just in case".

*Rationale:* one developer with AI agents cannot afford infrastructure that does not serve the
current milestone.

## Technology Constraints

- **Monorepo**: pnpm workspaces with three packages: `client` (Vite + Three.js), `server`
  (Node.js + Colyseus) and `shared` (types, constants, pure game rules).
- **Runtime**: Node.js 20 LTS or newer; ES modules; TypeScript strict.
- **Rendering**: Three.js on WebGL 2; WebGPU only behind a feature flag after WebGL 2 is solid.
  The toon shading and outlines are rebuilt in Three.js (custom shaders) to match the reference
  renders.
- **Physics**: Rapier (WASM) only within the scope defined in Principle III.
- **Networking**: Colyseus over WebSockets; binary/compact encoding for high-frequency transforms;
  server tick 20 Hz baseline.
- **Persistence**: SQLite for world/tower state and gallery metadata; object storage (Cloudflare
  R2) for images.
- **Assets**: Blender → glTF via scripts (blender_mcp or headless Blender) → gltf-transform
  compression → budget check → served from CDN.
- **Hosting**: Hetzner VPS for game servers; Cloudflare Pages/R2 for static files.

## Development Workflow

- Work proceeds through Spec Kit: constitution → specify → clarify (when needed) → plan → tasks →
  implement, one feature directory per phase or feature under `specs/`.
- Every plan MUST pass the Constitution Check against Principles I–VII before tasks are generated;
  any violation MUST be justified in Complexity Tracking or removed.
- Each phase ends with its validation gate; the next phase does not start until the gate passes or
  the owner explicitly accepts the risk.
- AI coding agents are allowed. All generated code MUST be reviewed against this constitution, and
  performance and test checks MUST pass before work is accepted.
- Art changes MUST be reviewed against the reference renders; new reference renders replace old ones
  only when the owner approves them.

## Governance

- This constitution overrides all other practices and guidelines in the project.
- Amendments require: a written proposal describing the change and its reason, the owner's approval,
  and an update to any affected specs or plans.
- Versioning follows semantic versioning: MAJOR for removing or redefining principles, MINOR for new
  principles/sections or materially expanded guidance, PATCH for clarifications and wording.
- Every plan and code review MUST verify compliance with Principles I–VII. Complexity beyond the
  stack defined here MUST be justified in writing.
- Runtime development guidance for agents lives in `CLAUDE.md` (to be created with the first
  feature plan).

**Version**: 1.1.0 | **Ratified**: 2026-11-04 | **Last Amended**: 2026-11-04
