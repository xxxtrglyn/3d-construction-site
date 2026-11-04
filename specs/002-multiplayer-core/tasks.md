---
description: "Task list for 002-multiplayer-core"
---

# Tasks: Multiplayer World with Host Crews

**Input**: Design documents from `/specs/002-multiplayer-core/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R16), data-model.md, contracts/, quickstart.md

**Tests**: Included. Constitution Principle VI requires the following:

- unit tests for every shared rule;
- integration tests for the server room logic;
- a headless 100-bot load test;
- automated perf and budget checks.

**Organization**: tasks are grouped by user story (US1–US9 from spec.md). The phases follow
priority order: P1 (US1, US2, US3), then P2 (US4, US5, US6, US9, US7), then P3 (US8).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: the user story the task belongs to
- Paths are relative to the repository root
- All commands run on **Node 24** (`nvm use`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: move to Node 24, turn the server placeholder into a real package, and wire up dev
tooling.

- [X] T001 Update root `package.json` and add `.nvmrc`.
  - **`engines`**: `"node": ">=24.11"`; `.nvmrc` contains `24`.
  - **Scripts**:
    - `dev`: `pnpm -r --parallel --filter @hht/server --filter @hht/client dev`
    - `loadtest`: `pnpm --filter @hht/server loadtest`
    - `reports`: `pnpm --filter @hht/server reports`
  - **`verify`**: becomes `pnpm typecheck && pnpm test && pnpm build && pnpm check:budgets && pnpm e2e && pnpm perf && pnpm loadtest --duration 60`.
- [X] T002 Scaffold `packages/server/package.json`:
  - **Package**: name `@hht/server`, type module, private.
  - **Dependencies**: `colyseus@0.18.10`, `@colyseus/ws-transport@0.18.4`, `@colyseus/schema@5.0.43`, `@hht/shared workspace:*`.
  - **Dev dependencies**: `@colyseus/testing@0.18.6`, `@colyseus/sdk@0.18.9`, `vitest@5.1.0`, `typescript@7.0.2`, `@types/node@24`.
  - **Scripts**:
    - `start`: `node src/index.ts`
    - `dev`: `HHT_METRICS=1 HHT_DEV_CHEATS=1 node --watch src/index.ts`
    - `typecheck`: `tsc -p tsconfig.json`
    - `test`: `vitest run`
    - `loadtest`: `node loadtest/run.ts`
    - `reports`: `node scripts/reports.ts`
  - Replace `packages/server/README.md` with run instructions.
- [X] T003 [P] Write `packages/server/tsconfig.json` and `packages/server/vitest.config.ts`.
  - **tsconfig**: extends the base, with `"erasableSyntaxOnly": true`, `"types": ["node"]`, `"lib": ["ES2024"]`, and includes `src`, `test`, `loadtest`, `scripts`. Server code must not use enums, parameter properties or decorators (research R1).
  - **vitest**: node environment, includes `test/**/*.test.ts`, 30 s timeout.
- [X] T004 [P] Add `@colyseus/sdk@0.18.9` to `packages/client/package.json`. In `packages/client/vite.config.ts`, proxy `/api` → `http://localhost:2567` and `/ws` → `ws://localhost:2567` (`ws: true`) for both `server` and `preview`.
- [X] T005 [P] Add `data/`, `reports/` and `packages/server/data/*.sqlite*` to `.gitignore`. Create `packages/server/data/chat-blocklist/en.txt` and `vi.txt` with a header comment explaining the format (one term per line, `#` comments; research R16).
- [X] T006 [P] Extend `tools/assets/budgets.json` and `tools/assets/check-budgets.mjs`.
  - **`perAsset`**: `site` 500000, `foreman` 150000, `props-mp` 120000, `clock-tower-lod1-1`…`-6` 40000 each, `clock-tower-stage-N-merged` (keep 600000).
  - **`render.crowd`**: `{ "high": { "drawCalls": 300, "triangles": 600000 }, "low": { "drawCalls": 200, "triangles": 300000 } }`.
  - **`net`**: `{ "ticksPerSMin": 19.5, "tickMsAvg": 10, "tickMsP99": 25, "bytesInPerSAvg": 30000, "heapMbPeak": 256, "heapSlopeMbPerMin": 0.5 }`.
  - **Critical payload check**: `check-budgets.mjs` must compute the multiplayer critical payload *without* the Rapier chunk, and the solo payload with it.
- [X] T007 Run `pnpm install` on Node 24. Confirm that `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e` and `pnpm perf` from feature 001 still pass unchanged.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the protocol, kinematics, site layout, server room skeleton, persistence, matchmaking
and client net and boot routing. Every story needs them.

**⚠️ CRITICAL**: no user story work can begin until this phase is complete.

### Shared rules and protocol

- [X] T008 [P] Add multiplayer constants to `packages/shared/src/constants.ts`:
  - `LOOSE_MP = { maxLoose: 150, fadeAfterSeconds: 60 }`; keep `LOOSE.maxLoose = 30` for solo;
  - `CREW = { maxSize: 8, requestExpireS: 30, denyCooldownS: 60, hostAwayS: 60, hostIdleS: 300, unattendedAfterS: 180 }`;
  - `PLOTS = { count: 12, retireAfterFinishedS: 600, celebrateS: 8 }`;
  - `SHIFT = { defaultMinutes: 60, warnS: 300, countdownS: 30 }`;
  - `NET = { tickMs: 50, patchMs: 100, simHz: 60, reconnectGraceS: 60, bootGraceS: 120, idleKickS: 600, tiers: [15, 35], hysteresisM: 2, interpDelayMs: [100, 180, 320], extrapolateMaxMs: 200 }`;
  - `CHAT = { maxLen: 80, nearbyM: 20, unlockAfterS: 60, duplicateWindowS: 30, logLines: 50, ringSize: 5, pauseReporters: 3, pauseWindowS: 600, reportRetentionDays: 30 }`;
  - `SOCIAL = { emoteRadiusM: 35, showS: 3 }`;
  - `BIN = { capacity: 10 }`.
- [X] T009 [P] Implement `packages/shared/src/rateLimit.ts`. It provides pure token buckets (`createBucket(refillPerS, burst)`, `take(bucket, now) → boolean`) and a strike window (`addStrike(window, now) → count in the last 10 s`). Export the `RATE` table from data-model.md:
  - move 60/s burst 12;
  - action 5/s burst 8;
  - emote 1 per 1.5 s burst 3;
  - request 1 per 5 s burst 2;
  - admin 2/s burst 4;
  - chat 1 per 2 s burst 3;
  - report 1 per 10 s burst 2;
  - **strike limit**: "30 strikes in 10 s" → disconnect.
- [X] T010 [P] Implement `packages/shared/src/names.ts`: `uniqueName(base, taken: Set<string>)`. It appends " 2", " 3"… and the result must stay ≤ 20 chars: truncate the noun-less suffix variant if needed, and keep `isValidGuestName`-compatible words.
- [X] T011 [P] Implement `packages/shared/src/interest.ts`: `tierFor(distance, prevTier)` with tiers ≤ 15 m → 1, ≤ 35 m → 2, else 3, and **2 m hysteresis**. Also `isDue(tier, tick)`: tier 1 every tick (20 Hz), tier 2 every 2nd tick (10 Hz), tier 3 every 5th tick (4 Hz).
- [X] T012 [P] Implement `packages/shared/src/social.ts`: `EMOTE_IDS = ['wave','cheer','dance','point','thumbsUp']` and `QUICK_MESSAGE_IDS = ['needBricks','overHere','thanks','nice','letsBuild','canIJoin']`, with type guards.
- [X] T013 Implement `packages/shared/src/protocol.ts` per `contracts/network-protocol.md`:
  - `PROTOCOL_VERSION = 1`;
  - the `JoinOptions` validator (protocol, 32-hex `playerKey`, `isValidGuestName`, `isHatColorId`);
  - client message types and validators for `grab`, `drop`, `toss`, `emote`, `say`, `foreman`, `crew`, `hide`, `shuffleName`, `ping`, `respawn`, `chat`, `report`. Validators reject non-finite numbers, unknown ids and payloads > 256 bytes (`chat` ≤ 400 bytes raw);
  - server event payload types;
  - close codes 4001–4005;
  - binary codecs `encodeSnapshot`/`decodeSnapshot`, writing into a caller-provided `DataView` so buffers are pooled. The format is little-endian: header, then own state, then `count × 10` bytes of `u16 netId, i16 x/y/z (cm), u8 yaw, u8 flags`;
  - binary codecs `encodeMoveInputs`/`decodeMoveInputs`: `u16 firstSeq, u8 n (1..12)`, then `n × (i8 dx, i8 dz, u8 buttons)`;
  - serial-number comparison for the u16 seq.
