# Research: Multiplayer World with Host Crews

**Feature**: 002-multiplayer-core | **Date**: 2026-11-04

Each item records a decision, the reason and the alternatives considered. Every "NEEDS
CLARIFICATION" item from the Technical Context is resolved here.

The drafts of R2, R4, R5 and R7 were reviewed in parallel by codex-cli and agy (Antigravity), as the
owner prefers for design questions. Their critiques changed several decisions; each change is noted
inline.

## R1. Package versions and runtime

- **Decision**:
  - **Node.js**: 24 LTS (installed through nvm: 24.15.0).
    - Root `engines` becomes `>=24.11`, and an `.nvmrc` file containing `24` is added.
    - The server runs TypeScript directly with Node's built-in type stripping. Server code
      therefore uses `erasableSyntaxOnly`: no enums, no parameter properties, no decorators.
  - **New server dependencies**: `colyseus` 0.18.10 (`@colyseus/core` 0.18.x,
    `@colyseus/ws-transport` 0.18.4) and `@colyseus/schema` 5.0.43.
  - **New client dependency**: `@colyseus/sdk` 0.18.9.
  - **Test dependency**: `@colyseus/testing` 0.18.6.
  - **SQLite**: Node's built-in `node:sqlite` (`DatabaseSync`).
  - **Versions** are checked with `npm view` on 2026-11-04. Each one was published at least a week
    earlier, and all are pinned exactly.
- **Rationale**:
  - **Node version**: Colyseus 0.18 requires Node ≥ 22, and Node 20 reached end of life in April
    2026. Node 24 is the current LTS and satisfies the constitution's "Node 20 LTS or newer".
  - **Type stripping**: this avoids a build step (tsx or esbuild) for the server. The shared
    package already exports `.ts` sources with explicit `.ts` import extensions. pnpm resolves
    workspace symlinks to their real path, so the files are outside `node_modules`, where Node allows
    type stripping.
  - **`node:sqlite`**: it removes a native dependency, in line with Principle VII.
- **Alternatives**:
  - Colyseus 0.16 on Node 20: Node 20 is end of life, and 0.16 lacks the 0.18 schema builder.
  - `better-sqlite3` 13: a native build, also requires Node ≥ 22. It is kept as the fallback if
    `node:sqlite` misbehaves.
  - `tsx` or an esbuild bundle for the server: an extra tool; it is the fallback if type stripping
    hits a blocker.

## R2. Movement authority: shared deterministic kinematics, input-driven

- **Decision**:
  - **One simulation in shared code**: movement is a pure, deterministic `stepWorker()` in
    `packages/shared/src/kinematics.ts`. Both sides run it at a fixed 60 Hz.
  - **Client**: it predicts its own worker with `stepWorker()`. Every 50 ms it sends the batch of
    `MoveInput`s since the last send (seq, quantized world direction, run, jump).
  - **Server**: it runs the same function on each received input.
    - Inputs are rate-limited to the real-time budget (60/s plus a burst of 12), so a client cannot
      move faster by sending more inputs.
    - Each snapshot acknowledges the last processed seq and carries the authoritative state of the
      player's own worker.
  - **Reconciliation**: when the server state differs from the client's stored prediction for that
    seq by more than 2 cm, the client resets to the server state and replays the inputs not yet
    acknowledged. Only the rendered offset is blended out over 150 ms.
  - **Collision**:
    - The worker is a 0.32 m circle tested against site obstacles, each with a height.
    - Autostep is 0.35 m. The worker can stand on top of an obstacle if its feet are above it.
    - Tower footprints block movement once stage ≥ 1. The play area is clamped to a circle.
    - Workers never collide with each other.
  - **Feel**: acceleration, coyote time, jump buffer, gravity and jump apex are ported from the 001
    Rapier controller, with a side-by-side feel test.
- **Rationale**:
  - **Constitution**: this is the only option that literally meets Principle II. Clients send only
    inputs, and the server simulates and decides.
  - **Cost**: about 6,000 cheap 2D steps per second for 100 players, well under 1 ms per tick.
  - **Determinism**: both sides run the same JS code with the same doubles, using only
    + − × ÷ √ in the step and a lookup table for facing. The two sides agree bit for bit, so
    corrections only happen after real divergence.
  - **No Rapier in multiplayer**: the multiplayer client no longer needs Rapier, so its about
    1.6 MB gzip of WASM drops from the multiplayer critical payload. That helps SC-001.
