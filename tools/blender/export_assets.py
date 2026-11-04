"""Headless asset export for Hard Hat Town.

Usage (from the repo root):
    blender --background --factory-startup --python tools/blender/export_assets.py [-- <asset-id> ...]

For every asset: build it in a clean scene, bake modifiers, merge meshes per material inside each
animatable/instanceable group node, drop helper empties, export to assets/build/raw/<id>.glb and
record it in assets/build/raw/assets.json (consumed by tools/assets/compress.mjs).
Also regenerates packages/client/src/render/palette.gen.ts from builders/palette.py and
packages/shared/src/site.gen.ts from builders/site_layout.py.
"""
import json
import os
import sys
import time

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)

from builders import clock_tower, foreman, fx, lot, pieces, props_mp, site, site_layout, worker  # noqa: E402
from builders.common import reset_scene  # noqa: E402
from builders.palette import PALETTE  # noqa: E402

RAW = os.path.join(ROOT, 'assets', 'build', 'raw')

PIECE_IDS = ['beam', 'brick', 'panel', 'paint', 'decor', 'bell', 'cone']
RACK_IDS = ['beam', 'brick', 'panel', 'paint', 'decor', 'bell']


def asset_specs():
    specs = [
        dict(id='worker', group='critical', build=worker.build,
             groups=['Body', 'Hat', 'Arm_L', 'Arm_R', 'Leg_L', 'Leg_R'], keep=['Worker', 'Hand_R', 'Carry']),
        dict(id='pieces', group='critical', build=pieces.build,
             groups=[f'Piece_{p}' for p in PIECE_IDS], keep=['Pieces']),
        dict(id='lot', group='critical', build=lot.build, groups=['Lot'],
             keep=['Spawn', 'TowerPlot'] + [f'Rack_{p}_Top' for p in RACK_IDS + ['cone']]),
        dict(id='site', group='critical', build=site.build, groups=['Site'], keep=['Site'], vcol='site'),
        dict(id='fx', group='deferred', build=fx.build,
             groups=['Fx_puff', 'Fx_confetti', 'Fx_sparkle', 'Fx_ray'], keep=['Fx']),
    ]
    for n in range(7):
        specs.append(dict(id=f'clock-tower-stage-{n}', group='critical' if n <= 1 else 'deferred',
                          build=(lambda n=n: clock_tower.build(n)), groups=[f'ClockTower_Stage{n}'],
                          keep=['Sign_Stars', 'BuildZone'], scale=clock_tower.TOWER_SCALE))
    # feature 002: low-poly vertex-colored pieces for the multiplayer site (hundreds of instances)
    specs.append(dict(id='pieces-lod1', group='critical', build=pieces.build,
                      groups=[f'Piece_{p}' for p in PIECE_IDS], keep=['Pieces'], vcol='all', decimate=2100))
    # feature 002: crowd worker (decimated, same parts/materials so the hat can be tinted per instance)
    specs.append(dict(id='worker-lod1', group='critical', build=worker.build,
                      groups=['Body', 'Hat', 'Arm_L', 'Arm_R', 'Leg_L', 'Leg_R'], keep=['Worker', 'Hand_R', 'Carry'], decimate=1000, vcol='crowd'))
    # feature 002: Foreman, plot props, and two tower LODs per stage for the 12-plot site (research R7)
    specs.append(dict(id='foreman', group='critical', build=foreman.build,
                      groups=['Body', 'Head', 'Arm_L', 'Arm_R', 'Leg_L', 'Leg_R'], keep=['Foreman'], vcol='keep-special'))
    specs.append(dict(id='props-mp', group='critical', build=props_mp.build, groups=['PlotSign', 'SupplyBin'],
                      keep=['PropsMP', 'PlotSign_Face', 'PlotSign_Flag', 'SupplyBin_Top'], vcol='keep-special', decimate=900))
    for n in range(1, 7):
        # LOD0: toon colors baked to vertex colors → one toon mesh + brick + glows (≤ 15 draws with outlines)
        specs.append(dict(id=f'clock-tower-stage-{n}-merged', group='deferred', build=(lambda n=n: clock_tower.build(n)),
                          groups=[f'ClockTower_Stage{n}'], keep=['Sign_Stars'], scale=clock_tower.TOWER_SCALE, vcol='keep-special', decimate=20000))
        # LOD1: everything in one vertex-colored mesh, decimated (1 draw, critical so far towers show at once)
        specs.append(dict(id=f'clock-tower-lod1-{n}', group='critical', build=(lambda n=n: clock_tower.build(n)),
                          groups=[f'ClockTower_Stage{n}'], keep=[], scale=clock_tower.TOWER_SCALE, vcol='all', decimate=2500))
    return specs


