"""Construction machines (feature 003): tower crane, excavator, forklift and cement mixer.

Original chunky toon machines in the approved palette. Blender units: meters, Z up, front = -Y
(three.js +Z after export). Each machine is split into rig parts under its root; the part names and
pivots are a contract with packages/client/src/machines/rig.ts (keep the constants in sync):

    Crane     > Mast, Cab, Jib, Trolley, Hook   (Jib/Cab pivot on the slew axis; Hook origin = hook tip)
    Excavator > Body, Boom, Arm, Bucket          (pivots at the joints)
    Forklift  > Body, Mast, Forks                (Forks origin = fork carriage at height 0)
    Mixer     > Body, Drum, Chute                (Drum origin = drum centre, axis along -Y)

`build_<kind>(lod=True)` builds a simplified variant under `<Kind>_LOD1` (merged and decimated by the
exporter to ≤ 600 triangles). `render_review(out_dir)` writes the owner review renders (FR-037).
"""
import math
import os

import bpy
from mathutils import Vector

from . import site_layout as L
from .common import D, beam, empty, new_obj, reset_scene, toon

# ---------------------------------------------------------------- rig contract (mirrored in client rig.ts)
CRANE_SLEW_Z = 13.4          # slew axis height (jib and cab pivot); spots.crane.cabHeight = 14
CRANE_TROLLEY_Z = 13.22      # trolley under the jib
CRANE_TROLLEY_REST = 4.0     # trolley radius in the rest pose (along -Y)
CRANE_HOOK_REST_Z = 12.8     # hook tip at rest (= cabHeight - 1.2)
CRANE_JIB_LEN = 8.2
CRANE_CAB = (0.0, 0.8, -0.55)  # cab centre relative to the slew pivot (behind the mast, below the jib)
EXC_BOOM_PIVOT = (-0.15, -0.55, 1.0)
EXC_BOOM_VEC = (0.0, -1.1, 0.8)    # boom pivot -> arm pivot (rest)
EXC_ARM_VEC = (0.0, -0.65, -1.1)   # arm pivot -> bucket pivot (rest)
FORK_MAST_Y = -0.62
MIXER_DRUM = (0.0, 0.1, 1.2)


def _part(name, root, loc=(0, 0, 0)):
    return empty(name, loc=loc, parent=root)


# ---------------------------------------------------------------- crane

