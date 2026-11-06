# Validation Gate: First Five Minutes of Construction

Status: all three user stories implemented; automated validation passed, 2026-11-06; human/device/owner acceptance pending. Owner accepted entry risks and deferred the baseline playtest.

## Entry

- [x] 003 outstanding owner art/budget review, device measurements, and human playtest completed, or explicit owner risk acceptance recorded for 004.
- [ ] Baseline newcomer/crew playtest recorded.

## Automated

- [x] Shared guidance and loading rules pass meaningful unit tests.
- [x] Server permissions, material conservation, early cement preparation, and actor-attribution integration tests pass.
- [x] Solo/multiplayer and keyboard/touch/gamepad guidance tests pass.
- [x] `pnpm verify` passes.
- [x] WebKit end-to-end scenarios pass, including focused reruns after fixes (see evidence below).
- [x] Five-minute 100-bot load run covers machine/early-supply scenarios and meets existing tick/bandwidth/memory criteria.

## Human and Devices

- [ ] SC-001: 4/5 useful contribution ≤60 s.
- [ ] SC-002: 4/5 productive machine operation ≤90 s.
- [ ] SC-003: 4/5 recover from each scripted refusal ≤15 s.
- [ ] SC-004: crew groundwork ≤5 min; crew tower ≤25 min; solo tower ≤30 min.
- [ ] SC-005: each crew member ≤60 s confusion/waiting in first five minutes.
- [ ] SC-006: 4/5 report fun and identify their contribution.
- [ ] SC-007: payload, initial play time, desktop/mobile fps, browsers, and bandwidth meet targets.
- [ ] Changed visual guidance/effects reviewed against approved art direction.

## Results

Implementation is present. Automated evidence and remaining checks are listed below; specification checklist completion does not establish feature acceptance.

