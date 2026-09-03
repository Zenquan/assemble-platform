"""
render_preview.py — 渲染已生成设备的等轴 PNG 预览(无头 Blender Eevee)。

用法:
  blender -b --python scripts/gltf-gen/render_preview.py -- <glb_path> <out_png> [--iso]
"""
from __future__ import annotations
import math, os, sys
import bpy


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    if len(argv) < 2:
        print("usage: -- <glb_path> <out_png> [--iso]")
        sys.exit(2)
    glb, out_png = argv[0], argv[1]
    use_iso = "--iso" in argv

    bpy.ops.wm.read_factory_settings(use_empty=False)
    # clean default cube/light/camera
    for nm in ("Cube", "Light", "Camera"):
        o = bpy.data.objects.get(nm)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)

    # world bg
    if not bpy.data.worlds:
        bpy.ops.world.new()
    w = bpy.data.worlds[0]
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.16,0.17,0.19,1.0)

    # import model
    bpy.ops.import_scene.gltf(filepath=glb)
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not objs:
        print("no mesh found"); sys.exit(1)
    # frame all
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    # compute bbox center
    def bbox_center(o):
        return (o.bound_box[0][0]+o.bound_box[6][0])/2, \
               (o.bound_box[0][1]+o.bound_box[6][1])/2, \
               (o.bound_box[0][2]+o.bound_box[6][2])/2
    cx, cy, cz = bbox_center(objs[0])
    for o in objs[1:]:
        bx,by,bz = bbox_center(o)
        cx+=bx; cy+=by; cz+=bz
    cx/=len(objs); cy/=len(objs); cz/=len(objs)

    # camera
    bpy.ops.object.camera_add()
    cam = bpy.context.object
    cam.name = "PrevCam"
    # radius based on bbox size
    mx = max((bb[0][0]-bb[6][0]) for bb in [o.bound_box for o in objs])
    my = max((bb[0][1]-bb[6][1]) for bb in [o.bound_box for o in objs])
    mz = max((bb[0][2]-bb[6][2]) for bb in [o.bound_box for o in objs])
    r = max(mx,my,mz,1.5)*1.4
    if use_iso:
        cam.location = (cx+r*0.8, cy-r*0.8, cz+r*1.1)
    else:
        cam.location = (cx+r*0.6, cy-r*1.4, cz+r*0.7)
    cam.data.lens = 45
    # track to center
    empty = bpy.data.objects.new("LookAt", None)
    bpy.context.scene.collection.objects.link(empty)
    empty.location = (cx, cy, cz+0.2)
    bpy.ops.object.select_all(action="DESELECT")
    cam.select_set(True); bpy.context.view_layer.objects.active = cam
    constraint = cam.constraints.new("TRACK_TO")
    constraint.target = empty
    constraint.track_axis = "TRACK_NEGATIVE_Z"
    constraint.up_axis = "UP_Y"

    # lights
    bpy.ops.object.light_add(type="AREA", location=(cx+r, cy-r, cz+r))
    l1=bpy.context.object; l1.data.energy=500; l1.data.size=6
    bpy.ops.object.light_add(type="AREA", location=(cx-r*0.6, cy-r*0.6, cz+r*0.9))
    l2=bpy.context.object; l2.data.energy=200; l2.data.size=6

    # renderer
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE_NEXT"
    sc.render.resolution_x = 900
    sc.render.resolution_y = 760
    sc.render.film_transparent = True
    sc.camera = cam
    sc.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    print(f"[prev] wrote {out_png} ({os.path.getsize(out_png)} bytes)")


if __name__ == "__main__":
    main()
