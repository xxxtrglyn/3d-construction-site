# Data Model: Single-Player Playable Prototype

All game-rule types live in `packages/shared` (pure TypeScript, no Three.js, no DOM), so the
multiplayer server can reuse them later. The client keeps the runtime and visual state.

## GuestProfile (client, stored on the device)

| Field | Type | Rules |
|---|---|---|
| `version` | `1` | Storage key `hht.profile.v1`; unknown versions are regenerated |
| `name` | string | Built from `NAME_ADJECTIVES` × `NAME_NOUNS` (+ optional 2-digit suffix); 3–20 chars; never free text |
| `hatColor` | `HatColorId` | One of 8 palette ids (`yellow`, `orange`, `white`, `red`, `teal`, `pink`, `purple`, `lime`) |
| `muted` | boolean | Default `false` |
| `hintsDone` | `{ firstPickup: boolean; firstSnap: boolean }` | Controls FR-022 hints |
| `createdAt` | ISO date string | Informational |

- **Invalid or corrupt data**: regenerate a new profile; never throw.
- **Storage unavailable**: keep the profile in memory only (edge case).

## PieceTypeId and PieceTypeDef (shared)

```text
PieceTypeId = 'beam' | 'brick' | 'panel' | 'paint' | 'decor' | 'bell' | 'cone'
```

| Field | Type | Notes |
|---|---|---|
| `id` | PieceTypeId | |
| `label` | string | Shown in hints ("Steel beam") |
| `iconId` | string | HUD icon above the plot |
| `fillsSlots` | boolean | `false` only for `cone` |
| `mass` | number (kg, gameplay units) | Toss distance scales with 1/mass |
| `carryPose` | `'twoHands' \| 'shoulder' \| 'hug'` | Beam = shoulder, bell = hug, others = twoHands |
| `collider` | `{ shape: 'box' \| 'cylinder'; size: [x, y, z] }` | Used when the piece is loose |

## Blueprint, StageDef and SlotDef (shared, static data)

```text
Blueprint {
  id: 'clock-tower'
  name: 'Clock Tower'
  stages: StageDef[6]        // ordered, index 0..5 → stage numbers 1..6
}
StageDef {
  number: 1..6
  name: 'Frame' | 'Walls & Floors' | 'Roof & Windows' | 'Paint' | 'Decoration' | 'Masterpiece'
  pieceType: PieceTypeId     // must have fillsSlots = true
  slotCount: number          // 6, 8, 6, 4, 5, 1
  starsAfter: number         // 1, 2, 3, 4, 5, 5 (gold)
  modelId: string            // 'clock-tower-stage-<n>'
}
```

Validation (unit-tested):

- There are exactly 6 stages, numbered 1..6 in order.
- `slotCount` is at least 1, and the total over all stages is 30.
- Every `pieceType` is one with `fillsSlots = true`.
- `starsAfter` never decreases and is capped at 5.

## TowerProgress (shared state + pure transition functions)

| Field | Type | Notes |
|---|---|---|
| `blueprintId` | string | `'clock-tower'` |
| `completedStages` | 0..6 | 0 = empty foundation |
| `filledSlots` | number | Slots filled in the stage currently being built (0..slotCount) |
| `stars` | 0..5 | Derived: `starsAfter` of the last completed stage, else 0 |
| `isMasterpiece` | boolean | Derived: `completedStages === 6` |

State transitions (pure functions in `shared/src/progression.ts`):

```text
deliver(progress, pieceType) → { progress', result }
  result ∈ { 'snapped', 'stageComplete', 'masterpiece', 'wrongPiece', 'alreadyComplete' }

  if isMasterpiece                                   → 'alreadyComplete' (no change)
  if pieceType ≠ currentStage.pieceType              → 'wrongPiece'      (no change)
  filledSlots += 1
  if filledSlots < slotCount                         → 'snapped'
  completedStages += 1; filledSlots = 0
  if completedStages == 6                            → 'masterpiece'
  else                                               → 'stageComplete'

reset(progress) → initial progress (completedStages 0, filledSlots 0)
neededPiece(progress) → PieceTypeId | null
```

Invariant: one `deliver` call changes `filledSlots` or `completedStages` by at most 1, so a piece
can never fill two slots (FR-010).

## Piece (client runtime)

| Field | Type | Notes |
|---|---|---|
| `id` | number | Unique per session |
| `type` | PieceTypeId | |
| `state` | `'held' \| 'loose' \| 'flying' \| 'snapped'` | Pieces on racks are not entities; they are created when picked up |
| `lastTouchedAt` | ms timestamp | For the 60 s fade |
| `body` | physics handle \| null | Present only while `loose` (dynamic body) |

Transitions:

```text
(rack) --pickup--> held --drop--> loose --pickup--> held
held --toss--> loose (with velocity)
held/loose --enter build zone & matches--> flying --arrive--> snapped
held/loose --enter build zone & wrong--> loose (bounced out, hint shown)
loose --untouched 60 s or count > 30--> removed (fade)
loose --fell below y = -5--> removed
snapped --stage complete--> removed (merged into the stage model)
```

Rules: at most one held piece; at most 30 loose pieces (the oldest fades first, FR-012).

## SupplyRack (client, static layout data)

| Field | Type | Notes |
|---|---|---|
| `pieceType` | PieceTypeId | One rack per type (6 racks plus a cone pile) |
| `position` / `rotation` | vec3 / yaw | Layout in `client/src/world/layout.ts` |
| `pickupRadius` | number (m) | 1.2 m |

Racks are unlimited and display 3–6 instanced copies of their piece.

## TowerPlot (client)

| Field | Type | Notes |
|---|---|---|
| `progress` | TowerProgress | Source of truth for the stage |
| `center` | vec3 | |
| `buildZoneRadius` | number (m) | 3.0 m around the tower center (tower exported at 1.6× scale) |
| `slotMarkers` | positions[] | Ring layout; count = current stage `slotCount` |
| `signStars` | 0..5 + gold flag | Mirrors `progress.stars` |

## Asset manifest (generated by the pipeline)

See `contracts/asset-manifest.schema.json`. The client loader reads `assets/manifest.json` to
decide the critical and deferred loads and to verify file hashes when caching.