def build_crane(lod=False):
    C = empty('Crane_LOD1' if lod else 'Crane')
    y, dark, conc = toon('yellow'), toon('dark'), toon('concrete')
    mast = _part('Mast', C)
    new_obj('cube', 'Footing', loc=(0, 0, 0.18), scale=D(1.5, 1.5, 0.36), mat=conc, bevel=0 if lod else 0.05, parent=mast)
    top = CRANE_SLEW_Z - 0.25
    w = 0.36
    if lod:
        new_obj('cube', 'MastBox', loc=(0, 0, (0.36 + top) / 2), scale=D(2 * w, 2 * w, top - 0.36), mat=y, parent=mast)
    else:
        corners = [(-w, -w), (w, -w), (w, w), (-w, w)]
        for dx, dy in corners:
            beam((dx, dy, 0.36), (dx, dy, top), 0.045, y, 'Post', parent=mast, vertices=6)
        segs = 9  # lattice bays (render.machines triangle budget)
        sh = (top - 0.36) / segs
        for i in range(segs):
            z0, z1 = 0.36 + i * sh, 0.36 + (i + 1) * sh
            for k in range(4):
                a, b = corners[k], corners[(k + 1) % 4]
                p, q = ((a[0], a[1], z0), (b[0], b[1], z1)) if i % 2 == 0 else ((b[0], b[1], z0), (a[0], a[1], z1))
                beam(p, q, 0.022, y, 'Brace', parent=mast, vertices=5)
        new_obj('cyl', 'SlewRing', loc=(0, 0, top + 0.1), scale=(0.55, 0.55, 0.1), mat=dark, smooth='angle', parent=mast, vertices=20)
    # cab: hangs behind the slew ring, turns with the jib
    cab = _part('Cab', C, loc=(0, 0, CRANE_SLEW_Z))
    cx, cy, cz = CRANE_CAB
    new_obj('cube', 'CabBox', loc=(cx, cy, cz), scale=D(1.0, 0.95, 1.1), mat=y, bevel=0 if lod else 0.07, parent=cab)
    if not lod:
        new_obj('cube', 'CabWindow', loc=(cx, cy - 0.48, cz + 0.12), scale=D(0.8, 0.04, 0.55), mat=toon('glass'), parent=cab)
        new_obj('cube', 'CabSide', loc=(cx + 0.51, cy, cz + 0.12), scale=D(0.04, 0.6, 0.45), mat=toon('glass'), parent=cab)
        new_obj('sphere', 'Beacon', loc=(cx, cy, cz + 0.62), scale=(0.08, 0.08, 0.07), mat=toon('orange'), smooth='all', parent=cab, segments=10, ring_count=6)
    # jib (-Y) and counter-jib (+Y) with ballast and an apex
    jib = _part('Jib', C, loc=(0, 0, CRANE_SLEW_Z))
    J = CRANE_JIB_LEN
    if lod:
        new_obj('cube', 'JibBox', loc=(0, -J / 2 + 0.4, 0.2), scale=D(0.5, J + 0.8, 0.45), mat=y, parent=jib)
        new_obj('cube', 'CounterJibBox', loc=(0, 1.6, 0.15), scale=D(0.6, 3.0, 0.3), mat=y, parent=jib)
        new_obj('cube', 'Ballast', loc=(0, 2.6, -0.15), scale=D(0.9, 0.8, 0.7), mat=conc, parent=jib)
    else:
        for sx in (-1, 1):
            beam((0.26 * sx, 0.6, 0), (0.26 * sx, -J, 0), 0.035, y, 'JibChord', parent=jib, vertices=6)
        beam((0, 0.6, 0.6), (0, -J, 0.18), 0.035, y, 'JibTop', parent=jib, vertices=6)
        n = 8
        for i in range(n):
            ya, yb = 0.6 - (J + 0.6) * i / n, 0.6 - (J + 0.6) * (i + 1) / n
            zb = 0.6 + (0.18 - 0.6) * (i + 1) / n
            for sx in (-1, 1):
                beam((0.26 * sx, ya, 0), (0, yb, zb), 0.016, y, 'JibBrace', parent=jib, vertices=5)
                beam((0.26 * sx, yb, 0), (0, yb, zb), 0.014, y, 'JibBrace', parent=jib, vertices=5)
        for sx in (-1, 1):
            beam((0.3 * sx, 0.3, 0.05), (0.3 * sx, 3.0, 0.05), 0.04, y, 'CounterChord', parent=jib, vertices=6)
        new_obj('cube', 'Walkway', loc=(0, 1.65, 0.07), scale=D(0.62, 2.7, 0.05), mat=toon('steel'), parent=jib)
        for k in range(2):
            new_obj('cube', 'Ballast', loc=(0, 2.25 + 0.42 * k, -0.25), scale=D(0.95, 0.38, 0.7), mat=conc, bevel=0.03, parent=jib)
        beam((0, 0, 0.1), (0, 0, 2.0), 0.06, y, 'Apex', parent=jib, vertices=6)
        beam((0, 0, 2.0), (0, -J * 0.75, 0.35), 0.012, dark, 'Tie', parent=jib, vertices=4)
        beam((0, 0, 2.0), (0, 2.8, 0.2), 0.012, dark, 'Tie', parent=jib, vertices=4)
        new_obj('cube', 'JibTip', loc=(0, -J, 0.1), scale=D(0.6, 0.12, 0.3), mat=toon('red'), parent=jib)
    # trolley and hook (positioned by the client from p1/p2/p3)
    trolley = _part('Trolley', C, loc=(0, -CRANE_TROLLEY_REST, CRANE_TROLLEY_Z))
    new_obj('cube', 'TrolleyBox', loc=(0, 0, 0), scale=D(0.62, 0.55, 0.18), mat=dark, bevel=0 if lod else 0.03, parent=trolley)
    if not lod:
        for sy in (-1, 1):
            new_obj('cyl', 'Sheave', loc=(0, 0.15 * sy, -0.14), rot=(0, math.pi / 2, 0), scale=(0.09, 0.09, 0.05), mat=toon('steel'), smooth='angle', parent=trolley, vertices=10)
    hook = _part('Hook', C, loc=(0, -CRANE_TROLLEY_REST, CRANE_HOOK_REST_Z))
    new_obj('cube', 'HookBlock', loc=(0, 0, 0.42), scale=D(0.34, 0.26, 0.4), mat=y, bevel=0 if lod else 0.05, parent=hook)
    if not lod:
        new_obj('cube', 'HookStripe', loc=(0, -0.135, 0.42), scale=D(0.34, 0.02, 0.1), mat=dark, parent=hook)
        new_obj('torus', 'HookCurve', loc=(0, 0, 0.12), rot=(math.pi / 2, 0, 0), mat=toon('steel'), smooth='all', parent=hook,
                major_radius=0.1, minor_radius=0.025, major_segments=12, minor_segments=5)
    return C


