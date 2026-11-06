# Research: Mixed-Material Stages (004)

Decisions for [plan.md](./plan.md). Each entry: **Decision**, **Rationale**, **Alternatives considered**.
Code references are from the 003 code base on `develop` (`bd337a7`).

## R1. Recipe model in the blueprint

**Decision**: `StageDef` keeps `pieceType` as the stage's **main material** (it still names the
look and the stage model) and gains `recipe: readonly RecipeItem[]`, where
`RecipeItem = { type: PieceTypeId; count: number; high: number }` (`high` = how many of `count` are
crane-only). `slotCount` and `highSlots` become derived values (sums over the recipe), so code that
only needs totals keeps working through helpers. At most 2 items per stage in this feature; the
validator allows 1-2 so the legacy blueprint (R2) fits the same shape.

**Rationale**: the smallest change that makes every rule generic. Keeping `pieceType` avoids touching
the stage-model/art lookup and the star logic. A list (not a map) keeps a stable order: item 0 is the
main material, which gives a stable slot layout (R4) and display order (R6).

**Alternatives considered**: (a) per-slot type arrays (`slots: PieceTypeId[]`): more data, and the
order would leak into rules even though the spec says any order; (b) a `Record<PieceTypeId, n>` map:
no stable order, and "main material" would need a separate field anyway.

## R2. Versioned recipes for towers already in progress (FR-004)

**Decision**: the recipe version is the **blueprint id**. The current blueprint keeps the id
`clock-tower` (new recipes). The old one-material blueprint is kept as `clock-tower-v1`, expressed in
the same recipe shape (one item per stage). The v2→v3 database migration rewrites `blueprint_id` of
every stored building to `clock-tower-v1`. All rules take the blueprint by id through one registry
(`blueprintById(id)`), which already matches how `TowerProgress.blueprintId` and
`PlotState.blueprintId` exist today.

**Rationale**: no new column, no new schema field and no special case in the rules: a legacy tower
is simply a tower of another blueprint. The hourly shift reset clears legacy towers within an hour,
after which `clock-tower-v1` is never used again by new buildings (only by tests).

**Alternatives considered**: (a) a `recipe_version` column + schema field: duplicates what
`blueprint_id` already expresses; (b) reinterpreting old progress (fill the first N slots): forbidden
by FR-004 and confusing for crews mid-stage; (c) wiping in-progress towers on deploy: loses progress.

## R3. Stage progress counters

**Decision**: `TowerProgress` replaces `filledSlots` with `filled: readonly number[]`, one count per
recipe item of the current stage (high fills included), and keeps `highFilled` (only one material
per stage has high slots in every recipe, which the validator enforces). A derived
`filledTotal(p)` replaces the old scalar where a total is needed. On the wire and in SQLite the
array is two `uint8` fields (`filledA`, `filledB`; `filled_a`, `filled_b`), since recipes have at
most 2 items.

**Rationale**: counters (not slot bitmasks) keep the 003 "counter model" (research M6 of 003): any
order within a material is the same state, so a bitmask would add no information. Two fixed fields
are cheaper and simpler to replicate than an array schema.

