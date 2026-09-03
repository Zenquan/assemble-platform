"""Generate layered fresh-cut produce equipment as glTF/GLB assets.

Blender authoring space is Z-up with metres as units. The glTF exporter converts
to Y-up for Babylon. Device roots stay at the installation footprint centre and
moving assemblies keep stable node names for runtime animation.

Usage:
  Blender -b --python scripts/gltf-gen/gen_freshcut.py -- \
    all --out services/model-svc/assets/glb \
    --preview-out scripts/gltf-gen/assets
"""

from __future__ import annotations

import argparse
import math
import os
import sys
from collections.abc import Callable, Iterable

import bpy
from mathutils import Vector


PALETTE = {
    "stainless": ((0.46, 0.50, 0.53, 1.0), 0.82, 0.28, None),
    "stainless_dark": ((0.20, 0.23, 0.25, 1.0), 0.78, 0.34, None),
    "white_panel": ((0.78, 0.82, 0.83, 1.0), 0.18, 0.32, None),
    "food_belt": ((0.02, 0.36, 0.43, 1.0), 0.02, 0.64, None),
    "food_belt_blue": ((0.02, 0.24, 0.52, 1.0), 0.02, 0.58, None),
    "rubber": ((0.025, 0.03, 0.035, 1.0), 0.0, 0.88, None),
    "motor_blue": ((0.03, 0.16, 0.30, 1.0), 0.55, 0.40, None),
    "safety_yellow": ((0.95, 0.62, 0.02, 1.0), 0.05, 0.42, None),
    "emergency_red": ((0.72, 0.015, 0.02, 1.0), 0.08, 0.38, None),
    "screen": ((0.01, 0.05, 0.07, 1.0), 0.0, 0.18, (0.02, 0.58, 0.72, 1.0)),
    "water": ((0.02, 0.28, 0.42, 1.0), 0.0, 0.18, (0.0, 0.08, 0.12, 1.0)),
    "produce_green": ((0.08, 0.42, 0.12, 1.0), 0.0, 0.72, None),
    "film": ((0.82, 0.90, 0.92, 1.0), 0.0, 0.22, None),
}

MATERIALS: dict[str, bpy.types.Material] = {}
Object = bpy.types.Object


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATERIALS.clear()
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    world = bpy.data.worlds.new("FreshcutWorld")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background:
        background.inputs[0].default_value = (0.025, 0.035, 0.045, 1.0)
        background.inputs[1].default_value = 0.32
    scene.world = world


def material(name: str) -> bpy.types.Material:
    cached = MATERIALS.get(name)
    if cached:
        return cached
    base, metallic, roughness, emission = PALETTE[name]
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    if shader:
        shader.inputs["Base Color"].default_value = base
        shader.inputs["Metallic"].default_value = metallic
        shader.inputs["Roughness"].default_value = roughness
        if emission:
            shader.inputs["Emission Color"].default_value = emission
            shader.inputs["Emission Strength"].default_value = 1.6
    MATERIALS[name] = result
    return result


def attach(obj: Object, parent: Object | None) -> Object:
    if parent:
        obj.parent = parent
    return obj


def empty(name: str, parent: Object | None = None) -> Object:
    result = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(result)
    return attach(result, parent)


def apply_bevel(obj: Object, width: float, segments: int = 2) -> None:
    if width <= 0:
        return
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    modifier = obj.modifiers.new("sanitary_edge", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def box(
    name: str,
    size: tuple[float, float, float],
    location: tuple[float, float, float],
    material_name: str,
    parent: Object | None = None,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel: float = 0.015,
) -> Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location, rotation=rotation)
    result = bpy.context.object
    result.name = name
    result.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    apply_bevel(result, min(bevel, min(size) * 0.22))
    result.data.materials.append(material(material_name))
    return attach(result, parent)


def cylinder(
    name: str,
    radius: float,
    depth: float,
    location: tuple[float, float, float],
    material_name: str,
    parent: Object | None = None,
    axis: str = "Z",
    vertices: int = 32,
) -> Object:
    rotation = (0.0, 0.0, 0.0)
    if axis == "X":
        rotation = (0.0, math.pi / 2, 0.0)
    elif axis == "Y":
        rotation = (math.pi / 2, 0.0, 0.0)
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    result = bpy.context.object
    result.name = name
    result.data.materials.append(material(material_name))
    for polygon in result.data.polygons:
        polygon.use_smooth = True
    return attach(result, parent)


