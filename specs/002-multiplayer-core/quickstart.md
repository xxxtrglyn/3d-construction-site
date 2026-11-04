# Quickstart & Validation Guide: Multiplayer World with Host Crews

## Prerequisites

- **Node.js 24 LTS**. Run `nvm use` in the repo; `.nvmrc` pins 24. Colyseus 0.18 requires Node ≥ 22,
  and Node 20 is end of life.
- **pnpm** 10.33+.
- Everything else from feature 001: Blender 5.2 for `pnpm assets`, and Playwright browsers.
- **Linux WebKit** for Playwright needs `sudo npx playwright install-deps`. This step was still
  pending from 001.

## Setup and run

```bash
nvm use                      # Node 24
pnpm install
pnpm assets                  # rebuilds all models incl. site, foreman, props-mp, tower LODs
pnpm dev                     # server :2567 + client :5173 (Vite proxies /api and /ws)
```

- **Two players**: open `http://localhost:5173` in two windows (or a normal and a private window, so
  they get different device keys).
- **Phone**: run `pnpm dev --host` and open the printed network URL. The proxy keeps everything on
  one origin.
- **Server environment variables**:

  | Variable | Default | Meaning |
  |---|---|---|
  | `HHT_SHIFT_MINUTES` | 60 | shift length |
  | `HHT_MAX_PLAYERS` | 100 | world capacity |
  | `HHT_DB` | `data/hht.sqlite` | SQLite file |
  | `HHT_METRICS=1` | off | enables `/api/metrics` |
  | `HHT_DEV_CHEATS=1` | off | enables `__hht.net.dev.*` |

- **Solo**: `http://localhost:5173/?solo=1` always runs the 001 single-player game.

## Automated checks

| Command | What it proves |
|---|---|
| `pnpm typecheck` | strict TypeScript across shared, client and server (server code uses only erasable syntax) |
| `pnpm test` | unit tests: shared rules (kinematics determinism and limits, toss, crew, plots, bin, shift, rate limit, names, interest, protocol codecs) and client net logic; **server integration tests** (`@colyseus/testing`) |
| `pnpm e2e` | 001 specs under `?solo=1`; multiplayer specs: two contexts see each other, Foreman → Host, ask/approve/deny/expire, shared snap, non-crew → bin, mute/hide, solo fallback with server down |
| `pnpm perf` | 001 Masterpiece scene, and `?perf=crowd` (100 workers + 12 towers) against `render.crowd` budgets |
| `pnpm check:budgets` | per-asset budgets incl. new assets; multiplayer critical payload ≤ 5 MB (Rapier excluded from the multiplayer critical path) |
| `pnpm loadtest --duration 60` | quick 100-bot run (part of `pnpm verify`) |
| `pnpm loadtest` | full 5-minute 100-bot run → `reports/loadtest/<ts>.json` |
| `pnpm loadtest --soak 1800` | 30-minute memory soak (phase gate) |
| `pnpm reports [--since 7d]` | owner review of chat reports stored in SQLite (FR-067) |
| `pnpm verify` | all of the above, with the quick load test |

The load-test budgets come from `tools/assets/budgets.json → net`:

| Measure | Budget |
|---|---|
| server ticks per second | ≥ 19.5 sustained |
| tick time | average ≤ 10 ms, p99 ≤ 25 ms |
| bytes in per client | average ≤ 30,000 B/s on the wire |
| heap | peak ≤ 256 MB; soak slope ≤ 0.5 MB/min |
| consistency counters (incl. chat outside its channel) | all 0 |

## Manual validation scenarios

Use two or more real devices or windows. Add `?debug=1` to see the FPS and net stats overlay.

1. **Shared world (US1)**
   - Open the link on a laptop and a phone. Both appear in the plaza of world 1 with the correct
     names and hats.
   - Walk, run and jump on one device: the movement is smooth on the other.
   - Throttle one device in Chrome DevTools to "Fast 4G" with 150 ms added latency. Its own movement
     still feels instant.
2. **Foreman → Host (US2)**: talk to the Foreman, then Start a building → Clock Tower. The arrow
   leads to your plot, and the sign shows your name and flag. Snap a beam: the other device sees it
   within half a second.
3. **Crews (US3)**
   - With device B, ask to join at A's sign. A sees a request card; approve it. Both now show A's
     flag, and B can snap.
   - Deny a request, then retry within 60 s: you see a cooldown message.
   - Let a request expire after 30 s.
   - Switch the crew to Open (B2 joins instantly), then to Solo (the sign shows the crew is closed).
   - Remove B from the crew.
4. **Host leaves (US4)**: close A's tab. After 60 s, B becomes Host and gets a toast. Close B too and
   wait 3 minutes: the Foreman lists "Unfinished buildings", and adopting it keeps the stage.
5. **Kindness (US5)**
   - As an outsider, drop a brick in A's build zone: it goes to the bin. A takes it from the bin, and
     the outsider sees "thanks".
   - Use each emote and quick message.
   - Mute, then hide, a player.
   - Spam E or emotes: you see "slow down".
   - Stand in front of a plot: others walk through you.
   - Toss a piece into the plaza: it fades immediately.
6. **Shifts and restart (US6)**
   - Start the server with `HHT_SHIFT_MINUTES=3`. Check the warning, the countdown, the reset and the
     summary card.
   - Build a few stages, then press Ctrl-C to stop the server and run `pnpm dev` again. The towers,
     Hosts, crews and timer are restored, and the clients reconnect within 15 s.
7. **Overflow and invites (US1, FR-003/004)**
   - Start the server with `HHT_MAX_PLAYERS=2`. A third window lands in world 2.
   - Menu → "Invite friends" copies a link to the current world. Opening it lands in that world
     when it has room; when it is full, you see the "sent to a nearby one" note.
8. **Chat (US9)**
   - Send Nearby and Crew messages between three windows at different distances.
   - Try a blocked word (it is masked), a link, an email address and a phone number (all refused),
     spam, a repeat within 30 s, and chatting in the first 60 s.
   - Use mute, hide and "Hide all chat".
   - Report one player from three different windows: their chat is paused for the shift.
   - Run `pnpm reports` to see the stored report.
9. **Solo fallback (US8)**: stop the server and open the link. Solo mode starts within 6 s with the
   banner. Start the server again: "Join others" appears.

## Reference devices (SC-007)

These are the same as in 001: a Pixel 6a-class Android phone with Chrome, an iPhone 12+ with
Safari, and a desktop with Chrome, Firefox and Safari. Measure on `?perf=crowd&q=low` on the phones
and on `?perf=crowd` on desktop, and in a live world with 100 bots (`pnpm loadtest --url
http://<lan-ip>:2567 --duration 600` while you play).

## Phase validation gate

Record the results in `specs/002-multiplayer-core/gate.md`.

- [ ] `pnpm verify` green, including the quick load test and WebKit e2e
- [ ] Full 5-minute 100-bot load test passes (SC-004/005/006); report linked
- [ ] 30-minute soak: heap slope within budget, no disconnects
- [ ] Consistency counters all 0 (SC-008)
- [ ] Restart restore within 15 s, with everything restored (SC-009)
- [ ] Phones at ≥ 30 fps on `?perf=crowd&q=low`, and in a live 100-bot world (SC-007)
- [ ] Owner approves the Foreman render and the site layout (art fidelity)
- [ ] Playtest with ≥ 5 people in one world: ≥ 4 of 5 start or join a crew within 2 minutes
      (SC-010) and call building with a crew fun (SC-011)
