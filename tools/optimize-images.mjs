/* 用 macOS 自带 sips 把 clean/ 概念图压成小体积 JPEG（零第三方依赖）
 * 用法：node tools/optimize-images.mjs
 * 产物：assets/optimized/*.jpg —— index.html 用相对路径，standalone.html 内联 base64
 */
import { readdir, mkdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'assets', 'horror-characters', 'clean');
const OUT = join(ROOT, 'assets', 'optimized');
const PORTRAIT = /^(01|02|04|05)_/;   // 竖版 1024x1536；其余横版 1536x1024

await mkdir(OUT, { recursive: true });
const files = (await readdir(SRC)).filter(function (f) {
  return f.toLowerCase().endsWith('.png');
}).sort();

if (!files.length) {
  console.error('未找到源图：' + SRC);
  process.exit(1);
}

let ok = 0;
for (const f of files) {
  const name = basename(f, '.png') + '.jpg';
  const max = PORTRAIT.test(f) ? 720 : 1280;
  // 传数组参数，不走 shell，避免路径注入
  const args = ['-Z', String(max), '-s', 'format', 'jpeg',
                '-s', 'formatOptions', '68', join(SRC, f), '--out', join(OUT, name)];
  try {
    execFileSync('sips', args, { stdio: 'pipe' });
  } catch (e) {
    console.warn('[optimize] sips 失败，跳过 ' + f + '：' + e.message);
    continue;
  }
  const s = await stat(join(OUT, name)).catch(function () { return null; });
  if (!s || s.size < 1024) {
    console.warn('[optimize] 产物异常：' + name);
    continue;
  }
  ok++;
  console.log(name + '  ' + (s.size / 1024).toFixed(0) + ' KB');
}

console.log('完成：' + ok + '/' + files.length + ' 张 → ' + OUT);
if (ok !== files.length) process.exit(1);
