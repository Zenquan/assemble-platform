"""
gen_device.py — 用 Blender 后台(无头)程序化生成工业工位设备 glTF 资产。

用法:
  /Applications/Blender.app/Contents/MacOS/Blender -b scripts/gltf-gen/gen_device.py -- \
      <device_id> --out <dir> [--scale F] [--seed N]

已支持设备 (device_id, 可逗号分隔批量):
  vision-module   视觉检测模组: 工业相机(镜头) + 环形光源 + 立柱支架
  feeder          工位1 振动盘供料器: 圆台螺旋盘 + 滑槽 + 控制盒
  gantry-arm      工位3 龙门机械臂: 立柱+横梁+滑块+垂直轴+夹爪吸盘
  conveyor        贯穿三工位输送带: 长机身 + 滚筒 + 4 组支腿 + 头尾控制盒
  transfer-conveyor 净菜设备间卫生转运输送段: 短机身 + 食品带 + 支撑脚
  box-pack        工位3末端装箱定位台: 底座+挡框+成品箱+HMI 小屏

用法:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/gltf-gen/gen_device.py -- \
      <device_id>[,<device_id>...] --out <dir> [--scale F]

导出约定(与 assemble-platform / Babylon 对齐):
  - glTF GLB, +Y up (Babylon Y 向上)
  - 原点落设备安装底面 / 装配锚点
  - PBR Principled BSDF, 单位米, 尺寸量级与场景(相机 ISO 视 240 内)匹配
"""
from __future__ import annotations
import math, os, sys

import bpy  # noqa: F401  (仅 Blender 内可用)
from mathutils import Vector

# ---------- 材质调色板 ----------
PALETTE = {
    "metal_dark":   dict(base=(0.12,0.13,0.15), metal=0.95, rough=0.45),
    "metal_mid":    dict(base=(0.28,0.30,0.33), metal=0.90, rough=0.35),
    "body_charcoal":dict(base=(0.16,0.17,0.19), metal=0.10, rough=0.60),
    "black_plastic":dict(base=(0.03,0.03,0.04), metal=0.05, rough=0.70),
    "lens_glass":   dict(base=(0.02,0.02,0.05), metal=0.0,  rough=0.05, emissive=(0.02,0.03,0.10)),
    "accent_orange":dict(base=(0.95,0.36,0.05), metal=0.20, rough=0.45),
    "led_ring":     dict(base=(0.7,0.72,0.78),  metal=0.0,  rough=0.30, emissive=(0.9,0.95,1.0)),
    "aluminum":     dict(base=(0.55,0.57,0.60), metal=0.85, rough=0.25),
    "food_belt":    dict(base=(0.02,0.36,0.43),  metal=0.02, rough=0.64),
    "dark_rubber":  dict(base=(0.05,0.05,0.06), metal=0.0,  rough=0.95),
}


def make_material(name: str) -> bpy.types.Material:
    p = PALETTE[name]
    m = bpy.data.materials.new(f"{name}")
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*p["base"], 1.0)
        bsdf.inputs["Metallic"].default_value = p.get("metal", 0.0)
        bsdf.inputs["Roughness"].default_value = p.get("rough", 0.5)
        if "emissive" in p:
            bsdf.inputs["Emission Color"].default_value = (*p["emissive"], 1.0)
            bsdf.inputs["Emission Strength"].default_value = 1.5
    return m


def _assign(obj: bpy.types.Object, mat_name: str) -> None:
    mat = make_material(mat_name)
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)