def _base_color(mat):
    """Linear base (or emission) color of a builder material."""
    bsdf = mat.node_tree.nodes.get('Principled BSDF') if mat.node_tree else None
    if bsdf is None:
        return tuple(mat.diffuse_color[:3])
    if mat.name.startswith('G_'):
        c = bsdf.inputs['Emission Color'].default_value
        return (c[0], c[1], c[2])
    c = bsdf.inputs['Base Color'].default_value
    return (c[0], c[1], c[2])


# materials kept as-is per bake mode (everything else becomes the vertex-colored T_vcol)
VCOL_KEEP = {
    'keep-special': {'T_brickwall'},
    'crowd': {'T_hat'},  # the hard hat is tinted per instance
    'site': {'T_earth', 'T_grass', 'T_grass2', 'T_dirt', 'T_concrete', 'T_mound'},  # ground: no outlines/shadows
}


def bake_vertex_colors(mode):
    """Replace toon materials by one vertex-colored T_vcol material (mode 'all' also bakes glow/brick)."""
    vmat = bpy.data.materials.get('T_vcol')
    if vmat is None:
        vmat = bpy.data.materials.new('T_vcol')
        vmat.use_nodes = True
        bsdf = vmat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)
        attr = vmat.node_tree.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Col'
        vmat.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    for obj in list(bpy.data.objects):
        if obj.type != 'MESH' or not obj.material_slots or not obj.material_slots[0].material:
            continue
        mat = obj.material_slots[0].material
        if mat.name in VCOL_KEEP.get(mode, set()) or (mode != 'all' and mat.name.startswith('G_')):
            continue
        col = _base_color(mat)
        if mat.name == 'T_brickwall':
            col = tuple(x ** 2.2 for x in (0.80, 0.36, 0.26))
        me = obj.data
        if me.users > 1:
            obj.data = me = me.copy()
        attr = me.color_attributes.get('Col') or me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
        for d in attr.data:
            d.color = (col[0], col[1], col[2], 1.0)
        me.color_attributes.active_color = attr
        obj.material_slots[0].material = vmat


def decimate(objs, target_tris):
    """Collapse-decimate the merged meshes to roughly `target_tris` triangles in total."""
    total = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
    ratio = min(1.0, target_tris / max(1, total))
    if ratio >= 0.999:
        return
    for o in objs:
        mod = o.modifiers.new('Decimate', 'DECIMATE')
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(depsgraph))
        o.modifiers.clear()
        old = o.data
        o.data = me
        bpy.data.meshes.remove(old)


def nearest_group(obj, groups):
    p = obj.parent
    while p is not None:
        if p.name in groups:
            return p
        p = p.parent
    return None


