# Implementation Plan: Multiplayer World with Host Crews

**Branch**: `002-multiplayer-core` | **Date**: 2026-11-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-multiplayer-core/spec.md`

## Summary

Turn the single-player prototype into one shared world of up to 100 players.

- **Joining**: players join from the link with no login and walk around a bigger site (a plaza and
  12 plots).
- **Hosts and crews**: a player talks to the Foreman to start a Clock Tower and becomes its Host.
  Others ask to join the crew; the Host's join mode is Open, Ask or Solo.
- **Building**: crews build their towers through six stages. Outsiders help through supply bins.
- **Persistence**: buildings survive Hosts leaving and server restarts, and reset on hourly shifts.
- **Chat**: typed chat for nearby players (20 m) and the player's crew, with the moderation baseline
  from constitution v1.1.0 (server filter, limits, mute/hide, reports, automatic pause).
- **Solo**: the 001 game stays available as a fallback and with `?solo=1`.

Technical approach:

- **Server**: one authoritative Colyseus 0.18 room per world, on Node 24 with native TypeScript type
  stripping.
- **Movement**: **true input authority**. A pure, deterministic `stepWorker()` in `shared` runs at
  60 Hz on both the client (prediction plus replay) and the server (authority). As a result, the
  multiplayer client needs no Rapier.
- **Pieces**: no physics. Tosses are analytic arcs.
- **Two network channels**:
  - Colyseus schema patches for low-frequency state (players, plots, buildings, crews, bins,
    pieces, shift);
  - per-client binary snapshots of 10-byte worker records, with distance tiers (20/10/4 Hz) and
    per-tier interpolation delays.
- **Persistence**: synchronous, transactional SQLite (`node:sqlite`) writes with shift epochs.
- **Client**: instanced crowd rendering (12 draw calls for 100 workers), and merged tower LODs.
- **Chat moderation**: pure functions in `shared/chat.ts` (sanitize, contact detection, blocklist
  masking with Vietnamese and English normalization). The blocklist files live on the server, and
  reports and pauses are stored in SQLite (R16).
- **Load test**: a 100-bot load test with budget assertions gates the milestone.

Details are in [research.md](./research.md) (R1–R16).

## Technical Context

**Language/Version**: TypeScript 7.0.2 `strict` everywhere. The server uses `erasableSyntaxOnly`
and runs directly on **Node.js 24 LTS** (24.15.0 installed; root `engines` `>=24.11`). Python 3 in
Blender 5.2 is used for the new asset builders.

**Primary Dependencies**:

- **New**:
  - server: `colyseus` 0.18.10, `@colyseus/ws-transport` 0.18.4, `@colyseus/schema` 5.0.43;
  - client: `@colyseus/sdk` 0.18.9;
  - tests: `@colyseus/testing` 0.18.6.
- **Kept**: three 0.187, Vite 8, Vitest 5, Playwright 1.64 and gltf-transform 4.5 from 001.
  Rapier 0.21 becomes solo-only, loaded with a dynamic import.

**Storage**:

- **Server**: SQLite through built-in `node:sqlite` (WAL), at `data/hht.sqlite`. Schema:
  [contracts/persistence.sql](./contracts/persistence.sql).
- **Client**: `localStorage` `hht.profile.v2`, which adds `playerKey` and `lastWorld` to the 001
  profile.

**Testing**:

- Vitest for the shared rules and client net logic;
- Vitest + `@colyseus/testing` for server room integration;
- Playwright for multiplayer and solo e2e (the config starts server + client);
- `pnpm perf` with the new `?perf=crowd` scene;
- `pnpm loadtest` with 100 bots (a quick version runs in verify; the full run and the soak are gate
  items).

**Target Platform**: Clients run in current Chrome, Firefox and Safari on desktop, Chrome on
Android and Safari on iOS 16+, with WebGL 2. The server runs on Linux with Node 24; only local and
dev use are in scope.

**Project Type**: Web application. It consists of a static client game, an authoritative realtime
game server, the shared rules package and the build-time asset pipeline.

**Performance Goals**:

- **Server, with 100 players**: 20 ticks per second; tick time average ≤ 10 ms and p99 ≤ 25 ms;
  ≤ 256 MB per world.
- **Network**: ≤ 30 KB/s per client on the wire.
- **Client, with 100 workers and 12 towers in view**: 60 fps on desktop and ≥ 30 fps on a mid-range
  phone.
- **Crowd scene budgets**: ≤ 300 draw calls on the high tier and ≤ 200 on the low tier; ≤ 600 k
  and ≤ 300 k triangles.

**Constraints**:

- **Payload**: the critical payload stays ≤ 5 MB. The multiplayer estimate is about 1.8 MB,
  because Rapier is not loaded.
- **Time to play**: ≤ 4 s on 4G, including matchmaking.
- **Fallback**: solo starts after 6 s if no world can be reached.
- **Player experience**: no login. Names are generated, and chat is the only free text (80
  characters, filtered). Building is additive-only.
- **Server data**: the server stores only hashed device keys, plus chat reports for 30 days.

**Scale/Scope**:

| Item | Amount |
|---|---|
| Players per world | 100 (overflow worlds on demand) |
| Plots | 12 |
| Crew size | ≤ 8 |
| Loose pieces | ≤ 150 |
| Blueprint | 1 |
| New assets | about 4 (site, foreman, props-mp, tower LODs) |
| New HUD panels | about 8 |
| Client→server message types | 14 |
| Server events | 20 typed + the binary snapshot |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this plan complies | Status |
|---|---|---|
| I. Instant Play | No login. The guest identity and device key are generated locally. The multiplayer critical payload is about 1.8 MB, ≤ 5 MB (no Rapier). Matchmaking is 1 HTTP request plus a WebSocket. A 6 s solo fallback keeps "click and play" during outages. Chrome, Firefox and Safari plus iOS and Android are in e2e and the device gate | ✅ |
| II. Server Authority | One room per world of ≤ 100 players. Clients send only inputs (`MoveInput`) and intents (grab, drop, toss, foreman, crew). The server simulates movement with the same deterministic kinematics and decides every placement, permission and tower state. Clients predict their own worker with replay and interpolate others with smoothed corrections. Interest tiers keep traffic ≤ 30 KB/s. Buildings belong to the world, with Host handover and adoption | ✅ |
| III. Performance Budgets | New numeric budgets: `render.crowd`, per-asset budgets for the new assets, and the `net` load-test budgets. All are enforced by `pnpm perf`, `check:budgets` and `pnpm loadtest`. Rapier is used only in solo. Multiplayer pieces use analytic arcs, and snapped pieces are static | ✅ |
| IV. Art Fidelity & Original IP | New site, Foreman, props and tower LODs come from scripted Blender builders through gltf-transform. The toon material and outlines are reused; instanced outlines are culled by distance. The owner reviews the Foreman and site renders | ✅ |
| V. Simple & Kind Sandbox (v1.1.0) | Controls stay move + action + toss (+ jump); talk and chat are menu UI. There are no forced goals. Building is additive-only, and only crews snap. The plaza is a safe zone, rate limits and strikes apply, Host approval is Open/Ask/Solo, and mute/hide are local. Chat ships with the full moderation baseline: server filter (masking plus refusal of links, emails and phones), 80-character limit, rate and duplicate limits, a 60 s unlock, nearby and crew channels only, mute/hide and hide-all, reports stored for owner review, and an automatic pause after 3 distinct reporters. Names stay generated | ✅ |
| VI. Test & Measure | Shared types, validators and codecs live in one package. Every new rule has unit tests. The server room has integration tests. The headless 100-bot load test asserts tick, bandwidth, memory and consistency. The phase gate is in quickstart → gate.md | ✅ |
| VII. Simplicity | It uses only constitution tech: Colyseus, SQLite (built-in, no native dependency) and the three.js client. There is no new framework. The server needs no build step. Overflow worlds are the only "scaling" mechanism | ✅ |

**Result**: PASS. See Complexity Tracking for two deliberate deviations from the "obvious" path.
Neither violates a principle.

**Post-design re-check (after Phase 1)**: PASS.

- **Contracts**: all client messages are inputs or intents, with validators in shared
  ([network-protocol.md](./contracts/network-protocol.md)).
- **Data model**: the rules are pure functions in shared ([data-model.md](./data-model.md)).
- **Budgets**: the new budgets are numeric and automated.
- **Simplicity**: the `/api/metrics` and dev-cheat endpoints exist only behind environment flags,
  and are not shipped in the client critical path.

## Project Structure

### Documentation (this feature)

```text
specs/002-multiplayer-core/
├── plan.md              # This file
├── research.md          # Phase 0 decisions R1–R15 (codex + agy reviewed)
├── data-model.md        # Entities, rules, state machines
├── quickstart.md        # Run/verify guide + phase gate
├── contracts/
│   ├── network-protocol.md
│   ├── http-api.md
│   ├── persistence.sql
│   ├── controls.md
│   ├── debug-api.md
│   └── loadtest-report.schema.json
├── checklists/requirements.md
└── tasks.md             # Created by /speckit-tasks
```

### Source Code (repository root)

```text
package.json                 # engines >=24.11; dev runs server+client; new: loadtest
.nvmrc                       # 24
tools/assets/budgets.json    # + perAsset (site, foreman, props-mp, lod1-*), render.crowd, net

