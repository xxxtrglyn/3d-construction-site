"""Multiplayer props (feature 002): the plot sign (Host name/flag/stars are drawn by the client on
top) and the supply bin where non-crew players donate pieces. One asset, two groups."""
import math

from .common import D, beam, empty, new_obj, toon


def build():
    root = empty('PropsMP')
    # plot sign: two posts, a wooden board with a cream face, and a little roof
    S = empty('PlotSign', parent=root)
    for x in (-0.55, 0.55):
        beam((x, 0, 0), (x, 0, 1.55), 0.05, toon('wood'), 'SignPost', parent=S, square=True)
    new_obj('cube', 'SignBoard', loc=(0, 0, 1.25), scale=D(1.35, 0.08, 0.62), mat=toon('wood'), bevel=0.03, parent=S)
    new_obj('cube', 'SignFace', loc=(0, -0.045, 1.25), scale=D(1.18, 0.02, 0.48), mat=toon('cream'), parent=S)
    new_obj('cube', 'SignRoof', loc=(0, 0, 1.62), rot=(0, 0, 0), scale=D(1.5, 0.22, 0.06), mat=toon('beam'), bevel=0.02, parent=S)
    new_obj('cube', 'FlagPole', loc=(0.62, 0, 1.95), scale=D(0.03, 0.03, 0.7), mat=toon('steel'), parent=S)
    empty('PlotSign_Face', loc=(0, -0.06, 1.25), parent=S)
    empty('PlotSign_Flag', loc=(0.62, 0, 2.2), parent=S)

    # supply bin: an open wooden crate on short legs with a yellow rim and a "donate" heart
    B = empty('SupplyBin', parent=root)
    for x in (-0.38, 0.38):
        for y in (-0.38, 0.38):
            new_obj('cube', 'BinLeg', loc=(x, y, 0.05), scale=D(0.08, 0.08, 0.1), mat=toon('dark'), parent=B)
    new_obj('cube', 'BinFloor', loc=(0, 0, 0.12), scale=D(0.86, 0.86, 0.04), mat=toon('wood'), parent=B)
    for i, (x, y, sx, sy) in enumerate(((0, -0.41, 0.86, 0.05), (0, 0.41, 0.86, 0.05), (-0.41, 0, 0.05, 0.86), (0.41, 0, 0.05, 0.86))):
        for k in range(3):
            new_obj('cube', 'BinSlat', loc=(x, y, 0.2 + k * 0.15), scale=D(sx, sy, 0.11), mat=toon('wood'), bevel=0.008, parent=B)
    new_obj('torus', 'BinRim', loc=(0, 0, 0.6), rot=(0, 0, math.pi / 4), mat=toon('yellow'), smooth='all', parent=B,
            major_radius=0.6, minor_radius=0.03, major_segments=4, minor_segments=4)
    new_obj('cube', 'BinHeart', loc=(0, -0.44, 0.38), rot=(0, math.radians(45), 0), scale=D(0.12, 0.02, 0.12), mat=toon('pink'), parent=B)
    empty('SupplyBin_Top', loc=(0, 0, 0.16), parent=B)
    return root