# ---------------------------------------------------------------- excavator

def build_excavator(lod=False):
    E = empty('Excavator_LOD1' if lod else 'Excavator')
    y, dark = toon('yellow'), toon('dark')
    body = _part('Body', E)
    for sx in (-1, 1):
        new_obj('cube', 'Track', loc=(0.62 * sx, 0, 0.24), scale=D(0.44, 2.1, 0.48), mat=dark, bevel=0 if lod else 0.17, seg=3, parent=body)
        if not lod:
            for yy in (-0.6, 0, 0.6):
                new_obj('cyl', 'Wheel', loc=(0.85 * sx, yy, 0.24), rot=(0, math.pi / 2, 0), scale=(0.13, 0.13, 0.02), mat=toon('steel'), smooth='angle', parent=body, vertices=10)
    new_obj('cyl', 'Turntable', loc=(0, 0, 0.53), scale=(0.55, 0.55, 0.06), mat=toon('steel'), smooth='angle', parent=body, vertices=16)
    new_obj('cube', 'House', loc=(-0.05, 0.15, 0.85), scale=D(1.35, 1.4, 0.55), mat=y, bevel=0 if lod else 0.12, parent=body)
    new_obj('cube', 'Counterweight', loc=(-0.05, 0.85, 0.82), scale=D(1.3, 0.35, 0.5), mat=dark, bevel=0 if lod else 0.14, parent=body)
    new_obj('cube', 'Cab', loc=(0.3, -0.05, 1.45), scale=D(0.62, 0.7, 0.7), mat=y, bevel=0 if lod else 0.08, parent=body)
    if not lod:
        new_obj('cube', 'WinFront', loc=(0.3, -0.41, 1.5), scale=D(0.48, 0.04, 0.42), mat=toon('glass'), parent=body)
        new_obj('cube', 'WinSide', loc=(0.62, -0.05, 1.5), scale=D(0.04, 0.5, 0.42), mat=toon('glass'), parent=body)
        new_obj('sphere', 'Beacon', loc=(0.3, -0.05, 1.86), scale=(0.08, 0.08, 0.07), mat=toon('orange'), smooth='all', parent=body, segments=10, ring_count=6)
        new_obj('cube', 'Stripe', loc=(-0.05, 0.86, 0.95), scale=D(1.32, 0.37, 0.08), mat=toon('beam'), parent=body)
    px, py, pz = EXC_BOOM_PIVOT
    boom = _part('Boom', E, loc=EXC_BOOM_PIVOT)
    bx, by, bz = EXC_BOOM_VEC
    beam((0, 0, 0), (bx, by, bz), 0.12, y, 'BoomBeam', parent=boom, square=True)
    if not lod:
        beam((0, 0.25, -0.25), (bx * 0.6, by * 0.6, bz * 0.6 - 0.1), 0.045, toon('steel'), 'BoomRam', parent=boom, vertices=8)
    arm = _part('Arm', E, loc=(px + bx, py + by, pz + bz))
    ax, ay, az = EXC_ARM_VEC
    beam((0, 0, 0), (ax, ay, az), 0.09, y, 'ArmBeam', parent=arm, square=True)
    if not lod:
        new_obj('cyl', 'Joint', loc=(0, 0, 0), rot=(0, math.pi / 2, 0), scale=(0.1, 0.1, 0.14), mat=dark, smooth='angle', parent=arm, vertices=10)
    bucket = _part('Bucket', E, loc=(px + bx + ax, py + by + ay, pz + bz + az))
    new_obj('cube', 'BucketShell', loc=(0, -0.16, -0.12), rot=(math.radians(-20), 0, 0), scale=D(0.55, 0.36, 0.32), mat=dark, bevel=0 if lod else 0.07, parent=bucket)
    if not lod:
        for k in range(4):
            new_obj('cone', 'Tooth', loc=(-0.2 + 0.13 * k, -0.36, -0.27), rot=(math.radians(110), 0, 0), mat=toon('steel'), parent=bucket, vertices=4, radius1=0.035, radius2=0, depth=0.1)
    return E