- **Review impact**: the first draft trusted a client-reported pose and validated it with a speed
  tolerance (+25%) and endpoint checks. Both reviewers showed problems with that draft:
  - the tolerance allows a permanent 6.9 m/s speed hack;
  - client-reported "grounded" allows air-walking;
  - endpoint checks allow tunnelling.

  Codex recommended a shared kinematic controller instead, and this decision adopts it.
- **Alternatives**:
  - **Validated client pose**: rejected for the reasons above.
  - **Rapier on the server with replay**: 4–8 ms per tick for 100 controllers (agy's estimate). Its
    determinism across the browser and Node WASM builds is also not guaranteed.
  - **A 20 Hz client simulation**: adds 50 ms of input latency.

## R3. Rooms, worlds and matchmaking

- **Decision**:
  - **Rooms**: one Colyseus room type, `world`, with `maxClients = 100`. Each room has a stable
    `worldId` (1, 2, …) that persists across restarts.
  - **Endpoint**: a small HTTP route, `POST /api/matchmake {world?, playerKey}`, picks the room:
    1. the requested world if it has room;
    2. otherwise the room with the lowest `worldId` that has room;
    3. otherwise it creates a room with the next `worldId`.
  - **Joining**: the route returns a Colyseus seat reservation, which the client consumes.
  - **Startup**: world 1 is created at boot and restored from SQLite. Worlds above 1 are created on
    demand and disposed after 5 minutes empty, with their state deleted.
  - **Rejection**: protocol version mismatch → HTTP 426 / close 4001; world full during a race → retry.
- **Rationale**: this gives exactly FR-003 ("oldest world with room") and FR-004 (invite links),
  which `joinOrCreate` plus `filterBy` cannot express. Seat reservations are Colyseus's documented
  extension point.
- **Alternatives**: `joinOrCreate` (no world ordering, no invite semantics); a separate lobby room
  (more moving parts).

## R4. Network encoding and interest management

- **Decision**:
  - **Two channels**:
    - **Colyseus schema** (built with `schema()`, no decorators): low-frequency state such as
      players' name, color, crew and held type, plots and buildings, loose and flying pieces,
      bins and the shift. `patchRate` is 100 ms.
    - **A custom binary snapshot** (`sendBytes`), sent per client every tick (20 Hz).
  - **Snapshot contents**:
    - a header: protocol, server tick, server time, the acknowledged input seq, and the
      authoritative own-worker state;
    - a list of 10-byte entity records: u16 `netId`, i16 x/y/z at 1 cm, u8 yaw, u8 anim (3 bits)
      plus carried piece type (3 bits) plus emote flag.
  - **netId**: increases monotonically per world and is never reused within a shift, so a reused id
    can never animate the wrong worker. This answers codex's concern about index generations.
  - **Interest tiers**: by distance to the receiver, with 2 m hysteresis:

    | Distance | Update rate |
    |---|---|
    | ≤ 15 m | 20 Hz |
    | ≤ 35 m | 10 Hz |
    | beyond | 4 Hz |

  - **Interpolation**: each remote worker is drawn behind real time by a delay that depends on its
    tier: 100 / 180 / 320 ms. Extrapolation is bounded to 200 ms, then the worker holds still.
  - **Buffers**: snapshot buffers are preallocated per connection and reused, to avoid GC pressure
    (agy).
  - **Events**: discrete events (snap, stage, celebration, hint, request card, emote, summary) are
    small typed messages.
  - **Relevance**: emotes are relayed only within 35 m. Building events go to everyone, since
    towers are visible from afar.
- **Budget check**: the bandwidth budget is 30,000 bytes per second, measured on the wire,
  including framing and schema patches.

  | Case | Remote workers per tier (≤ 15 / ≤ 35 / beyond) | Bytes per second |
  |---|---|---|
  | Worst case | 99 / 0 / 0 | 99 × 20 × 10 ≈ 19.8 k, plus about 1 k of headers and framing |
  | Typical | 10 / 25 / 64 | about 7 k |

- **Review impact**: both reviewers flagged that a fixed 100 ms buffer starves on the 4 Hz tier.
  This led to the per-tier delays and the hysteresis. Codex asked for tick, ack and generation
  fields, which led to the snapshot header and monotonic netId. Agy asked for the carried type in
  the snapshot, so a piece never pops between hands across channels.
- **Alternatives**:
  - **Positions in the schema**: about 40 KB/s at 100 players, with no per-tier rates.
  - **StateView filtering**: adds complexity, and the low-frequency state is small enough to send
    to everyone.
  - **WebRTC/UDP**: not in the constitution, and WebSocket over TCP is enough for 20 Hz.

## R5. Pieces without server physics

- **Decision**:
  - **Tosses**: a toss is an analytic ballistic arc computed by shared `tossArc(origin, facing,
    mass)`. The server takes the origin from its own worker state and clamps the speed. Each
    arc's ground hit point and time are found in closed form, and the swept path is tested against
    build zones and bins.
  - **In flight**: a flying piece is part of the schema (`arc` field), so late joiners see it, and it
    cannot be grabbed until it lands.
  - **At rest**: loose pieces never move.
  - **Plaza**: a landing in the plaza fades at once.
  - **Multiplayer client**: it only replays arcs and runs no piece physics.
  - **Solo mode**: keeps the 001 Rapier behaviour unchanged.
  - **Limits**: the loose-piece cap is raised from 30 to 150 for multiplayer only, with the 60 s fade
    kept. A new constant, `LOOSE_MP`, leaves the solo value at 30.
- **Rationale**: the ground is flat, so the arc is exact and identical on every client. No server
  physics engine is needed (Principle III). Contention ("first message wins") falls out of
  Colyseus processing messages one at a time.
- **Alternatives**: Rapier on the server for pieces (cost, a WASM dependency on the server, and
  nondeterminism across clients); client-authoritative tosses (abusable).

## R6. Persistence (SQLite)

- **Decision**:
  - **Database**: `node:sqlite` with WAL and `synchronous=NORMAL`, file `data/hht.sqlite` (set with
    `HHT_DB`).
  - **Tables**: `world`, `building`, `crew_member`, `bin_entry`, `meta(schema_version)` (see
    `contracts/persistence.sql`).
  - **Writes**: every building, crew or bin mutation runs a synchronous transaction in the same
    tick, about 50 µs each. Mutations are low-rate (tens per second at most).
  - **Shift epochs**: rows carry the shift `epoch`. Stale rows are ignored and purged at boot. If
    the server boots after `endsAt`, it resets the shift immediately.
  - **Player data**: only the SHA-256 `keyHash` is stored, never the raw key. All crew rows are
    deleted at each shift reset.
- **Rationale**: it meets FR-045/046 and the "atomic transitions, shift epochs" risk raised by
  codex. Synchronous writes in the same tick mean a piece consumed by `deliver()` and the slot it
  fills are committed together.
- **Alternatives**: periodic snapshots (can lose recent work in a crash); `better-sqlite3`
  (fallback, R1); JSON files (not atomic).

## R7. Client rendering: crowd, towers and payload

- **Decision**:
  - **Remote workers** are drawn by a `CrowdRenderer`:
    - one `InstancedMesh` per rigid part (Body, Hat, Arm_L/R, Leg_L/R), with the pivots preserved;
    - hat color set per instance with `setColorAt`;
    - the procedural animation from `WorkerView` ported to per-instance matrices;
    - outline hulls instanced too, and actually culled beyond the outline distance, not just faded
      (codex).
  - **Carried pieces**: one `InstancedMesh` per piece type.
  - **Nameplates, crew flags, emote icons and speech bubbles**: one billboard batch with a canvas
    atlas. The messages are preset, so their atlas is static. Names are drawn into the atlas when a
    player joins. Each element is culled beyond 25 m.
  - **Towers** have two LODs, both produced by the Blender pipeline:
    - **LOD0**: each stage merged by material into ≤ 15 draw calls including outlines;
    - **LOD1**: a single merged mesh with baked vertex colors, 1 draw call.
  - **LOD switching**: LOD0 is used within 30 m, at most 2 towers at a time (the 2 nearest).
  - **Sharing**: stage geometry and materials are shared across the 12 plots, because the plots
    clone the same assets.
  - **Shadows**: cast only by objects within 25 m.
  - **Mobile low tier**: DPR ≤ 1.5, bloom off.
  - **Streaming order**:
    1. LOD1 of all six stages (about 30 KB each) is part of the critical payload.
    2. LOD0 of each stage streams after spawn, and only when a tower at that stage comes within
       range.
  - **New crowd perf scene**, `?perf=crowd`: 100 animated workers carrying mixed pieces, 12 towers
    at mixed stages including 4 Masterpieces, a celebration, nameplates and emotes. Its budgets:

    | Tier | Draw calls | Triangles |
    |---|---|---|
    | high | ≤ 300 | ≤ 600 k |
    | low | ≤ 200 | ≤ 300 k |

    The device gate is ≤ 33.3 ms/frame on a Pixel 6a-class phone and an iPhone 12.
  - **Multiplayer payload**: Rapier is loaded only by solo mode, through a dynamic import.
- **Draw-call estimate for the crowd scene**:

  | Item | Draw calls |
  |---|---|
  | workers (6 parts + 6 hulls) | 12 |
  | carried pieces | 7 |
  | billboards | 1–2 |
  | 2 near towers | ≤ 30 |
  | 10 far towers, instanced per stage | ≤ 6 |
  | site, racks and props | about 40 |
  | effects | about 15 |
  | shadow pass | roughly doubles the near casters |
  | **Total** | about 150 |

  The budget leaves headroom over this estimate.
- **Review impact**: both reviewers showed that a stage at full detail (about 220 draws) makes
  "LOD0 near" unsafe. That led to merging LOD0 to ≤ 15 draws and capping LOD0 at 2 towers. Agy's
  risk of asset spikes led to the LOD1-first streaming order.
- **Alternatives**: one `WorkerView` clone per remote worker (600+ draws); a skinned mesh with
  `BatchedMesh` (needs skinning that the rigid-part worker does not have); impostor sprites for far
  towers (look worse than toon geometry, and the art fidelity principle applies).

## R8. Client architecture: solo vs. multiplayer

- **Decision**:
  - **Entry flow** (`main.ts`):
    - `?solo=1` → the 001 `Game`, unchanged (Rapier imported dynamically).
    - Otherwise → `matchmake()` with a 6 s timeout:
      - success → `NetGame`;
      - failure → the solo `Game` plus a "Playing solo" banner, while a `/api/health` poll every 10 s
        shows "Join others" (which reloads the page without `solo`).
  - **Shared building blocks**: `NetGame` reuses the render, world, input, fx, audio and ui modules,
    and the 001 `WorkerView` for the player's own worker.
  - **New modules**:
    - `net/`: connection, matchmaking, snapshot decoding, interpolation, prediction and
      reconciliation, clock sync;
    - `crowd/`: the crowd renderer and billboards;
    - `ui/` additions: Foreman dialogue, request card, talk wheel, player card, shift banners,
      summary, people list;
    - `world/site.ts`: the multiplayer site, built from `site.gen.ts` and `site.glb`.
  - **Shrinking `Game.ts`**: the parts of the 573-line file both modes need are moved into
    `GameShell`: the frame loop, camera, input polling and HUD wiring. The move happens only as far
    as `NetGame` needs it, and the 001 e2e tests guard against regressions.
- **Rationale**: keeping solo intact satisfies US8 and FR-050/051 without risking 001. Sharing
  render and UI modules avoids a second look and feel.
- **Alternatives**: rewriting solo on top of a local "fake server" (elegant, but larger and riskier
  for this phase); a separate client app (duplicated assets and code).

## R9. Identity, reconnect and restart resume

- **Decision**:
  - **Device key**: the device holds a 128-bit `playerKey`, sent only in the matchmake and join
    options. The server keys sessions by `SHA-256(playerKey)`.
  - **Short network drops** use Colyseus `allowReconnection(client, 60)`, so the session survives.
  - **Page reloads, and joins after a server restart**: a join whose `keyHash` matches an `away`
    session, or a restored crew member, takes over that identity and crew role. The grace period is
    60 s, or 120 s after boot.
  - **Duplicates**: a second tab is a separate identity, because the session lock is per key. The
    second tab's join with the same key is accepted as a new worker with a name suffix, and its
    crew resume is disabled.
  - **Names**: `uniqueName()` adds " 2", " 3"… within the world.
  - **Version check**: `protocolVersion` (in shared `protocol.ts`) is checked at matchmake and at
    join.
- **Rationale**: one mechanism covers FR-005, FR-037 and FR-052. No personal data is involved
  (FR-002).
- **Alternatives**: only Colyseus reconnection tokens (they do not survive a reload or restart);
  accounts (forbidden).

## R10. Foreman, crews and plots: rule placement

- **Decision**:
  - **Pure rules in `shared`**, with unit tests:
    - `plots.ts`: the state machine, assignment and retirement;
    - `crew.ts`: join modes, requests, expiry and cooldown, capacity, handover order, permissions;
    - `bin.ts`: capacity and accepted types;
    - `shift.ts`: phases;
    - `rateLimit.ts`: token buckets;
    - `names.ts`;
    - `interest.ts`: tiers with hysteresis;
    - `toss.ts`;
    - `kinematics.ts`;
    - `protocol.ts`: message ids, payload validators, binary codecs.
  - **The server room** only orchestrates: it calls the rules, mutates the schema, persists, and
    sends events.
  - **Flags**: the crew flag equals the plot index (12 fixed color/symbol pairs), so there is no
    allocation logic.
  - **Plot choice**: the Foreman picks the lowest free plot index.
- **Rationale**: constitution VI ("shared game rules MUST have unit tests") and 001's pattern
  (`deliver()`).

## R11. Server tick and performance safeguards

- **Decision**:
  - **Tick**: `setSimulationInterval(tick, 50)`. Each tick does the following, in order:
    1. drain the input queues through `stepWorker()`;
    2. resolve landings that are due;
    3. run timers: fades, request expiry, the handover and idle checks (once per second), the shift
       phase;
    4. compute interest tiers;
    5. encode and send snapshots from pooled buffers.
  - **Instrumentation**, each sample kept in a ring buffer:
    - tick duration;
    - encode time;
    - SQLite time;
    - event-loop delay (`perf_hooks.monitorEventLoopDelay`);
    - heap use and GC pauses (`PerformanceObserver` 'gc');
    - per-client bytes sent.
  - **Metrics endpoint**: the samples are exposed at `GET /api/metrics`, enabled only in dev and
    load tests.
  - **Slow clients**: a client whose send buffer exceeds 256 KB has tier-3 updates skipped. A client
    stuck above 1 MB for 10 s is disconnected.
  - **Message validation**: every client message is checked by the validators in shared
    `protocol.ts` (finite numbers, enum ids, ≤ 256 bytes). Invalid messages add strikes.
- **Rationale**: codex flagged that load tests can mislead when they measure only tick time. Agy
  flagged GC pressure.

## R12. 100-bot load test

- **Decision**:
  - **Command**: `pnpm loadtest` runs `packages/server/loadtest/run.ts` on Node 24.
    - **Server**: it starts an in-process server, or targets one with `--url`.
    - **Bots**: it spawns 100 bots using `@colyseus/sdk`, spread across 4 worker threads.
  - **Bot behaviors**: the bots use the shared rules for intelligent intents:
    - wandering and running;
    - talking to the Foreman and hosting (about 10 bots);
    - asking to join, while bot Hosts approve and deny;
    - fetching, tossing and delivering pieces;
    - donating and emoting.
  - **Duration**: `--duration` defaults to 300 s. A `--soak 1800` option checks memory growth over
    30 minutes.
  - **Measurements**:
    - bytes received per bot on the wire (mean and p95 per second);
    - server tick time (average and p99), encode, SQLite and event-loop delay;
    - heap (start, peak, end; slope over the soak).
  - **Pass/fail**: against `tools/assets/budgets.json → net`, writing
    `reports/loadtest/<timestamp>.json` (schema in `contracts/loadtest-report.schema.json`).
  - **`pnpm verify`** runs a 60 s quick variant. The full 5-minute run and the 30-minute soak are
    phase-gate items.
- **Alternatives**: `@colyseus/loadtest` (its CLI harness has no budget assertions, and custom
  scenario code is needed anyway); external tools such as k6 (they do not speak the Colyseus
  protocol).

## R13. Testing strategy

- **Unit tests (Vitest)**:
  - **Shared rules**: kinematics determinism and limits, toss arcs, crew, plots, bin, shift, rate
    limits, names, interest, protocol codecs (round trips and fuzzing).
  - **Client logic** (node environment): the interpolation buffer, reconciliation replay, clock
    sync, the snapshot decoder.
- **Server integration tests**: `@colyseus/testing` plus SDK clients, run in Vitest. They cover:
  - joins, the 100-player cap and overflow worlds, invite routing;
  - reconnect within and after the grace period, reload resume;
  - contested grabs and the last slot;
  - non-crew bin routing;
  - join modes, request expiry and cooldown;
  - remove, hand over, automatic handover;
  - unattended adoption, plot retirement;
  - rate limits and strike disconnects, invalid messages;
  - restart restore (closing and reopening the database), shift reset, the celebration delaying the
    reset;
  - version mismatch.
- **Playwright e2e**: the config starts the server and the client.
  - **Multiplayer**: two browser contexts see each other, the Foreman → Host flow, ask/approve, a
    shared snap, mute/hide.
  - **Fallback**: solo mode when the server is down; `?solo=1`.
  - **Regression**: the existing 001 specs run under `?solo=1`.
- **Perf**: the `?perf=crowd` scene, plus the existing Masterpiece scene for solo.
- **Debug API**: `window.__hht` gains a `net` section (see `contracts/debug-api.md`) so e2e tests
  can query state without pixel checks.

## R14. Local development and the phone test

- **Decision**:
  - **`pnpm dev`** runs the server (`node --watch src/index.ts`, port 2567) and Vite (5173)
    together, with a small `concurrently`-free script that uses `pnpm -r --parallel`.
  - **Proxy**: Vite proxies `/api` and the WebSocket path `/ws` to the server, so the client always
    connects to its own origin. This also works from a phone through `pnpm dev --host`.
  - **Configuration** comes from environment variables: `HHT_PORT`, `HHT_DB`, `HHT_SHIFT_MINUTES`,
    `HHT_MAX_PLAYERS` (default 100; tests use small values), `HHT_METRICS=1`.
  - **Production hosting** (Hetzner, Cloudflare, TLS) is out of scope. It is documented as next
    steps only.
- **Rationale**: FR-058. A same-origin proxy avoids mixed-content and CORS issues on phones.

## R15. New art (Blender pipeline)

- **Decision**: these are new builders in `tools/blender/builders/`:

  | Builder | Produces |
  |---|---|
  | `site.py` | plaza, 12 plots with foundations, 4 supply yards, fences and trees; exports `site.glb` + `site.gen.ts` |
  | `foreman.py` | an original chibi Foreman with clipboard, vest and white hard hat; rigid parts for procedural idle and talk animation |
  | `props_mp.py` | plot sign with a flag slot, supply bin, 12 crew-flag decals in one atlas |
  | `clock_tower.py` (extended) | merged LOD0 and LOD1 per stage |

  - **Emote poses** are procedural rotations added to `WorkerView` and the crowd animator (wave,
    dance, point, thumbs-up; cheer already exists). No new meshes.
  - **Per-asset budgets** are added to `budgets.json`:

    | Asset | Budget |
    |---|---|
    | site | 500 KB |
    | foreman | 150 KB |
    | props-mp | 120 KB |
    | each LOD1 | 40 KB |

  - **Critical payload estimate** for multiplayer:

    | Item | Size |
    |---|---|
    | worker, pieces and fx (as in 001) | about 0.4 MB |
    | site, foreman and props-mp | about 0.8 MB |
    | six LOD1s | about 0.2 MB |
    | JS, without Rapier (three plus app plus sdk) | about 0.35 MB gzip |
    | **Total** | about 1.8 MB, within the 5 MB budget |

- **Rationale**: Principle IV (original, scripted, reproducible); the owner reviews the Foreman
  render before integration.

## R16. Chat and the moderation baseline (constitution v1.1.0, Principle V)

- **Decision**:
  - **Pure rules in shared `chat.ts`**, with unit tests:
    - **`sanitize(text)`**: NFC normalization; strip control, zero-width and bidi characters;
      collapse whitespace; trim; reject if empty or longer than 80 characters.
    - **`detectContact(text)`**: rejects:
      - URLs (scheme, `www.`, `name.tld` with a known TLD, and spelled-out forms like "dot com");
      - email addresses (including "at"/"(at)" forms);
      - phone numbers: 7 or more digits allowing spaces, dots and dashes, with Vietnamese and
        international prefixes.
    - **`maskBlocked(text, list)`** matches on a normalized form:
      - lowercase, with diacritics removed (NFD, combining marks dropped, `đ→d`, so Vietnamese
        words match with or without tone marks);
      - letter substitutions undone (`0→o 1→i 3→e 4→a 5→s 7→t @→a $→s`);
      - separators between single letters removed ("f.u.c.k");
      - repeated letters collapsed.

      Matched spans in the original text are replaced with `♥`.
  - **Blocklist**: editable files `packages/server/data/chat-blocklist/en.txt` and `vi.txt`, one
    term per line with `#` comments. They are loaded at boot and reloaded when a file changes. They
    are never shipped to the client.
  - **Channels**:
    - **Nearby**: the server relays to players within 20 m of the sender's authoritative position
      when the message is sent.
    - **Crew**: relayed to current crew members, with membership checked when the message is sent.

    There is no world channel and no private messages.
  - **Limits**:
    - rate class `chat`: 1 per 2 s, burst 3;
    - the same normalized text is refused within 30 s;
    - chat unlocks 60 s after joining the world (stops drive-by spam bots);
    - refusals return `chatRefused {reason}`; over-limit attempts also add strikes (as in R11).
  - **Reports**:
    - The server keeps an in-memory ring of each player's last 5 accepted messages: the sanitized
      text before masking, so the owner sees what was really written.
    - A `report {who}` writes a `chat_report` row with both key hashes, the ring as JSON and the
      time. Each reporter can report a given player once per shift.
    - When 3 distinct reporters report the same player within 10 minutes, the server writes
      `chat_pause (keyHash, epoch)`, refuses that player's chat with `paused` until the epoch
      changes, and sends `chatPaused`.
    - Reports are purged after 30 days, at boot and every 24 h.
  - **Owner review**: `pnpm reports [--since 7d] [--world 1]` prints the reports as a table from
    SQLite (FR-067).
  - **Client**:
    - **Chat box**: a DOM `<input maxlength=80 enterkeyhint="send" autocomplete="off">` with a
      Nearby/Crew toggle. Opening it suspends gameplay actions (FR-068). On phones,
      `visualViewport` resize keeps the box above the keyboard.
    - **Chat log**: 50 lines, with Nearby and Crew tabs, kept in session memory only.
    - **Speech bubbles**: a pool of at most 12 DOM bubbles, nearest speakers first, positioned by
      projecting the speaker's head. Free text cannot use the static billboard atlas.
    - **Local filtering**: muted or hidden players, and "hide all chat" (`profile.hideAllChat`),
      are filtered on the device.
  - **Bandwidth**: about 110 bytes per message event. In the worst case of 99 nearby players
    chatting at the maximum rate, that adds about 5.4 KB/s. Added to the 19.8 KB/s snapshot worst
    case, the total stays under 30 KB/s. The load-test bots chat at a realistic rate (1 message per
    20–40 s each) and the worst case is unit-tested on the budget math.
- **Rationale**: this meets every item of the constitution's moderation baseline with the
  smallest possible machinery: pure functions, two SQLite tables and a local review command.
  Filtering only on the server keeps the blocklist private, and nobody can bypass it.
- **Alternatives**:
  - **A third-party moderation API**: adds an external dependency, cost and privacy exposure, and
    is not in the constitution's stack.
  - **Client-side filtering only**: easy to bypass.
  - **A world channel**: rejected by the owner (spam).
  - **Persisting all messages**: unnecessary data retention; only reports keep messages.

## Implementation notes (deviations recorded during /speckit-implement)

- **Nameplates, crew flags and speech bubbles are DOM elements** rather than a canvas-atlas
  billboard batch (R7). The label layer is a pool of up to 24 elements for the nearest workers
  within 25 m, plus one label per plot within 32 m.
  - It adds no draw calls and keeps text crisp, including free-text chat bubbles.
  - Crew flags are DOM badges (12 color + symbol pairs) instead of a texture atlas.
- **Message names**: the binary world snapshot is the message type `ws`. The JSON event `snap`
  (a piece snapped into a tower) kept its name.
- **Own worker state is f64 in snapshots**, so client prediction matches the server bit for bit
  (contracts updated).
- **Chat blocklist matching**: terms written with accents (Vietnamese) match only accent-exact, so
  "lồn" never masks "lớn" (big). Plain ASCII terms match on the accent-stripped text, including
  letter swaps, repeated letters, spaced-out letters and `*` wildcards.
- **Matchmaking rate limit** per IP is configurable (`HHT_MM_PER_MIN`, default 10/min). Tests and
  load tests raise it, because every bot shares one IP.
- **Shutdown**: closing the server for a restart never runs "player left" logic, so persisted crews
  survive the restart.
- **Packages**: the server uses `@colyseus/core` 0.18.23 plus `@colyseus/ws-transport`, not the
  `colyseus` meta-package (which pulls in redis, monitor and playground). Integration tests boot the
  real server in-process on port 0 rather than through `@colyseus/testing`.