def torus(
    name: str,
    major_radius: float,
    minor_radius: float,
    location: tuple[float, float, float],
    material_name: str,
    parent: Object | None = None,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=32,
        minor_segments=8,
        location=location,
        rotation=rotation,
    )
    result = bpy.context.object
    result.name = name
    result.data.materials.append(material(material_name))
    return attach(result, parent)


def sphere(
    name: str,
    radius: float,
    location: tuple[float, float, float],
    material_name: str,
    parent: Object | None = None,
) -> Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=24,
        ring_count=12,
        radius=radius,
        location=location,
    )
    result = bpy.context.object
    result.name = name
    result.data.materials.append(material(material_name))
    for polygon in result.data.polygons:
        polygon.use_smooth = True
    return attach(result, parent)


def beam_between(
    name: str,
    start: tuple[float, float, float],
    end: tuple[float, float, float],
    radius: float,
    material_name: str,
    parent: Object | None = None,
) -> Object:
    start_vector = Vector(start)
    end_vector = Vector(end)
    direction = end_vector - start_vector
    result = cylinder(
        name,
        radius,
        direction.length,
        tuple((start_vector + end_vector) * 0.5),
        material_name,
        parent,
    )
    result.rotation_mode = "QUATERNION"
    result.rotation_quaternion = direction.to_track_quat("Z", "Y")
    return result


def root_for(asset_id: str, dimensions: tuple[float, float, float]) -> Object:
    root = empty(asset_id)
    root["asset_id"] = asset_id
    root["nominal_dimensions_m"] = ",".join(str(value) for value in dimensions)
    root["industry"] = "fresh-cut-produce"
    return root


def feet(parent: Object, points: Iterable[tuple[float, float]], leg_height: float) -> None:
    for index, (x, y) in enumerate(points):
        box(f"leg_{index + 1}", (0.075, 0.075, leg_height), (x, y, leg_height / 2), "stainless_dark", parent)
        cylinder(f"foot_{index + 1}", 0.085, 0.035, (x, y, 0.018), "rubber", parent)


def motor(name: str, location: tuple[float, float, float], parent: Object, axis: str = "X") -> Object:
    group = empty(name, parent)
    cylinder("motor_body", 0.16, 0.34, location, "motor_blue", group, axis=axis)
    cylinder("motor_cap", 0.18, 0.05, location, "stainless_dark", group, axis=axis)
    return group


def control_cabinet(
    location: tuple[float, float, float],
    parent: Object,
    size: tuple[float, float, float] = (0.42, 0.24, 0.70),
) -> Object:
    group = empty("control_cabinet", parent)
    box("cabinet", size, location, "white_panel", group, bevel=0.025)
    front_y = location[1] - size[1] / 2 - 0.012
    box("hmi", (0.22, 0.025, 0.15), (location[0], front_y, location[2] + 0.12), "screen", group, bevel=0.01)
    cylinder("status_green", 0.025, 0.025, (location[0] - 0.09, front_y - 0.01, location[2] - 0.08), "produce_green", group, axis="Y", vertices=20)
    cylinder("status_red", 0.025, 0.025, (location[0] + 0.01, front_y - 0.01, location[2] - 0.08), "emergency_red", group, axis="Y", vertices=20)
    return group


def emergency_stop(location: tuple[float, float, float], parent: Object, name: str = "emergency_stop") -> Object:
    group = empty(name, parent)
    box("yellow_guard", (0.13, 0.07, 0.13), location, "safety_yellow", group, bevel=0.018)
    cylinder("red_button", 0.045, 0.045, (location[0], location[1] - 0.055, location[2]), "emergency_red", group, axis="Y", vertices=24)
    return group


