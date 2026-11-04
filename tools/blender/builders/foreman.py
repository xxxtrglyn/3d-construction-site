"""The Foreman (feature 002): an original chibi site boss with a white hard hat, a high-vis vest
over a green shirt, a clipboard and a whistle. Same rigid-part hierarchy idea as the worker so the
client can animate idle/talk procedurally.

Foreman (root, feet at origin, facing -Y)
├── Body    torso, vest, whistle (static)
├── Head    head, face, white hard hat (bobs while talking)
├── Arm_L   pivot at left shoulder, holds the clipboard
├── Arm_R   pivot at right shoulder (waves / points)
├── Leg_L   pivot at left hip
└── Leg_R   pivot at right hip
"""
import math

from mathutils import Vector

from .common import D, beam, empty, half_sphere, new_obj, toon

S = 1.15  # a little taller than the workers so he reads as "the boss" from across the plaza


def build():
    F = empty('Foreman')
    body = empty('Body', parent=F)
    head = empty('Head', loc=(0, 0, 0.95 * S), parent=F)
    sh_l, sh_r = Vector((0.22 * S, 0, 0.56 * S)), Vector((-0.22 * S, 0, 0.56 * S))
    hip_l, hip_r = Vector((0.11 * S, 0, 0.27 * S)), Vector((-0.11 * S, 0, 0.27 * S))
    arm_l = empty('Arm_L', loc=sh_l, parent=F)
    arm_r = empty('Arm_R', loc=sh_r, parent=F)
    leg_l = empty('Leg_L', loc=hip_l, parent=F)
    leg_r = empty('Leg_R', loc=hip_r, parent=F)

    for leg in (leg_l, leg_r):
        new_obj('cube', 'Boot', loc=(0, -0.03 * S, -0.22 * S), scale=D(0.18 * S, 0.24 * S, 0.11 * S), mat=toon('boots'), bevel=0.04, parent=leg)
        new_obj('cyl', 'Leg', loc=(0, 0, -0.09 * S), scale=(0.08 * S, 0.08 * S, 0.09 * S), mat=toon('wood'), smooth='angle', parent=leg, vertices=12)

    # torso: green shirt, high-vis vest with two reflective stripes, whistle on a cord
    new_obj('sphere', 'Shirt', loc=(0, 0, 0.45 * S), scale=(0.25 * S, 0.21 * S, 0.24 * S), mat=toon('leaf'), smooth='all', parent=body, segments=20, ring_count=12)
    new_obj('sphere', 'Vest', loc=(0, 0, 0.44 * S), scale=(0.265 * S, 0.225 * S, 0.21 * S), mat=toon('yellow'), smooth='all', parent=body, segments=20, ring_count=12)
    for z in (0.40, 0.48):
        new_obj('torus', 'Stripe', loc=(0, 0, z * S), scale=(1, 0.86, 1), mat=toon('reflect'), smooth='all', parent=body,
                major_radius=0.255 * S if z < 0.45 else 0.24 * S, minor_radius=0.018 * S, major_segments=24, minor_segments=6)
    beam(Vector((-0.08 * S, -0.17 * S, 0.66 * S)), Vector((0, -0.215 * S, 0.5 * S)), 0.008, toon('red'), 'Cord', parent=body, vertices=6)
    beam(Vector((0.08 * S, -0.17 * S, 0.66 * S)), Vector((0, -0.215 * S, 0.5 * S)), 0.008, toon('red'), 'Cord', parent=body, vertices=6)
    new_obj('cyl', 'Whistle', loc=(0, -0.235 * S, 0.49 * S), rot=(math.pi / 2, 0, 0), scale=(0.035 * S, 0.035 * S, 0.03 * S), mat=toon('steel'), smooth='angle', parent=body, vertices=12)

    # head with a friendly smile and big eyebrows, white boss hat with a badge
    new_obj('sphere', 'Head', loc=(0, 0, 0), scale=(0.33 * S,) * 3, mat=toon('skin'), smooth='all', parent=head, segments=28, ring_count=14)
    for sx in (-1, 1):
        new_obj('sphere', 'Eye', loc=(0.105 * sx * S, -0.3 * S, -0.02 * S), scale=(0.042 * S, 0.015 * S, 0.055 * S), mat=toon('black'), smooth='all', parent=head, segments=12, ring_count=8)
        new_obj('sphere', 'EyeHi', loc=((0.105 * sx + 0.014) * S, -0.318 * S, 0.0), scale=D(0.024 * S, 0.01, 0.028 * S), mat=toon('white'), smooth='all', parent=head, segments=8, ring_count=6)
        new_obj('cube', 'Brow', loc=(0.11 * sx * S, -0.3 * S, 0.075 * S), rot=(0, math.radians(12 * sx), 0), scale=D(0.1 * S, 0.02, 0.025 * S), mat=toon('trunk'), bevel=0.008, parent=head)
        new_obj('sphere', 'Blush', loc=(0.18 * sx * S, -0.26 * S, -0.09 * S), scale=D(0.09 * S, 0.03, 0.05 * S), mat=toon('blush'), smooth='all', parent=head,
                rot=(0, 0, math.radians(-28 * sx)), segments=12, ring_count=8)
    new_obj('torus', 'Smile', loc=(0, -0.3 * S, -0.1 * S), rot=(math.radians(90), 0, 0), scale=(1, 1, 0.6), mat=toon('black'), smooth='all', parent=head,
            major_radius=0.05 * S, minor_radius=0.012 * S, major_segments=16, minor_segments=6)
    half_sphere('HatDome', (0, 0, 0.095 * S), (0.36 * S, 0.36 * S, 0.32 * S), toon('white'), parent=head, segments=28, rings=14)
    new_obj('cyl', 'HatBrim', loc=(0, -0.02 * S, 0.095 * S), scale=(0.354 * S, 0.372 * S, 0.02 * S), mat=toon('white'), smooth='angle', parent=head, vertices=28)
    new_obj('cube', 'HatRidge', loc=(0, 0, 0.36 * S), scale=D(0.06 * S, 0.5 * S, 0.06 * S), mat=toon('white'), bevel=0.02, parent=head)
    new_obj('cyl', 'Badge', loc=(0, -0.33 * S, 0.24 * S), rot=(math.radians(70), 0, 0), scale=(0.06 * S, 0.06 * S, 0.01), mat=toon('gold'), smooth='angle', parent=head, vertices=16)

    # arms: left holds a clipboard against the chest, right hangs ready to wave
    for arm, sx in ((arm_l, 1), (arm_r, -1)):
        a, b = Vector((0, 0, 0)), Vector((0.1 * sx * S, -0.03 * S, -0.2 * S))
        beam(a, b, 0.065 * S, toon('leaf'), 'Arm', parent=arm, vertices=12)
        hand = b + (b - a).normalized() * 0.045 * S
        new_obj('sphere', 'Hand', loc=hand, scale=(0.07 * S,) * 3, mat=toon('skin'), smooth='all', parent=arm, segments=12, ring_count=8)
    board = Vector((0.05 * S, -0.16 * S, -0.22 * S))
    new_obj('cube', 'Clipboard', loc=board, rot=(math.radians(-20), 0, math.radians(-15)), scale=D(0.2 * S, 0.02 * S, 0.27 * S), mat=toon('wood'), bevel=0.01, parent=arm_l)
    new_obj('cube', 'Paper', loc=board + Vector((0, -0.014 * S, -0.01 * S)), rot=(math.radians(-20), 0, math.radians(-15)), scale=D(0.17 * S, 0.006, 0.22 * S), mat=toon('cream'), parent=arm_l)
    new_obj('cube', 'Clip', loc=board + Vector((0, -0.02 * S, 0.12 * S)), rot=(math.radians(-20), 0, math.radians(-15)), scale=D(0.08 * S, 0.02 * S, 0.03 * S), mat=toon('steel'), bevel=0.005, parent=arm_l)
    return F