# ---------------------------------------------------------------- forklift

def build_forklift(lod=False):
    F = empty('Forklift_LOD1' if lod else 'Forklift')
    y, dark = toon('yellow'), toon('dark')
    body = _part('Body', F)
    new_obj('cube', 'Chassis', loc=(0, 0.15, 0.45), scale=D(1.05, 1.55, 0.5), mat=y, bevel=0 if lod else 0.1, parent=body)
    new_obj('cube', 'Counterweight', loc=(0, 0.85, 0.5), scale=D(1.05, 0.32, 0.62), mat=dark, bevel=0 if lod else 0.12, parent=body)
    for sx in (-1, 1):
        for sy, r in ((-0.5, 0.26), (0.62, 0.22)):
            new_obj('cyl', 'Wheel', loc=(0.5 * sx, sy, r), rot=(0, math.pi / 2, 0), scale=(r, r, 0.12), mat=dark, smooth='angle', parent=body, vertices=8 if lod else 14)
    # overhead guard
    for sx in (-1, 1):
        for sy in (-0.35, 0.55):
            beam((0.45 * sx, sy, 0.7), (0.45 * sx, sy, 1.95), 0.035, dark, 'GuardPost', parent=body, vertices=6)
    new_obj('cube', 'GuardRoof', loc=(0, 0.1, 1.97), scale=D(1.0, 1.05, 0.06), mat=dark, parent=body)
    if not lod:
        new_obj('cube', 'Seat', loc=(0, 0.3, 0.85), scale=D(0.5, 0.4, 0.14), mat=dark, bevel=0.04, parent=body)
        new_obj('cube', 'SeatBack', loc=(0, 0.5, 1.05), scale=D(0.5, 0.1, 0.4), mat=dark, bevel=0.04, parent=body)
        beam((0, -0.25, 0.7), (0, -0.15, 1.15), 0.025, dark, 'Column', parent=body, vertices=6)
        new_obj('torus', 'Wheelie', loc=(0, -0.15, 1.16), rot=(math.radians(60), 0, 0), mat=dark, smooth='all', parent=body, major_radius=0.13, minor_radius=0.018, major_segments=12, minor_segments=4)
        new_obj('sphere', 'Beacon', loc=(0, 0.1, 2.05), scale=(0.07, 0.07, 0.06), mat=toon('orange'), smooth='all', parent=body, segments=10, ring_count=6)
    mast = _part('Mast', F, loc=(0, FORK_MAST_Y, 0))
    for sx in (-1, 1):
        beam((0.3 * sx, 0, 0.08), (0.3 * sx, 0, 2.15), 0.05, toon('steel'), 'Upright', parent=mast, square=True)
    for z in (0.6, 1.4, 2.12):
        beam((-0.3, 0, z), (0.3, 0, z), 0.03, toon('steel'), 'Cross', parent=mast, square=True)
    forks = _part('Forks', F, loc=(0, FORK_MAST_Y, 0))
    new_obj('cube', 'Carriage', loc=(0, -0.07, 0.32), scale=D(0.7, 0.06, 0.55), mat=dark, parent=forks)
    for sx in (-1, 1):
        new_obj('cube', 'Fork', loc=(0.22 * sx, -0.47, 0.04), scale=D(0.1, 0.8, 0.05), mat=toon('steel'), parent=forks)
        new_obj('cube', 'ForkHeel', loc=(0.22 * sx, -0.09, 0.3), scale=D(0.1, 0.05, 0.55), mat=toon('steel'), parent=forks)
    return F