def cube(size: tuple[float, float, float], center: tuple[float, float, float],
          mat: str, name: str, rot_z: float = 0.0) -> bpy.types.Object:
    """axis-aligned box, center in local space, origin at bottom-center unless lifted."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0))
    o = bpy.context.object
    o.name = name
    o.scale = (size[0], size[1], size[2])
    o.rotation_euler = (0, 0, rot_z)
    o.location = (center[0], center[1], center[2])
    _assign(o, mat)
    return o


def cylinder(radius: float, depth: float, center: tuple[float, float, float],
             mat: str, name: str, axis: str = "Z", verts: int = 48) -> bpy.types.Object:
    """cylinder; axis: Z(默认) | X | Y —— 用旋转实现轴向。origin 在其几何中心下移到底面可传 center。"""
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius,
                                        depth=depth, location=(0, 0, 0))
    o = bpy.context.object
    o.name = name
    if axis == "X":
        o.rotation_euler = (0, 0, math.pi / 2)
    elif axis == "Y":
        o.rotation_euler = (math.pi / 2, 0, 0)
    o.location = (center[0], center[1], center[2])
    _assign(o, mat)
    return o


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # 空场景没有默认 World，确保存在以设柔和背景
    if not bpy.data.worlds:
        bpy.ops.world.new()
        bpy.data.worlds[0].name = "GenWorld"
    world = bpy.data.worlds[0]
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.7, 0.7, 0.72, 1.0)
    bpy.context.scene.world = world
    # 用单一剪影光源保证 PBR 可见度
    bpy.ops.object.light_add(type="AREA", location=(12, -12, 22))
    light = bpy.context.object
    light.data.energy = 300
    light.data.size = 8
    light.rotation_euler = (math.radians(45), 0, math.radians(45))


# =====================================================================
# 设备构建器
# =====================================================================
def build_vision_module() -> list[bpy.types.Object]:
    """视觉检测工位模组：相机(镜头前) + 立柱 + 环形光源 + 安装基座。

    Y-up 语义：本地 Y 为"看向产线"方向。原点在基座底面中心。
    产出单一网格合并对象 'vision-module'，便于 Babylon 加载成一层。
    """
    # --- 基座(站台) ---
    base = cube((2.4, 1.4, 0.25), (0, 0, 0.125), "metal_dark", "base")
    top_plate = cube((2.1, 1.1, 0.08), (0, 0, 0.29), "metal_mid", "top_plate")

    # --- 立柱(双杆) ---
    pole_h = 1.6
    for sx in (-0.55, 0.55):
        cylinder(0.07, pole_h, (sx, 0, 0.25 + pole_h / 2), "aluminum",
                 f"pole_{'L' if sx < 0 else 'R'}")

    # --- 横梁(挂相机) ---
    beam = cube((1.5, 0.12, 0.12), (0, 0, 0.25 + pole_h), "aluminum", "beam")

    # --- 相机本体(箱式视觉处理器) ---
    cam_box = cube((0.55, 0.35, 0.30),
                   (0, 0.35, 0.25 + pole_h + 0.35), "body_charcoal", "cam_body")
    # 前置镜头筒
    lens = cylinder(0.13, 0.4, (0, 0.78, 0.25 + pole_h + 0.35), "metal_dark", "lens_barrel", axis="Y")
    # 镜头玻璃(前视)
    glass = cylinder(0.09, 0.03, (0, 0.99, 0.25 + pole_h + 0.35), "lens_glass", "lens_glass", axis="Y")

    # --- 环形光源(照向产线, Y 负方向) ---
    ring = cylinder(0.55, 0.06, (0, -0.55, 0.25 + pole_h - 0.15), "led_ring", "ring_light", axis="Y")
    ring_housing = cylinder(0.6, 0.08, (0, -0.47, 0.25 + pole_h - 0.15), "black_plastic", "ring_housing", axis="Y")

    # --- 排线护套装饰 ---
    for yy in (0.10, 0.50):
        cube((0.03, 0.6, 0.03), (0.28, yy, 0.25 + pole_h - 0.05), "dark_rubber", f"cable_{int(yy*10)}")

def build_vision_module_full() -> list[bpy.types.Object]:
    objs = []
    base = cube((2.4, 1.4, 0.25), (0, 0, 0.125), "metal_dark", "base"); objs.append(base)
    cube((2.1, 1.1, 0.08), (0, 0, 0.29), "metal_mid", "top_plate")
    pole_h = 1.6
    for sx in (-0.55, 0.55):
        objs.append(cylinder(0.07, pole_h, (sx, 0, 0.25 + pole_h/2), "aluminum", f"pole_{'L' if sx<0 else 'R'}"))
    objs.append(cube((1.5, 0.12, 0.12), (0, 0, 0.25+pole_h), "aluminum", "beam"))
    cam_y = 0.25 + pole_h + 0.35
    objs.append(cube((0.55, 0.35, 0.30), (0, 0.35, cam_y), "body_charcoal", "cam_body"))
    objs.append(cylinder(0.13, 0.4, (0, 0.78, cam_y), "metal_dark", "lens_barrel", axis="Y"))
    objs.append(cylinder(0.09, 0.03, (0, 0.99, cam_y), "lens_glass", "lens_glass", axis="Y"))
    objs.append(cylinder(0.55, 0.06, (0, -0.55, cam_y-0.3), "led_ring", "ring_light", axis="Y"))
    objs.append(cylinder(0.60, 0.08, (0, -0.47, cam_y-0.3), "black_plastic", "ring_housing", axis="Y"))
    for yy in (0.10, 0.50):
        objs.append(cube((0.03, 0.6, 0.03), (0.28, yy, cam_y-0.3), "dark_rubber", f"cable_{int(yy*10)}"))
    return objs


def cone(radius1: float, radius2: float, depth: float,
          center: tuple[float, float, float], mat: str, name: str,
          axis: str = "Z", verts: int = 64) -> bpy.types.Object:
    """圆台(截锥) —— Blender primitive_cone_add."""
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=radius1, radius2=radius2,
                                    depth=depth, location=(0, 0, 0))
    o = bpy.context.object
    o.name = name
    if axis == "X":
        o.rotation_euler = (0, 0, math.pi / 2)
    elif axis == "Y":
        o.rotation_euler = (math.pi / 2, 0, 0)
    o.location = (center[0], center[1], center[2])
    _assign(o, mat)
    return o


def join_to_single(name: str, objs: list[bpy.types.Object]) -> bpy.types.Object:
    """把给定对象合并成单一 mesh(保留各自材质槽), 命名 name, 返回合并对象。"""
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    active = bpy.context.object
    active.name = name
    return active


# =====================================================================
# 设备构建器 (续) —— 工位1/3 + 贯穿输送带
# =====================================================================
def build_feeder() -> list[bpy.types.Object]:
    """工位1：振动盘供料器。

    结构: 方形底座 + 圆台螺旋盘体 + 顶部圆柱分配环 + 落料滑槽 + 控制盒。
    Y-up：Z高, X宽, Y长(滑槽朝 +Y 抛出方向)。
    """
    objs = []
    objs.append(cube((1.2, 1.0, 0.18), (0, 0, 0.09), "metal_dark", "base_plate"))
    objs.append(cube((1.0, 0.85, 0.04), (0, 0, 0.20), "metal_mid", "deck"))
    # 圆台螺旋盘（底大顶小 + 朝 Y+ 略倾形成导出方向感）
    objs.append(cone(0.55, 0.40, 0.10, (0, 0, 0.27), "body_charcoal", "bowl"))
    # 中心分配柱
    objs.append(cylinder(0.06, 0.10, (0, 0, 0.37), "aluminum", "center_pillar"))
    # 顶圈
    objs.append(cylinder(0.50, 0.03, (0, 0, 0.43), "accent_orange", "top_ring"))
    # 落料滑槽
    objs.append(cube((0.18, 0.6, 0.06), (0.36, 0.45, 0.32), "metal_mid", "chute"))
    objs.append(cube((0.16, 0.04, 0.10), (0.36, 0.78, 0.30), "black_plastic", "chute_exit"))
    # 控制盒（侧面）
    objs.append(cube((0.12, 0.20, 0.30), (-0.55, 0.0, 0.35), "body_charcoal", "control_box"))
    objs.append(cube((0.10, 0.16, 0.10), (-0.55, 0.05, 0.50), "accent_orange", "status_led"))
    # 支撑腿
    for sx, sy in ((-0.50, -0.40), (0.50, -0.40), (-0.50, 0.40), (0.50, 0.40)):
        objs.append(cube((0.05, 0.05, 0.10), (sx, sy, 0.05), "metal_dark", f"leg_{sx}_{sy}"))
    return objs


def build_gantry_arm() -> list[bpy.types.Object]:
    """工位3：龙门式装箱机械臂。

    结构: 双立柱 + 顶部横梁 + 滑块 + 垂直 Z 轴 + 末端吸盘/夹爪 + 底座。
    X 跨度 ~1.6, Z 总高 ~1.95, 拾取朝 Y+。
    """
    objs = []
    objs.append(cube((1.6, 0.6, 0.12), (0, 0, 0.06), "metal_dark", "base"))
    # 双立柱
    col_h = 1.7
    for sx in (-0.7, 0.7):
        objs.append(cube((0.12, 0.12, col_h), (sx, 0, 0.12 + col_h/2), "aluminum", f"col_{'L' if sx<0 else 'R'}"))
    # 横梁
    beam_y = 0.12 + col_h
    objs.append(cube((1.6, 0.16, 0.14), (0, 0, beam_y), "aluminum", "beam_x"))
    # 滑块（沿 X 移动头）
    objs.append(cube((0.22, 0.18, 0.16), (0, 0, beam_y - 0.12), "body_charcoal", "slider"))
    # 垂直 Z 轴杆
    z_axis_y = beam_y - 0.22
    objs.append(cube((0.08, 0.08, 0.85), (0, 0, z_axis_y - 0.05), "aluminum", "z_axis"))
    # Z 轴箱
    objs.append(cube((0.18, 0.18, 0.18), (0, 0, beam_y - 0.21), "body_charcoal", "z_housing"))
    # 末端夹爪臂
    grip_y = z_axis_y - 0.5
    objs.append(cube((0.10, 0.30, 0.06), (0, 0, grip_y), "aluminum", "gripper_arm"))
    # 吸盘头
    objs.append(cylinder(0.08, 0.04, (0, 0, grip_y - 0.05), "dark_rubber", "suction_cup", axis="Z"))
    # 拾取指示灯
    objs.append(cylinder(0.025, 0.02, (0, 0.16, grip_y), "accent_orange", "indicator", axis="Z"))
    return objs


def build_conveyor() -> list[bpy.types.Object]:
    """贯穿三个工位的输送带。

