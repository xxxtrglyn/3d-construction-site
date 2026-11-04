# Research: Construction Machines (003)

These are the Phase 0 decisions for [spec.md](./spec.md). Each one lists the decision, the
rationale and the alternatives considered. The design builds on the 002 architecture:
- a pure 60 Hz `stepWorker()` shared by the client and the server;
- binary per-client snapshots with interest tiers;
- Colyseus schema patches for low-frequency state;
- SQLite persistence keyed by shift epoch.

## M1. Machine simulation: one pure, deterministic `stepMachine()` in `shared`

- **Decision**: add `packages/shared/src/machines.ts`, with
  `stepMachine(state, input, dt, ctx) → MachineState`. It runs at the same fixed 60 Hz (`SIM_DT`)
  as `stepWorker()`. Each machine is a kinematic rig with a few parameters (see data-model §1). There
  are no rigid bodies, joints or forces. Collision uses footprint circles against the static
  `ObstacleBox`/`ObstacleCyl` sets and a "drivable region" rule (M7), with the same slide resolution
  as the worker controller.
- **Who runs it**:
  - the server, which is authoritative;
  - the operating client, for prediction and replay (M3);
  - **solo mode**, through the same function (FR-042);
  - the load-test bots, which only send inputs.
- **Rationale**:
  - Principle III says "kinematic rigs driven by parameters".
  - The CLAUDE.md rule says movement uses only deterministic shared code on both sides.
  - Owner decision B (solo gets the machines) requires one definition for both modes.
  - Machines then need no Rapier at all, in solo or in multiplayer.
- **Alternatives**:
  - **Rapier kinematic bodies**: solo-only, not deterministic across builds, and it would fork the
    rules between the modes.
  - **Server-only simulation with client interpolation for the operator**: 100–250 ms of input lag
    makes the crane unusable. SC-001 needs the machine to respond immediately.

## M2. Machine inputs ride the existing move-input stream

- **Decision**: while a player operates a machine, their existing `MoveInput` stream (60 Hz, seq'd,
  batched ≤ 12) drives the machine instead of the worker. The input byte gains one bit:
  - bit 0 = `run` (unused in machines);
  - bit 1 = `jump` (**exit**, in machines);
  - bit 2 = **`act`**, new, an edge-triggered action press;
  - bit 3 = **`alt`**, new, the toss button (crane camera toggle). It is client-only, so the server
    ignores it, but it is reserved here so the input stays one stream.
- **Discrete intents** stay JSON messages:
  - `machine {op:'enter', id}` (needs the permission and range checks of FR-006);
  - `machine {op:'exit'}`, which is the server's answer to a jump edge. The client also sends it as
    a reliable fallback.
- **Rationale**:
  - The action must be applied at the exact simulation step where the operator pressed it. For
    example, a crane release snaps only if the hook is within 1.5 m at that step (FR-027).
  - A separate JSON message would race the input stream and break prediction replay.
  - The seq'd stream already gives ordering, acks and replay.
- **Alternatives**:
  - **A JSON `act` message with a client timestamp**: needs server-side rewind, and it is
    cheatable.
  - **A separate machine input stream**: duplicates the batching, acks and rate limiting.

## M3. Operator prediction and other players' view

- **Decision**:
  - **Operator**: predicts `MachineState` with the same replay buffer as the worker (`prediction.ts`
    becomes generic over the state type). Corrections blend over 150 ms (`NET.correctionBlendMs`).
  - **Discrete outcomes** are not predicted for their effects. Snapping, scoop counts, pallet
    pickup, mixing and piece release are shown only when the server's events arrive. The pose (arm
    swinging, hook lowering, bucket curling) is predicted.
  - **Other players**: interpolate machine records from snapshots with the same per-tier delays as
    workers (`NET.interpDelayMs`).
- **Rationale**: this is the 002 split. Motion is predicted, and game state is authoritative. A
  piece "half-snapped" and then taken back would be worse than a short wait (≤ 1 RTT).
