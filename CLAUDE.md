# Hard Hat Town — agent guide

A browser-based 3D chibi construction-site sandbox: about 100 players per world (later), no login,
and players join from a link.

- **Constitution (binding)**: `.specify/memory/constitution.md`
- **Active feature**: `specs/001-single-player-prototype/` (spec, plan, research, data model,
  contracts, tasks)
- **Approved art references**: `assets/renders/` (toon look); source scenes are in
  `assets/blender/`

## Stack

pnpm monorepo:

- `packages/shared`: pure rules and types, no DOM or Three.js
- `packages/client`: Vite + TypeScript strict + Three.js + Rapier compat
- `packages/server`: placeholder

Assets: headless Blender (`tools/blender/export_assets.py`) → gltf-transform (`tools/assets/`).

## Commands

`pnpm dev` · `pnpm assets` · `pnpm test` · `pnpm e2e` · `pnpm perf` · `pnpm check:budgets` ·
`pnpm verify`

Debug URLs: `?debug=1` (FPS overlay + `window.__hht`), `?perf=1` (Masterpiece reference scene),
`?shot=closeup|masterpiece|overview` (art comparison cameras), `?q=low|high` (quality tier).

Status: feature 001 is implemented and `pnpm verify` is green. The phase gate is in
`specs/001-single-player-prototype/gate.md` (playtests and device fps are still pending).

## Rules of thumb

- Game rules go in `packages/shared` as pure functions with unit tests.
- Never exceed the budgets in `tools/assets/budgets.json`. The critical payload must stay ≤ 5 MB.
- The visual look must match the reference renders: a 2-band toon ramp with shadow tint
  (0.50, 0.52, 0.66), plus inverted-hull outlines.
- Controls stay "move + action + toss (+ jump)", and there is no free-text input.
- Only original assets are allowed; never copy other games' content.