结构: 长 box 机身(沿 X) + 两端圆柱滚筒 + 4 组支腿 + 顶面传送带面 + 侧面控制盒。
总长 ~8.0(X), 宽 ~0.6(Y), 高 ~0.85(Z, 含支腿)。拾取面 ~0.75 高。
    """
    objs = []
    L = 8.0
    body_y0 = 0.5  # 机身中心高度
    # 机身两侧长板
    objs.append(cube((L, 0.05, 0.18), (0, 0.28, body_y0), "metal_dark", "side_rail_R"))
    objs.append(cube((L, 0.05, 0.18), (0, -0.28, body_y0), "metal_dark", "side_rail_L"))
    # 横梁连接（4 段）
    for x in (-3.2, -1.0, 1.0, 3.2):
        objs.append(cube((0.06, 0.6, 0.08), (x, 0, body_y0 - 0.06), "aluminum", f"cross_{int(x)}"))
    # 滚筒(两端 + 中间一根)
    for x in (-3.7, 0, 3.7):
        objs.append(cylinder(0.18, 0.5, (x, 0, body_y0 + 0.05), "metal_mid", f"roller_{int(x)}", axis="Y"))
    # 顶面传送带
    objs.append(cube((L-0.2, 0.5, 0.02), (0, 0, body_y0 + 0.12), "dark_rubber", "belt_surface"))
    # 支腿 4 对
    leg_h = body_y0 - 0.16
    for x in (-3.5, -1.2, 1.2, 3.5):
        for sy in (-0.32, 0.32):
            objs.append(cube((0.06, 0.06, leg_h), (x, sy, leg_h/2), "metal_dark", f"leg_{int(x)}_{int(sy*100)}"))
        # 横拉条
        objs.append(cube((0.06, 0.55, 0.04), (x, 0, 0.16), "metal_mid", f"leg_tie_{int(x)}"))
    # 头尾控制盒
    objs.append(cube((0.18, 0.4, 0.20), (-3.9, 0, body_y0 - 0.08), "body_charcoal", "head_box"))
    objs.append(cube((0.18, 0.4, 0.20), (3.9, 0, body_y0 - 0.08), "body_charcoal", "tail_box"))
    # 控制盒上指示灯
    objs.append(cylinder(0.018, 0.02, (-3.9, 0.15, body_y0+0.04), "accent_orange", "head_led", axis="Z"))
    objs.append(cylinder(0.018, 0.02, (3.9, 0.15, body_y0+0.04), "accent_orange", "tail_led", axis="Z"))
    return objs


def build_transfer_conveyor() -> list[bpy.types.Object]:
    """净菜设备之间的短距离卫生转运输送段，长度 0.8m。"""
    objs = []
    length = 0.8
    body_y0 = 0.5
    objs.append(cube((length, 0.05, 0.24), (0, 0.28, body_y0 + 0.08), "metal_dark", "side_rail_R"))
    objs.append(cube((length, 0.05, 0.24), (0, -0.28, body_y0 + 0.08), "metal_dark", "side_rail_L"))
    objs.append(cube((0.06, 0.6, 0.08), (0, 0, body_y0 - 0.06), "aluminum", "cross_center"))
    roller_offset = length / 2 - 0.18
    for x in (-roller_offset, roller_offset):
        objs.append(cylinder(0.18, 0.5, (x, 0, body_y0 + 0.05), "metal_mid", f"roller_{x}", axis="Y"))
    belt_top = body_y0 + 0.22
    objs.append(cube((length - 0.04, 0.5, 0.045), (0, 0, belt_top - 0.0225), "food_belt", "food_belt"))
    objs.append(cube((length - 0.16, 0.44, 0.025), (0, 0, body_y0 + 0.02), "dark_rubber", "belt_return"))
    leg_h = body_y0 - 0.09
    for x in (-roller_offset, roller_offset):
        for sy in (-0.32, 0.32):
            objs.append(cube((0.06, 0.06, leg_h), (x, sy, leg_h / 2), "metal_dark", f"leg_{x}_{sy}"))
    return objs


def build_box_pack() -> list[bpy.types.Object]:
    """工位3末端：装箱定位台。

