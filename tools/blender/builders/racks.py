"""Supply racks (unlimited piece sources). The client stacks instanced pieces on top.

Each Rack_<type> has its origin on the ground at the rack center and an empty `Rack_<type>_Top`
where the first display piece sits.
"""
from .common import D, beam, empty, new_obj, toon

RACK_COLORS = {'beam': 'beam', 'brick': 'brick', 'panel': 'teal', 'paint': 'purple', 'decor': 'pink', 'bell': 'gold'}


def _rack(R, accent):
    # wooden pallet
    for y in (-0.4, 0, 0.4):
        new_obj('cube', 'Runner', loc=(0, y, 0.05), scale=D(1.5, 0.12, 0.1), mat=toon('wood'), bevel=0.01, parent=R)
    for i in range(7):
        new_obj('cube', 'Board', loc=(-0.66 + 0.22 * i, 0, 0.12), scale=D(0.18, 1.0, 0.04), mat=toon('wood'), bevel=0.006, parent=R)
    # side posts with an accent-colored top bar (color-codes the rack from far away)
    for x in (-0.78, 0.78):
        beam((x, 0.45, 0.0), (x, 0.45, 1.2), 0.04, toon('steel'), 'Post', parent=R)
    beam((-0.82, 0.45, 1.2), (0.82, 0.45, 1.2), 0.07, toon(accent), 'TopBar', parent=R, square=True)
    new_obj('cube', 'SignPlate', loc=(0, 0.42, 1.0), scale=D(0.5, 0.04, 0.28), mat=toon('white'), bevel=0.02, parent=R)
    new_obj('cube', 'SignDot', loc=(0, 0.39, 1.0), scale=D(0.2, 0.04, 0.16), mat=toon(accent), bevel=0.02, parent=R)


def build():
    root = empty('Racks')
    for i, (pid, accent) in enumerate(RACK_COLORS.items()):
        R = empty(f'Rack_{pid}', loc=(i * 2.4, 0, 0), parent=root)
        _rack(R, accent)
        empty(f'Rack_{pid}_Top', loc=(0, 0, 0.14), parent=R)
    # cone pile base (small round mat)
    C = empty('Rack_cone', loc=(len(RACK_COLORS) * 2.4, 0, 0), parent=root)
    new_obj('cyl', 'ConeMat', loc=(0, 0, 0.02), scale=(0.7, 0.7, 0.02), mat=toon('dark'), smooth='angle', parent=C, vertices=20)
    empty('Rack_cone_Top', loc=(0, 0, 0.04), parent=C)
    return root
