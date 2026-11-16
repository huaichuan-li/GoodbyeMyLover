/* 零依赖资产预览服务：node tools/serve-assets.mjs [端口]
 * - 静态服务整个项目根（含 .glb / 图片 / 本地 three.js）
 * - GET /__api/assets 动态扫描 assets/ 下的模型与图片，团队新增文件刷新即出现
 * 仅监听 127.0.0.1，不对外暴露。
 */
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, normalize, parse, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.argv[2]) || 8081;
const ASSETS = join(ROOT, 'assets');
const MANIFEST = join(ASSETS, 'publics', 'model', 'sketchfab', 'manifest.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ktx2': 'image/ktx2'
};

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
const MODEL_EXT = new Set(['.glb', '.gltf']);

const IMAGE_META = {
  '01_centaur_trueform': ['人马真形', '主角真形：人上身接马身、撕裂病号服、湿瓷砖长影'],
  '02_mummy_beloved': ['木乃伊爱人', '医用绷带全身缠绕、垂地绷带、隔帘后半隐'],
  '03_same_face_candidates': ['同脸候选群', '五个同脸候选并排，只有一个前倾半拍不同步'],
  '04_false_beloved': ['假爱人', '长成她样子的假爱人：手臂略长、绷带反向、重影错位'],
  '05_puddle_reflection_truth': ['水坑倒影', '倒影显真形，多出一个不该存在的影子'],
  '06_split_perception': ['分屏感知', '同一走廊的两种被诅咒的视觉：木乃伊 / 人马']
};

async function walk(dir) {
  const out = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

function webPath(full) {
  return '/' + relative(ROOT, full).split(sep).join('/');
}

function variantLabel(rel) {
  const p = rel.replace(/\\/g, '/');
  if (p.startsWith('assets/horror-characters/clean/')) return '去水印版';
  if (p.startsWith('assets/horror-characters/') && !p.startsWith('assets/horror-characters/clean/')) return '原图（带 AI 标识）';
  if (p.startsWith('assets/optimized/')) return '压缩版';
  const parts = p.split('/');
  return parts.length > 2 ? parts[parts.length - 2] : '原图';
}

async function scanAssets() {
  const files = await walk(ASSETS);
  let manifestMap = new Map();
  try {
    const mf = JSON.parse(await readFile(MANIFEST, 'utf8'));
    for (const a of (mf.assets || [])) manifestMap.set(a.file, a);
  } catch { /* manifest 不存在时退化为占位元数据 */ }

  const models = [];
  const imageGroups = new Map();

  for (const full of files) {
    const ext = extname(full).toLowerCase();
    const rel = relative(ROOT, full).split(sep).join('/');
    let size = 0;
    try { size = (await stat(full)).size; } catch { continue; }
    const web = webPath(full);

    if (MODEL_EXT.has(ext)) {
      const name = parse(full).base;
      const m = manifestMap.get(name) || {};
      models.push({
        id: 'model:' + name,
        type: 'model',
        name: m.title || parse(full).name,
        file: name,
        path: web,
        category: m.category || '未分类模型',
        purpose: m.purpose || '新加入的模型，尚未在 manifest.json 中登记',
        title: m.title || parse(full).name,
        author: m.author || '—',
        license: m.license || '未核验（使用前请确认许可）',
        faces: m.faces ?? null,
        bytes: size,
        url: m.url || '',
        registered: !!manifestMap.get(name)
      });
    } else if (IMG_EXT.has(ext)) {
      const key = parse(full).name;
      if (!imageGroups.has(key)) {
        const meta = IMAGE_META[key] || [key, '概念图 / 参考素材'];
        imageGroups.set(key, { id: 'image:' + key, key, name: meta[0], caption: meta[1], variants: [] });
      }
      imageGroups.get(key).variants.push({ label: variantLabel(rel), path: web, bytes: size, ext });
    }
  }

  models.sort((a, b) => (a.category || '').localeCompare(b.category || '', 'zh') || a.file.localeCompare(b.file));

  const images = [...imageGroups.values()].map((g) => {
    const order = { '压缩版': 0, '去水印版': 1, '原图（带 AI 标识）': 2 };
    g.variants.sort((a, b) => (order[a.label] ?? 5) - (order[b.label] ?? 5));
    const cover = g.variants.find((v) => v.label === '压缩版') || g.variants[0];
    return {
      id: g.id,
      key: g.key,
      type: 'image',
      name: g.name,
      file: g.key,
      category: '概念图',
      purpose: g.caption,
      caption: g.caption,
      cover: cover?.path || '',
      variants: g.variants,
      bytes: g.variants.reduce((s, v) => s + v.bytes, 0),
      author: '团队 AI 生成',
      license: '内部创作（原图带 AI 生成标识）',
      faces: null,
      url: ''
    };
  }).sort((a, b) => a.key.localeCompare(b.key));

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    models,
    images,
    stats: {
      models: models.length,
      images: images.length,
      imageFiles: images.reduce((s, i) => s + i.variants.length, 0),
      totalBytes: models.reduce((s, m) => s + m.bytes, 0) + images.reduce((s, i) => s + i.bytes, 0)
    }
  };
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { res.writeHead(400); return res.end('bad request'); }

  if (pathname === '/__api/assets') {
    try {
      const data = await scanAssets();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
  }

  if (pathname === '/' || pathname === '/assets' || pathname === '/assets/') {
    res.writeHead(302, { Location: '/asset-viewer/index.html' });
    return res.end();
  }

  try {
    const full = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
    const s = await stat(full);
    if (!s.isFile()) throw new Error('not a file');
    const body = await readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(body);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 · ' + e.message);
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  《再见？爱人！》资产预览台');
  console.log('  → http://127.0.0.1:' + PORT + '/asset-viewer/index.html');
  console.log('  新增模型放进 assets/publics/model/，新图放进 assets/，刷新页面即可出现。');
  console.log('  Ctrl+C 停止。');
  console.log('');
});