- [X] T014 Implement `packages/shared/src/kinematics.ts`: `stepWorker(state, input, dt, site, blockers) → WorkerState`, run at a fixed 60 Hz, deterministic, using only + − × ÷ √ and a facing lookup table.
  - **Ported from** `packages/client/src/player/controller.ts`: acceleration (grounded 40, air 12), coyote 0.1 s, jump buffer 0.15 s, gravity 22, jump apex 1.1 m, walk 3.2, run 5.5, carry slowdown 15 % for beam/bell.
  - **Collision**:
    - worker circle r = 0.32 vs. boxes (rotated) and cylinders;
    - autostep when `top ≤ 0.35`;
    - stand on top when the feet are ≥ `top`;
    - clamp to `playRadius`;
    - tower footprints come from `blockers`;
    - no worker–worker collision.
  - Export `initialWorker(spawn)` and `quantizeDir(x, z) → {dx, dz}` (i8).
- [X] T015 [P] Unit tests in `packages/shared/test/protocol.test.ts`:
  - snapshot and move-input round trips at their limits (±327.67 m, yaw wrap, seq wrap);
  - every validator accepts good and rejects bad payloads;
  - a fuzz test of 10 000 random byte arrays that never throw outside validators.
- [X] T016 [P] Unit tests in `packages/shared/test/kinematics.test.ts`:
  - identical input streams give bit-identical states (two independent runs);
  - horizontal speed ≤ 5.5 m/s (≤ 4.675 m/s carrying a beam);
  - apex ≤ 1.1 m + 1e-6 above the support;
  - never ends inside a blocking obstacle (random walk of 100 000 steps against `site.gen` obstacles);
  - never leaves `playRadius`;
  - autosteps a 0.3 m box but not a 0.5 m one;
  - can land on and stand on a rack top;
  - coyote and buffered jump behave as in 001.
- [X] T017 [P] Unit tests in `packages/shared/test/rateLimit.test.ts`, `names.test.ts`, `interest.test.ts` and `social.test.ts`:
  - **rate limits**: the burst, then the refill;
  - **strikes**: 30 within 10 s;
  - **names**: duplicates get unique suffixes and stay valid at ≤ 20 chars;
  - **interest**: hysteresis prevents flapping at 15 ± 1 m, and the due cadence is 20/10/4 Hz.
- [X] T018 Export all new modules from `packages/shared/src/index.ts`.

### Site layout (Blender → shared data)

- [X] T019 Create `tools/blender/builders/site.py`. It is an original floating site in the approved toon style:
  - a central plaza (radius about 8 m) containing the empties `Spawn` and `Foreman`;
  - 12 plots on a ring (radius about 24 m), each with a foundation and the empties `Plot_<i>`, `Plot_<i>_Sign`, `Plot_<i>_Bin`;
  - 4 supply yards, each with `Rack_<type>` for the 7 types, every yard shared by 3 neighboring plots;
  - trees, fences and grass rim; play radius about 34 m.

  Add it to `tools/blender/export_assets.py` so it produces `site.glb`.
- [X] T020 Extend the pipeline (`tools/blender/export_assets.py` or `tools/assets/run-pipeline.mjs`) to write `packages/shared/src/site.gen.ts` from the site empties and obstacle list:
  - `playRadius`;
  - `plaza {center, radius}`, `spawn`, `foreman {pos, yaw, talkRadius: 2.0}`;
  - `plots[12] {index, center, yaw, buildZoneRadius: 3.0, bin {pos, radius: 0.9}, sign {pos}, towerFootprint {hx, hz}}`;
  - `supplyYards`;
  - `obstacles {boxes, cylinders}` with `top` heights.

  Convert coordinates Blender (x, y, z) → three (x, z, −y), and mark the file `// GENERATED`.
- [X] T021 Run `pnpm assets`. Commit the generated `site.gen.ts` and check that `site.glb` is within the 500 KB budget. Render `assets/renders/site-overview.png` for owner review.

### Server core

- [X] T022 [P] Implement `packages/server/src/config.ts`. It reads `HHT_PORT` (2567), `HHT_DB` (`data/hht.sqlite`), `HHT_SHIFT_MINUTES` (60), `HHT_MAX_PLAYERS` (100), `HHT_METRICS`, `HHT_DEV_CHEATS` and `HHT_BLOCKLIST_DIR` (`packages/server/data/chat-blocklist`), and returns a frozen config object.
- [X] T023 Implement `packages/server/src/persistence/db.ts`:
  - open `node:sqlite` `DatabaseSync` with `PRAGMA journal_mode=WAL; synchronous=NORMAL; foreign_keys=ON`;
  - apply `specs/002-multiplayer-core/contracts/persistence.sql` as migration v1 (tables `meta`, `world`, `building`, `crew_member`, `bin_entry`, `chat_report`, `chat_pause`), recording `schema_version`;
  - provide `tx(fn)` for synchronous transactions and `timed()` to report SQLite time to metrics;
  - support `HHT_DB=:memory:` for tests.
- [X] T024 [P] Implement `packages/server/src/metrics.ts`. It keeps ring buffers for tick ms, encode ms, SQLite ms, event-loop delay (`perf_hooks.monitorEventLoopDelay`), GC pauses (`PerformanceObserver` 'gc'), heap, and bytes per client per second. `snapshot()` returns the shape in `contracts/http-api.md` (`/api/metrics`).
- [X] T025 Define `WorldState` with `schema()` (no decorators) in `packages/server/src/rooms/schema.ts`, exactly per `contracts/network-protocol.md` §3:
  - `worldId`;
  - `shift {epoch, endsAt, towersCompleted, phase}`;
  - `players` map `{netId, name, hatColor, heldType, crewPlot (-1 none), crewRole, away}`;
  - `plots` array (length 12) `{state, blueprintId, completedStages, filledSlots, hostName, hostSession, joinMode, crewSize, bin[], finishedAt}`;
  - `pieces` map `{type, state 'loose'|'flying', x, y, z, ox, oy, oz, vx, vy, vz, t0, landAt}`.
- [X] T026 Implement `packages/server/src/systems/limits.ts`. It holds per-session buckets from the shared `RATE` table, `guard(session, class)` (returns false and sends `slowDown` at most once per 2 s), and `strike(session, reason)` (closes with 4003 on "30 strikes in 10 s").
- [X] T027 Implement the `packages/server/src/rooms/WorldRoom.ts` skeleton:
  - **`onCreate({worldId})`**: `maxClients = HHT_MAX_PLAYERS`, `patchRate = 100`, `setSimulationInterval(tick, 50)` with metrics timing around the tick;
  - **`onAuth`**: validates `JoinOptions` with the shared validator, closing with 4001 on a protocol mismatch, and computes `keyHash = sha256(playerKey)`;
  - **`onJoin`**: assigns a monotonic `netId` that is never reused within a shift epoch, applies `uniqueName`, creates the session per data-model.md PlayerSession, and sends `welcome {sessionId, netId, worldId, serverNow, tick, name, resumed:false}`;
  - **`onLeave`**: removes the player for now (grace handling comes in US1);
  - **a message router**: every message is validated, rate-limited and routed to a system handler, and invalid messages add strikes;
  - **`ping` → `pong`**.
- [X] T028 Implement `packages/server/src/http/health.ts` (`GET /api/health` → `{ok, protocol, worlds:[{worldId, players}]}`) and `http/metrics.ts` (`GET /api/metrics`, 404 unless `HHT_METRICS=1`).
- [X] T029 Implement `packages/server/src/http/matchmake.ts` (`POST /api/matchmake {protocol, playerKey, world?}`), choosing a world in this order:
  1. the requested world if it exists and has a seat;
  2. the lowest `worldId` with a seat (a world where this `keyHash` can resume counts as having a seat);
  3. otherwise create the next `worldId`.

  It returns `{reservation, worldId, redirected}` using Colyseus `matchMaker.reserveSeatFor`. Errors: 426 on protocol mismatch, 400 for an invalid body (> 1 KB or malformed), 429 above 10 per minute per IP, 503 while restoring.
