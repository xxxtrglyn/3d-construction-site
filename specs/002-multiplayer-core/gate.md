# Phase Validation Gate: 002-multiplayer-core

**Date**: 2026-11-04 · **Host**: Apple M1 (4P + 4E cores, 8 GB), macOS, Node 24.18.0 ·
**Build**: `b6992f4` plus the gate fixes listed below (uncommitted when measured)

Load-test reports are written to `reports/loadtest/` and are git-ignored, so the paths below point
to the machine that ran them. Their key numbers are copied into this file.

## Summary

| Gate item (quickstart) | Status |
|---|---|
| `pnpm verify` green, including the quick load test and WebKit e2e | ✅ |
| Full 5-minute 100-bot load test passes (SC-004/005/006) | ✅ |
| 30-minute soak: heap slope within budget, no disconnects | ✅ |
| Consistency counters all 0 (SC-008) | ✅ |
| Restart restore within 15 s, with everything restored (SC-009) | ✅ about 1.1 s |
| Phones at ≥ 30 fps on `?perf=crowd&q=low` and in a live 100-bot world (SC-007) | ⏳ needs real devices (desktop ✅) |
| Owner approves the Foreman render and the site layout | ⏳ owner review |
| Playtest with ≥ 5 people (SC-010, SC-011) | ⏳ needs real people |

## Automated checks: `pnpm verify` PASS (final code)

| Check | Result |
|---|---|
| `pnpm typecheck` (TS 7 strict, all packages) | ✅ |
| Unit and integration tests | ✅ shared 65 + client 24 + server 58 = **147/147** |
| Production build | ✅ |
| `check:budgets`: critical payload | ✅ **972 KB (net)** / 2,243 KB (solo) of 4,883 KB (5 MB) |
| e2e: Chromium + Firefox (13 specs each) | ✅ 26/26 |
| e2e: WebKit (`e2e:webkit`) | ✅ **13/13**. This closes the 001 follow-up: WebKit runs natively on macOS. |
| Perf, solo reference (high / low) | ✅ 177 / 131 draw calls, 258 k / 186 k triangles |
| Perf, crowd: 100 workers + 12 towers (high / low) | ✅ 128 / 56 draw calls (≤ 300 / ≤ 200), 578 k / 243 k triangles (≤ 600 k / ≤ 300 k) |
| Quick load test (60 s, 100 bots) | ✅ tick avg 6.23 ms, p99 11.42 ms, 15.3 KB/s per bot, all consistency counters 0 |

The perf e2e renders in software (SwiftShader), so its frame times (50 ms) are not meaningful.

## Load tests (SC-004, SC-005, SC-006, SC-008)

All runs used 100 bots, an in-process server, and bots in 4 worker threads of the same process.

| Metric | Budget | Full 5 min | 30-min soak |
|---|---|---|---|
| Ticks per second (avg) | ≥ 19.5 | 20 | 20 |
| Tick time avg | ≤ 10 ms | **6.58 ms** | **6.49 ms** |
| Tick time p99 | ≤ 25 ms | 14.54 ms | 12.03 ms |
| Bytes in per bot (avg) | ≤ 30 KB/s | 15.5 KB/s (p95 17.7, max 38.2) | 15.4 KB/s (p95 17.9, max 37.4) |
| Heap peak | ≤ 256 MB | 54.8 MB | 78.2 MB |
| Heap slope | ≤ 0.5 MB/min | n/a | **0.07 MB/min** (retained 24.3 → 26.4 MB) |
| Bots connected / disconnects | 100 / 0 | 100 / 0 | 100 / 0 |
| Client RTT p99 | none | 9 ms | 9 ms |
| Duplicate pieces, double-filled slots, non-crew snaps, divergent views, chat outside channel | 0 | **0 · 0 · 0 · 0 · 0** | **0 · 0 · 0 · 0 · 0** |

- Full run: `reports/loadtest/2026-11-04T10-54-24-172Z.json`. Bots did 35 Foreman starts, 1,267
  deliveries, 811 chats and 411 donations.
- Soak: `reports/loadtest/2026-11-04T11-24-32-982Z.json`. Bots did 1,203 deliveries, 5,813 chats
  and 3,195 donations.
- Self-test: `pnpm loadtest --selftest` still detects an injected 30 ms tick (p99 32.68 ms, FAIL as
  intended).

### What the first runs found, and the fixes

The first full run and soak (`…T09-55-27-198Z.json`, `…T10-25-36-032Z.json`) failed three budgets.
I investigated each one before changing anything.

1. **`consistency.chatOutsideChannel = 1` (full run).** The server routes chat from authoritative
   state: crew chat goes only to sessions with the same `crewPlot`, and nearby chat uses server
   positions. The bot's check was racy. Chat messages are sent at once, but state patches and
   snapshots arrive on the next tick. A chat sent right after a crew join, or from someone just
   entering interest range, therefore looked wrong on arrival. **Fix**
   (`loadtest/bot.ts`): the bot re-checks 300 ms later and counts a violation only if it still
   looks wrong. A real misroute stays wrong, so it is still caught. The report now shows
   `bots.chatRechecked`, which was 0 in the final runs because the race is rare: 1 in about 800
   chats.