def conveyor_module(
    parent: Object,
    length: float,
    width: float,
    belt_height: float,
    name: str = "food_belt",
) -> Object:
    group = empty(name, parent)
    group["motion"] = "translate-x-loop"
    box("belt_surface", (length, width, 0.055), (0.0, 0.0, belt_height), "food_belt", group, bevel=0.018)
    for x in (-length / 2 + 0.12, length / 2 - 0.12):
        cylinder(f"roller_{'in' if x < 0 else 'out'}", 0.105, width, (x, 0.0, belt_height - 0.015), "stainless_dark", group, axis="Y")
    return group


def build_infeed_elevator() -> Object:
    root = root_for("infeed-elevator", (3.4, 1.2, 2.2))
    frame = empty("static_frame", root)
    moving = empty("food_belt", root)
    moving["motion"] = "translate-incline-loop"
    angle = math.radians(24)
    belt_length = 2.75
    belt_center = (-0.05, 0.0, 1.07)
    box("belt_surface", (belt_length, 0.78, 0.075), belt_center, "food_belt_blue", moving, rotation=(0.0, -angle, 0.0), bevel=0.018)
    for index in range(11):
        ratio = index / 10
        x = -1.30 + ratio * 2.50
        z = 0.52 + ratio * 1.11
        box(f"cleat_{index + 1:02d}", (0.045, 0.72, 0.11), (x, 0.0, z), "white_panel", moving, rotation=(0.0, -angle, 0.0), bevel=0.008)
    for y in (-0.46, 0.46):
        box("side_guard", (2.9, 0.055, 0.26), belt_center, "stainless", frame, rotation=(0.0, -angle, 0.0), bevel=0.012).location.y = y
    box("hopper_floor", (1.15, 0.95, 0.12), (-1.35, 0.0, 0.38), "stainless", frame, bevel=0.025)
    box("hopper_back", (0.12, 1.10, 0.70), (-1.75, 0.0, 0.66), "stainless", frame, rotation=(0.0, math.radians(-12), 0.0), bevel=0.02)
    for y in (-0.50, 0.50):
        box("hopper_side", (0.90, 0.09, 0.65), (-1.34, y, 0.68), "stainless", frame, rotation=(0.0, math.radians(-8), 0.0), bevel=0.02)
    feet(frame, [(-1.45, -0.45), (-1.45, 0.45)], 0.38)
    feet(frame, [(1.10, -0.40), (1.10, 0.40)], 1.42)
    motor("drive_motor", (1.38, 0.54, 1.63), root, axis="Y")
    control_cabinet((-0.95, 0.70, 0.72), root, (0.42, 0.24, 0.62))
    emergency_stop((-0.65, -0.54, 1.05), root)
    return root


def build_bubble_washer() -> Object:
    root = root_for("bubble-washer", (4.6, 1.45, 1.75))
    frame = empty("static_frame", root)
    tank = empty("wash_tank", root)
    belt = empty("food_belt", root)
    belt["motion"] = "translate-x-loop"
    feet(frame, [(-1.95, -0.58), (-1.95, 0.58), (0.0, -0.58), (0.0, 0.58), (1.95, -0.58), (1.95, 0.58)], 0.52)
    box("tank_floor", (4.45, 1.18, 0.10), (0.0, 0.0, 0.58), "stainless_dark", tank, bevel=0.025)
    for y in (-0.62, 0.62):
        box("tank_wall", (4.50, 0.10, 0.72), (0.0, y, 0.91), "stainless", tank, bevel=0.025)
    for x in (-2.20, 2.20):
        box("tank_end", (0.10, 1.18, 0.70), (x, 0.0, 0.91), "stainless", tank, bevel=0.025)
    box("water_surface", (4.20, 1.05, 0.025), (-0.10, 0.0, 0.93), "water", tank, bevel=0.008)
    box("mesh_belt", (4.32, 0.96, 0.045), (0.0, 0.0, 1.00), "food_belt", belt, bevel=0.01)
    for index in range(17):
        x = -2.02 + index * 0.252
        box(f"belt_bar_{index + 1:02d}", (0.025, 0.94, 0.035), (x, 0.0, 1.035), "stainless", belt, bevel=0.004)
    spray = empty("spray_manifold", root)
    for x in (-1.45, -0.50, 0.45, 1.40):
        beam_between("spray_arch", (x, -0.66, 1.48), (x, 0.66, 1.48), 0.028, "stainless", spray)
        for y in (-0.38, 0.0, 0.38):
            cylinder("spray_nozzle", 0.022, 0.10, (x, y, 1.40), "safety_yellow", spray, axis="Z", vertices=20)
    beam_between("feed_pipe", (-2.05, 0.72, 0.30), (-2.05, 0.72, 1.50), 0.055, "stainless", root)
    beam_between("header_pipe", (-2.05, 0.72, 1.50), (1.72, 0.72, 1.50), 0.055, "stainless", root)
    motor("circulation_blower", (-1.55, -0.83, 0.72), root, axis="X")
    torus("drain_valve", 0.10, 0.018, (1.65, -0.78, 0.34), "safety_yellow", root, rotation=(math.pi / 2, 0.0, 0.0))
    beam_between("drain_pipe", (1.65, -0.67, 0.42), (1.65, -0.92, 0.20), 0.045, "stainless", root)
    control_cabinet((2.00, -0.82, 0.86), root)
    emergency_stop((1.58, -0.73, 1.31), root)
    return root