# ---------------------------------------------------------------- mixer

def build_mixer(lod=False):
    X = empty('Mixer_LOD1' if lod else 'Mixer')
    o, dark = toon('orange'), toon('dark')
    body = _part('Body', X)
    new_obj('cube', 'Frame', loc=(0, 0.1, 0.42), scale=D(0.9, 1.9, 0.16), mat=dark, parent=body)
    for sx in (-1, 1):
        new_obj('cyl', 'Wheel', loc=(0.55 * sx, 0.25, 0.3), rot=(0, math.pi / 2, 0), scale=(0.3, 0.3, 0.12), mat=dark, smooth='angle', parent=body, vertices=8 if lod else 14)
        beam((0.3 * sx, 0.1, 0.5), (0.3 * sx, 0.1, 0.85), 0.05, toon('yellow'), 'Cradle', parent=body, square=True)
    new_obj('cube', 'Engine', loc=(0.0, 0.85, 0.75), scale=D(0.7, 0.45, 0.5), mat=toon('yellow'), bevel=0 if lod else 0.06, parent=body)
    # hopper (back, where crews drop cement bags) and the operator's controls (left side)
    new_obj('cone', 'Hopper', loc=(0, 1.05, 1.55), rot=(math.pi, 0, 0), mat=toon('yellow'), parent=body, vertices=4 if lod else 8, radius1=0.42, radius2=0.18, depth=0.45)
    new_obj('cube', 'Controls', loc=(0.62, -0.1, 0.8), scale=D(0.2, 0.3, 0.45), mat=toon('yellow'), bevel=0 if lod else 0.04, parent=body)
    if not lod:
        new_obj('cube', 'Lever', loc=(0.7, -0.1, 1.08), scale=D(0.03, 0.03, 0.18), mat=toon('red'), parent=body)
        beam((0, -0.85, 0.42), (0, -1.15, 0.2), 0.04, dark, 'Hitch', parent=body, vertices=6)
    drum = _part('Drum', X, loc=MIXER_DRUM)
    # drum axis along -Y (client spins it about three.js +Z)
    for (cy, r1, r2, d, mat) in ((-0.55, 0.62, 0.32, 0.5, o), (0.35, 0.62, 0.42, 0.45, o)):
        rot = (math.pi / 2, 0, 0) if cy < 0 else (-math.pi / 2, 0, 0)
        new_obj('cone', 'DrumCone', loc=(0, cy, 0), rot=rot, mat=mat, smooth='angle', parent=drum, vertices=8 if lod else 18, radius1=r1, radius2=r2, depth=d)
    new_obj('cyl', 'DrumMid', loc=(0, -0.1, 0), rot=(math.pi / 2, 0, 0), scale=(0.63, 0.63, 0.2), mat=toon('white'), smooth='angle', parent=drum, vertices=8 if lod else 18)
    if not lod:
        for k in range(3):
            a = k * math.tau / 3
            beam((math.cos(a) * 0.5, -0.5, math.sin(a) * 0.5), (math.cos(a + 1.2) * 0.55, 0.3, math.sin(a + 1.2) * 0.55), 0.035, toon('white'), 'Fin', parent=drum, vertices=4)
    chute = _part('Chute', X, loc=(0, -0.95, 0.95))
    beam((0, 0, 0), (0, -0.55, -0.4), 0.09, toon('steel'), 'Trough', parent=chute, square=True)
    return X


