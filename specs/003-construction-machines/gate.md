# Phase validation gate: Construction Machines (003)

Checklist from [quickstart.md](./quickstart.md) → "Phase validation gate". Results are filled in by
T080.

- [x] Before starting: 002 gate open items accepted, or the risk accepted by the owner (constitution workflow)
  - **2026-11-04: risk accepted by the owner.** Implementation of 003 proceeds while these 002 items stay
    open: phones at ≥ 30 fps on `?perf=crowd&q=low` (Pixel 6a, iPhone 12), a phone in a live 100-bot
    world, owner approval of the Foreman and the site layout, and the 002 playtest. They are re-checked
    together with the 003 device and playtest items below.
- [x] `pnpm verify` green, including WebKit e2e and the quick load test — see Results (each step run green on
  2026-11-04; the e2e server ran on `HHT_E2E_PORT=2587` because a `pnpm dev` held 2567)
- [x] Full 5-minute 100-bot load test with machines passes; machines exercised (`groundworkDone ≥ 4`, `craneSnaps ≥ 8`, `palletUnload ≥ 10`)
- [x] 30-minute soak: retained-heap slope ≤ 0.5 MB/min, no disconnects
- [x] All consistency counters 0, including `machineOutsiderOps`, `highFilledByHand`, `workerMovedByMachine` and `heldPiecesLost` (SC-006)
- [x] Restart: Groundwork and mixer bags restored exactly; machines parked and empty (SC-008) — `restore.test.ts`
  (file database, real restart)
- [ ] `render.machines` budget change approved by the owner; phones at ≥ 30 fps on `?perf=machines&q=low` and in a live world (SC-007)
- [ ] Owner approves the 4 machine renders and the plot layout render (FR-037)
- [ ] Playtest: ≥ 4 of 5 operate a machine within 90 s unaided (SC-001); crew of 3 finishes Groundwork ≤ 5 min and a tower ≤ 25 min (SC-002); ≥ 4 of 5 say the machines were fun (SC-003); solo tower ≤ 30 min (SC-009)

## Owner review: machine art (T006)

- [ ] Owner approves `assets/renders/machine-crane.png`, `machine-excavator.png`, `machine-forklift.png`,
  `machine-mixer.png` and `machines-plot.png` (FR-037)

## Results (2026-11-04)

### Automated

| Check | Result |
|---|---|
| `pnpm typecheck` | ✅ shared, client, server |
| `pnpm test` | ✅ shared 104, client 31, server 84 (incl. `machines`, `groundwork`, `crane`, `forklift`, `migration`, `restore`, `shift`, `snapshots`) |
| `pnpm build` + `pnpm check:budgets` | ✅ critical payload: multiplayer 1006 KB, solo 2254 KB (≤ 4883 KB); machine models deferred (3–43 KB each); generated audio 872 KB deferred (budget 1172 KB); code bundle 1911 / 1953 KB |
| `pnpm e2e` (Chromium + Firefox) | ✅ 38 passed, incl. `mp-machines.spec.ts` (US1–US5) and `solo-machines.spec.ts` |
| `pnpm --filter @hht/client e2e:webkit` | ✅ 19 passed |
| `pnpm perf` | ✅ `?perf=1` high 174 draws / 254 k tris, low 139 / 188 k; `?perf=crowd` high 132 / 569 k, low 58 / 240 k; **`?perf=machines` high 180 / 678 k (≤ 300 / 700 k), low 79 / 285 k (≤ 200 / 340 k)** |
| Load test, quick (90 s, 100 bots) | ✅ tick avg 9.35 ms, p99 15.97 ms, 15.0 KB/s per bot, every counter 0 |
| Load test, full (300 s, 100 bots) | ✅ 20 ticks/s, tick avg 8.84 ms, p99 21.85 ms, 15.2 KB/s per bot (p95 17.7 KB/s), heap peak 52.8 MB; machines: `groundworkDone` 10, `craneSnaps` 17, `forkliftSnaps` 30, `palletUnload` 12, `maxMachinesMoving` 20, machine records 1.66 KB/s per client (p95 2.34 KB/s); all 9 consistency counters 0 (incl. the 4 new ones); 12 outsider probes, all refused. Report: `reports/loadtest/2026-11-04T15-23-56-348Z.json` |
| Soak (30 min, 100 bots) | ✅ retained-heap slope 0.07 MB/min (raw fit 0.42), heap peak 80 MB, 100/100 bots connected, tick avg 8.31 ms, p99 17.27 ms, 14.6 KB/s per bot, all 9 consistency counters 0 (34 outsider probes refused). Report: `reports/loadtest/2026-11-04T16-39-28-355Z.json` |

### Notes

1. **Tick time.** Machines add ≈ 2–3 ms per tick on this laptop (002: 6.2–6.6 ms; 003: 7.9–9.7 ms across
   runs). A CPU profile shows the server ≈ 77 % idle; the machine code itself is ≈ 0.5 % (collisions and
   record writes). Most of the rise is the snapshot path (bigger snapshots, more `writev`). Records are now
   built and hashed once per tick for all receivers. The bots share the CPU with the server, so for
   production numbers run them from another machine with `--url` (as in 002).
2. **Layout change (part of the owner's layout review).** The supply yards are now drive-through: 7 racks
   (with cement) on two arcs facing the yard centre with ≈ 2.7 m openings, so a forklift can reach every
   cement rack from every plot (`site_layout.py` asserts it). The rack corners keep ≥ 0.9 m gaps so
   workers never wedge between racks. The static scenery crane and excavator are gone; each plot has its
   pit outline, spoil heap, striped hook pad and parking marks.
3. **Machine detail.** LOD0 within 20 m (research M12 said 30 m; 20 m keeps `?perf=machines` inside
   700 k), LOD1 beyond. The crane's lattice mast and jib draw no inverted-hull outline and cast no shadow
   (they doubled their triangles). Solo draws its 4 machines at full detail.
4. **Protocol details** recorded in the contracts: stick axes use the full −127..127 square; p3 is in
   decimetres; mixer bags come from the schema.
5. **Bot behaviour (not a product issue).** Over long runs the bots pile many pieces on the hook pads and
   the crane bots re-lift mismatched pieces (soak: 3945 grabs, 7 crane snaps), so plots progress slowly
   after Groundwork. The load still exercises every machine; smarter bot piece selection is a follow-up.
6. **Sound.** Original music and machine sounds were generated with ElevenLabs
   (`tools/audio/generate-audio.mjs`, deferred, muted by the existing toggle). The API key was used from
   the environment only and is not in the repository.

### Open items (owner, devices, playtest)

- **Owner approval of `render.machines`** (700 k high-tier triangles; measured 678 k).
- **Owner approval of the machine renders** (`assets/renders/machine-*.png`, `machines-plot.png`) and the
  in-game comparison `assets/renders/ingame/machines-plot.png`; the 002 site-layout review now includes the
  drive-through supply yards.
- **Devices** (SC-007): phones at ≥ 30 fps on `?perf=machines&q=low` and in a live world; desktop GPU fps
  on `?perf=machines` (the headless runs above are software-rendered, so their fps is not meaningful).
- **Playtest** (SC-001/002/003/009).
- The 002 gate items accepted as risk at the start (see the first item).
