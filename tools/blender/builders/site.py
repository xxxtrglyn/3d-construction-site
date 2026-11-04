"""Multiplayer site (feature 002): round floating island with a central plaza (spawn + Foreman),
12 tower plots on a ring and 4 shared supply yards. Layout numbers come from site_layout.py, which
also writes packages/shared/src/site.gen.ts (colliders, plots, racks) — keep both in one place.

Origin = island center, ground z = 0. Blender coords (front = -Y).
"""
import math
import random

from mathutils import Vector

from . import site_layout as L
from .common import D, beam, empty, glow, new_obj, toon
from .lot import _crane, _excavator, _tree
from .racks import RACK_COLORS


def _disk(name, r, z0, z1, mat, parent, vertices=64):
    h = z1 - z0
    return new_obj('cyl', name, loc=(0, 0, z0 + h / 2), scale=(r, r, h / 2), mat=mat, smooth='angle', parent=parent, vertices=vertices)


def _pad(name, x, y, r, mat, parent, z=0.0, h=0.03, vertices=40):
    return new_obj('cyl', name, loc=(x, y, z + h / 2 - 0.01), scale=(r, r, h / 2), mat=mat, smooth='angle', parent=parent, vertices=vertices)


def _path(root, a, b, width):
    """Flat dirt strip from point a to point b (ground level)."""
    a, b = Vector((a[0], a[1], 0.0)), Vector((b[0], b[1], 0.0))
    mid = (a + b) / 2
    d = b - a
    o = new_obj('cube', 'Path', loc=(mid.x, mid.y, 0.005), scale=D(d.length, width, 0.02), mat=toon('dirt'), parent=root)
    o.rotation_euler = (0, 0, math.atan2(d.y, d.x))
    return o


def _rack_lite(R, accent):
    """Low-poly supply rack for the big site (same silhouette and color code as racks._rack)."""
    new_obj('cube', 'Pallet', loc=(0, 0, 0.07), scale=D(1.5, 1.0, 0.14), mat=toon('wood'), bevel=0.015, seg=1, parent=R)
    for i in range(3):
        new_obj('cube', 'Slat', loc=(-0.5 + 0.5 * i, 0, 0.145), scale=D(0.36, 1.0, 0.02), mat=toon('wood'), parent=R)
    for x in (-0.78, 0.78):
        beam((x, 0.45, 0.0), (x, 0.45, 1.2), 0.04, toon('steel'), 'Post', parent=R, square=True)
    beam((-0.82, 0.45, 1.2), (0.82, 0.45, 1.2), 0.07, toon(accent), 'TopBar', parent=R, square=True)
    new_obj('cube', 'SignPlate', loc=(0, 0.42, 1.0), scale=D(0.5, 0.04, 0.28), mat=toon('white'), parent=R)
    new_obj('cube', 'SignDot', loc=(0, 0.39, 1.0), scale=D(0.2, 0.04, 0.16), mat=toon(accent), parent=R)


