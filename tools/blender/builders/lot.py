"""The floating construction lot (24 x 24 m) with yard, trees, rocks, spawn pad, edge rails and
static scenery machines (excavator + small tower crane from the approved art test).

Origin = lot center, ground level z = 0 (top of the dirt yard). Front edge = -Y.
"""
import math
import random

from mathutils import Vector

from .common import D, beam, empty, glow, new_obj, squircle_slab, toon
from .racks import RACK_COLORS, _rack

SIZE = 24.0
HALF = SIZE / 2

# Layout (Blender coords, meters). Mirrored by packages/client/src/world/layout.ts via exported empties.
TOWER_PLOT = (0.0, 2.5)
SPAWN = (0.0, -7.5)
RACKS = {  # type: (x, y, rotz deg) — racks face the yard center
    'beam': (-7.0, -3.0, -90), 'brick': (-7.0, 0.2, -90), 'panel': (-7.0, 3.4, -90),
    'paint': (7.0, -3.0, 90), 'decor': (7.0, 0.2, 90), 'bell': (7.0, 3.4, 90),
}
CONE_PILE = (-3.2, -6.0)


def _tree(root, loc, s):
    T = empty('Tree', loc=loc, parent=root)
    beam((0, 0, 0), (0, 0, 0.9 * s), 0.1 * s, toon('trunk'), 'Trunk', parent=T)
    new_obj('ico', 'Leaf', loc=(0, 0, 1.3 * s), scale=(0.65 * s,) * 3, mat=toon('leaf'), parent=T, subdivisions=2)
    new_obj('ico', 'Leaf2', loc=(0.3 * s, 0.15 * s, 1.0 * s), scale=(0.42 * s,) * 3, mat=toon('leaf'), parent=T, subdivisions=2)


def _excavator(root, loc, rotz):
    E = empty('Excavator', loc=loc, parent=root)
    E.rotation_euler = (0, 0, math.radians(rotz))
    for sy in (-1, 1):
        new_obj('cube', 'Track', loc=(0, 0.42 * sy, 0.17), scale=D(1.3, 0.32, 0.34), mat=toon('dark'), bevel=0.13, seg=4, parent=E)
        for x in (-0.4, 0, 0.4):
            new_obj('cyl', 'Wheel', loc=(x, 0.585 * sy, 0.17), rot=(math.pi / 2, 0, 0), scale=(0.1, 0.1, 0.01), mat=toon('steel'), smooth='angle', parent=E, vertices=12)
    new_obj('cyl', 'Turntable', loc=(0, 0, 0.39), scale=(0.38, 0.38, 0.05), mat=toon('steel'), smooth='angle', parent=E, vertices=20)
    new_obj('cube', 'Body', loc=(-0.1, 0, 0.6), scale=D(1.0, 0.9, 0.35), mat=toon('yellow'), bevel=0.1, parent=E)
    new_obj('cube', 'Counterweight', loc=(-0.56, 0, 0.62), scale=D(0.3, 0.86, 0.36), mat=toon('dark'), bevel=0.12, parent=E)
    new_obj('cube', 'Cab', loc=(0.1, 0.2, 1.02), scale=D(0.5, 0.45, 0.52), mat=toon('yellow'), bevel=0.08, parent=E)
    new_obj('cube', 'WinFront', loc=(0.35, 0.2, 1.07), scale=D(0.04, 0.34, 0.3), mat=toon('glass'), parent=E)
    new_obj('cube', 'WinSide', loc=(0.1, 0.425, 1.07), scale=D(0.34, 0.04, 0.3), mat=toon('glass'), parent=E)
    new_obj('sphere', 'Beacon', loc=(0.1, 0.2, 1.32), scale=(0.07, 0.07, 0.06), mat=toon('orange'), smooth='all', parent=E, segments=12, ring_count=8)
    beam((0.35, -0.15, 0.72), (1.0, -0.15, 1.52), 0.1, toon('yellow'), 'Boom', parent=E, square=True)
    beam((1.0, -0.15, 1.52), (1.45, -0.15, 0.62), 0.08, toon('yellow'), 'Stick', parent=E, square=True)
    new_obj('cube', 'Bucket', loc=(1.47, -0.15, 0.48), rot=(0, math.radians(-25), 0), scale=D(0.3, 0.34, 0.26), mat=toon('dark'), bevel=0.06, parent=E)
    E.scale = (1.4, 1.4, 1.4)


