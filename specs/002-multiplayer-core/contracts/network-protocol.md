# Contract: Network Protocol (client ↔ world room)

`PROTOCOL_VERSION = 1`, defined in `packages/shared/src/protocol.ts`.

- **Where the definitions live**: every message id, payload type, validator and binary codec below
  is defined once in `packages/shared/src/protocol.ts`, and both sides import it.
- **Untrusted input**: the server treats every client payload as untrusted. A payload that fails
  its validator counts as a strike and has no effect.
- **Coordinates**: three.js world coordinates (Y up), in meters. Angles are in radians unless
  quantized.

## 1. Join

1. The client calls `POST /api/matchmake` (see `http-api.md`) and receives a seat reservation.
2. The client consumes the reservation with these join options:

   ```ts
   interface JoinOptions {
     protocol: number;          // must equal PROTOCOL_VERSION
     playerKey: string;         // 32 hex chars (device secret)
     name: string;              // must pass isValidGuestName
     hatColor: HatColorId;
   }
   ```

3. `onAuth` validates the options. The server may change the name to make it unique, adding " 2" or
   similar.
4. If `keyHash` matches an `away` session or a restored crew member, the join resumes that identity.
5. The first server message is `welcome`:

   ```ts
   { t: 'welcome', sessionId, netId, worldId, serverNow: number /* epoch ms */, tick: number,
     name /* final, possibly suffixed */, resumed: boolean }
   ```

### Close codes (server → client)

| Code | Meaning | Client behaviour |
|---|---|---|
| 4001 | protocol mismatch | show "A new version is ready — tap to reload" |
| 4002 | removed for idling (10 min) | show "Tap to rejoin" |
| 4003 | too many invalid or over-limit actions | show "Disconnected" plus a rejoin button after 30 s |
| 4004 | world closing (overflow world disposed) | matchmake again automatically |
| 4005 | server shutting down or restarting | reconnect loop (backoff 1, 2, 4, 8 s, then every 5 s), rejoining `lastWorld` |
| 1006 / other | network drop | SDK reconnection within 60 s, then matchmake again with `lastWorld` |

## 2. Client → server

| id | Payload | Rate class | Server validation |
|---|---|---|---|
| `in` (binary) | MoveInput batch (see §4) | move 60/s, burst 12 | finite and in range; at most the budget; seq continuity (gaps allowed, rewinds dropped) |
| `grab` | `{ target: { kind: 'rack', rack: number } \| { kind: 'piece', id: number } \| { kind: 'bin', plot: number } }` | action | in range of the server worker position (pickup radius + 0.3 m); not holding; target exists; a piece is not flying; a bin grab is crew only |
| `drop` | `{}` | action | holding |
| `toss` | `{ charge: number /* 0..1 */ }` | action | holding; the arc comes from server state |
| `emote` | `{ id: EmoteId }` | emote | known id |
| `say` | `{ id: QuickMessageId }` | emote | known id |
| `foreman` | `{ op: 'start', blueprint: 'clock-tower' } \| { op: 'adopt', plot: number }` | admin | within talk radius; not in a crew; plot is `unattended` (adopt) |
| `crew` | `{ op: 'request', plot } \| { op: 'cancel' } \| { op: 'answer', requester: sessionId, approve: boolean } \| { op: 'mode', mode: JoinMode } \| { op: 'remove', member: sessionId } \| { op: 'handover', to: sessionId } \| { op: 'leave' }` | request (for `request`) / admin | role checks: only the Host may `answer`, `mode`, `remove` and `handover`; `request` follows the rules in `data-model.md` (JoinRequest) |
| `hide` | `{ who: sessionId, hidden: boolean }` | admin | only affects whether that player's join requests reach this player |
| `shuffleName` | `{ name: string }` | admin (1 per 2 s) | `isValidGuestName`, then made unique |
| `ping` | `{ c: number }` | 1/s | the server replies with `pong` |
| `respawn` | `{}` | 1 per 2 s | the server teleports the worker to the plaza spawn |
| `chat` | `{ channel: 'nearby' \| 'crew', text: string }` | chat 1 per 2 s, burst 3 | ≤ 400 bytes raw; then the shared `chat.ts` checks in the order of `data-model.md` → Chat (locked → paused → rate → sanitize → contact → duplicate → noCrew) |
| `report` | `{ who: sessionId }` | report 1 per 10 s | target exists and is not self; one report per target per shift |

Mute and hide are local only. `hide` exists only so a hidden player's join requests are not shown
(FR-042). The server never tells anyone who hid whom.

## 3. Server → client

### Schema state (Colyseus patches, every 100 ms)

```ts
WorldState {
  worldId: number;
  shift: { epoch: number; endsAt: number /* server epoch ms */; towersCompleted: number; phase: 'running'|'warning'|'countdown'|'resetting' };
  players: Map<sessionId, { netId: number; name: string; hatColor: string; heldType: string /* '' or PieceTypeId */;
                            crewPlot: number /* -1 none */; crewRole: ''|'host'|'member'; away: boolean }>;
  plots: Array<{ state: 'free'|'building'|'unattended'|'finished'; blueprintId: string;
                 completedStages: number; filledSlots: number; hostName: string; hostSession: string;
                 joinMode: 'ask'|'open'|'solo'; crewSize: number; bin: Array<string /* PieceTypeId */>; finishedAt: number }>;  // length 12
  pieces: Map<pieceId(string), { type: string; state: 'loose'|'flying'; x: number; y: number; z: number;
                                 ox: number; oy: number; oz: number; vx: number; vy: number; vz: number; t0: number; landAt: number }>;
}
```