def merge_groups(groups):
    """Bake modifiers and merge mesh descendants of each group, one mesh per material."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    group_objs = {name: bpy.data.objects[name] for name in groups}
    buckets = {}  # (group, material) -> [obj]
    for obj in list(bpy.data.objects):
        if obj.type != 'MESH':
            continue
        g = group_objs.get(obj.name) if obj.name in group_objs else nearest_group(obj, group_objs)
        if g is None:
            raise RuntimeError(f'mesh {obj.name} is not inside any export group')
        mats = [s.material for s in obj.material_slots if s.material]
        if len(mats) != 1:
            raise RuntimeError(f'mesh {obj.name} must have exactly one material, has {len(mats)}')
        buckets.setdefault((g.name, mats[0].name), []).append(obj)

    merged = []
    for (gname, mname), objs in buckets.items():
        g = group_objs[gname]
        g_inv = g.matrix_world.inverted()
        bm = bmesh.new()
        for obj in objs:
            tmp = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
            tmp.transform(g_inv @ obj.matrix_world)
            if (g_inv @ obj.matrix_world).determinant() < 0:
                tmp.flip_normals()
            bm.from_mesh(tmp)
            bpy.data.meshes.remove(tmp)
        me = bpy.data.meshes.new(f'{gname}_{mname}')
        bm.to_mesh(me)
        bm.free()
        me.materials.append(bpy.data.materials[mname])
        o = bpy.data.objects.new(f'{gname}__{mname}', me)
        bpy.context.scene.collection.objects.link(o)
        o.parent = g
        merged.append(o)
    # remove the original meshes
    for objs in buckets.values():
        for obj in objs:
            bpy.data.objects.remove(obj, do_unlink=True)
    return merged


def prune_empties(keep):
    """Delete helper empties that are neither groups nor contract nodes, re-parenting children."""
    changed = True
    while changed:
        changed = False
        for obj in list(bpy.data.objects):
            if obj.type != 'EMPTY' or obj.name in keep:
                continue
            mw_children = [(c, c.matrix_world.copy()) for c in obj.children]
            for c, mw in mw_children:
                c.parent = obj.parent
                c.matrix_world = mw
            bpy.data.objects.remove(obj, do_unlink=True)
            changed = True
            break


def export(spec):
    reset_scene()
    root = spec['build']()
    if spec.get('scale'):
        root.scale = (spec['scale'],) * 3
    bpy.context.view_layer.update()
    if spec.get('vcol'):
        bake_vertex_colors(spec['vcol'])
    merged = merge_groups(spec['groups'])
    if spec.get('decimate'):
        decimate(merged, spec['decimate'])
    keep = set(spec['groups']) | set(spec['keep']) | {root.name}
    prune_empties(keep)
    bpy.context.view_layer.update()
    os.makedirs(RAW, exist_ok=True)
    path = os.path.join(RAW, f"{spec['id']}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=False,
                              export_cameras=False, export_lights=False, export_animations=False,
                              export_extras=False, export_materials='EXPORT',
                              export_texcoords=False, export_normals=True,
                              export_vertex_color='ACTIVE' if spec.get('vcol') else 'NONE')
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in merged)
    nodes = sorted(keep)
    return dict(id=spec['id'], file=f"{spec['id']}.glb", group=spec['group'], nodes=nodes,
                meshes=len(merged), triangles=tris, bytes=os.path.getsize(path))


def write_palette_ts():
    lines = ['// GENERATED by tools/blender/export_assets.py from tools/blender/builders/palette.py — do not edit.',
             'export const PALETTE: Readonly<Record<string, readonly [number, number, number]>> = {']
    for k, (r, g, b) in PALETTE.items():
        lines.append(f"  {k}: [{r}, {g}, {b}],")
    lines.append('};')
    out = os.path.join(ROOT, 'packages', 'client', 'src', 'render', 'palette.gen.ts')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w') as f:
        f.write('\n'.join(lines) + '\n')


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    specs = [s for s in asset_specs() if not argv or s['id'] in argv]
    t0 = time.time()
    results = []
    for spec in specs:
        r = export(spec)
        print(f"[export] {r['id']:<22} meshes={r['meshes']:<3} tris={r['triangles']:<7} raw={r['bytes'] / 1024:.0f} KB")
        results.append(r)
    index_path = os.path.join(RAW, 'assets.json')
    existing = {}
    if argv and os.path.exists(index_path):
        with open(index_path) as f:
            existing = {a['id']: a for a in json.load(f)['assets']}
    for r in results:
        existing[r['id']] = r
    order = [s['id'] for s in asset_specs()]
    with open(index_path, 'w') as f:
        json.dump({'assets': [existing[i] for i in order if i in existing]}, f, indent=2)
    write_palette_ts()
    print(f'[export] site layout -> {site_layout.write_ts(ROOT)}')
    print(f'[export] done: {len(results)} assets in {time.time() - t0:.1f}s')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # make headless failures fail the process
        import traceback
        traceback.print_exc()
        print(f'[export] FAILED: {e}')
        sys.exit(1)