BUILDERS = {'crane': build_crane, 'excavator': build_excavator, 'forklift': build_forklift, 'mixer': build_mixer}
PARTS = {
    'crane': ['Mast', 'Cab', 'Jib', 'Trolley', 'Hook'],
    'excavator': ['Body', 'Boom', 'Arm', 'Bucket'],
    'forklift': ['Body', 'Mast', 'Forks'],
    'mixer': ['Body', 'Drum', 'Chute'],
}
ROOTS = {'crane': 'Crane', 'excavator': 'Excavator', 'forklift': 'Forklift', 'mixer': 'Mixer'}


# ---------------------------------------------------------------- owner review renders (FR-037)

def _camera(scene, loc, target, lens):
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    scene.collection.objects.link(cam)
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens
    scene.camera = cam


def _render(path, size=(1400, 1000)):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_shadows = True
    sh.show_cavity = True
    sh.show_object_outline = True
    sh.object_outline_color = (0.16, 0.10, 0.10)
    scene.world = scene.world or bpy.data.worlds.new('W')
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.film_transparent = False
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('[render] wrote', path)


def _ground(r=7.0):
    new_obj('cyl', 'Ground', loc=(0, 0, -0.05), scale=(r, r, 0.05), mat=toon('grass'), smooth='angle', vertices=48)


def render_review(out_dir):
    """machine-<kind>.png (one per machine) and machines-plot.png (one plot with all 4 machines)."""
    os.makedirs(out_dir, exist_ok=True)
    views = {
        'crane': ((17, -22, 13), (0, -3.0, 7.5), 22),
        'excavator': ((3.6, -4.8, 3.0), (0, -0.5, 0.9), 45),
        'forklift': ((3.0, -4.0, 2.4), (0, -0.2, 0.9), 45),
        'mixer': ((3.0, -3.8, 2.4), (0, 0, 1.0), 45),
    }
    for kind, build in BUILDERS.items():
        reset_scene()
        _ground(4 if kind != 'crane' else 9)
        build()
        loc, target, lens = views[kind]
        _camera(bpy.context.scene, loc, target, lens)
        _render(os.path.join(out_dir, f'machine-{kind}.png'))
    reset_scene()
    _plot_scene()
    _camera(bpy.context.scene, (17, -21, 17), (0, 0.5, 5.0), 24)
    _render(os.path.join(out_dir, 'machines-plot.png'), (1600, 1100))


def _plot_scene():
    """One plot in its yard (local frame of site_layout: front = -Y): pit, spoil heap, hook pad, parking marks."""
    new_obj('cyl', 'Yard', loc=(0, 0, -0.06), scale=(L.YARD_RADIUS, L.YARD_RADIUS, 0.05), mat=toon('grass'), smooth='angle', vertices=48)
    new_obj('cyl', 'PlotPad', loc=(0, 0, 0.0), scale=(L.BUILD_ZONE_RADIUS + 0.9, L.BUILD_ZONE_RADIUS + 0.9, 0.015), mat=toon('dirt'), smooth='angle', vertices=40)
    groundwork_marks(None, (0, 0), 0.0)
    M = machine_poses_local()
    for kind, (x, y, rot) in M.items():
        root = BUILDERS[kind]()
        root.location = (x, y, 0)
        root.rotation_euler = (0, 0, rot)


