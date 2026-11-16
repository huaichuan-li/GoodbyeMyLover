/* 《再见？爱人！》资产预览台
 * 零构建、零外网依赖：three.js 已本地化在 ./vendor/
 * 数据来源优先 /__api/assets（tools/serve-assets.mjs 动态扫描），否则降级读 manifest.json + 内置图片清单。
 */
import * as THREE from 'three';
import { OrbitControls } from './vendor/jsm/controls/OrbitControls.js';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const PROJECT = '再见？爱人！';
const LS_PICKS = 'zjar-asset-review-v1';
const LS_THUMBS = 'zjar-asset-thumbs-v1';

const FALLBACK_IMAGES = [
  ['01_centaur_trueform', '人马真形', '主角真形：人上身接马身、撕裂病号服、湿瓷砖长影'],
  ['02_mummy_beloved', '木乃伊爱人', '医用绷带全身缠绕、垂地绷带、隔帘后半隐'],
  ['03_same_face_candidates', '同脸候选群', '五个同脸候选并排，只有一个前倾半拍不同步'],
  ['04_false_beloved', '假爱人', '长成她样子的假爱人：手臂略长、绷带反向、重影错位'],
  ['05_puddle_reflection_truth', '水坑倒影', '倒影显真形，多出一个不该存在的影子'],
  ['06_split_perception', '分屏感知', '同一走廊的两种被诅咒的视觉：木乃伊 / 人马']
].map(([key, name, caption]) => ({
  id: 'image:' + key, type: 'image', name, file: key, category: '概念图',
  purpose: caption, caption, author: '团队 AI 生成', license: '内部创作（原图带 AI 生成标识）',
  faces: null, bytes: 0, url: '',
  variants: [
    { label: '压缩版', path: '../assets/optimized/' + key + '.jpg' },
    { label: '去水印版', path: '../assets/horror-characters/clean/' + key + '.png' },
    { label: '原图（带 AI 标识）', path: '../assets/horror-characters/' + key + '.png' }
  ],
  cover: '../assets/optimized/' + key + '.jpg'
}));

const state = {
  items: [], filtered: [], currentId: null,
  query: '', category: '全部', quick: null,
  picks: {}, thumbs: {},
  scanInfo: '', thumbAbort: false
};