def _crane(root, loc):
    C = empty('Crane', loc=loc, parent=root)
    y = toon('yellow')
    new_obj('cube', 'Footing', loc=(0, 0, 0.1), scale=D(0.85, 0.85, 0.2), mat=toon('concrete'), bevel=0.04, parent=C)
    w, H, segs = 0.2, 4.2, 7
    corners = [(-w, -w), (w, -w), (w, w), (-w, w)]
    for dx, dy in corners:
        beam((dx, dy, 0.2), (dx, dy, 0.2 + H), 0.03, y, 'Post', parent=C, vertices=6)
    sh = H / segs
    for i in range(segs):
        z0, z1 = 0.2 + i * sh, 0.2 + (i + 1) * sh
        for k in range(4):
            a, b = corners[k], corners[(k + 1) % 4]
            p, q = ((a[0], a[1], z0), (b[0], b[1], z1)) if i % 2 == 0 else ((b[0], b[1], z0), (a[0], a[1], z1))
            beam(p, q, 0.016, y, 'Brace', parent=C, vertices=6)
    top = 0.2 + H
    new_obj('cube', 'Slew', loc=(0, 0, top + 0.06), scale=D(0.5, 0.5, 0.12), mat=toon('dark'), bevel=0.03, parent=C)
    new_obj('cube', 'Cab', loc=(0.2, -0.32, top + 0.28), scale=D(0.36, 0.3, 0.32), mat=y, bevel=0.06, parent=C)
    jz, jt = top + 0.2, top + 0.5
    for sy in (-1, 1):
        beam((-0.95, 0.13 * sy, jz), (3.2, 0.13 * sy, jz), 0.022, y, 'JibChord', parent=C, vertices=6)
    beam((0, 0, jt), (3.2, 0, jt), 0.022, y, 'JibTop', parent=C, vertices=6)
    for i in range(8):
        xa, xb = 3.2 * i / 8, 3.2 * (i + 1) / 8
        for sy in (-1, 1):
            beam((xa, 0.13 * sy, jz), (xb, 0, jt), 0.012, y, 'JibBrace', parent=C, vertices=6)
    new_obj('cube', 'Counterweight', loc=(-0.75, 0, jz - 0.12), scale=D(0.35, 0.38, 0.32), mat=toon('concrete'), bevel=0.04, parent=C)
    beam((2.5, 0, jz - 0.1), (2.5, 0, 2.6), 0.006, toon('dark'), 'Cable', parent=C, vertices=4)
    new_obj('cube', 'Hook', loc=(2.5, 0, 2.55), scale=D(0.16, 0.14, 0.16), mat=y, bevel=0.03, parent=C)
    new_obj('cube', 'Load', loc=(2.5, 0, 2.1), scale=D(1.2, 0.14, 0.12), mat=toon('beam'), bevel=0.02, parent=C)
    beam((2.5, 0, 2.47), (2.0, 0, 2.16), 0.004, toon('dark'), 'Sling', parent=C, vertices=4)
    beam((2.5, 0, 2.47), (3.0, 0, 2.16), 0.004, toon('dark'), 'Sling', parent=C, vertices=4)
    C.rotation_euler = (0, 0, math.radians(-35))


