# 末日爱人 LAST LOVER ON EARTH · 3D 网页游戏 demo

抽签主题：**恐怖 / 即时动作 / 马**　｜　人马 / 木乃伊 · 分屏感知错位　｜　3D 医院探索 + 双人协作相认
末日丧尸爆发，主角感染变成人马，爱人感染变成木乃伊。两人仍各自把活物看成对方的样子。主线不要求猜外观：双方分头寻找一段值班录音和一页病历，汇合后共同修复中继台，再在隔离闸门两侧同步确认。

---

## 运行（三种方式，零依赖）

| 方式 | 操作 |
|---|---|
| 直接双击 | 打开 `index.html`（`file://` 可跑） |
| 本地服务（推荐自检） | `node tools/serve.mjs` → `http://127.0.0.1:8080/` |
| 断网 / 无 Node 路演 | 双击 `standalone.html`（css/js 与概念图全部内联，单文件断网可跑） |

使用原生 WebGL 与程序化几何，不需要 `npm install`，没有构建链、没有 CDN 请求。游戏内画面全部程序化绘制，**仅标题 / 剧情 / 结局卡使用本地 AI 概念图**（`clean/` 去水印版，压缩为 JPEG，含图卡带「概念图由 AI 生成」页脚）。Node 仅用于可选的本地服务、图片压缩与打包脚本。

改过 css / js / 图片后必须按序重跑两步（顺序不能反）：

```
node tools/optimize-images.mjs       # sips 压缩 clean/ → assets/optimized/*.jpg
node tools/build-standalone.mjs      # 内联 css/js + 图片 base64 → standalone.html
```

`build-standalone.mjs` 会打印内联数量与产物体积；交付态产物中不应残留任何 `assets/` 相对路径（`--skip-images` 仅供 http 调试）。

## 概念图与 AI 标识

- 素材：`assets/horror-characters/` 为 6 张带平台「AI生成 / WORKBUDDY」标识的原图，`clean/` 为本地去水印副本；网页实际只引用压缩后的 `assets/optimized/*.jpg`。
- 分配：标题背景 `06_split_perception`、标题立绘 `01_centaur_trueform`、剧情卡 `02_mummy_beloved`、相认闪回 `05_puddle_reflection_truth`；6 类结局卡各配一张，抉择卡不配图。
- 游戏内角色剪影**不使用图片**，仍是程序化绘制；分屏感知机制与水坑倒影完全不受影响。
- 每张含图卡都有「概念图由 AI 生成」页脚。**带平台标识的原图保留未动**；若日后公开发布或正式答辩，应改用带标识原图或补齐显式 AI 标识与元数据。

## 键位

| | 键 |
|---|---|
| A · 人马 | `W A S D` 移动 · `左 Shift` 冲刺 · `E` 调查/修复 · `F` 闸门确认 |
| B · 木乃伊 | `方向键` 移动 · `右 Shift` 冲刺 · `K` 调查/修复 · `J` 闸门确认 |
| 单机 | `Tab` 接管切换 · `1 / 2 / 3` 结局抉择 |
| 系统 | `M` 静音 · `P` 展演亮度 · `Esc` 回到标题 |

标题页按任意键 → 剧情/键位页 → 按 `1` 单机（AI 同伴）或 `2` 双人同屏。相认线索与两名玩家的操作状态不会由开发快捷键直接揭示。

## 一关流程（3–5 分钟）

1. A、B 分头探索医院，分别调查值班录音与病历残页。两条证据提供互补信息：约定的节拍，以及节拍为何不能单独证明身份。
2. 两人同时抵达急救中继台并协作修复。中继台不会宣布谁是真身，只确认两份记录吻合。
3. 两人到隔离闸门两侧，同时按下确认键。相认来自共享记忆与共同操作，不靠序号、外形或倒影揭底。
4. 已相认后共同前往发射通道，找到血清并决定是否同行。

## 键位

| 玩家 | 操作 |
|---|---|
| A · 人马 | `W A S D` 移动 · 左 Shift 冲刺 · `E` 调查/修复 · `F` 闸门确认 |
| B · 木乃伊 | 方向键移动 · 右 Shift 冲刺 · `K` 调查/修复 · `J` 闸门确认 |
| 系统 | `Tab` 单机切换角色 · `1 / 2 / 3` 结局选择 · `M` 静音 · `P` 展演亮度 · `Esc` 标题 |

## 目录

```
index.html          单页入口（按序引入经典 script，不用 ESM，兼容 file://）
css/style.css       暗色基底 / 分屏 HUD / 字幕 / QTE 节奏条 / 结算卡 / 概念图卡片层
data/config.js      全部数值、键位常量、暗号谱、时间轴
data/script.js      剧情、结局文案、概念图路径与卡片配图映射
js/core.js          命名空间 / 事件总线 / 状态机 / 固定步长循环 / 总控
js/world.js         实体工厂 / 唯一 world / perception.project 感知投影
js/input.js         键位表 / 带时间戳的输入缓冲环
js/render.js        原生 WebGL 透视场景 / 双视角
js/audio.js         Web Audio 合成器 / 手势解锁 / 突然静音硬切
js/systems.js       移动与不能后退 / 感染数值 / 字幕 / 恐怖调度 / AI 同伴
js/recognition.js   相认状态与结果管理
js/levels.js        三区关卡布局 / 时间轴保底推进
js/ui.js            HUD / 字幕 / QTE 节奏条 / 标题·剧情·抉择·结局卡（含概念图）
js/boot.js          启动入口（必须最后加载）
tools/serve.mjs     零依赖本地静态服务
tools/optimize-images.mjs   sips 压缩概念图 → assets/optimized/
tools/build-standalone.mjs  单文件打包（css/js + 图片 base64 内联）
assets/horror-characters/   6 张 AI 概念原图（带标识）+ clean/ 去水印副本
assets/optimized/   6 张压缩 JPEG（网页实际引用，生成物）
设计文档.md         完整创意发散、四方案对比、机制与数值、验收与风险
standalone.html     内联单文件（生成物，含图片 base64）
```

> 实现说明：为控制 `file://` 下的 script 数量，把同层细碎模块做了合并（`core.js` 合并 loop+state-machine，`render.js` 合并剪影+光照，`systems.js` 合并 movement/infection/subtitles/horror/ai）。职责边界与计划一致，没有引入任何依赖。

## 当前实现范围

浏览器使用原生 WebGL 与程序化几何，无外部模型/CDN依赖。现阶段为 3D 可玩原型，模型、灯光、碰撞与关卡表现仍需继续打磨。双人模式是主要体验；单机接管模式可用于演示，AI 尚未代替另一名玩家完成证据交互。

## 版本与发布边界

- 当前基线 tag：`v1.1-art`（改名《末日爱人》+ 概念图接入）；上一版 `v1.0-demo` 保留可回退：`git checkout v1.0-demo`。二者均为本地 commit，未推远端。
- **本轮只做本地预览自检。推送 GitHub 与发布公网链接均需另行确认，当前不执行任何上线动作。**
