"""只读检查 hospital_1f.blend 的结构：单位/轴向/包围盒/材质/贴图/对象分类。
用 patched Blender 后台运行，不修改 .blend，不写任何文件（结果由 stdout 捕获）。"""
import bpy
from mathutils import Vector

sc = bpy.context.scene
print("=== UNIT ===")
print("unit.system =", sc.unit_settings.system, " scale_length =", sc.unit_settings.scale_length)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
cameras = [o for o in bpy.data.objects if o.type == "CAMERA"]
lights = [o for o in bpy.data.objects if o.type == "LIGHT"]
print("=== COUNTS ===")
print("objects =", len(bpy.data.objects), " meshes =", len(meshes),
      " cameras =", len(cameras), " lights =", len(lights))

print("=== SCENE BBOX (world, Blender coords X/Y/Z where Z is up) ===")
allpts = []
for o in meshes:
    for c in o.bound_box:
        allpts.append(o.matrix_world @ Vector(c))
if allpts:
    lo = tuple(round(min(p[i] for p in allpts), 3) for i in range(3))
    hi = tuple(round(max(p[i] for p in allpts), 3) for i in range(3))
    print("min =", lo, " max =", hi)
    print("size =", tuple(round(hi[i] - lo[i], 3) for i in range(3)))

print("=== IMAGES ===")
for im in bpy.data.images:
    try:
        size = tuple(im.size)
    except Exception:
        size = None
    print("IMG", repr(im.name), "size", size, "packed", bool(im.packed_file), "filepath", repr(im.filepath))

print("=== MATERIALS ===")
print([m.name for m in bpy.data.materials][:60])

# 对象名前缀分类：识别墙/门框/天花板/地板/家具
prefixes = {}
for o in meshes:
    key = o.name.split("_")[0] if "_" in o.name else o.name[:8]
    prefixes[key] = prefixes.get(key, 0) + 1
print("=== NAME PREFIXES (top 40) ===")
for k, v in sorted(prefixes.items(), key=lambda kv: -kv[1])[:40]:
    print("PREFIX", repr(k), v)

# 疑似结构件：按名字关键字归类
kw = {"WALL": [], "JAMB": [], "DOOR": [], "CEIL": [], "FLOOR": [], "BASE": []}
for o in meshes:
    n = o.name.upper()
    for k in kw:
        if k in n:
            kw[k].append(o.name)
print("=== STRUCTURAL KEYWORDS ===")
for k, v in kw.items():
    print("KW", k, len(v), v[:12])

print("=== DONE ===")
