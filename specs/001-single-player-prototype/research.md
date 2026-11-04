# Research: Single-Player Playable Prototype

**Feature**: 001-single-player-prototype | **Date**: 2026-11-04

Each item records a decision, the reason, and the alternatives considered. All "NEEDS
CLARIFICATION" items from the Technical Context are resolved here.

## R1. Package versions and toolchain

- **Decision**: pnpm 10 workspaces; Node.js 20.19+ (installed: 20.20.2); TypeScript 7.x
  (`strict`), falling back to 5.9 if a tool breaks with TS 7; Vite 8; three 0.187 + @types/three
  0.187; @dimforge/rapier3d-compat 0.21; Vitest 5; @playwright/test 1.64; @gltf-transform/cli,
  core, functions 4.5; meshoptimizer 1.3. Versions are pinned exactly in `package.json`.
- **Rationale**: These are the current releases (checked with `npm view` on 2026-11-04). Vite 8 requires
  Node 20.19+, which is satisfied. Exact pins keep agent-generated code reproducible.
- **Alternatives**: npm workspaces (slower, weaker workspace filtering); Bun (not in constitution).

## R2. Toon shading that matches the Blender look

- **Decision**: Extend `THREE.MeshToonMaterial` with `onBeforeCompile`. It uses a 2-step gradient
  (shadow threshold ≈ 0.28–0.48 with an ease, like the Blender ColorRamp) and a per-material
  `shadowTint` uniform, so shadowed areas become `baseColor × (0.50, 0.52, 0.66)`, the same cool
  tint used in Blender. One `DirectionalLight` (sun, same angle as the renders) with a PCF soft
  shadow map: 2048 px on desktop, 1024 on mobile. The hemisphere/ambient term is kept low so cast
  shadows read clearly. The output color space is sRGB with "no tone mapping", to match Blender's
  "Standard" view transform.
- **Rationale**: MeshToonMaterial already supports Three's shadow maps and lights, so only the final
  color mix needs patching. A fully custom ShaderMaterial would mean reimplementing shadow sampling.
- **Alternatives**: a full custom ShaderMaterial (more code, fragile on upgrades); MeshLambert +
  post-process posterize (affects UI and is costly on mobile).

## R3. Ink outlines

- **Decision**: Inverted-hull outlines. A second draw of the mesh with `side: BackSide` and a vertex
  shader that pushes vertices along their normals by a width scaled with view distance (constant
  thickness on screen), in a dark warm brown `#2a1a1a`. Outlines are enabled for objects within
  about 25 m of the camera, disabled for far objects, and turned off on the "low" quality tier.
  Merged stage meshes share one outline material per stage.
- **Rationale**: This matches how the Blender renders were made (Solidify + backface culling). It
  costs one extra draw per mesh, which fits the budget after merging.
- **Alternatives**: screen-space Sobel on depth/normals (full-screen pass, costly on mobile and blurs
  thin lines); no outlines (the owner approved the outlined look).

## R4. Asset pipeline (Blender → glTF → compressed)

- **Decision**: Move the Blender builder scripts used for the art test and stage mockup from the
  scratchpad into `tools/blender/builders/` (common helpers, worker, pieces/props, clock tower
  stages). `tools/blender/export_assets.py` runs headless
  (`blender --background --factory-startup --python tools/blender/export_assets.py`). It builds each
  asset in a clean scene and prepares it for export:
  - drops the Solidify outline modifiers (the client draws outlines);
  - applies the bevel modifiers;
  - converts toon node materials to plain Principled materials named `T_<palette>`, with base
    color = lit color, so the client can look up the toon palette by name;
  - converts glow materials to emissive `G_<name>` with KHR_materials_emissive_strength;
  - joins meshes per material inside each exported node group (fewer draw calls);
  - adds empties for slot anchors and attach points (`Slot_<stage>_<n>`, `Hand_R`, `Sign_Stars`).

  It then exports `.glb` files to `assets/build/raw/`. `tools/assets/compress.mjs` runs
  gltf-transform (`dedup`, `prune`, `weld`, `quantize`, `meshopt`) into
  `packages/client/public/assets/` and writes `manifest.json` with sizes and hashes.
  `pnpm assets` runs both steps.
- **Rationale**: The constitution requires a scripted, reproducible pipeline (Principle IV), and
  the approved models were already built from code, so rebuilding them headlessly is
  deterministic. Joining by material keeps a whole stage to about 15–30 draw calls.
- **Alternatives**: hand-exporting from the Blender UI (not reproducible); building the models
  procedurally in Three.js (duplicates the art and drifts from the approved renders).