def build_inspection_conveyor() -> Object:
    root = root_for("inspection-conveyor", (3.8, 1.35, 1.65))
    frame = empty("static_frame", root)
    conveyor_module(root, 3.65, 0.86, 0.87)
    feet(frame, [(-1.65, -0.48), (-1.65, 0.48), (0.0, -0.48), (0.0, 0.48), (1.65, -0.48), (1.65, 0.48)], 0.76)
    for y in (-0.56, 0.56):
        box("operator_shelf", (3.55, 0.20, 0.055), (0.0, y, 0.82), "stainless", frame, bevel=0.018)
        box("waste_chute", (0.62, 0.24, 0.28), (0.75 if y > 0 else -0.75, y + (0.09 if y > 0 else -0.09), 0.62), "stainless_dark", frame, rotation=(math.radians(8), 0.0, 0.0), bevel=0.025)
    lighting = empty("inspection_lighting", root)
    for x in (-1.45, 1.45):
        for y in (-0.52, 0.52):
            box("light_post", (0.055, 0.055, 0.70), (x, y, 1.20), "stainless", lighting, bevel=0.01)
    box("light_canopy", (3.05, 1.12, 0.10), (0.0, 0.0, 1.58), "white_panel", lighting, bevel=0.035)
    for y in (-0.30, 0.30):
        box("led_strip", (2.65, 0.08, 0.025), (0.0, y, 1.515), "screen", lighting, bevel=0.01)
    motor("drive_motor", (1.72, 0.54, 0.67), root, axis="Y")
    emergency_stop((-1.50, -0.63, 1.02), root, "emergency_stop_in")
    emergency_stop((1.50, -0.63, 1.02), root, "emergency_stop_out")
    return root


def build_vegetable_cutter() -> Object:
    root = root_for("vegetable-cutter", (2.2, 1.25, 1.75))
    frame = empty("static_frame", root)
    feet(frame, [(-0.82, -0.46), (-0.82, 0.46), (0.82, -0.46), (0.82, 0.46)], 0.32)
    box("main_cabinet", (1.10, 1.00, 1.12), (0.12, 0.0, 0.88), "white_panel", frame, bevel=0.055)
    box("service_door", (0.72, 0.035, 0.72), (0.14, -0.518, 0.82), "stainless", frame, bevel=0.03)
    cylinder("door_handle", 0.022, 0.18, (0.42, -0.55, 0.84), "stainless_dark", frame, axis="Z", vertices=20)
    infeed = empty("food_belt_in", root)
    infeed["motion"] = "translate-x-loop"
    box("infeed_belt", (0.88, 0.72, 0.07), (-0.82, 0.0, 0.91), "food_belt_blue", infeed, bevel=0.02)
    for y in (-0.41, 0.41):
        box("infeed_guard", (0.92, 0.045, 0.24), (-0.82, y, 1.02), "stainless", frame, bevel=0.012)
    outfeed = empty("food_belt_out", root)
    outfeed["motion"] = "translate-x-loop"
    box("outfeed_belt", (0.58, 0.70, 0.07), (0.92, 0.0, 0.75), "food_belt", outfeed, bevel=0.02)
    rotor = empty("cutter_rotor", root)
    rotor["motion"] = "rotate-y"
    cylinder("knife_disc", 0.34, 0.055, (0.12, -0.28, 1.15), "stainless_dark", rotor, axis="Y", vertices=48)
    for angle in (0.0, math.pi / 2, math.pi, math.pi * 1.5):
        box("knife_blade", (0.48, 0.025, 0.055), (0.12, -0.32, 1.15), "stainless", rotor, rotation=(0.0, angle, 0.0), bevel=0.004)
    box("safety_window", (0.54, 0.035, 0.54), (0.12, -0.54, 1.16), "screen", frame, bevel=0.06)
    motor("cutter_motor", (0.36, 0.62, 1.18), root, axis="Y")
    control_cabinet((0.70, -0.66, 1.17), root, (0.38, 0.22, 0.54))
    emergency_stop((-0.44, -0.60, 1.46), root)
    return root


