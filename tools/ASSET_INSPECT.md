# 资产检查记录 · hospital_1f.blend

> 生成方式：patched Blender 4.5.16 LTS 后台只读 inspect（`tools/inspect-hospital-blend.py`）
> 源文件由 Blender 5.0.2（502.45）写成，4.5 打开有「expect loss of data」警告，但几何/材质完整读取。

## 场景结构

| 项 | 值 |
|---|---|
| 对象总数 | 745（mesh 703 / camera 5 / light 36） |
| 单位 | METRIC，scale_length=1.0（1 单位 = 1 米） |
| 世界包围盒（Blender Z-up） | min(-1.15, -5.6, -3.379) / max(30.909, 5.6, 4.589) |
| 尺寸 | 约 32.06 × 11.2 × 7.97 米（一层医院走廊 + 病房） |
| 贴图 | 无外部图片贴图（仅内置 Render Result / Viewer Node）；27 个材质中 7 个用**程序化节点**（Noise/Voronoi/ColorRamp/Bump）生成纹理：M_WallUpper/M_WallLower/M_Floor/M_Ceiling/M_Metal/M_RustMetal/M_Concrete |
| 诊断 | glTF/GLB 不支持程序化节点，直接导出会退化为纯色 → 必须 Bake 成图片贴图（见下） |

## 命名前缀分类（mesh）

BED 140 · DZ 48 · FRONT 40 · STAIR 32 · DEBRIS 26 · CEIL 25 · PART 24(隔墙) · TROLLEY 24 · IV 22 · STREAK 22 · JAMB 20(门框) · LIGHT 20 · PLATE 20 · VENT 20 · PAPER 18 · VOID 16 · PEEL 14 · CORNER 12 · BLOOD 11 · PIPE 11 · GLASS 10 · HANDLE 10 · HEAD 10 · LINTEL 10 · SWITCH 10 · NURSE 7 · WHEELCHAIR 7 · BENCH 6 · DOOR 3 · FLOOR_slab 等

## 结构件关键字（用于决定是否隐藏）

- `JAMB_` ×20：门框
- `PART_` ×24：隔墙（与游戏 `w.walls` 逻辑墙语义重叠）
- `CEIL_` ×26 + `LINTEL_` ×10：天花板/过梁
- `FLOOR_slab`、`DZ_floor`：地板
- `DOOR_` / `STAIR_door*` / `WEST_door*`：门/楼梯门

## 导出策略（关键决策）

游戏里 `w.walls` 是碰撞/遮挡/手电的唯一真源，程序化墙按它生成。若 GLB 自带墙/天花/地板与逻辑墙不对齐会导致穿墙或隔墙辨认。

**因此导出时可以二选一：**
1. 全量导出（保留墙地天花），运行时按名字前缀隐藏结构件 → GLB 提供家具/灯光氛围，墙由程序化接管（推荐，与计划 §3 一致）
2. 导出时直接剔除结构件 → GLB 更小

采用方案 1：导出全部 mesh，脚本在导出前给结构件统一加 `WALL_` 前缀便于识别。

**最终实现更新（v1.4）**：GLB 中的结构件不再隐藏——墙/门框/天花/地板/家具全部作为画面主体完整显示，并统一 `DoubleSide` 双面渲染（外部模型从走廊内部看背面会被剔除成空洞）。`WALL_` 前缀保留用于资产识别。与之重叠的程序化方块墙/天花在 GLB 到位后隐藏（仅留地板兜底、科室牌等定位标志）。碰撞/遮挡/镜头避障/手电判定始终走逻辑真源 `w.walls`，与视觉网格完全解耦。

## 程序化材质烘焙（v1.5，关键修复）

**问题**：Blender 场景的米白上墙 + 深绿墙裙、地砖裂纹、金属污渍等纹理全部由程序化节点实时生成，没有一张图片贴图。glTF/GLB 格式不支持 Noise/Voronoi/ColorRamp 节点，直接导出时每个材质只能取一个近似纯色——这就是游戏里"场景还是方块/纯色"的真正原因（不是组员漏给贴图资产）。

**修复**：`tools/export-hospital-glb.py` 在导出前用 Cycles 把 7 个程序化材质的 Base Color 烘焙成 1024² JPEG 贴图（Bake DIFFUSE COLOR），接到各材质 Base Color 后内嵌进 GLB。验证：新 GLB `images=7 / textures=7 / texturedMats=7`（旧版全为 0），体积 1.4MB → 1.8MB。

**相机朝向**：医院走廊沿 X 轴延伸，默认相机朝向已设为走廊纵深（P1 yaw=+π/2、P2 yaw=-π/2），否则 yaw=0 会正对横向侧墙只看到近处墙面色块。

复现命令：
```bash
.workbuddy/blender-patched/Blender.app/Contents/MacOS/Blender \
  --background --python tools/export-hospital-glb.py
```

## 对齐

游戏逻辑坐标：x∈[0,2400]（1 单位=1cm），render 里 `X=x/100`，走廊 Z∈[-4.9,4.9]。
场景 GLB 尺寸 32×11 米（=3200×1100cm），需归一到 X∈[0,2400]、Z∈[-4.9,4.9]。导出脚本内做等比缩放 + 平移，或在 JS 侧用 Box3 归一化。采用 JS 侧 Box3 归一化（锚点 12,0,0，足迹 24×10），更稳。