Owner acceptance: see [003 gate](../003-construction-machines/gate.md#entry-into-004-2026-11-05). Baseline and all human/device evidence remain pending; no results are inferred.

## Implementation progress (2026-11-05)

- Pre-change `pnpm test`: shared 104, client 31, server 84 passed on Node v24.18.0 / pnpm 10.33.4. Full pre-change verify was not run; T003 remains partial until its intended evidence is reconciled. No human baseline measurements were inferred.
- New tests were first observed failing for missing guidance/learning/loading behavior, then passed after implementation.
- Focused Chromium guidance/help retention, multiplayer crew guidance/reset, and reduced-motion/muted refusal recovery passed (3 scenarios).
- Focused Chromium early forklift preparation passed in multiplayer and solo (2 scenarios); excavation and pouring remain at zero while cement is staged.
- Focused server machine/forklift/groundwork integration tests: 17 passed, including a mixer operator handoff and null actor for delayed completion.
- Full verify and machine scene budgets passed; final WebKit and full-load results are recorded below. Physical devices and human playtests remain pending under the accepted risk.

## Verification results (2026-11-06)

- `HHT_E2E_PORT=2587 pnpm verify`: PASS. Shared 114, client 37, server 86 tests; Chromium/Firefox 48 browser scenarios; all 6 render-budget scenarios; quick 100-bot test. Full command log: `reports/004-gameplay-onboarding/verify.log`.
- Machine render scene: high 180 draws / 677,293 triangles; low 79 draws / 284,861 triangles, within existing budgets. Headless frame timing is informational, not a real-device fps pass.
- Critical compressed payload: multiplayer 1,011 KB, solo 2,259 KB; code bundle 1,916 KB, within unchanged budgets.
- Quick load: 100/100 connected, average tick 7.37 ms, p99 14.75 ms, average bandwidth 15,698 B/s per client; all nine consistency counters zero.
- Desktop and 390×844 viewport guidance screenshots inspected: card fits viewport; revised overlay order keeps menu/request controls above guidance. Screenshots are in `reports/004-guidance-desktop.png` and `reports/004-guidance-mobile.png`. Owner visual review remains pending.
- Supplemental browser contract scenarios cover all recovery messages and live device-label switching; these are UI-boundary tests, paired with real server operation tests rather than claimed as human playtests.

- First full 300-second load run met performance/consistency limits but failed early-delivery coverage (3 loads, 0 deliveries before excavation). Bot destinations now follow actual cargo, cement unload waits for hopper reach, and excavation uses a bounded coordination wait. Retest required; the failed report is retained at `reports/loadtest/2026-11-06T14-35-28-762Z.json`.
- WebKit exposed per-frame replacement of the guidance button label; update now preserves unchanged text nodes. The preceding reset test now waits for and dismisses the shift summary, preventing that reset from racing the next test. Retests required.

- Browser validation: the original 24 scenarios passed in Chromium/Firefox through verify. WebKit's initial run passed 24/26; its two failures were corrected and passed in focused reruns. New refusal-event and crane-race scenarios passed in all three browsers; final reset/device-label run passed 6/6. Across these runs, all 27 distinct scenarios passed on each browser. Logs: `reports/004-gameplay-onboarding/webkit-initial.log`, `browser-regressions.log`, and `browser-reset-final.log` in the same report directory. Initial failures are retained rather than overwritten.
- US1: optional guidance, retained help, dismissal/replay, legacy seen-only profile, live device labels, crew departure and shift invalidation pass. Full-plot permission fallback is covered by shared selector tests.
- US2: solo refusals with muted/reduced-motion settings, server refusal UI mappings, confirmed crane operations, and stale preview after a second client's accepted stage update pass. The race uses the existing dev fixture for the competing update; release uses normal controls. Human interaction review remains pending.
- US3: real server/solo early cement loading and hopper delivery browser journeys pass without advancing digging/pouring; server tests cover permission/range, premature pour and concurrent hopper overflow conservation. Shared tests cover quantity/destination parity.

- Final `pnpm loadtest --duration 300`: PASS, 100/100 bots, 20 ticks/s, average tick 9.68 ms, p99 16.51 ms, average 15,073.6 B/s per client, peak heap 53.02 MB, all nine consistency counters zero. Coverage: 6 early cement loads, 12 cement bags delivered before excavation completed, 10 groundwork completions, 15 crane snaps, 14 pallet unload intents. Authoritative report: `reports/loadtest/2026-11-06T14-52-40-815Z.json`; log: `reports/004-gameplay-onboarding/load-full-final.log`. Existing thresholds were unchanged.
- Final client/server typechecks and `git diff --check` pass. No dependencies, asset budgets, building quantities, movement rules, or site distances changed. No extension hook file is configured.

## Merge with mixed-material stages (2026-11-07)

`origin/develop` (004 mixed-material stages, protocol v3 / schema v3) was merged into the onboarding work.
- One forklift loading rule: `forkliftLoadCount()` now covers cement during all of Groundwork (early
  preparation while digging) and each stage material's remaining need (it replaced `palletSize()`).
  Server, solo, prompts and load-test bots all use it.
- `selectGuidance()` is mixed-material aware: any still-needed material counts as "right", the forklift
  is sent to the material that fills the biggest pallet, and blueprint values replace `CLOCK_TOWER`.
- Machine help keeps onboarding's success-based card and adds back 003's always-on control bar (Q camera in
  every machine). Needs refusals use `needsText.hintLine()`; other refusals use `recoveryText()`.
- The guidance panel moved below the multiplayer crew-needs bar (top 104 px; 112 px on narrow screens).
- Node v24.18.0: `pnpm typecheck` passes; `pnpm test` passes (shared 136, client 42, server 94);
  `pnpm build` and `pnpm check:budgets` pass (critical: solo 2272 KB, net 1046 KB).
- `pnpm e2e` (Chromium + Firefox): 59/60 passed. `mp-recipes` "supply bin" was flaky under full-suite
  load (a single drop press missed); it passed 3/3 in isolation and was made robust by retrying the press.
  All 3 recipes tests then passed in one run.
- `pnpm perf` (Chromium, software renderer): 6/6 passed (reference, crowd and machines scenes, high and low tiers).
- `pnpm loadtest --duration 60` (100 bots; machine load average ≈ 5.7 at start): PASS. 20 ticks/s, tick avg
  6.25 ms, p99 17.11 ms, 14.7 KB/s in, heap peak 42.7 MB, every consistency counter 0. Early cement:
  `earlyCementLoads` 7, `earlyCementDelivered` 4 (both ≥ 1). Report:
  `reports/loadtest/2026-11-06T18-10-16-932Z.json`. A 60 s run is too short for Groundwork to finish
  (`groundworkDone` 0, `craneSnaps` / `forkliftSnaps` 0), so the full-length local run is still owed.
- No human, device or owner items changed; T002, T003 (full baseline), T023, T034, T035 and T036 stay open.

## Remaining acceptance

T002 baseline remains deferred; T003 has only the pre-change unit/integration baseline, not a retrospective full baseline. T023's human interaction review, T034 physical-device/4G/gamepad checks, T035 newcomer/crew/solo playtests, and T036 owner art review remain unchecked. See [baseline.md](baseline.md) and [playtest.md](playtest.md). Headless browser and viewport results do not establish these observations.