- [X] T030 Implement `packages/server/src/index.ts`: load config → open the db → define the `world` room → create world 1 at boot → mount the HTTP routes and the WS transport under `/ws` → listen on `HHT_PORT`. On SIGINT/SIGTERM, close all clients with 4005 and close the db.
- [X] T031 Create the integration test harness `packages/server/test/helpers.ts`. It boots the server in-process with `@colyseus/testing` (`HHT_DB=:memory:`, small `HHT_MAX_PLAYERS` and short timers through config overrides), and provides `joinPlayer(opts)` (matchmake + consume reservation with `@colyseus/sdk`), `waitForEvent`, `advance(ms)` (fake clock), and a raw-message sender.
- [X] T032 [P] Integration test `packages/server/test/auth.test.ts`. It covers the 4001 protocol mismatch, an invalid name/color/key rejected, the `welcome` fields, the `ping`/`pong` round trip, an invalid message adding a strike, and 30 invalid messages in 10 s → close 4003.

### Client core

- [X] T033 [P] Extend `packages/client/src/profile/guestProfile.ts` to `hht.profile.v2` with these new fields:
  - `playerKey` (32 hex chars, from `crypto.getRandomValues`, created once);
  - `lastWorld` (number | null);
  - `hideAllChat` (boolean, default false).

  Migrate v1 by adding them. Keep the in-memory fallback when storage is unavailable. Update `packages/client/test/guestProfile.test.ts` (migration, key format and stability).
- [X] T034 [P] Implement `packages/client/src/net/clock.ts`: `offset = serverNow − clientNow` from `welcome`, then from `pong`. Keep the median of the last 5 samples and discard samples whose RTT is > 2× the median. Provide `serverNow()` and `rtt()`. Unit tests in `packages/client/test/clock.test.ts`.
- [X] T035 Implement `packages/client/src/net/matchmake.ts` (`POST /api/matchmake` with a 6 s total timeout, returning a reservation or a typed error: `protocol` | `unreachable` | `full`) and `packages/client/src/net/connection.ts`:
  - consume the reservation with `@colyseus/sdk` on the same origin `/ws`;
  - expose the decoded schema state;
  - dispatch typed server events on an `EventTarget`;
  - decode the binary `snap` with the shared codec;
  - handle close codes per the contract table.
- [X] T036 Extract `packages/client/src/game/GameShell.ts` from `packages/client/src/game/Game.ts`: the frame loop, camera follow, input polling (`Actions`), HUD wiring, quality and bloom. `Game.ts` (solo) must keep identical behavior on top of it. Make Rapier load through a dynamic `import()` inside the solo path only (`Game.build()`), and remove `initRapier()` from the eager path in `main.ts`.
- [X] T037 Update `packages/client/src/main.ts` routing:
  - `?solo=1` → the 001 solo `Game`, with no network calls;
  - otherwise → `matchmake()`, then `NetGame` (a stub that loads site assets and shows the plaza).

  Load the critical assets for the chosen mode only.
- [X] T038 [P] Implement `packages/client/src/world/site.ts`. It loads `site.glb`, places plaza, plots, yards and racks from `site.gen.ts`, and applies the toon material and outlines as in 001.
- [X] T039 Update `packages/client/playwright.config.ts`:
  - `webServer` becomes an array: the server (`pnpm --filter @hht/server start` with `HHT_DB=:memory: HHT_DEV_CHEATS=1 HHT_METRICS=1`, url `http://localhost:2567/api/health`) and the client (`pnpm build && pnpm preview`, with the proxy from T004);
  - `packages/client/e2e/helpers.ts` adds `?solo=1` to every 001 spec URL.

  Confirm that the 001 specs pass in solo.
- [X] T040 [P] Add the `mode` field and an empty `net` section to `packages/client/src/debug/debugApi.ts` (`contracts/debug-api.md`). In net mode, disable the 001 world-mutating cheats.

**Checkpoint**: shared protocol and kinematics are tested, the site is exported, the server boots
with matchmaking and auth, the client can route solo vs. net, and the 001 e2e suite passes under
`?solo=1`.

---

## Phase 3: User Story 1 - Open the link and play in a shared world (Priority: P1) 🎯 MVP

**Goal**: everyone opening the link lands in world 1 and sees the others move smoothly, while their
own worker is predicted. Overflow goes to world 2, invite links work, and reconnect, resume and
idle handling are in place.

**Independent Test**: two or more browsers (plus bots) land in the same world and see each other
with correct names and colors, moving smoothly. Their own movement stays responsive with 150 ms
added latency. A 3rd player with `HHT_MAX_PLAYERS=2` goes to world 2.

### Tests for User Story 1

- [X] T041 [P] [US1] Integration test `packages/server/test/join.test.ts`:
  - two players join world 1 and both see each other in `players`;
  - duplicate names get " 2";
  - with `HHT_MAX_PLAYERS=2`, a 3rd player is placed in world 2;
  - an invite to a full world gives `redirected:true`;
  - an empty overflow world is disposed after 5 min (fake clock) and its state deleted;
  - `shuffleName` updates for everyone.
- [X] T042 [P] [US1] Integration test `packages/server/test/movement.test.ts`:
  - a server-stepped worker matches a local `stepWorker()` replay of the same inputs bit for bit;
  - more than 60 inputs/s (+12 burst) are dropped and add strikes, so the worker cannot move faster than 5.5 m/s;
  - `respawn` teleports to the spawn and sends `correction {reason:'respawn'}`;
  - the snapshot acknowledges the last processed seq.
- [X] T043 [P] [US1] Integration test `packages/server/test/snapshots.test.ts`:
  - entity records appear at 20/10/4 Hz by distance tier, with hysteresis;
  - `netId` is never reused after a leave within the epoch;
  - snapshot bytes per client for 10 nearby players are ≤ 10 × 10 + header bytes per tick.
- [X] T044 [P] [US1] Integration test `packages/server/test/reconnect.test.ts`:
  - a socket drop and reconnect within 60 s keeps the sessionId, netId and name;
  - a new join with the same `playerKey` within 60 s resumes (`welcome.resumed = true`);
  - after 60 s it is a new arrival;
  - 10 min with no input → close 4002;
  - a second tab with the same key becomes a separate worker with a suffixed name.
- [X] T045 [P] [US1] Unit tests in `packages/client/test/interpolation.test.ts` and `prediction.test.ts`:
  - **interpolation**: each tier renders at `serverTime − [100,180,320] ms`; extrapolation stops at 200 ms, then the worker holds still; a tier change does not jump.
  - **prediction**: replay after a correction reproduces the server state; a correction > 2 cm triggers a reset + replay; the visual offset decays to 0 within 150 ms.
- [X] T046 [P] [US1] E2E `packages/client/e2e/mp-presence.spec.ts`: two browser contexts open `/` (`?e2e=1`) and both report the same `worldId`. Each sees the other in `__hht.net.players()` with the correct name and color. Moving A with the keyboard changes A's position as seen by B within 0.5 s. The player counter shows 2.

### Implementation for User Story 1

- [X] T047 [US1] Implement `packages/server/src/systems/movement.ts`:
  - a per-session input queue fed by the binary `in` message (shared decoder);
  - each tick, drain the queue in seq order through `stepWorker()` at 1/60 s, limited by the move bucket ("60/s, burst 12": excess inputs are dropped and add strikes);
  - store `lastSeq`;
  - `respawn` → teleport to spawn + `correction`;
  - out-of-bounds (y < −5) → respawn.
- [X] T048 [US1] Implement `packages/server/src/systems/snapshots.ts`:
  - per-receiver interest tiers via shared `tierFor`/`isDue`, with the previous tier kept per pair;
  - encode into a **pooled per-connection buffer** (shared `encodeSnapshot`) with the own authoritative state and `ackSeq`;
  - send with `client.sendBytes`;
  - record bytes per client in metrics;
  - skip tier-3 records when the client send buffer is > 256 KB, and disconnect after more than 10 s above 1 MB (research R11).
