// Runs production gameplay/input/camera code with real Three.js math and a CPU render sink.
// GPU shading and physical controller compatibility still require browser/hardware checks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as Three from '../vendor/three/three.module.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const mapDots = [];
const mapContext = {
  fillStyle: '', strokeStyle: '', font: '',
  clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {}, fill() {},
  arc(x, y, radius) { mapDots.push({ x, y, radius, color: this.fillStyle }); }
};
class Target {
  listeners = {};
  style = {};
  classList = { add() {}, remove() {}, toggle() {} };
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatchEvent(event) { for (const fn of this.listeners[event.type] || []) fn(event); }
  focus() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  querySelectorAll() { return []; }
  getContext() { return mapContext; }
}
const elements = new Map();
const document = new Target();
document.getElementById = id => {
  if (!elements.has(id)) elements.set(id, new Target());
  return elements.get(id);
};
let focused = true, pad = null;
document.hasFocus = () => focused;
document.body = new Target();
const window = new Target();
Object.assign(window, { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
const frames = [], pendingAssets = [];
class RenderSink {
  shadowMap = {};
  setPixelRatio() {} setSize() {} setScissorTest() {} setViewport() {} setScissor() {}
  clear() { frames.length = 0; }
  render(scene, camera) {
    camera.updateMatrixWorld(true);
    frames.push({ scene, camera: camera.clone(), lights: scene.children.filter(x => x.isSpotLight && x.visible).map(x => ({ name: x.name, position: x.position.clone() })), visible: scene.children.filter(x => x.name.startsWith('entity-') && x.visible).map(x => x.name) });
  }
}
class Loader { load(url, callback) { pendingAssets.push({ url, callback }); } }
// SkeletonUtils.clone is imported as an ESM addon; the production build uses the
// real skinned-clone. In the CPU test a plain deep clone is enough to preserve the
// named bones that trait props attach to.
const cloneSkinned = source => source.clone(true);
const context = vm.createContext({ window, document, navigator: { getGamepads: () => pad ? [pad] : [] }, performance, console, Event, requestAnimationFrame() {}, THREE: { ...Three, WebGLRenderer: RenderSink }, GLTFLoader: Loader, cloneSkinned });
function run(file, transform = x => x) { vm.runInContext(transform(fs.readFileSync(root + file, 'utf8')), context, { filename: file }); }
for (const file of ['data/config.js', 'data/script.js', 'js/core.js', 'js/world.js', 'js/input.js', 'js/levels.js', 'js/beam.js', 'js/hazard.js']) run(file);
const G = window.G;
G.UI = { init() {} };
G.Audio = { unlock() {}, startAmbient() {}, stopAmbient() {} };
G.Subtitles = { clear() {} };
run('js/hospital-demo.js');
run('js/render-three.js', code => code.replace(/^import .*;\n/gm, ''));
G.Input.attach();
G.Renderer.init();
const key = (code, down = true) => document.dispatchEvent({ type: down ? 'keydown' : 'keyup', code, key: code, preventDefault() {} });
const step = (seconds = .2) => { for (let i = 0; i < Math.round(seconds * 60); i++) G.Hospital.tick(G.Game.world, 1 / 60); };
const position = p => [p.x, p.y];
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS ' + name); }
function reset() {
  pad = null; G.Input.down = {}; G.Input.gamepad = null; G.Input.gamepadButtons = [];
  G.Game.reset('duo');
  // 测试历史断言假设初始 yaw=0（前进=-y）；游戏实际默认朝向走廊纵深(+/-PI/2)。
  // Game.reset 内部会 resetViews()，因此在其后再校正回 0。
  G.Renderer.updateGamepadCamera('p1', -Math.PI / 2 / (2.1 * 0.1), 0, 0.1);
  G.Renderer.updateGamepadCamera('p2', Math.PI / 2 / (2.1 * 0.1), 0, 0.1);
  // 开局抽卡页：两人确认后才进入 PLAY，测试里直接模拟确认。
  G.Game.onPress({ code: 'KeyY', owner: 'p1' });
  G.Game.onPress({ code: 'GamepadA', owner: 'p2', source: 'gamepad' });
  G.Game.updateWheels(5);
  G.Game.onPress({ code: 'KeyY', owner: 'p1' });
  G.Game.onPress({ code: 'GamepadA', owner: 'p2', source: 'gamepad' });
  G.Game.world.p1.beam = G.Beam.effectiveBeam(null);
  G.Game.world.p2.beam = G.Beam.effectiveBeam(null);
  return G.Game.world;
}

test('WASD moves A at all six spawn pairs, leaving B unchanged', () => {
  const originalRandom = vm.runInContext('Math.random', context);
  for (let spawn = 0; spawn < 6; spawn++) {
    context.spawnRandom = () => (spawn + .01) / 6;
    vm.runInContext('Math.random = spawnRandom', context);
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
      const w = reset(), a = position(w.p1), b = position(w.p2);
      key(code); step(); key(code, false);
      assert.ok(Math.hypot(w.p1.x - a[0], w.p1.y - a[1]) > 20, `spawn ${spawn}, ${code}`);
      assert.deepEqual(position(w.p2), b);
    }
  }
  context.originalRandom = originalRandom;
  vm.runInContext('Math.random = originalRandom', context);
});
test('third-person mouse drag and V affect A only; movement follows camera direction', () => {
  reset();
  const canvas = elements.get('game');
  canvas.dispatchEvent({ type: 'pointerdown', clientX: 100, clientY: 100, button: 0 });
  canvas.dispatchEvent({ type: 'pointermove', clientX: 100 + Math.PI / .012, clientY: 100 });
  canvas.dispatchEvent({ type: 'pointerup' });
  close(G.Renderer.getCameraYaw('p1'), Math.PI / 2);
  close(G.Renderer.getCameraYaw('p2'), 0);
  key('KeyW'); const axis = G.Input.axis('p1'); key('KeyW', false);
  close(axis.x, 1); close(axis.y, 0);
  G.Game.onPress({ code: 'KeyV', owner: 'p1' });
  assert.equal(G.Renderer.getViewMode('p1'), 'first');
  assert.equal(G.Renderer.getViewMode('p2'), 'third');
  canvas.dispatchEvent({ type: 'pointerdown', clientX: 900, clientY: 100, button: 0 });
  canvas.dispatchEvent({ type: 'pointermove', clientX: 1000, clientY: 100 });
  close(G.Renderer.getCameraYaw('p1'), Math.PI / 2);
});
test('first-person mouse look follows movement without holding or dragging', () => {
  reset();
  const canvas = elements.get('game');
  G.Game.onPress({ code: 'KeyV', owner: 'p1' });
  assert.equal(G.Renderer.getViewMode('p1'), 'first');
  // When pointer lock is rejected, browsers may expose movementX/Y as zero;
  // absolute pointer movement must still turn A without a held button.
  canvas.dispatchEvent({ type: 'pointerdown', clientX: 100, clientY: 100, button: 0 });
  canvas.dispatchEvent({ type: 'pointermove', clientX: 140, clientY: 110, movementX: 0, movementY: 0 });
  close(G.Renderer.getCameraYaw('p1'), 0.1);
  close(G.Renderer.getCameraYaw('p2'), 0);
  document.pointerLockElement = canvas;
  canvas.dispatchEvent({ type: 'pointermove', clientX: 140, clientY: 110, movementX: 12, movementY: -4 });
  close(G.Renderer.getCameraYaw('p1'), 0.13);
  // Esc is reserved for releasing pointer lock while it is active.
  G.Game.onPress({ code: 'Escape', owner: 'sys' });
  assert.equal(G.State.current, 'PLAY');
  document.pointerLockElement = null;
});
test('gamepad sticks/buttons affect B only and ignore keyboard arrows', () => {
  const w = reset(), a = position(w.p1);
  pad = { index: 0, id: 'Regression Xbox standard pad', axes: [0, -1, 1, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
  G.Input.pollGamepad(1 / 60);
  const b = position(w.p2); step();
  assert.ok(w.p2.y < b[1] - 20); assert.deepEqual(position(w.p1), a);
  close(G.Renderer.getCameraYaw('p1'), 0);
  assert.ok(G.Renderer.getCameraYaw('p2') > 0);
  pad.buttons[3].pressed = true; G.Input.pollGamepad(1 / 60);
  for (const event of G.Input.drain()) G.Game.onPress(event);
  assert.equal(G.Renderer.getViewMode('p2'), 'first');
  assert.equal(G.Renderer.getViewMode('p1'), 'third');
  pad.axes = [0, 0, 0, 0]; key('ArrowUp');
  const stopped = position(w.p2); step(); key('ArrowUp', false);
  assert.deepEqual(position(w.p2), stopped);
  pad.axes = [0, -1, 1, 0]; focused = false;
  const yaw = G.Renderer.getCameraYaw('p2'); G.Input.pollGamepad(1 / 60); step();
  assert.deepEqual(position(w.p2), stopped); close(G.Renderer.getCameraYaw('p2'), yaw);
  focused = true;
});
test('controller turning is consistent at 30, 60 and 120 fps', () => {
  for (const fps of [30, 60, 120]) {
    reset();
    for (let i = 0; i < fps; i++) G.Renderer.updateGamepadCamera('p2', 1, 0, 1 / fps);
    close(G.Renderer.getCameraYaw('p2'), 2.1);
  }
});
test('walking stops at walls and passes through the actual doorway', () => {
  // 新 GLB 布局：中央走廊畅通；北走廊墙 y=400，门洞中心 x=450/712/974/1236/1498，
  // 门洞半宽 75、膨胀 20 → 净通行 x∈[395,505] 等（约 110px，进出顺滑）。
  const w = reset(); Object.assign(w.p1, { floor: 1, x: 350, y: 490 });
  key('KeyW'); step(2); key('KeyW', false);
  assert.ok(w.p1.y >= 414, 'north room wall (solid segment) must block A');
  Object.assign(w.p1, { x: 450, y: 490 }); key('KeyW'); step(2); key('KeyW', false);
  assert.ok(w.p1.y < 300, 'door opening at x=450 must allow passage');
});
test('TPS camera and near plane stay outside walls at corners on the single floor', () => {
  const w = reset();
  // 新 GLB 布局的开阔采样点：走廊中心(x=450/974/1498, y=490)、北/南房间中心、
  // 以及地图角落。避免把玩家放在新墙体内导致相机从墙内出发。
  for (const floor of [1]) for (const point of [[450, 490], [974, 490], [1498, 490], [450, 300], [450, 680], [70, 70], [2335, 915]]) {
    Object.assign(w.p1, { floor, x: point[0], y: point[1] });
    for (const pitch of [-1, 0, 1]) for (let turn = 0; turn < 24; turn++) {
      G.Renderer.resetViews();
      G.Renderer.updateGamepadCamera('p1', turn * Math.PI / 12 / .21, pitch * 100, .1);
      G.Renderer.renderAll();
      const camera = frames[0].camera, base = (floor - 1) * 4.2;
      assert.ok(camera.position.y <= base + 3.22 + 1e-6);
      const actualYaw = G.Renderer.getCameraYaw('p1');
      const direction = camera.getWorldDirection(new Three.Vector3());
      const horizontal = Math.hypot(direction.x, direction.z);
      close(direction.x / horizontal, Math.sin(actualYaw));
      close(-direction.z / horizontal, Math.cos(actualYaw));
      const samples = [camera.position];
      for (const x of [-1, 1]) for (const y of [-1, 1]) samples.push(new Three.Vector3(x, y, -1).unproject(camera));
      for (const wall of w.walls.filter(b => b.floor === floor)) {
        const box = new Three.Box3(new Three.Vector3(wall.x / 100, base, wall.y / 100 - 4.9), new Three.Vector3((wall.x + wall.w) / 100, base + 3.5, (wall.y + wall.h) / 100 - 4.9));
        for (const sample of samples) assert.ok(!box.containsPoint(sample), `camera entered wall at floor ${floor}, ${point}, yaw ${turn}, pitch ${pitch}`);
      }
    }
  }
});
test('walls block both entity rendering and interaction', () => {
  // 新 GLB 布局：走廊北墙 y=400，墙段（非门洞）挡视线；门洞 x=450 处可透视。
  const w = reset(); Object.assign(w.p1, { floor: 1, x: 350, y: 490 });
  const npcs = w.entities.filter(e => e.kind === 'npc');
  const npc = npcs[0];
  // 单层后所有 NPC 都在 1F；隔离出唯一目标，避免其它随机 NPC 干扰辨认/伤害判定。
  npcs.slice(1).forEach(e => { e.alive = false; });
  Object.assign(w.p2, { x: 1885, y: 490 }); // 拉开距离，避免触发双向相认
  Object.assign(npc, { floor: 1, x: 350, y: 360, state: 'still' });
  assert.equal(G.Renderer.canSee(w, w.p1, npc), false, 'solid corridor wall must block sight');
  G.Renderer.renderAll(); assert.ok(!frames[0].visible.includes('entity-' + npc.id));
  const hp = w.p1.hp; G.Hospital.interact(w, 'p1', true); assert.equal(w.p1.hp, hp);
  Object.assign(w.p1, { x: 450 }); Object.assign(npc, { x: 450 });
  assert.equal(G.Renderer.canSee(w, w.p1, npc), true, 'doorway at x=450 must allow sight');
});
test('each screen uses its own eye-mounted flashlight; rebuild keeps a single floor', () => {
  reset(); G.Renderer.renderAll();
  frames.forEach((frame, index) => {
    const role = index ? 'p2' : 'p1', p = G.Game.world[role];
    assert.equal(frame.lights.length, 1); assert.equal(frame.lights[0].name, 'flashlight-' + role);
    close(frame.lights[0].position.x, p.x / 100);
    // 眼高已从人物 1.6m 时代的 1.58 下移到与 0.8m 人物头部齐平的 0.76。
    close(frame.lights[0].position.y, (p.floor - 1) * 4.2 + 0.76);
  });
  for (let i = 0; i < 3; i++) { reset(); G.Renderer.renderAll(); }
  const floorGroups = frames[0].scene.children.filter(x => /^hospital-floor-/.test(x.name));
  assert.equal(floorGroups.length, 1, 'only one hospital floor group should exist');
  assert.equal(floorGroups[0].name, 'hospital-floor-1');
  assert.equal(frames[0].scene.children.filter(x => x.name === 'stairwell-core').length, 0);
});
test('第一人称相机眼高与 0.8m 人物头部齐平（0.76m），不再用旧 1.58', () => {
  reset();
  G.Game.onPress({ code: 'KeyV', owner: 'p1' }); // p1 切到第一人称
  assert.equal(G.Renderer.getViewMode('p1'), 'first');
  G.Renderer.renderAll();
  const frame = frames[0];
  const p = G.Game.world.p1;
  // 第一人称相机必须落在玩家眼部高度 ≈ 0.76m（人物总高 0.8m 的头顶稍下）。
  close(frame.camera.position.y, (p.floor - 1) * 4.2 + 0.76);
  assert.ok(frame.camera.position.y < (p.floor - 1) * 4.2 + 1.0,
    '第一人称眼高不应回到 1.58m 的旧高度');
  // 手电也应从同一眼高发出。
  close(frame.lights[0].position.y, (p.floor - 1) * 4.2 + 0.76);
  // p2 仍为第三人称，其取景基准同样降到 0.76 附近（越低越贴人物）。
  const p2 = G.Game.world.p2;
  close(frames[1].lights[0].position.y, (p2.floor - 1) * 4.2 + 0.76);
});
test('loaded props retain normalized centers when placed in the hospital', () => {
  const bed = pendingAssets.find(x => x.url.endsWith('prop_hospital_bed.glb'));
  const source = new Three.Group();
  const mesh = new Three.Mesh(new Three.BoxGeometry(20, 10, 5)); mesh.position.set(30, 25, -40); source.add(mesh);
  bed.callback({ scene: source }); G.Renderer.renderAll();
  const floor = frames[0].scene.getObjectByName('hospital-floor-1');
  const instance = floor.children.find(x => x.userData.sourceBounds);
  const bounds = new Three.Box3().setFromObject(instance), center = bounds.getCenter(new Three.Vector3());
  close(center.x, instance.position.x); close(center.z, instance.position.z); close(bounds.min.y, instance.position.y);
  close(bounds.getSize(new Three.Vector3()).x, 2.1);
});
// ========== 照射冻结与是/否判定 ==========
// 把 A 放到 B 的正前方（A 朝 +x 方向看，B 在其右侧 200 单位处）
function aimAt(w, shooter, victim) {
  Object.assign(w[shooter], { floor: 1, x: 800, y: 490 });
  Object.assign(w[victim], { floor: 1, x: 950, y: 490 });
}
test('照到对方：对方冻结不能移动，照方按 Y 判定"是"后立即解除', () => {
  const w = reset(); aimAt(w, 'p1', 'p2');
  // 直接用 beam 模块验证命中（朝向由测试直接给出，不依赖相机 yaw 数值）
  const hit = G.Beam.beamHits(w.p1, { x: 1, z: 0 }, w.p2, null);
  assert.equal(hit, true, 'A 朝向 B 时应命中');
  G.Beam.update(w, { p1: { x: 1, z: 0 }, p2: { x: -1, z: 0 } }, 1 / 60);
  assert.equal(G.Beam.isFrozen(w, 'p2'), true, 'B 应被冻结');
  assert.equal(G.Beam.canAct(w, 'p2'), false);
  const before = [w.p2.x, w.p2.y];
  key('KeyS'); step(0.5); key('KeyS', false);
  assert.deepEqual([w.p2.x, w.p2.y], before, '冻结中的 B 不能移动');
  G.Game.onPress({ code: 'KeyY', owner: 'p1' });
  assert.equal(G.Beam.isFrozen(w, 'p2'), false, 'A 判定"是"后 B 立即解除');
  assert.equal(w.p1.confirmedYes.p2, true, '判定记在照方 A 身上');
  assert.equal(w.p2.confirmedYes, undefined, 'B 没有做出判定');
});
test('照方按 N 判定"否"：解除冻结，但不触发相认', () => {
  const w = reset(); aimAt(w, 'p1', 'p2');
  G.Beam.update(w, { p1: { x: 1, z: 0 }, p2: { x: -1, z: 0 } }, 1 / 60);
  G.Game.onPress({ code: 'KeyN', owner: 'p1' });
  assert.equal(G.Beam.isFrozen(w, 'p2'), false);
  assert.equal(w.p1.confirmedYes.p2, false);
  assert.equal(G.State.current, 'PLAY', '否判定不结束游戏');
});
test('双向照射：两人各自冻结，各自用自己的键判定，互不影响', () => {
  const w = reset(); aimAt(w, 'p1', 'p2');
  // 两人互相对着
  G.Beam.update(w, { p1: { x: 1, z: 0 }, p2: { x: -1, z: 0 } }, 1 / 60);
  assert.equal(G.Beam.isFrozen(w, 'p1'), true, 'B 照到 A 时 A 冻结');
  assert.equal(G.Beam.isFrozen(w, 'p2'), true, 'A 照到 B 时 B 冻结');
  // A 判定 B 是
  G.Game.onPress({ code: 'KeyY', owner: 'p1' });
  assert.equal(G.Beam.isFrozen(w, 'p2'), false, 'B 解除');
  assert.equal(G.Beam.isFrozen(w, 'p1'), true, 'A 仍被 B 照住，不受 A 的判定影响');
  // B 用 Quote 判定 A 是 → 双向都确认 → 相认
  G.Game.onPress({ code: 'Quote', owner: 'p2' });
  assert.equal(G.Beam.isFrozen(w, 'p1'), false);
  assert.equal(w.p1.confirmedYes.p2, true);
  assert.equal(w.p2.confirmedYes.p1, true);
  assert.equal(G.State.current, 'RESULT', '双向确认后进入相认结局');
});
test('松开光束超过 1.5 秒自动解除，不超过则保持冻结', () => {
  const w = reset(); aimAt(w, 'p1', 'p2');
  G.Beam.update(w, { p1: { x: 1, z: 0 }, p2: { x: -1, z: 0 } }, 1 / 60);
  // 松开光束（A 转走，朝向 -x）
  for (let i = 0; i < 80; i++) G.Beam.update(w, { p1: { x: -1, z: 0 }, p2: { x: -1, z: 0 } }, 1 / 60);
  assert.equal(G.Beam.isFrozen(w, 'p2'), true, '1.33 秒仍应冻结');
  for (let i = 0; i < 30; i++) G.Beam.update(w, { p1: { x: -1, z: 0 }, p2: { x: -1, z: 0 } }, 1 / 60);
  assert.equal(G.Beam.isFrozen(w, 'p2'), false, '超过 1.5 秒自动解除');
});
test('冻结中按辨认键 F 无效（不能辨认）', () => {
  const w = reset(); aimAt(w, 'p1', 'p2');
  G.Beam.update(w, { p1: { x: 1, z: 0 }, p2: { x: -1, z: 0 } }, 1 / 60);
  G.Hospital.interact(w, 'p2', true);
  assert.match(w.p2.notice, /动不了|操作不了/);
});
test('无所畏惧卡：被照射也能正常移动', () => {
  const w = reset(); aimAt(w, 'p1', 'p2');
  w.p2.beam = G.Beam.effectiveBeam(G.Beam.CARDS.find(c => c.id === 'nerveless'));
  G.Beam.update(w, { p1: { x: 1, z: 0 }, p2: { x: -1, z: 0 } }, 1 / 60);
  assert.equal(G.Beam.canAct(w, 'p2'), true);
});
test('天崩开局：照射范围缩到 5m，超出范围不冻结', () => {
  const eff = G.Beam.effectiveBeam(G.Beam.CARDS.find(c => c.id === 'brokenLens'));
  assert.equal(eff.range, 500);
  const shooter = { x: 0, y: 0, floor: 1 }, target = { x: 800, y: 0, floor: 1 };
  assert.equal(G.Beam.beamHits(shooter, { x: 1, z: 0 }, target, { range: eff.range, halfAngle: eff.halfAngle }), false);
  assert.equal(G.Beam.beamHits(shooter, { x: 1, z: 0 }, target, null), true, '默认 12m 内应命中');
});
test('开局抽卡：每局两人各抽一张，卡效果只写入各自玩家', () => {
  const w = reset();
  assert.ok(w.p1.beamCard && w.p2.beamCard, '两人都应抽到卡');
  assert.ok(G.Beam.CARDS.some(c => c.id === w.p1.beamCard.id));
  assert.ok(w.p1.beam && typeof w.p1.beam.range === 'number');
});
test('木乃伊化：P1 与 P2 的身体基础体相同，差异只来自 traits', () => {
  const w = reset();
  assert.equal(w.p1.trueForm, 'mummy');
  assert.equal(w.p2.trueForm, 'mummy');
  assert.ok(w.p1.traits.length >= 1 && w.p2.traits.length >= 1);
  assert.equal(w.p1.traits.some(t => w.p2.traits.indexOf(t) >= 0), false, '两名玩家不应共享同一特征（否则无法区分）');
});
test('NPC 数量 8 个，全部木乃伊', () => {
  const w = reset();
  const npcs = w.entities.filter(e => e.kind === 'npc');
  assert.equal(npcs.length, 8);
  npcs.forEach(n => assert.equal(n.trueForm, 'mummy'));
});

test('墙体阻挡光束，确认后持续照射不会再次冻结', () => {
  const w=reset(); aimAt(w,'p1','p2');
  const dirs={p1:{x:1,z:0},p2:{x:1,z:0}};
  w.walls.push({floor:1,x:870,y:450,w:20,h:80});
  G.Beam.update(w,dirs,.1); assert.equal(G.Beam.isFrozen(w,'p2'),false);
  w.walls.pop(); G.Beam.update(w,dirs,.1); assert.equal(G.Beam.isFrozen(w,'p2'),true);
  G.Game.onPress({code:'KeyN',owner:'p1'}); G.Beam.update(w,dirs,.1);
  assert.equal(G.Beam.isFrozen(w,'p2'),false);
  G.Beam.update(w,{p1:{x:-1,z:0},p2:dirs.p2},.1); G.Beam.update(w,dirs,.1);
  assert.equal(G.Beam.isFrozen(w,'p2'),true);
});
test('闪光卡仅在触发时照亮并短暂冻结，手柄方向键可确认普通照射', () => {
  const w=reset(); aimAt(w,'p1','p2');
  w.p1.beam=G.Beam.effectiveBeam(G.Beam.CARDS.find(c=>c.id==='strobe'));
  const dirs={p1:{x:1,z:0},p2:{x:-1,z:0}};
  G.Beam.update(w,dirs,.01); assert.equal(G.Beam.isFrozen(w,'p2'),false);
  G.Beam.flash(w,'p1'); G.Beam.update(w,dirs,.01); assert.equal(G.Beam.isFrozen(w,'p2'),true);
  assert.equal(G.Beam.confirm(w,'p1',true).ok,false);
  G.Beam.update(w,dirs,.51); assert.equal(G.Beam.isFrozen(w,'p2'),false);
  assert.equal(G.Beam.isFrozen(w,'p1'),true);
  G.Game.onPress({code:'GamepadDown',owner:'p2',source:'gamepad'});
  assert.equal(G.Beam.isFrozen(w,'p1'),false); assert.equal(w.p2.confirmedYes.p1,false);
});
test('线索归属与目标玩家外貌一致', () => {
  const w=reset();
  for(const id of ['clueA','clueA2']) assert.ok(w.p2.traits.includes(w.byId[id].trait));
  for(const id of ['clueB','clueB2']) assert.ok(w.p1.traits.includes(w.byId[id].trait));
});

test('转盘独立启动，动画期间不发卡或重复抽取，双方确认后进入游戏', () => {
  G.Game.reset('duo');const w=G.Game.world;
  assert.equal(w.p1.beamCard,null);assert.equal(w.p2.beamCard,null);
  G.Game.onPress({code:'Enter',owner:'sys'});
  const chosen=w.p1.roulette.card;
  G.Game.onPress({code:'KeyY',owner:'p1'});
  assert.equal(w.p1.roulette.card,chosen);assert.equal(w.p2.roulette.phase,'idle');
  G.Game.updateWheels(2);assert.equal(w.p1.beamCard,null);assert.equal(G.State.current,'DRAW');
  G.Game.onPress({code:'GamepadA',owner:'p2',source:'gamepad'});
  G.Game.updateWheels(3);
  assert.equal(w.p1.roulette.phase,'revealed');assert.equal(w.p2.roulette.phase,'spinning');
  const sector=360/G.Beam.CARDS.length;
  assert.ok(Math.abs((w.p1.roulette.rotation+(w.p1.roulette.index+.5)*sector)%360)<1e-7);
  G.Game.onPress({code:'KeyY',owner:'p1'});assert.equal(w.p1.cardReady,true);assert.equal(G.State.current,'DRAW');
  G.Game.updateWheels(2);G.Game.onPress({code:'GamepadA',owner:'p2',source:'gamepad'});
  assert.equal(G.State.current,'PLAY');assert.equal(w.p1.beamCard,chosen);
});

test('确认顺序可交换：B 先确认后 A 仍可确认并进入游戏', () => {
  G.Game.reset('duo'); const w=G.Game.world;
  G.Game.onPress({code:'Enter',owner:'p1'});
  G.Game.onPress({code:'GamepadA',owner:'p2',source:'gamepad'});
  G.Game.updateWheels(5);
  G.Game.onPress({code:'GamepadA',owner:'p2',source:'gamepad'});
  assert.equal(w.p2.cardReady,true); assert.equal(G.State.current,'DRAW');
  G.Game.onPress({code:'Enter',owner:'p1'});
  assert.equal(w.p1.cardReady,true); assert.equal(G.State.current,'PLAY');
});

test('普通模式可跳过转盘动画并直接随机揭晓，各自仍需确认', () => {
  G.Game.reset('duo'); const w=G.Game.world;
  assert.equal(G.Game.skipWheel('p1'),true);
  assert.equal(w.p1.roulette.phase,'revealed');
  assert.ok(w.p1.beamCard&&G.Beam.CARDS.some(c=>c.id===w.p1.beamCard.id));
  G.Game.onPress({code:'KeyY',owner:'p1'});
  assert.equal(w.p1.cardReady,true);
  G.Game.onPress({code:'GamepadX',owner:'p2',source:'gamepad'});
  assert.equal(w.p2.roulette.phase,'revealed');
});

test('调试模式可自由选六张卡、明亮模式和双人确认', () => {
  G.Game.reset('debug'); const w=G.Game.world;
  assert.equal(G.Game.debugMode,true); assert.equal(w.brightMode,true, '调试模式默认全亮');
  G.Game.onPress({code:'Digit6',owner:'p1'});
  assert.equal(w.p1.beamCard.id,G.Beam.CARDS[5].id);
  G.Game.onPress({code:'GamepadUp',owner:'p2',source:'gamepad'});
  G.Game.onPress({code:'GamepadUp',owner:'p2',source:'gamepad'});
  G.Game.onPress({code:'GamepadA',owner:'p2',source:'gamepad'});
  assert.equal(w.p2.beamCard.id,G.Beam.CARDS[2].id);
  G.Game.onPress({code:'KeyL',owner:'p1'}); assert.equal(w.brightMode,false);
  G.Game.onPress({code:'KeyL',owner:'p1'}); assert.equal(w.brightMode,true);
  G.Game.onPress({code:'KeyY',owner:'p1'});
  assert.equal(w.p1.cardReady,true); assert.equal(G.State.current,'DRAW');
  G.Game.onPress({code:'GamepadA',owner:'p2',source:'gamepad'});
  assert.equal(G.State.current,'PLAY');
});

test('调试模式小地图显示同层队友位置，普通模式隐藏队友位置', () => {
  G.Game.reset('debug'); const w=G.Game.world;
  Object.assign(w.p1,{floor:1,x:500,y:300});
  Object.assign(w.p2,{floor:1,x:1500,y:700});
  mapDots.length=0; G.UI.update(w);
  assert.ok(mapDots.some(d=>Math.abs(d.x-1500/2400*220)<1e-6&&Math.abs(d.y-700/980*110)<1e-6&&d.color==='#f18ac4'), 'A 地图应显示 B 的位置');
  assert.ok(mapDots.some(d=>Math.abs(d.x-500/2400*220)<1e-6&&Math.abs(d.y-300/980*110)<1e-6&&d.color==='#7fd7ee'), 'B 地图应显示 A 的位置');
  w.debugMode=false; mapDots.length=0; G.UI.update(w);
  assert.ok(!mapDots.some(d=>Math.abs(d.x-1500/2400*220)<1e-6&&Math.abs(d.y-700/980*110)<1e-6&&d.color==='#f18ac4'), '普通模式应隐藏队友标记');
});

test('同层玩法：危险区扣共享血量并逐步模糊，离开后恢复', () => {
  const w = reset();
  w.p1.floor = w.p2.floor = 1;
  Object.assign(w.p1, { x: 1200, y: 490 });
  Object.assign(w.p2, { x: 1885, y: 490 });
  const hp = w.sharedHp;
  step(3);
  assert.ok(w.sharedHp < hp, '危险区应扣共享血量');
  assert.ok(w.p1.visionBlur > 0, '危险区应造成视野模糊');
  assert.ok(w.p1.heartLevel >= 1, '同层十米内心率应升高');
  Object.assign(w.p1, { x: 400, y: 490 }); step(4);
  assert.ok(w.p1.visionBlur < .2, '离开危险区后视野应恢复');
});

test('共享血量归零后倒地，另一名玩家靠近长按确认完成救援', () => {
  const w = reset();
  w.sharedHp = w.p1.hp = w.p2.hp = 1;
  G.Hazard.damage(w, 2, { downedRole: 'p1' });
  assert.equal(w.downedRole, 'p1'); assert.equal(w.p1.downed, true);
  Object.assign(w.p1, { floor: 1, x: 1000, y: 490 });
  Object.assign(w.p2, { floor: 1, x: 1040, y: 490 });
  step(2.1);
  assert.equal(w.downedRole, null); assert.equal(w.sharedHp, 35);
});

test('三秒双向相认进入逃生阶段，双方抵达出口后胜利', () => {
  const w = reset();
  w.p1.floor = w.p2.floor = 1;
  Object.assign(w.p1, { x: 800, y: 490 }); Object.assign(w.p2, { x: 860, y: 490 });
  G.Hospital.interact(w, 'p1', true);
  assert.equal(w.recognition.state, 'active'); assert.equal(G.State.current, 'PLAY');
  G.Hospital.interact(w, 'p2', true);
  assert.equal(w.escape.active, true); assert.equal(G.State.current, 'ESCAPE');
  w.entities.filter(e => e.kind === 'zombie').forEach(e => { e.alive = false; });
  Object.assign(w.p1, { x: 2290, y: 490 }); Object.assign(w.p2, { x: 2290, y: 490 });
  step(.1);
  assert.equal(w.ended, true); assert.equal(w.ending, 'escaped');
});

test('相认成功后小地图显示出口，一人倒下时幸存者到达出口也能逃生', () => {
  const w = reset();
  w.p1.floor = w.p2.floor = 1;
  const exit = w.entities.find(e => e.kind === 'exit');
  exit.floor = 1;
  Object.assign(w.p1, { x: 800, y: 490 }); Object.assign(w.p2, { x: 860, y: 490 });
  G.Hospital.interact(w, 'p1', true); G.Hospital.interact(w, 'p2', true);
  mapDots.length = 0; G.UI.update(w);
  assert.ok(mapDots.some(d => Math.abs(d.x - exit.x / 2400 * 220) < 1e-6 && d.color === '#ffd166'), '相认后地图应显示出口');
  w.p1.downed = true; w.p1.hp = 0; w.downedRole = 'p1';
  Object.assign(w.p2, { x: exit.x, y: exit.y });
  step(.1);
  assert.equal(w.ended, true, '一人倒下后幸存者到达出口应结束游戏');
  assert.equal(w.ending, 'escaped');
});

test('相认由同一个辨认动作发起和回应，不受 NPC 抢目标影响', () => {
  const w = reset();
  w.p1.floor = w.p2.floor = 1;
  Object.assign(w.p1, { x: 800, y: 490 }); Object.assign(w.p2, { x: 950, y: 490 });
  const npc = w.entities.find(e => e.kind === 'npc' && e.floor === 1);
  if (npc) Object.assign(npc, { x: 810, y: 490, alive: true });
  G.Game.onPress({ code: 'KeyF', owner: 'p1' });
  assert.equal(w.recognition.state, 'active', 'A 用辨认键发起相认');
  assert.equal(w.recognition.participants.p1, true);
  assert.equal(w.escape.active, false, '单人发起后应等待回应');
  G.Game.onPress({ code: 'GamepadX', owner: 'p2', source: 'gamepad' });
  assert.equal(w.recognition.participants.p2, true, 'B 用手柄同一个辨认键回应');
  assert.equal(w.escape.active, true, '双方回应后立刻进入逃生阶段');
  assert.equal(G.State.current, 'ESCAPE');
});

// ========== 单层世界数据断言 ==========
test('单层世界：楼层表只含 1F，所有实体/墙/科室都在 1F，无楼梯实体', () => {
  const w = reset();
  assert.deepEqual(Object.keys(G.Level.departments), ['1']);
  assert.equal(w.floorCount, 1);
  assert.equal(JSON.stringify(w.floorNames), JSON.stringify({ 1: '一楼' }));
  assert.ok(w.entities.every(e => e.floor === 1), '所有实体应在 1F');
  assert.ok(w.walls.every(b => b.floor === 1), '所有墙应在 1F');
  assert.ok(!w.entities.some(e => e.kind === 'stairs'), '不应存在楼梯实体');
  assert.ok(!w.walls.some(b => /stair/i.test(b.kind || '')), '不应存在楼梯墙');
});

// ========== 新 GLB 场景碰撞一致性：视觉空地必须真能走 ==========
test('碰撞墙与新 GLB 场景对齐：中央走廊全程畅通、无横墙误挡', () => {
  const w = reset();
  // 复现游戏 blocked() 的判定（每边膨胀 = G.collidePad），验证视觉上的空地确实可走。
  const pad = G.collidePad;
  const hit = (x, y) => w.walls.some(b =>
    b.floor === 1 && x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad);
  // 1) 中央走廊 y=490：沿 X 从 100 到 1900 全程不得被任何墙挡住（旧布局横穿的竖墙必须清除）。
  for (let x = 100; x <= 1900; x += 20) {
    assert.ok(!hit(x, 490), `中央走廊 (${x},490) 不应有隐形墙`);
  }
  // 2) 走廊带宽：y∈[450,540] 的任何点都应畅通（走廊内部无横墙）。
  for (let x = 100; x <= 1900; x += 40) for (let y = 450; y <= 540; y += 15) {
    assert.ok(!hit(x, y), `走廊内部 (${x},${y}) 不应有墙`);
  }
  // 3) 房间隔墙仍在正确位置（x≈318/580/842/1104/1366/1628 的墙段真实存在）。
  [318, 580, 842, 1104, 1366, 1628].forEach(cx => {
    assert.ok(hit(cx, 300), `北侧隔墙 x=${cx} 应存在`);
    assert.ok(hit(cx, 680), `南侧隔墙 x=${cx} 应存在`);
  });
  // 4) 门洞中心可进出房间：门洞 x∈{450,712,974,1236,1498} 在走廊墙上无墙。
  [450, 712, 974, 1236, 1498].forEach(cx => {
    assert.ok(!hit(cx, 400), `北门洞 x=${cx} 应畅通`);
    assert.ok(!hit(cx, 580), `南门洞 x=${cx} 应畅通`);
  });
  // 5) 门洞通行容差：玩家不必精确对齐门中心，偏移 ±40px 也应能从走廊进入房间。
  //    旧布局(GAP=90,PAD=26)净通行仅 38px、容差 ±10px，稍偏就卡住——这是本次修复的核心。
  [450, 712, 974, 1236, 1498].forEach(cx => {
    [-40, -20, 0, 20, 40].forEach(off => {
      // 从走廊 y=490 到北房间 y=250 的竖直通道上，每个采样点都不能被墙挡。
      for (let y = 490; y >= 250; y -= 15) {
        assert.ok(!hit(cx + off, y), `北门洞 x=${cx}${off >= 0 ? '+' : ''}${off} 通道 (${cx + off},${y}) 不应卡住`);
      }
    });
  });
});

// ========== 医院场景 GLB 断言 ==========
test('医院场景 GLB：结构件完整显示、装饰射线禁用，不叠加任何旧程序化残留物，归一化后挂到 1F', () => {
  const sceneAsset = pendingAssets.find(x => x.url.endsWith('hospital_1f.glb'));
  assert.ok(sceneAsset, '应请求医院场景 GLB');
  const src = new Three.Group();
  const wallMesh = new Three.Mesh(new Three.BoxGeometry(4, 3, 0.2), new Three.MeshBasicMaterial());
  wallMesh.name = 'WALL_partition';
  const decor = new Three.Mesh(new Three.BoxGeometry(1, 1, 1), new Three.MeshBasicMaterial());
  decor.name = 'prop_chair';
  src.add(wallMesh, decor);
  sceneAsset.callback({ scene: src });
  assert.equal(wallMesh.visible, true, 'WALL_ 结构件应完整显示（最新建模场景为画面主体）');
  assert.equal(wallMesh.material.side, Three.DoubleSide, '墙/门框应从走廊内部双面可见，避免背面剔除成空洞');
  // 结构大面保留 raycast，供第三人称相机避障（否则相机穿进墙出现黑色遮挡板）
  assert.equal(wallMesh.raycast, Three.Mesh.prototype.raycast, 'WALL_ 结构件应保留原生 raycast 供相机避障');
  // 装饰件应禁用 raycast 控制性能
  assert.equal(decor.raycast.toString().indexOf('ray') < 0, true, '装饰件射线应为禁用空函数');
  assert.equal(decor.visible, true, '装饰件应可见');
  G.Renderer.renderAll();
  const floorGroup = frames[0].scene.getObjectByName('hospital-floor-1');
  assert.ok(floorGroup, '应存在 1F 房间组');
  const glbInstance = floorGroup.children.find(x => x.userData && x.userData.sourceBounds && x.userData.sourceBounds.x === 4);
  assert.ok(glbInstance, '归一化后的医院 GLB 应挂到 1F');
  // 归一化足迹：宽度映射到 24m，取 min(sx,sz)，此处 size.x=4 -> 6 倍缩放落在 anchor 子节点
  const anchor = glbInstance.children[0];
  assert.ok(Math.abs(anchor.scale.x - 6) < 1e-6, '应按 24/4=6 缩放到逻辑足迹');
  // GLB 到位后：画面只显示新场景，不再生成任何旧程序化残留物（床/桌/椅/墙/标识等）。
  // 碰撞/遮挡/相机避障仍走 w.walls 逻辑 + GLB 的 WALL_ 结构件原生 raycast。
  const legacyNames = /^(floor|north-wall|south-wall|west-wall|east-wall|ceiling-(trim|light)-|proc-wall-|department-sign|corridor-sign|fire-extinguisher|exit-sign|warn-line|bed-fallback|mattress-fallback|nightstand|iv-pole|iv-bag|trolley-fallback|desk-|chair-)/;
  const legacy = floorGroup.children.filter(x => legacyNames.test(x.name));
  assert.equal(legacy.length, 0, 'GLB 到位后不应生成任何旧程序化残留物：' + legacy.map(x => x.name).join(','));
  // 程序化家具 GLB（床/推车）也不再叠加到新场景
  const bedProps = floorGroup.children.filter(x => x.userData && x.userData.sourceBounds && x !== glbInstance);
  assert.equal(bedProps.length, 0, '新场景不应再叠加旧的病床/推车道具实例');
});

test('医院 GLB 地板顶面必须落在世界 y=0（不被地下几何抬高），且地板 slab 基准记录正确', () => {
  const sceneAsset = pendingAssets.find(x => x.url.endsWith('hospital_1f.glb'));
  const src = new Three.Group();
  // 模拟真实资产：地板顶面在局部 y=0，另有一块地下室几何延伸到 y=-3.4（会把整体 bbox min 拉低）
  const floorSlab = new Three.Mesh(new Three.BoxGeometry(26, 0.4, 10), new Three.MeshBasicMaterial());
  floorSlab.name = 'WALL_FLOOR_slab'; floorSlab.position.set(12, -0.2, 0); // 顶面 y=0
  const basement = new Three.Mesh(new Three.BoxGeometry(4, 3, 4), new Three.MeshBasicMaterial());
  basement.name = 'basement'; basement.position.set(2, -2, 0); // 局部最低 y=-3.5
  src.add(floorSlab, basement);
  sceneAsset.callback({ scene: src });
  G.Renderer.renderAll();
  const floorGroup = frames[0].scene.getObjectByName('hospital-floor-1');
  const glbInstance = floorGroup.children.find(x => x.userData && x.userData.sourceBounds);
  assert.ok(glbInstance, '医院 GLB 应挂到 1F');
  // 关键断言：归一化基准是地板顶面而非整体 bbox min
  assert.ok(Math.abs(glbInstance.userData.floorTopLocalY - 0) < 1e-6,
    '应以地板 slab 顶面(局部 y=0)为对齐基准，而非整体 bbox min(-3.5)');
  // anchor.position.y = -floorTopLocalY * s = 0 → 地板顶面落在世界 y=0
  const anchor = glbInstance.children[0];
  assert.ok(Math.abs(anchor.position.y) < 1e-6, '地板顶面应落在世界 y=0，不能把整栋楼抬高');
});

test('角色与物体不再带 __outline__ 发光描边方块，也不再有荧光 glow 网格', () => {
  const w = reset();
  G.Renderer.renderAll();
  let outlineCount = 0, glowCount = 0;
  frames[0].scene.traverse(obj => {
    if (obj.name === '__outline__') outlineCount++;
    if (/__glow|clue-glow|phone-glow|exit-glow/.test(obj.name)) glowCount++;
  });
  assert.equal(outlineCount, 0, '不应存在 __outline__ 发光描边方块（会包裹角色）');
  assert.equal(glowCount, 0, '不应存在荧光发光层网格');
});

// ========== 动画木乃伊 GLB 断言 ==========
test('动画木乃伊 GLB：带 mixer/三条动作，无方块挂件，高度≈0.8m(上一版一半)，材质共享', () => {
  const mummyAsset = pendingAssets.find(x => x.url.endsWith('mummy_animated.glb'));
  assert.ok(mummyAsset, '应请求木乃伊动画 GLB');
  const src = new Three.Group();
  const body = new Three.Mesh(new Three.BoxGeometry(1, 2, 1), new Three.MeshStandardMaterial());
  body.name = 'output_unwrapped';
  src.add(body);
  ['forearm.L', 'chest', 'hand.L', 'head', 'hand.R'].forEach(n => {
    const bone = new Three.Object3D(); bone.name = n; src.add(bone);
  });
  const clips = ['Idle', 'Walk', 'Limp_Right'].map(n => new Three.AnimationClip(n, 1, []));
  mummyAsset.callback({ scene: src, animations: clips });

  const w = reset();
  G.Renderer.renderAll();
  const p1obj = frames[0].scene.getObjectByName('entity-p1');
  const p2obj = frames[0].scene.getObjectByName('entity-p2');
  assert.ok(p1obj.userData.mixer, '角色实体应带 AnimationMixer');
  assert.deepEqual(Object.keys(p1obj.userData.actions).sort(), ['Idle', 'Limp_Right', 'Walk']);
  assert.ok(p1obj.userData.mixer && p2obj.userData.mixer, '两名玩家都应各自持有 mixer');
  // 角色身上不生成任何 trait 方块挂件（旧版深色外套是套在胸前的灰色方块，已移除）
  let traitBoxes = 0;
  frames[0].scene.traverse(obj => { if (/^trait-/.test(obj.name)) traitBoxes++; });
  assert.equal(traitBoxes, 0, '不应存在 trait- 方块挂件（人物身上不能有方块壳）');
  // trait 数据仍保留供辨认/动画逻辑使用
  assert.ok((p1obj.userData.traits || []).length >= 1, 'trait 数据应保留在 userData');
  // 高度归一化到 0.8m（上一版 1.6m 的一半），mock body 原始高 2 → scale=0.4
  p1obj.updateMatrixWorld(true);
  const h = new Three.Box3().setFromObject(p1obj).getSize(new Three.Vector3()).y;
  assert.ok(Math.abs(h - 0.8) < 1e-3, `角色高度应≈0.8m(上一版一半)，实际 ${h.toFixed(3)}m`);
  // 共享材质：cloneSkinned 不复制材质，两个实例的同一网格应指向同一材质对象
  const m1 = p1obj.getObjectByName('output_unwrapped');
  const m2 = p2obj.getObjectByName('output_unwrapped');
  assert.ok(m1 && m2, '两个角色实例都应有基础网格');
  assert.equal(m1.material, m2.material, '角色材质应共享，不按实例 clone');
});

test('角色动画：limpGait 移动播放 Limp_Right，其余移动播放 Walk，静止回到 Idle', () => {
  const w = reset();
  G.Renderer.renderAll();
  const p1obj = frames[0].scene.getObjectByName('entity-p1');
  const p2obj = frames[0].scene.getObjectByName('entity-p2');
  // p2 带 limpGait，移动时应播放 Limp_Right
  Object.assign(w.p2, { moving: true, state: 'walk' });
  G.Renderer.renderAll();
  assert.equal(p2obj.userData.activeClip, 'Limp_Right');
  // p1 无 limpGait，移动时播放 Walk
  Object.assign(w.p1, { moving: true, state: 'walk' });
  G.Renderer.renderAll();
  assert.equal(p1obj.userData.activeClip, 'Walk');
  // 静止回到 Idle
  Object.assign(w.p1, { moving: false, state: 'still' });
  Object.assign(w.p2, { moving: false, state: 'still' });
  G.Renderer.renderAll();
  assert.equal(p1obj.userData.activeClip, 'Idle');
  assert.equal(p2obj.userData.activeClip, 'Idle');
});

console.log(`\n${checks} regression groups passed. GPU rendering and physical controller not simulated.`);
