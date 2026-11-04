# Contract: HTTP API (game server)

- **Base path**: `/api`. In development, Vite proxies `/api` and the WebSocket path `/ws` to
  `localhost:2567`, so the client always uses its own origin.
- **Format**: requests and responses are JSON. Request bodies are limited to 1 KB.

## `POST /api/matchmake`

Request:

```json
{ "protocol": 1, "playerKey": "32-hex", "world": 1 }
```

`world` is optional. It comes from an invite link `?w=<n>` or from `profile.lastWorld`.

The server picks a world in this order:

1. If `world` is given, that world exists, and it has a free seat: that world.
2. Otherwise, the existing world with the lowest `worldId` and a free seat. A world that
   `keyHash` can resume into (an away session or a restored crew member) counts as having a seat
   for that player.
3. Otherwise, a new world with the next `worldId`.

Responses:

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ "reservation": <Colyseus SeatReservation>, "worldId": 2, "redirected": true }` | `redirected` is true when a requested world could not be used; the client then shows "That site is full — you've been sent to a nearby one" |
| 426 | `{ "error": "protocol", "server": 1 }` | version mismatch: show the reload prompt |
| 400 | `{ "error": "invalid" }` | malformed body |
| 429 | `{ "error": "rate" }` | more than 10 requests per minute per IP |
| 503 | `{ "error": "starting" }` | the server is restoring state; the client retries |

## `GET /api/health`

- **Response**: `200 { "ok": true, "protocol": 1, "worlds": [{ "worldId": 1, "players": 37 }] }`.
- **Used by** the solo fallback poll every 10 s and by e2e tests.
- **Timeout**: the client gives up after 2 s.

## `GET /api/metrics`

This endpoint exists only when `HHT_METRICS=1` (dev and load tests). Otherwise it returns 404.

```json
{
  "uptimeS": 312,
  "worlds": [{
    "worldId": 1, "players": 100,
    "tickMs": { "avg": 3.1, "p99": 7.8, "max": 12.0 },
    "encodeMs": { "avg": 0.9, "p99": 2.2 },
    "sqliteMs": { "avg": 0.05, "p99": 0.4 },
    "bytesPerClientPerS": { "avg": 7100, "p95": 15800, "max": 21900 }
  }],
  "eventLoopDelayMs": { "p50": 0.6, "p99": 4.1 },
  "heapMb": { "used": 92, "peak": 118 },
  "gcPauseMs": { "p99": 3.0, "count": 211 }
}
```
