"""Clock Tower stage builder (ported from the approved stage mockup, all four faces detailed).

build(stage) creates the tower as it looks when `stage` is COMPLETE (0 = empty foundation,
6 = Masterpiece) under a root empty `ClockTower_Stage<N>`. Blender units: meters, Z up, front = -Y.
The exporter applies TOWER_SCALE so the in-game tower is big next to the chibi worker.
Gameplay effects (fireworks, confetti, sparkles, star icons, ghost previews) are drawn by the client.
"""
import math

import bmesh
from mathutils import Vector

from .common import D, beam, empty, glow, half_sphere, mesh_obj, new_obj, spike, squircle_slab, star_obj, toon, tri_flag

TOWER_SCALE = 1.6

L1 = (1.7, 0.10, 1.50)  # footprint, z0, z1
L2 = (1.4, 1.60, 3.10)
L3 = (1.6, 3.20, 4.30)

# out vector, side vector (side runs left->right when looking at the face from outside)
FACES = {
    'S': (Vector((0, -1, 0)), Vector((1, 0, 0))),
    'E': (Vector((1, 0, 0)), Vector((0, 1, 0))),
    'N': (Vector((0, 1, 0)), Vector((-1, 0, 0))),
    'W': (Vector((-1, 0, 0)), Vector((0, -1, 0))),
}
FACE_ROTZ = {'S': 0.0, 'E': math.pi / 2, 'N': math.pi, 'W': -math.pi / 2}
DISC_ROT = {'S': (math.pi / 2, 0, 0), 'N': (math.pi / 2, 0, 0), 'E': (0, math.pi / 2, 0), 'W': (0, math.pi / 2, 0)}


def M(name):
    return toon(name)


def on_face(face, half, u, z, d_out):
    out, side = FACES[face]
    return out * (half + d_out) + side * u + Vector((0, 0, z))


def dims(face, su, sd, sz):
    return D(su, sd, sz) if face in ('S', 'N') else D(sd, su, sz)


def face_box(T, name, face, half, u, z, su, sz, depth, mat, inset=0.0, bevel=0.0):
    loc = on_face(face, half, u, z, depth / 2 - inset)
    return new_obj('cube', name, loc=loc, scale=dims(face, su, depth, sz), mat=mat, bevel=bevel, parent=T)


def window(T, face, half, u, z, w, h, stage, tall=False):
    if stage == 2:
        face_box(T, 'WinOpening', face, half, u, z, w, h, 0.03, M('opening'), inset=0.012)
        return
    frame = M('white') if stage >= 4 else M('wood')
    face_box(T, 'WinFrame', face, half, u, z, w + 0.1, h + 0.1, 0.04, frame, bevel=0.01)
    glass = glow('window', (1.0, 0.82, 0.42), 2.2) if stage >= 6 else M('glass')
    face_box(T, 'WinGlass', face, half, u, z, w, h, 0.03, glass, inset=-0.025)
    face_box(T, 'WinBar', face, half, u, z, w, 0.025, 0.02, frame, inset=-0.05)
    face_box(T, 'WinBar', face, half, u, z, 0.025, h, 0.02, frame, inset=-0.05)
    if stage >= 5 and not tall:
        awning(T, face, half, u, z + h / 2 + 0.12, w + 0.22)
    elif stage >= 4:
        face_box(T, 'WinHood', face, half, u, z + h / 2 + 0.09, w + 0.2, 0.08, 0.06,
                 M('gold') if stage >= 6 else M('teal'), bevel=0.015)
    if stage >= 5 and not tall:
        box = face_box(T, 'FlowerBox', face, half, u, z - h / 2 - 0.08, w + 0.12, 0.14, 0.12, M('wood'), bevel=0.015)
        out, side = FACES[face]
        base = box.location + Vector((0, 0, 0.08))
        for i, col in enumerate(['pink', 'yellow', 'red', 'pink', 'purple']):
            p = base + side * ((i - 2) * (w + 0.08) / 5)
            new_obj('ico', 'Flower', loc=p, scale=(0.05, 0.05, 0.05), mat=M(col), parent=T, subdivisions=1)
            new_obj('ico', 'Leaf', loc=p + Vector((0, 0, -0.03)) + side * 0.03, scale=(0.04, 0.04, 0.03),
                    mat=M('leaf'), parent=T, subdivisions=1)


