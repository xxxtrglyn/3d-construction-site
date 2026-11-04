# Phase Validation Gate: 002-multiplayer-core

**Date**: 2026-11-04 · **Build**: branch `002-multiplayer-core` · Node 24.15 · headless Chromium
(SwiftShader software rendering)

## Automated checks

| Check | Result |
|---|---|
| `pnpm typecheck` (shared, client, server; TS 7 strict, server `erasableSyntaxOnly`) | ✅ pass |
| Unit tests: shared | ✅ 65/65 (kinematics determinism, protocol codecs + fuzz, crew/plots/bin/shift/toss rules, chat corpus SC-013) |
| Unit tests: client | ✅ 24/24 (prediction/replay, interpolation tiers, clock sync, profile v2 migration) |
| Integration tests: server | ✅ 56/56 (join/overflow/invite, movement authority, snapshots/tiers, reconnect/resume/idle, pieces, buildings, crews, handover, kindness, shifts, restart restore, chat moderation) |
| `pnpm check:budgets` | ✅ all assets within budget. Critical payload: multiplayer **972 KB**, solo **2.24 MB** (≤ 5 MB) |
| e2e (Chromium): 001 solo specs under `?solo=1` + multiplayer + fallback | ✅ 12/13 in the last full run, 13/13 when the remaining test is re-run alone. The one failure was the pre-existing 001 smoke flake (a lost first keydown under software rendering, also seen before 002). That test now re-presses the key |
| Perf: 001 Masterpiece scene | ✅ high 221 draws; low 131 draws / 186 k tris |
| Perf: `?perf=crowd` (100 workers + 12 towers incl. 4 Masterpieces + racks) | ✅ high **128** draws / **580 k** tris (≤ 300 / 600 k); low **56** / **245 k** (≤ 200 / 300 k) |
| `pnpm verify` (typecheck, tests, build, budgets, e2e Chromium + Firefox, perf, quick load test) | ✅ **green**: e2e 26/26, perf 4/4, load test PASS |
| e2e WebKit | ⚠️ not run: the WebKit browser still needs `sudo npx playwright install-deps` on this Linux host (same as 001) |

## 100-bot load test (SC-004/005/006/008)

| Run | Ticks/s | Tick avg / p99 | Bytes per bot per s (avg / p95) | Heap peak | Consistency | Report |
|---|---|---|---|---|---|---|
| Quick 60 s | 20 | 3.26 / 5.39 ms | 15 567 / 17 501 | 41 MB | all 0 | `reports/loadtest/2026-11-04T08-21-46-108Z.json` |
| Full 300 s | 20 | 3.23 / 5.16 ms | 15 754 / 17 766 | 55 MB | all 0 | `reports/loadtest/2026-11-04T08-27-42-948Z.json` |
| Self-test (+30 ms per tick) | 20 | 33.2 / 35.2 ms → **FAIL detected** ✅ | — | — | — | — |
| Soak 1800 s | 20 | 3.24 / 4.54 ms | 15 595 / 18 060 | 79 MB (retained after GC: 23.2 → 26.4 MB, slope **0.07 MB/min**) | all 0, 100/100 connected | `reports/loadtest/2026-11-04T10-06-23-078Z.json` |

Bot behavior in the full run:

| Behavior | Count |
|---|---|
| Foreman starts | 50 |
| Grabs | 2,337 |
| Deliveries | 1,315 |
| Tosses | 543 |
| Donations | 470 |
| Join requests | 145 |
| Emotes | 502 |
| Quick messages | 506 |
| Chat messages | 803 |

Budgets come from `tools/assets/budgets.json → net`: ≥ 19.5 ticks/s, avg ≤ 10 ms, p99 ≤ 25 ms,
≤ 30 000 B/s per client, heap ≤ 256 MB, soak slope ≤ 0.5 MB/min.

Load tests run in-process on a desktop CPU. Repeat them on the production VPS class before launch.

## Gate checklist

- [ ] `pnpm verify` green, including the quick load test and WebKit e2e. `pnpm verify` is
      ✅ green (Chromium + Firefox). WebKit is still pending: it needs
      `sudo npx playwright install-deps` on this host.
- [x] Full 5-minute 100-bot load test passes (SC-004/005/006); report linked above
- [x] 30-minute soak: heap slope within budget, no disconnects. The first soak sampled uncollected
      heap (0.72 MB/min). The slope is now measured on retained heap after a forced GC: 0.07 MB/min.
- [x] Consistency counters all 0 (SC-008), from the load tests and the integration tests
- [x] Restart restore with everything restored (SC-009): `test/restore.test.ts` covers towers,
      Host, crew, join mode, bin and timer, plus resume by key. Clients rejoin automatically
      through the reconnect loop (1, 2, 4, 8 s backoff). Measure the 15 s target live with
      `pnpm dev` and a restart.
- [ ] Phones at ≥ 30 fps on `?perf=crowd&q=low` and in a live 100-bot world (SC-007): needs
      the reference devices (Pixel 6a class, iPhone 12+)
- [ ] Owner approves the Foreman render (`assets/renders/foreman.png`) and the site layout
      (`assets/renders/site-overview.png`)
- [ ] Playtest with ≥ 5 people in one world: ≥ 4 of 5 start or join a crew within 2 minutes
      (SC-010) and call building with a crew fun (SC-011)

## Notes

- Chat moderation baseline (constitution v1.1.0):
  - SC-013 corpus: 100 % of contact info refused and 100 % of blocklist variants masked, with no
    false positives on game phrases or on Vietnamese words such as "lớn" and "đeo".
  - The starter blocklists in `packages/server/data/chat-blocklist/` need review by a native
    speaker before launch.
- The multiplayer client never loads Rapier. Solo mode loads it on demand.
- Production hosting (TLS, Hetzner, Cloudflare) is out of scope (see `packages/server/README.md`).
