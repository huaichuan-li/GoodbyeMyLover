import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* Bundled glTF renderer for downloaded scene props. Logical gameplay stays x/y/floor. */
(function () {
  var G = window.G;
  if (!G || !G.utils) return;
  var canvas = G.utils.el('game');
  var renderer, scene, cameras = {}, floors = {}, entities = {}, builtWorld = null;
  var sources = {};
  var assetDefs = {
    bed: { file: 'prop_hospital_bed.glb', max: 2.1 },
    trolley: { file: 'prop_hospital_trolley.glb', max: 1.0 },
    phone: { file: 'prop_phone_nokia.glb', max: 0.18 },
    food: { file: 'prop_food_can.glb', max: 0.16 }
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
    mesh.castShadow = false;
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
        normalized.add(model);
        normalized.scale.setScalar(scale);
        normalized.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
        normalized.userData.sourceBounds = { x: size.x, y: size.y, z: size.z };
        sources[id] = normalized;
        if (builtWorld) buildWorld(builtWorld);
        console.info('[GLB] loaded', def.file, normalized.userData.sourceBounds);
      }, undefined, function (err) {
        console.warn('[GLB] could not load ' + def.file + '; using procedural fallback.', err);
      });
    });
  }
  function init() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111a21);
    scene.fog = new THREE.Fog(0x111a21, 34, 80);
    scene.add(new THREE.HemisphereLight(0xdde7ec, 0x252f36, 1.35));
    var key = new THREE.DirectionalLight(0xffefd6, 1.6);
    key.position.set(-8, 16, 10);
    scene.add(key);
    ['p1', 'p2'].forEach(function (id) {
      cameras[id] = new THREE.PerspectiveCamera(60, 1, 0.1, 80);
    });
    window.addEventListener('resize', resize);
    loadAssets();
  }
  function resize() {
    if (!renderer) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  }
  function floorRoom(w, f) {
    var group = new THREE.Group();
    var base = (f - 1) * 4.2;
    group.name = 'hospital-floor-' + f;
    floors[f] = group;
    scene.add(group);
    box(group, 'floor', [12, base - 0.22, 0], [26, 0.4, 11], mat('floor', 0x46545c));
    var wall = mat('wall', 0x27323a);
    var trim = mat('trim', 0x59656c);
    box(group, 'north-wall', [12, base + 2.5, -5.45], [26, 5, 0.3], wall);
    box(group, 'south-wall', [12, base + 2.5, 5.45], [26, 5, 0.3], wall);
    box(group, 'west-wall', [-1, base + 2.5, 0], [0.3, 5, 11], wall);
    box(group, 'east-wall', [25, base + 2.5, 0], [0.3, 5, 11], wall);
    for (var i = 0; i < 12; i++) {
      box(group, 'ceiling-trim-' + i, [1 + i * 2.05, base + 4.8, 0], [0.08, 0.08, 10.5], trim);
    }
    w.walls.forEach(function (b) {
      if (b.floor !== f) return;
      box(group, b.kind || 'partition', [(b.x + b.w / 2) / 100, base + 1.75, (b.y + b.h / 2) / 100 - 4.9], [b.w / 100, 3.5, b.h / 100], trim);
    });
    G.Level.departments[f].forEach(function (_name, i) {
      var x = f === 1 ? (i ? 18.8 : 4.2) : 4.2 + i * 3.5;
      box(group, 'department-sign', [x, base + 3.8, -4.9], [2.25, 0.48, 0.08], mat('sign', 0x58696b));
    });
    addFurniture(group, f, base);
    return group;
  }
  function addFurniture(group, f, base) {
    if (f > 1) {
      [[10.0, -1.3, 0], [17.0, 1.0, Math.PI]].forEach(function (p, i) {
        var bed = assetInstance('bed');
        if (bed) {
          bed.position.set(p[0], base, p[1]);
          bed.rotation.y = p[2];
          group.add(bed);
        } else {
          box(group, 'bed-fallback-' + i, [p[0], base + 0.32, p[1]], [2.0, 0.6, 0.82], mat('bed-fallback', 0x828c8e));
          box(group, 'mattress-fallback-' + i, [p[0], base + 0.67, p[1]], [1.82, 0.14, 0.72], mat('mattress-fallback', 0xc4c4b5));
        }
      });
    }
    var cart = assetInstance('trolley');
    if (cart) {
      cart.position.set(f === 1 ? 12 : 11.7, base, 2.65);
      group.add(cart);
    } else {
      box(group, 'trolley-fallback', [f === 1 ? 12 : 11.7, base + 0.52, 2.65], [0.72, 0.9, 0.45], mat('trolley-fallback', 0x9da8a8));
    }
    var tables = f === 1 ? [[5.2, 2.7], [18.8, -2.7]] : (f === 2 ? [[4.2, -2.7]] : [[17.7, 2.7]]);
    tables.forEach(function (p, index) {
      var x = p[0], z = p[1], top = base + 0.78;
      var wood = mat('desk-' + f + '-' + index, 0x8c887c);
      box(group, 'desk-top', [x, top, z], [1.25, 0.12, 0.72], wood);
      [[-0.53, -0.28], [0.53, -0.28], [-0.53, 0.28], [0.53, 0.28]].forEach(function (leg) {
        box(group, 'desk-leg', [x + leg[0], base + 0.37, z + leg[1]], [0.07, 0.72, 0.07], mat('desk-leg-' + f, 0x626d72));
      });
    });
  }
  function entityObject(e) {
    var group = new THREE.Group();
    group.name = 'entity-' + e.id;
    var body = mat('body-' + e.id, e.id === 'p1' ? 0x53606a : (e.id === 'p2' ? 0x378197 : 0x77848a));
    if (e.kind === 'player') {
      box(group, 'body', [0, 0.7, 0], [0.62, 1.25, 0.58], body);
      box(group, 'head', [0, 1.55, 0], [0.52, 0.52, 0.52], mat('head-' + e.id, 0xb5a895));
      if (e.id === 'p1') box(group, 'sleeve', [0.28, 1.0, 0], [0.11, 0.1, 0.61], mat('trim-p1', 0xd0c6ae));
      else {
        box(group, 'bandage', [-0.34, 0.72, 0], [0.14, 0.32, 0.3], mat('trim-p2', 0x4ab1c8));
        box(group, 'badge', [0.1, 1.12, 0.3], [0.12, 0.12, 0.08], mat('badge-p2', 0xd3c08a));
      }
      box(group, 'hair', [0.36, 1.62, 0], [0.12, 0.36, 0.12], mat('hair-' + e.id, 0xe2a34a));
    } else if (e.kind === 'npc') {
      var lying = e.state === 'lie';
      var height = lying ? 0.24 : (0.92 + ((e.phase || 0) % 1) * 0.4);
      var wide = lying ? 0.9 : 0.48;
      group.position.y = 0;
      box(group, 'npc-body', [0, lying ? 0.18 : height * 0.55, 0], [wide, height, 0.48], body);
      box(group, 'npc-head', [0, lying ? 0.32 : height + 0.28, 0], [0.4, 0.4, 0.4], mat('npc-head-' + e.id, 0xa79e91));
      if ((e.phase || 0) > 0.6) box(group, 'npc-detail', [0.24, lying ? 0.24 : height * 0.5, 0], [0.11, 0.26, 0.3], mat('npc-detail-' + e.id, 0xb89c67));
    } else if (e.kind === 'phone' || e.kind === 'food') {
      var model = assetInstance(e.kind);
      if (model) { if (e.kind === 'phone') model.position.y += 0.84; group.add(model); }
      else box(group, 'pickup-fallback', [0, e.kind === 'phone' ? 0.9 : 0.22, 0], e.kind === 'phone' ? [0.24, 0.1, 0.14] : [0.14, 0.28, 0.14], mat('pickup-' + e.kind, e.kind === 'phone' ? 0x5ab3bb : 0x99b977));
    } else if (e.kind === 'clue') {
      box(group, 'clue-fallback', [0, 0.85, 0], [0.32, 0.08, 0.24], mat('clue', 0xc6a258));
    } else if (e.kind === 'stairs') {
      box(group, 'stairs-marker', [0, 0.22, 0], [1.4, 0.45, 1.4], mat('stairs', 0x899197));
    }
    entities[e.id] = group;
    return group;
  }
  function buildWorld(w) {
    if (!scene) return;
    Object.keys(floors).forEach(function (f) { scene.remove(floors[f]); });
    Object.keys(entities).forEach(function (id) { scene.remove(entities[id]); });
    floors = {}; entities = {};
    [1, 2, 3].forEach(function (f) { floorRoom(w, f); });
    w.entities.forEach(function (e) { var obj = entityObject(e); scene.add(obj); });
    builtWorld = w;
  }
  function view(w, x, width, role) {
    var player = role === 'p1' ? w.p1 : w.p2;
    var base = (player.floor - 1) * 4.2;
    var target = new THREE.Vector3(player.x / 100, base, player.y / 100 - 4.9);
    var camera = cameras[role];
    camera.aspect = width / window.innerHeight;
    camera.updateProjectionMatrix();
    camera.position.set(target.x - 3.5, base + 8.5, target.z + 3.5);
    camera.lookAt(target);
    Object.keys(floors).forEach(function (f) { floors[f].visible = Number(f) === player.floor; });
    w.entities.forEach(function (e) {
      var obj = entities[e.id];
      if (!obj) return;
      obj.position.set(e.x / 100, (e.floor - 1) * 4.2, e.y / 100 - 4.9);
      obj.visible = !!e.alive && e.floor === player.floor;
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
    if (G.Game.mode === 'duo' || G.Game.dualView) {
      view(w, 0, window.innerWidth / 2, 'p1');
      view(w, window.innerWidth / 2, window.innerWidth / 2, 'p2');
    } else {
      view(w, 0, window.innerWidth, 'p1');
    }
  }
  G.Renderer = { init: init, resize: resize, renderAll: renderAll };
  G.RendererReady = true;
  window.dispatchEvent(new Event('hospital-renderer-ready'));
})();
