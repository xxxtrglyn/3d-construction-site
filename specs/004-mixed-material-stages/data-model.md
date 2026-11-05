# Data Model: Mixed-Material Stages (004)

Builds on the 003 data model (`specs/003-construction-machines/data-model.md`). Only changed or new
entities are listed. Decisions are explained in [research.md](./research.md).

## 1. RecipeItem (new, shared)

| Field | Type | Rule |
|---|---|---|
| `type` | `PieceTypeId` | must have `fillsSlots` (not cone, cement, concrete) |
| `count` | integer ≥ 1 | slots of this material in the stage |
| `high` | integer, 0 ≤ high ≤ count | how many of them are crane-only |

## 2. StageDef (changed, shared `blueprints.ts`)

| Field | Change |
|---|---|
| `pieceType` | kept: the **main material** (= `recipe[0].type`), names the look |
| `recipe` | **new**: `readonly RecipeItem[]`, 1–2 items, distinct types |
| `slotCount` | now derived: Σ `count` |
| `highSlots` | now derived: Σ `high` |

**Validation** (`validateBlueprint`): 6 stages; 1–2 recipe items per stage; `recipe[0].type ===
pieceType`; no duplicate type in a stage; at most one item with `high > 0`; per stage Σ `high` equals
the number of high-slot points in `site.gen.ts` for that stage (3 for stage 3, 1 for stage 6, else 0);
`TOTAL_DELIVERIES` = Σ `slotCount` (31 for `clock-tower`, 30 for `clock-tower-v1`).

### Blueprints

| id | Recipe per stage (type × count, high) |
|---|---|
| `clock-tower` (current) | 1: beam×4, brick×2 · 2: brick×6, beam×2 · 3: panel×4 (high 3), beam×2 · 4: paint×3, panel×1 · 5: decor×3, paint×2 · 6: bell×1 (high 1), decor×1 |
| `clock-tower-v1` (legacy, FR-004) | 1: beam×6 · 2: brick×8 · 3: panel×6 (high 3) · 4: paint×4 · 5: decor×5 · 6: bell×1 (high 1) |

`blueprintById(id)` returns one of these; unknown ids are a load error (as today).

## 3. TowerProgress (changed, shared `progression.ts`)

| Field | Type | Change |
|---|---|---|
| `blueprintId` | string | unchanged; selects the recipe version |
| `groundDug`, `groundPoured` | integer | unchanged (003) |
| `completedStages` | 0..6 | unchanged |
| `filled` | `readonly number[]` | **replaces `filledSlots`**: per recipe item of the current stage, filled slots incl. high |
| `highFilled` | integer | unchanged meaning: high slots filled in the current stage (all belong to the one high item) |

**Invariants** (unit-tested):
- `filled.length === recipe.length` of the current stage (0 after the Masterpiece).
- `0 ≤ filled[i] ≤ recipe[i].count`; `highFilled ≤ filled[h]` and `highFilled ≤ recipe[h].high`,
  where `h` is the high item.
- Ordinary fills of item `i` = `filled[i] − (i === h ? highFilled : 0)` ≤ `count − high`.
- On stage completion `filled` resets to zeros of the next stage's length and `highFilled` to 0.

Derived helpers: `filledTotal(p)`, `needsOf(p, bp)`, `neededSupplies(p, bp)`, `openSlots(p, bp)`
returning per type `{ ordinary, high }`.

## 4. Need (new, derived, shared)

| Field | Type | Meaning |
|---|---|---|
| `type` | `PieceTypeId` | recipe material |
| `total` | integer | `count` |
| `left` | integer | `count − filled[i]` |
| `highLeft` | integer | crane-only slots still open for this material |
| `craneOnly` | boolean | `left > 0 && left === highLeft` |
| `done` | boolean | `left === 0` |

Order = recipe order. Sign, HUD, Foreman line, machine cue and hints all read `needsOf()`.

## 5. DeliverResult (changed)

`'snapped' | 'stageComplete' | 'masterpiece' | 'groundworkFirst' | 'wrongPiece' | 'tooHigh' |
'surplus' | 'alreadyComplete'` — **`surplus` is new**: the material is in the recipe but complete.

### Transition `deliver(p, type, via, slot?, bp)`

1. Groundwork not done → `groundworkFirst`.
2. No current stage → `alreadyComplete`.
3. `type` not in recipe → `wrongPiece`.
4. Item `i` of `type`: if `left(i) === 0` → `surplus`.
5. If `via === 'crane'` and (`slot.high` or no ordinary slot left) and a high slot is open → fill high
   (`filled[i]++`, `highFilled++`).
6. Else if an ordinary slot of item `i` is open → fill ordinary (`filled[i]++`).
7. Else (only high slots of `i` remain, `via` is hand or forklift) → `tooHigh`.
8. If every item is full → `stageComplete` (or `masterpiece` after stage 6), else `snapped`.

## 6. SlotRef (changed, shared `machines.ts`)

`{ index, high, type, x, y, z }` — `index` is now **per material** (0-based within that material's
ordinary range or within the high points). Ordinary positions: `handSlotPositions(plot, ordinaryTotal)`
assigned to materials in recipe order (research R4). High positions: `spots.highSlots[stage − 1]`.

## 7. BinEntry rules (changed, shared `bin.ts`)

- `binAccepts(type, p, bin, bp)`: cement → 003 rule; else `needsOf(p).find(type).left −
  bin.filter(type).length > 0` and `bin.length < 10`.
- `takeFromBin(bin, prefer: PieceTypeId[])`: first entry whose type is in `prefer` (in `prefer`
  order), else the most recent donation.

## 8. PlotState (changed, server schema / client view)

| Field | Type | Change |
|---|---|---|
| `filledSlots` | uint8 | **removed** |
| `filledA` | uint8 | new: `filled[0]` |
| `filledB` | uint8 | new: `filled[1]` (0 when the stage has 1 item) |
| `highFilled`, `blueprintId`, `completedStages`, … | — | unchanged |

`progressOf(plotView)` rebuilds `TowerProgress` from these fields and the blueprint's current stage.

## 9. Building row (changed, SQLite v3)

`filled_slots` → `filled_a`; new `filled_b`; `blueprint_id` of rows existing at migration time →
`clock-tower-v1`. See [contracts/persistence-v3.sql](./contracts/persistence-v3.sql).

## 10. State transitions (unchanged shape)

`free → building (Groundwork → stage 1 … 6) → finished → (shift reset) free`. Only the condition for
leaving a stage changes: all recipe items full instead of `filledSlots === slotCount`.