- [X] T049 [US1] Implement session lifecycle in `packages/server/src/rooms/WorldRoom.ts`:
  - `allowReconnection(client, 60)` on an unconsented leave (`away = true` in the schema; the worker is hidden);
  - **resume by `keyHash`**: a join matching an `away` session takes it over, with the same netId, name and (later) crew role, `resumed:true`;
  - remove after 60 s;
  - **idle**: 10 min with no input → close 4002;
  - the `shuffleName` handler (shared validator + `uniqueName`, rate 1 per 2 s).
- [X] T050 [US1] Add overflow-world disposal to `packages/server/src/http/matchmake.ts` and `WorldRoom.ts`: a world > 1 that has been empty for 5 minutes is disposed and its rows deleted (CASCADE). Clients still connected when a world closes get close 4004.
- [X] T051 [P] [US1] Implement `packages/client/src/net/snapshot.ts`, which decodes `snap` into per-entity buffers keyed by `netId` and maps `netId → sessionId` from the schema. Implement `packages/client/src/net/interpolation.ts`: a per-entity ring of (serverTime, pose) with per-tier delays of **100/180/320 ms**, extrapolation limited to **200 ms**, then holding still.
- [X] T052 [P] [US1] Implement `packages/client/src/net/prediction.ts`:
  - run `stepWorker()` locally at 60 Hz;
  - keep the last 2 s of (seq, input, state);
  - send batches of `MoveInput` every 50 ms with the shared encoder;
  - on a snapshot, compare with the stored state for `ackSeq`; if the difference is > 2 cm, reset to the server state and replay the unacknowledged inputs;
  - keep a visual offset that decays over 150 ms;
  - `correction` → snap instead of blending.
- [X] T053 [US1] Implement `packages/client/src/crowd/CrowdRenderer.ts`:
  - one `InstancedMesh` per worker part (Body, Hat, Arm_L, Arm_R, Leg_L, Leg_R) with the pivots preserved, plus instanced outline hulls that are **culled** (not just faded) beyond the quality tier's outline distance;
  - per-instance hat color via `setColorAt`;
  - the 001 `WorkerView` procedural animation (idle/walk/run/air/cheer, carry poses) ported to per-instance matrices driven by interpolated poses and anim flags;
  - carried pieces as one `InstancedMesh` per piece type;
  - hidden or away players not drawn.
- [X] T054 [P] [US1] Implement `packages/client/src/crowd/billboards.ts`: one instanced billboard batch with a canvas atlas. Names are drawn into the atlas on join and freed on leave, and nameplates are culled beyond 25 m. It is reused later for crew flags and quick-message bubbles.
- [X] T055 [US1] Implement `packages/client/src/game/NetGame.ts`. On top of `GameShell`:
  - the own worker uses `WorkerView`, driven by `net/prediction.ts`, using camera-relative input resolved to a world direction and quantized;
  - remote workers come from `CrowdRenderer` with interpolation;
  - the HUD shows the player count;
  - `welcome` sets the clock offset and saves `profile.lastWorld`.
- [X] T056 [P] [US1] Add to `packages/client/src/ui/`:
  - `connectionChip.ts`: "Connection is shaky" when RTT > 400 ms or no snapshot has arrived for > 500 ms;
  - `invite.ts`: Menu → "Invite friends" copies `${origin}/?w=${worldId}` and shows "Link copied!"; on `redirected` it shows "That site is full — you've been sent to a nearby one";
  - modal screens for close codes: 4001 "A new version is ready — tap to reload", 4002 "Tap to rejoin", 4003 "Disconnected" with a rejoin button after 30 s;
  - for 4004/1006, a silent matchmake again using `lastWorld`.
- [X] T057 [US1] Read `?w=<n>` in `packages/client/src/main.ts` and pass it to `matchmake()`, falling back to `profile.lastWorld`. Then implement the `net` section of `packages/client/src/debug/debugApi.ts`: `connected`, `worldId`, `me`, `players`, `stats`, `events`, `send`, and `dev.teleport`/`dev.spawnBots` (server-side cheats behind `HHT_DEV_CHEATS=1`).

**Checkpoint**: MVP. Players share one world from a link and see each other move smoothly with
server-authoritative movement.

---

## Phase 4: User Story 2 - Talk to the Foreman and start your own building (Priority: P1)

**Goal**: the Foreman assigns a free plot and makes the player its Host. The Host carries, tosses
and snaps pieces; the server owns every piece and the tower. Everyone sees towers grow and
Masterpieces celebrate, and finished towers stay standing.

**Independent Test**: talk to the Foreman → Clock Tower → follow the arrow → build stages as Host.
A second client sees the sign, the tower state and the snaps within 0.5 s. With all plots taken,
the Foreman says so.

### Tests for User Story 2

- [X] T058 [P] [US2] Unit tests `packages/shared/test/toss.test.ts` and `plots.test.ts`:
  - **toss**: `tossArc` ground hit and time are exact in closed form; the speed is clamped by mass; the swept-segment zone test catches an arc that ends in a zone between samples.
  - **plots**, the state machine from data-model.md:
    - `free → building` (start);
    - `building → finished` (masterpiece);
    - `finished → free` only if `now − finishedAt ≥ 600 s`, retiring the oldest first;
    - the Foreman picks the lowest free index, and gives `allPlotsBusy` otherwise;
    - "A player MUST be in at most one crew at a time".
- [X] T059 [P] [US2] Integration test `packages/server/test/pieces.test.ts`:
  - grabbing from a rack in range works, and out of range (> pickup radius + 0.3 m) does nothing;
  - two simultaneous grabs of one loose piece: exactly one holds it;
  - a flying piece cannot be grabbed;
  - drop/toss into the plaza → the piece fades at once;
  - loose cap 150, with the oldest fading first;
  - fade after 60 s untouched;
  - disconnecting while holding drops the piece.
- [X] T060 [P] [US2] Integration test `packages/server/test/buildings.test.ts`:
  - Foreman `start` in range → `assigned` with the lowest free plot, and the player becomes Host (`crewRole 'host'`);
  - out of the talk radius → no effect;
  - the Host delivers 30 pieces → `snap` events to everyone and `masterpiece`, `celebrate` for 8 s, then `finished` with the crew dissolved;
  - a wrong piece gives a `hint` to the actor only, and the piece is pushed 1.5 m outside the zone;
  - simultaneous last-slot deliveries fill exactly one slot, and the second follows the normal rules;
  - a non-crew delivery has no effect on the tower;
  - each change is written to the SQLite `building` row within the same tick.
- [X] T061 [P] [US2] E2E `packages/client/e2e/mp-foreman.spec.ts`: A talks to the Foreman, starts a Clock Tower and becomes Host; `dev.give('beam')` and a drop in the zone follow. B sees `plots()[i].filledSlots` increase within 0.5 s, with the Host name on the sign.

### Implementation for User Story 2

- [X] T062 [P] [US2] Implement `packages/shared/src/toss.ts`: `tossArc(origin, facing, mass, charge) → {velocity, landing, landAt}`, with the ground hit in closed form on flat ground and the speed clamped by mass. Also `sweptHitsCircle(arc, center, r)`.
- [X] T063 [P] [US2] Implement `packages/shared/src/plots.ts`:
  - `PlotState = 'free'|'building'|'unattended'|'finished'`;
  - `assignPlot(plots, now) → index | 'allPlotsBusy'` (lowest free index, else retire the oldest finished with `now − finishedAt ≥ 600 s`);
  - the transitions from data-model.md (Plot and Building).