def build_vibratory_dewaterer() -> Object:
    root = root_for("vibratory-dewaterer", (3.2, 1.35, 1.55))
    frame = empty("static_frame", root)
    feet(frame, [(-1.30, -0.50), (-1.30, 0.50), (1.30, -0.50), (1.30, 0.50)], 0.58)
    box("drain_pan", (2.90, 1.08, 0.14), (0.0, 0.0, 0.60), "stainless_dark", frame, rotation=(0.0, math.radians(-2), 0.0), bevel=0.035)
    deck = empty("vibrating_deck", root)
    deck["motion"] = "vibrate-xz"
    box("perforated_bed", (2.92, 0.92, 0.075), (0.0, 0.0, 0.94), "food_belt", deck, rotation=(0.0, math.radians(-4), 0.0), bevel=0.025)
    for index in range(15):
        x = -1.35 + index * 0.193
        box(f"screen_bar_{index + 1:02d}", (0.022, 0.86, 0.028), (x, 0.0, 0.985 - x * 0.012), "stainless", deck, bevel=0.003)
    for y in (-0.53, 0.53):
        box("deck_guard", (3.00, 0.06, 0.35), (0.0, y, 1.09), "stainless", deck, rotation=(0.0, math.radians(-4), 0.0), bevel=0.018)
    for index, (x, y) in enumerate([(-1.12, -0.45), (-1.12, 0.45), (1.12, -0.45), (1.12, 0.45)]):
        spring = empty(f"spring_mount_{index + 1}", root)
        for ring_index in range(4):
            torus("spring_ring", 0.075, 0.012, (x, y, 0.69 + ring_index * 0.045), "safety_yellow", spring)
    motor("vibrator_left", (-0.50, -0.62, 0.68), root, axis="X")
    motor("vibrator_right", (0.50, -0.62, 0.68), root, axis="X")
    beam_between("drain_pipe", (1.12, 0.52, 0.55), (1.12, 0.82, 0.24), 0.045, "stainless", root)
    control_cabinet((-1.30, -0.72, 1.00), root, (0.38, 0.22, 0.62))
    emergency_stop((-0.90, -0.66, 1.31), root)
    return root


