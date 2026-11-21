import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/* Bundled glTF renderer: single-floor 3D hospital + animated mummy characters.
   Logical gameplay stays x/y/floor; w.walls remains the single source for collision/occlusion. */
(function () {
  var G = window.G;
  if (!G || !G.utils) return;
  var canvas = G.utils.el('game');
  var renderer, scene, cameras = {}, flashlights = {}, floors = {}, entities = {}, builtWorld = null;
  var hemisphereLight = null, keyLight = null, corridorLight = null;
  // 医院 GLB 走廊沿 X 轴延伸；默认朝向走廊纵深（yaw=PI/2 朝 +X，P2 朝 -X），
  // 否则 yaw=0 会正对横向侧墙，只看到近处墙面色块。
  var views = {
    p1: { mode: 'third', yaw: Math.PI / 2, pitch: 0.18, distance: 3.2, dragging: false, lastX: 0, lastY: 0 },
    p2: { mode: 'third', yaw: -Math.PI / 2, pitch: 0.18, distance: 3.2, dragging: false, lastX: 0, lastY: 0 }
  };
  var sources = {};
  var sceneGLB = null;           // hospital_1f.glb 的场景实例
  var mummySource = null;        // mummy_animated.glb 的场景源（共享 geo/mat/texture）
  var mummyClips = {};           // Idle / Walk / Limp_Right
  var clock = new THREE.Clock();
  var flashEl;
  var assetDefs = {
    // 道具类（已用）
    bed: { file: 'prop_hospital_bed.glb', max: 2.1 },
    trolley: { file: 'prop_hospital_trolley.glb', max: 1.0 },
    phone: { file: 'prop_phone_nokia.glb', max: 0.18 },
    food: { file: 'prop_food_can.glb', max: 0.16 },
    battery: { file: 'prop_battery_aa.glb', max: 0.15 },
    ivCrutch: { file: 'prop_iv_drip_crutch.glb', max: 1.4 },
    flashlight: { file: 'prop_flashlight_horror.glb', max: 0.22 }
  };
  var SCENE_GLB = 'assets/publics/model/hospital_1f.glb';
  var MUMMY_GLB = 'assets/animated/mummy_animated.glb';
  // 人物高度：按需求在上一版 1.6m 基础上再减半 → 0.8m。
  // 第三人称下人物在画面里只占约原来一半，走廊与场景更完整可见。
  var MUMMY_HEIGHT = 0.8;
  var mats = {};
  function mat(name, color, roughness) {
    if (!mats[name]) mats[name] = new THREE.MeshStandardMaterial({ color: color, roughness: roughness || 0.85 });
    return mats[name];
  }
  function box(parent, name, pos, size, material) {
    var mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
    mesh.name = name;
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  // 木乃伊角色：用 mummy_animated.glb（SkeletonUtils.clone 共享贴图/骨骼），
  // trait 用轻量网格挂到骨骼 child，随动画摆动。limpGait 用 Limp_Right 动画体现。
  // 若 GLB 尚未加载完成（或 file:// 下 ESM 未生效），回退到程序化 box 木乃伊。
  var MUMMY_BODY = 0xc8b89a, MUMMY_HEAD = 0xbfae8f;
  // 角色外观完全交给 mummy_animated.glb 本体。早期版本把 trait（深色外套/徽章/
  // 腕带等）做成 BoxGeometry 方块挂到骨骼上，实机在角色胸前呈现为一个明显的
  // 灰色方块壳（用户反馈"人物身上还有一个方块"），已全部移除。
  // trait 仍保留在 userData.traits 供动画（limpGait）与辨认逻辑/HUD 文字使用，
  // 但不再生成任何几何挂件。
  function buildMummyBody(group, id, traits) {
    if (mummySource) {
      var avatar = cloneSkinned(mummySource);
      avatar.name = 'mummy-avatar';
      group.add(avatar);
      // 不再挂 trait 方块：角色外观就是 GLB 本体，避免身上出现方块壳
      var mixer = new THREE.AnimationMixer(avatar);
      var actions = {};
      Object.keys(mummyClips).forEach(function (name) {
        var action = mixer.clipAction(mummyClips[name]);
        action.loop = THREE.LoopRepeat;
        actions[name] = action;
      });
      group.userData.mixer = mixer;
      group.userData.actions = actions;
      group.userData.activeClip = null;
      group.userData.traits = (traits || []).slice();
      // 统一站立动作起手；每帧由 tickAvatars 根据 state 切换。
      if (actions['Idle']) actions['Idle'].play();
      return;
    }
    // ---- 程序化回退（GLB 未就绪）----
    box(group, 'body', [0, 0.7, 0], [0.62, 1.25, 0.58], mat('mummy-body-' + id, MUMMY_BODY));
    box(group, 'head', [0, 1.55, 0], [0.52, 0.52, 0.52], mat('mummy-head-' + id, MUMMY_HEAD));
    box(group, 'leg-l', [-0.15, 0.25, 0], [0.18, 0.55, 0.18], mat('mummy-leg-' + id, MUMMY_BODY));
    box(group, 'leg-r', [0.15, 0.25, 0], [0.18, 0.55, 0.18], mat('mummy-leg-r-' + id, MUMMY_BODY));
    box(group, 'wrap-1', [0, 0.95, 0.31], [0.64, 0.05, 0.02], mat('wrap-line', 0x9c8c6e));
    box(group, 'wrap-2', [0, 0.55, 0.31], [0.64, 0.05, 0.02], mat('wrap-line', 0x9c8c6e));
    // 程序化回退同样不生成 trait 方块挂件（避免角色身上出现方块壳）。
    // limpGait 用腿长差表现，其余外貌线索仅通过 HUD 文字呈现。
    if (traits.indexOf('limpGait') >= 0) group.getObjectByName('leg-r') && (group.getObjectByName('leg-r').position.y = 0.2);
  }
  function assetInstance(id) {
    var source = sources[id];
    if (!source) return null;
    var obj = source.clone(true);
    obj.traverse(function (child) { if (child.isMesh) { child.castShadow = false; child.receiveShadow = true; } });
    return obj;
  }
  var loadPending = 0;
  function loadDone() {
    loadPending = Math.max(0, loadPending - 1);
    if (loadPending === 0) window.dispatchEvent(new Event('hospital-models-ready'));
  }
  function loadAssets() {
    var loader = new GLTFLoader();
    // 1) 道具类
    Object.keys(assetDefs).forEach(function (id) {
      var def = assetDefs[id];
      loadPending++;
      loader.load('assets/publics/model/sketchfab/' + def.file, function (gltf) {
        var model = gltf.scene;
        model.updateMatrixWorld(true);
        var bounds = new THREE.Box3().setFromObject(model);
        var size = bounds.getSize(new THREE.Vector3());
        var center = bounds.getCenter(new THREE.Vector3());
        var maxDim = Math.max(size.x, size.y, size.z) || 1;
        var scale = def.max / maxDim;
        var normalized = new THREE.Group();
        var anchor = new THREE.Group();
        anchor.add(model);
        anchor.scale.setScalar(scale);
        anchor.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
        normalized.add(anchor);
        normalized.userData.sourceBounds = { x: size.x, y: size.y, z: size.z };
        sources[id] = normalized;
        if (builtWorld) buildWorld(builtWorld);
        loadDone();
      }, undefined, function (err) {
        console.warn('[GLB] could not load ' + def.file + '; using procedural fallback.', err);
        loadDone();
      });
    });
    // 2) 医院场景 GLB：完整显示最新建模（墙 / 门框 / 天花 / 地板 / 家具）
    loadPending++;
    loader.load(SCENE_GLB, function (gltf) {
      var model = gltf.scene;
      model.traverse(function (o) {
        if (o.isMesh) {
          // 外部 GLB 的墙/门框从走廊内部观察常是背面，需双面渲染否则被剔除成空洞。
          if (o.material) { o.material.side = THREE.DoubleSide; o.material.needsUpdate = true; }
          // 碰撞 / 遮挡 / 手电判定仍由逻辑真源 w.walls 决定，与视觉网格解耦。
          o.castShadow = false; o.receiveShadow = true;
          // 第三人称相机避障需要"看见"实体墙：结构大面（WALL_ 前缀：墙/地板/天花/隔墙）
          // 保留 raycast，否则相机会穿进精细模型出现黑色遮挡板。其余 600+ 家具/装饰禁用
          // raycast 以控制性能（它们不参与相机射线，遮挡仍由 w.walls 逻辑判定）。
          if (!/^WALL_/.test(o.name)) o.raycast = function () {};
        }
      });
      // 归一化到逻辑足迹 X∈[0,24]、Z∈[-4.9,4.9]、底面 y=0，锚点 (12,0,0)
      model.updateMatrixWorld(true);
      var bounds = new THREE.Box3().setFromObject(model);
      var size = bounds.getSize(new THREE.Vector3());
      var center = bounds.getCenter(new THREE.Vector3());
      var sx = 24 / (size.x || 1), sz = 10 / (size.z || 1);
      var s = Math.min(sx, sz);
      // 关键：不能用整体 bounds.min.y 对齐地面——本模型含地下室/地基几何（局部 y≈-3.38），
      // 会把整栋楼抬高 2.5m，导致相机走在地板下方看不到墙。改用地板 slab 的顶面（可行走面）
      // 作为 y=0 基准：WALL_FLOOR_slab 顶面局部 y≈0，对齐后墙/家具正好落在游戏逻辑地面。
      var floorTopLocalY = bounds.min.y; // 兜底：找不到地板时退回整体底
      var floorSlab = model.getObjectByName('WALL_FLOOR_slab');
      if (!floorSlab) {
        // 退而求其次：按名字模糊找任何 FLOOR 结构件
        model.traverse(function (o) { if (!floorSlab && o.isMesh && /FLOOR/i.test(o.name)) floorSlab = o; });
      }
      if (floorSlab) {
        var fb = new THREE.Box3().setFromObject(floorSlab);
        floorTopLocalY = fb.max.y; // 地板 slab 顶面 = 可行走的地面高度
      }
      var normalized = new THREE.Group();
      var anchor = new THREE.Group();
      anchor.add(model);
      anchor.scale.setScalar(s);
      anchor.position.set(12 - center.x * s, -floorTopLocalY * s, 0 - center.z * s);
      normalized.add(anchor);
      normalized.userData.sourceBounds = { x: size.x, y: size.y, z: size.z };
      normalized.userData.floorTopLocalY = floorTopLocalY;
      sceneGLB = normalized;
      if (builtWorld) buildWorld(builtWorld);
      loadDone();
    }, undefined, function (err) {
      console.warn('[GLB] hospital scene failed; using procedural room.', err);
      loadDone();
    });
    // 3) 木乃伊动画角色 GLB（共享 geo/mat/texture，仅 clone 骨骼层级）
    loadPending++;
    loader.load(MUMMY_GLB, function (gltf) {
      var model = gltf.scene;
      model.updateMatrixWorld(true);
      var bounds = new THREE.Box3().setFromObject(model);
      var size = bounds.getSize(new THREE.Vector3());
      // 归一化到 MUMMY_HEIGHT(≈门高 2/3)，而不是旧的 1.8m
      var scale = MUMMY_HEIGHT / (size.y || 1);
      model.scale.setScalar(scale);
      model.position.set(0, -bounds.min.y * scale, 0);
      // 归一化贴图：避免 mipmap 生成开销，保持共享
      model.traverse(function (o) {
        if (o.isMesh) {
          o.material = o.material; // 共享，禁止 clone
          o.castShadow = true; o.receiveShadow = true;
          var maps = ['map','normalMap','metalnessMap','roughnessMap'];
          maps.forEach(function (k) { if (o.material && o.material[k]) o.material[k].generateMipmaps = false; });
        }
      });
      mummySource = model;
      (gltf.animations || []).forEach(function (c) { mummyClips[c.name] = c; });
      // GLB 就绪后重建世界，让已有实体从 box 占位升级为动画模型
      if (builtWorld) buildWorld(builtWorld);
      loadDone();
    }, undefined, function (err) {
      console.warn('[GLB] animated mummy failed; using procedural mummy.', err);
      loadDone();
    });
  }

  /* ========== 楼层房间构建 ========== */
  function floorRoom(w, f) {
    var base = 0; // 单层：所有几何落在 y=0 基面
    var group = new THREE.Group();
    group.name = 'hospital-floor-' + f;
    floors[f] = group;
    scene.add(group);

    if (sceneGLB) {
      // 新场景 GLB 已到位：它是唯一视觉来源，完整渲染今天提供的最新建模。
      // 严格按要求——不再叠加任何旧程序化残留物：地板/边界墙/天花装饰条/顶灯/
      // 科室牌/走廊牌/灭火器/疏散牌/警示线，以及病床/床头桌/IV 架/推车/
      // 护士站桌/椅子，一律不生成。画面里只出现新场景自带的墙、门、地板和家具。
      // 碰撞 / 遮挡 / 相机避障 / 手电判定仍由逻辑真源 w.walls 决定（与视觉网格
      // 解耦），GLB 的 WALL_ 结构件保留原生 raycast 供第三人称相机避障。
      group.add(sceneGLB);
      return group;
    }

    // ---- 兜底：仅在 GLB 未加载完成 / 加载失败（file:// 或断网）时使用的旧程序化场景 ----
    // 保证单文件/离线打开时仍有可玩画面；HTTP 正常加载新场景时这段不会执行。
    box(group, 'floor', [12, base - 0.24, 0], [26, 0.4, 11], mat('floor', 0x46545c));
    var wall = mat('wall', 0x27323a);
    var trim = mat('trim', 0x59656c);
    // 边界墙
    box(group, 'north-wall', [12, base + 2.5, -5.45], [26, 5, 0.3], wall);
    box(group, 'south-wall', [12, base + 2.5, 5.45], [26, 5, 0.3], wall);
    box(group, 'west-wall', [-1, base + 2.5, 0], [0.3, 5, 11], wall);
    box(group, 'east-wall', [25, base + 2.5, 0], [0.3, 5, 11], wall);
    // 天花板装饰条 + 走廊顶灯
    for (var i = 0; i < 12; i++) box(group, 'ceiling-trim-' + i, [1 + i * 2.05, base + 4.8, 0], [0.08, 0.08, 10.5], trim);
    var lightMat = mat('light', 0xc8d4d8, 0.1);
    for (var i2 = 0; i2 < 6; i2++) box(group, 'ceiling-light-' + i2, [4 + i2 * 3.4, base + 4.9, 0], [1.6, 0.08, 0.4], lightMat);
    // 逻辑墙（唯一碰撞/遮挡真源）——统一 proc-wall 前缀，GLB 到位时可隐藏其可视网格
    w.walls.forEach(function (b, i) {
      if (b.floor !== f) return;
      box(group, 'proc-wall-' + i + '-' + (b.kind || 'partition'), [(b.x + b.w / 2) / 100, base + 1.75, (b.y + b.h / 2) / 100 - 4.9], [b.w / 100, 3.5, b.h / 100], trim);
    });
    // 科室标识牌（单层 4 个科室）
    G.Level.departments[f].forEach(function (_name, i) {
      box(group, 'department-sign', [i ? 18.8 : 4.2, base + 3.8, -4.9], [2.25, 0.48, 0.08], mat('sign', 0x58696b));
    });
    // 走廊标识 / 灭火器 / 疏散指示牌 / 警示线
    box(group, 'corridor-sign', [6, base + 2.8, -5.3], [1.4, 0.25, 0.05], mat('corridor-sign', 0x5a6770));
    box(group, 'corridor-sign2', [18, base + 2.8, -5.3], [1.4, 0.25, 0.05], mat('corridor-sign2', 0x5a6770));
    box(group, 'fire-extinguisher-1', [1, base + 0.9, 3], [0.2, 0.6, 0.2], mat('extinguisher', 0xb4453c));
    box(group, 'fire-extinguisher-2', [23, base + 0.9, -3], [0.2, 0.6, 0.2], mat('extinguisher2', 0xb4453c));
    box(group, 'exit-sign-1', [3, base + 3.0, 5.3], [0.6, 0.2, 0.02], mat('exit', 0x4a6a58));
    box(group, 'exit-sign-2', [22, base + 3.0, -5.3], [0.6, 0.2, 0.02], mat('exit2', 0x4a6a58));
    var warnMat = mat('warning', 0xc8a15a, 0.6);
    box(group, 'warn-line-1', [11.9, base - 0.21, 3.5], [3.5, 0.01, 0.08], warnMat);
    box(group, 'warn-line-2', [11.9, base - 0.21, -3.5], [3.5, 0.01, 0.08], warnMat);

    addFurniture(group, f, base);
    return group;
  }

  function addFurniture(group, f, base) {
    // 病床（单层医院也布置病床）
    {
      [[10.0, -1.3, 0], [17.0, 1.0, Math.PI], [5.5, -2.5, Math.PI / 2], [20.0, 2.5, -Math.PI / 3]].forEach(function (p, i) {
        var bed = assetInstance('bed');
        if (bed) {
          bed.position.set(p[0], base, p[1]);
          bed.rotation.y = p[2];
          group.add(bed);
        } else {
          box(group, 'bed-fallback-' + i, [p[0], base + 0.32, p[1]], [2.0, 0.6, 0.82], mat('bed-fallback', 0x828c8e));
          box(group, 'mattress-fallback-' + i, [p[0], base + 0.67, p[1]], [1.82, 0.14, 0.72], mat('mattress-fallback', 0xc4c4b5));
        }
        // 床头桌
        box(group, 'nightstand-' + i, [p[0] + Math.cos(p[2]) * 1.1, base + 0.4, p[1] + Math.sin(p[2]) * 1.1], [0.45, 0.5, 0.4], mat('nightstand', 0x6b655a));
        // IV 输液架
        box(group, 'iv-pole-' + i, [p[0] + Math.cos(p[2]) * 1.5, base + 1.2, p[1] + Math.sin(p[2]) * 1.5], [0.04, 2.4, 0.04], mat('iv', 0x899197));
        box(group, 'iv-bag-' + i, [p[0] + Math.cos(p[2]) * 1.5, base + 2.2, p[1] + Math.sin(p[2]) * 1.5], [0.12, 0.3, 0.08], mat('iv-bag', 0x3a7a6a));
      });
    }
    // 护理推车（每层都有）
    var cart = assetInstance('trolley');
    if (cart) {
      cart.position.set(f === 1 ? 12 : 11.7, base, 2.65);
      group.add(cart);
    } else {
      box(group, 'trolley-fallback', [f === 1 ? 12 : 11.7, base + 0.52, 2.65], [0.72, 0.9, 0.45], mat('trolley-fallback', 0x9da8a8));
    }
    // 护士站桌
    var tables = f === 1 ? [[5.2, 2.7], [18.8, -2.7]] : (f === 2 ? [[4.2, -2.7], [19.5, 2.7]] : [[4.5, 2.7], [19.0, -2.7]]);
    tables.forEach(function (p, index) {
      var x = p[0], z = p[1], top = base + 0.78;
      var wood = mat('desk-' + f + '-' + index, 0x8c887c);
      box(group, 'desk-top', [x, top, z], [1.25, 0.12, 0.72], wood);
      [[-0.53, -0.28], [0.53, -0.28], [-0.53, 0.28], [0.53, 0.28]].forEach(function (leg) {
        box(group, 'desk-leg', [x + leg[0], base + 0.37, z + leg[1]], [0.07, 0.72, 0.07], mat('desk-leg-' + f, 0x626d72));
      });
      // 桌上物品：台灯 + 键盘
      box(group, 'lamp-base-' + f + '-' + index, [x - 0.3, top + 0.06, z - 0.15], [0.18, 0.04, 0.14], mat('lamp', 0x4a5256));
      box(group, 'lamp-arm-' + f + '-' + index, [x - 0.28, top + 0.35, z - 0.13], [0.04, 0.3, 0.04], mat('lamp-arm', 0x4a5256));
      box(group, 'lamp-shade-' + f + '-' + index, [x - 0.25, top + 0.55, z - 0.1], [0.2, 0.15, 0.18], mat('lamp-shade', 0xc8a15a));
      box(group, 'keyboard-' + f + '-' + index, [x + 0.15, top + 0.07, z + 0.1], [0.4, 0.02, 0.15], mat('keyboard', 0x2a3238));
    });
    // 椅子（每层护士站）
    tables.forEach(function (p, index) {
      var x = p[0], z = p[1];
      box(group, 'chair-seat-' + f + '-' + index, [x, base + 0.48, z + 1.0], [0.5, 0.06, 0.5], mat('chair', 0x3a444a));
      box(group, 'chair-back-' + f + '-' + index, [x, base + 0.78, z + 1.22], [0.48, 0.5, 0.04], mat('chair-back', 0x3a444a));
      box(group, 'chair-leg1-' + f + '-' + index, [x - 0.22, base + 0.22, z + 1.22], [0.03, 0.44, 0.03], mat('chair-leg', 0x2a3238));
      box(group, 'chair-leg2-' + f + '-' + index, [x + 0.22, base + 0.22, z + 1.22], [0.03, 0.44, 0.03], mat('chair-leg2', 0x2a3238));
      box(group, 'chair-leg3-' + f + '-' + index, [x - 0.22, base + 0.22, z + 0.8], [0.03, 0.44, 0.03], mat('chair-leg3', 0x2a3238));
      box(group, 'chair-leg4-' + f + '-' + index, [x + 0.22, base + 0.22, z + 0.8], [0.03, 0.44, 0.03], mat('chair-leg4', 0x2a3238));
    });
  }

  /* ========== 实体构建 ========== */
  function entityObject(e) {
    var group = new THREE.Group();
    group.name = 'entity-' + e.id;

    if (e.kind === 'player') {
      // 全员木乃伊基础体：两名玩家共用同一套体型，只用 traits 对应的局部装饰做区分
      // （见《人物设定与美术交付说明》）。不再使用人马/护士外观。
      buildMummyBody(group, e.id, e.traits || []);
    } else if (e.kind === 'npc') {
      buildMummyBody(group, e.id, e.traits || []);
    } else if (e.kind === 'zombie') {
      // 感染者：略大的体型 + 头顶红色标记；不改共享材质（避免污染其它角色的贴图）
      buildMummyBody(group, e.id, ['scarLeftCheek']);
      group.scale.set(1.15, 1.15, 1.15);
      box(group, 'zombie-mark', [0, 2.02, 0], [0.16, 0.16, 0.16], mat('zombie-mark', 0x8d3c42, 0.5));
    } else if (e.kind === 'phone') {
      var model = assetInstance('phone');
      if (model) {
        model.position.y = 0.84;
        group.add(model);
      } else {
        box(group, 'phone-fallback', [0, 0.9, 0], [0.24, 0.1, 0.14], mat('phone-fallback', 0x5ab3bb));
      }
      // 荧光发光层已移除，保留手机模型本体
    } else if (e.kind === 'food' || e.kind === 'medicine') {
      var foodModel = assetInstance('food');
      if (foodModel) {
        foodModel.position.y = 0.22;
        group.add(foodModel);
      } else {
        box(group, 'food-fallback', [0, 0.22, 0], [0.14, 0.28, 0.14], mat('food-fallback', e.kind==='medicine'?0xc95d55:0x99b977));
      }
    } else if (e.kind === 'clue') {
      // 线索卡：去掉荧光发光层，只保留纸本体
      box(group, 'clue-paper', [0, 0.85, 0], [0.32, 0.02, 0.24], mat('clue-paper', 0xc6a258));
    } else if (e.kind === 'exit') {
      // 出口：去掉荧光描边，改为低调的门框
      box(group,'exit-frame',[0,1.1,0],[1.2,2.2,.18],mat('exit-frame',0x4a5a52));
    } else if (e.kind === 'food' || e.kind === 'battery') {
      // 通用拾取物 fallback
      box(group, 'pickup', [0, 0.22, 0], [0.16, 0.2, 0.16], mat('pickup-fallback', 0x99b977));
    }
    // 说明：早期版本在此预挂 __outline__ 发光薄壳做"最近可交互物"描边高亮。
    // 实测中它在角色身上呈现为一层彩色发光方块/荧光边框，与写实建模风格冲突，
    // 已按要求移除。辨认目标改由 HUD 文字提示，不再用屏幕内发光描边。
    group.userData.kind = e.kind;
    entities[e.id] = group;
    return group;
  }

  /* ========== 世界构建 ========== */
  function buildWorld(w) {
    if (!scene) return;
    Object.keys(floors).forEach(function (f) { scene.remove(floors[f]); });
    Object.keys(entities).forEach(function (id) { scene.remove(entities[id]); });
    floors = {}; entities = {};
    // 单层医院
    floorRoom(w, 1);
    // 实体
    w.entities.forEach(function (e) { var obj = entityObject(e); scene.add(obj); });
    builtWorld = w;
  }

  /* ========== 相机视角 ========== */
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function viewState(role) { return views[role] || views.p1; }
  function forwardFor(role) {
    var v = viewState(role);
    return { x: Math.sin(v.yaw), z: -Math.cos(v.yaw) };
  }
  // Test a segment against the same 3D wall boxes used by the scene. Keeping
  // this in one place makes camera collision and entity line-of-sight agree.
  function firstWallHit(w, floor, start, end, padding) {
    if (!w.walls) return 1;
    var dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
    var origins = [start.x, start.y, start.z], dirs = [dx, dy, dz];
    var nearest = 1;
    w.walls.forEach(function (wall) {
      if (wall.floor !== floor) return;
      var pad = padding || 0;
      var min = [wall.x / 100 - pad, (floor - 1) * 4.2, wall.y / 100 - 4.9 - pad];
      var max = [(wall.x + wall.w) / 100 + pad, (floor - 1) * 4.2 + 3.5, (wall.y + wall.h) / 100 - 4.9 + pad];
      var enter = 0, leave = 1, inside = true;
      for (var axis = 0; axis < 3; axis++) {
        if (origins[axis] < min[axis] || origins[axis] > max[axis]) inside = false;
        if (Math.abs(dirs[axis]) < 1e-7) {
          if (origins[axis] < min[axis] || origins[axis] > max[axis]) { leave = -1; break; }
        } else {
          var a = (min[axis] - origins[axis]) / dirs[axis];
          var b = (max[axis] - origins[axis]) / dirs[axis];
          if (a > b) { var swap = a; a = b; b = swap; }
          enter = Math.max(enter, a); leave = Math.min(leave, b);
          if (enter > leave) { leave = -1; break; }
        }
      }
      // If the camera starts within a wall box, treat the wall as an immediate hit.
      var hit = inside ? 0 : enter;
      if (leave >= 0 && hit >= 0 && hit < nearest && hit <= 1) nearest = hit;
    });
    return nearest;
  }
  function cameraBeforeWall(w, floor, pivot, desired) {
    var dx = desired.x - pivot.x, dy = desired.y - pivot.y, dz = desired.z - pivot.z;
    var length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!length) return desired;
    var hit = firstWallHit(w, floor, pivot, desired, 0.2);
    // 同时扫过床、桌和门框等当前楼层几何，镜头不能穿进静态场景。
    var direction = new THREE.Vector3(dx, dy, dz).normalize();
    var offsets = [[0, 0, 0], [0.12, 0, 0], [-0.12, 0, 0], [0, 0.12, 0], [0, -0.12, 0]];
    if (floors[floor]) {
      floors[floor].updateMatrixWorld(true);
      offsets.forEach(function (offset) {
        var origin = new THREE.Vector3(pivot.x + offset[0], pivot.y + offset[1], pivot.z + offset[2]);
        var ray = new THREE.Raycaster(origin, direction, 0, length);
        var intersections = ray.intersectObjects([floors[floor]], true);
        if (intersections.length) hit = Math.min(hit, intersections[0].distance / length);
      });
    }
    if (hit < 1) {
      var safeT = Math.max(0, hit - 0.16 / length);
      return { x: pivot.x + dx * safeT, y: pivot.y + dy * safeT, z: pivot.z + dz * safeT };
    }
    return desired;
  }
  function wallOccludes(w, floor, camera, point) {
    return firstWallHit(w, floor, camera, point, 0.015) < 0.995;
  }
  // Interaction and visibility use a ray from the player's eye, so entities
  // behind a corner cannot be selected merely because they are nearby.
  function canSee(w, player, entity) {
    if (!w || !player || !entity || player.floor !== entity.floor) return false;
    var floor = player.floor, base = (floor - 1) * 4.2;
    var start = { x: player.x / 100, y: base + 1.45, z: player.y / 100 - 4.9 };
    var end = { x: entity.x / 100, y: base + (entity.kind === 'player' ? 1.0 : 0.85), z: entity.y / 100 - 4.9 };
    return firstWallHit(w, floor, start, end, 0.015) >= 0.995;
  }
  function cameraTarget(player, base, role, height) {
    var v = viewState(role), f = forwardFor(role);
    var target = new THREE.Vector3(player.x / 100, base + (height || 1.58), player.y / 100 - 4.9);
    var pitch = v.pitch;
    if (v.mode === 'first') {
      var lookDistance = 6;
      target.x += f.x * lookDistance * Math.cos(pitch);
      target.y -= Math.sin(pitch) * lookDistance;
      target.z += f.z * lookDistance * Math.cos(pitch);
    }
    return target;
  }
  function installMouseCamera() {
    if (!canvas || canvas.__hospitalCameraInput) return;
    canvas.__hospitalCameraInput = true;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', function (e) {
      // 鼠标只服务 A 玩家；双屏右半边留给 B 的外置手柄。
      var duo = G.Game && (G.Game.mode === 'duo' || G.Game.dualView);
      var locked = document.pointerLockElement === canvas;
      if (duo && e.clientX >= window.innerWidth / 2 && !locked) return;
      if (e.button !== 0 && e.pointerType !== 'touch') return;
      var v = viewState('p1');
      if (v.mode === 'first') {
        // FPS 第一人称：点击一次捕获鼠标，此后用相对位移持续瞄准，不需按住或拖动。
        v.lastX = e.clientX; v.lastY = e.clientY;
        if (document.pointerLockElement !== canvas && canvas.requestPointerLock) {
          try {
            var lockRequest = canvas.requestPointerLock();
            if (lockRequest && lockRequest.catch) lockRequest.catch(function () {});
          } catch (_) {}
        }
        if (G.Audio && G.Audio.unlock) G.Audio.unlock();
        return;
      }
      v.dragging = true; v.lastX = e.clientX; v.lastY = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      if (G.Audio && G.Audio.unlock) G.Audio.unlock();
    });
    canvas.addEventListener('pointermove', function (e) {
      var v = viewState('p1');
      var locked = document.pointerLockElement === canvas;
      if (v.mode === 'first') {
        var duo = G.Game && (G.Game.mode === 'duo' || G.Game.dualView);
        // 锁定状态使用相对位移；未锁定时用屏幕坐标差，兼容 movementX 存在但始终为 0 的浏览器。
        var dx = locked ? (e.movementX || 0) : e.clientX - v.lastX;
        var dy = locked ? (e.movementY || 0) : e.clientY - v.lastY;
        if (!locked && duo && e.clientX >= window.innerWidth / 2) return;
        v.lastX = e.clientX; v.lastY = e.clientY;
        v.yaw += dx * 0.0025;
        v.pitch = clamp(v.pitch + dy * 0.002, -0.72, 0.78);
        return;
      }
      if (!v.dragging) return;
      var dx = e.clientX - v.lastX, dy = e.clientY - v.lastY;
      v.lastX = e.clientX; v.lastY = e.clientY;
      v.yaw += dx * 0.006;
      v.pitch = clamp(v.pitch + dy * 0.004, -0.72, 0.78);
    });
    var stop = function (e) {
      viewState('p1').dragging = false;
      if (e && e.pointerId !== undefined) { try { canvas.releasePointerCapture(e.pointerId); } catch (_) {} }
    };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    canvas.addEventListener('wheel', function (e) {
      var duo = G.Game && (G.Game.mode === 'duo' || G.Game.dualView);
      if (duo && e.clientX >= window.innerWidth / 2) return;
      var v = viewState('p1');
      if (v.mode === 'third') { v.distance = clamp(v.distance + e.deltaY * 0.008, 2.4, 8.5); e.preventDefault(); }
    }, { passive: false });
  }
  function toggleView(role) {
    var v = viewState(role);
    v.mode = v.mode === 'first' ? 'third' : 'first';
    v.dragging = false;
    if (role === 'p1' && v.mode === 'third' && document.pointerLockElement === canvas && document.exitPointerLock) {
      document.exitPointerLock();
    }
    if (G.Game && G.Game.world) {
      var p = role === 'p1' ? G.Game.world.p1 : G.Game.world.p2;
      p.notice = (v.mode === 'first' ? (role === 'p1' ? '第一人称：点击左屏捕获鼠标，直接移动鼠标转动视野，按 Esc 释放。' : '第一人称：使用手柄右摇杆转动视野。') : '第三人称视角：拖动鼠标/右摇杆环绕观察。');
      p.noticeUntil = G.Game.world.time + 2.5;
    }
    return v.mode;
  }
  function resetViews() {
    views.p1.mode = 'third'; views.p1.yaw = Math.PI / 2; views.p1.pitch = 0.18;
    views.p2.mode = 'third'; views.p2.yaw = -Math.PI / 2; views.p2.pitch = 0.18;
    ['p1', 'p2'].forEach(function (role) {
      views[role].distance = 3.2; views[role].dragging = false;
    });
  }
  function updateGamepadCamera(role, dx, dy, dt) {
    var v = viewState(role);
    var seconds = Math.min(Math.max(dt || 0, 0), 0.1);
    if (Math.abs(dx) > 0.01) v.yaw += dx * 2.1 * seconds;
    if (Math.abs(dy) > 0.01) v.pitch = clamp(v.pitch + dy * 1.5 * seconds, -0.72, 0.78);
  }
  function view(w, x, width, role) {
    var player = role === 'p1' ? w.p1 : w.p2;
    var base = (player.floor - 1) * 4.2;
    var state = viewState(role);
    var playerTarget = new THREE.Vector3(player.x / 100, base + 1.58, player.y / 100 - 4.9);
    var target = cameraTarget(player, base, role, 1.58);
    var camera = cameras[role];
    camera.aspect = width / window.innerHeight;
    camera.updateProjectionMatrix();
    var f = forwardFor(role);
    if (state.mode === 'first') {
      camera.position.set(playerTarget.x, base + 1.58, playerTarget.z);
    } else {
      var horizontal = Math.cos(state.pitch) * state.distance;
      var desired = {
        x: playerTarget.x - f.x * horizontal + Math.cos(state.yaw) * 0.5,
        y: clamp(base + 1.58 + Math.sin(state.pitch) * state.distance, base + 0.35, base + 3.22),
        z: playerTarget.z - f.z * horizontal + Math.sin(state.yaw) * 0.5
      };
      var safe = cameraBeforeWall(w, player.floor, playerTarget, desired);
      camera.position.set(safe.x, safe.y, safe.z);
      // 靠肩取景让人物位于画面左侧；回缩到眼睛时也保持原朝向。
      target.set(safe.x + f.x * Math.cos(state.pitch), safe.y - Math.sin(state.pitch), safe.z + f.z * Math.cos(state.pitch));
    }
    camera.lookAt(target);

    // 分屏渲染时只启用当前玩家的手电筒，避免 A/B 的光束互相照亮对方视野。
    Object.keys(flashlights).forEach(function (id) {
      var beam = flashlights[id];
      beam.visible = id === role && G.Beam.lightOn(player, w.time);
      if (id === role) {
        beam.distance = (player.beam && player.beam.range || 1200) / 100;
        beam.angle = player.beam && player.beam.halfAngle || Math.PI / 7;
        // 光源留在人物眼前，不随第三人称镜头退到墙角或照向自己。
        beam.position.set(playerTarget.x, base + 1.58, playerTarget.z);
        beam.target.position.set(playerTarget.x + f.x * 6 * Math.cos(state.pitch), base + 1.58 - Math.sin(state.pitch) * 6, playerTarget.z + f.z * 6 * Math.cos(state.pitch));
      }
    });

    // 单层：只需显示 1F 房间组
    Object.keys(floors).forEach(function (f) {
      floors[f].visible = Number(f) === player.floor;
    });

    w.entities.forEach(function (e) {
      var obj = entities[e.id];
      if (!obj) { obj = entityObject(e); scene.add(obj); }
      obj.position.set(e.x / 100, (e.floor - 1) * 4.2, e.y / 100 - 4.9);
      obj.traverse(function (child) { if (child.isMesh) child.castShadow = e.id !== player.id; });
      var entityPoint = { x: e.x / 100, y: base + (e.kind === 'player' ? 1.0 : 0.85), z: e.y / 100 - 4.9 };
      obj.visible = !!e.alive && e.floor === player.floor && !(e.id === player.id && (state.mode === 'first' || camera.position.distanceTo(playerTarget) < 1.2)) && canSee(w, player, e) && !wallOccludes(w, player.floor, camera.position, entityPoint);
    });

    // 发光描边高亮已移除（在角色身上呈现为荧光方块）；辨认目标由 HUD 文字提示。

    renderer.setViewport(x, 0, width, window.innerHeight);
    renderer.setScissor(x, 0, width, window.innerHeight);
    renderer.render(scene, camera);
  }

  // 每帧推进角色动画（只在这里 tick 一次，分屏 view() 不重复）。
  function tickAvatars(w) {
    if (!w) return;
    var dt = Math.min(clock.getDelta(), 0.05);
    w.entities.forEach(function (e) {
      var obj = entities[e.id];
      if (!obj || !obj.userData.mixer || !obj.userData.actions) return;
      var actions = obj.userData.actions;
      var traits = obj.userData.traits || e.traits || [];
      var moving = !!e.moving;
      var target;
      if (traits.indexOf('limpGait') >= 0 && moving) target = 'Limp_Right';
      else if (e.state === 'slowRun') target = 'Walk';
      else if ((e.state === 'walk' || e.state === 'wander') && moving) target = 'Walk';
      else target = 'Idle';
      if (actions[target] && obj.userData.activeClip !== target) {
        var prev = obj.userData.activeClip && actions[obj.userData.activeClip];
        if (prev) prev.fadeOut(0.25);
        actions[target].reset().fadeIn(0.25).play();
        actions[target].timeScale = (e.state === 'slowRun') ? 1.35 : 1;
        obj.userData.activeClip = target;
      }
      obj.userData.mixer.update(dt);
    });
  }

  function renderAll() {
    if (!renderer) init();
    var w = G.Game.world;
    if (w && builtWorld !== w) buildWorld(w);
    tickAvatars(w);
    renderer.clear(true, true, true);
    if (!w) return;
    // 调试明亮模式只提高环境照明与曝光，保留墙体碰撞、遮挡和手电逻辑。
    // 普通模式维持停电医院的低环境光，避免改变正式玩法。
    var bright=!!w.brightMode;
    // 普通模式保留停电基调，但环境光抬到能看清 GLB 场景的建模细节；
    // 手电仍是主要局部照明，L 键明亮模式供验收/试玩看全貌。
    if(hemisphereLight)hemisphereLight.intensity=bright?1.15:0.5;
    if(keyLight)keyLight.intensity=bright?0.72:0.42;
    if(corridorLight)corridorLight.intensity=bright?0.9:0.85;
    renderer.toneMappingExposure=bright?1.15:1.05;
    if(scene.background)scene.background.setHex(bright?0x4b565d:0x111a21);
    if(scene.fog)scene.fog.color.setHex(bright?0x4b565d:0x111a21);
    var duo = G.Game.mode === 'duo' || G.Game.dualView;
    if (duo) {
      view(w, 0, window.innerWidth / 2, 'p1');
      view(w, window.innerWidth / 2, window.innerWidth / 2, 'p2');
    } else {
      view(w, 0, window.innerWidth, 'p1');
    }
  }

  /* ========== 初始化 ========== */
  function init() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // 停电场景仍要保留材质层次；过高的曝光会把手电照到的墙面直接冲成纯白。
    renderer.toneMappingExposure = 0.9;
    renderer.autoClear = false;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setScissorTest(true);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111a21);
    scene.fog = new THREE.Fog(0x111a21, 34, 80);
    // 停电后的医院：环境光只保留轮廓，角色手电光束承担主要照明。
    hemisphereLight = new THREE.HemisphereLight(0x71818b, 0x080b0d, 0.12);
    scene.add(hemisphereLight);
    keyLight = new THREE.DirectionalLight(0xffefd6, 1.6);
    keyLight.position.set(-8, 16, 10);
    keyLight.intensity = 0.04;
    scene.add(keyLight);
    // 走廊中部环境补光（单层，提供冷暖对比）
    corridorLight = new THREE.PointLight(0x4ab1c8, 0.5, 20);
    corridorLight.position.set(11.9, 4.2, 0);
    scene.add(corridorLight);
    ['p1', 'p2'].forEach(function (id) {
      cameras[id] = new THREE.PerspectiveCamera(60, 1, 0.06, 80);
      scene.add(cameras[id]);
      // 有限距离与柔和边缘限定视野；恒定衰减避免贴墙时平方反比把墙面冲成白色。
      var beam = new THREE.SpotLight(0xffe4b2, 2.4, 12, Math.PI / 7, 0.58, 0);
      beam.name = 'flashlight-' + id;
      beam.position.set(0, 0, 0);
      beam.target.position.set(0, 0, -1);
      beam.castShadow = true;
      beam.shadow.mapSize.set(512, 512);
      beam.shadow.camera.near = 0.1;
      beam.shadow.camera.far = 20;
      beam.shadow.bias = -0.0002;
      beam.shadow.normalBias = 0.015;
      flashlights[id] = beam;
      scene.add(beam, beam.target);
    });
    installMouseCamera();
    window.addEventListener('resize', resize);
    loadAssets();
  }

  function resize() {
    if (!renderer) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  G.Renderer = {
    init: init, resize: resize, renderAll: renderAll,
    toggleView: toggleView, resetViews: resetViews,
    updateGamepadCamera: updateGamepadCamera,
    canSee: canSee,
    getCameraYaw: function (role) { return viewState(role).yaw; },
    getCameraPitch: function (role) { return viewState(role).pitch; },
    getViewMode: function (role) { return viewState(role).mode; },
    isMouseLocked: function () { return !!(canvas && document.pointerLockElement === canvas); },
    getViewLabel: function (role) { return viewState(role).mode === 'first' ? '第一人称' : '第三人称'; }
  };
  G.RendererReady = true;
  window.dispatchEvent(new Event('hospital-renderer-ready'));
})();
