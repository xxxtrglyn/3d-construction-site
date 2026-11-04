"""Carryable building pieces. Each Piece_<type> node is centered on its collider center.

Collider sizes (meters, X/Y/Z in Blender) mirror packages/shared/src/pieces.ts.
"""
import math

from mathutils import Vector

from .common import D, beam, empty, glow, half_sphere, new_obj, star_obj, toon


def _beam(P):
    # red I-beam 1.4 long along X
    new_obj('cube', 'Flange', loc=(0, 0, 0.07), scale=D(1.4, 0.16, 0.025), mat=toon('beam'), bevel=0.008, parent=P)
    new_obj('cube', 'Flange', loc=(0, 0, -0.07), scale=D(1.4, 0.16, 0.025), mat=toon('beam'), bevel=0.008, parent=P)
    new_obj('cube', 'Web', loc=(0, 0, 0), scale=D(1.4, 0.035, 0.13), mat=toon('beam'), parent=P)
    for x in (-0.55, 0.55):
        new_obj('cyl', 'Bolt', loc=(x, -0.02, 0), rot=(math.pi / 2, 0, 0), scale=(0.022, 0.022, 0.012), mat=toon('steel'), smooth='angle', parent=P, vertices=8)


def _brick(P):
    # bundle of 6 bricks (0.5 x 0.36 x 0.26) with a strap
    for ix in (-1, 1):
        for iy in (-1, 0, 1):
            for iz in (-1, 1):
                if iz == 1 and iy == 1 and ix == 1:
                    continue
                new_obj('cube', 'Brick', loc=(ix * 0.125, iy * 0.12, iz * 0.065), scale=D(0.235, 0.11, 0.12), mat=toon('brick'), bevel=0.012, parent=P)
    new_obj('cube', 'Strap', loc=(0, 0, 0), scale=D(0.04, 0.38, 0.27), mat=toon('yellow'), parent=P)


def _panel(P):
    # framed window panel with a teal roof tile on top
    new_obj('cube', 'PanelFrame', loc=(0, 0, -0.04), scale=D(0.6, 0.08, 0.42), mat=toon('wood'), bevel=0.012, parent=P)
    new_obj('cube', 'PanelGlass', loc=(0, -0.01, -0.04), scale=D(0.48, 0.08, 0.32), mat=toon('glass'), parent=P)
    new_obj('cube', 'PanelBarH', loc=(0, -0.05, -0.04), scale=D(0.48, 0.02, 0.025), mat=toon('wood'), parent=P)
    new_obj('cube', 'PanelBarV', loc=(0, -0.05, -0.04), scale=D(0.025, 0.02, 0.32), mat=toon('wood'), parent=P)
    new_obj('cube', 'PanelTile', loc=(0, 0, 0.21), rot=(math.radians(-12), 0, 0), scale=D(0.62, 0.14, 0.06), mat=toon('roofgray'), bevel=0.01, parent=P)


def _paint(P):
    new_obj('cyl', 'Bucket', loc=(0, 0, -0.02), scale=(0.16, 0.16, 0.16), mat=toon('white'), smooth='angle', parent=P, vertices=18)
    new_obj('cyl', 'PaintTop', loc=(0, 0, 0.142), scale=(0.145, 0.145, 0.004), mat=toon('teal'), smooth='angle', parent=P, vertices=18)
    new_obj('cyl', 'Label', loc=(0, 0, -0.02), scale=(0.163, 0.163, 0.06), mat=toon('teal'), smooth='angle', parent=P, vertices=18)
    new_obj('torus', 'Handle', loc=(0, 0, 0.14), rot=(math.pi / 2, 0, 0), scale=(1, 1, 1), mat=toon('dark'), smooth='all', parent=P,
            major_radius=0.15, minor_radius=0.012, major_segments=20, minor_segments=6)
    new_obj('sphere', 'Drip', loc=(0.1, -0.12, 0.1), scale=(0.03, 0.02, 0.05), mat=toon('teal'), smooth='all', parent=P, segments=8, ring_count=6)


