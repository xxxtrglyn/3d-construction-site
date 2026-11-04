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
| `HHT_DEV_CHEATS` | off | `1` enables `dev` messages: give, teleport, fillStage, endShiftIn, unlockChat |
| `HHT_BLOCKLIST_DIR` | `data/chat-blocklist` | Chat blocklist `*.txt` files (hot-reloaded, server only) |

## HTTP

See `specs/002-multiplayer-core/contracts/http-api.md`.

- `POST /api/matchmake`: picks the world and returns a Colyseus seat reservation.
- `GET /api/health`
- `GET /api/metrics`: only when `HHT_METRICS=1`.

The room protocol is in `contracts/network-protocol.md`.

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
