# Data Model: Construction Machines (003)

This file extends [002 data-model.md](../002-multiplayer-core/data-model.md). Only the new and
changed entities are listed. All rules are pure functions in `packages/shared`, with unit tests.
Coordinates are three.js world coordinates in metres (Y up).

## 1. Machine (shared `machines.ts`)

```ts
type MachineKind = 'crane' | 'excavator' | 'forklift' | 'mixer';   // kind index 0..3
type MachineId = number;                       // plot * 4 + kindIndex (0..47); solo uses plot 0

interface MachineState {
  id: MachineId;
  kind: MachineKind;
  x: number; z: number; yaw: number;           // body pose (crane/mixer: fixed at their spots)
  p1: number; p2: number; p3: number;          // rig parameters, meaning per kind (below)
  phase: 'idle' | 'lowering' | 'raising' | 'working';
  phaseT: number;                              // seconds left in the current phase
  load: MachineLoad;
}

type MachineLoad =
  | { kind: 'none' }
  | { kind: 'hook'; piece: PieceTypeId }        // crane
  | { kind: 'pallet'; pieces: PieceTypeId[] }   // forklift, 1..4 of one type
  | { kind: 'dirt' }                            // excavator bucket full
  | { kind: 'bags'; count: number };            // mixer, 0..4 (also mirrored in Plot)
```

| Kind | p1 | p2 | p3 | Moves body? |
|---|---|---|---|---|
| crane | slew angle (rad) | trolley radius (m, 2.5–7.5) | hook height (m, auto) | no |
| excavator | boom angle | bucket curl | (unused) | yes, inside its own yard |
| forklift | fork height (m) | steer angle | (unused) | yes, outside `noDrive` |
| mixer | drum angle | (unused) | (unused) | no |

**Validation and invariants**:

- One operator at most. An operator's session has exactly one `machine` (or none).
- `hook` and `pallet` loads hold only pieces that the server removed from the loose set. Pieces are
  conserved (§7).
- A forklift `pallet` holds 1–4 pieces of one type, and never `concrete` or `cone`.
- The crane hook position `hookPos(state, spots)` always lies in its own yard circle, with a radius
  between the reach limits.

**Pure functions**:

| Function | Purpose |
|---|---|
| `stepMachine(s, input, dt, ctx)` | 60 Hz kinematics and phase timers. The edge-triggered `act` starts a phase. Emits at most one `MachineAction` per step |
| `seatPose(s)` | cab seat position and yaw for the operator's worker |
| `exitSpot(s, ctx)` | where the worker stands after leaving |
| `hookPos(s, spots)` | world position of the crane hook |
| `canEnter(machine, plot, actor)` | crew check, free seat, empty hands, range ≤ 1.5 m |
| `snapTarget(hook, progress, piece, slots)` | the slot within 1.5 m (horizontal) that a release would fill, or null (FR-027) |
| `setDownSpot(x, z, ctx)` | nearest walkable point within 2 m that is not in the pit or the bin |
| `neededMachine(progress)` | which machine the cue points at: excavator, mixer, crane or null (FR-022a) |

The `ctx` argument holds the site layout, the static blockers, the drivable-region rules and the
machine spots.

`MachineAction` is what a step can request; the server (or `SoloMachines`) decides the effect:
- `scoop`, `dump`;
- `hookDown`, `hookUp`;
- `loadPallet`, `unloadPallet`;
- `mix`.

## 2. Machine spots (generated; `site.gen.ts` and the solo lot adapter)

```ts
interface MachineSpots {
  plot: number;
  yardRadius: number;                                  // 6.0
  pit: { x: number; z: number; half: number };         // = the tower footprint
  spoil: { x: number; z: number; radius: number };
  hookPad: { x: number; z: number; half: number };
  crane: { x: number; z: number; reachMin: number; reachMax: number; cabHeight: number };
  mixer: { x: number; z: number; yaw: number; hopper: Vec2; chute: Vec2 };
  parking: { excavator: Pose; forklift: Pose };
  highSlots: Vec3[];                                   // ring positions at the tower top, per stage
}
```

`SiteLayout` gains `machines: MachineSpots[]` (12 entries) and `noDrive` (the plaza radius plus
1 m, and `playRadius − 1.5`). `racks` gains 4 `cement` racks.

## 3. Progress (shared `progression.ts`, extended)

```ts
interface StageDef { /* 002 fields */ highSlots: number }          // Clock Tower: [0,0,3,0,0,1]
interface Blueprint { /* 002 fields */ groundwork: { scoops: 6; concrete: 4 } }

interface TowerProgress {
  blueprintId: string;
  groundDug: number;        // 0..6
  groundPoured: number;     // 0..4
  completedStages: number;  // 0..6 (unchanged)
  filledSlots: number;      // total filled in the current stage (unchanged meaning)
  highFilled: number;       // high slots filled in the current stage
}
type Via = 'hand' | 'forklift' | 'crane';
type DeliverResult = 'snapped' | 'stageComplete' | 'masterpiece' | 'wrongPiece' | 'alreadyComplete'
                   | 'groundworkFirst' | 'tooHigh';
```