def _decor(P):
    new_obj('cube', 'Crate', loc=(0, 0, -0.04), scale=D(0.44, 0.44, 0.3), mat=toon('wood'), bevel=0.02, parent=P)
    for z in (-0.12, 0.04):
        new_obj('cube', 'Slat', loc=(0, -0.225, z), scale=D(0.42, 0.02, 0.05), mat=toon('trunk'), parent=P)
    for i, (x, y, c) in enumerate(((-0.1, -0.08, 'pink'), (0.08, -0.1, 'yellow'), (0.12, 0.08, 'purple'), (-0.08, 0.1, 'red'))):
        new_obj('ico', 'Flower', loc=(x, y, 0.15), scale=(0.06, 0.06, 0.06), mat=toon(c), parent=P, subdivisions=1)
    new_obj('ico', 'Leaves', loc=(0, 0, 0.12), scale=(0.17, 0.17, 0.07), mat=toon('leaf'), parent=P, subdivisions=1)
    beam((0.15, 0.15, 0.1), (0.15, 0.15, 0.42), 0.008, toon('dark'), 'FlagPole', parent=P, vertices=6)
    new_obj('cube', 'MiniBanner', loc=(0.09, 0.15, 0.35), scale=D(0.12, 0.01, 0.1), mat=toon('red'), parent=P)


def _bell(P):
    gold = toon('gold')
    new_obj('cone', 'BellBody', loc=(0, 0, -0.04), mat=gold, smooth='angle', parent=P, vertices=20, radius1=0.25, radius2=0.12, depth=0.34)
    half_sphere('BellCap', (0, 0, 0.13), (0.12, 0.12, 0.1), gold, parent=P, segments=16, rings=8)
    new_obj('torus', 'BellLip', loc=(0, 0, -0.205), mat=gold, smooth='all', parent=P, major_radius=0.245, minor_radius=0.025, major_segments=24, minor_segments=8)
    new_obj('torus', 'BellLoop', loc=(0, 0, 0.25), rot=(math.pi / 2, 0, 0), mat=gold, smooth='all', parent=P, major_radius=0.05, minor_radius=0.015, major_segments=12, minor_segments=6)
    new_obj('sphere', 'Clapper', loc=(0, 0, -0.23), scale=(0.05, 0.05, 0.05), mat=toon('dark'), smooth='all', parent=P, segments=10, ring_count=6)
    new_obj('cube', 'Ribbon', loc=(0, -0.2, 0.06), rot=(math.radians(18), 0, 0), scale=D(0.1, 0.02, 0.12), mat=toon('red'), parent=P)
    star_obj('BellStar', (0, -0.225, -0.05), 0.06, glow('star_gold', (1.0, 0.85, 0.25), 2.5), parent=P)


def _cone(P):
    new_obj('cube', 'ConeBase', loc=(0, 0, -0.21), scale=D(0.36, 0.36, 0.04), mat=toon('dark'), bevel=0.015, parent=P)
    new_obj('cone', 'ConeBody', loc=(0, 0, 0.03), mat=toon('orange'), smooth='angle', parent=P, vertices=18, radius1=0.15, radius2=0.025, depth=0.44)
    new_obj('cone', 'ConeStripe', loc=(0, 0, 0.05), mat=toon('white'), smooth='angle', parent=P, vertices=18, radius1=0.099, radius2=0.078, depth=0.07)


BUILDERS = {'beam': _beam, 'brick': _brick, 'panel': _panel, 'paint': _paint, 'decor': _decor, 'bell': _bell, 'cone': _cone}


def build():
    root = empty('Pieces')
    for i, (pid, fn) in enumerate(BUILDERS.items()):
        P = empty(f'Piece_{pid}', loc=(i * 1.8, 0, 0), parent=root)
        fn(P)
    return root