- [X] T064 [P] [US2] Implement the base of `packages/shared/src/crew.ts`: the `Crew` type `{members: {keyHash, sessionId|null, name, joinedAt, role}[]}`, `createCrew(host)`, `canSnap(player, building)` (the player is a member of that building's crew) and `isInAnyCrew`.
- [X] T065 [US2] Implement `packages/server/src/systems/pieces.ts`:
  - **grab** from a rack (in range of the server worker position + 0.3 m tolerance) or of a loose piece (the first message wins; flying pieces cannot be grabbed);
  - **drop** at worker + forward 0.6 m;
  - **toss** via shared `tossArc` from the server worker state, flying in the schema with `arc`;
  - **landing resolve** at `landAt`, evaluated at landing time, in the order: plaza → fade; crew build zone → `deliver()`; otherwise loose. Non-crew handling in zones is a pushout until US5 adds bins;
  - the 150 cap with the oldest first, and the 60 s fade;
  - `heldType` in the schema plus carry bits in snapshots.
- [X] T066 [US2] Implement `packages/server/src/systems/buildings.ts`:
  - `deliver()` (shared progression) for crew members only;
  - events: `snap {plot, result, by, pieceType}` to everyone, `hint {wrongPiece, needed}` to the actor only, `celebrate {plot, until}` (8 s);
  - after masterpiece, `finished` with `finishedAt` and the crew dissolved; `shift.towersCompleted += 1`;
  - plot schema updates;
  - tower footprints passed to `stepWorker` as blockers once stage ≥ 1.
- [X] T067 [US2] Implement `packages/server/src/systems/foreman.ts`: `foreman {op:'start', blueprint:'clock-tower'}` within `talkRadius` 2.0 m, not in a crew → `assignPlot`, create the building (`joinMode 'ask'`, the player as Host), reply `foreman {result:'assigned', plot}`, or `allPlotsBusy` (retiring the oldest qualifying finished plot when possible).
- [X] T068 [US2] Implement the building parts of `packages/server/src/persistence/repo.ts`: `saveBuilding(worldId, plot)`, `deleteBuilding` and `saveCrew(plot)`, each as one synchronous transaction in the same tick as the mutation, with the `epoch` column and `host_key_hash` (never the raw key).
- [X] T069 [P] [US2] Create `tools/blender/builders/foreman.py`: an original chibi Foreman (white hard hat, orange vest, clipboard, mustache-free friendly face) with rigid parts `Foreman > Body, Head, Arm_L, Arm_R (Clipboard), Leg_L, Leg_R` for procedural idle and talk. Export `foreman.glb` (≤ 150 KB) and render `assets/renders/foreman.png` for owner review.
- [X] T070 [P] [US2] Extend `tools/blender/builders/clock_tower.py`:
  - per stage, export `clock-tower-stage-N-merged` (merged by material, **≤ 15 draw calls including outlines**);
  - export `clock-tower-lod1-N` (a single merged mesh with baked vertex colors, 1 draw call, ≤ 40 KB);
  - mark the LOD1s as critical and the merged LOD0s as deferred in the manifest.
- [X] T071 [P] [US2] Create `tools/blender/builders/props_mp.py`: the plot sign with a flag slot and star row, the supply bin (used in US5), and a 12-flag atlas (12 distinguishable color + symbol pairs, `flag = plotIndex`). Export `props-mp.glb` (≤ 120 KB).
- [X] T072 [US2] Implement `packages/client/src/world/towerLod.ts`: per plot, show LOD1 (instanced per stage across plots) and swap to the merged LOD0 for the **2 nearest towers within 30 m**. Stream LOD0 per stage on first need. Share geometry and materials across plots.
- [X] T073 [P] [US2] Implement `packages/client/src/world/plotView.ts` (sign with the Host name, flag, stars and next-needed icon from the schema; ghost slots for the current stage reusing 001 `slotMarkers`/`ghost`) and `packages/client/src/world/foremanView.ts` (procedural idle and talk animation).
- [X] T074 [US2] Implement network pieces in `packages/client/src/game/NetGame.ts`:
  - loose pieces rendered from the schema with instanced pieces;
  - flying pieces replayed from `arc` (same `tossArc` math, positioned by `serverNow()`);
  - held pieces on the own and crowd workers;
  - the context-sensitive `action` from `contracts/controls.md`, with the button prompt label;
  - grab/drop/toss intents (toss charge from the hold time);
  - snap, stage, celebration and hint effects and sfx from 001, positioned at each plot.
- [X] T075 [US2] Implement `packages/client/src/ui/foremanDialog.ts`: buttons "Start a building" → Clock Tower card → "Let's build!", "Bye", plus placeholders for "Who's hiring?" and "Unfinished buildings" (filled in US3/US4). It closes on Esc or when walking away. On `assigned`, show a guide arrow to the plot (reusing the 001 hint arrow). On `allPlotsBusy`, show a kind message.

**Checkpoint**: solo-Host building works end to end in the shared world.

---

## Phase 5: User Story 3 - Join a crew and build together (Priority: P1)

**Goal**: crew join modes (Open, Ask, Solo), requests with Host approval, expiry, cooldown,
capacity, removal and explicit hand-over, with shared crew flags.

**Independent Test**: test each join mode; approve, deny and expire requests; remove a member; and
have several members deliver at once. Everyone sees the same crew and tower state, and nothing is
duplicated.

### Tests for User Story 3

- [X] T076 [P] [US3] Unit tests in `packages/shared/test/crew.test.ts`, covering `requestJoin` results:
  - `open → joined`, `ask → pending`, `solo → closed`;
  - `full` at 8 members including the Host;
  - `cooldown` within 60 s after a denial or removal;
  - `alreadyInCrew`;
  - "only one pending request per player" (a new request replaces the old one).

  Also: a request expires after 30 s; it is expired when the mode switches to solo or the crew becomes full; approval checks capacity again; the remove/handover/leave roles are Host-only where required.
- [X] T077 [P] [US3] Integration test `packages/server/test/crews.test.ts`:
  - Ask: request → the Host gets `request {incoming}` → approve → `requestResult {joined}` and `crewNotice {joined}`, and the member can snap;
  - deny → `denied`, and asking again within 60 s → `cooldown` with `retryAt`;
  - 30 s → `expired`;
  - Open → joined immediately; Solo → `closed`;
  - the 9th member → `full`;
  - remove → `crewNotice {removed}`, and the removed player can no longer snap while snapped pieces stay;
  - `handover {to}` makes them Host;
  - a non-Host sending `answer`/`mode`/`remove` → strike, no effect;
  - crew rows are persisted.
- [X] T078 [P] [US3] E2E `packages/client/e2e/mp-crew.spec.ts`: B asks at A's sign; A sees the request card and approves with the Y key; both show A's flag; B's delivery snaps. A second run: deny, then retry, and B sees the cooldown text.

### Implementation for User Story 3

- [X] T079 [US3] Complete `packages/shared/src/crew.ts`:
  - `requestJoin(state, requester, plot, now) → 'joined'|'pending'|'closed'|'full'|'cooldown'|'alreadyInCrew'|'busy'`;
  - `answer(approve)`, `expireRequests(now)`, `setMode`, `remove`, `handOver(to)`, `leave`;
  - the deny/remove cooldown of **60 s** per plot;
  - requests expire after **30 s**;
  - "a player MUST have at most one pending request";
  - capacity **8** including the Host.
- [X] T080 [US3] Implement `packages/server/src/systems/crews.ts`:
  - handlers for `crew {op: request|cancel|answer|mode|remove|handover|leave}` with role checks (only the Host may `answer`/`mode`/`remove`/`handover`);
  - events `request {incoming|withdrawn}` to the current Host, `requestResult` to the requester, `crewNotice` to crew members;
  - schema `crewPlot`, `crewRole`, `crewSize`, `joinMode`;
  - request expiry each tick (once per second);
  - persist with `saveCrew`.
- [X] T081 [US3] Implement the Host request cards in `packages/client/src/ui/requestCards.ts`: stacked at the top, newest first, with the name, hat color, a 30 s countdown ring and ✔/✖ (keys Y/N, gamepad RB/LB, tap). Answering sends `crew {op:'answer'}`.
- [X] T082 [P] [US3] Implement the crew panel at the plot sign in `packages/client/src/ui/crewPanel.ts`: a member list with roles; for the Host, a join-mode toggle (Ask/Open/Solo) and per-member "Remove"/"Make Host"; "Leave crew" for everyone. Also implement the requester feedback toasts for `requestResult`: pending, joined, denied, expired ("The Host is busy — try again later"), full, closed, cooldown with time.
- [X] T083 [US3] Fill "Who's hiring?" in `packages/client/src/ui/foremanDialog.ts`: a list of buildings in Open/Ask mode that are not full, with stage, crew size and mode. Picking one shows a guide arrow to that plot.
- [X] T084 [US3] Add crew flags. Draw them over crew members' heads with `crowd/billboards.ts`, using the flag atlas from `props-mp`, with `flag = plotIndex`. Show the own flag in the HUD, and "You're the Host now!" / `crewNotice` toasts in `packages/client/src/ui/hud.ts`.

**Checkpoint**: all P1 stories are done. A shared world with Hosts and crews building towers
together.

---

## Phase 6: User Story 4 - The building survives its Host (Priority: P2)

**Goal**: automatic Host handover, and unattended buildings that can be adopted with their
progress kept.

**Independent Test**: make the Host disconnect, idle and leave in turn, and confirm the role passes
to the longest-serving member. Then empty the crew and confirm the building becomes adoptable after
3 min, keeping its progress.

- [X] T085 [P] [US4] Unit tests in `packages/shared/test/crew.test.ts` (handover section) and `plots.test.ts` (unattended section):
  - `nextHost` picks the oldest `joinedAt` among active members (not away, not idle ≥ 5 min), else the oldest;
  - the triggers: Host away > 60 s, Host leaves, Host idle 5 min while another member is active, explicit hand-over;
  - `building` with `emptySince` + 180 s → `unattended`;
  - a member rejoining clears `emptySince`;
  - adopting keeps the progress.
- [X] T086 [P] [US4] Integration test `packages/server/test/handover.test.ts`:
  - the Host disconnects → after 60 s, the longest-serving member becomes Host and gets `crewNotice {newHost}`;
  - the Host returns within 60 s → still Host;
  - the Host idles 5 min → handover;
  - a pending request moves to the new Host with the same expiry;
  - all members leave → 3 min later `unattended`;
  - the Foreman `adopt` → the new Host at the same stage and slots;
  - `foreman {op:'adopt'}` on a non-unattended plot → `notAvailable`.
- [X] T087 [US4] Implement handover and unattended timers in `packages/server/src/systems/crews.ts` (checks once per second using shared `nextHost`), and the `adopt` op in `packages/server/src/systems/foreman.ts`. Persist `empty_since` and the state changes.
- [X] T088 [US4] Show "Unfinished buildings" in `packages/client/src/ui/foremanDialog.ts` only when any exist (with stage and Host name). Adopting guides the player to the plot. Show `newHost` toasts to crew members.

**Checkpoint**: the constitution's "the tower survives its Host" rule holds.

---

## Phase 7: User Story 5 - Be kind by default: supply bins, emotes, mute and hide (Priority: P2)

**Goal**: outsiders help through bins, emotes and quick messages work, mute and hide are local, and
the anti-griefing rules hold (pass-through, plaza safe zone, rate limits).

**Independent Test**: an outsider drops a piece into a bin and the crew uses it (with "thanks").
Emotes and messages show on other clients. Mute and hide affect only the local client. Spam,
body-blocking and plaza drops are all impossible.

- [X] T089 [P] [US5] Unit tests in `packages/shared/test/bin.test.ts`:
  - accepts building piece types used by the blueprint (`beam`, `brick`, `panel`, `paint`, `decor`, `bell`) and never `cone`;
  - capacity is "up to 10 pieces";
  - full → refused;
  - take returns the donor.
- [X] T090 [P] [US5] Integration test `packages/server/test/kindness.test.ts`:
  - a non-crew drop or toss into the build zone or bin → `binned` (the bin has the piece) and never snapped;
  - a full bin → `hint {binFull}` and the piece is pushed out;
  - a crew member grabs from the bin → the donor gets `thanks`;
  - a non-crew bin grab → strike, no effect;
  - `emote`/`say` reaches only players within 35 m;
  - over the emote rate → `slowDown` once per 2 s;
  - a `hide` of a requester → that player's requests to this Host get `busy`, with no leak;
  - two workers can occupy the same spot (no collision).
- [X] T091 [P] [US5] Implement `packages/shared/src/bin.ts` (`canBin(type, blueprint)`, `addToBin` with a capacity of 10, `takeFromBin → {type, donorKeyHash}`).
- [X] T092 [US5] Update `packages/server/src/systems/pieces.ts` and `buildings.ts`:
  - landing or drop resolve for non-crew actors inside a build zone or bin radius → `binned` if the type is binnable and there is room, else pushed out with `hint {binFull|notCrew}`;
  - `grab {kind:'bin'}` for crew only;
  - `thanks {plot, by}` to the donor when their piece is used;
  - `bin_entry` persistence (`slot 0–9`, `piece_type` in the binnable set);
  - `donatedThisShift` / `deliveredThisShift` counters.
- [X] T093 [US5] Implement `packages/server/src/systems/social.ts`: `emote {id}` / `say {id}` with shared id validation, the emote rate class, relayed as `emote {who, id, kind}` to players within **35 m**; `hide {who, hidden}` is used only to filter join requests (FR-042).
- [X] T094 [P] [US5] Add the procedural emote poses wave, dance, point and thumbs-up (cheer exists) to `packages/client/src/player/workerView.ts` and the crowd animator in `packages/client/src/crowd/CrowdRenderer.ts`. Each plays for 3 s, and the snapshot `emoting` flag plus the `emote` event select the pose.
- [X] T095 [P] [US5] Implement `packages/client/src/ui/talkWheel.ts`: the T key, a 💬 button or gamepad Y opens a wheel of 5 emotes + 6 quick messages, picked with number keys, a tap or the right stick + A. Quick-message bubbles use the static atlas in `crowd/billboards.ts` for 3 s.
- [X] T096 [US5] Implement `packages/client/src/ui/playerCard.ts` and `peopleList.ts`:
  - tapping or clicking a worker (raycast on the instanced crowd) or the P key list opens a card with Mute, Hide (and later Report chat in US9);
  - for the Host, "Remove from crew" and "Make Host" when the player is in your crew;
  - mute and hide are kept in session memory, and hide sends `hide` to the server for request filtering;
  - hidden workers and their carried pieces are not drawn.
- [X] T097 [US5] Render supply bins in `packages/client/src/world/plotView.ts` with their contents (stacked piece icons from the schema `bin[]`). Show the "thanks" sparkle to the donor, the `slowDown` cue in `ui/hud.ts`, and the `binned` and `binFull`/`notCrew` hints.

**Checkpoint**: the kindness and anti-griefing baseline is complete (except typed chat, which is
US9).

---

## Phase 8: User Story 6 - Shifts and restarts (Priority: P2)

**Goal**: hourly shifts with a warning, countdown, reset and summary, and a full restore of
buildings, crews and the timer after a restart.

**Independent Test**: with `HHT_SHIFT_MINUTES=3`, check the warning, countdown, reset and summary.
Restart the server mid-shift: towers, Hosts, crews and the timer are restored, and clients are
back within 15 s.

- [X] T098 [P] [US6] Unit tests in `packages/shared/test/shift.test.ts`: `shiftPhase(now, endsAt, celebrating)` → `running` / `warning` (≤ 5 min) / `countdown` (≤ 30 s) / `resetting` only once no celebration is playing; booting after `endsAt` → reset immediately; `epoch` +1 per reset.
- [X] T099 [P] [US6] Integration test `packages/server/test/shift.test.ts`:
  - the `shift {warning}` and `shift {countdown}` events at the right times;
  - at the end: every plot is `free`, crews and bins are cleared, loose pieces are gone, players are teleported to the spawn and stay connected, each gets a personal `summary {epoch, worldTowers, myCrewTowers, delivered, donated}`, and `crew_member`/`bin_entry` rows are deleted;
  - a Masterpiece celebration in progress delays the reset until it ends.
- [X] T100 [P] [US6] Integration test `packages/server/test/restore.test.ts`:
  - build stages with a crew, close the room and db (simulated restart on the same file db), then boot again: plots, stages, slots, Host, crew, join mode, bin and remaining shift time are restored, and stale-epoch rows are purged;
  - a restored crew member rejoining with the same `playerKey` within 120 s resumes their role;
  - after 120 s the normal handover applies;
  - shutdown sends close 4005.
- [X] T101 [P] [US6] Implement `packages/shared/src/shift.ts` (`shiftPhase`, `nextEpoch`, `endsAt(startedAt, lengthMs)`).
- [X] T102 [US6] Implement `packages/server/src/systems/shift.ts`: the phase transitions each second, the `shift` events, and the reset procedure (waiting for any celebration → clear plots, crews, bins and pieces → teleport players → send personal `summary` → `epoch += 1` → persist `world` and delete per-epoch rows).
- [X] T103 [US6] Implement restore in `packages/server/src/persistence/repo.ts` and `packages/server/src/index.ts`:
  - at boot, read `world` and the rows with `epoch = world.epoch`, purge the stale ones, and reset at once if `now ≥ endsAt`;
  - rebuild the schema and crews, with restored members `away` and a **120 s** boot grace;
  - `/api/matchmake` returns 503 until the restore finishes.
- [X] T104 [US6] Implement `packages/client/src/ui/shiftBanner.ts` (a 5-minute warning toast, then a 30 s countdown chip using `endsAt` and the clock offset) and `packages/client/src/ui/summaryCard.ts` (the shift summary after the reset).
- [X] T105 [US6] Implement the auto-reconnect loop in `packages/client/src/net/connection.ts`: on close 4005, back off 1, 2, 4, 8 s, then every 5 s, then matchmake with `lastWorld`, without reloading the page. On resume, show "Welcome back!".

**Checkpoint**: persistence and shifts are complete (FR-045 to FR-049, FR-052).

---

## Phase 9: User Story 9 - Chat with nearby players and your crew (Priority: P2)

**Goal**: typed chat on the Nearby (20 m) and Crew channels, with the full moderation baseline from
constitution v1.1.0.

**Independent Test**: send nearby and crew messages between clients at different distances. Check
the blocked word, link, email, phone, spam, repeat, first-minute lock, mute, hide, hide-all, and
3-reporter pause behaviors.

### Tests for User Story 9

- [X] T106 [P] [US9] Unit tests in `packages/shared/test/chat.test.ts` (SC-013 corpus in `packages/shared/test/fixtures/chat-corpus.json`):
  - **`sanitize`**: strips control, zero-width and bidi characters, NFC, collapses whitespace, and rejects empty input or input over 80 characters;
  - **`detectContact`**: refuses 100 % of the corpus URLs (scheme, `www.`, `name.tld`, "dot com"), emails (including "at"/"(at)") and phone numbers (≥ 7 digits with separators, VN `+84`/`0` prefixes and international ones), with no false positives on a set of normal game phrases;
  - **`maskBlocked`**: masks 100 % of the corpus terms and their variants (case, Vietnamese diacritics present or removed, `đ→d`, the substitutions `0→o 1→i 3→e 4→a 5→s 7→t @→a $→s`, "f.u.c.k" spacing, repeated letters), keeps the surrounding text, and replaces the matched spans with `♥`.
- [X] T107 [P] [US9] Integration test `packages/server/test/chat.test.ts`:
  - **nearby**: delivered to players ≤ 20 m (including the sender's echo) and not at 40 m;
  - **crew**: delivered to all crew anywhere and to nobody else; `noCrew` without a crew;
  - **refusal order**: `locked` before 60 s, then `rate` (1 per 2 s, burst 3), then `duplicate` within 30 s, then `contact`;
  - **masking** is applied in the delivered text;
  - **removal**: a removed crew member stops sending to and receiving from the crew;
  - **reports**: a report writes a `chat_report` row with ≤ 5 unmasked messages and both key hashes, and a second report by the same reporter → `already`;
  - **pause**: 3 distinct reporters within 10 min → `chat_pause` + `chatPaused`, then `paused` refusals, while emotes still work; a new epoch lifts the pause;
  - **restart**: a pause survives a restart;
  - **retention**: reports older than 30 days are purged.
- [X] T108 [P] [US9] E2E `packages/client/e2e/mp-chat.spec.ts`: after `dev` skips the 60 s lock, A sends a nearby message and B (within 20 m) sees the bubble and log line. A link is refused with the hint text. With "Hide all chat" on, B sees nothing. While the chat box is open, the WASD keys do not move the worker.

### Implementation for User Story 9

- [X] T109 [US9] Implement `packages/shared/src/chat.ts`: `sanitize(text)`, `normalizeForMatch(text)` (lowercase, NFD with combining marks removed, `đ→d`, substitution map, separators between single letters removed, repeats collapsed, with an index map back to the original), `detectContact(text)` and `maskBlocked(text, compiledList)` (`♥` replacement). The list is compiled from lines, ignoring `#` comments.
- [X] T110 [US9] Seed `packages/server/data/chat-blocklist/en.txt` and `vi.txt` with starter lists of common profanity, slurs and sexual terms, one per line, without diacritics where the normalizer handles them. Implement `packages/server/src/systems/blocklist.ts`, which loads `HHT_BLOCKLIST_DIR` at boot and hot-reloads on file change (`fs.watch`, debounced).
- [X] T111 [US9] Implement `packages/server/src/systems/chat.ts`:
  - **`chat {channel, text}`** checks, in this order: `locked` (joined < 60 s ago, with `unlockAt`), `paused`, the `rate` bucket, `sanitize` (`tooLong`/`empty`), `detectContact` (`contact`), the `duplicate` normalized-text window of 30 s, and `noCrew`;
  - delivery with `maskBlocked`: **nearby** to players within 20 m of the server position (including the sender), **crew** to current crew members, as the `chat {from, channel, text, at}` event;
  - a per-session `recentChat` ring of 5 entries (sanitized, unmasked);
  - **`report {who}`**: not self, once per target per shift → a `chat_report` row with the ring JSON → `reportResult`;
  - **auto-pause**: 3 distinct reporters within 600 s → a `chat_pause` row for the current epoch + `chatPaused` to the target;
  - **retention**: purge reports older than 30 days at boot and every 24 h.
- [X] T112 [P] [US9] Implement `packages/server/scripts/reports.ts` (`pnpm reports [--since 7d] [--world 1]`): read `chat_report` from `HHT_DB` and print a table of time, world, reported name, short key hashes and messages.
- [X] T113 [US9] Implement `packages/client/src/ui/chatBox.ts`:
  - Enter or the "Aa" button opens `<input maxlength="80" enterkeyhint="send" autocomplete="off">` with a Nearby/Crew toggle (Tab) and a character counter;
  - refusal hints by reason ("Links and contact info aren't allowed", "Slow down", "Chat unlocks in m:ss", "Chat paused for this shift");
  - **suspend all gameplay actions while open** (`input/actions.ts`), and the worker stops;
  - on phones, `visualViewport` resize keeps the box above the keyboard.
- [X] T114 [P] [US9] Implement `packages/client/src/ui/chatLog.ts` (bottom-left, Nearby and Crew tabs, the last **50** lines in session memory, crew lines marked with the flag, fading when idle) and `packages/client/src/ui/chatBubbles.ts` (a pool of **at most 12** DOM bubbles for the nearest speakers, projected above heads, shown for 5 s). Filter muted and hidden players, and everything when `profile.hideAllChat` is on. Add "Hide all chat" to the menu.
- [X] T115 [US9] Add "Report chat" to `packages/client/src/ui/playerCard.ts` with a confirm step and an `reportResult` toast, and add `chatLog()` to the debug API in `packages/client/src/debug/debugApi.ts`.

**Checkpoint**: chat ships together with its moderation baseline.

---

## Phase 10: User Story 7 - Proof it scales: 100-bot load test (Priority: P2)

**Goal**: one command proves the server, bandwidth, memory and consistency budgets with 100 bots,
and the crowd perf scene proves the client budgets.

**Independent Test**: run `pnpm loadtest` and get a passing report. Inject an artificial 30 ms
busy-wait into the tick and confirm it fails, naming `tickMs.p99`.

- [X] T116 [US7] Implement `packages/server/loadtest/bot.ts`. A bot uses `@colyseus/sdk` and the shared kinematics and protocol, and acts like a real player:
  - wander and run;
  - about 10 % talk to the Foreman and host, approving or denying requests;
  - ask to join crews;
  - fetch, toss and deliver the needed pieces;
  - donate to bins;
  - emote;
  - chat at 1 message per 20–40 s (nearby and crew).

  It counts wire bytes in and out per second, and RTT.
- [X] T117 [US7] Implement `packages/server/loadtest/run.ts` and `report.ts`:
  - **options**: `--url` (default: an in-process server with `HHT_METRICS=1`, `:memory:` db, real SQLite file optional), `--bots 100` spread across 4 `worker_threads`, `--duration 300`, `--soak 1800`;
  - **sampling**: `/api/metrics` every second;
  - **consistency checks at the end**: duplicate pieces, double-filled slots, non-crew snaps, divergent views (compare a sample of bot schema views with the server), chat outside its channel;
  - **output**: `reports/loadtest/<ts>.json` per `contracts/loadtest-report.schema.json`, asserting against `tools/assets/budgets.json → net`, with a non-zero exit on failure and a readable summary table.
- [X] T118 [US7] Add a `--inject-tick-ms <n>` dev flag in `packages/server/src/rooms/WorldRoom.ts`, used only by `pnpm loadtest --selftest` to verify that a failing budget is detected.
- [X] T119 [P] [US7] Implement the `?perf=crowd` scene in `packages/client/src/debug/perfScene.ts`:
  - 100 synthetic workers fed through the real `net/interpolation.ts` and `crowd/` renderers, with mixed carries, emotes and nameplates;
  - 12 towers at mixed stages including 4 Masterpieces via `towerLod.ts`;
  - 1 looping celebration;
  - camera at the plaza hero angle;
  - no server needed.
- [X] T120 [US7] Extend `packages/client/e2e/perf.spec.ts` with `@perf` crowd tests on the high and low tiers, asserting `render.crowd` budgets (≤ 300 / ≤ 200 draw calls, ≤ 600 k / ≤ 300 k triangles) and recording the median frame ms.
- [X] T121 [US7] Run `pnpm loadtest` (full, 300 s) and fix any budget breach until it passes. Typical suspects:
  - allocations in snapshot encoding (pooled buffers);
  - schema churn;
  - SQLite in hot paths.

**Checkpoint**: the constitution's multiplayer milestone gate (100-bot load test) is automated.

---

## Phase 11: User Story 8 - Solo mode still works (Priority: P3)

**Goal**: the solo fallback when the server is unreachable, a "Join others" button when it comes
back, and `?solo=1` that never connects.

**Independent Test**: with the server stopped, solo starts within 6 s with the banner. Starting the
server shows "Join others". `?solo=1` makes no network requests.

- [X] T122 [US8] Implement the fallback in `packages/client/src/main.ts`: a matchmake failure (`unreachable`, or the 6 s timeout) → boot the solo `Game` with the "Playing solo" banner (`ui/connectionChip.ts`) → poll `GET /api/health` every 10 s with a 2 s timeout → show "Join others", which reloads the page without `solo`.
- [X] T123 [P] [US8] E2E `packages/client/e2e/solo-fallback.spec.ts`: route `/api/**` to abort → solo starts within 6 s and the banner is visible; unroute → "Join others" appears within 12 s. With `?solo=1`, assert that no request to `/api` or `/ws` is made (Playwright request log).

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: the docs, the phase gate, and the checks across all stories.

- [X] T124 [P] Update `CLAUDE.md`:
  - **Stack**: the server becomes Colyseus on Node 24 with no build step.
  - **Commands**: add `pnpm loadtest` and `pnpm reports`.
  - **Debug URLs**: add `?solo=1`, `?w=<n>` and `?perf=crowd`.
  - **Rules of thumb**: shared kinematics are the only movement code in multiplayer, and the server is authoritative.
- [X] T125 [P] Update `packages/server/README.md` with the environment variables, the HTTP endpoints, how to run tests and the load test, how to review reports, and the next steps for production hosting (out of scope).
- [ ] T126 Run `pnpm verify` (including the quick load test) and the WebKit e2e (`pnpm --filter @hht/client e2e:webkit` after `sudo npx playwright install-deps`). Fix any failures.
- [ ] T127 Run the 30-minute soak (`pnpm loadtest --soak 1800`) and the full 5-minute run, and link both reports.
- [ ] T128 Create `specs/002-multiplayer-core/gate.md` from the quickstart's "Phase validation gate". Record the automated results, the load-test and soak numbers, restore within 15 s, and which items are pending on real devices, the playtest and the owner's art review (Foreman and site renders).

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → user stories.
- **US1 (Phase 3)** is the MVP and is required by every other multiplayer story, which all need
  presence, movement and NetGame.
- **US2** depends on US1.
- **US3** depends on US2 (buildings and the crew base).
- **US4** depends on US3 (crews).
- **US5**:
  - depends on US2 for bins and pieces;
  - its player card and people list (T096) need US1 only;
  - its Host buttons in the player card need US3.
- **US6** depends on US2 and US3 (it restores buildings and crews). It can start after US3, in
  parallel with US4 and US5.
- **US9** depends on US1. Its crew channel needs US3, and its Report button needs US5's player card
  (T096). Most of it (T106, T109–T112) can start right after Foundational.
- **US7**:
  - the load-test harness (T116–T118) can start after US2;
  - the final passing run (T121) needs all server features (US2–US6, US9);
  - the crowd perf scene (T119–T120) needs only US1 and T072.
- **US8** depends only on Foundational (T037). It can be done at any time after Phase 2.
- **Polish** comes after all the desired stories.

### Within each story

Write the tests first (they should fail), then shared rules → server systems → persistence →
client UI.

## Parallel Opportunities

- **Phase 2**:
  - T008–T012 are separate shared files and can run in parallel; T013 and T014 are larger but
    independent;
  - the tests T015–T017 can run in parallel;
  - T022 and T024 can run in parallel; T033, T034, T038 and T040 can run in parallel;
  - the site builder (T019–T021) can proceed alongside the server core.
- **US1**: the tests T041–T046 can run in parallel; T051, T052 and T054 (client) can run in
  parallel with T047–T050 (server).
- **US2**: the art (T069, T070, T071) can run in parallel with the server work (T065–T068) and the
  shared rules (T062–T064).
- **US5**: T089–T091 and T094–T095 can run in parallel.
- **US9**: the shared chat rules and corpus (T106, T109) and the server chat (T111) can start right
  after Phase 2, in parallel with US2–US5.
- **US7**: the crowd perf scene (T119) can run in parallel with the load-test harness (T116–T118).

### Parallel example: User Story 1

```text
# Tests together (T041–T046):
packages/server/test/join.test.ts, movement.test.ts, snapshots.test.ts, reconnect.test.ts
packages/client/test/interpolation.test.ts, prediction.test.ts, e2e/mp-presence.spec.ts

# Then server and client in parallel:
Server: T047 movement → T048 snapshots → T049 lifecycle → T050 overflow
Client: T051 snapshot+interpolation | T052 prediction | T054 billboards → T053 crowd → T055 NetGame
```

### Parallel example: User Story 2

```text
Art:     T069 foreman.py | T070 clock_tower LODs | T071 props_mp.py
Shared:  T062 toss.ts | T063 plots.ts | T064 crew base
Server:  T065 pieces → T066 buildings → T067 foreman → T068 repo
Client:  T072 towerLod | T073 plotView+foremanView → T074 NetGame pieces → T075 foremanDialog
```

## Implementation Strategy

### MVP first (User Story 1)

1. Phases 1–2: the Node 24 move, shared protocol and kinematics, the site, the server skeleton and
   client routing.
2. Phase 3 (US1). **Stop and validate**: two devices share the world with smooth movement, and the
   owner reviews the site layout render.

### Incremental delivery

1. Add US2: a playable "Host builds a tower" in the shared world. This needs the owner's review of
   the Foreman render.
2. Add US3, which completes the P1 crew loop. **Playtest with 3–5 people.**
3. Add US4, US5, US6 and US9 (in parallel if staffed), each validated with its independent test.
4. US7: get the full load test and crowd perf passing (the milestone gate).
5. US8 (solo fallback), polish, and the gate record.

### Notes

- Never let `pnpm verify` stay red. The 001 solo e2e suite runs under `?solo=1` from T039 onward.
- The art tasks (T019, T069, T070, T071) need an owner review render before integration
  (constitution IV).
- Keep every new rule pure in `packages/shared`. The server room only orchestrates.
