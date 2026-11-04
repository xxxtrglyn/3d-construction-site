"""Chibi worker (approved art-test design) as an animatable node hierarchy.

Worker (root, feet at origin, facing -Y)
├── Body    head, torso, vest, face (static parts)
├── Hat     dome + brim (material T_hat, tinted at runtime)
├── Arm_L   pivot at left shoulder  (worker's left = +X)
├── Arm_R   pivot at right shoulder (worker's right = -X)
├── Leg_L   pivot at left hip
├── Leg_R   pivot at right hip
├── Hand_R  empty at the right hand
└── Carry   empty in front of the chest where held pieces attach
"""
import math

from mathutils import Vector

from .common import D, beam, empty, half_sphere, new_obj, toon


def build():
    W = empty('Worker')
    body = empty('Body', parent=W)
    hat = empty('Hat', loc=(0, 0, 1.045), parent=W)
    sh_l, sh_r = Vector((0.2, 0, 0.555)), Vector((-0.2, 0, 0.555))
    hip_l, hip_r = Vector((0.1, 0, 0.27)), Vector((-0.1, 0, 0.27))
    arm_l = empty('Arm_L', loc=sh_l, parent=W)
    arm_r = empty('Arm_R', loc=sh_r, parent=W)
    leg_l = empty('Leg_L', loc=hip_l, parent=W)
    leg_r = empty('Leg_R', loc=hip_r, parent=W)

    # legs (local to hip pivot)
    for leg in (leg_l, leg_r):
        new_obj('cube', 'Boot', loc=(0, -0.025, -0.22), scale=D(0.16, 0.22, 0.1), mat=toon('boots'), bevel=0.04, parent=leg)
        new_obj('cyl', 'Leg', loc=(0, 0, -0.09), scale=(0.07, 0.07, 0.09), mat=toon('jeans'), smooth='angle', parent=leg, vertices=12)

    # torso + head + face
    new_obj('sphere', 'Shirt', loc=(0, 0, 0.44), scale=(0.22, 0.19, 0.23), mat=toon('shirt'), smooth='all', parent=body, segments=20, ring_count=12)
    new_obj('sphere', 'Vest', loc=(0, 0, 0.43), scale=(0.235, 0.205, 0.2), mat=toon('orange'), smooth='all', parent=body, segments=20, ring_count=12)
    new_obj('torus', 'Stripe', loc=(0, 0, 0.385), scale=(1, 0.87, 1), mat=toon('reflect'), smooth='all', parent=body,
            major_radius=0.226, minor_radius=0.02, major_segments=24, minor_segments=8)
    new_obj('sphere', 'Head', loc=(0, 0, 0.95), scale=(0.32, 0.32, 0.32), mat=toon('skin'), smooth='all', parent=body, segments=28, ring_count=14)
    for sx in (-1, 1):
        new_obj('sphere', 'Eye', loc=(0.1 * sx, -0.292, 0.93), scale=(0.044, 0.015, 0.059), mat=toon('black'), smooth='all', parent=body, segments=12, ring_count=8)
        new_obj('sphere', 'EyeHi', loc=(0.1 * sx + 0.014, -0.31, 0.95), scale=D(0.026, 0.01, 0.03), mat=toon('white'), smooth='all', parent=body, segments=8, ring_count=6)
        new_obj('sphere', 'Blush', loc=(0.17 * sx, -0.252, 0.865), scale=D(0.09, 0.03, 0.05), mat=toon('blush'), smooth='all', parent=body,
                rot=(0, 0, math.radians(-28 * sx)), segments=12, ring_count=8)
    new_obj('sphere', 'Mouth', loc=(0, -0.305, 0.855), scale=D(0.06, 0.02, 0.028), mat=toon('black'), smooth='all', parent=body, segments=10, ring_count=6)

    # hat (local to hat pivot at z=1.045)
    half_sphere('HatDome', (0, 0, 0), (0.35, 0.35, 0.31), toon('hat'), parent=hat, segments=28, rings=14)
    new_obj('cyl', 'HatBrim', loc=(0, -0.02, 0), scale=(0.344, 0.361, 0.02), mat=toon('hat'), smooth='angle', parent=hat, vertices=28)

    # arms hang slightly outward (local to shoulder pivot)
    for arm, sx in ((arm_l, 1), (arm_r, -1)):
        a, b = Vector((0, 0, 0)), Vector((0.1 * sx, -0.02, -0.19))
        beam(a, b, 0.06, toon('shirt'), 'Arm', parent=arm, vertices=12)
        hand = b + (b - a).normalized() * 0.04
        new_obj('sphere', 'Hand', loc=hand, scale=(0.065, 0.065, 0.065), mat=toon('skin'), smooth='all', parent=arm, segments=12, ring_count=8)
    empty('Hand_R', loc=sh_r + Vector((-0.14, -0.04, -0.235)), parent=W)
    empty('Carry', loc=(0, -0.42, 0.5), parent=W)
    return W
