"""Shared helpers for Hard Hat Town asset builders.

Builders create *export-ready* scenes:
- toon materials are plain Principled BSDFs named ``T_<palette>`` whose base color is the lit color
  (the client swaps in its own toon shader by name),
- glow materials are emissive ``G_<name>``,
- no outline modifiers (the client draws inverted-hull outlines),
- bevel modifiers are allowed (applied at export time).

Everything works in ``blender --background`` (no UI context needed).
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from .palette import PALETTE, lin

_MATS = {}


def reset_scene():
    """Start from an empty scene, keeping nothing from previous builds."""
    _MATS.clear()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    return scene


def collection():
    return bpy.context.scene.collection


def _principled(name):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:  # Blender 5 always uses nodes
        pass
    return m, m.node_tree.nodes.get('Principled BSDF') or m.node_tree.nodes.new('ShaderNodeBsdfPrincipled')


def toon(name):
    """Toon material by palette name (client maps T_<name> to its toon shader)."""
    key = 'T_' + name
    if key in _MATS:
        return _MATS[key]
    m, bsdf = _principled(key)
    col = lin(PALETTE[name])
    bsdf.inputs['Base Color'].default_value = (*col, 1.0)
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Metallic'].default_value = 0.0
    m.diffuse_color = (*col, 1.0)
    _MATS[key] = m
    return m


def glow(name, srgb, strength=2.5):
    """Emissive glow material (G_<name>)."""
    key = 'G_' + name
    if key in _MATS:
        return _MATS[key]
    m, bsdf = _principled(key)
    col = lin(srgb)
    bsdf.inputs['Base Color'].default_value = (*col, 1.0)
    bsdf.inputs['Emission Color'].default_value = (*col, 1.0)
    bsdf.inputs['Emission Strength'].default_value = strength
    m.diffuse_color = (*col, 1.0)
    _MATS[key] = m
    return m


_OPS = {
    'cube': lambda **kw: bpy.ops.mesh.primitive_cube_add(**kw),
    'sphere': lambda **kw: bpy.ops.mesh.primitive_uv_sphere_add(**kw),
    'cyl': lambda **kw: bpy.ops.mesh.primitive_cylinder_add(**kw),
    'cone': lambda **kw: bpy.ops.mesh.primitive_cone_add(**kw),
    'ico': lambda **kw: bpy.ops.mesh.primitive_ico_sphere_add(**kw),
    'torus': lambda **kw: bpy.ops.mesh.primitive_torus_add(**kw),
}


def D(a, b, c):
    """Full dimensions -> half extents (primitive cube/cyl/sphere span [-1, 1])."""
    return (a / 2, b / 2, c / 2)


def _shade(o, smooth):
    me = o.data
    if smooth == 'all':
        for p in me.polygons:
            p.use_smooth = True
    elif smooth == 'angle':
        for p in me.polygons:
            p.use_smooth = True
        limit = math.radians(35)
        me.update()
        bm = bmesh.new()
        bm.from_mesh(me)
        sharp = []
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > limit:
                sharp.append(e.index)
            elif len(e.link_faces) != 2:
                sharp.append(e.index)
        bm.free()
        attr = me.attributes.get('sharp_edge') or me.attributes.new('sharp_edge', 'BOOLEAN', 'EDGE')
        for i in sharp:
            attr.data[i].value = True


def new_obj(prim, name, loc=(0, 0, 0), scale=(1, 1, 1), mat=None, rot=(0, 0, 0), bevel=0.0, seg=3,
            smooth=None, parent=None, **kw):
    _OPS[prim](**kw)
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    o.data.transform(Matrix.Diagonal((*scale, 1)))
    _shade(o, smooth)
    o.location = loc
    o.rotation_euler = rot
    if mat is not None:
        o.data.materials.append(mat)
    if bevel > 0:
        b = o.modifiers.new('Bevel', 'BEVEL')
        b.width = bevel
        b.segments = seg
        b.limit_method = 'ANGLE'
    if parent is not None:
        o.parent = parent
    return o


def empty(name, loc=(0, 0, 0), parent=None, size=0.2):
    e = bpy.data.objects.new(name, None)
    collection().objects.link(e)
    e.empty_display_size = size
    e.location = loc
    if parent is not None:
        e.parent = parent
    return e


def beam(p1, p2, r, mat, name, parent=None, square=False, vertices=10):
    p1, p2 = Vector(p1), Vector(p2)
    d = p2 - p1
    L = d.length
    if square:
        o = new_obj('cube', name, loc=(p1 + p2) / 2, scale=D(2 * r, 2 * r, L), mat=mat, parent=parent)
    else:
        o = new_obj('cyl', name, loc=(p1 + p2) / 2, scale=(r, r, L / 2), mat=mat, smooth='angle', parent=parent,
                    vertices=vertices)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    return o


def spike(p1, p2, r, mat, name, parent=None, vertices=8):
    p1, p2 = Vector(p1), Vector(p2)
    d = p2 - p1
    o = new_obj('cone', name, loc=(p1 + p2) / 2, mat=mat, smooth='angle', parent=parent, vertices=vertices,
                radius1=r, radius2=0.0, depth=d.length)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    return o


def mesh_obj(name, bm, mat, parent=None):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    collection().objects.link(o)
    me.materials.append(mat)
    if parent is not None:
        o.parent = parent
    return o


def half_sphere(name, loc, scale, mat, parent=None, segments=24, rings=12):
    o = new_obj('sphere', name, loc=loc, scale=scale, mat=mat, smooth='all', parent=parent, segments=segments,
                ring_count=rings)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, 0),
                           plane_no=(0, 0, 1), clear_inner=True)
    bm.to_mesh(o.data)
    bm.free()
    return o


def squircle_slab(name, a, b, z0, z1, mat, parent=None, n=5.0, res=64):
    bm = bmesh.new()
    bot, top = [], []
    for i in range(res):
        t = 2 * math.pi * i / res
        c, s = math.cos(t), math.sin(t)
        x = a * math.copysign(abs(c) ** (2 / n), c)
        y = b * math.copysign(abs(s) ** (2 / n), s)
        bot.append(bm.verts.new((x, y, z0)))
        top.append(bm.verts.new((x, y, z1)))
    for i in range(res):
        j = (i + 1) % res
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    bm.faces.new(top)
    bm.faces.new(list(reversed(bot)))
    return mesh_obj(name, bm, mat, parent)


def star_obj(name, loc, r, mat, parent=None, rot=(0, 0, 0), depth=0.03):
    """Chunky 5-point star in the XZ plane (faces -Y)."""
    bm = bmesh.new()
    ring_f, ring_b = [], []
    for i in range(10):
        a = math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * 0.45
        x, z = rr * math.cos(a), rr * math.sin(a)
        ring_f.append(bm.verts.new((x, -depth / 2, z)))
        ring_b.append(bm.verts.new((x, depth / 2, z)))
    cf = bm.verts.new((0, -depth, 0))
    cb = bm.verts.new((0, depth, 0))
    for i in range(10):
        j = (i + 1) % 10
        bm.faces.new((cf, ring_f[j], ring_f[i]))
        bm.faces.new((cb, ring_b[i], ring_b[j]))
        bm.faces.new((ring_f[i], ring_f[j], ring_b[j], ring_b[i]))
    o = mesh_obj(name, bm, mat, parent)
    o.location = loc
    o.rotation_euler = rot
    return o


def tri_flag(name, loc, size, mat, parent=None, rotz=0.0, thick=0.01):
    """Small pennant (triangle prism) hanging from its top-left corner, pointing +X."""
    bm = bmesh.new()
    a = bm.verts.new((0, 0, 0))
    b = bm.verts.new((size, 0, -size * 0.28))
    c = bm.verts.new((0, 0, -size * 0.56))
    a2 = bm.verts.new((0, thick, 0))
    b2 = bm.verts.new((size, thick, -size * 0.28))
    c2 = bm.verts.new((0, thick, -size * 0.56))
    bm.faces.new((a, b, c))
    bm.faces.new((c2, b2, a2))
    bm.faces.new((a, a2, b2, b))
    bm.faces.new((b, b2, c2, c))
    bm.faces.new((c, c2, a2, a))
    o = mesh_obj(name, bm, mat, parent)
    o.location = loc
    o.rotation_euler = (0, 0, rotz)
    return o
