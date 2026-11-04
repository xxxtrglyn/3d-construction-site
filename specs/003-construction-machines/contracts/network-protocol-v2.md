# Contract: Network Protocol v2 (machines)

This contract is a **delta** on [002 network-protocol.md](../../002-multiplayer-core/contracts/network-protocol.md).
Everything not listed here is unchanged. `PROTOCOL_VERSION = 2`. A v1 client is refused with close
code 4001 ("A new version is ready"). All definitions live in `packages/shared/src/protocol.ts`, and
the machine rules live in `machines.ts`.

## 1. Move inputs (binary `BIN_KIND.moveInputs`)

The layout is unchanged: per-step bytes `dx i8, dz i8, flags u8`. The flags byte changes:

| Bit | Name | Walking | Operating a machine |
|---|---|---|---|
| 0 | `run` | run | ignored |
| 1 | `jump` | jump | **exit** (the server puts the operator out at this step) |
| 2 | `act` | ignored (walking actions stay JSON intents) | **machine action** at this exact step |
| 3 | `alt` | ignored | client-only (crane camera toggle). The server ignores it |

A flags value above 15 fails validation and counts as a strike. Every `act` edge after the 4th
within the same second (60 steps) is ignored, with no strike.

**Directions (implementation note)**: while operating, `dx`/`dz` are the raw stick axes ×127
(`dx` = right, `dz` = forward), so a diagonal such as W+D is (127, 127). The decoder therefore
accepts the full square −127..127 per axis (only −128 is rejected). Walking is unaffected:
`stepWorker()` normalizes a wish vector longer than 1.

## 2. New client → server message

| Type | Payload | Sent when | Server checks |
|---|---|---|---|
| `machine` | `{ op: 'enter', id: MachineId }` | action pressed near a machine (the prompt says "Get in") | `canEnter`: the plot has a building; the sender is its Host or a member; hands are empty; the seat is free; the server worker is ≤ 1.5 m + 0.3 m slack from the cab. On failure: a `machineResult` event. Rate bucket `machine` (6, +2/s) |
| `machine` | `{ op: 'exit' }` | jump in a machine (a reliable fallback for the input-stream exit) | the sender is operating. Idempotent |

## 3. New and changed server → client events

| Event | Payload | To |
|---|---|---|
| `machineResult` | `{ id, result: 'entered' \| 'notCrew' \| 'busy' \| 'handsFull' \| 'tooFar' \| 'notBuilding' }` | the sender |
| `machineExit` | `{ id, reason: 'jump' \| 'idle' \| 'leftCrew' \| 'disconnect' \| 'shiftReset' }` | the operator |
| `machineAct` | `{ id, act: 'scoop' \| 'dump' \| 'dumpBack' \| 'hookGrab' \| 'hookRelease' \| 'palletLoad' \| 'palletUnload' \| 'mixStart' \| 'mixDone', plot }` | players within 35 m (sound and FX) |
| `ground` | `{ plot, dug, poured, done: boolean }` | everyone (also mirrored in the schema) |
| `snap` | 002 fields + `via: 'hand' \| 'forklift' \| 'crane'` | as in 002 |
| `hint` | 002 kinds + `{ kind: 'groundworkFirst', part: 'dig' \| 'concrete' }` \| `{ kind: 'tooHigh' }` \| `{ kind: 'crewOnlyMachine' }` \| `{ kind: 'mixerFull' }` | the actor |

## 4. Schema additions (`WorldState`)

`PlayerState`:
- `machine: int8`, where −1 means not operating.

`PlotState`:

| Field | Type | Notes |
|---|---|---|
| `groundDug` | `uint8` | 0..6 |
| `groundPoured` | `uint8` | 0..4 |
| `highFilled` | `uint8` | high slots filled in the current stage |
| `mixerBags` | `uint8` | 0..4 |
| `mixerMixUntil` | `float64` | server epoch ms, or 0 |
| `machineOps` | `array<string>` (length 4, kind order crane, excavator, forklift, mixer) | operator session id, or `''` |
| `hookType` | `string` | `''` or a `PieceTypeId` |
| `palletTypes` | `array<string>` | 0..4 entries of one type |

Pieces held by a machine are removed from `pieces` while held and re-added as `loose` when they
are set down (research M10).

## 5. Binary snapshot v2

```
header      kind u8 (=1) | protocol u8 (=2) | tick u32 | serverTime f64 | ackSeq u16
own         x y z vx vy vz facing coyote jumpBuffer (f64 ×9) | flags u8 (grounded | carry<<1, 4 bits)
ownMachine  inMachine u8 (0xff = none) | if ≠ 0xff: x z yaw p1 p2 p3 phaseT (f32 ×7) phase u8 loadCode u8
entities    count u8 | count × 10 B worker records
machines    count u8 | count × 12 B machine records
```

**Worker record** (10 B): netId u16, x/y/z i16 (cm), yaw u8. Byte 9 = `anim & 7 | (carry & 15) << 3
| emoting << 7`. Anim ids: 0 idle, 1 walk, 2 run, 3 air, 4 cheer, 5 emote, **6 seated**.

**Machine record** (12 B):

| Byte | Field |
|---|---|
| 0 | id u8 (plot × 4 + kind) |
| 1–2 | x i16 (cm) |
| 3–4 | z i16 (cm) |
| 5 | yaw u8 (256 steps) |
| 6–7 | p1 i16 (mrad, or mm for lengths) |
| 8–9 | p2 i16 (same units) |
| 10 | p3 u8 in decimetres (0–25.5 m: the crane hook height runs up to ~12.8 m; other kinds ≥ 0 only) |
| 11 | flags: bit0 operator present, bits1–4 load code (0 none, 1–9 piece type, 10 dirt, 11 pallet), bits5–6 phase (idle, lowering, raising, working) |

Mixer bags are not in the load code: the client reads them from the schema (`mixerBags`).

**Sending rule**: a machine is included for a receiver when it is due under that receiver's interest
tier (`tierFor` on the distance from the receiver to the machine, `isDue(tier, tick, 4096 + id)`)
**and** either it changed since the last record sent to that receiver, or 2 s have passed since that
receiver's last record for it. A receiver's own machine is always sent in `ownMachine` and is not
duplicated in `machines`.

**Size**: the worst case is about 2.4 KB/s per receiver (research M4), and the per-client budget
stays 30 KB/s on average.
