"""Effect meshes, instanced by the client (colors are tinted per instance at runtime)."""
import math

from .common import empty, glow, new_obj, star_obj, toon


def build():
    root = empty('Fx')
    P = empty('Fx_puff', loc=(0, 0, 0), parent=root)
    new_obj('ico', 'Puff', loc=(0, 0, 0), scale=(0.5, 0.5, 0.5), mat=toon('white'), parent=P, subdivisions=2)
    C = empty('Fx_confetti', loc=(1.5, 0, 0), parent=root)
    new_obj('cube', 'Confetti', loc=(0, 0, 0), scale=(0.03, 0.006, 0.018), mat=toon('white'), parent=C)
    S = empty('Fx_sparkle', loc=(3.0, 0, 0), parent=root)
    star_obj('Sparkle', (0, 0, 0), 0.5, glow('fx_white', (1.0, 1.0, 1.0), 3.0), parent=S, depth=0.08)
    R = empty('Fx_ray', loc=(4.5, 0, 0), parent=root)
    new_obj('cyl', 'Ray', loc=(0, 0, 0.5), scale=(0.02, 0.02, 0.5), mat=glow('fx_white', (1.0, 1.0, 1.0), 3.0), parent=R, vertices=6)
    new_obj('ico', 'RayTip', loc=(0, 0, 1.03), scale=(0.045, 0.045, 0.045), mat=glow('fx_white', (1.0, 1.0, 1.0), 3.0), parent=R, subdivisions=1)
    R.rotation_euler = (0, 0, 0)
    _ = math
    return root