**Alternatives considered**: a per-slot bitmask (agy's suggestion): needed only if slot order mattered
or slots were aimed at, which the spec rules out for hand deliveries; an `ArraySchema<uint8>`: extra
schema overhead for a fixed length of 2.

## R4. Slot layout and typed ghosts (FR-005, FR-011)

**Decision**: ordinary (hand) slot positions keep `handSlotPositions(plot, n)` (the arc around the
tower) with `n` = all ordinary slots of the stage. Positions are assigned to materials in recipe
order: the first `count − high` positions to item 0, the next to item 1. A material's next free slot
is the first unfilled index **within its own range**. High slots keep their fixed points from
`site.gen.ts` (3 for stage 3, 1 for stage 6) and belong to the one recipe item with `high > 0`.
`openSlotRefs()` returns typed refs from this layout for both the crane and the ghosts.

Ghosts: each open ordinary slot shows a translucent copy of its piece model (instanced per piece
type, toon ghost material, no outline), for plots within the 002 "near" interest radius; high slots
keep the 003 rings, now also tinted by material. Solo uses the same layout (replacing the plain
rings of `world/slotMarkers.ts`).

**Rationale**: the layout is a pure function of (plot, recipe), so server, clients, solo and bots
agree without sending positions. Grouping by material makes the two materials visibly distinct on
the arc. Instancing keeps draw calls at ≤ 6 extra (one per piece type).

**Alternatives considered**: interleaving materials around the arc (harder to read); per-slot
positions authored in Blender (needs a layout regeneration for every recipe tweak).

## R5. Delivering, surplus and refusal (FR-005 – FR-010)

**Decision**: `deliver(progress, type, via, slot?, bp)` stays the single pure transition. New order of
checks: groundwork → stage exists → `type` in recipe? (else `wrongPiece`) → material has an open slot
reachable by `via`? (ordinary for hand/forklift; ordinary or high for crane) → if only high slots of
that material remain and `via` is not crane: `tooHigh` (003) → if the material is complete:
`surplus` (new result) → fill. The stage completes when every item's `filled[i] === count`.
The server already applies deliveries one at a time inside the room (Colyseus message handlers and
the tick run on one thread), so simultaneous deliveries are serialized and the second of two "last
brick" deliveries becomes `surplus` (FR-009) with no extra locking.

Refused pieces (`wrongPiece`, `surplus`) are set down just outside the build zone (existing
`pushOut`); `tooHigh` keeps the 003 spot at the foot of the tower.

**Rationale**: one pure function is unit-testable for every edge case in the spec; the server only
orchestrates (CLAUDE.md rule of thumb).

**Alternatives considered**: keep surplus as `wrongPiece` (the hint could not say "Enough bricks");
queue surplus pieces for the next stage (pieces would vanish from the ground, violating "never
silently consumed").

## R6. Needs summary, sign, HUD, Foreman and hints (FR-011 – FR-015)

**Decision**: one pure `needsOf(progress, bp): Need[]` with
`Need = { type; total; left; highLeft; craneOnly; done }`, in recipe order. Every display reads it:

- **Plot sign** (`netWorld.plotNeedText`, solo HUD): `🪵 1 · 🧱 ✓ · 🟦 3 🏗️` style chips (icon from
  the existing piece colour dot + label, count, check mark, crane mark).
- **HUD** (`hud.setNeed` → `hud.setNeeds(needs)`): the same chips for the player's own plot.
- **Foreman** (crew member talking to him): one line from fixed templates, e.g. "Bring 2 bricks and
  1 beam!", "Only the crane can finish this: 3 panels up top!".
- **Hints**: `HintEvent` `wrongPiece` gets `needed: PieceTypeId[]` (all materials still needed) and a
  new `{ kind: 'surplus', type, needed: PieceTypeId[] }`. The client formats "Enough bricks, the
  Frame needs beams now" from fixed templates (no free text, Principle V).
- **Machine cue** (`neededMachine`): crane when every remaining open slot of the stage is high
  (`needs.every(n => n.done || n.craneOnly)`), otherwise as in 003.

**Rationale**: one derived summary guarantees the sign, the HUD and the Foreman agree (US2 test).
All text stays templated.

**Alternatives considered**: sending the summary from the server (redundant: it is a pure function of
replicated counters).

## R7. Forklift pallets (FR-016, FR-017)

**Decision**: `neededSupply()` becomes `neededSupplies(p, bp): PieceTypeId[]` (cement during the
concrete part of Groundwork, otherwise the materials with `left > 0`). Pallet size at a rack of
type `t` = `min(palletMax, ordinaryLeft(t) > 0 ? ordinaryLeft(t) : highLeft(t))` (the 003 formula,
per material). A rack type not in the list shows "<Material>: not needed". Pallets stay one type.
Unloading delivers piece by piece through `deliver()`; leftovers are set down as in 003.

**Rationale**: the 003 logic already sizes by remaining demand; only the "which material" input
changes. Shared helper used by server, solo and the rack button label.

**Alternatives considered**: mixed pallets (out of scope per spec).

## R8. Supply bin (FR-018, FR-019)

**Decision**: `canBin(type, bp)` becomes `binAccepts(type, progress, bin, bp)`: cement keeps the 003
rule; any other type is accepted only while `need(type).left − count(bin, type) > 0` for the current
stage, and the bin has room (10). `takeFromBin(bin, prefer)` takes a preference **list**
(`neededSupplies`), falling back to the most recent donation. Pieces already binned are never
deleted when the stage changes.

**Rationale**: stops the bin from filling with pieces the crew cannot use (codex risk note), while
keeping 002's kindness flow.

**Alternatives considered**: accept any blueprint material as today (bins clog with paint during the
Frame).

## R9. Persistence (schema v3)

**Decision**: `SCHEMA_VERSION = 3`. Migration v2→v3 (one transaction): rename `filled_slots` →
`filled_a` (SQLite `ALTER TABLE … RENAME COLUMN`), add `filled_b INTEGER NOT NULL DEFAULT 0
CHECK (filled_b >= 0)`, and `UPDATE building SET blueprint_id = 'clock-tower-v1'`. See
[contracts/persistence-v3.sql](./contracts/persistence-v3.sql). Restore maps the two columns to
`filled[]` of the stored blueprint's current stage.

**Rationale**: additive and reversible in spirit; legacy rows keep their exact meaning
(`filled_a` = the old `filled_slots`, item 0 of the legacy one-item recipe).

**Alternatives considered**: a JSON progress column (harder to CHECK, and 002/003 use plain columns).

## R10. Protocol v3

**Decision**: `PROTOCOL_VERSION = 3`. Changes: `PlotState.filledSlots` → `filledA` + new `filledB`
(`uint8`); `HintEvent` changes of R6; `snap` event unchanged (it already carries `pieceType`). Old
v2 tabs get the existing 4001 "new version, reload" prompt. Bandwidth: +1 byte per plot patch only
when it changes, negligible against 30 KB/s.

**Rationale**: the field rename makes the new meaning explicit and is free under a version bump.

**Alternatives considered**: keep `filledSlots` meaning "item 0" (misleading name).

## R11. Stage art: second-material details (FR-002, FR-024)

**Decision**: `tools/blender/builders/clock_tower.py` adds the second material's look to each stage
model, built from existing helpers and materials: Frame → brick footings at the 4 columns; Walls →
beam lintels over the windows; Roof → beam ridge pole; Paint → panel trim boards; Decoration → paint
touches (coloured stripes on the fence/banners); Masterpiece → decor weathervane next to the bell.
Each stage model stays inside its `budgets.json` entry (600 k triangles cap per stage, LOD1 40 k).
Owner review renders go to `assets/renders/clock-tower-stages-004.png` before integration.

**Rationale**: the spec asks for the second material to be visible on the tower; small details keep
silhouettes (and the approved look) intact.

**Alternatives considered**: no art change (the second material would vanish once snapped, which
feels like the pieces were eaten).

## R12. Bots and load test (FR-021, SC-005)

**Decision**: bots pick their fetch type from `neededSupplies()`, choosing the material with the
most `left` minus pieces already carried toward the plot by crew bots (spreads crews over both
racks); crane and forklift jobs use the per-material `openSlotRefs`/pallet helpers. The load-test
report gains `stalledTowers` (a building whose needs do not change for 120 s while crew bots are
connected) and keeps the overfill check with per-material counts. Pass rule: `stalledTowers == 0`
and towers completed per shift ≥ the 003 baseline in `loadtest-report-v2`.

**Rationale**: directly measures SC-005 and catches deadlocks (agy risk note).

**Alternatives considered**: random type choice (bots would bring surplus constantly and skew SC-002
style metrics).

## R13. Debug and test tooling

**Decision**: `fillStage` (dev cheat) loops over the recipe; `__hht` debug APIs expose `needs()`;
the solo debug `deliver(type)` stays. E2E specs that used one-type stages are updated (carry-snap,
stages, masterpiece, mp-crew, mp-foreman, mp-machines, solo-machines) and a new `mp-recipes.spec.ts`
covers US1-US4.

**Rationale**: tests keep using the shared helpers, so recipe tweaks do not break them.

**Alternatives considered**: none.
