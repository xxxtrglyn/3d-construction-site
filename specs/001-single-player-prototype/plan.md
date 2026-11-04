# Implementation Plan: Single-Player Playable Prototype

**Branch**: `001-single-player-prototype` | **Date**: 2026-11-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-single-player-prototype/spec.md`

## Summary

Build the first playable slice of Hard Hat Town: a browser game, opened from a link, where one
player controls the approved chibi worker on a floating construction lot. The worker picks up,
carries and tosses pieces and snaps them into the Clock Tower, which grows through six visibly
different stages to a celebrated Masterpiece.

Technical approach:

- **Monorepo**: a pnpm workspace with three packages:
  - `shared`: pure game rules and types (blueprint, progression, pieces, guest names);
  - `client`: Vite, TypeScript and Three.js, with a custom toon material, inverted-hull outlines,
    a Rapier character controller, procedural worker animation, procedural WebAudio sound and
    multi-device input;
  - `server`: a placeholder only.
- **Assets**: a headless-Blender export pipeline that rebuilds the approved models from Python
  builder scripts, exports glTF and compresses it with gltf-transform into a hashed manifest.
- **Checks**: automated budget checks (critical payload ≤ 5 MB) and perf checks (draw calls and
  triangles) on top of Vitest and Playwright tests.

## Technical Context

**Language/Version**: TypeScript 7.x, `strict` (fallback 5.9), ES2022 modules; Python 3 inside
Blender 5.2 for the asset builders; Node.js 20.19+ for tooling.

**Primary Dependencies**: three 0.187, @dimforge/rapier3d-compat 0.21, Vite 8,
@gltf-transform/{core,functions,cli} 4.5, meshoptimizer 1.3. No UI framework: the HUD is plain
DOM and CSS (see [research.md](./research.md) R1).

**Storage**: Browser `localStorage` for the guest profile only (`hht.profile.v1`). There is no
server-side storage in this feature.

**Testing**: Vitest 5 for the `shared` package and client logic (node environment); Playwright 1.64 for e2e
(Chromium, Firefox, WebKit); custom budget and perf scripts.

**Target Platform**: Current Chrome, Firefox and Safari on desktop; Chrome on Android; Safari on
iOS 16+. WebGL 2.

**Project Type**: Web application (static client game) plus a build-time asset pipeline.

**Performance Goals**: 60 fps on desktop and ≥ 30 fps on a mid-range phone. Worst-case draw calls
≤ 250 (high tier) / ≤ 150 (low tier); triangles ≤ 400 k / 200 k (R11).

**Constraints**: Critical payload ≤ 5 MB compressed (JS ≤ 1.6 MB gzip); time-to-play ≤ 4 s on 4G;
no login; only original assets; everything else streams after spawn (R10).

**Scale/Scope**: 1 player, 1 lot, 1 blueprint (6 stages, 30 deliveries), 7 piece types, about 12
glTF assets, about 6 HUD elements.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this plan complies | Status |
|---|---|---|
| I. Instant Play | Static link, no login; guest profile generated locally; critical/deferred asset split; 5 MB budget enforced by `check:budgets`; tested on Chrome/Firefox/Safari, iOS and Android | ✅ |
| II. Server Authority | No server in this feature (single-player). Game rules are pure functions in `shared` with an intent-style API (`deliver(progress, type)`), so the future server can own them unchanged | ✅ (N/A now, prepared) |
| III. Performance Budgets | Numeric budgets for draw calls, triangles, textures and payload; `pnpm perf` and `check:budgets` fail the build; Rapier only for the character and loose/tossed pieces; snapped pieces have no physics | ✅ |
| IV. Art Fidelity & Original IP | Toon ramp and cool shadow tint copied from the Blender materials; inverted-hull outlines; the reproducible headless-Blender pipeline rebuilds the approved models; art comparison against the reference renders in the quickstart | ✅ |
| V. Simple & Kind Sandbox | Move + action + toss (+ jump); no forced tutorial; names come only from lists (no free text); no destructive actions | ✅ |
| VI. Test & Measure | Strict TS across packages; Vitest for rules; Playwright e2e; validation gate checklist in the quickstart. The 100-bot load test does not apply (no multiplayer) | ✅ |
| VII. Simplicity | Plain DOM HUD; procedural audio; no state library, no UI framework, no backend; server package is a placeholder | ✅ |

**Result**: PASS, no violations. Complexity Tracking is empty.

**Post-design re-check (after Phase 1)**: PASS. The data model keeps rules in `shared`. The
contracts add only a dev/test-only debug API, which is excluded from the critical payload.

## Project Structure

### Documentation (this feature)

```text
specs/001-single-player-prototype/
├── plan.md              # This file
├── research.md          # Phase 0 decisions R1–R14
├── data-model.md        # Entities, rules, state transitions
├── quickstart.md        # Run/verify guide + validation gate
├── contracts/
│   ├── asset-manifest.schema.json
│   ├── asset-naming.md
│   ├── controls.md
│   └── debug-api.md
├── checklists/requirements.md
└── tasks.md             # Created by /speckit-tasks
```

### Source Code (repository root)

```text
package.json                 # root scripts: dev, build, assets, test, e2e, perf, verify
pnpm-workspace.yaml
tsconfig.base.json
CLAUDE.md                    # agent guidance (links constitution + active plan)

