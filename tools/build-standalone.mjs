/* 把 css/js/图片内联进单文件：断网 / 无 Node 的路演保险
 * 用法：node tools/build-standalone.mjs [--skip-images]
 * --skip-images 仅供 http 调试，交付态不得使用
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OPT = join(ROOT, 'assets', 'optimized');
const CLEAN = join(ROOT, 'assets', 'horror-characters', 'clean');
const SKIP = process.argv.includes('--skip-images');
let html = await readFile(join(ROOT, 'index.html'), 'utf8');

const cssRe = /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g;
const jsRe = /<script\s+src="([^"]+)"><\/script>/g;

// 函数式 replacer：避免替换文本里的 $& / $1 被当成替换模式解释
const cssMatches = [...html.matchAll(cssRe)];
for (const m of cssMatches) {
  const css = await readFile(join(ROOT, m[1]), 'utf8');
  html = html.replace(m[0], () => `<style>
${css}
</style>`);
}
const jsMatches = [...html.matchAll(jsRe)];
for (const m of jsMatches) {
  const js = await readFile(join(ROOT, m[1]), 'utf8');
  html = html.replace(m[0], () => `<script>
${js}
</script>`);
}

// 图片：对内联后的整份 HTML 做「路径字符串 → data URI」全局替换。
// 一条正则同时覆盖 JS 字面量 / <img src> / CSS url()，不依赖标签形态。
const pathRe = /assets\/optimized\/[A-Za-z0-9_.-]+\.(?:jpg|jpeg|png|webp)/g;
const paths = [...new Set(html.match(pathRe) || [])];
const cache = new Map();
const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

async function dataURI(rel) {
  if (cache.has(rel)) return cache.get(rel);
  const name = basename(rel);
  let buf = null;
  let mime = extname(name).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  try {
    buf = await readFile(join(OPT, name));
  } catch {
    try {
      buf = await readFile(join(CLEAN, name.replace(/\.(jpg|jpeg|webp)$/, '.png')));
      mime = 'image/png';
      console.warn('[standalone] 优化产物缺失，回退原图 base64：' + name);
    } catch {
      console.error('[standalone] 图片缺失，已用 1x1 透明占位：' + name);
    }
  }
  const uri = buf ? `data:${mime};base64,${buf.toString('base64')}` : PLACEHOLDER;
  cache.set(rel, uri);
  return uri;
}

let inlined = 0;
if (!SKIP) {
  for (const p of paths) {
    html = html.split(p).join(await dataURI(p));   // split/join 不受 $ 特殊序列影响
    inlined++;
  }
} else {
  console.warn('警告：--skip-images 产物不自包含，仅可用于 http 调试');
}

await writeFile(join(ROOT, 'standalone.html'), html, 'utf8');
const mb = (Buffer.byteLength(html) / 1048576).toFixed(2);
console.log(`standalone.html 已生成（${cssMatches.length} css / ${jsMatches.length} js / ${inlined} 图内联，${mb} MB）`);
