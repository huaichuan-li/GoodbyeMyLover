"""把 hospital_1f.blend 导出为带真实贴图的 hospital_1f.glb，供 Three.js GLTFLoader 加载。

关键：源场景用程序化材质（Noise/Voronoi/ColorRamp），glTF 不支持 -> 直接导出只有纯色。
本脚本先把 7 个程序化材质烘焙成 JPEG 贴图并接到 Base Color，再导出，贴图内嵌进 GLB。

流程：
1. 打开 .blend，切 Cycles
2. 烘焙 7 个程序化材质到 /tmp/hospital_bake/*.jpg
3. 把烘焙贴图接到各材质 Base Color（UV 采样）
4. 删除相机/灯光
5. 结构件统一加 WALL_ 前缀（运行时完整显示，双面渲染；碰撞仍走 w.walls）
6. 导出 GLB，贴图内嵌
零第三方依赖，只用 bpy + Blender 内置 glTF exporter。"""
import bpy
import os

SRC = "/Users/lihuaichuan/Documents/projects/超级交子孵化器/小马国墨鱼工作室/assets/hospital_1f.blend"
OUT = "/Users/lihuaichuan/Documents/projects/超级交子孵化器/小马国墨鱼工作室/assets/publics/model/hospital_1f.glb"
BAKE_DIR = "/tmp/hospital_bake"

# 使用程序化节点的材质（其余为纯色材质，无需烘焙）
PROC_MATS = [
    'M_WallUpper', 'M_WallLower', 'M_Floor', 'M_Ceiling',
    'M_Metal', 'M_RustMetal', 'M_Concrete',
]
TEX_SIZE = 1024

# 结构件前缀：这些与逻辑墙语义重叠，统一加 WALL_ 前缀便于资产识别（运行时完整显示）
STRUCT_PREFIXES = (
    "JAMB_", "PART_", "CEIL", "LINTEL_", "FLOOR_", "DZ_floor",
    "DOOR_", "STAIR_door", "WEST_door", "VOID_", "CORNER_",
)

bpy.ops.wm.open_mainfile(filepath=SRC)

# ---------- 1) 烘焙程序化材质 ----------
os.makedirs(BAKE_DIR, exist_ok=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.render.image_settings.file_format = 'JPEG'
scene.render.image_settings.quality = 88

baked = {}
print("=== BAKE START ===")
for matname in PROC_MATS:
    mat = bpy.data.materials.get(matname)
    if not mat or not mat.use_nodes:
        print("SKIP", matname)
        continue
    nt = mat.node_tree
    # 临时 plane，UV 铺满
    bpy.ops.mesh.primitive_plane_add(size=2.0, location=(0, 0, 0))
    plane = bpy.context.object
    plane.name = "BAKE_TEMP_" + matname
    if not plane.data.uv_layers:
        plane.data.uv_layers.new()
    plane.data.materials.clear()
    plane.data.materials.append(mat)
    # 目标 image
    img = bpy.data.images.new("BAKE_" + matname, TEX_SIZE, TEX_SIZE)
    img.file_format = 'JPEG'
    img.filepath_raw = os.path.join(BAKE_DIR, matname + ".jpg")
    # bake target 节点
    target = nt.nodes.new('ShaderNodeTexImage')
    target.name = "BAKE_TARGET_TEMP"
    target.image = img
    for n in nt.nodes:
        n.select = False
    target.select = True
    nt.nodes.active = target
    # bake
    bpy.ops.object.select_all(action='DESELECT')
    plane.select_set(True)
    bpy.context.view_layer.objects.active = plane
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'})
    img.save()
    baked[matname] = img
    print("BAKED", matname)
    # 清理临时节点与 plane
    nt.nodes.remove(target)
    bpy.data.objects.remove(plane, do_unlink=True)

# ---------- 2) 贴图接到 Base Color ----------
for matname, img in baked.items():
    mat = bpy.data.materials[matname]
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
    if not bsdf:
        continue
    bc = bsdf.inputs.get('Base Color')
    for l in list(bc.links):
        nt.links.remove(l)
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.name = "BAKED_COLOR"
    tex.image = img
    uvmap = nt.nodes.new('ShaderNodeUVMap')
    uvmap.uv_map = "UV贴图"
    nt.links.new(uvmap.outputs['UV'], tex.inputs['Vector'])
    nt.links.new(tex.outputs['Color'], bc)
print("=== BAKE SUMMARY ===", len(baked), "/", len(PROC_MATS), "materials baked")

# ---------- 3) 删除相机与灯光 ----------
for o in list(bpy.data.objects):
    if o.type in {"CAMERA", "LIGHT"}:
        bpy.data.objects.remove(o, do_unlink=True)

# ---------- 4) 结构件加前缀 ----------
renamed = 0
for o in bpy.data.objects:
    if o.type != "MESH" or o.name.startswith("WALL_"):
        continue
    if o.name.startswith(STRUCT_PREFIXES):
        o.name = "WALL_" + o.name
        renamed += 1
print("STRUCT_RENAMED", renamed)

# ---------- 5) 导出 GLB（贴图内嵌）----------
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
print("EXPORTED", OUT, os.path.getsize(OUT), "bytes", "meshes", len(meshes), "baked_textures", len(baked))
