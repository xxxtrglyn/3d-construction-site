"""Multiplayer site layout (feature 002) — pure Python, no bpy.

Single source of truth for the shared world: used by builders/site.py (Blender scene) and written to
packages/shared/src/site.gen.ts (client + server + bots). Run standalone to regenerate the TS file:

    python3 tools/blender/builders/site_layout.py

Coordinates here are Blender (x, y on the ground, z up). The TS output is three.js:
three (X, Y, Z) = blender (x, z, -y); a Blender rotation about Z by θ equals a three rotation about Y by θ.
"""
import math
import os

ISLAND_RADIUS = 36.5
PLAY_RADIUS = 34.0
PLAZA_RADIUS = 8.0
SPAWN = (0.0, -4.0)
FOREMAN = (0.0, 3.0)  # faces -Y (toward spawn) = default model orientation
FOREMAN_TALK_RADIUS = 2.0

PLOT_COUNT = 12
PLOT_RING = 24.0
PLOT_START_DEG = 15.0
BUILD_ZONE_RADIUS = 3.0
TOWER_HALF = 1.36  # half footprint of the tower walls (1.7 m x 1.6 scale / 2)
TOWER_TOP = 12.0
SIGN_LOCAL = (-2.4, -3.2)  # front-left of the plot (front = local -Y = toward the plaza)
BIN_LOCAL = (2.3, -3.0)
BIN_RADIUS = 0.9

YARD_RING = 13.3
YARD_ANGLES_DEG = (45.0, 135.0, 225.0, 315.0)
YARD_RACK_RADIUS = 4.0
# feature 003: racks stand on two arcs facing the yard centre, leaving drive-through openings on the
# tangential sides so a forklift can pass from one plot to any supply yard (degrees from the radial direction)
YARD_RACK_OFFSETS_DEG = (-64.5, -21.5, 21.5, 64.5, 137.0, 180.0, 223.0)  # ≥ 0.9 m between rack corners (no wedging), ~2.7 m openings
RACK_TYPES = ('beam', 'brick', 'panel', 'paint', 'decor', 'bell', 'cement')  # cement: feature 003
RACK_HALF = (0.85, 0.55)  # local x (width), local y (depth) in Blender = three x/z
RACK_TOP = 1.27

TREES = []  # filled below: (x, y, scale)
# feature 003: the static scenery crane and excavator are gone (FR-005); every plot has operable machines
MOUND = (-29.5, 12.0, 1.4, 1.1, 0.6)  # x, y, rx, ry, height (scenery; blocks movement; outside every yard)

# ---------------------------------------------------------------- feature 003: machine spots (plot-local, Blender)
# local frame: origin = plot centre, -Y toward the plaza (front), +Y outward (behind the tower)
YARD_RADIUS = 6.0
PIT_HALF = TOWER_HALF
SPOIL_LOCAL, SPOIL_RADIUS = (-4.5, 0.6), 1.2
HOOK_PAD_LOCAL, HOOK_PAD_HALF = (4.4, 0.6), 1.2
CRANE_LOCAL, CRANE_REACH, CRANE_CAB_HEIGHT = (0.0, 4.0), (2.5, 7.5), 14.0
CRANE_FOOT = 0.6  # half size of the crane footing (blocks walking: no, machines never collide with workers)
MIXER_LOCAL, MIXER_RADIUS = (-3.0, 3.8), 0.9
MIXER_CHUTE, MIXER_HOPPER, MIXER_HOPPER_RADIUS = 1.25, 1.05, 0.9  # along the mixer's front / back
EXCAVATOR_PARK = (3.0, 3.6)
EXCAVATOR_RADIUS = 1.1
FORKLIFT_PARK = (4.2, -1.9)
FORKLIFT_RADIUS = 0.9
# high slots: 3 roof slots (stage 3) at the eave, the bell (stage 6) on top (in-game metres, tower scale 1.6)
HIGH_SLOTS = {3: [(0.0, -0.95, 7.4), (-0.95, 0.0, 7.4), (0.95, 0.0, 7.4)], 6: [(0.0, 0.0, 9.3)]}
NO_DRIVE_PLAZA = PLAZA_RADIUS + 1.0
NO_DRIVE_OUTER = PLAY_RADIUS - 1.5