def build():
    random.seed(23)
    S = empty('Site')
    R = L.ISLAND_RADIUS
    # floating island: earth cone underneath + grass top
    new_obj('cone', 'Earth', loc=(0, 0, -3.2), rot=(math.pi, 0, 0), mat=toon('earth'), smooth='angle', parent=S,
            vertices=48, radius1=R - 0.2, radius2=R * 0.35, depth=6.0)
    _disk('Grass', R, -0.22, -0.02, toon('grass'), S, vertices=96)
    # plaza: concrete disk with a yellow ring and a spawn pad
    _disk('Plaza', L.PLAZA_RADIUS, -0.03, 0.01, toon('concrete'), S, vertices=64)
    new_obj('torus', 'PlazaRing', loc=(0, 0, 0.012), mat=toon('yellow'), smooth='all', parent=S,
            major_radius=L.PLAZA_RADIUS - 0.25, minor_radius=0.07, major_segments=64, minor_segments=4)
    sx, sy = L.SPAWN
    _pad('SpawnPad', sx, sy, 1.4, toon('white'), S, z=0.0, h=0.03, vertices=32)
    new_obj('torus', 'SpawnRing', loc=(sx, sy, 0.035), mat=toon('yellow'), smooth='all', parent=S,
            major_radius=1.25, minor_radius=0.06, major_segments=32, minor_segments=4)
    # Foreman's little stand (podium) behind the Foreman
    fx, fy = L.FOREMAN
    new_obj('cube', 'ForemanBoard', loc=(fx + 1.3, fy + 0.4, 0.9), scale=D(1.2, 0.08, 0.8), mat=toon('wood'), bevel=0.03, parent=S)
    new_obj('cube', 'ForemanBoardPaper', loc=(fx + 1.3, fy + 0.35, 0.95), scale=D(0.9, 0.02, 0.55), mat=toon('cream'), parent=S)
    for dx in (0.75, 1.85):
        beam((fx + dx, fy + 0.42, 0.0), (fx + dx, fy + 0.42, 1.35), 0.04, toon('steel'), 'BoardPost', parent=S, vertices=6)
    new_obj('sphere', 'ForemanLamp', loc=(fx + 1.3, fy + 0.42, 1.45), scale=(0.09,) * 3, mat=glow('bulb_warm', (1.0, 0.85, 0.45), 3.0),
            smooth='all', parent=S, segments=10, ring_count=6)

    # plots: dirt pad + low curb ring (the tower stages are separate assets placed by the client)
    for p in L.plot_defs():
        cx, cy = p['center']
        _pad(f'PlotPad_{p["index"]}', cx, cy, L.BUILD_ZONE_RADIUS + 0.9, toon('dirt'), S, h=0.03)
        new_obj('torus', f'PlotCurb_{p["index"]}', loc=(cx, cy, 0.03), mat=toon('concrete'), smooth='all', parent=S,
                major_radius=L.BUILD_ZONE_RADIUS + 0.85, minor_radius=0.08, major_segments=40, minor_segments=4)
        _path(S, (cx * (L.PLAZA_RADIUS / L.PLOT_RING), cy * (L.PLAZA_RADIUS / L.PLOT_RING)),
              (cx * ((L.PLOT_RING - L.BUILD_ZONE_RADIUS - 0.9) / L.PLOT_RING), cy * ((L.PLOT_RING - L.BUILD_ZONE_RADIUS - 0.9) / L.PLOT_RING)), 1.2)

    # supply yards: dirt pad, racks facing outward, cone pile in the middle
    for k, ad in enumerate(L.YARD_ANGLES_DEG):
        a = math.radians(ad)
        yx, yy = L.YARD_RING * math.cos(a), L.YARD_RING * math.sin(a)
        _pad(f'YardPad_{k}', yx, yy, L.YARD_RACK_RADIUS + 1.6, toon('dirt'), S, h=0.025)
    for i, r in enumerate(L.rack_defs()):
        x, y = r['pos']
        if r['type'] == 'cone':
            new_obj('cyl', 'ConeMat', loc=(x, y, 0.03), scale=(0.7, 0.7, 0.02), mat=toon('dark'), smooth='angle', parent=S, vertices=20)
            continue
        RB = empty(f'RackBase_{i}', loc=(x, y, 0), parent=S)
        RB.rotation_euler = (0, 0, r['rot'])
        _rack_lite(RB, RACK_COLORS[r['type']])

    # edge fence (red/white rails on posts) just outside the play radius
    fr = L.PLAY_RADIUS + 0.25
    n = 72
    for k in range(n):
        a0, a1 = math.tau * k / n, math.tau * (k + 1) / n
        p0 = Vector((fr * math.cos(a0), fr * math.sin(a0), 0))
        p1 = Vector((fr * math.cos(a1), fr * math.sin(a1), 0))
        if k % 2 == 0:
            beam(p0 - Vector((0, 0, 0.02)), p0 + Vector((0, 0, 0.7)), 0.05, toon('steel'), 'RailPost', parent=S, vertices=6)
        beam(p0 + Vector((0, 0, 0.6)), p1 + Vector((0, 0, 0.6)), 0.05, toon('red' if k % 2 == 0 else 'white'), 'Rail', parent=S, square=True)

    # trees, machines, rocks and grass tufts
    for (x, y, s) in L.TREES:
        _tree(S, (x, y, -0.02), s)
    for name, rr, ad, rotd in L.MACHINES:
        x, y = rr * math.cos(math.radians(ad)), rr * math.sin(math.radians(ad))
        if name == 'excavator':
            _excavator(S, (x, y, 0), rotd)
        else:
            _crane(S, (x, y, 0))
    new_obj('sphere', 'Mound', loc=(L.MOUND[0], L.MOUND[1], 0), scale=(L.MOUND[2], L.MOUND[3], L.MOUND[4]), mat=toon('mound'), smooth='all', parent=S, segments=16, ring_count=8)

    occupied = [p['center'] for p in L.plot_defs()]
    for i in range(40):
        a = random.uniform(0, math.tau)
        r = random.uniform(9.0, L.PLAY_RADIUS + 1.5)
        x, y = math.cos(a) * r, math.sin(a) * r
        if any(math.hypot(x - px, y - py) < L.BUILD_ZONE_RADIUS + 1.6 for px, py in occupied) or r < L.PLAZA_RADIUS + 1:
            continue
        s = random.uniform(0.12, 0.24)
        new_obj('ico', 'Rock', loc=(x, y, 0.0), scale=(s * 1.3, s, s * 0.8), rot=(0, 0, random.uniform(0, 3)), mat=toon('rock'), parent=S, subdivisions=1)
    for i in range(70):
        a = random.uniform(0, math.tau)
        r = random.uniform(L.PLAZA_RADIUS + 0.8, L.ISLAND_RADIUS - 0.5)
        x, y = math.cos(a) * r, math.sin(a) * r
        if any(math.hypot(x - px, y - py) < L.BUILD_ZONE_RADIUS + 1.2 for px, py in occupied):
            continue
        for k in range(3):
            new_obj('cone', 'Tuft', loc=(x + random.uniform(-0.1, 0.1), y + random.uniform(-0.1, 0.1), -0.03),
                    rot=(random.uniform(-0.3, 0.3), random.uniform(-0.3, 0.3), 0), mat=toon('grass2'), parent=S,
                    vertices=5, radius1=0.06, radius2=0.0, depth=random.uniform(0.2, 0.34))
    return S