def awning(T, face, half, u, ztop, width):
    n = 5
    sw = width / n
    dep = 0.28
    ang = math.radians(32)
    out, side = FACES[face]
    rot = {'S': (ang, 0, 0), 'N': (-ang, 0, 0), 'E': (0, ang, 0), 'W': (0, -ang, 0)}[face]
    for k in range(n):
        su = u - width / 2 + sw * (k + 0.5)
        c = Vector((0, 0, ztop)) + out * (half + math.cos(ang) * dep / 2) + side * su - Vector((0, 0, math.sin(ang) * dep / 2))
        col = M('red') if k % 2 == 0 else M('white')
        new_obj('cube', 'AwningSlat', loc=c, scale=dims(face, sw, dep, 0.025), rot=rot, mat=col, parent=T)
        tip = Vector((0, 0, ztop)) + out * (half + math.cos(ang) * dep) + side * su - Vector((0, 0, math.sin(ang) * dep + 0.035))
        sc = (sw * 0.5, 0.025, 0.045) if face in ('S', 'N') else (0.025, sw * 0.5, 0.045)
        new_obj('sphere', 'AwningScallop', loc=tip, scale=sc, mat=col, smooth='all', parent=T, segments=10, ring_count=6)


def banner(T, face, half, u, ztop, zbot, col, stage):
    out, side = FACES[face]
    w = 0.24
    base = out * (half + 0.03) + side * u
    bm = bmesh.new()
    pts2d = [(-w / 2, ztop), (w / 2, ztop), (w / 2, zbot), (0, zbot + 0.13), (-w / 2, zbot)]
    vf = [bm.verts.new(base + side * x + Vector((0, 0, z))) for x, z in pts2d]
    vb = [bm.verts.new(base + side * x + Vector((0, 0, z)) - out * 0.015) for x, z in pts2d]
    bm.faces.new(vf)
    bm.faces.new(list(reversed(vb)))
    for i in range(5):
        j = (i + 1) % 5
        bm.faces.new((vf[i], vb[i], vb[j], vf[j]))
    mesh_obj('Banner', bm, M(col), parent=T)
    a = base + out * 0.03 + side * (-w / 2 - 0.05) + Vector((0, 0, ztop + 0.02))
    b = base + out * 0.03 + side * (w / 2 + 0.05) + Vector((0, 0, ztop + 0.02))
    beam(a, b, 0.018, M('gold'), 'BannerRod', parent=T)
    star_mat = glow('star_gold', (1.0, 0.85, 0.25), 2.5) if stage >= 6 else M('gold')
    star_obj('BannerStar', base + out * 0.02 + Vector((0, 0, (ztop + zbot) / 2 + 0.08)), 0.075, star_mat, parent=T,
             rot=(0, 0, FACE_ROTZ[face]))


def clock_face(T, face, stage):
    half = L3[0] / 2
    zc = 3.75
    out, side = FACES[face]
    loc = out * (half + 0.025) + Vector((0, 0, zc))
    rot = DISC_ROT[face]
    rim = M('gold') if stage >= 4 else M('steel')
    face_mat = glow('clockface', (1.0, 0.97, 0.86), 1.25) if stage >= 6 else M('white')
    new_obj('cyl', 'ClockFace', loc=loc, rot=rot, scale=(0.42, 0.42, 0.025), mat=face_mat, smooth='angle', parent=T, vertices=32)
    up = Vector((0, 0, 1))
    if stage >= 6:
        c0 = loc + out * 0.01
        for k in range(16):
            a = k * math.pi / 8 + math.pi / 16
            dv = side * math.sin(a) + up * math.cos(a)
            ln = 0.6 if k % 2 == 0 else 0.53
            spike(c0 + dv * 0.45, c0 + dv * ln, 0.035, M('gold'), 'ClockRay', parent=T)
    new_obj('torus', 'ClockRim', loc=loc + out * 0.02, rot=rot, mat=rim, smooth='all', parent=T,
            major_radius=0.42, minor_radius=0.04, major_segments=32, minor_segments=8)
    c = loc + out * 0.04
    for k in range(12):
        a = k * math.pi / 6
        p = c + side * math.sin(a) * 0.33 + up * math.cos(a) * 0.33
        s = 0.035 if k % 3 == 0 else 0.02
        new_obj('sphere', 'ClockTick', loc=p, scale=(s, s, s), mat=M('dark'), smooth='all', parent=T, segments=8, ring_count=6)
    beam(c, c + up * 0.2 + side * 0.08, 0.022, M('dark'), 'ClockHour', parent=T, square=True)
    beam(c, c + side * 0.28 - up * 0.05, 0.016, M('dark'), 'ClockMinute', parent=T, square=True)
    new_obj('sphere', 'ClockPin', loc=c, scale=(0.04, 0.04, 0.04), mat=M('gold') if stage >= 4 else M('dark'),
            smooth='all', parent=T, segments=10, ring_count=6)