The schema carries no positions of workers; those come only in snapshots. Held pieces appear only
as `heldType`.

### Binary world snapshot `ws` (one per client per tick, 20 Hz)

The binary message type is `ws`. `snap` is the JSON event for a piece snapping into a tower; the two are distinct.

The snapshot is little-endian:

```text
u8  kind = 1
u8  protocol
u32 tick
f64 serverTime (epoch ms)
u16 ackSeq                 // last MoveInput seq processed for this client
--- own worker authoritative state (for reconciliation; f64 so prediction can match the server exactly)
f64 x, y, z, vx, vy, vz
f64 facing, coyote, jumpBuffer
u8  flags (bit0 grounded, bits1-3 carry type 0=none 1..7=PIECE_TYPE_IDS order)
--- remote entities
u8  count
count × 10 bytes:
  u16 netId
  i16 x, y, z              // centimeters
  u8  yaw                  // 0..255 → 0..2π
  u8  flags                // bits0-2 anim (idle, walk, run, air, cheer, emote), bits3-5 carry type, bit6 emoting
```

- **Which entities**: only those due this tick for the receiver's interest tiers, with 2 m
  hysteresis:

  | Distance | Rate |
  |---|---|
  | ≤ 15 m | 20 Hz |
  | ≤ 35 m | 10 Hz |
  | beyond | 4 Hz |

- **Missing entities**: an entity absent from a snapshot is simply not updated. Removal is signaled
  by the schema (the player is removed), never by absence.
- **Hidden players**: still sent. The client simply does not draw them.

### Events (typed messages)

| t | Payload | Audience |
|---|---|---|
| `welcome` | see §1 | joining client |
| `pong` | `{ c, s: serverNow }` | sender |
| `snap` | `{ plot, result: 'snapped'\|'stageComplete'\|'masterpiece', by: sessionId, pieceType }` | everyone |
| `hint` | `{ kind: 'wrongPiece', needed: PieceTypeId } \| { kind: 'notCrew' } \| { kind: 'binFull' }` | actor only |
| `binned` | `{ plot, by: sessionId }` | everyone |
| `thanks` | `{ plot, by: sessionId /* crew member who used the piece */ }` | donor only |
| `celebrate` | `{ plot, until: serverMs }` | everyone |
| `emote` | `{ who: sessionId, id: EmoteId \| QuickMessageId, kind: 'emote'\|'say' }` | players within 35 m |
| `foreman` | `{ result: 'assigned', plot } \| { result: 'allPlotsBusy' } \| { result: 'adopted', plot } \| { result: 'notAvailable' }` | sender |
| `request` | `{ op: 'incoming', requester: sessionId, name, expiresAt } \| { op: 'withdrawn', requester }` | current Host |
| `requestResult` | `{ plot, result: 'joined'\|'pending'\|'denied'\|'expired'\|'full'\|'closed'\|'cooldown'\|'busy', retryAt?: serverMs }` | requester |
| `crewNotice` | `{ plot, kind: 'newHost'\|'removed'\|'joined'\|'left', who: sessionId }` | crew members (`removed`: the removed player too) |
| `slowDown` | `{}` | actor (at most 1 per 2 s) |
| `correction` | `{ reason: 'respawn'\|'outOfBounds' }` | actor; the next snapshot carries the authoritative state; the client snaps instead of blending |
| `shift` | `{ phase: 'warning'\|'countdown', endsAt }` | everyone |
| `summary` | `{ epoch, worldTowers, myCrewTowers, delivered, donated }` | each player (personal values) |
| `chat` | `{ from: sessionId, channel: 'nearby'\|'crew', text /* masked */, at: serverMs }` | nearby: players within 20 m of the sender (incl. sender); crew: current crew members |
| `chatRefused` | `{ reason: 'locked'\|'paused'\|'rate'\|'tooLong'\|'empty'\|'contact'\|'duplicate'\|'noCrew', unlockAt?: serverMs }` | sender |
| `chatPaused` | `{ untilShiftEnd: true }` | the paused player |
| `reportResult` | `{ result: 'ok'\|'already'\|'invalid' }` | reporter (never tells the reported player) |

## 4. MoveInput batch (`in`, client → server, about every 50 ms)

```text
u8  kind = 2
u16 firstSeq
u8  n (1..12)
n × 3 bytes:
  i8 dx, i8 dz             // world-space wish direction ×127; |(dx,dz)| ≤ 127
  u8 buttons               // bit0 run, bit1 jump(pressed this step)
```

The server processes inputs in seq order, at most up to the rate budget. Excess inputs are dropped
and count as over-limit. The seq wraps at 65536; ordering uses serial-number arithmetic.

## 5. Clock

- **Offset**: the client estimates `offset = serverNow − clientNow` from `welcome`, then from
  `pong` (median of the last 5 measurements, discarding samples whose round trip is above 2× the
  median).
- **Interpolation**: each remote entity is drawn at `serverTime − tierDelay`, where `tierDelay` is
  100, 180 or 320 ms for tiers 1, 2 and 3.
- **Timers**: shift timers and request expiry are shown using `endsAt − (clientNow + offset)`.
