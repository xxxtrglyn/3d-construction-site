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

## Checks

```bash
pnpm verify         # typecheck → unit tests → build → budgets → e2e (Chromium+Firefox) → perf
pnpm check:budgets  # payload budgets (critical ≤ 5 MB) from tools/assets/budgets.json
pnpm perf           # draw-call / triangle budgets on the Masterpiece reference scene (?perf=1)
```

## Layout

- `packages/shared`: pure game rules (pieces, Clock Tower blueprint, progression, guest names)
- `packages/client`: Vite + TypeScript + Three.js + Rapier game client
- `packages/server`: placeholder for the multiplayer phase (Node.js + Colyseus)
- `tools/blender`: Python builders for every model, plus the headless exporter
- `tools/assets`: compression, manifest and budget checks
- `specs/001-single-player-prototype`: spec, plan, research, contracts, tasks, gate report
- `.specify/memory/constitution.md`: project principles