function toRel(p) { return p && p.startsWith('/') ? '..' + p : p; }
function fmtBytes(n) {
  if (!n || n < 0) return '—';
  return n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n / 1024).toFixed(0) + ' KB';
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function getPick(id) { return state.picks[id] || { mark: '', star: false, note: '' }; }
function loadLS(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}
function saveLS(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; }
  catch { toast('本地存储空间不足，本次修改未能持久化'); return false; }
}
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}
function download(name, content, type = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

/* ================= 数据 ================= */
async function loadAssets() {
  let data = null;
  try {
    const r = await fetch('/__api/assets', { cache: 'no-store' });
    if (r.ok) data = await r.json();
  } catch { /* 走降级 */ }

  if (data && data.ok) {
    state.items = [...(data.models || []), ...(data.images || [])].map(it => ({
      ...it,
      path: toRel(it.path),
      cover: toRel(it.cover),
      variants: (it.variants || []).map(v => ({ ...v, path: toRel(v.path) }))
    }));
    state.scanInfo = `动态扫描 · ${data.stats.models} 个模型 / ${data.stats.images} 组图片 · ${fmtBytes(data.stats.totalBytes)}`;
  } else {
    let models = [];
    try {
      const r = await fetch('../assets/publics/model/sketchfab/manifest.json', { cache: 'no-store' });
      const mf = await r.json();
      models = (mf.assets || []).map(m => ({
        id: 'model:' + m.file, type: 'model', name: m.title || m.file,
        file: m.file, path: '../assets/publics/model/sketchfab/' + m.file,
        category: m.category || '未分类模型', purpose: m.purpose || '',
        title: m.title, author: m.author, license: m.license,
        faces: m.faces, bytes: m.bytes, url: m.url, registered: true
      }));
    } catch { /* manifest 不可用时只显示图片 */ }
    state.items = [...models, ...FALLBACK_IMAGES];
    state.scanInfo = `静态清单 · ${models.length} 个模型 / ${FALLBACK_IMAGES.length} 组图片（启动 serve-assets.mjs 可自动扫描新增文件）`;
  }
  $('#scan-info').textContent = state.scanInfo;
}

/* ================= 列表 / 筛选 ================= */
function applyFilter() {
  const q = state.query.trim().toLowerCase();
  state.filtered = state.items.filter(it => {
    if (state.category !== '全部' && it.category !== state.category) return false;
    const p = getPick(it.id);
    if (state.quick === 'picked' && p.mark !== '选用') return false;
    if (state.quick === 'starred' && !p.star) return false;
    if (q) {
      const hay = [it.name, it.file, it.purpose, it.author, it.title, it.category, it.license, it.caption]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderFilters() {
  const counts = new Map();
  for (const it of state.items) counts.set(it.category, (counts.get(it.category) || 0) + 1);
  const chips = [{ key: '全部', label: '全部', n: state.items.length, kind: 'cat' }];
  for (const [k, n] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh'))) {
    chips.push({ key: k, label: k, n, kind: 'cat' });
  }
  chips.push({ key: 'picked', label: '已选用', n: state.items.filter(i => getPick(i.id).mark === '选用').length, kind: 'quick' });
  chips.push({ key: 'starred', label: '已收藏', n: state.items.filter(i => getPick(i.id).star).length, kind: 'quick' });

  $('#filters').innerHTML = chips.map(c => {
    const on = c.kind === 'cat' ? (state.category === c.key) : (state.quick === c.key);
    return `<button class="chip${on ? ' is-on' : ''}" data-kind="${c.kind}" data-key="${esc(c.key)}">${esc(c.label)}<span class="n">${c.n}</span></button>`;
  }).join('');
}

function renderList(autoFollow = false) {
  const list = $('#asset-list');
  const scroll = list.scrollTop;
  applyFilter();
  renderFilters();
  $('#list-meta-text').textContent = `显示 ${state.filtered.length} / ${state.items.length} 项`;
  $('#search-count').textContent = state.query ? `${state.filtered.length} 项` : '';

  if (!state.filtered.length) {
    list.innerHTML = '<div class="boot">没有匹配的资产，换个关键词或筛选条件试试。</div>';
    return;
  }
  list.innerHTML = state.filtered.map(it => {
    const p = getPick(it.id);
    const thumb = it.type === 'image'
      ? `<img src="${esc(toRel(it.cover))}" loading="lazy" alt="">`
      : (state.thumbs[it.id]
          ? `<img src="${state.thumbs[it.id]}" alt="">`
          : `<svg class="ic"><use href="#i-cube"/></svg>`);
    const sub = it.type === 'model'
      ? `${it.category} · ${it.faces ? it.faces.toLocaleString() + ' 面 · ' : ''}${fmtBytes(it.bytes)}`
      : `${it.category} · ${it.variants.length} 个版本`;
    return `<div class="asset-item${it.id === state.currentId ? ' is-active' : ''}" data-id="${esc(it.id)}">
      <div class="thumb">${thumb}</div>
      <div class="item-main">
        <div class="item-name" title="${esc(it.name)}">${esc(it.name)}</div>
        <div class="item-sub" title="${esc(sub)}">${esc(sub)}</div>
      </div>
      <div class="item-flags">
        <svg class="ic ${p.star ? 'starred' : ''}"><use href="#i-star"/></svg>
        <span class="dot ${p.mark ? 'p-' + p.mark : ''}"></span>
      </div>
    </div>`;
  }).join('');
  list.scrollTop = scroll;

  // 筛选/搜索后若当前资产已不在结果里，自动跟随到第一项，避免主舞台停留在旧资产
  if (autoFollow && state.filtered.length && !state.filtered.some(x => x.id === state.currentId)) {
    selectItem(state.filtered[0].id);
  }
}

function renderTally() {
  const c = { 选用: 0, 待定: 0, 不用: 0, 未标记: 0 };
  for (const it of state.items) {
    const m = getPick(it.id).mark || '未标记';
    c[m] = (c[m] || 0) + 1;
  }
  $('#tally').innerHTML =
    `<span class="t-y">选用 <b>${c['选用']}</b></span>` +
    `<span class="t-p">待定 <b>${c['待定']}</b></span>` +
    `<span class="t-n">不用 <b>${c['不用']}</b></span>` +
    `<span>未标记 <b>${c['未标记']}</b></span>`;
}

/* ================= 选中 / 信息 ================= */
function selectItem(id) {
  const it = state.items.find(x => x.id === id);
  if (!it) return;
  state.currentId = id;
  $$('.asset-item').forEach(el => el.classList.toggle('is-active', el.dataset.id === id));

  const p = getPick(id);
  $('#crumb-type').textContent = it.type === 'model' ? '3D 模型' : '图片资产';
  $('#crumb-cat').textContent = it.category || '—';
  $('#asset-title').textContent = it.name;
  const badges = [];
  if (it.type === 'model') {
    badges.push(`<span class="badge">GLB · ${fmtBytes(it.bytes)}</span>`);
    if (it.faces) badges.push(`<span class="badge">${it.faces.toLocaleString()} 面</span>`);
  } else {
    badges.push(`<span class="badge">${it.variants.length} 个版本</span>`);
  }
  const unverified = /未核验|未登记/.test(it.license || '');
  badges.push(`<span class="badge ${unverified ? 'b-unverified' : 'b-license'}">${esc(it.license || '许可未知')}</span>`);
  if (it.registered === false) badges.push('<span class="badge b-unverified">manifest 未登记</span>');
  $('#asset-badges').innerHTML = badges.join('');

  $$('#pick-seg button').forEach(b => b.classList.toggle('is-on', b.dataset.pick === p.mark));
  $('#btn-star').classList.toggle('is-on', !!p.star);
  $('#note-input').value = p.note || '';
  $('#info-id').textContent = it.file || it.id;

  renderInfo(it);
  if (it.type === 'model') { showPane('model'); loadModel(it); }
  else { showPane('image'); showImage(it); }
}

function renderInfo(it) {
  const row = (k, v) => `<div class="info-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  let html = '';
  if (it.type === 'model') {
    html += row('文件', `<code>${esc(it.file)}</code>`);
    html += row('类别', esc(it.category));
    html += row('原模型', esc(it.title || it.name));
    html += row('作者', esc(it.author || '—'));
    html += row('许可', esc(it.license || '—'));
    html += row('三角面', it.faces ? it.faces.toLocaleString() : '—');
    html += row('体积', fmtBytes(it.bytes));
    html += row('网格 / 材质', '<span id="mesh-stat">加载中…</span>');
    if (it.url) html += row('来源', `<a href="${esc(it.url)}" target="_blank" rel="noopener">Sketchfab ↗</a>`);
    html += `<div class="info-desc">${esc(it.purpose || '暂无用途说明')}</div>`;
  } else {
    html += row('文件名', `<code>${esc(it.file)}</code>`);
    html += row('类别', esc(it.category));
    html += row('版本数', it.variants.length + ' 个');
    html += row('作者', esc(it.author || '—'));
    html += row('许可 / 说明', esc(it.license || '—'));
    html += row('像素尺寸', '<span id="img-dim">读取中…</span>');
    html += `<div class="info-desc">${esc(it.caption || it.purpose || '')}</div>`;
    html += `<div class="info-warn">原图右下角带平台 AI 生成标识；对外公开发布请使用原图或补齐 AI 标识，去水印版仅用于内部概念稿。</div>`;
  }
  if (/未核验|未登记/.test(it.license || '') || it.registered === false) {
    html += `<div class="info-warn">该资产尚未在 manifest.json 登记许可与作者，正式使用前请先核对来源许可。</div>`;
  }
  $('#info-body').innerHTML = html;
}

function showPane(which) {
  $('#model-pane').hidden = which !== 'model';
  $('#image-pane').hidden = which !== 'image';
}

function setPick(patch) {
  if (!state.currentId) return;
  const id = state.currentId;
  state.picks[id] = { ...getPick(id), ...patch };
  saveLS(LS_PICKS, state.picks);
  const p = getPick(id);
  $$('#pick-seg button').forEach(b => b.classList.toggle('is-on', b.dataset.pick === p.mark));
  $('#btn-star').classList.toggle('is-on', !!p.star);
  renderTally(); renderList();
}

/* ================= 3D 预览 ================= */
let renderer, scene, camera, controls, grid;
let currentHolder = null, loadToken = 0, viewDist = 6, viewRadius = 2;
let wireSaved = [];

function initThree() {
  const host = $('#canvas-host');
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = Number($('#t-exposure').value) || 1.4;
  renderer.setClearColor(0x11161d, 1);
  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11161d);
  scene.fog = new THREE.Fog(0x11161d, 18, 46);

  camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
  camera.position.set(4, 3, 5);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.rotateSpeed = 0.85;
  controls.zoomSpeed = 0.95;
  controls.panSpeed = 0.8;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.35;
  controls.maxDistance = 80;
  controls.autoRotateSpeed = 1.5;

  scene.add(new THREE.HemisphereLight(0xd9e8f5, 0x232b36, 2.0));
  const key = new THREE.DirectionalLight(0xffffff, 2.3); key.position.set(4, 7, 5); scene.add(key);
  const fill = new THREE.DirectionalLight(0x9ec6d8, 1.2); fill.position.set(-5, 2, -4); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffd8c0, 0.6); rim.position.set(0, -3, -5); scene.add(rim);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));

  grid = new THREE.GridHelper(10, 20, 0x3d5060, 0x283540);
  grid.material.transparent = true; grid.material.opacity = 0.55;
  grid.visible = true;
  scene.add(grid);

  const ro = new ResizeObserver(resizeThree);
  ro.observe(host);
  resizeThree();
  (function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();
}

function resizeThree() {
  const host = $('#canvas-host');
  const w = host.clientWidth || 800, h = host.clientHeight || 600;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function disposeObject3D(root) {
  if (!root) return;
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) [].concat(o.material).forEach(m => {
      if (!m) return;
      for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); }
      m.dispose();
    });
  });
}
function disposeHolder(holder) {
  if (!holder) return;
  scene.remove(holder);
  disposeObject3D(holder);
}

function normalizeIntoHolder(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = 2.4 / maxDim;
  root.position.sub(center);
  const holder = new THREE.Group();
  holder.add(root);
  holder.scale.setScalar(s);
  const half = size.clone().multiplyScalar(s / 2);
  viewRadius = Math.max(half.length(), 0.6);
  viewDist = viewRadius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.18;
  grid.position.y = -half.y - 0.004;
  return holder;
}

function collectStats(root) {
  let tris = 0, meshes = 0; const mats = new Set();
  root.traverse(o => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    const c = g && (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0));
    tris += Math.floor((c || 0) / 3);
    [].concat(o.material || []).forEach(m => m && mats.add(m.uuid));
  });
  const el = $('#mesh-stat');
  if (el) el.textContent = `${meshes} 个网格 · ${tris.toLocaleString()} 三角面 · ${mats.size} 材质`;
}

function showLoading(on, label) {
  $('#model-loading').hidden = !on;
  if (on) { $('#loading-text').textContent = label || '加载模型…'; $('#progress-bar').style.width = '0%'; }
}
function showError(msg) {
  $('#model-error').hidden = false;
  $('#error-text').innerHTML = msg;
}

function loadModel(it) {
  const token = ++loadToken;
  showLoading(true, '加载模型…');
  $('#model-error').hidden = true;
  disposeHolder(currentHolder); currentHolder = null; wireSaved = [];
  $('#t-wire').classList.remove('is-on');
  $('#model-empty').hidden = true;

  const loader = new GLTFLoader();
  loader.load(toRel(it.path), (gltf) => {
    if (token !== loadToken) { disposeGltf(gltf.scene); return; }
    try {
      const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
      if (!root) throw new Error('GLB 中没有可用场景');
      currentHolder = normalizeIntoHolder(root);
      scene.add(currentHolder);
      collectStats(root);
      resetView(false);
      showLoading(false);
    } catch (e) { showLoading(false); showError('模型处理失败：' + esc(String(e))); }
  }, (evt) => {
    if (token !== loadToken) return;
    if (evt.lengthComputable && evt.total) {
      const pct = Math.min(100, Math.round(evt.loaded / evt.total * 100));
      $('#progress-bar').style.width = pct + '%';
      $('#loading-text').textContent = `加载模型… ${pct}%（${fmtBytes(evt.loaded)} / ${fmtBytes(evt.total)}）`;
    } else {
      $('#loading-text').textContent = `加载模型… ${fmtBytes(evt.loaded)}`;
    }
  }, (err) => {
    if (token !== loadToken) return;
    showLoading(false);
    const msg = String(err && err.message || err);
    showError(`<strong>模型加载失败</strong><br>${esc(msg)}<br><br>常见原因：用 <code>file://</code> 直接打开（请改用本地服务）、文件被移动、或模型含 Draco / Meshopt 压缩扩展（当前加载器未附解码器）。`);
  });
}

function disposeGltf(root) {
  if (!root) return;
  root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
}

const VIEW_DIRS = {
  front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0],
  top: [0, 1, 0.001], iso: [1, 0.72, 1]
};
let camTween = 0;
function moveCamera(dir, instant = false) {
  const to = new THREE.Vector3(...dir).normalize().multiplyScalar(viewDist);
  if (instant) { camera.position.copy(to); controls.target.set(0, 0, 0); controls.update(); return; }
  const from = camera.position.clone(), token = ++camTween;
  let t = 0;
  (function step() {
    if (token !== camTween) return;
    t = Math.min(1, t + 0.055);
    const e = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(from, to, e);
    controls.target.lerp(new THREE.Vector3(0, 0, 0), e);
    controls.update();
    if (t < 1) requestAnimationFrame(step);
  })();
}
function resetView(instant = false) { moveCamera(VIEW_DIRS.iso, instant); }

function toggleWire(on) {
  if (!currentHolder) return;
  if (on) {
    wireSaved = [];
    currentHolder.traverse(o => {
      if (!o.isMesh || !o.material) return;
      [].concat(o.material).forEach(m => {
        if (!m || typeof m.wireframe === 'undefined') return;
        wireSaved.push([m, m.wireframe]);
        m.wireframe = true;
      });
    });
  } else {
    wireSaved.forEach(([m, v]) => { m.wireframe = v; });
    wireSaved = [];
  }
}

function screenshot() {
  if (!currentHolder) { toast('请先选择一个 3D 模型'); return; }
  try {
    renderer.render(scene, camera);
    const it = state.items.find(x => x.id === state.currentId);
    download((it?.file || 'asset').replace(/\.[^.]+$/, '') + '_preview.png',
      dataURLtoBlob(renderer.domElement.toDataURL('image/png')), 'image/png');
    toast('截图已保存');
  } catch (e) { toast('截图失败：' + e.message); }
}
function dataURLtoBlob(u) {
  const [head, b64] = u.split(',');
  const mime = /:(.*?);/.exec(head)[1];
  const bin = atob(b64), arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/* 列表缩略图：离屏渲染，结果缓存到 localStorage */
async function generateThumbs() {
  const models = state.items.filter(i => i.type === 'model');
  if (!models.length) { toast('没有可生成缩略图的模型'); return; }
  state.thumbAbort = false;
  const btn = $('#btn-thumbs'); btn.disabled = true;
  const cv = document.createElement('canvas');
  let thumbRenderer;
  try {
    thumbRenderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true, alpha: false });
    thumbRenderer.setSize(200, 150, false);
    thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
    thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    thumbRenderer.setClearColor(0x11161d, 1);
    const s = new THREE.Scene(); s.background = new THREE.Color(0x11161d);
    s.add(new THREE.HemisphereLight(0xd9e8f5, 0x1b222c, 1.6));
    const l = new THREE.DirectionalLight(0xffffff, 2.0); l.position.set(4, 7, 5); s.add(l);
    const c = new THREE.PerspectiveCamera(45, 200 / 150, 0.01, 500);
    const loader = new GLTFLoader();

    for (let i = 0; i < models.length; i++) {
      if (state.thumbAbort) break;
      const it = models[i];
      btn.textContent = `生成中 ${i + 1}/${models.length}`;
      try {
        const gltf = await new Promise((res, rej) => loader.load(toRel(it.path), res, undefined, rej));
        const root = gltf.scene || gltf.scenes[0];
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
        const sc = 2.4 / (Math.max(size.x, size.y, size.z) || 1);
        root.position.sub(center);
        const holder = new THREE.Group(); holder.add(root); holder.scale.setScalar(sc); s.add(holder);
        const radius = Math.max(size.clone().multiplyScalar(sc / 2).length(), 0.6);
        const d = radius / Math.tan(THREE.MathUtils.degToRad(22.5)) * 1.2;
        c.position.set(d * 0.62, d * 0.45, d * 0.62); c.lookAt(0, 0, 0);
        thumbRenderer.render(s, c);
        state.thumbs[it.id] = cv.toDataURL('image/jpeg', 0.68);
        s.remove(holder); disposeObject3D(holder);
      } catch (e) { /* 单个失败跳过 */ }
    }
    saveLS(LS_THUMBS, state.thumbs);
    renderList();
    toast(`已生成 ${Object.keys(state.thumbs).length} 张缩略图`);
  } catch (e) { toast('缩略图生成失败：' + e.message); }
  finally {
    if (thumbRenderer) thumbRenderer.dispose();
    btn.disabled = false; btn.textContent = '生成缩略图';
  }
}

/* ================= 图片预览 ================= */
const imgView = { zoom: 1, x: 0, y: 0, variant: 0 };
function applyImgTransform() {
  const el = $('#image-main');
  el.style.transform = `translate(${imgView.x}px, ${imgView.y}px) scale(${imgView.zoom})`;
  $('#zoom-label').textContent = Math.round(imgView.zoom * 100) + '%';
}
function imgFit() { imgView.zoom = 1; imgView.x = 0; imgView.y = 0; applyImgTransform(); }
function showImage(it) {
  imgFit();
  $('#variant-tabs').innerHTML = it.variants.map((v, i) =>
    `<button data-i="${i}" class="${i === 0 ? 'is-on' : ''}">${esc(v.label)}</button>`).join('');
  setVariant(it, 0);
}
function setVariant(it, i) {
  imgView.variant = i;
  const v = it.variants[i];
  if (!v) return;
  const el = $('#image-main');
  el.src = toRel(v.path);
  $('#img-open').href = toRel(v.path);
  $$('#variant-tabs button').forEach(b => b.classList.toggle('is-on', +b.dataset.i === i));
  el.onload = () => {
    const dim = $('#img-dim');
    if (dim) dim.textContent = `${el.naturalWidth} × ${el.naturalHeight}`;
    imgFit();
  };
}

/* ================= 导出 / 导入 ================= */
function buildMarkdown() {
  const groups = ['选用', '待定', '不用', '未标记'];
  const lines = [
    `# ${PROJECT} · 资产挑选清单`, '',
    `> 导出时间：${new Date().toLocaleString('zh-CN')}　|　共 ${state.items.length} 项资产（${state.items.filter(i => i.type === 'model').length} 个模型 / ${state.items.filter(i => i.type === 'image').length} 组图片）`,
    `> 来源：Sketchfab CC BY 模型 + 团队 AI 概念图，项目非商用。`, '',
    '## 统计', '',
    '| 标记 | 数量 |', '|---|---|'
  ];
  for (const g of groups) lines.push(`| ${g} | ${state.items.filter(i => (getPick(i.id).mark || '未标记') === g).length} |`);
  lines.push('', '> ⚠️ CC BY 模型只要仍在场景中使用，就必须保留「模型名 + 作者 + 来源链接 + 许可」；完整署名表见 `assets/publics/model/sketchfab/ATTRIBUTION.md`。', '');

  for (const g of groups) {
    const arr = state.items.filter(i => (getPick(i.id).mark || '未标记') === g);
    lines.push(`## ${g}（${arr.length}）`, '');
    if (!arr.length) { lines.push('_无_', ''); continue; }
    lines.push('| 类型 | 名称 | 文件 | 类别 | 用途 | 作者 | 许可 | 来源 | 备注 |', '|---|---|---|---|---|---|---|---|---|');
    for (const it of arr) {
      const p = getPick(it.id);
      const cell = s => String(s ?? '—').replace(/\|/g, '/').replace(/\n/g, ' ');
      lines.push(`| ${it.type === 'model' ? '3D' : '图片'} | ${cell(it.name)} | \`${cell(it.file)}\` | ${cell(it.category)} | ${cell(it.purpose)} | ${cell(it.author)} | ${cell(it.license)} | ${it.url ? '[链接](' + it.url + ')' : '—'} | ${cell(p.note)} |`);
    }
    lines.push('');
  }
  lines.push('---', '', '策划侧占位资产；人物设计与正式资产由其他组交付后，保持文件名不变替换即可。', '');
  return lines.join('\n');
}

function exportJSON() {
  const picks = {};
  for (const it of state.items) {
    const p = getPick(it.id);
    if (p.mark || p.star || p.note) picks[it.id] = { ...p, name: it.name, file: it.file };
  }
  download(`${PROJECT}_挑选结果_${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify({ project: PROJECT, exportedAt: new Date().toISOString(), picks }, null, 2),
    'application/json;charset=utf-8');
  toast('JSON 已导出，可发给组员导入');
}

/* ================= 事件绑定 ================= */
function bindUI() {
  $('#search').addEventListener('input', e => { state.query = e.target.value; renderList(true); });
  $('#filters').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    if (b.dataset.kind === 'cat') { state.category = b.dataset.key; state.quick = null; }
    else { state.quick = state.quick === b.dataset.key ? null : b.dataset.key; state.category = '全部'; }
    renderList(true);
  });
  $('#asset-list').addEventListener('click', e => {
    const el = e.target.closest('.asset-item'); if (el) selectItem(el.dataset.id);
  });
  $('#btn-refresh').addEventListener('click', async () => {
    if (state.currentId && !state.items.some(i => i.id === state.currentId)) state.currentId = null;
    await loadAssets(); renderList(true); renderTally();
    toast('资产清单已重新扫描');
  });
  $('#btn-thumbs').addEventListener('click', generateThumbs);

  $('#pick-seg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const cur = getPick(state.currentId).mark;
    setPick({ mark: cur === b.dataset.pick ? '' : b.dataset.pick });
  });
  $('#btn-star').addEventListener('click', () => setPick({ star: !getPick(state.currentId).star }));
  $('#note-input').addEventListener('input', e => setPick({ note: e.target.value }));

  $('#t-exposure').addEventListener('input', e => {
    if (renderer) renderer.toneMappingExposure = Number(e.target.value);
  });
  $('#view-toolbar').addEventListener('click', e => {
    const v = e.target.closest('[data-view]');
    if (v) { moveCamera(VIEW_DIRS[v.dataset.view]); return; }
    const id = e.target.closest('button')?.id;
    if (id === 't-spin') { controls.autoRotate = !controls.autoRotate; e.target.closest('button').classList.toggle('is-on', controls.autoRotate); }
    if (id === 't-wire') { const on = !e.target.closest('button').classList.contains('is-on'); e.target.closest('button').classList.toggle('is-on', on); toggleWire(on); }
    if (id === 't-grid') { grid.visible = !grid.visible; e.target.closest('button').classList.toggle('is-on', grid.visible); }
    if (id === 't-reset') resetView();
    if (id === 't-shot') screenshot();
    if (id === 't-full') {
      if (document.fullscreenElement) document.exitFullscreen();
      else $('#viewer-shell').requestFullscreen?.();
    }
  });

  $('#variant-tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const it = state.items.find(x => x.id === state.currentId);
    if (it) setVariant(it, +b.dataset.i);
  });
  $('#img-zoom-in').addEventListener('click', () => { imgView.zoom = Math.min(8, imgView.zoom * 1.25); applyImgTransform(); });
  $('#img-zoom-out').addEventListener('click', () => { imgView.zoom = Math.max(0.2, imgView.zoom / 1.25); applyImgTransform(); });
  $('#img-fit').addEventListener('click', imgFit);
  const stage = $('#image-stage');
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    imgView.zoom = Math.min(8, Math.max(0.2, imgView.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    applyImgTransform();
  }, { passive: false });
  stage.addEventListener('dblclick', imgFit);
  let drag = null;
  stage.addEventListener('pointerdown', e => {
    if (e.target.tagName !== 'IMG') return;
    drag = { x: e.clientX, y: e.clientY, ox: imgView.x, oy: imgView.y };
    stage.classList.add('dragging'); stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', e => {
    if (!drag) return;
    imgView.x = drag.ox + e.clientX - drag.x;
    imgView.y = drag.oy + e.clientY - drag.y;
    applyImgTransform();
  });
  const endDrag = () => { drag = null; stage.classList.remove('dragging'); };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  $('#btn-export-md').addEventListener('click', () => {
    download(`${PROJECT}_资产挑选清单_${new Date().toISOString().slice(0, 10)}.md`, buildMarkdown(), 'text/markdown;charset=utf-8');
    toast('Markdown 清单已导出');
  });
  $('#btn-export-json').addEventListener('click', exportJSON);
  $('#btn-import-json').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!d.picks || typeof d.picks !== 'object') throw new Error('缺少 picks 字段');
      let n = 0;
      for (const [id, p] of Object.entries(d.picks)) {
        if (!state.items.some(i => i.id === id)) continue;
        state.picks[id] = { mark: p.mark || '', star: !!p.star, note: p.note || '' };
        n++;
      }
      saveLS(LS_PICKS, state.picks);
      renderList(); renderTally();
      if (state.currentId) selectItem(state.currentId);
      toast(`已合并 ${n} 条挑选结果`);
    } catch (err) { toast('导入失败：' + err.message); }
    e.target.value = '';
  });

  const help = $('#help-modal');
  $('#btn-help').addEventListener('click', () => { help.hidden = false; });
  $('#btn-help-close').addEventListener('click', () => { help.hidden = true; });
  help.addEventListener('click', e => { if (e.target === help) help.hidden = true; });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { help.hidden = true; return; }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); $('#search').focus(); return; }
    const idx = state.filtered.findIndex(i => i.id === state.currentId);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const d = e.key === 'ArrowRight' ? 1 : -1;
      const next = state.filtered[(idx + d + state.filtered.length) % state.filtered.length];
      if (next) { selectItem(next.id); $$('.asset-item.is-active')[0]?.scrollIntoView({ block: 'nearest' }); }
    }
    if (['1', '2', '3'].includes(e.key) && state.currentId) setPick({ mark: ['选用', '待定', '不用'][+e.key - 1] });
    if (e.key.toLowerCase() === 's' && state.currentId) setPick({ star: !getPick(state.currentId).star });
    if (e.key.toLowerCase() === 'r') resetView();
    if (e.key.toLowerCase() === 'f') $('#t-full').click();
  });
}

/* ================= 启动 ================= */
async function main() {
  state.picks = loadLS(LS_PICKS, {});
  state.thumbs = loadLS(LS_THUMBS, {});
  bindUI();
  try { initThree(); }
  catch (e) { showError('WebGL 初始化失败：' + esc(String(e)) + '<br>请确认浏览器已启用硬件加速。'); }
  await loadAssets();
  renderList(); renderTally();
  if (state.filtered.length) selectItem(state.filtered[0].id);
}

main();