def _deg(a):
    return math.radians(a)


def plot_defs():
    plots = []
    for i in range(PLOT_COUNT):
        a = _deg(PLOT_START_DEG + 30.0 * i)
        cx, cy = PLOT_RING * math.cos(a), PLOT_RING * math.sin(a)
        rot = a - math.pi / 2  # local -Y faces the plaza center
        c, s = math.cos(rot), math.sin(rot)

        def world(lx, ly, cx=cx, cy=cy, c=c, s=s):
            return (cx + lx * c - ly * s, cy + lx * s + ly * c)

        plots.append(dict(index=i, center=(cx, cy), rot=rot, sign=world(*SIGN_LOCAL), bin=world(*BIN_LOCAL)))
    return plots


def rack_defs():
    racks = []
    for yard, ad in enumerate(YARD_ANGLES_DEG):
        a = _deg(ad)
        yx, yy = YARD_RING * math.cos(a), YARD_RING * math.sin(a)
        for k, t in enumerate(RACK_TYPES):
            b = a + _deg(YARD_RACK_OFFSETS_DEG[k])
            rx, ry = yx + YARD_RACK_RADIUS * math.cos(b), yy + YARD_RACK_RADIUS * math.sin(b)
            racks.append(dict(type=t, yard=yard, pos=(rx, ry), rot=b + math.pi / 2))  # front (+Y local) faces the yard centre
        racks.append(dict(type='cone', yard=yard, pos=(yx, yy), rot=0.0))
    return racks


def _tree_ring():
    trees = []
    plots = [p['center'] for p in plot_defs()]
    k = 0
    for i in range(40):
        a = math.tau * (i + 0.5) / 40
        r = 31.6 if i % 2 else 35.4  # inner ring leaves a 1 m+ lane to the fence; outer ring is past the fence
        x, y = r * math.cos(a), r * math.sin(a)
        if any(math.hypot(x - px, y - py) < 6.5 for px, py in plots):
            continue
        trees.append((x, y, 0.85 + 0.35 * ((k * 37) % 10) / 10))
        k += 1
    return trees


TREES = _tree_ring()


def obstacles():
    """Static colliders in Blender coords: boxes (x, y, hx, hy, rot, top) and cylinders (x, y, r, top)."""
    boxes, cyls = [], []
    for r in rack_defs():
        if r['type'] == 'cone':
            continue
        boxes.append((r['pos'][0], r['pos'][1], RACK_HALF[0], RACK_HALF[1], r['rot'], RACK_TOP))
    for (x, y, s) in TREES:
        cyls.append((x, y, 0.32 * s, 2.4 * s))
    cyls.append((MOUND[0], MOUND[1], (MOUND[2] + MOUND[3]) / 2 * 0.85, MOUND[4]))
    cyls.append((FOREMAN[0], FOREMAN[1], 0.45, 1.7))
    cyls.append((FOREMAN[0] + 1.3, FOREMAN[1] + 0.42, 0.7, 1.5))  # notice board behind the Foreman
    for p in plot_defs():
        cyls.append((p['sign'][0], p['sign'][1], 0.14, 1.7))
        cyls.append((p['bin'][0], p['bin'][1], 0.5, 0.75))
    return boxes, cyls


def _local(p, lx, ly):
    cx, cy = p['center']
    c, s = math.cos(p['rot']), math.sin(p['rot'])
    return (cx + lx * c - ly * s, cy + lx * s + ly * c)


def _heading(frm, to):
    """three.js yaw (forward = (sin, cos) in three x/z) of the Blender direction frm -> to."""
    dx, dy = to[0] - frm[0], to[1] - frm[1]
    return math.atan2(dx, -dy)  # three x = blender x, three z = -blender y