def machine_poses_local():
    """Parked machine poses in the plot-local Blender frame (x, y, rotz)."""
    def face(frm, to):
        return math.atan2(-(to[0] - frm[0]), to[1] - frm[1]) + math.pi  # model front = -Y

    c = (0.0, 0.0)
    return {
        'crane': (L.CRANE_LOCAL[0], L.CRANE_LOCAL[1], face(L.CRANE_LOCAL, c)),
        'excavator': (L.EXCAVATOR_PARK[0], L.EXCAVATOR_PARK[1], face(L.EXCAVATOR_PARK, L.CRANE_LOCAL)),
        'forklift': (L.FORKLIFT_PARK[0], L.FORKLIFT_PARK[1], face(L.FORKLIFT_PARK, (0.0, -24.0))),
        'mixer': (L.MIXER_LOCAL[0], L.MIXER_LOCAL[1], face(L.MIXER_LOCAL, c)),
    }


def groundwork_marks(parent, center, rot, spoil=None, pad=None, parks=None):
    """Pit outline, spoil-heap base, yellow-striped hook pad and parking marks around a plot
    (site.py, lot.py and the renders). Offsets are plot-local (default: the multiplayer layout)."""
    spoil = spoil or L.SPOIL_LOCAL
    pad_l = pad or L.HOOK_PAD_LOCAL
    parks = parks or (L.EXCAVATOR_PARK, L.FORKLIFT_PARK)
    cx, cy = center
    c, s = math.cos(rot), math.sin(rot)

    def w(lx, ly):
        return (cx + lx * c - ly * s, cy + lx * s + ly * c)

    h = L.PIT_HALF + 0.12
    for k in range(4):
        a = rot + k * math.pi / 2
        ex, ey = w(*[(0, -h), (h, 0), (0, h), (-h, 0)][k])
        o = new_obj('cube', 'PitEdge', loc=(ex, ey, 0.02), scale=D(2 * h + 0.12, 0.12, 0.04), mat=toon('dark'), parent=parent)
        o.rotation_euler = (0, 0, a)
    sx, sy = w(*spoil)
    new_obj('cyl', 'SpoilBase', loc=(sx, sy, 0.01), scale=(L.SPOIL_RADIUS, L.SPOIL_RADIUS, 0.02), mat=toon('mound'), smooth='angle', parent=parent, vertices=20)
    px, py = w(*pad_l)
    pad_o = new_obj('cube', 'HookPad', loc=(px, py, 0.015), scale=D(2 * L.HOOK_PAD_HALF, 2 * L.HOOK_PAD_HALF, 0.03), mat=toon('concrete'), parent=parent)
    pad_o.rotation_euler = (0, 0, rot)
    for k in range(5):
        t = -L.HOOK_PAD_HALF + 0.3 + k * (2 * L.HOOK_PAD_HALF - 0.6) / 4
        qx, qy = w(pad_l[0] + t, pad_l[1])
        st = new_obj('cube', 'PadStripe', loc=(qx, qy, 0.035), scale=D(0.14, 2 * L.HOOK_PAD_HALF - 0.2, 0.01), mat=toon('yellow'), parent=parent)
        st.rotation_euler = (0, 0, rot + math.radians(25))
    for (lx, ly) in parks:
        mx, my = w(lx, ly)
        ring = new_obj('torus', 'ParkMark', loc=(mx, my, 0.02), mat=toon('white'), smooth='all', parent=parent,
                       major_radius=1.0, minor_radius=0.04, major_segments=24, minor_segments=3)
        ring.scale = (1, 1, 0.3)