packages/
├── shared/src/
│   ├── (001) pieces, blueprints, progression, guestName, constants
│   ├── site.gen.ts          # GENERATED by tools/blender/builders/site.py
│   ├── kinematics.ts        # stepWorker(): deterministic 60 Hz controller (client + server)
│   ├── toss.ts              # tossArc(), ground hit, swept zone test
│   ├── plots.ts             # plot/building state machine, assignment, retirement
│   ├── crew.ts              # join modes, requests, capacity, handover, permissions
│   ├── bin.ts               # supply bin rules
│   ├── shift.ts             # shift phases
│   ├── rateLimit.ts         # token buckets + strikes
│   ├── names.ts             # uniqueName()
│   ├── interest.ts          # distance tiers with hysteresis
│   ├── social.ts            # EmoteId, QuickMessageId
│   ├── chat.ts              # sanitize(), detectContact(), maskBlocked(), normalization (vi/en)
│   └── protocol.ts          # PROTOCOL_VERSION, message ids/types, validators, binary codecs
├── shared/test/             # unit tests for all of the above
├── server/
│   ├── package.json         # start: node src/index.ts; dev: node --watch; test: vitest
│   ├── src/
│   │   ├── index.ts         # boot: config → db → restore → Colyseus + HTTP routes
│   │   ├── config.ts        # HHT_* env
│   │   ├── http/            # matchmake.ts, health.ts, metrics.ts
│   │   ├── rooms/
│   │   │   ├── WorldRoom.ts # lifecycle, onAuth, message routing, tick
│   │   │   └── schema.ts    # WorldState via schema()
│   │   ├── systems/         # movement.ts, pieces.ts, buildings.ts, crews.ts, foreman.ts,
│   │   │                    # shift.ts, social.ts, chat.ts (channels, reports, pauses), snapshots.ts, limits.ts
│   │   ├── persistence/     # db.ts (node:sqlite, migrations), repo.ts (transactional writes, restore)
│   │   └── metrics.ts       # tick/encode/sqlite/event-loop/GC/bytes ring buffers
│   ├── data/chat-blocklist/ # en.txt, vi.txt (editable, hot-reloaded, never shipped to the client)
│   ├── scripts/reports.ts   # `pnpm reports`: owner review of chat reports
│   ├── test/                # integration tests (@colyseus/testing)
│   └── loadtest/            # run.ts, bot.ts (behaviors), report.ts
└── client/src/
    ├── main.ts              # ?solo=1 → Game (001); else matchmake → NetGame | solo fallback
    ├── game/
    │   ├── Game.ts          # 001 solo game (Rapier via dynamic import)
    │   ├── GameShell.ts     # frame loop, camera, input, HUD wiring shared by both modes
    │   └── NetGame.ts       # multiplayer game: prediction, remote views, intents, events
    ├── net/                 # connection.ts, matchmake.ts, snapshot.ts, interpolation.ts,
    │                        # prediction.ts (replay), clock.ts, events.ts
    ├── crowd/               # CrowdRenderer (instanced parts + hulls), billboards (names/flags/emotes)
    ├── world/               # + site.ts (site.glb + site.gen), plotView.ts (sign, flag, bin), towerLod.ts, foremanView.ts
    ├── ui/                  # + foremanDialog, requestCards, talkWheel, playerCard, peopleList,
    │                        #   shiftBanner, summaryCard, connectionChip, invite, chatBox, chatLog, chatBubbles
    ├── profile/             # guestProfile v2 (playerKey, lastWorld, v1 migration)
    └── debug/               # + net API, perf=crowd scene
    └── e2e/                 # + multiplayer specs; 001 specs run under ?solo=1

