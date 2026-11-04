# @hht/server

The authoritative game server for Hard Hat Town (feature 002). Each world is one Colyseus room of up
to 100 players. Rules come from `@hht/shared`, and state is persisted in SQLite (`node:sqlite`).

## Run

```bash
nvm use                       # Node 24 (Colyseus 0.18 needs ≥ 22); TypeScript runs directly
pnpm --filter @hht/server dev # HHT_METRICS=1 HHT_DEV_CHEATS=1, restarts on change
pnpm --filter @hht/server start
```

`pnpm dev` at the repo root runs this server and the Vite client together. The client reaches the
server through the `/api` and `/ws` proxy.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `HHT_PORT` | 2567 | HTTP and WebSocket port |
| `HHT_DB` | `data/hht.sqlite` | SQLite file (`:memory:` for tests) |
| `HHT_SHIFT_MINUTES` | 60 | Shift length |
| `HHT_MAX_PLAYERS` | 100 | Players per world (a full world opens an overflow world) |
| `HHT_MM_PER_MIN` | 10 | `/api/matchmake` requests per IP per minute |
| `HHT_METRICS` | off | `1` enables `GET /api/metrics` |
| `HHT_DEV_CHEATS` | off | `1` enables `dev` messages: give, teleport, fillStage, fillGround, machinePose, endShiftIn, unlockChat |
| `HHT_BLOCKLIST_DIR` | `data/chat-blocklist` | Chat blocklist `*.txt` files (hot-reloaded, server only) |

## HTTP

See `specs/002-multiplayer-core/contracts/http-api.md`.

- `POST /api/matchmake`: picks the world and returns a Colyseus seat reservation.
- `GET /api/health`
- `GET /api/metrics`: only when `HHT_METRICS=1`.

The room protocol is in `contracts/network-protocol.md`, with the feature 003 delta (protocol **v2**:
machines) in `specs/003-construction-machines/contracts/network-protocol-v2.md`. A v1 client is refused
with close code 4001 ("A new version is ready").

## Machines (feature 003)

`src/systems/machines.ts` (`MachineSystem`) holds the 48 machines of a world (12 plots × crane,
excavator, forklift, mixer; id = plot × 4 + kind):

- **Stepping**: a seated session's move inputs drive its machine through the shared
  `stepMachine()` (`movement.simulate`), one input = one 60 Hz step; a jump flag gets out at that
  exact step. Unoperated machines step on their own only while busy (a hook mid-lowering, a forklift
  coasting).
- **Permissions**: `canEnter` (crew of the plot, free seat, empty hands, ≤ 1.5 m + slack). Operators
  are put out on jump, leaving or removal from the crew, disconnect, 60 s without input
  (`timers.machineIdleS`) and shift reset; anything on the hook or the forks is set down safely.
- **Actions**: scoop/dump (Groundwork `dig`), the mixer hopper and mixing (`mixerBags`,
  `mixerMixUntil`), hook grab/release (`snapTarget` → `deliver(…, 'crane')`), pallets
  (`neededSupply`, one hand slot per piece). Hooked and pallet pieces leave the schema while held
  (`PieceRec.state` `hooked`/`pallet`).
- **Snapshots**: a 12-byte machine record per machine per receiver, by interest tier, sent only when
  it changed or every 2 s; the operator gets their own machine at full precision in `ownMachine`.
- **Persistence**: schema v2 (`ground_dug`, `ground_poured`, `high_filled`, `mixer_bags`). A v1
  database is migrated at boot in one transaction; buildings already in progress count as having
  finished Groundwork. Machine poses, operators and held loads are not stored: after a restart every
  machine is parked and empty.

## Tests and the load test

```bash
pnpm --filter @hht/server test      # integration tests (in-process server, :memory: db)
pnpm loadtest --duration 60         # quick 100-bot run (part of pnpm verify)
pnpm loadtest                       # full 5-minute run → reports/loadtest/<ts>.json
pnpm loadtest --soak 1800           # 30-minute memory soak
pnpm loadtest --selftest            # proves a slow tick fails the budget
pnpm loadtest --url http://host:2567 --duration 600   # against a running server
```

Reading the results:

- The soak's `heapSlopeMbPerMin` is fitted to the heap retained after a forced full GC, sampled once
  a minute from minute 3 (the script runs Node with `--expose-gc`). A fit over raw `heapUsed`
  follows V8's GC sawtooth and is noise; the report keeps it as `rawSlopeMbPerMin` for reference.
- Bots run in worker threads of the same process, so on a laptop they compete with the server for
  cores and `tickMs` is wall-clock time under that contention. For numbers that represent
  production, run the bots from another machine with `--url`.
- Report **version 2** (feature 003) adds a `machines` section (`groundworkDone`, `craneSnaps`,
  `forkliftSnaps`, `maxMachinesMoving`, `machineBytesPerClientPerS`), machine behaviour counts, and
  four consistency counters that must be 0: `machineOutsiderOps` (bots probe other crews' machines),
  `highFilledByHand`, `workerMovedByMachine` and `heldPiecesLost`. A full run (≥ 300 s) also needs
  `groundworkDone ≥ 4`, `craneSnaps ≥ 8` and `palletUnload ≥ 10`.
- `chatRechecked` counts chats that looked out of channel on arrival, only because the state patch
  had not landed yet, and were fine 300 ms later. Only chats that still look wrong count toward
  `consistency.chatOutsideChannel`.

## Chat moderation

The blocklists are `data/chat-blocklist/en.txt` and `vi.txt`, one term per line. Accented terms
match only with their accents. Plain ASCII terms also match letter swaps, repeated letters and
spaced-out letters.

To review reports: `pnpm reports --since 7d`. Reports are kept for 30 days.

## Production (not in this feature)

Hosting on Hetzner behind TLS (Caddy or nginx terminating `wss://`), the client on Cloudflare
Pages, and SQLite backups are next steps for a later feature.
