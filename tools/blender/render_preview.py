"""Quick review render of one builder (Workbench, material colors) for owner review.

    blender --background --factory-startup --python tools/blender/render_preview.py -- site assets/renders/site-overview.png
    blender --background --factory-startup --python tools/blender/render_preview.py -- machines assets/renders
      (feature 003: machine-crane/-excavator/-forklift/-mixer.png and machines-plot.png)
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from builders import foreman, machines, site  # noqa: E402
from builders.common import reset_scene  # noqa: E402

BUILDERS = {'site': (site.build, (0, -62, 58), (0, -3, 0), 38), 'foreman': (foreman.build, (1.6, -3.6, 1.5), (0, 0, 0.75), 50)}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    asset, out = argv[0], os.path.abspath(argv[1])
    if asset == 'machines':
        machines.render_review(out)
        return
    build, cam_loc, target, lens = BUILDERS[asset]
    reset_scene()
    build()
    scene = bpy.context.scene
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    scene.collection.objects.link(cam)
    cam.location = cam_loc
    d = Vector(target) - Vector(cam_loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens
    scene.camera = cam
    scene.render.engine = 'BLENDER_WORKBENCH'
    shading = scene.display.shading
    shading.light = 'STUDIO'
    shading.color_type = 'MATERIAL'
    shading.show_shadows = True
    shading.show_cavity = True
    shading.show_object_outline = True
    shading.object_outline_color = (0.16, 0.10, 0.10)
    scene.world = bpy.data.worlds.new('W') if scene.world is None else scene.world
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
    scene.render.film_transparent = False
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print('[render] wrote', out)


main()