def machine_spots():
    """Per-plot machine spots in Blender coords (data-model §2)."""
    out = []
    for p in plot_defs():
        cen = p['center']
        mixer = _local(p, *MIXER_LOCAL)
        mlen = math.hypot(cen[0] - mixer[0], cen[1] - mixer[1])
        mdir = ((cen[0] - mixer[0]) / mlen, (cen[1] - mixer[1]) / mlen)  # the chute points at the pit
        crane = _local(p, *CRANE_LOCAL)
        exc = _local(p, *EXCAVATOR_PARK)
        fork = _local(p, *FORKLIFT_PARK)
        out.append(dict(
            plot=p['index'], center=cen, rot=p['rot'],
            pit=cen, spoil=_local(p, *SPOIL_LOCAL), hook_pad=_local(p, *HOOK_PAD_LOCAL),
            crane=crane, crane_yaw=_heading(crane, cen),
            mixer=mixer, mixer_yaw=_heading(mixer, cen),
            chute=(mixer[0] + mdir[0] * MIXER_CHUTE, mixer[1] + mdir[1] * MIXER_CHUTE),
            hopper=(mixer[0] - mdir[0] * MIXER_HOPPER, mixer[1] - mdir[1] * MIXER_HOPPER),
            exc=exc, exc_yaw=_heading(exc, crane),  # parked side-on: drive to the pit first
            fork=fork, fork_yaw=_heading(fork, (0.0, 0.0)),  # faces the lane toward the plaza
            high={st: [(_local(p, lx, ly), z) for (lx, ly, z) in pts] for st, pts in HIGH_SLOTS.items()},
        ))
    return out


def check_layout():
    """Asserts the machine layout fits (research M7): yards apart, spots inside their own yard, cement racks reachable."""
    plots = plot_defs()
    spots = machine_spots()
    for a in plots:
        for b in plots:
            if a['index'] < b['index']:
                d = math.hypot(a['center'][0] - b['center'][0], a['center'][1] - b['center'][1])
                assert d >= 2 * YARD_RADIUS, f'yards of plots {a["index"]} and {b["index"]} overlap ({d:.2f} m)'
    for m in spots:
        cx, cy = m['center']

        def inside(pt, r, what):
            d = math.hypot(pt[0] - cx, pt[1] - cy)
            assert d + r <= YARD_RADIUS + 1e-6, f'plot {m["plot"]}: {what} leaves the yard ({d + r:.2f} m)'

        inside(m['spoil'], SPOIL_RADIUS, 'spoil heap')
        for sx in (-1, 1):
            for sy in (-1, 1):
                inside(_local(plots[m['plot']], HOOK_PAD_LOCAL[0] + sx * HOOK_PAD_HALF, HOOK_PAD_LOCAL[1] + sy * HOOK_PAD_HALF), 0, 'hook pad corner')
        inside(m['crane'], CRANE_FOOT, 'crane')
        inside(m['mixer'], MIXER_RADIUS, 'mixer')
        inside(m['exc'], EXCAVATOR_RADIUS, 'excavator parking')
        inside(m['fork'], FORKLIFT_RADIUS, 'forklift parking')
        # the hook pad is outside the build zone and inside the crane's reach
        pd = math.hypot(m['hook_pad'][0] - cx, m['hook_pad'][1] - cy)
        assert pd - HOOK_PAD_HALF >= BUILD_ZONE_RADIUS, f'plot {m["plot"]}: hook pad overlaps the build zone'
        for pt in (m['hook_pad'], m['center']):
            rd = math.hypot(pt[0] - m['crane'][0], pt[1] - m['crane'][1])
            assert CRANE_REACH[0] <= rd <= CRANE_REACH[1], f'plot {m["plot"]}: crane cannot reach {pt}'
    _check_cement_reachable(spots)