**Transitions** (all pure):

| Function | Rule |
|---|---|
| `dig(p)` | `groundDug + 1`, up to 6 |
| `pour(p)` | Needs `groundDug === 6`. `groundPoured + 1`, up to 4. Reaching 4 completes Groundwork, and the event `groundworkDone` is emitted |
| `deliver(p, type, via, slot?)` | Groundwork incomplete → `groundworkFirst` (concrete goes through `pour`, never `deliver`). Wrong type → `wrongPiece`. If `via` is not crane and hand slots remaining (`slotCount − highSlots − (filledSlots − highFilled)`) is 0 while high slots remain → `tooHigh`. A crane delivery with `slot.high` increments `highFilled` |
| `groundworkDone(p)` | `groundDug === 6 && groundPoured === 4` |

The stage completes when `filledSlots === slotCount`. `highFilled` resets to 0 when a stage
completes. Stars are unchanged.

**State machine of a building** (extends 002):

```
free ──Foreman start──▶ building[groundwork: digging → pouring] ──groundworkDone──▶ building[stage 1..6] ──▶ finished
```

The 002 states `unattended` and `finished` and the shift reset are unchanged. A reset clears
Groundwork too.

## 4. Pieces (shared `pieces.ts`)

| New type | Label | Rack? | Fills slots? | Mass | Carry pose | Notes |
|---|---|---|---|---|---|---|
| `cement` | Cement bag | yes, 1 per yard (multiplayer) and 1 on the solo lot | no (goes into the mixer) | 2 | twoHands | can be donated to bins |
| `concrete` | Concrete bucket | no (mixer output only) | footing only | 2 | twoHands | cannot be binned |

`PIECE_TYPE_IDS` keeps the existing order and appends `cement` and `concrete`, so the carry codes
for the old types stay 1–7. The carry code goes from 3 bits to 4 bits on the wire (§8).

## 5. Server-side records (`packages/server`)

```ts
interface Session { /* 002 */ machine: MachineId | -1; lastMachineInputAt: number }
interface PieceRec { /* 002 */ state: 'loose' | 'flying' | 'hooked' | 'pallet'; heldBy: MachineId | -1 }
interface MachineRec { state: MachineState; operator: string /* sessionId */ | '' }
// per-receiver dirty tracking lives on the Session instead (typed arrays, no Map churn):
// Session.machineTiers: Uint8Array(48), machineHash: Int32Array(48), machineSentTick: Int32Array(48)
```

`PlotState` (schema) gains:

| Field | Type |
|---|---|
| `groundDug` | `uint8` |
| `groundPoured` | `uint8` |
| `highFilled` | `uint8` |
| `mixerBags` | `uint8` |
| `mixerMixUntil` | `float64` |
| `machineOps` | `array<string>`, 4 entries |
| `hookType` | `string` |
| `palletTypes` | `array<string>` |

`PlayerState` gains `machine: int8` (−1 = none).

## 6. Persistence (schema_version 2)

See [contracts/persistence-v2.sql](./contracts/persistence-v2.sql). The `building` table gains
`ground_dug`, `ground_poured`, `high_filled` and `mixer_bags`, and `bin_entry.piece_type` allows
`cement`. Machine poses, operators and held loads are not stored.

## 7. Invariants checked by tests and the load test

1. **Piece conservation** (`heldPiecesLost = 0`): over any interval, pieces spawned by racks and
   the mixer = loose + flying + carried + hooked + on pallets + snapped + binned + faded.
2. **High slots**: `highFilled` only increases through a crane delivery (`highFilledByHand = 0`).
3. **Permissions**: an operator is always in the crew of the machine's plot. They are put out
   within 2 s of losing membership (`machineOutsiderOps = 0`).
4. **Worker safety**: no worker position changes in a step unless it comes from that worker's own
   input, a respawn, a teleport (dev only), seating or exiting (`workerMovedByMachine = 0`).
5. **Determinism**: `stepMachine` on the same inputs gives bit-identical states on the client and
   the server (a unit test replays recorded input logs).

## 8. Wire records (protocol v2, see contracts)

| Record | Size | Fields |
|---|---|---|
| Worker entity | 10 B (unchanged size) | byte 9 = anim (3 bits) \| carry (4 bits) \| emoting (1 bit); new anim `seated = 6` |
| Machine record | 12 B | id u8, x i16 cm, z i16 cm, yaw u8, p1 i16 (×1000), p2 i16 (×1000), p3 u8 (dm), flags u8 (op present, load code 4 bits, phase 2 bits) |
| Own machine block | 1 B, + 30 B while operating | `inMachine` u8 (0xff = none), then 7 × f32 (x, z, yaw, p1, p2, p3, phaseT), phase u8, loadCode u8 |
| Move input byte | 1 B per step | bit0 run, bit1 jump, bit2 act, bit3 alt (client-only, ignored by the server) |