- **Alternatives**: predicting snaps and rolling back. This is the most complex option, and the
  wait it hides is under 150 ms.

## M4. Wire format: a compact machine record in the binary snapshot (protocol v2)

- **Decision**: bump `PROTOCOL_VERSION` to **2**. Old clients get close code 4001 ("A new version
  is ready"). Two changes go into the snapshot:
  1. **Worker record, byte 9**: anim 3 bits, carry **4** bits, emoting 1 bit. The 9 piece types
     (adding `cement` and `concrete`) no longer fit 3 bits. A new anim `seated = 6` is added for
     operators.
  2. **A machine block after the entity block**: a u8 count, then **12-byte** records:
     - `id u8`: plot × 4 + kind;
     - `x, z i16` in cm, and `yaw u8`;
     - `p1 i16, p2 i16, p3 u8`: kind-specific parameters (data-model §1);
     - `flags u8`: operator present, load code (4 bits), and an action phase (2 bits).
  - The **own block** gains `inMachine u8` (0xff = none). When the player is in a machine, its
    full-precision `MachineState` follows (7 × f32 + 2 B = 30 B, only while operating), for
    reconciliation.
- **Rates and suppression**: a machine record is sent to a receiver when the machine is **due**
  under that receiver's interest tier (the same `tierFor`/`isDue` rules, keyed by machine id + 4096)
  **and** when it changed since the last record sent to that receiver, or a 2 s keyframe is due.
  Parked, idle machines therefore cost about nothing.
- **Budget estimate**:
  - **Worst case** (load test, every plot busy, about 20 machines moving at once): about 20 × 12 B ×
    a blended ~9 Hz ≈ **2.2 KB/s** per receiver, plus keyframes for the 28 idle machines (28 × 12 B
    / 2 s ≈ 0.17 KB/s).
  - **Today's average** is 15.4 KB/s, so there is ample headroom under 30 KB/s.
- **Rationale**: the same reasoning as 002 R4. Schema patches cannot do per-receiver rates, and
  float32 fields cost about 4× the bytes.
- **Alternatives**:
  - **Machines as schema entities**: about 48 × 9 fields × float32 at the 10 Hz patch rate, with no
    per-receiver tiers.
  - **Reusing the 10-byte worker record**: there is no room for the rig parameters.

## M5. Low-frequency machine state goes in the Colyseus schema

- **Decision**: `PlotState` gains:
  - `groundDug u8`, `groundPoured u8`;
  - `highFilled u8` (the high slots filled in the current stage);
  - `mixerBags u8`, and `mixerMixUntil f64` (0 = idle);
  - `machineOps`: an array of 4 strings, holding the operator's session id or `''`;
  - `hookType` and `palletTypes`: the load contents as `PieceTypeId` strings.
- **Rationale**: these values change at human speed. The schema gives reliable ordering with the
  other plot state, which the HUD, the plot sign and the cue rule (FR-022a) need.
- **Alternatives**: all of it in snapshots. That is unreliable for discrete state, and the operator
  and load would arrive out of order with crew changes.

## M6. Progress model: Groundwork and high slots extend `TowerProgress` (pure, unit-tested)

- **Decision**:
  - The `Blueprint` gains `groundwork: { scoops: 6, concrete: 4 }`.
  - Each `StageDef` gains `highSlots` (Clock Tower: stage 3 has 3 high slots, stage 6 has 1, all
    others have 0). `slotCount` stays the total, so stars and stage counts are unchanged.
  - `TowerProgress` gains `groundDug`, `groundPoured` and `highFilled`.
  - `filledSlots` stays **total** filled. Hand slots filled = `filledSlots − highFilled`.
- **New pure transitions** in `progression.ts`:
  - `dig(p)`, `pour(p)`;
  - `deliver(p, type, via: 'hand' | 'crane' | 'forklift')`, which returns `'tooHigh'` for a hand or
    forklift piece when only high slots remain, and `'groundworkFirst'` before Groundwork is done.
- **Rule**: a hand delivery takes the next **hand** slot. A crane delivery takes the slot it is
  aimed at (high or hand, FR-027). With M6 counters the outcome does not depend on which ring is
  used, so the rule needs no per-slot identity beyond hand versus high.
- **Rationale**:
  - It is the minimal change to the 001/002 counter model, which the client, the server, persistence
    and the bots all use.
  - The stars and stage numbers players already know stay as they are.
- **Alternatives**:
  - **Per-slot bitmasks**: more state and more migration, with no gameplay benefit.
  - **Groundwork as a 7th stage**: changes stars, `STAGE_COUNT`, the tower models and every "6
    stages" text in the UI.

## M7. Site layout: per-plot machine spots and drivable regions, generated by the Blender builder

- **Decision**: `site_layout.py` (the single source of truth, as in 002) generates, for each plot:
  - `pit`: equal to the tower footprint, so the pit is where the tower will stand;
  - `spoil`: a heap 4.5 m to the side;
  - `hookPad`: 2.4 × 2.4 m;
  - `crane`: the base, behind the tower on the outer side, with `reachMin` 2.5 m and `reachMax`
    7.5 m;
  - `mixer`: position, yaw, hopper point and chute point;
  - `parking` for the excavator and the forklift;
  - `yardRadius` = 6.0 m.
- **The site gains**:
  - a **cement rack** in each of the 4 rack yards (type `cement`);
  - a `noDrive` rule: the plaza circle (spawn zone) + 1 m, beyond `playRadius − 1.5`, and every
    *other* plot's yard circle.
- **Drivable region rules**:
  - the **excavator** stays inside its own yard circle;
  - the **forklift** may go anywhere not in `noDrive`;
  - the **crane hook** must stay inside its own yard circle (which contains the plot, the pad and
    the bin), between the reach radii.
- **Removed**: the two static scenery machines (FR-005).
- **Fit check**: plots sit on a 24 m circle, so neighbouring plot centres are about 12.4 m apart.
  6 m yards leave a ~0.4 m gap. The forklift can still reach the racks through the lane between the
  plaza edge (r 9) and the yards (r 18–30). `site_layout.py` asserts there are no overlaps.
- **Solo**: `lot.py` gets the same spots around its single plot (a `SoloLayout` adapter turns
  `lot.glb` empties into the same `MachineSpots` type). The static solo crane and excavator are
  removed. The lot is 24 × 24 m, which has room behind and to the sides of the tower; the builder
  asserts this.
- **Alternatives**:
  - **Hand-placed coordinates in TypeScript**: these drift from the art, which 002 R9 already
    rejected.
  - **One shared machine pool in the plaza**: the owner decided on per-plot machines.

## M8. Rig kinematics and controls (starting values, tuned in playtests)

| Machine | Move input | Action (`act` edge) | Limits |
|---|---|---|---|
| Excavator | Tank drive: dz = forward/back 2.8 m/s, dx = turn 1.6 rad/s | Near the pit (bucket tip ≤ 1.2 m from the pit edge): **scoop** (0.9 s curl) → full. At its spoil heap (≤ 1.5 m): **dump** (0.7 s) → server `dig()`. Anywhere else with a full bucket: dump back, no count | Own yard only |
| Forklift | Car drive: dz = throttle 6.5 m/s (faster than the 5.5 m/s run, FR-031), dx = steer | At a rack (fork tip ≤ 1.0 m from the rack front): **load** a pallet of ≤ 4 of the needed type. In its own build zone: unload into slots (hand only). At its own mixer hopper: unload bags. Elsewhere: set down as loose pieces | `noDrive` |
| Crane | dx = slew ±0.9 rad/s, dz = trolley in/out 3 m/s | Hook auto-lowers (1.0 s) → grab the nearest loose piece within 0.8 m of the hook below, or release (snap if a matching empty slot is within 1.5 m, otherwise set down) → auto-raise (1.0 s). Input ignored while lowering or raising | Own yard circle, reach 2.5–7.5 m |
| Mixer | none (stationary) | With ≥ 1 bag: **mix** for 5 s → one concrete bucket per bag at the chute | — |

Common rules:
- `jump` = exit (FR-008).
- Toss = crane camera toggle (FR-008a).
- Entering needs empty hands, crew membership, a free seat and a distance of ≤ 1.5 m.
- 60 s with no input = exit (FR-011).

## M9. Workers vs machines: no collision, a seated operator

- **Decision**:
  - Machines collide only with static obstacles. They pass through workers and through other
    machines (FR-004).
  - An operating worker is **seated**: the server sets `session.machine = id`. The worker's position
    is derived from the machine's cab pose every step (`seatPose(machine)` in `shared`), it is not
    simulated, and it is encoded with anim `seated`.
  - On exit, the worker is placed at `exitSpot(machine)`: the first free spot of 4 candidates around
    the cab, checked against the static blockers. The fallback is the parking spot.
- **Rationale**: this rules out griefing by blocking and lane jams (US5), and needs no
  worker-to-machine physics.

## M10. Pieces held by machines

- **Decision**:
  - Server `PieceRec.state` gains `'hooked'` (one piece; it follows the hook) and `'pallet'` (≤ 4).
  - Hooked and pallet pieces are **not** loose: they do not fade and do not count toward
    `LOOSE_MP.maxLoose` (150).
  - They are removed from the schema `pieces` map while held. The client draws them from the
    machine record's load code and `hookType`/`palletTypes`. This saves patch bytes while the hook
    moves at 20 Hz.
  - On release, put-out or restart, the pieces become loose at `setDownSpot()`: the nearest
    walkable, non-pit, non-bin point within 2 m (spec Edge Cases).
  - Cement bags in the mixer and dirt in the bucket are counters, not pieces.
- **Alternatives**: keeping the held pieces in the schema with positions. That means 3 × float32
  patches at 10 Hz per piece, all for a pose the machine record already implies.

## M11. Persistence (schema_version 2)

- **Decision**:
  - The `building` table gains `ground_dug`, `ground_poured`, `high_filled` and `mixer_bags`
    (all `INTEGER NOT NULL DEFAULT …`).
  - The `bin_entry.piece_type` CHECK adds `cement` (concrete buckets cannot be binned: FR-020 says
    mixer output only, and binning them would bypass the crew rule).
  - Migration v1 → v2: `ALTER TABLE … ADD COLUMN`. Rows that already exist get `ground_dug = 6`,
    `ground_poured = 4` and `high_filled = 0`, so buildings in progress count as having finished
    Groundwork (spec Assumption).
  - Machine pose, operator and held loads are **not persisted** (FR-034). Held loads become loose at
    restart, like the 002 pieces.
- **Writes**: in the same per-tick transaction as the 002 building writes, on `dig`, `pour`,
  deliveries and mixer bag changes. That is at most a few per second per world.

## M12. Rendering: per-kind instanced rigs, two LODs, streamed after play starts

- **Decision**:
  - Four new assets: `machine-crane`, `machine-excavator`, `machine-forklift` and `machine-mixer`.
    Each is split into rig parts as named nodes, for example crane `Mast`, `Jib`, `Trolley`, `Hook`.
  - The client builds **one `InstancedMesh` per part per kind**, with 12 instances (one per plot),
    plus inverted-hull outlines for the near ones. That is about 4 + 4 + 3 + 2 = 13 parts × 2 (hull)
    ≈ **26 draw calls** for all 48 machines.
  - **LOD1** (merged and simplified, ≤ 600 tris per machine, no outline) beyond 30 m.
  - Assets are **deferred**: they load after the first frame, with a flat-colour box placeholder
    until then (FR-038). The critical payload does not change.
- **New perf scene**: `?perf=machines` = `?perf=crowd` plus all 48 machines posed mid-action.
- **Budgets**:
  - `render.machines`: high ≤ 300 draw calls / ≤ 700 k triangles, low ≤ 200 / ≤ 340 k;
  - `perAsset`: crane 220 KB, excavator 200 KB, forklift 150 KB, mixer 120 KB, and each LOD1
    ≤ 30 KB.
- **Why the triangle ceiling rises from 600 k to 700 k**: crowd high is already at 578 k. Twelve
  near-LOD cranes alone add about 60 k. Device fps (SC-007) remains the binding gate, and it is
  measured on the reference phones. The owner must approve this budget change (Principle III:
  budgets are numeric and recorded).
- **Alternatives**:
  - **Separate meshes per machine**: about 48 × 4 × 2 ≈ 380 draw calls.
  - **Hiding the machines of idle plots**: rejected by FR-002 (machines are always visible).

## M13. Cameras and cues (client only)

- **Crane cameras**:
  - **hook camera**: target = the hook, offset (0, +6, −6) rotated with the jib, smoothed;
  - **cab camera**: at the cab, looking along the jib.
  - Toss toggles between them. The choice resets to the hook camera on every enter (FR-008a).
- **Driving camera**: the existing `FollowCamera` with a target of the machine body and a +40 %
  distance.
- **Snap ring**: while the hook carries a piece, the client computes `snapTarget(...)` (a shared
  pure function, the same one the server uses). If it returns a slot, that ring is lit (FR-027a).
- **Machine cue**: `neededMachine(progress)` (shared, pure) returns the kind or null. The client
  shows the glow and the arrow for crew members only, while that machine's `machineOps` slot is
  empty (FR-022a).

## M14. Load-test bots and consistency counters

- **New bot behaviours**:
  - when the plot is in Groundwork, bots drive the excavator in a scripted loop (pit ↔ spoil) and
    feed the mixer;
  - in the crane stages, one bot carries pieces to the pad while another lifts;
  - about 30 % of hand-stage fetches use the forklift.
- **New counters**, all of which must be 0:
  - `machineOutsiderOps`: some bots deliberately try to enter other plots' machines. The counter
    goes up if any such attempt is accepted (the bot sees itself as operator);
  - `highFilledByHand` (an audit on the server);
  - `workerMovedByMachine` (the server audits that no worker position changed during a step where
    no input was applied to it);
  - `heldPiecesLost` (the piece-count invariant: loose + held + snapped + in mixer is conserved).
- The report schema gains the `machines` usage counts (data-model §6).

## M15. Rate limits

- **Decision**:
  - Machine inputs reuse the move-input bucket (60 Hz, already limited).
  - `machine` JSON intents get a new bucket class `machine` (capacity 6, refill 2/s), with the same
    strike rules (002 FR-058).
  - `act` edges are capped at 4 per second inside the input stream. Extra edges are ignored, not
    struck, because they can come from honest button mashing.

## M16. Solo integration

- **Decision**:
  - The solo `Game` keeps Rapier for the worker and the pieces (001), and adds a `SoloMachines`
    module.
  - `SoloMachines` steps the shared `stepMachine()` at 60 Hz from the same `Actions`, and applies
    the same `progression.ts` transitions.
  - Hooked and pallet pieces are removed from the Rapier world while held, then re-added as dynamic
    bodies at `setDownSpot()`.
  - Static obstacles for the machines come from `lot.glb` empties, through the solo layout adapter.
- **Seated worker in solo**: the Rapier character collider is disabled while operating, and its
  pose is driven by `seatPose()`.
- **Rationale**: one definition of the rules (FR-042) without moving the solo worker off Rapier.
  That change would be a separate, risky refactor that this feature does not need.
- **Alternatives**: porting the solo worker to `stepWorker()`. It is attractive long-term, but it
  is out of scope (Principle VII). It is noted as a follow-up.