def scaffold(T, tall=True):
    xs = 1.08
    top = 3.3 if tall else 1.9
    for y in (-0.75, 0.0, 0.75):
        beam((xs, y, 0.1), (xs, y, top), 0.025, M('steel'), 'ScaffPole', parent=T)
        beam((xs + 0.38, y, 0.1), (xs + 0.38, y, top), 0.025, M('steel'), 'ScaffPole', parent=T)
    for z in ((1.5, 3.05) if tall else (1.5,)):
        new_obj('cube', 'ScaffPlank', loc=(xs + 0.19, 0, z), scale=D(0.42, 1.7, 0.05), mat=M('wood'), bevel=0.01, parent=T)
        beam((xs + 0.38, -0.75, z + 0.45), (xs + 0.38, 0.75, z + 0.45), 0.018, M('yellow'), 'ScaffRail', parent=T)


def ring_frame(T, w, z0, z1, r_col=0.065, r_beam=0.055, columns=((-1, -1), (-1, 1), (1, -1), (1, 1)), top=None):
    hh = w / 2
    for sx, sy in columns:
        beam((sx * hh, sy * hh, z0), (sx * hh, sy * hh, top if top else z1), r_col, M('beam'), 'Column', parent=T, square=True)
    for s in (-1, 1):
        beam((-hh - 0.06, s * hh, z1), (hh + 0.06, s * hh, z1), r_beam, M('beam'), 'RingBeam', parent=T, square=True)
        beam((s * hh, -hh - 0.06, z1), (s * hh, hh + 0.06, z1), r_beam, M('beam'), 'RingBeam', parent=T, square=True)


def picket_fence(T, hw=1.13, gap=0.45):
    wood = M('white')

    def run(p0, p1):
        p0, p1 = Vector(p0), Vector(p1)
        n = max(2, int((p1 - p0).length / 0.2))
        for k in range(n + 1):
            p = p0.lerp(p1, k / n)
            new_obj('cube', 'Picket', loc=p + Vector((0, 0, 0.2)), scale=D(0.045, 0.045, 0.3), mat=wood, bevel=0.008, parent=T)
            new_obj('cone', 'PicketTip', loc=p + Vector((0, 0, 0.385)), rot=(0, 0, math.radians(45)), mat=wood, parent=T,
                    vertices=4, radius1=0.032, radius2=0.0, depth=0.07)
        for z in (0.14, 0.28):
            beam(p0 + Vector((0, 0, z)), p1 + Vector((0, 0, z)), 0.016, wood, 'FenceRail', parent=T, square=True)

    run((-hw, -hw, 0), (-gap, -hw, 0))
    run((gap, -hw, 0), (hw, -hw, 0))
    run((hw, -hw, 0), (hw, hw, 0))
    run((-hw, -hw, 0), (-hw, hw, 0))
    run((-hw, hw, 0), (hw, hw, 0))


