// Runs production gameplay/input/camera code with real Three.js math and a CPU render sink.
// GPU shading and physical controller compatibility still require browser/hardware checks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as Three from '../vendor/three/three.module.js';

const root = fileURLToPath(new URL('../', import.meta.url));
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
const context = vm.createContext({ window, document, navigator: { getGamepads: () => pad ? [pad] : [] }, performance, console, Event, requestAnimationFrame() {}, THREE: { ...Three, WebGLRenderer: RenderSink }, GLTFLoader: Loader });
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
  const w = reset(); Object.assign(w.p1, { floor: 1, x: 400, y: 490 });
  key('KeyW'); step(2); key('KeyW', false);
  assert.ok(w.p1.y >= 414, 'north room wall must block A');
  Object.assign(w.p1, { x: 485, y: 490 }); key('KeyW'); step(2); key('KeyW', false);
  assert.ok(w.p1.y < 300, 'door opening must allow passage');
});
test('TPS camera and near plane stay outside walls at corners on all floors', () => {
  const w = reset();
  for (const floor of [1, 2, 3, 4]) for (const point of [[400, 580], [400, 420], [620, 420], [485, 490], [70, 70], [2335, 915]]) {
    Object.assign(w.p1, { floor, x: point[0], y: point[1] });
    for (const pitch of [-1, 0, 1]) for (let turn = 0; turn < 24; turn++) {
      G.Renderer.resetViews();
      G.Renderer.updateGamepadCamera('p1', turn * Math.PI / 12 / .21, pitch * 100, .1);
      G.Renderer.renderAll();
      const camera = frames[0].camera, base = (floor - 1) * 4.2;
      assert.ok(camera.position.y <= base + 3.22 + 1e-6);
      const direction = camera.getWorldDirection(new Three.Vector3());
      const horizontal = Math.hypot(direction.x, direction.z);
      close(direction.x / horizontal, Math.sin(turn * Math.PI / 12));
      close(-direction.z / horizontal, Math.cos(turn * Math.PI / 12));
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
  const w = reset(); Object.assign(w.p1, { floor: 1, x: 400, y: 420 });
  const npc = w.entities.find(e => e.kind === 'npc');
  Object.assign(npc, { floor: 1, x: 400, y: 350, state: 'still' });
  assert.equal(G.Renderer.canSee(w, w.p1, npc), false);
  G.Renderer.renderAll(); assert.ok(!frames[0].visible.includes('entity-' + npc.id));
  const hp = w.p1.hp; G.Hospital.interact(w, 'p1', true); assert.equal(w.p1.hp, hp);
  Object.assign(w.p1, { x: 485 }); Object.assign(npc, { x: 485 });
  assert.equal(G.Renderer.canSee(w, w.p1, npc), true);
});
test('each screen uses its own eye-mounted flashlight; rebuild keeps one stairwell', () => {
  reset(); G.Renderer.renderAll();
  frames.forEach((frame, index) => {
    const role = index ? 'p2' : 'p1', p = G.Game.world[role];
    assert.equal(frame.lights.length, 1); assert.equal(frame.lights[0].name, 'flashlight-' + role);
    close(frame.lights[0].position.x, p.x / 100);
    close(frame.lights[0].position.y, (p.floor - 1) * 4.2 + 1.58);
  });
  for (let i = 0; i < 3; i++) { reset(); G.Renderer.renderAll(); }
  assert.equal(frames[0].scene.children.filter(x => x.name === 'stairwell-core').length, 1);
});
test('loaded props retain normalized centers when placed in the hospital', () => {
  const bed = pendingAssets.find(x => x.url.endsWith('prop_hospital_bed.glb'));
  const source = new Three.Group();
  const mesh = new Three.Mesh(new Three.BoxGeometry(20, 10, 5)); mesh.position.set(30, 25, -40); source.add(mesh);
  bed.callback({ scene: source }); G.Renderer.renderAll();
  const floor = frames[0].scene.getObjectByName('hospital-floor-2');
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
  assert.equal(G.Game.debugMode,true); assert.equal(w.brightMode,false);
  G.Game.onPress({code:'Digit6',owner:'p1'});
  assert.equal(w.p1.beamCard.id,G.Beam.CARDS[5].id);
  G.Game.onPress({code:'GamepadUp',owner:'p2',source:'gamepad'});
  G.Game.onPress({code:'GamepadUp',owner:'p2',source:'gamepad'});
  G.Game.onPress({code:'GamepadA',owner:'p2',source:'gamepad'});
  assert.equal(w.p2.beamCard.id,G.Beam.CARDS[2].id);
  G.Game.onPress({code:'KeyL',owner:'p1'}); assert.equal(w.brightMode,true);
  G.Game.onPress({code:'KeyY',owner:'p1'});
  assert.equal(w.p1.cardReady,true); assert.equal(G.State.current,'DRAW');
  G.Game.onPress({code:'GamepadA',owner:'p2',source:'gamepad'});
  assert.equal(G.State.current,'PLAY');
});

test('同层玩法：危险区扣共享血量并逐步模糊，离开后恢复', () => {
  const w = reset();
  w.p1.floor = w.p2.floor = 2;
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
  Object.assign(w.p1, { floor: 2, x: 1000, y: 490 });
  Object.assign(w.p2, { floor: 2, x: 1040, y: 490 });
  step(2.1);
  assert.equal(w.downedRole, null); assert.equal(w.sharedHp, 35);
});

test('三秒双向相认进入逃生阶段，双方抵达出口后胜利', () => {
  const w = reset();
  w.p1.floor = w.p2.floor = 2;
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

console.log(`\n${checks} regression groups passed. GPU rendering and physical controller not simulated.`);