结构: 底座 + 4 角立柱 + 定位挡板 + 包装箱(置于台面上) + 控制小屏。
    """
    objs = []
    objs.append(cube((1.0, 0.9, 0.08), (0, 0, 0.04), "metal_dark", "deck"))
    objs.append(cube((0.9, 0.8, 0.04), (0, 0, 0.10), "metal_mid", "deck_top"))
    # 4 角立柱
    col_h = 0.6
    for sx, sy in ((-0.45, -0.35), (0.45, -0.35), (-0.45, 0.35), (0.45, 0.35)):
        objs.append(cube((0.05, 0.05, col_h), (sx, sy, 0.10 + col_h/2), "aluminum", f"col_{sx}_{sy}"))
    # 上挡框
    objs.append(cube((1.0, 0.04, 0.04), (0, 0.40, 0.10 + col_h + 0.02), "accent_orange", "frame_top"))
    objs.append(cube((1.0, 0.04, 0.04), (0, -0.40, 0.10 + col_h + 0.02), "accent_orange", "frame_bot"))
    objs.append(cube((0.04, 0.84, 0.04), (-0.50, 0, 0.10 + col_h + 0.02), "accent_orange", "frame_l"))
    objs.append(cube((0.04, 0.84, 0.04), (0.50, 0, 0.10 + col_h + 0.02), "accent_orange", "frame_r"))
    # 包装箱（成品）
    objs.append(cube((0.7, 0.55, 0.40), (0, 0, 0.10 + 0.20), "body_charcoal", "carton"))
    objs.append(cube((0.55, 0.40, 0.02), (0, 0, 0.10 + 0.40 + 0.01), "metal_mid", "carton_lid"))
    # 控制小屏
    objs.append(cube((0.18, 0.04, 0.14), (0.35, 0.50, 0.20), "body_charcoal", "hmi"))
    objs.append(cube((0.14, 0.02, 0.10), (0.35, 0.52, 0.22), "accent_orange", "hmi_screen"))
    return objs


BUILDERS = {
    "vision-module": build_vision_module_full,
    "feeder":       build_feeder,
    "gantry-arm":   build_gantry_arm,
    "conveyor":     build_conveyor,
    "transfer-conveyor": build_transfer_conveyor,
    "box-pack":     build_box_pack,
}


def export_glb(obj: bpy.types.Object, out_path: str, y_up: bool = True) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB",
                              export_yup=y_up, use_selection=True,
                              export_apply=True)
    print(f"[gen] wrote {out_path}  ({os.path.getsize(out_path)} bytes)")


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    if len(argv) < 2:
        print(__doc__)
        sys.exit(2)
    devices_arg = argv[0]
    if "--out" in argv:
        out_index = argv.index("--out")
        if out_index + 1 >= len(argv):
            print("[gen] --out requires a directory")
            sys.exit(2)
        out = argv[out_index + 1]
    else:
        out = argv[1]
    scale = 1.0
    if "--scale" in argv:
        scale = float(argv[argv.index("--scale") + 1])

    devices = [d.strip() for d in devices_arg.split(",") if d.strip()]
    unknown = [d for d in devices if d not in BUILDERS]
    if unknown:
        print(f"[gen] unknown device(s) {unknown} — available: {sorted(BUILDERS)}")
        sys.exit(2)

    # 一次 Blender 冷启动内生成全部(节省 ~6s/件)
    reset_scene()
    for i, device in enumerate(devices):
        objs = BUILDERS[device]()
        if scale != 1.0:
            for o in objs:
                o.scale *= scale
        merged = join_to_single(device, objs)
        path = os.path.join(out, f"{device}.glb")
        export_glb(merged, path)
        # 清掉合并对象以便下一件独立构造(不重置场景,保持灯光)
        bpy.data.objects.remove(merged, do_unlink=True)
    print(f"[gen] DONE ({len(devices)} device(s))")


if __name__ == "__main__":
    main()