def garlands(T, with_bulbs):
    cols = ['red', 'yellow', 'teal', 'pink', 'purple']
    bulbs = [glow('bulb_warm', (1.0, 0.85, 0.45), 3.0), glow('bulb_pink', (1.0, 0.55, 0.75), 3.0),
             glow('bulb_cyan', (0.5, 0.9, 1.0), 3.0)]
    for (zc, hw, sag) in ((1.47, 0.97, 0.22), (4.27, 0.99, 0.16)):
        for face, (out, side) in FACES.items():
            a = out * hw - side * hw + Vector((0, 0, zc))
            b = out * hw + side * hw + Vector((0, 0, zc))
            pts = []
            for k in range(13):
                t = k / 12.0
                p = a.lerp(b, t) + out * 0.04
                p.z -= sag * 4 * t * (1 - t)
                pts.append(p)
            for k in range(12):
                beam(pts[k], pts[k + 1], 0.006, M('dark'), 'BuntingLine', parent=T, vertices=6)
            for k in range(1, 12):
                fb = bmesh.new()
                v1 = fb.verts.new((-0.075, 0, 0))
                v2 = fb.verts.new((0.075, 0, 0))
                v3 = fb.verts.new((0, 0, -0.17))
                fb.faces.new((v1, v2, v3))
                fo = mesh_obj('BuntingFlag', fb, M(cols[k % 5]), parent=T)
                fo.location = pts[k] + out * 0.01
                fo.rotation_euler = (0, 0, FACE_ROTZ[face])
            if with_bulbs:
                for k in range(1, 24, 2):
                    t = k / 24.0
                    p = a.lerp(b, t) + out * 0.05
                    p.z -= sag * 4 * t * (1 - t)
                    new_obj('sphere', 'FairyBulb', loc=p, scale=(0.028, 0.028, 0.028), mat=bulbs[(k // 2) % 3],
                            smooth='all', parent=T, segments=8, ring_count=6)


def masterpiece_extras(T):
    gold = M('gold')
    bulbs = [glow('bulb_warm', (1.0, 0.85, 0.45), 3.0), glow('bulb_pink', (1.0, 0.55, 0.75), 3.0),
             glow('bulb_cyan', (0.5, 0.9, 1.0), 3.0)]
    # bell cupola
    new_obj('cube', 'CupolaBase', loc=(0, 0, 5.03), scale=D(0.92, 0.92, 0.08), mat=gold, bevel=0.02, parent=T)
    for sx in (-1, 1):
        for sy in (-1, 1):
            beam((sx * 0.33, sy * 0.33, 5.07), (sx * 0.33, sy * 0.33, 5.55), 0.045, M('white'), 'CupolaPillar', parent=T)
    new_obj('cube', 'CupolaTop', loc=(0, 0, 5.58), scale=D(0.86, 0.86, 0.07), mat=gold, bevel=0.02, parent=T)
    new_obj('cone', 'Bell', loc=(0, 0, 5.3), mat=gold, smooth='angle', parent=T, vertices=16, radius1=0.17, radius2=0.08, depth=0.22)
    new_obj('sphere', 'BellTop', loc=(0, 0, 5.42), scale=(0.08, 0.08, 0.06), mat=gold, smooth='all', parent=T, segments=12, ring_count=8)
    half_sphere('Dome', (0, 0, 5.6), (0.4, 0.4, 0.42), M('teal'), parent=T)
    new_obj('torus', 'DomeBand', loc=(0, 0, 5.63), mat=gold, smooth='all', parent=T, major_radius=0.4, minor_radius=0.03,
            major_segments=28, minor_segments=8)
    for k in range(8):
        a = k * math.pi / 4
        p0 = Vector((math.cos(a) * 0.4, math.sin(a) * 0.4, 5.63))
        p1 = Vector((0, 0, 6.02))
        mid = Vector((math.cos(a) * 0.276, math.sin(a) * 0.276, 5.6 + 0.42 * 0.72))
        beam(p0, mid, 0.016, gold, 'DomeRib', parent=T, vertices=6)
        beam(mid, p1, 0.016, gold, 'DomeRib', parent=T, vertices=6)
    beam((0, 0, 6.0), (0, 0, 6.42), 0.025, gold, 'Finial', parent=T)
    new_obj('sphere', 'FinialBall', loc=(0, 0, 6.1), scale=(0.07, 0.07, 0.07), mat=gold, smooth='all', parent=T, segments=12, ring_count=8)
    star_obj('FinialStar', (0, 0, 6.56), 0.17, glow('star_gold', (1.0, 0.85, 0.25), 2.5), parent=T, rot=(0, 0, math.radians(25)))
    # roof hips with bulbs
    for sx in (-1, 1):
        for sy in (-1, 1):
            p0 = Vector((sx * 0.95, sy * 0.95, 4.4))
            p1 = Vector((sx * 0.42, sy * 0.42, 5.0))
            beam(p0, p1, 0.035, gold, 'RoofHip', parent=T)
            for k in range(1, 6):
                new_obj('sphere', 'RoofBulb', loc=p0.lerp(p1, k / 6) + Vector((0, 0, 0.045)), scale=(0.03, 0.03, 0.03),
                        mat=bulbs[k % 3], smooth='all', parent=T, segments=8, ring_count=6)
    # dentils
    for (z, hw, n) in ((4.27, 0.95, 13), (1.47, 0.93, 13)):
        for face in FACES:
            for k in range(n):
                u = -hw + 2 * hw * (k + 0.5) / n
                pos = {'S': (u, -hw, z), 'N': (u, hw, z), 'E': (hw, u, z), 'W': (-hw, u, z)}[face]
                new_obj('sphere', 'Dentil', loc=pos, scale=(0.05, 0.05, 0.05), mat=gold, smooth='all', parent=T, segments=10, ring_count=6)
    # pinnacles + pennants
    cols = ['red', 'teal', 'pink', 'purple']
    for (z, hw) in ((1.6, 0.9), (3.2, 0.82), (4.42, 0.93)):
        for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
            b = Vector((sx * hw, sy * hw, z))
            new_obj('cube', 'PinnacleBase', loc=b + Vector((0, 0, 0.05)), scale=D(0.13, 0.13, 0.1), mat=gold, bevel=0.015, parent=T)
            spike(b + Vector((0, 0, 0.1)), b + Vector((0, 0, 0.42)), 0.06, gold, 'Pinnacle', parent=T)
            new_obj('sphere', 'PinnacleBall', loc=b + Vector((0, 0, 0.44)), scale=(0.035, 0.035, 0.035), mat=bulbs[0],
                    smooth='all', parent=T, segments=8, ring_count=6)
            if z > 4:
                beam(b + Vector((0, 0, 0.42)), b + Vector((0, 0, 0.62)), 0.008, M('dark'), 'PennantPole', parent=T, vertices=6)
                tri_flag('Pennant', b + Vector((0, 0, 0.62)), 0.2, M(cols[i]), parent=T, rotz=math.atan2(sy, sx) - math.pi / 2)
    # carpet, balloon arch, balloons, topiaries
    new_obj('cube', 'Carpet', loc=(0, -1.3, 0.11), scale=D(0.5, 0.92, 0.02), mat=M('red'), parent=T)
    for sx in (-1, 1):
        new_obj('cube', 'CarpetEdge', loc=(sx * 0.26, -1.3, 0.115), scale=D(0.03, 0.92, 0.025), mat=gold, parent=T)
    bcols = ['pink', 'yellow', 'teal', 'red', 'purple', 'white']
    n = 17
    for k in range(n):
        a = math.pi * k / (n - 1)
        p = Vector((math.cos(a) * 0.58, -1.62, 0.1 + math.sin(a) * 1.3))
        for j, off in enumerate((Vector((0, 0.06, 0)), Vector((0, -0.06, 0.03)))):
            new_obj('sphere', 'ArchBalloon', loc=p + off, scale=(0.1, 0.1, 0.11), mat=M(bcols[(k + j * 3) % 6]), smooth='all',
                    parent=T, segments=12, ring_count=8)
    for (dx, dz, c) in ((0, 1.55, 'pink'), (0.16, 1.68, 'yellow'), (-0.12, 1.75, 'teal'), (0.05, 1.9, 'purple')):
        top = Vector((1.25 + dx, -1.05, dz))
        beam(Vector((1.25, -1.05, 0.95)), top - Vector((0, 0, 0.13)), 0.004, M('dark'), 'BalloonString', parent=T, vertices=4)
        new_obj('sphere', 'Balloon', loc=top, scale=(0.13, 0.13, 0.15), mat=M(c), smooth='all', parent=T, segments=12, ring_count=8)
    for sx in (-1, 1):
        base = Vector((sx * 0.36, -1.3, 0.1))
        new_obj('cyl', 'TopiaryPot', loc=base + Vector((0, 0, 0.09)), scale=(0.1, 0.1, 0.09), mat=gold, smooth='angle', parent=T, vertices=14)
        beam(base + Vector((0, 0, 0.18)), base + Vector((0, 0, 0.75)), 0.018, M('trunk'), 'TopiaryTrunk', parent=T, vertices=6)
        for z, r in ((0.36, 0.12), (0.62, 0.1), (0.82, 0.08)):
            new_obj('sphere', 'TopiaryBall', loc=base + Vector((0, 0, z)), scale=(r, r, r), mat=M('leaf'), smooth='all', parent=T,
                    segments=12, ring_count=8)


def build(stage):
    """Build the tower as it looks when `stage` (0..6) is complete. Returns the root empty."""
    T = empty(f'ClockTower_Stage{stage}')
    h1, h2, h3 = L1[0] / 2, L2[0] / 2, L3[0] / 2
    # plot (all stages)
    squircle_slab('Dirt', 1.5, 1.5, -0.06, 0.0, M('dirt'), parent=T)
    new_obj('cube', 'Foundation', loc=(0, 0, 0.05), scale=D(2.15, 2.15, 0.1), mat=M('stone') if stage >= 4 else M('concrete'),
            bevel=0.03, parent=T)
    sg = Vector((1.25, -1.05, 0))
    beam(sg, sg + Vector((0, 0, 0.8)), 0.03, M('wood'), 'SignPost', parent=T)
    new_obj('cube', 'SignBoard', loc=sg + Vector((0, -0.01, 0.85)), scale=D(0.72, 0.06, 0.26), mat=M('wood'), bevel=0.02, parent=T)
    empty('Sign_Stars', loc=sg + Vector((0, -0.06, 0.85)), parent=T)
    empty('BuildZone', loc=(0, 0, 0.1), parent=T)
    if stage == 0:
        return T

    # 1: frame
    if stage == 1:
        ring_frame(T, *L1)
        ring_frame(T, *L2)
        new_obj('cube', 'Slab1', loc=(0, 0, 1.55), scale=D(1.8, 1.8, 0.08), mat=M('concrete'), bevel=0.02, parent=T)
        for sx, sy, top in ((-1, -1, 3.8), (1, -1, 3.55), (1, 1, 3.7)):
            beam((sx * h3, sy * h3, 3.1), (sx * h3, sy * h3, top), 0.06, M('beam'), 'Column', parent=T, square=True)
        return T

    # 2+: walls
    wall = M('cream') if stage >= 4 else M('brickwall')
    new_obj('cube', 'Wall_L1', loc=(0, 0, (L1[1] + L1[2]) / 2), scale=D(L1[0], L1[0], L1[2] - L1[1]), mat=wall, bevel=0.03, parent=T)
    new_obj('cube', 'Wall_L2', loc=(0, 0, (L2[1] + L2[2]) / 2), scale=D(L2[0], L2[0], L2[2] - L2[1]), mat=wall, bevel=0.03, parent=T)
    corn = M('gold') if stage >= 6 else (M('white') if stage >= 4 else M('concrete'))
    new_obj('cube', 'Cornice1', loc=(0, 0, 1.55), scale=D(1.86, 1.86, 0.1), mat=corn, bevel=0.025, parent=T)
    new_obj('cube', 'Cornice2', loc=(0, 0, 3.15), scale=D(1.7, 1.7, 0.1), mat=corn, bevel=0.025, parent=T)
    if stage == 2:
        ring_frame(T, L3[0], 3.2, 4.3, r_col=0.06, r_beam=0.05)
        face_box(T, 'DoorOpening', 'S', h1, 0, 0.62, 0.5, 0.95, 0.03, M('opening'), inset=0.012)
    if stage >= 3:
        new_obj('cube', 'Wall_L3', loc=(0, 0, (L3[1] + L3[2]) / 2), scale=D(L3[0], L3[0], L3[2] - L3[1]), mat=wall, bevel=0.03, parent=T)
        eave = M('gold') if stage >= 6 else (M('white') if stage >= 4 else M('concrete'))
        new_obj('cube', 'Eave', loc=(0, 0, 4.34), scale=D(1.9, 1.9, 0.08), mat=eave, bevel=0.02, parent=T)
        R = 0.925 * math.sqrt(2)
        if stage >= 6:
            new_obj('cone', 'Roof', loc=(0, 0, 4.38 + 0.31), rot=(0, 0, math.radians(45)), mat=M('teal'), parent=T,
                    vertices=4, radius1=R, radius2=0.40 * math.sqrt(2), depth=0.62)
        else:
            new_obj('cone', 'Roof', loc=(0, 0, 4.38 + 0.55), rot=(0, 0, math.radians(45)),
                    mat=M('teal') if stage >= 4 else M('roofgray'), parent=T, vertices=4, radius1=R, radius2=0.0, depth=1.1)
            spire = M('gold') if stage >= 4 else M('steel')
            beam((0, 0, 5.4), (0, 0, 5.95), 0.025, spire, 'Spire', parent=T)
            new_obj('sphere', 'SpireBall', loc=(0, 0, 5.5), scale=(0.07, 0.07, 0.07), mat=spire, smooth='all', parent=T,
                    segments=12, ring_count=8)
            if stage == 5:
                tri_flag('Flag', (0.02, 0, 5.95), 0.66, M('red'), parent=T)
        for face in FACES:
            clock_face(T, face, stage)
        face_box(T, 'Door', 'S', h1, 0, 0.6, 0.48, 0.9, 0.05, M('red') if stage >= 4 else M('wood'), bevel=0.015)
        knob = on_face('S', h1, 0.14, 0.58, 0.07)
        new_obj('sphere', 'DoorKnob', loc=knob, scale=(0.03, 0.03, 0.03), mat=M('gold'), smooth='all', parent=T, segments=8, ring_count=6)
    # windows on every face
    for face in FACES:
        if face == 'S':
            for u in (-0.55, 0.55):
                window(T, face, h1, u, 0.95, 0.3, 0.42, stage)
        else:
            window(T, face, h1, 0, 0.95, 0.36, 0.42, stage)
        window(T, face, h2, 0, 2.35, 0.32, 0.62, stage, tall=True)
    if stage in (2, 3):
        scaffold(T, tall=True)
    # 4+: paint details
    if stage >= 4:
        new_obj('cube', 'BaseCourse', loc=(0, 0, 0.24), scale=D(1.78, 1.78, 0.28), mat=M('stone'), bevel=0.02, parent=T)
        pil = M('gold') if stage >= 6 else M('teal')
        for (w, z0, z1) in (L1, L2, L3):
            hh = w / 2
            lower = 0.14 if w == L1[0] else 0.0
            for sx in (-1, 1):
                for sy in (-1, 1):
                    new_obj('cube', 'Pilaster', loc=(sx * hh, sy * hh, (z0 + z1) / 2 + lower / 2), scale=D(0.15, 0.15, (z1 - z0) - lower),
                            mat=pil, bevel=0.015, parent=T)
    # 5+: decoration
    if stage >= 5:
        for sx in (-1, 1):
            p = on_face('S', h1, sx * 0.42, 0, 0.2) + Vector((0, -0.05, 0))
            beam(p + Vector((0, 0, 0.1)), p + Vector((0, 0, 0.95)), 0.022, M('dark'), 'LampPost', parent=T)
            lamp = glow('window', (1.0, 0.82, 0.42), 2.2) if stage >= 6 else M('yellow')
            new_obj('sphere', 'Lamp', loc=p + Vector((0, 0, 1.02)), scale=(0.08, 0.08, 0.09), mat=lamp, smooth='all', parent=T,
                    segments=12, ring_count=8)
            new_obj('cube', 'Hedge', loc=(sx * 0.74, -0.98, 0.2), scale=D(0.5, 0.2, 0.2), mat=M('leaf'), bevel=0.06, parent=T)
            for k in range(6):
                fc = ['pink', 'yellow', 'red', 'purple', 'white', 'pink'][k]
                new_obj('ico', 'HedgeFlower', loc=(sx * 0.74 - 0.2 + 0.08 * k, -0.98 + (0.06 if k % 2 else -0.05), 0.31),
                        scale=(0.045, 0.045, 0.045), mat=M(fc), parent=T, subdivisions=1)
        picket_fence(T)
        for face in FACES:
            banner(T, face, h2, -0.45, 2.98, 2.08, 'red' if face in ('S', 'N') else 'purple', stage)
            banner(T, face, h2, 0.45, 2.98, 2.08, 'purple' if face in ('S', 'N') else 'red', stage)
        bal = on_face('S', h2, 0, 1.68, 0.21)
        new_obj('cube', 'Balcony', loc=bal, scale=D(0.8, 0.42, 0.07), mat=M('white'), bevel=0.015, parent=T)
        for k in range(5):
            x = -0.36 + 0.18 * k
            beam((x, bal.y - 0.18, 1.72), (x, bal.y - 0.18, 1.98), 0.014, M('teal'), 'Baluster', parent=T, vertices=6)
        beam((-0.4, bal.y - 0.18, 1.99), (0.4, bal.y - 0.18, 1.99), 0.02, M('teal'), 'Railing', parent=T)
        new_obj('ico', 'BalconyPlant', loc=(0.25, bal.y - 0.02, 1.84), scale=(0.11, 0.11, 0.11), mat=M('leaf'), parent=T, subdivisions=2)
        face_box(T, 'Plaque', 'S', h1, 0, 1.25, 0.55, 0.16, 0.04, M('gold') if stage >= 6 else M('teal'), bevel=0.015)
        garlands(T, with_bulbs=stage >= 6)
    if stage >= 6:
        masterpiece_extras(T)
    return T
