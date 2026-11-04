# Contract: Blender → glTF Asset Conventions

The exporter (`tools/blender/export_assets.py`) and the client (`packages/client/src/assets/`)
agree on these names. The exporter fails if a required node is missing; the client fails loudly in
dev builds.

## Files (ids)

| id | Group | Contents | Budget (compressed) |
|---|---|---|---|
| `worker` | critical | Worker hierarchy (see below) | ≤ 150 KB |
| `lot` | critical | Floating ground tile, grass, dirt, trees, rocks, edge rails, spawn pad, scenery machines **and the supply racks** (merged to save draw calls) | ≤ 400 KB |
| `pieces` | critical | One node per piece type: `Piece_beam`, `Piece_brick`, `Piece_panel`, `Piece_paint`, `Piece_decor`, `Piece_bell`, `Piece_cone` | ≤ 150 KB |
| `clock-tower-stage-0` | critical | Foundation slab + sign | ≤ 100 KB |
| `clock-tower-stage-1` … `-6` | stage 1 critical, 2–6 deferred | Completed tower at that stage, workers removed | ≤ 600 KB each |
| `fx` | deferred | Firework burst, confetti piece, sparkle star, puff cloud | ≤ 100 KB |

## Node names

- **Lot**: `Spawn`, `TowerPlot`, `Rack_<type>_Top` (one per piece type incl. `cone`; world transform = rack top + rack yaw).
- **Worker**: `Worker` (root) > `Body`, `Hat` (tinted at runtime), `Arm_L`, `Arm_R`, `Leg_L`,
  `Leg_R`, `Hand_R` (empty), `Carry` (empty in front of the chest). The pivot of each limb node is at its joint.
- **Tower stages**: root `ClockTower_Stage<N>`; `Sign_Stars` (empty: where the star sign is placed;
  stars are drawn by the client); `BuildZone` (empty: center of the build zone).
- **Ghost source**: the client builds the ghost from the next stage's meshes, so no ghost meshes are
  exported.

## Materials

- `T_<palette>`: toon material. The glTF base color = the lit color; the client swaps in the toon
  material with a shadow tint of (0.50, 0.52, 0.66) × base. Palette names match the Blender
  builders (`yellow`, `orange`, `beam`, `cream`, `teal`, `gold`, …).
- `T_brickwall`: the client applies a procedural brick pattern (running bond, 0.26 × 0.12 m bricks,
  mortar 0.012 m) on top of the toon shading.
- `G_<name>`: glow material. The glTF emissive color and strength (KHR_materials_emissive_strength)
  are rendered unlit by the client and picked up by the bloom pass on the high quality tier.
- `Ghost_Blueprint` is not exported; it is a client-side material.

## Units and axes

Meters, glTF +Y up (the Blender exporter converts from Z-up). The front of every asset faces −Y in
Blender, which becomes **+Z** in glTF/three.js. Tower stages are exported with a root scale of 1.6.