packages/
├── shared/
│   ├── src/
│   │   ├── pieces.ts         # PieceTypeId, PIECE_TYPES
│   │   ├── blueprints.ts     # CLOCK_TOWER blueprint + validateBlueprint()
│   │   ├── progression.ts    # deliver(), reset(), neededPiece(), stars
│   │   ├── guestName.ts      # name lists, hat palette, generateName()
│   │   ├── constants.ts      # speeds, radii, fade times, budgets shared with tools
│   │   └── index.ts
│   └── test/                 # Vitest
├── client/
│   ├── index.html            # inline loading screen + canvas + HUD root
│   ├── vite.config.ts
│   ├── src/
│   │   ├── main.ts           # bootstrap: profile → critical assets → physics → game loop
│   │   ├── game/             # Game loop, world state, piece manager, tower plot logic
│   │   ├── render/           # renderer, toonMaterial, outline, ghost, brick shader, quality tiers, bloom
│   │   ├── world/            # layout, lot, racks, tower view, slot markers, star sign
│   │   ├── player/           # worker view + procedural animation, character controller, follow camera
│   │   ├── physics/          # Rapier init, colliders, fixed-step loop
│   │   ├── input/            # actions, keyboard/mouse, touch joystick, gamepad
│   │   ├── fx/               # puff, sparkles, confetti, fireworks (instanced)
│   │   ├── audio/            # procedural WebAudio sfx
│   │   ├── ui/               # HUD, hints/arrows, menu, needed-piece icon, toasts
│   │   ├── assets/           # manifest loader (critical/deferred), material remapping
│   │   ├── profile/          # guest profile store (localStorage with fallback)
│   │   └── debug/            # window.__hht API, FPS overlay, perf scene (dynamic import)
│   ├── public/assets/        # generated by `pnpm assets` (gitignored except manifest?)
│   ├── test/                 # Vitest (node env)
│   └── e2e/                  # Playwright specs: smoke, build-flow, perf
└── server/
    └── README.md             # placeholder for phase 2 (Colyseus)

tools/
├── blender/
│   ├── builders/             # common.py, palette.py, worker.py, pieces.py, racks.py, lot.py, clock_tower.py, fx.py
│   └── export_assets.py      # headless entry: build each asset → prep → export raw glb
└── assets/
    ├── compress.mjs          # gltf-transform optimize → hashed files + manifest.json
    ├── budgets.json
    └── check-budgets.mjs

assets/
├── blender/                  # reference .blend files (art-test, clock-tower-stages)
├── renders/                  # approved reference renders
└── build/raw/                # intermediate glb export (gitignored)
```

**Structure Decision**: A pnpm monorepo with `packages/shared`, `packages/client` and
`packages/server` (placeholder), as required by the constitution's Technology Constraints. The
build-time tooling lives in `tools/`, outside the shipped packages. Generated assets go to
`packages/client/public/assets/`.

## Complexity Tracking

No constitution violations; nothing to justify.