def build_weigh_packer() -> Object:
    root = root_for("weigh-packer", (2.6, 1.8, 3.0))
    frame = empty("static_frame", root)
    feet(frame, [(-0.95, -0.66), (-0.95, 0.66), (0.95, -0.66), (0.95, 0.66)], 2.45)
    for z in (0.55, 2.38):
        box("frame_cross_x", (2.15, 0.075, 0.075), (0.0, -0.68, z), "stainless", frame, bevel=0.012)
        box("frame_cross_x", (2.15, 0.075, 0.075), (0.0, 0.68, z), "stainless", frame, bevel=0.012)
    for x in (-1.02, 1.02):
        box("frame_cross_y", (0.075, 1.42, 0.075), (x, 0.0, 2.38), "stainless", frame, bevel=0.012)
    feeder = empty("radial_feeder", root)
    feeder["motion"] = "vibrate-radial"
    cylinder("top_hopper", 0.60, 0.34, (0.0, 0.0, 2.73), "stainless", feeder, vertices=48)
    cylinder("distribution_cone", 0.48, 0.18, (0.0, 0.0, 2.47), "food_belt", feeder, vertices=48)
    buckets = empty("weigh_buckets", root)
    buckets["motion"] = "bucket-gates"
    for index in range(10):
        angle = index * math.tau / 10
        x = math.cos(angle) * 0.68
        y = math.sin(angle) * 0.68
        box(f"bucket_{index + 1:02d}", (0.28, 0.24, 0.30), (x, y, 2.13), "stainless", buckets, rotation=(0.0, 0.0, angle), bevel=0.055)
    cylinder("collection_funnel", 0.46, 0.55, (0.0, 0.0, 1.76), "stainless_dark", root, vertices=48)
    packing = empty("packing_head", root)
    box("vertical_body", (0.78, 0.78, 1.15), (0.0, 0.0, 0.92), "white_panel", packing, bevel=0.045)
    cylinder("forming_tube", 0.17, 0.86, (0.0, 0.0, 1.20), "stainless", packing, vertices=40)
    cylinder("film_roll", 0.24, 0.64, (-0.55, 0.0, 1.30), "film", packing, axis="Y", vertices=40)
    jaws = empty("sealing_jaws", root)
    jaws["motion"] = "close-open-x"
    box("jaw_left", (0.18, 0.58, 0.12), (-0.23, 0.0, 0.57), "safety_yellow", jaws, bevel=0.018)
    box("jaw_right", (0.18, 0.58, 0.12), (0.23, 0.0, 0.57), "safety_yellow", jaws, bevel=0.018)
    control_cabinet((0.82, -0.86, 1.36), root, (0.46, 0.24, 0.74))
    emergency_stop((0.48, -0.82, 1.74), root)
    return root


def build_metal_detector() -> Object:
    root = root_for("metal-detector", (2.4, 1.2, 1.75))
    frame = empty("static_frame", root)
    conveyor_module(root, 2.25, 0.72, 0.78)
    feet(frame, [(-0.92, -0.42), (-0.92, 0.42), (0.92, -0.42), (0.92, 0.42)], 0.68)
    portal = empty("detector_portal", root)
    for y in (-0.48, 0.48):
        box("portal_side", (0.48, 0.15, 1.22), (0.0, y, 1.19), "white_panel", portal, bevel=0.055)
    box("portal_top", (0.48, 1.10, 0.22), (0.0, 0.0, 1.69), "white_panel", portal, bevel=0.055)
    box("portal_inner_top", (0.30, 0.76, 0.055), (0.0, 0.0, 1.47), "stainless_dark", portal, bevel=0.018)
    reject = empty("reject_pusher", root)
    reject["motion"] = "translate-y"
    cylinder("air_cylinder", 0.055, 0.42, (0.62, 0.50, 0.98), "stainless_dark", reject, axis="Y", vertices=24)
    box("pusher_plate", (0.34, 0.055, 0.28), (0.62, 0.25, 0.90), "safety_yellow", reject, bevel=0.025)
    box("reject_bin", (0.70, 0.42, 0.50), (0.78, -0.72, 0.38), "stainless", frame, bevel=0.04)
    control_cabinet((0.0, -0.72, 1.34), root, (0.42, 0.22, 0.52))
    emergency_stop((-0.46, -0.61, 1.30), root)
    motor("drive_motor", (1.02, 0.48, 0.58), root, axis="Y")
    return root


BUILDERS: dict[str, Callable[[], Object]] = {
    "infeed-elevator": build_infeed_elevator,
    "bubble-washer": build_bubble_washer,
    "inspection-conveyor": build_inspection_conveyor,
    "vegetable-cutter": build_vegetable_cutter,
    "vibratory-dewaterer": build_vibratory_dewaterer,
    "weigh-packer": build_weigh_packer,
    "metal-detector": build_metal_detector,
}


def descendants(root: Object) -> list[Object]:
    result = [root]
    for child in root.children:
        result.extend(descendants(child))
    return result


