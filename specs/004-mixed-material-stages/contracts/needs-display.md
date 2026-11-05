# Needs Display Contract (feature 004)

How the remaining needs of a stage are shown and phrased. All displays read the shared
`needsOf(progress, blueprint)` (data-model §4), so they always agree (US2). All text comes from the
fixed templates below (no free text, constitution Principle V).

## Material chips

One chip per recipe material, in recipe order (main material first):

| State | Chip |
|---|---|
| `left > 0`, ordinary slots open | `● Beams 3` (piece colour dot + plural label + count) |
| `craneOnly` | `● Panels 3 🏗️` (crane mark; tooltip/aria "use the crane") |
| `done` | `● Bricks ✓` (dimmed) |

Labels and colour dots reuse `PIECE_TYPES[type].label` and the existing `PIECE_DOT` colours.

## Where

| Surface | Who sees it | Content |
|---|---|---|
| **Plot sign** (in world, multiplayer) | everyone near the plot | stage name + chips, e.g. `Frame · ● Beams 1 · ● Bricks ✓` |
| **HUD needs line** | crew members (own plot); solo player | the same chips; replaces "Needs: Beam 2/6" |
| **Foreman** (crew member opens the dialog) | the asking crew member | one templated line (below) |
| **Hints** (toast after a refused delivery) | the deliverer only | templated line (below) |
| **Machine cue** (003 glow + arrow) | crew members | crane cued when all remaining open slots are crane-only |

Updates: the sign and HUD re-render on every plot patch (≤ 1 s after a snap, FR-012).

## Foreman lines (crew member, current stage)

| Situation | Line |
|---|---|
| two materials left | "Bring {n1} {label1} and {n2} {label2}!" |
| one material left, ordinary slots | "Just {n} {label} to go!" |
| only crane slots left | "Only the crane can finish this: {n} {label} up top!" |
| Groundwork | 003 lines, unchanged |
| tower finished | 003 line, unchanged |

`{label}` is singular when `n === 1` ("1 beam", "2 beams").

## Hint lines (toast)

| Hint | Line |
|---|---|
| `wrongPiece`, `needed` = [a, b] | "The {stage} needs {a} and {b} now" |
| `wrongPiece`, `needed` = [a] | "The {stage} needs {a} now" |
| `surplus` | "Enough {type}, the {stage} needs {needed…} now" |
| `surplus`, `needed` empty | "Enough {type}!" |
| `tooHigh` | "Too high: use the crane" (003, unchanged) |
| `binNotNeeded` | "This plot has enough {type}: try {needed…}" |

Plural labels (`beams`, `bricks`, `panels`, `paint buckets`, `decor crates`, `golden bell`).

## Ghost slots

- Each open ordinary slot shows a translucent ghost of its material's piece model (toon ghost
  material, no outline), grouped by material along the slot arc in recipe order.
- High slots keep the 003 rings; the lit ring (crane within 1.5 m) is unchanged.
- Shown for plots within the "near" interest radius (002), and always for the player's own plot.
- Filled slots show nothing (the stage model and snap animation take over, as in 003).