2. **`heapSlopeMbPerMin = 0.73` (soak).** The slope was a least-squares fit over raw `heapUsed`,
   which follows V8's GC sawtooth (26–56 MB within each 30 s window). A 12-minute diagnostic soak
   that forced a full GC every minute showed the retained heap **flat at about 20.5 MB**, while the
   raw fit on that same run still reported 0.53. **Fix** (`loadtest/run.ts`, and the `loadtest`
   script now passes `--expose-gc`): the soak fits the slope to the retained heap after a forced GC,
   sampled once a minute from minute 3. The raw fit stays in the report as `rawSlopeMbPerMin`, and
   the peak still uses raw samples. In the final soak the retained heap rose 2.1 MB in 27 min. That
   matches the harness's own per-second byte-sample array (about 178 k numbers). The server's
   metric rings are preallocated.
3. **`tickMs.avg = 10.36 ms` (full run).** A main-thread CPU profile showed the server 84 % idle,
   with about 5.7 ms of CPU per tick: snapshots 7.2 % of wall time, half of it WebSocket `writev`,
   and movement 3.7 %. Wall-clock tick averages varied from 6.8 to 10.4 ms between identical runs.
   This is the 100 co-located bot clients competing for this laptop's cores. The metric was **not**
   changed. To gain real headroom, the per-receiver interest-tier `Map` (about 9,900 get/set per
   tick) was replaced with a `Uint8Array` indexed by netId (`systems/snapshots.ts`). Encode time
   fell from 5.0–6.6 ms to 4.1 ms, and tick avg is now 6.2–6.6 ms in every run. For numbers that
   represent production, run the bots from another machine with `--url` against the target host.

## Restart restore (SC-009) ✅

Measured with two real browser clients (Host and member), a file-backed SQLite, and a completed
stage. The server was stopped with SIGINT and started again, 3 runs:

| Run | Shutdown | Boot to `/api/health` | Host back in world | Member back in world | Page reloads | Tower, Host, join mode, crew size |
|---|---|---|---|---|---|---|
| 1 | 64 ms | 319 ms | 1.11 s | 1.11 s | 0 | ✅ identical |
| 2 | 57 ms | 317 ms | 1.10 s | 1.10 s | 0 | ✅ identical |
| 3 | 67 ms | 324 ms | 1.13 s | 1.13 s | 0 | ✅ identical |

Both clients came back with their crew roles (Host and member) and no reload, well within 15 s.
Exact restore of the shift timer (`endsAt`), bin contents and join mode is asserted by
`packages/server/test/restore.test.ts`.

## Device fps (SC-007): desktop ✅, phones pending

- [x] Desktop Chrome on Apple M1 (Metal GPU), `?perf=crowd`: **75 fps** (median 13.3 ms, p95
      14.0 ms) on both `q=high` and `q=low`. 75 fps is the display refresh cap.
- [ ] Pixel 6a-class Android, Chrome: ≥ 30 fps on `?perf=crowd&q=low`
- [ ] iPhone 12+ Safari: ≥ 30 fps on `?perf=crowd&q=low`
- [ ] Phone in a live 100-bot world (`pnpm loadtest --url http://<lan-ip>:2567 --duration 600`
      while playing)

## Art fidelity: pending owner review

In-game screenshots captured for this gate, to compare with the approved renders:

- `assets/renders/ingame/foreman.png` vs `assets/renders/foreman.png` (Foreman at the plaza sign)
- `assets/renders/ingame/site-crowd.png` vs `assets/renders/site-overview.png` (plaza hero angle
  of `?perf=crowd`: 12 towers, 100 workers)

- [ ] Owner approves the Foreman
- [ ] Owner approves the site layout

## Playtest (SC-010, SC-011): pending, needs real people

- [ ] ≥ 4 of 5 first-time players start a building with the Foreman or join a crew within 2 minutes
- [ ] In a ≥ 5-person world, ≥ 4 of 5 say building with a crew was fun and that they could tell who
      was in their crew and what others were building

Not part of this gate, but still to check by hand: SC-003 (responsiveness at 150 ms RTT and 2 %
loss) and SC-012 on real Safari and Android Chrome.

## Other fixes made during this gate

- **Chat blocklist was never in git (Principle V).** The `.gitignore` rule `data/` matched
  `packages/server/data/chat-blocklist/` too, so the lists seeded in T110 were never committed. A
  fresh checkout ran chat with **no** word masking (the server logged `blocklist not loaded`). The
  rule is now `/data/` + `packages/server/data/*` + `!packages/server/data/chat-blocklist/`.
  `en.txt` and `vi.txt` were re-seeded with profanity, sexual terms, slurs and self-harm phrases.
  Normal site words are deliberately left out: screw, hooker, erection, hoe. So are Vietnamese
  words whose unaccented forms are everyday: lon, deo, buoi, cac. The new
  `packages/server/test/blocklist.test.ts` checks that the shipped lists load and mask, and leave
  everyday chat alone. **The owner should review both lists.**
- **`@colyseus/core` override was ignored.** pnpm 10.33 no longer reads `pnpm.overrides` in
  `package.json`. The override moved to `pnpm-workspace.yaml`. A frozen install confirms the
  lockfile is unchanged.

## Known follow-ups

1. Run the load test from a separate machine (`--url`) against the production-like host to get tick
   numbers without bots competing for cores.
2. Interest tiers now use 64 KB per session (6.4 MB at 100 players). If `MAX_PLAYERS` or the netId
   range grows a lot, switch to dense per-world slot indexes.
3. The 001 follow-ups for Rapier non-compat and name-tag occlusion are still open.
