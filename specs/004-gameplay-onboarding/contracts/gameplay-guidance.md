# Gameplay Guidance and Feedback Contract

## Shared rules

Proposed pure interfaces in `packages/shared/src/guidance.ts` and existing machine rules:

- `selectGuidance(context): GuidanceSuggestion | null` follows the priority ordering in [data-model.md](../data-model.md). Labels are selected by the client; rules contain no DOM or Three.js references.
- `forkliftLoadCount(progress, pieceType, mixerBags, blueprint): number` applies identical loading eligibility and quantities in server, solo, and client prompt prediction.
- A suggestion or preview is advisory. Existing authoritative action validation always decides the result.

## Network event extension

Extend `ServerEvents.machineAct` with `by: string | null` while retaining `id`, `plot`, and `act`. For direct successful actions (including dump, palletLoad, mixStart), the server sets `by` to the initiating player's session ID before any seat transition. Never accept actor attribution from client payloads. For asynchronous mixDone, `by` may be null; it is not a tutorial completion trigger.

New clients tolerate an absent `by` from older event producers as unknown, showing world effects without recording learning. Older clients ignore the additional field. No new client intent, endpoint, SQLite schema, or binary snapshot version is required. Update event fixtures, bots if affected, and shared event types together.

Crane learning uses existing `snap` only when `by` is the current player and `via` is crane. Excavator uses attributed dump, forklift uses attributed palletLoad, and mixer uses attributed mixStart. Seat entry, movement, input, dumpBack, hookRelease, and generic palletUnload do not complete learning.

Solo maps accepted local operations to the same outcomes; it does not fabricate network traffic.

## Presentation

- One primary next-action message and guidance target. Reuse machine cue, supply targeting, and existing exact crane slot ring; do not add a second crane targeting algorithm.
- First-use compact help stays until confirmed success or dismissal; help can be reopened. Active device labels use existing action bindings. No additional required gameplay button.
- Wrong piece → show required material and source; groundworkFirst → direct to current groundwork step; tooHigh → crane and staging destination; busy → useful supply action or honest occupied state; binFull/mixerFull → retain/stage load safely and name alternate valid action if any; access denial → join/request crew or permitted bin help.
- Unknown refusal/context → neutral retry/help message, not a made-up destination. Existing permission boundaries apply to all suggestions.
- Forklift HUD displays actual pallet count/capacity. Preview labels distinguish hopper delivery, valid construction delivery, and safe ground unload; overflow is described before action.
- Confirmed effects respect mute and reduced-motion preferences. Reduce motion using system preference and an existing setting if available; static flashes/text remain visible. No full-screen mandatory overlay.
- On shift reset, disconnect, or crew change, discard targets from the old context before computing the next suggestion.

## Compatibility obligations

Keyboard/mouse, touch, gamepad, solo, multiplayer, existing guests, and storage-unavailable sessions must work. Feedback cannot mutate progress, permissions, machine movement, or material ownership. Existing chat restrictions and additive-only construction remain in force.

## Implemented presentation adapters

`GameplayGuide` in `packages/client/src/ui/gameplayGuide.ts` is the common optional message/target UI. Shared guidance uses validated material labels directly; target variants include the existing chute and striped pad. Adapters supply whether loose concrete is available, preventing suggestions to collect from an empty chute. Ordinary sign/progress text is retained. Selected Foreman crew directions take precedence for visitors until they reach that crew sign.

`ConfirmedFeedback` and the learning milestone selector are stateless. Local profile state holds learned machines; lifecycle changes clear help, guidance, and pooled effects. No extra event journal or persistent feedback state is needed.

Solo debug inspection adds `supplyRacks()` (type and position only) to position the real forklift in browser tests; it is only exposed through the existing debug API.

Authoritative load-test usage adds `earlyCementLoads` and `earlyCementDelivered`; full local 100-bot runs require both counters ≥1, alongside the existing machine coverage and consistency checks.
