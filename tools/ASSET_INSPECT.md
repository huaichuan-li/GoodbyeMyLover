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
| 贴图 | 无外部贴图（仅内置 Render Result / Viewer Node）；材质为参数化纯色 28 种 |

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

采用方案 1：导出全部 mesh，运行时用 `WALL_/JAMB_/PART_/CEIL_/LINTEL_/FLOOR_` 前缀判定隐藏。由于源命名非统一 `WALL_`，脚本会在导出前给结构件统一加 `WALL_` 前缀，便于 JS 侧识别。

## 对齐

游戏逻辑坐标：x∈[0,2400]（1 单位=1cm），render 里 `X=x/100`，走廊 Z∈[-4.9,4.9]。
场景 GLB 尺寸 32×11 米（=3200×1100cm），需归一到 X∈[0,2400]、Z∈[-4.9,4.9]。导出脚本内做等比缩放 + 平移，或在 JS 侧用 Box3 归一化。采用 JS 侧 Box3 归一化（锚点 12,0,0，足迹 24×10），更稳。
