# Network Protocol v3 (feature 004)

Delta on top of protocol v2 (`specs/003-construction-machines/contracts/network-protocol-v2.md`).
Everything not listed here is unchanged. Types live in `packages/shared/src/protocol.ts`.

## Version

- `PROTOCOL_VERSION = 3`. A v2 client joining a v3 server is closed with code **4001** and shows the
  existing "new version, reload" prompt. No compatibility shim.

## Client → server

No new or changed messages. Deliveries are still the existing `drop` / `toss` intents, forklift
`act` steps and crane releases (v2). The server decides every snap with the shared `deliver()`.

## Colyseus schema: `PlotState`

| Field | Type | v2 | v3 |
|---|---|---|---|
| `filledSlots` | uint8 | filled slots of the stage | **removed** |
| `filledA` | uint8 | — | filled slots of recipe item 0 of the current stage (incl. high) |
| `filledB` | uint8 | — | filled slots of recipe item 1 (0 when the stage has one item) |
| `highFilled` | uint8 | high slots filled | unchanged |
| `blueprintId` | string | `clock-tower` | `clock-tower` or `clock-tower-v1` (legacy towers, FR-004) |

Clients rebuild progress with `progressOf(plot)` and derive needs with `needsOf()`; no needs list is
sent. Patches are sent only when a field changes (one byte per delivery).

## Server → client events

### `hint` (changed union)

```ts
type HintEvent =
  | { kind: 'wrongPiece'; needed: PieceTypeId[] }          // v3: all materials still needed (was one type)
  | { kind: 'surplus'; type: PieceTypeId; needed: PieceTypeId[] } // v3, new: that material is complete
  | { kind: 'tooHigh' }                                     // unchanged (003)
  | { kind: 'groundworkFirst'; part: 'dig' | 'concrete' }   // unchanged (003)
  | /* other v2 kinds unchanged: notCrew, binFull, … */;
```

- `needed` is in recipe order, only materials with `left > 0`, possibly empty (stage just completed).
- The bin refusal uses `{ kind: 'binNotNeeded', type, needed }` (new) instead of the generic
  `notCrew` / `binFull` when the reason is demand (FR-018); `binFull` stays for a full bin.
- Validation (`validateHint` in shared) rejects unknown types and arrays longer than 2.

### `snap`

Unchanged (`{ plot, slot, pieceType, via }`); `slot` is now the per-material index of the SlotRef
(data-model §6). Clients that animate the snap look the slot up with `openSlotRefs()` before applying
the patch.

## Dev cheats (`HHT_DEV_CHEATS=1`)

- `fillStage(plot)`: fills every recipe item of the current stage (high slots counted as crane fills).
- `fillMaterial(plot, type)` (new): fills the remaining ordinary slots of one material, for tests.

## Bandwidth

No new per-tick data. Worst case: one extra byte in a plot patch per delivery; the 30 KB/s budget is
unaffected (re-measured by the load test, SC-006).