tools/blender/builders/      # + site.py, foreman.py, props_mp.py; clock_tower.py adds LOD0-merged + LOD1
```

**Structure Decision**: this keeps the constitution's three-package pnpm monorepo.

- **`packages/server`** goes from placeholder to the Colyseus server.
- **`packages/shared`** gains all new rules, kinematics and the wire protocol, so client, server
  and load-test bots share one definition.
- **The client** adds `net/`, `crowd/` and multiplayer UI, keeping the 001 solo `Game` intact
  behind `?solo=1` and the fallback.

## Complexity Tracking

> These are not constitution violations. They record two design choices that are more involved
> than the most obvious option, and why.

| Choice | Why needed | Simpler alternative rejected because |
|---|---|---|
| Custom shared kinematic controller replaces Rapier's character controller in multiplayer (Rapier remains for solo) | Literal input authority (Principle II) and deterministic prediction + replay. It also removes about 1.6 MB of WASM from the multiplayer critical path | **Client-reported pose + server validation**: both reviewers showed it allows speed hacks within the tolerance, air-walking and tunnelling. **Rapier on the server**: 4–8 ms per tick, and determinism across builds is not guaranteed |
| Chat moderation implemented in-house (pure filter functions + SQLite reports) | The constitution v1.1.0 baseline requires a filter, limits, reports and an automatic pause before chat may ship | **A third-party moderation API**: external dependency, cost and privacy exposure, not in the stack. **No chat**: the owner requested chat |
| Two sync channels (Colyseus schema + custom binary snapshots) | Worker transforms at 100 players need per-receiver distance tiers and ≤ 10 B/entity to fit 30 KB/s. This matches the constitution's "binary/compact encoding for high-frequency transforms" | **Positions in the schema**: about 40 KB/s, and no per-receiver rates. **StateView filtering for everything**: more complex, and still lacks per-tier rates |