def _check_cement_reachable(spots, step=0.5):
    """Grid flood fill for the forklift circle: every cement rack front is reachable from every plot's parking."""
    boxes, cyls = obstacles()
    r = FORKLIFT_RADIUS

    def blocked(x, y, own):
        d = math.hypot(x, y)
        if d < NO_DRIVE_PLAZA + r or d > NO_DRIVE_OUTER - r:
            return True
        for m in spots:
            if m['plot'] != own and math.hypot(x - m['center'][0], y - m['center'][1]) < YARD_RADIUS + r:
                return True
        for (bx, by, hx, hy, rot, top) in boxes:
            c, s = math.cos(rot), math.sin(rot)
            dx, dy = x - bx, y - by
            lx, ly = c * dx + s * dy, -s * dx + c * dy
            ox, oy = max(abs(lx) - hx, 0), max(abs(ly) - hy, 0)
            if ox * ox + oy * oy < r * r:
                return True
        for (qx, qy, qr, top) in cyls:
            if top > 0.3 and math.hypot(x - qx, y - qy) < qr + r:
                return True
        return False

    racks = [rk for rk in rack_defs() if rk['type'] == 'cement']
    n = int(PLAY_RADIUS / step) + 2
    key = lambda x, y: (round(x / step), round(y / step))  # noqa: E731
    for m in spots:
        start = key(*m['fork'])
        seen, todo = {start}, [start]
        while todo:
            i, j = todo.pop()
            for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                k = (i + di, j + dj)
                if k in seen or abs(k[0]) > n or abs(k[1]) > n or blocked(k[0] * step, k[1] * step, m['plot']):
                    continue
                seen.add(k)
                todo.append(k)
        for rk in racks:
            # the forklift body centre must get within rack half depth + forklift radius + fork reach (≈ 2.3 m)
            ok = any(math.hypot(i * step - rk['pos'][0], j * step - rk['pos'][1]) <= RACK_HALF[1] + r + 1.0 for (i, j) in seen)
            assert ok, f'plot {m["plot"]}: cement rack at {rk["pos"]} unreachable by the forklift'


# ---------------------------------------------------------------- TS export (three.js coordinates)

def _n(v):
    r = round(v, 4)
    return '0' if r == 0 else repr(r)


def _xz(p):
    return _n(p[0]), _n(-p[1])