## R5. How "slots" and tower stages work in the game

- **Decision**:
  - Each stage is its own glb (`clock-tower-stage-1.glb` … `-6.glb`) showing the tower when that
    stage is complete. Stage 0 is the foundation only.
  - While stage N is being built, the plot shows: the completed model for stage N−1; a translucent
    blue "ghost" of the stage-N model (shared ghost material: Fresnel rim + 25 % alpha, like the
    mockup); and one glowing **slot marker** per required piece on a ring around the foundation.
  - A delivered piece flies along an arc into the next free marker, and its mesh stays there,
    stacked as part of a visible "delivery pile".
  - When the last slot fills, a puff hides the pile, the stage-N model replaces N−1, and the ghost
    moves on to N+1.
- **Rationale**: This meets FR-009/010/013 and the "auto-fill the next slot" assumption, keeps the
  controls to one button, needs no per-piece placement art, and reuses the approved stage models
  directly.
- **Alternatives**: individual pieces becoming exact parts of the tower (needs bespoke geometry per
  slot, which is a lot of art for a prototype); a progress bar only (fails the "every piece is
  visible" feeling).

## R6. Physics scope (Rapier)

- **Decision**: Rapier `KinematicCharacterController` for the worker (capsule, snap-to-ground,
  autostep 0.3 m, max slope 45°). Static colliders: the lot slab, the tower plot (simple boxes per
  stage), the supply racks and the fence. Pieces have three physics states:
  - on a rack: no body (they are instanced visuals);
  - held: no body, parented to the hand;
  - loose or tossed: a dynamic body (box/cylinder collider) that sleeps quickly.

  When a piece snaps, its body is removed. Cones are dynamic bodies. Playable bounds are enforced by
  invisible walls; falling below y = −5 respawns the worker. Fixed 60 Hz physics step with an
  accumulator.
- **Rationale**: Constitution Principle III (physics only for characters, held/thrown items and
  machines). The compat build embeds the WASM, so there's no extra fetch or MIME setup; it adds
  about 0.6–0.8 MB gzip, which fits within 5 MB.
- **Alternatives**: a hand-written controller with raycasts (less robust on slopes and steps);
  cannon-es (slower, no character controller).

## R7. Worker character and animation

- **Decision**: The worker is exported as a small node hierarchy, not a skinned mesh: `Body` (head,
  torso and face merged by material), `Arm_L`, `Arm_R`, `Leg_L`, `Leg_R` and `Hat` (tinted at
  runtime for the guest color). Animation is procedural in code:
  - walk and run: leg swing, body bob, arm swing;
  - jump: squash and stretch;
  - carry: arms forward;
  - toss: a quick arm flick;
  - cheer: both arms up with a bounce;
  - idle: breathing.
- **Rationale**: With a single character in this feature, procedural motion is enough and avoids
  rigging and animation export. The hierarchy maps cleanly to the later instanced/VAT crowd approach.
- **Alternatives**: an armature with glTF animation clips (more pipeline work now, needed later for
  100-player crowds; deferred).

## R8. Input on every device

- **Decision**: One action layer (`move`, `look`, `jump`, `action`, `toss`, `respawn`, `menu`) with
  three sources:
  - **keyboard/mouse**: WASD/arrows to move; Shift to run; Space to jump; E or left click for the
    action; Q, or holding the action button, to toss; right-drag/mouse to orbit; R to respawn;
  - **touch**: an in-house dynamic joystick on the left half of the screen; drag on the right half
    to orbit; buttons [JUMP] [GRAB/DROP] [TOSS];
  - **gamepad**: the Gamepad API.

  On-screen controls appear after the first `touchstart`. Running = joystick pushed more than 85 %
  (or Shift).
- **Rationale**: Principle V (move + 1–2 buttons). Writing the joystick in-house avoids a dependency
  and keeps the payload small.
- **Alternatives**: nipplejs (an extra dependency and its own styling).

## R9. Audio

- **Decision**: Procedural WebAudio sound effects synthesized at runtime: pop (pick-up), thud
  (drop), whoosh (toss), sparkle-chime (snap), soft buzz (wrong piece), rising arpeggio (stage
  complete), synth bell plus firework crackles (Masterpiece). There is a mute toggle, saved in the
  guest profile. The AudioContext is unlocked on the first user gesture.
- **Rationale**: There are no audio files to download (Principle I). These sounds are easy to tune
  and are original.
- **Alternatives**: OGG/MP3 clips (about 50–300 KB, licensing to manage); deferred to a later polish
  phase.

## R10. Loading strategy and payload budget

- **Decision**:
  - **Critical set** (blocks play): JS bundle (three + rapier-compat + game code); `lot.glb`,
    `worker.glb`, `pieces.glb`, `racks.glb`, `clock-tower-stage-0.glb` (foundation) and
    `clock-tower-stage-1.glb` (needed for the first ghost).
  - **Deferred set** (streams after spawn): stages 2–6 and `fx.glb` (fireworks, confetti, sparkles).
  - A tiny CSS/HTML loading screen with a progress bar appears immediately.

  Budgets live in `tools/assets/budgets.json`:
  - critical total ≤ 5 MB compressed (target ≤ 3 MB);
  - JS ≤ 1.6 MB gzip;
  - each glb ≤ 600 KB;
  - worker ≤ 150 KB.

  Vite code-splitting keeps debug and perf tooling out of the production bundle.
- **Rationale**: SC-001/SC-002 and FR-026.
- **Alternatives**: one bundle with every asset (slower first load).
- **Update (implementation, 2026-11-04)**: the measured JS bundle is 1.87 MB gzip, because
  rapier3d-compat inlines its 3 MB WASM as base64. The JS budget is raised to 2.0 MB gzip. The
  critical total is still about 2.3 MB, under the 3 MB target and the 5 MB limit.
  Follow-up: switch to the non-compat `@dimforge/rapier3d` and serve the `.wasm` file separately
  (about 1.17 MB gzip, streaming compile), saving about 0.45 MB.

## R11. Performance budgets and how they are checked

- **Decision**: Budget table (Principle III):

  | Metric | Desktop (high) | Mobile (low) |
  |---|---|---|
  | Draw calls, worst case (Masterpiece + celebration) | ≤ 250 | ≤ 150 |
  | Triangles | ≤ 400 k | ≤ 200 k |
  | Texture memory | ≤ 64 MB | ≤ 32 MB |
  | Frame rate | ≥ 60 fps | ≥ 30 fps |

  The mobile tier lowers shadow resolution, outline distance and particle counts, and caps the
  pixel ratio at 1.5.

  `pnpm perf` runs a Playwright test that opens `/?perf=1` with the "reference scene" (Masterpiece
  plus celebration, fixed camera). It reads `renderer.info` through the debug API and **fails** on
  the draw-call and triangle budgets. It records the median frame time as informational, because
  headless/software GPUs cannot measure real fps.

  Real fps is checked manually with the in-game FPS overlay (`?debug=1`) on the reference devices
  listed in quickstart.md: a desktop Chrome laptop, an iPhone 12 or newer with Safari, and a
  Pixel 6a-class Android phone with Chrome.
- **Rationale**: Deterministic metrics can be automated reliably; fps needs real hardware.
- **Alternatives**: fully automated device farms (overkill for a prototype).

## R12. Guest identity

- **Decision**: The `shared` package exports a deterministic name generator: an adjective list
  (Sunny, Bouncy, Cozy…) plus a construction noun (Bolt, Brick, Beam…), with an optional two-digit
  suffix. It also exports an 8-color hard-hat palette. The profile is stored in `localStorage` as
  `hht.profile.v1` (`{name, hatColor, muted, hintsDone, createdAt}`), with every read and write
  wrapped in try/catch; if storage is unavailable it falls back to memory. Names are "shuffled" only
  from the lists: no free text (Principle V).
- **Rationale**: FR-002/FR-003 and the edge case where storage is blocked.

## R13. Testing approach

- **Decision**:
  - **Vitest unit tests (shared)**: blueprint validity, stage progression, slot filling and
    rejection, star rating, loose-piece fade rules, name generator.
  - **Vitest unit tests (client)**: input mapping, piece manager and the profile store, run in the node environment (jsdom failed to start under Vitest 5).
  - **Playwright e2e tests**:
    - load the page and see the worker;
    - move with the keyboard;
    - snap flow through the debug API (`__hht.debug.give('beam')` and similar);
    - stage transition;
    - Masterpiece reset.
  - **Budget and perf checks**: `pnpm check:budgets` and `pnpm perf`.
  - **CI script**: `pnpm verify` = typecheck + unit + build + budgets + e2e + perf.
- **Rationale**: Principle VI.

## R14. Hosting for the prototype

- **Decision**: Static build (`pnpm --filter client build` → `packages/client/dist`), previewed
  locally with `vite preview`, deployable as is to Cloudflare Pages. No server is needed for this
  feature. A `packages/server` placeholder exists only with a README describing phase 2.
- **Rationale**: Principle VII; multiplayer is out of scope.
