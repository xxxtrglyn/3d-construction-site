# Data Model: First Five Minutes of Construction

## GuidanceContext (derived; not persisted)

Inputs: mode (solo/multiplayer), crew/plot access, tower progress, held piece, own machine and load, occupancy by machine kind, mixer bags/capacity, relevant destinations, plot availability, nearby loose-concrete availability, and guidance visibility. Normalize existing state; do not introduce a second authoritative world model.

Solo supplies direct plot access and never requires a Foreman. Unknown or disconnected state produces no actionable target. A completed building produces no construction target.

## GuidanceSuggestion (derived)

Fields: stable action key, short user-facing message, optional material, and target discriminated as Foreman, machine, rack, hopper, spoil heap, pit, slot, bin, chute, pad, or none. One primary suggestion at a time. Suggestions never reserve jobs or authorize an action.

Priority: hidden/disconnected → none; own seated-machine operation → its next valid action; held material → valid destination/recovery; no multiplayer crew → Foreman or allowed helping route; free required machine → required operation; occupied excavator with available cement preparation → cement rack/forklift/hopper; otherwise permitted current-stage supply; no useful action → busy/free-play message. Refresh immediately on changes to these inputs. Hide the guidance arrow when none; retain ordinary construction slot markers.

## MachineLearningRecord (local profile)

Optional fields: `completedMachineHints: MachineKind[]`, `guidanceHidden: boolean`. Validate machine IDs, deduplicate, default to empty/false, and tolerate inaccessible storage with session memory. Preserve existing guest identity and unrelated fields. `seenMachineHints` remains backward-compatible but is not learning evidence.

Transitions: unseen → shown on entry; shown → dismissed explicitly (session only); shown/unseen → completed on attributable confirmed productive action; manual help → shown regardless of completion. Hiding help does not disable feedback. Reset stale pending action context on disconnect, crew change, or shift reset; completed learning persists on the device.

## ConfirmedFeedback (transient)

Fields: source event, actor, plot/machine reference, outcome, target when available. Use accepted dump, palletLoad, mixStart, and crane snap for tutorial milestones. machineAct/mixDone may show world effects but never complete a different player's tutorial. Existing attribution on snap is retained. One rendering path handles each incoming outcome; bounded effects expire and are discarded when their world context resets. A refusal has a recovery message and no success effect.

## Forklift loading rule (pure)

Inputs: progress, piece type, mixer bags, blueprint. Output: nonnegative integer no greater than pallet capacity. Cement is permitted during dig or concrete work; count = min(capacity, max(0, required concrete - poured - mixer bags)). After groundwork, retain current-stage material eligibility and existing hand/high-slot count behavior. Nonmatching/completed work returns zero. This is a per-load cap, not a global stock reservation. Server continues checking crew, range, machine ownership, and live load state.

No new database tables, migrations, building states, inventory entities, or binary snapshot fields.

## Implementation mapping

GuidanceSuggestion uses `key`, `text`, `target`, and optional `material`. The material is a validated PieceTypeId and text is assigned through textContent. ConfirmedFeedback is a stateless normalized event (`act`, optional `by`, `via`, `plot`, `id`); it needs no persisted lifecycle state. Mode adapters reject stale connection/crew context and clear presentation on world-context changes. MachineHints owns the session dismissal set, while ProfileStore owns successful-learning persistence.
