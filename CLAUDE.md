# Hard Hat Town — agent guide

A browser-based 3D chibi construction-site sandbox: about 100 players per world (later), no login,
and players join from a link.

- **Constitution (binding)**: `.specify/memory/constitution.md`
- **Active feature**: `specs/004-mixed-material-stages/` (two materials per stage, 31 deliveries;
  typed ghost slots, surplus refused kindly, per-material needs on sign/HUD/Foreman; recipe version =
  blueprint id, legacy `clock-tower-v1`; protocol v3, schema v3: spec, plan, research R1–R13, data
  model, contracts). Feature 003 (`specs/003-construction-machines/`, operable machines, protocol v2)
  is implemented; its gate has owner/device/playtest items open, as does 002's. Feature 001 stays
  available as solo mode (`?solo=1`).
- **Approved art references**: `assets/renders/` (toon look); source scenes are in
  `assets/blender/`

## Stack

pnpm monorepo:

- `packages/shared`: pure rules and types, no DOM or Three.js
- `packages/client`: Vite + TypeScript strict + Three.js (Rapier compat is loaded only by solo mode)
- `packages/server`: authoritative Colyseus 0.18 server (`@colyseus/core`), Node 24 running
  TypeScript directly (type stripping, `erasableSyntaxOnly`, no build step), SQLite via `node:sqlite`

Use Node 24 (`nvm use`; `.nvmrc`). Node 20 is end-of-life and Colyseus 0.18 needs Node ≥ 22.

Assets: headless Blender (`tools/blender/export_assets.py`) → gltf-transform (`tools/assets/`).

## Commands

`pnpm dev` (server :2567 + Vite, proxied `/api` and `/ws`) · `pnpm assets` · `pnpm test` · `pnpm e2e` ·
`pnpm perf` · `pnpm check:budgets` · `pnpm loadtest [--duration 300 | --soak 1800 | --selftest]` ·
`pnpm reports [--since 7d]` (chat reports for owner review) · `pnpm verify`

Debug URLs:

- `?debug=1`: FPS overlay plus `window.__hht` (in multiplayer, `__hht.net`)
- `?solo=1`: the 001 single-player game, with no server
- `?w=<n>`: invite link to world n
- `?perf=1`: the solo Masterpiece reference scene
- `?perf=crowd`: 100 workers plus 12 towers, offline
- `?perf=machines`: the crowd scene plus all 48 machines posed mid-action, offline
- `?shot=machines`: the solo plot with its 4 machines (art comparison with `assets/renders/machines-plot.png`)
- `?shot=closeup|masterpiece|overview`: art comparison cameras
- `?q=low|high`: quality tier

Server env: `HHT_PORT`, `HHT_DB`, `HHT_SHIFT_MINUTES`, `HHT_MAX_PLAYERS`, `HHT_METRICS=1`,
`HHT_DEV_CHEATS=1`, `HHT_MM_PER_MIN`, `HHT_BLOCKLIST_DIR`.

Status: feature 001 is done (gate in `specs/001-single-player-prototype/gate.md`). Feature 002 is
implemented (gate in `specs/002-multiplayer-core/gate.md`, automated items pass). Feature 003 is
implemented (gate in `specs/003-construction-machines/gate.md`; protocol v2, database schema v2;
owner, device and playtest items open). Feature 004 (mixed-material stages) is being implemented
(gate in `specs/004-mixed-material-stages/gate.md`; protocol v3, database schema v3: old towers keep
blueprint `clock-tower-v1`). Music and machine sounds: `tools/audio/generate-audio.mjs`
(ElevenLabs; the key comes from `ELEVENLABS_API_KEY`, never committed).

## Rules of thumb

- Game rules go in `packages/shared` as pure functions with unit tests. Stage needs come from
  `needsOf()` and its text from `client/src/ui/needsText.ts` only (feature 004).
- Multiplayer is server-authoritative. Clients send only inputs and intents (`shared/protocol.ts`).
  Movement uses only the deterministic `stepWorker()` (`shared/kinematics.ts`) on both sides, so
  never add client-only movement code. Server systems orchestrate; rules stay pure.
- Machines (003) are parameter rigs stepped only by the shared `stepMachine()` (`shared/machines.ts`)
  on the server, the operating client, solo mode and the bots. Never use Rapier for machines.
- The binary world snapshot message is `ws` (protocol v2: worker records, then 12-byte machine
  records; the operator's machine in `ownMachine`). `snap` is the JSON "piece snapped" event.
- Every new building starts with Groundwork (`dig`, `pour`); the 4 high slots need the crane
  (`deliver(…, via)` → `tooHigh`). Tests that start at stage 1 use `dev fillGround` / `skipGroundwork`.
- Never exceed the budgets in `tools/assets/budgets.json`. The critical payload must stay ≤ 5 MB.
- The visual look must match the reference renders: a 2-band toon ramp with shadow tint
  (0.50, 0.52, 0.66), plus inverted-hull outlines.
- Controls stay "move + action + toss (+ jump)". Names are generated (no free-text names). Chat is
  the only free-text input and must follow the moderation baseline in constitution v1.1.0
  (Principle V).
- Only original assets are allowed; never copy other games' content.
