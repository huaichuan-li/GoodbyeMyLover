"""把 hospital_1f.blend 导出为 hospital_1f.glb，供 Three.js GLTFLoader 加载。
- 剔除相机/灯光（场景照明由渲染器控制）
- 给结构件（隔墙/门框/天花/地板/过梁）统一加 WALL_ 前缀，便于运行时按前缀隐藏，
  避免与游戏逻辑墙 w.walls 冲突导致穿墙/隔墙辨认
- 家具/道具/装饰保留原名
- 贴图内嵌进 GLB（本场景无外部贴图，GLB 会很小）
零第三方依赖，只用 bpy + Blender 内置 glTF exporter。"""
import bpy
import os

SRC = "/Users/lihuaichuan/Documents/projects/超级交子孵化器/小马国墨鱼工作室/assets/hospital_1f.blend"
OUT = "/Users/lihuaichuan/Documents/projects/超级交子孵化器/小马国墨鱼工作室/assets/publics/model/hospital_1f.glb"

# 结构件前缀：这些与逻辑墙语义重叠，运行时隐藏
STRUCT_PREFIXES = (
    "JAMB_", "PART_", "CEIL", "LINTEL_", "FLOOR_", "DZ_floor",
    "DOOR_", "STAIR_door", "WEST_door", "VOID_", "CORNER_",
)

bpy.ops.wm.open_mainfile(filepath=SRC)

# 删除相机与灯光（导出时不带）
for o in list(bpy.data.objects):
    if o.type in {"CAMERA", "LIGHT"}:
        bpy.data.objects.remove(o, do_unlink=True)

# 结构件统一加 WALL_ 前缀（幂等：已有则不重复加）
renamed = 0
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    if o.name.startswith("WALL_"):
        continue
    if o.name.startswith(STRUCT_PREFIXES):
        o.name = "WALL_" + o.name
        renamed += 1
print("STRUCT_RENAMED", renamed)

# 全选 mesh，导出
bpy.ops.object.select_all(action="DESELECT")
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0] if meshes else None

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_cameras=False,
    export_lights=False,
    export_image_format="AUTO",
    export_texcoords=True,
    export_normals=True,
    export_materials="EXPORT",
)
print("EXPORTED", OUT, os.path.getsize(OUT), "bytes", "meshes", len(meshes))