def to_ts():
    out = ['// GENERATED by tools/blender/builders/site_layout.py — do not edit by hand.',
           '// Regenerate with `python3 tools/blender/builders/site_layout.py` (also run by `pnpm assets`).',
           "import type { SiteLayout } from './site.ts';", '',
           'export const SITE: SiteLayout = {']
    out.append(f'  playRadius: {_n(PLAY_RADIUS)},')
    out.append(f'  plaza: {{ x: 0, z: 0, radius: {_n(PLAZA_RADIUS)} }},')
    sx, sz = _xz(SPAWN)
    out.append(f'  spawn: {{ x: {sx}, y: 0, z: {sz} }},')
    fx, fz = _xz(FOREMAN)
    out.append(f'  foreman: {{ x: {fx}, z: {fz}, yaw: 0, talkRadius: {_n(FOREMAN_TALK_RADIUS)} }},')
    out.append('  plots: [')
    for p in plot_defs():
        cx, cz = _xz(p['center'])
        gx, gz = _xz(p['sign'])
        bx, bz = _xz(p['bin'])
        c, s = math.cos(p['rot']), math.sin(p['rot'])
        out.append(f"    {{ index: {p['index']}, x: {cx}, z: {cz}, yaw: {_n(p['rot'])}, c: {_n(c)}, s: {_n(s)}, "
                   f"buildZoneRadius: {_n(BUILD_ZONE_RADIUS)}, towerHalf: {_n(TOWER_HALF)}, towerTop: {_n(TOWER_TOP)}, "
                   f"sign: {{ x: {gx}, z: {gz} }}, bin: {{ x: {bx}, z: {bz}, radius: {_n(BIN_RADIUS)} }} }},")
    out.append('  ],')
    out.append('  racks: [')
    for i, r in enumerate(rack_defs()):
        x, z = _xz(r['pos'])
        out.append(f"    {{ index: {i}, type: '{r['type']}', yard: {r['yard']}, x: {x}, z: {z}, yaw: {_n(r['rot'])}, "
                   f"top: {_n(0.14 if r['type'] != 'cone' else 0.04)} }},")
    out.append('  ],')
    boxes, cyls = obstacles()
    out.append('  obstacles: {')
    out.append('    boxes: [')
    for (x, y, hx, hy, rot, top) in boxes:
        X, Z = _xz((x, y))
        out.append(f'      {{ x: {X}, z: {Z}, hx: {_n(hx)}, hz: {_n(hy)}, c: {_n(math.cos(rot))}, s: {_n(math.sin(rot))}, top: {_n(top)} }},')
    out.append('    ],')
    out.append('    cylinders: [')
    for (x, y, r, top) in cyls:
        X, Z = _xz((x, y))
        out.append(f'      {{ x: {X}, z: {Z}, r: {_n(r)}, top: {_n(top)} }},')
    out.append('    ],')
    out.append('  },')
    out.append('  machines: [')
    for m in machine_spots():
        c, s_ = math.cos(m['rot']), math.sin(m['rot'])
        cx, cz = _xz(m['center'])
        sx, sz = _xz(m['spoil'])
        hx, hz = _xz(m['hook_pad'])
        kx, kz = _xz(m['crane'])
        mx, mz = _xz(m['mixer'])
        ux, uz = _xz(m['hopper'])
        tx, tz = _xz(m['chute'])
        ex, ez = _xz(m['exc'])
        fx, fz = _xz(m['fork'])
        hs = []
        for st in range(1, 7):
            pts = m['high'].get(st, [])
            hs.append('[' + ', '.join(f'{{ x: {_xz(pt)[0]}, y: {_n(z)}, z: {_xz(pt)[1]} }}' for pt, z in pts) + ']')
        out.append(f"    {{ plot: {m['plot']}, center: {{ x: {cx}, z: {cz} }}, yardRadius: {_n(YARD_RADIUS)}, "
                   f"pit: {{ x: {cx}, z: {cz}, half: {_n(PIT_HALF)}, c: {_n(c)}, s: {_n(s_)} }}, "
                   f"spoil: {{ x: {sx}, z: {sz}, radius: {_n(SPOIL_RADIUS)} }}, "
                   f"hookPad: {{ x: {hx}, z: {hz}, half: {_n(HOOK_PAD_HALF)}, c: {_n(c)}, s: {_n(s_)} }},")
        out.append(f"      crane: {{ x: {kx}, z: {kz}, yaw: {_n(m['crane_yaw'])}, reachMin: {_n(CRANE_REACH[0])}, reachMax: {_n(CRANE_REACH[1])}, cabHeight: {_n(CRANE_CAB_HEIGHT)} }}, "
                   f"mixer: {{ x: {mx}, z: {mz}, yaw: {_n(m['mixer_yaw'])}, hopper: {{ x: {ux}, z: {uz} }}, chute: {{ x: {tx}, z: {tz} }}, hopperRadius: {_n(MIXER_HOPPER_RADIUS)} }},")
        out.append(f"      parking: {{ excavator: {{ x: {ex}, z: {ez}, yaw: {_n(m['exc_yaw'])} }}, forklift: {{ x: {fx}, z: {fz}, yaw: {_n(m['fork_yaw'])} }} }}, "
                   f"highSlots: [{', '.join(hs)}] }},")
    out.append('  ],')
    out.append(f'  noDrive: {{ plazaRadius: {_n(NO_DRIVE_PLAZA)}, outerRadius: {_n(NO_DRIVE_OUTER)} }},')
    out.append('};')
    return '\n'.join(out) + '\n'


def write_ts(root=None):
    check_layout()
    root = root or os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
    path = os.path.join(root, 'packages', 'shared', 'src', 'site.gen.ts')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(to_ts())
    return path


if __name__ == '__main__':
    print('[site] wrote', write_ts())
