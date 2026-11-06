# Validation Guide: First Five Minutes of Construction

All three user stories are implemented. Run these checks for validation; actual results and outstanding human/device evidence are recorded in gate.md.

## Prerequisites

- Resolve the implementation entry gate recorded in [gate.md](gate.md).
- Use repository Node 24 (`nvm use`) and install dependencies with `pnpm install`.
- Run `pnpm dev`; use the Vite URL printed by the command, `?debug=1` for multiplayer diagnostics, and `?solo=1&debug=1` for solo.
- Use fresh browser profiles for newcomers and separate browser contexts for a crew. Preserve a test profile with old seenMachineHints to exercise migration.

## Automated Checks

After implementation run `pnpm verify`, `pnpm --filter @hht/client e2e:webkit`, and `pnpm loadtest --duration 300`. The full load run must exercise early cement preparation and authoritative machine operations, not merely idle bots. Record scenario coverage alongside metrics. Run `pnpm perf` with the existing machine crowd scenario and verify numeric asset budgets through the normal verification command.

Meaningful tests: pure guidance selection; cement loading at every groundwork phase and completion; identical server/solo quantities; outsider refusal; premature pour refusal; safe full-hopper unload; event actor attribution across seat changes; wrong actions not completing help; compatible old profile; reset clearing targets; mixed-device labels. Add these to existing test suites and run them before the full checks.

## Manual Scenarios

1. Fresh multiplayer guest: follow Foreman guidance, start/join a building, and perform useful work. Help remains after waiting/movement; success or dismissal hides it. Reopen help and switch active input device.
2. Repeat direct plot guidance in solo; it must not ask the solo player to join a crew or find a multiplayer Foreman.
3. Have one crew member excavate while another loads cement by forklift and unloads into the mixer. Dig-before-pour stays enforced. Fill the hopper concurrently and verify excess material remains safe.
4. Try wrong piece, crane-only hand target, occupied machine, full mixer/bin, and denied crew access. Each gives recovery guidance; none shows false success.
5. Preview a crane slot while a teammate fills it. Confirm preview refresh, authoritative result, and no duplicate progress. Change seats immediately around machine actions; only the actor earns tutorial completion.
6. Change crew, reconnect, finish a building, and cross a shift reset. No old target remains. Hide guidance and confirm normal free play.
7. Test muted audio, reduced motion, touch layout, keyboard, gamepad, and unavailable local storage. Success remains readable and controls accessible.

## Human Playtest

Observe baseline before changes and post-change with five fresh newcomers, including a three-person crew. Record anonymous participant labels, device/input, time movement becomes available, first useful action, first productive machine operation, each refusal/recovery, groundwork/tower finish, and cumulative waiting/searching in the first five minutes. Allow no coaching before timed milestones. Script wrong-piece and crane-only failures separately from initial discovery. Record fun yes/no and each player's own description of their contribution.

Pass thresholds: SC-001 through SC-006 in [spec.md](spec.md). Include a solo full-build session for the 30-minute criterion. Record actual results, not only pass/fail; small-sample findings are directional.

## Devices and Performance

Measure actual desktop GPU and mid-range Android/iPhone hardware, including iOS Safari, in the existing machine scene and a live 100-player/bot world. Require 60 fps desktop / ≥30 fps phone, ≤30 KB/s average per client, existing render budgets, ≤5 MB critical payload, and ≤4 s first-play target on representative 4G. Headless software-renderer fps does not establish a hardware pass.

Save commands, dates, browser/device details, measurements, screenshots of changed cues, and human notes in gate.md or linked local reports. Outstanding owner/device/human checks remain unchecked.

## Focused regression commands

- `pnpm --filter @hht/shared exec vitest run test/guidance.test.ts test/forkliftPreparation.test.ts`
- `pnpm --filter @hht/client exec vitest run test/guestProfile.test.ts test/machineLearning.test.ts test/gameplayFeedback.test.ts`
- `pnpm --filter @hht/server exec vitest run test/machines.test.ts test/forklift.test.ts test/groundwork.test.ts`
- `HHT_E2E_PORT=2587 pnpm --filter @hht/client exec playwright test gameplay-guidance.spec.ts gameplay-feedback.spec.ts --project=chromium`
- `HHT_E2E_PORT=2587 pnpm --filter @hht/client exec playwright test mp-machines.spec.ts solo-machines.spec.ts --grep 'early cement|solo forklift' --project=chromium`

2587 avoids the existing development server port; do not run multiple Playwright suites simultaneously because they share preview port 4173. Run load/performance measurements without competing browser test workloads. Guidance browser tests also save desktop/mobile layout screenshots to `reports/004-guidance-desktop.png` and `reports/004-guidance-mobile.png`; viewport emulation is not physical-device performance evidence.
