/* 把 css/js 内联进单文件：断网 / 无 Node 的路演保险 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
let html = await readFile(join(ROOT, 'index.html'), 'utf8');

const cssRe = /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g;
const jsRe = /<script\s+src="([^"]+)"><\/script>/g;

const cssMatches = [...html.matchAll(cssRe)];
for (const m of cssMatches) {
  const css = await readFile(join(ROOT, m[1]), 'utf8');
  html = html.replace(m[0], `<style>\n${css}\n</style>`);
}
const jsMatches = [...html.matchAll(jsRe)];
for (const m of jsMatches) {
  const js = await readFile(join(ROOT, m[1]), 'utf8');
  html = html.replace(m[0], `<script>\n${js}\n</script>`);
}
await writeFile(join(ROOT, 'standalone.html'), html, 'utf8');
console.log(`standalone.html 已生成（${cssMatches.length} css / ${jsMatches.length} js 内联）`);