def build():
    random.seed(11)
    L = empty('Lot')
    # floating island: earth block + grass rim + dirt yard
    new_obj('cube', 'Earth', loc=(0, 0, -0.75), scale=D(SIZE, SIZE, 1.3), mat=toon('earth'), bevel=0.12, parent=L)
    new_obj('cube', 'Grass', loc=(0, 0, -0.08), scale=D(SIZE + 0.08, SIZE + 0.08, 0.14), mat=toon('grass'), bevel=0.06, parent=L)
    squircle_slab('Yard', HALF - 1.6, HALF - 1.6, -0.06, 0.0, toon('dirt'), parent=L)
    # supply racks (merged into the lot; client reads the *_Top empties for positions)
    for pid, (x, y, rz) in RACKS.items():
        R = empty(f'RackBase_{pid}', loc=(x, y, 0), parent=L)
        R.rotation_euler = (0, 0, math.radians(rz))
        _rack(R, RACK_COLORS[pid])
        empty(f'Rack_{pid}_Top', loc=(0, 0, 0.14), parent=R)
    C = empty('RackBase_cone', loc=(CONE_PILE[0], CONE_PILE[1], 0), parent=L)
    new_obj('cyl', 'ConeMat', loc=(0, 0, 0.02), scale=(0.7, 0.7, 0.02), mat=toon('dark'), smooth='angle', parent=C, vertices=20)
    empty('Rack_cone_Top', loc=(0, 0, 0.04), parent=C)
    empty('Spawn', loc=(SPAWN[0], SPAWN[1], 0.05), parent=L)
    empty('TowerPlot', loc=(TOWER_PLOT[0], TOWER_PLOT[1], 0.0), parent=L)
    # spawn pad (front center)
    new_obj('cyl', 'SpawnPad', loc=(0, -7.5, 0.02), scale=(1.4, 1.4, 0.03), mat=toon('concrete'), smooth='angle', parent=L, vertices=32)
    new_obj('torus', 'SpawnRing', loc=(0, -7.5, 0.05), mat=toon('yellow'), smooth='all', parent=L, major_radius=1.25, minor_radius=0.06, major_segments=32, minor_segments=6)
    # edge rails (red/white construction barrier look) on posts
    for side in range(4):
        for k in range(12):
            t0 = -HALF + 0.6 + k * (SIZE - 1.2) / 12
            t1 = t0 + (SIZE - 1.2) / 12
            if side == 0:
                p0, p1 = Vector((t0, -HALF + 0.35, 0)), Vector((t1, -HALF + 0.35, 0))
            elif side == 1:
                p0, p1 = Vector((t0, HALF - 0.35, 0)), Vector((t1, HALF - 0.35, 0))
            elif side == 2:
                p0, p1 = Vector((-HALF + 0.35, t0, 0)), Vector((-HALF + 0.35, t1, 0))
            else:
                p0, p1 = Vector((HALF - 0.35, t0, 0)), Vector((HALF - 0.35, t1, 0))
            beam(p0 - Vector((0, 0, 0.02)), p0 + Vector((0, 0, 0.7)), 0.05, toon('steel'), 'RailPost', parent=L, vertices=8)
            beam(p0 + Vector((0, 0, 0.6)), p1 + Vector((0, 0, 0.6)), 0.05, toon('red' if k % 2 == 0 else 'white'), 'Rail', parent=L, square=True)
    # trees, rocks, tufts on the grass rim
    for (x, y, s) in ((-10.6, 10.4, 1.3), (10.5, 10.6, 1.1), (-10.7, -6.0, 1.0), (10.6, -10.5, 0.9), (-3.0, 10.9, 0.8), (6.0, 10.8, 1.0), (10.8, 2.0, 0.85)):
        _tree(L, (x, y, -0.02), s)
    for i in range(14):
        a = random.uniform(0, math.tau)
        r = random.uniform(HALF - 1.4, HALF - 0.6)
        x, y = math.cos(a) * r, math.sin(a) * r
        x, y = max(-HALF + 0.5, min(HALF - 0.5, x)), max(-HALF + 0.5, min(HALF - 0.5, y))
        s = random.uniform(0.12, 0.25)
        new_obj('ico', 'Rock', loc=(x, y, 0.0), scale=(s * 1.3, s, s * 0.8), rot=(0, 0, random.uniform(0, 3)), mat=toon('rock'), parent=L, subdivisions=1)
    for i in range(40):
        x = random.uniform(-HALF + 0.5, HALF - 0.5)
        y = random.choice([random.uniform(-HALF + 0.4, -HALF + 1.4), random.uniform(HALF - 1.4, HALF - 0.4)])
        if random.random() < 0.5:
            x, y = y, x
        for k in range(3):
            new_obj('cone', 'Tuft', loc=(x + random.uniform(-0.1, 0.1), y + random.uniform(-0.1, 0.1), -0.03),
                    rot=(random.uniform(-0.3, 0.3), random.uniform(-0.3, 0.3), 0), mat=toon('grass2'), parent=L,
                    vertices=5, radius1=0.06, radius2=0.0, depth=random.uniform(0.2, 0.34))
    # dirt mound + static machines (scenery)
    new_obj('sphere', 'Mound', loc=(7.6, 6.4, 0), scale=(1.5, 1.2, 0.7), mat=toon('mound'), smooth='all', parent=L, segments=20, ring_count=10)
    _excavator(L, (9.6, 5.0, 0), 160)
    _crane(L, (-9.0, 8.6, 0))
    # tiny lamp on the spawn pad sign
    beam((1.6, -7.5, 0), (1.6, -7.5, 1.4), 0.04, toon('dark'), 'SpawnSignPost', parent=L)
    new_obj('cube', 'SpawnSign', loc=(1.6, -7.53, 1.25), scale=D(0.9, 0.06, 0.4), mat=toon('yellow'), bevel=0.03, parent=L)
    new_obj('sphere', 'SpawnLamp', loc=(1.6, -7.5, 1.5), scale=(0.08, 0.08, 0.08), mat=glow('bulb_warm', (1.0, 0.85, 0.45), 3.0), smooth='all', parent=L, segments=10, ring_count=6)
    return L
