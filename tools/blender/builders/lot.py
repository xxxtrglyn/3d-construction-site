"""The floating construction lot (24 x 24 m) with yard, trees, rocks, spawn pad and edge rails.
Feature 003: the static scenery machines are gone; the operable machines park at empties M_* around
the single plot (read by packages/client/src/world/layout.ts → MachineSpots), plus a cement rack.

Origin = lot center, ground level z = 0 (top of the dirt yard). Front edge = -Y.
"""
import math
import random

from mathutils import Vector

from . import site_layout as SL
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
    'cement': (-7.0, 6.6, -90),  # feature 003
}
CONE_PILE = (-3.2, -6.0)
PLAY_HALF = 11.3  # mirrors packages/client/src/world/layout.ts

# feature 003: machine spots around the single plot, plot-local (front = -Y = toward the spawn)
SOLO_YARD_RADIUS = 6.5
SOLO_SPOTS = {
    'crane': (0.0, 4.0), 'spoil': (-3.5, 3.8), 'hook_pad': (3.6, 3.1), 'mixer': (-4.6, 6.3),
    'excavator': (4.2, -1.5), 'forklift': (3.4, -7.1),
}
MACHINE_EMPTIES = (['M_Pit', 'M_Spoil', 'M_HookPad', 'M_Crane', 'M_Mixer', 'M_Mixer_Hopper', 'M_Mixer_Chute', 'M_Park_excavator', 'M_Park_forklift']
                   + [f'M_HighSlot_{st}_{i}' for st, pts in SL.HIGH_SLOTS.items() for i in range(len(pts))])


def _solo_machine_empties(L):
    """Empties the client turns into MachineSpots (positions; rotation Z = three.js yaw of the pose)."""
    px, py = TOWER_PLOT
    S = SOLO_SPOTS
    at = lambda k: (px + S[k][0], py + S[k][1])  # noqa: E731

    def heading(frm, to):
        return math.atan2(to[0] - frm[0], -(to[1] - frm[1]))  # three.js yaw (forward = (sin, cos) in x/z)

    def put(name, xy, yaw=0.0, z=0.0):
        e = empty(name, loc=(xy[0], xy[1], z), parent=L)
        e.rotation_euler = (0, 0, yaw)
        return e

    put('M_Pit', (px, py))
    put('M_Spoil', at('spoil'))
    put('M_HookPad', at('hook_pad'))
    put('M_Crane', at('crane'), heading(at('crane'), (px, py)))
    m = at('mixer')
    mdx, mdy = px - m[0], py - m[1]
    ml = math.hypot(mdx, mdy)
    mdx, mdy = mdx / ml, mdy / ml
    put('M_Mixer', m, heading(m, (px, py)))
    put('M_Mixer_Hopper', (m[0] - mdx * SL.MIXER_HOPPER, m[1] - mdy * SL.MIXER_HOPPER))
    put('M_Mixer_Chute', (m[0] + mdx * SL.MIXER_CHUTE, m[1] + mdy * SL.MIXER_CHUTE))
    put('M_Park_excavator', at('excavator'), heading(at('excavator'), at('crane')))
    put('M_Park_forklift', at('forklift'), heading(at('forklift'), SPAWN))
    for st, pts in SL.HIGH_SLOTS.items():
        for i, (lx, ly, z) in enumerate(pts):
            put(f'M_HighSlot_{st}_{i}', (px + lx, py + ly), 0.0, z)
    _check_solo_spots()


def _check_solo_spots():
    """The machine spots fit on the lot without blocking the racks or the spawn path (FR-043)."""
    px, py = TOWER_PLOT
    radius = {'crane': 0.75, 'spoil': SL.SPOIL_RADIUS, 'hook_pad': SL.HOOK_PAD_HALF * math.sqrt(2), 'mixer': 1.4, 'excavator': 1.1, 'forklift': 0.9}
    for k, (lx, ly) in SOLO_SPOTS.items():
        x, y, r = px + lx, py + ly, radius[k]
        assert abs(x) + r <= PLAY_HALF and abs(y) + r <= PLAY_HALF, f'solo {k} leaves the lot'
        for rk, (rx, ry, _) in RACKS.items():
            # racks are 1.7 x 1.1; keep 1.0 m in front of them free for the worker
            assert math.hypot(x - rx, y - ry) >= r + 1.2, f'solo {k} blocks the {rk} rack'
        assert abs(x - SPAWN[0]) >= r + 0.6 or y - r > py - L_HALF_PATH or y + r < SPAWN[1], f'solo {k} blocks the spawn path'
        if k in ('spoil', 'hook_pad', 'excavator', 'crane'):
            assert math.hypot(lx, ly) + (r if k != 'hook_pad' else 0) <= SOLO_YARD_RADIUS + 1e-6, f'solo {k} leaves the yard'
    pad = SOLO_SPOTS['hook_pad']
    cr = SOLO_SPOTS['crane']
    assert SL.CRANE_REACH[0] <= math.hypot(pad[0] - cr[0], pad[1] - cr[1]) <= SL.CRANE_REACH[1], 'solo crane cannot reach its pad'
    assert math.hypot(*pad) - SL.HOOK_PAD_HALF >= SL.BUILD_ZONE_RADIUS, 'solo hook pad overlaps the build zone'


L_HALF_PATH = 1.0


def _tree(root, loc, s):
    T = empty('Tree', loc=loc, parent=root)
    beam((0, 0, 0), (0, 0, 0.9 * s), 0.1 * s, toon('trunk'), 'Trunk', parent=T)
    new_obj('ico', 'Leaf', loc=(0, 0, 1.3 * s), scale=(0.65 * s,) * 3, mat=toon('leaf'), parent=T, subdivisions=2)
    new_obj('ico', 'Leaf2', loc=(0.3 * s, 0.15 * s, 1.0 * s), scale=(0.42 * s,) * 3, mat=toon('leaf'), parent=T, subdivisions=2)


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
    new_obj('sphere', 'Mound', loc=(7.6, 6.4, 0), scale=(1.5, 1.2, 0.7), mat=toon('mound'), smooth='all', parent=L, segments=20, ring_count=10)
    # feature 003: the static crane and excavator made way for the operable machines,
    # the pit outline, the spoil heap, the hook pad and the parking marks
    from .machines import groundwork_marks
    S = SOLO_SPOTS
    groundwork_marks(L, TOWER_PLOT, 0.0, spoil=S['spoil'], pad=S['hook_pad'], parks=(S['excavator'], S['forklift']))
    _solo_machine_empties(L)
    # tiny lamp on the spawn pad sign
    beam((1.6, -7.5, 0), (1.6, -7.5, 1.4), 0.04, toon('dark'), 'SpawnSignPost', parent=L)
    new_obj('cube', 'SpawnSign', loc=(1.6, -7.53, 1.25), scale=D(0.9, 0.06, 0.4), mat=toon('yellow'), bevel=0.03, parent=L)
    new_obj('sphere', 'SpawnLamp', loc=(1.6, -7.5, 1.5), scale=(0.08, 0.08, 0.08), mat=glow('bulb_warm', (1.0, 0.85, 0.45), 3.0), smooth='all', parent=L, segments=10, ring_count=6)
    return L
