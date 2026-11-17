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
for (const file of ['data/config.js', 'data/script.js', 'js/core.js', 'js/world.js', 'js/input.js', 'js/levels.js']) run(file);
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
function reset() { pad = null; G.Input.down = {}; G.Input.gamepad = null; G.Input.gamepadButtons = []; G.Game.reset('duo'); return G.Game.world; }

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
  for (const floor of [1, 2, 3]) for (const point of [[400, 580], [400, 420], [620, 420], [485, 490], [70, 70], [2335, 915]]) {
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
console.log(`\n${checks} regression groups passed. GPU rendering and physical controller not simulated.`);
