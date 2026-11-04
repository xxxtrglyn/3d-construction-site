# Quickstart & Validation Guide: Construction Machines (003)

## Prerequisites

The prerequisites are the same as in [002 quickstart](../002-multiplayer-core/quickstart.md): Node 24
(`nvm use`), pnpm 10.33+, Blender 5.2 for `pnpm assets`, and the Playwright browsers.

## Setup and run

```bash
pnpm install
pnpm assets          # rebuilds site (machine spots, cement racks, no static machines), lot, and the 4 machines + LOD1
pnpm dev             # server :2567 + client; a v1 client is told to reload (protocol 2)
```

- **Two players**: two windows, or a normal and a private window.
- **Phone**: open the network URL that `--host` prints.
- **Solo**: `?solo=1`. All four machines and Groundwork are on the solo lot.
- **Fast testing**: `HHT_DEV_CHEATS=1` enables `__hht.net.dev.fillGround(plot)` and
  `dev.fillStage(plot)`.

## Automated checks

| Command | What it proves (in addition to 002) |
|---|---|
| `pnpm test` | **shared**: `stepMachine` determinism (recorded-input replay is bit-identical), the rig limits and the drivable regions for each kind, `snapTarget` (1.5 m, nearest slot, matching type), `canEnter`, `dig`/`pour`/`deliver` with `via` (`groundworkFirst`, `tooHigh`), `neededMachine`, `setDownSpot`, and the v2 codecs (round trip; carry code 4 bits). **server**: enter/exit permissions, put-out on leaving the crew, disconnect and idle, hook and pallet piece conservation, the mixer, restart restore (Groundwork, bags; machines parked), shift reset, the v1 → v2 migration |
| `pnpm e2e` | multiplayer: a crew does Groundwork (excavator + mixer), the crane lifts the bell, a forklift pallet fills bricks, an outsider gets "Crew only", and the operator is put out on leaving the crew. Solo: the same machine flow on the lot |
| `pnpm perf` | `?perf=machines` against `render.machines` (high ≤ 300 draw calls / ≤ 700 k tris; low ≤ 200 / ≤ 340 k) |
| `pnpm check:budgets` | the 4 machine assets and their LOD1s are within `perAsset`; the critical payload is unchanged (the machines are deferred) |
| `pnpm loadtest` | bots use every machine; the 002 budgets plus the machine counters and consistency counters ([contracts/loadtest-report-v2.md](./contracts/loadtest-report-v2.md)) |
| `pnpm verify` | all of the above, with the quick load test |

## Manual scenarios (multiplayer: 2–3 windows)

1. **Enter and drive (US1)**: Host A starts a building and walks to the excavator. The prompt shows
   "Get in". Drive and turn, then press Space to get out. Window B, which is not crew, sees "Crew
   only". After B joins the crew while A is driving, B sees "Someone is driving".
2. **Groundwork (US2)**:
   - A beam delivered by hand is refused with "Dig the foundation first".
   - Do 6 scoops (scoop at the pit, dump at the spoil heap). The pit visibly deepens and the sign
     shows "Dig 6/6".
   - Carry cement bags into the mixer (it holds up to 4), get in, and press Mix. After 5 s, 4
     buckets come out of the chute.
   - Carry the buckets into the pit. Groundwork completes with a celebration, and Frame unlocks.
3. **Crane (US3)**:
   - At Roof & Windows, a hand delivery to a high slot is refused with "Too high: use the crane".
   - Put a panel on the hook pad and get in the crane: the hook camera is active. Press Q to switch
     to the cab camera and back.
   - Grab the panel and swing it toward a roof slot. The ring lights up within 1.5 m. Release: it
     snaps.
   - Also try a hand slot with the crane (it snaps), and a release far from any slot (the piece is
     set down).
4. **Forklift (US4)**: drive to the brick rack and press "Load 4 bricks". Drive back and unload in
   the build zone: 4 slots fill. Try to drive into the plaza or another plot's yard: the forklift
   stops at the edge. Drive through other workers: nobody is pushed.
5. **Fairness (US5)**: B operates the crane while holding a piece on the hook. A removes B from the
   crew: B is put out within 2 s and the piece is set down. Idle for 60 s in a machine: you are put
   out.
6. **Restart and shift (US6)**: dig 3 scoops and load 2 bags, then press Ctrl-C and run `pnpm dev`
   again. "Dig 3/6" and 2 bags are still there, and all machines are parked and empty. Then
   `HHT_SHIFT_MINUTES=3`: at the reset everything is parked and new buildings start at Groundwork.
7. **Solo (US6)**: `?solo=1`. Finish a whole tower alone, using every machine.
8. **Cue (FR-022a)**: the needed machine glows with an arrow for crew members only, and the arrow
   hides while someone is in that machine.

## Reference devices and art

- **Devices** (SC-007): the same as in 002. Measure `?perf=machines&q=low` on the phones and
  `?perf=machines` on desktop, and play a live world while `pnpm loadtest --url
  http://<lan-ip>:2567 --duration 600` runs.
- **Art** (FR-037): the owner approves these review renders before integration:
  - `assets/renders/machine-crane.png`
  - `assets/renders/machine-excavator.png`
  - `assets/renders/machine-forklift.png`
  - `assets/renders/machine-mixer.png`
  - `assets/renders/machines-plot.png`

  After integration, `?shot=machines` gives the in-game comparison.

## Phase validation gate

Record the results in `specs/003-construction-machines/gate.md`.

- [ ] Before starting: 002 gate open items accepted, or the risk accepted by the owner (constitution workflow)
- [ ] `pnpm verify` green, including WebKit e2e and the quick load test
- [ ] Full 5-minute 100-bot load test with machines passes; machines exercised (`groundworkDone ≥ 4`, `craneSnaps ≥ 8`, `palletUnload ≥ 10`)
- [ ] 30-minute soak: retained-heap slope ≤ 0.5 MB/min, no disconnects
- [ ] All consistency counters 0, including `machineOutsiderOps`, `highFilledByHand`, `workerMovedByMachine` and `heldPiecesLost` (SC-006)
- [ ] Restart: Groundwork and mixer bags restored exactly; machines parked and empty (SC-008)
- [ ] `render.machines` budget change approved by the owner; phones at ≥ 30 fps on `?perf=machines&q=low` and in a live world (SC-007)
- [ ] Owner approves the 4 machine renders and the plot layout render (FR-037)
- [ ] Playtest: ≥ 4 of 5 operate a machine within 90 s unaided (SC-001); crew of 3 finishes Groundwork ≤ 5 min and a tower ≤ 25 min (SC-002); ≥ 4 of 5 say the machines were fun (SC-003); solo tower ≤ 30 min (SC-009)
