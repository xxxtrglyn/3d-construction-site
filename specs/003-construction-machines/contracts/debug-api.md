# Contract: Debug API additions (`?debug=1` / `?e2e=1`)

This contract extends [002 debug-api.md](../../002-multiplayer-core/contracts/debug-api.md). It is
used by e2e, perf and manual testing. It is not part of the gameplay contract.

## `window.__hht.net` (multiplayer)

| Member | Returns / does |
|---|---|
| `machines()` | `Array<{ id, kind, plot, x, z, yaw, p1, p2, p3, phase, operator: sessionId \| '', load }>`: the interpolated views (the own machine is predicted) |
| `myMachine()` | `MachineId \| -1` |
| `plots()` | the 002 fields + `groundDug, groundPoured, highFilled, mixerBags, hookType, palletTypes` |
| `cue()` | `{ plot, machine: MachineKind \| null }`: the machine the cue currently points at for me |
| `snapRing()` | `{ slot: number, high: boolean } \| null`: the lit ring while the hook carries a piece |
| `camera()` | `'follow' \| 'hook' \| 'cab' \| 'mixer'` |
| `dev.fillGround(plot)` | (`HHT_DEV_CHEATS=1`) completes Groundwork |
| `dev.machinePose(id, pose)` | (dev cheats) teleports a machine (tests only) |

## `window.__hht` (solo)

| Member | Returns / does |
|---|---|
| `machines()`, `myMachine()`, `cue()`, `snapRing()`, `camera()` | same shapes as in multiplayer (plot 0) |
| `plot.groundwork` | `{ dug, poured, done }` |

## Perf scenes

- `?perf=machines`: `?perf=crowd` (100 workers, 12 towers) plus 48 machines posed mid-action
  (hooks lowered, forks raised, buckets curled), offline. It sets `__hhtPerfReady`.
- `?shot=machines`: an art comparison camera on one plot with all 4 machines, to compare with
  `assets/renders/machines-plot.png`.
