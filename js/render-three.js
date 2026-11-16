import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* Bundled glTF renderer for downloaded scene props. Logical gameplay stays x/y/floor. */
(function () {
  var G = window.G;
  if (!G || !G.utils) return;
  var canvas = G.utils.el('game');
  var renderer, scene, cameras = {}, flashlights = {}, floors = {}, entities = {}, builtWorld = null;
  var views = {
    p1: { mode: 'third', yaw: 0, pitch: 0.18, distance: 3.2, dragging: false, lastX: 0, lastY: 0 },
    p2: { mode: 'third', yaw: 0, pitch: 0.18, distance: 3.2, dragging: false, lastX: 0, lastY: 0 }
  };
  var sources = {};
  var stairwell = null;
  // 过渡动画状态
  var floorTransition = { active: false, t: 0, fromFloor: 0, toFloor: 0, fromRole: null };
  var flashEl;
  var assetDefs = {
    // 道具类（已用）
    bed: { file: 'prop_hospital_bed.glb', max: 2.1 },
    trolley: { file: 'prop_hospital_trolley.glb', max: 1.0 },
    phone: { file: 'prop_phone_nokia.glb', max: 0.18 },
    food: { file: 'prop_food_can.glb', max: 0.16 },
    battery: { file: 'prop_battery_aa.glb', max: 0.15 },
    // 新增：道具类
    ivCrutch: { file: 'prop_iv_drip_crutch.glb', max: 1.4 },
    flashlight: { file: 'prop_flashlight_horror.glb', max: 0.22 },
    // 新增：NPC 模型（替换方块人）
    npcZombie: { file: 'npc_zombie_hospital.glb', max: 1.8 },
    npcMummy: { file: 'npc_mummy_stylized.glb', max: 1.8 },
    npcVampire: { file: 'npc_mummyvamp.glb', max: 1.8 }
  };
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
  function assetInstance(id) {
    var source = sources[id];
    if (!source) return null;
    var obj = source.clone(true);
    obj.traverse(function (child) { if (child.isMesh) { child.castShadow = false; child.receiveShadow = true; } });
    return obj;
  }
  function loadAssets() {
    var loader = new GLTFLoader();
    Object.keys(assetDefs).forEach(function (id) {
      var def = assetDefs[id];
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
      }, undefined, function (err) {
        console.warn('[GLB] could not load ' + def.file + '; using procedural fallback.', err);
      });
    });
  }

  /* ========== 楼梯几何构建 ========== */
  function buildStairwell() {
    var group = new THREE.Group();
    group.name = 'stairwell-core';
    var stairMat = mat('stair', 0x5a656c, 0.4);
    var railMat = mat('rail', 0x8a959c, 0.3);
    var pipeMat = mat('pipe', 0x606b72, 0.7);

    // 楼梯井：三层共用，从 -1.5 到 14.7 的 Y 空间
    // 楼梯位置在 (11.9, *, 0)，南北走向
    // 楼梯占 X: 10.5~13.3, Z: -1.6~1.6 的空间

    // === 一楼→二楼 楼梯 (floor 1→2, base 0→4.2) ===
    // 从 base-0.22 爬升到 base+4.2
    var stair1 = new THREE.Group();
    stair1.name = 'stair-1to2';
    // 底层平台
    box(stair1, 'landing-1', [11.9, 0.05, 0], [2.8, 0.1, 3.2], stairMat);
    // 12 级台阶，从 y=0.15 到 y=3.85
    var steps = 12;
    for (var i = 0; i < steps; i++) {
      var stepY = 0.15 + i * 0.308;
      var stepZ = -1.6 + i * (3.2 / steps);
      box(stair1, 'step-1-' + i, [11.9, stepY + 0.08, stepZ + (3.2 / steps) / 2], [2.8, 0.16, 3.2 / steps], stairMat);
    }
    // 顶层平台
    box(stair1, 'landing-2', [11.9, 4.15, 1.6], [2.8, 0.1, 0.6], stairMat);
    // 扶手 - 西侧
    for (var j = 0; j <= steps; j++) {
      var railY = 0.35 + j * 0.308;
      var railZ = -1.6 + j * (3.2 / steps);
      box(stair1, 'rail-p1-' + j, [10.55, railY + 0.95, railZ], [0.08, 0.06, 0.1], railMat); // 立柱
    }
    // 扶手上横杆
    var railLine1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 3.2), railMat);
    railLine1.position.set(10.55, 0.35 + 12 * 0.308 * 0.5 + 0.95, 0);
    railLine1.rotation.y = Math.atan2(3.2, 12 * 0.308);
    railLine1.rotation.x = -Math.atan2(3.2 / steps, 0.308);
    stair1.add(railLine1);
    // 扶手 - 东侧
    var railLine2 = railLine1.clone();
    railLine2.position.x = 13.25;
    railLine2.rotation.copy(railLine1.rotation);
    stair1.add(railLine2);
    for (var k = 0; k <= steps; k++) {
      var railY2 = 0.35 + k * 0.308;
      var railZ2 = -1.6 + k * (3.2 / steps);
      box(stair1, 'rail-p2-' + k, [13.25, railY2 + 0.95, railZ2], [0.08, 0.06, 0.1], railMat);
    }
    // 楼梯平台下的支撑柱
    box(stair1, 'support-1', [10.55, 0, -1.2], [0.15, 4.2, 0.15], pipeMat);
    box(stair1, 'support-2', [13.25, 0, -1.2], [0.15, 4.2, 0.15], pipeMat);

    // === 二楼→三楼 楼梯 (floor 2→3, base 4.2→8.4) ===
    var stair2 = new THREE.Group();
    stair2.name = 'stair-2to3';
    var stair2Offset = 1.8; // 往东边偏移一点，避免与下楼梯重叠
    // 底层平台（从二楼走廊进入）
    box(stair2, 'landing-3', [11.9, 4.25, -1.6 - stair2Offset], [2.8, 0.1, 0.6], stairMat);
    // 上楼梯
    for (var s = 0; s < steps; s++) {
      var sY = 4.35 + s * 0.308;
      var sZ = -1.6 - stair2Offset + s * (3.2 / steps);
      box(stair2, 'step-2-' + s, [11.9, sY + 0.08, sZ + (3.2 / steps) / 2], [2.8, 0.16, 3.2 / steps], stairMat);
    }
    // 顶层平台
    box(stair2, 'landing-4', [11.9, 8.35, 1.6 - stair2Offset], [2.8, 0.1, 0.6], stairMat);
    // 扶手
    var railLine3 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 3.2), railMat);
    railLine3.position.set(10.55, 4.35 + 12 * 0.308 * 0.5 + 0.95, -1.6 - stair2Offset + 1.6);
    railLine3.rotation.x = -Math.atan2(3.2 / steps, 0.308);
    stair2.add(railLine3);
    var railLine4 = railLine3.clone();
    railLine4.position.x = 13.25;
    railLine4.rotation.copy(railLine3.rotation);
    stair2.add(railLine4);

    group.add(stair1);
    group.add(stair2);
    return group;
  }

  /* ========== 楼层房间构建 ========== */
  function floorRoom(w, f) {
    var group = new THREE.Group();
    var base = (f - 1) * 4.2;
    group.name = 'hospital-floor-' + f;
    floors[f] = group;
    scene.add(group);

    // 完整医院 GLB 的门墙与逻辑布局不同，保留在资产预览台供后续搭建使用。
    // 可玩区域的墙统一从 w.walls 生成，确保画面、人物碰撞和镜头遮挡一致。

    // 地板
    box(group, 'floor', [12, base - 0.22, 0], [26, 0.4, 11], mat('floor', 0x46545c));
    // 边界墙
    var wall = mat('wall', 0x27323a);
    var trim = mat('trim', 0x59656c);
    box(group, 'north-wall', [12, base + 2.5, -5.45], [26, 5, 0.3], wall);
    box(group, 'south-wall', [12, base + 2.5, 5.45], [26, 5, 0.3], wall);
    box(group, 'west-wall', [-1, base + 2.5, 0], [0.3, 5, 11], wall);
    box(group, 'east-wall', [25, base + 2.5, 0], [0.3, 5, 11], wall);
    // 天花板装饰条
    for (var i = 0; i < 12; i++) {
      box(group, 'ceiling-trim-' + i, [1 + i * 2.05, base + 4.8, 0], [0.08, 0.08, 10.5], trim);
    }
    // 走廊顶灯（三排）
    var lightMat = mat('light', 0xc8d4d8, 0.1);
    for (var i2 = 0; i2 < 6; i2++) {
      box(group, 'ceiling-light-' + i2, [4 + i2 * 3.4, base + 4.9, 0], [1.6, 0.08, 0.4], lightMat);
    }
    // 墙壁上的分割
    w.walls.forEach(function (b) {
      if (b.floor !== f) return;
      box(group, b.kind || 'partition', [(b.x + b.w / 2) / 100, base + 1.75, (b.y + b.h / 2) / 100 - 4.9], [b.w / 100, 3.5, b.h / 100], trim);
    });
    // 科室标识牌
    G.Level.departments[f].forEach(function (_name, i) {
      var x = f === 1 ? (i ? 18.8 : 4.2) : 4.2 + i * 3.5;
      box(group, 'department-sign', [x, base + 3.8, -4.9], [2.25, 0.48, 0.08], mat('sign', 0x58696b));
    });

    // === 楼层间连接：楼梯门和电梯门 ===
    // 楼梯入口保留地面标记；门墙由逻辑布局生成，避免装饰门柱占住出生点和通道。
    var doorFrameMat = mat('doorframe', 0x3a454d);
    // 楼梯间地面开口（用深色地板表示）
    box(group, 'stair-opening', [11.9, base - 0.1, 0], [2.8, 0.02, 3.2], mat('hole', 0x080c10));
    // 扶手栏 (楼梯入口两侧)
    box(group, 'railing-N', [11.9, base + 0.95, -1.6], [2.8, 0.06, 0.06], trim);
    box(group, 'railing-S', [11.9, base + 0.95, 1.6], [2.8, 0.06, 0.06], trim);
    // 立柱
    box(group, 'post-NL', [10.55, base + 0.5, -1.6], [0.06, 0.95, 0.06], trim);
    box(group, 'post-NR', [13.25, base + 0.5, -1.6], [0.06, 0.95, 0.06], trim);
    box(group, 'post-SL', [10.55, base + 0.5, 1.6], [0.06, 0.95, 0.06], trim);
    box(group, 'post-SR', [13.25, base + 0.5, 1.6], [0.06, 0.95, 0.06], trim);

    // 电梯井（在另一侧）
    var elevatorX = 22.5;
    box(group, 'elevator-frame', [elevatorX, base + 1.8, -1], [1.8, 3.2, 2.2], doorFrameMat);
    box(group, 'elevator-opening', [elevatorX, base + 1.8, -0.6], [1.2, 3.0, 0.05], mat('elevator', 0x1a2228));
    // 电梯按钮
    box(group, 'elevator-btn', [elevatorX + 0.9, base + 2.0, 0.1], [0.15, 0.15, 0.05], mat('elevator-btn', 0xc8a15a));
    // 楼层数字指示
    var numColor = f === 1 ? 0x4ab1c8 : (f === 2 ? 0xd0c6ae : 0x6f8a91);
    box(group, 'floor-indicator', [elevatorX - 0.4, base + 3.4, -0.6], [0.3, 0.2, 0.02], mat('indicator', numColor));

    // === 墙上的走廊标识和装饰 ===
    box(group, 'corridor-sign', [6, base + 2.8, -5.3], [1.4, 0.25, 0.05], mat('corridor-sign', 0x5a6770));
    box(group, 'corridor-sign2', [18, base + 2.8, -5.3], [1.4, 0.25, 0.05], mat('corridor-sign2', 0x5a6770));
    // 灭火器（靠墙）
    box(group, 'fire-extinguisher-1', [1, base + 0.9, 3], [0.2, 0.6, 0.2], mat('extinguisher', 0xb4453c));
    box(group, 'fire-extinguisher-2', [23, base + 0.9, -3], [0.2, 0.6, 0.2], mat('extinguisher2', 0xb4453c));
    // 墙上的疏散指示牌（发光）
    box(group, 'exit-sign-1', [3, base + 3.0, 5.3], [0.6, 0.2, 0.02], mat('exit', 0x3ddc84));
    box(group, 'exit-sign-2', [22, base + 3.0, -5.3], [0.6, 0.2, 0.02], mat('exit2', 0x3ddc84));

    // === 走廊地板警示线 ===
    var warnMat = mat('warning', 0xc8a15a, 0.6);
    box(group, 'warn-line-1', [11.9, base - 0.21, 3.5], [3.5, 0.01, 0.08], warnMat);
    box(group, 'warn-line-2', [11.9, base - 0.21, -3.5], [3.5, 0.01, 0.08], warnMat);

    addFurniture(group, f, base);
    return group;
  }

  function addFurniture(group, f, base) {
    // 病床（二楼三楼）
    if (f > 1) {
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
      // 玩家：更丰富的外形
      var isP1 = e.id === 'p1';
      var bodyColor = isP1 ? 0x53606a : 0x378197;
      var headColor = 0xb5a895;
      box(group, 'body', [0, 0.7, 0], [0.62, 1.25, 0.58], mat('body-' + e.id, bodyColor));
      box(group, 'head', [0, 1.55, 0], [0.52, 0.52, 0.52], mat('head-' + e.id, headColor));
      // 腿部
      box(group, 'leg-l', [-0.15, 0.25, 0], [0.18, 0.55, 0.18], mat('leg-' + e.id, bodyColor * 0.7));
      box(group, 'leg-r', [0.15, 0.25, 0], [0.18, 0.55, 0.18], mat('leg-r-' + e.id, bodyColor * 0.7));
      // 医疗大褂
      if (!isP1) {
        box(group, 'coat', [0, 0.75, 0], [0.65, 1.0, 0.6], mat('coat-p2', 0xe8e4d8));
        box(group, 'badge', [0.1, 1.12, 0.3], [0.14, 0.14, 0.06], mat('badge-p2', 0xd3c08a));
        box(group, 'stethoscope', [0.12, 1.0, 0.35], [0.02, 0.4, 0.02], mat('steth', 0x899197));
      } else {
        box(group, 'sleeve', [0.28, 1.0, 0], [0.11, 0.1, 0.61], mat('trim-p1', 0xd0c6ae));
        box(group, 'glasses', [0, 1.58, 0.26], [0.3, 0.12, 0.04], mat('glasses', 0x2a3238));
      }
      box(group, 'hair', [isP1 ? 0.36 : -0.2, 1.62, 0], [0.12, 0.36, 0.12], mat('hair-' + e.id, isP1 ? 0xe2a34a : 0x3a3a3a));
    } else if (e.kind === 'npc') {
      // P0: 优先使用开源 NPC 模型，fallback 到方块
      var npcKeys = ['npcZombie', 'npcMummy', 'npcVampire'];
      var npcKey = npcKeys[Math.floor((e.phase || 0) * 3) % 3];
      var npcModel = assetInstance(npcKey);
      var lying = e.state === 'lie';
      if (npcModel) {
        npcModel.position.set(0, lying ? 0.3 : 0, 0);
        if (lying) npcModel.rotation.z = Math.PI / 2;
        if (e.phase) npcModel.rotation.y = e.phase * Math.PI * 2;
        group.add(npcModel);
      } else {
        // fallback 方块 NPC
        var phase = e.phase || 0;
        var height = lying ? 0.24 : (0.92 + (phase % 1) * 0.4);
        var wide = lying ? 0.9 : 0.48;
        var palette = [0x77848a, 0x8a7e6a, 0x6a7880, 0x7a6b5e, 0x839096, 0x6d7c84];
        var bodyColor2 = palette[Math.floor(phase * 7) % palette.length];
        var headColor2 = 0xa79e91;
        group.position.y = 0;
        box(group, 'npc-body', [0, lying ? 0.18 : height * 0.55, 0], [wide, height, 0.48], mat('npc-body-' + e.id, bodyColor2));
        box(group, 'npc-head', [0, lying ? 0.32 : height + 0.28, 0], [0.4, 0.4, 0.4], mat('npc-head-' + e.id, headColor2));
        if (phase > 0.75) box(group, 'npc-badge', [0.2, lying ? 0.2 : height * 0.6, 0.28], [0.12, 0.12, 0.05], mat('npc-badge', 0xd3c08a));
        else if (phase > 0.5) box(group, 'npc-bandage', [0.22, lying ? 0.15 : height * 0.3, 0], [0.1, 0.25, 0.2], mat('npc-bandage', 0xd0c6ae));
        else if (phase > 0.25) box(group, 'npc-cane', [0.22, lying ? 0.15 : height * 0.3, 0], [0.04, 0.4, 0.04], mat('npc-cane', 0x8c887c));
      }
    } else if (e.kind === 'phone') {
      var model = assetInstance('phone');
      if (model) {
        model.position.y = 0.84;
        group.add(model);
      } else {
        box(group, 'phone-fallback', [0, 0.9, 0], [0.24, 0.1, 0.14], mat('phone-fallback', 0x5ab3bb));
      }
      // 发光效果
      box(group, 'phone-glow', [0, 0.9, 0], [0.26, 0.02, 0.16], mat('phone-screen', 0xc8a15a));
    } else if (e.kind === 'food') {
      var foodModel = assetInstance('food');
      if (foodModel) {
        foodModel.position.y = 0.22;
        group.add(foodModel);
      } else {
        box(group, 'food-fallback', [0, 0.22, 0], [0.14, 0.28, 0.14], mat('food-fallback', 0x99b977));
      }
    } else if (e.kind === 'clue') {
      // 线索卡：有发光边框
      box(group, 'clue-paper', [0, 0.85, 0], [0.32, 0.02, 0.24], mat('clue-paper', 0xc6a258));
      box(group, 'clue-glow', [0, 0.86, 0], [0.36, 0.01, 0.28], mat('clue-glow', 0xffd68a));
      box(group, 'clue-edge-1', [0, 0.865, -0.14], [0.34, 0.01, 0.01], mat('clue-edge', 0xc8a15a));
      box(group, 'clue-edge-2', [0, 0.865, 0.14], [0.34, 0.01, 0.01], mat('clue-edge2', 0xc8a15a));
    } else if (e.kind === 'stairs') {
      // 楼梯标志 - 发光箭头
      var arrowColor = e.direction === 'UP' ? 0x3ddc84 : 0x6f8a91;
      box(group, 'stairs-marker', [0, 0.22, 0], [1.4, 0.45, 1.4], mat('stairs-marker', 0x899197));
      // 箭头指示
      box(group, 'stairs-arrow', [0, 0.48, 0], [0.6, 0.02, 0.25], mat('stairs-arrow', arrowColor));
      // 楼层标签
      box(group, 'stairs-label', [0, 0.52, 0], [0.5, 0.02, 0.02], mat('stairs-label', arrowColor));
    } else if (e.kind === 'food' || e.kind === 'battery') {
      // 通用拾取物 fallback
      box(group, 'pickup', [0, 0.22, 0], [0.16, 0.2, 0.16], mat('pickup-fallback', 0x99b977));
    }
    // P0: 预挂边缘高亮 outline mesh（薄壳，不是大方块）
    var outlineGeo = new THREE.BoxGeometry(1.04, 1.84, 1.04);
    var outlineMat = new THREE.MeshBasicMaterial({
      color: 0xffe08a, transparent: true, opacity: 0.28,
      side: THREE.BackSide, depthTest: true
    });
    var outline = new THREE.Mesh(outlineGeo, outlineMat);
    outline.name = '__outline__';
    outline.visible = false;
    outline.renderOrder = 999;
    group.add(outline);
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
    // 楼层房间
    [1, 2, 3].forEach(function (f) { floorRoom(w, f); });
    // 贯穿三层的楼梯井核心
    if (stairwell) scene.remove(stairwell);
    stairwell = buildStairwell();
    scene.add(stairwell);
    // 实体
    w.entities.forEach(function (e) { var obj = entityObject(e); scene.add(obj); });
    builtWorld = w;
  }

  /* ========== 楼层过渡动画 ========== */
  function triggerFloorTransition(fromRole, fromFloor, toFloor) {
    if (!flashEl) flashEl = G.utils.el('flash');
    floorTransition = { active: true, t: 0, fromFloor: fromFloor, toFloor: toFloor, fromRole: fromRole };
    // 淡入效果
    flashEl.style.transition = 'opacity 0.3s';
    flashEl.style.opacity = '1';
    flashEl.style.background = '#000';
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
      if (stairwell) stairwell.updateMatrixWorld(true);
      offsets.forEach(function (offset) {
        var origin = new THREE.Vector3(pivot.x + offset[0], pivot.y + offset[1], pivot.z + offset[2]);
        var ray = new THREE.Raycaster(origin, direction, 0, length);
        var intersections = ray.intersectObjects(stairwell ? [floors[floor], stairwell] : [floors[floor]], true);
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
      if (duo && e.clientX >= window.innerWidth / 2) return;
      if (e.button !== 0 && e.pointerType !== 'touch') return;
      var v = viewState('p1');
      v.dragging = true; v.lastX = e.clientX; v.lastY = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      if (G.Audio && G.Audio.unlock) G.Audio.unlock();
    });
    canvas.addEventListener('pointermove', function (e) {
      var v = viewState('p1');
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
    if (G.Game && G.Game.world) {
      var p = role === 'p1' ? G.Game.world.p1 : G.Game.world.p2;
      p.notice = (v.mode === 'first' ? '第一人称视角：鼠标/右摇杆转动视野。' : '第三人称视角：拖动鼠标/右摇杆环绕观察。');
      p.noticeUntil = G.Game.world.time + 2.5;
    }
    return v.mode;
  }
  function resetViews() {
    ['p1', 'p2'].forEach(function (role) {
      views[role].mode = 'third'; views[role].yaw = 0; views[role].pitch = 0.18;
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
      beam.visible = id === role;
      if (id === role) {
        // 光源留在人物眼前，不随第三人称镜头退到墙角或照向自己。
        beam.position.set(playerTarget.x, base + 1.58, playerTarget.z);
        beam.target.position.set(playerTarget.x + f.x * 6 * Math.cos(state.pitch), base + 1.58 - Math.sin(state.pitch) * 6, playerTarget.z + f.z * 6 * Math.cos(state.pitch));
      }
    });

    // 只有当前楼层可见，楼梯井始终可见（贯穿各层）
    Object.keys(floors).forEach(function (f) {
      floors[f].visible = Number(f) === player.floor;
    });

    w.entities.forEach(function (e) {
      var obj = entities[e.id];
      if (!obj) return;
      obj.position.set(e.x / 100, (e.floor - 1) * 4.2, e.y / 100 - 4.9);
      obj.traverse(function (child) { if (child.isMesh) child.castShadow = e.id !== player.id; });
      var entityPoint = { x: e.x / 100, y: base + (e.kind === 'player' ? 1.0 : 0.85), z: e.y / 100 - 4.9 };
      obj.visible = !!e.alive && e.floor === player.floor && !(e.id === player.id && (state.mode === 'first' || camera.position.distanceTo(playerTarget) < 1.2)) && canSee(w, player, e) && !wallOccludes(w, player.floor, camera.position, entityPoint);
    });

    // P0: 边缘高亮——给玩家最近的可交互物体描发光边
    var interactableKinds = { stairs: 1, clue: 1, phone: 1, food: 1, battery: 1, npc: 1 };
    var hiliteColor = { stairs: 0x4ddd84, clue: 0xffd68a, phone: 0x6ad9c8, food: 0x99d477, battery: 0x99d477, npc: 0xff7a6a, player: 0x8aa9e8 };
    var nearest = null, nearestDist = Infinity;
    w.entities.forEach(function (e) {
      if (!interactableKinds[e.kind]) return;
      if (!e.alive || e.floor !== player.floor) return;
      var d = Math.hypot(e.x - player.x, e.y - player.y);
      if (d < nearestDist && d < 350 && canSee(w, player, e)) { nearestDist = d; nearest = e; }
    });
    Object.keys(entities).forEach(function (id) {
      var obj = entities[id];
      var ol = obj.children.find(function (c) { return c.name === '__outline__'; });
      if (!ol) return;
      var eKind = obj.userData.kind;
      if (nearest && nearest.id === id && hiliteColor[eKind]) {
        ol.visible = true;
        ol.material.color.setHex(hiliteColor[eKind]);
        ol.material.opacity = 0.35 + 0.2 * Math.sin(performance.now() / 200);
      } else {
        ol.visible = false;
      }
    });

    renderer.setViewport(x, 0, width, window.innerHeight);
    renderer.setScissor(x, 0, width, window.innerHeight);
    renderer.render(scene, camera);
  }

  function renderAll() {
    if (!renderer) init();
    var w = G.Game.world;
    if (w && builtWorld !== w) buildWorld(w);
    renderer.clear(true, true, true);
    if (!w) return;
    var duo = G.Game.mode === 'duo' || G.Game.dualView;
    if (duo) {
      view(w, 0, window.innerWidth / 2, 'p1');
      view(w, window.innerWidth / 2, window.innerWidth / 2, 'p2');
    } else {
      view(w, 0, window.innerWidth, 'p1');
    }

    // 过渡动画淡出
    if (floorTransition.active && flashEl) {
      floorTransition.t += 1 / 60;
      if (floorTransition.t > 0.35) {
        flashEl.style.opacity = '0';
        floorTransition.active = false;
      }
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
    scene.add(new THREE.HemisphereLight(0x71818b, 0x080b0d, 0.12));
    var key = new THREE.DirectionalLight(0xffefd6, 1.6);
    key.position.set(-8, 16, 10);
    key.intensity = 0.04;
    scene.add(key);
    // 楼梯间环境光（贯穿各层）
    var stairLight = new THREE.PointLight(0x4ab1c8, 0.5, 20);
    stairLight.position.set(11.9, 4.2, 0);
    scene.add(stairLight);
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
    // 监听楼层变化以触发过渡动画
    document.addEventListener('hospital-renderer-ready', function () {
      // 暴露过渡函数给 game 逻辑
      G.Renderer.triggerFloorTransition = triggerFloorTransition;
    });
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
    getViewMode: function (role) { return viewState(role).mode; },
    getViewLabel: function (role) { return viewState(role).mode === 'first' ? '第一人称' : '第三人称'; }
  };
  G.RendererReady = true;
  window.dispatchEvent(new Event('hospital-renderer-ready'));
})();