def bounds(root: Object) -> tuple[Vector, Vector]:
    minimum = Vector((math.inf, math.inf, math.inf))
    maximum = Vector((-math.inf, -math.inf, -math.inf))
    for obj in descendants(root):
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            minimum.x = min(minimum.x, world.x)
            minimum.y = min(minimum.y, world.y)
            minimum.z = min(minimum.z, world.z)
            maximum.x = max(maximum.x, world.x)
            maximum.y = max(maximum.y, world.y)
            maximum.z = max(maximum.z, world.z)
    return minimum, maximum


def export_glb(root: Object, output_path: str) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in descendants(root):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        export_yup=True,
        use_selection=True,
        export_apply=True,
        export_extras=True,
        export_materials="EXPORT",
    )
    minimum, maximum = bounds(root)
    size = maximum - minimum
    print(
        f"[freshcut] {root.name}: "
        f"size=[{size.x:.2f}, {size.y:.2f}, {size.z:.2f}]m "
        f"meshes={sum(obj.type == 'MESH' for obj in descendants(root))} "
        f"bytes={os.path.getsize(output_path)}"
    )


def setup_preview(root: Object) -> Object:
    minimum, maximum = bounds(root)
    centre = (minimum + maximum) * 0.5
    extent = max((maximum - minimum).length, 1.0)
    bpy.ops.mesh.primitive_plane_add(size=max(extent * 2.5, 8.0), location=(centre.x, centre.y, minimum.z - 0.02))
    ground = bpy.context.object
    ground.name = "preview_ground"
    ground.data.materials.append(material("rubber"))
    bpy.ops.object.light_add(type="AREA", location=(centre.x - extent * 0.45, centre.y - extent * 0.65, maximum.z + extent * 0.65))
    key = bpy.context.object
    key.data.energy = 1100
    key.data.shape = "DISK"
    key.data.size = extent * 0.55
    key.rotation_euler = ((centre - key.location).to_track_quat("-Z", "Y")).to_euler()
    bpy.ops.object.light_add(type="AREA", location=(centre.x + extent * 0.6, centre.y + extent * 0.45, centre.z + extent * 0.25))
    fill = bpy.context.object
    fill.data.energy = 650
    fill.data.size = extent * 0.5
    fill.rotation_euler = ((centre - fill.location).to_track_quat("-Z", "Y")).to_euler()
    bpy.ops.object.camera_add(location=(centre.x + extent * 0.82, centre.y - extent * 1.02, centre.z + extent * 0.58))
    camera = bpy.context.object
    camera.data.lens = 52
    camera.rotation_euler = ((centre - camera.location).to_track_quat("-Z", "Y")).to_euler()
    bpy.context.scene.camera = camera
    return camera


def render_preview(root: Object, output_path: str) -> None:
    setup_preview(root)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1100
    scene.render.resolution_y = 760
    scene.render.resolution_percentage = 70
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = output_path
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    bpy.ops.render.render(write_still=True)


def parse_args() -> argparse.Namespace:
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("devices", help="all or comma-separated asset ids")
    parser.add_argument("--out", required=True)
    parser.add_argument("--preview-out")
    parser.add_argument("--blend-out")
    return parser.parse_args(raw)


def main() -> None:
    args = parse_args()
    devices = list(BUILDERS) if args.devices == "all" else [value.strip() for value in args.devices.split(",") if value.strip()]
    unknown = [device for device in devices if device not in BUILDERS]
    if unknown:
        raise SystemExit(f"Unknown fresh-cut assets {unknown}; available={sorted(BUILDERS)}")
    for device in devices:
        reset_scene()
        root = BUILDERS[device]()
        export_glb(root, os.path.join(args.out, f"{device}.glb"))
        if args.preview_out:
            render_preview(root, os.path.join(args.preview_out, f"{device}_preview.png"))
        if args.blend_out:
            os.makedirs(args.blend_out, exist_ok=True)
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(args.blend_out, f"{device}.blend"))
    print(f"[freshcut] DONE ({len(devices)} assets)")


if __name__ == "__main__":
    main()
