# Hard Hat Town

A cozy chibi construction-site sandbox in the browser. Open a link and play right away: no login and
no download. This repository contains feature **001**, the single-player prototype: walk around the
lot, carry pieces from the supply racks, and build the Clock Tower through six stages to a
celebrated Masterpiece.

## Quick start

```bash
pnpm install
pnpm dev            # http://localhost:5173  (add ?debug=1 for the FPS overlay + debug API)
pnpm dev --host     # to try it on a phone on the same Wi-Fi
```

The generated assets are already in `packages/client/public/assets/`. To regenerate them from the
Blender builders (requires `blender` 5.2 on PATH):

```bash
pnpm assets         # headless Blender → glTF → gltf-transform (meshopt) → hashed files + manifest.json
```

## Controls

| | Keyboard / mouse | Touch | Gamepad |
|---|---|---|---|
| Move / run | WASD or arrows / hold Shift | left-side joystick (push far to run) | left stick |
| Camera | right-drag, mouse wheel to zoom | drag on the right side | right stick |
| Jump | Space | JUMP | A |
| Grab / drop | E or left click | GRAB / DROP | X |
| Toss | Q, or hold E | TOSS | B |
| Back to spawn | hold R | menu | View |
| Menu | Esc | ☰ | Menu |

Bring the piece shown on the badge ("Needs: Steel beam 2/6") to the glowing rings around the tower
and drop or toss it there.

### Machines (feature 003)

Every plot has a tower crane, an excavator, a forklift and a cement mixer (the solo lot too). Walk up
to one and press action ("Get in"); only the plot's Host and crew can operate its machines. In a
machine the same buttons are re-mapped. No new buttons are added:

| | Keyboard / mouse | Touch | Gamepad | Excavator | Forklift | Crane | Mixer |
|---|---|---|---|---|---|---|---|
| Move | WASD / arrows | joystick | left stick | W/S drive, A/D turn | W/S throttle, A/D steer | A/D swing, W/S hook out/in | — |
| Action | E / left click | ACTION (named: "Scoop", "Load 4 bricks"…) | X | scoop at the pit / dump on the heap | load at a rack / unload at your plot | grab / release (the hook goes down and up by itself) | mix (one concrete bucket per bag) |
| Jump | Space | EXIT | A | get out | get out | get out | get out |
| Toss | Q | CAMERA (crane only) | B | — | — | hook camera ↔ cab camera | — |

Every new building starts with **Groundwork**: dig the pit with the excavator (6 scoops onto the spoil
heap), carry cement bags into the mixer, mix, and carry the 4 concrete buckets into the pit. The roof
slots and the golden bell are **high slots** that only the crane can fill: put the piece on the
striped hook pad and lift it. The glowing machine (with the bouncing arrow) is the one your crew
needs next.

## Checks

```bash
pnpm verify         # typecheck → unit tests → build → budgets → e2e (Chromium+Firefox) → perf
pnpm check:budgets  # payload budgets (critical ≤ 5 MB) from tools/assets/budgets.json
pnpm perf           # draw-call / triangle budgets on the Masterpiece reference scene (?perf=1)
```

## Layout

- `packages/shared`: pure game rules (pieces, Clock Tower blueprint, progression, guest names)
- `packages/client`: Vite + TypeScript + Three.js + Rapier game client
- `packages/server`: the authoritative multiplayer server (Node.js 24 + Colyseus 0.18 + SQLite)
- `tools/blender`: Python builders for every model, plus the headless exporter
- `tools/assets`: compression, manifest and budget checks
- `tools/audio`: background music and machine sounds generated with ElevenLabs (`ELEVENLABS_API_KEY=… node tools/audio/generate-audio.mjs`; the key comes from the environment only)
- `specs/001-single-player-prototype`, `specs/002-multiplayer-core`, `specs/003-construction-machines`: spec, plan, research, contracts, tasks, gate report
- `.specify/memory/constitution.md`: project principles
